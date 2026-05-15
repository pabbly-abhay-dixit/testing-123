import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Menu, ChevronRight, BookOpen } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { DocsNavCtx, slugify } from './DocsNavCtx'
import { rank, snippet } from './fuzzy'

// Three-column docs shell — left nav, content, right TOC. Wraps each
// tab's existing Section list. Sections self-register via DocsNavCtx
// so the left nav builds itself with zero changes to the section JSX.
//
// Mobile (< sm): left nav becomes a slide-in drawer (hamburger button),
// right TOC becomes a collapsible <details> at the top of the content.
//
// Search index: scans the rendered DOM for each section's textContent
// after mount. Rebuilt whenever the registry changes (tab switch).
export default function DocsLayout({ tabKey, children }) {
  const containerRef = useRef(null)
  // Registry of sections that have self-registered via DocsNavCtx.
  // Stored as object keyed by slug so duplicates are deduped and
  // re-registers (StrictMode 2× mount) don't double-insert.
  const [registry, setRegistry] = useState({})
  // Insertion order — sections register in render order, which IS the
  // visual reading order. Stored separately so we don't lose it.
  const orderRef = useRef([])

  const register = useCallback((entry) => {
    if (!entry?.slug) return
    // Dedup at the ref level FIRST so React StrictMode's double-invoke
    // of the setRegistry callback can't push the same slug twice.
    // (Strict mode runs the updater fn twice with the same `prev` to
    // detect impurity — any mutation inside the updater would happen
    // both times.)
    if (orderRef.current.includes(entry.slug)) return
    orderRef.current.push(entry.slug)
    setRegistry((prev) => (prev[entry.slug] ? prev : { ...prev, [entry.slug]: entry }))
  }, [])

  // Active section: tracks which one the user has selected from the
  // left nav. Section-by-section mode — only the active section's
  // content renders; all others are `display: none`.
  const [activeSlug, setActiveSlugState] = useState(null)
  // `setActiveSlug` flips the active section AND scrolls the content
  // area back to the top so the user starts at the heading of the
  // newly-selected section. We walk up to the nearest scrolling
  // ancestor (the dashboard's <main>) — same trick as `findScrollRoot`
  // below — because the document viewport doesn't scroll here.
  const setActiveSlug = useCallback((slug) => {
    if (!slug) return
    setActiveSlugState(slug)
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href)
      u.searchParams.set('section', slug)
      window.history.replaceState(null, '', u)
    }
    // Scroll the actual scrolling container back to top, not the
    // window. The dashboard <main> has `overflow-auto`, so
    // window.scrollTo() is a no-op.
    let cur = containerRef.current?.parentElement
    while (cur && cur !== document.body) {
      const oy = window.getComputedStyle(cur).overflowY
      if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) {
        cur.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      cur = cur.parentElement
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // On first registry update for this tab, prefer ?section=<slug> if
  // it points to a registered section; else fall back to the first
  // registered slug.
  const sectionList = useMemo(() => orderRef.current.map((s) => registry[s]).filter(Boolean), [registry])
  useEffect(() => {
    if (activeSlug || sectionList.length === 0) return
    const urlSlug = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('section') : null
    const initial = urlSlug && registry[urlSlug] ? urlSlug : sectionList[0]?.slug
    if (initial) setActiveSlugState(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionList.length])

  // No reset effect needed: DocsPage renders a different <DocsLayout>
  // per tab (different JSX positions via the `&&` conditional), so
  // React unmounts the old DocsLayout and mounts a fresh one on tab
  // switch. The `tabKey` prop is now informational only — kept on the
  // signature so future debugging / telemetry can read it. The earlier
  // reset useEffect was firing on FIRST mount too (before children
  // registered) and silently wiping every section the children had
  // just registered — that's why the left nav and search were empty.

  const navCtxValue = useMemo(() => ({
    activeSlug,
    register,
    setActiveSlug,
  }), [activeSlug, register, setActiveSlug])

  // Sub-headings of the currently-active section — populates the
  // nested list under the active section in the left nav. Subhead ids
  // are assigned for ALL sections (not just active) on mount, so click
  // navigation works regardless of which section is currently active.
  const [subheads, setSubheads] = useState([])
  // Assign stable ids to every .docs-subhead in the whole tab once
  // sections have rendered. Ids = `subhead-<sectionSlug>-<subSlug>`.
  useEffect(() => {
    if (!containerRef.current || sectionList.length === 0) return undefined
    const t = setTimeout(() => {
      if (!containerRef.current) return
      sectionList.forEach((s) => {
        const root = containerRef.current.querySelector(`#section-${CSS.escape(s.slug)}`)
        if (!root) return
        root.querySelectorAll('.docs-subhead').forEach((node, idx) => {
          const text = node.textContent.trim()
          if (!text) return
          node.id = `subhead-${s.slug}-${slugify(text) || idx}`
          node.style.scrollMarginTop = '80px'
        })
      })
    }, 0)
    return () => clearTimeout(t)
  }, [sectionList])

  // Recompute the active section's subhead list whenever the active
  // slug changes OR the section's content changes (Endpoint cards
  // mount, images load, etc). Subheads always render when present —
  // each `.docs-subhead` (text subhead inside Section content OR an
  // Endpoint's `METHOD path` header) is a concrete navigation target
  // and we don't second-guess whether the section "needs" them.
  // Only filter applied: require >= 1 subhead with a non-empty label.
  useEffect(() => {
    if (!activeSlug || !containerRef.current) {
      setSubheads([])
      return undefined
    }
    const root = containerRef.current.querySelector(`#section-${CSS.escape(activeSlug)}`)
    if (!root) { setSubheads([]); return undefined }

    const recompute = () => {
      const list = []
      root.querySelectorAll('.docs-subhead').forEach((node) => {
        const text = node.textContent.trim()
        if (text && node.id) list.push({ id: node.id, text })
      })
      setSubheads(list)
    }

    // Initial measure after layout flushes — gives Endpoint children
    // a chance to mount + get their stable ids assigned by the id-
    // stamping effect above.
    const raf = window.requestAnimationFrame(recompute)

    // Re-measure on layout changes (image / font load, window resize,
    // collapsible expansions). ResizeObserver covers the dynamic
    // height cases; `resize` covers window-only changes.
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(recompute)
      : null
    if (ro) ro.observe(root)
    const onResize = () => recompute()
    window.addEventListener('resize', onResize)

    return () => {
      window.cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [activeSlug])

  // Track which subhead is currently in view so the matching left-nav
  // button can light up while the user scrolls inside a section.
  // Scroll-based scan (NOT IntersectionObserver) because an IO with a
  // narrow rootMargin band misses the bottom edge — when the user
  // scrolls past the last subhead, NONE of them intersect the band
  // and the highlight gets stuck. The scroll handler picks the last
  // subhead whose top has crossed the activation line, and force-
  // selects the final subhead when the scroller is at the bottom.
  const [activeSubheadId, setActiveSubheadId] = useState(null)
  useEffect(() => {
    if (!activeSlug || subheads.length === 0 || !containerRef.current) {
      setActiveSubheadId(null)
      return undefined
    }
    const nodes = subheads
      .map((sh) => ({ id: sh.id, node: document.getElementById(sh.id) }))
      .filter((x) => x.node)
    if (nodes.length === 0) return undefined

    // Find the actual scrolling ancestor (dashboard <main>).
    let scrollRoot = null
    let cur = containerRef.current?.parentElement
    while (cur && cur !== document.body) {
      const oy = window.getComputedStyle(cur).overflowY
      if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) {
        scrollRoot = cur
        break
      }
      cur = cur.parentElement
    }

    const recompute = () => {
      const viewportTop = scrollRoot ? scrollRoot.getBoundingClientRect().top : 0
      const viewportH = scrollRoot ? scrollRoot.clientHeight : window.innerHeight
      // Activation line — anything whose top has crossed this point
      // (going upward) is considered "currently being read".
      const activationY = viewportTop + viewportH * 0.25

      // Bottom-of-scroll guard — if the user can't scroll further down,
      // the last subhead wins regardless of where its anchor sits.
      // Without this, the highlight gets stuck on whatever was last
      // above the activation line when the page bottomed out.
      if (scrollRoot) {
        const atBottom = scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 4
        if (atBottom) {
          setActiveSubheadId(nodes[nodes.length - 1].id)
          return
        }
      } else {
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
        if (atBottom) {
          setActiveSubheadId(nodes[nodes.length - 1].id)
          return
        }
      }

      // Walk subheads in order; remember the last one whose top is at
      // or above the activation line. That's the currently-active one.
      let active = nodes[0].id
      for (const { id, node } of nodes) {
        const top = node.getBoundingClientRect().top
        if (top <= activationY) active = id
        else break
      }
      setActiveSubheadId(active)
    }

    // Initial paint + listen to scroll & resize on the right target.
    recompute()
    const target = scrollRoot || window
    const onScroll = () => recompute()
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [activeSlug, subheads])

  // ─── Search ───────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  // Index built lazily from the DOM after registry settles. Re-runs
  // when the tab (and so the rendered sections) changes.
  const [searchIndex, setSearchIndex] = useState([])
  const buildIndex = useCallback(() => {
    if (!containerRef.current || sectionList.length === 0) {
      setSearchIndex([])
      return
    }
    const items = []
    sectionList.forEach((s) => {
      const node = containerRef.current.querySelector(`#section-${CSS.escape(s.slug)}`)
      const text = node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : ''
      items.push({ slug: s.slug, title: s.title, icon: s.icon, text })
    })
    setSearchIndex(items)
  }, [sectionList])

  useEffect(() => {
    // Run after layout flushes so Section DOM nodes are present.
    const raf = requestAnimationFrame(buildIndex)
    return () => cancelAnimationFrame(raf)
  }, [buildIndex])

  // Belt-and-braces: when the user focuses the search bar, if the
  // index is somehow empty (e.g. registration race on the first paint),
  // rebuild it on the spot. Cheap — same scan that happens on mount.
  const ensureIndex = useCallback(() => {
    if (searchIndex.length === 0 && sectionList.length > 0) buildIndex()
  }, [searchIndex.length, sectionList.length, buildIndex])

  // Rank results — title carries 2× weight vs body since matches in
  // the title are almost always what the user wants.
  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    // Weight via two passes: score the title first, score the body,
    // then merge.
    const titleHits = rank(q, searchIndex, (it) => it.title, 12)
    const bodyHits = rank(q, searchIndex, (it) => it.text, 12)
    const seen = new Set()
    const merged = []
    for (const it of titleHits) {
      if (seen.has(it.slug)) continue
      seen.add(it.slug)
      merged.push({ ...it, matchedIn: 'title' })
      if (merged.length >= 8) break
    }
    for (const it of bodyHits) {
      if (seen.has(it.slug)) continue
      seen.add(it.slug)
      merged.push({ ...it, matchedIn: 'body', preview: snippet(q, it.text) })
      if (merged.length >= 8) break
    }
    return merged
  }, [query, searchIndex])

  // Keyboard: `/` focuses search, `Esc` clears.
  const searchRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable
      if (!isTyping && e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('')
        searchRef.current?.blur()
        setSearchFocused(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click a search result → jump to section + clear query.
  const goToResult = useCallback((slug) => {
    setActiveSlug(slug)
    setQuery('')
    setSearchFocused(false)
    // Scroll the content panel back to top after the section swap.
    setTimeout(() => {
      containerRef.current?.querySelector(`#section-${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }, [setActiveSlug])

  // Click a subhead → smooth-scroll inside the section.
  const goToSubhead = useCallback((id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ─── Mobile drawer ────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [activeSlug]) // close drawer on section pick

  return (
    <DocsNavCtx.Provider value={navCtxValue}>
      <div className="relative">
        {/* Toolbar — search + mobile menu button. Sticky so it follows
            the scroll. */}
        <div className="sticky top-0 z-20 -mx-3 sm:-mx-6 px-3 sm:px-6 py-3 mb-4 bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-gray-200 dark:border-neutral-700 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen((s) => !s)}
            className="sm:hidden p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex-shrink-0"
            aria-label="Open sections"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="relative flex-1 max-w-xl">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); ensureIndex() }}
              onFocus={() => { setSearchFocused(true); ensureIndex() }}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150) /* let click on result land */}
              placeholder="Search docs… (typos OK — try “dtaa”)"
              className="w-full pl-8 pr-9 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-neutral-900 outline-none text-[13px] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); searchRef.current?.focus() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {!query && (
              <kbd className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-neutral-400 dark:text-neutral-500 bg-neutral-200/60 dark:bg-neutral-700/60 border border-neutral-300/60 dark:border-neutral-600/60">
                /
              </kbd>
            )}
            {/* Search results dropdown */}
            {searchFocused && query && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg max-h-96 overflow-y-auto z-30">
                {results.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-neutral-500 dark:text-neutral-400">
                    No matches for <span className="font-mono text-neutral-700 dark:text-neutral-200">"{query}"</span>
                  </div>
                ) : (
                  <ul className="py-1">
                    {results.map((r) => {
                      const Icon = r.icon
                      return (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault() /* don't blur the input before click handler runs */}
                            onClick={() => goToResult(r.slug)}
                            className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 flex items-start gap-2"
                          >
                            {Icon && <Icon className="w-3.5 h-3.5 text-neutral-400 mt-0.5 flex-shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">{r.title}</div>
                              {r.preview && (
                                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5">{r.preview}</div>
                              )}
                            </div>
                            <ChevronRight className="w-3 h-3 text-neutral-300 dark:text-neutral-600 mt-1 flex-shrink-0" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
          {/* ─── LEFT NAV ─── */}
          {/* The aside is `position: sticky` directly. Sticky range =
              containing-block height − element height; here the
              containing block is the grid track, which is as tall as
              the content column. `self-start` keeps the aside at its
              natural height (not stretched), so the sticky range
              equals (content height − nav height) — large for any
              long section. `max-h` + internal `overflow-y-auto`
              handle the case where the nav itself is tall. `top-[64px]`
              parks it just below the sticky search toolbar. `z-10` so
              the sticking pane sits over content when they overlap. */}
          <aside className="hidden lg:block sticky top-[64px] self-start max-h-[calc(100vh-80px)] overflow-y-auto pr-1 z-10">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-neutral-400 mb-2 px-2">Sections</div>
              <nav className="flex flex-col gap-0.5">
                {sectionList.map((s) => {
                  const Icon = s.icon
                  const active = s.slug === activeSlug
                  const btn = (
                    <button
                      type="button"
                      onClick={() => setActiveSlug(s.slug)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-left transition-colors ${
                        active
                          ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                      }`}
                    >
                      {Icon ? <Icon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" /> : <BookOpen className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />}
                      <span className="truncate">{s.title}</span>
                    </button>
                  )
                  return (
                    <div key={s.slug}>
                      {s.tooltip ? <Tooltip content={s.tooltip} position="right">{btn}</Tooltip> : btn}
                      {/* Nested sub-sections — only rendered under the
                          active section so the nav stays compact. The
                          left bar gives a hierarchy cue (Stripe / Vercel
                          / Tailwind docs use the same pattern). */}
                      {active && subheads.length > 0 && (
                        <ul className="ml-3 mt-0.5 mb-1 border-l border-neutral-200 dark:border-neutral-700 flex flex-col gap-0.5">
                          {subheads.map((sh) => {
                            const isHere = sh.id === activeSubheadId
                            return (
                              <li key={sh.id}>
                                <button
                                  type="button"
                                  onClick={() => goToSubhead(sh.id)}
                                  className={`w-full text-left pl-3 pr-2 py-1 -ml-px border-l-2 truncate transition-colors ${
                                    isHere
                                      ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100 font-medium text-[11.5px]'
                                      : 'border-transparent hover:border-neutral-400 dark:hover:border-neutral-500 text-[11.5px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                                  }`}
                                  title={sh.text}
                                >
                                  {sh.text}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* ─── MOBILE DRAWER ─── */}
          {drawerOpen && (
            <>
              <div
                className="lg:hidden fixed inset-0 bg-black/40 z-30"
                onClick={() => setDrawerOpen(false)}
                aria-hidden="true"
              />
              <aside className="lg:hidden fixed left-0 top-0 bottom-0 w-72 max-w-[85vw] z-40 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-700 overflow-y-auto p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-neutral-400 px-2">Sections</div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="p-1 rounded text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <nav className="flex flex-col gap-0.5">
                  {sectionList.map((s) => {
                    const Icon = s.icon
                    const active = s.slug === activeSlug
                    return (
                      <div key={s.slug}>
                        <button
                          type="button"
                          onClick={() => setActiveSlug(s.slug)}
                          className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-[13px] text-left transition-colors ${
                            active
                              ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold'
                              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                          }`}
                        >
                          {Icon ? <Icon className="w-4 h-4 flex-shrink-0 text-neutral-400" /> : <BookOpen className="w-4 h-4 flex-shrink-0 text-neutral-400" />}
                          <span className="truncate">{s.title}</span>
                        </button>
                        {active && subheads.length > 0 && (
                          <ul className="ml-4 mt-0.5 mb-1 border-l border-neutral-200 dark:border-neutral-700 flex flex-col gap-0.5">
                            {subheads.map((sh) => {
                              const isHere = sh.id === activeSubheadId
                              return (
                                <li key={sh.id}>
                                  <button
                                    type="button"
                                    onClick={() => { goToSubhead(sh.id); setDrawerOpen(false) }}
                                    className={`w-full text-left pl-3 pr-2 py-1.5 -ml-px border-l-2 truncate transition-colors text-[12px] ${
                                      isHere
                                        ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100 font-medium'
                                        : 'border-transparent hover:border-neutral-400 dark:hover:border-neutral-500 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                                    }`}
                                  >
                                    {sh.text}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </nav>
              </aside>
            </>
          )}

          {/* ─── CONTENT ─── */}
          <div ref={containerRef} className="min-w-0">
            {/* Mobile-only "On this page" disclosure — desktop has the
                right-side TOC pane instead. */}
            {subheads.length > 0 && (
              <details className="lg:hidden mb-4 group">
                <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 rounded-md bg-neutral-50 dark:bg-neutral-800 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
                  <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                  On this page · {subheads.length}
                </summary>
                <ul className="mt-2 ml-2 flex flex-col gap-1 text-[12px]">
                  {subheads.map((sh) => (
                    <li key={sh.id}>
                      <button
                        type="button"
                        onClick={() => goToSubhead(sh.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-left"
                      >
                        {sh.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {children}
          </div>

        </div>
      </div>
    </DocsNavCtx.Provider>
  )
}
