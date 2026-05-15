import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Plus, Zap, Circle, Loader2, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react'
import RunsPanel from './RunsPanel'
import { useConfirm } from '../ui/ConfirmModal'
import Tooltip from '../ui/Tooltip'

/**
 * Card-level click hint. Mirrors the helper in RunsPanel: shows a tooltip
 * only when the cursor is over the card's "empty space", not over an inner
 * element that already has its own Tooltip (detected via the
 * `data-tooltip-wrapper="true"` marker the shared Tooltip component stamps).
 * Without that suppression, the card-level hint stacks on top of inner
 * tooltips because mouseleave doesn't fire on a parent when the cursor
 * moves into a child.
 */
function CardClickTooltip({ content, children }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: -9999, left: -9999 })
  const [arrowOffset, setArrowOffset] = useState(null)
  const [placement, setPlacement] = useState('bottom')
  const cardRef = useRef(null)
  const tipRef = useRef(null)
  const timeoutRef = useRef(null)

  const show = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 250)
  }
  const hide = () => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
    setCoords({ top: -9999, left: -9999 })
    setArrowOffset(null)
  }

  const handleMouseOver = (e) => {
    if (e.target.closest('[data-tooltip-wrapper="true"]')) { hide(); return }
    show()
  }
  const handleMouseOut = (e) => {
    if (cardRef.current && !cardRef.current.contains(e.relatedTarget)) hide()
  }

  useLayoutEffect(() => {
    if (!visible || !cardRef.current || !tipRef.current) return
    const padding = 8, arrowGap = 6
    const rect = cardRef.current.getBoundingClientRect()
    const tipRect = tipRef.current.getBoundingClientRect()
    let nextPlacement = 'bottom'
    let top = rect.bottom + arrowGap
    if (top + tipRect.height > window.innerHeight - padding) {
      top = rect.top - tipRect.height - arrowGap
      nextPlacement = 'top'
    }
    if (top < padding) top = padding
    let left = rect.left + rect.width / 2 - tipRect.width / 2
    if (left < padding) left = padding
    if (left + tipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tipRect.width - padding
    }
    const triggerCenterX = rect.left + rect.width / 2
    const offsetFromTooltipLeft = triggerCenterX - left
    const arrow = Math.max(10, Math.min(tipRect.width - 10, offsetFromTooltipLeft))
    setPlacement(nextPlacement)
    setCoords({ top, left })
    setArrowOffset(arrow)
  }, [visible])

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  return (
    <>
      <div ref={cardRef} onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
        {children}
      </div>
      {visible && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[9999] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug font-medium text-white bg-neutral-900 dark:bg-neutral-800 border border-neutral-700 dark:border-neutral-600 shadow-xl pointer-events-none animate-tooltip-pop"
          style={{ top: coords.top, left: coords.left, visibility: coords.top === -9999 ? 'hidden' : 'visible' }}
        >
          {content}
          <div
            className={`absolute w-2 h-2 rotate-45 bg-neutral-900 dark:bg-neutral-800 border-neutral-700 dark:border-neutral-600 ${
              placement === 'bottom'
                ? 'top-0 -translate-y-1/2 -translate-x-1/2 border-l border-t'
                : 'bottom-0 translate-y-1/2 -translate-x-1/2 border-r border-b'
            }`}
            style={{ left: arrowOffset ?? '50%' }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}

const stepStatusConfig = {
  proposed: { icon: Circle, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', label: 'Proposed' },
  configuring: { icon: AlertCircle, color: 'text-neutral-500 dark:text-neutral-400', bg: 'bg-neutral-50 dark:bg-[#383838]', border: 'border-neutral-200 dark:border-[#484848]', label: 'Needs Config' },
  testing: { icon: Loader2, color: 'text-neutral-500 dark:text-neutral-400', bg: 'bg-neutral-100 dark:bg-[#383838]', border: 'border-neutral-200 dark:border-[#484848]', label: 'Testing', spin: true },
  verified: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-800', label: 'Verified' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-800', label: 'Failed' },
}

// A step is shown as "AI" if either:
//   (a) its declared step_type is 'ai' (the runtime always calls an LLM via
//       executeAIStep), OR
//   (b) it's a code step whose code_body imports pabbly-llm — at runtime the
//       __trackedReq wrapper in bundled.rs intercepts those LLM.complete()
//       calls and meters tokens identically to AI steps, so for the user it
//       behaves the same way (same credit deduction, same Pabbly-Provider /
//       BYOK rules, same "spend").
// Detects all common require() / import() shapes Master Agent emits.
const PABBLY_LLM_PATTERN = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"]pabbly-llm['"]/
// Server-side `uses_llm` flag (sent in the lite list response from
// /steps?fields=meta) is the primary signal — it's pre-computed there so we
// don't ship `code_body` over the wire just to detect the LLM import.
// The regex fallback covers chat-parsed steps that haven't been re-fetched
// yet (Master Agent JSON blocks set code_body locally before any GET fires).
const stepUsesPabblyLLM = (step) => {
  if (step?.uses_llm === true) return true
  return PABBLY_LLM_PATTERN.test(step?.code_body || '')
}
const isAIStep = (step) => {
  const t = step?.step_type || 'ai'
  return t === 'ai' || stepUsesPabblyLLM(step)
}

// Compact "X seconds/minutes/hours ago" — used on the run-history refresh
// tooltip to surface the polling cadence to the user (so they understand
// the list updates by itself during executions and feel comfortable that
// the data is fresh). Returns "" for null/undefined input so callers can
// concatenate without conditionals.
const formatFetchedAgo = (epochMs) => {
  if (!epochMs) return ''
  const diffMs = Math.max(0, Date.now() - epochMs)
  if (diffMs < 5_000) return 'just now'
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return new Date(epochMs).toLocaleString()
}

const StepsPanel = ({ steps, stepsReady = true, selectedStepId, onSelectStep, onStepsChange, onDeleteStep, agent, onActivate, onTest, actionLoading, switchingProvider = false, runsCount = 0, activeExecution, onTrackExecution, onToggleAgentStatus, hideTabs = false, hideTestButton = false, onSyncDeploy, onSelectRun, selectedRunId }) => {
  const [activeTab, setActiveTab] = useState(hideTabs ? 'steps' : 'steps') // 'steps' | 'runs'
  const [totalRunsCount, setTotalRunsCount] = useState(runsCount) // real total from API
  // Keep `totalRunsCount` in sync with the `runsCount` prop after mount.
  // BuilderPage hydrates this in the background (after the workflow doc
  // resolves, in the `taskHistoryAPI.list(agentId, 1)` .then), so the prop
  // typically arrives AFTER StepsPanel's first render. Without this effect
  // the badge stays at the initial-mount value (usually 0) until the user
  // opens the Runs tab and RunsPanel pushes its own count via
  // `onTotalCountChange`. RunsPanel is now lazy (no eager fetch on mount),
  // so without this sync the badge never appears for users who never open
  // the tab. We pick the higher value so RunsPanel's authoritative count
  // (when it does load) doesn't get clobbered by a stale prop.
  useEffect(() => {
    if (typeof runsCount === 'number' && runsCount > totalRunsCount) {
      setTotalRunsCount(runsCount)
    }
  }, [runsCount, totalRunsCount])
  const runsRefreshRef = useRef(null) // callback exposed by RunsPanel
  const [runsRefreshing, setRunsRefreshing] = useState(false)
  // Tracks the last successful run-history fetch (epoch ms). Pushed up by
  // RunsPanel after every fetch — silent (3s execution poll, post-completion
  // refresh) and foreground (filter, manual refresh) — so the refresh-button
  // tooltip can show "Updated Xs ago" and prove polling is alive even when
  // the user never clicks anything. Re-rendered every 15 s while the Runs
  // tab is open so the relative label doesn't go stale on a hovering cursor.
  const [runsLastFetchedAt, setRunsLastFetchedAt] = useState(null)
  const [, setFreshnessTick] = useState(0)
  useEffect(() => {
    if (activeTab !== 'runs' || !runsLastFetchedAt) return
    const id = setInterval(() => setFreshnessTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [activeTab, runsLastFetchedAt])
  const confirm = useConfirm()

  // Live elapsed timer — uses stepStartedAt from BuilderPage (persists across tab switches)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (activeExecution?.status !== 'executing') return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activeExecution?.status])
  const stepElapsed = activeExecution?.stepStartedAt
    ? Math.floor((Date.now() - activeExecution.stepStartedAt) / 1000)
    : 0

  // Always sort steps by order to ensure correct display regardless of state update timing
  const sortedSteps = [...steps].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))

  const handleAddStep = () => {
    const newStep = {
      name: `Step ${safeSteps.length + 1}`,
      description: 'New step — click to configure',
      step_type: 'ai',
      status: 'proposed',
      llm_model: 'claude-opus-4-6',
      system_prompt: '',
      tools: [],
      max_tool_calls: 10,
    }
    // Use onStepAdded prop if available (goes through BuilderPage → stepsAPI.create)
    if (onSelectStep) {
      // Parent will handle API call and state update via handleStepAdded
      onStepsChange([...steps, { ...newStep, id: `step_${Date.now()}` }])
    }
    setActiveTab('steps')
  }

  const safeSteps = Array.isArray(steps) ? steps : []
  const verifiedCount = safeSteps.filter((s) => s.status === 'verified').length

  // Shared action-button row (Active/Inactive/Update/Activate + Test Workflow) —
  // rendered in the Steps-tab footer AND as an overlay at the bottom of the Runs tab
  // so either view exposes the same controls.
  const actionButtonRow = safeSteps.length > 0 ? (
    <div className="flex gap-1.5">
      {(() => {
        const isDeployed = !!agent?.pabbly_functions_id
        const isActive = agent?.status === 'active'
        const needsUpdate = isDeployed && agent?.needs_redeploy && !!onSyncDeploy

        if (needsUpdate) {
          return (
            <Tooltip content="Deploy latest changes" position="top" className="w-full">
              <button
                onClick={onSyncDeploy}
                disabled={!!actionLoading}
                className="w-full px-3.5 py-2 text-xs font-medium rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40 transition-all duration-300 animate-pulse-once shadow-sm"
              >
                <span className="flex items-center justify-center gap-1.5">
                  {actionLoading === 'sync' ? (
                    <>
                      <span className="inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">↑</span>
                      <span>Update</span>
                    </>
                  )}
                </span>
              </button>
            </Tooltip>
          )
        }

        if (isDeployed && isActive) {
          return (
            <Tooltip content="Click to deactivate — executions will stop" position="top" className="w-full">
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Deactivate Workflow?',
                    message: 'The workflow will stop accepting webhook requests, but the deployed function and its webhook URL stay on Pabbly Functions. Reactivating later reuses the exact same URL.',
                    confirmLabel: 'Deactivate',
                    danger: true,
                  })
                  if (ok) onToggleAgentStatus?.()
                }}
                disabled={!!actionLoading}
                className="w-full px-3.5 py-2 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-center transition-all duration-300 disabled:opacity-40"
              >
                <span className="flex items-center justify-center gap-1.5">
                  {actionLoading === 'deactivate' ? (
                    <>
                      <span className="inline-block h-3 w-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-emerald-700 dark:text-emerald-400">Deactivating...</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2 w-2 flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span className="text-emerald-700 dark:text-emerald-400">Active</span>
                    </>
                  )}
                </span>
              </button>
            </Tooltip>
          )
        }

        if (isDeployed && !isActive) {
          return (
            <Tooltip content="Click to reactivate — executions will resume" position="top" className="w-full">
              <button
                onClick={() => onToggleAgentStatus?.()}
                disabled={!!actionLoading}
                className="w-full px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-100 dark:bg-[#484848] border border-neutral-200 dark:border-[#4a4a4a] text-center transition-all duration-300 disabled:opacity-40"
              >
                <span className="flex items-center justify-center gap-1.5">
                  {actionLoading === 'reactivate' ? (
                    <>
                      <span className="inline-block h-3 w-3 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-neutral-600 dark:text-neutral-400">Activating...</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2 w-2 flex-shrink-0">
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-neutral-400" />
                      </span>
                      <span className="text-neutral-600 dark:text-neutral-400">Inactive</span>
                    </>
                  )}
                </span>
              </button>
            </Tooltip>
          )
        }

        return (
          <Tooltip content={safeSteps.length === 0
            ? 'Add at least one step first'
            : 'Deploy and start accepting calls'} position="top" className="w-full">
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: 'Activate Workflow?',
                  message: 'This will validate and activate your workflow. Once activated, it will be reachable via the invoke URL.',
                  confirmLabel: 'Activate',
                })
                if (ok) onActivate?.().catch(() => {})
              }}
              disabled={!!actionLoading || safeSteps.length === 0}
              className="w-full px-3.5 py-2 text-xs font-medium rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40 transition-all duration-300"
            >
              {actionLoading === 'activate' ? '⏳ Activating...' : 'Activate'}
            </button>
          </Tooltip>
        )
      })()}
      {onTest && !hideTestButton && (
        <Tooltip content="Send a test-workflow request to the Master Agent in the chat." position="top" className="w-full">
          <button
            onClick={onTest}
            disabled={safeSteps.length === 0}
            className="w-full px-3.5 py-2 text-xs font-medium bg-white dark:bg-[#383838] text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-[#484848] rounded-lg hover:bg-neutral-100 dark:hover:bg-[#484848] disabled:opacity-40"
          >
            Test Workflow
          </button>
        </Tooltip>
      )}
    </div>
  ) : null

  return (
    <div className="h-full flex flex-col">
      {/* Tabs: Steps | Task History (hidden when hideTabs is true). @container so tab labels can switch based on panel width */}
      {!hideTabs && (
        <div className="@container flex border-b border-neutral-200 dark:border-[#484848] flex-shrink-0">
          <button
            onClick={() => setActiveTab('steps')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === 'steps'
                ? 'text-neutral-700 dark:text-neutral-200 border-primary-500'
                : 'text-neutral-400 dark:text-neutral-400 border-transparent hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            <Layers size={14} />
            <Tooltip content="The ordered list of actions this workflow runs">
              <span>Steps</span>
            </Tooltip>
            {safeSteps.length > 0 && <span className={`text-[10px] px-2.5 py-0.5 rounded-md font-semibold text-white ${activeTab === 'steps' ? 'bg-primary-500' : 'bg-primary-200 dark:bg-primary-700'}`}>{safeSteps.length}</span>}
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === 'runs'
                ? 'text-neutral-700 dark:text-neutral-200 border-primary-500'
                : 'text-neutral-400 dark:text-neutral-400 border-transparent hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            <Clock size={14} />
            <Tooltip content="Past executions of this workflow — open a row to inspect inputs and outputs">
              <span className="whitespace-nowrap"><span className="@[400px]:hidden">History</span><span className="hidden @[400px]:inline">Run History</span></span>
            </Tooltip>
            {totalRunsCount > 0 && <span className={`text-[10px] px-2.5 py-0.5 rounded-md font-semibold text-white ${activeTab === 'runs' ? 'bg-primary-500' : 'bg-primary-200 dark:bg-primary-700'}`}>{totalRunsCount}</span>}
            <Tooltip content={runsLastFetchedAt ? `Refresh history · Updated ${formatFetchedAgo(runsLastFetchedAt)}` : 'Refresh history'}>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (activeTab !== 'runs') return
                  if (runsRefreshRef.current) {
                    setRunsRefreshing(true)
                    runsRefreshRef.current()
                    setTimeout(() => setRunsRefreshing(false), 600)
                  }
                }}
                aria-label="Refresh history"
                className={`ml-1 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-[#484848] transition-colors ${activeTab !== 'runs' ? 'invisible' : ''}`}
              >
                <RefreshCw size={11} className={runsRefreshing ? 'animate-spin' : ''} />
              </span>
            </Tooltip>
          </button>
        </div>
      )}

      {/* Steps Tab */}
      {activeTab === 'steps' && (
        <>
          {/* Steps list */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {safeSteps.length === 0 && !stepsReady ? (
              // Skeleton — fired while the steps fetch is still in flight in
              // the background (BuilderPage hydrates steps after the workflow
              // doc resolves so ChatPanel can mount immediately). 4 placeholder
              // step cards with arrow connectors so the layout matches what's
              // about to render. Same shimmer pattern as RunsPanel skeleton.
              (() => {
                const N = 4
                return (
                  <div className="space-y-0" aria-busy="true" aria-label="Loading steps">
                    {Array.from({ length: N }).map((_, i) => (
                      <div key={i}>
                        <div className="rounded-lg border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] px-4 py-3 animate-pulse">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="h-5 w-5 rounded-full bg-neutral-200 dark:bg-[#383838]" />
                            <div className="h-4 w-24 rounded bg-neutral-200 dark:bg-[#383838]" />
                            <div className="ml-auto h-4 w-12 rounded-full bg-neutral-200 dark:bg-[#383838]" />
                          </div>
                          <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-[#383838]" />
                        </div>
                        {i < N - 1 && (
                          <div className="flex justify-center">
                            <svg width="24" height="24" viewBox="0 0 24 24" className="text-neutral-200 dark:text-neutral-700">
                              <line x1="12" y1="0" x2="12" y2="16" stroke="currentColor" strokeWidth="2" />
                              <polygon points="12,24 6,14 18,14" fill="currentColor" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : safeSteps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Layers size={20} className="text-neutral-300 dark:text-neutral-600 mb-2" />
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1">No steps yet</p>
                <p className="text-xs text-neutral-400 dark:text-neutral-400">Chat with the Master Agent to build your workflow.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {/* Live execution banner */}
                {activeExecution?.status === 'executing' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800 rounded-lg mb-1">
                    <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-[11px] text-primary-700 font-medium">
                      {(() => {
                        const completed = (activeExecution.step_results || []).filter(
                          r => r.status === 'success' || r.status === 'failed' || r.status === 'completed'
                        ).length
                        return `Running step ${completed + 1}/${safeSteps.length}...`
                      })()}
                    </span>
                  </div>
                )}
                {activeExecution?.status === 'completed' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg mb-1">
                    <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                    <span className="text-[11px] text-emerald-700 font-medium">
                      All {safeSteps.length} steps passed
                    </span>
                  </div>
                )}
                {activeExecution?.status === 'failed' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-1">
                    <XCircle size={13} className="text-red-500 flex-shrink-0" />
                    <span className="text-[11px] text-red-700 font-medium">Execution failed</span>
                  </div>
                )}
                {sortedSteps.map((step, index) => {
                  const isSelected = step.id === selectedStepId
                  const status = stepStatusConfig[step.status] || stepStatusConfig.proposed
                  const StatusIcon = status.icon

                  // Live execution state for this step.
                  // Under the current callback model, step_results contains BOTH
                  // running placeholders (from step_started) AND completed
                  // entries (from step_finished). Trust result.status directly
                  // instead of inferring from array position/length.
                  let execState = null // null | 'completed' | 'running' | 'failed' | 'pending'
                  const allResults = activeExecution?.step_results || []
                  const result = allResults.find(r => r.step_name === step.name)
                  const runTerminal = activeExecution?.status === 'completed' ||
                    activeExecution?.status === 'failed'

                  if (result) {
                    if (result.status === 'success' || result.status === 'completed') {
                      execState = 'completed'
                    } else if (result.status === 'failed') {
                      execState = 'failed'
                    } else if (result.status === 'running') {
                      // A step left as 'running' after the parent run is terminal
                      // means step_finished never landed (VM crashed / callback
                      // lost) — treat as failed so the spinner stops.
                      execState = runTerminal ? 'failed' : 'running'
                    }
                  } else if (activeExecution?.status === 'executing') {
                    // No row for this step yet. Only mark it "running" if every
                    // prior step is done — otherwise show pending. This prevents
                    // showing two running steps simultaneously when a prior
                    // step's step_finished hasn't arrived yet.
                    const completedCount = allResults.filter(r =>
                      r.status === 'success' ||
                      r.status === 'completed' ||
                      r.status === 'failed'
                    ).length
                    const anyRunning = allResults.some(r => r.status === 'running')
                    if (index === completedCount && !anyRunning) {
                      execState = 'running'
                    } else if (index >= completedCount) {
                      execState = 'pending'
                    }
                  }

                  return (
                    <div key={step.id}>
                      <CardClickTooltip content={isSelected ? 'Currently open — see step details on the right' : 'Click to see step details'}>
                      <button
                        onClick={() => onSelectStep(step.id)}
                        className={`w-full text-left group rounded-lg border px-4 py-3.5 transition-colors duration-150 ${
                          execState === 'running'
                            ? 'border-blue-400/60 bg-blue-50/80 dark:border-blue-500/30 dark:bg-blue-950/20'
                            : isSelected
                              ? 'border-primary-400 bg-primary-50 dark:border-primary-500/40 dark:bg-[#131d2e] ring-1 ring-primary-500/20 dark:ring-primary-400/20'
                              : 'border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] hover:border-neutral-300 dark:hover:border-[#333]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {/* Status Icon */}
                          <div className="flex-shrink-0">
                            {execState === 'running' ? (
                              <Tooltip content="Currently executing" delay={100}>
                                <div className="w-4 h-4 rounded flex items-center justify-center bg-primary-500">
                                  <div className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin" />
                                </div>
                              </Tooltip>
                            ) : execState === 'completed' ? (
                              <Tooltip content="Completed successfully" delay={100}>
                                <div className="w-4 h-4 rounded flex items-center justify-center bg-emerald-500">
                                  <CheckCircle2 size={11} className="text-white" />
                                </div>
                              </Tooltip>
                            ) : execState === 'failed' ? (
                              <Tooltip content="Step failed" delay={100}>
                                <div className="w-4 h-4 rounded flex items-center justify-center bg-red-500">
                                  <XCircle size={11} className="text-white" />
                                </div>
                              </Tooltip>
                            ) : null}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 justify-between">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <p title={step.name} className={`text-sm font-semibold line-clamp-2 transition-colors ${isSelected ? 'text-primary-700 dark:text-white' : 'text-neutral-700 dark:text-neutral-200'}`}>{index + 1}. {step.name}</p>
                                {execState === 'running' && (
                                  <span className="text-[9px] text-primary-600 dark:text-primary-400 font-medium flex-shrink-0">{stepElapsed}s</span>
                                )}
                                {execState === 'completed' && (() => {
                                  const result = (activeExecution?.step_results || []).find(r => r.step_name === step.name)
                                  return result?.duration_ms > 0 ? (
                                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium flex-shrink-0">{result.duration_ms > 1000 ? `${(result.duration_ms/1000).toFixed(1)}s` : `${result.duration_ms}ms`}</span>
                                  ) : null
                                })()}
                              </div>
                              <Tooltip content={isAIStep(step) ? (stepUsesPabblyLLM(step) && (step.step_type || 'ai') === 'code' ? 'AI step — runs an LLM call (uses pabbly-llm); consumes AI Credits on Pabbly Provider' : 'AI step — runs an LLM call; consumes AI Credits on Pabbly Provider') : 'Non-AI step — runs deterministic code only; no LLM call, no AI Credits consumed'}>
                                <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-medium transition-colors flex-shrink-0 ${
                                  isAIStep(step)
                                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                                    : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                }`}>
                                  {isAIStep(step) ? 'AI' : 'Non-AI'}
                                </span>
                              </Tooltip>
                            </div>
                            {step.description && (
                              <p className={`text-[11px] leading-tight line-clamp-1 mt-1 transition-colors ${isSelected ? 'text-primary-600 dark:text-neutral-300' : 'text-neutral-500 dark:text-neutral-400'}`}>{step.description}</p>
                            )}
                          </div>
                        </div>
                      </button>
                      </CardClickTooltip>
                      {index < sortedSteps.length - 1 && (
                        <div className="flex justify-center">
                          <svg width="24" height="24" viewBox="0 0 24 24" className="text-neutral-300 dark:text-neutral-600">
                            <line x1="12" y1="0" x2="12" y2="16" stroke="currentColor" strokeWidth="2" />
                            <polygon points="12,24 6,14 18,14" fill="currentColor" />
                          </svg>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer: action buttons — three states:
              1. Active   → green dot, hover swaps to Deactivate. Mutations
                            auto-redeploy server-side, so no "stale" state.
              2. Inactive → grey dot, click reactivates. Function id + webhook
                            URL are preserved across deactivation, so this just
                            flips status back to active without re-deploying.
              3. Draft    → blue Activate. Never deployed yet. */}
          <div className="px-3 py-2.5 border-t border-neutral-200 dark:border-[#484848] flex-shrink-0 space-y-2">
            {actionButtonRow && (
              <div className="space-y-1.5">
                {actionButtonRow}
              </div>
            )}
          </div>
        </>
      )}

      {/* Runs Tab — always mounted (hidden via CSS) to preserve data across tab switches */}
      <div className={`flex-1 relative min-h-0 ${activeTab === 'runs' ? '' : 'hidden'}`}>
        <div className="absolute inset-0 overflow-y-auto pb-16">
          <RunsPanel agent={agent} activeExecution={activeExecution} steps={steps} onTotalCountChange={setTotalRunsCount} isVisible={activeTab === 'runs'} onTrackExecution={onTrackExecution} onSelectRun={onSelectRun} selectedRunId={selectedRunId} onRefreshRef={runsRefreshRef} switchingProvider={switchingProvider} onLastFetchChange={setRunsLastFetchedAt} />
        </div>
        {/* Overlayed action-button row — same styling as the Steps-tab footer (solid bg + top border) */}
        {actionButtonRow && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5 bg-white dark:bg-[#2c2c2c] border-t border-neutral-200 dark:border-[#484848]">
            {actionButtonRow}
          </div>
        )}
      </div>

    </div>
  )
}

export default StepsPanel
