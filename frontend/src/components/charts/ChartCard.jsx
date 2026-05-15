import Tooltip from '../ui/Tooltip'

/**
 * Shared wrapper for chart cards. Produces the rounded white/neutral-800
 * card with an uppercase title (optional Tooltip) and an optional
 * segmented tab switcher in the header. Body is whatever children pass
 * — typically a chart or a chart skeleton.
 *
 * Lifted out of AdminAnalytics so the Token Usage page can use the
 * exact same chrome.
 */
export default function ChartCard({ title, tip, tabs, activeTab, onTabChange, children, footer }) {
  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        {tip ? (
          <Tooltip content={tip}>
            <h3 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider inline-block">{title}</h3>
          </Tooltip>
        ) : (
          <h3 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{title}</h3>
        )}
        {tabs && (
          <div className="inline-flex bg-neutral-100 dark:bg-neutral-700 rounded-lg p-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`px-2 sm:px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 shadow-sm'
                    : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-100'
                }`}
              >{tab.label}</button>
            ))}
          </div>
        )}
      </div>
      {children}
      {footer}
    </div>
  )
}
