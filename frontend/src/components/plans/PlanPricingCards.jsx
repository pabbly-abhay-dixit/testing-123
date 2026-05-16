import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, ExternalLink, Check, ChevronDown, ChevronUp, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import { plansAPI, subscriptionsAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Tooltip from '../ui/Tooltip'
import PlanCheckoutPopup from './PlanCheckoutPopup'

// In-app pricing UI for `/usage/plan`. Visual language mirrors the
// "Buy AI Credits" card grid on Credits.jsx — gradient icon tile,
// bold plan name, big price line, full-width colored CTA — so the two
// purchase surfaces (subscription plans + AI credit packages) read as
// one product family.
//
// Tier → colour mapping (theme: black + blue only)
//   Free      → neutral grey (no checkout; "Your Plan" or "Manage Subscription")
//   Standard  → black  (gradient + button) — default paid option
//   Premium   → blue   (gradient + button, "MOST POPULAR" badge) — highlighted pick
//
// Blue is reserved for the recommended/highlighted plan so it always pops
// against the other (neutral-black) tiers in the same grid.
//
// Plans are filtered to `meta_data.paa_tier` (server-side, in
// pabbly_subscription::normalize_plan) so credit-package rows that
// share the same PSB product never appear on this surface.

// ─── Tier-specific style + copy ─────────────────────────────────────────

// Shared blue icon-tile gradient — every card uses this so the row
// reads as one design family (no black or gray tiles competing with
// the blue CTAs below).
const ICON_TILE_GRADIENT = 'from-blue-500 to-blue-600'

const FREE_TIER = {
  tier: 'free',
  label: 'Free',
  tagline: 'For trying it out',
  icon: '🎁',
  gradient: ICON_TILE_GRADIENT,
  // All CTA buttons use the brand blue so the "buy/select" action reads
  // as one cohesive call-to-action across tiers (no black buttons).
  button: 'bg-blue-600 hover:bg-blue-700',
  ctaTip: 'Try AgenticAI free — 5 workflows and 100 compute units per month',
}

const STANDARD_TIER = {
  tier: 'standard',
  label: 'Standard',
  tagline: 'For individuals',
  icon: '⚡',
  gradient: ICON_TILE_GRADIENT,
  button: 'bg-blue-600 hover:bg-blue-700',
  ctaTip: 'For individuals — more workflows, scheduling, and 2,000 compute units / month',
}

const PREMIUM_TIER = {
  tier: 'premium',
  label: 'Premium',
  tagline: 'For growing teams',
  icon: '🚀',
  gradient: ICON_TILE_GRADIENT,
  button: 'bg-blue-600 hover:bg-blue-700',
  popular: true,
  popularLabel: 'Most Popular',
  ctaTip: 'For teams — higher workflow + team limits, 8,000 compute units / month',
}

const CYCLE_META = {
  yearly: { label: 'Yearly', months: 12, saveBadge: null },
  '2-year': { label: '2 Yearly', months: 24, saveBadge: 'Save 5%' },
  '3-year': { label: '3 Yearly', months: 36, saveBadge: 'Save 10%' },
}
const VISIBLE_CYCLES = ['yearly', '2-year', '3-year']

// Fixed Free-tier limits — sourced from `tier_registry.local_limits` on
// the server. Hardcoded here because PSB has no Free plan to read from.
// Rendered as a vertical bullet list under the price; each item is its
// own row so the user can scan plans side-by-side and compare features
// at the same vertical position.
const FREE_FEATURES = [
  '5 workflows',
  '100 Compute Units / month',
  'Community support',
]

// ─── Helpers ────────────────────────────────────────────────────────────

function fmtPriceWhole(cents, symbol) {
  const dollars = Math.round((cents || 0) / 100)
  return `${symbol}${dollars}`
}

function monthlyEquivalentCents(plan) {
  const months = CYCLE_META[plan.billing_cycle]?.months
  if (!months || months <= 0) return plan.amount_cents
  return Math.round(plan.amount_cents / months)
}

// PSB ships `paa_schedulers` as either a bool or a string ("true"/"false")
// depending on how the admin entered it in the PSB dashboard. Be defensive
// — only render the bullet when the value affirmatively reads as enabled.
function isSchedulersEnabled(value) {
  if (value === true) return true
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

// Build a feature ARRAY for a paid plan card. Rendered as a vertical
// bullet list so users can compare equivalent rows across cards by
// reading down the column (workflows-to-workflows, units-to-units).
// Skips zero / missing fields so the list stays clean. Order mirrors the
// product hierarchy: capacity (workflows, CU) → seats → automation
// (schedulers) → support.
function planFeatures(plan) {
  const md = plan.meta_data || {}
  const parts = []
  if (md.paa_workflows) parts.push(`${md.paa_workflows} workflows`)
  if (md.paa_units) {
    parts.push(`${Number(md.paa_units).toLocaleString()} Compute Units / month`)
  }
  if (md.paa_team_members && Number(md.paa_team_members) > 0) {
    parts.push(`Up to ${md.paa_team_members} team members`)
  }
  if (isSchedulersEnabled(md.paa_schedulers)) parts.push('Schedulers included')
  const support = (md.paa_support_tier || '').toLowerCase()
  if (support === 'priority') parts.push('Priority support')
  else if (support === 'email') parts.push('Email support')
  return parts
}

// ─── Component ──────────────────────────────────────────────────────────

export default function PlanPricingCards() {
  const { user } = useAuth()
  const [plans, setPlans] = useState([])
  const [activeCycle, setActiveCycle] = useState('yearly')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Server-side rank-max — see `entitlements::aggregate`. We use this
  // ONLY to drive the Free card's CTA (Free vs. "Manage Subscription"
  // for users on a paid plan). We deliberately do NOT highlight any
  // specific paid plan as "Your Plan" or compare cycles, because:
  //   - users can stack purchases (multiple Premium 1-Year + a Premium
  //     3-Year, etc.) so there's no single "current" cycle
  //   - any plan can be purchased any number of times
  //   - showing "Switch to 3 Yearly" implies an exclusive swap, which
  //     isn't how PSB stacking works (it's an additional purchase)
  const [currentTier, setCurrentTier] = useState('free')
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkoutPlan, setCheckoutPlan] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Shared toggle — default OPEN so users see all features on first
  // load (no extra click needed). They can collapse via the
  // "Hide details" pill below the grid to scan compact cards.
  const [showDetails, setShowDetails] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    plansAPI
      .list()
      .then(({ data }) => {
        if (cancelled) return
        setPlans(Array.isArray(data?.plans) ? data.plans : [])
      })
      .catch((e) => {
        if (cancelled) return
        const msg =
          e?.response?.data?.message || e?.response?.data?.error || 'Could not load plans'
        setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    subscriptionsAPI
      .getMine()
      .then(({ data }) => {
        if (cancelled) return
        const tier = (data?.effective?.display_tier || 'free').toLowerCase()
        setCurrentTier(tier)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id, refreshKey])

  const tabPlans = useMemo(() => {
    const filtered = plans.filter((p) => p.billing_cycle === activeCycle)
    return {
      standard: filtered.find((p) => p.meta_data?.paa_tier === 'standard') || null,
      premium: filtered.find((p) => p.meta_data?.paa_tier === 'premium') || null,
    }
  }, [plans, activeCycle])

  // Yearly plans by tier — used as the "base" price for the discount
  // calculation on the 2-Yearly / 3-Yearly cards. Looked up across all
  // plans, NOT filtered by activeCycle, so the savings line works on
  // any tab. Null when no yearly plan is published (no savings shown).
  const yearlyByTier = useMemo(() => {
    const yearly = plans.filter((p) => p.billing_cycle === 'yearly')
    return {
      standard: yearly.find((p) => p.meta_data?.paa_tier === 'standard') || null,
      premium: yearly.find((p) => p.meta_data?.paa_tier === 'premium') || null,
    }
  }, [plans])

  const visibleCycles = useMemo(() => {
    const present = new Set(plans.map((p) => p.billing_cycle))
    return VISIBLE_CYCLES.filter((c) => present.has(c))
  }, [plans])

  const handleCheckout = (plan) => {
    if (!plan?.plan_id) {
      toast.error('Plan is not available — please contact support.')
      return
    }
    setCheckoutPlan(plan)
  }

  const handleCheckoutClose = () => setCheckoutPlan(null)

  const handleCheckoutSuccess = () => {
    setCheckoutPlan(null)
    setRefreshKey((k) => k + 1)
  }

  // Open the PSB customer portal so paid users can manage / cancel /
  // downgrade. Used by Free card's CTA when the user is on a paid plan.
  const handleManageSubscription = async () => {
    if (portalLoading) return
    setPortalLoading(true)
    try {
      const { data } = await subscriptionsAPI.createPortalSession()
      const url = data?.access_url || data?.url
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer')
      } else {
        toast.error('Could not open subscription portal — please contact support.')
      }
    } catch (e) {
      const msg = e?.response?.data?.message || 'Could not open subscription portal.'
      toast.error(msg)
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) {
    // Skeleton silhouette — mirrors the post-load layout (section
    // heading + billing-cycle pill row + 3 plan cards) so the page
    // outline stays steady through the fetch. Same chrome the page
    // settles into; no "Loading…" text bar that visibly jumps to
    // the real grid.
    return (
      <>
        <div className="mb-4">
          <div className="h-6 w-32 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
        </div>
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 mb-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 w-24 rounded-full bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-2xl p-5 shadow-sm flex flex-col"
            >
              <div className="h-10 w-10 rounded-xl bg-neutral-200 dark:bg-neutral-700 animate-pulse mb-3" />
              <div className="h-5 w-24 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse mb-1" />
              <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse mb-3" />
              <div className="h-8 w-28 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse mb-1" />
              <div className="h-3 w-36 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse mb-4" />
              <div className="border-t border-gray-100 dark:border-neutral-700 pt-4 w-full flex flex-col gap-2 mb-4">
                <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
                <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
                <div className="h-3 w-28 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
                <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
              </div>
              <div className="h-10 w-full rounded-xl bg-neutral-200 dark:bg-neutral-700 animate-pulse mt-auto" />
            </div>
          ))}
        </div>
      </>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Plans are temporarily unavailable
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 text-sm text-neutral-500 dark:text-neutral-400">
        No active plans available right now.
      </div>
    )
  }

  return (
    <div>
      {/* Section header — matches Credits.jsx "Buy AI Credits" treatment.
          No subtitle below: the header is self-explanatory and the
          previous "checkout runs on PSB" line was implementation-detail
          noise that didn't help users decide. */}
      <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100 mb-5">
        Choose your plan
      </h2>

      {/* Billing-cycle segmented control. Compact, labeled, clean.
          The "Billing cycle" caption tells users what the toggle
          controls without making them guess. Container is borderless
          + softly tinted so it reads as a single segmented control,
          not three loose pills.
          - Light mode: selected pill = black, save badge = blue chip
          - Dark mode: selected pill = white, save badge = black bg
            + blue text (high contrast against white) */}
      {/* Inverted look in dark mode:
          - Light: container = light grey, selected = black + white text,
            inactive text = dark grey.
          - Dark: container = black, selected = white + black text,
            inactive text = white.
          Save badge stays blue in both modes. */}
      {visibleCycles.length > 1 && (
        <div className="mb-5">
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            {visibleCycles.map((c) => {
              const meta = CYCLE_META[c]
              const active = c === activeCycle
              return (
              <button
                key={c}
                onClick={() => setActiveCycle(c)}
                className={`flex items-center gap-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ease-out ${
                  active
                    ? '-my-1 px-5 py-2.5 first:-ml-1 last:-mr-1 bg-neutral-900 text-white shadow-sm dark:bg-neutral-700 dark:text-white'
                    : 'px-4 py-1.5 text-neutral-600 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white hover:bg-white hover:shadow-sm dark:hover:bg-neutral-800 dark:hover:shadow-sm dark:hover:shadow-black/40'
                }`}
              >
                <span>{meta.label}</span>
                {meta.saveBadge && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
                    {meta.saveBadge}
                  </span>
                )}
              </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Free card only renders while the user is actually on Free.
            Once they upgrade, the Free pitch is irrelevant — replace
            it with a "Manage subscription" card that links into PSB's
            portal for invoices, payment methods, cancel/renew. */}
        {currentTier === 'free' ? (
          // Free user on mobile sees the paid pitch (Standard +
          // Premium) FIRST and Free last — they're already on Free,
          // so the "stay on Free" card belongs at the bottom of the
          // scroll. Desktop keeps natural left position.
          <FreeCard
            isCurrent={true}
            onManage={handleManageSubscription}
            managing={portalLoading}
            showDetails={showDetails}
            className="order-last sm:order-first"
          />
        ) : (
          // Mobile (single-column grid): Manage Subscription sits
          // LAST so the upgrade pitch (Standard + Premium) shows
          // first. Desktop (2/3-col grid): natural first position
          // since the row reads left-to-right and the user's account
          // entry-point belongs on the left.
          <ManageSubscriptionCard
            onManage={handleManageSubscription}
            managing={portalLoading}
            showDetails={showDetails}
            className="order-last sm:order-first"
          />
        )}

        <PaidCard
          plan={tabPlans.standard}
          yearlyPlan={yearlyByTier.standard}
          style={STANDARD_TIER}
          opening={checkoutPlan?.plan_id === tabPlans.standard?.plan_id}
          onCheckout={() => handleCheckout(tabPlans.standard)}
          showDetails={showDetails}
        />

        <PaidCard
          plan={tabPlans.premium}
          yearlyPlan={yearlyByTier.premium}
          style={PREMIUM_TIER}
          opening={checkoutPlan?.plan_id === tabPlans.premium?.plan_id}
          onCheckout={() => handleCheckout(tabPlans.premium)}
          showDetails={showDetails}
        />
      </div>

      {/* Shared toggle — desktop only. Initial state is OPEN
          (showDetails=true) so users see features on first load. On
          mobile each card always shows its features inline so no
          toggle is needed there. */}
      <div className="hidden sm:flex justify-center mb-8">
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1 transition-colors"
          aria-expanded={showDetails}
        >
          {showDetails ? 'View less' : 'View more'}
          {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Single page-level helper line. Carries the only mention of
          "My Subscription" on the entire Plan tab — the previous three
          mentions (page subtitle, mid-page paragraph, this footer) were
          identical in content and made the page feel like a privacy
          policy. */}
      <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed text-center">
        Prices in {tabPlans.standard?.currency_code || 'USD'}. Cancel or change anytime from{' '}
        <strong className="text-neutral-700 dark:text-neutral-300">My Subscription</strong>{' '}
        in your profile menu.
      </p>

      <PlanCheckoutPopup
        open={!!checkoutPlan}
        plan={checkoutPlan}
        user={user}
        onClose={handleCheckoutClose}
        onSuccess={handleCheckoutSuccess}
      />
    </div>
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────

function CardShell({ children, popular = false, className = '' }) {
  // Popular tier gets a subtle blue tonal background + ring so it pops
  // against the neutral cards without needing extra color elsewhere.
  // Mirrors the pricing card patterns on Stripe, Linear, Vercel —
  // single accent applied through bg + border + ring on the same card.
  // We deliberately do NOT carry an "active / your plan" highlight on
  // any card — stacked subs make per-card highlighting misleading.
  const accent = popular
    ? 'bg-blue-50/40 dark:bg-blue-900/10 border-blue-300 dark:border-blue-700/60 ring-1 ring-blue-200 dark:ring-blue-800/40'
    : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700'
  return (
    <div
      className={`relative border rounded-2xl p-5 shadow-sm transition-all hover:shadow-md flex flex-col text-left ${accent} ${className}`}
    >
      {children}
    </div>
  )
}

// Vertical feature list. One row per item, check icon tinted to match
// the card's tier (Premium=blue for the highlighted pick, others=neutral)
// so the row reads as a unit of colour across the card. Sits inside the
// (toggleable) details block — no `flex-1` because the collapsed card
// stays naturally compact; CTA pins to the bottom via its own `mt-auto`.
function FeatureBullets({ features, accent = 'neutral' }) {
  const check =
    accent === 'blue'
      ? 'text-blue-600 dark:text-blue-400'
      : 'text-neutral-500 dark:text-neutral-400'
  return (
    <ul className="w-full flex flex-col gap-2 text-left mb-4">
      {features.map((f, i) => (
        <li
          key={i}
          className="flex items-start gap-2 text-[13px] text-gray-700 dark:text-neutral-300 leading-snug"
        >
          <Check size={14} className={`flex-shrink-0 mt-0.5 ${check}`} />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  )
}

function IconTile({ icon, gradient }) {
  return (
    <div
      className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 text-lg flex-shrink-0`}
    >
      {icon}
    </div>
  )
}

// Section subheading above the feature list. Tiny + uppercase reads as
// "what's in this plan" without competing with the price block. Stripe
// + Vercel + Linear all use this pattern between price and features.
function FeaturesHeading() {
  return (
    <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-neutral-400 mb-3">
      What's included
    </div>
  )
}

// Shared "name + tagline" header block. Centered text inside a left-
// aligned card keeps the price block readable while letting the small
// tagline orient the reader without an extra paragraph below.
function PlanHeader({ label, tagline }) {
  return (
    <>
      <p className="text-lg font-bold text-gray-900 dark:text-neutral-100">
        {label}
      </p>
      {tagline && (
        <p className="text-xs text-gray-500 dark:text-neutral-400 mb-3">{tagline}</p>
      )}
    </>
  )
}

// ManageSubscriptionCard — shown in the Free-card slot for users who
// already have a paid subscription. Same card chrome as FreeCard so
// the row stays visually balanced (3 equal columns), but the body
// pitches subscription management (invoices, payment method, cancel)
// instead of the Free tier. Single CTA opens PSB's customer portal.
function ManageSubscriptionCard({ onManage, managing, showDetails = true, className = '' }) {
  return (
    <CardShell className={className}>
      {/* Reuse the same blue gradient tile chrome that the
          FreeCard / Standard / Premium cards use — keeps icon tiles
          identical across the row. */}
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${ICON_TILE_GRADIENT} flex items-center justify-center mb-3 text-lg flex-shrink-0 text-white`}>
        <Settings size={20} />
      </div>

      <PlanHeader label="Your Subscription" tagline="Manage billing and invoices" />

      {/* Match the paid-card price-row vertical rhythm with invisible
          placeholders so the divider + "What's Included" line up
          row-for-row across the three cards. */}
      <p className="text-base font-semibold text-gray-900 dark:text-neutral-100 mb-1">
        Billing portal
      </p>
      <p className="text-[11px] text-gray-500 dark:text-neutral-400 mb-1 invisible" aria-hidden="true">
        &nbsp;
      </p>
      <p className="text-[11px] font-semibold mb-4 invisible" aria-hidden="true">
        &nbsp;
      </p>

      <div className={`border-t border-gray-100 dark:border-neutral-700 pt-4 mb-1 w-full flex flex-col ${showDetails ? 'block' : 'sm:hidden'}`}>
        <FeaturesHeading />
        <FeatureBullets
          features={[
            'View & download invoices',
            'Update payment method',
            'Cancel or change plan anytime',
          ]}
          accent="neutral"
        />
      </div>

      <Tooltip
        content="Opens the Pabbly Subscription Billing portal in a new tab."
        position="bottom"
        maxWidth={260}
        className="w-full mt-auto"
      >
        <button
          onClick={onManage}
          disabled={managing}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {managing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <>
              Manage Subscription
              <ExternalLink size={12} className="opacity-80" />
            </>
          )}
        </button>
      </Tooltip>
    </CardShell>
  )
}

function FreeCard({ isCurrent, onManage, managing, showDetails = true, className = '' }) {
  return (
    <CardShell className={className}>
      <IconTile icon={FREE_TIER.icon} gradient={FREE_TIER.gradient} />

      <PlanHeader label={FREE_TIER.label} tagline={FREE_TIER.tagline} />

      {/* Price block — single baseline-aligned row. Two invisible
          placeholders below match the height of the paid cards'
          "Billed yearly at $X" + "You save $X" lines so all three
          cards align row-for-row (divider, "What's Included",
          features). */}
      <p className="inline-flex items-baseline gap-1.5 mb-1">
        <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-neutral-100 leading-none">
          $0
        </span>
        <span className="text-sm text-gray-500 dark:text-neutral-400 leading-none">
          forever
        </span>
      </p>
      <p className="text-[11px] text-gray-500 dark:text-neutral-400 mb-1 invisible" aria-hidden="true">
        &nbsp;
      </p>
      <p className="text-[11px] font-semibold mb-4 invisible" aria-hidden="true">
        &nbsp;
      </p>

      {/* Details — on mobile (<sm) ALWAYS shown inline (no toggle:
          cards stack vertically there). On desktop, gated behind the
          shared "View all features" / "Hide details" parent toggle.
          Initial state is open so first paint shows everything. */}
      <div className={`border-t border-gray-100 dark:border-neutral-700 pt-4 mb-1 w-full flex flex-col ${showDetails ? 'block' : 'sm:hidden'}`}>
        <FeaturesHeading />
        <FeatureBullets features={FREE_FEATURES} accent="neutral" />
      </div>

      {isCurrent ? (
        <Tooltip
          content="You're on the Free plan. Pick a paid plan above to upgrade."
          position="bottom"
          className="w-full mt-auto"
        >
          <button
            disabled
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-default"
          >
            Your Plan
          </button>
        </Tooltip>
      ) : (
        <Tooltip
          content="Opens the Pabbly Subscription Billing portal in a new tab where you can view invoices, change payment method, cancel, or downgrade your plan."
          position="bottom"
          maxWidth={300}
          className="w-full mt-auto"
        >
          <button
            onClick={onManage}
            disabled={managing}
            className={`w-full py-2.5 rounded-xl text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-1.5 ${FREE_TIER.button} disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {managing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <>
                Manage Subscription
                <ExternalLink size={12} className="opacity-80" />
              </>
            )}
          </button>
        </Tooltip>
      )}
    </CardShell>
  )
}

function PaidCard({ plan, yearlyPlan, style, opening = false, onCheckout, showDetails = true }) {
  if (!plan) {
    // Plan not published for this billing cycle yet. Keep the slot in
    // the grid so the layout doesn't reflow when the user tabs cycles.
    return (
      <CardShell>
        <IconTile icon={style.icon} gradient={style.gradient} />
        <PlanHeader label={style.label} tagline={style.tagline} />
        <p className="inline-flex items-baseline gap-1 mb-4">
          <span className="text-xl font-semibold tabular-nums text-neutral-400 dark:text-neutral-500 leading-none">
            Coming soon
          </span>
        </p>
        <div className="border-t border-gray-100 dark:border-neutral-700 pt-4 w-full">
          <p className="text-[12px] text-gray-500 dark:text-neutral-400 leading-snug">
            Not published in this billing cycle yet.
          </p>
        </div>
        <button
          disabled
          className="w-full mt-auto py-2.5 rounded-xl text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500 cursor-default"
        >
          Not available
        </button>
      </CardShell>
    )
  }

  const monthlyCents = monthlyEquivalentCents(plan)
  const cycleLabel = CYCLE_META[plan.billing_cycle]?.label?.toLowerCase() || plan.billing_cycle
  const billedTotal = `${plan.currency_symbol}${(plan.amount_cents / 100).toLocaleString(
    undefined,
    { maximumFractionDigits: 2 },
  )}`
  const popular = !!style.popular
  const features = planFeatures(plan)
  // Only the popular Premium plan gets the blue accent (highlighted pick);
  // Standard rides the neutral palette so the page stays black + blue.
  const accent = style.tier === 'premium' ? 'blue' : 'neutral'

  // Discount calculation — only meaningful on multi-year cycles where a
  // matching Yearly plan exists. We compute:
  //   fullPriceCents = yearlyPlan.amount_cents × (cycleMonths / 12)
  //   savingsCents   = fullPriceCents − plan.amount_cents
  //   yearlyMonthly  = yearlyPlan.amount_cents / 12   (for strikethrough)
  // If user is on Yearly (or no Yearly plan exists), skip the discount UI.
  const cycleMonths = CYCLE_META[plan.billing_cycle]?.months || 12
  const hasDiscount =
    yearlyPlan &&
    plan.billing_cycle !== 'yearly' &&
    cycleMonths > 12 &&
    yearlyPlan.amount_cents > 0
  const yearlyMonthlyCents = hasDiscount ? Math.round(yearlyPlan.amount_cents / 12) : 0
  const fullPriceCents = hasDiscount ? Math.round((yearlyPlan.amount_cents / 12) * cycleMonths) : 0
  const savingsCents = hasDiscount ? Math.max(0, fullPriceCents - plan.amount_cents) : 0
  const savingsLabel = hasDiscount && savingsCents > 0
    ? `${plan.currency_symbol}${(savingsCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : null

  // CTA is intentionally generic — paid plans are always purchasable
  // (PSB allows stacking, so the same plan can be bought any number of
  // times). No "Your Plan" or "Switch to <cycle>" wording; both would
  // imply exclusivity that doesn't match how the underlying billing
  // works.
  const ctaText = `Get ${style.label} Plan`
  const ctaClassName = `text-white transition-colors ${style.button}`

  return (
    <CardShell popular={popular}>
      {popular && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm whitespace-nowrap">
          {style.popularLabel}
        </div>
      )}

      <IconTile icon={style.icon} gradient={style.gradient} />

      <PlanHeader label={style.label} tagline={style.tagline} />

      {/* Price block — larger number, lighter cycle suffix, then a
          subdued "billed at" caption. On discounted cycles (2-Yearly /
          3-Yearly) the original Yearly-rate monthly price is shown
          struck-through next to the discounted price, and a
          "You save $X over Y years" caption replaces the standard
          "Billed at" line so the user sees the concrete savings. */}
      <p className="inline-flex items-baseline gap-1.5 mb-1 flex-wrap">
        {hasDiscount && yearlyMonthlyCents > monthlyCents && (
          <span className="text-base font-medium tabular-nums text-gray-400 dark:text-neutral-500 leading-none line-through">
            {fmtPriceWhole(yearlyMonthlyCents, plan.currency_symbol)}
          </span>
        )}
        <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-neutral-100 leading-none">
          {fmtPriceWhole(monthlyCents, plan.currency_symbol)}
        </span>
        <span className="text-sm text-gray-500 dark:text-neutral-400 leading-none">/ month</span>
      </p>
      <p className="text-[11px] text-gray-500 dark:text-neutral-400 mb-1">
        Billed {cycleLabel} at {billedTotal}
      </p>
      {savingsLabel && (
        <p className="text-[11px] font-semibold mb-4 text-emerald-600 dark:text-emerald-400">
          You save {savingsLabel} vs Yearly
        </p>
      )}
      {!savingsLabel && <div className="mb-3" />}

      {/* Details — mobile: always shown inline. Desktop: gated by
          the shared parent toggle (initial state open). Popular card
          uses a blue divider against its blue-tinted background. */}
      <div className={`border-t pt-4 mb-1 w-full flex flex-col ${popular ? 'border-blue-200 dark:border-blue-600/60' : 'border-gray-100 dark:border-neutral-700'} ${showDetails ? 'block' : 'sm:hidden'}`}>
        <FeaturesHeading />
        {features.length > 0 && <FeatureBullets features={features} accent={accent} />}
      </div>

      <Tooltip content={style.ctaTip || `Subscribe to the ${style.label} plan`} className="w-full mt-auto">
        <button
          onClick={onCheckout}
          disabled={opening}
          className={`w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 ${ctaClassName} disabled:opacity-90`}
        >
          {opening ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Opening checkout…
            </>
          ) : (
            ctaText
          )}
        </button>
      </Tooltip>
    </CardShell>
  )
}
