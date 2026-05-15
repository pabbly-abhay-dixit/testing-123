import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts'
import { isDarkMode } from './chartTheme'

// Monochromatic blue palette — wide contrast from blue-900 to blue-100 so
// adjacent slices stay visually distinct on a dark page background. Slices
// are picked across the full ramp (not sequential) based on how many buckets
// exist — see pickColor() below. Mirrors the pattern used by ProviderPieChart
// in the admin Analytics page so both pie charts read the same.
const BLUE_RAMP = [
  '#1e3a8a', // blue-900 (darkest — dominant)
  '#1d4ed8', // blue-700
  '#3b82f6', // blue-500
  '#60a5fa', // blue-400
  '#93c5fd', // blue-300
  '#dbeafe', // blue-100 (lightest)
]

// Spread indices 0..(total-1) across the full ramp so a 3-slice chart uses
// {dark, mid, light} instead of {dark, near-dark, near-near-dark} which all
// blend together on a dark page bg.
function pickColor(idx, total) {
  if (total <= 1) return BLUE_RAMP[0]
  const ratio = idx / (total - 1)
  const stop = Math.round(ratio * (BLUE_RAMP.length - 1))
  return BLUE_RAMP[stop]
}

// Outer label with leader line — name + percent shown outside each slice so
// values are visible at-a-glance without hovering. Slices below MIN_LABEL_PCT
// are skipped to avoid clutter on tiny slivers.
const MIN_LABEL_PCT = 2

function OuterLabel(props) {
  const { cx, cy, midAngle, outerRadius, percent, name, fill } = props
  if (!percent || percent * 100 < MIN_LABEL_PCT) return null
  const RAD = Math.PI / 180
  const sin = Math.sin(-midAngle * RAD)
  const cos = Math.cos(-midAngle * RAD)
  const sx = cx + outerRadius * cos
  const sy = cy + outerRadius * sin
  const mx = cx + (outerRadius + 10) * cos
  const my = cy + (outerRadius + 10) * sin
  const isRight = cos >= 0
  const ex = mx + (isRight ? 18 : -18)
  const ey = my
  const textAnchor = isRight ? 'start' : 'end'
  const pct = (percent * 100).toFixed(1)
  return (
    <g pointerEvents="none">
      <path d={`M${sx},${sy} L${mx},${my} L${ex},${ey}`} stroke={fill} strokeWidth={1} fill="none" opacity={0.55} />
      <circle cx={ex} cy={ey} r={2} fill={fill} />
      <text
        x={ex + (isRight ? 4 : -4)}
        y={ey - 2}
        textAnchor={textAnchor}
        fontSize={11}
        fontWeight={600}
        fill="currentColor"
        className="text-gray-800 dark:text-neutral-100"
      >
        {name}
      </text>
      <text
        x={ex + (isRight ? 4 : -4)}
        y={ey + 11}
        textAnchor={textAnchor}
        fontSize={10}
        fill="currentColor"
        className="text-gray-500 dark:text-neutral-400"
      >
        {pct}%
      </text>
    </g>
  )
}

// Active slice — the hovered slice extends a bit + carries an outer ring.
function ActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 9}
        outerRadius={outerRadius + 11}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.35}
      />
    </g>
  )
}

const fmtCost = (v) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)

function CustomTooltip({ active, payload, dark, total }) {
  if (!active || !payload || !payload.length) return null
  const datum = payload[0]?.payload || {}
  const value = payload[0]?.value || 0
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
  const bg = dark ? '#1f1f1f' : '#ffffff'
  const border = dark ? '#3f3f3f' : '#e5e7eb'
  const muted = dark ? '#9ca3af' : '#6b7280'
  const text = dark ? '#f3f4f6' : '#111827'
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      fontSize: 12,
      minWidth: 160,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: datum.color, display: 'inline-block' }} />
        <span style={{ color: text, fontWeight: 600 }}>{datum.name}</span>
      </div>
      <div style={{ color: muted, fontSize: 11 }}>
        <span style={{ color: text, fontWeight: 600 }}>{fmtCost(value)}</span>
        <span style={{ marginLeft: 8 }}>· {pct}%</span>
      </div>
    </div>
  )
}

/**
 * Cost breakdown by model — polished donut chart.
 * Visual + interaction parity with `ProviderPieChart` (admin Analytics)
 * so both pie charts feel identical to the user.
 *
 * @param {Array} data    - [{ model, cost, total_cost_usd }, ...]
 * @param {number} height - chart height (default 280)
 */
const CostByModelChart = ({ data = [], height = 280 }) => {
  const dark = isDarkMode()
  const [activeIdx, setActiveIdx] = useState(-1)

  const chartData = useMemo(() => {
    const getCost = (d) => Math.abs(d.cost || d.total_cost_usd || 0)
    const shortName = (m) => {
      if (!m) return 'Unknown'
      return m
        .replace('claude-', '')
        .replace('gpt-', 'GPT-')
        .replace('gemini-', 'Gemini ')
        .replace(/(\d)-(\d)/g, '$1.$2')
        .replace(/-/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    }
    const sorted = (data || [])
      .filter(d => getCost(d) > 0)
      .sort((a, b) => getCost(b) - getCost(a))
      .slice(0, 8)
    return sorted.map((d, i) => ({
      name: shortName(d.model),
      value: getCost(d),
      color: pickColor(i, sorted.length),
    }))
  }, [data])

  if (!chartData.length) {
    return <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>No model usage yet</div>
  }

  const total = chartData.reduce((s, d) => s + d.value, 0)
  const cardBg = dark ? '#262626' : '#ffffff'

  return (
    <div className="w-full">
      <div className="relative" style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="48%"
              innerRadius={56}
              outerRadius={84}
              dataKey="value"
              paddingAngle={1}
              stroke={cardBg}
              strokeWidth={2}
              label={<OuterLabel />}
              labelLine={false}
              activeIndex={activeIdx}
              activeShape={ActiveSlice}
              onMouseEnter={(_, idx) => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(-1)}
              isAnimationActive={false}
            >
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip dark={dark} total={total} />}
              wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text overlay — total cost. Hidden on hover so the per-slice
            tooltip and the aggregate total don't fight for attention. */}
        {activeIdx < 0 && (
          <div
            className="pointer-events-none absolute left-0 right-0 flex flex-col items-center text-center"
            style={{ top: 'calc(48% - 22px)' }}
          >
            <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Total</span>
            <span className="text-lg font-bold text-gray-900 dark:text-neutral-100 leading-tight">{fmtCost(total)}</span>
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400">cost</span>
          </div>
        )}
      </div>

      {/* Custom legend — flows below the chart wrapper so it never overflows
          the fixed-height ResponsiveContainer. Reserves a stable min-height
          so the panel doesn't "dance" between hover states. Scrolls past
          ~3 rows when the user has many models. */}
      <div
        className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 pt-3 mt-1 overflow-y-auto"
        style={{ minHeight: 56, maxHeight: 96 }}
      >
        {chartData.map((d) => {
          const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
          return (
            <div key={d.name} className="flex items-center gap-2 text-[11px] min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
              <span className="text-gray-700 dark:text-neutral-200 truncate flex-1" title={d.name}>{d.name}</span>
              <span className="text-gray-500 dark:text-neutral-400 tabular-nums flex-shrink-0">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default CostByModelChart
