import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

/**
 * Compact non-search dropdown matching the visual treatment of
 * `SearchableSelect` (used by Usage / Credits / AdminAnalytics) — borders,
 * primary-X selected state, dark mode, chevron, click-outside to close.
 *
 * Reach for this when the option list is short enough that search is overkill.
 *
 * Props:
 *   value           — currently selected value
 *   onChange(val)   — called on selection
 *   options         — [{ value, label, hint?, disabled? }]
 *                     `disabled: true` keeps the option in the list (so the
 *                     trigger renders its label when it matches the current
 *                     value) but blocks clicks and visually fades it.
 *   placeholder     — shown when nothing is selected
 *   className       — wrapper class
 *   triggerClassName — override trigger size (e.g. h-7 for compact rows)
 *   disabled
 *   align           — 'left' | 'right' (panel alignment)
 *   panelWidth      — Tailwind/CSS class for panel width (default w-40)
 *   size            — 'sm' (h-7) | 'md' (h-9) — visual height preset
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className = '',
  triggerClassName = '',
  disabled = false,
  align = 'left',
  panelWidth = 'w-40',
  size = 'md',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0, openUp: false })

  // Reposition the portal-rendered panel against the trigger every time the
  // dropdown opens or the viewport changes — `position: fixed` means we have
  // to compute the coordinates ourselves rather than rely on offset parents.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const updatePos = () => {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const estimatedPanelH = Math.min(280, options.length * 32 + 16)
      const openUp = spaceBelow < estimatedPanelH && spaceAbove > spaceBelow
      setPanelPos({
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        left: align === 'right' ? rect.right : rect.left,
        width: rect.width,
        openUp,
      })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open, align, options.length])

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const heightClass = size === 'sm' ? 'h-7 text-[11.5px] px-2' : 'h-9 text-[12.5px] px-3'

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-between gap-1.5 rounded-md border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] text-neutral-700 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-[#5a5a5a] focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${heightClass} ${triggerClassName}`}
      >
        <span className="truncate">
          {selected ? selected.label : <span className="text-neutral-400 dark:text-neutral-500">{placeholder}</span>}
        </span>
        <ChevronDown
          size={size === 'sm' ? 11 : 13}
          className={`text-neutral-400 dark:text-neutral-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-[10000] ${panelWidth} max-w-[calc(100vw-1.5rem)] max-h-[260px] overflow-y-auto bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-lg shadow-xl py-1`}
          style={{
            top: panelPos.openUp ? undefined : panelPos.top,
            bottom: panelPos.openUp ? window.innerHeight - panelPos.top : undefined,
            left: align === 'right' ? undefined : panelPos.left,
            right: align === 'right' ? window.innerWidth - panelPos.left : undefined,
            minWidth: panelPos.width,
          }}
          role="listbox"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-center text-[11px] text-neutral-400 dark:text-neutral-500">
              No options
            </p>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value
              const isDisabled = !!opt.disabled
              return (
                <button
                  type="button"
                  key={String(opt.value)}
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return
                    onChange?.(opt.value)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    isDisabled
                      ? 'text-neutral-400 dark:text-neutral-500 cursor-not-allowed opacity-60'
                      : isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium'
                      : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-[#383838]'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 flex-shrink-0">
                      {opt.hint}
                    </span>
                  )}
                  {isSelected && !isDisabled && <Check size={12} className="flex-shrink-0" />}
                </button>
              )
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
