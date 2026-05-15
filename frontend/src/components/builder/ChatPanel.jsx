import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Send, Bot, Square, Wrench, CheckCircle2, XCircle, ChevronDown, ArrowDown, Paperclip, X, Image, FileText, Copy, Check, Circle, Zap, Globe, Terminal, Settings, Webhook, CalendarClock, Coins, Search, Download, Share2, Users as UsersIcon, Loader2, MoreVertical } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_CLASSES, sanitizeForMarkdown, createMarkdownComponents, MemoMarkdown } from './ChatMarkdown'
import { TypewriterText, RotatingThinking, extractLastLine, TOOL_DESCRIPTIONS, TOOL_DISPLAY_NAMES } from './ChatActivity'
import ReactionBar from '../feedback/ReactionBar'
import { track } from '../../services/analytics'
// Virtuoso removed — plain scroll div prevents flickering during streaming
import toast from 'react-hot-toast'
import { keysAPI, chatAPI, toolsAPI, workflowsAPI, deploysAPI, taskHistoryAPI, creditsAPI, schedulesAPI } from '../../services/api'
import CreditPill from './CreditPill'
import { humanizeCron } from '../../utils/cron'
import { useAuth } from '../../context/AuthContext'
import { getMasterAgentPrompt } from '../../data/masterAgentPromptV2'
import { buildInvokeCurl } from '../../utils/curlBuilder'
import Tooltip from '../ui/Tooltip'
import FilePreviewModal from '../ui/FilePreviewModal'

// MIME types that render as inline text previews (font-mono <pre>) instead of
// images. Mirrors backend `llm.rs::is_text_like_mime` and `r2.rs::is_allowed_chat_mime`
// — single source of truth for the 3 preview surfaces (composer tile, bubble
// card, modal) and the text-fetch hook.
const STRUCTURED_TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/x-ndjson',
])
const isTextLikeMime = (mime) =>
  typeof mime === 'string' && (mime.startsWith('text/') || STRUCTURED_TEXT_MIMES.has(mime))

// Short uppercase format label rendered on the attachment card badge. Pasted
// text without a filename keeps the "PASTED" affordance so users can still
// tell apart paste-card from file-upload at a glance; everything else gets
// its format (JSON / CSV / MD / XML / YAML / TSV / NDJSON / TXT).
const formatLabelForMime = (mime, hasName) => {
  if (mime === 'application/pdf') return 'PDF'
  if (mime === 'application/json') return 'JSON'
  if (mime === 'application/x-ndjson') return 'NDJSON'
  if (mime === 'application/xml' || mime === 'text/xml') return 'XML'
  if (mime === 'application/yaml' || mime === 'application/x-yaml' || mime === 'text/yaml') return 'YAML'
  if (mime === 'text/csv') return 'CSV'
  if (mime === 'text/markdown') return 'MD'
  if (mime === 'text/tab-separated-values') return 'TSV'
  if (mime === 'text/plain') return hasName ? 'TXT' : 'PASTED'
  if (typeof mime === 'string' && mime.startsWith('text/')) return 'TEXT'
  return 'FILE'
}

// Resolve an attachment URL against the API base so images persisted on
// messages render in local dev (where frontend runs on :3000 and the backend
// on :4000) as well as production (shared domain behind nginx). Mirrors
// FilePreviewModal's resolveSrc() so the two paths stay in sync.
const resolveAttachmentSrc = (src) => {
  if (!src) return ''
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
  return `${base}${src.startsWith('/') ? src : '/' + src}`
}

// Trigger a browser download of an attachment. Handles three source shapes:
//   1. `att.dataUrl` (base64 data: URL) — composer-side just-picked files
//   2. `att.text` (raw string) — pasted-text attachments
//   3. `att.url` (backend proxy URL) — persisted message attachments
// For remote URLs we fetch → Blob → createObjectURL so the browser saves the
// bytes directly instead of navigating away. Same mechanism the preview modal
// download button uses.
async function downloadAttachment(att) {
  const name = att.name || (att.mime_type?.startsWith('image/') || att.mimeType?.startsWith('image/') ? 'image' :
                            (att.mime_type === 'application/pdf' || att.mimeType === 'application/pdf') ? 'document.pdf' :
                            'attachment.txt')
  let href = att.dataUrl
  let revoke = null
  try {
    if (!href && typeof att.text === 'string') {
      const blob = new Blob([att.text], { type: att.mimeType || 'text/plain' })
      href = URL.createObjectURL(blob)
      revoke = href
    } else if (!href && att.url) {
      const resolved = att.url.startsWith('http') || att.url.startsWith('data:')
        ? att.url
        : `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}${att.url.startsWith('/') ? att.url : '/' + att.url}`
      const r = await fetch(resolved)
      if (!r.ok) throw new Error(`fetch ${r.status}`)
      const blob = await r.blob()
      href = URL.createObjectURL(blob)
      revoke = href
    }
    if (!href) return
    const a = document.createElement('a')
    a.href = href
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 1000)
  }
}

// Lazy-fetch the text content of a persisted text/plain attachment so its
// card face can show a real preview after reload. Messages only persist the
// signed URL + mime_type — the original text was never written to the DB, so
// we pull it from the proxy endpoint the first time the card renders and
// cache the result in a ref-indexed map. Small (<= 1 MB) + already HMAC-gated.
const textPreviewCache = new Map()
function useTextAttachmentPreview(att) {
  const [loaded, setLoaded] = useState(() => {
    if (typeof att?.text === 'string') return att.text
    if (typeof att?.preview === 'string') return att.preview
    if (att?.url && textPreviewCache.has(att.url)) return textPreviewCache.get(att.url)
    return null
  })
  useEffect(() => {
    if (loaded != null) return
    if (typeof att?.text === 'string' || typeof att?.preview === 'string') return
    if (!att?.url) return
    let cancelled = false
    const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
    const abs = att.url.startsWith('http') ? att.url : `${base}${att.url.startsWith('/') ? att.url : '/' + att.url}`
    fetch(abs)
      .then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status))))
      .then(txt => {
        if (cancelled) return
        const preview = txt.slice(0, 400)
        textPreviewCache.set(att.url, preview)
        setLoaded(preview)
      })
      .catch(() => { if (!cancelled) setLoaded('') })
    return () => { cancelled = true }
  }, [att?.url, att?.text, att?.preview, loaded])
  return loaded
}

// Single attachment card: uniform 110×120 px, shadow darkens on hover (no
// overlay, no eye icon, no blur — per feedback 2026-04-17). Whole card is a
// button that opens the full-screen preview. Text/plain cards lazy-fetch
// their content so the face shows real preview after reload.
function AttachmentCard({ att, onOpen, resolveSrc }) {
  const mime = att.mime_type || att.mimeType || ''
  const isPdf = mime === 'application/pdf'
  const isText = isTextLikeMime(mime)
  const textPreview = useTextAttachmentPreview(isText ? att : null)
  const badgeLabel = formatLabelForMime(mime, !!att.name)

  const sizing = "w-[110px] h-[110px] sm:w-[120px] sm:h-[120px] flex-shrink-0"
  const base =
    "relative rounded-xl overflow-hidden border cursor-pointer " +
    "shadow-sm hover:shadow-lg focus:shadow-lg " +
    "transition-[box-shadow,border-color] duration-200 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"

  if (isPdf) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${sizing} ${base} bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50 hover:border-red-300 dark:hover:border-red-900 flex flex-col items-center justify-center gap-1 p-2`}
        aria-label={`Open ${att.name || 'document.pdf'} preview`}
        title={att.name || 'document.pdf'}
      >
        <FileText size={26} className="text-red-500" />
        <span className="text-[10px] text-red-700 dark:text-red-300 font-medium text-center line-clamp-2 leading-tight break-all">
          {att.name || 'document.pdf'}
        </span>
      </button>
    )
  }

  if (isText) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${sizing} ${base} bg-neutral-50 dark:bg-[#262626] border-neutral-200/80 dark:border-[#3a3a3a] hover:border-neutral-300 dark:hover:border-[#555] flex flex-col justify-between p-2 text-left`}
        aria-label={`Open ${att.name || 'Pasted text'} preview`}
        title={att.name || 'Pasted text'}
      >
        <span className="text-[9px] leading-[1.3] text-neutral-700 dark:text-neutral-300 font-mono line-clamp-5 whitespace-pre-wrap break-all">
          {textPreview && textPreview.length > 0
            ? textPreview
            : (textPreview === null ? 'Loading…' : (att.name || 'Pasted text'))}
        </span>
        <span className="self-start mt-1 px-1.5 py-0.5 rounded-[4px] bg-white dark:bg-[#1a1a1a] border border-neutral-300 dark:border-[#484848] text-[8px] font-bold tracking-wide text-neutral-700 dark:text-neutral-200 shadow-sm">
          {badgeLabel}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${sizing} ${base} p-0 border-neutral-200 dark:border-[#484848] hover:border-neutral-300 dark:hover:border-[#666]`}
      aria-label={`Open ${att.name || 'Attachment'} preview`}
      title={att.name || 'Attachment'}
    >
      <img
        src={att.dataUrl || resolveSrc(att.url)}
        alt={att.name || 'Attachment'}
        className="w-full h-full object-cover"
        draggable={false}
      />
    </button>
  )
}

// Responsive wrapping grid of attachment cards.
//   - mobile (<640px) : 3 columns
//   - desktop (≥640px): 4 columns
// Cards are uniform aspect-square, images zoom-fit via object-cover. The grid
// right-aligns inside the message column so the row hugs the user's bubble
// side even when the last row has fewer cards than columns.
function AttachmentRow({ atts, onOpen, resolveSrc }) {
  return (
    <div
      // Flex-wrap with justify-end: reading order stays natural LTR
      // (1→2→3→4), but the LAST partial row right-aligns so remaining cards
      // hug the right edge. Exact visual: [1][2][3][4] / _ _[5][6].
      // Mobile: cards wrap after 3 (110px * 3 + 8px * 2 ≈ 346px).
      // Desktop: cards wrap after 4 (120px * 4 + 8px * 3 ≈ 504px).
      className="flex flex-wrap gap-2 justify-end"
      style={{ maxWidth: 'min(100%, 504px)' }}
    >
      {atts.map((att, ai) => (
        <AttachmentCard
          key={att.id || att.url}
          att={att}
          onOpen={() => onOpen(ai)}
          resolveSrc={resolveSrc}
        />
      ))}
    </div>
  )
}
import { ProviderLogo, PROVIDER_COLORS, PROVIDER_NAMES } from '../../utils/providerLogos'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

// Robust clipboard copy with execCommand fallback. Used by the chat header
// "Copy URL / Copy cURL" buttons in the webhook menu — the modern Clipboard
// API silently fails inside iframes, on non-secure origins, on the ngrok
// tunnel without proper permissions, or when the click handler immediately
// changes focus by closing the menu. The fallback creates a transient
// off-screen textarea and runs execCommand('copy'), which works in all of
// those cases as long as we're inside a synchronous user-gesture handler.
async function copyToClipboard(text) {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to legacy */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// Tool names that mutate or report schedule state. Hoisted to module scope
// because the schedule-state useMemo runs on every messages change — building
// the Set inside the hook would allocate on every render.
const SCHEDULE_TOOL_NAMES = new Set([
  'get_schedule',
  'create_schedule',
  'update_schedule',
  'delete_schedule',
])

// Browser's resolved IANA timezone — shown alongside times in the chip
// dropdown so the user knows they're seeing local time, not the schedule's
// source timezone. Falls back to "Local" if Intl is unavailable.
const SCHEDULE_LOCAL_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local' }
  catch { return 'Local' }
})()

// Compact "27 Apr 2026 14:35" formatter for the schedule chip dropdown.
// No `timeZone` option = browser default (local). Hoisted so it isn't
// re-created on every dropdown render. Returns '—' for missing/invalid
// input so the chip never throws on partial schedule data.
const fmtScheduleAbs = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  )
}

// Permissive classifier for PF's `last_run_status`. PF's vocabulary is not
// formally documented and varies (`"success"`, `"succeeded"`, `"completed"`,
// `"ok"` for success; `"failed"`, `"failure"`, `"error"` for failure). The
// previous strict equality check (`=== 'success' || === 'completed'`)
// silently flipped every unrecognized value to "Failed", which made every
// successful run render red. Now: substring/boolean classification with
// explicit unknown → null so the badge hides instead of misreporting.
//
// Returns 'success' | 'failed' | null. Callers should hide the badge on null.
const classifyRunStatus = (status) => {
  if (status === true) return 'success'
  if (status === false) return 'failed'
  if (typeof status !== 'string') return null
  const s = status.toLowerCase().trim()
  if (!s) return null
  if (s === 'success' || s === 'succeeded' || s === 'completed' || s === 'complete' ||
      s === 'ok' || s === 'passed' || s.includes('succe')) {
    return 'success'
  }
  if (s === 'failed' || s === 'failure' || s === 'error' || s === 'errored' ||
      s === 'timeout' || s.includes('fail') || s.includes('error')) {
    return 'failed'
  }
  return null
}

// Comprehensive native model catalog — every model that works with a direct
// BYOK key for that provider. The platform pricing table only contains 1-2
// models per provider, so without this baseline a freshly-connected Anthropic
// key would only show Claude Opus. This list is the source of truth for
// native BYOK. OpenRouter is handled separately via byokCatalog.
//
// Hoisted to module-level so both the dropdown rendering AND the trigger
// button's `resolvedSelectedModel` memo can read it. Previously it was a
// local const inside the dropdown JSX callback, which made the memo crash
// with `NATIVE_BY_PROVIDER is not defined` when looking up a model.
const NATIVE_BY_PROVIDER = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (v2)' },
    { id: 'claude-3-5-sonnet-20240620', label: 'Claude 3.5 Sonnet (v1)' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { id: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ],
  openai: [
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4o-2024-11-20', label: 'GPT-4o (2024-11-20)' },
    { id: 'gpt-4o-2024-08-06', label: 'GPT-4o (2024-08-06)' },
    { id: 'chatgpt-4o-latest', label: 'ChatGPT-4o (latest)' },
    { id: 'o3', label: 'o3' },
    { id: 'o3-mini', label: 'o3 Mini' },
    { id: 'o3-pro', label: 'o3 Pro' },
    { id: 'o4-mini', label: 'o4 Mini' },
    { id: 'o1', label: 'o1' },
    { id: 'o1-mini', label: 'o1 Mini' },
    { id: 'o1-pro', label: 'o1 Pro' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'gpt-4', label: 'GPT-4' },
    { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (exp)' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
  ],
  xai: [
    { id: 'grok-4', label: 'Grok 4' },
    { id: 'grok-3', label: 'Grok 3' },
    { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    { id: 'grok-2-1212', label: 'Grok 2' },
    { id: 'grok-2-vision-1212', label: 'Grok 2 Vision' },
    { id: 'grok-beta', label: 'Grok Beta' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'mistral-medium-latest', label: 'Mistral Medium' },
    { id: 'mistral-small-latest', label: 'Mistral Small' },
    { id: 'codestral-latest', label: 'Codestral' },
  ],
  perplexity: [
    { id: 'sonar-pro', label: 'Sonar Pro' },
    { id: 'sonar', label: 'Sonar' },
    { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning', label: 'Sonar Reasoning' },
  ],
}

// Tools whose successful completion should trigger a fresh DB pull of the
// agent's steps so the StepsPanel re-renders mid-stream (Layer C).
// Includes both mutating tools and read-only sync tools (get_agent_status).
// set_step_code / set_step_prompt update step contents via the file-first
// protocol (write_file → set_step_code) — StepsPanel must re-fetch so the
// code_body / system_prompt display reflects what the LLM just saved.
const STEP_REFRESH_TOOLS = new Set([
  'create_step',
  'update_step',
  'delete_step',
  'set_step_code',
  'set_step_prompt',
  'get_agent_status',
  'test_step',
  'test_workflow',
  'set_webhook_schema',
])

// Tools that actually modify step definitions — only these should mark
// the agent as needing redeploy. Read-only tools (get_agent_status,
// test_step, test_workflow) must NOT trigger markDirty() because
// test_workflow auto-deploys and clears needs_redeploy; re-marking dirty
// would undo that and leave the Update button stuck.
// set_step_code / set_step_prompt / memory_store / memory_delete all call
// mark_needs_redeploy() on the backend — frontend must mirror so the Update
// button appears at end of stream.
const STEP_MUTATING_TOOLS = new Set([
  'create_step',
  'update_step',
  'delete_step',
  'set_step_code',
  'set_step_prompt',
  'set_webhook_schema',
  'memory_store',
  'memory_delete',
])

// Fallback models if backend pricing isn't loaded yet
const FALLBACK_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic', providerId: 'anthropic', tag: 'Most capable' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', providerId: 'anthropic', tag: 'Fast & smart' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', providerId: 'anthropic', tag: 'Fastest' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', providerId: 'openai', tag: 'Multimodal' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', providerId: 'openai', tag: 'Budget' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', providerId: 'google', tag: 'Long context' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', providerId: 'google', tag: 'Fast & cheap' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xAI', providerId: 'xai', tag: 'Real-time' },
]

// Model tags based on pricing (auto-assigned if not in fallback)
const MODEL_TAGS = {
  'claude-opus-4-6': 'Most capable', 'claude-sonnet-4-6': 'Fast & smart', 'claude-haiku-4-5': 'Fastest',
  'gpt-4o': 'Multimodal', 'gpt-4o-mini': 'Budget', 'gemini-2.5-pro': 'Long context',
  'gemini-2.5-flash': 'Fast & cheap', 'grok-3': 'Real-time',
}

// Provider logos + gradient colors for model selector
const PROVIDER_LOGOS = {
  anthropic: {
    gradient: 'from-neutral-800 to-neutral-950',
    logo: <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5"><path d="M17.304 3.541h-3.48l6.157 16.918h3.48L17.303 3.541zm-10.61 0L.54 20.459H4.1l1.273-3.574h6.57l1.272 3.574h3.56L10.618 3.541H6.694zm.575 10.484l2.14-6.003 2.14 6.003H7.269z" /></svg>,
  },
  openai: {
    gradient: 'from-neutral-800 to-neutral-950',
    logo: <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" /></svg>,
  },
  google: {
    gradient: 'from-blue-500 to-blue-600',
    logo: <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>,
  },
  xai: {
    gradient: 'from-neutral-800 to-neutral-950',
    logo: <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5"><path d="M2 2l8.5 10L2 22h2l7.5-9L19 22h3L13.5 12 22 2h-2l-7.5 9L5 2H2z" /></svg>,
  },
}

// ── Structured JSON Card Components ──

function ToolCallCard({ data }) {
  const [expandedKeys, setExpandedKeys] = useState({})
  const name = (data.name || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const params = data.params || {}
  const toggleKey = (k) => setExpandedKeys(prev => ({ ...prev, [k]: !prev[k] }))

  const renderValue = (key, val) => {
    if (val === null || val === undefined) return <span className="text-neutral-400 italic">null</span>
    if (typeof val === 'boolean') return <span className="text-blue-600 dark:text-blue-400">{val.toString()}</span>
    if (typeof val === 'number') return <span className="text-amber-600 dark:text-amber-400">{val}</span>
    if (Array.isArray(val)) return <span className="text-neutral-600 dark:text-neutral-400 font-mono text-[12px]">{JSON.stringify(val)}</span>
    if (typeof val === 'object') {
      const json = JSON.stringify(val, null, 2)
      return (
        <pre className="mt-1 p-2 bg-neutral-100 dark:bg-[#2c2c2c] rounded text-[11px] font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap max-w-full min-w-0" style={{ margin: 0, contain: 'inline-size', wordBreak: 'break-all' }}>{json}</pre>
      )
    }
    // String
    const str = String(val)
    const isCode = key === 'code_body'
    const isLong = str.length > 120 || str.includes('\n') || str.includes('\\n')
    if (isLong) {
      const expanded = expandedKeys[key]
      const displayStr = str.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      if (isCode) {
        return (
          <div className="min-w-0">
            <textarea
              readOnly
              value={displayStr}
              rows={expanded ? 20 : 5}
              className="mt-1 p-2 w-full bg-neutral-900 dark:bg-[#1a1a1a] rounded text-[11px] leading-relaxed font-mono text-neutral-100 border-none outline-none resize-y"
            />
            <button onClick={() => toggleKey(key)} className="text-[10px] text-primary-500 hover:text-primary-600 mt-0.5">{expanded ? 'Collapse' : 'Expand'}</button>
          </div>
        )
      }
      return (
        <div>
          <div className={`mt-1 p-2 bg-neutral-50 dark:bg-[#2c2c2c] rounded text-[15px] text-neutral-700 dark:text-neutral-300 leading-relaxed overflow-hidden break-words [&_h1]:text-[16px] [&_h2]:text-[15px] [&_h3]:text-[15px] [&_p]:text-[15px] [&_li]:text-[15px] [&_ol]:text-[15px] [&_ul]:text-[15px] [&_strong]:text-[15px] [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_ul]:pl-4 [&_ol]:pl-4 [&_ul]:list-disc [&_ol]:list-decimal ${!expanded ? 'max-h-20' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayStr}</ReactMarkdown>
          </div>
          <button onClick={() => toggleKey(key)} className="text-[10px] text-primary-500 hover:text-primary-600 mt-0.5">{expanded ? 'Collapse' : 'Expand'}</button>
        </div>
      )
    }
    return <span className="text-neutral-800 dark:text-neutral-200">{str}</span>
  }

  return (
    <div className="my-2 rounded-lg border border-neutral-200 dark:border-neutral-700/40 overflow-hidden">
      <div className="px-3 py-2 bg-neutral-50 dark:bg-neutral-800/50 flex items-center gap-2">
        <Zap size={14} className="text-primary-500" />
        <span className="text-[12px] sm:text-[14px] font-semibold text-neutral-700 dark:text-neutral-200">{name}</span>
      </div>
      {Object.keys(params).length > 0 && (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700/30">
          {Object.entries(params).map(([k, v]) => (
            <div key={k} className="px-3 py-1.5 sm:py-2 flex gap-2 sm:gap-3 bg-white dark:bg-neutral-800/30">
              <span className="text-[11px] sm:text-[13px] font-medium text-neutral-500 dark:text-neutral-400 min-w-[70px] sm:min-w-[100px] flex-shrink-0 pt-0.5">{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
              <div className="text-[12px] sm:text-[14px] flex-1 min-w-0">{renderValue(k, v)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentStatusCard({ data }) {
  const status = data.agent_status || 'unknown'
  const statusColor = { active: 'text-green-600', draft: 'text-yellow-600', ready: 'text-blue-600', compiled: 'text-purple-600' }[status] || 'text-neutral-600'
  const dotColor = { active: 'bg-green-500', draft: 'bg-yellow-500', ready: 'bg-blue-500', compiled: 'bg-purple-500' }[status] || 'bg-neutral-500'
  const steps = data.steps || []
  const stepCount = data.total_steps ?? steps.length
  const hasSteps = stepCount > 0

  // Empty state (e.g. fresh "Draft · 0 steps") — render as a slim inline pill
  // instead of a full card so it stops eating real estate in the chat.
  if (!hasSteps && (!data.total_files || data.total_files === 0)) {
    return (
      <div className="my-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/40">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className={`text-[10px] font-semibold ${statusColor}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-neutral-200 dark:border-neutral-700/40 overflow-hidden bg-white dark:bg-neutral-800/30">
      <div className="px-3 py-1.5 flex items-center justify-between bg-neutral-50 dark:bg-neutral-800/50">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className={`text-[11px] font-semibold ${statusColor}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-neutral-500">
          {hasSteps && <span>{stepCount} step{stepCount === 1 ? '' : 's'}</span>}
          {data.total_files > 0 && <span>{data.total_files} file{data.total_files === 1 ? '' : 's'}</span>}
        </div>
      </div>
      {Array.isArray(steps) && steps.length > 0 && (
        <div className="divide-y divide-neutral-100 dark:divide-[#333]">
          {steps.map((s, i) => (
            <div key={s.id || i} className="px-3 py-1.5 flex items-center gap-2">
              <span className="text-[11px] font-medium text-neutral-400 w-5">#{i + 1}</span>
              <span className="text-[12px] text-neutral-700 dark:text-neutral-300 flex-1 truncate">{s.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.type === 'ai' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>{s.type === 'ai' ? 'AI' : 'Non-AI'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentInstructionsCard({ text, onOpenSettings }) {
  return (
    <div className="my-2 rounded-lg border border-neutral-200 dark:border-neutral-700/40 overflow-hidden bg-white dark:bg-neutral-800/30">
      <div className="px-3 py-1.5 bg-neutral-50 dark:bg-neutral-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-neutral-500" />
          <span className="text-[12px] font-semibold text-neutral-600 dark:text-neutral-400">Workflow Instructions</span>
        </div>
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="text-[10px] text-primary-500 hover:text-primary-600 font-medium">View in Settings</button>
        )}
      </div>
      <div className="px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-300 leading-relaxed">{text}</div>
    </div>
  )
}

// markdownComponents — initialized once from imported factory + local card components
const markdownComponents = createMarkdownComponents(ToolCallCard, AgentStatusCard, AgentInstructionsCard)

// Live timer for compile/deploy progress
const CompileTimer = () => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1 h-1 bg-neutral-200 dark:bg-[#383838] rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-400 rounded-full transition-all duration-1000"
          style={{ width: `${Math.min((seconds / 120) * 100, 95)}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">
        {mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`}
      </span>
    </div>
  )
}

// TypewriterText, RotatingThinking, extractLastLine, TOOL_DESCRIPTIONS → imported from ./ChatActivity

// Collapsible tool call component — OpenClaw style
const TOOL_COLORS = {
  http_request: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800/40', icon: 'text-emerald-600 dark:text-emerald-400', label: 'text-emerald-700 dark:text-emerald-400', tag: 'HTTP' },
  exec_command: { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800/40', icon: 'text-blue-600 dark:text-blue-400', label: 'text-blue-700 dark:text-blue-400', tag: 'EXEC' },
  edit_file: { bg: 'bg-neutral-100 dark:bg-neutral-800/30', border: 'border-neutral-200 dark:border-neutral-700/40', icon: 'text-neutral-600 dark:text-neutral-400', label: 'text-neutral-700 dark:text-neutral-300', tag: 'FILE' },
  default: { bg: 'bg-neutral-50 dark:bg-neutral-800/30', border: 'border-neutral-200 dark:border-neutral-700/40', icon: 'text-[#0089FF] dark:text-[#4EB8FF]', label: 'text-neutral-700 dark:text-neutral-300', tag: 'TOOL' },
}

// Tool icon mapping
const TOOL_ICONS = {
  http_request: Globe,
  exec_command: Terminal,
  edit_file: FileText,
  default: Zap,
}

// Helper to get tool icon component
const getToolIcon = (name) => {
  return TOOL_ICONS[name] || TOOL_ICONS.default
}

// Helper to get tool colors
const getToolColors = (name) => {
  return TOOL_COLORS[name] || TOOL_COLORS.default
}

// Helper to capitalize first letter of each word (title case)
const toTitleCase = (str) => str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

// Known domain → friendly app name
const KNOWN_APPS = {
  'pm.pabbly.com': 'Pabbly PM',
  'connect.pabbly.com': 'Pabbly Connect',
  'payments.pabbly.com': 'Pabbly Payments',
  'pabbly.com': 'Pabbly',
  'api.github.com': 'GitHub',
  'api.openai.com': 'OpenAI',
  'api.anthropic.com': 'Anthropic',
  'api.stripe.com': 'Stripe',
  'api.slack.com': 'Slack',
  'discord.com': 'Discord',
  'api.notion.com': 'Notion',
  'api.airtable.com': 'Airtable',
  'api.sendgrid.com': 'SendGrid',
  'api.twilio.com': 'Twilio',
  'api.shopify.com': 'Shopify',
  'googleapis.com': 'Google',
  'graph.microsoft.com': 'Microsoft',
  'api.hubspot.com': 'HubSpot',
  'api.trello.com': 'Trello',
  'api.linear.app': 'Linear',
  'api.clickup.com': 'ClickUp',
}

// Method → verb for running/done states
const METHOD_VERB = {
  GET:    { running: 'Fetching', done: 'Fetched' },
  POST:   { running: 'Creating', done: 'Created' },
  PUT:    { running: 'Updating', done: 'Updated' },
  PATCH:  { running: 'Updating', done: 'Updated' },
  DELETE: { running: 'Deleting', done: 'Deleted' },
}

// Method badge colors
const METHOD_BADGE_STYLE = {
  GET:    { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300' },
  POST:   { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  PUT:    { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
  PATCH:  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
  DELETE: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
}

// Turn path segment into readable resource name: "user-stories" → "user stories", "projectId" → "project"
const humanize = (seg) => seg.replace(/Id$/, '').replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

// Unwrap tool params — backend stores either {url, method} or {name, params: {url, method}}
const unwrapParams = (raw) => {
  const p = typeof raw === 'string' ? JSON.parse(raw) : raw
  // If it's the full tool call shape {name, params}, unwrap
  return (p?.params && typeof p.params === 'object' && !Array.isArray(p.params)) ? p.params : p
}

// Tools whose params/results carry the step.type / step_type internal field.
// We hide that field from the user-facing Data In / Data Out display so the
// chat doesn't surface "ai" vs "code" — the user sees a single unified
// "step" concept and the AI vs Non-AI badge in StepsPanel is auto-derived
// from the code body content (pabbly-llm import detection). Master Agent
// still uses the field internally; only the visible JSON is redacted.
const STEP_TYPE_REDACT_TOOLS = new Set([
  'create_step',
  'update_step',
  'get_agent_status',
  'set_step_code',
  'set_step_prompt',
])

const redactStepTypeDeep = (val) => {
  if (Array.isArray(val)) return val.map(redactStepTypeDeep)
  if (val && typeof val === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(val)) {
      if (k === 'type' || k === 'step_type') continue
      out[k] = redactStepTypeDeep(v)
    }
    return out
  }
  return val
}

// Pretty-print tool params for the Data In panel, redacting step_type/type
// for the tools listed above.
const formatToolParamsForDisplay = (rawParams, toolName) => {
  try {
    const p = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams
    const cleaned = STEP_TYPE_REDACT_TOOLS.has(toolName) ? redactStepTypeDeep(p) : p
    return JSON.stringify(cleaned, null, 2)
  } catch {
    return typeof rawParams === 'string' ? rawParams : JSON.stringify(rawParams)
  }
}

// Lightweight XML pretty-printer. Re-indents tags onto their own lines —
// no parsing, no DOM, no external lib. Good enough for RSS / SOAP / generic
// XML responses dumped into the Data Out panel where the body would otherwise
// arrive as one minified line.
const prettyPrintXml = (xml) => {
  if (typeof xml !== 'string') return xml
  // Insert newline between tags
  let formatted = xml.replace(/></g, '>\n<').trim()
  // Indent based on tag depth
  const lines = formatted.split('\n')
  let depth = 0
  const indented = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    // Closing tag → dedent before printing
    if (/^<\//.test(trimmed)) depth = Math.max(0, depth - 1)
    const out = '  '.repeat(depth) + trimmed
    // Opening tag (not self-closing, not <?xml ?> processing instruction,
    // not <!-- comment -->, not closing tag) → indent next line
    const isOpenTag = /^<[^!?/]/.test(trimmed) &&
      !/\/>$/.test(trimmed) &&
      !/<\/[^>]+>$/.test(trimmed) // skip lines that contain a complete <tag>...</tag>
    if (isOpenTag) depth += 1
    return out
  })
  return indented.filter(l => l !== '').join('\n')
}

// Detect the response format and metadata from a tool result string.
// Used by the UI both to decide which formatter to apply AND to render
// HTTP failures as a styled error card instead of dumping raw text.
//
// Possible kinds:
//   - 'http_error'     — transport-level failure (HTTP_ERROR prefix)
//   - 'http'           — HTTP response with status (numeric); body in `body`
//   - 'plain'          — anything else (passes through unchanged)
const inspectToolResult = (rawResult) => {
  if (!rawResult || typeof rawResult !== 'string') {
    return { kind: 'plain', body: rawResult }
  }
  const trimmed = rawResult.trim()

  // Transport-level failure surfaced by the http_request / web_fetch wrappers.
  // Format: "HTTP_ERROR <CODE>: <message>\n(hint...)"
  if (trimmed.startsWith('HTTP_ERROR ')) {
    const firstNl = trimmed.indexOf('\n')
    const headLine = firstNl === -1 ? trimmed : trimmed.slice(0, firstNl)
    const hint = firstNl === -1 ? '' : trimmed.slice(firstNl + 1).trim()
    const m = headLine.match(/^HTTP_ERROR\s+([A-Z0-9_]+):\s*(.*)$/)
    return {
      kind: 'http_error',
      errorCode: m?.[1] || 'NETWORK_ERROR',
      errorMsg: m?.[2] || headLine.replace(/^HTTP_ERROR\s+/, ''),
      hint,
    }
  }

  // Successful or 4xx/5xx HTTP response from http_request — "HTTP <status>\n<body>"
  const httpMatch = trimmed.match(/^HTTP\s+(\d+)\n?([\s\S]*)$/)
  if (httpMatch) {
    const status = parseInt(httpMatch[1], 10)
    const body = httpMatch[2] || ''
    // Soft-failure detection: many SPAs / APIs return HTTP 200 with a JSON
    // body that actually indicates the request didn't work — typically the
    // body has a top-level `status` field with a 4xx/5xx number, OR top-level
    // `error` / `errors` fields, OR `success: false`. Surface these to the
    // caller so the visual badge isn't misleadingly green.
    let softFailStatus = null
    let softFailReason = null
    if (status >= 200 && status < 300) {
      const trimmedBody = body.trim()
      if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
        // Regex-first detection — works even when the body is truncated
        // mid-JSON (tools.rs caps response body at 50,000 chars; large 404
        // pages like NZ Herald embed massive Fusion template state that
        // overflows that cap, breaking JSON.parse). Scan only the first 2 KB
        // to keep this O(small).
        const head = trimmedBody.slice(0, 2000)
        const statusMatch = head.match(/"(?:status|statusCode|code)"\s*:\s*(\d{3})/)
        if (statusMatch) {
          const innerStatus = parseInt(statusMatch[1], 10)
          if (innerStatus >= 400) {
            softFailStatus = innerStatus
            softFailReason = `body reports status ${innerStatus}`
          }
        }
        if (softFailStatus === null && /"success"\s*:\s*false\b/.test(head)) {
          softFailStatus = status
          softFailReason = 'body has success:false'
        }
        if (softFailStatus === null) {
          const errMatch = head.match(/"(?:error|errors|err_msg|message)"\s*:\s*"([^"\\]{1,80})/)
          if (errMatch && /(error|fail|denied|unauthor|forbidden|not[\s_]?found|invalid)/i.test(errMatch[1])) {
            softFailStatus = status
            softFailReason = `body has error: ${errMatch[1].slice(0, 80)}`
          }
        }
        // Defensive parse fallback for fully-formed (untruncated) JSON — only
        // runs if the regex pass found nothing, so it never overrides a
        // confirmed soft-fail with a false negative.
        if (softFailStatus === null) {
          try {
            const parsed = JSON.parse(trimmedBody)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const innerStatus = parsed.status ?? parsed.statusCode ?? parsed.code
              if (typeof innerStatus === 'number' && innerStatus >= 400) {
                softFailStatus = innerStatus
                softFailReason = `body reports status ${innerStatus}`
              } else if (parsed.success === false) {
                softFailStatus = status
                softFailReason = 'body has success:false'
              } else if (parsed.error || parsed.errors) {
                softFailStatus = status
                const errVal = parsed.error || parsed.errors
                const errStr = typeof errVal === 'string' ? errVal : JSON.stringify(errVal)
                softFailReason = `body has error: ${errStr.slice(0, 80)}`
              }
            }
          } catch { /* truncated or not JSON, regex pass already covered it */ }
        }
      }
    }
    if (softFailStatus !== null) {
      return { kind: 'http_soft_fail', status, body, softFailStatus, softFailReason }
    }
    return { kind: 'http', status, body }
  }

  return { kind: 'plain', body: rawResult }
}

// Pick the right pretty-printer for a body string. Returns the body as-is
// if no known format matches.
const formatBodyByContent = (body) => {
  if (typeof body !== 'string') return body
  const t = body.trim()
  if (!t) return body
  // JSON
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(t), null, 2) } catch { /* fallthrough */ }
  }
  // XML / HTML / RSS — anything starting with `<`
  if (t.startsWith('<')) {
    return prettyPrintXml(t)
  }
  // CSV — first line has commas, second line also has commas, no opening brace
  if (/^[^\n,]+,[^\n]*\n[^\n,]+,/.test(t)) {
    return body // already line-separated; monospace is fine
  }
  return body
}

// Pretty-print tool result for the Data Out panel, redacting step_type/type
// in nested step docs (e.g. get_agent_status returns a list of step records,
// each with a `type` field we want to hide).
//
// Multi-format support:
//   - HTTP_ERROR ...        → returned as-is (UI renders styled error card via inspectToolResult)
//   - HTTP <status>\n<body> → status header + body re-formatted by content type
//   - JSON                  → pretty-printed with redaction
//   - XML / HTML / RSS      → tag-indented
//   - CSV / plain text      → unchanged
const formatToolResultForDisplay = (rawResult, toolName) => {
  if (!rawResult || typeof rawResult !== 'string') return rawResult
  const meta = inspectToolResult(rawResult)
  // The styled error card path doesn't call this formatter — but if it does
  // (e.g. a future caller), return the raw string so it's still readable.
  if (meta.kind === 'http_error') return rawResult
  if (meta.kind === 'http') {
    const formattedBody = formatBodyByContent(meta.body)
    return `HTTP ${meta.status}\n${formattedBody}`
  }
  // Plain — try JSON pretty-print + redaction (existing behaviour)
  const trimmed = rawResult.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const cleaned = STEP_TYPE_REDACT_TOOLS.has(toolName) ? redactStepTypeDeep(parsed) : parsed
      return JSON.stringify(cleaned, null, 2)
    } catch {
      return rawResult
    }
  }
  // XML / HTML fallback for plain (non-HTTP-prefix) bodies — useful when a
  // tool returns raw markup
  if (trimmed.startsWith('<')) {
    return prettyPrintXml(trimmed)
  }
  return rawResult
}

// Extract friendly app name + resource from a URL
const parseUrlContext = (url) => {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let appName = KNOWN_APPS[host] || ''
    if (!appName) {
      for (const [domain, name] of Object.entries(KNOWN_APPS)) {
        if (host.endsWith(domain)) { appName = name; break }
      }
    }
    if (!appName) {
      const parts = host.split('.')
      const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
      appName = main.charAt(0).toUpperCase() + main.slice(1)
    }
    // Extract resource from last meaningful path segment (skip IDs, versions, "api")
    let resource = ''
    const segments = u.pathname.split('/').filter(Boolean).filter(s => !/^(api|v[0-9]+|v[0-9]+\.[0-9]+)$/i.test(s))
    for (let i = segments.length - 1; i >= 0; i--) {
      if (!/^[0-9a-f-]{8,}$/i.test(segments[i]) && !/^\d+$/.test(segments[i])) {
        resource = humanize(segments[i])
        break
      }
    }
    return { appName, resource, host }
  } catch { return { appName: '', resource: '', host: '' } }
}

// Resolve step name from params or steps list
const resolveStepName = (p, steps) => {
  // Prefer step_name (always sent by backend tools), then name, then look up by step_id
  if (p.step_name) return p.step_name
  if (p.name) return p.name
  if (p.step_id && Array.isArray(steps)) {
    const match = steps.find(s => s._id === p.step_id || s.id === p.step_id)
    if (match) return match.name
  }
  return null
}

// Build smart summary + badge for ANY tool
const buildToolSummary = (toolName, params, status, steps) => {
  try {
    const p = unwrapParams(params)
    if (!p) return null
    const isDone = status === 'done'

    // ── http_request ──
    if (toolName === 'http_request' && p.url) {
      const method = (p.method || 'GET').toUpperCase()
      const verbs = METHOD_VERB[method] || METHOD_VERB.GET
      const verb = isDone ? verbs.done : verbs.running
      const badgeStyle = METHOD_BADGE_STYLE[method] || METHOD_BADGE_STYLE.GET
      const { appName, resource } = parseUrlContext(p.url)
      const summary = resource
        ? `${verb} ${resource}${appName ? ` from ${appName}` : ''}`
        : `${verb} data${appName ? ` from ${appName}` : ''}`
      return { summary, badge: method, badgeStyle }
    }

    // ── web_fetch ──
    if (toolName === 'web_fetch' && p.url) {
      const { appName, host } = parseUrlContext(p.url)
      const label = appName || host
      return {
        summary: isDone ? `Fetched content from ${label}` : `Fetching content from ${label}`,
        badge: 'FETCH',
        badgeStyle: { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-700 dark:text-indigo-300' },
      }
    }

    // ── web_search ──
    if (toolName === 'web_search' && p.query) {
      const q = p.query.length > 35 ? p.query.slice(0, 35) + '…' : p.query
      return {
        summary: isDone ? `Searched "${q}"` : `Searching "${q}"`,
        badge: 'SEARCH',
        badgeStyle: { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
      }
    }

    // ── exec_command ──
    if (toolName === 'exec_command' && p.command) {
      const cmd = p.command.length > 40 ? p.command.slice(0, 40) + '…' : p.command
      return {
        summary: isDone ? `Ran: ${cmd}` : `Running: ${cmd}`,
        badge: 'EXEC',
        badgeStyle: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
      }
    }

    // ── write_file ──
    if (toolName === 'write_file' && (p.path || p.filename)) {
      const file = (p.path || p.filename).split('/').pop()
      const label = p.step_name ? `code for "${p.step_name}"` : file
      return {
        summary: isDone ? `Wrote ${label}` : `Writing ${label}`,
        badge: 'WRITE',
        badgeStyle: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
      }
    }

    // ── read_file ──
    if (toolName === 'read_file' && (p.path || p.filename)) {
      const file = (p.path || p.filename).split('/').pop()
      return {
        summary: isDone ? `Read ${file}` : `Reading ${file}`,
        badge: 'READ',
        badgeStyle: { bg: 'bg-neutral-200 dark:bg-neutral-700/40', text: 'text-neutral-700 dark:text-neutral-300' },
      }
    }

    // ── edit_file ──
    if (toolName === 'edit_file' && (p.path || p.filename)) {
      const file = (p.path || p.filename).split('/').pop()
      return {
        summary: isDone ? `Edited ${file}` : `Editing ${file}`,
        badge: 'EDIT',
        badgeStyle: { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
      }
    }

    // ── send_email ──
    if (toolName === 'send_email') {
      const to = p.to ? (p.to.length > 25 ? p.to.slice(0, 25) + '…' : p.to) : ''
      return {
        summary: isDone ? `Sent email${to ? ` to ${to}` : ''}` : `Sending email${to ? ` to ${to}` : ''}`,
        badge: 'EMAIL',
        badgeStyle: { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-700 dark:text-sky-300' },
      }
    }

    // ── send_message ──
    if (toolName === 'send_message') {
      return {
        summary: isDone ? 'Sent message' : 'Sending message',
        badge: 'MSG',
        badgeStyle: { bg: 'bg-cyan-100 dark:bg-cyan-900/40', text: 'text-cyan-700 dark:text-cyan-300' },
      }
    }

    // ── memory_store ──
    if (toolName === 'memory_store' && p.key) {
      return {
        summary: isDone ? `Stored "${p.key}"` : `Storing "${p.key}"`,
        badge: 'STORE',
        badgeStyle: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-700 dark:text-violet-300' },
      }
    }

    // ── memory_get ──
    if (toolName === 'memory_get' && p.key) {
      return {
        summary: isDone ? `Retrieved "${p.key}"` : `Retrieving "${p.key}"`,
        badge: 'RECALL',
        badgeStyle: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-700 dark:text-violet-300' },
      }
    }

    // ── json_transform ──
    if (toolName === 'json_transform') {
      return {
        summary: isDone ? 'Transformed data' : 'Transforming data',
        badge: 'JSON',
        badgeStyle: { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300' },
      }
    }

    // ── test_workflow ──
    if (toolName === 'test_workflow') {
      return {
        summary: isDone ? 'Workflow test complete' : 'Running workflow test',
        badge: 'TEST',
        badgeStyle: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
      }
    }

    // ── create_step / update_step / delete_step ──
    if (toolName === 'create_step' && p.name) {
      return { summary: isDone ? `Created step "${p.name}"` : `Creating step "${p.name}"`, badge: 'CREATE', badgeStyle: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300' } }
    }
    if (toolName === 'update_step' && p.step_id) {
      const label = resolveStepName(p, steps) || p.step_id
      return { summary: isDone ? `Updated step "${label}"` : `Updating step "${label}"`, badge: 'UPDATE', badgeStyle: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' } }
    }
    if (toolName === 'delete_step') {
      const label = resolveStepName(p, steps)
      return { summary: isDone ? (label ? `Deleted step "${label}"` : 'Deleted step') : (label ? `Deleting step "${label}"` : 'Deleting step'), badge: 'DELETE', badgeStyle: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' } }
    }

    // ── get_agent_status ──
    if (toolName === 'get_agent_status') {
      return { summary: isDone ? 'Checked workflow config' : 'Checking workflow config', badge: 'STATUS', badgeStyle: { bg: 'bg-neutral-200 dark:bg-neutral-700/40', text: 'text-neutral-700 dark:text-neutral-300' } }
    }

    // ── get_webhook_info / set_webhook_schema ──
    if (toolName === 'get_webhook_info') {
      return { summary: isDone ? 'Checked webhook info' : 'Checking webhook info', badge: 'WEBHOOK', badgeStyle: { bg: 'bg-neutral-200 dark:bg-neutral-700/40', text: 'text-neutral-700 dark:text-neutral-300' } }
    }
    if (toolName === 'set_webhook_schema') {
      return { summary: isDone ? 'Set webhook schema' : 'Setting webhook schema', badge: 'SCHEMA', badgeStyle: { bg: 'bg-neutral-200 dark:bg-neutral-700/40', text: 'text-neutral-700 dark:text-neutral-300' } }
    }

    return null
  } catch { return null }
}

// Render any value as readable key-value card
const JsonValue = ({ value, isError = false }) => {
  if (value === null || value === undefined) return <span className="text-neutral-400 italic">null</span>
  if (typeof value === 'boolean') return <span className={value ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{String(value)}</span>
  if (typeof value === 'number') return <span className="text-primary-600 dark:text-primary-400">{value}</span>
  if (typeof value !== 'object') return <span className={`${isError ? 'text-red-300' : 'text-neutral-800 dark:text-neutral-200'} break-all whitespace-pre-wrap`}>{String(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-neutral-400 italic">[]</span>
    if (value.every(v => typeof v !== 'object')) return <span className="text-neutral-800 dark:text-neutral-200">{value.join(', ')}</span>
    return <div className="ml-2 mt-1 space-y-1">{value.map((item, i) => <div key={i} className="border-l-2 border-neutral-200 dark:border-neutral-600 pl-2"><JsonDataView data={item} isError={isError} /></div>)}</div>
  }
  return <div className="mt-1"><JsonDataView data={value} isError={isError} /></div>
}

// Render JSON as readable key-value card
const JsonDataView = ({ data, isError = false }) => {
  let parsed = null
  if (typeof data === 'string') {
    try { parsed = JSON.parse(data) } catch { parsed = null }
  } else {
    parsed = data
  }

  // Plain string — not JSON
  if (!parsed || typeof parsed !== 'object') {
    const display = typeof data === 'string' ? data : JSON.stringify(data)
    return (
      <div className={`px-3 py-2 text-[12px] whitespace-pre-wrap break-words ${isError ? 'text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>
        {display}
      </div>
    )
  }

  // Object or array — render as key-value rows
  if (Array.isArray(parsed)) {
    return (
      <div className="text-[12px] max-h-48 overflow-y-auto">
        {parsed.map((item, i) => (
          <div key={i} className="px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-700 last:border-0">
            <JsonValue value={item} isError={isError} />
          </div>
        ))}
      </div>
    )
  }

  const entries = Object.entries(parsed)
  return (
    <div className="text-[12px] max-h-48 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-700">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-3 px-3 py-1.5">
          <span className="text-neutral-500 dark:text-neutral-400 font-medium min-w-[90px] flex-shrink-0 truncate" title={key}>{key}</span>
          <div className="flex-1 min-w-0">
            <JsonValue value={val} isError={isError} />
          </div>
        </div>
      ))}
    </div>
  )
}

const ToolCallCollapsible = ({ tool, agentId, steps }) => {
  const [expanded, setExpanded] = useState(!tool.collapsed && tool.name === 'http_request')
  const [expandedRequest, setExpandedRequest] = useState(false)
  const [expandedResponse, setExpandedResponse] = useState(false)
  const toolRef = useRef(null)
  // Lazy-load full tool result. Backend returns first 5 KB + `truncated:true`
  // when the stored result exceeded 50 KB; the user expands by clicking the
  // banner button below. Local state keeps the per-card swap cheap (no parent
  // re-render across all messages).
  const [localResult, setLocalResult] = useState(tool.result)
  const [isTruncated, setIsTruncated] = useState(tool.truncated === true)
  const [loadingFull, setLoadingFull] = useState(false)
  const [loadError, setLoadError] = useState(null)
  // Sync local mirror when the tool prop swaps (e.g. switching workflows
  // re-runs mapHistoryMessage and the same component instance gets a new tool).
  useEffect(() => {
    setLocalResult(tool.result)
    setIsTruncated(tool.truncated === true)
    setLoadError(null)
  }, [tool.result, tool.truncated])
  const onLoadFull = useCallback(async () => {
    if (loadingFull || !tool.messageId || !tool.id || !agentId) return
    setLoadingFull(true)
    setLoadError(null)
    try {
      const { data } = await chatAPI.getToolResult(agentId, tool.messageId, tool.id)
      setLocalResult(data?.result ?? localResult)
      setIsTruncated(false)
    } catch {
      setLoadError('Failed to load full result')
    } finally {
      setLoadingFull(false)
    }
  }, [loadingFull, tool.messageId, tool.id, agentId, localResult])
  // Scroll to keep expanded content visible below
  const scrollAfterExpand = useCallback(() => {
    setTimeout(() => {
      toolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])
  // Trust `tool.status` as the authoritative success/fail signal. The backend
  // (chat.rs::classify_tool_call_status) now stamps "failed" for any of:
  //   - "Error" prefix (legacy generic error)
  //   - "HTTP_ERROR " prefix (transport failure)
  //   - HTTP 4xx/5xx envelope
  //   - HTTP 2xx with body indicating soft-failure
  //     (`{"status":4xx}`, `{"success":false}`, `{"error":"..."}`)
  // So the icon renders correctly on initial load — BEFORE the user expands
  // "Data Out" and the lazy-fetch populates `localResult`. No more green→red
  // flicker on expand. The localResult-based refinement below stays as a
  // defensive client-side double-check for live-streaming and any stale
  // (pre-classification) messages persisted before this change.
  const httpResultKind = (() => {
    if (!localResult || typeof localResult !== 'string') return null
    const meta = inspectToolResult(localResult)
    if (meta.kind === 'http_error') return 'http_error'      // transport fail (HTTP_ERROR prefix)
    if (meta.kind === 'http_soft_fail') return 'http_soft_fail' // 200 OK but body says error
    if (meta.kind === 'http') {
      if (meta.status >= 200 && meta.status < 400) return 'http_ok'
      return 'http_bad_status'                                // 4xx / 5xx upstream
    }
    return null
  })()
  const isHttpFailure =
    httpResultKind === 'http_error' ||
    httpResultKind === 'http_bad_status' ||
    httpResultKind === 'http_soft_fail'
  const isSuccess =
    tool.status === 'done' &&
    !(localResult && localResult.startsWith('Error')) &&
    !isHttpFailure
  const isFailed =
    tool.status === 'failed' ||
    (tool.status === 'done' && localResult?.startsWith('Error')) ||
    isHttpFailure
  const colors = getToolColors(tool.name)
  const displayName = TOOL_DISPLAY_NAMES[tool.name] || toTitleCase(tool.name?.replace(/_/g, ' ') || '')

  // Parse params for smart summary + badge
  let paramSummary = ''
  const toolInfo = tool.params ? buildToolSummary(tool.name, tool.params, tool.status, steps) : null
  if (tool.params) {
    try {
      const p = unwrapParams(tool.params)
      if (p.method && p.url) paramSummary = `${p.method} ${p.url.length > 60 ? p.url.slice(0, 60) + '...' : p.url}`
      else if (p.command) paramSummary = p.command.length > 60 ? p.command.slice(0, 60) + '...' : p.command
      else if (p.path && tool.name === 'write_file') { paramSummary = p.path }
      else if (p.filename) paramSummary = p.filename
    } catch { /* ignore */ }
  }

  return (
    <div ref={toolRef} className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) scrollAfterExpand() }}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:brightness-95 transition-all"
      >
        {tool.status === 'running' ? (
          <div className="w-5 h-5 rounded-full bg-white dark:bg-[#222222] border border-neutral-200 dark:border-[#484848] flex items-center justify-center flex-shrink-0">
            <Settings size={11} className="text-neutral-500 dark:text-neutral-400 animate-spin" />
          </div>
        ) : isSuccess ? (
          <div className="w-5 h-5 rounded-full bg-white dark:bg-[#222222] border border-emerald-200 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={11} className="text-emerald-500" />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full bg-white dark:bg-[#222222] border border-red-200 flex items-center justify-center flex-shrink-0">
            <XCircle size={11} className="text-red-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {(() => {
              const IconComponent = getToolIcon(tool.name)
              return <IconComponent size={14} className={`flex-shrink-0 ${colors.icon}`} />
            })()}
            <span className={`text-[11px] sm:text-[13px] font-semibold ${colors.label}`}>
              {displayName}
            </span>
            {toolInfo && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${toolInfo.badgeStyle.bg} ${toolInfo.badgeStyle.text}`}>
                {toolInfo.badge}
              </span>
            )}
          </div>
          {/* Smart summary for all tools, fallback to paramSummary */}
          {toolInfo ? (
            <p className="text-[10px] sm:text-[12px] text-neutral-600 dark:text-neutral-400 truncate mt-0.5">{toolInfo.summary}</p>
          ) : paramSummary ? (
            <p className="text-[10px] sm:text-[12px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5 font-mono">{paramSummary}</p>
          ) : null}
        </div>
        <ChevronDown size={12} className={`text-neutral-400 transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2 space-y-2.5">
          {(tool.params || localResult || isTruncated) && (
            <div className="w-full bg-white dark:bg-[#383838] rounded-lg border border-neutral-200 dark:border-[#484848] overflow-hidden">
              {tool.params && (
                <>
                  <button
                    onClick={() => { setExpandedRequest(!expandedRequest); if (!expandedRequest) scrollAfterExpand() }}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors border-b border-neutral-200 dark:border-[#484848]"
                  >
                    <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 uppercase">
                      Data In
                    </span>
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-neutral-200 dark:bg-[#4a4a4a] hover:bg-neutral-300 dark:hover:bg-[#505050] transition-colors">
                      <ChevronDown size={12} className={`text-neutral-700 dark:text-neutral-300 transition-transform ${expandedRequest ? '' : '-rotate-90'}`} />
                    </div>
                  </button>
                  {expandedRequest && (
                    <pre className="px-3 py-2 bg-neutral-900 dark:bg-neutral-900 text-neutral-100 text-[11px] sm:text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto" style={{ margin: 0, marginBlock: 0 }}>{formatToolParamsForDisplay(tool.params, tool.name)}</pre>
                  )}
                </>
              )}
              {(localResult || isTruncated) && (
                <>
                  {tool.params && <div className="border-b border-neutral-200 dark:border-[#484848]" />}
                  <button
                    onClick={() => {
                      const opening = !expandedResponse
                      setExpandedResponse(!expandedResponse)
                      if (opening) scrollAfterExpand()
                      // Auto-fetch on first open when result is server-stripped
                      // (truncated=true, no local copy yet). Re-opens are
                      // instant — `localResult` cache survives collapse.
                      if (opening && isTruncated && !localResult && !loadingFull) {
                        onLoadFull()
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-[#383838] ${
                      tool.params ? '' : 'border-b border-neutral-200 dark:border-[#484848]'
                    }`}
                  >
                    <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 uppercase">
                      Data Out
                    </span>
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-neutral-200 dark:bg-[#4a4a4a] hover:bg-neutral-300 dark:hover:bg-[#505050] transition-colors">
                      <ChevronDown size={12} className={`text-neutral-700 dark:text-neutral-300 transition-transform ${expandedResponse ? '' : '-rotate-90'}`} />
                    </div>
                  </button>
                  {expandedResponse && (
                    loadingFull && !localResult ? (
                      <div className="px-3 py-3 text-[11px] text-neutral-400 dark:text-neutral-500 italic flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Loading result…</span>
                      </div>
                    ) : loadError && !localResult ? (
                      <div className="px-3 py-2 flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-900/20 border-t border-red-200/40 dark:border-red-900/30">
                        <span>{loadError}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onLoadFull() }}
                          className="underline hover:text-red-700 dark:hover:text-red-300"
                        >
                          Retry
                        </button>
                      </div>
                    ) : localResult ? (
                      (() => {
                        // Render styled error card for transport-level HTTP failures
                        // (HTTP_ERROR ...). The raw "HTTP 0" / cryptic strings used to
                        // dump as a literal "0" in a black <pre> — confusing both the
                        // agent and the user. The card surfaces error code + message +
                        // hint so the failure mode (DNS / TLS / Cloudflare block) is
                        // immediately legible.
                        const meta = inspectToolResult(localResult)
                        if (meta.kind === 'http_error') {
                          return (
                            <div className="px-3 py-3 bg-red-50 dark:bg-red-900/30 border-t border-red-200 dark:border-red-800/50">
                              <div className="flex items-start gap-2">
                                <XCircle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-semibold text-red-700 dark:text-red-300">
                                    Connection failed
                                  </div>
                                  <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 break-words">
                                    <span className="font-mono">{meta.errorCode}</span>: {meta.errorMsg}
                                  </div>
                                  {meta.hint && (
                                    <div className="text-[10px] text-red-500 dark:text-red-400/80 mt-1.5 italic break-words">
                                      {meta.hint}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        }
                        // Soft-failure: HTTP 200 OK from upstream, but the body
                        // itself signals failure (typical of SPAs that return a
                        // wrapper envelope `{status: 404, body: ...}` or
                        // `{success: false, error: ...}`). Show an amber badge
                        // explaining the discrepancy so the user/agent doesn't
                        // think the call actually worked.
                        if (meta.kind === 'http_soft_fail') {
                          const formattedBody = formatBodyByContent(meta.body)
                          return (
                            <div className="bg-amber-950/80 dark:bg-amber-950/80">
                              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-2 border-b border-white/10 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/30 text-amber-200">
                                  HTTP {meta.status}
                                </span>
                                <span className="text-amber-200">
                                  Body reports failure ({meta.softFailStatus})
                                </span>
                                {meta.softFailReason && (
                                  <span className="text-[9px] normal-case text-amber-300/80 italic">
                                    — {meta.softFailReason}
                                  </span>
                                )}
                              </div>
                              <pre className="px-3 py-2 text-[11px] sm:text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto text-amber-100" style={{ margin: 0, marginBlock: 0 }}>{formattedBody || '(empty body)'}</pre>
                            </div>
                          )
                        }
                        // HTTP response with body — render status header chip + body
                        if (meta.kind === 'http') {
                          const httpOk = meta.status >= 200 && meta.status < 400
                          const formattedBody = formatBodyByContent(meta.body)
                          return (
                            <div className={httpOk ? 'bg-neutral-900 dark:bg-neutral-900' : 'bg-red-950/80 dark:bg-red-950/80'}>
                              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-2 border-b border-white/10">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${httpOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/30 text-red-200'}`}>
                                  HTTP {meta.status}
                                </span>
                                <span className={httpOk ? 'text-neutral-400' : 'text-red-200'}>
                                  {httpOk ? 'Success' : 'Failed'}
                                </span>
                              </div>
                              <pre className={`px-3 py-2 text-[11px] sm:text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto ${httpOk ? 'text-neutral-100' : 'text-red-100'}`} style={{ margin: 0, marginBlock: 0 }}>{formattedBody || '(empty body)'}</pre>
                            </div>
                          )
                        }
                        // Plain — existing path (JSON pretty-print + redaction)
                        return (
                          <pre className={`px-3 py-2 text-[11px] sm:text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto ${isSuccess ? 'bg-neutral-900 dark:bg-neutral-900 text-neutral-100' : 'bg-red-950 dark:bg-red-950 text-red-100'}`} style={{ margin: 0, marginBlock: 0 }}>{formatToolResultForDisplay(localResult, tool.name)}</pre>
                        )
                      })()
                    ) : null
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Memoized streaming content — avoids full ChatPanel re-render on every token
// CSS for typing animation — injected once
const typingStyleId = 'streaming-typing-css'
if (typeof document !== 'undefined' && !document.getElementById(typingStyleId)) {
  const style = document.createElement('style')
  style.id = typingStyleId
  style.textContent = `
    @keyframes typing-cursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
    @keyframes token-fade { from { opacity: 0.3; } to { opacity: 1; } }
    @keyframes activity-orbit {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes activity-pulse {
      0%, 100% { opacity: 0.4; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1.2); }
    }
    .activity-spinner {
      position: relative; width: 16px; height: 16px; flex-shrink: 0;
    }
    .activity-spinner .dot {
      position: absolute; width: 4px; height: 4px; border-radius: 50%;
      background: #0089FF;
    }
    .dark .activity-spinner .dot { background: #4EB8FF; }
    .activity-spinner .orbit {
      animation: activity-orbit 1.2s linear infinite;
      transform-origin: 8px 8px;
    }
    .activity-spinner .d1 { top: 0; left: 6px; animation: activity-pulse 1.2s ease-in-out infinite 0s; }
    .activity-spinner .d2 { top: 6px; right: 0; animation: activity-pulse 1.2s ease-in-out infinite 0.3s; }
    .activity-spinner .d3 { bottom: 0; left: 6px; animation: activity-pulse 1.2s ease-in-out infinite 0.6s; }
    .activity-spinner .d4 { top: 6px; left: 0; animation: activity-pulse 1.2s ease-in-out infinite 0.9s; }
    .typing-cursor {
      display: inline-block; width: 2px; height: 16px; background: #6366f1;
      border-radius: 1px; margin-left: 2px; vertical-align: text-bottom;
      animation: typing-cursor 0.8s ease-in-out infinite;
    }
    .dark .typing-cursor { background: #a5b4fc; }
    .streaming-token { animation: token-fade 0.25s ease-out forwards; }
  `
  document.head.appendChild(style)
}

// Text Smoother — Claude.ai-style velocity-smoothed character reveal
// Buffers incoming tokens and reveals them at a steady ~125 chars/sec via 60fps animation loop.
// Creates the smooth "AI is typing" effect instead of chunky token bursts.
const StreamingContent = memo(({ text, onSmootherDone }) => {
  const [displayed, setDisplayed] = useState('')
  const stateRef = useRef({
    arrivals: [],
    position: 0,
    velocity: 100,
    lastFrame: null,
  })

  // Track token arrivals with timestamps
  useEffect(() => {
    if (text.length > 0) {
      const s = stateRef.current
      const now = performance.now()
      if (s.arrivals.length === 0) s.lastFrame = now
      s.arrivals.push({ time: now, totalChars: text.length })
    }
  }, [text])

  // 60fps animation loop with velocity smoothing
  useEffect(() => {
    let rafId
    const ALPHA = 0.99
    const OFFSET = 400
    const MIN_V = 30
    const MAX_V = 500

    const tick = () => {
      const s = stateRef.current
      const now = performance.now()
      if (!s.lastFrame) { s.lastFrame = now; rafId = requestAnimationFrame(tick); return }

      const dt = (now - s.lastFrame) / 1000
      s.lastFrame = now
      const total = text.length
      const deadline = now - OFFSET

      // Find chars available at the deadline
      let target = 0
      for (const a of s.arrivals) {
        if (a.time <= deadline) target = a.totalChars
        else break
      }

      // Drain buffer when stream is done (no new tokens for 300ms)
      const lastArrival = s.arrivals.length > 0 ? s.arrivals[s.arrivals.length - 1].time : now
      if (now - lastArrival > 300 && total > 0) {
        target = total
      }

      // Velocity smoothing
      const remaining = target - s.position
      if (remaining > 0) {
        const targetV = remaining / Math.max(dt, 0.016)
        s.velocity = ALPHA * s.velocity + (1 - ALPHA) * targetV
        s.velocity = Math.max(MIN_V, Math.min(MAX_V, s.velocity))
      }

      // Advance position
      if (s.position < total) {
        s.position = Math.min(s.position + s.velocity * dt, total)
        setDisplayed(text.slice(0, Math.floor(s.position)))
      } else if (s.position >= total && total > 0 && s.doneFired !== total) {
        // Smoother caught up to all text — signal done (fire exactly once per total)
        s.doneFired = total
        if (onSmootherDone) onSmootherDone()
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [text, onSmootherDone])

  // Strip tool_call blocks and handle unclosed code fences
  let safeText = displayed
    .replace(/```tool_call[\s\S]*?```/g, '')
    .replace(/```tool_call[\s\S]*/g, '')
    .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '') // tool-shaped json fences
    .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*/g, '')      // unclosed mid-stream
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<function_calls>[\s\S]*/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_call>[\s\S]*/g, '')
  const fences = safeText.match(/```/g)
  if (fences && fences.length % 2 !== 0) {
    safeText = safeText + '\n```'
  }

  return (
    <div className={MARKDOWN_CLASSES + ' dark:text-neutral-100'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {sanitizeForMarkdown(safeText)}
      </ReactMarkdown>
    </div>
  )
})

// Strip legacy :::action blocks from AI response text (action chips removed — just clean the text)
const extractActions = (text) => {
  if (!text) return { cleaned: text, actions: [] }
  const cleaned = text.replace(/:::action\s*\{[^}]*\}\s*:::/g, '').trim()
  return { cleaned, actions: [] }
}

// Inline action buttons rendered inside chat messages
const InlineActionButtons = memo(({ actions, onActivate, actionLoading, agent, onSendMessage }) => {
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [customText, setCustomText] = useState('')
  const customInputRef = useRef(null)

  // Show success state after activation
  if (selected === '__activated__') {
    return (
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-neutral-200 dark:border-[#484848]/50">
        <CheckCircle2 size={14} className="text-emerald-500" />
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Workflow activated successfully!</span>
      </div>
    )
  }

  // Show which option was selected
  if (selected) {
    return (
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-neutral-200 dark:border-[#484848]/50">
        <CheckCircle2 size={12} className="text-primary-400" />
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{selected}</span>
      </div>
    )
  }

  const handleActivate = async () => {
    setLoading(true)
    setError(null)
    try {
      await onActivate()
      setSelected('__activated__')
    } catch (err) {
      setError(err?.message || 'Activation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleOptionClick = (option) => {
    setSelected(option)
    if (onSendMessage) onSendMessage(option)
  }

  const handleCustomSend = () => {
    if (!customText.trim()) return
    setSelected(customText.trim())
    if (onSendMessage) onSendMessage(customText.trim())
    setCustomText('')
  }

  const hasQuestionActions = actions.some(a => a.type === 'question' && a.options)

  return (
    <div className="mt-2.5 pt-2 border-t border-neutral-200 dark:border-[#484848]/50">
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action, ai) => {
          if (action.type === 'activate_agent') {
            if (['active', 'compiled', 'deployed'].includes(agent?.status)) return null
            return (
              <button
                key={ai}
                onClick={handleActivate}
                disabled={loading || actionLoading === 'compile'}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {loading || actionLoading === 'compile' ? 'Activating...' : 'Yes, Activate'}
              </button>
            )
          }
          if (action.type === 'question' && action.options) {
            return action.options.map((opt, oi) => (
              <button
                key={`${ai}-${oi}`}
                onClick={() => handleOptionClick(opt)}
                className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 dark:hover:border-primary-700 text-neutral-700 dark:text-neutral-300 rounded-lg transition-colors"
              >
                {opt}
              </button>
            ))
          }
          return null
        })}
      </div>
      {/* Custom text input — allows typing a custom response */}
      {hasQuestionActions && (
        <div className="flex items-center gap-1.5 mt-2">
          <input
            ref={customInputRef}
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomSend()}
            placeholder="Or type your answer..."
            className="flex-1 px-2.5 py-1.5 text-[11px] bg-white dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] rounded-lg text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none focus:border-primary-300 dark:focus:border-primary-600"
          />
          <button
            onClick={handleCustomSend}
            disabled={!customText.trim()}
            className="p-1.5 text-primary-500 hover:text-primary-600 disabled:text-neutral-300 dark:disabled:text-neutral-600 transition-colors"
          >
            <Send size={12} />
          </button>
        </div>
      )}
      {error && <span className="text-xs text-red-500 mt-1 block">{error}</span>}
    </div>
  )
})

// Map a backend MessageResponse into the local UI message shape. Pure —
// kept at module scope so the reference is stable across renders and across
// Strict Mode mount/unmount cycles, which prevents the chat-history fetch
// effect from re-firing just because a fresh function reference was created.
const mapHistoryMessage = (m) => {
  // `truncated` + `full_result_url` arrive on heavy results (>50 KB) — the
  // backend trims the inline string to 5 KB and the frontend renders a
  // "Load full result" button that fetches the rest via `getToolResult`.
  // `messageId` is propagated onto each tool call/segment so the click
  // handler can build the API path without walking back up to the parent.
  const toolCalls = m.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.name,
    params: tc.params,
    status: tc.status || 'done',
    result: tc.result,
    truncated: tc.truncated === true,
    fullResultUrl: tc.full_result_url || null,
    messageId: m.id,
  }))
  // Use backend segments if available (preserves exact execution order)
  // Fallback: reconstruct from tool_calls for old messages
  const segments = m.segments?.length > 0
    ? m.segments.map(seg => seg.type === 'tool'
        ? {
            ...seg,
            truncated: seg.truncated === true,
            fullResultUrl: seg.full_result_url || null,
            messageId: m.id,
          }
        : seg
      )
    : toolCalls?.length > 0
      ? [
          ...(m.content ? [{ type: 'text', content: m.content }] : []),
          ...toolCalls.map(tc => ({ type: 'tool', ...tc })),
        ]
      : undefined
  // Extract inline actions from stored content
  const { cleaned: cleanedContent, actions: msgActions } = extractActions(m.content)
  return {
    id: m.id,
    role: m.role,
    content: cleanedContent,
    timestamp: m.created_at,
    status: m.status || null,
    error: m.error || undefined,
    isError: m.status === 'error' || Boolean(m.error),
    toolCalls,
    segments,
    actions: msgActions.length > 0 ? msgActions : undefined,
    usage: m.usage || undefined,
    attachments: m.attachments || undefined,
  }
}

const ChatPanel = ({ agent, steps, onStepAdded, onStepUpdated, onStepReorder, onClearAgent, onInstructionsUpdated, onWebhookSchemaUpdated, collectedCredentials = {}, onCredentialCollected, onActivate, actionLoading, compileError, compileSuccess, testResult, onDismissCompileError, onDismissCompileSuccess, onDismissTestResult, onStepsRefreshed, onRefreshAgent, onWorkflowDeployed, activeExecution, onTrackExecution, creditRefreshKey, webhookUrl, allAgents = [], onSwitchAgent, onCredentialsChanged, onOpenSettings, onOpenShare, onOpenTeamAccess, onProviderSwitching, compact = false, pendingChatInput, onPendingChatInputConsumed }) => {
  const { user, updateUser } = useAuth()
  // Pabbly Provider AI Credit balance + threshold-based pill tone — green when
  // healthy, amber when getting low, red when nearly empty. Lets the Pabbly
  // Provider dropdown row + trigger tooltip surface a balance the user can
  // actually act on without having to do mental math.
  const creditsLeft = user?.credit_balance != null ? user.credit_balance / 1000 : null
  const creditBadgeTone =
    creditsLeft == null
      ? ''
      : creditsLeft < 10
        ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'
        : creditsLeft < 50
          ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
          : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
  const [messages, setMessages] = useState([])
  const [chatLoading, setChatLoading] = useState(true)
  // Lifetime workflow credit consumption — fetched once from /credit-summary
  // on mount, then refreshed on every chat-done, active-execution finish, and
  // tab focus. Includes ALL platform-key spend across this workflow (chat +
  // test runs + production webhook runs), not just the loaded message slice.
  // BYOK rows are excluded server-side via key_type:"platform" filter.
  const [creditSummary, setCreditSummary] = useState({
    total: { credits_used: 0, request_count: 0 },
    by_source: {
      chat: { credits_used: 0, request_count: 0 },
      test: { credits_used: 0, request_count: 0 },
      run:  { credits_used: 0, request_count: 0 },
    },
  })
  // Coalesce rapid refresh triggers (SSE done + activeExecution finish for the
  // same test_workflow call often fire within 100ms of each other).
  const creditRefetchTimerRef = useRef(null)
  const refetchCreditSummary = useCallback(() => {
    if (!agent?.slug && !agent?.id) return
    clearTimeout(creditRefetchTimerRef.current)
    creditRefetchTimerRef.current = setTimeout(() => {
      creditsAPI.getWorkflowSummary(agent.slug || agent.id)
        .then((res) => {
          if (res?.data) setCreditSummary(res.data)
        })
        .catch(() => { /* network blip — next trigger retries */ })
    }, 250)
  }, [agent?.slug, agent?.id])
  // BuilderPage bumps `creditRefreshKey` whenever a tracked execution finishes
  // (test or production run). The credits land in DB via the PF callback path,
  // never the chat SSE stream, so this is the only signal we get.
  useEffect(() => {
    if (creditRefreshKey > 0) refetchCreditSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditRefreshKey])
  const [bannerDismissed, setBannerDismissed] = useState(false)
  // Backend chat pagination — initial fetch is `limit: 5`. Older pages are
  // fetched on demand when the user clicks "Load earlier messages" button.
  // Replaces the previous in-memory `visibleCount` slice (which still required
  // the full chat to be downloaded up-front).
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [oldestMessageId, setOldestMessageId] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Use ref for input to avoid re-rendering entire ChatPanel on every keystroke
  const inputRef = useRef('')
  const [inputVersion, setInputVersion] = useState(0) // only used to force re-render of send button state
  // Per-workflow draft key — drafts survive page reload until a message
  // actually sends (then handleSend clears the entry).
  const draftKey = agent?.id ? `chat_draft_${agent.id}` : null
  const setInput = useCallback((val) => {
    inputRef.current = val
    if (textareaRef.current) textareaRef.current.value = val
    setInputVersion(v => v + 1)
    if (draftKey) {
      try {
        if (val) localStorage.setItem(draftKey, val)
        else localStorage.removeItem(draftKey)
      } catch { /* quota / private mode — non-fatal */ }
    }
  }, [draftKey])
  const input = inputRef.current
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null)
  const streamingRef = useRef('')
  const parsedStepNamesRef = useRef(new Set()) // track steps already parsed in current message
  const stepRefreshLockRef = useRef(false) // when true, parseStepActions is blocked (DB is source of truth)
  const refreshDebounceRef = useRef(null) // debounces stepsAPI.list() calls when multiple step tools chain (Layer C4)
  const executionTrackingStartedRef = useRef(false) // prevents duplicate onTrackExecution calls per stream
  // Tracks the run_id of the LAST execution this ChatPanel itself kicked off
  // (i.e. master agent's `test_workflow` tool fired during a chat response).
  // The inline "Running step X of N..." live-execution block in this chat is
  // only rendered when activeExecution.runId === chatInitiatedRunIdRef.current
  // — that way TestPanel's "Run All Steps" and external webhook fires (which
  // also populate activeExecution via BuilderPage) DON'T pollute the chat
  // with a misleading "Running…" indicator that makes the user think the
  // chat itself is busy. Both of those still update Steps panel + Task
  // History exactly as before.
  const chatInitiatedRunIdRef = useRef(null)
  const rafRef = useRef(null) // requestAnimationFrame ID

  // ── Search in Chat ──
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchMatches, setSearchMatches] = useState([])   // [{msgIndex}]
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const searchInputRef = useRef(null)
  const searchDebounceRef = useRef(null)

  const [toolActivity, setToolActivity] = useState(null)
  const [activityDesc, setActivityDesc] = useState('') // AI-generated description of current activity
  const [liveStatus, setLiveStatus] = useState('') // ephemeral status text from 'status' SSE events
  const toolActivityTimerRef = useRef(null)
  const [toolHistory, setToolHistory] = useState([]) // [{id, name, status, result, collapsed}]
  const toolHistoryRef = useRef([])
  // Live elapsed timer — uses stepStartedAt from BuilderPage (persists across tab switches)
  const [, _setTick] = useState(0)
  const segmentsRef = useRef([]) // ordered [{type:'text',content}, {type:'tool',...toolData}]
  const [streamingSegments, setStreamingSegments] = useState([]) // reactive copy for rendering
  const lastTextSegmentRef = useRef('') // tracks text accumulated before a tool_call
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)
  const [selectedModel, setSelectedModel] = useState(agent?.model || 'claude-sonnet-4-6')
  // True = use platform's "Pabbly AI Model" (admin's active_model + platform key).
  // False = use the user's BYOK + selectedModel above. The chat header dropdown
  // toggles this when the user picks an option. Persisted to agent.config.use_system_model
  // so the deployed function (bundled.rs::resolve_api_key) reads the same preference
  // and stays consistent with what the user picked here.
  const [useSystemModel, setUseSystemModel] = useState(
    agent?.config?.use_system_model !== undefined ? !!agent.config.use_system_model : true
  )

  // Sync local BYOK toggle from the agent doc whenever the user lands on a
  // different agent. agent loads asynchronously (BuilderPage useEffect), so
  // the initial useState above sees agent=null and falls back to true; this
  // effect picks up the persisted preference once it arrives. Keyed on
  // agent.id only — mid-session local toggles stay authoritative.
  useEffect(() => {
    if (!agent?.id) return
    if (agent.config?.use_system_model !== undefined) {
      setUseSystemModel(!!agent.config.use_system_model)
    }
    if (agent.config?.use_system_model === false && agent.model) {
      setSelectedModel(agent.model)
    }
    setSelectedConnectionId(agent.config?.connection_id || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id])

  // Persist BYOK preference to agent.config so the deploy/webhook path picks
  // up the same provider+model+key the chat panel is using.
  //
  // - For NOT-deployed agents: fire-and-forget local persist; chat.rs receives
  //   use_platform inline so the next send still works regardless.
  // - For DEPLOYED agents (agent.pabbly_functions_id set): we additionally hit
  //   the update-env endpoint which re-pushes the function on Pabbly Functions
  //   with the new LLM_* env vars. If that fails, the backend rolls the DB
  //   back AND we revert the local dropdown state, so the user sees the model
  //   they actually have running. The previous selection is captured via the
  //   `previous` callback args so React state is restored on error.
  const persistByokPreference = useCallback((nextUseSystemModel, nextSelectedModel, previous, nextConnectionId) => {
    if (!agent?.id) return
    const nextConfig = { ...(agent.config || {}), use_system_model: !!nextUseSystemModel }
    // Multi-connection binding: when switching to Pabbly Provider, drop any
    // stale connection_id (it only applies to BYOK). When switching to BYOK,
    // honor the caller-supplied connection_id; an explicit `null` clears it
    // (revert to per-provider default connection), `undefined` leaves the
    // existing binding alone.
    if (nextUseSystemModel) {
      delete nextConfig.connection_id
    } else if (nextConnectionId === null) {
      delete nextConfig.connection_id
    } else if (nextConnectionId) {
      nextConfig.connection_id = nextConnectionId
    }
    const payload = { config: nextConfig }
    // Push agent.model on BOTH switch directions:
    //   • Picked a BYOK model → write the model id.
    //   • Switched back to Pabbly Provider → write null to CLEAR a stale BYOK
    //     model id. Otherwise agent.model stays pointing at e.g. a Fireworks
    //     model while use_system_model=true, and credit deduction looks up
    //     pricing for a model that's never actually being charged (the run
    //     uses PABBLY_AI_* anthropic) → step_credits stays 0 → no credits in
    //     task history. Backend reads agent.model = null as "use admin's
    //     active model".
    if (!nextUseSystemModel && nextSelectedModel) {
      payload.model = nextSelectedModel
    } else if (nextUseSystemModel) {
      payload.model = null
    }

    // Always persist model to agent document first — chat reads from DB,
    // so the model switch works immediately regardless of FaaS sync.
    workflowsAPI.update(agent.id, payload).catch(() => {})

    if (agent?.pabbly_functions_id) {
      // Deployed → push env to Pabbly Functions so webhooks pick up the
      // new model.
      //
      // CRITICAL: if the FaaS push fails (anything other than "no steps"
      // on a hello placeholder), the deployed function still has the OLD
      // env vars. Most importantly, switching from Pabbly Provider → BYOK
      // custom and silently leaving Pabbly env on the FaaS side means the
      // SDK keeps reading PABBLY_AI_* (admin's anthropic platform key)
      // even though the chat header says "custom". User then tests with
      // a non-anthropic model and gets "anthropic 400". So on FaaS error
      // we MUST revert local state to whatever's actually deployed —
      // backend already rolled back the DB on its side.
      //
      // SAFETY: while the FaaS push is in flight (~3-5s), we set the local
      // `switchingProvider` flag so handleSend / send button get blocked
      // and we notify the parent (BuilderPage) via onProviderSwitching so
      // it can flip actionLoading="switching" and the Test button in
      // StepsPanel auto-disables. This prevents the user from sending a
      // chat message or running a test while the function still has the
      // OLD env vars — a chat in that window would route to the wrong
      // model and bill the wrong path.
      setSwitchingProvider(true)
      if (typeof onProviderSwitching === 'function') onProviderSwitching(true)

      deploysAPI.updateEnv(agent.id, {
        use_system_model: !!nextUseSystemModel,
        // null = clear (going to Pabbly Provider), string = set (going to
        // BYOK), undefined = leave alone. Backend differentiates these.
        model: nextUseSystemModel ? null : (nextSelectedModel || undefined),
        // Same tri-state for connection_id: null clears (revert to default
        // connection), string sets, undefined leaves alone. Switching back
        // to Pabbly Provider always clears the connection.
        connection_id: nextUseSystemModel
          ? null
          : (nextConnectionId === null ? null : (nextConnectionId || undefined)),
      })
        .then(() => {
          toast.success(nextUseSystemModel ? 'Switched to Pabbly Provider' : `Switched to ${nextSelectedModel}`)
        })
        .catch((err) => {
          const msg = err?.response?.data?.error || 'Failed to update deployed function'
          // "no steps" is expected for fresh agents with auto-deployed hello
          // function — not a real error. Backend skipped the redeploy and
          // saved the model anyway; the next add_step will pick it up.
          if (msg.toLowerCase().includes('no steps')) {
            toast.success(nextUseSystemModel ? 'Switched to Pabbly Provider' : `Switched to ${nextSelectedModel}`)
            return
          }
          // Real FaaS failure → revert local UI so the dropdown reflects
          // what's actually deployed. Otherwise the user sees "custom"
          // selected, tests, and hits the platform anthropic key.
          if (previous) {
            setUseSystemModel(previous.useSystemModel)
            setSelectedModel(previous.selectedModel)
          }
          toast.error(`Couldn't switch on Pabbly Functions: ${msg}. Reverted to previous selection.`)
        })
        .finally(() => {
          setSwitchingProvider(false)
          if (typeof onProviderSwitching === 'function') onProviderSwitching(false)
        })
    } else {
      toast.success(nextUseSystemModel ? 'Switched to Pabbly Provider' : `Switched to ${nextSelectedModel}`)
    }
  }, [agent?.id, agent?.config, agent?.model, agent?.pabbly_functions_id, onProviderSwitching])

  // While true, chat send + test are blocked because the FaaS-side env-var
  // push for a provider/model switch is still in flight. Cleared in the
  // .finally() of the deploysAPI.updateEnv promise above.
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  // Tracks which BYOK provider section is expanded inside the model dropdown
  const [expandedDropdownProvider, setExpandedDropdownProvider] = useState(null)
  const [modelDropdownSearch, setModelDropdownSearch] = useState('')
  // Two refs — panel (the absolute-positioned dropdown body) and trigger
  // (the chip/button in the composer). Outside-click closes when a click
  // lands outside BOTH; without this, mousedown on the trigger fires the
  // outside-handler before the click toggles state, and the dropdown
  // re-opens immediately on every close-click.
  const modelDropdownRef = useRef(null)
  const modelTriggerRef = useRef(null)
  const [configuredProviders, setConfiguredProviders] = useState([])
  const [keysLoaded, setKeysLoaded] = useState(false)
  const [customProviderKey, setCustomProviderKey] = useState(null)
  // Full keys list (with id + name + is_default) so the chat header's BYOK
  // model dropdown can show per-provider connection selectors. Only renders
  // a connection picker when a provider has 2+ rows.
  const [allKeys, setAllKeys] = useState([])
  // Persisted multi-connection binding from agent.config.connection_id — set
  // by the connection picker in the BYOK dropdown. When null, the resolver
  // falls back to is_default=true for the active provider.
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    agent?.config?.connection_id || null
  )
  const [allModels, setAllModels] = useState(FALLBACK_MODELS)
  const [availableModels, setAvailableModels] = useState(FALLBACK_MODELS)
  const [platformActiveModel, setPlatformActiveModel] = useState(null)
  // Full catalog from /api/usage/all-pricing — used by the BYOK dropdown so
  // users can pick from ALL models per provider, not just the small set in
  // the platform pricing table. Each entry: { id, label, providerId }.
  const [byokCatalog, setByokCatalog] = useState([])
  const [availableTools, setAvailableTools] = useState([])
  const [webhookCopied, setWebhookCopied] = useState(false)
  const [showWebhookMenu, setShowWebhookMenu] = useState(false)
  const [webhookCopiedKind, setWebhookCopiedKind] = useState(null) // 'url' | 'curl' | null
  const [webhookPreview, setWebhookPreview] = useState(null) // 'url' | 'curl' | null
  const webhookMenuRef = useRef(null)
  // Schedule chip — sibling to the Webhook chip, only renders when this
  // workflow has a cron schedule attached on Pabbly Functions.
  //
  // Two state sources, in priority order:
  //   1. `scheduleStateFromMessages` — derived from the chat-message log
  //      via useMemo (see below). Live updates from get_schedule /
  //      create_schedule / update_schedule / delete_schedule tool results.
  //      Always wins when present so in-session actions reflect immediately.
  //   2. `mountedSchedule` — one-shot fetch on agent open via
  //      `GET /api/workflows/:id/schedule`. Seeds the chip on cold reload
  //      (chat history defaults to last 5 messages, so an older schedule
  //      action wouldn't otherwise be in scope).
  const [showScheduleMenu, setShowScheduleMenu] = useState(false)
  const scheduleMenuRef = useRef(null)
  // Overflow kebab in chat sub-header — collapses Share / Team Access /
  // Settings into a single ⋮ button on desktop. The three buttons used to
  // each take a slot in the sub-header; consolidating them frees up that
  // row for the chat content while keeping the actions one click away.
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  // Two refs because the kebab trigger lives inside the composer (whose
  // outer card has `overflow-hidden`), but the popup must render OUTSIDE
  // that clip context to be visible — so the panel is rendered at the chat
  // panel root with its own ref, and outside-click checks both.
  const overflowMenuRef = useRef(null)
  const overflowPanelRef = useRef(null)
  // Mobile composer kebab — replaces the old Settings cog and opens an
  // upward dropdown that surfaces Schedule status, Credits used, Share,
  // Team Access, and Workflow Settings in one place (desktop has these as
  // separate sub-header pills + kebab; mobile sub-header is h-0 so we fold
  // everything into the composer toolbar). The composer card has
  // `overflow-hidden`, so the panel must be portaled out of it — same
  // dual-ref pattern as the desktop overflow kebab.
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const [composerMenuPos, setComposerMenuPos] = useState({ bottom: 0, right: 0 })
  const composerMenuRef = useRef(null)
  const composerMenuPanelRef = useRef(null)
  // Track composer height so the model dropdown's bottom anchor adapts when
  // the textarea grows (multi-line input) — fixed `bottom-[124px]` would let
  // the dropdown overlap the trigger button on tall composers.
  const composerRef = useRef(null)
  const [composerHeight, setComposerHeight] = useState(0)
  const [mountedSchedule, setMountedSchedule] = useState(null)
  const searchBoxRef = useRef(null)
  // messagesEndRef removed — Virtuoso handles scroll-to-bottom
  const textareaRef = useRef(null)
  const abortControllerRef = useRef(null)
  const pendingFinalizeRef = useRef(null) // stores final message data waiting for typing to finish

  // Auto-focus textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100)
  }, [])

  // Quick-fill from action buttons (Test / Activate / Deactivate / Update in
  // the Steps panel). Parent sets `pendingChatInput` to `{ text, nonce }`;
  // a fresh nonce on each click re-fires this effect even when the text is
  // identical to the prior click. We populate the textarea (no auto-send —
  // user reviews and presses Enter), focus the caret at the end, then signal
  // the parent to clear its slot.
  useEffect(() => {
    const text = pendingChatInput?.text
    if (!text) return
    setInput(text)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      const end = ta.value.length
      try { ta.setSelectionRange(end, end) } catch { /* ignore */ }
    })
    onPendingChatInputConsumed?.()
  }, [pendingChatInput, setInput, onPendingChatInputConsumed])

  // Derive schedule state from the chat message log — no extra API call.
  //
  // Walks tool calls in reverse (newest → oldest) and returns on the first
  // schedule-related result we find. Latest action wins, so the first hit
  // walking backward is authoritative — no need to scan the rest. Average
  // case is O(1) when the most recent message has the schedule action;
  // worst case (no schedule tool ever called) is O(n) but still cheap and
  // only runs when `messages` changes.
  //
  // Tool → state mapping:
  //   delete_schedule(success)              → { exists: false }
  //   get_schedule(exists:true|false)       → mirrors `exists`
  //   create_schedule / update_schedule(ok) → { exists: true, schedule }
  //
  // Initial value is `null` (unknown) — chip stays hidden until the first
  // schedule tool fires. Page refresh re-derives state from getHistory().
  const scheduleStateFromMessages = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const calls = messages[i]?.toolCalls
      if (!calls || calls.length === 0) continue
      for (let j = calls.length - 1; j >= 0; j--) {
        const call = calls[j]
        if (!call || !SCHEDULE_TOOL_NAMES.has(call.name)) continue
        if (!call.result || (typeof call.result === 'string' && call.result.startsWith('Error'))) continue
        let parsed
        try { parsed = typeof call.result === 'string' ? JSON.parse(call.result) : call.result }
        catch { continue }
        if (!parsed || parsed.status === 'failed') continue
        if (call.name === 'delete_schedule') return { exists: false }
        if (call.name === 'get_schedule') {
          return parsed.exists
            ? { exists: true, schedule: parsed.schedule || {} }
            : { exists: false }
        }
        // create_schedule / update_schedule
        if (parsed.schedule) return { exists: true, schedule: parsed.schedule }
      }
    }
    return null
  }, [messages])

  // Final chip state — `mountedSchedule` wins because it's refetched after
  // every schedule tool completes (see SSE handler), so it reflects PF's
  // authoritative current state. `scheduleStateFromMessages` is a fast
  // initial-paint fallback for the brief window before the mount fetch
  // resolves (cold reload with a recent schedule action in chat history).
  // Without this priority, partial update_schedule responses (which sometimes
  // omit the `enabled` field) would shadow the refetched state and render
  // stale "Enabled" after a pause.
  const scheduleState = mountedSchedule ?? scheduleStateFromMessages

  // One-shot fetch on workflow open. Reset when switching workflows so a
  // stale value from the prior agent never bleeds into the next one.
  // Failures are silent — the chip just stays hidden until a chat tool
  // surfaces a fresh state, which is the same UX as before this fallback.
  useEffect(() => {
    setMountedSchedule(null)
    const id = agent?.slug || agent?.id
    if (!id) return
    let cancelled = false
    schedulesAPI
      .getForWorkflow(id)
      .then((res) => {
        if (cancelled) return
        const data = res?.data
        if (!data) return
        if (data.exists && data.schedule) {
          setMountedSchedule({ exists: true, schedule: data.schedule })
        } else if (data.exists === false) {
          setMountedSchedule({ exists: false })
        }
      })
      .catch(() => { /* silent — chip stays null */ })
    return () => { cancelled = true }
  }, [agent?.slug, agent?.id])

  // Restore draft from localStorage when the workflow loads. Runs once per
  // agent.id change so switching workflows pulls the right draft.
  useEffect(() => {
    if (!draftKey) return
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved && !inputRef.current) {
        inputRef.current = saved
        if (textareaRef.current) textareaRef.current.value = saved
        setInputVersion(v => v + 1)
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  const fileInputRef = useRef(null)
  const [attachments, setAttachments] = useState([]) // [{id, dataUrl, mimeType, name}]
  // Attachment preview modal — { files: [{url?, dataUrl?, mimeType, name?, text?}], initialIndex }
  const [preview, setPreview] = useState(null)

  // Normalize any attachment shape (message.attachments OR composer attachments)
  // into the FilePreviewModal file schema + open the modal.
  // `opts.editable` = true → the modal will surface an Edit button for text
  // attachments and persist changes back into composer state via onEditText.
  // Sent-message attachments are NEVER editable (the LLM has already seen the
  // original; mutating it locally would just confuse history).
  const openAttachmentPreview = useCallback((atts, idx = 0, opts = {}) => {
    if (!Array.isArray(atts) || atts.length === 0) return
    const a = atts[Math.max(0, Math.min(idx, atts.length - 1))]
    if (!a) return
    // Single-file-at-a-time preview (Claude-style minimal chrome). Siblings
    // are not passed in — to view another attachment the user taps outside
    // to close and clicks that card. No nav arrows, no count, no download
    // clutter in the modal.
    setPreview({
      files: [{
        url: a.url,
        dataUrl: a.dataUrl,
        mimeType: a.mime_type || a.mimeType,
        name: a.name,
        text: a.text,
      }],
      initialIndex: 0,
      onEditText: opts.editable
        ? (newText) => {
            setAttachments((prev) =>
              prev.map((x) =>
                x.id === a.id
                  ? { ...x, text: newText, preview: newText.slice(0, 220) }
                  : x
              )
            )
            // Mirror the change back into the open modal so the user can keep
            // editing without closing/reopening.
            setPreview((p) =>
              p ? { ...p, files: p.files.map((f, i) => (i === 0 ? { ...f, text: newText } : f)) } : p
            )
          }
        : undefined,
    })
  }, [])

  // Fetch dynamic models from backend pricing + configured API keys
  useEffect(() => {
    // Fetch platform models + active model from pricing table
    import('../../services/api.js').then(({ creditsAPI: cAPI }) => {
      cAPI.getPricing().then((res) => {
        const data = res.data
        // Store the platform active model for "Pabbly Provider" display,
        // but do NOT overwrite selectedModel — the agent sync useEffect
        // handles restoring the user's persisted BYOK model on reload.
        if (data.active_model) {
          setPlatformActiveModel(data.active_model)
        }
        const pricingModels = (data.models || [])
          .filter((m) => !String(m.model || '').endsWith(':free')) // hide unreliable free tier models
          .map((m) => ({
          id: m.model,
          label: m.display_name || m.model,
          provider: (m.provider || '').charAt(0).toUpperCase() + (m.provider || '').slice(1),
          providerId: m.provider || 'unknown',
          tag: MODEL_TAGS[m.model] || '',
        }))
        if (pricingModels.length > 0) {
          setAllModels(pricingModels)
          setAvailableModels(pricingModels)
        }
      }).catch(() => {})
    })

    // Fetch the full BYOK catalog (platform pricing + cached OpenRouter models).
    // This drives the per-provider lists in the chat header model dropdown so
    // users can pick from the full set, not just the few platform-priced ones.
    import('../../services/api.js').then(({ usageAPI: uAPI }) => {
      uAPI.getAllPricing().then((res) => {
        const models = (res.data?.models || []).map((m) => ({
          id: m.model,
          label: m.display_name || m.model,
          providerId: m.provider || 'unknown',
          source: m.source || 'platform', // 'platform' | 'openrouter'
        }))
        setByokCatalog(models)
      }).catch(() => {})
    })

    // Fetch available tools
    toolsAPI.list()
      .then((res) => setAvailableTools(res.data.tools || []))
      .catch(() => {})

    // Fetch user's configured BYOK keys — needed by the chat-header model
    // dropdown to know which provider sections to show alongside "Pabbly AI Model".
    keysAPI.getAll()
      .then((res) => {
        const keys = res.data?.keys || []
        // Sort by creation order (oldest first) so the per-provider
        // connection picker in the chat header model dropdown lists
        // connections in the same order the user added them.
        const sortedKeys = [...keys].sort((a, b) => {
          const ta = a?.created_at ? new Date(a.created_at).getTime() : 0
          const tb = b?.created_at ? new Date(b.created_at).getTime() : 0
          return ta - tb
        })
        // Normalise: 'anthropic_oauth' counts as 'anthropic'
        const providers = [...new Set(sortedKeys.map((k) => (k.provider || '').replace(/_oauth$/, '')))]
        setConfiguredProviders(providers)
        setAllKeys(sortedKeys)
        // Store custom provider key data for the dropdown (needs model_id)
        const customKey = sortedKeys.find(k => k.provider === 'custom')
        if (customKey) setCustomProviderKey(customKey)
      })
      .catch(() => {})
      .finally(() => setKeysLoaded(true))
  }, [])

  // Auto-clear tool spinner after 60s timeout (prevents stuck spinners)
  useEffect(() => {
    if (toolActivity) {
      toolActivityTimerRef.current = setTimeout(() => {
        setToolActivity(null)
      }, 60000)
      return () => clearTimeout(toolActivityTimerRef.current)
    }
  }, [toolActivity])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      const inModelPanel = modelDropdownRef.current?.contains(e.target)
      const inModelTrigger = modelTriggerRef.current?.contains(e.target)
      if (!inModelPanel && !inModelTrigger) setShowModelDropdown(false)
      if (webhookMenuRef.current && !webhookMenuRef.current.contains(e.target)) setShowWebhookMenu(false)
      if (scheduleMenuRef.current && !scheduleMenuRef.current.contains(e.target)) setShowScheduleMenu(false)
      const inOverflowTrigger = overflowMenuRef.current?.contains(e.target)
      const inOverflowPanel = overflowPanelRef.current?.contains(e.target)
      if (!inOverflowTrigger && !inOverflowPanel) setShowOverflowMenu(false)
      const inComposerTrigger = composerMenuRef.current?.contains(e.target)
      const inComposerPanel = composerMenuPanelRef.current?.contains(e.target)
      if (!inComposerTrigger && !inComposerPanel) setShowComposerMenu(false)
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target) && !searchInputRef.current?.value) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Build a Postman-compatible cURL from the agent's invocation URL + webhook input schema.
  // Delegates to the shared buildInvokeCurl helper so this stays in sync with
  // the deploy modal's "Copy cURL" button. The `invoked_by` block uses the
  // logged-in user's real name + email so the copied cURL is attributed to
  // them in the FaaS audit trail and the deployed function's invocation log
  // — not the previous "API Caller / api@example.com" dummy.
  const buildPostmanCurl = (url) => buildInvokeCurl({
    url,
    schema: agent?.webhook_input_schema,
    invokedBy: { name: user?.name, email: user?.email },
  })

  // Load chat history — auto-greet if fresh agent. Initial page is the last 10
  // messages; older pages load on demand via loadOlderMessages().
  // `mapHistoryMessage` is defined at module scope (see top of file) so its
  // reference is stable across renders and doesn't bloat the effect dep array.
  useEffect(() => {
    if (!agent?.slug && !agent?.id) return
    // Fresh load / agent switch — re-arm the initial-scroll-to-bottom guard
    initialScrollDoneRef.current = false
    // Fire credit summary in parallel — independent of chat history, so no
    // reason to await sequentially.
    creditsAPI.getWorkflowSummary(agent.slug || agent.id)
      .then((res) => { if (res?.data) setCreditSummary(res.data) })
      .catch(() => { /* non-fatal — pill stays at zero */ })
    // Tab focus refresh — picks up credits accrued in another tab or by an
    // external webhook firing while the user was away.
    const onVisibility = () => {
      if (!document.hidden) refetchCreditSummary()
    }
    document.addEventListener('visibilitychange', onVisibility)
    chatAPI.getHistory(agent.slug || agent.id, { limit: 5 })
      .then((res) => {
        const history = (res.data.messages || []).map(mapHistoryMessage)
        setHasMoreOlder(res.data.has_more === true)
        setOldestMessageId(res.data.oldest_id || null)
        if (history.length === 0) {
          // Fresh agent — auto-greet
          setMessages([{
            role: 'assistant',
            content: `Welcome to **Pabbly AgenticAI**! 👋\n\nBuild powerful AI automation workflows in minutes — no coding required. Simply describe what you want, and I'll create the steps for you.\n\n**How it works:**\n1. Tell me what your workflow should do\n2. I'll design the workflow with AI and code steps\n3. Test it with real data, then activate\n\nYour workflow runs automatically via a webhook URL — connect it to any app or trigger.\n\n**Try something like:**\n- "Analyze images and send results to Google Chat"\n- "Fetch daily tickets from Freshdesk and generate a report"\n- "Summarize YouTube videos and post to Slack"\n\nWhat would you like to build?`,
            timestamp: new Date().toISOString(),
          }])
        } else {
          setMessages(history)
        }
        setChatLoading(false)
      })
      .catch(() => { setChatLoading(false) })
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(creditRefetchTimerRef.current)
    }
  }, [agent?.slug, agent?.id, refetchCreditSummary])

  // Load older messages on demand. Captures scroll position before prepending
  // and restores it via the height delta so the user's viewport stays anchored
  // at the same logical message (no jump-to-top jolt).
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || !oldestMessageId) return
    const id = agent?.slug || agent?.id
    if (!id) return
    setLoadingOlder(true)
    const container = chatContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0
    const prevScrollTop = container?.scrollTop || 0
    try {
      const res = await chatAPI.getHistory(id, { limit: 5, before: oldestMessageId })
      const older = (res.data.messages || []).map(mapHistoryMessage)
      if (older.length > 0) {
        setMessages((prev) => [...older, ...prev])
      }
      setHasMoreOlder(res.data.has_more === true)
      setOldestMessageId(res.data.oldest_id || oldestMessageId)
      // Restore scroll position after the new DOM lays out — double rAF lets
      // markdown/images settle before we measure scrollHeight again.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (chatContainerRef.current) {
            const delta = chatContainerRef.current.scrollHeight - prevScrollHeight
            chatContainerRef.current.scrollTop = prevScrollTop + delta
          }
        })
      })
    } catch {
      // keep state intact; user can retry by clicking the button again
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, hasMoreOlder, oldestMessageId, agent?.slug, agent?.id])

  // Auto-scroll only when user is near the bottom (not when they've scrolled up to read)
  const chatContainerRef = useRef(null)
  // userScrolledUpRef removed — Virtuoso handles scroll tracking

  // virtuosoRef removed — using plain scroll div

  // Auto-scroll: scroll to bottom when new messages arrive or streaming updates
  const chatEndRef = useRef(null)
  const userScrolledUpRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const lastSeenMsgCountRef = useRef(0)
  // Fires once per mount after history loads — ensures initial scroll lands at
  // the bottom even when messages contain late-rendering markdown/images.
  const initialScrollDoneRef = useRef(false)

  // Track if user scrolled up — show arrow when scrolled up, show "New activity" when new content arrives.
  // NOTE: scroll-to-top NO longer triggers auto-load. The "Load earlier
  // messages" button at the top of the chat is the only way to fetch older
  // pages — keeps network behavior predictable per user request.
  const handleChatScroll = useCallback((e) => {
    const el = e.target
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    userScrolledUpRef.current = !isNearBottom
    if (isNearBottom) {
      setShowScrollToBottom(false)
      lastSeenMsgCountRef.current = messages.length
    } else {
      setShowScrollToBottom(true)
    }
  }, [messages.length])

  // Scroll to bottom handler for the button
  const scrollToBottom = useCallback(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
      setShowScrollToBottom(false)
    }
  }, [])

  // Initial scroll after chat history loads — uses double-RAF + 'instant' so
  // it lands at the true bottom even when messages contain markdown/images that
  // render late. Runs once per mount (or when agent changes).
  useEffect(() => {
    if (chatLoading) return
    if (initialScrollDoneRef.current) return
    if (messages.length === 0) return
    initialScrollDoneRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
        }
        userScrolledUpRef.current = false
        lastSeenMsgCountRef.current = messages.length
      })
    })
  }, [chatLoading, messages.length])

  // Auto-scroll on new messages + reset visible window. Skips the very first
  // fire after load — initialScrollDoneRef-guarded effect above handles that
  // one with 'instant' to avoid a mid-chat smooth-scroll jump.
  useEffect(() => {
    if (!initialScrollDoneRef.current) {
      // Initial load not yet committed — don't race the initial-scroll effect.
      return
    }
    if (!userScrolledUpRef.current && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
      lastSeenMsgCountRef.current = messages.length
    } else if (userScrolledUpRef.current && messages.length > lastSeenMsgCountRef.current) {
      // New content arrived while user is scrolled up — show the button
      setShowScrollToBottom(true)
    }
  }, [messages.length])

  // Auto-scroll during streaming — triggers on text, tool calls, and segment changes
  useEffect(() => {
    if (isStreaming && !userScrolledUpRef.current && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'auto' })
    } else if (isStreaming && userScrolledUpRef.current) {
      setShowScrollToBottom(true)
    }
  }, [streamingText, isStreaming, streamingSegments, toolHistory, toolActivity])

  // Simple 1-second tick while executing (forces re-render for elapsed calculation)
  useEffect(() => {
    if (activeExecution?.status !== 'executing') return
    const id = setInterval(() => _setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activeExecution?.status])
  const stepElapsed = activeExecution?.stepStartedAt
    ? Math.floor((Date.now() - activeExecution.stepStartedAt) / 1000)
    : 0

  // Warn user before navigating away while streaming
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isStreaming) {
        e.preventDefault()
        e.returnValue = 'AI is still generating. If you leave, files will still be saved in the background.'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isStreaming])

  // ── Search in Chat — functions + effects ──

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchTerm('')
    setSearchMatches([])
    setCurrentMatchIndex(0)
    clearTimeout(searchDebounceRef.current)
    // Clear DOM highlights
    const container = chatContainerRef.current
    if (container) {
      container.querySelectorAll('mark.search-hl').forEach(mark => {
        const parent = mark.parentNode
        parent.replaceChild(document.createTextNode(mark.textContent), mark)
        parent.normalize()
      })
    }
  }, [])

  const scrollToMatch = useCallback((idx, matches) => {
    const match = (matches || searchMatches)[idx]
    if (!match) return
    requestAnimationFrame(() => {
      const msgEl = chatContainerRef.current?.querySelector(`[data-msg-index="${match.msgIndex}"]`)
      if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [searchMatches])

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    const next = (currentMatchIndex + 1) % searchMatches.length
    setCurrentMatchIndex(next)
    scrollToMatch(next)
  }, [currentMatchIndex, searchMatches, scrollToMatch])

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length
    setCurrentMatchIndex(prev)
    scrollToMatch(prev)
  }, [currentMatchIndex, searchMatches, scrollToMatch])

  const handleSearchInput = useCallback((value) => {
    setSearchTerm(value)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      if (!value.trim()) {
        setSearchMatches([])
        setCurrentMatchIndex(0)
        return
      }
      const term = value.toLowerCase()
      const matches = []
      // Chat search runs over message text (content) + assistant prose
      // segments only. Tool call result bodies are intentionally excluded —
      // they're lazy-loaded on click via `getToolResult`, so most are not
      // resident in memory and would either miss or trigger N parallel
      // fetches per keystroke. Per-product spec, search is for conversation
      // text, not tool I/O.
      messages.forEach((msg, msgIndex) => {
        const content = (msg.content || '').toLowerCase()
        let pos = 0
        while ((pos = content.indexOf(term, pos)) !== -1) {
          matches.push({ msgIndex, offset: pos })
          pos += term.length
        }
        // Also walk text-only segments (the assistant's interleaved prose
        // between tool calls). These are tiny strings, no fetch needed.
        if (msg.segments) {
          msg.segments.forEach((seg) => {
            if (seg.type === 'text' && seg.content) {
              if (seg.content.toLowerCase().includes(term)) {
                matches.push({ msgIndex, offset: -1 })
              }
            }
          })
        }
      })
      // Deduplicate — keep at most one entry per msgIndex for navigation
      const seen = new Set()
      const deduped = matches.filter(m => { if (seen.has(m.msgIndex)) return false; seen.add(m.msgIndex); return true })
      setSearchMatches(deduped)
      setCurrentMatchIndex(deduped.length > 0 ? 0 : -1)
      // Scroll to first match. Search runs over messages currently loaded —
      // pagination means very old messages may not be in memory yet; the user
      // can click "Load earlier messages" before searching to widen the scope.
      if (deduped.length > 0) {
        setTimeout(() => scrollToMatch(0, deduped), 100)
      }
    }, 200)
  }, [messages, scrollToMatch])

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? goToPrevMatch() : goToNextMatch() }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
  }, [goToNextMatch, goToPrevMatch, closeSearch])


  // DOM-based highlighting for assistant messages (avoids fighting ReactMarkdown)
  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return
    // Clear previous highlights
    container.querySelectorAll('mark.search-hl').forEach(mark => {
      const parent = mark.parentNode
      parent.replaceChild(document.createTextNode(mark.textContent), mark)
      parent.normalize()
    })
    if (!searchTerm.trim() || searchMatches.length === 0) return
    const term = searchTerm.toLowerCase()
    searchMatches.forEach((match, matchIdx) => {
      const msgEl = container.querySelector(`[data-msg-index="${match.msgIndex}"]`)
      if (!msgEl) return
      const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_TEXT)
      const textNodes = []
      while (walker.nextNode()) textNodes.push(walker.currentNode)
      let found = false
      for (const node of textNodes) {
        if (found) break
        const nodeText = node.textContent.toLowerCase()
        const idx = nodeText.indexOf(term)
        if (idx === -1) continue
        try {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + searchTerm.length)
          const mark = document.createElement('mark')
          mark.className = matchIdx === currentMatchIndex ? 'search-hl search-hl-active' : 'search-hl'
          range.surroundContents(mark)
          found = true
        } catch { /* surroundContents can fail on split nodes — skip */ }
      }
    })
  }, [searchTerm, searchMatches, currentMatchIndex, messages])

  // Chat search opens via the toolbar button only — Ctrl+F stays as
  // browser-native Find. Escape-to-close is handled inside the search input
  // (handleSearchKeyDown), so it only triggers while the box is focused.

  // Track composer height — drives the model dropdown's bottom offset so it
  // floats above the composer regardless of textarea growth.
  useEffect(() => {
    if (!composerRef.current) return
    const update = () => {
      if (composerRef.current) setComposerHeight(composerRef.current.offsetHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(composerRef.current)
    return () => ro.disconnect()
  }, [])

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      const inPanel = modelDropdownRef.current?.contains(e.target)
      const inTrigger = modelTriggerRef.current?.contains(e.target)
      if (!inPanel && !inTrigger) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const hasApiKey = configuredProviders.includes('anthropic') ||
    configuredProviders.includes('anthropic_oauth') ||
    (user?.credit_balance > 0)

  const selectedModelObj = availableModels.find((m) => m.id === selectedModel) || availableModels[0]

  // Unified resolver for the trigger button: looks up the selected model's
  // {providerId, label} across BOTH `availableModels` AND the dropdown's own
  // sources (NATIVE_BY_PROVIDER hand-curated catalog + byokCatalog). The
  // dropdown pushes items without a providerId and from a different source
  // than `availableModels`, so picking a non-default model previously made
  // the trigger button fall back to the Pabbly favicon and a raw model id
  // label. This memo bridges the two catalogs so the button always renders
  // the correct provider icon and human-readable label.
  const resolvedSelectedModel = useMemo(() => {
    if (useSystemModel) return null
    const fromAvailable = availableModels.find((m) => m.id === selectedModel)
    if (fromAvailable?.providerId) return fromAvailable
    for (const [providerId, models] of Object.entries(NATIVE_BY_PROVIDER || {})) {
      const m = (models || []).find((mm) => mm.id === selectedModel)
      if (m) return { ...m, providerId }
    }
    const fromCatalog = (byokCatalog || []).find((m) => m.id === selectedModel)
    if (fromCatalog) return fromCatalog
    return fromAvailable || null
  }, [useSystemModel, selectedModel, availableModels, byokCatalog])

  // Auto-dismiss "No API key" banner after 5 seconds. Gated on keysLoaded +
  // !chatLoading so we don't start the timer before the banner is eligible to
  // show — otherwise a slow keysAPI would silently dismiss the banner before
  // the user ever sees it.
  useEffect(() => {
    if (!chatLoading && keysLoaded && !hasApiKey && !bannerDismissed) {
      const t = setTimeout(() => setBannerDismissed(true), 5000)
      return () => clearTimeout(t)
    }
  }, [chatLoading, keysLoaded, hasApiKey, bannerDismissed])

  // Track if component is still mounted
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const stoppedRef = useRef(false)

  const handleStop = () => {
    // Mark as stopped FIRST — prevents any queued state updates
    stoppedRef.current = true
    // Abort the SSE reader
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }

    // Cancel the backend task so it stops burning API credits. Backend's
    // cancel path (chat.rs:1820+) persists the FULL partial message with
    // segments + tool_calls + status="partial" — we don't save from the
    // frontend, to avoid racing/duplicating that row.
    // Backend cancel_chat also marks any executing webhook_runs as cancelled
    // in the DB, so Task History polling picks up the cancellation immediately.
    const agentId = agent?.slug || agent?.id
    if (agentId) {
      chatAPI.cancel(agentId).catch(() => {}) // fire and forget
    }

    // If a test_workflow run was initiated from this chat, cancel it too so
    // the Task History panel immediately shows "failed/cancelled" and the
    // inline execution block disappears.
    if (chatInitiatedRunIdRef.current) {
      taskHistoryAPI.cancel(chatInitiatedRunIdRef.current).catch(() => {})
      chatInitiatedRunIdRef.current = null
    }
    // Clear the inline "Running step X of N" execution block
    if (onTrackExecution) onTrackExecution(null)

    // Build a full message from the same refs finalizeMessage uses on the
    // normal `done` path — prior text segments, completed tool calls, AND
    // the trailing text — so nothing that streamed before the stop is lost.
    // Mirrors the logic at the `done` handler below.
    const stripToolBlocks = (text) =>
      (text || '')
        .replace(/```tool_call[\s\S]*?```/g, '')
        .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
        .replace(/```json\s*\n\s*\{\s*"step"\s*:[\s\S]*?```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    // 1. Flush any unflushed trailing text into the segment list
    if (lastTextSegmentRef.current && lastTextSegmentRef.current.trim()) {
      segmentsRef.current = [
        ...segmentsRef.current,
        { type: 'text', content: lastTextSegmentRef.current },
      ]
    }

    // 2. Clean + filter segments, same rules as done-path
    const cleanedSegments = segmentsRef.current
      .map(s => s.type === 'text' ? { ...s, content: stripToolBlocks(s.content) } : s)
      .filter(s => s.type === 'tool' || s.content)

    // 3. Content is either the clean trailing text (if no tools ran) or the
    //    concatenation of all cleaned text segments (for display + search)
    const trailingClean = stripToolBlocks(lastTextSegmentRef.current)
    const textOnlyContent = cleanedSegments
      .filter(s => s.type === 'text')
      .map(s => s.content)
      .join('\n\n')
      .trim()
    const hasTools = cleanedSegments.some(s => s.type === 'tool')
    const baseContent = hasTools ? textOnlyContent : (trailingClean || textOnlyContent)
    const hasAnything = cleanedSegments.length > 0 || baseContent.length > 0

    if (hasAnything) {
      // No "*(stopped)*" marker in content — the `status: 'partial'` badge
      // ("Response was interrupted") handled below the bubble communicates
      // that, and the backend-saved copy won't have this marker either, so
      // keeping them identical avoids a visual flicker on refresh.
      // Force any still-running tool calls to 'done' so the spinning icon stops
      const forceComplete = (t) =>
        t.status === 'running' ? { ...t, status: 'done', result: t.result || '(stopped)' } : t
      const stoppedToolCalls = toolHistoryRef.current.length > 0
        ? toolHistoryRef.current.map(forceComplete)
        : undefined
      const stoppedSegments = hasTools
        ? cleanedSegments.map(s => s.type === 'tool' ? forceComplete(s) : s)
        : undefined

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: baseContent,
        timestamp: new Date().toISOString(),
        status: 'partial',
        toolCalls: stoppedToolCalls,
        segments: stoppedSegments,
      }])
      parseStepActions(baseContent)
    }

    // Cleanup — only after we've captured the state above
    streamingRef.current = ''
    setStreamingText('')
    setIsStreaming(false)
    setToolActivity(null)
    setToolHistory([])
    toolHistoryRef.current = []
    segmentsRef.current = []; setStreamingSegments([])
    lastTextSegmentRef.current = ''
  }

  // Recover last prompt from localStorage on mount (in case of HMR/reload)
  useEffect(() => {
    const saved = localStorage.getItem(`builder_last_prompt_${agent?.id || 'unknown'}`)
    if (saved && !input) {
      // Don't auto-restore into input, but show a recovery banner
      setRecoverablePrompt(saved)
    }
  }, [agent?.id])

  const [recoverablePrompt, setRecoverablePrompt] = useState(null)

  // Retry a failed/partial message — delete it from DB and re-send the user's message
  const handleRetry = async (failedMsg) => {
    const idx = messages.findIndex(m => m === failedMsg)
    const userMsg = idx > 0 ? messages[idx - 1] : null

    // Delete the failed message from DB
    if (failedMsg.id) {
      try {
        await chatAPI.deleteMessage(agent?.slug || agent?.id, failedMsg.id)
      } catch {}
    }

    // Remove both the failed AI message AND the user message from UI (handleSend will re-add the user message)
    const retryContent = userMsg?.role === 'user' ? userMsg.content : null
    setMessages(prev => prev.filter(m => m !== failedMsg && m !== userMsg))

    // Re-send the user's original message automatically
    if (retryContent) {
      setTimeout(() => {
        sendQuickMessage(retryContent)
      }, 100)
    }
  }

  const handleSendRef = useRef(null)

  // Quick send — used by inline action buttons to send option as user message
  const sendQuickMessage = useCallback((text) => {
    if (!text) return
    inputRef.current = text
    if (textareaRef.current) { textareaRef.current.value = text }
    setTimeout(() => { if (handleSendRef.current) handleSendRef.current() }, 0)
  }, [])

  const handleSend = async () => {
    const currentInput = inputRef.current
    if (!currentInput.trim() && attachments.length === 0) return
    // Silent block while a provider/model switch is mid-flight — see
    // persistByokPreference. Send button is disabled in this window so
    // this guard is the keyboard-shortcut backstop. No toast / no banner
    // — UX is "the button just looks disabled for a few seconds".
    if (switchingProvider) return
    track('message_sent', { agent_id: agent?.id })

    // If streaming, stop the current stream and SAVE the partial response so
    // the user can still see what was happening when they interrupted. The
    // partial gets persisted with status="partial" and stays visible in the
    // chat history forever (the user explicitly asked for this — "do not
    // remove it show as it is"). It will NOT be auto-resumed on the next
    // turn though: the apiMessages payload below filters out partial/error
    // messages so the LLM never sees them, breaking the
    // forever-retry-the-same-tool-call loop.
    if (isStreaming) {
      stoppedRef.current = true
      if (abortControllerRef.current) abortControllerRef.current.abort()
      // Tell the backend to stop the in-flight stream immediately so it stops
      // burning API credits.
      const agentSlugForCancel = agent?.slug || agent?.id
      if (agentSlugForCancel) chatAPI.cancel(agentSlugForCancel).catch(() => {})
      // Build the partial message from the FULL streaming state (prior text
      // segments + completed tool calls + trailing text), mirroring the
      // logic in handleStop above. The backend's cancel path persists the
      // same message to DB via chat.rs:1820+ — we do NOT save from the
      // frontend (avoids duplicate rows racing the backend's write).
      const stripToolBlocksImpl = (text) =>
        (text || '')
          .replace(/```tool_call[\s\S]*?```/g, '')
          .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
          .replace(/```json\s*\n\s*\{\s*"step"\s*:[\s\S]*?```/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()

      if (lastTextSegmentRef.current && lastTextSegmentRef.current.trim()) {
        segmentsRef.current = [
          ...segmentsRef.current,
          { type: 'text', content: lastTextSegmentRef.current },
        ]
      }
      const cleanedSegs = segmentsRef.current
        .map(s => s.type === 'text' ? { ...s, content: stripToolBlocksImpl(s.content) } : s)
        .filter(s => s.type === 'tool' || s.content)
      const trailing = stripToolBlocksImpl(lastTextSegmentRef.current)
      const textOnly = cleanedSegs
        .filter(s => s.type === 'text')
        .map(s => s.content)
        .join('\n\n')
        .trim()
      const hadTools = cleanedSegs.some(s => s.type === 'tool')
      const partialContent = hadTools ? textOnly : (trailing || textOnly)
      const hadAnything = cleanedSegs.length > 0 || partialContent.length > 0

      if (hadAnything) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: partialContent,
          timestamp: new Date().toISOString(),
          status: 'partial',
          toolCalls: toolHistoryRef.current.length > 0 ? [...toolHistoryRef.current] : undefined,
          segments: hadTools ? cleanedSegs : undefined,
        }])
      }

      streamingRef.current = ''
      setStreamingText('')
      setIsStreaming(false)
      setToolActivity(null)
      setToolHistory([])
      toolHistoryRef.current = []
      segmentsRef.current = []; setStreamingSegments([])
      lastTextSegmentRef.current = ''
      // Small delay to let state settle before sending new message
      await new Promise(r => setTimeout(r, 100))
    }

    // Reset stopped flag and parsed step tracking for this new message
    stoppedRef.current = false
    parsedStepNamesRef.current = new Set()
    executionTrackingStartedRef.current = false

    // Save prompt to localStorage for recovery
    localStorage.setItem(`builder_last_prompt_${agent?.id || 'unknown'}`, currentInput.trim())

    const currentAttachments = [...attachments]
    // Anthropic/OpenAI reject empty user content. If the user sent only attachments
    // with no text, fall back to a placeholder so the message is never persisted as "".
    // Exception: text-only attachments are inlined into the LLM prompt as
    // <pasted_user_text> blocks — no placeholder needed (and "[attachment]" used to
    // make the model hallucinate a `read_file({path:"attachment"})` tool call).
    const trimmedInput = currentInput.trim()
    const hasOnlyTextAttachments =
      currentAttachments.length > 0 && currentAttachments.every((a) => typeof a.text === 'string')
    const safeContent = trimmedInput
      || (hasOnlyTextAttachments ? '' : (currentAttachments.length > 0 ? '(see attached file)' : ''))
    const userMessage = {
      role: 'user',
      content: safeContent,
      timestamp: new Date().toISOString(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    }
    setMessages((prev) => [...prev, userMessage])
    requestAnimationFrame(() => { chatEndRef.current?.scrollIntoView({ behavior: 'instant' }) })
    // Clear textarea directly (no re-render of parent)
    inputRef.current = ''
    if (textareaRef.current) { textareaRef.current.value = ''; textareaRef.current.style.height = 'auto' }
    setInputVersion(v => v + 1)
    // Drop the persisted draft now that the message is on its way.
    if (draftKey) { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }
    setAttachments([])
    setRecoverablePrompt(null)
    setIsStreaming(true)
    setStreamingText('')
    streamingRef.current = ''
    toolHistoryRef.current = []
    setToolHistory([])
    segmentsRef.current = []; setStreamingSegments([])
    lastTextSegmentRef.current = ''
    setToolActivity(null)
    setActivityDesc('')
    // Clear previous execution when sending a new message
    if (onTrackExecution) onTrackExecution(null)

    // Build the LLM payload from chat history. Partial/error/interrupted
    // assistant messages are EXCLUDED — they remain visible in the chat UI
    // (so the user can still see what was happening when their previous run
    // got interrupted) but the LLM never sees them. Without this filter, the
    // master agent would see an orphan ```tool_call``` fence in a prior turn,
    // think the action was abandoned mid-flight, and emit the SAME tool_call
    // fence on every follow-up message — looping forever on "Refreshing Gmail
    // OAuth Token" no matter what the user typed next ("yes", "do it", "hi"…).
    // The user explicitly asked for "start fresh, no auto-resume" semantics.
    // See plan: buzzing-singing-sparrow.md.
    const apiMessages = [...messages, userMessage]
      .filter((m) => m.status !== 'partial' && m.status !== 'error')
      .map((m) => {
        const msg = { role: m.role, content: m.content }
        // Include persisted R2 image URLs from prior messages so the LLM can
        // "see" images from earlier turns (multi-turn vision). Current-turn
        // images go via apiAttachments below (base64, fastest path).
        if (m.attachments?.length > 0) {
          const urls = m.attachments.filter(a => a.url).map(a => ({ url: a.url, mimeType: a.mime_type || a.mimeType }))
          if (urls.length > 0) msg.attachment_urls = urls
        }
        return msg
      })

    // Build attachments payload for API (base64 without data URL prefix).
    // - Image / PDF attachments have `att.dataUrl` (base64 DataURL) from the
    //   file-picker / paste-image path.
    // - Text paste attachments have `att.text` (raw string) from handlePaste's
    //   long-text branch — encode to base64 on the fly so the backend uploader
    //   can treat them uniformly.
    const apiAttachments = currentAttachments.map((att) => {
      let content
      if (att.dataUrl) {
        content = att.dataUrl.split(',')[1]
      } else if (typeof att.text === 'string') {
        // UTF-8 safe base64 encode
        content = btoa(unescape(encodeURIComponent(att.text)))
      } else {
        return null
      }
      let type = 'image'
      if (att.mimeType === 'application/pdf') type = 'document'
      else if (
        att.mimeType &&
        (att.mimeType.startsWith('text/') ||
          att.mimeType === 'application/json' ||
          att.mimeType === 'application/xml' ||
          att.mimeType === 'application/yaml' ||
          att.mimeType === 'application/x-yaml' ||
          att.mimeType === 'application/x-ndjson')
      ) {
        type = 'text'
      }
      return { type, mimeType: att.mimeType, content }
    }).filter(Boolean)

    // AbortController is ONLY for the explicit Stop button — NOT for navigation.
    // The backend runs the full AI loop independently, so even if user navigates away,
    // the response + files are saved to DB. When user comes back, they'll be loaded.
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const systemPrompt = getMasterAgentPrompt(
        steps,
        collectedCredentials,
        [],
        agent?.instructions || '',
        agent?.webhook_input_schema || null,
        {
          is_deployed: !!agent?.pabbly_functions_id,
          needs_redeploy: !!agent?.needs_redeploy,
          status: agent?.status || 'unknown',
        }
      )
      const token = localStorage.getItem('token')
      const agentId = agent?.slug || agent?.id

      // Auth: prefer Bearer header when localStorage.token exists (Google /
      // dev-login flows), otherwise omit the header entirely so the backend's
      // pabbly_token cookie auth path is used (Pabbly Accounts SSO).
      // CRITICAL: never send `Bearer null` — backend's middleware prefers the
      // Authorization header over the cookie, so a `null` token literal
      // overrides a perfectly valid cookie and fails JWT verification.
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

      // Fire the request — do NOT pass abort signal so the request completes
      // even if the component unmounts. The backend saves to DB independently.
      const response = await fetch(`${API_BASE}/api/workflows/${agentId}/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          messages: apiMessages,
          system_prompt: systemPrompt,
          model: selectedModel,
          // When the user picks "Pabbly AI Model" in the header dropdown, the
          // backend forces the platform path (admin's active_model + platform
          // key) and skips BYOK lookup. When they pick a specific BYOK model,
          // use_platform stays false and the backend uses BYOK as usual.
          use_platform: useSystemModel,
          attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
        }),
        // No signal here — we want the request to complete even on navigation
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || `HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''
      let sseDoneReceived = false
      // SSE event type MUST persist across reader.read() iterations. A single
      // SSE event ("event: X\ndata: ...\n\n") can span multiple TCP chunks
      // when its body is large (e.g. http_request returning a 50 KB+ RSS
      // feed). When that happens, the `event:` line lands in chunk 1 and the
      // `data:` line in chunk N. Re-declaring eventType inside the while loop
      // discarded the type before its matching data line arrived, so the
      // handler ran with eventType=='' and the event was silently dropped —
      // the visible symptom was tool cards stuck on `running` until
      // end-of-stream, when the forceCompleteTool safety net flipped them
      // to `done` with the buffered result. Declare it once, here.
      let eventType = ''

      while (true) {
        // If user clicked Stop, cancel the reader
        if (abortControllerRef.current?.signal?.aborted) {
          reader.cancel()
          break
        }
        // If SSE done event was processed, cancel reader and break immediately
        // (don't wait for HTTP connection to close — UI must clear instantly)
        if (sseDoneReceived) {
          reader.cancel()
          break
        }
        const { done, value } = await reader.read()
        if (done) break
        // If component unmounted (navigation), just let the reader drain silently
        // Backend will save everything to DB independently
        if (!mountedRef.current) {
          reader.cancel()
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        // NOTE: `eventType` is declared outside the while loop above so it
        // persists across reader.read() chunks. SSE blank-line separator (an
        // empty line) is what resets eventType — handled inline below where
        // the `data:` branch sets eventType = '' after dispatch, and the
        // event/data line processing below treats blank lines as benign.
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)

            // Handle error events BEFORE JSON.parse — error data may contain malformed nested JSON.
            // Finalize segmentsRef + toolHistoryRef into ONE persistent assistant message
            // (with a dedicated `error` field) instead of wiping them and appending a bare
            // error bubble. Keeps live UI in sync with what the backend already persists,
            // so live ≡ refresh. (US-10287 follow-up)
            if (eventType === 'error') {
              let errorMsg = 'Something went wrong. Please try again.'
              try {
                const ep = JSON.parse(data)
                errorMsg = ep.error || errorMsg
              } catch {
                const match = data.match(/"error"\s*:\s*"([^"]*)"/)
                if (match) errorMsg = match[1]
                else if (data.length > 0 && data.length < 500) errorMsg = data
              }
              const isCreditsError = errorMsg.includes('Insufficient credits') || errorMsg.includes('credits')

              // 1. Snapshot streaming refs BEFORE clearing them
              const finalSegments = [...segmentsRef.current]
              if (lastTextSegmentRef.current && lastTextSegmentRef.current.trim()) {
                finalSegments.push({ type: 'text', content: lastTextSegmentRef.current })
              }
              const finalContent = streamingRef.current || ''
              const errorBody = isCreditsError
                ? `**Insufficient AI Credits**\n\nYou don't have enough AI Credits to continue. [Purchase more AI Credits](/credits) or add your own API key in Settings.`
                : `**Error:** ${errorMsg}`

              // 2. Append ONE assistant message with everything streamed so far + the error
              setMessages((prev) => [...prev, {
                role: 'assistant',
                content: finalContent,
                segments: finalSegments.length > 0 ? finalSegments : undefined,
                toolCalls: toolHistoryRef.current.length > 0 ? [...toolHistoryRef.current] : undefined,
                timestamp: new Date().toISOString(),
                status: 'error',
                error: errorBody,
                isError: true,
              }])

              // 3. NOW reset refs (after committing them to the message)
              segmentsRef.current = []
              toolHistoryRef.current = []
              lastTextSegmentRef.current = ''
              streamingRef.current = ''
              setStreamingText('')
              setStreamingSegments([])
              setToolHistory([])
              setToolActivity(null)
              setIsStreaming(false)
              eventType = ''
              continue
            }

            try {
              // If user clicked Stop, ignore all further events
              if (stoppedRef.current) continue

              const parsed = JSON.parse(data)

              if (eventType === 'token' && parsed.text) {
                setLiveStatus('')
                accumulated += parsed.text
                lastTextSegmentRef.current += parsed.text
                // streamingRef tracks ONLY the current segment (not full accumulated history)
                // This is reset to '' on each tool_call flush, then rebuilds from new tokens
                streamingRef.current = lastTextSegmentRef.current
                // Direct state update — no smoother, no RAF batching. React 18+ batches automatically.
                setStreamingText(streamingRef.current)
              } else if (eventType === 'tool_call') {
                setLiveStatus('')
                // Flush any accumulated text as a text segment before the tool
                if (lastTextSegmentRef.current.trim()) {
                  // Strip trailing orphan ``` (start of tool_call block that leaked into text)
                  const flushText = lastTextSegmentRef.current
                    .replace(/```\s*$/, '')
                    .replace(/```tool_call[\s\S]*/g, '')
                    .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*/g, '')
                    .replace(/<function_calls>[\s\S]*/g, '')
                    .replace(/<tool_call>[\s\S]*/g, '')
                  if (flushText.trim()) segmentsRef.current = [...segmentsRef.current, { type: 'text', content: flushText }]
                  lastTextSegmentRef.current = ''
                  // Clear streaming text so it doesn't duplicate the segmented content
                  streamingRef.current = ''
                  setStreamingText('')
                }
                // Prefer the canonical tc_id from backend so the matching
                // tool_result event can target THIS exact tool call by id.
                // Falls back to a local id for back-compat with older backends.
                const toolId = parsed.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
                const newTool = { type: 'tool', id: toolId, name: parsed.name, status: 'running', params: parsed.params ? JSON.stringify(parsed.params) : null, result: null }
                segmentsRef.current = [...segmentsRef.current, newTool]
                setStreamingSegments([...segmentsRef.current])
                toolHistoryRef.current = [...toolHistoryRef.current, newTool]
                setToolHistory(toolHistoryRef.current)
                setToolActivity({ id: toolId, name: parsed.name, status: 'running' })
                // Smart activity description using buildToolSummary for all tools
                let smartDesc = null
                if (parsed.params) {
                  const info = buildToolSummary(parsed.name, JSON.stringify(parsed.params), 'running', steps)
                  if (info) smartDesc = info.summary + '...'
                }
                if (!smartDesc) {
                  const toolDesc = TOOL_DESCRIPTIONS[parsed.name]
                  const fallback = extractLastLine(accumulated)
                  const friendly = TOOL_DISPLAY_NAMES[parsed.name]
                  const shortFallback = fallback
                    ? fallback.split(/\s+/).slice(0, 4).join(' ') + '...'
                    : (friendly || parsed.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
                  smartDesc = toolDesc || shortFallback
                }
                setActivityDesc(smartDesc)
              } else if (eventType === 'tool_result') {
                // Match by canonical id (set by backend at tool_start) so
                // parallel calls of the same tool name (e.g. five http_request
                // fetches in one turn) each receive their own result instead
                // of all collapsing onto the first running tool.
                // Name-only fallback preserves back-compat with older backends.
                // Prefer the canonical status the backend computed (`done` /
                // `failed`) — same value persisted to messages.tool_calls[].status,
                // so the live and reload-from-DB renders agree on success/fail
                // visualization. Fall back to 'done' for older backends that
                // didn't include the field.
                const updateTool = (t) =>
                  t.status === 'running' &&
                  (parsed.id ? t.id === parsed.id : t.name === parsed.tool)
                    ? { ...t, status: parsed.status || 'done', result: parsed.result }
                    : t
                toolHistoryRef.current = toolHistoryRef.current.map(updateTool)
                segmentsRef.current = segmentsRef.current.map(s => s.type === 'tool' ? updateTool(s) : s)
                setStreamingSegments([...segmentsRef.current])
                setToolHistory([...toolHistoryRef.current])
                setToolActivity(null)
                // Refresh steps from DB when ANY step-affecting tool completes (Layer C: real-time UI update).
                // Covers create_step, update_step, delete_step, get_agent_status, test_step, test_workflow, set_webhook_schema.
                // Debounced 100ms so back-to-back tool calls don't hammer the API.
                if (STEP_REFRESH_TOOLS.has(parsed.tool) && parsed.result && !parsed.result.startsWith('Error')) {
                  stepRefreshLockRef.current = true // Lock parseStepActions — DB is source of truth
                  const agentId = agent?.slug || agent?.id
                  const toolName = parsed.tool
                  if (agentId) {
                    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
                    refreshDebounceRef.current = setTimeout(() => {
                      import('../../services/api.js').then(({ stepsAPI }) => {
                        stepsAPI.list(agentId).then(res => {
                          const newSteps = (res.data.steps || res.data || []).sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                          if (onStepsRefreshed) onStepsRefreshed(newSteps, toolName)
                          // Lock stays active until 'done' handler releases it after final DB sync
                        }).catch(() => { /* lock stays — 'done' handler will release */ })
                      })
                    }, 100)
                  }
                }
                // Refetch agent after test_workflow — auto-deploy may have
                // cleared needs_redeploy, so the Update button should disappear.
                // Delay 200ms so this fires after the step refresh (100ms debounce).
                if (parsed.tool === 'test_workflow' && parsed.result) {
                  if (onRefreshAgent) setTimeout(() => onRefreshAgent(), 200)
                }
                // Flip the Update button to Active locally after a successful
                // update_workflow — backend already cleared needs_redeploy; no
                // refetch needed, just mirror the state so the UI snaps.
                //
                // Also cancel any pending debounced step-refresh. An earlier
                // create_step/update_step in the same turn scheduled a 100ms
                // refetch that calls onStepsRefreshed with a mutating toolName,
                // which triggers markDirty() and flips needs_redeploy back to
                // true — stomping on the deploy we just confirmed. The refresh
                // isn't needed: deploy just succeeded with the current steps,
                // so steps in memory match what's deployed. The 'done' handler
                // at end-of-stream performs the authoritative final sync.
                if (parsed.tool === 'update_workflow' && parsed.result && !parsed.result.startsWith('Error')) {
                  try {
                    const res = JSON.parse(parsed.result)
                    if (res.status === 'success') {
                      if (refreshDebounceRef.current) {
                        clearTimeout(refreshDebounceRef.current)
                        refreshDebounceRef.current = null
                      }
                      // Pass through pabbly_functions_id + invocation_url so the
                      // parent can populate fields that may have been null in
                      // local state (e.g., when the page loaded before the
                      // background auto-deploy had finished).
                      onWorkflowDeployed?.({
                        pabbly_functions_id: res.pabbly_functions_id,
                        invocation_url: res.invocation_url,
                      })
                    }
                  } catch { /* non-JSON result — ignore */ }
                }
                // Refresh agent when webhook schema is updated
                if (parsed.tool === 'set_webhook_schema' && parsed.result && !parsed.result.startsWith('Error')) {
                  const agentId = agent?.slug || agent?.id
                  if (agentId) {
                    import('../../services/api.js').then(({ workflowsAPI }) => {
                      workflowsAPI.getOne(agentId).then(res => {
                        const updated = res.data
                        if (updated && onInstructionsUpdated) {
                          // Re-set agent state with new webhook_input_schema via parent
                          onWebhookSchemaUpdated?.(updated.webhook_input_schema)
                        }
                      }).catch(() => {})
                    })
                  }
                }
                // Refresh StoredCredentialsCard when credentials change via tool calls
                if ((parsed.tool === 'memory_store' || parsed.tool === 'memory_delete')
                    && parsed.result && !parsed.result.startsWith('Error')) {
                  onCredentialsChanged?.()
                }
                // Refresh the Schedule chip when any schedule tool completes.
                // The reverse-walk over `messages` already picks up tool
                // results at end-of-stream, but PF's update/create response
                // sometimes returns a partial schedule envelope (no `enabled`
                // field) so the chip would render stale "Enabled" after a
                // pause. A direct refetch guarantees the chip mirrors PF's
                // current state regardless of the tool-response shape.
                if (parsed.tool && SCHEDULE_TOOL_NAMES.has(parsed.tool)
                    && parsed.result && !parsed.result.startsWith('Error')) {
                  const id = agent?.slug || agent?.id
                  if (id) {
                    schedulesAPI.getForWorkflow(id).then((res) => {
                      const data = res?.data
                      if (!data) return
                      if (data.exists && data.schedule) {
                        setMountedSchedule({ exists: true, schedule: data.schedule })
                      } else if (data.exists === false) {
                        setMountedSchedule({ exists: false })
                      }
                    }).catch(() => { /* silent */ })
                  }
                }
              } else if (eventType === 'status') {
                try {
                  const parsed = JSON.parse(data)
                  setLiveStatus(parsed.text || '')
                } catch { /* ignore malformed status */ }
              } else if (eventType === 'run_started') {
                try {
                  const parsed = JSON.parse(data)
                  if (parsed.run_id) {
                    chatInitiatedRunIdRef.current = parsed.run_id
                    if (onTrackExecution) onTrackExecution(parsed.run_id)
                  }
                } catch { /* ignore malformed run_started */ }
              } else if (eventType === 'done') {
                // Clear tool spinner on stream completion
                setLiveStatus('')
                setToolActivity(null)

                // Safety net: force any remaining 'running' tools to 'done'
                // (handles cases where tool_result SSE was missed or failed to parse)
                const forceCompleteTool = (t) =>
                  t.status === 'running' ? { ...t, status: 'done', result: t.result || '(result not received)' } : t
                toolHistoryRef.current = toolHistoryRef.current.map(forceCompleteTool)
                segmentsRef.current = segmentsRef.current.map(s => s.type === 'tool' ? forceCompleteTool(s) : s)

                const rawFinalContent = parsed.content || accumulated
                // Extract inline action blocks (:::action ... :::)
                const { cleaned: finalContent, actions: inlineActions } = extractActions(rawFinalContent)
                if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }

                // Detect created files
                const createdFiles = extractFileNames(finalContent)

                // Build final segments: strip tool_call blocks from text segments,
                // then append the clean final content as the last text segment
                const stripToolBlocks = (text) =>
                  text
                    .replace(/```tool_call[\s\S]*?```/g, '')
                    .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
                    .replace(/```json\s*\n\s*\{\s*"step"\s*:[\s\S]*?```/g, '')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim()

                let finalSegments = undefined
                if (segmentsRef.current.length > 0) {
                  // Clean intermediate text segments (remove tool_call blocks)
                  // Flush any remaining text that came after the last tool call
                  if (lastTextSegmentRef.current.trim()) {
                    segmentsRef.current.push({ type: 'text', content: lastTextSegmentRef.current })
                  }
                  const cleaned = segmentsRef.current
                    .map(s => s.type === 'text' ? { ...s, content: stripToolBlocks(s.content) } : s)
                    .filter(s => s.type === 'tool' || s.content) // drop empty text segments
                  // Only use segments if there were tool calls (otherwise just render as plain text)
                  if (cleaned.some(s => s.type === 'tool')) {
                    finalSegments = cleaned
                  }
                }
                lastTextSegmentRef.current = ''
                const finalToolCalls = toolHistoryRef.current.length > 0 ? [...toolHistoryRef.current] : undefined
                const doneUsage = parsed.usage?.credits_used != null ? parsed.usage : undefined

                // Server tells us the R2 URLs it assigned to this turn's
                // attachments so follow-up turns can replay them — without
                // this, the local user message keeps its raw { text, preview }
                // fields forever and the apiMessages builder drops it
                // (filter(a => a.url) is empty), causing the LLM to lose the
                // attachment on every subsequent turn in the same session.
                const doneUserAttachmentUrls = Array.isArray(parsed.user_attachment_urls)
                  ? parsed.user_attachment_urls
                  : []

                // Don't immediately swap — let typing animation finish first
                const finalizeMessage = () => {
                  setMessages((prev) => {
                    // Patch the most recent user message with the server-
                    // assigned URLs. We walk the array in reverse and stop at
                    // the first user message; if it already has URLs (e.g.
                    // this is a history-loaded message, somehow replaying)
                    // we leave it alone to avoid clobbering good data.
                    let patched = prev
                    if (doneUserAttachmentUrls.length > 0) {
                      for (let i = prev.length - 1; i >= 0; i--) {
                        if (prev[i].role !== 'user') continue
                        const existing = prev[i].attachments || []
                        // Pair each existing attachment (index-preserving)
                        // with its URL record; if the user had more local
                        // attachments than the server uploaded (rare — only
                        // when R2 upload failed for one), leave the unpaired
                        // ones untouched rather than dropping them.
                        const merged = existing.map((att, idx) => {
                          const rec = doneUserAttachmentUrls[idx]
                          if (!rec || att.url) return att
                          return { ...att, url: rec.url, mime_type: rec.mime_type }
                        })
                        patched = [...prev]
                        patched[i] = { ...prev[i], attachments: merged }
                        break
                      }
                    }
                    return [...patched, {
                      role: 'assistant',
                      content: finalContent,
                      timestamp: new Date().toISOString(),
                      createdFiles: createdFiles.length > 0 ? createdFiles : undefined,
                      toolCalls: finalToolCalls,
                      segments: finalSegments,
                      actions: inlineActions.length > 0 ? inlineActions : undefined,
                      usage: doneUsage,
                    }]
                  })
                  // Update TopBar credit balance in real-time
                  if (doneUsage?.balance_after != null && user) {
                    updateUser({ ...user, credit_balance: Math.round(doneUsage.balance_after * 1_000) })
                  }
                  toolHistoryRef.current = []
                  setToolHistory([])
                  segmentsRef.current = []; setStreamingSegments([])
                  lastTextSegmentRef.current = ''
                  parseStepActions(finalContent)
                  setStreamingText('')
                  streamingRef.current = ''
                  setIsStreaming(false)
                  setToolActivity(null)
                  pendingFinalizeRef.current = null
                }
                // ALWAYS finalize immediately on done event — never wait for smoother.
                // The smoother is purely visual; finalization handles state cleanup.
                finalizeMessage()
                // Signal outer loop to break — don't wait for HTTP connection close
                sseDoneReceived = true

                // Refresh the credit pill — the chat turn just deducted credits,
                // and any test_workflow tool calls fired inside this turn have
                // also written their callbacks by now (debounced 250ms inside
                // the helper to coalesce with concurrent triggers).
                refetchCreditSummary()

                // Final safety: always sync steps from DB on stream completion.
                // Only mark dirty if a mutating tool ran AND no dirty-clearing tool
                // (test_workflow auto-deploy, or update_workflow explicit deploy) ran
                // after it. Otherwise markDirty would re-stamp needs_redeploy=true on
                // top of a freshly-cleared state and leave the Update button stuck.
                const doneAgentId = agent?.slug || agent?.id
                const history = toolHistoryRef.current
                const isDirtyClearer = (name) => name === 'test_workflow' || name === 'update_workflow'
                const lastMutatingIdx = history.map((t, i) => STEP_MUTATING_TOOLS.has(t.name) && t.status === 'done' ? i : -1).filter(i => i >= 0).pop() ?? -1
                const lastClearerIdx = history.map((t, i) => isDirtyClearer(t.name) && t.status === 'done' ? i : -1).filter(i => i >= 0).pop() ?? -1
                const lastMutatingTool = (lastMutatingIdx >= 0 && lastMutatingIdx > lastClearerIdx)
                  ? history[lastMutatingIdx].name
                  : '__none__'
                if (doneAgentId) {
                  import('../../services/api.js').then(({ stepsAPI }) => {
                    stepsAPI.list(doneAgentId).then(res => {
                      const freshSteps = (res.data.steps || res.data || []).sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                      if (onStepsRefreshed) onStepsRefreshed(freshSteps, lastMutatingTool)
                      stepRefreshLockRef.current = false
                    }).catch(() => { stepRefreshLockRef.current = false })
                  })
                }
              }
              // error events are handled above before JSON.parse
            } catch (parseErr) {
              console.warn('[SSE] Failed to parse', eventType, 'event:', parseErr.message, data?.slice(0, 200))
            }
            eventType = ''
          }
          // After SSE done, stop processing remaining lines and break outer loop ASAP
          if (sseDoneReceived) break
        }
        if (sseDoneReceived) break
      }
    } catch (err) {
      if (typeof parseInterval !== 'undefined') clearInterval(parseInterval)
      if (err.name === 'AbortError' || !mountedRef.current) {
        // User navigated away or clicked Stop — backend continues in background
        return
      }
      if (mountedRef.current) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `**Error:** ${err.message || 'Stream failed'}`,
          timestamp: new Date().toISOString(),
          isError: true,
        }])
        setStreamingText('')
      }
    } finally {
      // ALWAYS clear streaming state — the smoother is purely visual, state must release immediately
      if (mountedRef.current) {
        setIsStreaming(false)
        setToolActivity(null)
        pendingFinalizeRef.current = null
      }
      stepRefreshLockRef.current = false // Safety: always release lock on stream end
      abortControllerRef.current = null
    }
  }

  handleSendRef.current = handleSend

  // Parse step actions + files from response — robust, handles AI formatting variations
  const parseStepActions = (content) => {
    if (!content) return

    // === 1. Parse JSON blocks (steps, step_updates) ===
    // Flexible: handles ```json, ``` json, extra spaces, no trailing newline, etc.
    const jsonMatches = [...content.matchAll(/```\s*json?\s*\n?([\s\S]*?)\n?\s*```/gi)]

    // Fallback: also look for raw JSON objects with "step" key outside code blocks
    const rawJsonMatches = [...content.matchAll(/\{\s*"(?:step|steps|step_update)"[\s\S]*?\n\}/g)]

    const allJsonCandidates = [
      ...jsonMatches.map((m) => m[1]),
      ...rawJsonMatches.map((m) => m[0]),
    ]

    // clear_agent JSON block is DEPRECATED — the Master Agent prompt now
    // directs the model to call delete_step per step for any "clear all" /
    // "start fresh" request. We intentionally do not act on {"clear_agent":
    // true} here anymore: silently resetting + reloading the page was a bad
    // UX (context lost, history gone) and hid the fact that the model had
    // skipped the real tool calls. If the model regresses and emits the JSON
    // anyway, the steps simply stay visible and the bug is obvious —
    // exactly the behavior we want so we can iterate on the prompt.

    if (stepRefreshLockRef.current) return // DB is source of truth — don't overwrite with parsed data

    for (const jsonStr of allJsonCandidates) {
      try {
        const parsed = JSON.parse(jsonStr.trim())

        // Handle agent_instructions — save overall agent purpose
        if (parsed.agent_instructions && typeof parsed.agent_instructions === 'string' && onInstructionsUpdated) {
          onInstructionsUpdated(parsed.agent_instructions)
          continue
        }

        // clear_agent is deprecated — see comment above. Ignore silently if
        // the model regresses and emits it.
        if (parsed.clear_agent === true) continue

        // Only skip JSON blocks that have an ID when a step-affecting tool already handled the change.
        // Uses the same STEP_REFRESH_TOOLS set as the live-refresh whitelist (Layer C2) so any tool
        // that would have triggered a DB resync also suppresses the JSON-block fallback parser.
        const usedModifyTools = toolHistoryRef.current.some(t =>
          STEP_REFRESH_TOOLS.has(t.name) && t.status === 'done'
        )

        const addStep = (s) => {
          // Skip JSON blocks with an ID when update_step/delete_step already handled it
          if (s.id && usedModifyTools) {
            console.debug('[parseStepActions] Skipping JSON update block — tool already handled:', s.id)
            return
          }
          const stepName = s.name || 'Unnamed Step'
          // Skip if we already parsed this step in the current message (dedup by id or name)
          const dedupKey = s.id || stepName
          if (parsedStepNamesRef.current.has(dedupKey)) return
          parsedStepNamesRef.current.add(dedupKey)
          onStepAdded({
            ...(s.id ? { id: s.id } : {}),  // pass ID when updating existing step
            name: stepName,
            description: s.description || '',
            step_type: s.type || s.step_type || 'ai',
            status: s.status || 'proposed',
            llm_model: s.llm_model || 'claude-sonnet-4-6',
            system_prompt: s.system_prompt || '',
            tools: s.tools || [],
            max_tool_calls: s.max_tool_calls ?? 10,
            ...(s.code_body ? { code_body: s.code_body } : {}),
            ...(s.order != null ? { order: s.order } : {}),
          })
        }

        if (parsed.step?.name) {
          addStep(parsed.step)
          // Track credentials if they have values
          if (parsed.step.credentials_needed) {
            parsed.step.credentials_needed.forEach((c) => {
              if (c.value && onCredentialCollected) {
                onCredentialCollected(c.key, c.value)
              }
            })
          }
        }
        if (parsed.step_update?.name) {
          onStepUpdated(parsed.step_update.name, { status: parsed.step_update.status || 'verified' })
        }
        if (Array.isArray(parsed.steps)) parsed.steps.forEach(addStep)
        // Handle step reordering
        if (Array.isArray(parsed.step_reorder) && onStepReorder) {
          onStepReorder(parsed.step_reorder)
        }
        // clear_agent already handled by the pre-scan above (page reloads).
      } catch (e) {
        console.debug('Step parse skip:', e.message, jsonStr.slice(0, 100))
      }
    }

  }

  // Extract file names from AI response for display badges
  const extractFileNames = (content) => {
    if (!content) return []
    const names = new Set()
    // 4-backtick with filename
    for (const m of content.matchAll(/````[a-z]*\s*filename\s*=\s*["']?([^\s"']+)["']?/gi)) names.add(m[1])
    // 4-backtick as tag
    for (const m of content.matchAll(/````(\w+\.(?:rs|md|toml|sh|json|yaml|yml))/gi)) names.add(m[1])
    // 3-backtick with filename
    for (const m of content.matchAll(/```[a-z]*\s*filename\s*=\s*["']?([^\s"']+)["']?/gi)) names.add(m[1])
    // 3-backtick as tag
    for (const m of content.matchAll(/```(\w+\.(?:rs|md|toml|sh|json|yaml|yml))/gi)) names.add(m[1])
    // Context patterns: ### soul.md, **main.rs**, `config.md`:
    for (const m of content.matchAll(/(?:^|\n)(?:#{1,4}\s+|[*_]{1,2})?`?(\w[\w.-]*\.(?:rs|md|toml|sh|json|yaml|yml))`?[*_]{0,2}\s*:?\s*\n```/gi)) names.add(m[1])
    return [...names]
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Voice-to-text: SpeechRecognition with persistent transcript
  // Key fix: transcript stored in ref AND localStorage so it survives tab switches
  const voiceTranscriptRef = useRef('')
  const voiceActiveRef = useRef(false)

  const toggleVoiceInput = () => {
    if (isListening) {
      // Stop
      voiceActiveRef.current = false
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setIsListening(false)
      // Ensure final text is in input
      if (voiceTranscriptRef.current) {
        setInput(voiceTranscriptRef.current)
      }
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported. Use Chrome or Edge.')
      return
    }

    // Preserve any existing text in the input
    voiceTranscriptRef.current = input || ''
    voiceActiveRef.current = true
    setIsListening(true)
    startRecognition()
  }

  const startRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition || !voiceActiveRef.current) return

    // Stop any existing instance first
    try { recognitionRef.current?.stop() } catch {}

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      // Always read the CURRENT saved transcript from ref (not a stale closure)
      let final = voiceTranscriptRef.current
      let interim = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += (final ? ' ' : '') + text
          voiceTranscriptRef.current = final
          // Also save to localStorage so it survives tab switching
          localStorage.setItem('voice_transcript_temp', final)
        } else {
          interim = text
        }
      }
      setInput(final + (interim ? ' ' + interim : ''))
    }

    recognition.onend = () => {
      // Auto-restart if voice is still active
      if (voiceActiveRef.current) {
        // Recover transcript from localStorage in case state was lost
        const saved = localStorage.getItem('voice_transcript_temp')
        if (saved && !voiceTranscriptRef.current) {
          voiceTranscriptRef.current = saved
        }
        setTimeout(() => {
          if (voiceActiveRef.current) startRecognition()
        }, 300)
      }
    }

    recognition.onerror = (e) => {
      // These errors are normal during tab switches — just let onend handle restart
      if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network') return
      // Real error — stop
      voiceActiveRef.current = false
      setIsListening(false)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      // Already started or mic busy — retry after delay
      setTimeout(() => {
        if (voiceActiveRef.current) {
          try { recognition.start() } catch {}
        }
      }, 500)
    }
  }

  // When tab becomes visible again, restart recognition and restore transcript
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && voiceActiveRef.current) {
        // Restore transcript from localStorage
        const saved = localStorage.getItem('voice_transcript_temp')
        if (saved) {
          voiceTranscriptRef.current = saved
          setInput(saved)
        }
        // Restart recognition
        setTimeout(() => startRecognition(), 200)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      voiceActiveRef.current = false
      try { recognitionRef.current?.stop() } catch {}
      localStorage.removeItem('voice_transcript_temp')
    }
  }, [])

  // Compress image using Canvas — max 1600px, JPEG 0.7 quality
  const compressImage = (file) => {
    return new Promise((resolve) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const MAX_DIM = 1600
        let { width, height } = img
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        // Use JPEG for photos (smaller), PNG for screenshots with text
        const outputType = file.type === 'image/png' && file.size < 500 * 1024 ? 'image/png' : 'image/jpeg'
        const quality = outputType === 'image/jpeg' ? 0.7 : undefined
        const dataUrl = canvas.toDataURL(outputType, quality)
        resolve({ dataUrl, mimeType: outputType, width, height })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        // Fallback: read as-is
        const reader = new FileReader()
        reader.onload = () => resolve({ dataUrl: reader.result, mimeType: file.type })
        reader.readAsDataURL(file)
      }
      img.src = url
    })
  }

  // Image attachment handlers
  // 3.5MB raw = ~4.7MB base64. Keep under 5MB base64 for Claude API.
  const MAX_RAW_SIZE = 3.5 * 1024 * 1024

  // Image and PDF are inline-rendered in chat. Tier 1 structured-text MIMEs
  // (JSON / CSV / Markdown / XML / YAML / TSV / NDJSON) are accepted and flow
  // through the same multi-turn replay pipeline as pasted text — backend
  // mirror in `r2.rs::is_allowed_chat_mime`. SVG is intentionally NOT here:
  // an `image/svg+xml` upload could carry inline scripts that execute on the
  // signed-URL origin, so the backend rejects it too.
  const ALLOWED_EXACT_MIMES = new Set([
    'application/pdf',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
    'application/x-ndjson',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/xml',
    'text/yaml',
    'text/tab-separated-values',
  ])
  const SAFE_IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
  ])
  const isAllowedFile = (type) =>
    SAFE_IMAGE_MIMES.has(type) || ALLOWED_EXACT_MIMES.has(type)
  const isPdf = (type) => type === 'application/pdf'
  const isStructuredTextMime = (type) =>
    type !== 'application/pdf' && ALLOWED_EXACT_MIMES.has(type)

  // Browsers don't always populate `file.type` from the OS — Windows in
  // particular returns an empty string for unregistered extensions (.md is
  // the common one; .ndjson, .yaml, .tsv often hit the same case). Without a
  // fallback, those files would be silently rejected even though they're on
  // the allowlist. Map the most common extensions for our allowed types here
  // so the rest of the flow can rely on a non-empty MIME.
  const inferMimeFromName = (name) => {
    if (!name) return ''
    const ext = name.toLowerCase().split('.').pop() || ''
    switch (ext) {
      case 'json': return 'application/json'
      case 'ndjson': case 'jsonl': return 'application/x-ndjson'
      case 'csv': return 'text/csv'
      case 'md': case 'markdown': return 'text/markdown'
      case 'xml': return 'text/xml'
      case 'yaml': case 'yml': return 'text/yaml'
      case 'tsv': return 'text/tab-separated-values'
      case 'txt': case 'log': return 'text/plain'
      case 'pdf': return 'application/pdf'
      case 'png': return 'image/png'
      case 'jpg': case 'jpeg': return 'image/jpeg'
      case 'gif': return 'image/gif'
      case 'webp': return 'image/webp'
      default: return ''
    }
  }

  const addFilesAsAttachments = async (files) => {
    for (const file of files) {
      // Resolve the MIME once, falling back to extension inference if the
      // browser returned an empty string (Windows + .md is the canonical case).
      const mime = isAllowedFile(file.type)
        ? file.type
        : inferMimeFromName(file.name)
      if (!isAllowedFile(mime)) {
        // Previously a silent `continue` — users got no feedback when they
        // picked an Excel/zip/docx file, just nothing happened. Surface the
        // rejection with a per-file toast so the failure mode is visible.
        toast.error(
          `${file.name || 'File'} not supported. Try image, PDF, JSON, CSV, MD, XML, YAML, or TSV.`
        )
        continue
      }

      // PDFs: read as base64 directly (no compression), max 20MB
      if (isPdf(mime)) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error('PDF must be under 20MB')
          continue
        }
        const reader = new FileReader()
        reader.addEventListener('load', () => {
          setAttachments((prev) => [...prev, {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            dataUrl: reader.result,
            mimeType: mime,
            name: file.name,
          }])
        })
        reader.readAsDataURL(file)
        continue
      }

      // Structured text files (JSON / CSV / Markdown / XML / YAML / TSV /
      // NDJSON): read as UTF-8 string and follow the same `text` + `preview`
      // shape as paste-text attachments so the existing card preview + multi-
      // turn replay path (`enrich_prior_text_attachments`) handle them
      // identically. Backend cap mirror is `r2.rs::is_structured_text_mime`
      // (256 KB).
      if (isStructuredTextMime(mime)) {
        if (file.size > 256 * 1024) {
          toast.error(`${file.name || 'File'} must be under 256 KB`)
          continue
        }
        const reader = new FileReader()
        reader.addEventListener('load', () => {
          const txt = typeof reader.result === 'string' ? reader.result : ''
          if (!txt) {
            toast.error('Could not read file contents')
            return
          }
          setAttachments((prev) => [...prev, {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            text: txt,
            preview: txt.slice(0, 220),
            mimeType: mime,
            name: file.name,
          }])
        })
        reader.addEventListener('error', () => {
          toast.error('Could not read file contents')
        })
        reader.readAsText(file)
        continue
      }

      // Images: existing flow
      if (file.size > 50 * 1024 * 1024) {
        toast.error('Image must be under 50MB')
        continue
      }

      // Small images (< 3.5MB raw ≈ < 5MB base64) — send as-is
      if (file.size <= MAX_RAW_SIZE) {
        const reader = new FileReader()
        reader.addEventListener('load', () => {
          setAttachments((prev) => [...prev, {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            dataUrl: reader.result,
            mimeType: mime,
            name: file.name,
          }])
        })
        reader.readAsDataURL(file)
        continue
      }

      // Large images (> 3.5MB) — compress to fit
      try {
        const { dataUrl, mimeType } = await compressImage(file)
        const base64Size = Math.round(dataUrl.length * 0.75)
        if (base64Size > 5 * 1024 * 1024) {
          toast.error(`Image too large after compression (${(base64Size / 1024 / 1024).toFixed(1)}MB). Try a smaller image.`)
          continue
        }
        setAttachments((prev) => [...prev, {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dataUrl,
          mimeType,
          name: file.name,
        }])
      } catch {
        toast.error('Failed to process image. Try a different format.')
      }
    }
  }

  const handleFileSelect = (e) => {
    if (e.target.files?.length) {
      addFilesAsAttachments(e.target.files)
      e.target.value = '' // reset so same file can be re-selected
    }
  }

  // Threshold for converting a text paste into a "Pasted text" attachment card
  // instead of dumping it into the textarea. 2000 chars sits at the industry
  // median (Claude.ai ~2k, ChatGPT ~1.5–2.5k) — small JSON samples and code
  // snippets stay inline, only large reference material becomes an attachment.
  const PASTE_AS_CARD_MIN_CHARS = 2000
  // Per-attachment ceiling. Above this we refuse the paste entirely — the LLM
  // context budget can't absorb a single multi-hundred-KB blob without crowding
  // out chat history. Backend enforces the same cap in r2::upload_chat_image.
  const PASTE_AS_CARD_MAX_CHARS = 40000

  const handlePaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    // 1. Image / PDF / structured-text FILE pastes → file-attachment path.
    //    Critical: filter on `kind === 'file'` BEFORE checking the MIME. A
    //    plain-text typed paste shows up as a `kind: 'string', type: 'text/plain'`
    //    item — and `text/plain` is now on the allowlist (for the structured-text
    //    upload path). Without the kind check we'd accept the string item, call
    //    `getAsFile()` which returns null for strings, push null into pastedFiles,
    //    then crash on `file.type` inside addFilesAsAttachments. The long-text
    //    paste-card branch below (step 2) handles typed text via getData(), not
    //    via this file-pump path.
    const pastedFiles = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || item.kind !== 'file') continue
      if (!isAllowedFile(item.type)) continue
      const f = item.getAsFile()
      if (f) pastedFiles.push(f)
    }
    if (pastedFiles.length > 0) {
      e.preventDefault()
      addFilesAsAttachments(pastedFiles)
      return
    }
    // 2. Long text paste → convert to a "Pasted text" attachment card
    const text = e.clipboardData.getData('text/plain')
    if (text && text.length >= PASTE_AS_CARD_MIN_CHARS) {
      e.preventDefault()
      if (text.length > PASTE_AS_CARD_MAX_CHARS) {
        toast.error(
          `Paste is ${text.length.toLocaleString()} chars. Max is ${PASTE_AS_CARD_MAX_CHARS.toLocaleString()} (~13 pages). Split it across multiple pastes or upload as a .txt file.`
        )
        return
      }
      const lineCount = text.split('\n').length
      const id = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setAttachments((prev) => [
        ...prev,
        {
          id,
          mimeType: 'text/plain',
          name: `Pasted text — ${lineCount} line${lineCount === 1 ? '' : 's'}`,
          text,
          // Small head preview rendered on the card face
          preview: text.slice(0, 220),
        },
      ])
    }
  }

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Chat header — model dropdown trigger now lives in the composer (left
          of textarea); the dropdown body is anchored to this root via
          `sm:absolute sm:bottom-[88px] sm:left-3` so it pops up above the
          composer regardless of where the trigger sits.
          Webhook menu stays desktop-only (multi-line copy actions don't fit on phones).
          Agent name is NOT repeated here — it's already in the TopBar. */}
      <div className={`flex sm:pt-2.5 sm:pb-1 items-center gap-1.5 flex-shrink-0 sm:border-b-0 h-0 sm:h-auto overflow-visible min-w-0 ${compact ? 'px-1.5 sm:px-1.5' : 'px-3'}`}>

        {/* Webhook menu — only shown when the agent is deployed (has invocation_url).
            Click opens a dropdown with two copy options:
              1. Copy URL    → just the invoke URL
              2. Copy cURL   → full Postman-compatible curl with sample body */}
        {webhookUrl && agent?.pabbly_functions_id && (
          <div className={`relative hidden sm:block min-w-0 ${compact ? 'sm:hidden' : ''}`} ref={webhookMenuRef}>
            <Tooltip content="Copy webhook URL or cURL">
            <button
              onClick={() => setShowWebhookMenu(!showWebhookMenu)}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors border text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 border-primary-200/60 dark:border-primary-900/40 bg-white dark:bg-[#2c2c2c] hover:bg-primary-50 dark:hover:bg-[#1a3030]"
              aria-label="Webhook menu"
              aria-haspopup="menu"
              aria-expanded={showWebhookMenu}
            >
              <Webhook size={14} />
            </button>
            </Tooltip>

            {showWebhookMenu && (
              <div className="absolute left-0 top-full mt-1.5 w-[370px] bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-xl shadow-lg z-50 animate-fade-in overflow-hidden">
                {/* ── URL Section ── */}
                <div className="px-3.5 pt-3 pb-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Tooltip content="HTTP method — send a POST request with a JSON body to trigger the workflow">
                        <span className="text-[9px] font-bold text-white bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-800 px-1.5 py-0.5 rounded cursor-default">POST</span>
                      </Tooltip>
                      <Tooltip content="The public webhook URL that triggers this workflow when called from external services (Pabbly Connect, cron jobs, custom apps, etc.)">
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 cursor-default">Invoke URL</span>
                      </Tooltip>
                    </div>
                    <Tooltip content={webhookCopiedKind === 'url' ? 'URL copied to clipboard' : 'Copy the Invoke URL to your clipboard'} position="left">
                      <button
                        onClick={async () => {
                          await copyToClipboard(webhookUrl)
                          setWebhookCopiedKind('url')
                          setTimeout(() => setWebhookCopiedKind(k => k === 'url' ? null : k), 2000)
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                          webhookCopiedKind === 'url'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-[#484848]'
                        }`}
                      >
                        {webhookCopiedKind === 'url' ? <Check size={11} /> : <Copy size={11} />}
                        {webhookCopiedKind === 'url' ? 'Copied' : 'Copy'}
                      </button>
                    </Tooltip>
                  </div>
                  <div className="bg-neutral-50 dark:bg-[#383838] rounded-md px-2.5 py-2 border border-neutral-100 dark:border-[#484848] select-all">
                    {(() => {
                      try {
                        const u = new URL(webhookUrl)
                        return (
                          <code className="text-[10.5px] font-mono leading-relaxed block break-all">
                            <span className="text-neutral-400 dark:text-neutral-500">{u.protocol}//</span>
                            <span className="text-neutral-800 dark:text-neutral-100 font-semibold">{u.host}</span>
                            <span className="text-primary-600 dark:text-primary-400">{u.pathname}</span>
                          </code>
                        )
                      } catch {
                        return <code className="text-[10.5px] font-mono text-neutral-700 dark:text-neutral-200 break-all leading-relaxed">{webhookUrl}</code>
                      }
                    })()}
                  </div>
                </div>

                <div className="border-t border-neutral-100 dark:border-[#484848]" />

                {/* ── cURL Section ── */}
                <div className="px-3.5 pt-2.5 pb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Tooltip content="Ready-to-run cURL command with a sample JSON body — paste into a terminal or Postman to test the webhook">
                        <Terminal size={12} className="text-neutral-400 dark:text-neutral-500 cursor-default" />
                      </Tooltip>
                      <Tooltip content="Ready-to-run cURL command with a sample JSON body — paste into a terminal or Postman to test the webhook">
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 cursor-default">cURL Command</span>
                      </Tooltip>
                    </div>
                    <Tooltip content={webhookCopiedKind === 'curl' ? 'cURL command copied to clipboard' : 'Copy the full cURL command to your clipboard'} position="left">
                      <button
                        onClick={async () => {
                          const curl = buildPostmanCurl(webhookUrl)
                          await copyToClipboard(curl)
                          setWebhookCopiedKind('curl')
                          setTimeout(() => setWebhookCopiedKind(k => k === 'curl' ? null : k), 2000)
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                          webhookCopiedKind === 'curl'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-[#484848]'
                        }`}
                      >
                        {webhookCopiedKind === 'curl' ? <Check size={11} /> : <Copy size={11} />}
                        {webhookCopiedKind === 'curl' ? 'Copied' : 'Copy'}
                      </button>
                    </Tooltip>
                  </div>
                  <div className="bg-neutral-50 dark:bg-[#383838] rounded-md border border-neutral-100 dark:border-[#484848] overflow-hidden">
                    <pre className="px-2.5 py-2 text-[10.5px] font-mono leading-[1.7] max-h-[200px] overflow-y-auto select-all whitespace-pre-wrap break-all">{(() => {
                      const sample = { invoked_by: { name: user?.name || '', email: user?.email || '' } }
                      if (Array.isArray(agent?.webhook_input_schema) && agent.webhook_input_schema.length > 0) {
                        agent.webhook_input_schema.forEach(f => { const k = f?.name || f?.field; if (k) sample[k] = f.example ?? '' })
                      } else {
                        sample.message = 'your input here'
                      }
                      const body = JSON.stringify(sample, null, 2)
                      return (<><span className="text-primary-600 dark:text-primary-400 font-semibold">curl</span><span className="text-neutral-500 dark:text-neutral-400"> --location </span><span className="text-primary-700 dark:text-primary-400">'{webhookUrl}'</span><span className="text-neutral-400 dark:text-neutral-600"> \</span>{'\n'}<span className="text-neutral-500 dark:text-neutral-400">  --header </span><span className="text-primary-700 dark:text-primary-400">'Content-Type: application/json'</span><span className="text-neutral-400 dark:text-neutral-600"> \</span>{'\n'}<span className="text-neutral-500 dark:text-neutral-400">  --data </span><span className="text-primary-700 dark:text-primary-400">'</span>{'\n'}<span className="text-primary-700 dark:text-primary-400">{body}</span>{'\n'}<span className="text-primary-700 dark:text-primary-400">'</span></>)
                    })()}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Schedule chip — sibling to the Webhook chip, only renders when
            `scheduleState.exists === true` (derived from the chat tool-call
            log via useMemo). Click opens a popup with cron + timezone +
            next run + status. No extra API call — state lives in chat
            history; a page refresh re-derives it after getHistory loads. */}
        {scheduleState?.exists && scheduleState.schedule && (
          <div className="relative hidden sm:block min-w-0" ref={scheduleMenuRef}>
            <Tooltip content={
              scheduleState.schedule.paused_reason ? 'Schedule is paused — click to view cron, timezone, and next run details'
              : scheduleState.schedule.enabled === false ? 'Schedule is disabled — click to view details'
              : 'Workflow is on a cron schedule — click to view cron, timezone, and next run details'
            }>
              <button
                onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                className={`flex items-center gap-2 px-2.5 h-8 rounded-lg text-[12.5px] font-medium transition-colors border bg-white dark:bg-[#2c2c2c] ${
                  scheduleState.schedule.paused_reason
                    ? 'text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-900/40 hover:bg-amber-50 dark:hover:bg-[#3a3024]'
                    : scheduleState.schedule.enabled === false
                    ? 'text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-[#484848] hover:bg-neutral-100 dark:hover:bg-[#383838]'
                    : 'text-blue-600 dark:text-blue-400 border-blue-200/60 dark:border-blue-900/40 hover:bg-blue-50 dark:hover:bg-[#1a2638]'
                }`}
                aria-label="Schedule menu"
                aria-haspopup="menu"
                aria-expanded={showScheduleMenu}
              >
                <CalendarClock size={14} />
                {!compact && (
                  <span className="font-semibold truncate">
                    {scheduleState.schedule.paused_reason ? 'Paused' :
                     scheduleState.schedule.enabled === false ? 'Disabled' :
                     'Scheduled'}
                  </span>
                )}
                {!compact && <ChevronDown size={14} className={`transition-transform flex-shrink-0 text-current opacity-60 ${showScheduleMenu ? 'rotate-180' : ''}`} />}
              </button>
            </Tooltip>

            {showScheduleMenu && (() => {
              // Resolve common fields off the schedule with safe fallbacks.
              const sch = scheduleState.schedule || {}
              const cron = sch.cron_expression || ''
              const tz = sch.timezone || 'UTC'
              // Suppress next_run_at when the schedule isn't active — PF
              // keeps the last-computed value on disabled/paused rows, but
              // showing it reads as a missed run instead of "no upcoming
              // run scheduled".
              const isActiveStatus = !sch.paused_reason && sch.enabled !== false
              const nextRun = isActiveStatus ? sch.next_run_at : null
              const lastRun = sch.last_run_at
              const lastStatus = sch.last_run_status
              const isPaused = !!sch.paused_reason
              const isDisabled = sch.enabled === false && !isPaused
              return (
                <div className="absolute left-0 top-full mt-1.5 w-[340px] bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-xl shadow-lg z-50 animate-fade-in overflow-hidden">
                  {/* Header — humanized cron + status pill */}
                  <div className="px-3.5 pt-3 pb-2.5 border-b border-neutral-100 dark:border-[#484848]">
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CalendarClock size={12} className="text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Schedule</span>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isPaused ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                        isDisabled ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300' :
                        'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          isPaused ? 'bg-amber-500' : isDisabled ? 'bg-neutral-400' : 'bg-emerald-500'
                        }`} />
                        {isPaused ? 'Paused' : isDisabled ? 'Disabled' : 'Enabled'}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100 leading-snug">
                      {humanizeCron(cron, tz)}
                    </div>
                    <div className="text-[10.5px] font-mono text-neutral-400 dark:text-neutral-500 mt-0.5">
                      {cron} <span className="text-neutral-300 dark:text-neutral-600">·</span> {tz}
                    </div>
                  </div>

                  {/* Next + Last run — both shown in the user's local
                      timezone. Header label echoes the resolved IANA zone
                      so the absolute times can't be misread as the
                      schedule's source-tz times. */}
                  <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-medium text-neutral-400 dark:text-neutral-500 mb-0.5">
                        Next run <span className="text-neutral-300 dark:text-neutral-600 normal-case">· {SCHEDULE_LOCAL_TZ}</span>
                      </div>
                      <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200 tabular-nums">
                        {fmtScheduleAbs(nextRun)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-medium text-neutral-400 dark:text-neutral-500 mb-0.5">
                        Last run <span className="text-neutral-300 dark:text-neutral-600 normal-case">· {SCHEDULE_LOCAL_TZ}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200 tabular-nums">
                          {fmtScheduleAbs(lastRun)}
                        </span>
                        {(() => {
                          const cls = classifyRunStatus(lastStatus)
                          if (!cls) return null
                          return (
                            <span className={`inline-flex w-fit px-1 py-0.5 rounded text-[9px] font-medium ${
                              cls === 'success'
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                            }`}>
                              {cls === 'success' ? 'OK' : 'Failed'}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Paused reason hint */}
                  {isPaused && (
                    <div className="px-3.5 pb-2.5 -mt-1">
                      <div className="text-[10.5px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5">
                        {sch.paused_reason === 'function_disabled'
                          ? 'Workflow function is disabled — re-enable it to resume the schedule.'
                          : `Paused: ${sch.paused_reason}`}
                      </div>
                    </div>
                  )}

                  {/* Footer hint — guides user to chat for changes since
                      the chip is read-only by design. */}
                  <div className="px-3.5 py-2 bg-neutral-50 dark:bg-[#252525] border-t border-neutral-100 dark:border-[#484848]">
                    <div className="text-[10.5px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      Ask the Master Agent to change, pause, or remove this schedule.
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Search in Chat — sits between Webhook and spacer.
            Closed: compact icon button.
            Open: the button slot expands into a search input with the same
            height. Webhook on the left and Provider+Settings on the right
            stay exactly where they are — nothing hides, nothing shifts. */}
        {!searchOpen ? (
          <Tooltip content="Search in chat">
            <button
              onClick={openSearch}
              aria-label="Search in chat"
              className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-lg transition-colors border bg-white dark:bg-[#2c2c2c] text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 border-neutral-200 dark:border-[#484848] hover:bg-neutral-100 dark:hover:bg-[#484848] ${compact ? 'sm:hidden' : ''}`}
            >
              <Search size={14} />
            </button>
          </Tooltip>
        ) : (
          <div ref={searchBoxRef} className={`hidden sm:flex items-center gap-2 px-3 h-8 rounded-lg text-[13px] border border-neutral-200 dark:border-[#484848] bg-neutral-50 dark:bg-[#383838] animate-fade-in ${compact ? 'sm:hidden' : ''}`}>
            <Search size={14} className="text-neutral-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="w-28 min-w-0 text-[13px] bg-transparent text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none border-none shadow-none"
              style={{ boxShadow: 'none' }}
              autoFocus
            />
            {searchTerm && (
              <span className="text-[12px] text-neutral-400 flex-shrink-0 tabular-nums">{searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0'}</span>
            )}
            {searchMatches.length > 1 && (
              <>
                <Tooltip content="Previous match"><button onClick={goToPrevMatch} aria-label="Previous match" className="p-0.5 rounded-md hover:bg-neutral-200 dark:hover:bg-[#333]"><ChevronDown size={14} className="rotate-180 text-neutral-400" /></button></Tooltip>
                <Tooltip content="Next match"><button onClick={goToNextMatch} aria-label="Next match" className="p-0.5 rounded-md hover:bg-neutral-200 dark:hover:bg-[#333]"><ChevronDown size={14} className="text-neutral-400" /></button></Tooltip>
              </>
            )}
            <Tooltip content="Close (Esc)"><button onClick={closeSearch} aria-label="Close search" className="p-0.5 rounded-md hover:bg-neutral-200 dark:hover:bg-[#333]"><X size={14} className="text-neutral-400" /></button></Tooltip>
          </div>
        )}

        {/* Workflow credit pill — on the LEFT when compact (narrow chat
            panel), since the right side is bare except for the kebab. */}
        {compact && useSystemModel && creditSummary.total.credits_used > 0 && (
          <span className="hidden sm:inline-flex">
            <CreditPill summary={creditSummary} />
          </span>
        )}

        <div className="hidden sm:block flex-1" />

        {/* Right: Model dropdown + Settings — always visible */}
        <div className="flex items-center gap-1.5 min-w-0">

          {/* Workflow credit pill — on the RIGHT in full-width mode. */}
          {!compact && useSystemModel && creditSummary.total.credits_used > 0 && (
            <span className="hidden sm:inline-flex">
              <CreditPill summary={creditSummary} />
            </span>
          )}

          {/* Model dropdown body MOVED to chat panel root level (search for
              "Model dropdown body — rendered at chat panel root" further
              down). The sub-header is `position: absolute` now, which would
              make it the positioning ancestor for the dropdown's
              `sm:absolute` and break the bottom anchor. */}

          {/* Overflow kebab — Share / Team Access / Settings collapsed into a
              single desktop-only menu so the sub-header has fewer slots
              competing for attention. Mobile keeps Settings inside the
              composer top row (mobile sub-header is h-0). */}
          {(onOpenShare || onOpenTeamAccess || onOpenSettings) && (
            <div className="relative hidden sm:block" ref={overflowMenuRef}>
              <Tooltip content="More actions" position="bottom">
                <button
                  onClick={() => setShowOverflowMenu((v) => !v)}
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={showOverflowMenu}
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#484848] transition-colors"
                >
                  <MoreVertical size={16} />
                </button>
              </Tooltip>
              {showOverflowMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-xl shadow-lg z-50 animate-fade-in overflow-hidden py-1">
                  {onOpenShare && (
                    <Tooltip content="Create a public link so anyone can clone this workflow into their own account" position="left" className="w-full">
                      <button
                        onClick={() => { setShowOverflowMenu(false); onOpenShare() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <Share2 size={14} className="text-neutral-400" />
                        <span>Share Workflow</span>
                      </button>
                    </Tooltip>
                  )}
                  {onOpenTeamAccess && (
                    <Tooltip content="Invite teammates to view or edit this live workflow (no copy made — they edit the same instance)" position="left" className="w-full">
                      <button
                        onClick={() => { setShowOverflowMenu(false); onOpenTeamAccess() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <UsersIcon size={14} className="text-neutral-400" />
                        <span>Team Access</span>
                      </button>
                    </Tooltip>
                  )}
                  {onOpenSettings && (
                    <Tooltip content="Configure model, stored credentials, deployment, and other workflow-level options" position="left" className="w-full">
                      <button
                        onClick={() => { setShowOverflowMenu(false); onOpenSettings() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <Settings size={14} className="text-neutral-400" />
                        <span>Workflow Settings</span>
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile-only search strip — visible ONLY while actively searching.
          When closed, the trigger lives as a floating top-right button on
          top of the messages area (rendered below) so the chat doesn't lose
          a 44px row to an empty bar. */}
      {searchOpen && (
        <div className="sm:hidden h-11 flex items-center px-2 border-b border-neutral-200 dark:border-[#484848] flex-shrink-0">
          <div className="flex-1 flex items-center gap-1.5 animate-fade-in min-w-0">
            <Search size={14} className="text-neutral-400 flex-shrink-0 ml-1.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="flex-1 min-w-0 text-[13px] bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-0 focus:shadow-none border-none outline-none shadow-none"
              style={{ boxShadow: 'none' }}
              autoFocus
            />
            {searchTerm && (
              <span className="text-[11px] text-neutral-500 flex-shrink-0 tabular-nums">
                {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0'}
              </span>
            )}
            <Tooltip content="Close (Esc)">
              <button onClick={closeSearch} aria-label="Close search" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#383838]">
                <X size={14} className="text-neutral-400" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Messages — virtualized for performance */}
      <div ref={chatContainerRef} className="flex-1 overflow-hidden relative" role="log" aria-live="polite" aria-label="Chat messages">
        {/* Floating search trigger — mobile-only, sits over the messages
            area's top-right corner so we don't waste a row when the user
            isn't searching. Wrapper has `sm:hidden` so the Tooltip's own
            `<div class="inline-flex">` is also dropped on desktop (the
            button's own `sm:hidden` only hides the button, leaving the
            empty wrapper in the DOM). */}
        {!searchOpen && (
          <div className="sm:hidden">
            <Tooltip content="Search in chat" position="left">
              <button
                onClick={openSearch}
                aria-label="Search in chat"
                className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white/95 dark:bg-[#2c2c2c]/95 backdrop-blur-sm border border-neutral-200 dark:border-[#484848] text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-[#383838] active:scale-95 transition-all shadow-sm"
              >
                <Search size={16} strokeWidth={2.25} />
              </button>
            </Tooltip>
          </div>
        )}
        {chatLoading ? (
          /* Skeleton loader — mirrors real message layout: assistant on left
             with avatar, user on right inside a rounded bubble (bg-neutral-100/80).
             Tool-call cards are taller to match real ToolCallCollapsible (~64px). */
          <div className="max-w-[820px] xl:max-w-[900px] mx-auto px-3 sm:px-4 py-4 space-y-6 animate-pulse">
            {/* User message — right-aligned, bubble background */}
            <div className="flex justify-end">
              <div className="rounded-2xl bg-neutral-100/80 dark:bg-[#383838]/60 px-4 py-3 space-y-2 max-w-[70%]" style={{ width: '55%' }}>
                <div className="h-3 bg-neutral-200 dark:bg-[#484848] rounded w-full" />
                <div className="h-3 bg-neutral-200 dark:bg-[#484848] rounded w-[65%]" />
              </div>
            </div>
            {/* Assistant message — avatar + content */}
            <div className="flex gap-2 items-end">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-neutral-200 dark:bg-[#484848] flex-shrink-0" />
              <div className="flex-1 space-y-2.5 min-w-0">
                <div className="h-3.5 bg-neutral-200 dark:bg-[#484848] rounded w-[85%]" />
                <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-[70%]" />
                <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-[50%]" />
                {/* Tool-call card — header row + 2 line preview */}
                <div className="rounded-xl border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] p-3 w-[75%] mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-neutral-200 dark:bg-[#484848]" />
                    <div className="h-3.5 w-32 bg-neutral-200 dark:bg-[#484848] rounded" />
                    <div className="h-4 w-10 bg-emerald-100 dark:bg-emerald-900/30 rounded ml-auto" />
                  </div>
                  <div className="h-2.5 w-3/4 bg-neutral-100 dark:bg-[#4a4a4a] rounded" />
                </div>
                <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-[40%]" />
              </div>
            </div>
            {/* Short user message */}
            <div className="flex justify-end">
              <div className="rounded-2xl bg-neutral-100/80 dark:bg-[#383838]/60 px-4 py-3 max-w-[70%]" style={{ width: '38%' }}>
                <div className="h-3 bg-neutral-200 dark:bg-[#484848] rounded w-full" />
              </div>
            </div>
            {/* Second assistant — with another tool card */}
            <div className="flex gap-2 items-end">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-neutral-200 dark:bg-[#484848] flex-shrink-0" />
              <div className="flex-1 space-y-2.5 min-w-0">
                <div className="h-3.5 bg-neutral-200 dark:bg-[#484848] rounded w-[78%]" />
                <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-[55%]" />
                <div className="rounded-xl border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] p-3 w-[60%] mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-neutral-200 dark:bg-[#484848]" />
                    <div className="h-3.5 w-28 bg-neutral-200 dark:bg-[#484848] rounded" />
                    <div className="h-4 w-10 bg-emerald-100 dark:bg-emerald-900/30 rounded ml-auto" />
                  </div>
                </div>
                <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-[45%]" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-primary-50 dark:bg-[#383838] flex items-center justify-center mb-3">
              <Bot size={24} className="text-primary-400" />
            </div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Start building your workflow</p>
            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              Describe what you want your agent to do. I'll design the steps and configuration for you.
            </p>
            {/* Quick-start prompts — click to pre-fill the composer so users
                without an idea of where to begin still get a usable starting
                point. Same pattern as ChatGPT's example tiles. */}
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {[
                'Send a Slack alert when a Stripe payment is received',
                'Summarise new Gmail emails into a daily digest',
                'Post a tweet whenever a new blog article is published',
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setInput(sample)
                    setTimeout(() => textareaRef.current?.focus(), 0)
                  }}
                  className="text-left text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-300 px-3 py-2 rounded-lg border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 transition-colors"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={chatContainerRef}
            onScroll={handleChatScroll}
            className="h-full overflow-y-auto"
          >
          <div className="max-w-[820px] xl:max-w-[900px] mx-auto">
            {hasMoreOlder && (
              <div className="flex justify-center py-2">
                <button
                  onClick={loadOlderMessages}
                  disabled={loadingOlder}
                  className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#383838] hover:bg-neutral-200 dark:hover:bg-[#484848] disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={msg.timestamp || i} data-msg-index={i} className="group/msg px-3 sm:px-4 py-2 sm:py-4">
              <div className={`flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 ${msg.role === 'user' ? 'items-end sm:justify-end' : 'items-start sm:justify-start'}`}>
                {/* AI Avatar — bottom left on desktop, below message on mobile.
                    Uses /favicon.svg (the brand icon shown in the sidebar) on a
                    theme-aware circular background. */}
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center flex-shrink-0 mb-0.5 order-2 sm:order-first">
                    <img src="/favicon.svg" alt="Pabbly" className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                )}
                <div className={`relative order-1 min-w-0 ${msg.role === 'user' ? 'max-w-[85%] sm:max-w-[85%]' : 'max-w-full sm:max-w-[85%] pl-3 sm:pl-5'}`} style={msg.role === 'assistant' ? { borderLeft: '2px solid #20B276', borderImageSource: 'linear-gradient(to bottom, #20B276 calc(100% - 4px), transparent calc(100% - 4px))', borderImageSlice: 1 } : undefined}>
                  {/* Copy button — appears on hover */}
                  <Tooltip content={copiedMsgIdx === i ? 'Copied' : 'Copy message'}>
                  <button
                    onClick={() => {
                      // Build full copy text including tool calls
                      let copyText = ''
                      if (msg.segments?.length > 0) {
                        copyText = msg.segments.map(seg => {
                          if (seg.type === 'tool') {
                            let t = `[TOOL: ${seg.name}]`
                            if (seg.params) { try { t += '\nParams: ' + JSON.stringify(JSON.parse(typeof seg.params === 'string' ? seg.params : JSON.stringify(seg.params)), null, 2) } catch { t += '\nParams: ' + seg.params } }
                            if (seg.result) {
                              try { const r = JSON.parse(seg.result); t += '\nResult: ' + JSON.stringify(r, null, 2) } catch { t += '\nResult: ' + seg.result }
                            } else if (seg.truncated) {
                              t += '\nResult: [Not loaded — open the tool card in the UI to load before copying.]'
                            }
                            return t
                          }
                          return seg.content || ''
                        }).filter(Boolean).join('\n\n')
                      } else if (msg.toolCalls?.length > 0) {
                        const toolText = msg.toolCalls.map(tc => {
                          let t = `[TOOL: ${tc.name}]`
                          if (tc.params) { try { t += '\nParams: ' + JSON.stringify(JSON.parse(typeof tc.params === 'string' ? tc.params : JSON.stringify(tc.params)), null, 2) } catch { t += '\nParams: ' + tc.params } }
                          if (tc.result) {
                            try { const r = JSON.parse(tc.result); t += '\nResult: ' + JSON.stringify(r, null, 2) } catch { t += '\nResult: ' + tc.result }
                          } else if (tc.truncated) {
                            t += '\nResult: [Not loaded — open the tool card in the UI to load before copying.]'
                          }
                          return t
                        }).join('\n\n')
                        copyText = toolText + '\n\n' + (msg.content || '')
                      } else {
                        copyText = msg.content || ''
                      }
                      navigator.clipboard.writeText(copyText.trim())
                      setCopiedMsgIdx(i)
                      setTimeout(() => setCopiedMsgIdx(null), 1500)
                    }}
                    className={`absolute ${msg.role === 'user' ? '-left-8' : '-right-8'} top-1 p-1.5 rounded-md bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] shadow-sm opacity-0 group-hover/msg:opacity-100 transition-opacity hover:bg-neutral-100 dark:hover:bg-[#484848] z-10 hidden sm:block`}
                    aria-label="Copy message"
                  >
                    {copiedMsgIdx === i
                      ? <Check size={12} className="text-emerald-500" />
                      : <Copy size={12} className="text-neutral-400 dark:text-neutral-500" />
                    }
                  </button>
                  </Tooltip>

                {msg.role === 'user' ? (
                  /* ── User message: attachments in a single horizontal row
                       outside the text bubble. Uniform 120×120 cards, scroll
                       right with a Next arrow when more than 3-4 attachments. ── */
                  <div className="flex flex-col items-end gap-1.5 max-w-full min-w-0">
                    {msg.attachments?.length > 0 && (
                      <AttachmentRow
                        atts={msg.attachments}
                        onOpen={(idx) => openAttachmentPreview(msg.attachments, idx)}
                        resolveSrc={resolveAttachmentSrc}
                      />
                    )}
                    {(() => {
                      // Hide the text bubble when content is empty OR a known
                      // placeholder string. Covers (a) fresh sends with text-only
                      // attachments where safeContent='' (no bubble needed; the
                      // attachment card IS the message), and (b) legacy DB rows
                      // that still carry "[attachment]" / "(see attached file)"
                      // from before the placeholder fix.
                      const c = (msg.content || '').trim()
                      const isPlaceholder = c === '' || c === '[attachment]' || c === '(see attached file)' || c === '(no content)'
                      if (isPlaceholder) return null
                      return (
                        <div className="rounded-2xl px-3 sm:px-3.5 py-2 sm:py-2.5 text-[13px] sm:text-[15px] leading-relaxed overflow-hidden break-words bg-primary-500 text-white rounded-br-md max-w-full min-w-0">
                          <span className="break-words whitespace-pre-wrap overflow-wrap-anywhere">{msg.content}</span>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  /* ── AI message — ordered: segments (text + tools interleaved) ── */
                  <div className="space-y-2">
                    {msg.segments?.length > 0 ? (
                      <>
                        {/* Interleaved: tool cards + text segments in original order */}
                        {msg.segments.map((seg, si) => {
                          if (seg.type === 'tool') return (
                            <div key={seg.id || si}>
                              <ToolCallCollapsible tool={{...seg, collapsed: true}} agentId={agent?.slug || agent?.id} steps={steps} />
                            </div>
                          )
                          const segClean = sanitizeForMarkdown((seg.content || '')
                            .replace(/```tool_call[\s\S]*?```/g, '')
                            .replace(/```tool_call[\s\S]*/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*/g, '')
                            .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
                            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
                            .replace(/```\s*$/g, '')
                            .replace(/:::action\s*\{[^}]*\}\s*:::/g, '')
                            .trim())
                          if (!segClean || segClean.replace(/[`\s\n]/g, '').length === 0) return null
                          // Short text right before a tool call → subtle context annotation
                          const nextSeg = msg.segments[si + 1]
                          const isToolContext = nextSeg?.type === 'tool' && segClean.split('\n').filter(l => l.trim()).length <= 2
                          if (isToolContext) return (
                            <p key={si} className="text-[12px] sm:text-[13px] text-neutral-400 dark:text-neutral-500 italic mt-1 mb-0.5">{segClean.replace(/\*\*/g, '').replace(/[*_`#>]/g, '')}</p>
                          )
                          return (
                            <div key={si} className="text-neutral-800 dark:text-neutral-200 break-words">
                              <div className={MARKDOWN_CLASSES}>
                                <MemoMarkdown components={markdownComponents} content={segClean} />
                              </div>
                            </div>
                          )
                        })}
                        {/* Append any remaining text from done event not in segments */}
                        {msg.content && (() => {
                          const segText = msg.segments.filter(s => s.type === 'text').map(s => (s.content || '').trim()).join('\n')
                          const clean = msg.content
                            .replace(/```tool_call[\s\S]*?```/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
                            .replace(/```json\s*\n\s*\{\s*"step"\s*:[\s\S]*?```/g, '')
                            .replace(/:::action\s*\{[^}]*\}\s*:::/g, '')
                            .replace(/\n{3,}/g, '\n\n')
                            .trim()
                          // If no text segments exist, show full content
                          if (!segText) {
                            if (!clean || clean.replace(/[`\s\n]/g, '').length < 3) return null
                            return (
                              <div className="text-neutral-800 dark:text-neutral-200 break-words">
                                <div className={MARKDOWN_CLASSES}><MemoMarkdown components={markdownComponents} content={clean} /></div>
                              </div>
                            )
                          }
                          // Find text after the last segment's content
                          const lastSeg = msg.segments.filter(s => s.type === 'text' && s.content?.trim()).pop()
                          if (!lastSeg) return null
                          const lastContent = lastSeg.content.trim()
                          const idx = clean.lastIndexOf(lastContent)
                          if (idx < 0) {
                            // Segments don't match content — show full content as fallback
                            if (clean.length > segText.length + 50) {
                              return (
                                <div className="text-neutral-800 dark:text-neutral-200 break-words">
                                  <div className={MARKDOWN_CLASSES}><MemoMarkdown components={markdownComponents} content={clean} /></div>
                                </div>
                              )
                            }
                            return null
                          }
                          const tail = clean.slice(idx + lastContent.length).trim()
                          if (!tail || tail.replace(/[`\s\n]/g, '').length < 3) return null
                          return (
                            <div className="text-neutral-800 dark:text-neutral-200 break-words">
                              <div className={MARKDOWN_CLASSES}><MemoMarkdown components={markdownComponents} content={tail} /></div>
                            </div>
                          )
                        })()}
                      </>

                    ) : msg.toolCalls?.length > 0 ? (
                      <>
                        {msg.toolCalls.map((tc) => (
                          <div key={tc.id}>
                            <ToolCallCollapsible tool={{...tc, collapsed: true}} agentId={agent?.slug || agent?.id} steps={steps} />
                          </div>
                        ))}
                        {msg.content && (
                          <div className="text-neutral-800 dark:text-neutral-200 break-words">
                            <div className={MARKDOWN_CLASSES}>
                              <MemoMarkdown components={markdownComponents} content={msg.content} />
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-neutral-800 dark:text-neutral-200 break-words">
                        <div className={MARKDOWN_CLASSES}>
                          <MemoMarkdown components={markdownComponents} content={msg.content} />
                        </div>
                      </div>
                    )}

                    {/* Inline action buttons — disabled, users use main input */}
                    {/* Created files */}
                    {msg.createdFiles?.length > 0 && (
                      <div className="px-3 pt-1">
                        <p className="text-[10px] text-neutral-400 font-medium mb-1">Files created/updated:</p>
                        <div className="flex flex-wrap gap-1">
                          {msg.createdFiles.map((f) => (
                            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono rounded-md border border-emerald-200 dark:border-emerald-800/50">
                              <FileText size={9} />
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Error reason callout — shown above the status badge so users
                        can see the tool cards above + the specific failure reason here.
                        Preserves backward compat: older messages without `msg.error`
                        still show the generic badge below. */}
                    {msg.error && (
                      <div className="mt-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-3 py-2 text-[13px] break-words">
                        <div className={MARKDOWN_CLASSES}>
                          <MemoMarkdown components={markdownComponents} content={msg.error} />
                        </div>
                      </div>
                    )}
                    {/* Status badges */}
                    {msg.status === 'partial' && (
                      <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-[#383838]/50 px-3 py-1.5 rounded-lg">
                        <XCircle size={12} />
                        <span>Response was interrupted</span>
                        <button onClick={() => handleRetry(msg)} className="ml-auto text-neutral-700 dark:text-neutral-300 font-medium hover:underline">Retry</button>
                      </div>
                    )}
                    {msg.status === 'error' && (
                      <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50/50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg">
                        <XCircle size={12} />
                        <span>Failed to generate response</span>
                        <button onClick={() => handleRetry(msg)} className="ml-auto text-red-700 dark:text-red-400 font-medium hover:underline">Retry</button>
                      </div>
                    )}
                    {/* Credit usage badge — admin-only view.
                        Gated on balance_after so BYOK messages never display a credit pill. */}
                    {user?.is_admin && msg.usage?.credits_used != null && msg.usage?.balance_after != null && (
                      <div className="px-3 pt-1.5 flex items-center gap-2">
                        <Tooltip content={`${msg.usage.input_tokens || 0} input + ${msg.usage.output_tokens || 0} output tokens • exact: ${msg.usage.credits_used.toFixed(6)} AI credits`} position="left">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-full text-[10px] text-red-600 dark:text-red-400 font-medium"
                        >
                          <Coins size={10} />
                          AI Credit Used: {
                            msg.usage.credits_used === 0
                              ? '0.00'
                              : msg.usage.credits_used < 0.01
                                ? msg.usage.credits_used.toFixed(4)
                                : msg.usage.credits_used.toFixed(2)
                          }
                        </span>
                        </Tooltip>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500 italic">admin only</span>
                      </div>
                    )}
                  </div>
                )}
                </div>
                {/* User Avatar — right side on desktop, below message on mobile */}
                {msg.role === 'user' && (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0 mb-0.5 overflow-hidden order-2 sm:order-last self-end sm:self-auto">
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] font-bold text-white">{(user?.name || 'U')[0].toUpperCase()}</span>
                    )}
                  </div>
                )}
              </div>
              {/* Reaction bar — temporarily hidden in all views per product decision.
                  Uncomment the block below to re-enable. The bar would render OUTSIDE
                  the green-bordered content div, indented under the message text, with
                  always-reserved space (no layout shift on hover). */}
              {/*
              {msg.role === 'assistant' && msg.content && (
                <div className="pl-11 sm:pl-[60px] mt-1">
                  <ReactionBar agentId={agent?.id} messageId={msg.timestamp} context="chat" />
                </div>
              )}
              */}
              {/* Message timestamp — shown on hover */}
              {msg.timestamp && (
                <div className={`mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500 opacity-0 group-hover/msg:opacity-100 transition-opacity select-none ${msg.role === 'user' ? 'text-right pr-1' : 'pl-10 sm:pl-[52px]'}`}>
                  {(() => {
                    try {
                      const d = new Date(msg.timestamp)
                      return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                    } catch { return '' }
                  })()}
                </div>
              )}
              </div>
            ))}

            {/* Streaming content — matches finalized message layout */}
            <div className="px-3 sm:px-4 py-3 sm:py-4">
                  {isStreaming && (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 items-start sm:justify-start">
                      {/* Avatar — matches the sidebar's brand icon */}
                      <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center flex-shrink-0 mb-0.5 order-2 sm:order-first">
                        <img src="/favicon.svg" alt="Pabbly" className="w-7 h-7 sm:w-8 sm:h-8" />
                      </div>
                      {/* Content with green line */}
                      <div className="relative order-1 min-w-0 max-w-full sm:max-w-[85%] pl-4 sm:pl-5 space-y-2 overflow-hidden" style={{ borderLeft: '2px solid #20B276', borderImageSource: 'linear-gradient(to bottom, #20B276 calc(100% - 4px), transparent calc(100% - 4px))', borderImageSlice: 1 }}>
                        {/* Completed segments */}
                        {streamingSegments.map((seg, si) => {
                          if (seg.type === 'tool') return (
                            <div key={seg.id || si}>
                              <ToolCallCollapsible tool={{...seg, collapsed: true}} agentId={agent?.slug || agent?.id} steps={steps} />
                            </div>
                          )
                          const segClean = sanitizeForMarkdown((seg.content || '')
                            .replace(/```tool_call[\s\S]*?```/g, '')
                            .replace(/```tool_call[\s\S]*/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*?```/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*/g, '')
                            .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
                            .replace(/<function_calls>[\s\S]*/g, '')
                            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
                            .replace(/<tool_call>[\s\S]*/g, '')
                            .replace(/```\s*$/g, '')
                            .replace(/:::action\s*\{[^}]*\}\s*:::/g, '')
                            .trim())
                          if (!segClean || segClean.replace(/[`\s\n]/g, '').length === 0) return null
                          // Short text right before a tool call → subtle context annotation
                          const nextStreamSeg = streamingSegments[si + 1]
                          const isStreamToolContext = nextStreamSeg?.type === 'tool' && segClean.split('\n').filter(l => l.trim()).length <= 2
                          if (isStreamToolContext) return (
                            <p key={si} className="text-[12px] sm:text-[13px] text-neutral-400 dark:text-neutral-500 italic mt-1 mb-0.5">{segClean.replace(/\*\*/g, '').replace(/[*_`#>]/g, '')}</p>
                          )
                          return (
                            <div key={si} className="text-neutral-800 dark:text-neutral-200 break-words">
                              <div className={MARKDOWN_CLASSES}>
                                <MemoMarkdown components={markdownComponents} content={segClean} />
                              </div>
                            </div>
                          )
                        })}
                        {/* Live streaming text — direct markdown render, no smoother */}
                        {streamingText && streamingText.replace(/[`\s\n]/g, '').length > 0 && (() => {
                          // Strip incomplete tool_call blocks from live text
                          let safeText = streamingText
                            .replace(/```tool_call[\s\S]*/g, '')
                            .replace(/```json\s*\n\s*\{\s*"name"\s*:[\s\S]*/g, '')
                            .replace(/<function_calls>[\s\S]*/g, '')
                            .replace(/<tool_call>[\s\S]*/g, '')
                            .replace(/```\s*$/g, '')
                            .replace(/:::action\s*\{[^}]*\}\s*:::/g, '')
                          // Close unclosed code fences for partial markdown rendering
                          const fences = safeText.match(/```/g)
                          if (fences && fences.length % 2 !== 0) safeText = safeText + '\n```'
                          if (!safeText.trim()) return null
                          return (
                            <div className="text-neutral-800 dark:text-neutral-200 break-words">
                              <div className={MARKDOWN_CLASSES}>
                                <MemoMarkdown components={markdownComponents} content={sanitizeForMarkdown(safeText)} />
                              </div>
                            </div>
                          )
                        })()}
                        {/* Activity pill — always visible at bottom while streaming */}
                        <div className="flex items-center gap-2 mt-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] w-fit">
                          <div className="activity-spinner">
                            <div className="dot d1" />
                            <div className="dot d2" />
                            <div className="dot d3" />
                            <div className="dot d4" />
                          </div>
                          <span className="text-[12px] text-neutral-600 dark:text-neutral-400 font-medium max-w-[300px]">
                            {activityDesc
                              ? <TypewriterText text={activityDesc} />
                              : liveStatus
                                ? <TypewriterText text={liveStatus} speed={25} />
                                : <RotatingThinking />
                            }
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Compile/Test/Deploy progress banner */}
                  {actionLoading && (
                    <div className="flex justify-start py-1">
                      <div className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 border ${
                        actionLoading === 'compile' ? 'bg-neutral-50 dark:bg-[#383838] border-neutral-200 dark:border-[#484848]' :
                        actionLoading === 'test' ? 'bg-blue-50 dark:bg-[#2c2c2c] border-blue-200 dark:border-[#484848]' :
                        'bg-neutral-100 dark:bg-[#383838] border-neutral-200 dark:border-[#484848]'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-5 h-5 rounded-full border-2 border-t-transparent animate-spin ${
                            actionLoading === 'compile' ? 'border-primary-500' :
                            actionLoading === 'test' ? 'border-blue-500' :
                            'border-neutral-400'
                          }`} />
                          <div>
                            <p className={`text-xs font-semibold ${
                              actionLoading === 'compile' ? 'text-neutral-700 dark:text-neutral-300' :
                              actionLoading === 'test' ? 'text-blue-700 dark:text-blue-400' :
                              actionLoading === 'activate' || actionLoading === 'reactivate' ? 'text-emerald-700 dark:text-emerald-400' :
                              actionLoading === 'deactivate' ? 'text-neutral-600 dark:text-neutral-300' :
                              'text-neutral-700 dark:text-neutral-300'
                            }`}>
                              {actionLoading === 'compile' ? 'Compiling agent...' :
                               actionLoading === 'test' ? 'Running test...' :
                               actionLoading === 'activate' || actionLoading === 'reactivate' ? 'Activating workflow...' :
                               actionLoading === 'deactivate' ? 'Deactivating workflow...' :
                               'Deploying workflow...'}
                            </p>
                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                              {actionLoading === 'compile'
                                ? 'Building Rust binary — this may take 1-2 minutes on first compile'
                                : actionLoading === 'test'
                                  ? 'Executing workflow with test input'
                                  : actionLoading === 'activate' || actionLoading === 'reactivate'
                                    ? 'Turning the workflow back on so webhooks can trigger it'
                                    : actionLoading === 'deactivate'
                                      ? 'Taking the workflow offline — webhooks will stop triggering'
                                      : 'Deploying compiled binary to server'}
                            </p>
                          </div>
                        </div>
                        <CompileTimer />
                      </div>
                    </div>
                  )}

                  {/* Activation error */}
                  {compileError && (
                    <div className="flex justify-start py-1">
                      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-red-700 dark:text-red-400">Activation Failed</span>
                          <button onClick={onDismissCompileError} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 p-0.5">
                            <X size={12} />
                          </button>
                        </div>
                        <pre className="text-[10px] text-red-800 dark:text-red-300 bg-red-100/50 dark:bg-red-900/30 rounded-lg p-2.5 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
                          {compileError}
                        </pre>
                        <p className="text-[10px] text-red-500 dark:text-red-400 mt-1.5">Ask the AI to fix the errors above.</p>
                      </div>
                    </div>
                  )}

                  {/* Activation success */}
                  {compileSuccess && (
                    <div className="flex justify-start py-1 animate-fade-in">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-emerald-500" />
                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Workflow Activated</span>
                          </div>
                          <button onClick={onDismissCompileSuccess} className="text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 p-0.5">
                            <X size={12} />
                          </button>
                        </div>
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                          Workflow is live and ready to receive webhooks.
                        </p>
                      </div>
                    </div>
                  )}


                  {/* Test result */}
                  {testResult && (
                    <div className="flex justify-start py-1">
                      <div className={`max-w-[90%] rounded-2xl rounded-bl-md px-3 py-2.5 border ${
                        testResult.status === 'passed' || testResult.status === 'completed' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {testResult.status === 'passed' || testResult.status === 'completed' ? (
                              <CheckCircle2 size={14} className="text-emerald-500" />
                            ) : (
                              <XCircle size={14} className="text-red-500" />
                            )}
                            <span className={`text-xs font-semibold ${testResult.status === 'passed' || testResult.status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                              Test {testResult.status === 'passed' || testResult.status === 'completed' ? 'Passed' : 'Failed'}
                              {testResult.duration_ms ? ` (${testResult.duration_ms}ms)` : ''}
                            </span>
                          </div>
                          <button onClick={onDismissTestResult} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 dark:text-neutral-400 p-0.5">
                            <X size={12} />
                          </button>
                        </div>
                        {testResult.output && (
                          <pre className="text-[10px] text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#2c2c2c]/50 rounded-lg p-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono mt-1">
                            {testResult.output}
                          </pre>
                        )}
                        {testResult.error && (
                          <pre className="text-[10px] text-red-800 dark:text-red-300 bg-red-100/50 dark:bg-red-900/30 rounded-lg p-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono mt-1">
                            {testResult.error}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>

            {/* Bottom spacer — only during streaming to keep text visible above input */}
            <div className={isStreaming ? 'h-10' : 'h-4'} />
            {/* Scroll anchor */}
            <div ref={chatEndRef} />
          </div>
          </div>
        )}

        {/* Scroll to bottom button — shown when user scrolls up and new activity happens below */}
        {showScrollToBottom && messages.length > 0 && (() => {
          const hasNewActivity = isStreaming || messages.length > lastSeenMsgCountRef.current
          return (
            <button
              onClick={scrollToBottom}
              className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600 transition-all ${hasNewActivity ? 'px-3 py-1.5' : 'w-8 h-8 justify-center'}`}
            >
              <ArrowDown size={13} />
              {hasNewActivity && <span className="text-xs font-medium">New activity</span>}
            </button>
          )
        })()}
      </div>

      {/* No API key warning — auto-dismisses after 5s, user can close.
          Gated on both keysLoaded + !chatLoading to prevent a false-positive
          flash while keysAPI / history are still in-flight. */}
      {!chatLoading && keysLoaded && !hasApiKey && !bannerDismissed && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] rounded-lg text-xs text-neutral-700 dark:text-neutral-300">
            <span>No API key configured. Using platform AI Credits.</span>
            <a href="/settings/models" className="font-medium text-neutral-700 dark:text-neutral-300 underline">Add Key</a>
            <button onClick={() => setBannerDismissed(true)} className="ml-auto p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}


      {/* Input */}
      <div ref={composerRef} className="relative px-3 sm:px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-2.5 pt-2 flex-shrink-0 max-w-[820px] xl:max-w-[900px] mx-auto w-full">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachments.map((att, ai) => {
              const mime = att.mimeType || ''
              const composerBadge = formatLabelForMime(mime, !!att.name)
              // Edit affordance is text-like — images and PDFs stay read-only
              // even from the composer (no in-place editor for binary formats).
              // Structured-text MIMEs (JSON / CSV / etc.) round-trip through
              // the same paste shape, so they're editable too.
              const onOpen = () => openAttachmentPreview(attachments, ai, { editable: isTextLikeMime(mime) })
              return (
                <div key={att.id} className="relative group">
                  {/* All composer tiles share the same 96×96 footprint so images,
                      PDFs, and pasted-text cards line up cleanly in one row. */}
                  {mime === 'application/pdf' ? (
                    <button
                      type="button"
                      onClick={onOpen}
                      className="w-24 h-24 rounded-lg border border-neutral-200 dark:border-[#484848] bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center gap-1 p-1.5 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary-500"
                      aria-label={`Open ${att.name || 'PDF'} preview`}
                    >
                      <FileText size={22} className="text-red-500" />
                      <span className="text-[9px] text-red-600 dark:text-red-400 font-bold">PDF</span>
                    </button>
                  ) : isTextLikeMime(mime) ? (
                    <button
                      type="button"
                      onClick={onOpen}
                      className="w-24 h-24 rounded-lg border border-neutral-200/80 dark:border-[#3a3a3a] bg-neutral-50 dark:bg-[#262626] shadow-md shadow-neutral-400/15 dark:shadow-black/40 flex flex-col justify-between p-1.5 text-left hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary-500 overflow-hidden"
                      aria-label={`Open ${att.name || (composerBadge === 'PASTED' ? 'Pasted text' : composerBadge)} preview`}
                      title={att.name || ''}
                    >
                      <span className="text-[8px] leading-[1.3] text-neutral-700 dark:text-neutral-300 font-mono line-clamp-5 whitespace-pre-wrap break-all">
                        {att.preview || att.text?.slice(0, 160) || att.name || composerBadge}
                      </span>
                      <span className="self-start mt-1 px-1 py-[1px] rounded-[3px] bg-white dark:bg-[#1a1a1a] border border-neutral-300 dark:border-[#484848] text-[7px] font-bold tracking-wide text-neutral-700 dark:text-neutral-200 shadow-sm">
                        {composerBadge}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpen}
                      className="p-0 border-0 bg-transparent rounded-lg hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary-500"
                      aria-label={`Open ${att.name || 'Attachment'} preview`}
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.name || 'Attachment'}
                        className="w-24 h-24 rounded-lg object-cover border border-neutral-200 dark:border-[#484848]"
                      />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(att.id) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-neutral-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove attachment"
                  >
                    <X size={10} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          // `accept=` filters the OS file dialog so unsupported formats (Excel,
          // Word, zips) don't even appear — the absence in the picker is the
          // signal to the user that those formats aren't supported, no toast
          // needed for the picker path. Drag-drop / paste paths still hit the
          // JS allowlist + toast as a fallback.
          accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,.pdf,application/pdf,.json,application/json,.csv,text/csv,.md,.markdown,text/markdown,.xml,text/xml,application/xml,.yaml,.yml,text/yaml,application/yaml,application/x-yaml,.tsv,text/tab-separated-values,.ndjson,.jsonl,application/x-ndjson"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="bg-white dark:bg-[#383838] sm:bg-neutral-100 rounded-2xl sm:rounded-xl px-4 sm:px-3 py-2 shadow-lg sm:shadow-none border border-neutral-200 dark:border-[#484848] sm:border-0 overflow-hidden">
          {/* Composer top row — provider/model picker chip on the left.
              Visible on mobile and desktop (Option B: provider lives next to
              the input). The mobile-only kebab on the right folds Schedule /
              Credits / Share / Team Access / Workflow Settings together —
              desktop surfaces them as separate sub-header pills + kebab. */}
          <div ref={modelTriggerRef} className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-neutral-100 dark:border-[#4a4a4a]">
            <Tooltip
              content={
                useSystemModel && creditsLeft != null
                  ? `${creditsLeft.toFixed(2)} AI Credits left`
                  : 'Switch AI provider or model'
              }
              position="top"
            >
            <button
              onClick={() => !isStreaming && !switchingProvider && setShowModelDropdown(!showModelDropdown)}
              disabled={isStreaming || switchingProvider}
              className="flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-md text-[12px] sm:text-[13px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#4a4a4a] disabled:opacity-50 min-w-0"
              aria-label={switchingProvider ? 'Switching provider…' : 'Switch AI provider or model'}
              aria-haspopup="menu"
              aria-expanded={showModelDropdown}
              aria-busy={switchingProvider}
            >
              {(() => {
                const pid = resolvedSelectedModel?.providerId || null
                if (useSystemModel || !pid) {
                  return <img src="/favicon.svg" alt="Pabbly" className="w-4 h-4 flex-shrink-0" />
                }
                const color = PROVIDER_COLORS[pid]
                return (
                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (color || '#888') + '20', color: color || '#888' }}>
                    <ProviderLogo providerId={pid} fallbackLetter={(PROVIDER_NAMES[pid] || pid)[0]} />
                  </div>
                )
              })()}
              <span className="truncate max-w-[160px] sm:max-w-[200px] font-semibold">
                {useSystemModel
                  ? 'Pabbly Provider'
                  : (resolvedSelectedModel?.label || selectedModel)}
              </span>
              {switchingProvider
                ? <Loader2 size={12} className="animate-spin flex-shrink-0 text-primary-500" />
                : <ChevronDown size={12} className={`flex-shrink-0 text-neutral-400 transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />}
            </button>
            </Tooltip>
            {(onOpenSettings || onOpenShare || onOpenTeamAccess) && (
              <div className="sm:hidden" ref={composerMenuRef}>
                <Tooltip content="More actions" position="top">
                  <button
                    onClick={() => {
                      if (!showComposerMenu) {
                        const rect = composerMenuRef.current?.getBoundingClientRect()
                        if (rect) {
                          setComposerMenuPos({
                            bottom: Math.max(8, window.innerHeight - rect.top + 6),
                            right: Math.max(8, window.innerWidth - rect.right),
                          })
                        }
                      }
                      setShowComposerMenu((v) => !v)
                    }}
                    className="p-1.5 -mr-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded-md hover:bg-neutral-100 dark:hover:bg-[#4a4a4a]"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={showComposerMenu}
                  >
                    <MoreVertical size={16} />
                  </button>
                </Tooltip>
              </div>
            )}
            {showComposerMenu && createPortal(
              (() => {
                const showSchedule = scheduleState?.exists && scheduleState.schedule
                const showCredits = useSystemModel && creditSummary?.total?.credits_used > 0
                const hasInfoRow = showSchedule || showCredits
                return (
                  <div
                    ref={composerMenuPanelRef}
                    className="fixed w-56 bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-xl shadow-lg z-[80] animate-fade-in overflow-hidden py-1 sm:hidden"
                    style={{ bottom: composerMenuPos.bottom, right: composerMenuPos.right }}
                    role="menu"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    {showSchedule && (() => {
                      const sch = scheduleState.schedule || {}
                      const cron = sch.cron_expression || ''
                      const tz = sch.timezone || 'UTC'
                      return (
                        <div className="px-3 py-2 text-[13px]">
                          <div className="flex items-center gap-2.5">
                            <CalendarClock size={14} className="text-neutral-400 flex-shrink-0" />
                            <span className="flex-1 text-neutral-700 dark:text-neutral-200">Schedule</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              sch.paused_reason
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : sch.enabled === false
                                  ? 'bg-neutral-100 text-neutral-500 dark:bg-[#484848] dark:text-neutral-400'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            }`}>
                              {sch.paused_reason
                                ? 'Paused'
                                : sch.enabled === false
                                  ? 'Disabled'
                                  : 'Scheduled'}
                            </span>
                          </div>
                          {cron && (
                            <div className="pl-[26px] mt-1">
                              <div className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-snug">
                                {humanizeCron(cron, tz)}
                              </div>
                              <div className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500 mt-0.5 truncate">
                                {cron} · {tz}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    {showCredits && (
                      <div className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200">
                        <Coins size={14} className="text-red-500 dark:text-red-400 flex-shrink-0" />
                        <span className="flex-1">AI Credits Used</span>
                        <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 tabular-nums">
                          {creditSummary.total.credits_used.toFixed(2)}
                        </span>
                      </div>
                    )}
                    {hasInfoRow && (
                      <div className="my-1 h-px bg-neutral-100 dark:bg-[#383838]" />
                    )}
                    {onOpenShare && (
                      <button
                        onClick={() => { setShowComposerMenu(false); onOpenShare() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <Share2 size={14} className="text-neutral-400" />
                        <span>Share Workflow</span>
                      </button>
                    )}
                    {onOpenTeamAccess && (
                      <button
                        onClick={() => { setShowComposerMenu(false); onOpenTeamAccess() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <UsersIcon size={14} className="text-neutral-400" />
                        <span>Team Access</span>
                      </button>
                    )}
                    {onOpenSettings && (
                      <button
                        onClick={() => { setShowComposerMenu(false); onOpenSettings() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                      >
                        <Settings size={14} className="text-neutral-400" />
                        <span>Workflow Settings</span>
                      </button>
                    )}
                  </div>
                )
              })(),
              document.body
            )}
          </div>
          {/* Single-row pill: textarea grows up to maxHeight, paperclip + send
              stay anchored to the bottom (items-end) so they line up with the
              last visible line. Empty state collapses to a 40px tall pill that
              matches the action button heights. */}
          <div className="flex items-end gap-1 min-w-0">
            <textarea
              ref={textareaRef}
              defaultValue=""
              onChange={(e) => {
                const wasEmpty = !inputRef.current.trim()
                inputRef.current = e.target.value
                const el = e.target
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
                const isEmpty = !e.target.value.trim()
                if (wasEmpty !== isEmpty) setInputVersion(v => v + 1)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={compact ? 'Describe your workflow…' : 'Describe your workflow, paste a webhook URL, sample JSON…'}
              aria-label="Message input"
              rows={1}
              className="flex-1 min-w-0 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 resize-none border-0 outline-0 ring-0 focus:ring-0 focus:outline-0 focus:border-0 p-0 m-0 leading-relaxed self-center"
              style={{ minHeight: '24px', maxHeight: '120px', paddingTop: '8px', paddingBottom: '8px', boxShadow: 'none', WebkitAppearance: 'none' }}
            />
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Attach */}
              {!isStreaming && (
                <Tooltip content="Attach file (image, PDF, or text)">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-[#484848] transition-all w-9 h-9 flex items-center justify-center"
                    aria-label="Attach file"
                  >
                    <Paperclip size={16} />
                  </button>
                </Tooltip>
              )}
              {/* Send or Stop */}
              {isStreaming && !inputRef.current.trim() ? (
                <Tooltip content="Stop response">
                  <button
                    onClick={handleStop}
                    aria-label="Stop response"
                    className="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all w-9 h-9 flex items-center justify-center"
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={
                  inputRef.current.trim() || attachments.length > 0
                    ? 'Send message (Enter)'
                    : 'Type a message or attach a file to send'
                }>
                  <span>
                    <button
                      data-send-button
                      onClick={handleSend}
                      disabled={(!inputRef.current.trim() && attachments.length === 0) || switchingProvider}
                      aria-label={switchingProvider ? 'Switching provider — please wait' : 'Send message'}
                      className="p-2 text-white bg-primary-500 hover:bg-primary-600 disabled:bg-neutral-300 dark:disabled:bg-[#4a4a4a] disabled:text-neutral-400 dark:disabled:text-neutral-500 rounded-lg transition-all shadow-sm w-9 h-9 flex items-center justify-center"
                    >
                      {switchingProvider ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Model dropdown body — rendered at chat panel root so it anchors to
          the chat panel's `relative` (NOT the absolute sub-header). Mobile:
          fixed bottom strip. Desktop: anchored above the composer area. */}
      {showModelDropdown && (
        <>
          {/* Mobile-only backdrop — tap to dismiss */}
          <div
            className="sm:hidden fixed inset-0 bg-black/40 z-40 animate-fade-in"
            onClick={() => setShowModelDropdown(false)}
          />
          {/* Alignment wrapper — mirrors composer's `max-w-[820px] xl:max-w-[900px] mx-auto px-3 sm:px-2`
              so the inner dropdown panel's left edge tracks the composer's
              left edge dynamically. The bottom offset is composer height +
              12px so the dropdown floats just above the composer regardless
              of textarea growth. */}
          <div
            className="fixed inset-x-0 bottom-0 sm:absolute sm:bottom-[var(--composer-h,124px)] sm:max-w-[820px] xl:max-w-[900px] sm:mx-auto sm:px-2 z-50 sm:pointer-events-none"
            style={composerHeight > 0 ? { '--composer-h': `${composerHeight + 12}px` } : undefined}
          >
          <div ref={modelDropdownRef} className="max-h-[85vh] sm:max-h-[calc(100vh-200px)] w-auto sm:w-96 sm:max-w-full bg-white dark:bg-[#2c2c2c] border-t sm:border border-neutral-200 dark:border-[#484848] rounded-t-2xl sm:rounded-xl shadow-2xl animate-fade-in sm:pointer-events-auto pb-[env(safe-area-inset-bottom)] sm:pb-0 flex flex-col overflow-hidden">
            {/* Mobile drag handle */}
            <div className="sm:hidden flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
            </div>
            {/* Header */}
            <div className="px-3 pt-2.5 pb-2 border-b border-neutral-100 dark:border-[#484848]">
              <h3 className="text-[13px] font-bold text-neutral-900 dark:text-neutral-100">Select AI Provider</h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                Choose Pabbly default or one of your connected keys.{' '}
                <Tooltip content="Opens the AI Settings page where you can connect your own API keys (BYOK) and read about provider options"><Link to="/ai-settings" className="text-blue-600 dark:text-blue-400 underline decoration-[0.5px] decoration-blue-300 dark:decoration-blue-700 underline-offset-2 hover:decoration-blue-600 dark:hover:decoration-blue-400 hover:decoration-1 transition-colors font-medium">Learn more</Link></Tooltip>
              </p>
            </div>
            {/* Search bar */}
            <div className="px-3 py-2 border-b border-neutral-100 dark:border-[#484848]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  autoFocus
                  value={modelDropdownSearch}
                  onChange={(e) => setModelDropdownSearch(e.target.value)}
                  placeholder="Search providers and models…"
                  className="w-full pl-9 pr-9 py-2 text-[13px] bg-neutral-50 dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#484848] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 dark:focus:ring-primary-700 focus:border-primary-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                />
                {modelDropdownSearch && (
                  <button
                    type="button"
                    onClick={() => setModelDropdownSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-[#484848]"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {/* Pabbly Provider — always present */}
            {(!modelDropdownSearch || 'pabbly provider'.includes(modelDropdownSearch.toLowerCase())) && (
              <button
                onClick={() => {
                  // No-op when Pabbly Provider is already the active selection
                  // — `persistByokPreference` would otherwise re-trigger a
                  // backend POST + Pabbly Functions redeploy for nothing.
                  if (useSystemModel) {
                    setShowModelDropdown(false)
                    setExpandedDropdownProvider(null)
                    setModelDropdownSearch('')
                    return
                  }
                  const prev = { useSystemModel, selectedModel }
                  setUseSystemModel(true)
                  persistByokPreference(true, null, prev)
                  setShowModelDropdown(false)
                  setExpandedDropdownProvider(null)
                  setModelDropdownSearch('')
                }}
                className={`relative w-[calc(100%-1rem)] mx-2 mt-2 flex items-start gap-2.5 px-3 py-2 text-left rounded-xl border transition-all ${
                  useSystemModel
                    ? 'border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/20 shadow-md'
                    : 'border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#262626] hover:border-neutral-300 dark:hover:border-[#5a5a5a] shadow-sm'
                }`}
              >
                {useSystemModel && (
                  <div className="absolute top-1/2 right-2.5 -translate-y-1/2 leading-none">
                    <Tooltip content="Currently selected provider">
                      <Check size={14} className="text-primary-600 dark:text-primary-400" />
                    </Tooltip>
                  </div>
                )}
                <div className="w-8 h-8 rounded-lg bg-primary-100/70 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                  <img src="/favicon.svg" alt="Pabbly" className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0 pr-5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tooltip content="Run on Pabbly's managed AI model — billed in AI Credits from your wallet">
                      <span className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100 cursor-default">Pabbly Provider</span>
                    </Tooltip>
                    {creditsLeft != null && (
                      <Tooltip content="Your remaining AI Credit balance">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums cursor-default ${creditBadgeTone}`}>
                          {creditsLeft.toFixed(2)} AI Credits left
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                    <Tooltip content="Default option — used when no BYOK key is selected">
                      <span className="inline-flex items-center px-1.5 py-0.5 mr-1.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-[9px] font-bold uppercase tracking-wider cursor-default align-middle">Platform Default</span>
                    </Tooltip>
                    uses your AI Credits
                  </p>
                </div>
              </button>
            )}
            {/* BYOK provider sections — wrapped in flex-1 scrollable area
                so the heading, search box, and Pabbly Provider card above
                stay fixed; only the BYOK list scrolls. */}
            <div className="flex-1 overflow-y-auto min-h-0">
            {(() => {
              const PROVIDER_LABELS = {
                anthropic: 'Anthropic',
                openai: 'OpenAI',
                openrouter: 'OpenRouter',
                custom: 'OpenAI Compatible',
                google: 'Google',
                xai: 'xAI',
                mistral: 'Mistral',
                perplexity: 'Perplexity',
              }
              const q = modelDropdownSearch.trim().toLowerCase()
              const providerEntries = configuredProviders
                .filter((pid) => PROVIDER_LABELS[pid])
                .map((pid) => {
                  let list = []
                  if (pid === 'custom') {
                    if (customProviderKey?.model_id) {
                      const label = customProviderKey.provider_name
                        ? `${customProviderKey.provider_name} / ${customProviderKey.model_id}`
                        : customProviderKey.model_id
                      list = [{ id: customProviderKey.model_id, label }]
                    }
                  } else if (pid === 'openrouter') {
                    list = byokCatalog.filter(
                      (m) => m.source === 'openrouter' || (m.id || '').includes('/')
                    )
                  } else {
                    const nativeList = NATIVE_BY_PROVIDER[pid] || []
                    const seen = new Set(nativeList.map((m) => m.id))
                    list = [...nativeList]
                    for (const m of byokCatalog) {
                      if (m.providerId !== pid) continue
                      if ((m.id || '').includes('/')) continue
                      if (seen.has(m.id)) continue
                      seen.add(m.id)
                      list.push({ id: m.id, label: m.label })
                    }
                  }
                  if (q) {
                    list = list.filter((m) =>
                      (m.label || '').toLowerCase().includes(q) ||
                      (m.id || '').toLowerCase().includes(q)
                    )
                  }
                  return [pid, list]
                })
                .filter(([, list]) => list.length > 0)
              if (providerEntries.length === 0) {
                return (
                  <div className="px-4 py-4 text-[12px] text-neutral-500 dark:text-neutral-400 text-center bg-neutral-50/30 dark:bg-[#1a1a1a]/40">
                    {q
                      ? <>No models match "<span className="font-semibold">{modelDropdownSearch}</span>"</>
                      : <>Add an API key in <strong className="text-neutral-700 dark:text-neutral-200">AI Settings</strong> to use your own models</>}
                  </div>
                )
              }
              return (
                <>
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Your Connected Keys (BYOK)</span>
                  </div>
                  <div className="px-2 pb-2 space-y-2">
                    {providerEntries.map(([providerId, list]) => {
                      const isExpanded = q ? true : expandedDropdownProvider === providerId
                      const label = PROVIDER_LABELS[providerId] || providerId
                      const color = PROVIDER_COLORS[providerId]
                      return (
                        <div
                          key={providerId}
                          className={`rounded-xl border bg-white dark:bg-[#262626] overflow-hidden transition-all ${
                            isExpanded
                              ? 'border-neutral-300 dark:border-[#5a5a5a] shadow-md'
                              : 'border-neutral-200 dark:border-[#484848] hover:border-neutral-300 dark:hover:border-[#5a5a5a] shadow-sm'
                          }`}
                        >
                          <button
                            onClick={() => !q && setExpandedDropdownProvider(isExpanded ? null : providerId)}
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: (color || '#888') + '15', color: color || '#888' }}
                              >
                                <ProviderLogo providerId={providerId} fallbackLetter={label[0]} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Tooltip content={`Your own ${label} API key — usage is billed by ${label} directly, not from your AI Credits`}>
                                    <span className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100 truncate cursor-default">{label}</span>
                                  </Tooltip>
                                  <Tooltip content="API key validated and ready to use">
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold uppercase tracking-wider cursor-default">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                      Connected
                                    </span>
                                  </Tooltip>
                                </div>
                                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{list.length} model{list.length === 1 ? '' : 's'} available</p>
                              </div>
                            </div>
                            {!q && (
                              <ChevronDown size={16} className={`text-neutral-400 transition-transform flex-shrink-0 ml-2 ${isExpanded ? 'rotate-180' : ''}`} />
                            )}
                          </button>
                          {isExpanded && (() => {
                            const cap = q ? 200 : 50
                            const visible = list.slice(0, cap)
                            const overflow = list.length - visible.length
                            const providerConnections = (allKeys || []).filter((k) => {
                              const p = (k.provider || '').replace(/_oauth$/, '')
                              return p === providerId && k.is_active !== false
                            })
                            const isProviderActive = !useSystemModel && list.some((m) => m.id === selectedModel)
                            const defaultConnId = (
                              providerConnections.find((k) => k.is_default)?.id
                              || providerConnections[0]?.id
                              || null
                            )
                            return (
                              <div className="bg-neutral-50/40 dark:bg-[#1a1a1a]/30 relative">
                                {providerConnections.length > 1 && (
                                  <div className="px-3 pl-12 pt-2.5 pb-2.5 border-b border-neutral-100 dark:border-[#484848]">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1.5">Connection</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {providerConnections.map((conn) => {
                                        const localPick = (
                                          selectedConnectionId
                                          && providerConnections.some((c) => c.id === selectedConnectionId)
                                            ? selectedConnectionId
                                            : null
                                        )
                                        const isBound = localPick
                                          ? localPick === conn.id
                                          : (isProviderActive && conn.id === defaultConnId)
                                        return (
                                          <button
                                            key={conn.id}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setSelectedConnectionId(conn.id)
                                              if (isProviderActive) {
                                                const prev = { useSystemModel, selectedModel }
                                                persistByokPreference(false, selectedModel, prev, conn.id)
                                              }
                                            }}
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] border transition-colors ${
                                              isBound
                                                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 font-semibold shadow-sm'
                                                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 dark:border-[#484848] dark:bg-[#2c2c2c] dark:text-neutral-300 dark:hover:bg-[#383838]'
                                            }`}
                                            title={conn.key_hint ? `${conn.name || 'Unnamed'} · ${conn.key_hint}` : (conn.name || 'Unnamed')}
                                          >
                                            <span
                                              className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-400"
                                              aria-hidden="true"
                                            />
                                            <span className="truncate max-w-[160px]">{conn.name || 'Unnamed'}</span>
                                            {conn.is_default && (
                                              <span className={`text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${
                                                isBound
                                                  ? 'bg-white/15 text-white/90 dark:bg-neutral-900/15 dark:text-neutral-900/80'
                                                  : 'bg-neutral-100 text-neutral-500 dark:bg-[#383838] dark:text-neutral-400'
                                              }`}>
                                                DEF
                                              </span>
                                            )}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                <div className="relative max-h-[260px] overflow-y-auto">
                                <div
                                  className="absolute left-[26px] top-0 bottom-0 w-px"
                                  style={{ backgroundColor: (color || '#888') + '40' }}
                                  aria-hidden="true"
                                />
                                {visible.map((m) => {
                                  const isPicked = !useSystemModel && selectedModel === m.id
                                  return (
                                    <button
                                      key={m.id}
                                      onClick={() => {
                                        // Skip backend redeploy when this exact model
                                        // is already active.
                                        if (isPicked) {
                                          setShowModelDropdown(false)
                                          setModelDropdownSearch('')
                                          return
                                        }
                                        const prev = { useSystemModel, selectedModel }
                                        setSelectedModel(m.id)
                                        setUseSystemModel(false)
                                        const nextConn = (
                                          providerConnections.length > 1
                                            ? (selectedConnectionId
                                                && providerConnections.some((c) => c.id === selectedConnectionId)
                                                ? selectedConnectionId
                                                : defaultConnId)
                                            : null
                                        )
                                        if (nextConn !== null) {
                                          setSelectedConnectionId(nextConn)
                                        } else {
                                          setSelectedConnectionId(null)
                                        }
                                        persistByokPreference(false, m.id, prev, nextConn)
                                        setShowModelDropdown(false)
                                        setModelDropdownSearch('')
                                      }}
                                      className={`relative w-full flex items-center justify-between px-4 py-2 pl-12 text-left transition-colors ${
                                        isPicked
                                          ? 'bg-primary-50/60 dark:bg-primary-900/20'
                                          : 'hover:bg-white dark:hover:bg-[#383838]'
                                      }`}
                                    >
                                      <span
                                        className="absolute left-[22px] top-1/2 -translate-y-1/2 w-[9px] h-px"
                                        style={{ backgroundColor: (color || '#888') + '60' }}
                                        aria-hidden="true"
                                      />
                                      <span
                                        className="absolute left-[30px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ring-2 ring-white dark:ring-[#2c2c2c]"
                                        style={{ backgroundColor: isPicked ? (color || '#888') : (color || '#888') + '70' }}
                                        aria-hidden="true"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className={`text-[13px] truncate ${isPicked ? 'text-primary-700 dark:text-primary-300 font-semibold' : 'text-neutral-800 dark:text-neutral-200 font-medium'}`}>{m.label}</div>
                                        <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono truncate mt-0.5">{m.id}</div>
                                      </div>
                                      {isPicked && <Check size={14} className="text-primary-600 dark:text-primary-400 flex-shrink-0 ml-2" />}
                                    </button>
                                  )
                                })}
                                {overflow > 0 && (
                                  <div className="px-4 py-2 pl-12 text-[11px] text-neutral-400 dark:text-neutral-500 italic">
                                    + {overflow} more — type above to search all {list.length}
                                  </div>
                                )}
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}
            </div>
          </div>
          </div>
        </>
      )}

      {/* Full-screen file preview — opened when a chat attachment is clicked. */}
      {preview && (
        <FilePreviewModal
          files={preview.files}
          initialIndex={preview.initialIndex}
          onClose={() => setPreview(null)}
          onEditText={preview.onEditText}
        />
      )}
    </div>
  )
}

export default ChatPanel
