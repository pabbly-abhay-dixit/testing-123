import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { keysAPI } from '../services/api'
import { PROVIDER_NAMES, ProviderLogo } from '../utils/providerLogos'
import { useConfirm } from '../components/ui/ConfirmModal'
import Tooltip from '../components/ui/Tooltip'

/**
 * AI Settings — connection manager per provider.
 *
 * Each provider gets its own card. Inside: connection rows that expand to
 * an inline edit form, plus an "Add a new connection" dashed-icon row at
 * the bottom. Skeleton shimmer placeholders render while keys load so the
 * page reserves layout space and doesn't reflow when data arrives.
 *
 * All styling is Tailwind utilities — the previous V1Studio CSS injection
 * was converted to inline classes plus one custom keyframe (`shimmer` in
 * index.css) that drives the loading state's background-position animation.
 */

// Provider display order — Anthropic, Google (Gemini), OpenAI, OpenRouter.
// Custom (OpenAI Compatible) sits last via its own CustomSection.
const ALLOWED_PROVIDERS = ['anthropic', 'google', 'openai', 'openrouter']

const PROVIDER_META = {
  anthropic: {
    placeholder: 'sk-ant-api03-… or sk-ant-oat01-…',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    docsLabel: 'console.anthropic.com',
  },
  openai: {
    placeholder: 'sk-… or sk-proj-…',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'platform.openai.com',
  },
  google: {
    placeholder: 'AIza…',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'aistudio.google.com',
  },
  openrouter: {
    placeholder: 'sk-or-…',
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: 'openrouter.ai/keys',
  },
}

const MAX_NAME_LEN = 60

// Density / scaling thresholds for the connection list.
// COLLAPSE_THRESHOLD: above this count, extras are hidden behind a "Show N more" toggle.
// FILTER_THRESHOLD: above this count, a name/key-hint filter input renders in the section head.
const COLLAPSE_THRESHOLD = 5
const FILTER_THRESHOLD = 8

// Per-provider accent gradient applied to the row icon. The gradient itself
// is inline-styled (Tailwind can express it via arbitrary values but the
// readability is poor for 5 variants); each provider just supplies its
// `from` and `to` colors.
const ACCENT_BY_PROVIDER = {
  anthropic:  { from: '#d97757', to: '#b65d3f' },
  openai:     { from: '#1ec39a', to: '#0e9577' },
  google:     { from: '#5a8df0', to: '#3667d4' },
  openrouter: { from: '#7a73f0', to: '#5b53e0' },
  custom:     { from: '#6a64f0', to: '#4e47d6' },
}

// ─── Repeated class strings (Tailwind) ──────────────────────────────────────
// Kept as named constants to keep the JSX readable. Each chunk describes
// one repeated element of the V1Studio layout, fully expressed in Tailwind
// utilities (no custom CSS).
const CARD_CLS = 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-sm overflow-hidden'
const SECTION_HEAD_CLS = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2.5 pb-1.5'
const SECTION_TITLE_CLS = 'text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight'
const SECTION_META_CLS = 'text-xs text-neutral-500 dark:text-neutral-400'
const ROW_CLS = 'grid grid-cols-[36px_1fr_auto_24px] gap-3 items-center px-4 py-2.5 border-b border-neutral-200/60 dark:border-neutral-700/50 cursor-pointer transition-colors duration-150 hover:bg-neutral-100/40 dark:hover:bg-neutral-700/30'
const ROW_OPEN_CLS = 'bg-neutral-100/60 dark:bg-neutral-700/40'
const ICON_CLS = 'w-7 h-7 rounded-md grid place-items-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_5px_rgba(78,71,214,0.2)]'
const PANEL_CLS = 'grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out'
const PANEL_OPEN_CLS = 'grid-rows-[1fr]'
const FORM_CLS = 'overflow-hidden'  // wraps the actual form so the grid-rows 0→1fr clip works
const FORM_GRID_CLS = 'px-4 pt-2 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5'
const FIELD_CLS = 'flex flex-col gap-1.5'
const LABEL_CLS = 'text-[11px] tracking-wider uppercase text-neutral-500 dark:text-neutral-400 font-semibold flex gap-1.5 items-baseline'
const INPUT_CLS = 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2.5 text-[13.5px] font-medium font-mono text-neutral-900 dark:text-neutral-100 outline-none w-full transition-[border-color,box-shadow] duration-150 focus:border-indigo-600 focus:shadow-[0_0_0_3px_rgba(78,71,214,0.13)] placeholder:text-neutral-400 placeholder:font-normal'
// Button styles — restored to the previous compact outlined style used
// across the app: `px-3 py-1.5 text-sm rounded-xl` with provider-coded
// outlines (emerald=test, blue=save/update, red=remove/cancel) and a single
// solid-blue primary CTA for "Add new connection".
const BTN_CLS = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'
const BTN_PRIMARY_CLS = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'
const BTN_ACCENT_CLS = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-blue-600'
const BTN_DANGER_CLS = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl border border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent'
const BTN_GHOST_CLS = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100/60 dark:hover:bg-neutral-700/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
const ADD_ROW_CLS = 'grid grid-cols-[36px_1fr_24px] sm:grid-cols-[36px_1fr_auto_24px] gap-3 items-center px-4 py-2.5 cursor-pointer border-b border-neutral-200/60 dark:border-neutral-700/50 last:border-b-0 transition-colors duration-150 hover:bg-neutral-100/40 dark:hover:bg-neutral-700/30'
const ADD_ICON_CLS = 'w-7 h-7 rounded-md border border-dashed border-neutral-300 dark:border-neutral-600 grid place-items-center text-neutral-500 dark:text-neutral-400'
// Shimmer placeholders for the loading state. The `animate-shimmer` class
// is wired in index.css's `@theme` block.
const SKEL_CLS = 'inline-block rounded bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 dark:from-neutral-700 dark:via-neutral-600 dark:to-neutral-700 bg-[length:200%_100%] animate-shimmer'
const SKEL_ICON_CLS = 'w-7 h-7 rounded-md bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 dark:from-neutral-700 dark:via-neutral-600 dark:to-neutral-700 bg-[length:200%_100%] animate-shimmer'
const FILTER_INPUT_CLS = 'w-full px-3 py-1 text-[12px] bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 transition-colors'
const TOGGLE_ROW_CLS = 'w-full px-4 py-1.5 text-[11.5px] font-medium hover:bg-neutral-100/40 dark:hover:bg-neutral-700/30 border-b border-neutral-200/60 dark:border-neutral-700/50 transition-colors text-left flex items-center gap-1.5'

// ─────────────────────────────────────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function AISettings() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Pabbly AgenticAI | AI Settings'
    return () => { document.title = 'Pabbly AgenticAI' }
  }, [])

  const loadKeys = async () => {
    try {
      const res = await keysAPI.getAllFresh()
      setKeys(res.data?.keys || [])
    } catch {
      toast.error('Failed to load AI settings')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadKeys() }, [])

  return (
    <div className="p-3 sm:p-5 overflow-x-hidden">
      {/* Page header — Tailwind-styled, unchanged from the original AI Settings page. */}
      <div className="mb-2 sm:mb-3 min-w-0">
        <div className="flex items-center gap-2">
          <Tooltip content="Connect your own AI provider API keys">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-neutral-100 inline-block cursor-default">AI Settings</h1>
          </Tooltip>
          <Tooltip content="Bring Your Own Key — use your provider account instead of platform AI Credits">
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 text-[10px] font-semibold text-primary-700 dark:text-primary-400 uppercase tracking-wider">
              <Sparkles size={9} />
              BYOK
            </span>
          </Tooltip>
        </div>
        <p className="text-[12.5px] sm:text-[13px] text-gray-600 dark:text-neutral-400 mt-0.5 leading-snug">
          Connect your own API keys for Anthropic, OpenAI, Google, and OpenRouter. Save multiple
          named connections per provider and pick a default.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {/* First card shimmers as "one connection added"; the rest shimmer as empty (bottom AddRow). Mirrors the most common first-paint shape: one provider configured, the others not yet. */}
          {[1, 0, 0, 0, 0].map((rowCount, i) => <ProviderSkeleton key={i} rows={rowCount} />)}
        </div>
      ) : (
        <div className="space-y-2">
          {ALLOWED_PROVIDERS.map(provider => (
            <ProviderSection
              key={provider}
              provider={provider}
              connections={keys.filter(k => k.provider === provider).sort(sortConnections)}
              onReload={loadKeys}
            />
          ))}
          <CustomSection
            connections={keys.filter(k => k.provider === 'custom').sort(sortConnections)}
            onReload={loadKeys}
          />
        </div>
      )}
    </div>
  )
}

const sortConnections = (a, b) => {
  if (a.is_default && !b.is_default) return -1
  if (!a.is_default && b.is_default) return 1
  return new Date(a.created_at || 0) - new Date(b.created_at || 0)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Standard provider section (Anthropic / OpenAI / Google / OpenRouter)
// ─────────────────────────────────────────────────────────────────────────────
function ProviderSection({ provider, connections, onReload }) {
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [filter, setFilter] = useState('')
  const meta = PROVIDER_META[provider]
  const accent = ACCENT_BY_PROVIDER[provider] || ACCENT_BY_PROVIDER.custom
  const setOpen = (id) => { setOpenId(openId === id ? null : id); setAdding(false) }

  const { visible, filtered, hiddenCount, showFilter } = computeConnectionView(connections, filter, showAll)

  const hasConnections = connections.length > 0
  const toggleAdding = () => {
    if (adding) setAdding(false)
    else { setAdding(true); setOpenId(null) }
  }
  const addFormNode = adding && (
    <StandardAddForm
      provider={provider}
      meta={meta}
      existingNames={connections.map(c => c.name)}
      onCancel={() => setAdding(false)}
      onSaved={() => { setAdding(false); onReload() }}
    />
  )

  return (
    <section className={CARD_CLS}>
      <div className={SECTION_HEAD_CLS}>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <div className={SECTION_TITLE_CLS}>{PROVIDER_NAMES[provider]}</div>
          <div className={`${SECTION_META_CLS} truncate`}>
            {connections.length === 0 ? (
              'Not connected'
            ) : (
              <>
                {connections.length}{' '}
                <span className="sm:hidden">Conn{connections.length === 1 ? '' : 's'}</span>
                <span className="hidden sm:inline">connection{connections.length === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasConnections && (
            <CompactAddButton
              providerName={PROVIDER_NAMES[provider]}
              open={adding}
              onClick={toggleAdding}
            />
          )}
          {meta.docsUrl && <GetKeyButton url={meta.docsUrl} label={meta.docsLabel} />}
        </div>
      </div>

      {hasConnections && (
        <div className={`${PANEL_CLS} ${adding ? PANEL_OPEN_CLS : ''} ${adding ? 'border-b border-neutral-200/60 dark:border-neutral-700/50' : ''}`}>
          <div className={FORM_CLS}>{addFormNode}</div>
        </div>
      )}

      {showFilter && (
        <div className="px-4 pb-1.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${connections.length} ${PROVIDER_NAMES[provider]} connections…`}
            className={FILTER_INPUT_CLS}
          />
        </div>
      )}

      <div>
        {visible.map(conn => (
          <StandardRow
            key={conn.id}
            conn={conn}
            provider={provider}
            accent={accent}
            open={openId === conn.id}
            onToggle={() => setOpen(conn.id)}
            onReload={onReload}
          />
        ))}
        {filter.trim() && filtered.length === 0 && (
          <div className="px-4 py-2.5 text-[11.5px] text-neutral-500 dark:text-neutral-400 border-b border-neutral-200/60 dark:border-neutral-700/50">
            No connections match &ldquo;{filter}&rdquo;
          </div>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={`${TOGGLE_ROW_CLS} text-indigo-600 dark:text-indigo-400`}
          >
            <ChevronDown /> Show {hiddenCount} more {hiddenCount === 1 ? 'connection' : 'connections'}
          </button>
        )}
        {showAll && filtered.length > COLLAPSE_THRESHOLD && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className={`${TOGGLE_ROW_CLS} text-neutral-500 dark:text-neutral-400`}
          >
            <ChevronUp /> Show less
          </button>
        )}
        {!hasConnections && (
          <AddRow
            providerName={PROVIDER_NAMES[provider]}
            open={adding}
            onOpen={() => { setAdding(true); setOpenId(null) }}
            onClose={() => setAdding(false)}
          >
            {addFormNode}
          </AddRow>
        )}
      </div>
    </section>
  )
}

// Shared collapse + filter logic. When a filter is active, all matching
// rows render expanded (no collapse during search). Empty filter falls back
// to the slice-to-COLLAPSE_THRESHOLD behavior unless `showAll` is true.
// Plain function (not a hook) — runs synchronously inside each section's render.
function computeConnectionView(connections, filter, showAll) {
  const q = filter.trim().toLowerCase()
  const filtered = q
    ? connections.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.key_hint || '').toLowerCase().includes(q))
    : connections
  const showFilter = connections.length >= FILTER_THRESHOLD
  const collapsed = !showAll && !q && filtered.length > COLLAPSE_THRESHOLD
  const visible = collapsed ? filtered.slice(0, COLLAPSE_THRESHOLD) : filtered
  const hiddenCount = filtered.length - visible.length
  return { visible, filtered, hiddenCount, showFilter }
}

// ─── Standard row (single key field) ────────────────────────────────────────
function StandardRow({ conn, provider, accent, open, onToggle, onReload }) {
  const confirm = useConfirm()
  const [name, setName] = useState(conn.name || 'Default')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (open) { setName(conn.name || 'Default'); setApiKey(''); setResult(null) }
  }, [open, conn.id])

  const dirty = name.trim() !== (conn.name || '') || apiKey.trim().length > 0
  const canTest = apiKey.trim().length > 0 && !busy
  const canSave = dirty && !busy

  const handleTest = async () => {
    if (!canTest) return
    setBusy('test'); setResult(null)
    try {
      const t0 = performance.now()
      const res = await keysAPI.test({ provider, api_key: apiKey.trim() })
      const ms = Math.round(performance.now() - t0)
      if (res.data?.valid) setResult({ ok: true, ms })
      else setResult({ ok: false, msg: res.data?.message || 'Invalid' })
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Test failed' })
    } finally { setBusy(null) }
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy('save')
    try {
      if (apiKey.trim() && name.trim() === conn.name) {
        await keysAPI.create({ provider, api_key: apiKey.trim(), name: conn.name })
      } else if (apiKey.trim()) {
        await keysAPI.patch(conn.id, { name: name.trim() })
        await keysAPI.create({ provider, api_key: apiKey.trim(), name: name.trim() })
      } else {
        await keysAPI.patch(conn.id, { name: name.trim() })
      }
      toast.success('Saved')
      onReload()
      onToggle()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed')
    } finally { setBusy(null) }
  }

  const handleSetDefault = async () => {
    if (conn.is_default) return
    setBusy('default')
    try {
      await keysAPI.patch(conn.id, { is_default: true })
      toast.success(`"${conn.name}" is now default`)
      onReload()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed')
    } finally { setBusy(null) }
  }

  const handleRemove = async () => {
    const ok = await confirm({
      title: `Remove "${conn.name}"?`,
      message: 'This connection will be deleted. Workflows bound to it will fall back to the default.',
      confirmLabel: 'Remove', danger: true,
    })
    if (!ok) return
    setBusy('delete')
    try {
      await keysAPI.delete(conn.id)
      toast.success('Removed')
      onReload()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed')
    } finally { setBusy(null) }
  }

  return (
    <>
      <div className={`${ROW_CLS} ${open ? ROW_OPEN_CLS : ''}`} onClick={onToggle}>
        <div
          className={ICON_CLS}
          style={{ background: `linear-gradient(160deg, ${accent.from} 0%, ${accent.to} 100%)` }}
        >
          <ProviderLogo providerId={provider} fallbackLetter={PROVIDER_NAMES[provider]?.[0]} />
        </div>
        <div>
          <div className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 flex-wrap leading-tight">
            {conn.name || 'Default'}
            {conn.is_default && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold tracking-wider uppercase"><span className="sm:hidden">Def</span><span className="hidden sm:inline">Default</span></span>
            )}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0 font-mono break-all leading-tight">{conn.key_hint || '••••'}</div>
        </div>
        <div className="inline-flex gap-1 items-center text-[10.5px] font-semibold tracking-wider uppercase text-emerald-700 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Connected
        </div>
        <div className={`text-neutral-400 grid place-items-center transition-transform duration-200 ${open ? 'rotate-90 text-indigo-600 dark:text-indigo-400' : ''}`}>
          <ChevronRight />
        </div>
      </div>
      <div className={`${PANEL_CLS} ${open ? PANEL_OPEN_CLS : ''}`}>
        <div className={FORM_CLS}>
          <div className={FORM_GRID_CLS} onClick={(e) => e.stopPropagation()}>
            <div className={FIELD_CLS}>
              <div className={LABEL_CLS}>Connection name</div>
              <input className={`${INPUT_CLS} !font-sans`} value={name} maxLength={MAX_NAME_LEN}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className={FIELD_CLS}>
              <div className={LABEL_CLS}>
                API Key
                <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">leave blank to keep saved</em>
              </div>
              <div className="relative">
                <input className={`${INPUT_CLS} pr-10`} type={showKey ? 'text' : 'password'}
                  placeholder={`Saved · ${conn.key_hint || '••••'}`}
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <EyeToggle open={showKey} onClick={() => setShowKey(s => !s)} />
              </div>
            </div>
            <ActionsRow
              testBtn={{ disabled: !canTest, label: busy === 'test' ? 'Testing…' : 'Test', onClick: handleTest }}
              saveBtn={{ disabled: !canSave, label: busy === 'save' ? 'Saving…' : (dirty ? 'Save' : 'Saved'), onClick: handleSave }}
              extras={!conn.is_default && (
                <button className={BTN_CLS} onClick={handleSetDefault} disabled={busy === 'default'}>
                  {busy === 'default' ? 'Setting…' : 'Set as default'}
                </button>
              )}
              onCancel={onToggle}
              onRemove={handleRemove}
              removing={busy === 'delete'}
              result={result}
            />
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Standard add form ──────────────────────────────────────────────────────
function StandardAddForm({ provider, meta, existingNames, onCancel, onSaved }) {
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)

  const trimmedName = name.trim()
  const nameTaken = trimmedName && existingNames.some(n => (n || '').toLowerCase() === trimmedName.toLowerCase())
  const canTest = apiKey.trim() && !busy
  const canSave = apiKey.trim() && !nameTaken && !busy

  const handleTest = async () => {
    if (!canTest) return
    setBusy('test'); setResult(null)
    try {
      const t0 = performance.now()
      const res = await keysAPI.test({ provider, api_key: apiKey.trim() })
      const ms = Math.round(performance.now() - t0)
      if (res.data?.valid) setResult({ ok: true, ms })
      else setResult({ ok: false, msg: res.data?.message || 'Invalid' })
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Test failed' })
    } finally { setBusy(null) }
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy('save')
    try {
      const finalName = trimmedName || (existingNames.length === 0 ? 'Default' : `Connection ${existingNames.length + 1}`)
      await keysAPI.create({ provider, api_key: apiKey.trim(), name: finalName, is_default: existingNames.length === 0 })
      toast.success(`${PROVIDER_NAMES[provider]} connected`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed')
    } finally { setBusy(null) }
  }

  return (
    <div className={FORM_GRID_CLS} onClick={(e) => e.stopPropagation()}>
      <div className={FIELD_CLS}>
        <div className={LABEL_CLS}>
          Connection name
          <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">optional</em>
        </div>
        <input className={`${INPUT_CLS} !font-sans`}
          placeholder={existingNames.length === 0 ? 'Default' : `Connection ${existingNames.length + 1}`}
          value={name} maxLength={MAX_NAME_LEN}
          onChange={(e) => setName(e.target.value)} />
        {nameTaken && <span className="text-[11px] text-red-600">Already in use</span>}
      </div>
      <div className={FIELD_CLS}>
        <div className={LABEL_CLS}>API Key <span className="text-red-600">*</span></div>
        <div className="relative">
          <input className={`${INPUT_CLS} pr-10`} type={showKey ? 'text' : 'password'}
            placeholder={meta.placeholder} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} />
          <EyeToggle open={showKey} onClick={() => setShowKey(s => !s)} />
        </div>
      </div>
      <AddActionsRow
        testBtn={{ disabled: !canTest, label: busy === 'test' ? 'Testing…' : 'Test', onClick: handleTest }}
        saveBtn={{ disabled: !canSave, label: busy === 'save' ? 'Saving…' : 'Save', onClick: handleSave }}
        onCancel={onCancel}
        result={result}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Custom (OpenAI-compatible) section
// ─────────────────────────────────────────────────────────────────────────────
function CustomSection({ connections, onReload }) {
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [filter, setFilter] = useState('')
  const setOpen = (id) => { setOpenId(openId === id ? null : id); setAdding(false) }

  const { visible, filtered, hiddenCount, showFilter } = computeConnectionView(connections, filter, showAll)

  const hasConnections = connections.length > 0
  const toggleAdding = () => {
    if (adding) setAdding(false)
    else { setAdding(true); setOpenId(null) }
  }
  const addFormNode = adding && (
    <CustomAddForm
      existingNames={connections.map(c => c.name)}
      onCancel={() => setAdding(false)}
      onSaved={() => { setAdding(false); onReload() }}
    />
  )

  return (
    <section className={CARD_CLS}>
      <div className={SECTION_HEAD_CLS}>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <div className={SECTION_TITLE_CLS}>OpenAI Compatible</div>
          <div className={`${SECTION_META_CLS} truncate`}>
            {connections.length === 0 ? (
              'Not connected'
            ) : (
              <>
                {connections.length}{' '}
                <span className="sm:hidden">Conn{connections.length === 1 ? '' : 's'}</span>
                <span className="hidden sm:inline">connection{connections.length === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasConnections && (
            <CompactAddButton
              providerName="OpenAI-compatible"
              open={adding}
              onClick={toggleAdding}
            />
          )}
        </div>
      </div>

      {hasConnections && (
        <div className={`${PANEL_CLS} ${adding ? PANEL_OPEN_CLS : ''} ${adding ? 'border-b border-neutral-200/60 dark:border-neutral-700/50' : ''}`}>
          <div className={FORM_CLS}>{addFormNode}</div>
        </div>
      )}

      {showFilter && (
        <div className="px-4 pb-1.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${connections.length} custom connections…`}
            className={FILTER_INPUT_CLS}
          />
        </div>
      )}

      <div>
        {visible.map(conn => (
          <CustomRow
            key={conn.id}
            conn={conn}
            open={openId === conn.id}
            onToggle={() => setOpen(conn.id)}
            onReload={onReload}
          />
        ))}
        {filter.trim() && filtered.length === 0 && (
          <div className="px-4 py-2.5 text-[11.5px] text-neutral-500 dark:text-neutral-400 border-b border-neutral-200/60 dark:border-neutral-700/50">
            No connections match &ldquo;{filter}&rdquo;
          </div>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={`${TOGGLE_ROW_CLS} text-indigo-600 dark:text-indigo-400`}
          >
            <ChevronDown /> Show {hiddenCount} more {hiddenCount === 1 ? 'connection' : 'connections'}
          </button>
        )}
        {showAll && filtered.length > COLLAPSE_THRESHOLD && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className={`${TOGGLE_ROW_CLS} text-neutral-500 dark:text-neutral-400`}
          >
            <ChevronUp /> Show less
          </button>
        )}
        {!hasConnections && (
          <AddRow
            providerName="OpenAI-compatible"
            open={adding}
            onOpen={() => { setAdding(true); setOpenId(null) }}
            onClose={() => setAdding(false)}
          >
            {addFormNode}
          </AddRow>
        )}
      </div>
    </section>
  )
}

// ─── Custom row (5 fields) ──────────────────────────────────────────────────
function CustomRow({ conn, open, onToggle, onReload }) {
  const confirm = useConfirm()
  const accent = ACCENT_BY_PROVIDER.custom
  const [draft, setDraft] = useState(toDraft(conn))
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  useEffect(() => { if (open) { setDraft(toDraft(conn)); setResult(null) } }, [open, conn.id])

  const dirty =
    draft.name !== (conn.name || '') ||
    draft.baseUrl !== (conn.base_url || '') ||
    draft.modelId !== (conn.model_id || '') ||
    draft.authPrefix !== (conn.auth_header_prefix || 'Bearer') ||
    draft.apiKey.trim().length > 0
  const canTest = draft.apiKey.trim() && draft.baseUrl.trim() && draft.modelId.trim() && !busy
  const canSave = draft.baseUrl.trim() && draft.modelId.trim() && dirty && !busy

  const handleTest = async () => {
    if (!canTest) return
    setBusy('test'); setResult(null)
    try {
      const t0 = performance.now()
      const res = await keysAPI.test({
        provider: 'custom',
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model_id: draft.modelId.trim(),
        auth_header_prefix: draft.authPrefix.trim() || 'Bearer',
      })
      const ms = Math.round(performance.now() - t0)
      if (res.data?.valid) setResult({ ok: true, ms })
      else setResult({ ok: false, msg: res.data?.message || 'Invalid' })
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Test failed' })
    } finally { setBusy(null) }
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy('save')
    try {
      const newName = draft.name.trim() || conn.name
      if (newName !== conn.name) {
        await keysAPI.patch(conn.id, { name: newName })
      }
      await keysAPI.create({
        provider: 'custom',
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model_id: draft.modelId.trim(),
        auth_header_prefix: draft.authPrefix.trim() || 'Bearer',
        provider_name: newName,
        name: newName,
      })
      toast.success('Saved')
      onReload()
      onToggle()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed')
    } finally { setBusy(null) }
  }

  const handleSetDefault = async () => {
    if (conn.is_default) return
    setBusy('default')
    try {
      await keysAPI.patch(conn.id, { is_default: true })
      toast.success(`"${conn.name}" is now default`)
      onReload()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed')
    } finally { setBusy(null) }
  }

  const handleRemove = async () => {
    const ok = await confirm({
      title: `Remove "${conn.name}"?`,
      message: 'This connection will be deleted. Workflows bound to it will fall back to the default.',
      confirmLabel: 'Remove', danger: true,
    })
    if (!ok) return
    setBusy('delete')
    try {
      await keysAPI.delete(conn.id)
      toast.success('Removed')
      onReload()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed')
    } finally { setBusy(null) }
  }

  return (
    <>
      <div
        className={`cursor-pointer transition-colors duration-150 hover:bg-neutral-100/40 dark:hover:bg-neutral-700/30 border-b border-neutral-200/60 dark:border-neutral-700/50 ${open ? ROW_OPEN_CLS : ''}`}
        onClick={onToggle}
      >
        <div className="grid grid-cols-[36px_1fr_auto_24px] gap-x-3 gap-y-0.5 items-center px-4 py-2.5">
          <div
            className={`${ICON_CLS} row-span-2 sm:row-span-1 self-center`}
            style={{ background: `linear-gradient(160deg, ${accent.from} 0%, ${accent.to} 100%)` }}
          >
            <ZapIcon />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 flex-wrap leading-tight">
              {conn.name || 'Custom'}
              {conn.is_default && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold tracking-wider uppercase"><span className="sm:hidden">Def</span><span className="hidden sm:inline">Default</span></span>
              )}
            </div>
            {/* Desktop: model_id inline under the name */}
            <div className="hidden sm:block text-[11px] text-neutral-500 dark:text-neutral-400 mt-0 font-mono break-all leading-tight">{conn.model_id || '—'}</div>
          </div>
          <div className="inline-flex gap-1 items-center text-[10.5px] font-semibold tracking-wider uppercase text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Connected
          </div>
          <div className={`text-neutral-400 grid place-items-center transition-transform duration-200 ${open ? 'rotate-90 text-indigo-600 dark:text-indigo-400' : ''}`}>
            <ChevronRight />
          </div>
          {/* Mobile: model_id as a second row spanning cols 2–4. Icon's grid-row:1/-1 lets it span both rows so it stays vertically centered. */}
          <div className="sm:hidden col-span-3 text-[11px] text-neutral-500 dark:text-neutral-400 font-mono break-all leading-tight">
            {conn.model_id || '—'}
          </div>
        </div>
      </div>
      <div className={`${PANEL_CLS} ${open ? PANEL_OPEN_CLS : ''}`}>
        <div className={FORM_CLS}>
          <div className={FORM_GRID_CLS} onClick={(e) => e.stopPropagation()}>
            <div className={FIELD_CLS}>
              <div className={LABEL_CLS}>
                Connection name
                <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">optional</em>
              </div>
              <input className={`${INPUT_CLS} !font-sans`} value={draft.name} maxLength={MAX_NAME_LEN}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className={FIELD_CLS}>
              <div className={LABEL_CLS}>
                Auth Header Prefix
                <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">default: Bearer</em>
              </div>
              <input className={INPUT_CLS} value={draft.authPrefix}
                onChange={(e) => setDraft({ ...draft, authPrefix: e.target.value })} />
            </div>
            <div className={`${FIELD_CLS} sm:col-span-2`}>
              <div className={LABEL_CLS}>Base URL <span className="text-red-600">*</span></div>
              <input className={INPUT_CLS} value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
            </div>
            <div className={`${FIELD_CLS} sm:col-span-2`}>
              <div className={LABEL_CLS}>
                API Key
                <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">leave blank to keep saved · {conn.key_hint || '••••'}</em>
              </div>
              <div className="relative">
                <input className={`${INPUT_CLS} pr-10`} type={showKey ? 'text' : 'password'}
                  placeholder="Provider's API key" value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
                <EyeToggle open={showKey} onClick={() => setShowKey(s => !s)} />
              </div>
            </div>
            <div className={`${FIELD_CLS} sm:col-span-2`}>
              <div className={LABEL_CLS}>Model ID <span className="text-red-600">*</span></div>
              <input className={INPUT_CLS} value={draft.modelId}
                onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} />
            </div>
            <ActionsRow
              testBtn={{ disabled: !canTest, label: busy === 'test' ? 'Testing…' : 'Test', onClick: handleTest }}
              saveBtn={{ disabled: !canSave, label: busy === 'save' ? 'Saving…' : (dirty ? 'Save' : 'Saved'), onClick: handleSave }}
              extras={!conn.is_default && (
                <button className={BTN_CLS} onClick={handleSetDefault} disabled={busy === 'default'}>
                  {busy === 'default' ? 'Setting…' : 'Set as default'}
                </button>
              )}
              onCancel={onToggle}
              onRemove={handleRemove}
              removing={busy === 'delete'}
              result={result}
            />
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Custom add form ────────────────────────────────────────────────────────
function CustomAddForm({ existingNames, onCancel, onSaved }) {
  const [draft, setDraft] = useState({ name: '', authPrefix: 'Bearer', baseUrl: '', apiKey: '', modelId: '' })
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)

  const trimmedName = draft.name.trim()
  const nameTaken = trimmedName && existingNames.some(n => (n || '').toLowerCase() === trimmedName.toLowerCase())
  const canTest = draft.apiKey.trim() && draft.baseUrl.trim() && draft.modelId.trim() && !busy
  const canSave = canTest && !nameTaken

  const handleTest = async () => {
    if (!canTest) return
    setBusy('test'); setResult(null)
    try {
      const t0 = performance.now()
      const res = await keysAPI.test({
        provider: 'custom',
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model_id: draft.modelId.trim(),
        auth_header_prefix: draft.authPrefix.trim() || 'Bearer',
      })
      const ms = Math.round(performance.now() - t0)
      if (res.data?.valid) setResult({ ok: true, ms })
      else setResult({ ok: false, msg: res.data?.message || 'Invalid' })
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Test failed' })
    } finally { setBusy(null) }
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy('save')
    try {
      const name = trimmedName || (existingNames.length === 0 ? 'Default' : `Connection ${existingNames.length + 1}`)
      await keysAPI.create({
        provider: 'custom',
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model_id: draft.modelId.trim(),
        auth_header_prefix: draft.authPrefix.trim() || 'Bearer',
        provider_name: name,
        name,
        is_default: existingNames.length === 0,
      })
      toast.success(`${name} connected`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed')
    } finally { setBusy(null) }
  }

  return (
    <div className={FORM_GRID_CLS} onClick={(e) => e.stopPropagation()}>
      <div className={FIELD_CLS}>
        <div className={LABEL_CLS}>
          Connection name
          <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">optional</em>
        </div>
        <input className={`${INPUT_CLS} !font-sans`} placeholder="e.g. Friendli, Together, Baseten"
          value={draft.name} maxLength={MAX_NAME_LEN}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {nameTaken && <span className="text-[11px] text-red-600">Already in use</span>}
      </div>
      <div className={FIELD_CLS}>
        <div className={LABEL_CLS}>
          Auth Header Prefix
          <em className="not-italic text-neutral-400 dark:text-neutral-500 font-normal text-[11.5px] normal-case tracking-normal">default: Bearer</em>
        </div>
        <input className={INPUT_CLS} value={draft.authPrefix}
          onChange={(e) => setDraft({ ...draft, authPrefix: e.target.value })} />
      </div>
      <div className={`${FIELD_CLS} sm:col-span-2`}>
        <div className={LABEL_CLS}>Base URL <span className="text-red-600">*</span></div>
        <input className={INPUT_CLS} placeholder="https://api.friendli.ai/serverless/v1"
          value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
      </div>
      <div className={`${FIELD_CLS} sm:col-span-2`}>
        <div className={LABEL_CLS}>API Key <span className="text-red-600">*</span></div>
        <div className="relative">
          <input className={`${INPUT_CLS} pr-10`} type={showKey ? 'text' : 'password'}
            placeholder="Provider's API key" value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
          <EyeToggle open={showKey} onClick={() => setShowKey(s => !s)} />
        </div>
      </div>
      <div className={`${FIELD_CLS} sm:col-span-2`}>
        <div className={LABEL_CLS}>Model ID <span className="text-red-600">*</span></div>
        <input className={INPUT_CLS} placeholder="e.g. accounts/fireworks/models/qwen3p6-plus"
          value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} />
      </div>
      <AddActionsRow
        testBtn={{ disabled: !canTest, label: busy === 'test' ? 'Testing…' : 'Test', onClick: handleTest }}
        saveBtn={{ disabled: !canSave, label: busy === 'save' ? 'Saving…' : 'Save', onClick: handleSave }}
        onCancel={onCancel}
        result={result}
      />
    </div>
  )
}

// ─── "Get key" plain link — opens the provider's API-keys page ─────────────
function GetKeyButton({ url, label }) {
  return (
    <Tooltip content={`Opens ${label} in a new tab`}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        Get key
        <ExternalLinkIcon />
      </a>
    </Tooltip>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Compact add-new pill rendered in the section header ───────────────────
// Shown when connections.length >= 1. For the empty state we still render the
// full-width AddRow below — it earns its space by teaching first-time users
// what to do.
function CompactAddButton({ providerName, open, onClick }) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border border-dashed transition-colors'
  const idle = 'border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10'
  const active = 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10'
  return (
    <Tooltip content={`Add another ${providerName} connection · press N`}>
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${open ? active : idle}`}
        aria-label={open ? `Cancel new ${providerName} connection` : `Add new ${providerName} connection`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {open ? 'Cancel' : 'Add'}
      </button>
    </Tooltip>
  )
}

// ─── Shared add row (CTA + expanded form host) ──────────────────────────────
function AddRow({ providerName, open, onOpen, onClose, children }) {
  return (
    <>
      <div className={`${ADD_ROW_CLS} ${open ? ROW_OPEN_CLS : ''}`} onClick={open ? onClose : onOpen}>
        <div className={ADD_ICON_CLS}>
          <PlusIcon />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 leading-tight">
            {open ? `New ${providerName} connection` : 'Add a new connection'}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0 leading-tight truncate">
            {open ? 'Fill in the details and save' : `Save another ${providerName} key under a different name`}
          </div>
        </div>
        <span className="hidden sm:inline-block font-mono text-[11px] font-medium bg-neutral-100/80 dark:bg-neutral-700/40 border border-neutral-200 dark:border-neutral-600 px-1.5 py-0.5 rounded text-neutral-600 dark:text-neutral-400">N</span>
        <div className={`text-neutral-400 grid place-items-center transition-transform duration-200 ${open ? 'rotate-90 text-indigo-600 dark:text-indigo-400' : ''}`}>
          <ChevronRight />
        </div>
      </div>
      <div className={`${PANEL_CLS} ${open ? PANEL_OPEN_CLS : ''}`}>
        <div className={FORM_CLS}>{children}</div>
      </div>
    </>
  )
}

// ─── Actions row reused inside connection edit panels ───────────────────────
function ActionsRow({ testBtn, saveBtn, extras, onCancel, onRemove, removing, result }) {
  return (
    <div className="col-span-full flex flex-wrap gap-2.5 items-center pt-1.5">
      <button className={BTN_CLS} onClick={testBtn.onClick} disabled={testBtn.disabled}>{testBtn.label}</button>
      <button className={BTN_PRIMARY_CLS} onClick={saveBtn.onClick} disabled={saveBtn.disabled}>{saveBtn.label}</button>
      {extras}
      <button className={BTN_GHOST_CLS} onClick={onCancel}>Cancel</button>
      {result && <ResultPill ok={result.ok} ms={result.ms} msg={result.msg} />}
      <span className="flex-1" />
      <button className={BTN_DANGER_CLS} onClick={onRemove} disabled={removing}>
        {removing ? 'Removing…' : 'Remove'}
      </button>
    </div>
  )
}

// ─── Actions row reused inside add-new form ─────────────────────────────────
function AddActionsRow({ testBtn, saveBtn, onCancel, result }) {
  return (
    <div className="col-span-full flex flex-wrap gap-2.5 items-center pt-1.5">
      <button className={BTN_CLS} onClick={testBtn.onClick} disabled={testBtn.disabled}>{testBtn.label}</button>
      <button className={BTN_ACCENT_CLS} onClick={saveBtn.onClick} disabled={saveBtn.disabled}>{saveBtn.label}</button>
      <button className={BTN_GHOST_CLS} onClick={onCancel}>Cancel</button>
      {result && <ResultPill ok={result.ok} ms={result.ms} msg={result.msg} />}
    </div>
  )
}

function ResultPill({ ok, ms, msg }) {
  return (
    <span className={`text-[12.5px] px-2.5 py-1.5 rounded ${ok ? 'bg-emerald-100/60 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-100/60 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
      {ok ? `✓ Reachable · ${ms}ms` : `✗ ${msg}`}
    </span>
  )
}

// ─── Skeleton loader ────────────────────────────────────────────────────────
function ProviderSkeleton({ rows = 1, withAddRow = rows === 0 }) {
  return (
    <section className={CARD_CLS} aria-busy="true" aria-label="Loading provider connections">
      <div className={SECTION_HEAD_CLS}>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className={SKEL_CLS} style={{ width: 90, height: 14 }} />
          <span className={SKEL_CLS} style={{ width: 50, height: 11 }} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {rows > 0 && <span className={SKEL_CLS} style={{ width: 52, height: 20, borderRadius: 6 }} />}
          <span className={SKEL_CLS} style={{ width: 48, height: 12 }} />
        </div>
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-[36px_1fr_auto_24px] gap-x-3 items-center px-4 py-2.5 border-b border-neutral-200/60 dark:border-neutral-700/50">
            <span className={SKEL_ICON_CLS} />
            <div className="min-w-0">
              <span className={SKEL_CLS} style={{ display: 'block', width: 'min(60%, 130px)', height: 13 }} />
              <span className={SKEL_CLS} style={{ display: 'block', width: 'min(80%, 200px)', height: 10, marginTop: 6 }} />
            </div>
            <span className={SKEL_CLS} style={{ width: 60, height: 10 }} />
            <span className={SKEL_CLS} style={{ width: 12, height: 12, borderRadius: '50%' }} />
          </div>
        ))}
        {withAddRow && (
          <div className="grid grid-cols-[36px_1fr_24px] sm:grid-cols-[36px_1fr_auto_24px] gap-x-3 items-center px-4 py-2.5">
            <span className="w-7 h-7 rounded-md border border-dashed border-neutral-300 dark:border-neutral-600" />
            <div className="min-w-0">
              <span className={SKEL_CLS} style={{ display: 'block', width: 'min(65%, 150px)', height: 13 }} />
              <span className={SKEL_CLS} style={{ display: 'block', width: 'min(85%, 240px)', height: 10, marginTop: 6 }} />
            </div>
            <span className={`${SKEL_CLS} hidden sm:inline-block`} style={{ width: 20, height: 18 }} />
            <span className={SKEL_CLS} style={{ width: 12, height: 12, borderRadius: '50%' }} />
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function toDraft(conn) {
  return {
    name: conn.name || '',
    authPrefix: conn.auth_header_prefix || 'Bearer',
    baseUrl: conn.base_url || '',
    apiKey: '',
    modelId: conn.model_id || '',
  }
}

// ─── Icons ──────────────────────────────────────────────────────────────────
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function EyeToggle({ open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-indigo-600 rounded"
      tabIndex={-1}
      aria-label={open ? 'Hide key' : 'Show key'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        {!open && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      </svg>
    </button>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
function ZapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" />
    </svg>
  )
}
