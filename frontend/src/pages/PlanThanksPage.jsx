import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowRight, Rocket } from 'lucide-react'

// Post-purchase landing for subscription plans (Standard / Premium / etc).
// Deliberately generic — no polling, no invoice_id lookup, no plan-name
// fetch. Two reasons:
//   1) The credit-purchase thanks page at `/thanks` ALREADY handles the
//      polling + pending-email recovery flow. Duplicating that here would
//      cost ~150 LOC for marginal UX benefit, since users land on
//      `/usage/plan` within seconds anyway where the Current Plan card
//      reflects the new subscription via EntitlementsContext refresh.
//   2) PSB's plan-config `redirect_url` field only accepts a clean URL
//      (no query parameters allowed when configuring), so we can't pass
//      plan_id through the URL on the PayPal/Razorpay redirect path. A
//      generic page bypasses that constraint entirely — both the in-app
//      Card path (`navigate('/plan/thanks')`) and the PSB-redirect path
//      (PSB lands user at `/plan/thanks?invoice_id=X`; we just ignore the
//      param) end up here.
//
// Behavior: 5-second countdown, then auto-navigate to `/usage/plan`.
// Manual "Go to Plans & Usage" button for impatient users. Secondary
// "Back to Dashboard" link.

const AUTO_REDIRECT_SECONDS = 5

export default function PlanThanksPage() {
  const navigate = useNavigate()
  const [secondsLeft, setSecondsLeft] = useState(AUTO_REDIRECT_SECONDS)
  // Track whether the user already navigated manually so the auto-redirect
  // doesn't double-fire after they clicked the CTA. React Router unmounts
  // the component on navigation, which clears the interval via the cleanup
  // below — this ref is belt-and-suspenders for the rare race where the
  // interval tick fires between click and unmount.
  const navigatedRef = useRef(false)

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id)
          if (!navigatedRef.current) {
            navigatedRef.current = true
            navigate('/usage/plan', { replace: true })
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [navigate])

  const handleGoToPlan = () => {
    if (navigatedRef.current) return
    navigatedRef.current = true
    navigate('/usage/plan', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#1e1e1e] px-4">
      <div className="w-full max-w-md bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-2xl p-8 shadow-xl">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mx-auto mb-4">
            <Rocket className="w-7 h-7 text-violet-600 dark:text-violet-400" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Thank you for your purchase!
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2 leading-relaxed">
            Your subscription is being activated. We&rsquo;ll take you to your
            plan in a moment, where the new entitlements will appear as soon
            as Pabbly confirms the payment.
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-500 mb-6 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              Redirecting in{' '}
              <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">
                {secondsLeft}
              </span>
              {' '}
              {secondsLeft === 1 ? 'second' : 'seconds'}…
            </span>
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleGoToPlan}
              className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
            >
              Go to Plans &amp; Usage <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center w-full py-2 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
