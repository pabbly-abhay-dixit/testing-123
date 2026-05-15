import { useRef, useEffect, useState } from 'react'
import { Copy, Check, WrapText, Search } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, placeholder as cmPlaceholder, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// Decoration-only match highlighter. Two visual tiers:
//   `pa-search-match`        — light amber on every match
//   `pa-search-match-current` — bright amber on the active match (Enter advances)
// React owns the navigation state; we ship {term, positions, currentIdx} into
// CodeMirror via a single effect and the StateField just paints decorations.
const setMatchData = StateEffect.define()
const matchMark = Decoration.mark({ class: 'pa-search-match' })
const matchMarkCurrent = Decoration.mark({ class: 'pa-search-match pa-search-match-current' })

const matchField = StateField.define({
  create() { return Decoration.none },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setMatchData)) {
        const { term, positions, currentIdx } = e.value
        if (!term || !positions?.length) return Decoration.none
        const ranges = positions.map((p, i) =>
          (i === currentIdx ? matchMarkCurrent : matchMark).range(p, p + term.length)
        )
        return Decoration.set(ranges)
      }
    }
    return decos.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

/**
 * CodeView — CodeMirror 6 powered code editor / viewer.
 *
 * Modes:
 *  - language="js"     → JavaScript syntax highlighting + line numbers (default)
 *  - language="prose"  → plain text, no gutter, no highlighting (system prompts)
 *  - language="text"   → plain text with monospace (legacy fallback)
 *
 * Props match the old API so all existing call sites work unchanged.
 */

// VS Code Dark+ syntax highlighting — every token type gets a visible color.
const vscodeDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.controlKeyword, color: '#c586c0' },
  { tag: tags.operatorKeyword, color: '#569cd6' },
  { tag: tags.definitionKeyword, color: '#569cd6' },
  { tag: tags.moduleKeyword, color: '#c586c0' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.definition(tags.variableName), color: '#9cdcfe' },
  { tag: tags.propertyName, color: '#9cdcfe' },
  { tag: tags.definition(tags.propertyName), color: '#9cdcfe' },
  { tag: tags.function(tags.variableName), color: '#dcdcaa' },
  { tag: tags.function(tags.propertyName), color: '#dcdcaa' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.special(tags.string), color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.bool, color: '#569cd6' },
  { tag: tags.null, color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.className, color: '#4ec9b0' },
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.punctuation, color: '#d4d4d4' },
  { tag: tags.paren, color: '#d4d4d4' },
  { tag: tags.brace, color: '#d4d4d4' },
  { tag: tags.squareBracket, color: '#d4d4d4' },
  { tag: tags.angleBracket, color: '#d4d4d4' },
  { tag: tags.separator, color: '#d4d4d4' },
  { tag: tags.derefOperator, color: '#d4d4d4' },
  { tag: tags.regexp, color: '#d16969' },
  { tag: tags.labelName, color: '#9cdcfe' },
  { tag: tags.self, color: '#569cd6' },
  { tag: tags.atom, color: '#569cd6' },
  { tag: tags.meta, color: '#d4d4d4' },
  { tag: tags.content, color: '#d4d4d4' },
])

// Custom dark theme — editor chrome (bg, gutters, selection, scrollbars).
const pabblyDarkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    maxHeight: 'var(--cm-max-height)',
    overflow: 'hidden',
  },
  '.cm-content': {
    padding: '16px 0 24px 0',
    caretColor: '#aeafad',
  },
  '.cm-line': {
    padding: '0 16px 0 0',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#aeafad',
  },
  // Selection: translucent blue so syntax-highlighted text stays readable
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(51, 144, 255, 0.25) !important',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(51, 144, 255, 0.15) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-gutters': {
    backgroundColor: '#1e1e1e',
    color: '#858585',
    border: 'none',
    borderRight: '1px solid #2d2d2d',
    fontSize: '11px',
    minWidth: '40px',
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 4px',
  },
  '.cm-scroller': {
    overflow: 'auto !important',
    maxHeight: 'var(--cm-max-height)',
    lineHeight: '1.5rem',
    scrollbarWidth: 'thin',
    scrollbarColor: '#4a4a4a transparent',
  },
  '.cm-placeholder': {
    color: '#6a6a6a',
    fontStyle: 'italic',
  },
  // Webkit scrollbar styling
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: '#1e1e1e',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: '#424242',
    borderRadius: '4px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: '#555555',
  },
  '.cm-scroller::-webkit-scrollbar-corner': {
    background: '#1e1e1e',
  },
  // Match highlights — translucent so the syntax-highlighted text underneath
  // stays readable. Light tint on every match, denser tint + outline for the
  // currently-selected one so the user can see where Enter just landed them.
  // No `color` override — the editor's existing token colors must come through.
  '.pa-search-match': {
    backgroundColor: 'rgba(252, 211, 77, 0.25)',
    borderRadius: '2px',
  },
  '.pa-search-match-current': {
    backgroundColor: 'rgba(245, 158, 11, 0.55)',
    outline: '1px solid rgba(245, 158, 11, 0.9)',
  },
}, { dark: true })

// Prose theme — sans-serif, no monospace, for system prompts
const proseTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
    fontSize: '13px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  '.cm-content': {
    padding: '16px 0 24px 0',
    caretColor: '#aeafad',
    lineHeight: '1.6',
  },
  '.cm-line': {
    padding: '0 16px 0 16px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#aeafad',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#264f78 !important',
  },
  '.cm-selectionBackground': {
    backgroundColor: '#264f78 !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.6',
    scrollbarWidth: 'thin',
    scrollbarColor: '#4a4a4a transparent',
  },
  '.cm-placeholder': {
    color: '#6a6a6a',
    fontStyle: 'italic',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: '#1e1e1e',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: '#424242',
    borderRadius: '4px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: '#555555',
  },
  '.cm-scroller::-webkit-scrollbar-corner': {
    background: '#1e1e1e',
  },
}, { dark: true })

export default function CodeView({
  code = '',
  language = 'js',
  editable = false,
  onChange,
  rows = 14,
  showLineNumbers = true,
  lineWrapping: lineWrappingProp = false,
  placeholder,
  ariaLabel,
  copyLabel = 'Copy code',
}) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const searchBoxRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [wrapEnabled, setWrapEnabled] = useState(() => window.innerWidth < 1024)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [matches, setMatches] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  // Bumped every time the editor view is rebuilt so the dispatch-decorations
  // effect re-runs against the fresh view (otherwise wrap toggle / prop change
  // destroys the view and search highlights silently disappear).
  const [viewBuildKey, setViewBuildKey] = useState(0)

  const isProse = language === 'prose'
  // Effective wrap: prose always wraps; otherwise use toggle or prop
  const effectiveWrap = isProse || lineWrappingProp || wrapEnabled

  useEffect(() => {
    const onResize = () => setWrapEnabled(window.innerWidth < 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Keep onChange ref current without rebuilding the editor
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Build CodeMirror instance
  useEffect(() => {
    if (!containerRef.current) return

    const extensions = [
      // Theme
      isProse ? proseTheme : pabblyDarkTheme,
      // Syntax highlighting — VS Code Dark+ colors, covers all token types
      ...(isProse ? [] : [syntaxHighlighting(vscodeDarkHighlight)]),
      // Language
      ...(language === 'js' ? [javascript()] : []),
      // Line numbers
      ...(showLineNumbers && !isProse ? [lineNumbers(), highlightActiveLineGutter()] : []),
      // Active line
      highlightActiveLine(),
      // Fallback — anything our VS Code style misses gets default colors
      ...(isProse ? [syntaxHighlighting(defaultHighlightStyle, { fallback: true })] : []),
      // Keymaps — intentionally NOT including searchKeymap so browser-native
      // Ctrl+F stays available; we drive search via our own toolbar input.
      keymap.of([...defaultKeymap, indentWithTab]),
      // Match-only highlighter (no cursor movement, no selection)
      matchField,
      // Tab size
      EditorState.tabSize.of(2),
      // Placeholder
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      // Read-only
      ...(!editable ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      // Line wrapping
      ...(effectiveWrap ? [EditorView.lineWrapping] : []),
      // Change listener
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString())
        }
      }),
    ]

    const state = EditorState.create({
      doc: code || '',
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view
    // Tell the dispatch-decorations effect to re-fire with current search state
    setViewBuildKey(k => k + 1)

    // Set aria-label
    if (ariaLabel) {
      const contentEl = containerRef.current.querySelector('.cm-content')
      if (contentEl) contentEl.setAttribute('aria-label', ariaLabel)
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Only rebuild on language/editable/rows/showLineNumbers/lineWrapping change — NOT on code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, editable, rows, showLineNumbers, lineWrappingProp, isProse, placeholder, ariaLabel, wrapEnabled])

  // Sync external code changes into the editor (without rebuilding)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code || '' },
      })
    }
  }, [code])

  // Recompute match positions when the term (or doc, on code prop change)
  // changes. Reset the active match to the first occurrence.
  useEffect(() => {
    const view = viewRef.current
    if (!view) { setMatches([]); setCurrentIdx(0); return }
    if (!searchTerm) { setMatches([]); setCurrentIdx(0); return }
    const docText = view.state.doc.toString()
    const lower = docText.toLowerCase()
    const lowerTerm = searchTerm.toLowerCase()
    const arr = []
    let pos = 0
    while ((pos = lower.indexOf(lowerTerm, pos)) !== -1) {
      arr.push(pos)
      pos += searchTerm.length || 1
    }
    setMatches(arr)
    setCurrentIdx(0)
  }, [searchTerm, code])

  // Push current state into CodeMirror — paints decorations and scrolls the
  // active match into view (no selection change, so the active-line highlight
  // doesn't kick in and tint the whole row).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const effects = [setMatchData.of({ term: searchTerm, positions: matches, currentIdx })]
    if (matches.length > 0 && matches[currentIdx] !== undefined) {
      effects.push(EditorView.scrollIntoView(matches[currentIdx], { y: 'center' }))
    }
    view.dispatch({ effects })
  }, [searchTerm, matches, currentIdx, viewBuildKey])

  const handleToggleSearch = () => {
    setSearchOpen(o => {
      const next = !o
      if (!next) setSearchTerm('')
      return next
    })
  }

  // Click-outside collapses the search input back into a button. Mousedown so
  // we react before the focus moves; checks the search box ref so clicks on
  // the input itself stay open.
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setSearchOpen(false)
        setSearchTerm('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code || ''
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const LINE_PX = isProse ? 26 : 24
  const VPAD_PX = 32
  const lineCount = Math.max(1, (code || '').split('\n').length)
  const naturalHeight = lineCount * LINE_PX + VPAD_PX
  const maxHeight = rows * LINE_PX + VPAD_PX
  const height = Math.min(naturalHeight, maxHeight)

  return (
    <div className="group relative rounded-lg border border-[#2d2d2d] bg-[#1e1e1e] overflow-hidden">
      {/* Toolbar: Wrap toggle + Copy */}
      <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {!isProse && (
          searchOpen ? (
            <div
              ref={searchBoxRef}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-primary-500 bg-[#0d1117]"
            >
              <Search size={11} className="text-primary-400 flex-shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches.length > 0) {
                    e.preventDefault()
                    // Shift+Enter = previous, Enter = next, both wrap.
                    setCurrentIdx(i => {
                      const n = matches.length
                      return e.shiftKey ? (i - 1 + n) % n : (i + 1) % n
                    })
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setSearchOpen(false)
                    setSearchTerm('')
                  }
                }}
                placeholder="Search..."
                autoFocus
                className="w-40 text-[11px] font-mono bg-transparent text-neutral-100 placeholder:text-neutral-500 focus:outline-none border-none shadow-none"
                style={{ boxShadow: 'none' }}
              />
              {searchTerm && matches.length > 0 && (
                <span className="text-[10px] text-neutral-400 tabular-nums flex-shrink-0">
                  {currentIdx + 1}/{matches.length}
                </span>
              )}
            </div>
          ) : (
            <Tooltip content="Search in code">
              <button
                type="button"
                onClick={handleToggleSearch}
                onMouseDown={(e) => e.preventDefault()}
                aria-label="Open search"
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium border transition-colors bg-[#2d2d2d]/90 hover:bg-[#484848] text-[#cccccc] hover:text-white border-[#484848]"
              >
                <Search size={11} />
                Search
              </button>
            </Tooltip>
          )
        )}
        {!isProse && (
          <Tooltip content={wrapEnabled ? 'No wrap' : 'Wrap long lines'}>
            <button
              type="button"
              onClick={() => setWrapEnabled(w => !w)}
              onMouseDown={(e) => e.preventDefault()}
              aria-label={wrapEnabled ? 'Disable word wrap' : 'Enable word wrap'}
              className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                wrapEnabled
                  ? 'bg-primary-600/80 border-primary-500 text-white'
                  : 'bg-[#2d2d2d]/90 hover:bg-[#484848] text-[#cccccc] hover:text-white border-[#484848]'
              }`}
            >
              <WrapText size={11} />
              Wrap
            </button>
          </Tooltip>
        )}
        <Tooltip content="Copy code">
          <button
            type="button"
            onClick={handleCopy}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={copyLabel}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-[#2d2d2d]/90 hover:bg-[#484848] text-[#cccccc] hover:text-white text-[10px] font-medium border border-[#484848]"
          >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </Tooltip>
      </div>

      {/* CodeMirror mount point */}
      <div
        ref={containerRef}
        className="rounded-lg"
        style={{ '--cm-max-height': `${height}px` }}
      />
    </div>
  )
}

// Keep tokenizeJS export for backward compat (used nowhere currently, but exported)
const JS_TOKEN = new RegExp(
  [
    '(`(?:\\\\.|[^\\\\`])*`|"(?:\\\\.|[^\\\\"])*"|\'(?:\\\\.|[^\\\\\'])*\')',
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '(\\b(?:if|else|for|while|return|try|catch|finally|throw|switch|case|break|continue|new|typeof|instanceof|await|async|do|in|of|yield)\\b)',
    '(\\b(?:const|let|var|function|class|extends|implements|import|export|from|as|true|false|null|undefined|this|super|void|delete|static)\\b)',
    '([A-Za-z_$][\\w$]*(?=\\s*\\())',
    '([A-Za-z_$][\\w$]*)',
    '([{}])',
    '([\\[\\]])',
    '([()])',
  ].join('|'),
  'g'
)

export function tokenizeJS(src) {
  const tokens = []
  if (!src) return tokens
  let lastIndex = 0
  const re = new RegExp(JS_TOKEN.source, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > lastIndex) tokens.push({ type: 'plain', text: src.slice(lastIndex, m.index) })
    let type = 'plain'
    if (m[1]) type = 'string'
    else if (m[2]) type = 'comment'
    else if (m[3]) type = 'number'
    else if (m[4]) type = 'controlKeyword'
    else if (m[5]) type = 'keyword'
    else if (m[6]) type = 'function'
    else if (m[7]) type = 'identifier'
    else if (m[8]) type = 'brace'
    else if (m[9]) type = 'bracket'
    else if (m[10]) type = 'paren'
    if (type === 'string') {
      let i = re.lastIndex
      while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
      if (src[i] === ':') type = 'propertyKey'
    }
    tokens.push({ type, text: m[0] })
    lastIndex = re.lastIndex
    if (m[0].length === 0) re.lastIndex++
  }
  if (lastIndex < src.length) tokens.push({ type: 'plain', text: src.slice(lastIndex) })
  return tokens
}
