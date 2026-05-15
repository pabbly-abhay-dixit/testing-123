import { useEffect, useState, useCallback, useRef } from 'react'
import { X, FileText, Copy, Check, Pencil } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

// Resolve file src — prepend API_BASE to relative URLs so backend proxy routes work.
//
// PDF + dataUrl special case: a `data:application/pdf;base64,...` string blows
// past Chromium's iframe data-URL size cap (~2 MB practical) for PDFs of 3 MB+.
// The iframe silently renders blank. We can't render the dataUrl directly, so
// the caller MUST use the blob-URL flow below (see `useEffect` in the
// component) — this helper only handles the cheap cases (R2 URL, image
// dataUrl, plain HTTP/HTTPS).
const resolveSrc = (file) => {
  if (file?.dataUrl) return file.dataUrl
  const url = file?.url
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  return `${API_BASE}${url.startsWith('/') ? url : '/' + url}`
}

// Decode a `data:<mime>;base64,<b64>` URL into a Blob URL. PDFs over ~2 MB
// can't render via `<iframe src="data:...">` (Chromium memory cap), so we
// rewrite the dataUrl into an in-memory Blob. Blob URLs have no size cap.
// Caller MUST `URL.revokeObjectURL` on cleanup or memory leaks accumulate.
const dataUrlToBlobUrl = (dataUrl) => {
  try {
    const [meta, b64] = dataUrl.split(',', 2)
    if (!b64) return null
    const mimeMatch = meta.match(/^data:([^;]+)/)
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
    const bin = atob(b64)
    const len = bin.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return null
  }
}

/**
 * FilePreviewModal — Full-screen preview for chat attachments.
 * Supports images (img), PDFs (iframe), with prev/next for multi-file arrays.
 *
 * Props:
 *   files        — array of { url?, dataUrl?, mimeType, name? }
 *   initialIndex — index of file to show first (default 0)
 *   onClose      — called when user dismisses (backdrop click, ESC, close button)
 */
export default function FilePreviewModal({ files = [], initialIndex = 0, onClose, onEditText }) {
  // Single-file UX — only the clicked file is ever shown. If callers pass
  // more, we just render the first at `initialIndex`. No prev/next, no count.
  const index = Math.max(0, Math.min(initialIndex, Math.max(files.length - 1, 0)))
  const [textContent, setTextContent] = useState(null)
  const [textLoading, setTextLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  // Edit-mode state for text attachments. Activated by clicking the pencil
  // button — only rendered when the parent passed an `onEditText` callback
  // (composer-staged attachments only; sent-message attachments are read-only).
  const [isEditing, setIsEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  // Captured card dimensions at the moment Edit was clicked. Without this,
  // switching `<pre>` (intrinsic-sized to long content) → `<textarea>` (no
  // intrinsic size, parent uses `sm:w-auto sm:h-auto`) collapses the card to
  // a small box. Freezing the size keeps the editor visually aligned with the
  // preview the user just clicked away from.
  const [frozenSize, setFrozenSize] = useState(null)
  const cardRef = useRef(null)
  const file = files[index]
  // Reset edit state whenever the file under preview changes (file swap or close).
  useEffect(() => { setIsEditing(false); setDraftText(''); setFrozenSize(null) }, [index])

  const handleCopyText = useCallback(async () => {
    if (!textContent) return
    try {
      await navigator.clipboard.writeText(textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback for non-secure contexts (http://) where Clipboard API is blocked
      const ta = document.createElement('textarea')
      ta.value = textContent
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* give up */ }
      document.body.removeChild(ta)
    }
  }, [textContent])

  // Image zoom/pan state — wheel-to-zoom (0.5× .. 6×), drag-to-pan while
  // zoomed, double-click to toggle fit ↔ 2×. Resets on file change.
  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 6
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [index])

  const onImageWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + delta * (z < 1.5 ? 1 : z * 0.8)).toFixed(3))))
  }, [])

  const onImageMouseDown = useCallback((e) => {
    if (zoom <= 1) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }, [zoom, pan.x, pan.y])

  const onImageMouseMove = useCallback((e) => {
    if (!dragRef.current) return
    e.preventDefault()
    const d = dragRef.current
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
  }, [])

  const onImageMouseUp = useCallback(() => { dragRef.current = null }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onImageMouseMove)
    window.addEventListener('mouseup', onImageMouseUp)
    return () => {
      window.removeEventListener('mousemove', onImageMouseMove)
      window.removeEventListener('mouseup', onImageMouseUp)
    }
  }, [onImageMouseMove, onImageMouseUp])

  const onImageDoubleClick = useCallback((e) => {
    e.stopPropagation()
    setZoom((z) => (z > 1 ? 1 : 2))
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const baseSrc = file ? resolveSrc(file) : ''
  const mime = file ? (file.mimeType || file.mime_type || '') : ''

  // PDF + base64 dataUrl → rewrite to Blob URL. Without this, large PDFs
  // (>~2 MB) render as a blank iframe because Chromium refuses to load big
  // `data:` URLs into a viewer frame. Blob URLs sidestep the cap entirely.
  // Lives in state + useEffect so we can revoke the URL on file change /
  // modal close — leaking blob URLs accumulates memory across sessions.
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  useEffect(() => {
    if (!file) return
    const isPdf = (file.mimeType || file.mime_type) === 'application/pdf'
    if (!isPdf || !file.dataUrl) {
      setPdfBlobUrl(null)
      return
    }
    const blobUrl = dataUrlToBlobUrl(file.dataUrl)
    if (!blobUrl) {
      setPdfBlobUrl(null)
      return
    }
    setPdfBlobUrl(blobUrl)
    return () => URL.revokeObjectURL(blobUrl)
  }, [file])

  const src = pdfBlobUrl || baseSrc
  // Real filename if present; otherwise fall back to a minimal plural-aware
  // label used only for a11y. See `hasRealName` — when the user never gave
  // the file a name, we hide the on-screen label entirely and let the
  // preview itself be the whole UI (Claude-style minimal chrome).
  const hasRealName = typeof file?.name === 'string' && file.name.length > 0
  const name = hasRealName
    ? file.name
    : (files.length > 1 ? 'Attachments' : 'Attachment')
  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  // Mirror frontend `ChatPanel::isTextLikeMime` and backend
  // `llm.rs::is_text_like_mime` — text/* plus the structured-text MIMEs we
  // accept in chat. Kept inline (instead of imported) because this modal is
  // also reused in surfaces that don't ship ChatPanel.
  const isText =
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/x-ndjson'

  // Load text content when previewing a text attachment
  useEffect(() => {
    if (!file || !isText) {
      setTextContent(null)
      return
    }
    // If we have in-memory text (from paste handler), use it directly
    if (file.text) {
      setTextContent(file.text)
      return
    }
    // Else fetch and decode
    setTextLoading(true)
    setTextContent(null)
    fetch(src)
      .then((r) => r.text())
      .then((t) => setTextContent(t))
      .catch(() => setTextContent('Failed to load text content.'))
      .finally(() => setTextLoading(false))
  }, [src, isText, file])

  if (!file) return null

  return (
    <div
      // Theme-aware backdrop. Lighter in both modes — the file is the star;
      // the backdrop just darkens the surroundings enough to focus attention
      // without fully obscuring the page behind. Tuned so the difference
      // between light and dark mode matches the rest of the app chrome.
      className="fixed inset-0 z-[9999] flex flex-col bg-black/45 dark:bg-black/70"
      onClick={onClose}
    >
      {/* Content area. Generous mobile vertical padding (py-12) so taps above
          and below the file reach the backdrop and close the modal. Desktop
          uses symmetric p-8. NO stopPropagation on this outer flex container
          so clicks in the empty padding bubble up to the backdrop. */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-3 py-12 sm:p-8">
        {/* Close button — positioned relative to the content wrapper so it
            visually anchors to the file itself rather than the viewport
            corner. Pill style with subtle backdrop so it reads as "dismiss
            this preview" regardless of what's behind it (image edge, text
            card, empty backdrop). */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose?.() }}
          className="absolute top-2 right-2 sm:top-3 sm:right-3 z-30 p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white/90 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          title="Close"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {isImage && (
          <>
            <img
              src={src}
              alt={name}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={onImageDoubleClick}
              onWheel={onImageWheel}
              onMouseDown={onImageMouseDown}
              draggable={false}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none"
              style={{
                background: '#1a1a1a',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
                cursor: zoom > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
              }}
            />
            {zoom !== 1 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-medium backdrop-blur-sm pointer-events-none"
              >
                {Math.round(zoom * 100)}%
              </div>
            )}
          </>
        )}
        {isPdf && (
          <iframe
            src={src}
            title={name}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full max-w-full max-h-full bg-white rounded-lg shadow-2xl border-0"
          />
        )}
        {isText && (
          <div
            ref={cardRef}
            onClick={(e) => e.stopPropagation()}
            // Mobile: cap height so there's tap-to-close space ABOVE and BELOW
            // the text card (not just the sides). Desktop: 720 px cap with
            // generous empty backdrop on all sides. While editing, dimensions
            // are frozen via inline style (captured on Edit click) so the
            // textarea fills exactly the same footprint as the preview.
            className={
              isEditing
                ? 'relative bg-white dark:bg-[#1e1e1e] rounded-lg shadow-2xl flex flex-col overflow-hidden'
                : 'relative w-full max-h-[70vh] sm:w-auto sm:h-auto sm:max-w-[720px] sm:max-h-[85vh] sm:min-w-[360px] sm:min-h-[320px] bg-white dark:bg-[#1e1e1e] rounded-lg shadow-2xl flex flex-col overflow-hidden'
            }
            style={isEditing && frozenSize ? { width: frozenSize.width, height: frozenSize.height } : undefined}
          >
            {textLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : isEditing ? (
              <>
                {/* Edit-mode toolbar — Save / Cancel replace Copy / Edit while editing. */}
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsEditing(false); setDraftText(''); setFrozenSize(null) }}
                    title="Discard changes"
                    aria-label="Cancel editing"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 shadow-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditText?.(draftText)
                      setTextContent(draftText)
                      setIsEditing(false)
                      setFrozenSize(null)
                    }}
                    title="Save changes"
                    aria-label="Save changes"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white border border-primary-600 shadow-sm transition-colors"
                  >
                    <Check size={14} />
                    <span>Save</span>
                  </button>
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // Cmd/Ctrl+Enter saves quickly (matches common editor UX);
                    // Escape cancels without saving. Don't bubble — the modal's
                    // own ESC handler would close instead of cancelling edit.
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); e.stopPropagation()
                      onEditText?.(draftText); setTextContent(draftText); setIsEditing(false); setFrozenSize(null)
                    } else if (e.key === 'Escape') {
                      e.preventDefault(); e.stopPropagation()
                      setIsEditing(false); setDraftText(''); setFrozenSize(null)
                    }
                  }}
                  spellCheck={false}
                  autoFocus
                  className="flex-1 w-full resize-none px-5 py-4 pt-14 text-[12px] font-mono leading-relaxed text-neutral-800 dark:text-neutral-200 bg-transparent outline-none focus:ring-0"
                />
              </>
            ) : (
              <>
                {/* View-mode toolbar — Copy + (optional) Edit. */}
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyText() }}
                    disabled={!textContent}
                    title={copied ? 'Copied' : 'Copy to clipboard'}
                    aria-label={copied ? 'Copied to clipboard' : 'Copy text to clipboard'}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  {/* Edit button — only when parent enabled editing for this attachment. */}
                  {onEditText && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // Snapshot the rendered card size so the editor below
                        // doesn't collapse to a smaller box when <pre> swaps
                        // to <textarea> (which has no intrinsic dimensions).
                        if (cardRef.current) {
                          const r = cardRef.current.getBoundingClientRect()
                          setFrozenSize({ width: r.width, height: r.height })
                        }
                        setDraftText(textContent || '')
                        setIsEditing(true)
                      }}
                      disabled={textContent == null}
                      title="Edit text"
                      aria-label="Edit text"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil size={14} />
                      <span>Edit</span>
                    </button>
                  )}
                </div>
                <pre className="flex-1 overflow-auto px-5 py-4 pr-32 text-[12px] font-mono leading-relaxed text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words">
                  {textContent || ''}
                </pre>
              </>
            )}
          </div>
        )}
        {!isImage && !isPdf && !isText && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#2c2c2c] rounded-lg p-8 text-center max-w-md"
          >
            <FileText size={48} className="text-neutral-400 mx-auto mb-3" />
            {hasRealName && (
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 mb-1">{name}</p>
            )}
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Preview not available for this file type.</p>
          </div>
        )}
      </div>
    </div>
  )
}
