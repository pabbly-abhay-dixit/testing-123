import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  Search,
  X,
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
  ExternalLink,
  CalendarOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { schedulesAPI } from '../services/api'
import { humanizeCron } from '../utils/cron'
import { useConfirm } from '../components/ui/ConfirmModal'
import Tooltip from '../components/ui/Tooltip'
import Pagination from '../components/ui/Pagination'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import UpgradeGate from '../components/ui/UpgradeGate'
import { useEntitlements } from '../context/EntitlementsContext'

const PAGE_SIZE_DEFAULT = 25
const BULK_LIMIT = 50

// ─── Atoms (visual parity with Dashboard) ───────────────────────────────────

// Browser's resolved IANA timezone (e.g. "Asia/Kolkata"). Used to label
// tooltip times so users know they're seeing their own clock, not the
// schedule's source timezone. Falls back to "Local" if Intl is unavailable.
const LOCAL_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local' }
  catch { return 'Local' }
})()

// Compact "27 Apr 2026 14:35" — same family as Dashboard.formatDate but
// includes time since schedules are inherently time-sensitive. Always uses
// the BROWSER's local timezone (no `timeZone` option = default → local).
const fmtAbsolute = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

// "Monday, 27 April 2026 at 14:35:22 (Asia/Kolkata)" — verbose tooltip
// variant, mirrors Dashboard.formatDateLong, with the user's local TZ
// appended so the absolute time is unambiguous.
const fmtAbsoluteLong = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date} at ${time} (${LOCAL_TZ})`
}

// Relative label for the cell text — "in 2h", "5m ago" — keeps the table
// scannable. Hover gives the absolute via Tooltip (Dashboard pattern).
const fmtRelative = (iso) => {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = t - Date.now()
  const past = diff < 0
  const abs = Math.abs(diff)
  const min = Math.round(abs / 60000)
  if (min < 1) return past ? 'just now' : 'in <1m'
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`
  const day = Math.round(hr / 24)
  if (day < 30) return past ? `${day}d ago` : `in ${day}d`
  return fmtAbsolute(iso)
}

// Two-line action/description tooltip — same shape as Dashboard.tipLines.
const tipLines = (action, description) => (
  <div className="leading-snug">
    <div className="text-white">{action}</div>
    {description && <div className="text-neutral-300 mt-1">{description}</div>}
  </div>
)

// Schedule status palette — folded from PF's enabled + paused_reason fields
// into three display states. Same key shape as Dashboard.STATUS_META so any
// future component reuse is trivial.
const STATUS_META = {
  enabled:  { label: 'Enabled',  bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  disabled: { label: 'Disabled', bg: 'bg-gray-100 dark:bg-neutral-700',       text: 'text-gray-700 dark:text-neutral-300',     dot: 'bg-gray-400' },
  paused:   { label: 'Paused',   bg: 'bg-amber-100 dark:bg-amber-900/30',     text: 'text-amber-700 dark:text-amber-300',      dot: 'bg-amber-500' },
}

const deriveStatusKey = (s) => {
  if (s?.paused_reason) return 'paused'
  return s?.enabled ? 'enabled' : 'disabled'
}

const StatusPill = ({ schedule }) => {
  const key = deriveStatusKey(schedule)
  const meta = STATUS_META[key]
  const tip =
    key === 'paused' && schedule.paused_reason === 'function_disabled'
      ? 'Workflow function is disabled — re-enable it to resume the schedule'
      : key === 'paused'
      ? `Paused: ${schedule.paused_reason}`
      : meta.label
  return (
    <Tooltip content={tip} delay={300}>
      <span className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium pl-2 pr-2 sm:pr-3 py-1 rounded-full ${meta.bg} ${meta.text}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
        {meta.label}
      </span>
    </Tooltip>
  )
}

// Permissive PF run-status classifier — PF's vocabulary varies
// (`"success"` / `"succeeded"` / `"completed"` / `"ok"` for success,
// `"failed"` / `"failure"` / `"error"` for failure). Strict equality misses
// variants and silently flips success rows to "Failed". Unknown strings
// return null so the badge hides instead of misreporting.
const classifyRunStatus = (status) => {
  if (status === true) return 'success'
  if (status === false) return 'failed'
  if (typeof status !== 'string') return null
  const s = status.toLowerCase().trim()
  if (!s) return null
  if (s === 'success' || s === 'succeeded' || s === 'completed' || s === 'complete' ||
      s === 'ok' || s === 'passed' || s.includes('succe')) return 'success'
  if (s === 'failed' || s === 'failure' || s === 'error' || s === 'errored' ||
      s === 'timeout' || s.includes('fail') || s.includes('error')) return 'failed'
  return null
}

const LastRunBadge = ({ status }) => {
  const cls = classifyRunStatus(status)
  if (!cls) return null
  const isSuccess = cls === 'success'
  const tone = isSuccess
    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
  return (
    <span className={`inline-flex w-fit px-1.5 py-0.5 rounded-md text-[10px] font-medium ${tone}`}>
      {isSuccess ? 'Success' : 'Failed'}
    </span>
  )
}

// Same checkbox spec as Dashboard's RowCheckbox so selections feel consistent.
const RowCheckbox = ({ checked, indeterminate, onChange }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onChange?.() }}
    className={`w-[16px] h-[16px] rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
      checked || indeterminate
        ? 'bg-blue-600 border-blue-600'
        : 'bg-white dark:bg-neutral-900 border-gray-300 dark:border-neutral-500 hover:border-gray-400'
    }`}
  >
    {checked && (
      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )}
    {indeterminate && !checked && <div className="w-2 h-[2px] bg-white rounded-full" />}
  </button>
)

// Bulk action bar — mirrors components/dashboard/BulkActionsBar visual
// language (rounded-xl shadow-sm white card, sits ABOVE the table). Kept
// inline because the only action surfaced here is Delete + Clear; reusing
// the dashboard bar would drag in workflow-only buttons (Move / Activate /
// Team Access).
const ScheduleBulkBar = ({ count, onDelete, onClear, busy }) => {
  const btnBase = 'inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const danger = 'text-gray-700 dark:text-white hover:bg-red-100 dark:hover:bg-red-500/20'
  const neutral = 'text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-neutral-600'
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-3">
      <span className="text-sm font-medium text-gray-700 dark:text-neutral-200">
        {count} selected{count >= BULK_LIMIT ? ` (max ${BULK_LIMIT})` : ''}
      </span>
      <div className="hidden sm:block h-5 w-px bg-gray-200 dark:bg-neutral-700" />
      <button onClick={onDelete} disabled={busy} className={`${btnBase} ${danger}`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      <button onClick={onClear} disabled={busy} className={`${btnBase} ${neutral} ml-auto`}>
        <X size={14} /> Clear
      </button>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Schedules() {
  const confirm = useConfirm()
  // Plan-cap gate: hide the entire page behind an upgrade CTA when the
  // user's plan does not include Schedulers. Existing schedules created
  // before enforcement (or before a Premium → Free downgrade) keep firing
  // on PSB's side regardless — see backend/utils/entitlements.rs and the
  // platform-pricing-tiers-plan §4 lifecycle.
  const { loaded: entLoaded, effective } = useEntitlements()
  const schedulersEnabled = !entLoaded || effective?.schedulers_enabled !== false
  const [schedules, setSchedules] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // {include: [], exclude: []} shape mirrors Dashboard's status filter so the
  // dropdown visual + behavior match exactly. Backend currently only honors
  // a single status (PF API takes one); we forward `include[0]` when present.
  const [statusFilter, setStatusFilter] = useState({ include: [], exclude: [] })

  const statusOptions = useMemo(() => [
    { value: 'enabled',  label: 'Enabled',  color: '#10b981' },
    { value: 'disabled', label: 'Disabled', color: '#9ca3af' },
    { value: 'paused',   label: 'Paused',   color: '#f59e0b' },
  ], [])

  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // 300 ms debounce — matches what Dashboard's filter inputs feel like.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300)
    return () => clearTimeout(id)
  }, [searchTerm])

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { page, limit: pageSize }
      if (debouncedSearch) params.search = debouncedSearch
      // PF accepts a single status filter — pass the first include value.
      // Exclude semantics aren't supported upstream; we filter exclusions
      // client-side after the fetch so the UX still feels right.
      const includeStatuses = statusFilter.include || []
      if (includeStatuses.length === 1) params.status = includeStatuses[0]
      const resp = await schedulesAPI.list(params)
      let list = resp.data.schedules || []
      // Client-side filter for the multi-include / exclude cases that the
      // single-`status` PF filter can't express. Cheap on a paginated list.
      const inc = new Set(statusFilter.include || [])
      const exc = new Set(statusFilter.exclude || [])
      if (inc.size > 1 || exc.size > 0) {
        list = list.filter((s) => {
          const key = s.paused_reason ? 'paused' : s.enabled ? 'enabled' : 'disabled'
          if (inc.size > 0 && !inc.has(key)) return false
          if (exc.has(key)) return false
          return true
        })
      }
      setSchedules(list)
      setTotal(resp.data.total || 0)
      // Drop selections for rows that just left the visible page.
      setSelected((prev) => {
        const visible = new Set(list.map((s) => s._id || s.id))
        const next = new Set()
        for (const id of prev) if (visible.has(id)) next.add(id)
        return next
      })
    } catch {
      // Generic copy on purpose — backend error strings can leak internal
      // detail (PF upstream codes, mongo messages) and aren't useful to the
      // end user. Retry CTA handles the recoverable case.
      setError('Server error. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedSearch, statusFilter])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])
  useEffect(() => { setPage(1) }, [debouncedSearch, statusFilter, pageSize])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  )

  const visibleIds = useMemo(
    () => schedules.map((s) => s._id || s.id).filter(Boolean),
    [schedules],
  )
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someSelected = visibleIds.some((id) => selected.has(id))
  const selectionState = allSelected ? 'all' : someSelected ? 'partial' : 'none'

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) {
          if (next.size >= BULK_LIMIT) break
          next.add(id)
        }
        if (visibleIds.length > BULK_LIMIT) {
          toast.error(`Selection capped at ${BULK_LIMIT} rows`)
        }
      }
      return next
    })
  }

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < BULK_LIMIT) next.add(id)
      else toast.error(`You can select up to ${BULK_LIMIT} schedules at a time`)
      return next
    })
  }

  const clearFilters = () => {
    setSearchTerm('')
    setStatusFilter({ include: [], exclude: [] })
  }
  const hasActiveFilters =
    !!debouncedSearch ||
    (statusFilter.include?.length || 0) > 0 ||
    (statusFilter.exclude?.length || 0) > 0

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    const count = selected.size
    const ok = await confirm({
      title: `Delete ${count} schedule${count === 1 ? '' : 's'}?`,
      message:
        'The cron schedule(s) will be removed. The underlying workflows keep working manually — test runs and webhook URLs still fire. This cannot be undone.',
      confirmLabel: `Delete ${count}`,
      danger: true,
    })
    if (!ok) return
    setBulkBusy(true)
    try {
      await schedulesAPI.bulkDelete(Array.from(selected))
      toast.success(`Deleted ${count} schedule${count === 1 ? '' : 's'}`)
      setSelected(new Set())
      await fetchSchedules()
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  // Plan-cap upsell — render full-page upgrade prompt when the current
  // plan does not include schedulers. Read-only access to existing
  // schedules already created (e.g. by a downgraded Premium user) is
  // intentionally NOT exposed in this view; they'll keep firing on PSB
  // until the user re-upgrades or deletes them via PSB's portal.
  //
  // Render the page bg only until entitlements have loaded — without this
  // the schedule list renders for ~200ms before being replaced by the
  // upgrade gate, producing a visible flicker on every reload for Free users.
  if (!entLoaded) {
    return <div className="min-h-full bg-neutral-50 dark:bg-neutral-900" />
  }
  if (!schedulersEnabled) {
    return (
      <UpgradeGate
        feature="Schedules"
        description="Run your workflows on a recurring cron schedule. Schedulers are included on the Standard and Premium plans. Existing schedules created on a previous plan keep running."
      />
    )
  }

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900 leading-normal">
      <div className="p-3 sm:p-6 overflow-x-hidden">

        {/* Page header — matches Dashboard.tsx pattern: title left, action
            right, subtitle below title with row count. */}
        <div className="flex flex-row items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="min-w-0">
            {/* Both title and subtitle wrapped in `block` divs so the
                Tooltip's default inline-flex doesn't collapse them onto
                one line — matches Dashboard.jsx page-header pattern. */}
            <div className="block">
              <Tooltip content={tipLines('Recurring runs across all your workflows')} delay={300} position="bottom">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 cursor-default">Schedules</h1>
              </Tooltip>
            </div>
            <div className="block mt-0.5 sm:mt-1">
              <Tooltip content={tipLines('Total number of cron schedules attached to your workflows')} delay={300} position="bottom">
                <p className="text-gray-600 dark:text-neutral-400 text-sm sm:text-base cursor-default">
                  {loading ? ' ' : `${total} Schedule${total === 1 ? '' : 's'}`}
                </p>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <Tooltip content={tipLines('Re-fetch the list from Pabbly Functions')} delay={300} position="bottom">
              <button
                type="button"
                onClick={fetchSchedules}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-xl transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Filter bar — same surface tokens as Dashboard's filter card. */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-4 sm:mb-6">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
            <div className="col-span-2 sm:col-span-1 sm:min-w-[200px] sm:max-w-[280px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by workflow name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X size={14} className="text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            <div className="sm:min-w-[140px]">
              <MultiSearchableSelect
                label="Status"
                multi
                usePortal
                value={statusFilter}
                onChange={setStatusFilter}
                options={statusOptions}
                placeholder="All Statuses"
                searchPlaceholder="Search statuses…"
                renderOption={(opt) => (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span className="truncate">{opt.label}</span>
                  </span>
                )}
              />
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Bulk-action slot — same spacing rhythm as Dashboard.jsx. */}
        <div className="mb-3">
          {selected.size > 0 && (
            <ScheduleBulkBar
              count={selected.size}
              busy={bulkBusy}
              onDelete={handleBulkDelete}
              onClear={() => setSelected(new Set())}
            />
          )}
        </div>

        {/* Error banner — block-level, sits where the table would. Hidden
            while loading so a refetch (Try again / Refresh) immediately
            swaps to the skeleton table instead of showing stale error. */}
        {error && !loading && (
          <div className="bg-white dark:bg-neutral-800 border border-red-200 dark:border-red-900/40 shadow-sm p-4 mb-4 rounded-xl flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-neutral-100">Could not load schedules</div>
              <div className="text-sm text-gray-600 dark:text-neutral-400 mt-1">{error}</div>
              <button
                onClick={fetchSchedules}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Table card — flat surface, same as Dashboard. No rounded corners.
            Renders during loading too so the skeleton shows on refetch even
            if a prior error left state populated. */}
        {(!error || loading) && (
          <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
            <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[700px] lg:min-w-[1100px]">
                <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                  <tr>
                    <th className="w-[36px] sm:w-[44px] pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
                      <Tooltip content={tipLines(selectionState === 'all' ? 'Clear all selected rows on this page' : 'Select every row on this page')} delay={300} position="bottom">
                        <RowCheckbox
                          checked={selectionState === 'all'}
                          indeterminate={selectionState === 'partial'}
                          onChange={toggleAllOnPage}
                        />
                      </Tooltip>
                    </th>
                    <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[300px]">Workflow</th>
                    <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[360px]">Schedule</th>
                    <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[160px]">Next run</th>
                    <th className="hidden lg:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[160px]">Last run</th>
                    <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[120px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        <td className="pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3"><div className="w-4 h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse" /></td>
                        <td className="px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-3/4" /></td>
                        <td className="hidden md:table-cell px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-2/3" /></td>
                        <td className="hidden md:table-cell px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-16" /></td>
                        <td className="hidden lg:table-cell px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-16" /></td>
                        <td className="px-3 lg:px-4 py-3"><div className="h-5 bg-gray-200 dark:bg-neutral-700 rounded-full animate-pulse w-16" /></td>
                      </tr>
                    ))
                  ) : schedules.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <CalendarOff size={36} className="text-gray-300 dark:text-neutral-600 mb-3" />
                          <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-1">
                            {hasActiveFilters ? 'No schedules match the current filters' : 'No schedules yet'}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-neutral-400 mb-4 max-w-sm">
                            {hasActiveFilters
                              ? 'Try adjusting or clearing your filters.'
                              : 'Open any workflow and ask the Master Agent to schedule it (e.g. "run every weekday at 9am UTC").'}
                          </p>
                          {hasActiveFilters ? (
                            <button onClick={clearFilters} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors">
                              Clear filters
                            </button>
                          ) : (
                            <Link to="/dashboard" className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors">
                              Go to Dashboard
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    schedules.map((s) => {
                      const id = s._id || s.id
                      const isSelected = selected.has(id)
                      // Two cron renderings: bare for the cell (paired with
                      // local-tz times elsewhere) and with-tz for the tooltip
                      // so the schedule's source timezone stays accessible.
                      const tz = s.timezone || 'UTC'
                      const cronCell = humanizeCron(s.cron_expression, tz, { withTimezone: false })
                      const cronTooltip = humanizeCron(s.cron_expression, tz)
                      const workflowSlug = s.workflow_slug
                      const rawName = s.workflow_name || s.function_name || s.function_id || 'Unknown workflow'
                      // Capitalize first character only — preserve the rest of the
                      // user's casing (e.g. "myAPI Sync" stays mixed, just the leading
                      // letter is uppercased). Leading whitespace tolerated.
                      const workflowName = rawName.replace(/^(\s*)([a-z])/, (_, ws, ch) => ws + ch.toUpperCase())
                      return (
                        <tr key={id} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                          <td className="pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3">
                            <RowCheckbox checked={isSelected} onChange={() => toggleOne(id)} />
                          </td>
                          <td className="px-3 lg:px-4 py-3 max-w-0">
                            {workflowSlug ? (
                              <Link
                                to={`/workflows/${workflowSlug}`}
                                className="block min-w-0 no-underline group"
                              >
                                <Tooltip content={workflowName} delay={300}>
                                  <div className="text-sm font-medium text-gray-900 dark:text-neutral-100 line-clamp-2 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center gap-1.5">
                                    <span className="truncate">{workflowName}</span>
                                    <ExternalLink size={12} className="text-gray-400 dark:text-neutral-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </Tooltip>
                              </Link>
                            ) : (
                              <Tooltip content={workflowName} delay={300}>
                                <div className="text-sm font-medium text-gray-500 dark:text-neutral-400 line-clamp-2 break-words cursor-default">
                                  {workflowName}
                                </div>
                              </Tooltip>
                            )}
                            {/* Mobile-only schedule subtitle — Schedule
                                column is hidden below md, so cron shows
                                inline below the workflow name. */}
                            <div className="md:hidden mt-0.5 text-xs text-gray-500 dark:text-neutral-500 truncate">
                              {cronCell}
                            </div>
                          </td>
                          <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                            <Tooltip content={cronTooltip} delay={300}>
                              <div className="text-sm text-gray-700 dark:text-neutral-300 truncate cursor-default">
                                {cronCell}
                              </div>
                            </Tooltip>
                          </td>
                          <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                            {deriveStatusKey(s) === 'enabled' ? (
                              <Tooltip content={fmtAbsoluteLong(s.next_run_at) || 'Not scheduled'} delay={300}>
                                <span className="text-sm text-gray-700 dark:text-neutral-300 tabular-nums whitespace-nowrap">
                                  {fmtRelative(s.next_run_at)}
                                </span>
                              </Tooltip>
                            ) : (
                              // Disabled / paused schedules don't fire — PF still
                              // carries the last-computed `next_run_at`, but
                              // surfacing "2m ago" reads as a missed run rather
                              // than what it actually is (no future run scheduled).
                              <Tooltip content="No upcoming run — schedule is not active" delay={300}>
                                <span className="text-sm text-gray-400 dark:text-neutral-500 cursor-default">—</span>
                              </Tooltip>
                            )}
                          </td>
                          <td className="hidden lg:table-cell px-3 lg:px-4 py-3">
                            {s.last_run_at ? (
                              <div className="flex flex-col gap-1">
                                <Tooltip content={fmtAbsoluteLong(s.last_run_at)} delay={300}>
                                  <span className="text-sm text-gray-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                                    {fmtRelative(s.last_run_at)}
                                  </span>
                                </Tooltip>
                                <LastRunBadge status={s.last_run_status} />
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400 dark:text-neutral-500">—</span>
                            )}
                          </td>
                          <td className="px-3 lg:px-4 py-3">
                            <StatusPill schedule={s} />
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination — only renders when there are rows. Identical
                component to the rest of the dashboard so behavior + visuals
                match. */}
            {!loading && schedules.length > 0 && (
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={total}
                itemsPerPage={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                loading={loading}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
