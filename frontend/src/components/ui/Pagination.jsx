import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import Select from './Select'

const Pagination = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100, 200],
  loading = false,
}) => {
  if (totalItems === 0) return null

  const showPageControls = totalPages > 1
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  // Two page-number sets: a tight one for mobile (≤3 visible numbers) and
  // a wider one for sm+ screens (≤5 visible). Both share the same `…` logic;
  // only the window size differs. We render BOTH and toggle visibility with
  // Tailwind's responsive `hidden`/`block` classes — no JS media query, no
  // extra render after a resize.
  const buildPages = (maxVisible) => {
    const pages = []
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
      return pages
    }
    // Always show first + last; window of `maxVisible - 2` around current.
    const wing = Math.floor((maxVisible - 2) / 2)
    pages.push(1)
    let start = Math.max(2, currentPage - wing)
    let end = Math.min(totalPages - 1, currentPage + wing)
    // Clamp window to fit between first/last.
    if (currentPage <= wing + 1) end = Math.min(totalPages - 1, maxVisible - 1)
    if (currentPage >= totalPages - wing) start = Math.max(2, totalPages - maxVisible + 2)
    if (start > 2) pages.push('...')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < totalPages - 1) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  const mobilePages = showPageControls ? buildPages(3) : []
  const desktopPages = showPageControls ? buildPages(5) : []

  const navBtn = "w-8 h-8 inline-flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-white dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700">
      {/* Left — "Showing N–M of T" + "Rows per page: [N ▾]" */}
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 min-w-0">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-neutral-300 dark:border-neutral-600 border-t-neutral-600 dark:border-t-neutral-300 rounded-full animate-spin" aria-hidden />
            Loading…
          </span>
        ) : (
          <span>
            Showing{' '}
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{startItem}</span>
            <span className="mx-0.5">–</span>
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{endItem}</span>
            {' '}of{' '}
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{totalItems}</span>
          </span>
        )}
        {onPageSizeChange && (
          <span className="inline-flex items-center gap-2">
            <span>Rows per page:</span>
            <Select
              value={itemsPerPage}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizeOptions.map((size) => ({ value: size, label: String(size) }))}
              disabled={loading}
              size="sm"
              panelWidth="w-24"
              triggerClassName="rounded-md w-16"
            />
          </span>
        )}
      </div>

      {/* Right — first / prev / pages / next / last */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1 || loading}
          className={navBtn}
          title="First page"
          aria-label="First page"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || loading}
          className={navBtn}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Mobile: tight 3-page set */}
        <div className="flex sm:hidden items-center gap-0.5">
          {mobilePages.map((page, index) => (
            page === '...' ? (
              <span key={`m-ellipsis-${index}`} className="px-1 py-1 text-neutral-400 dark:text-neutral-500 text-xs">…</span>
            ) : (
              <button
                key={`m-${page}`}
                onClick={() => onPageChange(page)}
                disabled={loading}
                className={`min-w-[28px] h-7 px-1.5 rounded-lg text-xs font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                } disabled:opacity-50`}
              >
                {page}
              </button>
            )
          ))}
        </div>
        {/* Desktop: 5-page set */}
        <div className="hidden sm:flex items-center gap-1">
          {desktopPages.map((page, index) => (
            page === '...' ? (
              <span key={`d-ellipsis-${index}`} className="px-2 py-1 text-neutral-400 dark:text-neutral-500 text-sm">…</span>
            ) : (
              <button
                key={`d-${page}`}
                onClick={() => onPageChange(page)}
                disabled={loading}
                className={`min-w-[32px] h-8 px-2.5 rounded-lg text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                } disabled:opacity-50`}
              >
                {page}
              </button>
            )
          ))}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || loading}
          className={navBtn}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages || loading}
          className={navBtn}
          title="Last page"
          aria-label="Last page"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}

export default Pagination
