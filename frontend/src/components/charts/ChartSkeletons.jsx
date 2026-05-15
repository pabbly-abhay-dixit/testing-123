// Chart-shape-specific skeleton placeholders. Lifted out of AdminAnalytics
// so the Token Usage page can render the same loading silhouettes for its
// line / donut charts.

function Skel({ className = '', style }) {
  return <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} style={style} />
}

export function LineChartSkel({ height = 260 }) {
  // Big block + axis tick row at the bottom — mimics a line/area chart.
  return (
    <div className="relative w-full" style={{ height }}>
      <Skel className="absolute inset-0 rounded-md" />
      <div className="absolute left-0 right-0 bottom-2 flex justify-between px-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skel key={i} className="h-2 w-6" />
        ))}
      </div>
    </div>
  )
}

export function DonutSkel({ height = 280 }) {
  return (
    <div className="flex flex-col items-center justify-center w-full" style={{ height }}>
      <div
        className="rounded-full border-[18px] border-neutral-200 dark:border-neutral-700 animate-pulse"
        style={{ width: 168, height: 168 }}
      />
      <div className="flex gap-3 mt-4">
        {Array.from({ length: 3 }).map((_, i) => <Skel key={i} className="h-3 w-16" />)}
      </div>
    </div>
  )
}

export function BarsSkel({ height = 280 }) {
  // Vertical-bar shape — mirrors hourly activity. Random heights for realism.
  const heights = [12, 8, 10, 14, 22, 18, 30, 45, 70, 60, 50, 80, 92, 70, 55, 90, 78, 65, 45, 30, 20, 18, 12, 10]
  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end justify-between h-[88%] gap-1 px-1">
        {heights.map((h, i) => (
          <Skel key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, minWidth: 6 }} />
        ))}
      </div>
      <div className="flex justify-between px-1 mt-2">
        {Array.from({ length: 8 }).map((_, i) => <Skel key={i} className="h-2 w-6" />)}
      </div>
    </div>
  )
}

export function BarRowsSkel({ rows = 10, height }) {
  // Horizontal bars matching TopItemsBarChart's row layout (name + bar).
  const widths = ['90%', '78%', '64%', '58%', '52%', '45%', '38%', '32%', '24%', '18%']
  const rowHeight = 24
  const computedHeight = height || rows * rowHeight + 32
  return (
    <div className="w-full" style={{ height: computedHeight }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(110px, 22%) 1fr' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="contents">
            <Skel className="h-3 self-center" style={{ width: '70%' }} />
            <Skel className="h-2.5 self-center" style={{ width: widths[i] || '20%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
