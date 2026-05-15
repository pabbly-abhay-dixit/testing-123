import { createContext } from 'react'

// Per-tab navigation state. When this context is set, each <Section>
// (a) self-registers its slug + title + icon so the parent left nav
// can list them, and (b) returns null when it isn't the active
// section — implementing the "one section at a time" pattern that
// docs.stripe.com / docs.vercel.com / nextjs.org/docs use.
//
// Shape:
//   {
//     activeSlug:   string | null,         // currently-shown section
//     register:     (entry) => void,       // Section calls on mount
//     unregister:   (slug)  => void,       // Section calls on unmount
//     setActiveSlug:(slug)  => void,       // left nav click target
//   }
//
// `entry` is `{ slug, title, icon, tooltip }`.
//
// Components rendered WITHOUT this context (legacy / standalone usage)
// keep their existing behaviour: every section renders sequentially
// in one long scroll.
//
// HMR-safe singleton: createContext() returns a new instance each call,
// so a hot-reload of this module would create a fresh context and
// any already-mounted consumer would hold a stale reference. We
// stash the instance on `globalThis` so HMR reuses the same object.
const KEY = '__pabbly_docs_nav_ctx__'
export const DocsNavCtx = globalThis[KEY] || (globalThis[KEY] = createContext(null))

// Title → slug. Stable, deterministic, URL-safe — lowercase, strip
// non-alphanumerics, collapse runs of dashes.
export function slugify(title) {
  if (!title) return ''
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
