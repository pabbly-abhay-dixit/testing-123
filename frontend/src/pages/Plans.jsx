import { useEffect, useRef, useState } from 'react'
import { Check, X, Workflow, Cpu, Users, CalendarClock } from 'lucide-react'
import { subscriptionsAPI, schedulesAPI } from '../services/api'
import { useEntitlements } from '../context/EntitlementsContext'
import PlanPricingCards from '../components/plans/PlanPricingCards'
import Tooltip from '../components/ui/Tooltip'
import toast from 'react-hot-toast'

// All subscription management — pricing, checkout, cancel, invoices — lives
// on Pabbly Subscription Billing. The auto-login link is in the topbar
// profile dropdown (TopBar.jsx → "My Subscription") matching PabblyConnect's
// nav placement. This page just shows the user's current entitlements +
// usage meters. Visual tokens match Dashboard.jsx (neutral-50 bg, white
// cards w/ rounded-xl + shadow-sm, blue-600 primary).

// Uniform row inside the "Combined entitlements & usage" table-style list.
// Every row shares the same 3-column structure (label | value | bar/status)
// so they read as one consistent unit instead of a mix of progress bars and
// status pills. Theme: only black/blue for the bar fill; red/amber are
// retained ONLY as functional warnings at 70%/90% usage thresholds.
// Each entitlement renders as its own self-contained tile in a 2×2 grid
// — same pattern Vercel / AWS / Linear use for usage dashboards. The
// label gets an Info icon next to it; hover/tap reveals a custom
// tooltip explaining the term in plain English. This way the hint copy
// is hidden by default (compact, scannable) but always one hover away.
//
// Layout inside a tile:
//   LABEL (i)                                    [big value]
//   [progress bar]                                or [status pill]
// Stat card — mirrors the Admin Analytics MetricCard pattern
// (icon + label header, big bold value). Same chrome runs on Plan /
// AI Credits / BYOK / Analytics so the four surfaces read as one
// design family. Each tooltip wraps ONLY the visible text so the
// arrow tracker points at the words, not surrounding chrome.
function EntitlementTile({ label, used, max, labelTooltip, valueTooltip, status, icon: Icon }) {
  const isUnlimited = max === -1
  const isStatus = status !== undefined
  const bigValue = isStatus
    ? (status ? 'Included' : 'Off')
    : `${used.toLocaleString()} / ${isUnlimited ? '∞' : max.toLocaleString()}`

  const labelText = labelTooltip ? (
    <Tooltip content={labelTooltip} position="top" maxWidth={200}>
      <span className="cursor-help">{label}</span>
    </Tooltip>
  ) : (
    <span>{label}</span>
  )
  const valueText = valueTooltip ? (
    <Tooltip content={valueTooltip} position="top" maxWidth={200}>
      <span className="cursor-help">{bigValue}</span>
    </Tooltip>
  ) : (
    <span>{bigValue}</span>
  )

  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm w-full h-full">
      <div className="flex items-center gap-2 mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
        {Icon && <Icon size={14} className="text-neutral-400 flex-shrink-0" />}
        {labelText}
      </div>
      <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums break-words">
        {valueText}
      </p>
    </div>
  )
}

// Skeleton silhouette that mirrors the post-load layout so users see the
// page outline instead of a stranded "Loading…" line. Same approach as
// Credits.jsx + Usage.jsx (Token Usage tab) skeletons.
function Sk({ className = '', style }) {
  return <div className={`animate-pulse bg-gray-200 dark:bg-neutral-700 rounded ${className}`} style={style} />
}

function PlansSkeleton() {
  return (
    <>
      {/* Current Plan card silhouette */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-3 sm:mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="space-y-2">
            <Sk className="h-3 w-24" />
            <Sk className="h-6 w-32" />
          </div>
          <Sk className="h-7 w-24 !rounded-full" />
        </div>
        <div className="flex gap-2 mb-4">
          <Sk className="h-6 w-28 !rounded-full" />
        </div>
        <div className="border-t border-gray-100 dark:border-neutral-700 pt-3">
          <Sk className="h-3 w-44 mb-3" />
          {/* Stat-card silhouette mirroring the post-load
              EntitlementTile (fixed-width auto-fill grid). */}
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3 w-full">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
                <Sk className="h-3 w-20" />
                <Sk className="h-7 w-28 mt-1" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section heading */}
      <Sk className="h-5 w-32 mb-5 mt-4" />

      {/* Billing-cycle pill selector silhouette */}
      <div className="inline-flex items-center gap-1 p-1 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 mb-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Sk key={i} className="h-7 w-24 !rounded-full" />
        ))}
      </div>

      {/* 3-card grid silhouette — matches the compact default
          PlanPricingCards layout (icon · name · tagline · price · CTA).
          Feature list lives behind a "View details" toggle so it's
          not part of the initial load silhouette. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-2xl p-5 shadow-sm flex flex-col"
          >
            <Sk className="h-10 w-10 !rounded-xl mb-3" />
            <Sk className="h-5 w-24 mb-1" />
            <Sk className="h-3 w-32 mb-3" />
            <Sk className="h-8 w-28 mb-1" />
            <Sk className="h-3 w-36 mb-4" />
            <Sk className="h-10 w-full !rounded-xl mt-auto" />
          </div>
        ))}
      </div>
      {/* "View details" toggle placeholder */}
      <div className="flex justify-center mb-8">
        <Sk className="h-4 w-32" />
      </div>
    </>
  )
}

// `+N more` chip with click-to-toggle popover. Replaces the prior
// hover-only Tooltip so mobile users can also reach the list of
// additional stacked plans (no hover on touch devices). Behavior:
// - Click toggles the popover open/close
// - Outside-click or Esc closes
// - Anchored absolutely below the chip; uses tierDotColor for each row
function RestPlansChip({ rest, restCount, tierDotColor }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Show ${restCount} additional ${restCount === 1 ? 'plan' : 'plans'}`}
        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full cursor-pointer bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-neutral-700/60 dark:text-neutral-200 dark:ring-neutral-600 hover:bg-gray-200 dark:hover:bg-neutral-600/60 transition-colors"
      >
        +{restCount}
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute z-50 top-full left-0 mt-1.5 min-w-[200px] max-w-[280px] rounded-lg bg-neutral-900 dark:bg-neutral-800 border border-neutral-700 dark:border-neutral-600 shadow-xl py-2 px-2.5"
        >
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium mb-1.5 px-0.5">
            Also active
          </div>
          <div className="flex flex-col gap-1.5 text-left">
            {rest.map((p) => (
              <div key={p.key} className="flex items-center gap-2 whitespace-nowrap text-[11px] text-white">
                <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${tierDotColor(p.tier)}`} />
                <span>{p.label}{p.quantity > 1 ? ` × ${p.quantity}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// `embedded=true` skips the outer page chrome (background wrapper + own
// header) so this component can be rendered as a tab inside Usage.jsx,
// which already provides the "Plans & Usage" title.
export default function Plans({ embedded = false }) {
  // Read from EntitlementsContext — same /api/me/subscription call already
  // fired once at app boot. This component used to do its own fetch on mount
  // which doubled the network cost (and round-trip latency) whenever the
  // user opened the Plan tab. Falls back to a one-time fetch only when the
  // context was never primed (e.g. someone deep-links to /usage/plan with
  // a stale session and the auth-bootstrap hasn't yet enabled the provider).
  const { loaded: ctxLoaded, effective, subscriptions, refresh } = useEntitlements()
  const [me, setMe] = useState(null)
  const [fallbackLoading, setFallbackLoading] = useState(false)
  // Count of active schedules — fetched separately because the
  // entitlements payload only carries the boolean `schedulers_enabled`
  // flag. One schedule attaches to one workflow, so the ceiling is the
  // user's workflow limit (rendered as `schedulesCount / workflows_max`).
  const [schedulesCount, setSchedulesCount] = useState(null)

  // Build the same { effective, subscriptions } shape the old getMine() returned
  // so the render block below doesn't have to change.
  const ctxMe = effective ? { effective, subscriptions } : null

  useEffect(() => {
    if (ctxLoaded) {
      setMe(null) // clear any prior fallback state once context has data
      return
    }
    // Context hasn't loaded yet — fire a direct fetch as a one-time fallback.
    let cancelled = false
    setFallbackLoading(true)
    subscriptionsAPI.getMine()
      .then(({ data }) => { if (!cancelled) setMe(data) })
      .catch((e) => {
        if (!cancelled) toast.error(e?.response?.data?.error || 'Failed to load plan')
      })
      .finally(() => { if (!cancelled) setFallbackLoading(false) })
    return () => { cancelled = true }
  }, [ctxLoaded])

  // Fetch the number of active schedules the user has set up. The
  // entitlements payload only ships a boolean (`schedulers_enabled`),
  // so we hit /api/schedules?limit=1 once and read the `total` field
  // — gives us "X of your N workflows have a schedule" without
  // dragging the full schedule list. Silent on failure (count stays
  // null, tile falls back to boolean "Included" mode).
  useEffect(() => {
    let cancelled = false
    schedulesAPI.list({ limit: 1 })
      .then(({ data }) => {
        if (cancelled) return
        const total = data?.total ?? data?.pagination?.total ?? (Array.isArray(data?.schedules) ? data.schedules.length : 0)
        setSchedulesCount(typeof total === 'number' ? total : 0)
      })
      .catch(() => { /* leave null — tile falls back to boolean mode */ })
    return () => { cancelled = true }
  }, [])

  const data = ctxMe || me
  const loading = !data && (fallbackLoading || !ctxLoaded)
  // Silence unused-import lint when refresh isn't consumed yet — kept on the
  // hook return so future "manual refresh" UI can wire it in without diff churn.
  void refresh

  // Group active subs by plan (pabbly_plan_id uniquely identifies tier + billing
  // cycle, so two "Premium 3-Yearly" rows get merged into one "× 2" pill while
  // a "Premium 1-Yearly" row sitting next to them stays distinct). PSB stacking
  // sends multiple rows of the same plan as separate documents — sum each row's
  // `quantity` (defaults to 1) so seat-bundle plans count correctly. Free rows
  // are kept so a Free user still sees their plan listed instead of an empty
  // strip. Falls back to `label`-only grouping for the rare row that's missing
  // a plan_id (legacy / Enterprise rows).
  const groupedPlans = (() => {
    if (!data?.subscriptions?.length) return []
    const map = new Map()
    for (const s of data.subscriptions) {
      if (s.status && s.status !== 'active') continue
      const key = s.pabbly_plan_id || `label:${s.label || s.tier}`
      const qty = Math.max(1, Number(s.quantity) || 1)
      const existing = map.get(key)
      if (existing) {
        existing.quantity += qty
      } else {
        // Prefer the server-derived display_label (includes the billing cycle
        // so "Premium 3-Yearly" doesn't collapse against "Premium Yearly" of
        // the same tier). Falls back to bare label for clients hitting an old
        // backend that hasn't shipped display_label yet. `Subscription.label`
        // is non-optional on the Rust side so the second branch is the real
        // floor — no need for a tier-cap fallback.
        map.set(key, {
          key,
          label: s.display_label || s.label,
          tier: s.tier || 'free',
          quantity: qty,
        })
      }
    }
    // Sort: highest tier first, then longest billing cycle within that
    // tier (3-Yearly > 2-Yearly > Yearly > Monthly), then alpha as a
    // stable tiebreak. So `groupedPlans[0]` is THE most-premium plan
    // the user owns — that's the one we surface as the primary chip;
    // everything else collapses into the `+N` notification badge.
    const tierRank = { enterprise: 4, premium: 3, standard: 2, free: 1 }
    const cycleRank = (label) => {
      const l = (label || '').toLowerCase()
      if (l.includes('3-year') || l.includes('3 year') || l.includes('3-yearly') || l.includes('3 yearly')) return 4
      if (l.includes('2-year') || l.includes('2 year') || l.includes('2-yearly') || l.includes('2 yearly')) return 3
      if (l.includes('year')) return 2
      if (l.includes('month')) return 1
      return 0
    }
    return Array.from(map.values()).sort((a, b) => {
      const ra = tierRank[a.tier] ?? 0
      const rb = tierRank[b.tier] ?? 0
      if (ra !== rb) return rb - ra
      const ca = cycleRank(a.label)
      const cb = cycleRank(b.label)
      if (ca !== cb) return cb - ca
      return a.label.localeCompare(b.label)
    })
  })()

  // Tier → chip style on the blue + white + gray theme (no purple,
  // no black). Tier hierarchy reads through blue intensity: premium
  // = saturated blue tone, enterprise = mid blue, standard = light
  // blue, free = neutral gray.
  const tierChipStyle = (tier) => {
    switch (tier) {
      case 'premium':
        return 'bg-blue-600 text-white ring-1 ring-blue-700 dark:bg-blue-500 dark:text-white dark:ring-blue-400'
      case 'enterprise':
        return 'bg-blue-100 text-blue-800 ring-1 ring-blue-300 dark:bg-blue-900/50 dark:text-blue-100 dark:ring-blue-600'
      case 'standard':
        return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-700/40'
      case 'free':
      default:
        return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-neutral-700/60 dark:text-neutral-300 dark:ring-neutral-600'
    }
  }
  const tierDotColor = (tier) => {
    switch (tier) {
      case 'premium': return 'bg-white dark:bg-blue-100'
      case 'enterprise': return 'bg-blue-600'
      case 'standard': return 'bg-blue-500'
      case 'free':
      default: return 'bg-gray-400 dark:bg-neutral-500'
    }
  }
  const totalActivePlans = groupedPlans.reduce((sum, p) => sum + p.quantity, 0)

  const content = (
    <>
      {!embedded && (
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100">
              My Plan
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-neutral-400 mt-0.5 sm:mt-1">
              Your current entitlements and usage. Manage subscription, billing, and invoices on Pabbly.
            </p>
          </div>
        </div>
      )}
      {/* Embedded mode (inside the Usage tab strip) intentionally has no
          sub-header here — the page-level "Plans & Usage" + the tab name
          already orient the user, and the Current Plan card immediately
          below is self-explanatory. The previous paragraph repeated the
          "Manage via My Subscription" link that the pricing footer also
          carries — one mention per page is enough. */}

      {loading && <PlansSkeleton />}

        {!loading && data && (
          <>
            {/* Current plan + usage card. Headline is the highest-rank tier
                across stacked subs (so a Premium + Standard user reads as
                "Premium"); the strip below lists every active plan by its
                exact PSB label (e.g. "Premium 3-Yearly Plan × 2") so users
                can see what they actually own at-a-glance — important
                because PSB allows stacking multiple cycles of the same
                tier and aggregating those into one "Premium" line would
                hide the renewal context the user came here to check. */}
            <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5 mb-3 sm:mb-4">
              {/* Headline block — two-row hierarchy. Tooltips trigger
                  off the text itself (no visible Info icons) — matches
                  the project's tooltip pattern (Dashboard, Usage page,
                  ChatPanel etc.). `cursor-help` is the only visual cue
                  that hovering reveals more info. */}
              <div className="mb-3">
                {/* Row 1: label only, no orphan badge on the right —
                    the `+N` notification badge on row 2 already
                    surfaces the active-plan count. */}
                <Tooltip content="Your active subscription." maxWidth={200}>
                  <span className="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-neutral-400 cursor-help inline-block mb-1.5">
                    Current plan
                  </span>
                </Tooltip>
                {/* Row 2: tier headline + PRIMARY chip + optional
                    `+N more` notification-style badge. Listing every
                    chip inline got noisy when the user had many
                    stacked subs (Premium 2-Yearly + 3-Yearly + Yearly
                    ×4 etc); collapsing the tail into a `+N` pill is
                    the same pattern notification UIs use. Full list
                    lives in the +N pill's tooltip. */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  {(() => {
                    // Strip the trailing " + N more" suffix from the
                    // backend-computed display_label so the headline
                    // reads just the tier name (e.g. "Premium"). The
                    // primary chip + `+N` badge to the right already
                    // surface the exact plans and the stacked count.
                    const cleanLabel = String(data.effective.display_label || '')
                      .replace(/\s*\+\s*\d+\s*more\s*$/i, '')
                      .trim()
                    return (
                      <Tooltip content="Your plan tier." maxWidth={200}>
                        <span className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-neutral-100 cursor-help inline-block">
                          {cleanLabel}
                        </span>
                      </Tooltip>
                    )
                  })()}
                  {groupedPlans.length > 0 && (() => {
                    const primary = groupedPlans[0]
                    const rest = groupedPlans.slice(1)
                    const restCount = rest.reduce((sum, p) => sum + p.quantity, 0)
                    return (
                      <>
                        <Tooltip
                          content={primary.quantity > 1
                            ? `${primary.quantity} active subscriptions — limits stack.`
                            : 'Your active plan.'}
                          maxWidth={200}
                        >
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full cursor-help ${tierChipStyle(primary.tier)}`}
                          >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${tierDotColor(primary.tier)}`} />
                            <span className="whitespace-nowrap">{primary.label}</span>
                            {primary.quantity > 1 && (
                              <span className="opacity-70">× {primary.quantity}</span>
                            )}
                          </span>
                        </Tooltip>
                        {rest.length > 0 && (
                          <RestPlansChip
                            rest={rest}
                            restCount={restCount}
                            tierDotColor={tierDotColor}
                          />
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-neutral-700 pt-3 sm:pt-4">
                <Tooltip
                  content="What your current plan includes and how much you've used so far. Numbers on the left are used; numbers on the right are your plan's limit. Hover any card label for a plain-English explanation."
                  maxWidth={320}
                >
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-4 cursor-help inline-block">
                    Plan Usage
                  </h3>
                </Tooltip>
                {/* Auto-fill grid: each card is 180–220px wide. Same
                    template as Credits + BYOK so cards across the
                    three tabs render at the same physical width
                    regardless of how many fit per row. */}
                <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,220px))] gap-3 w-full">
                  <EntitlementTile
                    icon={Workflow}
                    label="Workflows"
                    used={data.effective.workflows_used}
                    max={data.effective.workflows_max}
                    labelTooltip="Workflows you've built."
                    valueTooltip="Created / limit"
                  />
                  <EntitlementTile
                    icon={Cpu}
                    label="Compute units"
                    used={data.effective.units_used_this_period}
                    max={data.effective.units_max_per_month}
                    labelTooltip="Workflow runtime (1 unit = 30s)."
                    valueTooltip="Used / monthly limit"
                  />
                  <EntitlementTile
                    icon={Users}
                    label="Team members"
                    used={data.effective.team_members_used}
                    max={data.effective.team_members_max}
                    labelTooltip="Invited teammates."
                    valueTooltip="Invited / seat limit"
                  />
                  {/* Schedulers — metered when enabled, otherwise a
                      boolean pill. Same card chrome either way. */}
                  {data.effective.schedulers_enabled && schedulesCount !== null ? (
                    <EntitlementTile
                      icon={CalendarClock}
                      label="Schedulers"
                      used={schedulesCount}
                      max={data.effective.workflows_max}
                      labelTooltip="Scheduled workflows."
                      valueTooltip="Active / max"
                    />
                  ) : (
                    <EntitlementTile
                      icon={CalendarClock}
                      label="Schedulers"
                      status={!!data.effective.schedulers_enabled}
                      labelTooltip="Run workflows on a schedule."
                      valueTooltip={
                        data.effective.schedulers_enabled
                          ? "In your plan."
                          : "Upgrade to enable."
                      }
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Live PSB pricing cards. The "AI Credits are separate from
                plan" disclaimer that used to live between the current-plan
                card and the pricing cards was dropped — the Credits tab
                sits right beside Plan in the tab strip above, which makes
                the relationship clear without needing a paragraph to spell
                it out. */}
            <div className="mt-4">
              <PlanPricingCards />
            </div>
          </>
        )}
    </>
  )

  if (embedded) return content

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900">
      <div className="p-3 sm:p-6 overflow-x-hidden">{content}</div>
    </div>
  )
}
