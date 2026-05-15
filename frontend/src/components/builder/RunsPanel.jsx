import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Clock, RefreshCw, RotateCcw, Coins, Copy, Check, Search, X, Gauge } from 'lucide-react'
import { taskHistoryAPI } from '../../services/api'
import toast from 'react-hot-toast'
import Tooltip from '../ui/Tooltip'
import { formatDuration, formatTimeAgo } from './taskHistoryUtils.jsx'
import { applyStaleOverride } from '../../utils/runTimeout'

/**
 * Card-level click hint tooltip. Renders the wrapped card and shows a
 * "Click to open run details" floating tooltip ONLY when the mouse is
 * hovering the card's empty area — i.e. not over any inner element that
 * already has its own Tooltip wrapper (detected via the
 * `data-tooltip-wrapper="true"` attribute the shared Tooltip component
 * stamps on its trigger). Without that target check, the parent + child
 * tooltips would both render simultaneously because mouseleave doesn't
 * fire on a parent when the cursor moves into a child.
 */
function CardClickTooltip({ content, children }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: -9999, left: -9999 })
  const [arrowOffset, setArrowOffset] = useState(null)
  const [placement, setPlacement] = useState('bottom') // 'bottom' | 'top'
  const cardRef = useRef(null)
  const tipRef = useRef(null)
  const timeoutRef = useRef(null)

  const show = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 250)
  }
  const hide = () => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
    setCoords({ top: -9999, left: -9999 })
    setArrowOffset(null)
  }

  const handleMouseOver = (e) => {
    // If the cursor entered an inner element that has its own Tooltip
    // wrapper, suppress the card-level hint so the two don't stack.
    if (e.target.closest('[data-tooltip-wrapper="true"]')) {
      hide()
      return
    }
    show()
  }
  const handleMouseOut = (e) => {
    // Only hide when the cursor genuinely left the card (relatedTarget
    // outside the card) — otherwise child→child moves would flicker.
    if (cardRef.current && !cardRef.current.contains(e.relatedTarget)) {
      hide()
    }
  }

  // Position + arrow tracking. Mirrors the shared Tooltip component's
  // logic so the look matches: arrow always points at the card's center
  // even after the tooltip is clamped to the viewport.
  useLayoutEffect(() => {
    if (!visible || !cardRef.current || !tipRef.current) return
    const padding = 8
    const arrowGap = 6 // distance from card to tooltip body
    const rect = cardRef.current.getBoundingClientRect()
    const tipRect = tipRef.current.getBoundingClientRect()

    // Prefer below; fall back above if there isn't room.
    let nextPlacement = 'bottom'
    let top = rect.bottom + arrowGap
    if (top + tipRect.height > window.innerHeight - padding) {
      top = rect.top - tipRect.height - arrowGap
      nextPlacement = 'top'
    }
    if (top < padding) top = padding

    let left = rect.left + rect.width / 2 - tipRect.width / 2
    if (left < padding) left = padding
    if (left + tipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tipRect.width - padding
    }

    const arrowEdgePadding = 10
    const triggerCenterX = rect.left + rect.width / 2
    const offsetFromTooltipLeft = triggerCenterX - left
    const arrow = Math.max(
      arrowEdgePadding,
      Math.min(tipRect.width - arrowEdgePadding, offsetFromTooltipLeft),
    )

    setPlacement(nextPlacement)
    setCoords({ top, left })
    setArrowOffset(arrow)
  }, [visible])

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  return (
    <>
      <div ref={cardRef} onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
        {children}
      </div>
      {visible && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[9999] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug font-medium text-white bg-neutral-900 dark:bg-neutral-800 border border-neutral-700 dark:border-neutral-600 shadow-xl pointer-events-none animate-tooltip-pop"
          style={{ top: coords.top, left: coords.left, visibility: coords.top === -9999 ? 'hidden' : 'visible' }}
        >
          {content}
          <div
            className={`absolute w-2 h-2 rotate-45 bg-neutral-900 dark:bg-neutral-800 border-neutral-700 dark:border-neutral-600 ${
              placement === 'bottom'
                ? 'top-0 -translate-y-1/2 -translate-x-1/2 border-l border-t'
                : 'bottom-0 translate-y-1/2 -translate-x-1/2 border-r border-b'
            }`}
            style={{ left: arrowOffset ?? '50%' }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}

function RunIdChip({ id }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  const copy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(id)
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1400)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // Fixed-width middle truncation — the chip never grows or shrinks past
  // ~110px so Row 2 (date · duration · chip) always fits on a single line
  // even when the right detail panel is open and the card is narrow.
  // Searchable hidden overlay keeps the full id as one contiguous text
  // node so browser Ctrl+F still matches arbitrary substrings.
  const display = `${id.slice(0, 8)}…${id.slice(-5)}`

  return (
    <Tooltip
      content={copied ? 'Copied!' : `Run ID: ${id} · Click to copy`}
      position="bottom"
      delay={150}
      className="ml-auto flex-shrink-0"
    >
      <span
        role="button"
        onClick={copy}
        className={`relative inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[12px] whitespace-nowrap cursor-pointer transition-colors ${
          copied
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-neutral-100 dark:bg-[#3a3a3a] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-[#484848]'
        }`}
      >
        <span aria-hidden="true">{display}</span>
        {copied ? <Check size={12} className="flex-shrink-0" /> : <Copy size={12} className="flex-shrink-0" />}
        {/* Hidden full id for browser Ctrl+F. color:transparent keeps the
            glyphs invisible, but the find-highlight rectangle still draws
            on top of the visible chip — so a match auto-scrolls the row
            into view AND visibly highlights it. pointer-events-none keeps
            clicks routed to the chip; user-select:none stops double-copy. */}
        <span
          className="absolute inset-0 overflow-hidden whitespace-nowrap pointer-events-none select-none"
          style={{ color: 'transparent' }}
        >{id}</span>
      </span>
    </Tooltip>
  )
}

const RunsPanel = ({ agent, activeExecution, steps = [], onTotalCountChange, isVisible = false, onTrackExecution, onSelectRun, selectedRunId, onRefreshRef, switchingProvider = false, onLastFetchChange }) => {
  const [runs, setRuns] = useState([])
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [runLimit, setRunLimit] = useState(20)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const lastFetchRef = useRef(0)
  // Monotonic id for every loadRuns call. The success/error handlers compare
  // their captured id against the latest — only the most-recent request
  // applies state, all earlier ones (now stale) are discarded silently.
  // Without this, rapid chip clicks (Failed → All → Success) raced because
  // whichever HTTP response landed LAST won setRuns — so an earlier filter's
  // empty/different result could overwrite the current selection's data,
  // leaving the panel showing "no items" or rows from the wrong filter.
  const requestIdRef = useRef(0)
  // Counts in-flight FOREGROUND fetches (filter / search / cold open / manual
  // refresh). Skeleton stays mounted until the count drains to zero — so a
  // late-arriving stale foreground response can't flip the skeleton off
  // while a newer one is still pending. Silent fetches (poll, load-more,
  // post-completion) don't touch this counter.
  const inflightForegroundRef = useRef(0)
  const [reExecutingRunId, setReExecutingRunId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [, setTick] = useState(0)
  // `isFetching` drives the skeleton overlay for foreground fetches (cold
  // open + filter/search changes). Background fetches that should NOT
  // disrupt the visible list (3s execution poll, post-completion refresh,
  // load-more pagination, re-execute follow-up) call loadRuns with
  // silent=true and never flip this flag.
  const [isFetching, setIsFetching] = useState(false)
  // Filter UI state — kept intentionally minimal.
  // - searchInput: raw value bound to <input>; echoes typing immediately.
  // - debouncedQuery: 300ms-debounced version of searchInput; drives fetch.
  // - statusFilter: '' | 'completed' | 'failed' | 'executing'.
  // - searchError: surfaces backend validation messages inline.
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchError, setSearchError] = useState('')

  const handleReExecute = async (run) => {
    if (!agent?.user_id || !agent?.id) return
    setReExecutingRunId(run.id)
    try {
      let payload = {}
      try {
        payload = typeof run.webhook_data === 'string'
          ? JSON.parse(run.webhook_data)
          : (run.webhook_data || {})
      } catch { payload = {} }

      const API_BASE = import.meta.env.VITE_API_URL || ''
      const resp = await fetch(`${API_BASE}/api/webhook/${agent.user_id}/${agent.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pabbly-test': 'true' },
        body: JSON.stringify(payload),
      })
      const data = await resp.json().catch(() => ({}))

      if (resp.ok && data.run_id) {
        if (onTrackExecution) onTrackExecution(data.run_id)
        // Silent refresh — re-execute already gave the user a row in the
        // poller; flashing a full skeleton over the visible list would be
        // noise.
        setTimeout(() => loadRuns(null, true, true), 1000)
      } else {
        toast.error(data.error || 'Re-execute failed')
      }
    } catch (e) {
      console.error('Re-execute failed:', e)
      toast.error('Re-execute failed')
    } finally {
      setReExecutingRunId(null)
    }
  }

  const loadRuns = async (limit, force, silent = false) => {
    if (!agent?.slug && !agent?.id) return
    const useLimit = limit || runLimit
    // Cache short-circuit BEFORE any loading state is touched — a stale-cache
    // bail-out shouldn't flash the skeleton or spinner.
    if (!force && !limit && lastFetchRef.current && Date.now() - lastFetchRef.current < 30000 && runs.length > 0) return

    // Stamp this request with a monotonic id. After await, we compare against
    // the latest id — if a newer loadRuns has fired since (rapid chip click
    // / typing), this response is stale and we discard it instead of letting
    // it overwrite the newer one's data. Fixes the empty-state stuck-state
    // when a slow Failed-filter response landed AFTER a fast All-filter
    // response and reset runs back to the empty Failed result.
    const myRequestId = ++requestIdRef.current
    if (force) setRefreshing(true)
    if (!silent) {
      inflightForegroundRef.current += 1
      setIsFetching(true)
    }
    try {
      const opts = { limit: useLimit }
      if (debouncedQuery) opts.q = debouncedQuery
      if (statusFilter) opts.status = statusFilter
      const res = await taskHistoryAPI.list(agent.slug || agent.id, opts)
      // Stale-response guard. Only the latest request applies state; older
      // ones are dropped on the floor.
      if (myRequestId === requestIdRef.current) {
        const fetched = res.data.runs || []
        setRuns(fetched)
        const newTotal = res.data.total || fetched.length
        setTotalCount(newTotal)
        if (onTotalCountChange) onTotalCountChange(newTotal)
        setHasMore(res.data.has_more || false)
        const now = Date.now()
        lastFetchRef.current = now
        // Surface the freshness timestamp to the parent so the tab-bar refresh
        // button can render an "Updated Xs ago" tooltip. Fires for BOTH silent
        // (poll, post-completion) and foreground (filter, manual refresh)
        // fetches — the user-visible signal is "data was confirmed fresh at
        // this instant", regardless of why we asked.
        if (onLastFetchChange) onLastFetchChange(now)
        setSearchError('')

        if (onTrackExecution && !activeExecution) {
          const executingRun = fetched.find(r => r.status === 'executing')
          if (executingRun) onTrackExecution(executingRun.id)
        }
      }
    } catch (e) {
      // Surface 400s (non-hex search input) so the user understands why the
      // list went empty. Other errors stay silent — matches prior behavior.
      // Stale errors are also discarded so an old filter's failure can't
      // re-paint the current filter's empty state.
      if (myRequestId === requestIdRef.current) {
        const msg = e?.response?.data?.error
        if (e?.response?.status === 400 && msg) setSearchError(msg)
      }
    } finally {
      // initialLoaded + loadingMore reset unconditionally — they're per-request
      // flags, not "freshness of the visible list" flags.
      setInitialLoaded(true)
      setLoadingMore(false)
      if (force) setTimeout(() => setRefreshing(false), 400)
      // Skeleton drains only when the LAST in-flight foreground fetch finishes.
      // A first-finishing earlier request must NOT flip the skeleton off
      // while a newer one is still pending — that would briefly show stale
      // data before the real result lands.
      if (!silent) {
        inflightForegroundRef.current = Math.max(0, inflightForegroundRef.current - 1)
        if (inflightForegroundRef.current === 0) setIsFetching(false)
      }
    }
  }

  // Keep the latest loadRuns in a ref so the 3s execution-polling interval
  // always calls the freshest closure (otherwise it would re-arm with stale
  // filter state every time the user typed a character).
  const loadRunsRef = useRef(loadRuns)
  useEffect(() => { loadRunsRef.current = loadRuns })

  const loadMore = () => {
    const newLimit = runLimit + 20
    setRunLimit(newLimit)
    setLoadingMore(true)
    // Silent — load-more keeps the existing list visible and shows its own
    // bottom-row spinner. A full skeleton overlay would defeat the point of
    // pagination.
    loadRuns(newLimit, false, true)
  }

  // Expose refresh function to parent (StepsPanel tab bar refresh button)
  useEffect(() => {
    if (onRefreshRef) onRefreshRef.current = () => loadRuns(null, true)
  })

  // Debounce raw search input → query that drives the fetch. 300ms keeps the
  // UI responsive without flooding Mongo on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Truly lazy initial load — only fires when the Runs tab actually becomes
  // visible. The badge count for the tab label is provided separately by
  // BuilderPage's `?limit=1` poll (drives the StepsPanel + mobile tab labels),
  // so this component doesn't need to eager-fetch on first mount just to
  // populate that count.
  useEffect(() => {
    if (!isVisible) return
    loadRuns()
  }, [isVisible, agent?.slug, agent?.id])

  // Reload on filter change. Skipped on the very first run (initial empty
  // filter state) — the visibility effect above handles the cold-open load.
  // Subsequent transitions: reset to page 1 + invalidate the 30s cache +
  // force a fetch so the user sees fresh results immediately.
  const filterMountedRef = useRef(false)
  useEffect(() => {
    if (!filterMountedRef.current) {
      filterMountedRef.current = true
      return
    }
    setRunLimit(20)
    lastFetchRef.current = 0
    if (isVisible) loadRuns(20, true)
    // Intentionally NOT depending on isVisible — if the tab is hidden when
    // the user clears the filter via keyboard from a sibling panel, the
    // next reveal's visibility effect will pick up the fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, statusFilter])

  // Poll during execution — gated on `isVisible` so the 3s poll never fires
  // while the user is on the Chat / Steps tab. When the user switches away
  // mid-execution, the interval is cleaned up; when they switch back, the
  // effect re-runs (isVisible is in the dep array) and the interval is
  // re-armed for the same runId. Polling only happens when BOTH:
  //   - the Runs tab is visible (desktop activeTab === 'runs' OR mobile
  //     mobileTab === 'history' — RunsPanel is mounted in both layouts), AND
  //   - a workflow is currently executing.
  // Once execution finishes the interval is cleared and one final loadRuns
  // fires to flip the row's status badge from "Running" to its terminal state.
  const pollRef = useRef(null)
  const prevRunIdRef = useRef(null)
  useEffect(() => {
    const runId = activeExecution?.runId
    const status = activeExecution?.status

    // Stop the poll whenever any of the three preconditions fails.
    if (!isVisible || !runId || (status && status !== 'executing')) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      // One final refresh on completion so the just-finished run shows its
      // terminal status. Only fires when execution actually ended (not when
      // the cause was tab-hide or no-active-run). Silent — this is a
      // status-flip refresh, not a user-initiated reload.
      if (status && status !== 'executing') {
        loadRuns(null, true, true)
      }
      return
    }

    // Visible AND execution active — refresh once + (re)start polling.
    // Both paths are silent: polling that wipes the list to skeleton every
    // 3 s would be unusable.
    if (runId !== prevRunIdRef.current) {
      prevRunIdRef.current = runId
      loadRuns(null, true, true)
    }
    if (!pollRef.current) {
      pollRef.current = setInterval(() => loadRunsRef.current(null, true, true), 3000)
    }

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [activeExecution?.runId, activeExecution?.status, isVisible])

  // Tick for elapsed timer
  useEffect(() => {
    if (activeExecution?.status !== 'executing') return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activeExecution?.status])

  // 10-second tick whenever ANY loaded run is still 'executing'. Ensures
  // the client-side stale override (isRunStale) re-evaluates without
  // needing a poll or refresh — a row that crosses the 5-minute threshold
  // flips to 'failed' locally within 10s even if no active execution is
  // being tracked.
  const hasAnyExecuting = runs.some(r => r?.status === 'executing')
  useEffect(() => {
    if (!hasAnyExecuting) return
    const id = setInterval(() => setTick(t => t + 1), 10_000)
    return () => clearInterval(id)
  }, [hasAnyExecuting])

  // Skeleton placeholder rows. Reused by the cold-open and the
  // foreground-fetch (filter / search change) paths. Mirrors the real
  // run-card layout (card + arrow connector + card …) so when actual data
  // arrives nothing reflows. `animate-pulse` is the Tailwind built-in
  // shimmer; arrow SVG matches the connector at line ~318.
  const SKELETON_COUNT = 4
  const skeletonBlock = (
    <div className="p-2 space-y-0" aria-busy="true" aria-label="Loading run history">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div key={i}>
          <div className="rounded-lg border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] px-4 py-3 animate-pulse">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-6 rounded bg-neutral-200 dark:bg-[#383838]" />
                <div className="h-4 w-16 rounded-full bg-neutral-200 dark:bg-[#383838]" />
              </div>
              <div className="h-4 w-12 rounded-full bg-neutral-200 dark:bg-[#383838]" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-[#383838]" />
              <div className="h-3 w-10 rounded bg-neutral-200 dark:bg-[#383838]" />
            </div>
          </div>
          {/* Arrow connector — same SVG as real list */}
          {i < SKELETON_COUNT - 1 && (
            <div className="flex justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" className="text-neutral-200 dark:text-neutral-700">
                <line x1="12" y1="8" x2="12" y2="24" stroke="currentColor" strokeWidth="2" />
                <polygon points="12,0 6,10 18,10" fill="currentColor" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const isBYOK = agent?.config?.use_system_model === false
  const isFilterActive = Boolean(debouncedQuery) || Boolean(statusFilter)
  const STATUS_CHIPS = [
    { value: '', label: 'All', tip: 'Show every run regardless of outcome' },
    { value: 'completed', label: 'Success', tip: 'Runs that finished without errors' },
    { value: 'failed', label: 'Failed', tip: 'Runs that errored out or timed out' },
    { value: 'executing', label: 'Running', tip: 'Runs currently in progress' },
  ]

  // Filter header — minimal: search box + 4 status chips. Rendered above
  // both the empty state and the runs list so filters are always visible.
  // `sticky top-0` keeps it pinned while scrolling deep run histories.
  const filterHeader = (
    <div className="sticky top-0 z-10 bg-white dark:bg-[#2c2c2c] border-b border-neutral-200 dark:border-[#484848] px-2 py-2 space-y-1.5">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search Run ID, error, or any value inside step data…"
          spellCheck={false}
          autoComplete="off"
          className="w-full pl-7 pr-7 py-1.5 text-[12px] rounded-md border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#1c1c1c] text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-primary-400 dark:focus:border-primary-500/60"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-[#484848]"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {STATUS_CHIPS.map(({ value, label, tip }) => {
          const active = statusFilter === value
          return (
            <Tooltip key={value || 'status-all'} content={tip}>
              <button
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-500/40'
                    : 'bg-neutral-100 dark:bg-[#3a3a3a] text-neutral-600 dark:text-neutral-300 border-transparent hover:bg-neutral-200 dark:hover:bg-[#484848]'
                }`}
              >
                {label}
              </button>
            </Tooltip>
          )
        })}
      </div>
      {searchError && (
        <div className="text-[11px] text-red-500 dark:text-red-400">{searchError}</div>
      )}
    </div>
  )

  // Skeleton overlay for foreground fetches: cold open OR filter/search
  // change. Background fetches (poll, load-more, post-completion refresh,
  // re-execute follow-up) call loadRuns with silent=true and never reach
  // here — those keep the visible list intact. Filter header stays mounted
  // so the user can keep typing or change filters mid-load.
  const showSkeleton = isFetching || (!initialLoaded && runs.length === 0)
  if (showSkeleton) {
    return (
      <div>
        {filterHeader}
        {skeletonBlock}
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div>
        {filterHeader}
        <div className="flex flex-col items-center justify-center h-40 text-center px-4">
          <Clock size={28} className="text-neutral-300 dark:text-neutral-600 mb-2" />
          {isFilterActive ? (
            <>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-300">No runs match these filters</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-300 mt-1">
                Try a shorter Run ID, an error keyword, or any value that appears in a step's input or output.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-300">No executions yet</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-300 mt-1">
                Send a POST to your webhook URL to trigger the workflow.
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {filterHeader}
      <div className="p-2 space-y-0">
      {/* Runs list — card style matching Steps panel */}
      {runs.map((rawRun, runIdx) => {
        // Client-side stale override: if the row has been sitting in
        // 'executing' for longer than the max run duration (10 min, matches
        // backend sweep), render it as failed immediately — no reload needed.
        const run = applyStaleOverride(rawRun)
        // Prefer the backend-stamped absolute chronological position
        // (1 = oldest, N = newest) so the `#N` label stays stable when
        // status / search filters narrow the visible list — `#52` keeps
        // reading as `#52` even if it's the only match. Fallback math
        // (`totalCount - runIdx`) only runs against a legacy backend that
        // doesn't emit `position`, in which case the label is filter-relative
        // — same behavior as before this change.
        const runNumber = typeof run.position === 'number' ? run.position : (totalCount - runIdx)
        const isSelected = run.id === selectedRunId
        const isLive = run.status === 'executing' && activeExecution?.runId === run.id

        return (
          <div key={run.id}>
            <CardClickTooltip content={isSelected ? 'Currently open — see run details on the right' : 'Click to open run details'}>
            <button
              onClick={() => onSelectRun?.(run.id, { created_at: run.created_at, completed_at: run.completed_at, duration_ms: run.duration_ms, status: run.status, credits_used: run.credits_used, units_charged: run.units_charged })}
              className={`w-full text-left group rounded-lg border px-4 py-3 transition-colors duration-150 ${
                isSelected
                  ? 'border-primary-400 bg-primary-50 dark:border-primary-500/40 dark:bg-[#131d2e] ring-1 ring-primary-500/20 dark:ring-primary-400/20'
                  : isLive
                    ? 'border-blue-400/60 bg-blue-50/80 dark:border-blue-500/30 dark:bg-blue-950/20'
                    : run.status === 'failed'
                      ? 'border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] hover:border-red-300 dark:hover:border-red-800/50'
                      : 'border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] hover:border-neutral-300 dark:hover:border-[#333]'
              }`}
            >
              {/* Row 1: #number + status badge + credits + re-execute */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[14px] font-semibold ${isSelected ? 'text-primary-700 dark:text-white' : 'text-neutral-700 dark:text-neutral-200'}`}>
                    #{runNumber}
                  </span>
                  <Tooltip content={
                    run.status === 'completed' ? 'Completed successfully'
                    : run.status === 'failed' ? (run.error ? `Failed: ${String(run.error).slice(0, 60)}` : 'Failed')
                    : run.status === 'executing' ? 'Currently executing'
                    : ''
                  } delay={100}>
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                      run.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      : run.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : run.status === 'executing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'bg-neutral-100 dark:bg-[#484848] text-neutral-500'
                    }`}>
                      {run.status === 'completed' ? 'Success' : run.status === 'failed' ? 'Failed' : run.status === 'executing' ? 'Running' : run.status}
                    </span>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!isBYOK && typeof run.credits_used === 'number' && run.credits_used > 0 && (
                    <Tooltip content={`${run.credits_used.toFixed(4)} AI credits`} position="left">
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30">
                        <Coins size={11} /> -{run.credits_used < 0.01 ? '<0.01' : run.credits_used.toFixed(2)}
                      </span>
                    </Tooltip>
                  )}
                  {typeof run.units_charged === 'number' && run.units_charged > 0 && (
                    <Tooltip content={`${run.units_charged} compute unit${run.units_charged === 1 ? '' : 's'} (1 unit ≈ 30 s runtime)`} position="left">
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                        <Gauge size={11} /> -{run.units_charged} CU
                      </span>
                    </Tooltip>
                  )}
                  {run.status === 'executing' && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        taskHistoryAPI.cancel?.(run.id).catch(() => {})
                        setRuns(prev => prev.map(r => r.id === run.id ? { ...r, status: 'failed', error: 'Cancelled' } : r))
                      }}
                      className="text-[11px] font-medium text-red-500 hover:text-red-700 dark:hover:text-red-400 px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                    >Stop</span>
                  )}
                  {(run.status === 'completed' || run.status === 'failed') && (
                    reExecutingRunId === run.id ? (
                      <div className="p-1">
                        <div className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <Tooltip content="Re-run with the same input" position="left">
                        <button
                          onClick={(e) => { e.stopPropagation(); if (!switchingProvider) handleReExecute(run) }}
                          disabled={switchingProvider}
                          aria-label="Re-run with the same input"
                          className="p-1 rounded text-neutral-400 dark:text-neutral-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-neutral-100 dark:hover:bg-[#484848] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </Tooltip>
                    )
                  )}
                </div>
              </div>
              {/* Row 2: date · duration · task history id — locked to a single line.
                  Date shrinks first (truncate + min-w-0); duration and chip
                  are flex-shrink-0 so they always render in full. */}
              <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-neutral-500 dark:text-neutral-400 min-w-0">
                {run.created_at && (
                  <Tooltip content={`Executed at: ${new Date(run.created_at).toLocaleString()}`} position="bottom" className="min-w-0 truncate">
                    <span className="whitespace-nowrap truncate min-w-0 cursor-default">{formatTimeAgo(run.created_at)}</span>
                  </Tooltip>
                )}
                {run.duration_ms > 0 && (() => {
                  const start = new Date(run.created_at)
                  const end = run.completed_at ? new Date(run.completed_at) : new Date(start.getTime() + run.duration_ms)
                  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                  return (
                    <Tooltip content={`Start: ${fmt(start)} · End: ${fmt(end)}`} position="bottom">
                      <span className="inline-flex items-center gap-0.5 cursor-default whitespace-nowrap flex-shrink-0">· <Clock size={11} /> {formatDuration(run.duration_ms)}</span>
                    </Tooltip>
                  )
                })()}
                {run.id && <RunIdChip id={run.id} />}
              </div>
            </button>
            </CardClickTooltip>

            {/* Arrow connector between cards */}
            {runIdx < runs.length - 1 && (
              <div className="flex justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" className="text-neutral-300 dark:text-neutral-600">
                  <line x1="12" y1="8" x2="12" y2="24" stroke="currentColor" strokeWidth="2" />
                  <polygon points="12,0 6,10 18,10" fill="currentColor" />
                </svg>
              </div>
            )}
          </div>
        )
      })}

      {/* Load more */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2 mt-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-300 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#484848] rounded-lg transition-colors disabled:opacity-50"
        >
          {loadingMore ? 'Loading...' : `Load more history`}
        </button>
      )}
      </div>
    </div>
  )
}

export default RunsPanel
