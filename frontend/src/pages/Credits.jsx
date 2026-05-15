import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Coins, Clock, TrendingDown, Gift, CreditCard, ShoppingCart } from 'lucide-react'
import { creditsAPI, adminAPI, workflowsAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import Pagination from '../components/ui/Pagination'
import Tooltip from '../components/ui/Tooltip'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import { resolveDatePreset } from '../utils/dateRange'

// Theme: black + blue only. The popular package gets the blue treatment
// (icon gradient + button) so it pops as the recommended pick; the rest
// stay on the neutral-black palette. Driven by `pkg.popular`, not index —
// admins can mark any row popular without re-sorting.
const POPULAR_GRADIENT = 'from-blue-500 to-blue-600'
const POPULAR_BUTTON = 'bg-blue-600 hover:bg-blue-700'
// Non-popular packs use the same blue as POPULAR_BUTTON — every "buy
// credits" CTA on the page is one cohesive blue action, matching the
// Plan tab's pricing-card buttons. No black anywhere.
// Every pack-card icon tile uses the same blue gradient — matches
// the Plan tab's icon-tile chrome and the in-page blue CTA buttons.
// No black gradient anywhere on the credits-purchase surface.
const DEFAULT_GRADIENT = 'from-blue-500 to-blue-600'
const DEFAULT_BUTTON = 'bg-blue-600 hover:bg-blue-700'

export default function Credits({ embedded = false }) {
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin
  const [searchParams] = useSearchParams()
  const [balance, setBalance] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [periodFilter, setPeriodFilter] = useState('yesterday')
  // Multi-select filters: shape is `{ include: string[], exclude: string[] }`
  // matching the MultiSearchableSelect contract. Backend serializes as
  // comma-separated lists in `tx_type` / `tx_type_exclude` / `agent_id`
  // / `agent_id_exclude`.
  const [txTypeFilter, setTxTypeFilter] = useState({ include: [], exclude: [] })
  const [agentFilter, setAgentFilter] = useState({ include: [], exclude: [] })
  const [agentOptions, setAgentOptions] = useState([]) // [{id, name}]
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [packages, setPackages] = useState([])
  const [tooltip, setTooltip] = useState({ visible: false, tx: null, x: 0, y: 0 })
  const [pricingMap, setPricingMap] = useState({})
  // Margin multiplier — kept in state so future tooltip / breakdown views
  // (or any other admin surface on this page) can read the active multiplier
  // without re-fetching. Currently not displayed on the package cards (we
  // intentionally do NOT reveal margin or model-level economics in the
  // hover tooltip), but the value stays available for other consumers.
  const [marginMultiplier, setMarginMultiplier] = useState(2.0)

  useEffect(() => {
    creditsAPI.listPackages()
      .then(res => setPackages(res.data.packages || []))
      .catch(() => {}) // silently ignore — empty list is fine
    creditsAPI.getPricing()
      .then(res => {
        const map = {}
        for (const m of res.data.models) map[m.model] = m
        setPricingMap(map)
      })
      .catch(() => {})
    adminAPI.getSettings()
      .then(res => {
        if (res.data.margin_multiplier) setMarginMultiplier(res.data.margin_multiplier)
      })
      .catch(() => {})
    // Load workflow list for filter dropdown (user's own agents, incl. trashed)
    workflowsAPI.getAll()
      .then(res => {
        const list = Array.isArray(res.data?.agents) ? res.data.agents : []
        setAgentOptions(list.map(a => ({ id: a.id, name: a.name })))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast.success('AI Credits purchased successfully!')
    }
    if (searchParams.get('cancelled') === 'true') {
      toast('Purchase cancelled', { icon: 'i' })
    }
    fetchCredits()
  }, [])

  // Re-fetch when filters change — also dismiss the token tooltip so it
  // doesn't get stuck when the transaction row it was anchored to unmounts.
  useEffect(() => {
    setTooltip({ visible: false, tx: null, x: 0, y: 0 })
    setHistoryPage(1)
    fetchFilteredHistory()
  }, [periodFilter, txTypeFilter, agentFilter, dateFrom, dateTo])

  const buildHistoryParams = (page = 1, limitOverride) => {
    const params = { page, limit: limitOverride ?? historyPageSize }
    const presetRange = resolveDatePreset(periodFilter)
    if (dateFrom || dateTo) {
      // Custom date range overrides period filter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
    } else if (presetRange) {
      // today / yesterday — frontend computes the local-tz day boundaries
      // and sends them as a custom range, so the backend can use a bounded
      // index range scan instead of a 7-day window.
      Object.assign(params, presetRange)
    } else if (periodFilter && periodFilter !== 'all') {
      params.period = periodFilter
    }
    // Multi-select filters serialize as comma-separated lists. Backend
    // accepts `tx_type` / `tx_type_exclude` (single value falls through
    // to exact-match for back-compat) and `agent_id` / `agent_id_exclude`.
    if (txTypeFilter?.include?.length) params.tx_type = txTypeFilter.include.join(',')
    if (txTypeFilter?.exclude?.length) params.tx_type_exclude = txTypeFilter.exclude.join(',')
    if (agentFilter?.include?.length) params.agent_id = agentFilter.include.join(',')
    if (agentFilter?.exclude?.length) params.agent_id_exclude = agentFilter.exclude.join(',')
    return params
  }

  const fetchCredits = async () => {
    try {
      const [balanceRes, historyRes] = await Promise.all([
        creditsAPI.getBalance(),
        creditsAPI.getHistory(buildHistoryParams(1)),
      ])
      setBalance(balanceRes.data)
      setTransactions(historyRes.data.transactions)
      setHistoryTotal(historyRes.data.total)
    } catch (err) {
      toast.error('Failed to load AI Credits')
    } finally {
      setLoading(false)
    }
  }

  const fetchFilteredHistory = async () => {
    try {
      const res = await creditsAPI.getHistory(buildHistoryParams(1))
      setTransactions(res.data.transactions)
      setHistoryTotal(res.data.total)
    } catch {}
  }

  const handleCheckout = (pkg) => {
    if (!pkg.checkout_url) {
      toast.error('Checkout not configured. Please contact support.')
      return
    }
    if (window.open_center_popup) {
      window.open_center_popup(pkg.checkout_url)
    } else {
      window.location.href = pkg.checkout_url
    }
  }

  const fetchHistoryPage = async (page, limitOverride) => {
    setHistoryLoading(true)
    try {
      const res = await creditsAPI.getHistory(buildHistoryParams(page, limitOverride))
      setTransactions(res.data.transactions)
      setHistoryTotal(res.data.total)
      setHistoryPage(page)
    } catch {
      toast.error('Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }

  if (loading) {
    // Full-structure skeleton — mirrors the post-load page (description,
    // balance hero card, Buy Credits table, Transaction History table)
    // so users see the page silhouette instead of a stranded spinner.
    // Same approach as the Token Usage tab and the Analytics page.
    const Sk = ({ className = '', style }) => (
      <div className={`animate-pulse bg-gray-200 dark:bg-neutral-700 rounded ${className}`} style={style} />
    )
    return (
      <div className={embedded ? '' : 'max-w-[1600px] mx-auto px-3 sm:px-4 py-3 sm:py-4'}>
        {/* Description paragraph — 2 lines */}
        <div className="mb-5 space-y-2">
          <Sk className="h-3 w-full max-w-[640px]" />
          <Sk className="h-3 w-3/4 max-w-[480px]" />
        </div>

        {/* Balance card silhouette — mirrors the post-load outer card
            (white chrome + larger section heading + 3 fixed-width
            stat cards). */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-4 sm:mb-6">
          <Sk className="h-5 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
                <Sk className="h-3 w-20" />
                <Sk className="h-7 w-24 mt-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Buy Credits — section heading + 3-card grid silhouette.
            Compact default (icon · name · tagline · price · CTA);
            features live behind a "View details" toggle below. */}
        <Sk className="h-5 w-32 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-2xl p-5 shadow-sm flex flex-col"
            >
              <Sk className="h-10 w-10 !rounded-xl mb-3" />
              <Sk className="h-5 w-24 mb-1" />
              <Sk className="h-3 w-28 mb-3" />
              <Sk className="h-8 w-28 mb-1" />
              <Sk className="h-3 w-32 mb-4" />
              <Sk className="h-10 w-full !rounded-xl mt-auto" />
            </div>
          ))}
        </div>
        {/* "View details" toggle placeholder */}
        <div className="flex justify-center mb-8">
          <Sk className="h-4 w-32" />
        </div>

        {/* Transaction History — heading + filter bar + table */}
        <Sk className="h-5 w-44 mb-3" />

        {/* Filter bar card placeholder — 4 dropdown placeholders */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-4">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
            {[
              'col-span-2 sm:col-span-1 sm:w-[160px]',
              'col-span-2 sm:col-span-1 sm:w-[150px]',
              'col-span-2 sm:col-span-1 sm:w-[180px]',
            ].map((w, i) => (
              <div key={i} className={w}>
                <Sk className="h-3 w-16 mb-1" />
                <Sk className="h-8 w-full !rounded-xl" />
              </div>
            ))}
          </div>
        </div>

        {/* Transaction table card — header + 6 rows + pagination footer */}
        <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 dark:bg-neutral-700">
                <tr>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <th key={i} className="px-3 lg:px-4 py-3"><Sk className="h-3 w-16" /></th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                {Array.from({ length: 6 }).map((_, rIdx) => (
                  <tr key={rIdx}>
                    {/* Transaction (icon + 2-line label) */}
                    <td className="px-3 lg:px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Sk className="h-8 w-8 !rounded-lg" />
                        <div className="space-y-1.5">
                          <Sk className="h-3 w-32" />
                          <Sk className="h-2.5 w-20" />
                        </div>
                      </div>
                    </td>
                    {/* Date */}
                    <td className="px-3 lg:px-4 py-3"><Sk className="h-3 w-32" /></td>
                    {/* Source pill */}
                    <td className="px-3 lg:px-4 py-3"><Sk className="h-5 w-20 !rounded-full" /></td>
                    {/* Tokens (admin) */}
                    <td className="px-3 lg:px-4 py-3 text-center"><Sk className="h-3 w-20 mx-auto" /></td>
                    {/* Used */}
                    <td className="px-3 lg:px-4 py-3 text-right"><Sk className="h-3 w-14 ml-auto" /></td>
                    {/* Balance */}
                    <td className="px-3 lg:px-4 py-3 text-right"><Sk className="h-5 w-20 !rounded-full ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination footer */}
          <div className="flex items-center justify-between gap-3 px-3 lg:px-4 py-3 border-t border-gray-200 dark:border-neutral-700">
            <Sk className="h-4 w-32" />
            <div className="flex items-center gap-2">
              <Sk className="h-7 w-20 !rounded-md" />
              <Sk className="h-7 w-7 !rounded-md" />
              <Sk className="h-7 w-7 !rounded-md" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const balanceRaw = balance ? balance.balance / 1_000 : 0
  const balanceCredits = balanceRaw.toFixed(2)

  return (
    <>
    <div className={embedded ? '' : 'max-w-[1600px] mx-auto px-3 sm:px-4 py-3 sm:py-4'}>
      {/* Description */}
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5 leading-relaxed">
        AI Credits are consumed when your agents use Pabbly's AI models. Each API call deducts AI credits based on token usage and model pricing. If you use your own API key (BYOK), no AI credits are deducted — that usage appears in the <strong className="text-neutral-700 dark:text-neutral-300">Token Usage</strong> tab instead.
      </p>

      {/* Balance Card — same outer-card chrome as the Plan tab's
          "Current Plan" card and the BYOK Token Usage tab's header.
          Inside: section heading + stat cards using the same
          mini-card pattern (white / neutral-200 border / rounded-xl
          / p-4) so the AI Credits tab reads as the same family.
          Heading sized like Dashboard section titles, not the tiny
          uppercase column labels used inside the cards. */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-4 sm:mb-6">
        <Tooltip content="Your current AI Credit wallet and lifetime totals">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 cursor-help inline-block">
            Credit Balance
          </h3>
        </Tooltip>
        {/* 3 equal-width columns from `sm:` upward, stacked on mobile.
            Explicit cols (vs. auto-fill) so the cards always fit the
            container at every viewport width and never overflow past
            the right edge. */}
        <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3">
          {/* Single tooltip per card — wraps the whole card so hover
              anywhere on the card surface reveals the one-line
              explanation. Tooltip wrapper passed `w-full h-full` so
              the inline-flex default doesn't shrink-wrap the card. */}
          <Tooltip content="Credits ready to spend right now." maxWidth={220} className="w-full h-full">
            <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm cursor-help w-full h-full">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                <Coins size={14} className="text-neutral-400 flex-shrink-0" />
                <span>Available</span>
              </div>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">
                {balanceCredits}
              </p>
            </div>
          </Tooltip>
          <Tooltip content="Total credits you've bought, all-time." maxWidth={220} className="w-full h-full">
            <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm cursor-help w-full h-full">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                <ShoppingCart size={14} className="text-neutral-400 flex-shrink-0" />
                <span>Lifetime Purchased</span>
              </div>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">
                {balance ? (balance.lifetime_purchased / 1_000).toFixed(2) : '0.00'}
              </p>
            </div>
          </Tooltip>
          <Tooltip content="Total credits consumed, all-time." maxWidth={220} className="w-full h-full">
            <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm cursor-help w-full h-full">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                <TrendingDown size={14} className="text-neutral-400 flex-shrink-0" />
                <span>Lifetime Used</span>
              </div>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">
                {balance ? (balance.lifetime_used / 1_000).toFixed(2) : '0.00'}
              </p>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Purchase Packages — card grid (1/2/3 cols responsive). Reverted
          from the table layout so each plan reads as a self-contained
          card with its own icon, big credit count, plan label and CTA.
          The "Best Value" badge floats over the popular plan. */}
      <Tooltip content="Top up your wallet with prepaid AI Credit packages">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-6 cursor-help">Buy AI Credits</h2>
      </Tooltip>
      {packages.length === 0 ? (
        <div className="border border-dashed border-gray-200 dark:border-neutral-700 rounded-xl p-6 text-center text-sm text-neutral-400 mb-8">
          No AI Credit packages available right now. Please contact support.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {packages.map((pkg) => {
            const gradient = pkg.popular ? POPULAR_GRADIENT : DEFAULT_GRADIENT
            const buttonColor = pkg.popular ? POPULAR_BUTTON : DEFAULT_BUTTON
            const priceLabel = `$${(pkg.price_cents / 100).toFixed((pkg.price_cents % 100) === 0 ? 0 : 2)}`

            return (
              <div
                key={pkg.id || pkg.pabbly_plan_id}
                className={`relative border rounded-2xl p-5 shadow-sm transition-all hover:shadow-md flex flex-col items-center text-center ${
                  pkg.popular
                    ? 'bg-blue-50/40 dark:bg-blue-900/10 border-blue-300 dark:border-blue-700/60 ring-1 ring-blue-200 dark:ring-blue-800/40'
                    : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700'
                }`}
              >
                {/* "Best Value" pill — floats over the top edge of the popular card */}
                {pkg.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm whitespace-nowrap">
                    Best Value
                  </div>
                )}

                {/* Icon — gradient tile. Blue for the popular pick, neutral
                    black for the rest, so the row reads as one black+blue
                    family. */}
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 text-lg flex-shrink-0`}>
                  {pkg.icon || '✨'}
                </div>

                {/* Plan name — plain text, no tooltip. The Buy button
                    below carries the only tooltip on the card so
                    hover-help isn't redundant. */}
                {pkg.label && (
                  <p className="text-lg font-bold text-gray-900 dark:text-neutral-100 mb-3 truncate max-w-full">
                    {pkg.label}
                  </p>
                )}

                {/* Credit count is now the headline (no separate price
                    line — price lives in the Buy button below). Big
                    bold number + small "AI credits" label inline.
                    Plain text — only the Buy button carries a tip. */}
                <p className="inline-flex items-baseline gap-1.5 mb-4">
                  <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-neutral-100 leading-none">
                    {pkg.credits.toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-neutral-400 leading-none">AI credits</span>
                </p>

                <Tooltip
                  content={`Get ${pkg.credits.toLocaleString()} AI Credits added to your wallet for ${priceLabel}${pkg.label ? ` — ${pkg.label} pack` : ''}`}
                  position="bottom"
                  className="w-full mt-auto"
                >
                  <button
                    onClick={() => handleCheckout(pkg)}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium text-white transition-colors ${buttonColor}`}
                  >
                    {`Buy for ${priceLabel}`}
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
      )}


      {/* Credit History */}
      <Tooltip content="Every credit added or deducted from your wallet — purchases, signup bonus, and per-message usage">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-3 cursor-help">Credit History</h2>
      </Tooltip>

      {/* Filter bar — Dashboard-style card */}
      {(() => {
        // Note: "Yesterday" is the default (page loads on it) and is rendered
        // as the built-in placeholder row of MultiSearchableSelect, so it is
        // NOT listed here — adding it again would duplicate the entry.
        const dateRangeOptions = [
          { value: 'today',  label: 'Today' },
          { value: '7d',     label: 'Last 7 days' },
          { value: '30d',    label: 'Last 30 days' },
          { value: '90d',    label: 'Last 90 days' },
          { value: 'all',    label: 'All time' },
          { value: 'custom', label: 'Custom range' },
        ]
        const isCustom = periodFilter === 'custom' || !!dateFrom || !!dateTo
        const hasMultiValue = (m) => (m?.include?.length || 0) > 0 || (m?.exclude?.length || 0) > 0
        // Default state = yesterday + no other filters. The Clear-filters
        // button surfaces when anything has drifted from that.
        const hasActiveFilters = (periodFilter && periodFilter !== 'yesterday') || hasMultiValue(txTypeFilter) || hasMultiValue(agentFilter) || !!dateFrom || !!dateTo
        const handleDateRangeChange = (v) => {
          // Clicking the placeholder row sends '' — fall back to the default.
          const next = v || 'yesterday'
          setPeriodFilter(next)
          // Switching to a preset range clears any custom date inputs so the
          // server-side period filter takes effect cleanly.
          if (next !== 'custom') {
            setDateFrom('')
            setDateTo('')
          }
        }
        const clearAllFilters = () => {
          setPeriodFilter('yesterday')
          setTxTypeFilter({ include: [], exclude: [] })
          setAgentFilter({ include: [], exclude: [] })
          setDateFrom('')
          setDateTo('')
        }
        return (
          <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-4">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
              {/* Date Range — full width on phones (col-span-2) so the
                  trigger button can comfortably fit "Last 30 days" / "Custom
                  range" without truncation. Intrinsic-width once the parent
                  flips to flex at sm+. */}
              <div className="col-span-2 sm:col-span-1 sm:min-w-[160px] sm:max-w-[220px]">
                <MultiSearchableSelect
                  label="Date Range"
                  usePortal
                  value={isCustom ? 'custom' : (periodFilter && periodFilter !== 'yesterday' ? periodFilter : '')}
                  onChange={handleDateRangeChange}
                  options={dateRangeOptions}
                  placeholder="Yesterday"
                  searchPlaceholder="Search…"
                />
              </div>

              {/* Custom date inputs — only when Custom range is selected.
                  From/To stay side-by-side on mobile (each col-span-1
                  inside the grid-cols-2 parent) — they pair naturally and
                  fit the screen. */}
              {isCustom && (
                <>
                  <div className="sm:min-w-[140px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setPeriodFilter('custom') }}
                      className="w-full text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                    />
                  </div>
                  <div className="sm:min-w-[140px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setPeriodFilter('custom') }}
                      className="w-full text-sm leading-5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
                    />
                  </div>
                </>
              )}

              {/* Type — full width on phones */}
              <div className="col-span-2 sm:col-span-1 sm:min-w-[150px] sm:max-w-[200px]">
                <MultiSearchableSelect
                  label="Type"
                  multi
                  usePortal
                  value={txTypeFilter}
                  onChange={setTxTypeFilter}
                  options={[
                    { value: 'usage', label: 'AI Usage' },
                    { value: 'purchase', label: 'Purchases' },
                    { value: 'signup_bonus', label: 'Bonuses' },
                  ]}
                  placeholder="All Types"
                  searchPlaceholder="Search types…"
                />
              </div>

              {/* Workflow — full width on phones (long names need room) */}
              {agentOptions.length > 0 && (
                <div className="col-span-2 sm:col-span-1 sm:min-w-[160px] sm:max-w-[260px]">
                  <MultiSearchableSelect
                    label="Workflow"
                    multi
                    usePortal
                    value={agentFilter}
                    onChange={setAgentFilter}
                    options={agentOptions.map(a => ({ value: a.id, label: a.name }))}
                    placeholder="All Workflows"
                    searchPlaceholder="Search workflows…"
                  />
                </div>
              )}

              {/* Clear filters — own row on mobile, right-aligned text */}
              {hasActiveFilters && (
                <div className="col-span-2 sm:col-span-1 sm:self-end flex justify-end sm:justify-start">
                  <button
                    onClick={clearAllFilters}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}
      {transactions.length === 0 ? (
        <div className="text-center py-12 text-neutral-400 dark:text-neutral-500">
          <Clock size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No transactions yet</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
          {/* Desktop: real Dashboard-style table (sm+) */}
          <div className="hidden sm:block overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
              <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                <tr>
                  <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">
                    <Tooltip content="What happened — credit purchase, signup bonus, or a specific AI usage event">
                      <span className="cursor-help">Activity</span>
                    </Tooltip>
                  </th>
                  <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">Date &amp; Time</th>
                  <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Source</th>
                  {isAdmin && <th className="px-3 lg:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Tokens</th>}
                  <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Used</th>
                  <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                {transactions.map((tx, txIdx) => {
                  const isCredit = tx.amount > 0
                  const txIcon = isCredit
                    ? (tx.tx_type === 'signup_bonus' ? <Gift size={14} /> : <CreditCard size={14} />)
                    : <TrendingDown size={14} />
                  const txLabel = isCredit
                    ? (tx.tx_type === 'signup_bonus' ? 'Welcome Bonus' : tx.tx_type === 'purchase' ? 'AI Credit Purchase' : tx.description)
                    : tx.tx_type === 'usage'
                      ? (tx.agent_name || 'Deleted Workflow')
                      : tx.description
                  const txSubtitle = tx.tx_type === 'usage' ? 'Pabbly AI Credits' : tx.tx_type
                  return (
                    <tr key={tx.id || `tx-${txIdx}`} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                      {/* Transaction */}
                      <td className="px-3 lg:px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isCredit
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                              : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
                          }`}>
                            {txIcon}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-neutral-100 truncate">{txLabel}</p>
                            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 capitalize truncate">{txSubtitle}</p>
                          </div>
                        </div>
                      </td>

                      {/* Date & Time */}
                      <td className="px-3 lg:px-4 py-3 text-xs text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                        {tx.created_at
                          ? new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' ' + new Date(tx.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                          : '—'}
                      </td>

                      {/* Source badge */}
                      <td className="px-3 lg:px-4 py-3">
                        {(() => {
                          const src = tx.source
                          if (!src || tx.tx_type !== 'usage') {
                            return <span className="text-[11px] text-neutral-300 dark:text-neutral-600">—</span>
                          }
                          const label =
                            src === 'chat' ? 'Master Agent' :
                            src === 'test' ? 'Test Run' :
                            src === 'run'  ? 'Workflow Run' :
                            src
                          const tip =
                            src === 'chat' ? 'Master Agent chat' :
                            src === 'test' ? 'Workflow test run' :
                            src === 'run'  ? 'Live workflow run' :
                            src
                          const cls =
                            src === 'chat' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400' :
                            src === 'test' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400' :
                                             'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/50 text-violet-700 dark:text-violet-400'
                          return (
                            <Tooltip content={tip}>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}>
                                {label}
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </td>

                      {/* Tokens — admin-only */}
                      {isAdmin && (
                        <td className="px-3 lg:px-4 py-3 text-center">
                          {tx.input_tokens != null ? (
                            <div
                              className="text-[11px] text-gray-500 dark:text-neutral-400 cursor-help inline-block"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const spaceBelow = window.innerHeight - rect.bottom
                                const showAbove = spaceBelow < 250
                                setTooltip({ visible: true, tx, x: rect.left + rect.width / 2, y: showAbove ? rect.top : rect.bottom + 8, above: showAbove })
                              }}
                              onMouseLeave={() => setTooltip({ visible: false, tx: null, x: 0, y: 0 })}
                            >
                              {(() => {
                                const cr = tx.cache_read_tokens || 0
                                const cw = tx.cache_write_tokens || 0
                                const anthropicStyle = (cr + cw) > (tx.input_tokens || 0)
                                const totalIn = anthropicStyle ? (tx.input_tokens || 0) + cr + cw : (tx.input_tokens || 0)
                                const cachedPct = totalIn > 0 ? Math.round(cr / totalIn * 100) : 0
                                return (
                                  <>
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">{totalIn.toLocaleString()}</span>
                                    <span className="text-neutral-400 mx-0.5">/</span>
                                    <span className="text-violet-600 dark:text-violet-400 font-medium">{(tx.output_tokens || 0).toLocaleString()}</span>
                                    <p className="text-[9px] text-neutral-400 mt-0.5">in{cr > 0 ? <span className="text-emerald-500"> ({cachedPct}% cached)</span> : ''} / out</p>
                                  </>
                                )
                              })()}
                            </div>
                          ) : (
                            <span className="text-[11px] text-neutral-300 dark:text-neutral-600">—</span>
                          )}
                        </td>
                      )}

                      {/* Used */}
                      <td className="px-3 lg:px-4 py-3 text-right whitespace-nowrap">
                        <Tooltip content={isCredit ? 'AI Credits added to your account' : 'AI Credits deducted for this AI usage'}>
                          <span className={`text-sm font-bold cursor-help ${
                            isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {isCredit ? '+' : ''}{tx.amount_credits.toFixed(tx.tx_type === 'usage' ? 4 : 2)}
                          </span>
                        </Tooltip>
                      </td>

                      {/* Balance */}
                      <td className="px-3 lg:px-4 py-3 text-right whitespace-nowrap">
                        <Tooltip content="AI Credit balance remaining after this transaction">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-full cursor-help">
                            <Coins size={10} className="text-amber-500" />
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">{tx.balance_after_credits.toFixed(tx.tx_type === 'usage' ? 4 : 2)}</span>
                          </span>
                        </Tooltip>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards (sm:hidden) */}
          <div className="sm:hidden divide-y divide-gray-200 dark:divide-neutral-700">
            {transactions.map((tx, txIdx) => {
              const isCredit = tx.amount > 0
              const txIcon = isCredit
                ? (tx.tx_type === 'signup_bonus' ? <Gift size={14} /> : <CreditCard size={14} />)
                : <TrendingDown size={14} />
              const txLabel = isCredit
                ? (tx.tx_type === 'signup_bonus' ? 'Welcome Bonus' : tx.tx_type === 'purchase' ? 'AI Credit Purchase' : tx.description)
                : tx.tx_type === 'usage'
                  ? (tx.agent_name || 'Deleted Workflow')
                  : tx.description
              const txSubtitle = tx.tx_type === 'usage' ? 'Pabbly AI Credits' : tx.tx_type

              return (
                <div key={tx.id || `tx-mobile-${txIdx}`} className="px-3 py-3 hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                  <div className="flex flex-col gap-2">
                    {/* Row 1: icon + label/subtitle + amount */}
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isCredit
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
                      }`}>
                        {txIcon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{txLabel}</p>
                        <p className="text-[10px] text-neutral-400 dark:text-neutral-500 capitalize truncate">{txSubtitle}</p>
                      </div>
                      <p className={`text-sm font-bold flex-shrink-0 ${
                        isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                      }`}>
                        {isCredit ? '+' : ''}{tx.amount_credits.toFixed(tx.tx_type === 'usage' ? 4 : 2)}
                      </p>
                    </div>
                    {/* Row 2: date + tokens + balance */}
                    <div className="flex items-center justify-between gap-2 pl-10 text-[11px] text-neutral-500 dark:text-neutral-400">
                      <span>
                        {tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' ' + new Date(tx.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}
                      </span>
                      <div className="flex items-center gap-2">
                        {/* Inline token breakdown + tap-tooltip — admin-only.
                            Non-admin users only see the final credit cost/balance. */}
                        {isAdmin && tx.input_tokens != null && (
                          <button
                            type="button"
                            className="text-[10px] cursor-pointer"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              const spaceBelow = window.innerHeight - rect.bottom
                              const showAbove = spaceBelow < 250
                              setTooltip({ visible: !tooltip.visible || tooltip.tx?.id !== tx.id, tx, x: rect.left + rect.width / 2, y: showAbove ? rect.top : rect.bottom + 8, above: showAbove })
                            }}
                          >
                            <span className="text-blue-600 dark:text-blue-400 font-medium">{tx.input_tokens.toLocaleString()}</span>
                            <span className="text-neutral-400 mx-0.5">/</span>
                            <span className="text-violet-600 dark:text-violet-400 font-medium">{(tx.output_tokens || 0).toLocaleString()}</span>
                          </button>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-full">
                          <Coins size={10} className="text-amber-500" />
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">{tx.balance_after_credits.toFixed(tx.tx_type === 'usage' ? 4 : 2)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination
            currentPage={historyPage}
            totalPages={Math.max(1, Math.ceil(historyTotal / historyPageSize))}
            totalItems={historyTotal}
            itemsPerPage={historyPageSize}
            onPageChange={(p) => fetchHistoryPage(p)}
            onPageSizeChange={(s) => { setHistoryPageSize(s); fetchHistoryPage(1, s) }}
            pageSizeOptions={[10, 25, 50, 100, 200]}
            loading={historyLoading}
          />
        </div>
      )}
    </div>

    {/* Fixed-position token breakdown tooltip — admin-only.
        Exposes per-request token counts, rates, raw API cost and the margin
        multiplier. Non-admin users should never see this surface. */}
    {isAdmin && tooltip.visible && tooltip.tx && (() => {
      const t = tooltip.tx
      const pricing = pricingMap[t.model]
      // Provider semantics diverge:
      //   Anthropic: `input_tokens` is NON-cached only; cache tokens are additive.
      //   OpenAI:    `prompt_tokens` INCLUDES cached tokens (cache is a subset).
      // Detect Anthropic-style when cache > input.
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
      const finalCost = Math.abs(t.amount_credits)
      const fmtCost = (v) => (v / 1_000_000).toFixed(4)

      return (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.above ? undefined : tooltip.y, bottom: tooltip.above ? (window.innerHeight - tooltip.y + 8) + 'px' : undefined, transform: 'translateX(-50%)' }}
        >
          <div className="bg-neutral-800 dark:bg-neutral-900 text-white text-[10px] rounded-lg px-3 py-2.5 whitespace-nowrap shadow-xl border border-neutral-700 min-w-[220px]">
            {!tooltip.above && <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-neutral-800 dark:border-b-neutral-900"></div>}
            {tooltip.above && <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800 dark:border-t-neutral-900"></div>}
            <p className="font-semibold text-[11px] text-neutral-200 mb-2 border-b border-neutral-600 pb-1">Token Usage & Cost</p>

            {/* Input token bifurcation */}
            {t.system_prompt_tokens && (
              <div className="mb-2 pb-1.5 border-b border-neutral-700 text-[9px] text-neutral-400 space-y-0.5">
                <p className="text-[10px] text-neutral-300 font-medium mb-1">Input tokens include:</p>
                <div className="flex justify-between">
                  <span>System prompt</span>
                  <span className="text-blue-300">~{t.system_prompt_tokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>User message + history ({t.conversation_messages || 0} msgs)</span>
                  <span className="text-blue-300">~{Math.max(0, totalInput - t.system_prompt_tokens).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Token rows with cost. Rate + per-row Cost columns and the
                "Raw API cost" / "With margin + conversion" breakdown are
                admin-only — they expose raw provider pricing and the internal
                margin multiplier. Non-admin users only see Type + Tokens and
                the final Total deducted in credits. */}
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-neutral-400">
                  <td className="pb-1">Type</td>
                  <td className="pb-1 text-right">Tokens</td>
                  {isAdmin && pricing && <td className="pb-1 text-right">Rate</td>}
                  {isAdmin && pricing && <td className="pb-1 text-right">Cost</td>}
                </tr>
              </thead>
              <tbody>
                {/* Input rows grouped together so the subtotal below matches
                    the header's "in" count. Output is rendered after all
                    input rows to keep the visual flow input → output. */}
                <tr>
                  <td className="text-blue-400 py-0.5">{cacheRead > 0 || cacheWrite > 0 ? 'Input (non-cached)' : 'Input'}</td>
                  <td className="text-right font-medium">{nonCachedInput.toLocaleString()}</td>
                  {isAdmin && pricing && <td className="text-right text-neutral-400">${(pricing.input_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                  {isAdmin && pricing && <td className="text-right font-medium">{fmtCost(inputCost)}</td>}
                </tr>
                {cacheRead > 0 && (
                  <tr>
                    <td className="text-emerald-400 py-0.5">Cache Read</td>
                    <td className="text-right font-medium">{cacheRead.toLocaleString()}</td>
                    {isAdmin && pricing && <td className="text-right text-neutral-400">${(pricing.cache_read_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                    {isAdmin && pricing && <td className="text-right font-medium">{fmtCost(cacheReadCost)}</td>}
                  </tr>
                )}
                {cacheWrite > 0 && (
                  <tr>
                    <td className="text-amber-400 py-0.5">Cache Write</td>
                    <td className="text-right font-medium">{cacheWrite.toLocaleString()}</td>
                    {isAdmin && pricing && <td className="text-right text-neutral-400">${(pricing.cache_write_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                    {isAdmin && pricing && <td className="text-right font-medium">{fmtCost(cacheWriteCost)}</td>}
                  </tr>
                )}
                {(cacheRead > 0 || cacheWrite > 0) && (
                  <tr className="border-t border-neutral-700/60">
                    <td className="text-neutral-300 py-0.5 font-medium">Total input</td>
                    <td className="text-right font-semibold text-blue-300">{totalInput.toLocaleString()}</td>
                    {isAdmin && pricing && <td></td>}
                    {isAdmin && pricing && <td></td>}
                  </tr>
                )}
                <tr className={cacheRead > 0 || cacheWrite > 0 ? 'border-t border-neutral-700/60' : ''}>
                  <td className="text-violet-400 py-0.5">Output</td>
                  <td className="text-right font-medium">{(t.output_tokens || 0).toLocaleString()}</td>
                  {isAdmin && pricing && <td className="text-right text-neutral-400">${(pricing.output_cost_per_mtok / 1_000_000).toFixed(2)}/Mtok</td>}
                  {isAdmin && pricing && <td className="text-right font-medium">{fmtCost(outputCost)}</td>}
                </tr>
              </tbody>
            </table>

            {/* Totals */}
            {pricing && (
              <div className="mt-1.5 pt-1.5 border-t border-neutral-600 space-y-0.5">
                {isAdmin && (
                  <>
                    <div className="flex justify-between text-neutral-400">
                      <span>Raw API cost</span>
                      <span>${(rawTotal / 1_000_000).toFixed(6)}</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>With margin + conversion</span>
                      <span>{finalCost.toFixed(4)} AI credits</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-semibold text-red-400 text-[11px]">
                  <span>Total deducted</span>
                  <span>{finalCost.toFixed(4)} AI credits</span>
                </div>
              </div>
            )}
            {!pricing && (
              <div className="mt-1.5 pt-1.5 border-t border-neutral-600 text-neutral-400">
                Total: {(t.input_tokens + (t.output_tokens || 0) + (t.cache_read_tokens || 0) + (t.cache_write_tokens || 0)).toLocaleString()} tokens
              </div>
            )}
          </div>
        </div>
      )
    })()}

    </>
  )
}
