import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, Layers, Settings, MessageSquare, Menu, X, Webhook, Copy, Check, Zap, Clock, ChevronDown, FileText, Sparkles, Terminal } from 'lucide-react'
import DashboardSidebar from '../components/layout/DashboardSidebar'
import TopBar from '../components/layout/TopBar'
import useSystemStatus from '../hooks/useSystemStatus'

import { workflowsAPI, buildsAPI, deploysAPI, stepsAPI, taskHistoryAPI, chatAPI } from '../services/api'
import toast from 'react-hot-toast'
import { useAgents } from '../context/AgentsContext'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../components/ui/ConfirmModal'
import ChatPanel from '../components/builder/ChatPanel'
import StepsPanel from '../components/builder/StepsPanel'
import ConfigPanel from '../components/builder/ConfigPanel'
import TaskDetailPanel from '../components/builder/TaskDetailPanel'
import RunsPanel from '../components/builder/RunsPanel'
import ErrorBoundary from '../components/ErrorBoundary'
import { track } from '../services/analytics'
import MicroFeedback from '../components/feedback/MicroFeedback'
import { buildInvokeCurl } from '../utils/curlBuilder'
import CodeView from '../components/builder/CodeView'
import Tooltip from '../components/ui/Tooltip'
import StoredCredentialsCard from '../components/builder/StoredCredentialsCard'
import ShareWorkflowModal from '../components/builder/ShareWorkflowModal'
import TeamAccessModal from '../components/builder/TeamAccessModal'

// Inline-editable workflow name with maxLength counter and live save status.
// Pattern: controlled input, autosave on blur (or Enter), Escape reverts.
// Visible status pip — Saving → Saved (1.5s) → cleared, or Error with the
// backend's friendly `message` shown beneath. Mirrors the 80-char cap the
// dashboard enforces; backend rejects anything over.
const WORKFLOW_NAME_MAX = 80

const WorkflowNameField = ({ value, onSave, inputClassName }) => {
  const [local, setLocal] = useState(value || '')
  const [status, setStatus] = useState('idle') // idle | saving | saved | error
  const [errorMsg, setErrorMsg] = useState('')
  const [focused, setFocused] = useState(false)
  const savedTimerRef = useRef(null)
  const inputRef = useRef(null)

  // Sync external value (e.g. agent reload) only when not actively editing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocal(value || '')
    }
  }, [value])

  useEffect(() => () => clearTimeout(savedTimerRef.current), [])

  const commit = async () => {
    const trimmed = local.trim()
    if (!trimmed) { setLocal(value || ''); setStatus('idle'); setErrorMsg(''); return }
    if (trimmed === (value || '')) { setStatus('idle'); setErrorMsg(''); return }
    setStatus('saving'); setErrorMsg('')
    try {
      await onSave(trimmed)
      setStatus('saved')
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 1500)
    } catch (err) {
      const body = err?.response?.data
      setErrorMsg(body?.message || body?.error || 'Failed to update')
      setStatus('error')
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { setLocal(value || ''); setStatus('idle'); setErrorMsg(''); inputRef.current?.blur() }
  }

  const tooLong = local.length >= WORKFLOW_NAME_MAX
  const dirty = local.trim() !== (value || '').trim() && local.trim().length > 0
  const borderClass = status === 'error'
    ? 'border-red-400 dark:border-red-500 focus:ring-red-400'
    : tooLong
    ? 'border-amber-400 dark:border-amber-500 focus:ring-amber-400'
    : dirty && status === 'idle'
    ? 'border-amber-300 dark:border-amber-500 focus:ring-amber-400'
    : 'border-neutral-200 dark:border-[#484848] focus:ring-primary-400'

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={local}
          maxLength={WORKFLOW_NAME_MAX}
          onChange={(e) => { setLocal(e.target.value); if (status === 'error') { setStatus('idle'); setErrorMsg('') } }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`${inputClassName || 'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2c2c2c] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 border'} ${borderClass} ${focused && dirty ? 'pr-24' : ''}`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums pointer-events-none flex items-center gap-1">
          {status === 'saving' && (
            <span className="text-neutral-500 dark:text-neutral-400 inline-flex items-center gap-1">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
              </svg>
              Saving
            </span>
          )}
          {status === 'saved' && <span className="text-green-600 dark:text-green-400">Saved ✓</span>}
          {status === 'error' && <span className="text-red-600 dark:text-red-400">Error</span>}
          {status === 'idle' && focused && dirty && (
            <span className={tooLong ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-400 dark:text-neutral-500'}>
              {local.length}/{WORKFLOW_NAME_MAX}
            </span>
          )}
        </span>
      </div>
      {status === 'error' && errorMsg && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errorMsg}</p>
      )}
      {status !== 'error' && focused && dirty && (
        <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
          Press Enter to save, Esc to revert.
        </p>
      )}
    </div>
  )
}

export default function BuilderPage() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const { agents } = useAgents()
  const { user: authUser } = useAuth()
  const confirm = useConfirm()
  const downtime = useSystemStatus()
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  // Per-panel readiness flags so each panel can render its own skeleton
  // independently of the global `loading` (which now flips false as soon as
  // the workflow doc resolves so ChatPanel can mount immediately). Without
  // these the StepsPanel would briefly show its "No steps yet" empty state
  // while the steps fetch is still in flight in the background.
  const [stepsReady, setStepsReady] = useState(false)

  // Update browser tab title with agent name
  useEffect(() => {
    document.title = agent?.name ? `Pabbly AgenticAI | ${agent.name}` : 'Pabbly AgenticAI'
    return () => { document.title = 'Pabbly AgenticAI' }
  }, [agent?.name])
  const [steps, setSteps] = useState([])
  const [selectedStepId, setSelectedStepId] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState(null)
  // Lightweight metadata about the row the user just clicked — sourced from
  // the list response, which carries fields (created_at, completed_at) that
  // the single-run GET still omits. Used by TaskDetailPanel as a fallback so
  // the run-details header tooltip can show "Start · End" identically to the
  // run-history card's tooltip.
  const [selectedRunMeta, setSelectedRunMeta] = useState(null)
  const [configModels, setConfigModels] = useState([])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved ? JSON.parse(saved) : false
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed))
  }, [sidebarCollapsed])

  // ConfigPanel-deferred fetch is registered later in the file (after the
  // configSlideOpen / configMode state is declared). Search for
  // `configModelsLoadedRef`.

  const [mobileTab, setMobileTab] = useState('chat')
  const [currentView, setCurrentView] = useState('builder') // 'builder' | 'settings'

  const [runsCount, setRunsCount] = useState(0)

  // Credentials collected during conversation (tracked for context)
  const [collectedCredentials, setCollectedCredentials] = useState({})

  // Build/Deploy/Test state
  const [actionLoading, setActionLoading] = useState('') // 'compile' | 'deploy' | ''
  // True while the chat panel's provider/model switch is mid-FaaS-push.
  // Lifted here (instead of staying inside ChatPanel) so the StepsPanel's
  // Test button can also disable while the deployed function still has the
  // OLD env vars — clicking Test in that ~3-5s window would route through
  // a model the FaaS side isn't configured for and produce confusing errors.
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [deployResult, setDeployResult] = useState(null) // { invoke_url, curl_command, function_id }
  const [compileError, setCompileError] = useState(null) // full compile error for chat display
  const [compileSuccess, setCompileSuccess] = useState(null) // compile success info
  const [testResult, setTestResult] = useState(null) // test result for chat display

  // Live execution tracking — shows which step is currently running
  const [activeExecution, setActiveExecution] = useState(null) // { runId, status, step_results, stepStartedAt }
  const [microFeedbackType, setMicroFeedbackType] = useState(null)
  const executionPollRef = useRef(null)
  const prevStepCountRef = useRef(-1)
  const credentialsRef = useRef(null)
  // Bumped whenever a tracked execution reaches a terminal state. ChatPanel
  // watches this counter and refetches its credit-summary so the pill picks
  // up test/run credits that landed via the callback path (NOT visible in
  // the chat SSE stream).
  const [creditRefreshKey, setCreditRefreshKey] = useState(0)

  // Chat-input quick-fill — StepsPanel action buttons (Test / Activate /
  // Deactivate / Update) write their intent into the chat textarea instead
  // of running their own side-effect, so the Master Agent owns execution.
  // Stored as an `{ text, nonce }` envelope so clicking the same button
  // twice in a row still re-fires the effect inside ChatPanel (state
  // identity must change for the watching useEffect to run).
  const [pendingChatInput, setPendingChatInput] = useState(null)
  const queueChatInput = useCallback((text) => {
    if (!text) return
    setPendingChatInput({ text, nonce: Date.now() })
  }, [])
  const clearPendingChatInput = useCallback(() => setPendingChatInput(null), [])

  // Step changes auto-redeploy server-side (see spawn_auto_redeploy in
  // backend/src/handlers/deploys.rs), so the UI no longer tracks a "stale"
  // dirty-state — there's nothing for the user to manually re-push.

  // Track a live execution — called by the chat-driven test_workflow tool or webhook trigger
  const trackExecution = useCallback((runId) => {
    if (!runId) return
    prevStepCountRef.current = 0
    setActiveExecution({ runId, status: 'executing', step_results: [], currentStepIndex: 0, stepStartedAt: Date.now() })

    // Clear any existing poll
    if (executionPollRef.current) clearInterval(executionPollRef.current)

    executionPollRef.current = setInterval(async () => {
      try {
        // Lite mode — the progress poll only needs status + per-step
        // metadata (status, name, duration, tokens). Heavy `input` / `output`
        // bodies stay server-side until the user opens TaskDetailPanel and
        // clicks a specific step row to expand it.
        const res = await taskHistoryAPI.getStatus(runId, { lite: true })
        const data = res.data

        // Parse step results to find completed steps
        let stepResults = []
        try {
          stepResults = typeof data.step_results === 'string' ? JSON.parse(data.step_results) : (data.step_results || [])
        } catch {}

        // Under the new callback model, step_results contains both 'running' placeholders
        // (from step_started) and completed entries (from step_finished). Count only
        // completed ones so currentStepIndex reflects actual progress.
        const completedCount = stepResults.filter(
          r => r.status === 'success' || r.status === 'failed' || r.status === 'completed'
        ).length
        const currentStepIndex = data.status === 'executing' ? completedCount : -1

        const newStepStartedAt = stepResults.length !== prevStepCountRef.current
          ? Date.now()
          : undefined // keep existing
        prevStepCountRef.current = stepResults.length

        setActiveExecution(prev => ({
          runId,
          status: data.status,
          step_results: stepResults,
          currentStepIndex,
          duration_ms: data.duration_ms,
          stepStartedAt: newStepStartedAt || prev?.stepStartedAt || Date.now(),
        }))

        if (data.status !== 'executing') {
          clearInterval(executionPollRef.current)
          executionPollRef.current = null
          setRunsCount(prev => prev + 1)
          // Test or production run just finished — credits have been
          // deducted in the callback path. Signal ChatPanel to refresh.
          setCreditRefreshKey(k => k + 1)
          // Show micro-feedback only once per agent (localStorage tracks which agents already asked)
          if (data.status === 'completed') {
            const key = `feedback_asked_${agent?.id}`
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, '1')
              setMicroFeedbackType('agent_working')
            }
          }
          // Clear after 5 seconds
          setTimeout(() => setActiveExecution(null), 5000)
        }
      } catch {
        clearInterval(executionPollRef.current)
        executionPollRef.current = null
      }
    }, 1000)
  }, [])

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (executionPollRef.current) clearInterval(executionPollRef.current) }
  }, [])

  // Lightweight check for external webhook triggers — polls limit=1 every 5s
  // to detect new executing runs. Paused when:
  //  • The browser tab is hidden (document.visibilityState !== 'visible') —
  //    a backgrounded workflow doesn't need new-run detection.
  //  • An execution is already being tracked (executionPollRef takes over).
  const lastDetectedRunRef = useRef(null)
  useEffect(() => {
    if (!agent?.slug && !agent?.id) return
    const checkInterval = setInterval(async () => {
      if (activeExecution) return // already tracking
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      try {
        const res = await taskHistoryAPI.list(agent.slug || agent.id, 1)
        const runs = res.data.runs || []
        if (runs.length > 0 && runs[0].status === 'executing' && runs[0].id !== lastDetectedRunRef.current) {
          lastDetectedRunRef.current = runs[0].id
          trackExecution(runs[0].id)
        }
      } catch {}
    }, 5000)
    return () => clearInterval(checkInterval)
  }, [agent?.slug, agent?.id, activeExecution, trackExecution])

  // Unified Activate handler — does compile (validation) + deploy in one click.
  // Used by:
  //   - The "Activate" button in StepsPanel (initial activation)
  //   - The "Activate" amber-dot button in StepsPanel (in-place redeploy when stale)
  //   - The InlineActionButtons rendered inside chat messages (Master Agent prompts)
  const handleActivate = async () => {
    const id = agent?.slug || agent?.id
    if (!id) return
    track('agent_activated', { agent_id: agent?.id })

    if (steps.length === 0) {
      toast.error('Add steps first by chatting with the Master Agent')
      return
    }

    const isRedeploy = !!agent?.pabbly_functions_id
    setActionLoading('activate')
    setCompileError(null)
    setCompileSuccess(null)
    try {
      // 1. Validate the workflow
      const validateRes = await buildsAPI.trigger(id)
      if (!validateRes.data.valid) {
        const errors = (validateRes.data.errors || []).map((e) => `${e.step}: ${e.issue}`).join('\n')
        setCompileError(errors || 'Validation failed')
        toast.error('Validation failed — fix the issues and try again')
        throw new Error(errors || 'Validation failed')
      }
      setCompileSuccess({ steps_count: validateRes.data.steps_count })
      setTimeout(() => setCompileSuccess(null), 3000)

      // 2. Deploy / redeploy to Pabbly Functions (handler updates in place when pabbly_functions_id exists)
      const deployRes = await deploysAPI.trigger(id)
      const data = deployRes.data

      toast.success(isRedeploy ? 'Updated and redeployed!' : 'Activated and deployed!')

      // Show deploy feedback once per agent
      const deployKey = `feedback_deploy_${agent?.id}`
      if (!localStorage.getItem(deployKey)) {
        localStorage.setItem(deployKey, '1')
        setMicroFeedbackType('deploy_success')
      }

      // Refresh agent to get updated pabbly_functions_id + invocation_url
      workflowsAPI.getOne(id).then((r) => setAgent(r.data)).catch(() => {})

      // Show deploy result modal
      setDeployResult(data)
      return { success: true }
    } catch (err) {
      if (!err.message?.includes('Validation failed')) {
        const errorMsg = err.response?.data?.error || err.message || 'Activation failed'
        setCompileError(errorMsg)
        toast.error(errorMsg)
      }
      throw err
    } finally {
      setActionLoading('')
    }
  }

  // Toggle active/inactive handler — flips status between 'active' and 'draft'
  // but PRESERVES the Pabbly Functions deployment (function id, invoke URL,
  // sample cURL). The function stays on functions.pabbly.com so the same
  // webhook URL works the moment the user reactivates — no churn, no new URL,
  // no broken integrations on the caller side. The local "active vs draft"
  // gate is enforced by our backend webhook handler, not by the function's
  // existence.
  //
  // Called from the StepsPanel "Active → Deactivate" / "Inactive → Reactivate"
  // button.
  const handleToggleAgentStatus = async () => {
    const id = agent?.slug || agent?.id
    if (!id) return
    const nextStatus = agent?.status === 'active' ? 'ready' : 'active'
    setActionLoading(nextStatus === 'active' ? 'reactivate' : 'deactivate')
    try {
      await workflowsAPI.update(id, { status: nextStatus })
      // Only update local state on success — if the backend returns an error
      // (e.g. Pabbly Functions set_status failed → 502), the catch block runs
      // and the button stays in its prior state, matching the actual remote.
      setAgent((prev) => prev ? { ...prev, status: nextStatus } : prev)
      toast.success(nextStatus === 'active' ? 'Activated' : 'Deactivated')
    } catch (err) {
      // Surface the backend's error message (Pabbly Functions API failure,
      // network error, etc.) so the user knows what actually went wrong
      // instead of seeing a generic "Failed to" toast.
      const detail = err?.response?.data?.error || err?.message
      const fallback = nextStatus === 'active' ? 'Failed to reactivate' : 'Failed to deactivate'
      toast.error(detail || fallback)
    } finally {
      setActionLoading('')
    }
  }

  // Optimistically mark the agent as needing a redeploy after a local mutation
  // (step CRUD, credential collection). Backend has the source of truth and
  // sets needs_redeploy on the next agent fetch — this just makes the UI snap
  // immediately so the Update button doesn't lag behind the user's click.
  // Skips for non-deployed agents (nothing to be out of sync with).
  const markDirty = () => {
    setAgent((prev) => (prev && prev.pabbly_functions_id ? { ...prev, needs_redeploy: true } : prev))
  }

  // Called when credentials change via chat tool calls (memory_store / memory_delete).
  // Refreshes the StoredCredentialsCard and marks agent for redeploy.
  const handleCredentialsChanged = useCallback(() => {
    credentialsRef.current?.refresh()
    markDirty()
  }, [])

  // Auto-deploy credential changes from the settings UI to Pabbly Functions.
  // Silently syncs in the background — no toast (the card already toasts on edit/delete).
  const handleCredentialSettingsChange = useCallback(() => {
    markDirty()
    const id = agent?.slug || agent?.id
    if (id && agent?.pabbly_functions_id) {
      deploysAPI.sync(id).then(() => {
        workflowsAPI.getOne(id).then(r => setAgent(r.data)).catch(() => {})
      }).catch(() => {})
    }
  }, [agent?.slug, agent?.id, agent?.pabbly_functions_id])

  // Push pending local changes to Pabbly Functions. Triggered by the "Update"
  // button, which only renders when agent.needs_redeploy && pabbly_functions_id.
  // Refreshes the agent doc on success so needs_redeploy clears in the UI.
  const handleSyncDeploy = async () => {
    const id = agent?.slug || agent?.id
    if (!id) return
    setActionLoading('sync')
    try {
      await deploysAPI.sync(id)
      const fresh = await workflowsAPI.getOne(id)
      setAgent(fresh.data)
      toast.success('Updated')
    } catch (err) {
      const detail = err?.response?.data?.error || err?.message || 'Failed to update'
      toast.error(detail)
    } finally {
      setActionLoading('')
    }
  }

  // Webhook URL for this agent — points to BACKEND (port 4000), not frontend
  const [webhookCopied, setWebhookCopied] = useState(false)
  const [settingsWebhookOpen, setSettingsWebhookOpen] = useState(false)
  const [settingsHelpOpen, setSettingsHelpOpen] = useState(false)
  // Webhook URL: set after deployment to Pabbly Functions (auto-deployed on agent creation)
  const webhookUrl = agent?.invocation_url || ''

  // Slide-over config panel visibility and mode
  const [configSlideOpen, setConfigSlideOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  // Team Access (shared-edit collaboration) modal — owner-only.
  const [teamAccessOpen, setTeamAccessOpen] = useState(false)
  const [configMode, setConfigMode] = useState('step-detail') // 'step-detail' | 'settings' | 'task-detail'
  // Track which panel the user last clicked — the focused panel gets more width (flex-[2])
  // while the others shrink (flex-1). Defaults to 'config' when config first opens.
  const [focusedPanel, setFocusedPanel] = useState('config') // 'chat' | 'steps' | 'config'

  // Viewport < 1440 means 2-col layout — chat can be as narrow as 40%, so its header must go icon-only
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1440)
  useEffect(() => {
    const onResize = () => setIsNarrowViewport(window.innerWidth < 1440)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Fetch available models for ConfigPanel (filtered by user's API keys).
  // Deferred — only fires the first time the user actually opens ConfigPanel
  // for a step. The pricing + keys responses together can be 15–30 KB, and
  // the data is never read until the user clicks a step and opens its model
  // dropdown. Fetched once per session; subsequent ConfigPanel opens reuse
  // the cached `configModels`.
  const configModelsLoadedRef = useRef(false)
  useEffect(() => {
    if (configModelsLoadedRef.current) return
    if (!(configSlideOpen && configMode === 'step-detail')) return
    configModelsLoadedRef.current = true
    Promise.all([
      import('../services/api').then(m => m.creditsAPI.getPricing()),
      import('../services/api').then(m => m.keysAPI.getAll()),
    ]).then(([pricingRes, keysRes]) => {
      const providers = (keysRes.data.keys || []).filter(k => k.is_active).map(k => k.provider.replace('_oauth', ''))
      const normalized = [...new Set(providers)]
      const models = (pricingRes.data?.models || [])
        .filter(m => normalized.includes(m.provider))
        .map(m => ({ id: m.model, label: m.display_name || m.model, provider: m.provider }))
      if (models.length > 0) setConfigModels(models)
    }).catch(() => {
      // Allow retry on next ConfigPanel open if first attempt failed
      configModelsLoadedRef.current = false
    })
  }, [configSlideOpen, configMode])

  // === DATA LOADING — all from backend ===
  //
  // Load order tuned for *perceived* speed: the chat panel is what users
  // look at first, so its content has to appear first. We fire chat history
  // at T=0 (before anything else) and gate the global `loading` flag on just
  // the workflow doc fetch — steps + task-history hydrate in the background
  // and render their own skeletons inside StepsPanel / RunsPanel.
  //
  // Net effect on the wire:
  //   T=0   → chat?limit=5 + workflows/{id} fire in parallel
  //   T~300 → workflows resolves → setAgent → loading=false → ChatPanel mounts
  //           → ChatPanel's useEffect fires chatAPI.getHistory → DEDUP HIT
  //           on the in-flight chat fetch (services/api.js _chatHistoryInflight)
  //           → resolves with already-loaded data
  //   T~500 → chat content visible to user
  //   T~1s  → steps + task-history badge populate in their own panels
  const loadAllData = async () => {
    if (!agentId) return
    setLoading(true)
    setStepsReady(false)

    // (B1) Fire chat history immediately, fire-and-forget. Warms the
    // chatAPI in-flight cache so when ChatPanel mounts it gets the data
    // instantly via the dedup map keyed by (agentId, session, limit, before).
    // The catch swallows errors here — ChatPanel itself reports them via its
    // own fetch path, so we don't need to handle them twice.
    chatAPI.getHistory(agentId, { limit: 5 }).catch(() => {})

    // (B2) The workflow doc is the only fetch that gates UI mount. ChatPanel
    // can't render without `agent`, but Steps/Task-history panels CAN render
    // with their own skeletons.
    let agentRes
    try {
      agentRes = await workflowsAPI.getOne(agentId)
    } catch {
      navigate('/dashboard')
      return
    }
    setAgent(agentRes.data)
    // Pre-seed steps from the agent.config snapshot if the dedicated steps
    // collection hasn't responded yet. Most modern agents have empty
    // config.steps, so this is mostly a no-op fallback for legacy data.
    // If we DO get pre-seed data we can flip stepsReady early — no need to
    // make the user stare at a skeleton when we already have data to show.
    if (Array.isArray(agentRes.data.config?.steps) && agentRes.data.config.steps.length > 0) {
      setSteps(agentRes.data.config.steps)
      setStepsReady(true)
    }
    if (agentRes.data.config?.credentials) {
      setCollectedCredentials(agentRes.data.config.credentials)
    }
    // Unblock the UI now — ChatPanel mounts, hits the in-flight chat fetch.
    setLoading(false)

    // Background hydration — non-blocking, fires in parallel after agent
    // doc is in. Both swallow errors gracefully; their panels stay in
    // skeleton state on failure rather than crashing the whole page.
    stepsAPI.list(agentId, { fields: 'meta' })
      .then((stepsRes) => {
        const loaded = Array.isArray(stepsRes.data.steps) ? stepsRes.data.steps : []
        if (loaded.length > 0) setSteps(loaded)
      })
      .catch(() => {})
      .finally(() => setStepsReady(true))
    taskHistoryAPI.list(agentId, 1)
      .then((runsRes) => {
        setRunsCount(runsRes.data.total || runsRes.data.runs?.length || 0)
      })
      .catch(() => {})
  }

  useEffect(() => { loadAllData() }, [agentId])

  const selectedStep = steps.find((s) => s.id === selectedStepId) || null
  const agentSlugOrId = agent?.slug || agent?.id

  // === SAVE TO BACKEND — every mutation writes to DB ===

  // Save credentials to agent.config in DB (steps are saved via stepsAPI)
  const saveConfigToBackend = (updatedSteps, updatedCreds) => {
    if (!agentSlugOrId) return
    workflowsAPI.update(agentSlugOrId, {
      config: {
        credentials: updatedCreds ?? collectedCredentials,
      },
    }).catch((e) => console.error('Failed to save config:', e))
  }

  const handleDeleteStep = async (stepId) => {
    const id = agent?.slug || agent?.id
    if (!id) return
    try {
      await stepsAPI.delete(id, stepId)
      setSteps((prev) => prev.filter((s) => s.id !== stepId))
      if (selectedStepId === stepId) setSelectedStepId(null)
      markDirty()
      toast.success('Step deleted')
    } catch (e) {
      console.error('Delete step failed:', e?.response?.data || e)
      toast.error(e?.response?.data?.error || 'Failed to delete step')
    }
  }

  const handleStepAdded = async (newStep) => {
    const id = agent?.slug || agent?.id
    if (!id) return

    // Use functional updater to check against LATEST state (avoids race conditions
    // when multiple steps are parsed rapidly from a single AI message)
    let alreadyExists = false
    let matchedStepId = null
    setSteps((prev) => {
      // Match by ID only — name is NOT a unique identifier
      const existing = newStep.id ? prev.find((s) => s.id === newStep.id) : null
      if (existing) {
        alreadyExists = true
        matchedStepId = existing.id
        return prev.map((s) => s === existing ? { ...s, ...newStep } : s)
      }
      return prev // don't add yet — we'll add after API call
    })

    if (alreadyExists) {
      const stepId = matchedStepId
      if (stepId && !stepId.startsWith('step_')) {
        // Normalize fields for backend
        const updateData = {}
        if (newStep.name) updateData.name = newStep.name
        if (newStep.description) updateData.description = newStep.description
        if (newStep.step_type) updateData.step_type = newStep.step_type
        if (newStep.status) updateData.status = newStep.status
        if (newStep.llm_model) updateData.llm_model = newStep.llm_model
        if (newStep.system_prompt != null) updateData.system_prompt = newStep.system_prompt
        if (newStep.tools) updateData.tools = newStep.tools
        if (newStep.max_tool_calls != null) updateData.max_tool_calls = newStep.max_tool_calls
        if (newStep.code_body != null) updateData.code_body = newStep.code_body
        if (newStep.order != null) updateData.order = newStep.order

        try {
          const res = await stepsAPI.update(id, stepId, updateData)
          // Refresh local state with server response
          setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, ...res.data } : s))
          markDirty()
        } catch (e) {
          console.error('Failed to update step:', e)
          // Revert local state on failure
          setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s } : s))
        }
      }
      return
    }

    // Create new step via API
    try {
      const stepData = {
        name: newStep.name,
        description: newStep.description || '',
        step_type: newStep.step_type || 'ai',
        status: newStep.status || 'proposed',
        llm_model: newStep.llm_model || agent?.model || 'claude-opus-4-6',
        system_prompt: newStep.system_prompt || '',
        tools: newStep.tools || [],
        max_tool_calls: newStep.max_tool_calls ?? 10,
      }
      if (newStep.code_body) stepData.code_body = newStep.code_body
      if (newStep.order != null) stepData.order = newStep.order
      const res = await stepsAPI.create(id, stepData)
      setSteps((prev) => {
        // Dedup by ID only (not name)
        if (prev.find((s) => s.id === res.data.id)) {
          return prev.map((s) => s.id === res.data.id ? { ...s, ...res.data } : s)
        }
        // Sort by order so inserted steps appear in correct position
        return [...prev, res.data].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      })
      setSelectedStepId(res.data.id)
      markDirty()
    } catch (e) {
      console.error('Failed to create step:', e)
      // Fallback: add to local state with temp ID
      setSteps((prev) => {
        const tempStep = { ...newStep, id: newStep.id || `step_${Date.now()}` }
        return [...prev, tempStep]
      })
    }
  }

  const handleStepUpdatedByName = async (stepName, updates) => {
    const id = agent?.slug || agent?.id
    const step = steps.find((s) => s.name === stepName)
    if (!id || !step) return

    // Update local state immediately
    setSteps((prev) => prev.map((s) => s.name === stepName ? { ...s, ...updates } : s))
    // Persist to API
    try {
      await stepsAPI.update(id, step.id, updates)
      markDirty()
    } catch (e) {
      console.error('Failed to update step:', e)
    }
  }

  const handleStepUpdate = async (stepId, updates) => {
    const id = agent?.slug || agent?.id
    if (!id) return

    // Update local state immediately
    setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, ...updates } : s))
    // Persist to API
    try {
      await stepsAPI.update(id, stepId, updates)
      markDirty()
    } catch (e) {
      console.error('Failed to update step:', e)
    }
  }

  // Reset compile status when files or steps change
  const invalidateCompile = () => {
    setCompileSuccess(null)
    setCompileError(null)
    if (agent?.status === 'compiled' || agent?.status === 'deployed') {
      setAgent((prev) => prev ? { ...prev, status: 'ready' } : prev)
      if (agentSlugOrId) {
        workflowsAPI.update(agentSlugOrId, { status: 'ready' }).catch(() => {})
      }
    }
  }

  const handleClearAgent = async () => {
    if (!agentSlugOrId) return
    setSteps([])
    setSelectedStepId(null)
    setCollectedCredentials({})
    try {
      await workflowsAPI.update(agentSlugOrId, { status: 'draft', instructions: '', config: { steps: [], credentials: {} } })
      setAgent((prev) => prev ? { ...prev, status: 'draft', instructions: null } : prev)
    } catch {}
    toast.success('Workflow cleared — ready for a new use case')
  }

  const handleInstructionsUpdated = async (instructions) => {
    const id = agent?.slug || agent?.id
    if (!id) return
    try {
      await workflowsAPI.update(id, { instructions })
      setAgent((prev) => prev ? { ...prev, instructions } : prev)
    } catch (e) {
      console.error('Failed to save agent instructions:', e)
    }
  }

  const handleWebhookSchemaUpdated = (schema) => {
    setAgent((prev) => prev ? { ...prev, webhook_input_schema: schema } : prev)
  }

  const handleStepReorder = async (reorderList) => {
    const id = agent?.slug || agent?.id
    if (!id) return

    // Update local state immediately
    setSteps((prev) => {
      const reordered = [...prev]
      reorderList.forEach(({ name, order }) => {
        const step = reordered.find((s) => s.name === name)
        if (step) step.order = order
      })
      reordered.sort((a, b) => (a.order || 0) - (b.order || 0))
      return reordered
    })

    // Build API payload — map names to IDs with new order values
    const apiSteps = reorderList
      .map(({ name, order }) => {
        const step = steps.find((s) => s.name === name)
        return step ? { id: step.id, order } : null
      })
      .filter(Boolean)

    try {
      await stepsAPI.reorder(id, { steps: apiSteps })
    } catch (e) {
      console.error('Failed to reorder steps:', e)
    }
  }

  // Close the right-side slide-over AND clear the selected-step highlight in
  // the Steps panel, so dismissing the panel never leaves a misleading
  // "selected" row behind. Safe to call from every close site (X button,
  // backdrop click, toggle-off, post-delete) — the selection state is reset
  // regardless of which mode the panel was in.
  const closeConfigPanel = () => {
    setConfigSlideOpen(false)
    setSelectedStepId(null)
    setSelectedRunId(null)
  }

  const handleSelectStep = (stepId) => {
    if (configSlideOpen && selectedStepId === stepId && configMode === 'step-detail') {
      closeConfigPanel()
      return
    }
    setSelectedStepId(stepId)
    setSelectedRunId(null)
    setConfigMode('step-detail')
    setConfigSlideOpen(true)
    setFocusedPanel('config')

    // Lazy-hydrate the heavy fields (code_body / system_prompt). The list call
    // uses ?fields=meta and omits them, so first click on a step fires a
    // single-step GET and merges the full detail into the steps array. Once
    // hydrated, re-clicking the same step is a no-op.
    const id = agent?.slug || agent?.id
    const target = steps.find((s) => s.id === stepId)
    if (id && target && target.system_prompt === undefined) {
      stepsAPI.getOne(id, stepId)
        .then((res) => {
          setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, ...res.data } : s))
        })
        .catch(() => { /* keep lite view; user can retry by re-clicking */ })
    }
  }

  const handleSelectRun = (runId, runMeta = null) => {
    if (configSlideOpen && selectedRunId === runId && configMode === 'task-detail') {
      closeConfigPanel()
      return
    }
    setSelectedRunId(runId)
    setSelectedRunMeta(runMeta)
    setSelectedStepId(null)
    setConfigMode('task-detail')
    setConfigSlideOpen(true)
    setFocusedPanel('config')
  }

  const verifiedCount = (Array.isArray(steps) ? steps : []).filter((s) => s.status === 'verified').length

  if (loading) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-neutral-100 dark:bg-[#1a1a1a]">
        <DashboardSidebar activeTab="builder" collapsed={sidebarCollapsed} onToggleCollapse={() => {}} mobileOpen={false} onCloseMobile={() => {}} />
        <div className="flex-1 flex flex-col min-w-0 relative">
          <TopBar
            onMenuClick={() => {}}
            mode="auto-hide"
            forcePinned={downtime.active}
            downtimeActive={downtime.active}
            downtimeMessage={downtime.message}
          />
          <div className="flex-1 overflow-hidden hidden lg:flex gap-3.5 p-3.5">
            {/* Chat panel skeleton — mirrors flex-[3] / flex-[2] split of the real layout */}
            <div className="flex-[3] min-[1440px]:flex-[7] min-w-0 bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] flex flex-col overflow-hidden">
              {/* Header (~py-1.5, no border-b in real) — webhook chip + search | provider chip + cog */}
              <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-[110px] rounded-lg bg-neutral-100 dark:bg-[#383838] border border-neutral-200/70 dark:border-[#484848] animate-pulse" />
                  <div className="h-7 w-7 rounded-lg bg-neutral-100 dark:bg-[#383838] border border-neutral-200/70 dark:border-[#484848] animate-pulse" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-[150px] rounded-lg bg-neutral-100 dark:bg-[#383838] border border-neutral-200/70 dark:border-[#484848] animate-pulse" />
                  <div className="h-7 w-7 rounded-lg bg-neutral-100 dark:bg-[#383838] animate-pulse" />
                </div>
              </div>
              {/* Body — bubble skeletons matching alternating chat layout, max-width centered like real */}
              <div className="flex-1 overflow-hidden px-4 py-6">
                <div className="max-w-[820px] xl:max-w-[900px] mx-auto w-full space-y-7">
                  {[
                    { side: 'right', w: '52%', lines: 1 },
                    { side: 'left',  w: '82%', lines: 3 },
                    { side: 'right', w: '38%', lines: 1 },
                    { side: 'left',  w: '74%', lines: 2 },
                    { side: 'right', w: '46%', lines: 2 },
                    { side: 'left',  w: '78%', lines: 3 },
                  ].map((b, i) => (
                    <div key={i} className={`flex ${b.side === 'right' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`space-y-2 ${b.side === 'right' ? 'rounded-2xl bg-neutral-100/80 dark:bg-[#383838]/60 px-4 py-3' : ''}`}
                        style={{ width: b.w, maxWidth: '85%' }}
                      >
                        {Array.from({ length: b.lines }).map((_, li) => (
                          <div
                            key={li}
                            className={`${li === 0 ? 'h-3.5 bg-neutral-200 dark:bg-[#484848]' : 'h-3 bg-neutral-100 dark:bg-[#4a4a4a]'} rounded animate-pulse`}
                            style={{ width: li === b.lines - 1 && b.lines > 1 ? '65%' : '100%' }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Composer — matches real wrapper px-2 pt-2 pb-4 + inner rounded-xl bg-neutral-100 px-3 py-2 (textarea ~44px + buttons row ~44px) */}
              <div className="flex-shrink-0 px-2 pt-2 pb-4">
                <div className="max-w-[820px] xl:max-w-[900px] mx-auto w-full">
                  <div className="rounded-xl bg-neutral-100 dark:bg-[#383838] px-3 py-2">
                    <div className="space-y-2 pt-1.5 pb-1" style={{ minHeight: '44px' }}>
                      <div className="h-3 w-2/5 bg-neutral-200 dark:bg-[#484848] rounded animate-pulse" />
                      <div className="h-3 w-1/3 bg-neutral-200/70 dark:bg-[#484848]/70 rounded animate-pulse" />
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <div className="h-11 w-11 rounded-lg bg-neutral-200 dark:bg-[#484848] animate-pulse" />
                      <div className="h-11 w-11 rounded-xl bg-emerald-200 dark:bg-emerald-900/40 animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Steps panel skeleton — flex-[2] / min-[1440px]:flex-[3] like real */}
            <div className="flex-[2] min-[1440px]:flex-[3] min-w-0 bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] flex flex-col overflow-hidden">
              {/* Tab header — Steps | Task History, py-3 each, with bottom border + active-tab indicator */}
              <div className="flex border-b border-neutral-200 dark:border-[#484848] flex-shrink-0">
                <div className="flex-1 flex items-center justify-center gap-2 py-3 border-b-2 border-primary-500">
                  <div className="h-3.5 w-3.5 rounded bg-neutral-300 dark:bg-[#5a5a5a] animate-pulse" />
                  <div className="h-3.5 w-10 bg-neutral-300 dark:bg-[#5a5a5a] rounded animate-pulse" />
                  <div className="h-4 w-5 bg-primary-500/80 rounded-md animate-pulse" />
                </div>
                <div className="flex-1 flex items-center justify-center gap-2 py-3 border-b-2 border-transparent">
                  <div className="h-3.5 w-3.5 rounded bg-neutral-200 dark:bg-[#484848] animate-pulse" />
                  <div className="h-3.5 w-20 bg-neutral-200 dark:bg-[#484848] rounded animate-pulse" />
                  <div className="h-4 w-5 bg-neutral-200 dark:bg-[#484848] rounded-md animate-pulse" />
                </div>
              </div>
              {/* Step cards — px-4 py-3.5 with title row + Non-AI pill + 1-line description, connector arrow between */}
              <div className="flex-1 overflow-hidden px-3 py-3 space-y-0">
                {[0, 1, 2].map(i => (
                  <div key={i}>
                    <div className="rounded-lg border border-neutral-200 dark:border-[#484848] px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 justify-between">
                            <div className="h-3.5 bg-neutral-200 dark:bg-[#484848] rounded animate-pulse" style={{ width: '55%' }} />
                            <div className="h-4 w-12 bg-emerald-100 dark:bg-emerald-900/30 rounded animate-pulse flex-shrink-0" />
                          </div>
                          <div className="h-2.5 mt-2 bg-neutral-100 dark:bg-[#4a4a4a] rounded animate-pulse" style={{ width: '85%' }} />
                        </div>
                      </div>
                    </div>
                    {i < 2 && (
                      <div className="flex justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" className="text-neutral-300 dark:text-neutral-600">
                          <line x1="12" y1="0" x2="12" y2="16" stroke="currentColor" strokeWidth="2" />
                          <polyline points="8,12 12,16 16,12" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Footer — px-3 py-2.5 with Update (primary) + Test Workflow (outline) buttons (px-3.5 py-2) */}
              <div className="px-3 py-2.5 border-t border-neutral-200 dark:border-[#484848] flex-shrink-0">
                <div className="flex gap-1.5">
                  <div className="flex-1 h-[34px] rounded-lg bg-primary-500/80 animate-pulse" />
                  <div className="flex-1 h-[34px] rounded-lg border border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#383838] animate-pulse" />
                </div>
              </div>
            </div>
          </div>
          {/* Below-lg skeleton */}
          <div className="flex-1 lg:hidden p-3">
            <div className="h-full bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-4 space-y-4 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-neutral-200 dark:bg-[#484848] rounded w-3/4" />
                  <div className="h-3 bg-neutral-100 dark:bg-[#4a4a4a] rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }


  return (
    <div className="flex h-[100dvh] overflow-hidden bg-neutral-100 dark:bg-[#1a1a1a]">
      <DashboardSidebar
        activeTab="builder"
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top bar — auto-hide on BuilderPage so chat takes the full height
            by default. Pin toggle on the bar lets the user lock it visible.
            forcePinned overrides auto-hide during deploy-downtime so the
            inline maintenance indicator stays visible without the user
            having to hover. The indicator itself is rendered inside TopBar. */}
        <TopBar
          onMenuClick={() => setMobileMenuOpen(true)}
          currentAgentName={agent?.name}
          mode="auto-hide"
          forcePinned={downtime.active}
          downtimeActive={downtime.active}
          downtimeMessage={downtime.message}
        />

        {/* Tab bar (below lg) */}
        <div className="lg:hidden flex border-b border-neutral-200 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] flex-shrink-0">
          {[
            { id: 'chat', label: 'Chat', icon: MessageSquare },
            { id: 'steps', label: `Steps (${steps.length})`, icon: Layers },
            { id: 'history', label: runsCount > 0 ? `History (${runsCount})` : 'History', icon: Clock },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              aria-label={tab.label}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium border-b-2 transition-colors min-h-[36px] ${
                mobileTab === tab.id ? 'text-primary-600 border-primary-500' : 'text-neutral-400 border-transparent'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Settings View — removed, now in slide-over panel */}
        {currentView === 'settings_DISABLED' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-neutral-50 dark:bg-[#2c2c2c]">
            <div className="max-w-xl space-y-5">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Workflow Configuration</h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Manage your workflow's settings, model, and memory configuration.</p>
              </div>

              {/* Agent Name */}
              <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">Workflow Name</label>
                <WorkflowNameField
                  value={agent?.name || ''}
                  inputClassName="w-full px-3 py-2.5 text-sm rounded-lg bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 border"
                  onSave={async (val) => {
                    const res = await workflowsAPI.update(agent?.slug || agent?.id, { name: val })
                    const updated = res.data
                    setAgent((prev) => prev ? { ...prev, name: updated.name || val, slug: updated.slug || prev.slug } : prev)
                    if (updated.slug && updated.slug !== agent?.slug) {
                      navigate(`/workflows/${updated.slug}`, { replace: true })
                    }
                  }}
                />
              </div>

              {/* Description */}
              <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">Description</label>
                <textarea
                  defaultValue={agent?.description || ''}
                  rows={3}
                  onBlur={(e) => {
                    workflowsAPI.update(agent?.slug || agent?.id, { description: e.target.value.trim() }).then(() => {
                      setAgent((prev) => prev ? { ...prev, description: e.target.value.trim() } : prev)
                    }).catch(() => {})
                  }}
                  className="w-full px-3 py-2.5 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                  placeholder="Describe what this workflow does..."
                />
              </div>

              {/* Default Model */}
              <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Bot size={16} className="text-neutral-500 dark:text-neutral-400" />
                  <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Default Model</label>
                </div>
                <select
                  value={agent?.model || 'claude-opus-4-6'}
                  onChange={(e) => {
                    const model = e.target.value
                    workflowsAPI.update(agent?.slug || agent?.id, { model }).then(() => {
                      setAgent((prev) => prev ? { ...prev, model } : prev)
                      toast.success('Model updated')
                    }).catch(() => toast.error('Failed to update'))
                  }}
                  className="w-full px-3 py-2.5 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100"
                >
                  <optgroup label="Anthropic">
                    <option value="claude-opus-4-6">Claude Opus 4.6</option>
                    <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                    <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                  </optgroup>
                  <optgroup label="OpenAI">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                  </optgroup>
                  <optgroup label="Google">
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  </optgroup>
                </select>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-2">The AI model used for this workflow's conversations and pipeline steps.</p>
              </div>

              {/* Memory Configuration */}
              <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>
                  <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Memory Configuration</label>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">How the workflow retains information between interactions.</p>
                <div className="space-y-2">
                  {[
                    { id: 'session', label: 'Session Only', desc: 'Memory resets after each session', default: true },
                    { id: 'persistent', label: 'Persistent', desc: 'Memory persists across sessions (uses MongoDB)' },
                    { id: 'custom', label: 'Custom Window', desc: 'Set a custom context window size' },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        (agent?.config?.memory_mode || 'session') === opt.id
                          ? 'border-primary-300 bg-primary-50/50 dark:bg-primary-900/30'
                          : 'border-neutral-200 dark:border-[#484848] hover:border-neutral-300 dark:hover:border-neutral-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="memory_mode"
                        checked={(agent?.config?.memory_mode || 'session') === opt.id}
                        onChange={() => {
                          const config = { ...(agent?.config || {}), memory_mode: opt.id }
                          workflowsAPI.update(agent?.slug || agent?.id, { config }).then(() => {
                            setAgent((prev) => prev ? { ...prev, config } : prev)
                            toast.success('Memory mode updated')
                          }).catch(() => {})
                        }}
                        className="mt-0.5 accent-primary-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{opt.label}</p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Invoke URL / Deploy Prompt */}
              <div className="space-y-4">
                {webhookUrl ? (
                  <>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" /></span>
                        <label className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Invoke URL</label>
                        <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 rounded-full font-medium ml-auto">Deployed</span>
                      </div>
                      {agent?.deployed_at && <p className="text-[10px] text-emerald-600/70 mb-2">Last deployed: {new Date(agent.deployed_at).toLocaleString()}</p>}
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-white dark:bg-[#383838] px-3 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 font-mono text-neutral-700 dark:text-neutral-200 truncate" title={webhookUrl}>{webhookUrl}</code>
                        <button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('URL copied!') }} className="px-3 py-2.5 text-xs font-medium text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg hover:bg-emerald-200 flex-shrink-0">Copy</button>
                      </div>
                    </div>

                    {/* Sample cURL — VS Code Dark+ chrome (matches the Step
                        Config code block) but with strict word-wrap and no
                        horizontal scrollbar, and a prettified multi-line
                        layout so each part of the request is easy to read. */}
                    <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Sample cURL Request</label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-[#484848] text-neutral-500 dark:text-neutral-400">POST</span>
                      </div>
                      {(() => {
                        const schema = agent?.webhook_input_schema
                        const samplePayload = schema?.length > 0
                          ? schema.reduce((acc, f) => { acc[f.name || f.field] = f.example || f.type || 'value'; return acc }, {})
                          : { message: 'your input here' }
                        // Use the logged-in user's identity so the sample cURL the user
                        // copies is attributed to them in the FaaS audit trail (was a
                        // hardcoded "API / api@example.com" dummy before).
                        const bodyJson = JSON.stringify({ invoked_by: { name: authUser?.name, email: authUser?.email }, ...samplePayload }, null, 2)
                        const curlCmd = agent?.curl_command || `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyJson.replace(/'/g, "\\'")}'`
                        return (
                          <div className="group relative rounded-lg overflow-hidden border border-[#2d2d2d] bg-[#2c2c2c]">
                            <button
                              type="button"
                              onClick={() => { navigator.clipboard.writeText(curlCmd); toast.success('cURL copied!') }}
                              title="Copy cURL"
                              aria-label="Copy cURL"
                              className="absolute top-1.5 right-1.5 z-20 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#2d2d2d]/90 hover:bg-[#484848] text-[#cccccc] hover:text-white text-[10px] font-medium border border-[#484848] transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <Copy size={11} />
                              Copy
                            </button>
                            <pre
                              className="m-0 px-4 py-3 pr-14 text-[12px] font-mono text-[#d4d4d4] whitespace-pre-wrap break-all overflow-x-hidden overflow-y-auto max-h-[24rem] leading-[1.5rem]"
                              aria-label="Sample cURL request"
                            >
                              <span className="text-[#dcdcaa]">curl</span>
                              <span className="text-[#d4d4d4]"> -X </span>
                              <span className="text-[#ce9178]">POST</span>
                              <span className="text-[#d4d4d4]"> </span>
                              <span className="text-[#ce9178]">"{webhookUrl}"</span>
                              <span className="text-[#d4d4d4]"> \</span>
                              {'\n  '}
                              <span className="text-[#d4d4d4]">-H </span>
                              <span className="text-[#ce9178]">"Content-Type: application/json"</span>
                              <span className="text-[#d4d4d4]"> \</span>
                              {'\n  '}
                              <span className="text-[#d4d4d4]">-d </span>
                              <span className="text-[#ce9178]">{"'" + bodyJson + "'"}</span>
                            </pre>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Input Payload Format */}
                    {agent?.webhook_input_schema?.length > 0 && (
                      <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                        <label className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">Input Payload Format</label>
                        <div className="space-y-1.5">
                          {agent.webhook_input_schema.map((field, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <code className="px-1.5 py-0.5 bg-neutral-100 dark:bg-[#383838] rounded font-mono text-neutral-700 dark:text-neutral-300">{field.name || field.field}</code>
                              <span className="text-neutral-400">{field.type || 'string'}</span>
                              {field.example && <span className="text-neutral-500 italic">e.g. {String(field.example)}</span>}
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-neutral-400 mt-2">All requests must include <code className="text-[10px]">invoked_by: {'{'}name, email{'}'}</code> in the payload.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-5 text-center">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">No Invoke URL yet</p>
                    <p className="text-xs text-amber-600/80 dark:text-amber-500/80">Click the <strong>Deploy</strong> button in the Steps panel to deploy this agent to Pabbly Functions and get an invoke URL.</p>
                  </div>
                )}
              </div>

              {/* Status + Agent ID */}
              <div className="bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1 block">Status</label>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      agent?.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                      agent?.status === 'deployed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                      agent?.status === 'compiled' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      agent?.status === 'ready' ? 'bg-neutral-100 dark:bg-[#484848] text-neutral-700 dark:text-neutral-300' :
                      'bg-neutral-100 dark:bg-[#484848] text-neutral-500 dark:text-neutral-400'
                    }`}>
                      {agent?.status || 'draft'}
                    </span>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1 block">Workflow ID</label>
                    <code className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{agent?.id}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Desktop (lg+): 1024-1439 = 2-col (Chat + one of Steps/Config); ≥1440 = 3-col (Chat + Steps + Config inline) */}
        <div className="flex-1 overflow-hidden hidden lg:flex gap-3 lg:gap-3.5 p-2.5 lg:p-3.5">
          {/* Chat Panel — Steps has fixed width; only Chat vs Config focus-resizes. 1024-1439 2-col: fixed 60% (closed) or 50% (open). ≥1440 closed: 70%. ≥1440 3-col: focus chat = flex-[2], else flex-1 */}
          <div
            className={`${configSlideOpen ? 'flex-1' : 'flex-[3]'} ${configSlideOpen ? (focusedPanel === 'chat' ? 'min-[1440px]:flex-[2]' : 'min-[1440px]:flex-1') : 'min-[1440px]:flex-[7]'} min-w-0 h-full bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] shadow-sm flex flex-col overflow-hidden transition-all duration-200`}
            onMouseDown={() => { if (configSlideOpen) setFocusedPanel('chat') }}
          >
            <ErrorBoundary>
            <ChatPanel agent={agent} steps={steps} onProviderSwitching={setSwitchingProvider} onStepAdded={handleStepAdded} onStepUpdated={handleStepUpdatedByName} onStepReorder={handleStepReorder} onClearAgent={handleClearAgent} onInstructionsUpdated={handleInstructionsUpdated} onWebhookSchemaUpdated={handleWebhookSchemaUpdated} onActivate={handleActivate} actionLoading={actionLoading} compileError={compileError} compileSuccess={compileSuccess} testResult={testResult} onDismissCompileError={() => setCompileError(null)} onDismissCompileSuccess={() => setCompileSuccess(null)} onDismissTestResult={() => setTestResult(null)} collectedCredentials={collectedCredentials} onCredentialCollected={(key, val) => { setCollectedCredentials(prev => { const updated = {...prev, [key]: val}; saveConfigToBackend(null, updated); return updated }) }} onStepsRefreshed={(newSteps, toolName) => { setSteps(newSteps); if (!toolName || ['create_step','update_step','delete_step','set_webhook_schema'].includes(toolName)) markDirty() }} onRefreshAgent={() => { const id = agent?.slug || agent?.id; if (id) workflowsAPI.getOne(id).then(r => setAgent(r.data)).catch(() => {}) }} onWorkflowDeployed={(data) => setAgent((prev) => {
                if (!prev) return prev
                const next = { ...prev, needs_redeploy: false, status: 'active' }
                // Populate deploy IDs from the tool result when local state is
                // missing them — e.g., if the agent was loaded before the
                // background auto-deploy on creation had populated these fields.
                if (data?.pabbly_functions_id && !prev.pabbly_functions_id) next.pabbly_functions_id = data.pabbly_functions_id
                if (data?.invocation_url && !prev.invocation_url) next.invocation_url = data.invocation_url
                return next
              })} activeExecution={activeExecution} onTrackExecution={trackExecution} creditRefreshKey={creditRefreshKey} webhookUrl={webhookUrl} allAgents={agents} onSwitchAgent={(slug) => navigate(`/workflows/${slug}`)} onCredentialsChanged={handleCredentialsChanged} onOpenSettings={() => { if (configSlideOpen && configMode === 'settings') { setConfigSlideOpen(false) } else { setConfigMode('settings'); setConfigSlideOpen(true); setFocusedPanel('config') } }} onOpenShare={(agent?.effective_role === 'owner' || !agent?.effective_role) ? () => setShareModalOpen(true) : undefined} onOpenTeamAccess={(agent?.effective_role === 'owner' || agent?.effective_role === 'full_control' || !agent?.effective_role) ? () => setTeamAccessOpen(true) : undefined} compact={isNarrowViewport || (configSlideOpen && focusedPanel !== 'chat')} pendingChatInput={pendingChatInput} onPendingChatInputConsumed={clearPendingChatInput} />
            </ErrorBoundary>
          </div>

          {/* Steps Panel — fixed width, never focus-resizes. 1024-1439: 40% (closed) / hidden (config open). ≥1440 closed (2-col): 30%. ≥1440 open (3-col): flex-1 — shares with config */}
          <div
            className={`flex-[2] ${configSlideOpen ? 'min-[1440px]:flex-1' : 'min-[1440px]:flex-[3]'} min-w-0 h-full bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] shadow-sm flex-col overflow-hidden transition-all duration-200 ${configSlideOpen ? 'hidden min-[1440px]:flex' : 'flex'}`}
          >
            <ErrorBoundary>
            <StepsPanel steps={steps} stepsReady={stepsReady} selectedStepId={selectedStepId} onSelectStep={handleSelectStep} onStepsChange={setSteps} onDeleteStep={handleDeleteStep} agent={agent} onActivate={handleActivate} onTest={() => queueChatInput('Test my workflow')} actionLoading={actionLoading} switchingProvider={switchingProvider} runsCount={runsCount} activeExecution={activeExecution} onTrackExecution={trackExecution} onToggleAgentStatus={handleToggleAgentStatus} onSyncDeploy={() => queueChatInput('Update the workflow')} onSelectRun={handleSelectRun} selectedRunId={selectedRunId} />
            </ErrorBoundary>
          </div>

          {/* Config Panel — 1024-1439: replaces Steps; fixed 50%. ≥1440 3-col: focus-resize with Chat (flex-[2] focused, flex-1 else) */}
          {configSlideOpen ? (
            <div
              className={`flex-1 ${focusedPanel === 'config' ? 'min-[1440px]:flex-[2]' : 'min-[1440px]:flex-1'} min-w-0 h-full bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200 dark:border-[#484848] shadow-sm flex flex-col overflow-hidden transition-all duration-200`}
              onMouseDown={() => setFocusedPanel('config')}
            >
          <div className="h-11 flex items-center justify-between px-4 border-b border-neutral-200 dark:border-[#484848] flex-shrink-0 bg-neutral-50/80 dark:bg-[#383838]/80">
            <div className="flex items-center gap-2">
              {configMode === 'settings' ? (
                <>
                  <Settings size={14} className="text-primary-500" />
                  <span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Workflow Settings</span>
                </>
              ) : configMode === 'task-detail' ? (
                <>
                  <Clock size={14} className="text-primary-500" />
                  <span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Run Details</span>
                </>
              ) : (
                <>
                  <Settings size={14} className="text-emerald-500" />
                  <span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Step Config</span>
                </>
              )}
            </div>
            <Tooltip content="Close panel">
              <button
                onClick={closeConfigPanel}
                aria-label="Close panel"
                className="p-1.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#484848] rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-hidden">
            {configMode === 'task-detail' ? (
              <TaskDetailPanel runId={selectedRunId} runMeta={selectedRunMeta} agent={agent} steps={steps} activeExecution={activeExecution} onTrackExecution={trackExecution} switchingProvider={switchingProvider} />
            ) : configMode === 'settings' ? (
              <div className="h-full overflow-y-auto p-3">
                  <div className="space-y-3">

                    {/* ── Name ── */}
                    <div>
                      <Tooltip content="The display name of this workflow — shown in the dashboard, sidebar, and webhook logs">
                        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><FileText size={14} /> Name</label>
                      </Tooltip>
                      <WorkflowNameField
                        value={agent?.name || ''}
                        onSave={async (val) => {
                          const res = await workflowsAPI.update(agent?.slug || agent?.id, { name: val })
                          const updated = res.data
                          setAgent((prev) => prev ? { ...prev, name: updated.name || val, slug: updated.slug || prev.slug } : prev)
                          if (updated.slug && updated.slug !== agent?.slug) {
                            navigate(`/workflows/${updated.slug}`, { replace: true })
                          }
                        }}
                      />
                    </div>

                    {/* ── Description ── */}
                    <div>
                      <Tooltip content="A short summary of what this workflow does — for your own reference; not sent to the LLM at runtime">
                        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><FileText size={14} /> Description</label>
                      </Tooltip>
                      <textarea
                        key={agent?.description ?? ''}
                        defaultValue={agent?.description || ''}
                        rows={2}
                        onBlur={(e) => {
                          workflowsAPI.update(agent?.slug || agent?.id, { description: e.target.value.trim() }).then(() => {
                            setAgent((prev) => prev ? { ...prev, description: e.target.value.trim() } : prev)
                          }).catch(() => {})
                        }}
                        className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#2c2c2c] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                        placeholder="What does this workflow do?"
                      />
                    </div>

                    {/* ── AI Instructions ── */}
                    <div>
                      <Tooltip content="Persistent guidance the Master Agent reads at the top of every chat turn — use it to set tone, default behaviors, or constraints">
                        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><Sparkles size={14} /> AI instructions</label>
                      </Tooltip>
                      <textarea
                        key={agent?.instructions ?? ''}
                        defaultValue={agent?.instructions || ''}
                        rows={4}
                        onBlur={(e) => {
                          const val = e.target.value.trim()
                          if (val !== (agent?.instructions || '')) {
                            workflowsAPI.update(agent?.slug || agent?.id, { instructions: val }).then(() => {
                              setAgent((prev) => prev ? { ...prev, instructions: val } : prev)
                              toast.success('Instructions updated')
                            }).catch(() => toast.error('Failed to update'))
                          }
                        }}
                        className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#2c2c2c] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-y leading-relaxed"
                        placeholder="Optional: override the default system prompt for this workflow."
                      />
                    </div>

                    {/* Webhook section intentionally omitted on desktop —
                        chat-panel header already exposes it via the Webhook pill.
                        Mobile settings panel still renders the webhook (chat
                        header is hidden < sm). */}

                    {/* ── Stored Credentials (collapsible) ── */}
                    <StoredCredentialsCard ref={credentialsRef} agentId={agent?.slug || agent?.id} role={agent?.effective_role} onNeedsRedeploy={handleCredentialSettingsChange} />

                  </div>
              </div>
            ) : (
              <ConfigPanel step={selectedStep} stepIndex={selectedStep ? steps.findIndex((s) => s.id === selectedStep.id) : -1} agent={agent} onStepUpdate={handleStepUpdate} onDeleteStep={(id) => { handleDeleteStep(id); closeConfigPanel() }} availableModels={configModels} />
            )}
          </div>
          </div>
          ) : null}
        </div>

        {/* Below lg: all tabs rendered, inactive ones hidden with CSS to preserve state */}
        <div className="flex-1 overflow-hidden lg:hidden">
          <div className={mobileTab === 'chat' ? 'h-full bg-white dark:bg-[#2c2c2c]' : 'hidden'}><ChatPanel compact agent={agent} steps={steps} onProviderSwitching={setSwitchingProvider} onStepAdded={handleStepAdded} onStepUpdated={handleStepUpdatedByName} onStepReorder={handleStepReorder} onClearAgent={handleClearAgent} onInstructionsUpdated={handleInstructionsUpdated} onWebhookSchemaUpdated={handleWebhookSchemaUpdated} onActivate={handleActivate} actionLoading={actionLoading} compileError={compileError} compileSuccess={compileSuccess} testResult={testResult} onDismissCompileError={() => setCompileError(null)} onDismissCompileSuccess={() => setCompileSuccess(null)} onDismissTestResult={() => setTestResult(null)} collectedCredentials={collectedCredentials} onCredentialCollected={(key, val) => { setCollectedCredentials(prev => { const updated = {...prev, [key]: val}; saveConfigToBackend(null, updated); return updated }) }} onStepsRefreshed={(newSteps, toolName) => { setSteps(newSteps); if (!toolName || ['create_step','update_step','delete_step','set_webhook_schema'].includes(toolName)) markDirty() }} onRefreshAgent={() => { const id = agent?.slug || agent?.id; if (id) workflowsAPI.getOne(id).then(r => setAgent(r.data)).catch(() => {}) }} onWorkflowDeployed={(data) => setAgent((prev) => {
                if (!prev) return prev
                const next = { ...prev, needs_redeploy: false, status: 'active' }
                // Populate deploy IDs from the tool result when local state is
                // missing them — e.g., if the agent was loaded before the
                // background auto-deploy on creation had populated these fields.
                if (data?.pabbly_functions_id && !prev.pabbly_functions_id) next.pabbly_functions_id = data.pabbly_functions_id
                if (data?.invocation_url && !prev.invocation_url) next.invocation_url = data.invocation_url
                return next
              })} webhookUrl={webhookUrl} allAgents={agents} onSwitchAgent={(slug) => navigate(`/workflows/${slug}`)} onCredentialsChanged={handleCredentialsChanged} onOpenSettings={() => { setConfigMode('settings'); setConfigSlideOpen(true); setFocusedPanel('config') }} onOpenShare={(agent?.effective_role === 'owner' || !agent?.effective_role) ? () => setShareModalOpen(true) : undefined} onOpenTeamAccess={(agent?.effective_role === 'owner' || agent?.effective_role === 'full_control' || !agent?.effective_role) ? () => setTeamAccessOpen(true) : undefined} activeExecution={activeExecution} onTrackExecution={trackExecution} pendingChatInput={pendingChatInput} onPendingChatInputConsumed={clearPendingChatInput} /></div>
          <div className={mobileTab === 'steps' ? 'h-full bg-neutral-50 dark:bg-[#383838]' : 'hidden'}><StepsPanel steps={steps} stepsReady={stepsReady} selectedStepId={selectedStepId} onSelectStep={handleSelectStep} onStepsChange={setSteps} onDeleteStep={handleDeleteStep} agent={agent} onActivate={handleActivate} actionLoading={actionLoading} activeExecution={activeExecution} onTrackExecution={trackExecution} onToggleAgentStatus={handleToggleAgentStatus} onSyncDeploy={() => queueChatInput('Update the workflow')} hideTabs hideTestButton /></div>
          <div className={mobileTab === 'history' ? 'h-full bg-white dark:bg-[#2c2c2c] flex flex-col' : 'hidden'}>
            <div className="flex-1 overflow-y-auto"><RunsPanel agent={agent} activeExecution={activeExecution} steps={steps} isVisible={mobileTab === 'history'} onTrackExecution={trackExecution} onSelectRun={handleSelectRun} selectedRunId={selectedRunId} switchingProvider={switchingProvider} /></div>
            <div className="px-3 py-2 border-t border-neutral-200 dark:border-[#484848] flex-shrink-0">
              <button onClick={() => queueChatInput('Test my workflow')} disabled={steps.length === 0} className="w-full px-3 py-2 text-[11px] font-medium bg-white dark:bg-[#383838] text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-[#484848] rounded-lg hover:bg-neutral-100 dark:hover:bg-[#484848] disabled:opacity-40">
                Test Workflow
              </button>
            </div>
          </div>
        </div>

        {/* Below lg: Config slide-over (full-width overlay) */}
        {configSlideOpen && (
          <>
            <div className="fixed inset-0 bg-black/30 z-[55] lg:hidden" onClick={closeConfigPanel} />
            <div className="fixed top-0 right-0 h-full z-[60] lg:hidden flex flex-col w-full bg-white dark:bg-[#2c2c2c] shadow-2xl" role="dialog" aria-modal="true" aria-label="Configuration panel" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="h-11 flex items-center justify-between px-4 border-b border-neutral-200 dark:border-[#484848] flex-shrink-0 bg-neutral-50/80 dark:bg-[#383838]/80">
                <div className="flex items-center gap-2">
                  {configMode === 'settings' ? (
                    <><Settings size={14} className="text-primary-500" /><span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Workflow Settings</span></>
                  ) : configMode === 'task-detail' ? (
                    <><Clock size={14} className="text-primary-500" /><span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Run Details</span></>
                  ) : (
                    <><Settings size={14} className="text-emerald-500" /><span className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">Step Config</span></>
                  )}
                </div>
                <Tooltip content="Close panel"><button onClick={closeConfigPanel} aria-label="Close panel" className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-[#484848] rounded-lg transition-colors"><X size={16} /></button></Tooltip>
              </div>
              <div className="flex-1 overflow-hidden">
                {configMode === 'task-detail' ? (
                  <TaskDetailPanel runId={selectedRunId} runMeta={selectedRunMeta} agent={agent} steps={steps} activeExecution={activeExecution} onTrackExecution={trackExecution} switchingProvider={switchingProvider} />
                ) : configMode === 'settings' ? (
                  <div className="h-full overflow-y-auto p-4">
                    <div className="space-y-3">
                      <div>
                        <Tooltip content="The display name of this workflow — shown in the dashboard, sidebar, and webhook logs">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><FileText size={14} /> Name</label>
                        </Tooltip>
                        <input type="text" key={agent?.name ?? ''} defaultValue={agent?.name || ''} onBlur={(e) => { const val = e.target.value.trim(); if (val && val !== agent?.name) { workflowsAPI.update(agent?.slug || agent?.id, { name: val }).then((res) => { const u = res.data; setAgent((prev) => prev ? { ...prev, name: u.name || val, slug: u.slug || prev.slug } : prev); toast.success('Name updated'); if (u.slug && u.slug !== agent?.slug) navigate(`/workflows/${u.slug}`, { replace: true }) }).catch(() => toast.error('Failed to update')) } }} className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400" />
                      </div>
                      <div>
                        <Tooltip content="A short summary of what this workflow does — for your own reference; not sent to the LLM at runtime">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><FileText size={14} /> Description</label>
                        </Tooltip>
                        <textarea key={agent?.description ?? ''} defaultValue={agent?.description || ''} rows={2} onBlur={(e) => { workflowsAPI.update(agent?.slug || agent?.id, { description: e.target.value.trim() }).then(() => { setAgent((prev) => prev ? { ...prev, description: e.target.value.trim() } : prev) }).catch(() => {}) }} className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none" placeholder="What does this workflow do?" />
                      </div>
                      <div>
                        <Tooltip content="Persistent guidance the Master Agent reads at the top of every chat turn — use it to set tone, default behaviors, or constraints">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><Sparkles size={14} /> AI instructions</label>
                        </Tooltip>
                        <textarea
                          key={agent?.instructions ?? ''}
                          defaultValue={agent?.instructions || ''}
                          rows={4}
                          onBlur={(e) => { const val = e.target.value.trim(); if (val !== (agent?.instructions || '')) { workflowsAPI.update(agent?.slug || agent?.id, { instructions: val }).then(() => { setAgent((prev) => prev ? { ...prev, instructions: val } : prev); toast.success('Instructions updated') }).catch(() => toast.error('Failed to update')) } }}
                          className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-y leading-relaxed"
                          placeholder="Optional: override the default system prompt for this workflow."
                        />
                      </div>
                      {/* Webhook block — mobile only (< sm). At sm+ the chat-panel header pill renders it. */}
                      {webhookUrl && (() => {
                        const userName = authUser?.name || 'API Client'
                        const userEmail = authUser?.email || 'client@example.com'
                        const curlCmd = (() => {
                          if (agent?.curl_command) {
                            return agent.curl_command.replace(/"API Client"/g, `"${userName}"`).replace(/"client@example\.com"/g, `"${userEmail}"`)
                          }
                          const sample = { invoked_by: { name: userName, email: userEmail } }
                          if (agent?.webhook_input_schema?.length > 0) {
                            agent.webhook_input_schema.forEach(f => { sample[f.name || f.field] = f.example || `your_${f.name}_here` })
                          } else {
                            sample.message = "your input here"
                          }
                          return `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(sample, null, 2)}'`
                        })()
                        return (
                        <div className="sm:hidden">
                          <hr className="border-neutral-200 dark:border-[#484848] mb-3" />
                          <button
                            onClick={() => setSettingsWebhookOpen(!settingsWebhookOpen)}
                            className="w-full flex items-center gap-1.5 py-1"
                          >
                            <Webhook size={13} className="text-neutral-400 dark:text-neutral-500" />
                            <Tooltip content="The public POST URL that triggers this workflow from external services (Pabbly Connect, cron jobs, custom apps)">
                              <span className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-400 text-left cursor-help">Webhook</span>
                            </Tooltip>
                            <span className="flex-1" />
                            <Tooltip content={agent?.status === 'active' ? 'Workflow is deployed and ready to receive webhook calls' : 'Workflow is not currently active — webhook calls will be rejected'}>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help ${
                                agent?.status === 'active'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-neutral-100 dark:bg-[#484848] text-neutral-500 dark:text-neutral-400'
                              }`}>{agent?.status === 'active' ? 'LIVE' : 'INACTIVE'}</span>
                            </Tooltip>
                            <ChevronDown size={13} className={`text-neutral-400 dark:text-neutral-500 transition-transform duration-200 ${settingsWebhookOpen ? '' : '-rotate-90'}`} />
                          </button>
                          {settingsWebhookOpen && (
                            <div className="mt-2 space-y-2.5">
                              <div className="flex items-center gap-1.5 border border-neutral-200 dark:border-[#484848] rounded-lg bg-neutral-50 dark:bg-[#2a2a2a] px-3 h-[36px]">
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded flex-shrink-0">POST</span>
                                <code className="flex-1 min-w-0 text-[11px] font-mono text-neutral-600 dark:text-neutral-300 truncate">{webhookUrl}</code>
                                <button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('URL copied!') }} className="p-1 rounded text-neutral-400 hover:text-neutral-600 flex-shrink-0">
                                  <Copy size={12} />
                                </button>
                              </div>
                              <div>
                                <Tooltip content="A ready-to-run cURL command for triggering the webhook from a terminal or Postman">
                                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5 cursor-help"><Terminal size={14} /> cURL</label>
                                </Tooltip>
                                <CodeView code={curlCmd} language="js" rows={6} showLineNumbers lineWrapping copyLabel="Copy cURL" />
                              </div>
                            </div>
                          )}
                        </div>
                        )
                      })()}
                      <StoredCredentialsCard ref={credentialsRef} agentId={agent?.slug || agent?.id} role={agent?.effective_role} onNeedsRedeploy={handleCredentialSettingsChange} />
                    </div>
                  </div>
                ) : (
                  <ConfigPanel step={selectedStep} stepIndex={selectedStep ? steps.findIndex((s) => s.id === selectedStep.id) : -1} agent={agent} onStepUpdate={handleStepUpdate} onDeleteStep={(id) => { handleDeleteStep(id); closeConfigPanel() }} availableModels={configModels} />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Deploy Result Modal */}
      {deployResult && deployResult.invoke_url && (() => {
        const curlCommand = buildInvokeCurl({
          url: deployResult.invoke_url,
          schema: agent?.webhook_input_schema,
          invokedBy: { name: authUser?.name, email: authUser?.email },
        })
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeployResult(null)}>
          <div className="bg-white dark:bg-[#2c2c2c] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🚀 {deployResult.is_update ? 'Redeployed' : 'Deployed'} Successfully</h2>
              <p className="text-emerald-100 text-xs mt-1">Your workflow is live on Pabbly Functions</p>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              {/* Invoke URL */}
              <div>
                <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5 block">Invoke URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-neutral-50 dark:bg-[#383838] px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-[#484848] font-mono text-neutral-700 dark:text-neutral-200 truncate">{deployResult.invoke_url}</code>
                  <button onClick={() => { navigator.clipboard.writeText(deployResult.invoke_url); toast.success('URL copied!') }} className="px-3 py-2.5 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg hover:bg-emerald-100 flex-shrink-0">Copy</button>
                </div>
              </div>

              {/* cURL Command */}
              <div>
                <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5 block">Sample cURL</label>
                <div className="bg-neutral-900 rounded-lg overflow-hidden">
                  <pre className="text-[11px] text-neutral-100 p-3 max-h-56 overflow-auto font-mono whitespace-pre-wrap break-words">{curlCommand}</pre>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(curlCommand); toast.success('cURL copied!') }} className="w-full mt-2 px-3 py-2 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg hover:bg-emerald-100">Copy cURL</button>
              </div>

              {/* Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-400">
                <p className="font-medium mb-1">How to trigger this agent:</p>
                <p>Use the <strong>Webhook URL</strong> in Settings tab — it handles authentication, rate limiting, and run history automatically.</p>
                <p className="mt-1">The invoke URL above is for direct Pabbly Functions calls (advanced).</p>
              </div>

              {/* Code size */}
              {deployResult.code_size_kb && (
                <p className="text-[10px] text-neutral-400 text-center">Code size: {deployResult.code_size_kb} KB • Function ID: {deployResult.function_id}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-neutral-50 dark:bg-[#383838] border-t border-neutral-200 dark:border-[#484848] flex-shrink-0">
              <button onClick={() => setDeployResult(null)} className="w-full px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-lg hover:bg-neutral-100">Close</button>
            </div>
          </div>
        </div>
        )
      })()}
      {microFeedbackType && <MicroFeedback type={microFeedbackType} agentId={agent?.id} onDismiss={() => setMicroFeedbackType(null)} />}
      {shareModalOpen && agent && (
        <ShareWorkflowModal agent={agent} onClose={() => setShareModalOpen(false)} />
      )}
      {teamAccessOpen && agent && (
        <TeamAccessModal agent={agent} onClose={() => setTeamAccessOpen(false)} />
      )}
    </div>
  )
}