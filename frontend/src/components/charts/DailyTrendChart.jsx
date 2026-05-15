import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { isDarkMode, tooltipStyle, formatNumber } from './chartTheme'

/**
 * Daily usage trend — stacked area chart showing input vs output tokens over time.
 * Same component handles "hourly" mode (24 points, hour-of-day labels) by
 * adjusting XAxis tick spacing so labels stay evenly spaced + readable.
 * @param {Array} data - [{date: "2026-04-01", input_tokens: 1234, output_tokens: 567}, ...]
 * @param {number} height - chart height (default 280)
 * @param {'daily' | 'hourly'} granularity - axis style hint (default 'daily')
 */
const DailyTrendChart = ({ data = [], height = 280, granularity = 'daily' }) => {
  const dark = isDarkMode()

  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}> No usage data yet</div>
  }

  // Format X-axis label. Daily values like "2026-04-01" get parsed and
  // formatted as "Apr 1". Hourly values like "12a" / "3p" aren't valid
  // dates — `new Date("12a")` produces NaN rather than throwing, so we
  // explicitly check `isNaN(getTime())` and fall through to the raw value.
  const formatDate = (d) => {
    if (d == null) return ''
    const dt = new Date(d)
    if (isNaN(dt.getTime())) return String(d)
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  // For hourly mode (24 points), render every 3rd tick (12a, 3a, 6a, 9a,
  // 12p, 3p, 6p, 9p) so labels don't crowd. For daily, let recharts pick.
  const xAxisInterval = granularity === 'hourly' ? 2 : 'preserveStartEnd'

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#4a4a4a' : '#f0f0f0'} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: dark ? '#9ca3af' : '#6b7280' }}
          axisLine={false}
          tickLine={false}
          interval={xAxisInterval}
          minTickGap={12}
          padding={{ left: 6, right: 6 }}
        />
        <YAxis tickFormatter={formatNumber} tick={{ fontSize: 11, fill: dark ? '#9ca3af' : '#6b7280' }} axisLine={false} tickLine={false} width={50} />
        <Tooltip
          formatter={(val, name) => [formatNumber(val), name === 'input_tokens' ? 'Input' : 'Output']}
          labelFormatter={formatDate}
          {...tooltipStyle(dark)}
        />
        <Area type="monotone" dataKey="input_tokens" name="input_tokens" stroke="#6366f1" strokeWidth={2} fill="url(#gradInput)" />
        <Area type="monotone" dataKey="output_tokens" name="output_tokens" stroke="#22c55e" strokeWidth={2} fill="url(#gradOutput)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default DailyTrendChart
