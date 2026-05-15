import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { adminAPI, keysAPI, packagesAPI } from '../services/api'
import Tooltip from '../components/ui/Tooltip'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import { useAuth } from '../context/AuthContext'
import { ProviderLogo } from '../utils/providerLogos'
import ProviderCard from '../components/settings/ProviderCard'
import {
  Server, DollarSign, Users, TrendingUp, ShieldCheck, MoreVertical, Key,
  ToggleLeft, ToggleRight, Search, ChevronLeft, ChevronRight, ChevronDown, Pencil,
  RefreshCw, AlertCircle, Check, X, Plus, Minus, UserCog, Coins, Save, BookOpen,
  Cpu, Zap, Database, Lock, BarChart3, Trash2, ExternalLink, Copy, Ban, Crown,
} from 'lucide-react'
import { useConfirm } from '../components/ui/ConfirmModal'
import Pagination from '../components/ui/Pagination'
import AnalyticsSkeleton from '../components/ui/AnalyticsSkeleton'

const LazyAdminAnalytics = lazy(() => import('./admin/AdminAnalytics'))
const LazyAdminEconomics = lazy(() => import('./admin/AdminEconomics'))
const LazySubscriptionTiers = lazy(() => import('./admin/SubscriptionTiersTab'))

// Generic in-tab skeleton for Providers / Economics / others that depend on
// parent-fetched data. The page header + tab strip stay rendered above this
// so the user always sees full page chrome.
// Sortable column header for the Users table — click toggles asc/desc on
// the active column or switches sort key. Indicator chevron flips with dir;
// inactive columns show a faint up/down marker so the affordance is
// discoverable. Same pattern as Dashboard / Usage SortHeader.
function UsersSortHeader({ label, sortKey, sort, onSort, align = 'left', className = '' }) {
  const isActive = sort.key === sortKey
  const dir = isActive ? sort.dir : null
  const alignCls = align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-3 lg:px-4 py-3 ${alignCls} text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-neutral-200 transition-colors ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {isActive ? (
          <svg className="w-3 h-3 text-gray-900 dark:text-neutral-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
            {dir === 'asc'
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
          </svg>
        ) : (
          // Inactive sort indicator — neutral-400 in light, neutral-400 in
          // dark too. Was neutral-600 which was nearly invisible against
          // the dark table-header bg.
          <svg className="w-3 h-3 text-gray-400 dark:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
          </svg>
        )}
      </span>
    </th>
  )
}

// Suspense fallback for the lazy-loaded Credit Economics tab. Mirrors
// AdminEconomics's loaded structure 1:1 — Overview heading + 6 labeled
// metric cards (label + icon visible, value skeletoned), then the Profit
// Margin and Credits Per Dollar section cards with their headings and
// descriptions visible. This way when the chunk lands the layout doesn't
// shift; only the skeleton bars get replaced by real values.
function AdminTabSkeleton() {
  const Box = ({ className = '' }) => (
    <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} />
  )
  const metrics = [
    { icon: Users, label: 'Total Users' },
    { icon: Coins, label: 'Total Purchased' },
    { icon: Zap, label: 'Total Used' },
    { icon: DollarSign, label: 'Raw API Cost' },
    { icon: TrendingUp, label: 'Your Profit' },
    { icon: Database, label: 'Remaining Balance' },
  ]
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 mb-3">Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {metrics.map(({ icon: Icon, label }) => (
            <div key={label} className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className="text-neutral-400" />
                <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider truncate">{label}</span>
              </div>
              <Box className="h-7 w-24 mt-1" />
              <Box className="h-3 w-32 mt-2" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Profit Margin</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">Controls how much users pay above your actual API cost</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Current Multiplier</p>
              <Box className="h-7 w-20" />
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Example (Opus $0.05 call)</p>
              <Box className="h-4 w-48" />
            </div>
          </div>
          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-700">
            <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">New Multiplier</p>
            <Box className="h-8 w-32" />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Credits Per Dollar</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">Controls how many credits $1 buys. Affects package sizes and cost display.</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Current Rate</p>
            <Box className="h-7 w-40" />
          </div>
          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-700">
            <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">New Value</p>
            <Box className="h-8 w-32" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Providers tab specifically — mirrors the loaded layout: an active-model
// status banner at the top, then a stack of provider cards (each with a
// logo square + name + Connected pill + subtitle + chevron). Without this
// the Providers tab briefly showed a 6-card metric grid which had nothing
// to do with the real content.
function ProvidersTabSkeleton() {
  const Box = ({ className = '' }) => (
    <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} />
  )
  return (
    <div className="space-y-4">
      {/* Active model banner — dot + text + Deactivate button on one row */}
      <div className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Box className="w-2.5 h-2.5 rounded-full flex-shrink-0" />
          <Box className="h-3.5 w-64 max-w-full" />
        </div>
        <Box className="h-5 w-20 ml-3 flex-shrink-0" />
      </div>

      {/* Provider cards — 4 collapsed rows matching ProviderCard chrome */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-sm">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Box className="w-9 h-9 rounded-lg flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Box className="h-3.5 w-24" />
                  <Box className="h-4 w-16 rounded-full" />
                </div>
                <Box className="h-3 w-40 max-w-full" />
              </div>
            </div>
            <Box className="w-4 h-4 flex-shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3, tip: 'Platform-wide usage trends and metrics' },
  { id: 'providers', label: 'Providers & Models', icon: Server, tip: 'Configure platform LLM providers and active models' },
  { id: 'economics', label: 'Credit Economics', icon: TrendingUp, tip: 'Tune the credits-per-dollar exchange rate and margin' },
  { id: 'plans', label: 'Pricing Plans', icon: Coins, tip: 'Manage credit packages users can purchase' },
  { id: 'tiers', label: 'Subscription Tiers', icon: Crown, tip: 'Register PSB plan_ids, edit Free/Enterprise limits, override per user' },
  { id: 'users', label: 'Users & Usage', icon: Users, tip: 'View users, balances, and grant credits' },
  { id: 'docs', label: 'Docs', icon: BookOpen, tip: 'Admin documentation and operational notes' },
]

const PROVIDERS = {
  anthropic: { name: 'Anthropic', color: '#D97757' },
  openai: { name: 'OpenAI', color: '#10A37F' },
  google: { name: 'Google', color: '#4285F4' },
  xai: { name: 'xAI', color: '#1D9BF0' },
  mistral: { name: 'Mistral AI', color: '#FF6B35' },
  perplexity: { name: 'Perplexity', color: '#20B2AA' },
  openrouter: { name: 'OpenRouter', color: '#6366F1' },
}

// Admin Providers tab only renders these. The full PROVIDERS map above
// stays intact so other tabs (Credit Economics, Users) can still look up
// `PROVIDERS[provider]?.name` for any model in the pricing table.
const ADMIN_VISIBLE_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter']

export default function Admin() {
  const { user } = useAuth()
  const { tab } = useParams()
  useEffect(() => { document.title = 'Pabbly AgenticAI | Admin Panel'; return () => { document.title = 'Pabbly AgenticAI' } }, [])
  const activeTab = tab || 'providers'

  const [stats, setStats] = useState(null)
  const [pricing, setPricing] = useState(null)
  const [settings, setSettings] = useState(null)
  const [users, setUsers] = useState(null)
  // Lifted from PricingPlansTab — keeping packages in parent state means
  // switching tabs doesn't unmount/remount the tab and re-fetch the packages
  // every time. The user reported the loader animation running constantly
  // because of that re-fetch on each tab switch.
  const [packages, setPackages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // refreshKey increments after in-tab mutations (set active model, save margin,
  // grant credits, etc.) to trigger a re-pull of stats/pricing/settings without
  // a user-facing button. Filter / period changes inside tabs already drive
  // their own fetches.
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Promise.allSettled — partial failures are common (one endpoint slow,
    // another up). We commit whatever data succeeded and only show the banner
    // when every call fails. Without this, a single 5xx on getPricing would
    // wipe out stats + settings AND render an error banner over Analytics
    // (which doesn't even consume these endpoints — it has its own fetch).
    const [statsRes, pricingRes, settingsRes] = await Promise.allSettled([
      adminAPI.getStats(),
      adminAPI.getPricing(),
      adminAPI.getSettings(),
    ])
    if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
    if (pricingRes.status === 'fulfilled') setPricing(pricingRes.value.data)
    if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.data)

    const allFailed = statsRes.status === 'rejected'
      && pricingRes.status === 'rejected'
      && settingsRes.status === 'rejected'
    if (allFailed) {
      // Friendly message — never surface raw backend / HTTP error strings
      // ("500 Server error", "ECONNREFUSED", etc.) to admins.
      setError("We couldn't load the latest data. Please check your connection and try again.")
    }
    setLoading(false)
  }, [refreshKey])

  useEffect(() => { fetchData() }, [fetchData])

  if (!user?.is_admin) {
    return (
      <div className="min-h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 p-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-2">Access Denied</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">You need admin privileges to access this page.</p>
        </div>
      </div>
    )
  }

  // No early-return skeleton here — header + tabs render immediately on mount
  // so the user always sees the page chrome ("Admin Panel" / subtitle / tab
  // strip). Each tab is responsible for its own loading state inside the
  // content area below.

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900 leading-normal">
    <div className="p-3 sm:p-6 overflow-x-hidden">
      {/* Unified page header — matches Dashboard / Usage / AI Settings pattern */}
      <div className="mb-4 sm:mb-6 min-w-0">
        <Tooltip content="Platform-wide settings: providers, pricing, credits, packages, and users">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 inline-block">Admin Panel</h1>
        </Tooltip>
        <p className="text-sm sm:text-base text-gray-600 dark:text-neutral-400 mt-0.5 sm:mt-1">
          Manage providers, pricing, credits, and users.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-start sm:items-center gap-3 flex-col sm:flex-row">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5 sm:mt-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
          </div>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-neutral-800 border border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-neutral-700 text-amber-800 dark:text-amber-200 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Tabs — on mobile, only the active tab shows its label; the rest stay
          icon-only so the strip fits comfortably without horizontal scroll.
          On sm+ widths every tab shows icon + label. */}
      <div className="flex gap-3 sm:gap-6 mb-4 sm:mb-6 border-b border-neutral-200 dark:border-neutral-700 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <Tooltip key={tab.id} content={tab.tip}>
              <Link
                to={`/admin/${tab.id}`}
                aria-label={tab.label}
                className={`flex items-center gap-1.5 pb-2.5 text-[13px] font-medium transition-all border-b-2 -mb-px no-underline whitespace-nowrap
                  ${isActive
                    ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                  }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className={isActive ? 'inline' : 'hidden sm:inline'}>{tab.label}</span>
              </Link>
            </Tooltip>
          )
        })}
      </div>

      {/* Tab Content — header + tab strip stay rendered above; each tab
          handles its own loading state. Providers & Economics depend on
          parent-fetched stats/pricing/settings, so show a generic skeleton
          while those are loading. */}
      {activeTab === 'analytics' && (
        <Suspense fallback={<AnalyticsSkeleton />}>
          <LazyAdminAnalytics />
        </Suspense>
      )}
      {activeTab === 'providers' && (
        loading && !pricing
          ? <ProvidersTabSkeleton />
          : <ProvidersTab pricing={pricing} settings={settings} onRefresh={() => setRefreshKey(k => k + 1)} />
      )}
      {activeTab === 'economics' && (
        <Suspense fallback={<AdminTabSkeleton />}>
          <LazyAdminEconomics stats={stats} onRefresh={() => setRefreshKey(k => k + 1)} />
        </Suspense>
      )}
      {activeTab === 'plans' && <PricingPlansTab packages={packages} setPackages={setPackages} />}
      {activeTab === 'tiers' && (
        <Suspense fallback={<AnalyticsSkeleton />}>
          <LazySubscriptionTiers />
        </Suspense>
      )}
      {activeTab === 'users' && <UsersTab users={users} setUsers={setUsers} refreshKey={refreshKey} currentUserId={user?.id} />}
      {activeTab === 'docs' && <DocsTab />}
    </div>
    </div>
  )
}

// ────────────────────────────────────────
// Tab 1: Providers & Models
// ────────────────────────────────────────

function ProvidersTab({ pricing, settings, onRefresh }) {
  const [toggling, setToggling] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const [pendingPreferred, setPendingPreferred] = useState({})

  // Build custom provider config from admin settings (NOT from user BYOK keysAPI)
  const cp = settings?.custom_provider
  const customKey = cp?.configured ? {
    provider: 'custom',
    base_url: cp.base_url || '',
    model_id: cp.model_id || '',
    auth_header_prefix: cp.auth_prefix || 'Bearer',
    key_hint: cp.key_hint || '',
    provider_name: cp.provider_name || '',
  } : null

  const serverPreferred = settings?.preferred_models || {}
  const preferredFor = (providerKey) =>
    pendingPreferred[providerKey] !== undefined
      ? pendingPreferred[providerKey]
      : serverPreferred[providerKey] || ''

  const setPreferred = useCallback(async (providerKey, modelId) => {
    setPendingPreferred((p) => ({ ...p, [providerKey]: modelId }))
    try {
      await adminAPI.setPreferredModel(providerKey, modelId)
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remember model')
      setPendingPreferred((p) => { const next = { ...p }; delete next[providerKey]; return next })
    }
  }, [onRefresh])

  if (!pricing) return null

  const activeProvider = settings?.active_provider || ''
  const activeModel = settings?.active_model || ''

  const byProvider = {}
  for (const m of pricing.models) {
    if (!byProvider[m.provider]) byProvider[m.provider] = []
    byProvider[m.provider].push(m)
  }
  for (const p in byProvider) {
    byProvider[p].sort((a, b) => {
      const costA = (a.input_cost_per_mtok || 0) + (a.output_cost_per_mtok || 0)
      const costB = (b.input_cost_per_mtok || 0) + (b.output_cost_per_mtok || 0)
      return costB - costA
    })
  }

  const activateModel = async (providerKey, modelId) => {
    const keyInfo = settings?.platform_keys?.[providerKey]
    if (!keyInfo?.configured) {
      toast.error(`Configure ${PROVIDERS[providerKey].name} API key first`)
      return
    }
    setToggling(modelId)
    try {
      await adminAPI.setActiveModel(providerKey, modelId)
      toast.success(`Active model set to ${modelId}`)
      try { await adminAPI.setPreferredModel(providerKey, modelId) } catch {}
      onRefresh()
    } catch (err) {
      const data = err.response?.data
      let msg
      if (data && typeof data === 'object' && typeof data.error === 'string') {
        msg = data.error
      } else if ([502, 503, 504].includes(err.response?.status)) {
        msg = 'Pabbly Functions is unreachable right now — could not sync the new active model. Your previous active model is still in effect. Please try again in a moment.'
      } else if (err.response?.status) {
        msg = `Failed to set active model (HTTP ${err.response.status}). Please try again or contact support.`
      } else {
        msg = 'Could not reach the server. Check your connection and try again.'
      }
      toast.error(msg, { duration: 8000 })
    } finally { setToggling(null) }
  }

  const deactivateModel = async () => {
    setToggling('deactivate')
    try {
      await adminAPI.setActiveModel(null, null)
      toast.success('All models deactivated')
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to deactivate')
    } finally { setToggling(null) }
  }

  const saveKey = async (providerKey, val) => {
    if (!val) return
    setSavingKey(providerKey)
    try {
      await adminAPI.updatePlatformKey(providerKey, val)
      toast.success(`${PROVIDERS[providerKey].name} API key saved`)
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save key')
    } finally { setSavingKey(null) }
  }

  const removeKey = async (providerKey) => {
    setSavingKey(providerKey)
    try {
      await adminAPI.updatePlatformKey(providerKey, '')
      toast.success(`${PROVIDERS[providerKey].name} API key removed`)
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove key', { duration: 6000 })
    } finally { setSavingKey(null) }
  }

  const KEY_HINTS = {
    anthropic: 'Paste your Anthropic API key or OAuth access token — both formats are supported.',
    openai: 'Paste your OpenAI API key — you can create one in your OpenAI dashboard.',
    google: 'Paste your Google AI Studio API key.',
    xai: 'Paste your xAI API key from the xAI console.',
    openrouter: 'One OpenRouter key gives you access to 300+ models from all major providers.',
  }
  const KEY_PLACEHOLDERS = {
    anthropic: 'sk-ant-api03-… or sk-ant-oat01-…',
    openai: 'sk-… or sk-proj-…',
    google: 'AIza…',
    xai: 'xai-…',
    openrouter: 'sk-or-…',
  }

  return (
    <div className="space-y-4">
      {/* Active model status banner */}
      {activeModel ? (
        <div className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-2.5 h-2.5">
              <div className="absolute inset-0 rounded-full bg-emerald-500 animate-pulse" />
              <div className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              Platform active model: <span className="font-bold text-neutral-900 dark:text-neutral-50">{activeProvider === 'custom' ? (customKey?.provider_name || 'Custom') : PROVIDERS[activeProvider]?.name} / {activeModel}</span>
            </span>
          </div>
          <Tooltip content="Stop using this model platform-wide. New requests will fail until another model is activated.">
            <button
              onClick={deactivateModel}
              disabled={toggling === 'deactivate'}
              aria-label="Deactivate active model"
              className="bg-red-600 text-white px-3 sm:px-4 py-1.5 text-sm font-medium rounded-xl hover:bg-red-700 transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              {toggling === 'deactivate' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              {toggling === 'deactivate' ? 'Deactivating...' : 'Deactivate'}
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-amber-700 dark:text-amber-300">No active model. Select a model below to enable AI features.</span>
        </div>
      )}

      {Object.entries(PROVIDERS).filter(([key]) => ADMIN_VISIBLE_PROVIDERS.includes(key)).map(([key, info]) => {
        const models = byProvider[key] || []
        const keyInfo = settings?.platform_keys?.[key]
        const hasKey = !!keyInfo?.configured
        const isActive = key === activeProvider

        return (
          <ProviderCard
            key={key}
            provider={key}
            providerName={info.name}
            providerColor={info.color}
            hasKey={hasKey}
            keyMasked={keyInfo?.masked}
            keyPlaceholder={KEY_PLACEHOLDERS[key]}
            keyHintText={KEY_HINTS[key]}
            isActiveProvider={isActive}
            badgeLabel="Connected"
            subtitle={isActive
              ? `Active: ${models.find(m => m.model === activeModel)?.display_name || activeModel}`
              : `${models.length} models available`}
            models={models}
            activeModel={isActive ? activeModel : null}
            preferredModel={preferredFor(key)}
            toggling={toggling}
            saving={savingKey === key}
            showTestButton={true}
            onTestKey={async (val) => {
              try {
                const res = await keysAPI.test({ provider: key, api_key: val })
                if (res.data?.valid) toast.success(`${info.name} key is valid`)
                else toast.error(res.data?.message || 'Invalid API key')
              } catch (err) {
                toast.error(err.response?.data?.error || 'Invalid API key')
              }
            }}
            onSaveKey={(val) => saveKey(key, val)}
            onRemoveKey={() => removeKey(key)}
            onActivateModel={(modelId) => activateModel(key, modelId)}
            onSelectPreferred={(modelId) => setPreferred(key, modelId)}
            providers={PROVIDERS}
          />
        )
      })}

      {/* Custom OpenAI-compatible provider — admin can set as platform default */}
      <ProviderCard
        isCustom
        customConfig={customKey}
        isActivePlatformModel={activeProvider === 'custom'}
        onCustomSaved={() => onRefresh()}
        onCustomDeleted={() => onRefresh()}
        onCustomActivate={async () => {
          if (!customKey?.base_url || !customKey?.model_id) {
            toast.error('Save the custom provider first before activating')
            return
          }
          try {
            await api.post('/api/admin/settings/active-model', {
              provider: 'custom',
              model: customKey.model_id,
              base_url: customKey.base_url,
              api_key: '__use_stored__',
              auth_header_prefix: customKey.auth_header_prefix || 'Bearer',
              display_name: customKey.provider_name || customKey.model_id,
            })
            toast.success(`Custom provider activated: ${customKey.model_id}`)
            onRefresh()
          } catch (err) {
            toast.error(err.response?.data?.error || 'Failed to activate custom provider')
          }
        }}
        mode="admin"
      />
    </div>
  )
}

// ────────────────────────────────────────
// Tab 2: Credit Economics — extracted to pages/admin/AdminEconomics.jsx
// ────────────────────────────────────────


// ────────────────────────────────────────
// Tab 3: Users & Usage
// ────────────────────────────────────────

// ────────────────────────────────────────
// Action Menu (3-dot dropdown)
// ────────────────────────────────────────

function ActionMenu({ user: u, isSelf, onToggleRole, togglingRole, onGrantCredits }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)
  const btnRef = useRef(null)

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const closeScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', closeScroll, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('scroll', closeScroll, true) }
  }, [open])

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.right - 176 }) // 176 = w-44
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref}>
      <Tooltip content="User actions">
        <button
          ref={btnRef}
          onClick={handleOpen}
          aria-label="User actions"
          className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
        >
          <MoreVertical className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
        </button>
      </Tooltip>

      {open && (
        <div
          className="fixed w-44 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl z-50 py-1"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Role actions */}
          {isSelf ? (
            <div className="px-3 py-2 text-[11px] text-neutral-400 italic">Cannot change own role</div>
          ) : (
            <>
              <Tooltip content="Demote this user — removes admin access" position="left" className="w-full">
                <button
                  onClick={async () => {
                    if (u.is_admin) { onToggleRole(); setOpen(false) }
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors ${
                    !u.is_admin
                      ? 'text-neutral-900 dark:text-neutral-100 bg-neutral-50 dark:bg-neutral-700/50 font-medium'
                      : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 flex-shrink-0" />
                  Set as User
                  {!u.is_admin && <Check className="w-3 h-3 ml-auto text-emerald-500" />}
                </button>
              </Tooltip>
              <Tooltip content="Grant this user full admin access" position="left" className="w-full">
                <button
                  onClick={async () => {
                    if (!u.is_admin) { onToggleRole(); setOpen(false) }
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors ${
                    u.is_admin
                      ? 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 font-medium'
                      : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  Set as Admin
                  {u.is_admin && <Check className="w-3 h-3 ml-auto text-purple-500" />}
                </button>
              </Tooltip>
            </>
          )}

          {/* Divider */}
          <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />

          {/* Grant credits */}
          <Tooltip content="Manually add credits to this user's balance" position="left" className="w-full">
            <button
              onClick={() => { onGrantCredits(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <Coins className="w-3.5 h-3.5 flex-shrink-0" />
              Grant Credits
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────
// Tab: Pricing Plans
// ────────────────────────────────────────

// Regex: extracts the 24-hex Pabbly plan ObjectId from an embed script like
//   <script src="https://payments.pabbly.com/api/checkoutv/embed.js?_p=69e0c225081315121a34de14"></script>
const EMBED_PLAN_ID_REGEX = /_p=([a-f0-9]{24})/i

const EMPTY_PACKAGE_FORM = {
  id: null,
  pabbly_plan_id: '',
  pabbly_plan_code: '',
  label: '',
  description: '',
  credits: '',
  price_cents: '',
  embed_script: '',
  checkout_url: '',
  icon: '',
  popular: false,
  sort_order: 0,
  active: true,
}

function PricingPlansTab({ packages, setPackages }) {
  // Loading is true only on the very first fetch (when parent has null) so
  // tab switches don't show the spinner — packages stay in parent state and
  // survive unmount/remount.
  const [loading, setLoading] = useState(packages === null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  // Three-dot row menu — single open menu at a time, anchored to the trigger
  // by viewport coords (matches Dashboard's row action menu pattern).
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const menuRef = useRef(null)
  const [copiedId, setCopiedId] = useState(null)
  const confirm = useConfirm()

  // Close the row menu on outside click + scroll. Triggers re-position
  // automatically because the menu is fixed-positioned on viewport coords.
  useEffect(() => {
    if (!menuOpenFor) return
    const closeOutside = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (e.target.closest('[data-action-trigger="plan-row-menu"]')) return
      setMenuOpenFor(null)
    }
    const closeScroll = () => setMenuOpenFor(null)
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('scroll', closeScroll, true)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('scroll', closeScroll, true)
    }
  }, [menuOpenFor])

  const copyPlanId = async (planId) => {
    try {
      await navigator.clipboard.writeText(planId)
      setCopiedId(planId)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      toast.error('Could not copy plan id')
    }
  }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await packagesAPI.list()
      setPackages(res.data.packages || [])
    } catch {
      toast.error('Failed to load packages')
    } finally {
      setLoading(false)
    }
  }, [setPackages])

  useEffect(() => {
    // Only fetch on first mount when parent has no cached packages. Tab
    // switches keep the cached array, so the spinner doesn't keep re-running.
    if (packages === null) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (pkg) => { setEditing(pkg); setModalOpen(true) }

  const handleDelete = async (pkg) => {
    const ok = await confirm({
      title: `Deactivate "${pkg.label}"?`,
      message: 'The package will be hidden from the Credits page. Historical transactions remain intact.',
      confirmLabel: 'Deactivate',
      danger: true,
    })
    if (!ok) return
    try {
      await packagesAPI.remove(pkg.id)
      toast.success('Package deactivated')
      reload()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to deactivate')
    }
  }

  if (loading || packages === null) {
    // Skeleton mirrors the loaded layout 1:1 so the page doesn't shift when
    // real data arrives: heading + Add Plan on one row, description below,
    // Dashboard-style flat-edge table with 7 columns matching the real
    // widths, then the Setup Guide card.
    const Bar = ({ className = '', style }) => (
      <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} style={style} />
    )
    return (
      <div className="space-y-4">
        {/* Header — Credit Packages heading + Add Plan button + description */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <Bar className="h-4 w-32" />
            <Bar className="h-8 w-24 rounded-xl" />
          </div>
          <Bar className="h-3 w-full max-w-xl mt-2" />
        </div>

        {/* Table — Dashboard pattern: flat edges, sticky-style header bg,
            divide-y between rows. Columns mirror the real ones (Order,
            Label, Credits, Price, Pabbly id, Status, Actions). */}
        <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
          <div className="bg-gray-50 dark:bg-neutral-700 px-3 lg:px-4 py-3 hidden md:grid items-center gap-4" style={{ gridTemplateColumns: '60px minmax(0,1fr) 80px 80px 140px 100px 60px' }}>
            <Bar className="h-3 w-10" />
            <Bar className="h-3 w-14" />
            <Bar className="h-3 w-14 ml-auto" />
            <Bar className="h-3 w-10 ml-auto" />
            <Bar className="h-3 w-20" />
            <Bar className="h-3 w-14" />
            <Bar className="h-3 w-14 ml-auto" />
          </div>
          <div className="divide-y divide-gray-200 dark:divide-neutral-700">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-3 lg:px-4 py-3 grid items-center gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 80px 80px 140px 100px 60px' }}>
                {/* sm:hidden Order column omitted on mobile to match real layout */}
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <Bar className="h-4 w-4 rounded" />
                    <Bar className="h-3.5 w-20" />
                  </div>
                  <Bar className="h-2.5 w-32" />
                </div>
                <Bar className="h-3 w-10 ml-auto" />
                <Bar className="h-3 w-12 ml-auto" />
                <Bar className="h-6 w-24 rounded" />
                <Bar className="h-6 w-16 rounded-full" />
                <Bar className="h-6 w-6 rounded ml-auto" />
              </div>
            ))}
          </div>
        </div>

        {/* Setup Guide card */}
        <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
          <Bar className="h-4 w-24 mb-2" />
          <Bar className="h-3 w-48 mb-3" />
          <div className="space-y-2">
            <Bar className="h-3 w-full max-w-md" />
            <Bar className="h-3 w-full max-w-lg" />
            <Bar className="h-3 w-full max-w-sm" />
            <Bar className="h-3 w-full max-w-xs" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Heading + Add Plan button on the same row; description below. The
          button is right-aligned, vertically centered with the heading text. */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <Tooltip content="Credit packages users can purchase via Pabbly Subscription Billing">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 inline-block">Credit Packages</h2>
          </Tooltip>
          <Tooltip content="Create a new credit package">
            <button
              onClick={openCreate}
              aria-label="Add plan"
              className="bg-blue-600 text-white px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus size={14} />
              Add Plan
            </button>
          </Tooltip>
        </div>
        <p className="text-xs text-gray-600 dark:text-neutral-400 mt-1">
          One-time credit top-ups sold via Pabbly Subscription Billing. Paste the embed script from Pabbly to auto-fill the plan id.
        </p>
      </div>

      {/* Dashboard-style table — no rounded edges, divide-y rows, sticky
          header, hover state. Status pills + action icons follow the same
          tokens used in the workflows table. */}
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
            <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
              <tr>
                <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider hidden sm:table-cell" title="Display order on the Credits page (lower = shown first)">Order</th>
                <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider" title="Package name and short description shown to users">Label</th>
                <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider" title="Credits granted on successful purchase">Credits</th>
                <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider" title="Price in USD that users pay">Price</th>
                <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider hidden lg:table-cell" title="Pabbly Subscription Billing plan id used to match invoice_paid webhooks">Pabbly plan id</th>
                <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider" title="Active = visible on Credits page; Inactive = hidden but transactions preserved">Status</th>
                <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
              {packages.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="text-center py-16 text-neutral-400 dark:text-neutral-500">
                      <Coins size={36} className="mx-auto mb-3 opacity-50" />
                      <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">No packages yet</p>
                      <p className="text-xs mt-1">Click <strong>Add Plan</strong> to create your first credit package.</p>
                    </div>
                  </td>
                </tr>
              )}
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-3 lg:px-4 py-3 text-gray-500 dark:text-neutral-400 hidden sm:table-cell tabular-nums">{pkg.sort_order}</td>
                  <td className="px-3 lg:px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {pkg.icon && <span className="text-base">{pkg.icon}</span>}
                      <span className="font-medium text-gray-900 dark:text-neutral-100">{pkg.label}</span>
                      {pkg.popular && (
                        <Tooltip content="Highlighted as the recommended package on the Credits page">
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full uppercase tracking-wider">Popular</span>
                        </Tooltip>
                      )}
                    </div>
                    {pkg.description && (
                      <div className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">{pkg.description}</div>
                    )}
                  </td>
                  <td className="px-3 lg:px-4 py-3 text-right font-medium text-gray-900 dark:text-neutral-100 tabular-nums">{pkg.credits.toLocaleString()}</td>
                  <td className="px-3 lg:px-4 py-3 text-right font-medium text-gray-900 dark:text-neutral-100 tabular-nums">${(pkg.price_cents / 100).toFixed(2)}</td>
                  <td className="px-3 lg:px-4 py-3 hidden lg:table-cell">
                    {/* Plan id is too long to show in full but admins need the
                        full string for debugging. Show a short masked version
                        + a Copy button (same pattern PPM uses for IDs). */}
                    <Tooltip content={copiedId === pkg.pabbly_plan_id ? 'Copied!' : `Click to copy: ${pkg.pabbly_plan_id}`}>
                      <button
                        onClick={() => copyPlanId(pkg.pabbly_plan_id)}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-600 dark:text-neutral-300 bg-gray-100 dark:bg-neutral-700 hover:bg-gray-200 dark:hover:bg-neutral-600 px-2 py-1 rounded transition-colors group"
                      >
                        <span>{pkg.pabbly_plan_id.slice(0, 6)}…{pkg.pabbly_plan_id.slice(-4)}</span>
                        {copiedId === pkg.pabbly_plan_id
                          ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          : <Copy className="w-3 h-3 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-neutral-200" />}
                      </button>
                    </Tooltip>
                  </td>
                  <td className="px-3 lg:px-4 py-3">
                    {/* Status pill — Dashboard pattern: dot + label, no
                        leading icon. Active = emerald, Inactive = gray. */}
                    <Tooltip content={pkg.active ? 'Visible on the Credits page' : 'Hidden from the Credits page'}>
                      {pkg.active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300">
                          <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
                          Inactive
                        </span>
                      )}
                    </Tooltip>
                  </td>
                  <td className="px-3 lg:px-4 py-3">
                    {/* Three-dot action menu — Dashboard pattern. Single
                        trigger that opens a dropdown with all row actions. */}
                    <div className="flex items-center justify-end">
                      <Tooltip content="More actions" position="left">
                        <button
                          data-action-trigger="plan-row-menu"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (menuOpenFor === pkg.id) { setMenuOpenFor(null); return }
                            const rect = e.currentTarget.getBoundingClientRect()
                            setMenuOpenFor(pkg.id)
                            setMenuPos({
                              top: rect.bottom + 4,
                              right: window.innerWidth - rect.right,
                              triggerTop: rect.top,
                            })
                          }}
                          aria-label="Plan actions"
                          className="w-7 h-7 inline-flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
                        >
                          <MoreVertical size={15} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Three-dot row action menu — fixed-position, right-anchored, flips
          upward if it would overflow viewport bottom. Mirrors Dashboard. */}
      {menuOpenFor && menuPos && (() => {
        const pkg = packages.find(p => p.id === menuOpenFor)
        if (!pkg) return null
        return createPortal(
          <div
            ref={menuRef}
            className="fixed w-52 rounded-lg border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999] overflow-hidden bg-white dark:bg-neutral-800"
            style={(() => {
              const menuHeight = pkg.checkout_url ? 144 : 96
              const wouldOverflowBottom = menuPos.top + menuHeight > window.innerHeight - 8
              const top = wouldOverflowBottom
                ? menuPos.triggerTop - menuHeight - 4
                : menuPos.top
              return {
                top: `${Math.max(8, top)}px`,
                right: `${Math.max(8, menuPos.right)}px`,
              }
            })()}
          >
            {pkg.checkout_url && (
              <a
                href={pkg.checkout_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpenFor(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors no-underline"
              >
                <ExternalLink size={14} /> Open Checkout URL
              </a>
            )}
            <button
              onClick={() => { setMenuOpenFor(null); openEdit(pkg) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
            >
              <Pencil size={14} /> Edit Plan
            </button>
            <button
              onClick={() => { setMenuOpenFor(null); handleDelete(pkg) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={14} /> Deactivate
            </button>
          </div>,
          document.body
        )
      })()}

      {/* Setup guide — neutral content card matching PPM convention. The
          previous amber/yellow box read like a warning when it's actually
          just a "how to" reference. */}
      <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 mb-1">Setup Guide</h3>
        <p className="text-[11px] text-gray-500 dark:text-neutral-400 mb-3">How to add a new credit plan.</p>
        <ol className="list-decimal list-inside space-y-1 text-xs text-gray-700 dark:text-neutral-300">
          <li>Open Pabbly Subscription Billing → Products → Pabbly AgenticAI → the target plan.</li>
          <li>Set <code className="font-mono bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-200 px-1 py-0.5 rounded">meta_data.paa_credits</code> to the number of credits this plan should grant (e.g. <code className="font-mono">100</code>).</li>
          <li>Copy the <strong className="text-gray-900 dark:text-neutral-100">Embed Script</strong> from Pabbly — this form auto-extracts the plan id.</li>
          <li>Fill in the remaining fields and click <strong className="text-gray-900 dark:text-neutral-100">Save</strong>.</li>
        </ol>
      </div>

      {modalOpen && (
        <PackageFormModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reload() }}
        />
      )}
    </div>
  )
}

function PackageFormModal({ editing, onClose, onSaved }) {
  const isEdit = !!editing
  const [form, setForm] = useState(() => {
    if (!editing) return { ...EMPTY_PACKAGE_FORM }
    return {
      id: editing.id,
      pabbly_plan_id: editing.pabbly_plan_id || '',
      pabbly_plan_code: editing.pabbly_plan_code || '',
      label: editing.label || '',
      description: editing.description || '',
      credits: String(editing.credits ?? ''),
      price_cents: String(editing.price_cents ?? ''),
      embed_script: editing.embed_script || '',
      checkout_url: editing.checkout_url || '',
      icon: editing.icon || '',
      popular: !!editing.popular,
      sort_order: editing.sort_order ?? 0,
      active: editing.active !== false,
    }
  })
  const [saving, setSaving] = useState(false)

  const handleEmbedPaste = (value) => {
    const next = { ...form, embed_script: value }
    const match = value.match(EMBED_PLAN_ID_REGEX)
    if (match && !isEdit) next.pabbly_plan_id = match[1]
    setForm(next)
  }

  const handleSave = async () => {
    const pabbly_plan_id = form.pabbly_plan_id.trim()
    const label = form.label.trim()
    const checkout_url = form.checkout_url.trim()
    const credits = parseInt(form.credits, 10)
    const price_cents = parseInt(form.price_cents, 10)

    if (!isEdit && !/^[a-f0-9]{24}$/i.test(pabbly_plan_id)) {
      toast.error('pabbly_plan_id must be a 24-character hex string')
      return
    }
    if (!label) { toast.error('Label is required'); return }
    if (!Number.isFinite(credits) || credits <= 0) { toast.error('Credits must be a positive number'); return }
    if (!Number.isFinite(price_cents) || price_cents < 0) { toast.error('Price (cents) must be a non-negative number'); return }
    if (!checkout_url) { toast.error('Checkout URL is required'); return }

    setSaving(true)
    try {
      const payload = {
        pabbly_plan_code: form.pabbly_plan_code.trim(),
        label,
        description: form.description.trim(),
        credits,
        price_cents,
        embed_script: form.embed_script.trim(),
        checkout_url,
        icon: form.icon.trim(),
        popular: form.popular,
        sort_order: Number(form.sort_order) || 0,
        active: form.active,
      }
      if (isEdit) {
        await packagesAPI.update(form.id, payload)
        toast.success('Package updated')
      } else {
        await packagesAPI.create({ pabbly_plan_id, ...payload })
        toast.success('Package created')
      }
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // PPM-aligned input: same tokens as Dashboard search + dropdown internal
  // search (`bg-gray-50 dark:bg-neutral-700` + `rounded-xl` + `py-1.5`).
  const input = "w-full text-sm leading-5 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-600 rounded-xl px-3 py-1.5 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors"
  const labelCls = "block text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1"

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-neutral-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-neutral-100">
            {isEdit ? `Edit plan — ${editing.label}` : 'Add a new plan'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-200 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>
              Embed script from Pabbly {!isEdit && <span className="text-gray-400 dark:text-neutral-500 font-normal">(auto-extracts plan id)</span>}
            </label>
            <textarea
              rows={2}
              value={form.embed_script}
              onChange={(e) => handleEmbedPaste(e.target.value)}
              placeholder='<script src="https://payments.pabbly.com/api/checkoutv/embed.js?_p=..."></script>'
              className={`${input} font-mono py-2`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Pabbly plan id {!isEdit && <span className="text-red-500">*</span>}</label>
              <input
                type="text"
                value={form.pabbly_plan_id}
                onChange={(e) => setForm({ ...form, pabbly_plan_id: e.target.value })}
                disabled={isEdit}
                placeholder="69e0c225081315121a34de14"
                className={`${input} font-mono ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              {isEdit && (
                <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-1">Plan id is set once and cannot be changed.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Pabbly plan code</label>
              <input
                type="text"
                value={form.pabbly_plan_code}
                onChange={(e) => setForm({ ...form, pabbly_plan_code: e.target.value })}
                placeholder="pabbly-agentic-ai-standard"
                className={`${input} font-mono`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Label <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Standard"
                className={input}
              />
            </div>
            <div>
              <label className={labelCls}>Icon (emoji)</label>
              <input
                type="text"
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="⚡"
                className={input}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="100 credits for $5"
              className={input}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Credits <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="1"
                value={form.credits}
                onChange={(e) => setForm({ ...form, credits: e.target.value })}
                placeholder="100"
                className={input}
              />
            </div>
            <div>
              <label className={labelCls}>Price (cents) <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                value={form.price_cents}
                onChange={(e) => setForm({ ...form, price_cents: e.target.value })}
                placeholder="500"
                className={input}
              />
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-1">$5 = 500 · $20 = 2000 · $50 = 5000</p>
            </div>
            <div>
              <label className={labelCls}>Sort order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                placeholder="10"
                className={input}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Checkout URL <span className="text-red-500">*</span></label>
            <input
              type="url"
              value={form.checkout_url}
              onChange={(e) => setForm({ ...form, checkout_url: e.target.value })}
              placeholder="https://payments.pabbly.com/subscribe/..."
              className={`${input} font-mono`}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.popular}
                onChange={(e) => setForm({ ...form, popular: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
              />
              Popular (shows a badge)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
              />
              Active (visible on Credits page)
            </label>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-neutral-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-xl transition-colors w-full sm:w-auto"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors w-full sm:w-auto"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create plan')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ────────────────────────────────────────
// Tab 4: Users & Usage
// ────────────────────────────────────────

function UsersTab({ users: usersProp, setUsers, refreshKey, currentUserId }) {
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [grantModal, setGrantModal] = useState(null) // { userId, userName }
  const [grantAmount, setGrantAmount] = useState('')
  const [granting, setGranting] = useState(false)
  const [togglingRole, setTogglingRole] = useState(null)
  // Role filter — client-side + passed to backend as `role` param (backend
  // ignores if unsupported, results just stay unfiltered which is the
  // pre-feature behavior). 'all' / 'admin' / 'user'.
  const [roleFilter, setRoleFilter] = useState('all')
  // Sort state — client-side reorder of the current page. PPM Dashboard /
  // Usage tables follow the same pattern.
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  // Three-dot row menu — right-anchored portal, matches Dashboard / Plans pattern
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const menuRef = useRef(null)

  const handleSort = (key) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' })
    setPage(1) // server-side sort spans all pages — reset to page 1
  }

  useEffect(() => {
    if (!menuOpenFor) return
    const closeOutside = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (e.target.closest('[data-action-trigger="user-row-menu"]')) return
      setMenuOpenFor(null)
    }
    const closeScroll = () => setMenuOpenFor(null)
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('scroll', closeScroll, true)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('scroll', closeScroll, true)
    }
  }, [menuOpenFor])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page,
        limit: pageSize,
        search: search || undefined,
        sort_by: sort.key,
        sort_dir: sort.dir,
      }
      if (roleFilter !== 'all') params.role = roleFilter
      const res = await adminAPI.getUsers(params)
      setUsers(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [page, pageSize, search, roleFilter, sort, setUsers, refreshKey])

  // Sort + filter happen server-side now (backend handles sort_by, sort_dir,
  // role, search). Client just renders whatever the API returns.
  const visibleUsers = usersProp?.users || []

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleGrant = async () => {
    if (!grantModal || !grantAmount) return
    setGranting(true)
    try {
      const res = await adminAPI.grantCredits(grantModal.userId, parseFloat(grantAmount))
      toast.success(`Granted ${grantAmount} credits to ${grantModal.userName} (Balance: ${res.data.new_balance_credits?.toFixed(2)})`)
      setGrantModal(null)
      setGrantAmount('')
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to grant credits')
    } finally { setGranting(false) }
  }

  const toggleRoleFor = async (u) => {
    setTogglingRole(u.id)
    try {
      const res = await adminAPI.toggleRole(u.id)
      toast.success(`${u.name} is now ${res.data.is_admin ? 'Admin' : 'User'}`)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change role')
    } finally { setTogglingRole(null) }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar — Search + Role */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3">
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
          <div className="w-full sm:min-w-[240px] sm:max-w-[320px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setPage(1) }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Role filter — single-select. "All Users" lives in the
              MultiSearchableSelect placeholder so it isn't duplicated in
              the dropdown options. */}
          <div className="w-full sm:min-w-[160px] sm:max-w-[200px]">
            <MultiSearchableSelect
              label="Role"
              labelTooltip="Filter the table to Admin-only or User-only accounts. Default shows everyone."
              usePortal
              value={roleFilter === 'all' ? '' : roleFilter}
              onChange={(v) => { setRoleFilter(v || 'all'); setPage(1) }}
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'user', label: 'User' },
              ]}
              placeholder="All Users"
              searchPlaceholder="Search…"
            />
          </div>
        </div>
      </div>

      {/* Users Table — Dashboard pattern: flat edges, sticky thead, divide-y
          rows, hover blue-50 / neutral-700/50. `table-fixed` + explicit
          column widths keep the layout stable when long names / emails would
          otherwise blow out the User cell and shift Role / Balance / Joined
          to the right. */}
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 text-[13px]">
            <colgroup>
              {/* Mobile: User wide / Balance / Actions only. Role + Joined
                  hidden on small screens to avoid horizontal scroll on phones. */}
              <col className="w-[60%] sm:w-[40%]" /> {/* User */}
              <col className="hidden sm:table-column sm:w-[14%]" /> {/* Role */}
              <col className="w-[28%] sm:w-[18%]" /> {/* Credit Balance */}
              <col className="hidden md:table-column md:w-[18%]" /> {/* Joined */}
              <col className="w-[12%] sm:w-[10%]" /> {/* Actions */}
            </colgroup>
            <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
              <tr>
                <UsersSortHeader label="User" sortKey="name" sort={sort} onSort={handleSort} align="left" />
                <UsersSortHeader label="Role" sortKey="role" sort={sort} onSort={handleSort} align="left" className="hidden sm:table-cell" />
                <UsersSortHeader
                  // Shorter label on mobile because the column is narrow at
                  // small widths and "Credit Balance" wraps awkwardly.
                  label={<><span className="sm:hidden">Balance</span><span className="hidden sm:inline">Credit Balance</span></>}
                  sortKey="balance" sort={sort} onSort={handleSort} align="right" />
                <UsersSortHeader label="Joined" sortKey="joined" sort={sort} onSort={handleSort} align="left" className="hidden md:table-cell" />
                {/* Actions column header has no label — the 3-dot icon is
                    self-evident and a duplicate "ACTIONS" word added noise
                    especially on mobile where space is tight. */}
                <th className="px-3 lg:px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
              {visibleUsers.map((u, uIdx) => (
                <tr key={u.id || u.email || `user-${uIdx}`} className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-3 lg:px-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="block min-w-0">
                        <Tooltip content={u.name} className="max-w-full">
                          <p className="font-medium text-gray-900 dark:text-neutral-100 truncate cursor-default">{u.name}</p>
                        </Tooltip>
                      </div>
                      <div className="block min-w-0">
                        <Tooltip content={u.email} className="max-w-full">
                          <p className="text-[11px] text-gray-500 dark:text-neutral-400 truncate cursor-default">{u.email}</p>
                        </Tooltip>
                      </div>
                      {/* Inline Role chip — only on mobile, since the Role
                          column itself is hidden on small screens. Keeps the
                          role visible without forcing horizontal scroll. */}
                      <div className="sm:hidden pt-1">
                        {u.is_admin ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                            User
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 lg:px-4 py-3 hidden sm:table-cell">
                    <Tooltip content={u.is_admin ? 'Has full admin access' : 'Standard user — no admin access'}>
                      {u.is_admin ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300">
                          <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
                          User
                        </span>
                      )}
                    </Tooltip>
                  </td>
                  <td className="px-3 lg:px-4 py-3 text-right whitespace-nowrap">
                    <span className="font-medium text-gray-900 dark:text-neutral-100 tabular-nums">{u.credit_balance_display?.toFixed(2)}</span>
                    <span className="text-[11px] text-gray-500 dark:text-neutral-400 ml-1">cr</span>
                  </td>
                  <td className="px-3 lg:px-4 py-3 text-gray-500 dark:text-neutral-400 whitespace-nowrap hidden md:table-cell">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-3 lg:px-4 py-3">
                    <div className="flex items-center justify-end">
                      <Tooltip content="More actions" position="left">
                        <button
                          data-action-trigger="user-row-menu"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (menuOpenFor === u.id) { setMenuOpenFor(null); return }
                            const rect = e.currentTarget.getBoundingClientRect()
                            setMenuOpenFor(u.id)
                            setMenuPos({
                              top: rect.bottom + 4,
                              right: window.innerWidth - rect.right,
                              triggerTop: rect.top,
                            })
                          }}
                          aria-label="User actions"
                          className="w-7 h-7 inline-flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
                        >
                          <MoreVertical size={15} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && loading && (
                // Skeleton rows mirror the real row structure so the table
                // doesn't collapse to a centered spinner — feels closer to
                // populated state and avoids layout jump when data lands.
                Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    <td className="px-3 lg:px-4 py-3">
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-32 sm:w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
                        <div className="h-2.5 w-40 sm:w-56 rounded bg-neutral-200 dark:bg-neutral-700/70" />
                      </div>
                    </td>
                    <td className="px-3 lg:px-4 py-3 hidden sm:table-cell">
                      <div className="h-5 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                    </td>
                    <td className="px-3 lg:px-4 py-3 text-right">
                      <div className="h-3.5 w-16 rounded bg-neutral-200 dark:bg-neutral-700 ml-auto" />
                    </td>
                    <td className="px-3 lg:px-4 py-3 hidden md:table-cell">
                      <div className="h-3.5 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
                    </td>
                    <td className="px-3 lg:px-4 py-3">
                      <div className="h-7 w-7 rounded-md bg-neutral-200 dark:bg-neutral-700 ml-auto" />
                    </td>
                  </tr>
                ))
              )}
              {visibleUsers.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="text-center">
                    <div className="text-center py-16 text-neutral-400 dark:text-neutral-500">
                      <Users size={36} className="mx-auto mb-3 opacity-50" />
                      <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">No users found</p>
                      {search && <p className="text-xs mt-1">Try a different search term.</p>}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {usersProp && usersProp.total > 0 && (
          <Pagination
            currentPage={usersProp.page || page}
            totalPages={usersProp.total_pages || 1}
            totalItems={usersProp.total || 0}
            itemsPerPage={usersProp.limit || pageSize}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            pageSizeOptions={[10, 25, 50, 100, 200]}
            loading={loading}
          />
        )}
      </div>

      {/* Three-dot row menu — right-anchored portal, flips upward on overflow */}
      {menuOpenFor && menuPos && (() => {
        const u = usersProp?.users?.find(x => x.id === menuOpenFor)
        if (!u) return null
        const isSelf = u.id === currentUserId
        return createPortal(
          <div
            ref={menuRef}
            className="fixed w-52 rounded-lg border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999] overflow-hidden bg-white dark:bg-neutral-800"
            style={(() => {
              const menuHeight = 120
              const wouldOverflowBottom = menuPos.top + menuHeight > window.innerHeight - 8
              const top = wouldOverflowBottom ? menuPos.triggerTop - menuHeight - 4 : menuPos.top
              return {
                top: `${Math.max(8, top)}px`,
                right: `${Math.max(8, menuPos.right)}px`,
              }
            })()}
          >
            {isSelf ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-neutral-400 italic">Cannot change own role</div>
            ) : (
              <button
                onClick={() => { setMenuOpenFor(null); toggleRoleFor(u) }}
                disabled={togglingRole === u.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                <ShieldCheck size={14} />
                {u.is_admin ? 'Demote to User' : 'Promote to Admin'}
              </button>
            )}
            <button
              onClick={() => { setMenuOpenFor(null); setGrantModal({ userId: u.id, userName: u.name }) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
            >
              <Coins size={14} />
              Grant Credits
            </button>
          </div>,
          document.body
        )
      })()}

      {/* Grant Credits modal — PPM tokens, blue primary action */}
      {grantModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setGrantModal(null)}
        >
          <div
            className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl w-full max-w-sm p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-neutral-100 mb-1">Grant Credits</h3>
            <p className="text-xs text-gray-600 dark:text-neutral-400 mb-4">
              To: <strong className="text-gray-900 dark:text-neutral-100">{grantModal.userName}</strong>
            </p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setGrantAmount(prev => String(Math.max(0, (parseFloat(prev) || 0) - 10)))}
                className="p-2 rounded-xl border border-gray-200 dark:border-neutral-600 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
                aria-label="Decrease by 10"
              >
                <Minus className="w-4 h-4 text-gray-700 dark:text-neutral-300" />
              </button>
              <input
                type="number"
                placeholder="Credits amount"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm leading-5 text-center font-mono bg-gray-50 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-xl focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors text-gray-900 dark:text-neutral-100"
              />
              <button
                onClick={() => setGrantAmount(prev => String((parseFloat(prev) || 0) + 10))}
                className="p-2 rounded-xl border border-gray-200 dark:border-neutral-600 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
                aria-label="Increase by 10"
              >
                <Plus className="w-4 h-4 text-gray-700 dark:text-neutral-300" />
              </button>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button
                onClick={() => setGrantModal(null)}
                className="flex-1 px-4 py-1.5 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGrant}
                disabled={!grantAmount || granting}
                className="flex-1 px-4 py-1.5 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
              >
                {granting ? 'Granting...' : 'Grant Credits'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ────────────────────────────────────────
// Tab 5: Docs
// ────────────────────────────────────────

function DocsTab() {
  // Each section is now ONE self-contained card with the heading rendered
  // INSIDE at the top followed by a divider — matches the Dashboard /
  // Credit Economics card pattern. Previously the heading floated outside
  // the card making the page feel like loose tiles.
  const sectionCardClass = 'mb-4 sm:mb-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm overflow-hidden'
  const sectionHeaderClass = 'flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-700/30'
  const sectionTitleClass = 'text-sm font-semibold text-gray-900 dark:text-neutral-100'
  const bodyClass = 'p-4 sm:p-5 text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed space-y-3'
  const subHeadClass = 'font-semibold text-neutral-800 dark:text-neutral-200 text-xs sm:text-sm mt-4 mb-1'
  // Tables match Dashboard table pattern — flat edges (no rounded), outer
  // border on the wrapper, sticky-style header bg, divide-y rows. Same
  // visual language as the Workflows / Users / Pricing Plans tables.
  const tableWrapClass = 'mt-2 overflow-x-auto border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800'
  const tableClass = 'min-w-full text-xs sm:text-[13px] divide-y divide-gray-200 dark:divide-neutral-700'
  const theadClass = 'bg-gray-50 dark:bg-neutral-700'
  const thClass = 'text-left px-3 py-2 font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap'
  const tbodyClass = 'divide-y divide-gray-200 dark:divide-neutral-700'
  const trClass = 'hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors'
  const tdClass = 'px-3 py-2 text-neutral-600 dark:text-neutral-400'
  const codeClass = 'font-mono bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-1.5 py-0.5 rounded text-[11px]'

  // Quick-links target the same admin tabs the user is already in. We don't
  // hardcode labels — pull from the TABS constant so renames stay in sync.
  // 'docs' itself is excluded since linking from Docs to Docs is noise.
  const quickLinks = [
    { id: 'analytics', desc: 'Usage trends, transaction log, platform credit flow.' },
    { id: 'providers', desc: 'Active models, platform keys, custom provider config.' },
    { id: 'economics', desc: 'Edit margin, credits-per-dollar, and per-model rates.' },
    { id: 'plans', desc: 'Create and edit credit packages users can purchase.' },
    { id: 'users', desc: 'Search users, view balances, grant credits, toggle role.' },
  ]
  return (
    <div>
      {/* Intro — plain heading + lead paragraph, no card chrome */}
      <div className="mb-4 sm:mb-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 mb-1">Operator Reference</h2>
        <p className="text-xs sm:text-[13px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
          How providers, pricing, and credits work. For live data (active models, current rates, transactions),
          see the other admin tabs — this page only contains evergreen concepts.
        </p>
      </div>

      {/* ── Section 1: Providers & Key Resolution ── */}
      <div className={sectionCardClass}>
        <div className={sectionHeaderClass}>
          <Cpu className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <h2 className={sectionTitleClass}>Providers &amp; Key Resolution</h2>
        </div>
        <div className={bodyClass}>
            <p>
              The platform supports six provider integrations:{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">Anthropic</strong>,{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">OpenAI</strong>,{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">Google</strong>,{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">xAI</strong>,{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">OpenRouter</strong>, and{' '}
              <strong className="text-neutral-800 dark:text-neutral-200">custom OpenAI-compatible</strong> endpoints
              (Friendli, Together, Groq, Ollama, LM Studio, DeepSeek). Provider is auto-detected from the model
              identifier; custom providers configure <span className={codeClass}>base_url</span> and{' '}
              <span className={codeClass}>auth_header_prefix</span>.
            </p>

            <p className={subHeadClass}>BYOK vs Platform</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/30">
                <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">BYOK</p>
                <p className="text-neutral-500 dark:text-neutral-400">User's own key from Settings. No credits deducted. Usage logged for analytics only.</p>
              </div>
              <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/30">
                <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Platform</p>
                <p className="text-neutral-500 dark:text-neutral-400">Admin-configured key. Credits deducted per call. The flag <span className={codeClass}>use_pabbly_default</span> on each agent decides which key path applies.</p>
              </div>
            </div>

            <p className={subHeadClass}>Tool calling</p>
            <p>
              Chat uses <strong className="text-neutral-800 dark:text-neutral-200">native function calling</strong> —
              providers return structured tool-call objects (Anthropic <span className={codeClass}>tool_use</span>,
              OpenAI <span className={codeClass}>tool_calls</span>, Google <span className={codeClass}>functionCall</span>).
              No text parsing. The agentic loop runs up to 25 iterations per request with mid-loop balance checks.
              Deployed JS inside Pabbly Functions still uses text-fence tool calling — that's a deferred migration.
            </p>

            <p className="mt-3 text-neutral-500 dark:text-neutral-500">
              The live list of active models lives in the <strong className="text-neutral-700 dark:text-neutral-300">Providers &amp; Models</strong> tab.
              Disabled models are hidden from the workflow builder.
            </p>
        </div>
      </div>

      {/* ── Section 2: Token Cost Model ── */}
      <div className={sectionCardClass}>
        <div className={sectionHeaderClass}>
          <BarChart3 className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <h2 className={sectionTitleClass}>Token Cost Model</h2>
        </div>
        <div className={bodyClass}>
            <p>
              Providers charge per token (~4 chars). Each API response returns counts split into four categories
              that the platform tracks for accurate billing.
            </p>

            <p className={subHeadClass}>Token types</p>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Token Type</th>
                    <th className={thClass}>What it is</th>
                    <th className={thClass}>Typical cost</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {[
                    ['Input', 'System prompt + history + user message', 'Low'],
                    ['Output', 'Text generated by the model', 'High (3–5× input)'],
                    ['Cache read', 'Re-read from prompt cache (Anthropic / OpenAI)', 'Very low (~10% of input)'],
                    ['Cache write', 'First write into prompt cache (Anthropic only)', 'Slightly above input'],
                  ].map(([type, desc, cost]) => (
                    <tr key={type} className={trClass}>
                      <td className={tdClass}><span className="font-medium text-neutral-700 dark:text-neutral-300">{type}</span></td>
                      <td className={tdClass}>{desc}</td>
                      <td className={tdClass + ' whitespace-nowrap'}>{cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={subHeadClass}>Cost formula</p>
            <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 space-y-1">
              <p>raw_sum = input_tokens × input_rate</p>
              <p className="pl-10">+ output_tokens × output_rate</p>
              <p className="pl-10">+ cache_read_tokens × cache_read_rate</p>
              <p className="pl-10">+ cache_write_tokens × cache_write_rate</p>
              <p className="mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-600">
                cost_milli = ⌈ raw_sum × margin × credits_per_dollar ÷ 1,000,000,000 ⌉
              </p>
              <p className="text-neutral-500 text-[10px] mt-1">
                Rates are micro-dollars/Mtok. Result is milli-credits (1 credit = 1,000 milli-credits).
              </p>
            </div>

            <p className="mt-3 text-neutral-500 dark:text-neutral-500">
              Margin multiplier and credits-per-dollar are tunable from the{' '}
              <strong className="text-neutral-700 dark:text-neutral-300">Credit Economics</strong> tab.
              Per-model rates are seeded from the <span className="font-mono">credit_pricing</span> collection at startup.
            </p>
        </div>
      </div>

      {/* ── Section 3: Credit Lifecycle ── */}
      <div className={sectionCardClass}>
        <div className={sectionHeaderClass}>
          <Coins className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <h2 className={sectionTitleClass}>Credit Lifecycle</h2>
        </div>
        <div className={bodyClass}>
            <p>
              Credits are the internal currency users spend. Stored in milli-credits internally
              (1 credit = 1,000 milli-credits). Single source of truth: the{' '}
              <span className={codeClass}>credit_balances</span> collection — there is no cached balance
              on the <span className={codeClass}>users</span> document.
            </p>

            <p className={subHeadClass}>How credits enter the system</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Signup bonus</p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  Every new user receives <strong className="text-neutral-700 dark:text-neutral-300">50 free credits</strong> automatically — granted in <span className={codeClass}>handlers/auth.rs::grant_signup_bonus</span> on first-time SSO signup.
                </p>
              </div>
              <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Pabbly Subscription Billing</p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  Purchases route through Pabbly. The <span className={codeClass}>invoice_paid</span> webhook matches the plan against{' '}
                  <span className={codeClass}>credit_packages</span> by <span className={codeClass}>pabbly_plan_id</span> and grants from
                  the plan's <span className={codeClass}>meta_data.paa_credits</span> (webhook metadata is the source of truth).
                  Manage packages from the <strong className="text-neutral-700 dark:text-neutral-300">Pricing Plans</strong> tab.
                </p>
              </div>
            </div>
            <p className="mt-2 text-neutral-500">
              Admins can also manually grant credits to any user from the <strong className="text-neutral-700 dark:text-neutral-300">Users &amp; Usage</strong> tab.
              Unknown emails are queued in <span className={codeClass}>pending_credits</span> and drained on signup.
            </p>

            <p className={subHeadClass}>Deduction flow</p>
            <div className="flex flex-col gap-0 mt-1">
              {[
                { icon: Zap, label: 'User sends message or workflow step runs' },
                { icon: Key, label: 'Resolve key: BYOK → custom → platform (use_pabbly_default decides path)' },
                { icon: Server, label: 'BYOK = no deduction. Platform = pre-flight balance check (returns 402 if insufficient)' },
                { icon: Cpu, label: 'Call provider; capture token counts (input, output, cache read/write)' },
                { icon: DollarSign, label: 'Compute raw cost from rates × margin × credits_per_dollar' },
                { icon: Database, label: 'Atomic findOneAndUpdate with $gte balance guard on credit_balances (prevents race + negative)' },
                { icon: Lock, label: 'Append a credit_transactions row with source tag (chat / test / run) and the new balance' },
              ].map(({ icon: Icon, label }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
                    </div>
                    {i < 6 && <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />}
                  </div>
                  <p className="pt-1.5 pb-2">{label}</p>
                </div>
              ))}
            </div>

            <p className={subHeadClass}>Margin reference</p>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Multiplier</th>
                    <th className={thClass}>Profit margin</th>
                    <th className={thClass}>$0.0547 raw → user pays</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {[
                    ['1.0', '0%', '$0.0547'],
                    ['1.25', '20%', '$0.0684'],
                    ['1.5', '33%', '$0.0821'],
                    ['2.0', '50%', '$0.1094'],
                    ['3.0', '67%', '$0.1641'],
                  ].map(([mult, margin, ex]) => (
                    <tr key={mult} className={trClass}>
                      <td className={tdClass}><span className={codeClass}>{mult}x</span></td>
                      <td className={tdClass + ' whitespace-nowrap'}>{margin}</td>
                      <td className={tdClass + ' whitespace-nowrap'}>{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-neutral-500">
              The current value lives in <span className={codeClass}>admin_settings</span> — edit it from the{' '}
              <strong className="text-neutral-700 dark:text-neutral-300">Credit Economics</strong> tab. No server restart required.
            </p>
        </div>
      </div>

      {/* ── Section 4: Safety & Atomicity ── */}
      <div className={sectionCardClass}>
        <div className={sectionHeaderClass}>
          <ShieldCheck className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <h2 className={sectionTitleClass}>Safety &amp; Atomicity</h2>
        </div>
        <div className="divide-y divide-neutral-200 dark:divide-neutral-700 text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {[
            ['Race conditions prevented', 'Atomic findOneAndUpdate on credit_balances with $gte balance guard. Only one concurrent deduction succeeds; negative balances are impossible. Failed deductions zero out residuals.'],
            ['Pabbly webhook idempotency', 'Unique index on pending_credits.invoice_id and credit_transactions.stripe_payment_id. Retried invoice_paid webhooks fail the duplicate insert silently — no double credit.'],
            ['Signed callbacks for deployed runs', 'Pabbly Functions VMs post step_started / step_finished / run_finished callbacks signed with HMAC-SHA256. The backend rejects callbacks with invalid tokens.'],
            ['Encrypted credentials', 'BYOK API keys and agent_memory secrets are AES-256-GCM encrypted at rest. ENCRYPTION_KEY rotation invalidates all stored values.'],
            ['Platform key isolation', 'Platform keys live server-side in admin_settings (custom) or env vars. Users never see which provider/model is used by the platform — error messages are sanitized via sanitize_platform_error().'],
          ].map(([title, desc], i) => (
            <div key={title} className="flex items-start gap-3 px-4 sm:px-5 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/30 transition-colors">
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-neutral-800 dark:text-neutral-200 mb-0.5">{title}</p>
                <p className="text-neutral-500 dark:text-neutral-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 5: Quick Links ── */}
      <div className={sectionCardClass}>
        <div className={sectionHeaderClass}>
          <ExternalLink className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          <h2 className={sectionTitleClass}>Live Data &amp; Quick Links</h2>
        </div>
        <div className={bodyClass}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {quickLinks.map(({ id, desc }) => {
              const tab = TABS.find(t => t.id === id)
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Link
                  key={id}
                  to={`/admin/${id}`}
                  className="group flex items-start gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-700/30 hover:bg-blue-50/50 dark:hover:bg-neutral-700/60 hover:border-blue-200 dark:hover:border-neutral-600 transition-colors no-underline"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 flex-shrink-0 group-hover:bg-blue-100 dark:group-hover:bg-neutral-600">
                    <Icon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-0.5">{tab.label}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-snug">{desc}</p>
                  </div>
                </Link>
              )
            })}
          </div>
          <p className="mt-3 text-neutral-500 dark:text-neutral-400">
            For deep architecture, see <span className={codeClass}>docs/</span> in the repository — particularly{' '}
            <span className={codeClass}>02-architecture.md</span>, <span className={codeClass}>11-agent-execution.md</span>,
            and <span className={codeClass}>12-pabbly-functions.md</span>.
          </p>
        </div>
      </div>
    </div>
  )
}
