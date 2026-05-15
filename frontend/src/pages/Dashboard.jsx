import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, MoreVertical, Trash2, Pencil, Trash, FolderOpen, Settings, RotateCcw, X, Bot, Users, ChevronDown, Check, FolderInput } from 'lucide-react'
import TeamAccessModal from '../components/builder/TeamAccessModal'
import ShareComposeModal from '../components/builder/ShareComposeModal'
import { workflowsAPI, foldersAPI, deploysAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { useConfirm } from '../components/ui/ConfirmModal'
import Tooltip from '../components/ui/Tooltip'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import Pagination from '../components/ui/Pagination'
import BulkActionsBar from '../components/dashboard/BulkActionsBar'
import FolderManagementModal from '../components/dashboard/FolderManagementModal'

// Premium modal shell — Vercel/Linear style. Kept verbatim for the Create
// Workflow + Move-To-Folder modals so their interaction feel doesn't change.
// `dirty` — when true, clicking the backdrop is a no-op. Escape + the
// modal's own Cancel button still close. Use this when the modal holds
// in-progress user input (typed name, picked folder, etc.) so accidental
// off-modal clicks don't wipe the user's work. Default false preserves
// the legacy "click-anywhere-to-dismiss" behavior for modals with no
// state of their own.
const PremiumModal = ({ onClose, children, dirty = false }) => {
  const [phase, setPhase] = useState('enter')
  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => setPhase('visible'))) }, [])
  useEffect(() => { const h = (e) => { if (e.key === 'Escape') doClose() }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h) }, [])
  const doClose = () => { setPhase('exit'); setTimeout(() => onClose(), 160) }
  const onBackdropClick = () => { if (!dirty) doClose() }
  const isVisible = phase === 'visible', isExit = phase === 'exit'
  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Visual backdrop only — pointer-events disabled so the centering
          wrapper below actually receives outside-clicks. Previously this
          div was the click target but it sat BEHIND the wrapper in DOM
          order, so the click never reached it and the modal couldn't be
          dismissed by clicking outside. */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.55)', opacity: isExit ? 0 : isVisible ? 1 : 0, transition: `opacity ${isExit ? '150ms' : '200ms'}` }} />
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onBackdropClick}>
        <div className="w-full max-w-[440px]" style={{ opacity: isExit ? 0 : isVisible ? 1 : 0, transform: isExit ? 'translateY(6px) scale(0.98)' : isVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)', transition: isExit ? 'all 150ms ease-in' : 'all 260ms cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={e => e.stopPropagation()}>
          <div className="relative rounded-xl bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 overflow-hidden min-h-[200px] flex flex-col" style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)' }}>
            <div className="relative z-10 px-6 py-6 flex-1 flex flex-col">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Capitalize the first character of a string. Used for the workflow Name
// column so titles always render with a leading uppercase letter regardless
// of what the user typed when creating the workflow.
const capitalizeFirst = (s) => {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Cap workflow name length so the row + tooltip stay readable. Legacy
// workflows created before this cap may still exceed it; the tooltip
// clamps long content separately for display safety.
const WORKFLOW_NAME_MAX = 80
const TOOLTIP_NAME_CLAMP = 200
const clampForTooltip = (s) => {
  if (!s) return s
  return s.length > TOOLTIP_NAME_CLAMP ? s.slice(0, TOOLTIP_NAME_CLAMP) + '…' : s
}

// Compact date — "27 Apr 2026" (day month year). Always shows year so
// rows from past years aren't ambiguous with current-year ones at a glance.
const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Verbose date used in hover tooltips — "Monday, 27 April 2026 at 14:35:22".
// Gives the full weekday + spelled-out month + 24h time so users can tell
// stale rows from fresh ones without reading the cell value.
const formatDateLong = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date} at ${time}`
}

// Two-line tooltip content — primary action / instruction on top in
// solid white, then a softer description below explaining what the
// thing is used for. Reads as "do this → here's why" so the user gets
// the call-to-action first, then the context.
const tipLines = (action, description) => (
  <div className="leading-snug">
    <div className="text-white">{action}</div>
    {description && <div className="text-neutral-300 mt-1">{description}</div>}
  </div>
)

// PPM-style status pill — flat color background with leading dot.
// Maps the agent.status enum (active / ready / draft / failed / etc.) to
// PPM's blue/green/gray/red palette.
const STATUS_META = {
  active: { label: 'Active', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  deployed: { label: 'Active', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  ready: { label: 'Inactive', bg: 'bg-gray-100 dark:bg-neutral-700', text: 'text-gray-700 dark:text-neutral-300', dot: 'bg-gray-400' },
  draft: { label: 'Draft', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  planning: { label: 'Planning', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  compiled: { label: 'Compiled', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  trashed: { label: 'Trashed', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-300', dot: 'bg-red-400' },
}

// Status pill — clickable inline dropdown to toggle Active ↔ Inactive
// for already-deployed workflows. Read-only static pill for Draft / Failed
// workflows since their status is system-managed (Draft = never deployed,
// Failed = last deploy errored). Going from Draft → Active requires an
// actual deploy via the workflow builder, not a status flip, so we don't
// let users set status to those states from the dashboard.
const StatusPill = ({ status, onChange, disabled }) => {
  const s = STATUS_META[status] || STATUS_META.draft
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const popupRef = useRef(null)

  // Close on outside click via document listener (PPM pattern). Avoids the
  // fixed inset-0 overlay approach which blocks page scroll while open.
  useEffect(() => {
    if (!open) return
    const handleDocClick = (e) => {
      if (popupRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    // Also close if user scrolls anywhere on the page — the dropdown is
    // fixed-positioned so it would detach from the trigger on scroll.
    const handleScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleDocClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleDocClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  const isActive = status === 'active' || status === 'deployed'
  const isInactive = status === 'ready'
  // Only deployed workflows (Active or Inactive) get a clickable dropdown.
  // Draft / Failed / others are static — backend status semantics don't
  // allow user-driven transitions out of those states.
  const isToggleable = !disabled && (isActive || isInactive)
  const options = [
    { value: 'active', label: 'Active', meta: STATUS_META.active },
    { value: 'ready', label: 'Inactive', meta: STATUS_META.ready },
  ]

  const handleToggle = (e) => {
    e.stopPropagation()
    if (!isToggleable) return
    if (open) { setOpen(false); return }
    const r = e.currentTarget.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,
      left: r.left,
      triggerTop: r.top,
    })
    setOpen(true)
  }

  const handlePick = (e, value) => {
    e.stopPropagation()
    setOpen(false)
    if (value === 'active' && !isActive) onChange?.('active')
    else if (value === 'ready' && isActive) onChange?.('ready')
  }

  return (
    <>
      <Tooltip
        content={!isToggleable ? (status === 'draft' ? 'Deploy from the workflow builder to activate' : status === 'failed' ? 'Last deploy failed — open the workflow to retry' : '') : ''}
        delay={300}
      >
        <button
          ref={btnRef}
          type="button"
          onClick={handleToggle}
          disabled={!isToggleable}
          className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium pl-2 pr-2 sm:pr-3 py-1 rounded-full transition-colors ${s.bg} ${s.text} ${isToggleable ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
          {s.label}
          {isToggleable && <ChevronDown size={14} className="opacity-70 ml-0.5" />}
        </button>
      </Tooltip>
      {open && pos && createPortal(
        <div
          ref={popupRef}
          className="fixed w-36 rounded-lg border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999] overflow-hidden bg-white dark:bg-neutral-800"
          style={(() => {
            const menuH = 88
            const wouldOverflow = pos.top + menuH > window.innerHeight - 8
            const top = wouldOverflow ? pos.triggerTop - menuH - 4 : pos.top
            return {
              top: `${Math.max(8, top)}px`,
              left: `${Math.max(8, Math.min(pos.left, window.innerWidth - 152))}px`,
            }
          })()}
          onClick={(e) => e.stopPropagation()}
        >
            {options.map((opt) => {
              const selected = (opt.value === 'active' && isActive) || (opt.value === 'ready' && !isActive)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => handlePick(e, opt.value)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${selected ? 'bg-gray-50 dark:bg-neutral-700/50 text-gray-900 dark:text-neutral-100' : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${opt.meta.dot}`} />
                  <span className="flex-1 text-left">{opt.label}</span>
                  {selected && <Check size={14} className="text-blue-600" />}
                </button>
              )
            })}
        </div>,
        document.body
      )}
    </>
  )
}

// Inline checkbox — matches PPM table-row checkbox style. Kept inline (not
// extracted) since it's only used in two places and PPM does the same.
const RowCheckbox = ({ checked, indeterminate, onChange }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onChange?.() }}
    className={`w-[16px] h-[16px] rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
      checked
        ? 'bg-blue-600 border-blue-600'
        : indeterminate
        ? 'bg-blue-600 border-blue-600'
        : 'bg-white dark:bg-neutral-900 border-gray-300 dark:border-neutral-500 hover:border-gray-400'
    }`}
  >
    {checked && (
      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )}
    {indeterminate && !checked && <div className="w-2 h-[2px] bg-white rounded-full" />}
  </button>
)

// Always-visible sort affordance on column headers — faded chevron when
// the column isn't the active sort key, prominent up/down chevron when
// it is. Lets users see at-a-glance which columns are sortable instead
// of having to hover.
const SortIndicator = ({ active, dir }) => {
  if (active) {
    return (
      <svg className="w-3 h-3 ml-1 inline-block text-gray-700 dark:text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        {dir === 'asc'
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
      </svg>
    )
  }
  // Inactive — show stacked up/down chevrons so users know the column
  // is sortable but no current direction is set.
  return (
    <svg className="w-3 h-3 ml-1 inline-block text-gray-400 dark:text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  )
}

const Dashboard = () => {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Folder state ──
  const [folders, setFolders] = useState([])
  const [loadingFolders, setLoadingFolders] = useState(true)
  const [homeCount, setHomeCount] = useState(0)
  const [trashCount, setTrashCount] = useState(0)
  const [pinnedFolders, setPinnedFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pinnedFolders') || '[]') } catch { return [] }
  })
  const [folderTeamAccessFor, setFolderTeamAccessFor] = useState(null)
  const [showManageFolders, setShowManageFolders] = useState(false)
  // Create-folder modal state — opened from the folder filter footer.
  // Mirrors the Create Workflow modal pattern (PremiumModal + name input).
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  // Per-row 3-dot menu in the folder dropdown — { folderId, top, left }.
  const [folderRowMenuFor, setFolderRowMenuFor] = useState(null)

  // ── Filters (multi-select shape: { include: [], exclude: [] }) ──
  // Trash is folded into the Folder filter as a virtual entry — when the
  // user picks Trash from the folder dropdown, isTrash (derived below)
  // becomes true and the table swaps to trashed-only view. Default
  // behavior: trash hidden until user explicitly picks it.
  const [searchTerm, setSearchTerm] = useState('')
  const [folderFilter, setFolderFilter] = useState({ include: [], exclude: [] }) // empty = active workflows only
  const [statusFilter, setStatusFilter] = useState({ include: [], exclude: [] })

  // ── Sort ──
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('dashboard_sortBy') || 'updated_at')
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('dashboard_sortDir') || 'desc')
  useEffect(() => { localStorage.setItem('dashboard_sortBy', sortBy) }, [sortBy])
  useEffect(() => { localStorage.setItem('dashboard_sortDir', sortDir) }, [sortDir])

  // ── Pagination ──
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('dashboard_pageSize')) || 25)
  const [currentPage, setCurrentPage] = useState(1)
  useEffect(() => { localStorage.setItem('dashboard_pageSize', String(pageSize)) }, [pageSize])

  // ── Agents ──
  // Both lists fetched once on mount, then merged client-side via the
  // folder filter (Trash is one of the filter options). Avoids
  // re-fetching when user picks Trash from the dropdown — only a
  // refresh or mutation triggers a new API call.
  const [activeAgents, setActiveAgents] = useState([])
  const [trashedAgents, setTrashedAgents] = useState([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [togglingAgentId, setTogglingAgentId] = useState(null)
  // `allAgents` retained as an alias for the merged source counts shown
  // in the page subtitle; actual filtering uses `allWorkflows` below.
  const allAgents = activeAgents

  // ── Selection ──
  const [selectedAgents, setSelectedAgents] = useState(new Set())
  // In-flight bulk action key ('activate'|'deactivate'|'delete'|'permanent_delete'|'restore'|null).
  // Drives spinner + disabled state on BulkActionsBar — bulk activate/deactivate
  // now does N sequential PF toggle calls so a multi-row selection can take
  // several seconds; without this affordance the UI looked frozen.
  const [bulkLoading, setBulkLoading] = useState(null)

  // ── Modals ──
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentFolderId, setNewAgentFolderId] = useState('')
  const [creating, setCreating] = useState(false)
  const [nameError, setNameError] = useState('')
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveFolderId, setMoveFolderId] = useState('')

  // "Dirty" signals — flipped to true only when the USER interacts with
  // an input inside the modal. Programmatic pre-fills (e.g. Create
  // Workflow inheriting the active folder filter) do NOT mark the
  // modal dirty. Reset to false whenever the modal closes so the next
  // open starts from a fresh "not dirty" state.
  const [createTouched, setCreateTouched] = useState(false)
  const [moveTouched, setMoveTouched] = useState(false)
  const [createFolderTouched, setCreateFolderTouched] = useState(false)
  // For row-level Move (single workflow). When set, the Move modal
  // commits via handleSingleMove instead of the bulk handler.
  const [moveSingleAgentId, setMoveSingleAgentId] = useState(null)
  // Row-level Team Access — opens TeamAccessModal for a single agent
  // (collaborator management, not public share link).
  const [teamAccessAgent, setTeamAccessAgent] = useState(null)
  // Bulk Team Access — opens ShareComposeModal pre-loaded with the
  // currently-selected workflow ids when 2+ rows are selected.
  const [bulkTeamAccessIds, setBulkTeamAccessIds] = useState(null)

  // Auto-open Create modal from ?create=1 (preserves Cmd+click → new tab UX)
  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setShowCreateModal(true)
      const next = new URLSearchParams(searchParams)
      next.delete('create')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Reset the touched flag every time a modal closes so the next open
  // starts in a clean state. Reset on close (not on open) so a brand-
  // new mount doesn't reset before the modal has a chance to render.
  useEffect(() => { if (!showCreateModal) setCreateTouched(false) }, [showCreateModal])
  useEffect(() => { if (!showMoveModal) setMoveTouched(false) }, [showMoveModal])
  useEffect(() => { if (!showCreateFolderModal) setCreateFolderTouched(false) }, [showCreateFolderModal])

  // Per-row action menu (three-dot) — fixed-position to escape table clipping
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const rowMenuRef = useRef(null)

  // Close the row action menu on outside click + on scroll. Avoids the
  // fixed-inset overlay which would block page scrolling while open.
  // Ignores clicks on any 3-dot trigger button (data-action-trigger=
  // "row-menu") so the button's onClick can still toggle: clicking the
  // same trigger again closes the menu, clicking a different row's
  // trigger opens that row's menu instead.
  useEffect(() => {
    if (!menuOpenFor) return
    const handleDocClick = (e) => {
      if (rowMenuRef.current?.contains(e.target)) return
      if (e.target.closest('[data-action-trigger="row-menu"]')) return
      setMenuOpenFor(null)
    }
    const handleScroll = () => setMenuOpenFor(null)
    document.addEventListener('mousedown', handleDocClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleDocClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [menuOpenFor])

  // ── Fetch ──
  // Folder list is filtered to only this user's owned folders too.
  // Folders shared to me as a collaborator are excluded — they live on
  // the dedicated /shared surface. Same rule as the agent fetch above.
  // `silent: true` keeps the skeleton state untouched — used by mutation
  // refreshes (bulk activate / move / etc.) so the existing rows stay
  // visible while data updates in the background.
  const fetchFolders = useCallback(async ({ silent = false } = {}) => {
    try {
      const res = await foldersAPI.getAll()
      const myId = user?.id ? String(user.id) : null
      const all = res.data.folders || []
      const owned = myId
        ? all.filter(f => !f.user_id || String(f.user_id) === myId)
        : all
      setFolders(owned)
      setHomeCount(res.data.home_count || 0)
      setTrashCount(res.data.trash_count || 0)
    } catch { /* ignore */ }
    finally { if (!silent) setLoadingFolders(false) }
  }, [user?.id])

  // Fetch both the active list and the trashed list in parallel. Stable
  // identity (no deps) so it doesn't refire when user toggles trash mode.
  // Re-runs only on explicit mutations (create / delete / restore / etc.)
  // via the existing fetchAgents() call sites.
  //
  // Filters out shared workflows — the dashboard only shows what THIS
  // user created (workflows where `user_id === user.id`). Workflows
  // shared TO me as a collaborator come back from the API too because
  // the backend includes them via the `collaborators.user_id` $or
  // branch — but the dashboard intentionally hides them. They're
  // available on the dedicated /shared page instead.
  // `silent: true` skips the skeleton flash — used by mutation refreshes
  // (bulk activate/deactivate, move, delete, restore) so the table rows
  // stay rendered with their existing data while the new payload arrives.
  // Without this, every bulk action made the whole table flash to a
  // skeleton for ~300ms which felt jankier than the action itself.
  const fetchAgents = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingAgents(true)
    try {
      // Slim dashboard endpoint — drops 11 unused fields per row, cuts
       // response size ~50% vs. the general LIST. Envelope key is
       // `workflows`, not `agents`.
      const [activeRes, trashedRes] = await Promise.all([
        workflowsAPI.getDashboard({}),
        workflowsAPI.getDashboard({ trashed: true }),
      ])
      const myId = user?.id ? String(user.id) : null
      const ownedOnly = (list) => myId
        ? (list || []).filter(a => String(a.user_id) === myId)
        : (list || [])
      setActiveAgents(ownedOnly(activeRes.data.workflows))
      setTrashedAgents(ownedOnly(trashedRes.data.workflows))
    } catch {
      if (!silent) {
        setActiveAgents([])
        setTrashedAgents([])
      }
    } finally {
      if (!silent) setLoadingAgents(false)
    }
  }, [user?.id])

  useEffect(() => { fetchFolders() }, [fetchFolders])
  useEffect(() => { fetchAgents() }, [fetchAgents])

  // Derived trash mode — true when the user has picked the Trash
  // virtual folder from the Folder filter dropdown. Drives status pill
  // disable, empty-state CTAs, bulk-action set, and the right-side
  // Empty-Trash button.
  const isTrash = (folderFilter.include || []).includes('__trash__')

  // Clear selection + reset pagination when the folder filter changes
  // (which now drives mode switches between active / trash views).
  useEffect(() => { setSelectedAgents(new Set()); setCurrentPage(1) }, [folderFilter])
  useEffect(() => { setCurrentPage(1) }, [searchTerm, statusFilter])

  // When the Create Workflow modal opens, pre-select a folder if the user
  // is currently filtering to exactly one real folder (sidebar context).
  // Otherwise default to '' (Home). Trash/Home pseudo-ids are excluded.
  useEffect(() => {
    if (!showCreateModal) return
    const inc = (folderFilter.include || []).filter(id => id && id !== '__trash__' && id !== '__home__')
    setNewAgentFolderId(inc.length === 1 ? inc[0] : '')
  }, [showCreateModal])

  // ── Folder helpers ──
  const folderById = useMemo(() => {
    const m = new Map()
    folders.forEach(f => m.set(f.id, f))
    return m
  }, [folders])

  const folderName = useCallback((id) => {
    if (!id) return 'Home'
    return folderById.get(id)?.name || '—'
  }, [folderById])

  const getFolderDepth = useCallback((id) => {
    let d = 0
    let cur = folderById.get(id)
    while (cur?.parent_id) { d++; cur = folderById.get(cur.parent_id) }
    return d
  }, [folderById])

  // ── Filter + sort + paginate ──
  // Folder filter empty → only active workflows (trash hidden by default).
  // Sentinel values: '__home__' for workflows with no folder, '__trash__'
  // for trashed workflows treated as a virtual folder.
  const HOME_SENTINEL = '__home__'
  const TRASH_SENTINEL = '__trash__'

  // Combine active + trashed into a single source list. Trashed agents
  // get a `_virtualFolder` set to TRASH_SENTINEL so the folder-filter
  // pipeline can treat the trash as just another folder option.
  const allWorkflows = useMemo(() => [
    ...activeAgents,
    ...trashedAgents.map(a => ({ ...a, _virtualFolder: TRASH_SENTINEL })),
  ], [activeAgents, trashedAgents])

  const filteredAgents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const folderInc = new Set(folderFilter.include || [])
    const folderExc = new Set(folderFilter.exclude || [])
    const statusInc = new Set(statusFilter.include || [])
    const statusExc = new Set(statusFilter.exclude || [])
    const folderActive = folderInc.size > 0 || folderExc.size > 0
    const statusActive = statusInc.size > 0 || statusExc.size > 0

    return allWorkflows.filter(a => {
      // Default: hide trashed workflows when no folder filter is active.
      // User must explicitly pick "Trash" in the folder dropdown to see them.
      if (!folderActive && a.is_trashed) return false

      if (q) {
        const name = (a.name || '').toLowerCase()
        const slug = (a.slug || '').toLowerCase()
        if (!name.includes(q) && !slug.includes(q)) return false
      }
      if (folderActive) {
        const fkey = a._virtualFolder || a.folder_id || HOME_SENTINEL
        if (folderInc.size > 0 && !folderInc.has(fkey)) return false
        if (folderExc.has(fkey)) return false
      }
      if (statusActive) {
        const s = a.status || 'draft'
        if (statusInc.size > 0 && !statusInc.has(s)) return false
        if (statusExc.has(s)) return false
      }
      return true
    })
  }, [allWorkflows, searchTerm, folderFilter, statusFilter])

  const sortedAgents = useMemo(() => {
    const arr = [...filteredAgents]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = (a.name || '').localeCompare(b.name || '')
      else if (sortBy === 'status') cmp = (a.status || '').localeCompare(b.status || '')
      else if (sortBy === 'folder') cmp = folderName(a.folder_id).localeCompare(folderName(b.folder_id))
      else if (sortBy === 'created_at') cmp = new Date(a.created_at) - new Date(b.created_at)
      else cmp = new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at)
      return sortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [filteredAgents, sortBy, sortDir, folderName])

  const totalPages = Math.max(1, Math.ceil(sortedAgents.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const pagedAgents = useMemo(() =>
    sortedAgents.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedAgents, safePage, pageSize]
  )

  // ── Sort toggling ──
  const handleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  // ── Selection ──
  const toggleSelect = (id) => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAllOnPage = () => {
    setSelectedAgents(prev => {
      const allSelected = pagedAgents.every(a => prev.has(a.id))
      const next = new Set(prev)
      if (allSelected) pagedAgents.forEach(a => next.delete(a.id))
      else pagedAgents.forEach(a => next.add(a.id))
      return next
    })
  }
  const selectionStateOnPage = useMemo(() => {
    if (pagedAgents.length === 0) return 'none'
    const selectedOnPage = pagedAgents.filter(a => selectedAgents.has(a.id)).length
    if (selectedOnPage === 0) return 'none'
    if (selectedOnPage === pagedAgents.length) return 'all'
    return 'partial'
  }, [pagedAgents, selectedAgents])

  // ── Agent actions ──
  const handleCreate = async () => {
    if (!newAgentName.trim()) { setNameError('Workflow name is required'); return }
    setCreating(true)
    try {
      const data = {
        name: newAgentName.trim(),
        ...(newAgentFolderId ? { folder_id: newAgentFolderId } : {}),
      }
      const res = await workflowsAPI.create(data)
      setShowCreateModal(false); setNewAgentName(''); setNewAgentFolderId('')
      fetchFolders({ silent: true }); fetchAgents({ silent: true })
      toast.success('Workflow created!')
      navigate(`/workflows/${res.data.slug || res.data.id}`)
    } catch (error) {
      // Backend returns { error: <code>, code: <code>, message: <human> }.
      // Prefer the human message so users don't see "workflow_limit_reached".
      const body = error.response?.data
      toast.error(body?.message || body?.error || 'Failed to create workflow')
    }
    finally { setCreating(false) }
  }

  const handleDelete = async (e, agentId) => {
    e.stopPropagation(); setMenuOpenFor(null)
    // Look up the row in BOTH lists so the confirm dialog shows the
    // correct copy (Trash vs Permanently Delete) regardless of which
    // folder filter is active.
    const inTrash = trashedAgents.some(a => a.id === agentId)
    await confirm(inTrash ? {
      title: 'Permanently Delete Workflow?',
      message: 'This workflow will be permanently deleted, and its deployed function on Pabbly Functions will also be removed. This action cannot be undone.',
      confirmLabel: 'Delete Permanently',
      danger: true,
      action: async () => {
        try { await deploysAPI.delete(agentId) } catch { /* not deployed */ }
        try {
          await workflowsAPI.permanentDelete(agentId)
          toast.success('Workflow permanently deleted')
          fetchFolders({ silent: true }); fetchAgents({ silent: true })
        } catch (err) {
          toast.error('Failed to delete')
          throw err // keep modal open so user can retry
        }
      },
    } : {
      title: 'Move to Trash?',
      message: 'This workflow will be moved to the trash. You can restore it later. The deployed function on Pabbly Functions stays intact, so restoring + reactivating reuses the same webhook URL.',
      confirmLabel: 'Move to Trash',
      danger: true,
      action: async () => {
        try {
          await workflowsAPI.delete(agentId)
          toast.success('Workflow moved to trash')
          fetchFolders({ silent: true }); fetchAgents({ silent: true })
        } catch (err) {
          toast.error('Failed to delete')
          throw err
        }
      },
    })
  }

  const handleRestore = async (e, agentId) => {
    e.stopPropagation(); setMenuOpenFor(null)
    try { await workflowsAPI.restore(agentId); toast.success('Workflow restored'); fetchFolders({ silent: true }); fetchAgents({ silent: true }) }
    catch { toast.error('Failed to restore') }
  }

  const handleEmptyTrash = async () => {
    await confirm({
      title: 'Empty Trash?',
      message: `This will permanently delete all ${trashCount} trashed workflow(s). This action cannot be undone.`,
      confirmLabel: 'Empty Trash',
      danger: true,
      action: async () => {
        try {
          await workflowsAPI.emptyTrash()
          toast.success('Trash emptied')
          fetchFolders({ silent: true }); fetchAgents({ silent: true })
        } catch (err) {
          toast.error('Failed to empty trash')
          throw err
        }
      },
    })
  }

  const handleRenameAgent = async (e, agent) => {
    e.stopPropagation(); setMenuOpenFor(null)
    await confirm({
      title: 'Rename Workflow',
      message: 'Enter a new name for this workflow.',
      input: true,
      inputDefault: agent.name,
      inputPlaceholder: 'Enter workflow name',
      inputMaxLength: WORKFLOW_NAME_MAX,
      confirmLabel: 'Rename',
      // Keep the modal open with a spinner until the API call settles;
      // matches the Create Workflow modal's behavior.
      action: async (newName) => {
        try {
          await workflowsAPI.update(agent.id, { name: newName })
          fetchAgents({ silent: true })
          toast.success('Workflow renamed')
        } catch (err) {
          const body = err.response?.data
          toast.error(body?.message || body?.error || 'Failed to rename')
          throw err
        }
      },
    })
  }

  const handleToggleActive = async (e, agent) => {
    e.stopPropagation(); setMenuOpenFor(null)
    const isActive = agent.status === 'active' || agent.status === 'deployed'
    setTogglingAgentId(agent.id)
    try {
      await workflowsAPI.update(agent.id, { status: isActive ? 'ready' : 'active' })
      fetchAgents({ silent: true })
      toast.success(isActive ? 'Workflow deactivated' : 'Workflow activated')
    } catch { toast.error('Failed to update') }
    finally { setTogglingAgentId(null) }
  }

  // ── Bulk actions ──
  const handleBulkAction = async (action) => {
    if (action === 'move') {
      // Bulk move — clear single-row state so handleBulkMove uses the
      // selection set, not a single agent.
      setMoveSingleAgentId(null)
      setMoveFolderId('')
      setShowMoveModal(true)
      return
    }
    if (action === 'team_access') {
      const ids = [...selectedAgents]
      if (ids.length === 0) return
      if (ids.length === 1) {
        const agent = activeAgents.find(a => a.id === ids[0]) || trashedAgents.find(a => a.id === ids[0])
        if (agent) setTeamAccessAgent(agent)
      } else {
        // Multi-select → ShareComposeModal handles the bulk invite, fanning
        // out add-collaborator calls per (workflow, email) pair.
        setBulkTeamAccessIds(ids)
      }
      return
    }
    const ids = [...selectedAgents]
    if (action === 'delete') {
      await confirm({
        title: `Move ${ids.length} Workflow(s) to Trash?`,
        message: 'Selected workflows will be moved to the trash.',
        confirmLabel: 'Move to Trash',
        danger: true,
        action: async () => {
          setBulkLoading('delete')
          try {
            await workflowsAPI.bulkAction({ agent_ids: ids, action })
            toast.success(`${ids.length} workflow(s) moved to trash`)
            setSelectedAgents(new Set())
            fetchFolders({ silent: true }); fetchAgents({ silent: true })
          } catch (err) {
            toast.error('Failed to delete workflows')
            throw err
          } finally { setBulkLoading(null) }
        },
      })
      return
    }
    if (action === 'permanent_delete') {
      await confirm({
        title: `Permanently Delete ${ids.length} Workflow(s)?`,
        message: 'This will permanently delete the selected workflows, their chat history, steps, and files. This action cannot be undone.',
        confirmLabel: 'Delete Permanently',
        danger: true,
        action: async () => {
          setBulkLoading('permanent_delete')
          try {
            await workflowsAPI.bulkAction({ agent_ids: ids, action })
            toast.success(`${ids.length} workflow(s) permanently deleted`)
            setSelectedAgents(new Set())
            fetchFolders({ silent: true }); fetchAgents({ silent: true })
          } catch (err) {
            toast.error('Failed to permanently delete workflows')
            throw err
          } finally { setBulkLoading(null) }
        },
      })
      return
    }
    if (action === 'restore') {
      setBulkLoading('restore')
      try {
        await workflowsAPI.bulkAction({ agent_ids: ids, action })
        toast.success(`${ids.length} workflow(s) restored`)
        setSelectedAgents(new Set())
        fetchFolders({ silent: true }); fetchAgents({ silent: true })
      } catch { toast.error('Failed to restore workflows') }
      finally { setBulkLoading(null) }
      return
    }
    const label = action === 'activate' ? 'Activated' : 'Deactivated'
    setBulkLoading(action)
    try {
      await workflowsAPI.bulkAction({ agent_ids: ids, action })
      toast.success(`${ids.length} workflow(s) ${label.toLowerCase()}`)
      setSelectedAgents(new Set())
      fetchFolders({ silent: true }); fetchAgents({ silent: true })
    } catch { toast.error(`Failed to ${action} workflows`) }
    finally { setBulkLoading(null) }
  }

  // Single-row Move from the 3-dot menu — opens the same modal but
  // commits to one agent instead of the bulk selection set.
  const handleRowMove = (e, agent) => {
    e.stopPropagation(); setMenuOpenFor(null)
    setMoveSingleAgentId(agent.id)
    setMoveFolderId('')
    setShowMoveModal(true)
  }

  // Single-row Team Access — opens collaborator management for one agent.
  const handleRowTeamAccess = (e, agent) => {
    e.stopPropagation(); setMenuOpenFor(null)
    setTeamAccessAgent(agent)
  }

  const handleBulkMove = async () => {
    // Branch: row-level move (single agent) vs bulk move (selection).
    if (moveSingleAgentId) {
      try {
        await workflowsAPI.bulkAction({ agent_ids: [moveSingleAgentId], action: 'move', folder_id: moveFolderId || 'home' })
        toast.success('Workflow moved')
        setShowMoveModal(false)
        setMoveSingleAgentId(null)
        fetchFolders({ silent: true }); fetchAgents({ silent: true })
      } catch { toast.error('Failed to move workflow') }
      return
    }
    const ids = [...selectedAgents]
    try {
      await workflowsAPI.bulkAction({ agent_ids: ids, action: 'move', folder_id: moveFolderId || 'home' })
      toast.success(`${ids.length} workflow(s) moved`)
      setSelectedAgents(new Set())
      setShowMoveModal(false)
      fetchFolders({ silent: true }); fetchAgents({ silent: true })
    } catch { toast.error('Failed to move workflows') }
  }

  // ── Folder CRUD (delegated to FolderManagementModal) ──
  const handleCreateFolder = async (name, parentId) => {
    try {
      await foldersAPI.create({ name, parent_id: parentId })
      fetchFolders({ silent: true })
      toast.success('Folder created')
    } catch { toast.error('Failed to create folder') }
  }

  const handleRenameFolder = async (folderId, currentName) => {
    const name = await confirm({ title: 'Rename Folder', message: 'Enter a new name for this folder.', input: true, inputDefault: currentName || '', inputPlaceholder: 'Enter folder name', confirmLabel: 'Rename' })
    if (!name) return
    try {
      await foldersAPI.update(folderId, { name })
      fetchFolders({ silent: true })
      toast.success('Folder renamed')
    } catch { toast.error('Failed to rename folder') }
  }

  const handleDeleteFolder = async (folderId) => {
    const folder = folders.find(f => f.id === folderId)
    const name = folder?.name || 'this folder'
    const count = folder?.agent_count || 0
    const ok = await confirm({
      title: `Delete "${name}"?`,
      message: count > 0 ? `${count} workflow(s) inside will be moved to Home.` : 'This folder will be permanently deleted.',
      confirmLabel: 'Delete Folder',
      danger: true,
    })
    if (!ok) return
    try {
      await foldersAPI.delete(folderId)
      fetchFolders({ silent: true }); fetchAgents({ silent: true })
      toast.success(`Folder "${name}" deleted.${count > 0 ? ` ${count} workflow(s) moved to Home.` : ''}`)
    } catch { toast.error('Failed to delete folder') }
  }

  const handlePinFolder = (folderId) => {
    setPinnedFolders(prev => {
      const next = prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]
      localStorage.setItem('pinnedFolders', JSON.stringify(next))
      return next
    })
  }

  // ── Folder filter options ──
  // Single-layer only: nested folders hidden from filter to keep the folder
  // list flat. Subfolders, if any legacy ones exist, are filtered out so the
  // filter shows only top-level folders + the Home sentinel + Trash entry.
  const folderOptions = useMemo(() => {
    // Layout: Home pinned at the top, then a SCROLLABLE middle list of
    // real folders (max ~5 visible), then Trash pinned at the bottom.
    // `_pinTop` / `_pinBottom` keep Home and Trash visible regardless of
    // how many folders the user has — `MultiSearchableSelect` renders
    // pinned rows OUTSIDE the scroll area.
    const realFolders = folders.filter(f => !f.parent_id).map((f) => ({
      value: f.id,
      label: f.name,
    }))
    return [
      { value: HOME_SENTINEL, label: 'Home', _pinTop: true },
      ...realFolders,
      {
        value: TRASH_SENTINEL,
        label: trashedAgents.length > 0 ? `Trash (${trashedAgents.length})` : 'Trash',
        _pinBottom: true,
        _dividerBefore: true,
      },
    ]
  }, [folders, trashedAgents.length])

  // Status filter — `failed` removed because the backend never sets
  // agent.status to "failed" anywhere in the codebase. Only Active /
  // Inactive / Draft are real statuses a user can encounter.
  const statusOptions = useMemo(() => [
    { value: 'active', label: 'Active', color: '#10B981' },
    { value: 'ready', label: 'Inactive', color: '#A8A29E' },
    { value: 'draft', label: 'Draft', color: '#3B82F6' },
  ], [])

  const hasActiveFilters =
    !!searchTerm ||
    (folderFilter.include?.length || 0) > 0 ||
    (folderFilter.exclude?.length || 0) > 0 ||
    (statusFilter.include?.length || 0) > 0 ||
    (statusFilter.exclude?.length || 0) > 0

  const clearFilters = () => {
    setSearchTerm('')
    setFolderFilter({ include: [], exclude: [] })
    setStatusFilter({ include: [], exclude: [] })
  }

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900 leading-normal">
      {/* Responsive padding:
          - Mobile (< 640px): symmetric `p-3` (12px) — tight layout.
          - Desktop (sm+): `pl-6 pr-6 py-6` — heading + filter card +
            table all left-aligned at x = sidebar + 24px, matching the
            TopBar workflow-switcher button's outer left edge (TopBar
            uses px-6 = 24px). Works in both collapsed and expanded
            sidebar modes since TopBar shares the same horizontal anchor. */}
      <div className="p-3 sm:p-6 overflow-x-hidden">

        {/* Page header — title on the left, Create Workflow on the right,
            ALL screen sizes (mobile included). Title and CTA share the
            same row. */}
        <div className="flex flex-row items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="min-w-0">
            <div className="block">
              <Tooltip content={tipLines('All workflows in your account')} delay={300} position="bottom">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 cursor-default">My Workflows</h1>
              </Tooltip>
            </div>
            <div className="block mt-0.5 sm:mt-1">
              <Tooltip content={tipLines(isTrash ? 'Total workflows currently in the trash' : 'Total number of workflows you have')} delay={300} position="bottom">
                <p className="text-gray-600 dark:text-neutral-400 text-sm sm:text-base cursor-default">
                  {loadingAgents ? ' ' : `${allAgents.length} Workflow${allAgents.length === 1 ? '' : 's'}`}
                </p>
              </Tooltip>
            </div>
          </div>
          {/* Right-side action button — always Create Workflow on every
              screen size (sits on the same row as the page title). */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <Tooltip content={tipLines('Create a new workflow from scratch')} delay={300} position="bottom">
              <Link
                to="/dashboard?create=1"
                className="bg-blue-600 text-white px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Plus size={14} /> Create Workflow
              </Link>
            </Tooltip>
          </div>
        </div>

        {/* Filter bar — search + folder + status + manage folders */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-4 sm:mb-6">
          {/* Mobile: 2-column grid — Search spans both cols (full row),
              Folder + Status share the next row 50/50. Desktop (sm+):
              switches to a flex-wrap row with the original min-widths. */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
            {/* Search — full width on mobile (col-span-2), fixed range
                on desktop matching PPM. */}
            <div className="col-span-2 sm:col-span-1 sm:min-w-[180px] sm:max-w-[240px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or slug..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X size={14} className="text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            <div className="sm:min-w-[140px]">
              <MultiSearchableSelect
                label="Folder"
                multi
                usePortal
                value={folderFilter}
                onChange={setFolderFilter}
                options={folderOptions}
                placeholder="All Folders"
                searchPlaceholder="Search folders…"
                renderOption={(opt) => {
                  // Home / Trash are NOT folders — they're virtual buckets.
                  // Style them apart from the real folder list so the user
                  // reads "no-folder workflows" and "trashed workflows" as
                  // distinct concepts. Trash gets red text to signal that
                  // it's a destructive zone.
                  if (opt.value === TRASH_SENTINEL) {
                    return (
                      <span className="truncate block text-red-600 dark:text-red-400">
                        {opt.label}
                      </span>
                    )
                  }
                  if (opt.value === HOME_SENTINEL) {
                    return (
                      <span className="truncate block text-neutral-700 dark:text-neutral-200 font-medium">
                        {opt.label}
                      </span>
                    )
                  }
                  return <span className="truncate block">{opt.label}</span>
                }}
                renderOptionAccessory={(opt) => {
                  // Only real folders get the 3-dot menu — Home / Trash
                  // sentinels and anything without a matching folders[] row
                  // are skipped.
                  if (opt.value === HOME_SENTINEL || opt.value === TRASH_SENTINEL) return null
                  const folder = folders.find(f => f.id === opt.value)
                  if (!folder) return null
                  return (
                    <button
                      type="button"
                      aria-label={`Folder actions for ${folder.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setFolderRowMenuFor({ folderId: folder.id, top: r.bottom + 4, left: r.right - 160 })
                      }}
                      className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                    >
                      <MoreVertical size={14} />
                    </button>
                  )
                }}
                footer={({ close }) => (
                  <button
                    onClick={() => { close(); setShowCreateFolderModal(true); setNewFolderName('') }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
                  >
                    <Plus size={12} /> Create Folder
                  </button>
                )}
              />
            </div>

            {/* Status filter — shares the second mobile row with Folder
                via the parent grid's grid-cols-2. */}
            <div className="sm:min-w-[140px]">
              <MultiSearchableSelect
                label="Status"
                multi
                usePortal
                value={statusFilter}
                onChange={setStatusFilter}
                options={statusOptions}
                placeholder="All Statuses"
                searchPlaceholder="Search statuses…"
                renderOption={(opt) => (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                    <span className="truncate">{opt.label}</span>
                  </span>
                )}
              />
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Bulk actions slot — small empty spacer by default; when items
            are selected the bar expands to its natural height inside the
            same wrapper. Keeps a calm baseline gap, only takes real space
            when there's something to act on. */}
        <div className="mb-3">
          {selectedAgents.size > 0 && (() => {
            // Decide which action set the bulk bar shows by looking at
            // whether ALL selected rows are trashed. Mixed selection
            // (some active + some trashed) falls back to the active-side
            // action set; users can act on each kind separately if they
            // want fine-grained control.
            const trashedIds = new Set(trashedAgents.map(a => a.id))
            const allSelectedAreTrashed = [...selectedAgents].every(id => trashedIds.has(id))
            return (
              <BulkActionsBar
                count={selectedAgents.size}
                isTrash={allSelectedAreTrashed}
                onAction={handleBulkAction}
                onClear={() => setSelectedAgents(new Set())}
                loading={bulkLoading}
              />
            )
          })()}
        </div>

        {/* Table card — sits inside the page padding with the same
            left/right margin as the filter and bulk-action cards above
            (no negative -mx). Square corners — no rounded — to keep the
            table reading as a flat data surface. */}
        <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
          <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[600px] lg:min-w-[1100px]">
              <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                <tr>
                  <th className="w-[36px] sm:w-[44px] pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
                    <Tooltip content={tipLines(selectionStateOnPage === 'all' ? 'Clear all selected rows on this page' : 'Select every row on this page')} delay={300} position="bottom">
                      <RowCheckbox
                        checked={selectionStateOnPage === 'all'}
                        indeterminate={selectionStateOnPage === 'partial'}
                        onChange={toggleSelectAllOnPage}
                      />
                    </Tooltip>
                  </th>
                  <th
                    onClick={() => handleSort('name')}
                    className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[420px] cursor-pointer select-none"
                  >
                    <Tooltip content={tipLines('Click to sort A to Z', 'Name of the workflow')} delay={300} position="bottom">
                      <div className="flex items-center gap-1">Name <SortIndicator active={sortBy === 'name'} dir={sortDir} /></div>
                    </Tooltip>
                  </th>
                  <th
                    onClick={() => handleSort('folder')}
                    className="hidden sm:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[160px] cursor-pointer select-none"
                  >
                    <Tooltip content={tipLines('Click to sort by folder', 'The folder where this workflow is saved')} delay={300} position="bottom">
                      <div className="flex items-center gap-1">Folder <SortIndicator active={sortBy === 'folder'} dir={sortDir} /></div>
                    </Tooltip>
                  </th>
                  <th
                    onClick={() => handleSort('status')}
                    className="px-2 sm:px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[100px] sm:w-[140px] cursor-pointer select-none"
                  >
                    <Tooltip content={tipLines('Click to sort by status', 'Active means the workflow is running. Inactive means it is paused. Draft means it is not deployed yet.')} delay={300} position="bottom">
                      <div className="flex items-center gap-1">Status <SortIndicator active={sortBy === 'status'} dir={sortDir} /></div>
                    </Tooltip>
                  </th>
                  <th
                    onClick={() => handleSort('created_at')}
                    className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] cursor-pointer select-none"
                  >
                    <Tooltip content={tipLines('Click to sort by date', 'The day this workflow was first made')} delay={300} position="bottom">
                      <div className="flex items-center gap-1">Created <SortIndicator active={sortBy === 'created_at'} dir={sortDir} /></div>
                    </Tooltip>
                  </th>
                  <th
                    onClick={() => handleSort('updated_at')}
                    className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] cursor-pointer select-none"
                  >
                    <Tooltip content={tipLines('Click to sort by date', 'The day this workflow was last edited')} delay={300} position="bottom">
                      <div className="flex items-center gap-1">Updated <SortIndicator active={sortBy === 'updated_at'} dir={sortDir} /></div>
                    </Tooltip>
                  </th>
                  <th className="px-2 sm:px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[44px] sm:w-[80px] select-none">
                    <Tooltip content={tipLines('Open the menu to rename or delete a workflow')} delay={300} position="bottom">
                      <span className="hidden sm:inline-block">Actions</span>
                      <span className="sm:hidden inline-block">&nbsp;</span>
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
                {loadingAgents ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-3 py-3"><div className="w-4 h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse" /></td>
                      <td className="px-3 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-3/4" /></td>
                      <td className="hidden sm:table-cell px-3 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-20" /></td>
                      <td className="px-3 py-3"><div className="h-5 bg-gray-200 dark:bg-neutral-700 rounded-full animate-pulse w-16" /></td>
                      <td className="hidden md:table-cell px-3 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-16" /></td>
                      <td className="hidden md:table-cell px-3 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-16" /></td>
                      <td className="px-3 py-3"><div className="w-6 h-6 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse ml-auto" /></td>
                    </tr>
                  ))
                ) : pagedAgents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center">
                        {isTrash ? (
                          <Trash size={36} className="text-gray-300 dark:text-neutral-600 mb-3" />
                        ) : (
                          <Bot size={36} className="text-gray-300 dark:text-neutral-600 mb-3" />
                        )}
                        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-1">
                          {hasActiveFilters
                            ? 'No workflows match the current filters'
                            : isTrash ? 'Trash is empty' : 'No workflows yet'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-neutral-400 mb-4 max-w-xs">
                          {hasActiveFilters
                            ? 'Try adjusting or clearing your filters.'
                            : isTrash ? 'Deleted workflows will appear here for recovery.' : 'Get started by creating your first AI workflow.'}
                        </p>
                        {isTrash ? (
                          <button onClick={() => setFolderFilter({ include: [], exclude: [] })} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors">
                            Show All Workflows
                          </button>
                        ) : (
                          <Link to="/dashboard?create=1" className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors">
                            <Plus size={14} /> Create Workflow
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedAgents.map((agent) => (
                    <tr
                      key={agent.id}
                      className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors"
                    >
                      <td className="pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3">
                        <RowCheckbox
                          checked={selectedAgents.has(agent.id)}
                          onChange={() => toggleSelect(agent.id)}
                        />
                      </td>
                      <td className="px-2 sm:px-3 lg:px-4 py-3 max-w-0">
                        {isTrash ? (
                          <Tooltip content={clampForTooltip(capitalizeFirst(agent.name)) || 'Untitled'} delay={300}>
                            <div className="text-sm font-medium text-gray-500 dark:text-neutral-400 line-clamp-2 break-words cursor-default">
                              {capitalizeFirst(agent.name) || 'Untitled'}
                            </div>
                          </Tooltip>
                        ) : (
                          <Link
                            to={`/workflows/${agent.slug || agent.id}`}
                            className="block min-w-0 no-underline group"
                          >
                            <Tooltip content={clampForTooltip(capitalizeFirst(agent.name)) || 'Untitled'} delay={300}>
                              <div className="text-sm font-medium text-gray-900 dark:text-neutral-100 line-clamp-2 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {capitalizeFirst(agent.name) || 'Untitled'}
                              </div>
                            </Tooltip>
                          </Link>
                        )}
                        {/* Mobile-only folder subtitle — Folder column is
                            hidden below sm, so the folder name shows
                            inline below the workflow name with a small
                            folder icon. Trashed rows show "Trash" rather
                            than the original folder (backend keeps
                            folder_id intact for restore, frontend
                            overrides display). */}
                        <div className="sm:hidden flex items-center gap-1 mt-0.5 text-xs text-gray-500 dark:text-neutral-500 truncate">
                          <FolderOpen size={11} className="flex-shrink-0" />
                          <span className="truncate">{agent.is_trashed ? 'Trash' : folderName(agent.folder_id)}</span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 lg:px-4 py-3">
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-neutral-300 truncate" title={agent.is_trashed ? 'Trash' : folderName(agent.folder_id)}>
                          <FolderOpen size={13} className="text-gray-400 dark:text-neutral-500 flex-shrink-0" />
                          <span className="truncate">{agent.is_trashed ? 'Trash' : folderName(agent.folder_id)}</span>
                        </div>
                      </td>
                      <td className="px-2 sm:px-3 lg:px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {togglingAgentId === agent.id ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400">
                            <div className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            <span className="hidden sm:inline">Updating</span>
                          </span>
                        ) : (
                          <StatusPill
                            status={agent.status}
                            disabled={agent.is_trashed}
                            onChange={(next) => handleToggleActive({ stopPropagation: () => {} }, agent)}
                          />
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                        <Tooltip content={formatDateLong(agent.created_at)} delay={300}>
                          <span className="text-sm text-gray-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">{formatDate(agent.created_at)}</span>
                        </Tooltip>
                      </td>
                      <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                        <Tooltip content={formatDateLong(agent.updated_at)} delay={300}>
                          <span className="text-sm text-gray-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">{formatDate(agent.updated_at)}</span>
                        </Tooltip>
                      </td>
                      <td className="pl-1 sm:pl-3 lg:pl-4 pr-2 sm:pr-3 lg:pr-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip content="More actions" position="left">
                          <button
                            data-action-trigger="row-menu"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (menuOpenFor === agent.id) { setMenuOpenFor(null); return }
                              const rect = e.currentTarget.getBoundingClientRect()
                              setMenuOpenFor(agent.id)
                              // Right-anchor the menu so it always opens leftward
                              // from the trigger and never overflows the table.
                              // `right` = distance from viewport's right edge.
                              setMenuPos({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                                triggerBottom: rect.bottom,
                                triggerTop: rect.top,
                              })
                            }}
                            aria-label="Workflow actions"
                            className="w-6 h-6 sm:w-7 sm:h-7 inline-flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
                          >
                            <MoreVertical size={14} className="sm:size-[15px]" />
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loadingAgents && sortedAgents.length > 0 && (
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={sortedAgents.length}
              itemsPerPage={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1) }}
              loading={loadingAgents}
            />
          )}
        </div>
      </div>

      {/* ── Three-dot row action menu (fixed-position, right-anchored
            to the trigger button so it always opens leftward and stays on
            screen regardless of horizontal scroll/sidebar state). Flips
            upward if it would overflow the bottom of the viewport. ── */}
      {menuOpenFor && menuPos && (
        <div
          ref={rowMenuRef}
          className="fixed w-52 rounded-lg border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999] overflow-hidden bg-white dark:bg-neutral-800"
          style={(() => {
            const menuHeight = 200
            const wouldOverflowBottom = menuPos.top + menuHeight > window.innerHeight - 8
            const top = wouldOverflowBottom
              ? menuPos.triggerTop - menuHeight - 4
              : menuPos.top
            return {
              top: `${Math.max(8, top)}px`,
              right: `${Math.max(8, menuPos.right)}px`,
            }
          })()}
        >
            {(() => {
              // Look up the agent in BOTH lists since the row menu can
              // open over a trashed row too. Activate/Deactivate is
              // intentionally NOT in this menu — the status pill on the
              // row itself toggles workflow state, so duplicating it
              // here adds noise.
              const agent = activeAgents.find(a => a.id === menuOpenFor)
                || trashedAgents.find(a => a.id === menuOpenFor)
              if (!agent) return null
              if (agent.is_trashed) {
                return (
                  <>
                    <button onClick={(e) => handleRestore(e, agent.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                      <RotateCcw size={14} /> Restore
                    </button>
                    <button onClick={(e) => handleRenameAgent(e, agent)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                      <Pencil size={14} /> Rename
                    </button>
                    <button onClick={(e) => handleDelete(e, agent.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 size={14} /> Delete Permanently
                    </button>
                  </>
                )
              }
              return (
                <>
                  <button onClick={(e) => handleRowMove(e, agent)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                    <FolderInput size={14} /> Move to Folder
                  </button>
                  <button onClick={(e) => handleRowTeamAccess(e, agent)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                    <Users size={14} /> Team Access
                  </button>
                  <button onClick={(e) => handleRenameAgent(e, agent)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                    <Pencil size={14} /> Rename
                  </button>
                  {/* "Trash" because the action soft-deletes (moves to
                      trash). The hard "Delete Permanently" appears
                      above when the row is already in trash. */}
                  <button onClick={(e) => handleDelete(e, agent.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 size={14} /> Trash
                  </button>
                </>
              )
            })()}
        </div>
      )}

      {/* ── Create Workflow modal ── */}
      {showCreateModal && (
        <PremiumModal
          dirty={createTouched}
          onClose={() => { setShowCreateModal(false); setNewAgentName(''); setNewAgentFolderId(''); setNameError('') }}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-neutral-50">Create Workflow</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Give your workflow a name and choose where to keep it.</p>
          <div className="mt-4">
            <input
              type="text"
              placeholder="Enter workflow name"
              value={newAgentName}
              onChange={(e) => { setCreateTouched(true); setNewAgentName(e.target.value); setNameError('') }}
              onKeyDown={(e) => e.key === 'Enter' && newAgentName.trim() && handleCreate()}
              maxLength={WORKFLOW_NAME_MAX}
              className="w-full h-9 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-sm text-gray-900 dark:text-neutral-100 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
              autoFocus
            />
            <p className="mt-1.5 text-[11px] text-gray-400 dark:text-neutral-500 text-right tabular-nums">
              {newAgentName.length}/{WORKFLOW_NAME_MAX}
            </p>
            {nameError && <p className="text-xs text-red-500 mt-2">{nameError}</p>}
          </div>
          <div className="mt-4">
            <MultiSearchableSelect
              label="Folder"
              usePortal
              value={newAgentFolderId || ''}
              onChange={(val) => { setCreateTouched(true); setNewAgentFolderId(val || '') }}
              options={[
                { value: '', label: 'Home' },
                ...folders.filter(f => !f.parent_id).map(f => ({ value: f.id, label: f.name })),
              ]}
              placeholder="Select a folder"
              searchPlaceholder="Search folders…"
              hidePlaceholderRow
            />
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => { setShowCreateModal(false); setNewAgentName(''); setNewAgentFolderId(''); setNameError('') }} className="h-9 px-4 text-sm font-medium rounded-xl border border-gray-300 dark:border-neutral-600 text-gray-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={!newAgentName.trim() || creating} className="h-9 px-4 text-sm font-medium rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </PremiumModal>
      )}

      {/* ── Create Folder modal ──
          Mirrors the Create Workflow modal — same PremiumModal shell,
          same input + buttons. Triggered from the Folder filter footer. */}
      {showCreateFolderModal && (
        <PremiumModal
          dirty={createFolderTouched}
          onClose={() => { setShowCreateFolderModal(false); setNewFolderName('') }}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-neutral-50">Create Folder</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Group your workflows under a folder for easier filtering.</p>
          <div className="mt-4">
            <input
              type="text"
              placeholder="Enter folder name"
              value={newFolderName}
              onChange={(e) => { setCreateFolderTouched(true); setNewFolderName(e.target.value) }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newFolderName.trim() && !creatingFolder) {
                  setCreatingFolder(true)
                  try {
                    await handleCreateFolder(newFolderName.trim(), null)
                    setShowCreateFolderModal(false)
                    setNewFolderName('')
                  } finally { setCreatingFolder(false) }
                }
              }}
              className="w-full h-9 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-sm text-gray-900 dark:text-neutral-100 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => { setShowCreateFolderModal(false); setNewFolderName('') }}
              className="h-9 px-4 text-sm font-medium rounded-xl border border-gray-300 dark:border-neutral-600 text-gray-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (!newFolderName.trim() || creatingFolder) return
                setCreatingFolder(true)
                try {
                  await handleCreateFolder(newFolderName.trim(), null)
                  setShowCreateFolderModal(false)
                  setNewFolderName('')
                } finally { setCreatingFolder(false) }
              }}
              disabled={!newFolderName.trim() || creatingFolder}
              className="h-9 px-4 text-sm font-medium rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingFolder ? 'Creating…' : 'Create'}
            </button>
          </div>
        </PremiumModal>
      )}

      {/* ── Move To Folder modal ──
          Uses the same searchable dropdown as the page filters so a
          long folder list is searchable instead of an unwieldy native
          <select>. Single-select mode (multi=false). */}
      {showMoveModal && (
        <PremiumModal
          dirty={moveTouched}
          onClose={() => setShowMoveModal(false)}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-neutral-50">Move To Folder</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Select where to move the selected workflow(s).</p>
          <div className="mt-4">
            <MultiSearchableSelect
              label="Destination"
              usePortal
              value={moveFolderId || ''}
              onChange={(val) => { setMoveTouched(true); setMoveFolderId(val || '') }}
              options={[
                { value: '', label: 'Home' },
                ...folders.filter(f => !f.parent_id).map(f => ({ value: f.id, label: f.name })),
              ]}
              placeholder="Select a folder"
              searchPlaceholder="Search folders…"
              hidePlaceholderRow
            />
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setShowMoveModal(false)} className="h-9 px-4 text-sm font-medium rounded-xl border border-gray-300 dark:border-neutral-600 text-gray-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
              Cancel
            </button>
            <button onClick={handleBulkMove} className="h-9 px-4 text-sm font-medium rounded-xl text-white bg-blue-600 hover:bg-blue-700 transition-colors">
              Move
            </button>
          </div>
        </PremiumModal>
      )}

      {/* ── Manage Folders modal ── */}
      <FolderManagementModal
        open={showManageFolders}
        onClose={() => setShowManageFolders(false)}
        folders={folders}
        pinnedFolders={pinnedFolders}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onPin={handlePinFolder}
        onDelete={handleDeleteFolder}
        onTeamAccess={(f) => setFolderTeamAccessFor({ id: f.id, name: f.name })}
      />

      {folderTeamAccessFor && (
        <TeamAccessModal
          folder={folderTeamAccessFor}
          onClose={() => setFolderTeamAccessFor(null)}
        />
      )}

      {teamAccessAgent && (
        <TeamAccessModal
          agent={teamAccessAgent}
          onClose={() => setTeamAccessAgent(null)}
        />
      )}

      {bulkTeamAccessIds && (
        <ShareComposeModal
          initialResourceType="workflow"
          initialResourceIds={bulkTeamAccessIds}
          onClose={() => setBulkTeamAccessIds(null)}
          onShared={() => { setBulkTeamAccessIds(null); setSelectedAgents(new Set()) }}
        />
      )}

      {folderRowMenuFor && (() => {
        const folder = folders.find(f => f.id === folderRowMenuFor.folderId)
        if (!folder) return null
        const close = () => setFolderRowMenuFor(null)
        return (
          <>
            <div className="fixed inset-0 z-[10000]" onClick={close} />
            <div
              className="fixed z-[10001] w-40 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1 animate-fade-in"
              style={{ top: folderRowMenuFor.top, left: Math.max(8, folderRowMenuFor.left) }}
            >
              <button
                onClick={() => { close(); handleRenameFolder(folder.id, folder.name) }}
                className="w-full text-left px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 inline-flex items-center gap-2"
              >
                <Pencil size={13} className="text-neutral-400" /> Rename
              </button>
              <button
                onClick={() => { close(); setFolderTeamAccessFor({ id: folder.id, name: folder.name }) }}
                className="w-full text-left px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 inline-flex items-center gap-2"
              >
                <Users size={13} className="text-neutral-400" /> Team Access
              </button>
              <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />
              <button
                onClick={() => { close(); handleDeleteFolder(folder.id) }}
                className="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 inline-flex items-center gap-2"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </>
        )
      })()}
    </div>
  )
}

export default Dashboard
