// Tables on the docs page run from 2 columns ("Status / Meaning") up to
// 3+ columns (Tools, Token Cost Model). On phones (~375 px) wide content was
// either clipping or pushing a column to one character per line. Two fixes
// baked into the shared classes:
//   1. break-words / align-top on cells — long URLs, JSON fields, sentences
//      wrap to the next line inside their own column instead of stretching it.
//   2. px-2 sm:px-3 lg:px-4 + py-2.5 sm:py-3 — tighter padding on mobile
//      gives content the extra horizontal room it needs.
// Header font is also dropped to text-[10px] on mobile (was xs / 12 px) so
// uppercase labels like "TOKEN COST MODEL" fit in a narrow column.
export const tableClass = 'w-full text-sm border-collapse mt-3 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm table-auto'
export const thClass = 'text-left px-2 sm:px-3 lg:px-4 py-2.5 sm:py-3 font-medium text-gray-500 dark:text-neutral-400 bg-gray-50 dark:bg-neutral-700 border-b border-gray-200 dark:border-neutral-700 text-[10px] sm:text-xs uppercase tracking-wider align-top'
export const tdClass = 'px-2 sm:px-3 lg:px-4 py-2.5 sm:py-3 border-b border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 align-top break-words'
// `docs-subhead` is a marker class the right-side "On this page" TOC
// uses to enumerate sub-headings inside the active section via
// querySelectorAll. Keep it on every subhead — search relies on it too.
export const subHeadClass = 'docs-subhead font-semibold text-gray-900 dark:text-neutral-100 text-sm mt-5 mb-1.5'
export const stepBadge = 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-bold flex-shrink-0 mr-2.5 shadow-sm'

export const BASE_URL = 'https://agenticai.pabbly.com'
