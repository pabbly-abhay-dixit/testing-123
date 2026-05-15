/**
 * Max duration a webhook run can stay in `status: "executing"` before we
 * treat it as stale. Matches the Pabbly Functions VM's 10-minute hard
 * timeout — any run executing longer than this has either crashed mid-run
 * or lost its completion callback.
 *
 * **Keep in sync with `backend/src/handlers/webhook.rs::STUCK_RUN_THRESHOLD_SECS`.**
 * Backend sweeps the DB row to `failed` when this threshold is crossed on
 * any task-history GET; the frontend mirrors the same check locally so the
 * UI flips to "failed" without waiting for the next poll.
 */
export const RUN_MAX_DURATION_MS = 10 * 60 * 1000

/**
 * User-facing error surfaced for stale runs.
 * **Keep in sync with `backend/src/handlers/webhook.rs::STUCK_RUN_ERROR_MESSAGE`.**
 */
export const RUN_TIMEOUT_ERROR =
  'Oops! Your request took too long to complete — we allow up to 10 minutes per request. This can happen with larger or more complex tasks. Please try again — if the issue continues, try simplifying your request.'

/**
 * Returns true iff `run` is still marked executing but its `created_at` is
 * older than the max run duration. Safe on missing/bad `created_at` — a
 * parse failure returns false (let the next poll's backend sweep handle it).
 *
 * @param {{ status?: string, created_at?: string }} run
 * @param {number} [nowMs=Date.now()] injected clock for testability
 */
export function isRunStale(run, nowMs = Date.now()) {
  if (!run || run.status !== 'executing') return false
  if (!run.created_at) return false
  const startedMs = Date.parse(run.created_at)
  if (Number.isNaN(startedMs)) return false
  return nowMs - startedMs > RUN_MAX_DURATION_MS
}

/**
 * Overlay for display: if a run is stale, return a synthetic
 * `{status: 'failed', error: RUN_TIMEOUT_ERROR}` so every UI consumer
 * renders a consistent failed state without mutating the source row.
 *
 * @template T
 * @param {T & { status?: string, created_at?: string, error?: string | null }} run
 * @returns {T & { status: string, error: string | null }}
 */
export function applyStaleOverride(run) {
  if (!isRunStale(run)) return run
  return { ...run, status: 'failed', error: run.error || RUN_TIMEOUT_ERROR }
}
