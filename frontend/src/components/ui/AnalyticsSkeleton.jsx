// Shared skeleton for the Admin > Analytics page.
// Used in TWO places so the user never sees a spinner-then-skeleton flash:
//   1. Admin.jsx <Suspense fallback={…}>  while the lazy chunk downloads
//   2. AdminAnalytics.jsx                  while the API request is in-flight
// Layout mirrors the post-load body: 6 metric cards, daily-trend full row,
// distribution + hourly two-up row, top-by-cost full row, transaction log.

function Box({ className = '' }) {
  return <div className={`bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} />
}

function MetricSkel() {
  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
      <Box className="h-3 w-20 mb-3" />
      <Box className="h-7 w-24 mb-2" />
      <Box className="h-3 w-28" />
    </div>
  )
}

function ChartSkel({ height = 260 }) {
  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
      <Box className="h-3 w-32 mb-3" />
      <Box className={`w-full`} style={{ height }} />
    </div>
  )
}

export default function AnalyticsSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 6 metric cards in one row (2 cols mobile, 3 cols sm, 6 cols lg) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <MetricSkel key={i} />)}
      </div>
      {/* Daily trend (full width) */}
      <ChartSkel height={260} />
      {/* Distribution + Hourly Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartSkel height={280} />
        <ChartSkel height={280} />
      </div>
      {/* Top by cost (full width) */}
      <ChartSkel height={320} />
      {/* Transaction log card */}
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <Box className="h-4 w-36" />
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Box key={i} className="h-8 w-full" />)}
        </div>
      </div>
    </div>
  )
}
