import { useState } from 'react'
import { Users, Coins, Zap, TrendingUp, DollarSign, Wallet, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminAPI } from '../../services/api'
import Tooltip from '../../components/ui/Tooltip'

// Single accent rule (mirrors AdminAnalytics) — emerald = positive (money in,
// profit), red = cost (operator's API spend), neutral default for everything
// else. Tinted card backgrounds removed: card chrome stays white/neutral-800
// and only the value text gets the accent color.
const ACCENT = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  neutral: 'text-gray-900 dark:text-neutral-100',
}

function Skel({ className = '', style }) {
  return <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} style={style} />
}

function MetricCard({ icon: Icon, label, value, sub, accent = 'neutral', tip, loading = false }) {
  const colorCls = ACCENT[accent] || ACCENT.neutral
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

// Reusable input + Save button row. Guidance moved off-canvas into a hover
// tooltip on the label + a native `title` on the input — keeps the inline
// row uncluttered while still surfacing the recommended range when the
// admin actually needs it. Mobile-stacks so input + button don't collide.
function NumericSetting({ label, tooltip, placeholder, step, min, value, onChange, onSave, saving, saveLabel }) {
  const labelEl = tooltip ? (
    <Tooltip content={tooltip}>
      <label className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1 block cursor-help">{label}</label>
    </Tooltip>
  ) : (
    <label className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1 block">{label}</label>
  )
  return (
    <div className="pt-2 border-t border-neutral-100 dark:border-neutral-700">
      {labelEl}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <input
          type="number"
          step={step}
          min={min}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full sm:w-32 px-3 py-1.5 text-xs leading-5 font-mono bg-gray-50 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-xl focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500 transition-colors text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500"
        />
        <button
          onClick={onSave}
          disabled={!value || saving}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-30 transition-colors w-full sm:w-auto"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving...' : saveLabel}
        </button>
      </div>
    </div>
  )
}

export default function AdminEconomics({ stats, onRefresh }) {
  const [marginInput, setMarginInput] = useState('')
  const [savingMargin, setSavingMargin] = useState(false)
  const [cpdInput, setCpdInput] = useState('')
  const [savingCpd, setSavingCpd] = useState(false)

  const saveMargin = async () => {
    const val = parseFloat(marginInput)
    if (isNaN(val) || val < 1) { toast.error('Margin must be at least 1.0'); return }
    setSavingMargin(true)
    try {
      await adminAPI.updateMargin(val)
      toast.success(`Margin updated to ${val}x (${((val - 1) / val * 100).toFixed(0)}% profit)`)
      setMarginInput('')
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update margin')
    } finally { setSavingMargin(false) }
  }

  const saveCreditsPerDollar = async () => {
    const val = parseFloat(cpdInput)
    if (isNaN(val) || val < 1) { toast.error('Credits per dollar must be at least 1.0'); return }
    setSavingCpd(true)
    try {
      await adminAPI.updateCreditsPerDollar(val)
      toast.success(`Credits per dollar updated to ${val} ($1 = ${val} credits)`)
      setCpdInput('')
      onRefresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update')
    } finally { setSavingCpd(false) }
  }

  const loading = !stats
  const fmtCr = (v) => (v || 0) >= 10 ? Math.round(v).toLocaleString() : (v || 0).toFixed(2)
  const fmtDlr = (v) => `$${(v || 0) >= 10 ? Math.round(v).toLocaleString() : (v || 0).toFixed(2)}`
  const profitPct = stats ? ((stats.margin_multiplier - 1) / stats.margin_multiplier * 100).toFixed(0) : '—'
  const margin = stats?.margin_multiplier || 0
  const cpd = stats?.credits_per_dollar || 20

  return (
    <div className="space-y-6">
      {/* Overview — uniform white metric cards. Accent applied only to the
          value text (emerald for money in / profit, red for cost). Tinted
          backgrounds removed per the "neutral default" color rule. */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 mb-3">Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard
            icon={Users}
            label="Total Users"
            loading={loading}
            value={stats?.total_users?.toLocaleString() || 0}
            sub="across the platform"
            tip="Total registered users on the platform (lifetime count)."
          />
          <MetricCard
            icon={Coins}
            label="Total Purchased"
            loading={loading}
            accent="positive"
            value={fmtCr(stats?.total_purchased_credits)}
            sub={`${fmtDlr(stats?.total_purchased_dollars || 0)} revenue`}
            tip="All-time credits purchased by users via Pabbly Subscription Billing. Money in."
          />
          <MetricCard
            icon={Zap}
            label="Total Used"
            loading={loading}
            value={fmtCr(stats?.total_used_credits)}
            sub={`${fmtDlr(stats?.total_used_dollars || 0)} consumed`}
            tip="All-time credits deducted (platform-key calls only — BYOK excluded)."
          />
          <MetricCard
            icon={DollarSign}
            label="Raw API Cost"
            loading={loading}
            accent="negative"
            value={fmtCr(stats?.raw_cost_credits)}
            sub={`${fmtDlr(stats?.raw_cost_dollars || 0)} actual`}
            tip="What the platform paid LLM providers, before applying margin. Operator's true cost."
          />
          <MetricCard
            icon={TrendingUp}
            label="Your Profit"
            loading={loading}
            accent="positive"
            value={fmtCr(stats?.total_profit_credits)}
            sub={loading ? null : `${fmtDlr(stats?.total_profit_dollars || 0)} earned · ${profitPct}% margin`}
            tip="Lifetime profit = Used − Raw API cost. The margin multiplier converts API cost into user spend."
          />
          <MetricCard
            icon={Wallet}
            label="Remaining Balance"
            loading={loading}
            value={fmtCr(stats?.total_balance_credits)}
            sub={`${fmtDlr(stats?.total_balance_dollars || 0)} across users`}
            tip="Sum of unspent credits across all user balances right now."
          />
        </div>
      </div>

      {/* Profit Margin */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Profit Margin</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">Controls how much users pay above your actual API cost</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          {/* Current value + concrete example. Dropped the "Profit: X% —
              Formula: user_cost = api_cost × N" sub-line — that info already
              lives in the Profit metric card above + the example below makes
              the formula visible without prose. */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Current Multiplier</p>
              {loading
                ? <Skel className="h-7 w-20" />
                : <p className="text-2xl font-bold text-gray-900 dark:text-neutral-100">{margin}x</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Example (Opus $0.05 call)</p>
              {loading ? (
                <Skel className="h-4 w-48" />
              ) : (
                <p className="text-sm">
                  <span className="text-gray-700 dark:text-neutral-300">User pays </span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-neutral-100">${(0.05 * margin).toFixed(2)}</span>
                  <span className="text-gray-700 dark:text-neutral-300"> &mdash; you keep </span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">${(0.05 * margin - 0.05).toFixed(2)}</span>
                </p>
              )}
            </div>
          </div>

          <NumericSetting
            label="New Multiplier"
            tooltip="Multiplier on top of raw API cost. 1.0 = pass-through (no profit). Typical range 1.5–3.0 for a sustainable margin."
            placeholder={loading ? '—' : String(margin)}
            step="0.1"
            min="1"
            value={marginInput}
            onChange={setMarginInput}
            onSave={saveMargin}
            saving={savingMargin}
            saveLabel="Update Margin"
          />
        </div>
      </div>

      {/* Credits Per Dollar */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Credits Per Dollar</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">Controls how many credits $1 buys. Affects package sizes and cost display.</p>
        </div>
        <div className="px-4 py-4 space-y-4">
          {/* Current rate only. Dropped the "$5 = X / $20 = Y / $50 = Z"
              breakdown — the math is obvious from "$1 = N credits" and the
              line was redundant noise. */}
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-600 dark:text-neutral-400 mb-1">Current Rate</p>
            {loading
              ? <Skel className="h-7 w-40" />
              : <p className="text-2xl font-bold text-gray-900 dark:text-neutral-100">$1 = {cpd} credits</p>}
          </div>

          <NumericSetting
            label="New Value"
            tooltip="Credits granted per US dollar. Higher = users get more credits per $. Affects every package size shown on the Credits page."
            placeholder={loading ? '—' : String(cpd)}
            step="1"
            min="1"
            value={cpdInput}
            onChange={setCpdInput}
            onSave={saveCreditsPerDollar}
            saving={savingCpd}
            saveLabel="Update Rate"
          />
        </div>
      </div>
    </div>
  )
}
