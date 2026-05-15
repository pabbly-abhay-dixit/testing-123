import axios from 'axios'

// Production: if set, send unauthenticated users straight to Pabbly Accounts.
// Local dev: unset, fall back to the in-app /login page (Google button).
const SSO_REDIRECT_URL = import.meta.env.VITE_SSO_REDIRECT_URL

// Use `??` (not `||`) so an explicit empty VITE_API_URL is preserved as same-origin.
// `||` treats `""` as falsy and would silently fall back to localhost:4000, breaking
// cookie auth when the app is served via a different host (ngrok, prod nginx).
// Same-origin lets the Vite dev-server proxy (or nginx in prod) forward /api/* to
// the backend, which keeps cookies on a single domain.
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  // Required so the HttpOnly `pabbly_token` cookie set by /api/auth/tauth
  // travels with every XHR. In production frontend and backend share the same
  // origin via nginx, so this is a same-site credentialed request.
  withCredentials: true,
})

// Inject JWT token into every request — but ONLY if a real token is stored.
// localStorage.getItem returns the literal string "null" when an earlier write
// used JSON.stringify(null), so we treat both the absent case and the literal
// string "null"/"undefined" as missing. Otherwise we'd send `Bearer null` and
// override the HttpOnly pabbly_token cookie set by SSO — backend's middleware
// prefers the Authorization header, would JWT-verify "null" and 401.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && token !== 'null' && token !== 'undefined') {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses — clear token and redirect to login.
// Layer D3 — also normalize non-JSON error bodies into a uniform {error: '...'} shape
// so callers can always read `err.response.data.error` without crashing on a plain string
// (e.g. if an upstream proxy returned text/plain instead of application/json).
//
// Bad-gateway protection: when the backend is restarting (deploy / cargo build),
// nginx returns its 502/503/504 HTML page. Stuffing that raw HTML into
// `error.response.data.error` causes the UI to render the entire page as the
// error message. Detect HTML or 5xx and replace with a friendly generic message.
const isHtmlBody = (text) =>
  typeof text === 'string' &&
  /^\s*(<!DOCTYPE|<html|<head|<body)/i.test(text.slice(0, 200))

const friendlyForStatus = (status) => {
  if (status === 502) return 'Service temporarily unavailable. The server is restarting — please try again in a moment.'
  if (status === 503) return 'Service temporarily unavailable. Please try again in a moment.'
  if (status === 504) return 'Server took too long to respond. Please try again.'
  if (status >= 500) return 'Server error. Please try again in a moment.'
  return null
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const status = error.response.status
      const data = error.response.data
      const friendly = friendlyForStatus(status)

      // 5xx hint — likely a deploy-time blip. Nudge useSystemStatus to
      // re-check now so the maintenance pill can appear without waiting
      // for the next mount/visibility trigger. Cheap fire-and-forget;
      // useSystemStatus is the only listener.
      if (status >= 502 && status <= 504) {
        try { window.dispatchEvent(new CustomEvent('check-system-status')) } catch {}
      }

      if (typeof data === 'string') {
        // Either nginx HTML (502/503/504) or a plain-text error.
        if (isHtmlBody(data) || friendly) {
          error.response.data = { error: friendly || `HTTP ${status}` }
        } else {
          // Non-HTML string body — try JSON, fall back to the raw text.
          try { error.response.data = JSON.parse(data) }
          catch { error.response.data = { error: data || `HTTP ${status}` } }
        }
      } else if (data && typeof data === 'object') {
        // Object body but with an HTML-looking `error` field (rare, defensive).
        if (isHtmlBody(data.error)) {
          error.response.data = { error: friendly || `HTTP ${status}` }
        } else if (friendly && !data.error) {
          // 5xx with empty body — surface the friendly message.
          error.response.data = { ...data, error: friendly }
        }
      } else if (friendly) {
        // No body at all on a 5xx — synthesize one.
        error.response.data = { error: friendly }
      }
    } else if (error.request) {
      // No response received (network drop / CORS / DNS).
      error.response = {
        status: 0,
        data: { error: 'Unable to reach the server. Check your connection and try again.' },
      }
    }

    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      const path = window.location.pathname
      if (path !== '/login' && path !== '/register') {
        if (SSO_REDIRECT_URL) {
          // Production: skip the intermediate /login page and go straight to accounts.
          window.location.replace(SSO_REDIRECT_URL)
        } else {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export const workflowsAPI = {
  getAll: (params) => api.get('/api/workflows', { params }),
  // Slim list dedicated to the Dashboard table — drops the 11 fields the
  // dashboard never renders (model, instructions, plan_summary, binary_size,
  // r2_url, invocation_url, curl_command, execution_mode, pabbly_functions_id,
  // deployed_at, webhook_input_schema, config). Response envelope uses
  // `workflows` (not `agents`).
  // Deduped — Dashboard fires regular + trashed variants in parallel, plus
  // AgentsContext fires its own (no-args) call on mount. Strict Mode doubles
  // each. Without dedup that was 6 round-trips for the same data; the dedup
  // collapses simultaneous identical-params calls onto one in-flight promise.
  getDashboard: (params) => {
    const key = `dashboard|${params ? JSON.stringify(params) : ''}`
    return dedupedGet(key, () => api.get('/api/workflows/dashboard', { params }))
  },
  getOne: (id) => dedupedGet(`workflow|${id}`, () => api.get(`/api/workflows/${id}`)),
  create: (data) => api.post('/api/workflows', data),
  update: (id, data) => api.put(`/api/workflows/${id}`, data),
  delete: (id) => api.delete(`/api/workflows/${id}`),
  restore: (id) => api.post(`/api/workflows/${id}/restore`),
  permanentDelete: (id) => api.delete(`/api/workflows/${id}/permanent-delete`),
  emptyTrash: () => api.post('/api/trash/empty'),
  bulkAction: (data) => api.post('/api/workflows/bulk-action', data),
  switchMode: (id, data) => api.post(`/api/workflows/${id}/mode`, data),
  reset: (id) => api.post(`/api/workflows/${id}/reset`),
}

export const foldersAPI = {
  // Deduped — Dashboard + ShareComposeModal can fire concurrent
  // `getAll` calls. Strict Mode doubles each. Without dedup the heavier
  // backend $facet aggregation runs once per call; collapsing parallel
  // hits halves the load.
  getAll: () => dedupedGet('folders', () => api.get('/api/folders')),
  create: (data) => api.post('/api/folders', data),
  update: (id, data) => api.put(`/api/folders/${id}`, data),
  delete: (id) => api.delete(`/api/folders/${id}`),
}

// Team-access (shared-edit collaboration). Distinct from `shareAPI` which
// implements link-clone sharing. See docs/features/team-access.md.
export const teamAccessAPI = {
  // ── Discovery (collaborator-side) ──
  // Pagination + search params: { limit?: number, offset?: number, q?: string }
  // Default limit 50 (max 200). Search is case-insensitive substring on name.
  listSharedWithMe: (params = {}) => api.get('/api/me/shared', { params }),
  listSharedFolderWorkflows: (folderId) => api.get(`/api/me/shared/folders/${folderId}`),

  // ── Discovery (owner-side) — what I've shared and with whom ──
  // Section-scoped pagination: { section?: 'workflows'|'folders'|'members'|'counts',
  //   limit?, offset?, q? }
  listSharedByMe: (params = {}) => api.get('/api/me/shared-by-me', { params }),
  // Bulk remove: drop a collaborator from EVERY workflow + folder I own.
  removeTeamMemberEverywhere: (collabUserId) =>
    api.delete(`/api/me/team-members/${collabUserId}`),
  // Bulk revoke: clear all collaborators from each listed workflow I own.
  // Used by the multi-select bulk action on the Sharing page.
  bulkRevokeWorkflows: (workflowIds) =>
    api.post('/api/me/workflow-collaborators/bulk-revoke', { workflow_ids: workflowIds }),
  // Bulk revoke: clear all collaborators from each listed folder I own.
  // Cascades — all workflows in those folders lose folder-inherited access.
  bulkRevokeFolders: (folderIds) =>
    api.post('/api/me/folder-collaborators/bulk-revoke', { folder_ids: folderIds }),

  // ── Owner-side: workflow collaborators ──
  listWorkflowCollaborators: (agentId) => api.get(`/api/workflows/${agentId}/collaborators`),
  addWorkflowCollaborator: (agentId, data) => api.post(`/api/workflows/${agentId}/collaborators`, data),
  updateWorkflowCollaborator: (agentId, collabUserId, data) =>
    api.patch(`/api/workflows/${agentId}/collaborators/${collabUserId}`, data),
  removeWorkflowCollaborator: (agentId, collabUserId) =>
    api.delete(`/api/workflows/${agentId}/collaborators/${collabUserId}`),

  // ── Owner-side: folder collaborators ──
  listFolderCollaborators: (folderId) => api.get(`/api/folders/${folderId}/collaborators`),
  addFolderCollaborator: (folderId, data) => api.post(`/api/folders/${folderId}/collaborators`, data),
  updateFolderCollaborator: (folderId, collabUserId, data) =>
    api.patch(`/api/folders/${folderId}/collaborators/${collabUserId}`, data),
  removeFolderCollaborator: (folderId, collabUserId) =>
    api.delete(`/api/folders/${folderId}/collaborators/${collabUserId}`),

  // ── Cap management ──
  getCap: (collabUserId) => api.get(`/api/me/caps/${collabUserId}`),
  updateCap: (collabUserId, data) => api.patch(`/api/me/caps/${collabUserId}`, data),
  resetCap: (collabUserId) => api.post(`/api/me/caps/${collabUserId}/reset`),
}

export const shareAPI = {
  // Owner: read existing share-link status for an agent (active + clone count).
  getStatus: (agentId) => api.get(`/api/workflows/${agentId}/share`),
  // Owner: create or re-issue the agent's share link. Idempotent — returns
  // the existing token if one is already active.
  create: (agentId) => api.post(`/api/workflows/${agentId}/share`),
  // Owner: revoke the active share link. Future visits to /share/:token 404.
  revoke: (agentId) => api.delete(`/api/workflows/${agentId}/share`),
  // Public — no auth needed. Returns workflow name, owner name, step list,
  // and credential key names (no values).
  getPreview: (token) => api.get(`/api/share/${token}`),
  // Authenticated — clones the workflow into the caller's workspace.
  clone: (token) => api.post(`/api/share/${token}/clone`),
}

// In-flight chat-history fetches keyed by `${agentId}|${session}|${limit}|${before}`.
// Strict Mode mounts ChatPanel's history effect twice on the same workflow
// open; before this guard, both went over the wire and returned 11 MB / 77 KB
// each. Per-key (not just per-agent) keeps "Load older messages" responsive
// when its `before` cursor differs from the initial-load fetch.
const _chatHistoryInflight = new Map()

export const chatAPI = {
  send: (agentId, data) => api.post(`/api/workflows/${agentId}/chat`, data),
  // opts: { sessionId, limit, before } — limit triggers paginated mode on the
  // backend (returns { messages, has_more, oldest_id }); without it the backend
  // returns the full history (legacy path).
  getHistory: (agentId, opts = {}) => {
    const params = {}
    // Back-compat: 2nd arg used to be a plain sessionId string.
    if (typeof opts === 'string') {
      params.session_id = opts
    } else {
      if (opts.sessionId) params.session_id = opts.sessionId
      if (opts.limit != null) params.limit = opts.limit
      if (opts.before) params.before = opts.before
    }
    const key = `${agentId}|${params.session_id || ''}|${params.limit ?? ''}|${params.before || ''}`
    const existing = _chatHistoryInflight.get(key)
    if (existing) return existing
    const promise = api.get(`/api/workflows/${agentId}/chat`, { params })
      .finally(() => { _chatHistoryInflight.delete(key) })
    _chatHistoryInflight.set(key, promise)
    return promise
  },
  deleteMessage: (agentId, messageId) => api.delete(`/api/workflows/${agentId}/chat/${messageId}`),
  cancel: (agentId) => api.post(`/api/workflows/${agentId}/chat/cancel`),
  // Lazy-load the FULL tool result string when the chat list response trimmed
  // it to 5 KB (truncated=true). Single user click per call — no in-flight
  // dedup needed (mis-fires are rare and harmless for an idempotent GET).
  getToolResult: (agentId, messageId, callId) =>
    api.get(`/api/workflows/${agentId}/chat/messages/${messageId}/tool-result/${callId}`),
}

export const sessionsAPI = {
  list: (agentId) => api.get(`/api/workflows/${agentId}/sessions`),
  create: (agentId, data) => api.post(`/api/workflows/${agentId}/sessions`, data || {}),
}

export const taskHistoryAPI = {
  // Back-compat: legacy callers pass a number as the 2nd arg (`list(id, 20)`).
  // New callers pass `{ limit, q, status }` to drive the search/filter UI in
  // the Run History panel. `q` is either a 24-char ObjectId (exact match)
  // or a 4+ char substring matched against stringified `_id` AND `error`
  // (case-insensitive). `status` is `completed|failed|executing`.
  // Cache key includes filters so a filtered fetch doesn't collide with the
  // unfiltered cache slot.
  //
  // URL note: hits `/api/workflows/{id}/run-history` (the current name).
  // The backend keeps `/api/workflows/{id}/task-history` and
  // `/api/workflows/{id}/webhook-runs` as legacy aliases — both reach the
  // same handler — but new clients should use `run-history`.
  list: (agentId, optsOrLimit = {}) => {
    const opts = typeof optsOrLimit === 'number' ? { limit: optsOrLimit } : (optsOrLimit || {})
    const { limit = 20, q, status } = opts
    const params = { limit }
    const trimmedQ = q && String(q).trim()
    if (trimmedQ) params.q = trimmedQ
    if (status) params.status = status
    const key = `run-history|${agentId}|${limit}|${params.q || ''}|${params.status || ''}`
    return dedupedGet(key, () => api.get(`/api/workflows/${agentId}/run-history`, { params }))
  },
  // opts can pass `{ signal, timeout, lite }` — `lite: true` adds `?fields=lite`
  // so the backend strips per-step `input` + `output` from `step_results` and
  // returns metadata only (name, status, duration, tokens, credits, plus
  // `has_input`/`has_output` flags). The TaskDetailPanel uses lite mode for
  // its initial fetch + 2s live-progress poll; per-step bodies are pulled
  // separately via `getStepDetail` when the user expands a step row.
  getStatus: (runId, opts = {}) => {
    const { lite, ...rest } = opts || {}
    const params = lite ? { ...(rest.params || {}), fields: 'lite' } : (rest.params || undefined)
    return api.get(`/api/run-history/${runId}`, { ...rest, ...(params ? { params } : {}) })
  },
  // Lazy-load a single step's full input + output. Same dual-auth as
  // `getStatus` (cookie/bearer JWT or status_token query param). Cheap GET —
  // no in-flight dedup, an accidental double-click just races two identical
  // requests.
  getStepDetail: (runId, stepIndex, opts = {}) =>
    api.get(`/api/run-history/${runId}/steps/${stepIndex}`, opts),
  cancel: (runId) => api.post(`/api/run-history/${runId}/cancel`),
}

export const testsAPI = {
  run: (agentId, data) => api.post(`/api/workflows/${agentId}/test`, data),
  testStep: (agentId, stepId, data) => api.post(`/api/workflows/${agentId}/test-step/${stepId}`, data),
  list: (agentId) => api.get(`/api/workflows/${agentId}/tests`),
}

// Cron schedules attached to workflows. Backend filters by authenticated
// user server-side — the `created_by` query param is injected, never trust
// the client. Bulk-delete is double-gated: backend lists the user's own
// schedules first and rejects the request if any requested id is foreign.
export const schedulesAPI = {
  list: (params = {}) => {
    // Cache key tuple — bump when params change. Stale lookups are cheap;
    // any mutation downstream invalidates by re-fetching.
    const key = `schedules|${JSON.stringify(params)}`
    return dedupedGet(key, () => api.get('/api/schedules', { params }))
  },
  bulkDelete: (scheduleIds) =>
    api.delete('/api/schedules/bulk', { data: { schedule_ids: scheduleIds } }),
  // One-shot read used by ChatPanel's Schedule chip on cold reload, when
  // the schedule action is older than the loaded chat history. Returns
  // `{exists: true, schedule}` or `{exists: false}` — same shape the
  // get_schedule chat tool produces, so the frontend can plug it directly
  // into the chip's render path.
  getForWorkflow: (agentId) =>
    dedupedGet(
      `workflow-schedule|${agentId}`,
      () => api.get(`/api/workflows/${agentId}/schedule`),
    ),
}

export const buildsAPI = {
  trigger: (agentId) => api.post(`/api/workflows/${agentId}/build`),
  list: (agentId) => api.get(`/api/workflows/${agentId}/builds`),
}

export const deploysAPI = {
  trigger: (agentId) => api.post(`/api/workflows/${agentId}/deploy`),
  // Push pending local changes to the deployed function (the "Update" button).
  // Returns 502 with the PF error if the push fails — dirty flag stays set.
  sync: (agentId) => api.post(`/api/workflows/${agentId}/sync`),
  list: (agentId) => api.get(`/api/workflows/${agentId}/deployments`),
  delete: (agentId) => api.delete(`/api/workflows/${agentId}/deploy`),
  // Push a new model/provider to an already-deployed function. The backend
  // re-prefetches with the new agent.model + use_system_model and calls
  // pf_client.update() to push fresh LLM_* env vars. Rolls back DB on failure.
  updateEnv: (agentId, data) => api.post(`/api/workflows/${agentId}/update-env`, data),
}

// Workflow file storage (AD-043). Backend talks to R2 directly via
// `utils::workflow_storage` — no PF round-trip on these calls.
export const storageAPI = {
  /**
   * List files for a workflow.
   * @param {string} agentId
   * @param {{ folder?: 'generated'|'management'|'all', prefix?: string, limit?: number, cursor?: string, with_metadata?: boolean }} [params]
   */
  listWorkflowFiles: (agentId, params = {}) =>
    api.get(`/api/workflows/${agentId}/storage`, { params }),
  /**
   * Fetch a single file's content (base64-encoded body).
   * @param {string} agentId
   * @param {string} path  Path relative to the workflow's basePrefix, e.g. "management/state.json"
   */
  getFileContent: (agentId, path) =>
    api.get(`/api/workflows/${agentId}/storage/content`, { params: { path } }),
  /**
   * Per-user storage usage (bytes_used / file_count / refreshed_at + caps).
   * @param {boolean} [force] When true, the backend re-lists R2 synchronously
   *   before returning instead of trusting its 15-min TTL cache. Used by the
   *   Refresh button so clicking it actually shows fresh numbers.
   */
  getUsage: (force = false) =>
    api.get('/api/me/storage-usage', force ? { params: { force: 1 } } : undefined),
}

export const modelsAPI = {
  getAll: () => api.get('/api/models'),
}

// Module-level cache for /api/keys responses. Two consumers (BuilderPage's
// ConfigPanel-deferred fetch and ChatPanel's mount fetch — needed for the
// "no API key" banner gating) used to fire identical parallel requests on
// every workflow open. The cache + in-flight dedup collapses them to one.
// Mutations (create/delete) invalidate so reads stay fresh.
const KEYS_TTL_MS = 30 * 1000
let _keysCache = null // { data, expiresAt } when fulfilled, { promise, expiresAt: 0 } while in flight

const fetchKeysWithCache = () => {
  const now = Date.now()
  if (_keysCache?.data && _keysCache.expiresAt > now) {
    return Promise.resolve(_keysCache.data)
  }
  if (_keysCache?.promise) {
    return _keysCache.promise
  }
  const promise = api.get('/api/keys')
    .then((res) => {
      _keysCache = { data: res, expiresAt: Date.now() + KEYS_TTL_MS }
      return res
    })
    .catch((err) => {
      _keysCache = null
      throw err
    })
  _keysCache = { promise, expiresAt: 0 }
  return promise
}

const invalidateKeysCache = () => {
  _keysCache = null
}

export const keysAPI = {
  // Cached read — first caller fetches, parallel callers within KEYS_TTL_MS
  // (or in flight) reuse the same response. Used by ChatPanel + BuilderPage.
  getAll: () => fetchKeysWithCache(),
  // Bypass the cache — used by AISettings which needs fresh data after edits.
  getAllFresh: () => {
    invalidateKeysCache()
    return fetchKeysWithCache()
  },
  create: (data) => api.post('/api/keys', data).then((res) => { invalidateKeysCache(); return res }),
  // PATCH: rename a connection or promote it to default. Body shape:
  //   { name?: string, is_default?: true }
  // Backend rejects is_default=false (can't unset default without a replacement).
  patch: (id, data) => api.patch(`/api/keys/${id}`, data).then((res) => { invalidateKeysCache(); return res }),
  delete: (id) => api.delete(`/api/keys/${id}`).then((res) => { invalidateKeysCache(); return res }),
  reveal: (id) => api.get(`/api/keys/${id}/reveal`),
  test: (data) => api.post('/api/keys/test', data),
}

export const stepVerifyAPI = {
  verify: (data) => api.post('/api/verify-step', data),
}

export const templatesAPI = {
  getAll: () => api.get('/api/templates'),
  clone: (templateId) => api.post(`/api/templates/${templateId}/clone`),
}

export const memoryAPI = {
  list: (agentId) => api.get(`/api/workflows/${agentId}/memory`),
  reveal: (agentId, key) => api.get(`/api/workflows/${agentId}/memory/${encodeURIComponent(key)}`),
  update: (agentId, key, data) => api.put(`/api/workflows/${agentId}/memory/${encodeURIComponent(key)}`, data),
  delete: (agentId, key) => api.delete(`/api/workflows/${agentId}/memory/${encodeURIComponent(key)}`),
}

export const stepsAPI = {
  list: (agentId, opts = {}) => {
    const params = {}
    if (opts.fields) params.fields = opts.fields
    return dedupedGet(
      `steps|${agentId}|${params.fields || ''}`,
      () => api.get(`/api/workflows/${agentId}/steps`, { params })
    )
  },
  getOne: (agentId, stepId) => dedupedGet(
    `step|${agentId}|${stepId}`,
    () => api.get(`/api/workflows/${agentId}/steps/${stepId}`)
  ),
  create: (agentId, data) => api.post(`/api/workflows/${agentId}/steps`, data),
  update: (agentId, stepId, data) => api.put(`/api/workflows/${agentId}/steps/${stepId}`, data),
  delete: (agentId, stepId) => api.delete(`/api/workflows/${agentId}/steps/${stepId}`),
  reorder: (agentId, data) => api.post(`/api/workflows/${agentId}/steps/reorder`, data),
}

// /api/tools returns a static list maintained in backend `utils/tools.rs`. Its
// shape only changes on a backend release. Cache in localStorage so repeat
// workflow opens skip the network round-trip entirely.
const TOOLS_CACHE_KEY = 'cached_tools_v1'
const TOOLS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const readCachedTools = () => {
  try {
    const raw = localStorage.getItem(TOOLS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.fetched_at !== 'number') return null
    if (Date.now() - parsed.fetched_at > TOOLS_CACHE_TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

const writeCachedTools = (data) => {
  try {
    localStorage.setItem(TOOLS_CACHE_KEY, JSON.stringify({ fetched_at: Date.now(), data }))
  } catch {
    // Quota exceeded or storage disabled — silently skip the cache write.
  }
}

// Generic in-flight dedup. Two near-simultaneous callers with the same key
// share one network request; once it settles the slot is freed. Strict Mode
// fires every effect twice in dev — without this every workflow open doubles
// every GET. Cheap insurance for production too (e.g. concurrent re-renders).
const _inflightByKey = new Map()
const dedupedGet = (key, fetcher) => {
  const existing = _inflightByKey.get(key)
  if (existing) return existing
  const promise = fetcher().finally(() => { _inflightByKey.delete(key) })
  _inflightByKey.set(key, promise)
  return promise
}

// In-flight promise — collapses parallel callers (Strict Mode double-mount
// fires the effect twice synchronously, before the first response resolves;
// without this guard, both go out over the wire).
let _toolsInflight = null

export const toolsAPI = {
  list: () => {
    const cached = readCachedTools()
    if (cached) {
      // Mimic the axios response shape so callers don't branch on `res.data`.
      return Promise.resolve({ data: cached })
    }
    if (_toolsInflight) return _toolsInflight
    _toolsInflight = api.get('/api/tools')
      .then((res) => {
        writeCachedTools(res.data)
        return res
      })
      .finally(() => { _toolsInflight = null })
    return _toolsInflight
  },
}

// Module-level memoized fetcher: collapses parallel callers (Strict Mode
// double-mount, BuilderPage + ChatPanel firing the same endpoint) onto a
// single in-flight promise, and serves the resolved response for `ttlMs` after
// success. Backend already sends Cache-Control: max-age=300 on these endpoints
// — this layer wins for the *first* fetch within a session, where the browser
// hasn't seen a 200 yet.
const _memoCaches = new Map()

const memoizedGet = (key, ttlMs, fetcher) => {
  const now = Date.now()
  const entry = _memoCaches.get(key)
  if (entry?.data && entry.expiresAt > now) {
    return Promise.resolve(entry.data)
  }
  if (entry?.promise) {
    return entry.promise
  }
  const promise = fetcher()
    .then((res) => {
      _memoCaches.set(key, { data: res, expiresAt: Date.now() + ttlMs })
      return res
    })
    .catch((err) => {
      _memoCaches.delete(key)
      throw err
    })
  _memoCaches.set(key, { promise, expiresAt: 0 })
  return promise
}

const PRICING_TTL_MS = 5 * 60 * 1000 // 5 min — matches backend Cache-Control

export const usageAPI = {
  getSummary: (params) => api.get('/api/usage/summary', { params }),
  getAgentUsage: (agentId, params) => api.get(`/api/usage/agent/${agentId}`, { params }),
  // Cached — see memoizedGet. Pricing data only changes when admin updates
  // rates; in a single workflow-open burst (Strict Mode + BuilderPage +
  // ChatPanel) this used to fire 4 times, now collapses to 1.
  getAllPricing: () => memoizedGet('all-pricing', PRICING_TTL_MS, () => api.get('/api/usage/all-pricing')),
}

export const creditsAPI = {
  getBalance: () => api.get('/api/credits'),
  // Cached for the same reason as usageAPI.getAllPricing.
  getPricing: () => memoizedGet('credits-pricing', PRICING_TTL_MS, () => api.get('/api/credits/pricing')),
  getHistory: (params) => api.get('/api/credits/history', { params }),
  listPackages: () => api.get('/api/credits/packages'),
  getInvoiceStatus: (invoiceId) => api.get(`/api/credits/invoice/${invoiceId}`),
  // Per-workflow lifetime spend (platform key only) grouped by source.
  // Refreshed on chat-done, run-finish, and tab-focus.
  getWorkflowSummary: (workflowId) => api.get(`/api/workflows/${workflowId}/credit-summary`),
}

export const packagesAPI = {
  list: () => api.get('/api/admin/packages'),
  create: (data) => api.post('/api/admin/packages', data),
  update: (id, data) => api.put(`/api/admin/packages/${id}`, data),
  remove: (id) => api.delete(`/api/admin/packages/${id}`),
}

// Live PSB plan discovery — fetched server-side from
// payments.pabbly.com/api/v1/plans, cached 10 min. Returns
// { plans: [...], billing_cycles: [...] }.
export const plansAPI = {
  list: () => api.get('/api/plans'),
  invalidateCache: () => api.post('/api/admin/plans/invalidate-cache'),
}

// In-app subscription checkout — wraps the custom checkout modal's
// two POST endpoints. Both run through the axios client so the JWT
// (and the CSRF defenses around it) auto-attach. The backend uses
// the JWT to set first_name/last_name/email when forwarding to PSB,
// so a malicious user can't substitute someone else's email through
// the form body — see backend/src/handlers/payment.rs.
export const paymentAPI = {
  // body: { plan_id, gateway_type, card_number, month, year, cvv,
  //         coupon_code, token (recaptcha) }
  // Identity (name/email) is read from the JWT user on the backend, not
  // from this body — see handlers/payment.rs::process_payment.
  process: (body) => api.post('/api/payment', body),
  // body: { coupon_code, plan_id, total_price }
  validateCoupon: (body) => api.post('/api/payment/coupon', body),
}

// Platform pricing tiers (separate from AI credit packages — see
// docs/plans/platform-pricing-tiers-plan.md). Tiers gate workflows,
// schedulers, team size, and monthly executions.
export const subscriptionsAPI = {
  // Current user's effective entitlements + active sub rows + usage meters.
  getMine: () => api.get('/api/me/subscription'),
  // Auto-login portal session — backend talks to PSB and returns a
  // single-use access_url. Mirrors PabblyConnect's My Subscription flow.
  createPortalSession: () => api.post('/api/me/portal-session'),
}

export const adminAPI = {
  getStats: (params) => api.get('/api/admin/stats', { params }),
  getPricing: () => api.get('/api/admin/pricing'),
  updatePricing: (id, data) => api.put(`/api/admin/pricing/${id}`, data),
  getUsers: (params) => api.get('/api/admin/users', { params }),
  grantCredits: (userId, credits) => api.post(`/api/admin/users/${userId}/grant-credits`, { credits }),
  toggleRole: (userId) => api.post(`/api/admin/users/${userId}/toggle-role`),
  getSettings: () => api.get('/api/admin/settings'),
  updateMargin: (margin) => api.put('/api/admin/settings/margin', { margin_multiplier: margin }),
  updateCreditsPerDollar: (cpd) => api.put('/api/admin/settings/credits-per-dollar', { credits_per_dollar: cpd }),
  updatePlatformKey: (provider, apiKey, extra = {}) => api.put(`/api/admin/settings/platform-key/${provider}`, { api_key: apiKey, ...extra }),
  setActiveModel: (provider, model) => api.post('/api/admin/settings/active-model', { provider, model }),
  getActiveModel: () => api.get('/api/admin/settings/active-model'),
  setPreferredModel: (provider, model) => api.put('/api/admin/settings/preferred-model', { provider, model }),
  // Usage analytics
  getUsageSummary: (params) => api.get('/api/admin/usage/summary', { params }),
  getTopUsers: (params) => api.get('/api/admin/usage/users', { params }),
  getTransactions: (params) => api.get('/api/admin/usage/transactions', { params }),
  // Lightweight cross-user workflow list — feeds the Transactions filter
  // dropdown. Capped server-side at 2000 rows.
  getWorkflowsListMin: () => api.get('/api/admin/workflows/list-min'),
  // Lightweight all-users list — feeds the Transactions User filter dropdown.
  // Returns every user (not just top spenders); capped server-side at 5000.
  getUsersListMin: () => api.get('/api/admin/users/list-min'),

  // ── Subscription tier registry CRUD ──
  listTiers: () => api.get('/api/admin/tier-registry'),
  createTier: (data) => api.post('/api/admin/tier-registry', data),
  updateTier: (id, data) => api.put(`/api/admin/tier-registry/${id}`, data),
  removeTier: (id) => api.delete(`/api/admin/tier-registry/${id}`),
  // Per-user manual override (Enterprise + comp accounts).
  overrideSubscription: (userId, data) =>
    api.post(`/api/admin/subscriptions/${userId}/override`, data),
}

export default api
