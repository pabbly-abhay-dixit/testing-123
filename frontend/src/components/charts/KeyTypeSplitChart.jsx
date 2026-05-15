import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts'
import { isDarkMode, formatNumber } from './chartTheme'

// Same monochromatic blue ramp as ProviderPieChart so the two Distribution
// modes share a visual language. Dominant slice gets the darker blue; the
// secondary uses a much lighter shade so they never blend on a dark bg.
const BLUE_RAMP = ['#1e3a8a', '#93c5fd']

// Outer leader-line label — shows name + % outside each slice. Slices below
// MIN_LABEL_PCT are skipped to avoid clutter on tiny slivers.
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
      <text x={ex + (isRight ? 4 : -4)} y={ey - 2} textAnchor={textAnchor} fontSize={11} fontWeight={600} fill="currentColor" className="text-gray-800 dark:text-neutral-100">{name}</text>
      <text x={ex + (isRight ? 4 : -4)} y={ey + 11} textAnchor={textAnchor} fontSize={10} fill="currentColor" className="text-gray-500 dark:text-neutral-400">{pct}%</text>
    </g>
  )
}

function ActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 9} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.35} />
    </g>
  )
}

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
        <span style={{ color: text, fontWeight: 600 }}>{formatNumber(value)}</span> tokens
        <span style={{ marginLeft: 8 }}>· {pct}%</span>
      </div>
    </div>
  )
}

/**
 * BYOK vs Platform usage split — polished donut.
 * @param {Array} data - [{key_type: "platform", tokens, requests}, ...]
 * @param {number} height - chart height (default 280)
 */
const KeyTypeSplitChart = ({ data = [], height = 280 }) => {
  const dark = isDarkMode()
  const [activeIdx, setActiveIdx] = useState(-1)

  const filtered = data.filter(d => (d.tokens || d.requests) > 0)
  if (!filtered.length) {
    return <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>No data yet</div>
  }

  const sorted = [...filtered].sort((a, b) => (b.tokens || b.requests || 0) - (a.tokens || a.requests || 0))
  const chartData = sorted.map((d, i) => ({
    name: d.key_type === 'byok' ? 'BYOK (Own Key)' : 'Platform Credits',
    value: d.tokens || d.requests || 0,
    color: BLUE_RAMP[i % BLUE_RAMP.length],
  }))
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
            paddingAngle={2}
            stroke={cardBg}
            strokeWidth={2}
            label={<OuterLabel />}
            labelLine={false}
            activeIndex={activeIdx}
            activeShape={ActiveSlice}
            onMouseEnter={(_, idx) => setActiveIdx(idx)}
            onMouseLeave={() => setActiveIdx(-1)}
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

      {activeIdx < 0 && (
        <div
          className="pointer-events-none absolute left-0 right-0 flex flex-col items-center text-center"
          style={{ top: `calc(48% - 22px)` }}
        >
          <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Total</span>
          <span className="text-lg font-bold text-gray-900 dark:text-neutral-100 leading-tight">{formatNumber(total)}</span>
          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">tokens</span>
        </div>
      )}
      </div>

      <div
        className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 pt-3 mt-1 overflow-y-auto"
        style={{ minHeight: 56, maxHeight: 96 }}
      >
        {chartData.map((d) => {
          const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
          return (
            <div key={d.name} className="flex items-center gap-2 text-[11px] min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
              <span className="text-gray-700 dark:text-neutral-200 truncate flex-1">{d.name}</span>
              <span className="text-gray-500 dark:text-neutral-400 tabular-nums flex-shrink-0">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default KeyTypeSplitChart
