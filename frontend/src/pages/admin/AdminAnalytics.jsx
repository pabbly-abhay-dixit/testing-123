import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Users, Coins, Zap, Bot, TrendingUp, DollarSign, Activity, RotateCw, Copy, Check } from 'lucide-react'
import { adminAPI } from '../../services/api'
import toast from 'react-hot-toast'
import Pagination from '../../components/ui/Pagination'
import AnalyticsSkeleton from '../../components/ui/AnalyticsSkeleton'
import DailyTrendChart from '../../components/charts/DailyTrendChart'
import TopItemsBarChart from '../../components/charts/TopItemsBarChart'
import HourlyActivityChart from '../../components/charts/HourlyActivityChart'
import ProviderPieChart from '../../components/charts/ProviderPieChart'
import KeyTypeSplitChart from '../../components/charts/KeyTypeSplitChart'
import { formatNumber, formatCredits } from '../../components/charts/chartTheme'
import Tooltip from '../../components/ui/Tooltip'
import MultiSearchableSelect from '../../components/ui/MultiSearchableSelect'
import { resolveDatePreset } from '../../utils/dateRange'

// Default ("Yesterday") is the built-in placeholder row of MultiSearchableSelect —
// not listed here to avoid duplication. Yesterday is preferred over Today as
// the default because today is partial (in-progress) data.
const PERIODS = [
  { value: 'today',  label: 'Today' },
  { value: '7d',     label: 'Last 7 days' },
  { value: '30d',    label: 'Last 30 days' },
  { value: '90d',    label: 'Last 90 days' },
  { value: 'all',    label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

// Transactions section uses Today as its default (placeholder), so its
// dropdown swaps Today out for an explicit Yesterday option. The page-level
// charts/cards filter (PERIODS) keeps Yesterday-as-default because aggregate
// trend windows want stable, completed days.
const TX_PERIODS = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d',        label: 'Last 7 days' },
  { value: '30d',       label: 'Last 30 days' },
  { value: '90d',       label: 'Last 90 days' },
  { value: 'all',       label: 'All time' },
  { value: 'custom',    label: 'Custom range' },
]

const PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'xai', label: 'xAI' },
  { value: 'openrouter', label: 'OpenRouter' },
]

const KEY_TYPE_OPTIONS = [
  { value: 'platform', label: 'Platform' },
  { value: 'byok', label: 'BYOK' },
]

// Surface every credit-movement type so admins can audit purchases / bonuses
// alongside AI usage. Values match `credit_transactions.tx_type` exactly.
const TX_TYPE_OPTIONS = [
  { value: 'usage',         label: 'AI Usage' },
  { value: 'purchase',      label: 'Purchases' },
  { value: 'signup_bonus',  label: 'Signup Bonus' },
  { value: 'admin_grant',   label: 'Admin Grant' },
]

// `source` is usage-only — chat / test / run buckets credit deduction by
// where the LLM call originated. Non-usage rows simply lack this field.
const SOURCE_OPTIONS = [
  { value: 'chat', label: 'Master Agent' },
  { value: 'test', label: 'Test Run' },
  { value: 'run',  label: 'Workflow Run' },
]

// Row sort options. `newest` / `oldest` keep the cheap indexed
// `find().sort({created_at:_})` server path; `tx_desc` / `tx_asc` flip
// the backend into a `$setWindowFields` aggregation that groups rows by
// user_tx_count so a heavy user's rows appear contiguously at the top
// (or bottom). Backend defaults to `newest` on unknown values, so a
// stale frontend chip can never break the table.
const SORT_OPTIONS = [
  { value: 'newest',  label: 'Newest first' },
  { value: 'oldest',  label: 'Oldest first' },
  { value: 'tx_desc', label: 'Most-active users on top' },
  { value: 'tx_asc',  label: 'Least-active users on top' },
]

// Human-readable label + tailwind classes for the Type column / chip.
// Reused by both the desktop table cell and the mobile card variant.
// `description` powers the tooltip content on touch surfaces (cards)
// where the column header isn't visible — explains what each chip means
// in plain language.
function txTypeMeta(t) {
  switch (t) {
    case 'purchase':
      return { label: 'Purchase', description: 'Type: Purchase — credits added via Pabbly Subscription Billing', cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400' }
    case 'signup_bonus':
      return { label: 'Signup Bonus', description: 'Type: Signup Bonus — free credits granted on first SSO signup', cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400' }
    case 'admin_grant':
      return { label: 'Admin Grant', description: 'Type: Admin Grant — credits added manually from this panel', cls: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/50 text-violet-700 dark:text-violet-400' }
    case 'usage':
    default:
      return { label: 'AI Usage', description: 'Type: AI Usage — credits deducted for an LLM API call', cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400' }
  }
}

// Source pill — mirrors the user-facing Credits page visual language so
// admins moving between user-side and admin-side surfaces don't have to
// re-learn the color → meaning mapping.
function sourceMeta(s) {
  switch (s) {
    case 'chat': return { label: 'Master Agent', description: 'Source: Master Agent — credit deducted from a chat builder turn', cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400' }
    case 'test': return { label: 'Test Run',     description: 'Source: Test Run — credit deducted from a test_workflow / Test Panel call', cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400' }
    case 'run':  return { label: 'Workflow Run', description: 'Source: Workflow Run — credit deducted from an external webhook / live workflow trigger', cls: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/50 text-violet-700 dark:text-violet-400' }
    default:     return null
  }
}

// Key-type pill description — same purpose as txType / source meta.
function keyTypeMeta(kt) {
  return kt === 'byok'
    ? { label: 'BYOK', description: 'Key Type: BYOK — call ran on the user\'s own API key, no platform credits deducted', cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' }
    : { label: 'Platform', description: 'Key Type: Platform — call billed to platform credits via Pabbly Provider', cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' }
}

const fmtCr = (v) => (v || 0) >= 10 ? Math.round(v).toLocaleString() : (v || 0).toFixed(2)
const fmtDlr = (v) => '$' + ((v || 0) >= 10 ? Math.round(v).toLocaleString() : (v || 0).toFixed(2))

// localStorage persistence — admins explicitly asked for filters to survive a
// page refresh. Stored as a single JSON blob under one key so it's easy to
// invalidate later. Wrapped in try/catch because localStorage can be disabled
// (private browsing) or quota-exceeded; we silently fall back to defaults.
//
// v2 bump (2026-05-04): added Type / Workflow / Source filters to the
// transaction section. Old v1 blobs carried only date+user+provider+key_type;
// loading them as-is works (extra keys default to empty), but bumping the key
// flushes any stale blob whose structure we might evolve again later.
const FILTERS_STORAGE_KEY = 'admin-analytics-filters-v2'

function loadStoredFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveStoredFilters(filters) {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // ignore — quota / private browsing
  }
}

// Single rule: emerald = positive (profit/savings), red = cost, neutral default.
// No more rainbow.
const ACCENT = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  neutral: 'text-gray-900 dark:text-neutral-100',
}

// Generic pulse bar — building block for all inline skeleton placeholders.
function Skel({ className = '', style }) {
  return <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} style={style} />
}

function MetricCard({ icon: Icon, label, value, sub, accent = 'neutral', tip, loading = false }) {
  const colorCls = ACCENT[accent] || ACCENT.neutral
  // Card chrome (label + icon) stays rendered while loading so the user sees
  // *what* is loading instead of an abstract gray box. Only the value + sub
  // get the skeleton treatment.
  const inner = (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full h-full">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={14} className="text-neutral-400" />}
        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider truncate">{label}</span>
      </div>
      {loading ? (
        <>
          <Skel className="h-7 w-24 mt-1" />
          <Skel className="h-3 w-32 mt-2" />
        </>
      ) : (
        <>
          <p className={`text-2xl font-bold ${colorCls}`}>{value}</p>
          {sub && <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 truncate">{sub}</p>}
        </>
      )}
    </div>
  )
  return tip && !loading ? <Tooltip content={tip} className="w-full">{inner}</Tooltip> : inner
}

// Chart-area loaders — each mirrors the visual shape of the chart it stands in
// for, so the page layout stays identical between loading and loaded states.
function LineChartSkel({ height = 260 }) {
  // Big block + axis tick row at the bottom — mimics a line/area chart.
  return (
    <div className="relative w-full" style={{ height }}>
      <Skel className="absolute inset-0 rounded-md" />
      <div className="absolute left-0 right-0 bottom-2 flex justify-between px-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skel key={i} className="h-2 w-6" />
        ))}
      </div>
    </div>
  )
}

function DonutSkel({ height = 280 }) {
  return (
    <div className="flex flex-col items-center justify-center w-full" style={{ height }}>
      <div
        className="rounded-full border-[18px] border-neutral-200 dark:border-neutral-700 animate-pulse"
        style={{ width: 168, height: 168 }}
      />
      <div className="flex gap-3 mt-4">
        {Array.from({ length: 3 }).map((_, i) => <Skel key={i} className="h-3 w-16" />)}
      </div>
    </div>
  )
}

function BarsSkel({ height = 280 }) {
  // Vertical-bar shape — mirrors hourly activity. Random heights for realism.
  const heights = [12, 8, 10, 14, 22, 18, 30, 45, 70, 60, 50, 80, 92, 70, 55, 90, 78, 65, 45, 30, 20, 18, 12, 10]
  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end justify-between h-[88%] gap-1 px-1">
        {heights.map((h, i) => (
          <Skel key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, minWidth: 6 }} />
        ))}
      </div>
      <div className="flex justify-between px-1 mt-2">
        {Array.from({ length: 8 }).map((_, i) => <Skel key={i} className="h-2 w-6" />)}
      </div>
    </div>
  )
}

function BarRowsSkel({ rows = 10, height }) {
  // Horizontal bars matching TopItemsBarChart's row layout (name + bar).
  const widths = ['90%', '78%', '64%', '58%', '52%', '45%', '38%', '32%', '24%', '18%']
  const rowHeight = 24
  const computedHeight = height || rows * rowHeight + 32
  return (
    <div className="w-full" style={{ height: computedHeight }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(110px, 22%) 1fr' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="contents">
            <Skel className="h-3 self-center" style={{ width: '70%' }} />
            <Skel className="h-2.5 self-center" style={{ width: widths[i] || '20%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Reusable card shell for charts; supports optional tab switcher.
// Skeleton row for the desktop transaction table — matches the 9-column
// layout (Type · User · Workflow · Key Type · Source · Provider · Tokens
// · Credits · Date) so the table doesn't shift when real data arrives.
function TxTableSkeletonRow() {
  const Bar = ({ w }) => (
    <div className={`bg-neutral-200 dark:bg-neutral-700 rounded h-3 animate-pulse`} style={{ width: w }} />
  )
  return (
    <tr>
      <td className="px-3 lg:px-4 py-3"><Bar w={56} /></td>{/* Type */}
      <td className="px-3 lg:px-4 py-3"><Bar w={110} /></td>{/* User */}
      <td className="px-3 lg:px-4 py-3"><Bar w={120} /></td>{/* Workflow */}
      <td className="px-3 lg:px-4 py-3"><Bar w={56} /></td>{/* Key Type */}
      <td className="px-3 lg:px-4 py-3"><Bar w={64} /></td>{/* Source */}
      <td className="px-3 lg:px-4 py-3 align-top space-y-1.5"><Bar w={70} /><Bar w={50} /></td>{/* Provider + Model */}
      <td className="px-3 lg:px-4 py-3"><div className="ml-auto"><Bar w={70} /></div></td>{/* Tokens */}
      <td className="px-3 lg:px-4 py-3"><div className="ml-auto"><Bar w={50} /></div></td>{/* Credits */}
      <td className="px-3 lg:px-4 py-3"><Bar w={90} /></td>{/* Date */}
    </tr>
  )
}

// Skeleton card for the mobile transaction list.
// Card skeleton — mirrors the 6-row inline-labeled card (Type | Credits;
// User; Workflow; Provider | Tokens; Source | Key Type; Date) so the
// layout doesn't shift when real data lands. Each row is a horizontal
// strip: a tiny label bar followed by the value bar, matching the live
// card's "LABEL value" inline rhythm. Labels are hidden at < sm to
// match the live card (values render full-width on mobile).
function TxCardSkeleton() {
  const Bar = ({ w, h = 'h-3', className = '' }) => (
    <div className={`bg-neutral-200 dark:bg-neutral-700 rounded ${h} animate-pulse ${className}`} style={{ width: w }} />
  )
  const Label = ({ w = 32 }) => <Bar w={w} h="h-2" className="opacity-70 hidden sm:block" />

  return (
    <div className="px-3 sm:px-4 py-3 space-y-1.5">
      {/* Row 1 — Type | Credits */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5"><Label /><Bar w={60} /></div>
        <div className="flex items-center gap-1.5"><Label w={40} /><Bar w={70} /></div>
      </div>
      {/* Row 2 — User */}
      <div className="flex items-center gap-1.5"><Label /><Bar w="55%" /></div>
      {/* Row 3 — Workflow */}
      <div className="flex items-center gap-1.5"><Label w={50} /><Bar w="60%" /></div>
      {/* Row 4 — Provider | Tokens */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5"><Label w={45} /><Bar w={120} /></div>
        <div className="flex items-center gap-1.5"><Label w={42} /><Bar w={70} /></div>
      </div>
      {/* Row 5 — Source | Key Type */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5"><Label w={40} /><Bar w={64} /></div>
        <div className="flex items-center gap-1.5"><Label w={50} /><Bar w={56} /></div>
      </div>
      {/* Row 6 — Date */}
      <div className="flex items-center gap-1.5"><Label /><Bar w="55%" /></div>
    </div>
  )
}

function ChartCard({ title, tip, tabs, activeTab, onTabChange, children, footer }) {
  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        {tip ? (
          <Tooltip content={tip}>
            <h3 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider inline-block">{title}</h3>
          </Tooltip>
        ) : (
          <h3 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{title}</h3>
        )}
        {tabs && (
          <div className="inline-flex bg-neutral-100 dark:bg-neutral-700 rounded-lg p-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`px-2 sm:px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 shadow-sm'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-100'
                }`}
              >{tab.label}</button>
            ))}
          </div>
        )}
      </div>
      {children}
      {footer}
    </div>
  )
}

export default function AdminAnalytics() {
  // Hydrate from localStorage so a refresh restores every filter the admin
  // had selected. Falls back to defaults when the slot is empty / corrupted.
  const stored = loadStoredFilters() || {}
  const [period, setPeriod] = useState(stored.period || 'yesterday')
  const [startDate, setStartDate] = useState(stored.startDate || '')
  const [endDate, setEndDate] = useState(stored.endDate || '')
  // `loading` shows the full skeleton — only on the very first fetch when we
  // have no data yet. After that, filter changes flip `refreshing` true and
  // the existing data stays on screen with a subtle progress overlay so the
  // UI never blanks out for a slow backend round-trip.
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState(null)
  const [opStats, setOpStats] = useState(null)
  const [topUsers, setTopUsers] = useState([])

  // Chart toggles — distribution by Provider/Key Type, top by User/Workflow/Model
  const [distMode, setDistMode] = useState('provider')
  const [topMode, setTopMode] = useState('user')

  // Transaction log state — has its own date range, independent from the
  // page-level period above. The user explicitly asked for these to be
  // separate so admins can drill into transactions for a different window
  // than the cards / charts above them.
  const [transactions, setTransactions] = useState([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [txPageSize, setTxPageSize] = useState(10)
  // Default Today (live data). Charts use Yesterday because aggregate trends
  // want completed days; the transactions table is for "what's happening
  // right now" so the default sits on the in-progress day.
  const [txPeriod, setTxPeriod] = useState(stored.txPeriod || 'today')
  const [txStartDate, setTxStartDate] = useState(stored.txStartDate || '')
  const [txEndDate, setTxEndDate] = useState(stored.txEndDate || '')
  const [providerFilter, setProviderFilter] = useState(stored.providerFilter || { include: [], exclude: [] })
  const [keyTypeFilter, setKeyTypeFilter] = useState(stored.keyTypeFilter || { include: [], exclude: [] })
  const [userFilter, setUserFilter] = useState(stored.userFilter || { include: [], exclude: [] })
  // Default tx_type filter is EMPTY — table shows every transaction
  // type (usage / purchase / signup_bonus / admin_grant) until the
  // admin opts into a subset via the Type chip. The earlier "AI Usage
  // only" default was confusing — it made the Clear-filters affordance
  // appear permanently active, and clearing didn't actually clear it.
  const [txTypeFilter, setTxTypeFilter] = useState(stored.txTypeFilter || { include: [], exclude: [] })
  const [workflowFilter, setWorkflowFilter] = useState(stored.workflowFilter || { include: [], exclude: [] })
  const [sourceFilter, setSourceFilter] = useState(stored.sourceFilter || { include: [], exclude: [] })
  // Row ordering — defaults to newest-first (matches the historical behavior
  // before this control existed). Persisted in the same localStorage blob as
  // the chip filters so a refresh restores the chosen sort.
  const [txSort, setTxSort] = useState(stored.txSort || 'newest')
  // Workflow filter dropdown options — fetched once on mount, cross-user.
  // Carries `_owner` + `_trashed` so the option renderer can show the
  // owner email under the workflow name and tag deleted rows.
  const [workflowOptions, setWorkflowOptions] = useState([])
  // ALL users on the platform — feeds the User filter dropdown so admins can
  // filter by users who have no recent activity (top-spenders-only would
  // hide them). Fetched once on mount; loaded in parallel with workflows.
  const [allUserOptions, setAllUserOptions] = useState([])
  const [txLoading, setTxLoading] = useState(false)
  // Refresh-mode flag — keeps existing rows on screen while a refetch is in
  // flight so the manual Refresh button (and any future silent refetch) does
  // not flash the table to skeletons. `txInitialLoaded` flips true after the
  // first successful fetch so subsequent fetches can opt into refresh-mode.
  const [txRefreshing, setTxRefreshing] = useState(false)
  const txInitialLoadedRef = useRef(false)
  const isCustomTxRange = txPeriod === 'custom' && txStartDate && txEndDate

  // Per-row Token Usage & Cost tooltip — mirrors the rich breakdown on the
  // user-facing Credits page so admins see the same Input/Cache Read/Cache
  // Write/Output rows + per-token rate + raw API cost + final credit
  // deduction without leaving the Transactions table. Hover-driven on
  // desktop, tap-toggle on mobile (handled inline via the same setter).
  const [tokenTip, setTokenTip] = useState({ visible: false, tx: null, x: 0, y: 0, above: false })
  // Pricing map — keyed by model id; carries $/Mtok rates per token type.
  // Sourced from `/api/admin/pricing` so the rate / cost columns reflect
  // the canonical operator-side numbers (margin_multiplier comes alongside
  // and is used to derive the "with-margin" line in the totals block).
  const [pricingMap, setPricingMap] = useState({})
  const [marginMultiplier, setMarginMultiplier] = useState(2.0)

  // ── Interactive user popover (hover on user-name cell) ──
  // Two trade-offs vs. the shared `Tooltip` component:
  //   1. Tooltip uses `pointer-events: none` → Copy button inside would
  //      be unclickable. We need an interactive surface.
  //   2. Adjacent table rows steal the hover when the cursor transits
  //      over them. The naive fix (place popover BELOW with an 8 px gap)
  //      doesn't work — that gap is exactly where row N+1's user cell
  //      starts, so the cursor's mouseenter fires for tx_{N+1} before
  //      it reaches the popover.
  // Real fix: place popover BELOW with NO vertical gap (top: rect.bottom)
  // and `pointer-events-auto`. The popover overlays row N+1's cells via
  // its z-index, and since pointer events go to the topmost element, the
  // cursor lands on the popover instead of triggering row N+1. Result:
  // cursor moves down → cell boundary at rect.bottom → instantly enters
  // popover. No transit gap, no row-N+1 hijack.
  const [userPopover, setUserPopover] = useState({ visible: false, tx: null, x: 0, y: 0, placement: 'below' })
  const userPopoverHideTimer = useRef(null)
  const userPopoverShowTimer = useRef(null)
  const [copiedEmail, setCopiedEmail] = useState(null)

  // Approximate popover dimensions for placement math. Real dimensions are
  // measured-after-render in the Tooltip component; here we accept a small
  // estimate-vs-actual mismatch in exchange for keeping the implementation
  // simple — the popover is short and the viewport-clamp handles drift.
  const POPOVER_W = 280
  const POPOVER_H = 86

  const showUserPopover = (e, tx) => {
    if (userPopoverHideTimer.current) {
      clearTimeout(userPopoverHideTimer.current)
      userPopoverHideTimer.current = null
    }
    if (!tx?.user_email && !tx?.user_name) return
    const rect = e.currentTarget.getBoundingClientRect()

    // Default: BELOW the cell. Flip ABOVE only when the bottom of the
    // viewport is too tight AND the top has room. The "no gap" placement
    // is the key to preventing adjacent-row hijack — see comment above.
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const placement = (spaceBelow < POPOVER_H + 8 && spaceAbove > POPOVER_H + 8)
      ? 'above'
      : 'below'

    // Anchor x to the cell's left edge. If the popover would overflow
    // the viewport's right edge, shift it left to fit (still keeps the
    // popover roughly aligned with the user's eye line on the name).
    let x = rect.left
    if (x + POPOVER_W > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - POPOVER_W - 8)
    }
    if (x < 8) x = 8

    // y: cell.bottom for below, cell.top for above. NO GAP — the popover
    // touches the cell boundary so the cursor's transit is unbroken.
    const y = placement === 'below' ? rect.bottom : rect.top

    // Small show-delay so quick hover-throughs (cursor scanning the table)
    // don't spam the popover on every adjacent row.
    if (userPopoverShowTimer.current) clearTimeout(userPopoverShowTimer.current)
    userPopoverShowTimer.current = setTimeout(() => {
      setUserPopover({ visible: true, tx, x, y, placement })
    }, 120)
  }

  const scheduleHideUserPopover = () => {
    // Cancel any pending show first — if user moves out before the show
    // delay elapses, no popover should ever appear.
    if (userPopoverShowTimer.current) {
      clearTimeout(userPopoverShowTimer.current)
      userPopoverShowTimer.current = null
    }
    if (userPopoverHideTimer.current) clearTimeout(userPopoverHideTimer.current)
    userPopoverHideTimer.current = setTimeout(() => {
      setUserPopover({ visible: false, tx: null, x: 0, y: 0, placement: 'right' })
      setCopiedEmail(null)
    }, 220)
  }

  const cancelHideUserPopover = () => {
    if (userPopoverHideTimer.current) {
      clearTimeout(userPopoverHideTimer.current)
      userPopoverHideTimer.current = null
    }
  }

  const copyEmail = async (email) => {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopiedEmail(email)
      toast.success('Email copied', { id: 'admin-tx-email-copy' })
      // Revert the icon after a short window — keeps the popover usable
      // for a second copy without leaving the green check stuck on.
      setTimeout(() => setCopiedEmail(c => (c === email ? null : c)), 1400)
    } catch {
      toast.error('Could not copy — clipboard blocked')
    }
  }

  const isCustomRange = period === 'custom' && startDate && endDate

  const buildPeriodParams = () => {
    const presetRange = resolveDatePreset(period)
    if (presetRange) return { start_date: presetRange.date_from, end_date: presetRange.date_to }
    if (period === 'custom') return isCustomRange ? { start_date: startDate, end_date: endDate } : null
    return { period }
  }

  const fetchAll = async () => {
    const periodParams = buildPeriodParams()
    if (!periodParams) return
    // Only show the full skeleton on the very first load. Subsequent fetches
    // keep existing data rendered + flip `refreshing` so the user sees a
    // progress indicator instead of a UI wipe.
    const isFirstLoad = summary === null
    if (isFirstLoad) setLoading(true)
    else setRefreshing(true)
    try {
      const [sumRes, usersRes, statsRes] = await Promise.all([
        adminAPI.getUsageSummary(periodParams),
        adminAPI.getTopUsers(periodParams),
        adminAPI.getStats(periodParams),
      ])
      setSummary(sumRes.data)
      setTopUsers(usersRes.data?.users || [])
      setOpStats(statsRes.data)
    } catch {
      // Stable toast id so retries replace the existing toast instead of
      // stacking — server-down scenarios were piling up 5+ identical toasts.
      toast.error("We couldn't load analytics right now. Please try again.", {
        id: 'admin-analytics-load',
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const buildFilterParams = () => {
    const out = {}
    if (providerFilter.include.length) out.providers = providerFilter.include.join(',')
    if (providerFilter.exclude.length) out.providers_exclude = providerFilter.exclude.join(',')
    if (keyTypeFilter.include.length) out.key_types = keyTypeFilter.include.join(',')
    if (keyTypeFilter.exclude.length) out.key_types_exclude = keyTypeFilter.exclude.join(',')
    if (userFilter.include.length) out.user_ids = userFilter.include.join(',')
    if (userFilter.exclude.length) out.user_ids_exclude = userFilter.exclude.join(',')
    // tx_types — backend defaults to "usage" when omitted, so an empty
    // include list is equivalent to "AI Usage only". We send the CSV
    // explicitly when at least one chip is selected; if the admin clears
    // the chip the param is omitted and the back-compat default applies.
    if (txTypeFilter.include.length) out.tx_types = txTypeFilter.include.join(',')
    if (workflowFilter.include.length) out.agent_ids = workflowFilter.include.join(',')
    if (sourceFilter.include.length) out.sources = sourceFilter.include.join(',')
    // Always include sort even when "newest" (the backend default) so the
    // server log + admin_cache key reflect the explicit user choice.
    if (txSort) out.sort = txSort
    return out
  }

  // Transaction log uses its own period state (txPeriod / txStartDate /
  // txEndDate) — independent from the page-level date range. Defaults to 7d.
  const buildTxPeriodParams = () => {
    const presetRange = resolveDatePreset(txPeriod)
    if (presetRange) return { start_date: presetRange.date_from, end_date: presetRange.date_to }
    if (txPeriod === 'custom') return isCustomTxRange ? { start_date: txStartDate, end_date: txEndDate } : null
    return { period: txPeriod }
  }

  // `mode` controls how the in-flight state is surfaced to the user:
  //   'auto'    → first fetch shows the skeleton; later auto-fetches (filter
  //               changes, pagination) also show the skeleton because the
  //               displayed data is no longer valid for the new query.
  //   'refresh' → manual user action. Existing rows stay on screen and only
  //               a quiet button-spinner flips on, so the view does not jump
  //               and the admin's reading position is preserved.
  // The refresh path also keeps `txPage` as-is — same query, same window.
  const fetchTransactions = async (page = 1, limitOverride, mode = 'auto') => {
    const periodParams = buildTxPeriodParams()
    if (!periodParams) return
    const isRefresh = mode === 'refresh' && txInitialLoadedRef.current
    if (isRefresh) setTxRefreshing(true)
    else setTxLoading(true)
    try {
      const limit = limitOverride ?? txPageSize
      const params = { page, limit, ...buildFilterParams(), ...periodParams }
      const res = await adminAPI.getTransactions(params)
      setTransactions(res.data?.transactions || [])
      setTxTotal(res.data?.total || 0)
      setTxPage(page)
      txInitialLoadedRef.current = true
    } catch {
      toast.error("We couldn't load the transaction log. Please try again.", {
        id: 'admin-analytics-tx',
      })
    } finally {
      setTxLoading(false)
      setTxRefreshing(false)
    }
  }

  // Manual refresh — same filters, same page, same scroll. The whole point
  // is "give me the latest numbers without disturbing my view."
  const handleTxRefresh = () => fetchTransactions(txPage, undefined, 'refresh')

  // Page-level cards / charts: only refetch on page period change.
  useEffect(() => { fetchAll() }, [period, startDate, endDate])

  // Workflow + All-users dropdowns — fetched once on mount, in parallel.
  // Failures are silent (toast would be noise; the filter just stays empty
  // and admins can still filter by other dimensions). `_ownerId` is the join
  // key for narrowing the workflow list by the User filter (see
  // filteredWorkflowOptions below). The all-users list is the dropdown
  // source — `topUsers` only carries top spenders for the current page-level
  // window, which would hide every user with no recent activity from the
  // filter.
  useEffect(() => {
    let cancelled = false
    adminAPI.getWorkflowsListMin().then(res => {
      if (cancelled) return
      const list = res.data?.workflows || []
      setWorkflowOptions(list.map(w => ({
        value: w.id,
        // Search target — name + email so typing either matches.
        label: `${w.name || 'Untitled'} ${w.owner_email || ''}`.trim(),
        _name: w.name || 'Untitled',
        _ownerId: w.owner_id,
        _ownerName: w.owner_name,
        _email: w.owner_email,
        _trashed: w.is_trashed,
      })))
    }).catch(() => { /* silent — see comment above */ })
    adminAPI.getUsersListMin().then(res => {
      if (cancelled) return
      const list = res.data?.users || []
      setAllUserOptions(list.map(u => ({
        value: u.id,
        // Search target — name + email so typing either matches; lets the
        // admin search "pabbly" and Select-all-matching to bulk-exclude
        // every internal address in one click.
        label: `${u.name || ''} ${u.email || ''}`.trim() || 'Unknown',
        _name: u.name || u.email || 'Unknown',
        _email: u.email,
      })))
    }).catch(() => { /* silent — see comment above */ })
    // Pricing — feeds the per-row Token Usage & Cost tooltip with live
    // $/Mtok rates. Admin endpoint (vs. /api/credits/pricing) so non-
    // anonymized model names + raw cost figures are available; this whole
    // page is already gated on is_admin so no extra leakage risk.
    adminAPI.getPricing().then(res => {
      if (cancelled) return
      const map = {}
      for (const m of res.data?.models || []) map[m.model] = m
      setPricingMap(map)
      if (typeof res.data?.margin_multiplier === 'number') {
        setMarginMultiplier(res.data.margin_multiplier)
      }
    }).catch(() => { /* silent — tooltip degrades to "no pricing" footer */ })
    return () => { cancelled = true }
  }, [])

  // Persist all filters to localStorage on every change so a refresh restores
  // exactly the same view. Single keyed JSON blob — easy to invalidate later.
  useEffect(() => {
    saveStoredFilters({
      period, startDate, endDate,
      txPeriod, txStartDate, txEndDate,
      providerFilter, keyTypeFilter, userFilter,
      txTypeFilter, workflowFilter, sourceFilter,
      txSort,
    })
  }, [period, startDate, endDate, txPeriod, txStartDate, txEndDate,
      providerFilter, keyTypeFilter, userFilter,
      txTypeFilter, workflowFilter, sourceFilter, txSort])

  // Transaction log: refetch independently on its own period + filters. The
  // first fetch shows the skeleton; every subsequent filter change uses
  // 'refresh' mode so the existing rows stay on screen and only a subtle
  // progress bar flips on. Without this the table flashed back to skeletons
  // on every chip click — the "dancing" the admin reported.
  const txFilterMountRef = useRef(true)
  useEffect(() => {
    if (txFilterMountRef.current) {
      txFilterMountRef.current = false
      // Initial fetch on mount — auto mode shows the full skeleton because
      // we have nothing to render yet.
      fetchTransactions(1)
      return
    }
    fetchTransactions(1, undefined, 'refresh')
  }, [txPeriod, txStartDate, txEndDate, providerFilter, keyTypeFilter, userFilter,
      txTypeFilter, workflowFilter, sourceFilter, txSort])

  const t = summary?.totals || {}

  // ── Cross-filter narrowing ──
  //
  // The two filter dropdowns share an owner relationship: each workflow
  // belongs to exactly one user. When one filter is active the other
  // narrows so the dropdown only offers options that are still
  // consistent with the current selection.
  //
  // 1. Workflow ← User: User filter narrows the workflow list.
  // 2. User ← Workflow: Workflow filter narrows the user list (reverse).
  //
  // Currently-selected chips are always retained in the option list so
  // MultiSearchableSelect can resolve their labels — otherwise a chip
  // would render as an opaque hex id when its owner gets filtered out
  // of the narrowed list.
  const filteredWorkflowOptions = (() => {
    const inc = userFilter.include
    const exc = userFilter.exclude
    if (inc.length === 0 && exc.length === 0) return workflowOptions
    const selected = new Set([
      ...workflowFilter.include,
      ...workflowFilter.exclude,
    ])
    return workflowOptions.filter(w => {
      if (selected.has(w.value)) return true
      if (inc.length > 0) return w._ownerId && inc.includes(w._ownerId)
      return !w._ownerId || !exc.includes(w._ownerId)
    })
  })()

  // Reverse: when Workflow filter has includes, the User dropdown is
  // built from the OWNERS of those workflows. Without a Workflow filter
  // the dropdown shows the full all-users list (`allUserOptions`) —
  // previously this fell back to `topUsers` (top 20 spenders in the
  // page-level period), which silently hid every user with no recent
  // activity and made the filter feel broken on quiet days. We DON'T
  // narrow by Workflow exclude because excluding workflow X still leaves
  // user X's other workflows' transactions in scope, so the user list
  // shouldn't shrink.
  const filteredUserOptions = (() => {
    const inc = workflowFilter.include

    if (inc.length === 0) return allUserOptions

    // Narrowed list: derive options directly from the selected workflows'
    // owners. A workflow owner who isn't yet loaded into `allUserOptions`
    // (e.g. mount-time fetch still in flight, or list-min cap exceeded)
    // is still surfaced via the workflow row's denormalized owner fields.
    const ownerMap = new Map() // ownerId → { name, email }
    workflowOptions
      .filter(w => inc.includes(w.value) && w._ownerId)
      .forEach(w => {
        if (!ownerMap.has(w._ownerId)) {
          ownerMap.set(w._ownerId, { name: w._ownerName, email: w._email })
        }
      })

    const out = Array.from(ownerMap.entries()).map(([id, { name, email }]) => ({
      value: id,
      label: `${name || ''} ${email || ''}`.trim() || 'Unknown',
      _name: name || email || 'Unknown',
      _email: email,
    }))

    // Preserve currently-selected user chips even if they fall outside
    // the narrowed owner set (so labels stay readable on screen). Pull
    // from `allUserOptions` first (full list) and fall back to topUsers
    // for legacy ids that pre-dated the all-users endpoint.
    const inOut = new Set(out.map(o => o.value))
    const selectedUserIds = new Set([...userFilter.include, ...userFilter.exclude])
    for (const opt of allUserOptions) {
      if (selectedUserIds.has(opt.value) && !inOut.has(opt.value)) {
        out.push(opt)
        inOut.add(opt.value)
      }
    }
    for (const u of topUsers) {
      if (selectedUserIds.has(u.user_id) && !inOut.has(u.user_id)) {
        out.push({
          value: u.user_id,
          label: `${u.name || ''} ${u.email || ''}`.trim() || 'Unknown',
          _name: u.name || u.email || 'Unknown',
          _email: u.email,
        })
        inOut.add(u.user_id)
      }
    }
    return out
  })()

  // Derived values
  const byokKeyType = (summary?.by_key_type || []).find(k => k.key_type === 'byok')
  const platformKeyType = (summary?.by_key_type || []).find(k => k.key_type === 'platform')
  const byokRequests = byokKeyType?.requests || 0
  const platformRequests = platformKeyType?.requests || 0
  const totalRequests = t.total_requests || (byokRequests + platformRequests) || 0
  const profitMultiplier = opStats?.margin_multiplier || 1
  const profitPct = profitMultiplier > 1 ? Math.round(((profitMultiplier - 1) / profitMultiplier) * 100) : 0

  // Top-by-cost data for the merged chart — same shape per tab
  const topByCostData = (() => {
    if (topMode === 'user') {
      return topUsers.slice(0, 10).map(u => ({
        name: u.name || u.email || 'Unknown',
        value: u.total_cost ? u.total_cost * 1e6 : 0,
        extra: {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cache_read: u.cache_read_tokens || 0,
          cache_write: u.cache_write_tokens || 0,
          requests: u.requests || u.total_requests || 0,
        },
      }))
    }
    if (topMode === 'workflow') {
      return (summary?.by_agent || []).slice(0, 10).map(a => ({
        name: a.name || 'Unknown',
        value: a.cost ? a.cost * 1e6 : 0,
        extra: {
          input: a.input_tokens || 0,
          output: a.output_tokens || 0,
          cache_read: a.cache_read_tokens || 0,
          cache_write: a.cache_write_tokens || 0,
          requests: a.requests || a.total_requests || 0,
        },
      }))
    }
    // model
    return (summary?.by_model || []).slice(0, 10).map(m => ({
      name: (m.model || 'Unknown').replace('claude-', '').replace('gpt-', 'GPT-'),
      value: (m.cost || m.total_cost_usd || 0) * 1e6,
      extra: {
        input: m.input_tokens || 0,
        output: m.output_tokens || 0,
        cache_read: m.cache_read_tokens || 0,
        cache_write: m.cache_write_tokens || 0,
        requests: m.requests || m.total_requests || 0,
      },
    }))
  })()

  // Single brand color across all Top-by-Cost tabs — the X-axis labels make
  // the dimension obvious; switching colors per tab just adds visual noise.
  // Blue-500 matches the primary action color used elsewhere.
  const topByCostColor = '#3b82f6'
  const topByCostEmpty = `No ${topMode} data yet`

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Outer header card — wraps filter row + section heading + 6-card
          metric grid, mirroring the Plan / AI Credits / BYOK Token Usage
          tabs so the entire app reads as one design family. */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3 sm:gap-5">
          <div className="w-full sm:w-auto sm:min-w-[180px] sm:max-w-[240px]">
            <MultiSearchableSelect
              label="Date Range"
              labelTooltip="Window for cards & charts above. Pick a preset (today, 7/30/90 days, all time) or use 'Custom range' to enter exact start + end dates. Defaults to yesterday."
              usePortal
              value={period === 'yesterday' ? '' : period}
              onChange={(v) => {
                const next = v || 'yesterday'
                setPeriod(next)
                if (next !== 'custom') { setStartDate(''); setEndDate('') }
              }}
              options={PERIODS}
              placeholder="Yesterday"
              searchPlaceholder="Search…"
            />
          </div>

          {period === 'custom' && (
            <>
              {/* `flex flex-col items-start` forces label-on-top, input-below
                  layout — matches the symmetry of the Date Range / User /
                  Provider / Key Type columns above. Without this the Tooltip
                  wrapper renders inline and label + input collapse onto a
                  single row. */}
              <div className="flex flex-col items-start">
                <Tooltip content="First day of the custom window (inclusive). Cards & charts will count data from 00:00 on this date.">
                  <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1 cursor-help">Start date</label>
                </Tooltip>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                />
              </div>
              <div className="flex flex-col items-start">
                <Tooltip content="Last day of the custom window (inclusive). Data is counted up to 23:59 on this date.">
                  <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1 cursor-help">End date</label>
                </Tooltip>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                />
              </div>
              {!isCustomRange && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pb-1.5">Pick both dates to load data.</p>
              )}
            </>
          )}
        </div>

        {/* Divider + section heading + 6-card metric grid, all nested
            inside the outer header card. Matches the Plan / AI Credits
            / BYOK Token Usage tabs. */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 mt-4 pt-4">
          <Tooltip content="Headline platform metrics for the selected period — users, requests, credits, profit, revenue, tokens.">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 cursor-help inline-block">
              Platform Overview
            </h3>
          </Tooltip>
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3">
          <MetricCard
            icon={Users}
            label="Active Users"
            loading={loading && !summary}
            value={summary?.active_users || 0}
            sub={opStats ? `${(opStats.total_users || 0).toLocaleString()} total platform` : null}
            tip="Distinct users with at least one request in the selected period. Subtitle shows platform-lifetime user count."
          />
          <MetricCard
            icon={Bot}
            label="Requests"
            loading={loading && !summary}
            value={formatNumber(totalRequests)}
            sub={byokRequests > 0 ? `${formatNumber(byokRequests)} BYOK` : 'all on platform key'}
            tip={`Total LLM API requests in this period (chat + workflow runs). BYOK requests run on the user's own key — these don't deduct platform credits.`}
          />
          <MetricCard
            icon={Coins}
            label="Credits Consumed"
            loading={loading && !summary}
            value={formatCredits(t.total_cost_usd ? t.total_cost_usd * 1e6 : 0)}
            sub={`${fmtDlr(t.total_cost_usd || 0)} USD`}
            tip="Platform credits deducted in this period (BYOK calls excluded). Subtitle shows the dollar equivalent."
          />
          <MetricCard
            icon={TrendingUp}
            label="Your Profit"
            loading={loading && !opStats}
            value={opStats ? fmtCr(opStats.total_profit_credits) : '—'}
            accent="positive"
            sub={opStats ? `${fmtDlr(opStats.total_profit_dollars || 0)} · ${profitPct}% margin` : null}
            tip={opStats ? `Lifetime profit = Used − Raw API cost. Margin multiplier = ${profitMultiplier}x. Raw API cost (lifetime) = ${fmtCr(opStats.raw_cost_credits)} cr / ${fmtDlr(opStats.raw_cost_dollars || 0)}.` : 'Loading platform stats…'}
          />
          <MetricCard
            icon={DollarSign}
            label="Lifetime Revenue"
            loading={loading && !opStats}
            value={opStats ? fmtCr(opStats.total_purchased_credits) : '—'}
            sub={opStats ? `${fmtDlr(opStats.total_purchased_dollars || 0)} · ${fmtCr(opStats.total_balance_credits)} unspent` : null}
            tip={opStats ? `All-time credits purchased via Pabbly Subscription Billing. Subtitle: revenue in dollars + sum of remaining unspent credits across all users.` : 'Loading platform stats…'}
          />
          <MetricCard
            icon={Zap}
            label="Total Tokens"
            loading={loading && !summary}
            value={formatNumber(t.total_tokens || 0)}
            sub={`${formatNumber(t.input_tokens || 0)} in / ${formatNumber(t.output_tokens || 0)} out`}
            tip="Total LLM tokens processed across all users in this period. Subtitle shows the input/output split."
          />
          </div>
        </div>
      </div>

      {/* Content below the outer header card — charts, distribution,
          hourly activity, transaction log. Wrapped in the refreshing
          overlay so soft refetches dim them as a group. */}
      <div className={`relative ${refreshing ? 'opacity-95' : ''} space-y-4 sm:space-y-6 transition-opacity`}>
        {/* Soft refreshing indicator */}
        {refreshing && (
          <div className="absolute -top-1 left-0 right-0 z-10 pointer-events-none">
            <div className="h-0.5 bg-blue-100 dark:bg-blue-900/30 overflow-hidden rounded-full">
              <div className="h-full w-1/3 bg-blue-500 dark:bg-blue-400" style={{ animation: 'pabblyRefreshSlide 1.2s ease-in-out infinite' }} />
            </div>
          </div>
        )}

        {/* Row 1: Daily trend (full width) — title + skeleton chart visible while loading */}
        <ChartCard title="Platform Daily Trend" tip="Daily token usage across the entire platform in the selected period">
          {loading && !summary
            ? <LineChartSkel height={260} />
            : <DailyTrendChart data={summary?.daily_trend || []} height={260} />}
        </ChartCard>

        {/* Row 2: Distribution (toggle) + Hourly Activity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard
            title="Distribution"
            tip={distMode === 'provider'
              ? 'Token usage across LLM providers (Anthropic, OpenAI, etc.) in the selected period.'
              : 'Token usage split between BYOK (user keys) and Platform (Pabbly billing) in the selected period.'}
            tabs={[{ key: 'provider', label: 'Provider' }, { key: 'keytype', label: 'Key Type' }]}
            activeTab={distMode}
            onTabChange={setDistMode}
          >
            {loading && !summary
              ? <DonutSkel height={280} />
              : (distMode === 'provider'
                  ? <ProviderPieChart data={summary?.by_provider || []} height={280} />
                  : <KeyTypeSplitChart data={summary?.by_key_type || []} height={280} />)}
          </ChartCard>

          <ChartCard
            title={`Hourly Activity (${(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'Local' } })()})`}
            tip="Request count distribution by hour of day, in your local timezone. Helps identify peak-load windows."
          >
            {loading && !summary
              ? <BarsSkel height={280} />
              : <HourlyActivityChart data={summary?.hourly_distribution || []} height={280} />}
          </ChartCard>
        </div>

        {/* Row 3: Top by cost (full width, tabs) */}
        <ChartCard
          title="Top by Cost"
          tip="Top 10 entities ranked by spend in this period. Switch between Users, Workflows, or Models."
          tabs={[
            { key: 'user', label: 'Users' },
            { key: 'workflow', label: 'Workflows' },
            { key: 'model', label: 'Models' },
          ]}
          activeTab={topMode}
          onTabChange={setTopMode}
        >
          {loading && !summary ? (
            <BarRowsSkel rows={10} />
          ) : topByCostData.length === 0 ? (
            <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height: 280 }}>{topByCostEmpty}</div>
          ) : (
            <TopItemsBarChart
              data={topByCostData}
              valueLabel="Credits"
              valueType="credits"
              color={topByCostColor}
              height={Math.max(280, topByCostData.length * 32)}
            />
          )}
        </ChartCard>

          {/* Transactions section — every credit movement (usage / purchases /
              bonuses / grants) across all users, with multi-dimensional
              filtering. Charts above are for trend analysis; this section is
              the per-row audit drill-down (e.g. "where did this user's
              credits go?", "kis bonus ka invoice tha?"). */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-3">Transactions</h2>

            {/* Table-scope filter card — Date / Type / User / Workflow / Source
                / Provider / Key Type. Action buttons (Clear / Refresh) sit at
                the top-right of THIS card so they visually belong to the
                filter scope. Date Range here is INDEPENDENT from the
                page-level Date Range above; admins can drill into a different
                time window for the transactions table without disturbing the
                cards / charts. */}
            <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-3">
              {/* Single row: filters first, then Clear (conditional) +
                  Refresh pushed to the right end via `sm:ml-auto`. On
                  desktop this fills the empty space between Key Type and
                  the card's right edge. On wrap (narrow tablets) the
                  action group falls onto its own line and stays right-
                  aligned via `justify-end`. `items-end` makes the button
                  baselines line up with the filter inputs. */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
                <div className="col-span-2 sm:col-span-1 sm:min-w-[160px] sm:max-w-[220px]">
                  <MultiSearchableSelect
                    label="Date Range"
                    labelTooltip="Window for the transactions table only. Independent of the page-level date range above. Defaults to today (live, in-progress data)."
                    usePortal
                    value={txPeriod === 'today' ? '' : txPeriod}
                    onChange={(v) => {
                      const next = v || 'today'
                      setTxPeriod(next)
                      if (next !== 'custom') { setTxStartDate(''); setTxEndDate('') }
                    }}
                    options={TX_PERIODS}
                    placeholder="Today"
                    searchPlaceholder="Search…"
                  />
                </div>
                <div className="col-span-1 sm:min-w-[160px] sm:max-w-[200px]">
                  <MultiSearchableSelect
                    label="Type"
                    labelTooltip="AI Usage = LLM credit deductions. Purchases = credit pack buys. Signup Bonus = new-user grants. Admin Grant = manual grants from this panel. Default shows AI Usage only."
                    multi
                    usePortal
                    value={txTypeFilter}
                    onChange={setTxTypeFilter}
                    options={TX_TYPE_OPTIONS}
                    placeholder="All Types"
                    searchPlaceholder="Search types…"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 sm:min-w-[200px] sm:max-w-[260px]">
                  <MultiSearchableSelect
                    label="User"
                    labelTooltip={
                      workflowFilter.include.length
                        ? "Filter rows to specific users. Narrowed to the selected workflow(s)' owners — clear the Workflow filter to see every user."
                        : "Filter rows to one or more specific users. Use the Include / Exclude tabs to narrow the table to (or away from) the selected users. Search matches name OR email."
                    }
                    multi
                    usePortal
                    value={userFilter}
                    onChange={setUserFilter}
                    options={filteredUserOptions}
                    getOptionDisplayLabel={(opt) => opt._name}
                    getOptionChipTitle={(opt) => opt._email ? `${opt._name} · ${opt._email}` : opt._name}
                    placeholder="All Users"
                    searchPlaceholder="Search by name or email…"
                    renderOption={(opt) => (
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm text-gray-800 dark:text-neutral-100 truncate">{opt._name || 'Unknown'}</span>
                        {opt._email && opt._name !== opt._email && (
                          <span className="text-[11px] text-gray-500 dark:text-neutral-400 truncate">{opt._email}</span>
                        )}
                      </div>
                    )}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 sm:min-w-[200px] sm:max-w-[260px]">
                  <MultiSearchableSelect
                    label="Workflow"
                    labelTooltip={
                      (userFilter.include.length || userFilter.exclude.length)
                        ? "Filter rows to specific workflows. Narrowed to the selected user(s) — clear the User filter to see every workflow."
                        : "Filter rows to specific workflows (any user's). Search matches workflow name OR owner email. Trashed workflows are tagged so admins can still audit deleted items."
                    }
                    multi
                    usePortal
                    value={workflowFilter}
                    onChange={setWorkflowFilter}
                    options={filteredWorkflowOptions}
                    getOptionDisplayLabel={(opt) => opt._trashed ? `${opt._name} (deleted)` : opt._name}
                    getOptionChipTitle={(opt) => opt._email ? `${opt._name} · ${opt._email}` : opt._name}
                    placeholder="All Workflows"
                    searchPlaceholder="Search by workflow or owner…"
                    renderOption={(opt) => (
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm text-gray-800 dark:text-neutral-100 truncate">
                          {opt._name}
                          {opt._trashed && <span className="ml-1 text-[10px] text-red-500">(deleted)</span>}
                        </span>
                        {opt._email && (
                          <span className="text-[11px] text-gray-500 dark:text-neutral-400 truncate">{opt._email}</span>
                        )}
                      </div>
                    )}
                  />
                </div>
                <div className="col-span-1 sm:min-w-[160px] sm:max-w-[200px]">
                  <MultiSearchableSelect
                    label="Source"
                    labelTooltip="AI Usage rows only — where the LLM call originated. Master Agent = chat builder turn. Test Run = test_workflow / Test Panel. Workflow Run = external webhook trigger / live workflow."
                    multi
                    usePortal
                    value={sourceFilter}
                    onChange={setSourceFilter}
                    options={SOURCE_OPTIONS}
                    placeholder="All Sources"
                    searchPlaceholder="Search sources…"
                  />
                </div>
                <div className="col-span-1 sm:min-w-[160px] sm:max-w-[200px]">
                  <MultiSearchableSelect
                    label="Provider"
                    labelTooltip="Filter rows by LLM provider (Anthropic, OpenAI, etc.). Select multiple to include several at once, or use the Exclude tab to hide specific providers."
                    multi
                    usePortal
                    value={providerFilter}
                    onChange={setProviderFilter}
                    options={PROVIDER_OPTIONS}
                    placeholder="All Providers"
                    searchPlaceholder="Search providers…"
                  />
                </div>
                <div className="col-span-1 sm:min-w-[160px] sm:max-w-[200px]">
                  <MultiSearchableSelect
                    label="Key Type"
                    labelTooltip="Platform = calls billed to platform credits. BYOK = calls running on the user's own API key (no platform credits deducted). Pick to focus on one or both."
                    multi
                    usePortal
                    value={keyTypeFilter}
                    onChange={setKeyTypeFilter}
                    options={KEY_TYPE_OPTIONS}
                    placeholder="All Key Types"
                    searchPlaceholder="Search types…"
                  />
                </div>

                {/* Sort by — single-select, sits right after Key Type and
                    immediately before the Clear-filters link so the row
                    reads as: [filter chips] · Sort · Clear · Refresh.
                    Compact width (matches the small filter chips) so the
                    whole row fits on a single line on common desktop
                    widths; falls back to wrapping on narrower screens.
                    Cheap sorts keep the indexed `find().sort()` server
                    path; the two "users on top" options switch the
                    backend into a $setWindowFields aggregation. */}
                <div className="col-span-1 sm:col-auto sm:min-w-[160px] sm:max-w-[200px]">
                  <MultiSearchableSelect
                    label="Sort by"
                    labelTooltip="Order rows in the table. 'Most-active users on top' groups every user's rows together with the heaviest spenders first. 'Least-active users on top' is the mirror — handy for spot-checking quiet accounts."
                    usePortal
                    value={txSort === 'newest' ? '' : txSort}
                    onChange={(v) => setTxSort(v || 'newest')}
                    options={SORT_OPTIONS}
                    placeholder="Newest first"
                    searchPlaceholder="Search…"
                  />
                </div>

                {/* "Clear filters" — inline text link sitting RIGHT NEXT TO
                    the last filter chip (Key Type). Renders only when at
                    least one filter holds a non-default value. Defaults
                    are: period 'today' (no custom dates) AND every chip
                    filter empty (include + exclude both length 0). */}
                {(() => {
                  const anyActive =
                    txPeriod !== 'today' ||
                    txStartDate || txEndDate ||
                    txTypeFilter.include.length || txTypeFilter.exclude.length ||
                    userFilter.include.length || userFilter.exclude.length ||
                    workflowFilter.include.length ||
                    sourceFilter.include.length ||
                    providerFilter.include.length || providerFilter.exclude.length ||
                    keyTypeFilter.include.length || keyTypeFilter.exclude.length ||
                    txSort !== 'newest'
                  if (!anyActive) return null
                  return (
                    <div className="col-span-2 sm:col-auto flex items-center sm:pb-1">
                      <button
                        type="button"
                        onClick={() => {
                          // Reset every filter back to its true default —
                          // empty for chips, 'today' for period.
                          setTxPeriod('today'); setTxStartDate(''); setTxEndDate('')
                          setTxTypeFilter({ include: [], exclude: [] })
                          setUserFilter({ include: [], exclude: [] })
                          setWorkflowFilter({ include: [], exclude: [] })
                          setSourceFilter({ include: [], exclude: [] })
                          setProviderFilter({ include: [], exclude: [] })
                          setKeyTypeFilter({ include: [], exclude: [] })
                          setTxSort('newest')
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Clear filters
                      </button>
                    </div>
                  )
                })()}

                {/* Refresh — pushed to the right end of the row. Sort
                    dropdown + Clear-filters link both sit BEFORE this in
                    JSX order so the visual rhythm reads as: [filters] ·
                    Sort by · Clear (when active) · ⟶ space ⟶ · Refresh.
                    `pb-1` baseline-aligns the button with the taller
                    filter inputs (their label adds height). */}
                <div className="col-span-2 sm:col-auto sm:ml-auto flex items-center justify-end sm:pb-1">
                  {/* Compact icon-only refresh — frees up horizontal
                      space so the whole filter row fits on one line on
                      common desktop widths. Wrapped in the shared
                      `Tooltip` so admins get the same dark-styled
                      hover popover used everywhere else in the page
                      (the previous native `title` attribute was
                      inconsistent with the design system). The icon's
                      spinning state still signals an in-flight refetch
                      and `aria-label` keeps the button accessible. */}
                  <Tooltip content="Refresh the transactions table — keeps your filters, page, and scroll position">
                    <button
                      type="button"
                      onClick={handleTxRefresh}
                      disabled={txLoading || txRefreshing}
                      aria-label="Refresh transactions"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <RotateCw size={14} className={txRefreshing ? 'animate-spin' : ''} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              {txPeriod === 'custom' && (
                <div className="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700 flex flex-wrap items-end gap-3">
                  <div className="flex flex-col items-start">
                    <Tooltip content="First day of the transaction window (inclusive). Rows are counted from 00:00 on this date.">
                      <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1 cursor-help">Start date</label>
                    </Tooltip>
                    <input
                      type="date"
                      value={txStartDate}
                      onChange={e => setTxStartDate(e.target.value)}
                      className="text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col items-start">
                    <Tooltip content="Last day of the transaction window (inclusive). Rows are counted up to 23:59 on this date.">
                      <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1 cursor-help">End date</label>
                    </Tooltip>
                    <input
                      type="date"
                      value={txEndDate}
                      onChange={e => setTxEndDate(e.target.value)}
                      className="text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                    />
                  </div>
                  {!isCustomTxRange && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 pb-1.5">Pick both dates to load data.</p>
                  )}
                </div>
              )}
            </div>

            {/* < lg (mobile + tablet): card list. >= lg (desktop): full
                table. Tablet drops the table because 9 columns at <1024 px
                forces horizontal scroll and pinches the cell paddings; the
                card surface is wider than mobile so it can show every
                field cleanly without scroll. Desktop keeps the dense
                tabular view for fast scanning. */}
            <div className={`bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm relative ${txRefreshing ? 'opacity-95' : ''} transition-opacity`}>
              {/* Subtle refresh indicator — sits at the top edge of the
                  table card while a refresh-mode refetch is in flight.
                  Existing rows stay visible underneath so the admin's
                  scroll position + reading focus are preserved (vs. the
                  prior behavior of flashing the entire table back to
                  skeletons on every chip click). */}
              {txRefreshing && (
                <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
                  <div className="h-0.5 bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
                    <div className="h-full w-1/3 bg-blue-500 dark:bg-blue-400" style={{ animation: 'pabblyRefreshSlide 1.2s ease-in-out infinite' }} />
                  </div>
                </div>
              )}
              {/* Cards — visible at < lg (mobile + tablet). Each field is
                  prefixed with its key-name label so the user can read the
                  card without referring to a column header. Chips (Type /
                  Source / Key Type) are wrapped in Tooltip so a hover-
                  capable user (tablet w/ trackpad, desktop dev preview)
                  gets a plain-language explanation; the inline labels
                  cover touch-only devices where hover is unavailable.
                  Date renders FULL (weekday, date, time) — no
                  hide-behind-tooltip on touch. */}
              <div className="lg:hidden divide-y divide-gray-200 dark:divide-neutral-700">
                {txLoading ? (
                  Array.from({ length: 6 }).map((_, i) => <TxCardSkeleton key={i} />)
                ) : transactions.length === 0 ? (
                  <div className="text-center py-12 text-neutral-400 dark:text-neutral-500 px-4">
                    <Activity size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">No transactions match these filters</p>
                    <p className="text-xs mt-1">Adjust filters above or pick a wider date range.</p>
                  </div>
                ) : transactions.map((tx, i) => {
                  const tMeta = txTypeMeta(tx.tx_type)
                  const sMeta = sourceMeta(tx.source)
                  const ktMeta = keyTypeMeta(tx.key_type)
                  const isCredit = (tx.amount || 0) >= 0
                  const modelShort = (tx.model || '').replace('claude-', '').replace('gpt-', 'GPT-')
                  const dateObj = tx.created_at ? new Date(tx.created_at) : null
                  // Mobile/tablet shows the FULL date inline because a
                  // touch user can't reveal a tooltip — they need every
                  // detail in flow.
                  const dateFull = dateObj
                    ? `${dateObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
                    : '—'

                  // Inline label classes — small, uppercase, muted;
                  // consistent with the table header style. Sits on the
                  // SAME line as its value so the card stays compact.
                  // Hidden at < sm (mobile) on the user's request — the
                  // values are self-evident from card context, and the
                  // label was eating horizontal space the Provider/Model
                  // string needed to render without truncation. Tablet
                  // (sm → < lg) keeps labels because the wider canvas
                  // affords them and they aid scanability.
                  const labelCls = 'hidden sm:inline-block text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider sm:mr-1.5 flex-shrink-0'

                  return (
                    <div key={tx.id || i} className="px-3 sm:px-4 py-3 space-y-1.5">
                      {/* Row 1 — Type | Credits (paired) */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center min-w-0">
                          <span className={labelCls}>Type</span>
                          <Tooltip content={tMeta.description}>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap cursor-help ${tMeta.cls}`}>{tMeta.label}</span>
                          </Tooltip>
                        </div>
                        <div className="flex items-center flex-shrink-0">
                          <span className={labelCls}>Credits</span>
                          <span className={`text-sm font-semibold whitespace-nowrap ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {isCredit ? '+' : '−'}{Math.abs(tx.amount || 0).toFixed(2)} cr
                          </span>
                        </div>
                      </div>

                      {/* Row 2 — User */}
                      <div className="flex items-center min-w-0">
                        <span className={labelCls}>User</span>
                        <span
                          className="text-[13px] font-medium text-gray-900 dark:text-neutral-100 truncate cursor-default"
                          onMouseEnter={(e) => showUserPopover(e, tx)}
                          onMouseLeave={scheduleHideUserPopover}
                        >
                          {tx.user_name || '—'}
                        </span>
                      </div>

                      {/* Row 3 — Workflow */}
                      <div className="flex items-center min-w-0">
                        <span className={labelCls}>Workflow</span>
                        <span className="text-[13px] text-gray-700 dark:text-neutral-200 truncate" title={tx.agent_name}>
                          {tx.agent_name || '—'}
                          {tx.agent_is_trashed && tx.agent_name && <span className="ml-1 text-[10px] text-red-500">(deleted)</span>}
                        </span>
                      </div>

                      {/* Row 4 — Provider · Model | Tokens (paired) */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center min-w-0">
                          <span className={labelCls}>Provider</span>
                          <span className="text-[13px] text-gray-700 dark:text-neutral-200 truncate">
                            <span className="capitalize font-medium">{tx.provider || '—'}</span>
                            {modelShort && (
                              <>
                                <span className="text-neutral-400 mx-1">·</span>
                                <span className="text-neutral-500 dark:text-neutral-400" title={tx.model}>{modelShort}</span>
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center flex-shrink-0">
                          <span className={labelCls}>Tokens</span>
                          {/* Mobile/tablet — tap-to-toggle the same Token
                              Usage & Cost tooltip the desktop table opens
                              on hover. Re-tapping the same row closes it
                              (the `tokenTip.tx?.id !== tx.id` toggle).
                              Same in/out + % cached visual treatment as
                              the desktop variant for consistency. */}
                          {(() => {
                            const cr = tx.cache_read_tokens || 0
                            const cw = tx.cache_write_tokens || 0
                            const rawIn = tx.input_tokens || 0
                            const anthropicStyle = (cr + cw) > rawIn
                            const totalIn = anthropicStyle ? rawIn + cr + cw : rawIn
                            const cachedPct = totalIn > 0 ? Math.round(cr / totalIn * 100) : 0
                            const hasTokens = (rawIn + (tx.output_tokens || 0) + cr + cw) > 0
                            if (!hasTokens) {
                              return <span className="text-[13px] text-neutral-300 dark:text-neutral-600">—</span>
                            }
                            return (
                              <button
                                type="button"
                                className="text-[13px] tabular-nums whitespace-nowrap text-right cursor-pointer"
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const spaceBelow = window.innerHeight - rect.bottom
                                  const showAbove = spaceBelow < 280
                                  setTokenTip(prev => (prev.visible && prev.tx?.id === tx.id)
                                    ? { visible: false, tx: null, x: 0, y: 0, above: false }
                                    : { visible: true, tx, x: rect.left + rect.width / 2, y: showAbove ? rect.top : rect.bottom + 8, above: showAbove }
                                  )
                                }}
                              >
                                <div>
                                  <span className="text-blue-600 dark:text-blue-400 font-medium">{formatNumber(totalIn)}</span>
                                  <span className="text-neutral-400 mx-1">/</span>
                                  <span className="text-violet-600 dark:text-violet-400 font-medium">{formatNumber(tx.output_tokens || 0)}</span>
                                </div>
                                {cr > 0 && (
                                  <p className="text-[9px] text-emerald-500 leading-none">{cachedPct}% cached</p>
                                )}
                              </button>
                            )
                          })()}
                        </div>
                      </div>

                      {/* Row 5 — Source | Key Type (paired) */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center min-w-0">
                          <span className={labelCls}>Source</span>
                          {sMeta ? (
                            <Tooltip content={sMeta.description}>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap cursor-help ${sMeta.cls}`}>{sMeta.label}</span>
                            </Tooltip>
                          ) : (
                            <span className="text-[11px] text-neutral-300 dark:text-neutral-600">—</span>
                          )}
                        </div>
                        <div className="flex items-center flex-shrink-0">
                          <span className={labelCls}>Key Type</span>
                          <Tooltip content={ktMeta.description}>
                            <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap cursor-help ${ktMeta.cls}`}>{ktMeta.label}</span>
                          </Tooltip>
                        </div>
                      </div>

                      {/* Row 6 — Date (full inline, no hover-only) */}
                      <div className="flex items-center min-w-0">
                        <span className={labelCls}>Date</span>
                        <span className="text-[13px] text-gray-700 dark:text-neutral-200 truncate" title={dateFull}>{dateFull}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop-only table (>= lg). 9 columns: Type · User ·
                  Workflow · Key Type · Source · Provider (with model
                  below) · Tokens (in / out) · Credits · Date (compact
                  + full date+time on hover). At < lg the cards above
                  render instead — they fit every field cleanly without
                  the horizontal-scroll squeeze the table would impose.
                  `maxHeight: 70vh` + `overflow-auto` makes the wrapper a
                  real scroll container so `sticky top-0` on the thead
                  actually engages — without a vertical-scroll context
                  sticky becomes a no-op. The table itself scrolls
                  internally; the page above scrolls separately, and the
                  sticky header pins to the top of THIS region only,
                  which is the standard "scrollable table card" pattern. */}
              <div className="hidden lg:block overflow-auto" style={{ scrollbarWidth: 'thin', maxHeight: '70vh' }}>
                <table className="w-full bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
                  <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Type</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">User</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Workflow</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Key Type</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Source</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Provider</th>
                      <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Tokens</th>
                      <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Credits</th>
                      <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                    {txLoading ? (
                      Array.from({ length: 6 }).map((_, i) => <TxTableSkeletonRow key={i} />)
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <div className="text-center py-16 text-neutral-400 dark:text-neutral-500">
                            <Activity size={36} className="mx-auto mb-3 opacity-50" />
                            <p className="text-sm font-medium">No transactions match these filters</p>
                            <p className="text-xs mt-1">Adjust filters above or pick a wider date range.</p>
                          </div>
                        </td>
                      </tr>
                    ) : transactions.map((tx, i) => {
                      const tMeta = txTypeMeta(tx.tx_type)
                      const sMeta = sourceMeta(tx.source)
                      // Negative amount = credit deduction (red); positive =
                      // grant/purchase (emerald). Mirrors the user-facing
                      // Credits page so admins moving between surfaces see
                      // the same color → meaning mapping.
                      const isCredit = (tx.amount || 0) >= 0
                      // Date: compact label in the cell + verbose
                      // weekday/full-date/time string on hover via Tooltip.
                      // Mirrors the dashboard's date-column pattern.
                      const dateObj = tx.created_at ? new Date(tx.created_at) : null
                      const dateCompact = dateObj
                        ? dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '-'
                      const dateFull = dateObj
                        ? `${dateObj.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
                        : ''
                      // Trim provider/model for display.
                      const modelShort = (tx.model || '').replace('claude-', '').replace('gpt-', 'GPT-')
                      return (
                        <tr key={tx.id || i} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                          <td className="px-3 lg:px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${tMeta.cls}`}>
                              {tMeta.label}
                            </span>
                          </td>
                          <td
                            className="px-3 lg:px-4 py-3 font-medium text-gray-900 dark:text-neutral-100 whitespace-nowrap max-w-[160px] truncate cursor-default"
                            onMouseEnter={(e) => showUserPopover(e, tx)}
                            onMouseLeave={scheduleHideUserPopover}
                          >
                            {tx.user_name || '-'}
                          </td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap max-w-[180px] truncate" title={tx.agent_name}>
                            {tx.agent_name || '-'}
                            {tx.agent_is_trashed && tx.agent_name && <span className="ml-1 text-[10px] text-red-500">(deleted)</span>}
                          </td>
                          <td className="px-3 lg:px-4 py-3">
                            <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${tx.key_type === 'byok' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                              {tx.key_type === 'byok' ? 'BYOK' : 'Platform'}
                            </span>
                          </td>
                          <td className="px-3 lg:px-4 py-3">
                            {sMeta ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${sMeta.cls}`}>{sMeta.label}</span>
                            ) : (
                              <span className="text-[11px] text-neutral-300 dark:text-neutral-600">—</span>
                            )}
                          </td>
                          <td className="px-3 lg:px-4 py-3 align-top">
                            <div className="text-gray-700 dark:text-neutral-200 whitespace-nowrap font-medium capitalize">{tx.provider || '-'}</div>
                            {modelShort && (
                              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap truncate max-w-[160px]" title={tx.model}>{modelShort}</div>
                            )}
                          </td>
                          <td className="px-3 lg:px-4 py-3 text-right text-gray-700 dark:text-neutral-200 whitespace-nowrap tabular-nums">
                            {/* Tokens — hover-driven Token Usage & Cost
                                tooltip mirrors the Credits-page breakdown
                                (Input non-cached / Cache Read / Cache Write
                                / Total input / Output, with rates + raw
                                API cost + final credits deducted). The
                                visual treatment matches Credits.jsx —
                                blue for input, violet for output, green
                                "% cached" badge when cache_read > 0 — so
                                operators moving between the two surfaces
                                aren't relearning the colour map. */}
                            {(() => {
                              const cr = tx.cache_read_tokens || 0
                              const cw = tx.cache_write_tokens || 0
                              const rawIn = tx.input_tokens || 0
                              // Anthropic reports `input_tokens` as
                              // non-cached only; OpenAI/Google fold cached
                              // tokens INTO `prompt_tokens`. Detect by
                              // comparing magnitudes — see CLAUDE.md
                              // "Token storage semantics diverge by
                              // provider".
                              const anthropicStyle = (cr + cw) > rawIn
                              const totalIn = anthropicStyle ? rawIn + cr + cw : rawIn
                              const cachedPct = totalIn > 0 ? Math.round(cr / totalIn * 100) : 0
                              const hasTokens = (rawIn + (tx.output_tokens || 0) + cr + cw) > 0
                              if (!hasTokens) {
                                return <span className="text-neutral-300 dark:text-neutral-600">—</span>
                              }
                              return (
                                <div
                                  className="cursor-help inline-block text-right"
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const spaceBelow = window.innerHeight - rect.bottom
                                    const showAbove = spaceBelow < 280
                                    setTokenTip({ visible: true, tx, x: rect.left + rect.width / 2, y: showAbove ? rect.top : rect.bottom + 8, above: showAbove })
                                  }}
                                  onMouseLeave={() => setTokenTip({ visible: false, tx: null, x: 0, y: 0, above: false })}
                                >
                                  <div>
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">{formatNumber(totalIn)}</span>
                                    <span className="text-neutral-400 mx-1">/</span>
                                    <span className="text-violet-600 dark:text-violet-400 font-medium">{formatNumber(tx.output_tokens || 0)}</span>
                                  </div>
                                  <p className="text-[9px] text-neutral-400 mt-0.5">
                                    in{cr > 0 ? <span className="text-emerald-500"> ({cachedPct}% cached)</span> : ''} / out
                                  </p>
                                </div>
                              )
                            })()}
                          </td>
                          <td className={`px-3 lg:px-4 py-3 text-right font-medium whitespace-nowrap ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {isCredit ? '+' : '−'}{Math.abs(tx.amount || 0).toFixed(2)}
                          </td>
                          <td className="px-3 lg:px-4 py-3 text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                            {dateObj ? (
                              <Tooltip content={dateFull}>
                                <span className="cursor-help">{dateCompact}</span>
                              </Tooltip>
                            ) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {txTotal > 0 && (
                <Pagination
                  currentPage={txPage}
                  totalPages={Math.max(1, Math.ceil(txTotal / txPageSize))}
                  totalItems={txTotal}
                  itemsPerPage={txPageSize}
                  onPageChange={(p) => fetchTransactions(p, undefined, 'refresh')}
                  onPageSizeChange={(size) => { setTxPageSize(size); fetchTransactions(1, size, 'refresh') }}
                  pageSizeOptions={[10, 25, 50, 100, 200]}
                  loading={txLoading}
                />
              )}
            </div>
          </div>
      </div>

      {/* Interactive user-name popover — portal'd into document.body so it
          escapes the table's overflow:auto container and can sit above
          everything. Placement: BELOW the cell with NO vertical gap so
          the cursor transits cleanly into the popover (an 8 px gap is
          long enough for row N+1's mouseenter to steal the hover state).
          Above-placement is used only when the viewport bottom is tight.
          Visual style matches the shared `Tooltip` (dark bg, rotated-
          square arrow). `pointer-events-auto` is implicit — needed for
          the Copy button to be clickable. */}
      {userPopover.visible && createPortal(
        <div
          onMouseEnter={cancelHideUserPopover}
          onMouseLeave={scheduleHideUserPopover}
          style={{
            position: 'fixed',
            left: userPopover.x,
            top: userPopover.y,
            // Below: top edge of popover sits exactly at cell.bottom.
            // Above: bottom edge of popover sits exactly at cell.top
            //   (translateY(-100%) to anchor the bottom edge to userPopover.y).
            transform: userPopover.placement === 'below'
              ? 'none'
              : 'translateY(-100%)',
          }}
          className="z-[9999] bg-neutral-900 dark:bg-neutral-800 border border-neutral-700 dark:border-neutral-600 shadow-xl rounded-lg px-3 py-2.5 min-w-[220px] max-w-[320px] animate-tooltip-pop"
        >
          <p className="text-sm font-semibold text-white truncate">
            {userPopover.tx.user_name || 'Unknown'}
          </p>
          {userPopover.tx.user_email ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="text-[12px] text-neutral-300 truncate flex-1 min-w-0"
                title={userPopover.tx.user_email}
              >
                {userPopover.tx.user_email}
              </span>
              <button
                type="button"
                onClick={() => copyEmail(userPopover.tx.user_email)}
                title={copiedEmail === userPopover.tx.user_email ? 'Copied' : 'Copy email'}
                className="flex-shrink-0 p-1 rounded hover:bg-neutral-700 dark:hover:bg-neutral-600 text-neutral-400 hover:text-white transition-colors"
              >
                {copiedEmail === userPopover.tx.user_email
                  ? <Check size={13} className="text-emerald-400" />
                  : <Copy size={13} />}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-neutral-400">No email on file</p>
          )}

          {/* Arrow — small rotated square placed against the popover's
              top (below-placement) or bottom (above-placement) edge so it
              visually points back at the trigger cell. Sits ~16 px in
              from the left so it points at the user's name area, which
              is roughly where the cell's content starts. */}
          <div
            className={`absolute left-4 w-2 h-2 rotate-45 bg-neutral-900 dark:bg-neutral-800 ${
              userPopover.placement === 'below'
                ? '-top-1 border-t border-l border-neutral-700 dark:border-neutral-600'
                : '-bottom-1 border-b border-r border-neutral-700 dark:border-neutral-600'
            }`}
          />
        </div>,
        document.body
      )}

      {/* Token Usage & Cost tooltip — fixed-position, portal'd to body so
          it escapes the table's overflow:auto + sticky header stacking
          context. Mirrors the Credits-page tooltip 1:1 (Input/Cache
          Read/Cache Write/Total input/Output rows + per-row Rate +
          per-row Cost + Raw API cost + Total deducted), so admins moving
          between the user-facing Credits surface and this admin
          Transactions table see exactly the same shape and numbers.

          Pricing is looked up by `tx.model`. Missing pricing (legacy
          rows, deleted models) degrades gracefully to the token totals
          line at the bottom — no Rate / Cost columns, no Raw / Total
          deducted breakdown, but the table itself still renders so the
          admin can at least see the token counts. */}
      {tokenTip.visible && tokenTip.tx && (() => {
        const t = tokenTip.tx
        const pricing = pricingMap[t.model]
        const cacheRead = t.cache_read_tokens || 0
        const cacheWrite = t.cache_write_tokens || 0
        const rawInput = t.input_tokens || 0
        const anthropicStyle = (cacheRead + cacheWrite) > rawInput
        const nonCachedInput = anthropicStyle ? rawInput : Math.max(0, rawInput - cacheRead - cacheWrite)
        const totalInput = anthropicStyle ? rawInput + cacheRead + cacheWrite : rawInput
        const inputCost = pricing ? (nonCachedInput * pricing.input_cost_per_mtok / 1_000_000) : null
        const outputCost = pricing ? ((t.output_tokens || 0) * pricing.output_cost_per_mtok / 1_000_000) : null
        const cacheReadCost = pricing && cacheRead > 0 ? (cacheRead * pricing.cache_read_cost_per_mtok / 1_000_000) : null
        const cacheWriteCost = pricing && cacheWrite > 0 ? (cacheWrite * pricing.cache_write_cost_per_mtok / 1_000_000) : null
        const rawTotal = (inputCost || 0) + (outputCost || 0) + (cacheReadCost || 0) + (cacheWriteCost || 0)
        // tx.amount is already credit-denominated (admin endpoint divides
        // milli → credits server-side); BYOK rows have amount=0 so the
        // "Total deducted" line correctly reads as no charge for those.
        const finalCost = Math.abs(t.amount || 0)
        const fmtCost = (v) => (v / 1_000_000).toFixed(4)

        return createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{ left: tokenTip.x, top: tokenTip.above ? undefined : tokenTip.y, bottom: tokenTip.above ? (window.innerHeight - tokenTip.y + 8) + 'px' : undefined, transform: 'translateX(-50%)' }}
          >
            <div className="bg-neutral-800 dark:bg-neutral-900 text-white text-[10px] rounded-lg px-3 py-2.5 whitespace-nowrap shadow-xl border border-neutral-700 min-w-[260px]">
              {!tokenTip.above && <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-neutral-800 dark:border-b-neutral-900"></div>}
              {tokenTip.above && <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800 dark:border-t-neutral-900"></div>}

              <p className="font-semibold text-[11px] text-neutral-200 mb-2 border-b border-neutral-600 pb-1">Token Usage & Cost</p>

              {/* Header context — model + provider so the rate column
                  numbers below are self-explanatory ("which model is
                  $3/Mtok against?"). */}
              {(t.model || t.provider) && (
                <div className="mb-2 pb-1.5 border-b border-neutral-700 text-[9px] text-neutral-400 flex items-center justify-between gap-3">
                  <span>{t.provider || '—'}</span>
                  <span className="text-neutral-300 truncate max-w-[180px]" title={t.model}>{t.model || '—'}</span>
                </div>
              )}

              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-neutral-400">
                    <td className="pb-1">Type</td>
                    <td className="pb-1 text-right">Tokens</td>
                    {pricing && <td className="pb-1 text-right">Rate</td>}
                    {pricing && <td className="pb-1 text-right">Cost</td>}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-blue-400 py-0.5">{cacheRead > 0 || cacheWrite > 0 ? 'Input (non-cached)' : 'Input'}</td>
                    <td className="text-right font-medium">{nonCachedInput.toLocaleString()}</td>
                    {pricing && <td className="text-right text-neutral-400">${(pricing.input_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                    {pricing && <td className="text-right font-medium">{fmtCost(inputCost)}</td>}
                  </tr>
                  {cacheRead > 0 && (
                    <tr>
                      <td className="text-emerald-400 py-0.5">Cache Read</td>
                      <td className="text-right font-medium">{cacheRead.toLocaleString()}</td>
                      {pricing && <td className="text-right text-neutral-400">${(pricing.cache_read_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                      {pricing && <td className="text-right font-medium">{fmtCost(cacheReadCost)}</td>}
                    </tr>
                  )}
                  {cacheWrite > 0 && (
                    <tr>
                      <td className="text-amber-400 py-0.5">Cache Write</td>
                      <td className="text-right font-medium">{cacheWrite.toLocaleString()}</td>
                      {pricing && <td className="text-right text-neutral-400">${(pricing.cache_write_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                      {pricing && <td className="text-right font-medium">{fmtCost(cacheWriteCost)}</td>}
                    </tr>
                  )}
                  {(cacheRead > 0 || cacheWrite > 0) && (
                    <tr className="border-t border-neutral-700/60">
                      <td className="text-neutral-300 py-0.5 font-medium">Total input</td>
                      <td className="text-right font-semibold text-blue-300">{totalInput.toLocaleString()}</td>
                      {pricing && <td></td>}
                      {pricing && <td></td>}
                    </tr>
                  )}
                  <tr className={cacheRead > 0 || cacheWrite > 0 ? 'border-t border-neutral-700/60' : ''}>
                    <td className="text-violet-400 py-0.5">Output</td>
                    <td className="text-right font-medium">{(t.output_tokens || 0).toLocaleString()}</td>
                    {pricing && <td className="text-right text-neutral-400">${(pricing.output_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                    {pricing && <td className="text-right font-medium">{fmtCost(outputCost)}</td>}
                  </tr>
                </tbody>
              </table>

              {/* Totals — Raw API cost (dollar) + the with-margin
                  conversion + the final credit deduction. Mirrors the
                  Credits-page admin totals block; margin multiplier is
                  surfaced inline so admins can sanity-check the math
                  without leaving the tooltip. */}
              {pricing && (
                <div className="mt-1.5 pt-1.5 border-t border-neutral-600 space-y-0.5">
                  <div className="flex justify-between text-neutral-400">
                    <span>Raw API cost</span>
                    <span>${(rawTotal / 1_000_000).toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>With margin (×{marginMultiplier})</span>
                    <span>{finalCost.toFixed(4)} credits</span>
                  </div>
                  <div className={`flex justify-between font-semibold text-[11px] ${t.key_type === 'byok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    <span>{t.key_type === 'byok' ? 'BYOK · not deducted' : 'Total deducted'}</span>
                    <span>{t.key_type === 'byok' ? '0.0000 credits' : `${finalCost.toFixed(4)} credits`}</span>
                  </div>
                </div>
              )}
              {!pricing && (
                <div className="mt-1.5 pt-1.5 border-t border-neutral-600 text-neutral-400">
                  <div className="flex justify-between">
                    <span>Total tokens</span>
                    <span>{(rawInput + (t.output_tokens || 0) + cacheRead + cacheWrite).toLocaleString()}</span>
                  </div>
                  <p className="text-[9px] text-neutral-500 mt-0.5">No pricing on file for this model.</p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}
