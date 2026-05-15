import { useEffect, useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, AlertTriangle, Coins, Loader2, ArrowRight } from 'lucide-react'
import { creditsAPI } from '../services/api'

// Poll interval + max polls: 2s × 30 = 60s total before we show the generic
// "should arrive shortly" message. Webhooks from Pabbly typically arrive in
// <5s, so this is ample.
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 30

export default function ThanksPage() {
  const [searchParams] = useSearchParams()
  const invoiceId = searchParams.get('invoice_id') || ''
  const [state, setState] = useState(invoiceId ? 'polling' : 'no_invoice')
  // result shape: { credits, email, pabbly_plan_id }
  const [result, setResult] = useState(null)
  const pollsRef = useRef(0)

  useEffect(() => {
    if (!invoiceId) return

    let cancelled = false
    let timer = null

    const poll = async () => {
      if (cancelled) return
      pollsRef.current += 1
      try {
        const res = await creditsAPI.getInvoiceStatus(invoiceId)
        const data = res.data || {}
        if (data.state === 'credited') {
          setResult({ credits: data.credits, pabbly_plan_id: data.pabbly_plan_id })
          setState('credited')
          return
        }
        if (data.state === 'pending') {
          setResult({ credits: data.credits, email: data.email, pabbly_plan_id: data.pabbly_plan_id })
          setState('pending')
          return
        }
        // state === 'unknown' — keep polling
        if (pollsRef.current >= MAX_POLLS) {
          setState('timeout')
          return
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      } catch {
        if (pollsRef.current >= MAX_POLLS) {
          setState('timeout')
          return
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [invoiceId])

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#1e1e1e] px-4">
      <div className="w-full max-w-md bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-2xl p-8 shadow-xl">
        {state === 'credited' && <CreditedView result={result} />}
        {state === 'pending' && <PendingView result={result} />}
        {state === 'polling' && <PollingView />}
        {(state === 'timeout' || state === 'no_invoice') && <TimeoutView />}
      </div>
    </div>
  )
}

function CreditedView({ result }) {
  const credits = result?.credits ?? 0
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Payment successful</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
        <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
          <Coins className="w-4 h-4" /> {credits.toLocaleString()} credits
        </span>
        {' '}have been added to your account.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-700 text-white text-sm font-medium hover:bg-neutral-800 dark:hover:bg-neutral-600 transition-colors"
        >
          Back to workflows <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          to="/usage/credits"
          className="inline-flex items-center justify-center w-full py-2 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          View credit history
        </Link>
      </div>
    </div>
  )
}

function PendingView({ result }) {
  const credits = result?.credits ?? 0
  const email = result?.email || 'the purchasing email'
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
        <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
      </div>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Payment received — one more step</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 leading-relaxed">
        We received your payment for{' '}
        <span className="font-semibold text-amber-600 dark:text-amber-400">{credits.toLocaleString()} credits</span>,
        but we couldn't find an account for{' '}
        <span className="font-mono text-xs px-1 py-0.5 bg-neutral-100 dark:bg-[#383838] rounded">{email}</span>.
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
        Please sign up with <strong>the same email address</strong> and your credits will be applied automatically.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          to="/register"
          className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          Create your account <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center justify-center w-full py-2 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Already registered? Log in
        </Link>
      </div>
    </div>
  )
}

function PollingView() {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-full bg-neutral-100 dark:bg-[#383838] flex items-center justify-center mx-auto mb-4">
        <Loader2 className="w-7 h-7 text-neutral-500 animate-spin" />
      </div>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Confirming your payment…</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        This usually takes a few seconds. Please keep this page open.
      </p>
    </div>
  )
}

function TimeoutView() {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-full bg-neutral-100 dark:bg-[#383838] flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-7 h-7 text-neutral-500" />
      </div>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Thanks for your purchase</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
        Your credits should arrive within a minute. If they don't appear on the Credits page after a refresh, please contact support.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          to="/usage/credits"
          className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-700 text-white text-sm font-medium hover:bg-neutral-800 dark:hover:bg-neutral-600 transition-colors"
        >
          Check credit balance <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center w-full py-2 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
