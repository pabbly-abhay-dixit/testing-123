// Returns the user's *local* day boundaries as full UTC ISO timestamps,
// so the backend filter `created_at >= from && created_at <= to` covers
// exactly the calendar day the user sees on their wall clock — not the
// UTC day, which is shifted 5.5h for IST users (and similarly off for
// any non-UTC timezone).
//
// IST 2026-04-30 picks "Today" → emits:
//   from_ts: 2026-04-29T18:30:00.000Z   (= 00:00 IST 2026-04-30)
//   to_ts:   2026-04-30T18:29:59.999Z   (= 23:59 IST 2026-04-30)
function localDayBounds(date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return {
    date_from: start.toISOString(),
    date_to: end.toISOString(),
  }
}

// Maps "today" / "yesterday" preset values to a {date_from, date_to} pair
// using the browser's local clock. Returns null for any other preset so
// callers can fall through to their existing period (7d/30d/...) handling.
export function resolveDatePreset(preset) {
  if (preset === 'today') {
    return localDayBounds(new Date())
  }
  if (preset === 'yesterday') {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return localDayBounds(y)
  }
  return null
}
