import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X, Check } from 'lucide-react'

/**
 * Single-select dropdown with text search. Inspired by ptm-app's SearchableSelect
 * but trimmed to single-select / no exclude / no tabs for the Usage filter case.
 *
 * Props:
 *   value           — currently selected option value (anything; null/undefined for "all")
 *   onChange(val)   — called with new value
 *   options         — [{ value, label, hint? }]
 *   placeholder     — trigger label when nothing is selected
 *   searchPlaceholder
 *   className       — wrapper class
 *   triggerClassName
 *   panelClassName  — override the dropdown panel's width / position
 *                     (defaults to a fixed 260px panel; pass e.g. `w-full`
 *                     for a trigger-width panel on wide picker surfaces)
 *   listMaxHeightPx — pixel height cap for the option list (default 260;
 *                     pass e.g. 420 for taller lists). Inline style — does
 *                     NOT go through Tailwind, so arbitrary values work
 *                     reliably regardless of JIT scan timing.
 *   disabled
 *   allowClear      — show an "All / Clear" entry at top that resets to null
 *   align           — 'left' | 'right' (dropdown alignment)
 *   usePortal       — render the panel at document.body via React Portal so
 *                     it escapes every ancestor stacking context (sticky
 *                     headers, sidebar transforms, overflow:hidden cards).
 *                     Required on surfaces like the Storage page where the
 *                     trigger sits inside a card that creates its own
 *                     stacking context and z-index alone can't lift the
 *                     panel above sibling cards.
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'All',
  searchPlaceholder = 'Search…',
  className = '',
  triggerClassName = '',
  panelClassName = 'w-[260px]',
  listMaxHeightPx = 260,
  disabled = false,
  allowClear = true,
  align = 'left',
  usePortal = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const portalPanelRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const label = String(o.label ?? '').toLowerCase()
      const hint = String(o.hint ?? '').toLowerCase()
      return label.includes(q) || hint.includes(q)
    })
  }, [options, search])

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  )

  useEffect(() => {
    if (!isOpen) return
    const onClick = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (usePortal && portalPanelRef.current?.contains(e.target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [isOpen, usePortal])

  // Compute portal panel position from the trigger's bounding rect. Runs
  // once on open and again on scroll/resize so the panel tracks the trigger
  // if the user scrolls the page underneath it. Width defaults to the
  // trigger's measured width but clamps to a minimum readable size.
  useLayoutEffect(() => {
    if (!isOpen || !usePortal || !triggerRef.current) return
    const compute = () => {
      const rect = triggerRef.current.getBoundingClientRect()
      const panelHeight = listMaxHeightPx + 80
      const panelMinWidth = Math.max(rect.width, 240)
      let top = rect.bottom + 4
      let left = align === 'right' ? rect.right - panelMinWidth : rect.left
      if (top + panelHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - panelHeight - 4)
      }
      if (left + panelMinWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - panelMinWidth - 8)
      }
      if (left < 8) left = 8
      setPortalPos({ top, left, width: panelMinWidth })
    }
    compute()
    const handleScroll = (e) => {
      if (portalPanelRef.current?.contains(e.target)) return
      compute()
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', compute)
    }
  }, [isOpen, usePortal, align, listMaxHeightPx])

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
    setSearch('')
    setActiveIndex(-1)
  }, [isOpen])

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIndex}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const choose = useCallback((opt) => {
    onChange?.(opt?.value ?? null)
    setIsOpen(false)
  }, [onChange])

  const onKey = (e) => {
    if (!isOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min((i < 0 ? -1 : i) + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[activeIndex]
      if (opt) choose(opt)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    }
  }

  const triggerLabel = selected?.label ?? placeholder

  return (
    // When the dropdown is open, promote the wrapper into its own stacking
    // context with a high z-index. Without this, sibling cards rendered later
    // in the DOM (e.g. a table with a sticky `thead z-10`) can draw OVER the
    // absolutely-positioned panel because the panel's z-50 is bounded by
    // whichever stacking context contains the wrapper.
    <div
      ref={containerRef}
      className={`relative ${isOpen ? 'z-[60]' : ''} ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-[#383838] disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[140px] ${triggerClassName}`}
      >
        <span className="truncate flex-1 text-left">{triggerLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (() => {
        const panel = (
        <div
          ref={usePortal ? portalPanelRef : null}
          className={`${usePortal ? 'fixed' : 'absolute'} z-[1000] ${usePortal ? '' : 'mt-1'} ${panelClassName} max-w-[calc(100vw-1.5rem)] bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-lg shadow-lg overflow-hidden ${!usePortal && align === 'right' ? 'right-0' : ''} ${!usePortal && align !== 'right' ? 'left-0' : ''}`}
          style={usePortal ? { top: portalPos.top, left: portalPos.left, minWidth: portalPos.width } : undefined}
        >
          <div className="px-2 py-2 border-b border-neutral-100 dark:border-[#383838]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(0) }}
                onKeyDown={onKey}
                placeholder={searchPlaceholder}
                className="w-full pl-7 pr-7 py-1.5 rounded-md border border-neutral-200 dark:border-[#484848] bg-neutral-50 dark:bg-[#383838] text-xs text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div
            ref={listRef}
            className="overflow-y-auto py-1"
            style={{ maxHeight: `${listMaxHeightPx}px` }}
            role="listbox"
          >
            {allowClear && (
              <button
                type="button"
                onClick={() => choose({ value: null })}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${value == null ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-[#383838]'}`}
              >
                <span className="flex-1">{placeholder}</span>
                {value == null && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            )}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-center text-[11px] text-neutral-400 dark:text-neutral-500">No matches</p>
            )}
            {filtered.map((opt, idx) => {
              const isSelected = opt.value === value
              const isActive = idx === activeIndex
              return (
                <button
                  type="button"
                  key={String(opt.value)}
                  data-idx={idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => choose(opt)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors
                    ${isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium'
                      : isActive
                        ? 'bg-neutral-100 dark:bg-[#383838] text-neutral-800 dark:text-neutral-100'
                        : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-[#383838]'
                    }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="flex-1 truncate" title={opt.label}>{opt.label}</span>
                  {opt.hint && <span className="text-[10px] text-neutral-400 dark:text-neutral-500 flex-shrink-0">{opt.hint}</span>}
                  {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
        )
        return usePortal ? createPortal(panel, document.body) : panel
      })()}
    </div>
  )
}
