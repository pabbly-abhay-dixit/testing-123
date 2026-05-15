import { useState, useEffect, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { isDarkMode, PALETTE, formatNumber, formatCredits } from './chartTheme'

/**
 * Top items horizontal bar chart — reusable for top agents, top users, etc.
 * @param {Array} data - [{name: "Agent Name", value: 12345, extra?: {input, output, cache_read, cache_write, requests}}, ...]
 * @param {string} valueLabel - label for the value (default "Cost")
 * @param {string} valueType - "credits" | "tokens" | "number" | "usd" (formatting)
 * @param {string} color - bar color (default palette[0])
 * @param {number} height - chart height (default 280)
 */

const GUTTER_LEFT_PADDING = 14    // breathing room from chart left edge
const TICK_FONT_SIZE = 12
// Roughly the average glyph width at the tick font size used by recharts. Used
// to derive how many characters fit in the available name gutter so we only
// truncate when the name genuinely overflows.
const AVG_CHAR_WIDTH = 7.2
// Gutter sizing — % of container width on desktop, with a hard floor + cap so
// it stays usable on tiny phones and doesn't eat half the chart on huge
// monitors.
const GUTTER_PCT = 0.22
const GUTTER_MIN = 110
const GUTTER_MAX = 320

// Middle-ellipsis: keep first chunk + last chunk, "…" in between. Limit is
// derived from the available gutter width at render time, NOT a fixed const.
// "Meeting Scheduler Workflow" (length 26, limit 17) → "Meeting S…rkflow"
function truncate(name, limit) {
  if (!name) return 'Unknown'
  if (name.length <= limit) return name
  const keep = limit - 1
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return name.slice(0, head) + '…' + name.slice(-tail)
}

function formatUsd(val) {
  const n = Math.abs(val || 0)
  if (n === 0) return '$0'
  if (n < 0.01) return '$' + n.toFixed(4)
  if (n < 1) return '$' + n.toFixed(3)
  if (n < 100) return '$' + n.toFixed(2)
  return '$' + Math.round(n).toLocaleString()
}

function formatValue(val, valueType) {
  if (valueType === 'usd') return formatUsd(val)
  if (valueType === 'credits') return formatCredits(val) + ' credits'
  if (valueType === 'tokens') return formatNumber(val) + ' tokens'
  return formatNumber(val)
}

/**
 * Custom YAxis tick:
 *   • Always renders on a single line (recharts' default <Text> auto-wraps on
 *     spaces — that turned "Meeting…rkflow" into a 2-row stacked label).
 *   • Left-aligned to the gutter so every name starts at the same x-position.
 *   • SVG glyphs can extend a couple of pixels left of `x` because of glyph
 *     side-bearing — so we keep a generous left padding to avoid clipping the
 *     first letter against the chart's left edge.
 *   • Hover-aware: only truncated names register hover, fires `onHover` with
 *     the full name + screen position so the parent can render a styled
 *     tooltip on top of the chart.
 */
function CategoryTick({ x, y, payload, fill, allData, gutterWidth, onHover, onLeave }) {
  const display = payload?.value || ''
  // Recharts only passes the displayed value to the tick, not the full datum.
  // Recover the original name from the parent's chartData (truncated names
  // are unique within a Top-N visible set).
  const datum = allData?.find((d) => d.name === display)
  const fullName = datum?.fullName || display
  const truncated = fullName !== display
  return (
    <g transform={`translate(${x},${y})`} style={{ overflow: 'visible' }}>
      <text
        x={-(gutterWidth - GUTTER_LEFT_PADDING)}
        y={0}
        dy={4}
        textAnchor="start"
        fontSize={TICK_FONT_SIZE}
        fill={fill}
        fontWeight={500}
        style={{ cursor: truncated ? 'help' : 'default' }}
        onMouseEnter={(e) => truncated && onHover?.(fullName, e)}
        onMouseLeave={() => truncated && onLeave?.()}
      >
        {display}
      </text>
    </g>
  )
}

// Bar/value tooltip — full name + (optional) per-token breakdown.
function CustomTooltip({ active, payload, valueLabel, valueType, dark }) {
  if (!active || !payload || !payload.length) return null
  const datum = payload[0]?.payload || {}
  const fullName = datum.fullName || datum.name || 'Unknown'
  const value = payload[0]?.value ?? 0
  const extra = datum.extra
  const bg = dark ? '#1f1f1f' : '#ffffff'
  const border = dark ? '#3f3f3f' : '#e5e7eb'
  const muted = dark ? '#9ca3af' : '#6b7280'
  const text = dark ? '#f3f4f6' : '#111827'

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: '8px 10px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: 11,
        minWidth: 180,
        maxWidth: 280,
      }}
    >
      <div style={{ color: text, fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>{fullName}</div>
      <div style={{ color: muted, marginBottom: extra ? 6 : 0 }}>
        <span>{valueLabel}: </span>
        <span style={{ color: text, fontWeight: 600 }}>{formatValue(value, valueType)}</span>
      </div>
      {extra && (() => {
        const rows = []
        const push = (label, val) => {
          if (val == null || val === 0) return
          rows.push(
            <span key={`${label}-l`}>{label}</span>,
            <span key={`${label}-v`} style={{ color: text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(val)}</span>,
          )
        }
        push('Total tokens', extra.total)
        push('Input', extra.input)
        push('Output', extra.output)
        push('Cache read', extra.cache_read)
        push('Cache write', extra.cache_write)
        push('Requests', extra.requests)
        if (rows.length === 0) return null
        return (
          <div style={{ borderTop: `1px solid ${border}`, paddingTop: 6, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', color: muted }}>
            {rows}
          </div>
        )
      })()}
    </div>
  )
}

const TopItemsBarChart = ({ data = [], valueLabel = 'Cost', valueType = 'credits', color, height = 280 }) => {
  const dark = isDarkMode()
  const barColor = color || PALETTE[0]
  const [tickHover, setTickHover] = useState(null) // { name, left, top }
  // Track the wrapper width so the YAxis gutter can scale with the chart and
  // names display in full whenever there's room. Defaults to 600 so the first
  // render before ResizeObserver fires still produces a sensible gutter.
  const wrapperRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(600)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w && Math.abs(w - containerWidth) > 4) setContainerWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>No data yet</div>
  }

  // Gutter size: ~22% of chart width on desktop, clamped to keep mobile usable
  // and avoid hogging the chart on ultra-wide screens. Truncate limit derives
  // from the gutter — names only ellipsis when they genuinely overflow.
  const gutterWidth = Math.round(
    Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, containerWidth * GUTTER_PCT))
  )
  const truncateLimit = Math.max(8, Math.floor((gutterWidth - GUTTER_LEFT_PADDING) / AVG_CHAR_WIDTH))

  // Keep full name for the tooltip, truncated label for the YAxis tick.
  const chartData = data.slice(0, 10).map(d => ({
    ...d,
    fullName: d.name || 'Unknown',
    name: truncate(d.name, truncateLimit),
  }))

  const tickFill = dark ? '#e5e5e5' : '#1f2937'

  const handleTickHover = (name, evt) => {
    const rect = evt?.currentTarget?.getBoundingClientRect?.()
    if (!rect) return
    setTickHover({
      name,
      left: rect.right + 6,
      top: rect.top + rect.height / 2,
    })
  }

  return (
    <div ref={wrapperRef} className="relative" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
          barCategoryGap="25%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#4a4a4a' : '#f0f0f0'} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v) => valueType === 'usd' ? formatUsd(v) : valueType === 'credits' ? formatCredits(v) : formatNumber(v)}
            tick={{ fontSize: 11, fill: dark ? '#9ca3af' : '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={(
              <CategoryTick
                fill={tickFill}
                allData={chartData}
                gutterWidth={gutterWidth}
                onHover={handleTickHover}
                onLeave={() => setTickHover(null)}
              />
            )}
            axisLine={false}
            tickLine={false}
            width={gutterWidth}
            interval={0}
          />
          <Tooltip cursor={{ fill: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} content={<CustomTooltip valueLabel={valueLabel} valueType={valueType} dark={dark} />} />
          <Bar dataKey="value" fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>

      {tickHover && (
        <div
          style={{
            position: 'fixed',
            left: tickHover.left,
            top: tickHover.top,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
            background: dark ? '#1f1f1f' : '#111827',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            whiteSpace: 'nowrap',
            maxWidth: 360,
          }}
        >
          {tickHover.name}
        </div>
      )}
    </div>
  )
}

// CategoryTick is rendered through React.cloneElement by recharts when passed
// as a JSX element to the YAxis `tick` prop — that means recharts merges the
// tick callback's `x`, `y`, and `payload` into the props automatically.
// No further wiring needed here.

// `fullName` is read off the recharts payload via the `data-doc-section` style
// pattern: the chartData is mapped so each row carries a stable `fullName` —
// but the YAxis only knows the truncated `name`. To recover the full name
// inside the tick component, we look it up from the parent's chartData via
// the `payload.value` (which is the truncated label). This works because
// truncated labels in Top-N charts are unique within the visible set.

export default TopItemsBarChart
