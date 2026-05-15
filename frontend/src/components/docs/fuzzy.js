// Tiny typo-tolerant fuzzy matcher for the docs search bar.
// No npm dep. Three-tier scoring against a `haystack` string:
//
//   1. EXACT substring          score = 1000 (highest)
//   2. SUBSEQUENCE match        score = 700 + closeness bonus
//      every query char appears in order somewhere in the haystack
//      e.g. "dtaa" → "data" (d-t-a-a in d-a-t-a-... order)
//   3. EDIT-DISTANCE ≤ 2        score = 500 - distance
//      single-word transpositions / missing chars / extra chars
//      e.g. "datta" ↔ "data" (1 edit)
//
// Anything below all three tiers scores 0 → filtered out.
// Single function `score(query, haystack)` so callers can sort matches
// by relevance. Case-insensitive throughout.

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // Two-row dynamic programming — O(a*b) time, O(min(a,b)) space.
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      )
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  return prev[b.length]
}

function subsequenceMatch(query, haystack) {
  // Walk both strings in order. Returns the index of the last matched
  // char in haystack on success, -1 otherwise. Closeness = how tightly
  // the query chars are packed in the haystack (lower last-index = better).
  let qi = 0
  let lastIdx = -1
  for (let hi = 0; hi < haystack.length && qi < query.length; hi++) {
    if (haystack.charCodeAt(hi) === query.charCodeAt(qi)) {
      lastIdx = hi
      qi++
    }
  }
  return qi === query.length ? lastIdx : -1
}

// Public: returns 0 for "no match", a positive number for a match where
// higher = more relevant.
export function score(query, haystack) {
  const q = (query || '').toLowerCase().trim()
  const h = (haystack || '').toLowerCase()
  if (!q || !h) return 0
  // 1. exact substring — also rewards earlier match positions
  const idx = h.indexOf(q)
  if (idx !== -1) return 1000 - Math.min(idx, 100)
  // 2. subsequence
  const subLast = subsequenceMatch(q, h)
  if (subLast !== -1) return 700 - Math.min(subLast - q.length, 100)
  // 3. edit distance — only useful when query length is meaningful
  // (avoid matching every 1-char query to every word in the haystack).
  if (q.length < 3) return 0
  // Tokenise haystack into rough word boundaries — running Levenshtein
  // on the whole document is too expensive AND too noisy.
  const tokens = h.split(/[^a-z0-9]+/).filter(Boolean)
  let best = Infinity
  for (const tok of tokens) {
    if (Math.abs(tok.length - q.length) > 2) continue
    const d = levenshtein(q, tok)
    if (d < best) best = d
    if (best === 0) break
  }
  if (best <= 2) return 500 - best * 100
  return 0
}

// Sort + cap helper used by the search dropdown.
export function rank(query, items, getText, maxResults = 8) {
  if (!query) return []
  const scored = []
  for (const it of items) {
    const s = score(query, getText(it))
    if (s > 0) scored.push({ item: it, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxResults).map((x) => x.item)
}

// Build a short snippet around the first match — used in the search
// dropdown to show context. Falls back to the first ~120 chars.
export function snippet(query, text, max = 120) {
  if (!query || !text) return (text || '').slice(0, max)
  const q = query.toLowerCase()
  const lower = text.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return text.slice(0, max)
  const start = Math.max(0, idx - 32)
  const end = Math.min(text.length, idx + q.length + max - 32)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}
