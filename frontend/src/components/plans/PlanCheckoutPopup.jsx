import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Loader2,
  ShieldCheck,
  Lock,
  CreditCard,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { paymentAPI } from '../../services/api'

// Fully custom checkout modal — replaces PSB's hosted popup. Card data is
// captured here, posted to OUR backend (`POST /api/payment`), which then
// brokers the actual gateway call to PSB / Stripe / PayPal. Modelled after
// buy.pabbly.com/agenticai's checkout reference, adapted to React + our
// `violet-*` accents to match the Premium tier card (which gets the
// "MOST POPULAR" badge), unifying the checkout step with the upgrade
// path users most often arrive from.
//
// IMPORTANT: This puts the AgenticAI backend in PCI scope (raw PAN flows
// through it). The Pabbly platform already handles this same flow for
// buy.pabbly.com, so the infrastructure exists; this component just makes
// it work from our app. See the security audit notes for the broader
// implications.
//
// Backend integration points (paste PSB contract when ready):
//   - POST /api/payment   — body: { name, email, plan_id, gateway_type,
//                                   card_number, month, year, cvv,
//                                   coupon_code, token (recaptcha), ...utm }
//                            response on success: { status:"success", msg, payment_redirect_url? }
//                            response on failure: 4xx with { msg }
//   - POST /api/payment/coupon — body: { coupon_code, plan_id, total_price }
//                            response on success: { status:"success", amount:"123.45" }
//                            response on failure: 4xx with { msg }

// reCAPTCHA v2 site key. Fallback is the real Pabbly-owned site key
// shared with buy.pabbly.com — its matching secret is set on our
// backend `.env` as `RECAPTCHA_SECRET_KEY`. Override via
// `VITE_RECAPTCHA_SITE_KEY` if a different key is ever provisioned
// for agenticai.pabbly.com specifically. Both site + secret must
// always change together — they're a registered pair on Google's
// reCAPTCHA admin console.
const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
  '6LdNrKgUAAAAALsQ3getachCJBWULQBj4q17_mgv'

const RECAPTCHA_SCRIPT_SRC =
  'https://www.google.com/recaptcha/api.js?render=explicit'

// Module-scope widget id — survives modal unmount/remount cycles. The
// reference Astro implementation uses the same pattern (script-scope
// `let recaptchaWidgetId = null`). Component-scoped refs reset on
// remount, but Google's internal widget registry doesn't — without
// this, a stale widget id leaks on Google's side and the second
// render call silently fails to inject a fresh iframe.
let persistentWidgetId = null

// Translate PSB / gateway error strings into messages users can act on.
// Falls back to the raw message when nothing matches, and to a generic
// message when there's no raw text at all.
function friendlyPaymentError(raw) {
  const msg = String(raw || '')
  if (/card.*number|invalid card|card.*invalid/i.test(msg))
    return 'The card number you entered is invalid. Please check and try again.'
  if (/cvv/i.test(msg))
    return 'Invalid CVV. Please check the 3 or 4 digit code on your card.'
  if (/expir/i.test(msg))
    return 'Card expiry date is invalid or expired. Please use a valid card.'
  if (/captcha/i.test(msg))
    return 'Captcha verification failed. Please verify and try again.'
  if (/declin/i.test(msg))
    return 'Your card was declined. Please try a different payment method.'
  if (/insufficient/i.test(msg))
    return 'Insufficient funds on the card. Please try a different card.'
  if (/coupon/i.test(msg))
    return 'There was an issue with your coupon code. Please remove it and try again.'
  if (msg) return msg
  return 'Payment could not be processed. Please check your details and try again.'
}

function formatCardNumber(value) {
  const digits = value.replace(/\D/g, '').slice(0, 19)
  const chunks = digits.match(/.{1,4}/g)
  return chunks ? chunks.join(' ') : ''
}

function formatExpiry(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length >= 2) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits
}

// PayPal logo as inline SVG so we don't depend on an external image asset
// for this component. Sized to match the Card tab's icon footprint.
function PayPalMark({ className = '' }) {
  return (
    <svg
      viewBox="0 0 124 33"
      className={className}
      aria-label="PayPal"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#253B80"
        d="M46.211 6.749h-6.839a.95.95 0 0 0-.939.802l-2.766 17.537a.57.57 0 0 0 .564.658h3.265a.95.95 0 0 0 .939-.803l.746-4.73a.95.95 0 0 1 .938-.803h2.165c4.505 0 7.105-2.18 7.784-6.5.306-1.89.013-3.375-.872-4.415-.972-1.142-2.696-1.746-4.985-1.746zm.789 6.405c-.374 2.454-2.249 2.454-4.062 2.454h-1.032l.724-4.583a.57.57 0 0 1 .563-.481h.473c1.235 0 2.4 0 3.002.704.359.42.469 1.044.332 1.906zM66.654 13.075h-3.275a.57.57 0 0 0-.563.481l-.145.916-.229-.332c-.709-1.029-2.29-1.373-3.868-1.373-3.619 0-6.71 2.741-7.312 6.586-.313 1.918.132 3.752 1.22 5.031.998 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .562.66h2.95a.95.95 0 0 0 .939-.803l1.77-11.209a.568.568 0 0 0-.561-.658zm-4.565 6.374c-.316 1.871-1.801 3.127-3.695 3.127-.951 0-1.711-.305-2.199-.883-.484-.574-.668-1.391-.514-2.301.295-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.499.589.697 1.411.554 2.317zM84.096 13.075h-3.291a.954.954 0 0 0-.787.417l-4.539 6.686-1.924-6.425a.953.953 0 0 0-.912-.678h-3.234a.57.57 0 0 0-.541.754l3.625 10.638-3.408 4.811a.57.57 0 0 0 .465.9h3.287a.949.949 0 0 0 .781-.408l10.946-15.8a.57.57 0 0 0-.468-.895z"
      />
      <path
        fill="#179BD7"
        d="M94.992 6.749h-6.84a.95.95 0 0 0-.938.802l-2.766 17.537a.569.569 0 0 0 .562.658h3.51a.665.665 0 0 0 .656-.562l.785-4.971a.95.95 0 0 1 .938-.803h2.164c4.506 0 7.105-2.18 7.785-6.5.307-1.89.012-3.375-.873-4.415-.971-1.142-2.694-1.746-4.983-1.746zm.789 6.405c-.373 2.454-2.248 2.454-4.062 2.454h-1.031l.725-4.583a.568.568 0 0 1 .562-.481h.473c1.234 0 2.4 0 3.002.704.359.42.468 1.044.331 1.906zM115.434 13.075h-3.273a.567.567 0 0 0-.562.481l-.145.916-.23-.332c-.709-1.029-2.289-1.373-3.867-1.373-3.619 0-6.709 2.741-7.311 6.586-.312 1.918.131 3.752 1.219 5.031 1 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .564.66h2.949a.95.95 0 0 0 .938-.803l1.771-11.209a.571.571 0 0 0-.565-.658zm-4.565 6.374c-.314 1.871-1.801 3.127-3.695 3.127-.949 0-1.711-.305-2.199-.883-.484-.574-.666-1.391-.514-2.301.297-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.501.589.699 1.411.554 2.317zM119.295 7.23l-2.807 17.858a.569.569 0 0 0 .562.658h2.822c.469 0 .867-.34.939-.803l2.768-17.536a.57.57 0 0 0-.562-.659h-3.16a.571.571 0 0 0-.562.482z"
      />
      <path
        fill="#253B80"
        d="M7.266 29.154l.523-3.322-1.165-.027H1.061L4.927 1.292a.316.316 0 0 1 .314-.268h9.38c3.114 0 5.263.648 6.385 1.927.526.6.861 1.227 1.023 1.917.17.724.173 1.589.007 2.644l-.012.077v.676l.526.298a3.69 3.69 0 0 1 1.065.812c.45.513.741 1.165.864 1.938.127.795.085 1.741-.123 2.812-.24 1.232-.628 2.305-1.152 3.183a6.547 6.547 0 0 1-1.825 2c-.696.494-1.523.869-2.458 1.109-.906.236-1.939.355-3.072.355h-.73c-.522 0-1.029.188-1.427.525a2.21 2.21 0 0 0-.744 1.328l-.055.299-.924 5.855-.042.215c-.011.068-.03.102-.058.125a.155.155 0 0 1-.096.035H7.266z"
      />
      <path
        fill="#179BD7"
        d="M23.048 7.667c-.028.179-.06.362-.096.55-1.237 6.351-5.469 8.545-10.874 8.545H9.326c-.661 0-1.218.48-1.321 1.132L6.596 26.83l-.399 2.533a.704.704 0 0 0 .695.814h4.881c.578 0 1.069-.42 1.16-.99l.048-.248.919-5.832.059-.32c.09-.572.582-.992 1.16-.992h.73c4.729 0 8.431-1.92 9.513-7.476.452-2.321.218-4.259-.978-5.622a4.667 4.667 0 0 0-1.336-1.03z"
      />
      <path
        fill="#222D65"
        d="M21.754 7.151a9.757 9.757 0 0 0-1.203-.267 15.284 15.284 0 0 0-2.426-.177h-7.352a1.172 1.172 0 0 0-1.159.992L8.05 17.605l-.045.289a1.336 1.336 0 0 1 1.321-1.132h2.752c5.405 0 9.637-2.195 10.874-8.545.037-.188.068-.371.096-.55a6.594 6.594 0 0 0-1.017-.429 9.045 9.045 0 0 0-.277-.087z"
      />
      <path
        fill="#253B80"
        d="M9.614 7.699a1.169 1.169 0 0 1 1.159-.991h7.352c.871 0 1.684.057 2.426.177a9.757 9.757 0 0 1 1.481.353c.365.121.704.264 1.017.429.368-2.347-.003-3.945-1.272-5.392C20.378.682 17.853 0 14.622 0h-9.38c-.66 0-1.223.48-1.325 1.133L.01 25.898a.806.806 0 0 0 .795.932h5.791l1.454-9.225 1.564-9.906z"
      />
    </svg>
  )
}

export default function PlanCheckoutPopup({ open, plan, user, onClose, onSuccess }) {
  const navigate = useNavigate()

  // Form state. Name + email are seeded from the logged-in user and
  // rendered readOnly so the same misuse vector the user flagged is
  // closed at the form level (we own the form now, no PSB iframe).
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('card') // 'card' | 'paypal'

  // Coupon state.
  const [couponCode, setCouponCode] = useState('')
  const [showCoupon, setShowCoupon] = useState(false)
  const [appliedCoupon, setAppliedCoupon] = useState(null) // { code, amount: string }
  const [couponApplying, setCouponApplying] = useState(false)
  const [couponMessage, setCouponMessage] = useState({ text: '', type: null }) // type: 'success' | 'error' | null

  // Effective price after coupon application — kept in CENTS so the math
  // matches plan.amount_cents. UI formats by /100 right before render.
  const [finalCents, setFinalCents] = useState(0)

  // reCAPTCHA state. `status` drives the visible state:
  //   'loading' — script / widget mounting (skeleton shown)
  //   'ready'   — widget rendered, awaiting user solve
  //   'error'   — failed after MAX_RETRIES, "Reload captcha" button shown
  const [recaptchaToken, setRecaptchaToken] = useState('')
  const [recaptchaStatus, setRecaptchaStatus] = useState('loading')
  const recaptchaContainerRef = useRef(null)
  const recaptchaRetryCountRef = useRef(0)
  const recaptchaTimerRef = useRef(null)

  const [submitting, setSubmitting] = useState(false)
  // Submission error displayed INSIDE the modal as a banner above the
  // form. We can't use react-hot-toast for these because its default
  // z-index is below our modal's z-[10500] backdrop — the toast renders
  // behind the blurred overlay and is unreadable. The banner sits at
  // the top of the form so the user sees it without scrolling.
  const [submitError, setSubmitError] = useState('')

  // Reset form whenever the modal reopens for a (potentially different) plan.
  useEffect(() => {
    if (!open || !plan) return
    setName(user?.name || '')
    setEmail(user?.email || '')
    setCardNumber('')
    setExpiry('')
    setCvv('')
    setPaymentMethod('card')
    setCouponCode('')
    setShowCoupon(false)
    setAppliedCoupon(null)
    setCouponMessage({ text: '', type: null })
    setFinalCents(plan.amount_cents || 0)
    setRecaptchaToken('')
    setSubmitting(false)
    setSubmitError('')
  }, [open, plan?.plan_id, user?.email, user?.name])

  // Body scroll lock + Esc to close. Cleaned up on unmount or close.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // reCAPTCHA v2 lazy loader + render. Script is injected once globally
  // (cached by the browser), widget is (re)rendered every time the
  // modal opens so a stale token from a previous attempt never carries
  // over. Bounded retry — if `window.grecaptcha.render` doesn't appear
  // within MAX_RETRIES * INTERVAL_MS, we flip to 'error' state so the
  // user can manually retry instead of staring at an invisible widget.
  const RECAPTCHA_RETRY_INTERVAL_MS = 200
  const RECAPTCHA_MAX_RETRIES = 50 // 50 × 200ms = 10s budget — generous

  const clearRecaptchaTimer = useCallback(() => {
    if (recaptchaTimerRef.current) {
      clearTimeout(recaptchaTimerRef.current)
      recaptchaTimerRef.current = null
    }
  }, [])

  const renderRecaptcha = useCallback(() => {
    clearRecaptchaTimer()
    if (!recaptchaContainerRef.current) {
      // Container not in DOM yet — retry on next tick. Ref attaches
      // after first paint of the modal.
      if (recaptchaRetryCountRef.current < RECAPTCHA_MAX_RETRIES) {
        recaptchaRetryCountRef.current += 1
        recaptchaTimerRef.current = setTimeout(
          renderRecaptcha,
          RECAPTCHA_RETRY_INTERVAL_MS,
        )
      } else {
        setRecaptchaStatus('error')
      }
      return
    }
    if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function') {
      // Script loaded but API isn't ready yet. Bounded retry.
      if (recaptchaRetryCountRef.current < RECAPTCHA_MAX_RETRIES) {
        recaptchaRetryCountRef.current += 1
        recaptchaTimerRef.current = setTimeout(
          renderRecaptcha,
          RECAPTCHA_RETRY_INTERVAL_MS,
        )
      } else {
        console.warn('reCAPTCHA: grecaptcha never became ready')
        setRecaptchaStatus('error')
      }
      return
    }

    // Defensive: if a previous mount left an iframe inside this
    // brand-new container (shouldn't happen on a fresh remount but
    // does in React StrictMode + dev fast-refresh), don't re-render
    // on top of it — just mark ready.
    const container = recaptchaContainerRef.current
    if (container.querySelector('iframe[src*="recaptcha"]')) {
      setRecaptchaStatus('ready')
      return
    }

    // The widget id from the previous mount lives on at module scope
    // (Google's internal registry persists across React unmounts).
    // Try to reset it first — this cleans Google's state so render()
    // below can safely create a fresh widget. If reset throws (the
    // old container is detached, which is the normal case for us),
    // catch + null + fall through to fresh render.
    if (persistentWidgetId !== null) {
      try {
        window.grecaptcha.reset(persistentWidgetId)
      } catch {
        // Old container is gone — expected after unmount. Forget it.
      }
      persistentWidgetId = null
    }

    container.innerHTML = ''
    try {
      persistentWidgetId = window.grecaptcha.render(container, {
        sitekey: RECAPTCHA_SITE_KEY,
        theme: 'light',
        size: 'normal',
        callback: (token) => setRecaptchaToken(token),
        'expired-callback': () => setRecaptchaToken(''),
        'error-callback': () => {
          setRecaptchaToken('')
          setRecaptchaStatus('error')
        },
      })
      setRecaptchaStatus('ready')
      // Sanity verify: Google sometimes returns a widget id but the
      // iframe injection runs later. If after 1s there's still no
      // iframe in our container, something went wrong — flip to
      // error so the user gets the "Reload captcha" button rather
      // than a silently invisible widget.
      recaptchaTimerRef.current = setTimeout(() => {
        if (
          recaptchaContainerRef.current &&
          !recaptchaContainerRef.current.querySelector('iframe[src*="recaptcha"]')
        ) {
          console.warn(
            'reCAPTCHA: render() returned id but no iframe — marking error',
          )
          setRecaptchaStatus('error')
        }
      }, 1500)
    } catch (e) {
      console.warn('reCAPTCHA render failed:', e?.message || e)
      setRecaptchaStatus('error')
    }
  }, [clearRecaptchaTimer])

  useEffect(() => {
    if (!open) return
    setRecaptchaStatus('loading')
    recaptchaRetryCountRef.current = 0

    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      // Script + API both ready. Brief delay so the container ref attaches.
      recaptchaTimerRef.current = setTimeout(renderRecaptcha, 80)
      return clearRecaptchaTimer
    }

    if (!document.querySelector(`script[src^="${RECAPTCHA_SCRIPT_SRC}"]`)) {
      // First time on this page — inject the script.
      const s = document.createElement('script')
      s.src = RECAPTCHA_SCRIPT_SRC
      s.async = true
      s.defer = true
      s.onload = () => {
        recaptchaTimerRef.current = setTimeout(renderRecaptcha, 80)
      }
      s.onerror = () => {
        // Script fetch itself failed (network, adblocker, etc.).
        setRecaptchaStatus('error')
      }
      document.head.appendChild(s)
    } else {
      // Script tag already injected — poll for the API to come online.
      recaptchaTimerRef.current = setTimeout(renderRecaptcha, 250)
    }
    return clearRecaptchaTimer
  }, [open, renderRecaptcha, clearRecaptchaTimer])

  // Manual retry — user clicks "Reload captcha" after a failed load.
  const retryRecaptcha = useCallback(() => {
    persistentWidgetId = null
    if (recaptchaContainerRef.current) recaptchaContainerRef.current.innerHTML = ''
    setRecaptchaToken('')
    setRecaptchaStatus('loading')
    recaptchaRetryCountRef.current = 0
    renderRecaptcha()
  }, [renderRecaptcha])

  const resetRecaptcha = useCallback(() => {
    setRecaptchaToken('')
    if (window.grecaptcha && persistentWidgetId !== null) {
      try {
        window.grecaptcha.reset(persistentWidgetId)
      } catch {
        // Widget gone — let the next open re-render it.
        persistentWidgetId = null
      }
    }
  }, [])

  // $0-after-coupon edge case: card details aren't needed because no
  // charge is made (Pabbly still activates the subscription via the
  // webhook). Hide the card fields and skip their validation.
  //
  // CRITICAL: this derivation + the useEffect below MUST run on every
  // render, including the `open=false` initial pre-mount render — they
  // are hooks (and a hook-dependent derivation) and React enforces a
  // stable hook-call count across renders. Putting the useEffect after
  // `if (!open) return null` previously caused "Rendered more hooks
  // than during the previous render" when `open` flipped true on click,
  // crashing the React tree (white-screen bug). Keep all hooks above
  // the early return.
  const isFreeAfterCoupon = finalCents === 0

  // PayPal/Razorpay don't support $0 orders — PSB's response omits the
  // payment_redirect_url for free orders since there's no charge to
  // route, and our backend's strict redirect check turns that into a
  // "Redirect url is not set" error. Card has a placeholder-card path
  // for $0; PayPal does not. Auto-switch back to Card whenever the
  // coupon would zero the order so the user can't bounce themselves
  // back into a broken state.
  useEffect(() => {
    if (isFreeAfterCoupon && paymentMethod !== 'card') {
      setPaymentMethod('card')
      // Clear any stale "Redirect url is not set" banner the user may
      // have triggered before the auto-switch landed.
      setSubmitError('')
    }
  }, [isFreeAfterCoupon, paymentMethod])

  if (!open || !plan) return null

  const currencySymbol = plan.currency_symbol || '$'
  const displayDollars = (finalCents / 100).toFixed(2)
  // PayPal doesn't support multi-year subscriptions on PSB (per the
  // reference). Hide that tab for 2-year and 3-year cycles and force
  // Card as the only payment method.
  const isMultiYear =
    plan.billing_cycle === '2-year' || plan.billing_cycle === '3-year'

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase()
    if (!code) {
      setCouponMessage({ text: 'Please enter a coupon code', type: 'error' })
      return
    }
    if (appliedCoupon) {
      setCouponMessage({ text: 'Coupon already applied', type: 'success' })
      return
    }
    setCouponApplying(true)
    setCouponMessage({ text: '', type: null })
    try {
      const { data } = await paymentAPI.validateCoupon({
        coupon_code: code,
        plan_id: plan.plan_id,
        total_price: (plan.amount_cents / 100).toFixed(2),
      })
      if (data?.status === 'success') {
        const newCents = Math.round(parseFloat(String(data.amount).replace(/[^0-9.]/g, '')) * 100)
        setFinalCents(newCents || 0)
        setAppliedCoupon({ code, amount: data.amount })
        setCouponMessage({
          text: `Coupon applied! New price: ${currencySymbol}${data.amount}`,
          type: 'success',
        })
      } else {
        setCouponMessage({ text: data?.msg || 'Invalid coupon code', type: 'error' })
      }
    } catch (e) {
      // axios surfaces backend 4xx as e.response.data — surface PSB's
      // actual message ("Invalid Coupon", "Coupon Expired", etc.) when
      // available.
      const msg =
        e?.response?.data?.msg ||
        e?.message ||
        'Could not validate coupon. Try again.'
      setCouponMessage({ text: msg, type: 'error' })
    } finally {
      setCouponApplying(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    // Client-side validation. Same checks the reference does, with the
    // free-checkout escape hatch for $0 amounts.
    setSubmitError('')
    if (!name.trim()) {
      setSubmitError('Please enter your name')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSubmitError('Please enter a valid email address')
      return
    }
    if (!recaptchaToken) {
      setSubmitError('Please verify you are not a robot')
      return
    }

    let sendCardNumber = cardNumber.replace(/\s/g, '')
    let sendExpiry = expiry
    let sendCvv = cvv

    if (paymentMethod === 'card' && !isFreeAfterCoupon) {
      if (sendCardNumber.length < 13) {
        setSubmitError('Please enter a valid card number')
        resetRecaptcha()
        return
      }
      if (sendExpiry.length < 5) {
        setSubmitError('Please enter a valid expiry (MM/YY)')
        resetRecaptcha()
        return
      }
      if (sendCvv.length < 3) {
        setSubmitError('Please enter a valid CVV')
        resetRecaptcha()
        return
      }
    }

    // For $0 checkouts the reference sends placeholder card data because
    // the backend still runs a Luhn check. Mirror that here so the same
    // backend works for both flows.
    if (isFreeAfterCoupon) {
      sendCardNumber = '4242424242424242'
      sendExpiry = '12/30'
      sendCvv = '123'
    }

    setSubmitting(true)
    try {
      const [mm, yy] = sendExpiry.split('/')
      // Identity is derived from the JWT user on the backend, NOT from
      // this payload — so we deliberately don't include name/email here.
      // The locked Name and Email fields exist purely for display; the
      // server uses `Extension<User>` to build the PSB request.
      const payload = {
        plan_id: plan.plan_id,
        gateway_type: paymentMethod === 'card' ? 'stripe' : 'paypal',
        card_number: sendCardNumber,
        month: mm || '',
        year: yy ? '20' + yy : '',
        cvv: sendCvv || '',
        coupon_code: appliedCoupon?.code || '',
        token: recaptchaToken,
      }

      const { data: result } = await paymentAPI.process(payload)

      if (result?.status === 'success') {
        // PayPal path — gateway returns an approval URL; navigate there
        // and PayPal will redirect back to our redirect_url after auth.
        if (payload.gateway_type === 'paypal' && result.payment_redirect_url) {
          window.location.href = result.payment_redirect_url
          return
        }
        // Card path — subscription is queued for activation on PSB's
        // side. Let the parent know so it can clean up its checkoutPlan
        // state, then navigate to the dedicated subscription thanks
        // page (which auto-redirects to /usage/plan after 5s, giving
        // the webhook time to land + EntitlementsContext to refresh).
        // Using `replace: true` so the back button doesn't bring users
        // back to the closed modal.
        onSuccess?.(result)
        navigate('/plan/thanks', { replace: true })
        return
      }

      // Unlikely (success path returns 200) — but if the backend ever
      // returns 200 with `status: error`, surface the message.
      setSubmitError(friendlyPaymentError(result?.msg))
      resetRecaptcha()
    } catch (e) {
      // axios surfaces backend 4xx/5xx as e.response. The backend
      // returns { status:"error", msg } for known-bad inputs (Luhn,
      // CVV, expiry, declined, etc.).
      //
      // We previously had a "$0-after-coupon → treat 4xx as success"
      // branch here, mirroring buy.pabbly.com's reference. The
      // assumption in that reference — that PSB still creates the
      // subscription via webhook even when its own API returns 4xx
      // for a $0 charge — does NOT hold for AgenticAI: we verified
      // against production Mongo that PSB rejects the request without
      // creating a subscription. That branch was therefore silently
      // claiming success when nothing happened, which is exactly the
      // worst possible UX. Removed — every 4xx is now surfaced.
      const resp = e?.response
      const rawMsg = resp?.data?.msg || e?.message
      setSubmitError(friendlyPaymentError(rawMsg))
      resetRecaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Checkout — ${plan.label}`}
      className="fixed inset-0 z-[10500] flex items-start justify-center px-4 py-6 overflow-y-auto bg-black/55 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="relative w-full max-w-[500px] my-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 animate-scale-in">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close checkout"
          className="absolute top-3.5 right-3.5 w-8 h-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors z-10"
        >
          <X size={16} />
        </button>

        <div className="p-6 sm:p-7">
          {/* Header */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-[10px] font-bold uppercase tracking-wider mb-3">
              <ShieldCheck size={11} />
              Secure Checkout
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-1 leading-tight">
              Complete your purchase
            </h3>
            <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
              {plan.label}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {/* In-modal error banner. Errors live HERE rather than in
                react-hot-toast because the modal's z-[10500] sits above
                the toast container — toasts would render behind the
                blurred backdrop and be unreadable. The banner uses the
                same red palette as the validation messages so the
                visual treatment is consistent across the app's error
                surfaces. Dismissable via the small X. */}
            {submitError && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400"
              >
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span className="flex-1 leading-snug">{submitError}</span>
                <button
                  type="button"
                  onClick={() => setSubmitError('')}
                  aria-label="Dismiss error"
                  className="flex-shrink-0 p-0.5 -m-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Name + Email — locked to the logged-in user. */}
            <div className="grid grid-cols-2 gap-3">
              <FieldLocked label="Name" value={name} />
              <FieldLocked label="Email" value={email} />
            </div>

            {/* Payment method tabs */}
            {!isMultiYear ? (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <PaymentTab
                    active={paymentMethod === 'card'}
                    onClick={() => setPaymentMethod('card')}
                  >
                    <CreditCard size={18} />
                    <span>Card</span>
                  </PaymentTab>
                  <PaymentTab
                    active={paymentMethod === 'paypal'}
                    onClick={() => setPaymentMethod('paypal')}
                    ariaLabel={
                      isFreeAfterCoupon
                        ? 'PayPal unavailable for 100% off coupons — remove the coupon to pay with PayPal'
                        : 'Pay with PayPal'
                    }
                    disabled={isFreeAfterCoupon}
                    title={
                      isFreeAfterCoupon
                        ? 'PayPal isn’t available when a coupon zeroes the order. Remove the coupon to use PayPal, or continue with Card.'
                        : undefined
                    }
                  >
                    <PayPalMark className="h-5 w-auto" />
                  </PaymentTab>
                </div>
                {isFreeAfterCoupon && (
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 -mt-1">
                    PayPal isn&rsquo;t available for $0 orders. Continue with
                    Card, or remove the coupon to pay with PayPal.
                  </div>
                )}
              </>
            ) : (
              // Multi-year plans: PSB doesn't support PayPal for multi-year
              // billing cycles. Card-only with a small note.
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 -mt-1">
                Multi-year plans are paid by card. PayPal is only available
                on yearly billing.
              </div>
            )}

            {/* Card fields — hidden when amount is $0 (100%-off coupon) */}
            {paymentMethod === 'card' && !isFreeAfterCoupon && (
              <>
                <Field
                  label="Card number"
                  value={cardNumber}
                  onChange={(v) => setCardNumber(formatCardNumber(v))}
                  placeholder="1234 1234 1234 1234"
                  maxLength={19}
                  inputMode="numeric"
                  autoComplete="cc-number"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Expiry"
                    value={expiry}
                    onChange={(v) => setExpiry(formatExpiry(v))}
                    placeholder="MM/YY"
                    maxLength={5}
                    inputMode="numeric"
                    autoComplete="cc-exp"
                  />
                  <Field
                    label="CVV"
                    value={cvv}
                    onChange={(v) => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                    placeholder="123"
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                  />
                </div>
              </>
            )}

            {/* PayPal copy */}
            {paymentMethod === 'paypal' && (
              <div className="text-[12px] text-neutral-600 dark:text-neutral-400 leading-relaxed bg-neutral-50 dark:bg-neutral-800/40 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-3 text-center">
                You'll be redirected to PayPal to complete your purchase.
              </div>
            )}

            {/* Coupon */}
            {!showCoupon ? (
              <button
                type="button"
                onClick={() => setShowCoupon(true)}
                className="self-start text-xs text-neutral-600 dark:text-neutral-400 hover:text-violet-600 dark:hover:text-violet-400 underline underline-offset-2 decoration-neutral-300 dark:decoration-neutral-600 hover:decoration-violet-500"
              >
                Have a coupon? Click here.
              </button>
            ) : (
              <div className="flex gap-2 min-w-0">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase())
                    if (!appliedCoupon) setCouponMessage({ text: '', type: null })
                  }}
                  disabled={!!appliedCoupon}
                  placeholder="Enter coupon code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="flex-1 min-w-0 h-10 px-3 border-2 border-neutral-200 dark:border-neutral-700 rounded-lg text-sm uppercase font-mono tabular-nums bg-white dark:bg-neutral-900 focus:outline-none focus:border-violet-500 disabled:bg-neutral-100 dark:disabled:bg-neutral-800 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={couponApplying || !!appliedCoupon}
                  className="flex-shrink-0 h-10 px-4 border-2 border-neutral-900 dark:border-neutral-100 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 rounded-lg text-sm font-bold hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-[88px]"
                >
                  {couponApplying ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : appliedCoupon ? (
                    <>
                      Applied <CheckCircle2 size={12} />
                    </>
                  ) : (
                    'Apply'
                  )}
                </button>
              </div>
            )}

            {/* Coupon message — single role=status surface, lives outside
                the input row so the spacing stays clean. */}
            {couponMessage.text && (
              <div
                role="status"
                aria-live="polite"
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  couponMessage.type === 'success'
                    ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/50'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/50'
                }`}
              >
                {couponMessage.text}
              </div>
            )}

            {/* reCAPTCHA — generous vertical breathing room above +
                below so it doesn't crowd the coupon link or the Pay
                button. `mt-5` sits on top of the form's `gap-3.5` for
                ~34px above the captcha block; `mb-2` then gives
                another beat before the Pay button.
                CRITICAL: the container is ALWAYS visible. Google's
                `grecaptcha.render()` silently bails when its target
                has `display: none` (which broke the second-open case
                where loading state hid the slot before render ran).
                Loading + error overlays sit absolutely on top during
                their states; the iframe Google injects sits in the
                same slot underneath and shows through once it
                renders. */}
            <div className="flex flex-col items-center mt-5 mb-2">
              <div className="relative w-[304px] min-h-[78px]">
                {/* Container is always mounted + visible so Google
                    can render its iframe into it on every modal open. */}
                <div
                  ref={recaptchaContainerRef}
                  className="w-full min-h-[78px]"
                />
                {recaptchaStatus === 'loading' && (
                  <div className="absolute inset-0 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 flex items-center justify-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 pointer-events-none">
                    <Loader2 size={14} className="animate-spin" />
                    Loading captcha…
                  </div>
                )}
                {recaptchaStatus === 'error' && (
                  <div className="absolute inset-0 rounded-md border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-center flex flex-col items-center justify-center">
                    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                      <AlertCircle size={13} />
                      Captcha didn't load
                    </div>
                    <button
                      type="button"
                      onClick={retryRecaptcha}
                      className="text-[11px] font-semibold text-violet-700 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 underline underline-offset-2"
                    >
                      Reload captcha
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Pay button. Stays disabled until the reCAPTCHA widget
                fires its callback with a token — defends against
                bot-driven form submission AND tells the user upfront
                that the captcha is the next gating step. The text
                switches to "Verify captcha to continue" so the
                disabled state has an explanation, not just greyed
                pixels. */}
            <button
              type="submit"
              disabled={submitting || !recaptchaToken}
              aria-disabled={submitting || !recaptchaToken}
              className="w-full h-12 mt-1 inline-flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-neutral-300 dark:disabled:bg-neutral-700 disabled:text-neutral-500 dark:disabled:text-neutral-400 text-white font-semibold rounded-xl shadow-sm transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Processing…
                </>
              ) : !recaptchaToken ? (
                <>
                  <ShieldCheck size={14} />
                  Verify captcha to continue
                </>
              ) : paymentMethod === 'paypal' && !isFreeAfterCoupon ? (
                <>Continue with PayPal</>
              ) : (
                <>
                  Pay {currencySymbol}
                  {displayDollars}
                </>
              )}
            </button>

            {/* Trust + footer */}
            <div className="text-center pt-2">
              <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                <span className="h-px bg-neutral-200 dark:bg-neutral-700 w-10" />
                <Lock size={10} />
                <span>Trusted &amp; Secured</span>
                <span className="h-px bg-neutral-200 dark:bg-neutral-700 w-10" />
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 space-x-2">
                <a
                  href="https://www.pabbly.com/privacy-policy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-violet-600 dark:hover:text-violet-400 hover:underline"
                >
                  Privacy Policy
                </a>
                <span>•</span>
                <a
                  href="https://www.pabbly.com/terms-conditions/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-violet-600 dark:hover:text-violet-400 hover:underline"
                >
                  Terms &amp; Conditions
                </a>
              </div>
            </div>
          </form>
        </div>

        {/* Loader overlay — sits above the form so the user can't double-
            submit or edit fields mid-charge. */}
        {submitting && (
          <div className="absolute inset-0 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm rounded-2xl flex items-center justify-center z-20">
            <div className="text-center">
              <Loader2
                size={32}
                className="animate-spin text-violet-500 mx-auto mb-3"
              />
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Processing your payment…
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Please don't close this window.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── Inputs ──────────────────────────────────────────────────────────────

function Field({ label, value, onChange, ...inputProps }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 px-3 border-2 border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-shadow"
        {...inputProps}
      />
    </label>
  )
}

function FieldLocked({ label, value }) {
  // Read-only inputs styled to look obviously disabled. Backed by the
  // server-side `purchase_intent` token (when wired up) for the actual
  // anti-misuse enforcement — visual lock is the UX hint, not the lock
  // itself.
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
        {label}
        <Lock size={9} className="text-neutral-400 dark:text-neutral-500" />
      </span>
      <input
        type="text"
        value={value || ''}
        readOnly
        tabIndex={-1}
        aria-readonly="true"
        title={`Locked to your account ${label.toLowerCase()} — contact support to change.`}
        className="h-10 px-3 border-2 border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 cursor-not-allowed select-none"
      />
    </label>
  )
}

// ─── Payment method tab ──────────────────────────────────────────────────

function PaymentTab({ children, active, onClick, ariaLabel, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={`h-12 inline-flex items-center justify-center gap-2 px-4 rounded-lg text-sm font-semibold transition-all border-2 ${
        disabled
          ? 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 text-neutral-400 dark:text-neutral-500 cursor-not-allowed opacity-60'
          : active
            ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 shadow-sm'
            : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600'
      }`}
    >
      {children}
    </button>
  )
}
