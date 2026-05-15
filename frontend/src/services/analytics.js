import api from './api'

// ── Lightweight Analytics — batched event tracking ──
// Queues events and flushes every 5 seconds or when batch reaches 10 events.
// No external SDK needed — posts to our own /api/analytics/events endpoint.

let queue = []
let flushTimer = null

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flush, 5000)
}

async function flush() {
  flushTimer = null
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await api.post('/api/analytics/events', { events: batch })
  } catch {
    // Non-fatal — analytics loss is acceptable
  }
}

/**
 * Track an event with optional properties.
 * Events are batched and sent every 5 seconds.
 *
 * Usage:
 *   track('agent_created', { agent_id: '...' })
 *   track('step_created', { step_name: 'Fetch Weather', type: 'code' })
 *   track('message_sent')
 */
export function track(event, properties = null) {
  queue.push({ event, properties })
  if (queue.length >= 10) {
    flush()
  } else {
    scheduleFlush()
  }
}

/**
 * Submit a reaction on a message, run, or template.
 * Fires immediately (not batched) since it's user-initiated.
 *
 * Usage:
 *   react('helpful', { agent_id: '...', message_id: '...' })
 *   react('bug', { run_id: '...' })
 */
export async function react(reaction, { agent_id, message_id, run_id, context } = {}) {
  try {
    await api.post('/api/feedback/react', { reaction, agent_id, message_id, run_id, context })
    return true
  } catch {
    return false
  }
}

/**
 * Report a frontend error to the backend.
 */
export async function reportError(error, component = null) {
  try {
    await api.post('/api/analytics/error', {
      message: error?.message || String(error),
      component,
      stack: error?.stack?.slice(0, 5000),
      url: window.location.href,
      user_agent: navigator.userAgent,
    })
  } catch {
    // Non-fatal
  }
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush)
}
