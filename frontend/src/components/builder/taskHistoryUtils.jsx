import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Clock, Circle, SkipForward, WrapText, Search } from 'lucide-react'
import Tooltip from '../ui/Tooltip'

export const formatDuration = (ms) => {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export const formatTimeAgo = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date} ${time}`
}

export const statusIcon = (status) => {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />
  if (status === 'failed') return <XCircle size={14} className="text-red-500" />
  if (status === 'executing') return <div className="w-3.5 h-3.5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
  return <Clock size={14} className="text-neutral-400" />
}

export const stepStatusIcon = (status) => {
  if (status === 'running') return <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
  if (status === 'success' || status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />
  if (status === 'failed') return <XCircle size={14} className="text-red-500" />
  if (status === 'pending') return <Circle size={14} className="text-neutral-300 dark:text-neutral-600" />
  return <SkipForward size={14} className="text-neutral-300" />
}

export const statusColor = (s) =>
  s === 'completed' ? '#22c55e' : s === 'failed' ? '#ef4444' : s === 'executing' ? '#3b82f6' : '#737373'

export const parseStepResults = (run) => {
  if (!run.step_results) return []
  try {
    let parsed = run.step_results
    while (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/** Preformatted block with copy + word-wrap toggle. Default: no wrap on desktop, wrap on mobile.
 *  When `toolbar="external"`, Wrap/Copy buttons are NOT rendered (caller handles them via onWrapChange). */
export function PreBlock({ children, color, copyText, defaultWrap = false, toolbar = 'inline' }) {
  const [wrap, setWrap] = useState(() => defaultWrap || window.innerWidth < 1024)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (defaultWrap) return
    const onResize = () => setWrap(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [defaultWrap])
  return (
    <>
      {toolbar === 'inline' && (
        <div className="flex items-center gap-1.5 absolute top-1.5 right-2">
          <Tooltip content={wrap ? 'No wrap' : 'Wrap long lines'}>
            <button
              onClick={(e) => { e.stopPropagation(); setWrap(w => !w) }}
              aria-label={wrap ? 'Disable word wrap' : 'Enable word wrap'}
              className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${wrap ? 'bg-blue-600/60 text-white' : 'hover:underline'}`}
              style={wrap ? {} : { color: '#8b949e' }}
            ><WrapText size={9} />Wrap</button>
          </Tooltip>
          <Tooltip content="Copy">
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(copyText || '')
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              aria-label="Copy"
              className="text-[9px] hover:underline"
              style={{ color: '#8b949e' }}
            >{copied ? 'Copied!' : 'Copy'}</button>
          </Tooltip>
        </div>
      )}
      <pre
        className={`px-3 py-3 text-[12px] font-mono max-h-64 overflow-auto leading-relaxed ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
        style={{ color }}
      >{children}</pre>
    </>
  )
}

/** Standalone Wrap + Copy toolbar for use in tab bars.
 *  Optional Search — pass `onToggleSearch` + `searchOpen` to render the button.
 *  When `searchOpen` is true, the button morphs into an inline input fed by
 *  `searchTerm` / `onSearchTermChange` / `onSearchKeyDown`; the caller handles
 *  click-outside via `searchBoxRef`. `matchCount` + `currentMatchIdx` render
 *  the "3/12" counter when matches exist. */
export function PreBlockToolbar({
  wrap,
  onToggleWrap,
  copyText,
  onToggleSearch,
  searchOpen,
  searchTerm = '',
  onSearchTermChange,
  onSearchKeyDown,
  matchCount = 0,
  currentMatchIdx = 0,
  searchBoxRef,
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 ml-auto pr-1 flex-shrink-0">
      {onToggleSearch && (
        searchOpen ? (
          <div
            ref={searchBoxRef}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-blue-500/70 bg-[#0d1117]"
          >
            <Search size={10} className="text-blue-400 flex-shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchTermChange?.(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search..."
              autoFocus
              className="w-32 text-[11px] font-mono bg-transparent text-neutral-100 placeholder:text-neutral-500 focus:outline-none border-none shadow-none"
              style={{ boxShadow: 'none' }}
            />
            {searchTerm && matchCount > 0 && (
              <span className="text-[10px] text-neutral-400 tabular-nums flex-shrink-0">
                {currentMatchIdx + 1}/{matchCount}
              </span>
            )}
          </div>
        ) : (
          <Tooltip content="Search in this pane">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSearch() }}
              aria-label="Open search"
              className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors hover:bg-neutral-700/50"
              style={{ color: '#8b949e' }}
            ><Search size={10} />Search</button>
          </Tooltip>
        )
      )}
      <Tooltip content={wrap ? 'No wrap' : 'Wrap long lines'}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleWrap() }}
          aria-label={wrap ? 'Disable word wrap' : 'Enable word wrap'}
          className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${wrap ? 'bg-blue-600/60 text-white' : 'hover:bg-neutral-700/50'}`}
          style={wrap ? {} : { color: '#8b949e' }}
        ><WrapText size={10} />Wrap</button>
      </Tooltip>
      <Tooltip content="Copy JSON">
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigator.clipboard.writeText(copyText || '')
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          aria-label="Copy JSON"
          className="text-[10px] px-2 py-0.5 rounded hover:bg-neutral-700/50 transition-colors"
          style={{ color: '#8b949e' }}
        >{copied ? 'Copied!' : 'Copy'}</button>
      </Tooltip>
    </div>
  )
}
