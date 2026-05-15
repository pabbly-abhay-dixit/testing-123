// Shared chart theme — colors, dark mode detection, tooltip styles.
// All chart components import from here for visual consistency.

export const PALETTE = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#64748b', // slate
]

export const isDarkMode = () =>
  document.documentElement.classList.contains('dark')

export const useChartColors = () => {
  const dark = isDarkMode()
  return {
    grid: dark ? '#4a4a4a' : '#e5e7eb',
    text: dark ? '#9ca3af' : '#6b7280',
    bg: dark ? '#2c2c2c' : '#ffffff',
    cardBg: dark ? '#383838' : '#fafafa',
    border: dark ? '#484848' : '#e5e7eb',
    palette: PALETTE,
  }
}

export const tooltipStyle = (dark) => ({
  contentStyle: {
    background: dark ? '#2c2c2c' : '#fff',
    border: `1px solid ${dark ? '#4a4a4a' : '#e5e7eb'}`,
    borderRadius: 8,
    fontSize: 12,
    padding: '8px 12px',
    color: dark ? '#e5e5e5' : '#1a1a1a',
  },
  labelStyle: { color: dark ? '#9ca3af' : '#6b7280', marginBottom: 4 },
})

// Format large numbers: 1234567 → "1.2M", 12345 → "12.3K"
export const formatNumber = (n) => {
  if (n == null) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

// Format credits (milli-credits to display): smart formatting for larger values
export const formatCredits = (milli) => {
  if (milli == null) return '0'
  const credits = Math.abs(milli) / 1_000
  if (credits >= 1000) return Math.round(credits).toLocaleString()
  if (credits >= 10) return credits.toFixed(1)
  if (credits >= 1) return credits.toFixed(2)
  return credits.toFixed(4)
}
