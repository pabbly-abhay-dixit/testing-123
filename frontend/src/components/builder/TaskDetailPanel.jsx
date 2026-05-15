import { useState, useEffect, useCallback, useRef } from 'react'
import { Clock, RotateCcw, Coins, Gauge } from 'lucide-react'
import { taskHistoryAPI } from '../../services/api'
import { formatDuration, formatTimeAgo, statusIcon, stepStatusIcon, parseStepResults, PreBlock, PreBlockToolbar } from './taskHistoryUtils.jsx'
import { applyStaleOverride } from '../../utils/runTimeout'
import Tooltip from '../ui/Tooltip'
import toast from 'react-hot-toast'

/**
 * Attempt to parse a multi-line "KEY: value" payload into a structured
 * object. Our code-step convention emits output like:
 *   PDF_URL: https://...
 *   IMAGE_URL: https://...
 *   DESCRIPTION: A futuristic city at night...
 * which deserves rendering as real JSON keys, not wrapped as a single
 * stringified blob.
 *
 * Rules (all must hold for a successful parse):
 *   - Every non-blank line matches `<KEY>: <value>` where <KEY> is a
 *     JS-identifier-ish token (letter-led, alphanumeric + underscore/dash)
 *   - At least one such line exists
 *   - Only the FIRST colon on a line splits key/value, so values may
 *     contain colons (URLs like `https://...` work naturally)
 *
 * Returns the parsed object, or null if the string doesn't fit the shape.
 */
const tryParseKeyValueText = (text) => {
  if (typeof text !== 'string') return null
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const kvRegex = /^([A-Z][A-Z0-9_-]{1,30})\s*:\s*(.*)$/  // ALL-CAPS keys only (CITY, COUNTRY, ...) so URLs/sentences don't false-match
  const result = {}
  const preamble = []
  let currentKey = null
  for (const line of lines) {
    const m = line.match(kvRegex)
    if (m) {
      currentKey = m[1]
      result[currentKey] = m[2]
    } else if (currentKey) {
      // Continuation line for the previous key (e.g. multi-line DETAILS).
      result[currentKey] = (result[currentKey] ? result[currentKey] + ' ' : '') + line
    } else {
      // Lines that appear BEFORE the first KEY: match — model preamble like
      // "I'll analyze the image from the provided URL.". Stash separately
      // so the structured fields stay clean; surface only if there are real
      // KV pairs to render.
      preamble.push(line)
    }
  }
  // Require at least 2 real KV pairs (≥3 if there's a preamble) to call
  // this a structured response — otherwise it's prose and the wrapper-as-
  // string display path is more appropriate. Preamble (any text before the
  // first KEY: line — e.g. Claude's "I'll analyze the image from…" filler)
  // is intentionally discarded; the structured KV pairs are what the
  // workflow author wanted to surface, not the model's filler narration.
  const minPairs = preamble.length > 0 ? 3 : 2
  if (Object.keys(result).length < minPairs) return null
  return result
}

/**
 * Normalize any value into a JSON-stringifiable shape so every Task Detail
 * pane (Input / Output / Error) renders as pretty-printed JSON.
 *
 *   object/array            → returned as-is (already JSON)
 *   string that parses as JSON → parsed so objects pretty-print, not escaped
 *   string matching KEY: val  → structured object (see tryParseKeyValueText)
 *   string otherwise        → wrapped as { [wrapperKey]: string }
 *   primitive / null        → wrapped as { [wrapperKey]: value } (or {} for null)
 */
const toJsonDisplay = (value, wrapperKey = 'data') => {
  if (value === undefined || value === null) return {}
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try {
        const parsed = JSON.parse(value)
        if (parsed !== null && typeof parsed === 'object') return parsed
      } catch { /* not JSON — try other patterns */ }
    }
    const kv = tryParseKeyValueText(value)
    if (kv) return kv
    return { [wrapperKey]: value }
  }
  return { [wrapperKey]: value }
}

const toJsonString = (value, wrapperKey) =>
  JSON.stringify(toJsonDisplay(value, wrapperKey), null, 2)

// Mirror of StepsPanel's AI-badge detection. A step is "AI" if its declared
// step_type is 'ai' OR it's a code step whose code_body imports pabbly-llm —
// at runtime the __trackedReq wrapper meters those LLM calls identically to
// AI steps, so they should display the same badge. Without this match, every
// new (unified-code-authoring) step lands here as step_type='code' and the
// task-history badge silently disagrees with the steps panel.
const PABBLY_LLM_PATTERN = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"]pabbly-llm['"]/
const codeImportsPabblyLLM = (code) => typeof code === 'string' && PABBLY_LLM_PATTERN.test(code)

/** Render `text` with case-insensitive `term` occurrences wrapped in <mark>.
 *  Two visual tiers — every match gets a light amber background; the match at
 *  `currentIdx` gets a brighter amber + ref so it can be scrolled into view.
 *  Returns { nodes, count } so the caller can wire Enter-to-advance. */
function highlightMatches(text, term, currentIdx, currentRef) {
  if (!term || !text) return { nodes: text, count: 0 }
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  const out = []
  let pos = 0
  let key = 0
  let matchIdx = 0
  while (pos < text.length) {
    const found = lowerText.indexOf(lowerTerm, pos)
    if (found === -1) {
      out.push(text.slice(pos))
      break
    }
    if (found > pos) out.push(text.slice(pos, found))
    const isCurrent = matchIdx === currentIdx
    out.push(
      <mark
        key={key++}
        ref={isCurrent ? currentRef : null}
        // Translucent backgrounds — the original text color stays visible
        // through the highlight. Current match is denser + outlined.
        className={
          isCurrent
            ? 'rounded-sm outline outline-1 outline-amber-500/80 bg-transparent'
            : 'rounded-sm bg-transparent'
        }
        style={{
          backgroundColor: isCurrent
            ? 'rgba(245, 158, 11, 0.7)'
            : 'rgba(252, 211, 77, 0.45)',
          color: 'inherit',
        }}
      >
        {text.slice(found, found + term.length)}
      </mark>
    )
    pos = found + term.length
    matchIdx++
  }
  return { nodes: out, count: matchIdx }
}

/** Tabbed Input / Output / Error view for a single step's data */
function StepDataTabs({ step, stepIndex, displaySteps, run, rawOutput, displayOutput }) {
  const [activeTab, setActiveTab] = useState(() => {
    const isFailed = step.status === 'failed'
    if (step.output && !isFailed) return 'output'
    if (isFailed && (step.error || step.output)) return 'error'
    return 'input'
  })
  const [wrap, setWrap] = useState(true) // default wrapped
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentIdx, setCurrentIdx] = useState(0)
  const currentMatchRef = useRef(null)
  const searchBoxRef = useRef(null)

  // Click outside the inline search box collapses it back to a button.
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setSearchOpen(false)
        setSearchTerm('')
        setCurrentIdx(0)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  // Reset the active match when switching tabs — the new pane starts at match 0
  useEffect(() => { setCurrentIdx(0) }, [activeTab])

  // Scroll the active match into view whenever it changes
  useEffect(() => {
    if (currentMatchRef.current) {
      currentMatchRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [currentIdx, searchTerm])

  // Build input — scope to ONLY what's relevant for this step position:
  //   Step 1 → the webhook payload (no wrapper)
  //   Step N (N>=2) → the immediately prior step's output (no webhook, no
  //                   map of all prior steps — just the one that matters)
  //
  // Sources, in priority order:
  //   1. step.input (populated by handle_step_started — authoritative)
  //   2. Cross-step search (for steps still 'pending' during live execution,
  //      step.input is not yet populated — borrow webhook from any sibling
  //      step that has it, since every step shares the same webhook payload)
  //   3. Legacy rebuild from run.webhook_data / prior step outputs (for
  //      pre-callback-era rows and orchestrator-path rows)
  let inputObj = undefined

  if (stepIndex === 0) {
    // Step 1: webhook payload only
    if (step?.input && typeof step.input === 'object' && 'webhook' in step.input) {
      inputObj = step.input.webhook
    } else {
      // Scan siblings for a populated step.input.webhook (handles the live-run
      // case where step 1 is still 'pending' but later steps already started
      // and carry the same webhook in their step.input)
      for (const s of displaySteps) {
        if (s?.input && typeof s.input === 'object' && 'webhook' in s.input) {
          inputObj = s.input.webhook
          break
        }
      }
      // Legacy fallback
      if (inputObj === undefined && run.webhook_data) {
        try { inputObj = typeof run.webhook_data === 'string' ? JSON.parse(run.webhook_data) : run.webhook_data }
        catch { inputObj = run.webhook_data }
      }
    }
  } else {
    // Step N: just the immediately prior step's output
    const prev = displaySteps[stepIndex - 1]
    const prevName = prev?.step_name || prev?.name
    if (step?.input?.previous_steps && typeof step.input.previous_steps === 'object'
        && prevName && prevName in step.input.previous_steps) {
      inputObj = step.input.previous_steps[prevName]
    } else if (prev?.output != null && prev.output !== '') {
      let parsed = prev.output
      try { parsed = JSON.parse(prev.output) } catch {}
      inputObj = parsed
    }
  }

  // Normalize empty/missing → {} so the Input tab still renders and the user
  // sees at minimum "no data yet" shape instead of the tab disappearing
  if (inputObj === undefined || inputObj === null) inputObj = {}

  // Input/Output/Error always render as JSON. Non-JSON strings get wrapped
  // in a {data: ...} / {error: ...} envelope so the pane always looks the
  // same regardless of step type or data shape.
  const formattedInput = toJsonString(inputObj, 'data')

  const isFailed = step.status === 'failed'
  const rawFailure = isFailed ? (step.error || step.output || '') : ''
  const failureText = rawFailure ? toJsonString(rawFailure, 'error') : ''
  const hasOutput = step.output && !isFailed
  const hasError = isFailed && !!failureText
  const tabs = [
    { id: 'input', label: 'Input', available: !!formattedInput, tip: 'Data passed into this step — webhook payload merged with prior steps’ outputs' },
    { id: 'output', label: 'Output', available: hasOutput, tip: 'Data this step produced and passed on to the next step' },
    { id: 'error', label: 'Error', available: hasError, tip: 'Error message thrown by this step — explains why it failed' },
  ].filter(t => t.available)

  if (tabs.length === 0) return null

  const resolvedTab = tabs.find(t => t.id === activeTab) ? activeTab : tabs[0].id

  return (
    <div className="mx-2 mb-1.5 ml-6 rounded-lg overflow-hidden border border-neutral-700/50" style={{ background: '#0d1117' }}>
      {/* Tab bar with Wrap/Copy controls */}
      <div className="flex items-center border-b border-neutral-700/50">
        {tabs.map(tab => (
          <Tooltip key={tab.id} content={tab.tip}>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id) }}
              className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                resolvedTab === tab.id
                  ? tab.id === 'error'
                    ? 'text-red-400 border-b-2 border-red-400'
                    : tab.id === 'output'
                      ? 'text-emerald-400 border-b-2 border-emerald-400'
                      : 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          </Tooltip>
        ))}
        {(() => {
          // Compute the active pane's text and the highlighted nodes once so
          // PreBlockToolbar gets a real match count and the <pre> reuses the
          // same nodes — and the Enter handler can wrap on the same count.
          const activeText = resolvedTab === 'input' ? formattedInput
            : resolvedTab === 'output' ? displayOutput
            : failureText
          const { count } = searchTerm
            ? highlightMatches(activeText, searchTerm, currentIdx, currentMatchRef)
            : { count: 0 }
          return (
            <PreBlockToolbar
              wrap={wrap}
              onToggleWrap={() => setWrap(w => !w)}
              searchOpen={searchOpen}
              onToggleSearch={() => {
                setSearchOpen(o => !o)
                if (searchOpen) { setSearchTerm(''); setCurrentIdx(0) }
              }}
              searchTerm={searchTerm}
              onSearchTermChange={(v) => { setSearchTerm(v); setCurrentIdx(0) }}
              onSearchKeyDown={(e) => {
                if (e.key === 'Enter' && count > 0) {
                  e.preventDefault()
                  setCurrentIdx(i => e.shiftKey ? (i - 1 + count) % count : (i + 1) % count)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearchOpen(false)
                  setSearchTerm('')
                  setCurrentIdx(0)
                }
              }}
              matchCount={count}
              currentMatchIdx={currentIdx}
              searchBoxRef={searchBoxRef}
              copyText={activeText}
            />
          )
        })()}
      </div>

      {/* Tab content — highlights run against the active pane only. */}
      {(() => {
        const activeText = resolvedTab === 'input' ? formattedInput
          : resolvedTab === 'output' ? displayOutput
          : failureText
        const activeColor = resolvedTab === 'error' ? '#f85149' : '#e6edf3'
        const { nodes } = searchTerm
          ? highlightMatches(activeText, searchTerm, currentIdx, currentMatchRef)
          : { nodes: activeText }
        return (
          <div>
            <pre
              className={`px-3 py-3 text-[12px] font-mono max-h-64 overflow-auto leading-relaxed ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
              style={{ color: activeColor }}
            >{nodes}</pre>
          </div>
        )
      })()}
    </div>
  )
}

const TaskDetailPanel = ({ runId, runMeta = null, agent, steps = [], activeExecution, onTrackExecution, switchingProvider = false }) => {
  const [run, setRun] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [fetchAttempt, setFetchAttempt] = useState(0) // bump to retry
  const [expandedStep, setExpandedStep] = useState(null)
  const [reExecuting, setReExecuting] = useState(false)
  const [, setTick] = useState(0)
  // Per-step input/output cache. The run-level fetch runs in `lite` mode
  // (see `getStatus({ lite: true })` calls below) which strips heavy `input`
  // / `output` strings from each step in `step_results`. When the user
  // expands a step row we hit `getStepDetail` for just that one step — this
  // map memoizes the response so re-expanding the same row is instant.
  // Keyed by step index. Reset whenever `runId` changes.
  const [stepDetails, setStepDetails] = useState(() => new Map())
  const [stepFetching, setStepFetching] = useState(() => new Set())
  const [stepFetchError, setStepFetchError] = useState(() => new Map())

  // Does BuilderPage already have live data for this runId? If so we can
  // render immediately from activeExecution (no skeleton, no fetch-hang
  // under load) and piggyback on its 1.5s poll instead of running our own.
  const hasActiveData = activeExecution?.runId === runId

  // Synthetic "run" built from activeExecution when BuilderPage is tracking
  // this same run. Covers the fields TaskDetailPanel renders from; fields
  // only available via fetch (webhook_data, error, credits_used,
  // units_charged, created_at, completed_at) stay null until the background
  // fetch lands.
  const syntheticRun = hasActiveData ? {
    id: runId,
    status: activeExecution.status,
    step_results: JSON.stringify(activeExecution.step_results || []),
    duration_ms: activeExecution.duration_ms || 0,
    webhook_data: null,
    credits_used: null,
    units_charged: null,
    error: null,
    created_at: null,
    completed_at: null,
  } : null

  // Fetch run data with a 15s timeout. AbortController cancels on unmount,
  // runId change, or timeout. Timeout prevents the skeleton hanging forever
  // when the browser's 6-conn-per-origin limit is saturated by the chat
  // SSE stream + other polling.
  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)
    // Clear state from the previously-selected run BEFORE starting the new
    // fetch. Without this reset, the panel briefly shows the old run's
    // data stamped with the new runId while the new fetch is in flight —
    // making it unclear to the user whether they're looking at the row
    // they just clicked or the previous one. Skeleton + retry state also
    // re-anchor to the new runId.
    setRun(null)
    setFetchError(null)
    setExpandedStep(null)
    // Drop the previous run's per-step cache — indices belong to a different
    // run now and the heavy bodies could leak across rows otherwise.
    setStepDetails(new Map())
    setStepFetching(new Set())
    setStepFetchError(new Map())

    taskHistoryAPI.getStatus(runId, { lite: true, signal: controller.signal })
      .then(res => {
        clearTimeout(timeoutId)
        if (!controller.signal.aborted) setRun(applyStaleOverride(res.data))
      })
      .catch(err => {
        clearTimeout(timeoutId)
        // Don't surface an error for explicit cancellations (component
        // unmount / runId switch) — those are intentional, not failures.
        const isCanceled = err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED'
        if (!isCanceled) setFetchError(err?.message || 'Failed to load')
      })

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [runId, fetchAttempt])

  // Mirror activeExecution → run when BuilderPage has live data for this
  // runId. Lets per-step progress flow in without our own fetch. Only
  // overwrites fields activeExecution actually carries; preserves
  // fetched-only fields (webhook_data, error, credits_used, units_charged)
  // from `run`.
  useEffect(() => {
    if (!hasActiveData) return
    setRun(prev => {
      const base = prev || syntheticRun
      if (!base) return prev
      return {
        ...base,
        status: activeExecution.status,
        step_results: JSON.stringify(activeExecution.step_results || []),
        duration_ms: activeExecution.duration_ms ?? base.duration_ms,
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tracking primitive activeExecution fields, not the object identity
  }, [hasActiveData, activeExecution?.status, activeExecution?.step_results, activeExecution?.duration_ms])

  // Fallback 3s poll for runs NOT being tracked by BuilderPage (historical
  // executing runs, or runs triggered externally). When hasActiveData is
  // true, BuilderPage's 1.5s poll already keeps activeExecution fresh and
  // the mirror effect above feeds it into `run` — no need for our own.
  useEffect(() => {
    if (!runId || !run || run.status !== 'executing' || hasActiveData) return
    const id = setInterval(() => {
      // Same lite mode as the initial fetch — progress polling only needs
      // step status + duration, not the bodies.
      taskHistoryAPI.getStatus(runId, { lite: true }).then(res => setRun(applyStaleOverride(res.data))).catch(() => {})
    }, 3000)
    return () => clearInterval(id)
  }, [runId, run?.status, hasActiveData])

  // Lazy-load a single step's input + output. Cached in `stepDetails` so
  // repeat expand/collapse of the same row is instant. Errors are kept in
  // `stepFetchError` so the row can render a retry hint.
  const fetchStepDetail = useCallback((stepIndex) => {
    if (!runId || stepDetails.has(stepIndex) || stepFetching.has(stepIndex)) return
    setStepFetching(prev => {
      const next = new Set(prev)
      next.add(stepIndex)
      return next
    })
    taskHistoryAPI.getStepDetail(runId, stepIndex)
      .then(res => {
        setStepDetails(prev => {
          const next = new Map(prev)
          next.set(stepIndex, {
            input: res.data?.input ?? null,
            output: res.data?.output ?? null,
            error: res.data?.error ?? null,
          })
          return next
        })
        setStepFetchError(prev => {
          if (!prev.has(stepIndex)) return prev
          const next = new Map(prev)
          next.delete(stepIndex)
          return next
        })
      })
      .catch(() => {
        setStepFetchError(prev => {
          const next = new Map(prev)
          next.set(stepIndex, 'Failed to load step detail')
          return next
        })
      })
      .finally(() => {
        setStepFetching(prev => {
          if (!prev.has(stepIndex)) return prev
          const next = new Set(prev)
          next.delete(stepIndex)
          return next
        })
      })
  }, [runId, stepDetails, stepFetching])

  // Tick for elapsed timer
  const isLive = activeExecution?.runId === runId && activeExecution?.status === 'executing'
  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [isLive])

  const stepElapsed = activeExecution?.stepStartedAt
    ? Math.floor((Date.now() - activeExecution.stepStartedAt) / 1000)
    : 0

  const handleReExecute = async () => {
    if (!agent?.user_id || !agent?.id || !run) return
    setReExecuting(true)
    try {
      let payload = {}
      try {
        payload = typeof run.webhook_data === 'string' ? JSON.parse(run.webhook_data) : (run.webhook_data || {})
      } catch { payload = {} }
      const API_BASE = import.meta.env.VITE_API_URL || ''
      const resp = await fetch(`${API_BASE}/api/webhook/${agent.user_id}/${agent.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pabbly-test': 'true' },
        body: JSON.stringify(payload),
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok && data.run_id) {
        if (onTrackExecution) onTrackExecution(data.run_id)
      } else {
        toast.error(data.error || 'Re-execute failed')
      }
    } catch {
      toast.error('Re-execute failed')
    } finally {
      setReExecuting(false)
    }
  }

  // Prefer fetched `run` (richer); fall back to synthetic from live data
  // when the fetch is still pending. This is the key to not flashing a
  // skeleton when the user clicks the currently-running task.
  const effectiveRun = run || syntheticRun

  // Skeleton only when we have NO data at all — neither fetched nor live.
  // Covers the "historical run, fetch still in flight" case.
  if (!effectiveRun && !fetchError) {
    return (
      <div className="animate-pulse">
        {/* Header row: [badge] duration · steps   ↻ */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-200 dark:border-[#484848]">
          <div className="h-6 w-14 rounded-md bg-neutral-200 dark:bg-[#3a3a3a]" />
          <div className="h-3.5 w-24 rounded bg-neutral-100 dark:bg-[#333]" />
          <div className="ml-auto h-6 w-6 rounded-md bg-neutral-100 dark:bg-[#333]" />
        </div>
        {/* Step rows */}
        <div className="p-3 space-y-2">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex items-center gap-2 px-2 py-2 rounded-md">
              <div className="h-3 w-3 rounded bg-neutral-100 dark:bg-[#333]" />
              <div className="h-3.5 w-3.5 rounded-full bg-neutral-200 dark:bg-[#3a3a3a]" />
              <div className="h-3.5 w-4 rounded bg-neutral-100 dark:bg-[#333]" />
              <div className="h-3.5 flex-1 rounded bg-neutral-200 dark:bg-[#3a3a3a]" />
              <div className="h-4 w-11 rounded-full bg-neutral-100 dark:bg-[#333] flex-shrink-0" />
              <div className="h-3.5 w-10 rounded bg-neutral-100 dark:bg-[#333] flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error/timeout state — offer a retry. Only shown when the fetch failed
  // AND we have no live data to fall back on. If live data exists, we
  // render it below even if the fetch errored.
  if (!effectiveRun && fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-6 gap-3">
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">Couldn't load this task's details.</p>
        <button
          onClick={() => setFetchAttempt(a => a + 1)}
          className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-neutral-200 dark:border-[#484848] hover:bg-neutral-50 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!effectiveRun) {
    return <div className="flex items-center justify-center h-32 text-neutral-400 text-xs">Task not found</div>
  }

  const stepResults = parseStepResults(effectiveRun)
  const liveResults = isLive ? (activeExecution?.step_results || []) : stepResults
  const displaySteps = isLive && steps.length > 0
    ? steps.map((s, i) => {
        const result = liveResults.find(r => r.step_name === s.name)
        return result || {
          step_name: s.name,
          step_type: s.step_type || s.type,
          status: 'pending',
          output: '',
          duration_ms: 0,
        }
      })
    : liveResults

  const isBYOK = agent?.config?.use_system_model === false
  const statusLabel = effectiveRun.status === 'completed' ? 'Success' : effectiveRun.status === 'failed' ? 'Failed' : effectiveRun.status === 'executing' ? 'Running' : effectiveRun.status
  const stepCount = displaySteps.length
  const passedCount = displaySteps.filter(s => s.status === 'success' || s.status === 'completed').length

  // Re-execute uses the fetched-only `webhook_data` field, so only enable
  // the button once the fetch has actually landed. Synthetic data (from
  // activeExecution) doesn't carry webhook_data.
  const canReExecute = !!(run && (effectiveRun.status === 'completed' || effectiveRun.status === 'failed'))

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Header — single row ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-200 dark:border-[#484848]">
        <Tooltip content={
          effectiveRun.status === 'completed' ? 'All steps finished without errors'
          : effectiveRun.status === 'failed' ? (effectiveRun.error ? `Failed: ${String(effectiveRun.error).slice(0, 80)}` : 'One or more steps errored out')
          : effectiveRun.status === 'executing' ? 'Run is still in progress'
          : ''
        } className="flex-shrink-0">
          <span className={`text-[12px] font-bold px-2.5 py-1 rounded-md cursor-default ${
            effectiveRun.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
            : effectiveRun.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
            : effectiveRun.status === 'executing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'bg-neutral-100 dark:bg-[#484848] text-neutral-500'
          }`}>
            {statusLabel}
          </span>
        </Tooltip>
        <div className="flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400 min-w-0">
          {effectiveRun.duration_ms > 0 && (() => {
            // Prefer the run row's own timestamps; fall back to the list-row
            // meta the parent passes in (the single-run GET historically
            // omits these fields, so meta is the only source until that
            // backend change is deployed).
            const createdAt = effectiveRun.created_at || runMeta?.created_at
            const completedAt = effectiveRun.completed_at || runMeta?.completed_at
            const start = createdAt ? new Date(createdAt) : null
            const end = completedAt
              ? new Date(completedAt)
              : (start ? new Date(start.getTime() + effectiveRun.duration_ms) : null)
            const fmt = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            const tip = start && end ? `Start: ${fmt(start)} · End: ${fmt(end)}` : 'Total run duration'
            return (
              <Tooltip content={tip} className="flex-shrink-0">
                <span className="inline-flex items-center gap-0.5 cursor-default"><Clock size={12} /> {formatDuration(effectiveRun.duration_ms)}</span>
              </Tooltip>
            )
          })()}
          <Tooltip content="Steps that finished successfully out of total" className="flex-shrink-0">
            <span className="cursor-default">· {passedCount}/{stepCount} steps</span>
          </Tooltip>
          {!isBYOK && typeof effectiveRun.credits_used === 'number' && effectiveRun.credits_used > 0 && (
            <Tooltip content={`${effectiveRun.credits_used.toFixed(4)} AI credits`} position="left">
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 flex-shrink-0">
                <Coins size={11} /> -{effectiveRun.credits_used < 0.01 ? '<0.01' : effectiveRun.credits_used.toFixed(2)}
              </span>
            </Tooltip>
          )}
          {typeof effectiveRun.units_charged === 'number' && effectiveRun.units_charged > 0 && (
            <Tooltip content={`${effectiveRun.units_charged} compute unit${effectiveRun.units_charged === 1 ? '' : 's'} (1 unit ≈ 30 s runtime)`} position="bottom">
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 flex-shrink-0">
                <Gauge size={11} /> -{effectiveRun.units_charged} CU
              </span>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex-shrink-0">
          {canReExecute && (
            <Tooltip content="Re-run with the same input" position="left">
              <button
                onClick={handleReExecute}
                disabled={reExecuting || switchingProvider}
                aria-label="Re-run with the same input"
                className="p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-neutral-100 dark:hover:bg-[#383838] transition-colors disabled:opacity-50"
              >
                {reExecuting
                  ? <div className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                  : <RotateCcw size={14} />
                }
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Run-level error ── */}
      {effectiveRun.error && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg text-[12px] font-mono whitespace-pre-wrap break-words" style={{ background: '#1c0d0d', color: '#f85149' }}>
          {effectiveRun.error}
        </div>
      )}

      {/* ── Steps ── */}
      <div className="p-3 space-y-0">
        {displaySteps.map((step, i) => {
          const isStepExpanded = expandedStep === i
          const isLast = i === displaySteps.length - 1
          const rawOutput = typeof step.output === 'string' ? step.output : JSON.stringify(step.output || '', null, 2)
          // Always render as JSON. If output parses as JSON object/array → pretty-print it.
          // If it's a plain string (e.g. "IMAGE_URL: ...") → wrap as {"output": "..."}
          // so the pane is visually consistent across steps and step types.
          const displayOutput = rawOutput ? toJsonString(rawOutput, 'output') : ''

          const connector = isLast ? '└' : '├'

          const explicitType = step.step_type || step.type
          const hasTokens = step.tokens && (Number(step.tokens.input || 0) > 0 || Number(step.tokens.output || 0) > 0)
          // Resolve the agent-step doc that backs this run-step so we can
          // peek at its code_body. The step_started callback only carries
          // {step_name, step_type, input, ...} — code_body is never on the
          // wire — so we match by name against the live `steps` prop.
          const stepName = step.step_name || step.name
          const matchingAgentStep = stepName ? steps.find((s) => s.name === stepName) : null
          // Prefer the server-side `uses_llm` flag from the lite list response.
          // Fallback to the regex on `code_body` for chat-parsed steps that
          // haven't been hydrated via stepsAPI.getOne yet.
          const codeImportsLLM = matchingAgentStep?.uses_llm === true
            || codeImportsPabblyLLM(matchingAgentStep?.code_body)
          const isAI = explicitType === 'ai'
            || codeImportsLLM
            || (!explicitType && (hasTokens || (typeof step.credits_used === 'number' && step.credits_used > 0)))

          // If the parent run is terminal (failed/completed) but this step still
          // shows 'running', the VM crashed before step_finished landed — treat as failed.
          const runTerminal = effectiveRun.status === 'failed' || effectiveRun.status === 'completed'
          const effectiveStepStatus = step.status === 'running' && runTerminal ? 'failed' : step.status

          // Merge lazy-loaded body fields if we've already fetched this step.
          // `step` from `step_results` has only metadata in lite mode; the
          // cached entry adds `input` / `output` / `error`.
          const cached = stepDetails.get(i)
          const enrichedStep = cached
            ? { ...step, input: cached.input ?? step.input, output: cached.output ?? step.output, error: cached.error ?? step.error }
            : step
          const isFetchingThisStep = stepFetching.has(i)
          const stepLoadError = stepFetchError.get(i)

          return (
            <div key={i}>
              <button
                onClick={() => {
                  const opening = !isStepExpanded
                  setExpandedStep(isStepExpanded ? null : i)
                  // Fetch on first expand only — cache covers re-opens.
                  if (opening) fetchStepDetail(i)
                }}
                className="w-full flex items-center text-left px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors group rounded"
              >
                <span className="text-neutral-300 dark:text-neutral-600 font-mono text-[12px] w-4 flex-shrink-0 select-none">{connector}─</span>
                <div className="flex-shrink-0 mx-1.5">{stepStatusIcon(effectiveStepStatus)}</div>
                <span className="text-[12px] font-mono font-bold text-neutral-400 dark:text-neutral-500 flex-shrink-0 mr-1.5 tabular-nums">{i + 1}.</span>
                <Tooltip content={isStepExpanded ? 'Click to hide step input & output' : 'Click to see this step’s input & output'} delay={250} className="flex-1 min-w-0">
                  <span className="text-[13px] text-neutral-700 dark:text-neutral-300 min-w-0 truncate group-hover:text-neutral-900 dark:group-hover:text-neutral-100 transition-colors">
                    {step.step_name || step.name || `Step ${i + 1}`}
                  </span>
                </Tooltip>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Tooltip content={isAI ? 'AI step — ran an LLM call; consumes AI Credits on Pabbly Provider' : 'Non-AI step — deterministic code only; no LLM call, no AI Credits consumed'}>
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full cursor-default ${isAI ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'}`}>
                      {isAI ? 'AI' : 'Non-AI'}
                    </span>
                  </Tooltip>
                  <Tooltip content={`Time this step took to execute${effectiveStepStatus === 'running' ? ' (still running)' : ''}`}>
                    <span className="text-[12px] text-neutral-400 dark:text-neutral-300 tabular-nums inline-flex items-center gap-0.5 w-[3.5rem] cursor-default">
                      <Clock size={11} className="text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
                      {effectiveStepStatus === 'running' ? `${stepElapsed}s` : formatDuration(step.duration_ms || 0)}
                    </span>
                  </Tooltip>
                </div>
              </button>

              {/* Step detail — tabbed Input / Output view. Lazy-loaded
                  bodies stream in via `fetchStepDetail` (lite mode strips
                  them from the run-level fetch). Show a spinner while the
                  per-step request is in flight; show a retry pill on error. */}
              {isStepExpanded && (
                isFetchingThisStep && !cached ? (
                  // Skeleton mirrors StepDataTabs layout (tab bar + JSON pane)
                  // so the panel doesn't visually shift when real data lands.
                  <div className="mx-2 mb-1.5 ml-6 rounded-lg overflow-hidden border border-neutral-700/50 animate-pulse" style={{ background: '#0d1117' }}>
                    {/* Tab bar placeholder — Input + Output pills */}
                    <div className="flex items-center border-b border-neutral-700/50 px-3 py-1.5 gap-3">
                      <div className="h-3 w-10 rounded bg-neutral-700/60" />
                      <div className="h-3 w-12 rounded bg-neutral-700/40" />
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-3 w-8 rounded bg-neutral-700/40" />
                        <div className="h-3 w-8 rounded bg-neutral-700/40" />
                      </div>
                    </div>
                    {/* JSON-ish content lines — varying widths to suggest a real payload */}
                    <div className="px-3 py-3 space-y-1.5">
                      <div className="h-2.5 w-1/3 rounded bg-neutral-700/50" />
                      <div className="h-2.5 w-3/4 rounded bg-neutral-700/40 ml-3" />
                      <div className="h-2.5 w-2/3 rounded bg-neutral-700/40 ml-3" />
                      <div className="h-2.5 w-1/2 rounded bg-neutral-700/40 ml-3" />
                      <div className="h-2.5 w-4/5 rounded bg-neutral-700/40 ml-3" />
                      <div className="h-2.5 w-1/4 rounded bg-neutral-700/50" />
                    </div>
                  </div>
                ) : stepLoadError && !cached ? (
                  <div className="mx-2 mb-1.5 ml-6 px-3 py-2 flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-900/20 rounded">
                    <span>{stepLoadError}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); fetchStepDetail(i) }}
                      className="underline hover:text-red-700 dark:hover:text-red-300"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <StepDataTabs
                    step={enrichedStep}
                    stepIndex={i}
                    displaySteps={displaySteps}
                    run={effectiveRun}
                    rawOutput={typeof enrichedStep.output === 'string' ? enrichedStep.output : JSON.stringify(enrichedStep.output || '', null, 2)}
                    displayOutput={(() => {
                      const ro = typeof enrichedStep.output === 'string' ? enrichedStep.output : JSON.stringify(enrichedStep.output || '', null, 2)
                      return ro ? toJsonString(ro, 'output') : ''
                    })()}
                  />
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TaskDetailPanel
