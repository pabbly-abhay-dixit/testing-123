import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Coins } from 'lucide-react'

/**
 * Credit consumption pill for the chat header. Shows total platform-key
 * credit spend across the workflow's lifetime, with a hover (desktop) /
 * tap (mobile) breakdown by source — chat, test, run.
 *
 * Visibility gate is the parent's responsibility: only render this pill
 * when the user is on Pabbly Provider AND total > 0.
 *
 * The popover opens on click (works on touch + mouse) AND on hover
 * (desktop affordance). Outside-click and Esc close it.
 */
function fmtCredits(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  if (n >= 0.01) return n.toFixed(2)
  return n.toFixed(4)
}

const ROW_LABELS = {
  chat: 'Chat',
  test: 'Test',
  run: 'Run',
}

const ROW_DESCRIPTIONS = {
  chat: 'Master Agent conversations',
  test: 'Test Workflow runs',
  run: 'Live workflow executions (webhook & schedule)',
}

const ROW_COLORS = {
  chat: 'bg-blue-500',
  test: 'bg-amber-500',
  run: 'bg-violet-500',
}

const CreditPill = ({ summary }) => {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: -9999, left: -9999 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const hoverTimeoutRef = useRef(null)

  const total = summary?.total?.credits_used || 0
  const totalCount = summary?.total?.request_count || 0
  const bySource = summary?.by_source || {}

  // Position the popover below + right-aligned with the trigger
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return
    const padding = 8
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const popWidth = popoverRef.current.offsetWidth
    const popHeight = popoverRef.current.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = triggerRect.bottom + 6
    let left = triggerRect.right - popWidth
    if (left < padding) left = padding
    if (left + popWidth > vw - padding) left = vw - popWidth - padding
    if (top + popHeight > vh - padding) {
      top = triggerRect.top - popHeight - 6
      if (top < padding) top = padding
    }
    setCoords({ top, left })
  }, [open, summary])

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (
        popoverRef.current?.contains(e.target) ||
        triggerRef.current?.contains(e.target)
      ) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Hover affordance for desktop. Touch-only devices won't fire these.
  const handleMouseEnter = () => {
    clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => setOpen(true), 120)
  }
  const handleMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => setOpen(false), 200)
  }

  const rows = ['chat', 'test', 'run']
    .map(k => ({
      key: k,
      label: ROW_LABELS[k],
      description: ROW_DESCRIPTIONS[k],
      color: ROW_COLORS[k],
      credits: bySource[k]?.credits_used || 0,
      count: bySource[k]?.request_count || 0,
    }))
    .filter(r => r.credits > 0 || r.count > 0)

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-label={`Workflow AI Credit usage: ${total.toFixed(2)} AI credits`}
        className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 h-8 rounded-lg text-[11px] sm:text-[12px] font-medium text-red-600 dark:text-red-400 bg-white dark:bg-[#2c2c2c] border border-red-200 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-[#3a2424] transition-colors flex-shrink-0 cursor-default"
      >
        <Coins size={12} className="sm:hidden" />
        <Coins size={13} className="hidden sm:inline" />
        <span className="tabular-nums">{fmtCredits(total)}</span>
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Workflow AI Credit usage breakdown"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="fixed z-[9999] min-w-[280px] rounded-lg bg-white dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] shadow-xl animate-tooltip-pop"
          style={{
            top: coords.top,
            left: coords.left,
            visibility: coords.top === -9999 ? 'hidden' : 'visible',
          }}
        >
          <div className="px-3 py-2 border-b border-neutral-100 dark:border-[#484848]">
            <div className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide">
              Workflow AI Credit Usage
            </div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5">
              Pabbly Provider only · Lifetime spend on this workflow
            </div>
          </div>
          <div className="px-3 py-2">
            {rows.length === 0 ? (
              <div className="text-[12px] text-neutral-500 dark:text-neutral-400 py-1">
                No usage yet.
              </div>
            ) : (
              <>
                {/* Column header row — labels the Credits / Requests columns
                    so the right-side numbers aren't ambiguous. */}
                <div className="flex items-center justify-between gap-3 pb-1.5 mb-1.5 border-b border-neutral-100 dark:border-[#484848]">
                  <span className="text-[9px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                    Source
                  </span>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="text-[9px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                      Credits
                    </span>
                    <span className="text-[9px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide w-16 text-right">
                      Requests
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map(r => (
                    <div key={r.key} className="flex items-start justify-between gap-3 text-[12px]">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${r.color} flex-shrink-0 mt-1.5`} />
                        <div className="min-w-0">
                          <div className="text-neutral-700 dark:text-neutral-300 font-medium">{r.label}</div>
                          <div className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight mt-0.5">
                            {r.description}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 tabular-nums flex-shrink-0 pt-0.5">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {fmtCredits(r.credits)}
                        </span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 w-16 text-right">
                          {r.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="px-3 py-2 border-t border-neutral-100 dark:border-[#484848] flex items-center justify-between text-[12px]">
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">Total</span>
            <div className="flex items-center gap-2 tabular-nums">
              <span className="font-semibold text-red-600 dark:text-red-400">
                {fmtCredits(total)} AI credits
              </span>
              <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400 w-16 text-right">
                {totalCount}
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export default CreditPill
