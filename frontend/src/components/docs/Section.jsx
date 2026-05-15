import { useContext, useEffect, useMemo } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { CollapseCtx } from './CollapseCtx'
import { DocsNavCtx, slugify } from './DocsNavCtx'

export default function Section({ title, icon: Icon, tooltip, children, alwaysOpen = false, headerActions = null }) {
  const ctx = useContext(CollapseCtx)
  const navCtx = useContext(DocsNavCtx)
  // alwaysOpen lets a single section (e.g. Introduction) opt out of the
  // collapsible group even when wrapped in a CollapseCtx — it always renders
  // expanded in the original non-collapsible layout.
  const collapsible = !!ctx && !alwaysOpen
  const id = collapsible ? `section:${title}` : null
  const open = collapsible ? ctx.isOpen(id) : true

  // Register this id with the parent ApiReferenceTab so Expand-All knows the
  // total set of collapsibles. No-op when not collapsible.
  useEffect(() => {
    if (collapsible && ctx.register) ctx.register(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsible, id])

  // Slug derived from title — stable, used by the parent left-nav as the
  // key + URL fragment + active-state matcher.
  const slug = useMemo(() => slugify(title), [title])

  // Register with the DocsNavCtx (if any) so the parent can render the
  // left-nav list. No unregister on unmount: tab switches reset the
  // registry from the parent side via a useEffect on activeTab; that
  // keeps the section-registration stable when the active section
  // toggles within a tab (Section keeps rendering in `hidden` mode).
  useEffect(() => {
    if (!navCtx || !navCtx.register) return
    navCtx.register({ slug, title, icon: Icon, tooltip })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, title])

  // Section-by-section mode: only the active section renders in view.
  // When DocsNavCtx is present and this section's slug doesn't match
  // the active one, hide it. The left-nav click handler in DocsLayout
  // flips activeSlug and scrolls the content area back to top —
  // Stripe/Vercel-style one-section-at-a-time reading flow.
  const navHide = !!(navCtx && navCtx.activeSlug && navCtx.activeSlug !== slug)

  if (!collapsible) {
    const heading = (
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-neutral-100 cursor-help truncate">{title}</h2>
    )
    return (
      <section className={`mb-8 pb-1 docs-section ${navHide ? 'hidden' : ''}`} data-section-title={title} data-section-slug={slug} id={`section-${slug}`}>
        <div className="flex items-center justify-between gap-3 pb-2 mb-3 border-b border-gray-200 dark:border-neutral-700">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 flex-shrink-0" />}
            {tooltip ? <Tooltip content={tooltip}>{heading}</Tooltip> : heading}
          </div>
          {headerActions && (
            <div className="docs-no-print flex items-center gap-2 flex-shrink-0">{headerActions}</div>
          )}
        </div>
        <div className="text-sm text-gray-600 dark:text-neutral-300 leading-relaxed space-y-3">
          {children}
        </div>
      </section>
    )
  }

  // Collapsible variant — mirrors ptm-app `OrganizationSettings` API Doc tab:
  // bordered card + tinted full-width header button + folder icon + chevron-down
  // that rotates 180° when expanded.
  const HeadIcon = Icon || FolderOpen
  return (
    <div className={`docs-section mb-3 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden ${navHide ? 'hidden' : ''}`} data-section-title={title} data-section-slug={slug} id={`section-${slug}`}>
      <button
        type="button"
        onClick={() => ctx.toggle(id)}
        aria-expanded={open}
        className="w-full flex items-center justify-between bg-neutral-50 dark:bg-neutral-800 px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <HeadIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          <h5 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 truncate">{title}</h5>
        </div>
        <ChevronDown className={`w-4 h-4 text-neutral-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`docs-collapsible-body ${open ? '' : 'hidden'}`}>
        <div className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-300 leading-relaxed space-y-3 border-t border-neutral-200 dark:border-neutral-700">
          {tooltip && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 italic">{tooltip}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
