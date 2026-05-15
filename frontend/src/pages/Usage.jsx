import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Activity, DollarSign, Hash, Zap, ChevronDown, ChevronUp, Lightbulb, Coins, BarChart2, Crown, Database, TrendingUp, PiggyBank } from 'lucide-react'
import { usageAPI, creditsAPI } from '../services/api'
import Credits from './Credits'
import Plans from './Plans'
import toast from 'react-hot-toast'
import DailyTrendChart from '../components/charts/DailyTrendChart'
import CostByModelChart from '../components/charts/CostByModelChart'
import ChartCard from '../components/charts/ChartCard'
import { LineChartSkel, DonutSkel } from '../components/charts/ChartSkeletons'
import Pagination from '../components/ui/Pagination'
import Tooltip from '../components/ui/Tooltip'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import { resolveDatePreset } from '../utils/dateRange'

// --- Tips (scrolling ticker) ---
const TIPS = [
  'Use code steps for API calls — they consume zero AI tokens.',
  'Claude Haiku is 6x cheaper than Opus for simple tasks.',
  'Keep system prompts under 500 words to reduce per-request cost.',
  'Prompt caching saves up to 90% on repeated context — structure static content first.',
  'Use labeled output formats (KEY: value) for reliable inter-step parsing.',
  'Break complex tasks into multiple simpler steps — cheaper models handle each one.',
  'Avoid sending raw HTML to AI — strip tags in a code step first.',
  'Filter data before sending to AI — only pass what the model actually needs.',
  'Use JSON output format in system prompts for structured, parseable responses.',
  'GPT-4o Mini costs 96% less than GPT-4o — great for classification tasks.',
  'Cache read tokens cost 90% less than regular input on Claude models.',
  'Set max_tool_calls to limit runaway tool usage in AI steps.',
  'Test with cheaper models first, upgrade only if quality is insufficient.',
  'Use code steps to aggregate data before AI analysis — fewer tokens, better results.',
  'Short, specific prompts outperform long, vague ones — and cost less.',
  'Gemini Flash is ideal for high-volume, low-complexity tasks at $0.15/1M tokens.',
  'Batch multiple items in one prompt instead of making separate API calls.',
  'Use output filters to trim AI responses before passing to next steps.',
  'Monitor your daily trend chart to spot unexpected usage spikes early.',
  'Every 1K tokens in your system prompt costs ~$0.003/request with Sonnet.',
  'Use web_search sparingly — each search adds tokens from search results.',
  'Prefer structured data (JSON) over natural language for inter-step communication.',
  'Code steps run in milliseconds vs seconds for AI steps — faster and free.',
  'Set precise output instructions to avoid verbose AI responses.',
  'Use Haiku for routing/classification, Sonnet for analysis, Opus only for complex reasoning.',
]

// --- Helpers ---

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return Math.round(n / 1000) + 'K'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function formatUsd(n) {
  if (!n || n === 0) return '$0.00'
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(2)
}

// Note: "Yesterday" is the default — it's rendered as the built-in
// placeholder row of MultiSearchableSelect and is intentionally NOT
// listed here to avoid duplication. Default is yesterday (not today)
// because today is partial — yesterday's complete-day numbers are the
// useful baseline and the smaller window also keeps the page fast.
const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: 'Last 7 days' },
  { value: '30d',   label: 'Last 30 days' },
  { value: '90d',   label: 'Last 90 days' },
  { value: 'all',   label: 'All time' },
]

// --- Skeleton ---

function Skeleton({ className = '', style }) {
  return <div className={`animate-pulse bg-gray-200 dark:bg-neutral-700 rounded ${className}`} style={style} />
}

function MetricCardSkeleton({ withSubtext = false }) {
  // Mirrors the real metric card: rounded-xl p-4 shadow-sm border, text-[11px]
  // uppercase label + text-2xl bold value + optional sub-text row.
  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-28 mt-1" />
      {withSubtext && <Skeleton className="h-3 w-32 mt-1" />}
    </div>
  )
}

function TopListSkeleton() {
  // Mirrors "Top Models" / "Top Workflows" subsections inside Usage
  // Breakdown — flat (no card chrome), header + 5 inline rows.
  return (
    <div>
      <Skeleton className="h-3 w-24 mb-3" />
      <div className="space-y-2.5">
        {[0.55, 0.65, 0.4, 0.5, 0.45].map((w, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3.5" style={{ width: `${w * 100}%` }} />
            <div className="flex items-center gap-3 flex-shrink-0">
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TokensByTypeSkeleton() {
  // Mirrors the "Tokens By Type" flat subsection — header pulse, then
  // 4 rows of (label + value + 6px mini-bar), then a total line.
  return (
    <div>
      <Skeleton className="h-3 w-24 mb-3" />
      <div className="space-y-2.5">
        {[0.6, 0.5, 0.4, 0.3].map((w, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-1.5 !rounded-full" style={{ width: `${w * 100}%` }} />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-20 mt-3" />
    </div>
  )
}

function TableCardSkeleton({ rows = 5, columns = 6 }) {
  // Mirrors the Dashboard-style table cards used for Model Breakdown and
  // Workflow Breakdown — section heading, table header bar, body rows,
  // and the Pagination footer below.
  return (
    <div className="mb-8">
      <Skeleton className="h-5 w-48 mb-4" />
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 dark:bg-neutral-700">
              <tr>
                {Array.from({ length: columns }).map((_, i) => (
                  <th key={i} className="px-3 lg:px-4 py-3">
                    <Skeleton className="h-3 w-16" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
              {Array.from({ length: rows }).map((_, rIdx) => (
                <tr key={rIdx}>
                  {Array.from({ length: columns }).map((_, cIdx) => (
                    <td key={cIdx} className="px-3 lg:px-4 py-3">
                      <Skeleton className={`h-4 ${cIdx === 0 ? 'w-32' : 'w-16'}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination footer placeholder — controls + page-info */}
        <div className="flex items-center justify-between gap-3 px-3 lg:px-4 py-3 border-t border-gray-200 dark:border-neutral-700">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-20 !rounded-md" />
            <Skeleton className="h-7 w-7 !rounded-md" />
            <Skeleton className="h-7 w-7 !rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Sortable Table Header (Dashboard-style) ---

const SortIndicator = ({ active, dir }) => {
  if (active) {
    return (
      <svg className="w-3 h-3 ml-1 inline-block text-gray-700 dark:text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        {dir === 'asc'
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 ml-1 inline-block text-gray-400 dark:text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  )
}

function SortHeader({ label, sortKey, currentSort, onSort, className = '' }) {
  const isActive = currentSort.key === sortKey
  return (
    <th
      className={`px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider cursor-pointer select-none ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <SortIndicator active={isActive} dir={currentSort.dir} />
      </div>
    </th>
  )
}

// --- Tip Slider (one tip at a time, auto-rotate) ---

function TipSlider() {
  const [idx, setIdx] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setIdx(i => (i + 1) % TIPS.length), 8000)
    return () => clearInterval(timer)
  }, [])

  const prev = () => setIdx(i => (i - 1 + TIPS.length) % TIPS.length)
  const next = () => setIdx(i => (i + 1) % TIPS.length)
  const copy = () => {
    navigator.clipboard.writeText(TIPS[idx])
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mb-8 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <Lightbulb size={14} className="text-amber-500 flex-shrink-0" />
        <p className="flex-1 text-[13px] text-neutral-700 dark:text-neutral-300 leading-relaxed min-h-[20px]">{TIPS[idx]}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip content="Copy tip">
            <button onClick={copy} aria-label="Copy tip" className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/20 text-neutral-400 hover:text-amber-600 transition-colors">
              {copied ? <span className="text-[10px] text-emerald-500 font-medium px-1">Copied</span> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
            </button>
          </Tooltip>
          <Tooltip content="Previous tip">
            <button onClick={prev} aria-label="Previous tip" className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/20 text-neutral-400 hover:text-neutral-600 transition-colors">
              <ChevronUp size={14} className="rotate-[-90deg]" />
            </button>
          </Tooltip>
          <Tooltip content="Next tip">
            <button onClick={next} aria-label="Next tip" className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/20 text-neutral-400 hover:text-neutral-600 transition-colors">
              <ChevronDown size={14} className="rotate-[-90deg]" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex justify-center gap-0.5 mt-2">
        {TIPS.map((_, i) => (
          <Tooltip key={i} content={`Go to tip ${i + 1}`}>
            <button onClick={() => setIdx(i)} aria-label={`Go to tip ${i + 1}`} className={`w-1 h-1 rounded-full transition-all ${i === idx ? 'bg-amber-500 w-3' : 'bg-amber-300/40 dark:bg-amber-600/30'}`} />
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

// --- Main Page ---

// Tab bar component used in both tabs
const USAGE_TABS = [
  { key: 'plan', label: 'Plan', icon: Crown, path: '/usage/plan', tip: 'Subscription tier, usage limits, and upgrade options' },
  { key: 'credits', label: 'AI Credits', icon: Coins, path: '/usage/credits', tip: 'Pabbly Provider AI Credit balance and transactions' },
  { key: 'tokens', label: 'BYOK Token Usage', icon: BarChart2, path: '/usage/tokens', tip: 'Token consumption from your own API keys (BYOK)' },
]

function UsageTabs({ activeTab }) {
  return (
    <div className="flex gap-6 mb-6 border-b border-neutral-200 dark:border-neutral-700">
      {USAGE_TABS.map(tab => {
        const isActive = activeTab === tab.key
        return (
          <Tooltip key={tab.key} content={tab.tip}>
            <Link
              to={tab.path}
              aria-label={tab.label}
              className={`flex items-center gap-1.5 pb-2.5 text-[13px] font-medium transition-all border-b-2 -mb-px no-underline
                ${isActive
                  ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
                  : 'border-transparent text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300'
                }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Link>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default function Usage() {
  const { tab } = useParams()
  const activeTab = tab || 'plan'
  useEffect(() => { document.title = 'Pabbly AgenticAI | Usage'; return () => { document.title = 'Pabbly AgenticAI' } }, [])

  const [period, setPeriod] = useState('yesterday')
  // Multi-select workflow filter. Shape: `{ include: string[], exclude: string[] }`
  // matching the MultiSearchableSelect contract. Backend `/api/usage/summary`
  // accepts comma-separated `agent_id` (include) and `agent_id_exclude`.
  const [agentFilter, setAgentFilter] = useState({ include: [], exclude: [] })
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  const [pricing, setPricing] = useState(null)
  // Stable workflow options for the filter dropdown — cached from the
  // first unfiltered summary so the dropdown stays populated even when
  // the user filters down to a workflow whose row drops out of `by_agent`.
  const [workflowOptions, setWorkflowOptions] = useState([])

  // Model table sort
  const [modelSort, setModelSort] = useState({ key: 'cost', dir: 'desc' })
  // Agent table sort
  const [agentSort, setAgentSort] = useState({ key: 'cost', dir: 'desc' })

  // Pagination state for each table
  const [modelPage, setModelPage] = useState(1)
  const [modelPageSize, setModelPageSize] = useState(10)
  const [agentPage, setAgentPage] = useState(1)
  const [agentPageSize, setAgentPageSize] = useState(10)

  // Viewport-aware chart height — shorter on phones to prevent excessive scrolling,
  // but tall enough that bar charts with 8+ items still get visible spacing.
  const [chartHeight, setChartHeight] = useState(280)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setChartHeight(w < 640 ? 240 : w < 1024 ? 260 : 280)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Reset pages when filters/data change so current page stays valid
  useEffect(() => { setModelPage(1); setAgentPage(1) }, [period, agentFilter])

  useEffect(() => {
    fetchData()
  }, [period, agentFilter])

  useEffect(() => {
    creditsAPI.getPricing().then(res => setPricing(res.data?.models || res.data || []))
      .catch(() => {})
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = { key_type: 'byok' }
      const presetRange = resolveDatePreset(period)
      if (presetRange) Object.assign(params, presetRange)
      else             params.period = period
      // Multi-select serializes as comma-separated lists. Backend's
      // /api/usage/summary handles single-value as exact match for
      // back-compat, multi-value via $in/$nin.
      if (agentFilter?.include?.length) params.agent_id = agentFilter.include.join(',')
      if (agentFilter?.exclude?.length) params.agent_id_exclude = agentFilter.exclude.join(',')
      const res = await usageAPI.getSummary(params)
      setSummary(res.data)
      // Cache the full workflow list ONLY when no filter is active so
      // the dropdown stays populated after the user narrows the view
      // down to a subset.
      const filterIsEmpty = !(agentFilter?.include?.length) && !(agentFilter?.exclude?.length)
      if (filterIsEmpty) {
        const list = (res.data?.by_agent || [])
          .map((a) => ({ id: a.agent_id, name: a.agent_name || a.agent_id }))
          .filter((a) => a.id)
        if (list.length > 0) setWorkflowOptions(list)
      }
    } catch (err) {
      toast.error('Failed to load usage data')
    } finally {
      setLoading(false)
    }
  }

  // Sorting helpers
  const sortedModels = useMemo(() => {
    const models = summary?.by_model || []
    return [...models].sort((a, b) => {
      const dir = modelSort.dir === 'asc' ? 1 : -1
      const av = a[modelSort.key] ?? 0
      const bv = b[modelSort.key] ?? 0
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * (av - bv)
    })
  }, [summary?.by_model, modelSort])

  const sortedAgents = useMemo(() => {
    const agents = summary?.by_agent || []
    return [...agents].sort((a, b) => {
      const dir = agentSort.dir === 'asc' ? 1 : -1
      const av = a[agentSort.key] ?? 0
      const bv = b[agentSort.key] ?? 0
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * (av - bv)
    })
  }, [summary?.by_agent, agentSort])

  const handleModelSort = (key) => {
    setModelSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
  }

  const handleAgentSort = (key) => {
    setAgentSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
  }

  // Daily trend data
  // Stable references — recharts re-renders heavily when fed a fresh array
  // ref each parent render. Memoize so the underlying arrays only change
  // when the actual summary payload changes.
  const dailyData = useMemo(
    () => (summary?.daily_trend || []).slice(-30),
    [summary?.daily_trend],
  )
  const maxCost = useMemo(
    () => Math.max(...dailyData.map(d => d.total_cost_usd || 0), 0.01),
    [dailyData],
  )

  // Trend granularity (daily vs hourly) — combines what used to be two
  // separate charts (Daily Usage Trend + Hourly Activity) into one line
  // chart with a user-controlled toggle.
  const [trendGranularity, setTrendGranularity] = useState('daily')

  const trendData = useMemo(() => {
    const hourLabel = (h) => {
      if (h === 0) return '12a'
      if (h === 12) return '12p'
      return h < 12 ? `${h}a` : `${h - 12}p`
    }
    if (trendGranularity === 'hourly') {
      return (summary?.hourly_distribution || []).map((h) => ({
        date: hourLabel(h.hour),
        input_tokens: h.input_tokens || 0,
        output_tokens: h.output_tokens || 0,
      }))
    }
    return dailyData
  }, [trendGranularity, summary?.hourly_distribution, dailyData])

  // Summary stats — backend nests under `totals`
  const t = summary?.totals || {}
  const inputTokens = t.input_tokens || 0
  const outputTokens = t.output_tokens || 0
  const cacheReadTokens = t.cache_read_tokens || 0
  const cacheWriteTokens = t.cache_write_tokens || 0
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  const totalCost = t.total_cost_usd || 0
  const totalRequests = t.total_requests || 0
  // Cache savings: cache reads cost ~90% less than regular input tokens
  const cacheSavings = useMemo(() => {
    if (!pricing || !cacheReadTokens) return 0
    const defaultModel = pricing.find(p => p.model?.includes('sonnet')) || pricing[0]
    if (!defaultModel) return 0
    const inputRate = (defaultModel.input_cost_per_mtok || 0) / 1_000_000
    const cacheRate = (defaultModel.cache_read_cost_per_mtok || 0) / 1_000_000
    return cacheReadTokens * (inputRate - cacheRate) / 1_000_000
  }, [pricing, cacheReadTokens])

  return (
    <div className="p-3 sm:p-6 overflow-x-hidden">
      {/* Unified page header — same pattern across all top-level pages */}
      <div className="mb-4 sm:mb-6 min-w-0">
        <Tooltip content="Two views — AI Credits tracks Pabbly Provider spend, Token Usage tracks BYOK API key consumption with model + workflow breakdowns" position="bottom">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 cursor-default inline-block">Plans & Usage</h1>
        </Tooltip>
        <p className="text-sm sm:text-base text-gray-600 dark:text-neutral-400 mt-0.5 sm:mt-1">
          Manage your subscription, AI Credit wallet, and BYOK token usage in one place.
        </p>
      </div>

      {/* Persistent tab bar — never unmounts */}
      <UsageTabs activeTab={activeTab} />

      {/* Plan tab — hidden with CSS to preserve state */}
      <div className={activeTab === 'plan' ? '' : 'hidden'}>
        <Plans embedded />
      </div>

      {/* Credits tab — hidden with CSS to preserve state */}
      <div className={activeTab === 'credits' ? '' : 'hidden'}>
        <Credits embedded />
      </div>

      {/* Token Usage tab — hidden with CSS to preserve state */}
      <div className={activeTab === 'tokens' ? '' : 'hidden'}>

      {/* Description */}
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5 leading-relaxed">
        Token Usage tracks consumption from your own API keys (BYOK). This helps you monitor costs on your personal API accounts. Platform AI Credit usage is tracked separately in the <strong className="text-neutral-700 dark:text-neutral-300">AI Credits</strong> tab.
      </p>

      {/* Filter bar — Dashboard-style card. Order: Date Range first, then
          Workflow — same reading order as Dashboard's Folder/Status row. */}
      {/* Outer card — wraps the filter row + summary badges + 6 metric
          cards into one unit, so the BYOK tab's header matches the
          Plan tab's "Current Plan" card pattern. Visual rhythm stays
          aligned across Plan / AI Credits / BYOK Token Usage. */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-4 sm:mb-6">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
          {/* Date Range — single-select. Default ("Last 7 days") is the
              built-in placeholder row of MultiSearchableSelect, so it's not
              listed in PERIODS to avoid duplication.
              `col-span-2 sm:col-span-1` = full width on phones, intrinsic
              width once the parent flips to flex at sm. */}
          <div className="col-span-2 sm:col-span-1 sm:min-w-[160px] sm:max-w-[220px]">
            <MultiSearchableSelect
              label="Date Range"
              usePortal
              value={period === 'yesterday' ? '' : period}
              onChange={(v) => setPeriod(v || 'yesterday')}
              options={PERIODS}
              placeholder="Yesterday"
              searchPlaceholder="Search…"
            />
          </div>

          {/* Workflow filter — multi-select with include / exclude. Driven
              by the cached `workflowOptions` so the dropdown stays
              populated even after the user narrows the table. */}
          {workflowOptions.length > 0 && (
            <div className="col-span-2 sm:col-span-1 sm:min-w-[180px] sm:max-w-[260px]">
              <MultiSearchableSelect
                label="Workflow"
                multi
                usePortal
                value={agentFilter}
                onChange={setAgentFilter}
                options={workflowOptions.map((a) => ({ value: a.id, label: a.name }))}
                placeholder="All Workflows"
                searchPlaceholder="Search workflows…"
              />
            </div>
          )}
        </div>

        {/* Divider between filter row and summary section */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 mt-4 pt-4">
          <Tooltip content="Token consumption from your own API keys (BYOK) for the selected period">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 cursor-help inline-block">
              Token Usage
            </h3>
          </Tooltip>
          {loading ? (
            <>
              {/* Row 1: Summary badges (mirror real pill row) */}
              <div className="flex flex-wrap gap-2 mb-4">
                <Skeleton className="h-[26px] w-28 !rounded-full" />
                <Skeleton className="h-[26px] w-24 !rounded-full" />
                <Skeleton className="h-[26px] w-28 !rounded-full" />
                <Skeleton className="h-[26px] w-24 !rounded-full" />
              </div>
              {/* Row 2: 6 metric cards — all uniform (no subtext rows
                  on the real cards, so all skeletons match). */}
              <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3">
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </div>
            </>
          ) : !summary ? (
            <div className="text-center py-12 text-neutral-400 dark:text-neutral-500">
              <Activity size={36} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No usage data yet</p>
              <p className="text-xs mt-1">Start chatting with a workflow to see token usage here.</p>
            </div>
          ) : (
            <>
              {/* Row 1: Summary badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                <Tooltip content={`Exact: ${totalTokens.toLocaleString()} tokens`}>
                  <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">{formatTokens(totalTokens)} Tokens</span>
                </Tooltip>
                <Tooltip content={`Total spend on your BYOK API keys: $${(totalCost || 0).toFixed(4)}`}>
                  <span className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium">{formatUsd(totalCost)} Cost</span>
                </Tooltip>
                <Tooltip content="Total LLM API requests in the selected period">
                  <span className="px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-medium">{totalRequests} Requests</span>
                </Tooltip>
                {(summary?.messages?.total || 0) > 0 && (
                  <Tooltip content="Total chat messages exchanged with workflows">
                    <span className="px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-xs font-medium">{summary.messages.total} Messages</span>
                  </Tooltip>
                )}
              </div>

              {/* Row 2: 6 Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3">
                {/* All 6 cards carry an icon — matches the Analytics
                    MetricCard chrome (icon + label, big bold value). */}
                {/* Total Tokens */}
                <Tooltip content={`Total tokens consumed across all requests in this period. In = ${inputTokens.toLocaleString()}, Out = ${outputTokens.toLocaleString()}`} className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <Hash size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Total Tokens</span>
                    </div>
                    <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{formatTokens(totalTokens)}</p>
                  </div>
                </Tooltip>
                {/* Total Cost */}
                <Tooltip content="Total dollars billed by your provider (BYOK) across all requests" className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <DollarSign size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Total Cost</span>
                    </div>
                    <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{formatUsd(totalCost)}</p>
                  </div>
                </Tooltip>
                {/* Avg Cost / Request */}
                <Tooltip content="Average dollar cost per LLM request — useful for spotting outliers" className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <TrendingUp size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Avg Cost / Request</span>
                    </div>
                    <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{formatUsd(summary?.avg_cost_per_request || (totalRequests > 0 ? totalCost / totalRequests : 0))}</p>
                  </div>
                </Tooltip>
                {/* Cache Hit Rate */}
                <Tooltip content="Share of input tokens served from prompt cache (90% cheaper than fresh input)" className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <Database size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Cache Hit Rate</span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{(summary?.cache_hit_rate || ((inputTokens + cacheReadTokens) > 0 ? (cacheReadTokens / (inputTokens + cacheReadTokens) * 100) : 0)).toFixed(1)}%</p>
                  </div>
                </Tooltip>
                {/* Requests */}
                <Tooltip content="Total LLM API requests sent to your providers" className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <Activity size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Requests</span>
                    </div>
                    <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{totalRequests.toLocaleString()}</p>
                  </div>
                </Tooltip>
                {/* Cache Savings */}
                <Tooltip content="Estimated dollars saved by prompt caching vs paying full input rate" className="w-full">
                  <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full">
                    <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <PiggyBank size={14} className="text-neutral-400 flex-shrink-0" />
                      <span>Cache Savings</span>
                    </div>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatUsd(cacheSavings)}</p>
                  </div>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Section 2: Top Models, charts, tables — outside the header card */}
      {loading ? (
        <>
          {/* Usage Breakdown card — Top Models + Top Workflows + Tokens By Type
              flat inside one outer card, sharing one heading. */}
          <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-4 sm:mb-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-0 lg:divide-x lg:divide-neutral-200 lg:dark:divide-neutral-700">
              <div className="lg:pr-5"><TopListSkeleton /></div>
              <div className="lg:px-5"><TopListSkeleton /></div>
              <div className="lg:pl-5"><TokensByTypeSkeleton /></div>
            </div>
          </div>
          {/* Row 5: Usage Trend (line) + Cost by Model (donut). Same
              <ChartCard> chrome as the loaded view, with shape-specific
              skeletons inside so the silhouette matches what's coming. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ChartCard title="Usage Trend">
              <LineChartSkel height={chartHeight} />
            </ChartCard>
            <ChartCard title="Cost by Model">
              <DonutSkel height={chartHeight} />
            </ChartCard>
          </div>
          {/* Section: Model Breakdown table */}
          <TableCardSkeleton rows={5} columns={6} />
          {/* Section: Workflow Breakdown table */}
          <TableCardSkeleton rows={5} columns={5} />
        </>
      ) : !summary ? null : (
        <>
          {/* Usage Breakdown — single outer card wraps Top Models +
              Top Workflows + Tokens By Type, all inline on desktop. */}
          {(((summary?.top_models?.length || sortedModels.length) > 0)
            || ((summary?.top_agents?.length || sortedAgents.length) > 0)
            || totalTokens > 0) && (
            <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-4 sm:mb-6">
              <Tooltip content="Top spend leaders and token-type mix for the selected period">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 cursor-help inline-block">
                  Usage Breakdown
                </h3>
              </Tooltip>
              {/* Three flat sections — no nested card chrome so each
                  subsection heading sits at the same x-coordinate as
                  the outer "Usage Breakdown" heading. Vertical
                  dividers separate columns on desktop. */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-0 lg:divide-x lg:divide-neutral-200 lg:dark:divide-neutral-700">
                {/* Top Models */}
                {((summary?.top_models?.length || sortedModels.length) > 0) && (
                  <div className="lg:pr-5">
                    <Tooltip content="Models ranked by total dollar cost in this period">
                      <h4 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3 inline-block">Top Models</h4>
                    </Tooltip>
                    <div className="space-y-2">
                      {(summary?.top_models || sortedModels).slice(0, 5).map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-[13px]">
                          <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate mr-2">{m.model}</span>
                          <div className="flex items-center gap-3 flex-shrink-0 text-[12px]">
                            <span className="text-neutral-900 dark:text-neutral-100 font-semibold">{formatUsd(m.total_cost_usd || m.cost)}</span>
                            <span className="text-neutral-400">{formatTokens(m.total_tokens || ((m.input_tokens||0)+(m.output_tokens||0)+(m.cache_read_tokens||0)+(m.cache_write_tokens||0)))}</span>
                          </div>
                        </div>
                      ))}
                      {(summary?.top_models || sortedModels).length === 0 && <p className="text-[12px] text-neutral-400">No model data yet</p>}
                    </div>
                  </div>
                )}
                {/* Top Workflows */}
                {((summary?.top_agents?.length || sortedAgents.length) > 0) && (
                  <div className="lg:px-5">
                    <Tooltip content="Workflows ranked by spend — click a row to filter">
                      <h4 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3 inline-block">Top Workflows</h4>
                    </Tooltip>
                    <div className="space-y-2">
                      {(summary?.top_agents || sortedAgents).slice(0, 5).map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-[13px] cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700/50 -mx-2 px-2 py-0.5 rounded transition-colors" onClick={() => setAgentFilter({ include: [a.agent_id], exclude: [] })}>
                          <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate mr-2">{a.agent_name || a.agent_id}</span>
                          <div className="flex items-center gap-3 flex-shrink-0 text-[12px]">
                            <span className="text-neutral-900 dark:text-neutral-100 font-semibold">{formatUsd(a.total_cost_usd || a.cost)}</span>
                            <span className="text-neutral-400">{formatTokens(a.total_tokens)}</span>
                          </div>
                        </div>
                      ))}
                      {(summary?.top_agents || sortedAgents).length === 0 && <p className="text-[12px] text-neutral-400">No workflow data yet</p>}
                    </div>
                  </div>
                )}
                {/* Tokens By Type — sorted list of mini-bars. */}
                {totalTokens > 0 && (
                  <div className="lg:pl-5">
                    <Tooltip content="Share of tokens by type — Input, Output, Cache Read and Cache Write, sorted by volume">
                      <h4 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3 inline-block">Tokens By Type</h4>
                    </Tooltip>
                    <div className="space-y-2.5">
                      {[
                        { key: 'input',       label: 'Input',       value: inputTokens,       bar: 'bg-emerald-500' },
                        { key: 'output',      label: 'Output',      value: outputTokens,      bar: 'bg-red-500' },
                        { key: 'cache_read',  label: 'Cache Read',  value: cacheReadTokens,   bar: 'bg-blue-500' },
                        { key: 'cache_write', label: 'Cache Write', value: cacheWriteTokens,  bar: 'bg-amber-500' },
                      ]
                        .filter((t) => t.value > 0)
                        .sort((a, b) => b.value - a.value)
                        .map((t) => {
                          const pct = (t.value / totalTokens) * 100
                          return (
                            <div key={t.key}>
                              <div className="flex items-center justify-between text-[12px] mb-1">
                                <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate mr-2">
                                  {t.label}
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-neutral-900 dark:text-neutral-100 font-semibold tabular-nums">{formatTokens(t.value)}</span>
                                  <span className="text-neutral-400 tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
                                </div>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                                <div className={`h-full ${t.bar} rounded-full`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-3">Total: {formatTokens(totalTokens)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Charts — Usage Trend (with daily/hourly toggle) +
              Cost by Model. Uses the shared <ChartCard> + chart components
              that the admin Analytics page also uses, so the visual + tab
              behavior matches across pages. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Usage Trend — line chart, daily or hourly via header tabs */}
            {trendData.length > 0 && (
              <ChartCard
                title="Usage Trend"
                tip="Input vs output token volume over time — toggle between per-day trend and per-hour-of-day distribution"
                tabs={[{ key: 'daily', label: 'Daily' }, { key: 'hourly', label: 'Hourly' }]}
                activeTab={trendGranularity}
                onTabChange={setTrendGranularity}
                footer={
                  <div className="flex gap-4 mt-2 text-[10px] text-neutral-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Input</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Output</span>
                  </div>
                }
              >
                <DailyTrendChart data={trendData} height={chartHeight} granularity={trendGranularity} />
              </ChartCard>
            )}

            {/* Cost by Model — polished donut (matches ProviderPieChart) */}
            {(summary?.by_model || []).length > 0 && (
              <ChartCard
                title="Cost by Model"
                tip="Share of dollar cost per model — hover a slice for the exact amount"
              >
                <CostByModelChart data={summary.by_model} height={chartHeight} />
              </ChartCard>
            )}
          </div>

          {/* Section 3: Model Breakdown */}
          {sortedModels.length > 0 && (
            <div className="mb-8">
              <Tooltip content="Detailed token + cost breakdown per model used in this period">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 inline-block">Model Breakdown</h2>
              </Tooltip>
              <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
                <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                  <table className="w-full bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
                    <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                      <tr>
                        <SortHeader label="Model" sortKey="model" currentSort={modelSort} onSort={handleModelSort} />
                        <SortHeader label="Provider" sortKey="provider" currentSort={modelSort} onSort={handleModelSort} className="hidden lg:table-cell" />
                        <SortHeader label="Input" sortKey="input_tokens" currentSort={modelSort} onSort={handleModelSort} className="hidden md:table-cell" />
                        <SortHeader label="Output" sortKey="output_tokens" currentSort={modelSort} onSort={handleModelSort} className="hidden md:table-cell" />
                        <SortHeader label="Cache R" sortKey="cache_read_tokens" currentSort={modelSort} onSort={handleModelSort} className="hidden lg:table-cell" />
                        <SortHeader label="Cache W" sortKey="cache_write_tokens" currentSort={modelSort} onSort={handleModelSort} className="hidden lg:table-cell" />
                        <SortHeader label="Total" sortKey="total_tokens" currentSort={modelSort} onSort={handleModelSort} />
                        <SortHeader label="Cost" sortKey="cost" currentSort={modelSort} onSort={handleModelSort} />
                        <SortHeader label="Requests" sortKey="requests" currentSort={modelSort} onSort={handleModelSort} className="hidden sm:table-cell" />
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                      {sortedModels.slice((modelPage - 1) * modelPageSize, modelPage * modelPageSize).map((m, i) => (
                        <tr key={i} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                          <td className="px-3 lg:px-4 py-3 font-medium text-gray-900 dark:text-neutral-100 whitespace-nowrap max-w-[180px] truncate" title={m.model}>{m.model}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-500 dark:text-neutral-400 whitespace-nowrap hidden lg:table-cell">{m.provider || '-'}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden md:table-cell">{formatTokens(m.input_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden md:table-cell">{formatTokens(m.output_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden lg:table-cell">{formatTokens(m.cache_read_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden lg:table-cell">{formatTokens(m.cache_write_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-900 dark:text-neutral-100 font-medium whitespace-nowrap">{formatTokens(m.total_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-900 dark:text-neutral-100 font-medium whitespace-nowrap">{formatUsd(m.cost)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden sm:table-cell">{(m.requests || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={modelPage}
                  totalPages={Math.max(1, Math.ceil(sortedModels.length / modelPageSize))}
                  totalItems={sortedModels.length}
                  itemsPerPage={modelPageSize}
                  onPageChange={setModelPage}
                  onPageSizeChange={(s) => { setModelPageSize(s); setModelPage(1) }}
                  pageSizeOptions={[10, 25, 50, 100, 200]}
                />
              </div>
            </div>
          )}

          {/* Section 4: Workflow Breakdown */}
          {sortedAgents.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4">Workflow Breakdown</h2>
              <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
                <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                  <table className="w-full bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
                    <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                      <tr>
                        <SortHeader label="Workflow" sortKey="agent_name" currentSort={agentSort} onSort={handleAgentSort} />
                        <SortHeader label="Input" sortKey="input_tokens" currentSort={agentSort} onSort={handleAgentSort} className="hidden md:table-cell" />
                        <SortHeader label="Output" sortKey="output_tokens" currentSort={agentSort} onSort={handleAgentSort} className="hidden md:table-cell" />
                        <SortHeader label="Cache R" sortKey="cache_read_tokens" currentSort={agentSort} onSort={handleAgentSort} className="hidden lg:table-cell" />
                        <SortHeader label="Cache W" sortKey="cache_write_tokens" currentSort={agentSort} onSort={handleAgentSort} className="hidden lg:table-cell" />
                        <SortHeader label="Total" sortKey="total_tokens" currentSort={agentSort} onSort={handleAgentSort} />
                        <SortHeader label="Cost" sortKey="cost" currentSort={agentSort} onSort={handleAgentSort} />
                        <SortHeader label="Requests" sortKey="requests" currentSort={agentSort} onSort={handleAgentSort} className="hidden sm:table-cell" />
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                      {sortedAgents.slice((agentPage - 1) * agentPageSize, agentPage * agentPageSize).map((a, i) => (
                        <tr
                          key={i}
                          onClick={() => setAgentFilter({ include: [a.agent_id], exclude: [] })}
                          className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer"
                        >
                          <td className="px-3 lg:px-4 py-3 font-medium text-gray-900 dark:text-neutral-100 whitespace-nowrap max-w-[180px] sm:max-w-[260px] truncate">
                            {a.agent_name === 'Unknown Workflow' ? (
                              <Tooltip content="This row's workflow has been deleted (or its ID was missing on the transaction). The usage history is kept for billing accuracy.">
                                <span className="cursor-help underline decoration-dotted decoration-neutral-400">{a.agent_name}</span>
                              </Tooltip>
                            ) : (
                              <span title={a.agent_name || a.agent_id}>{a.agent_name || a.agent_id}</span>
                            )}
                          </td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden md:table-cell">{formatTokens(a.input_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden md:table-cell">{formatTokens(a.output_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden lg:table-cell">{formatTokens(a.cache_read_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden lg:table-cell">{formatTokens(a.cache_write_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-900 dark:text-neutral-100 font-medium whitespace-nowrap">{formatTokens(a.total_tokens)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-900 dark:text-neutral-100 font-medium whitespace-nowrap">{formatUsd(a.cost)}</td>
                          <td className="px-3 lg:px-4 py-3 text-gray-600 dark:text-neutral-300 whitespace-nowrap hidden sm:table-cell">{(a.requests || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={agentPage}
                  totalPages={Math.max(1, Math.ceil(sortedAgents.length / agentPageSize))}
                  totalItems={sortedAgents.length}
                  itemsPerPage={agentPageSize}
                  onPageChange={setAgentPage}
                  onPageSizeChange={(s) => { setAgentPageSize(s); setAgentPage(1) }}
                  pageSizeOptions={[10, 25, 50, 100, 200]}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Section 5: Single Tip Slider */}
      <TipSlider />
      </div>
    </div>
  )
}
