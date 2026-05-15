import { Crown } from 'lucide-react'
import { Link } from 'react-router-dom'
import Tooltip from './Tooltip'

/// Full-page upsell shown when a feature isn't included in the user's plan.
/// Matches the empty-state pattern used elsewhere in the app (Dashboard /
/// Schedules) — centered icon, heading + body, blue-600 primary CTA, neutral
/// secondary CTA. Sized for a full-page experience rather than an in-table
/// empty state.
///
/// Primary CTA deep-links to the in-app pricing cards on `/usage/plan`,
/// which now fetch live plans from PSB and launch the checkout popup
/// without leaving the app. The previous external `VITE_PABBLY_PRICING_URL`
/// redirect is no longer used.
export default function UpgradeGate({ feature, description }) {
  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900">
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 mb-4">
          <Crown size={22} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-neutral-100 mb-1.5">
          {feature} is not in your plan
        </h3>
        <p className="text-sm text-gray-500 dark:text-neutral-400 mb-5">
          {description}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Tooltip content={`Open Plans & Usage to compare plans and upgrade — unlocks ${feature}`}>
            <Link
              to="/usage/plan"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
            >
              See plans &amp; upgrade
            </Link>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
