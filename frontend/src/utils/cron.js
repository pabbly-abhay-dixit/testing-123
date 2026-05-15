// Tiny wrapper around cronstrue. Falls back to the raw expression when
// cronstrue throws (e.g. malformed input from PF) so the row still renders
// instead of blowing up.
//
// `withTimezone` (default true) appends the schedule's source timezone in
// parentheses — needed in tooltips and detail dropdowns for unambiguous
// schedules like "weekdays 09:00". Pass `false` for compact cell displays
// where the surrounding UI shows times in the user's local timezone, so
// the table doesn't double-render the source-tz info.
import cronstrue from 'cronstrue'

export const humanizeCron = (expr, timezone = 'UTC', { withTimezone = true } = {}) => {
  if (!expr || typeof expr !== 'string') return ''
  let text
  try {
    text = cronstrue.toString(expr, { use24HourTimeFormat: true })
  } catch {
    return expr
  }
  if (!withTimezone) return text
  const tz = timezone || 'UTC'
  return `${text} (${tz})`
}
