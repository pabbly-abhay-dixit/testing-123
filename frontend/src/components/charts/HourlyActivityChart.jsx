import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { isDarkMode, formatNumber } from './chartTheme'

/**
 * Hourly activity — 24-bar chart showing token usage distribution across hours.
 * Data comes from MongoDB $hour (UTC). We shift to the user's local timezone
 * so the chart reads naturally (e.g. "6a" means 6 AM local, not UTC).
 * @param {Array} data - [{hour: 0, tokens: 1234, requests: 5}, ...] (24 entries, UTC hours)
 * @param {number} height - chart height (default 240)
 */

const BAR_COLOR = '#3b82f6'        // blue-500 — matches Top by Cost
const BAR_HOVER = '#93c5fd'        // blue-300 — clearly brighter on hover so the
                                   // selected bar is unmistakably called out

function CustomTooltip({ active, payload, label, dark }) {
  if (!active || !payload || !payload.length) return null
  const datum = payload[0]?.payload || {}
  const tokens = datum.tokens || 0
  const requests = datum.requests || 0
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
        <span style={{ width: 10, height: 10, borderRadius: 2, background: BAR_COLOR, display: 'inline-block' }} />
        <span style={{ color: text, fontWeight: 600 }}>Hour {label}</span>
      </div>
      <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>
        <div>Tokens: <span style={{ color: text, fontWeight: 600 }}>{formatNumber(tokens)}</span></div>
        {requests > 0 && (
          <div>Requests: <span style={{ color: text, fontWeight: 600 }}>{formatNumber(requests)}</span></div>
        )}
      </div>
    </div>
  )
}

const HourlyActivityChart = ({ data = [], height = 240 }) => {
  const dark = isDarkMode()
  const [activeIdx, setActiveIdx] = useState(-1)

  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>No activity data yet</div>
  }

  // Detect user's timezone offset in hours (e.g. IST = +5.5, EST = -5)
  const tzOffsetHours = -(new Date().getTimezoneOffset() / 60)

  // Shift UTC hours to local timezone
  const fullData = Array.from({ length: 24 }, (_, i) => {
    const utcHour = ((i - tzOffsetHours) % 24 + 24) % 24
    const utcHourFloor = Math.floor(utcHour)
    const existing = data.find(d => d.hour === utcHourFloor)
    return {
      hour: i,
      label: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
      tokens: existing?.tokens || 0,
      requests: existing?.requests || 0,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={fullData}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        onMouseMove={(state) => {
          if (state?.isTooltipActive && state.activeTooltipIndex != null) {
            setActiveIdx(state.activeTooltipIndex)
          } else {
            setActiveIdx(-1)
          }
        }}
        onMouseLeave={() => setActiveIdx(-1)}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#4a4a4a' : '#f0f0f0'} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: dark ? '#9ca3af' : '#6b7280' }} axisLine={false} tickLine={false} interval={2} />
        <YAxis tickFormatter={formatNumber} tick={{ fontSize: 11, fill: dark ? '#9ca3af' : '#6b7280' }} axisLine={false} tickLine={false} width={45} />
        <Tooltip
          // Subtle column highlight (very low opacity blue) instead of the
          // intrusive default light-gray rectangle. The hovered bar itself
          // also flips to a brighter blue, so the selection is doubly clear.
          cursor={{ fill: dark ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.08)' }}
          content={<CustomTooltip dark={dark} />}
          wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
        />
        <Bar dataKey="tokens" radius={[3, 3, 0, 0]} barSize={10}>
          {fullData.map((_, i) => (
            <Cell key={i} fill={i === activeIdx ? BAR_HOVER : BAR_COLOR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default HourlyActivityChart
