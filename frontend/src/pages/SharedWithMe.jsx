import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Folder,
  Workflow,
  Users,
  Eye,
  Pencil,
  Shield,
  Loader2,
  Search,
  X,
  Settings,
  Trash2,
  Share2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
} from 'lucide-react'
import { teamAccessAPI, workflowsAPI } from '../services/api'
import toast from 'react-hot-toast'
import Tooltip from '../components/ui/Tooltip'
import MultiSearchableSelect from '../components/ui/MultiSearchableSelect'
import UpgradeGate from '../components/ui/UpgradeGate'
import { useEntitlements } from '../context/EntitlementsContext'
import { useConfirm } from '../components/ui/ConfirmModal'
import TeamAccessModal from '../components/builder/TeamAccessModal'
import ShareComposeModal from '../components/builder/ShareComposeModal'

// ─── Atoms ──────────────────────────────────────────────────────────────────

const middleTruncate = (name, limit) => {
  if (!name) return ''
  if (name.length <= limit) return name
  const startLen = Math.ceil(limit * 0.6)
  const endLen = Math.max(1, limit - startLen - 1)
  return name.slice(0, startLen) + '…' + name.slice(-endLen)
}

// Compact date — "27 Apr 2026" (matches Dashboard).
const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Verbose date used in hover tooltips — matches Dashboard's formatDateLong.
const fmtDateLong = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date} at ${time}`
}

// Two-line "action + description" tooltip, matching Dashboard. Action in
// solid white on top, softer description below.
const tipLines = (action, description) => (
  <div className="leading-snug">
    <div className="text-white">{action}</div>
    {description && <div className="text-neutral-300 mt-1">{description}</div>}
  </div>
)

const statusColors = {
  draft: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  active: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  ready: { bg: 'bg-gray-100 dark:bg-neutral-700', text: 'text-gray-700 dark:text-neutral-300', dot: 'bg-gray-400', label: 'Inactive' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  planning: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
}

const StatusBadge = ({ status }) => {
  const s = statusColors[status] || statusColors.draft
  return (
    <span className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium pl-2 pr-2 sm:pr-3 py-1 rounded-full capitalize ${s.bg} ${s.text}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label || status}
    </span>
  )
}

// Wire format → user-visible label. `capitalize` alone turns `full_control`
// into `Full_control`, which reads broken — humanize through this helper
// wherever role text is rendered as plain text (not via RoleBadge).
const humanizeRole = (role) => {
  if (role === 'full_control') return 'Full Control'
  if (role === 'editor') return 'Editor'
  if (role === 'viewer') return 'Viewer'
  if (role === 'owner') return 'Owner'
  return role || '—'
}

const RoleBadge = ({ role }) => {
  // Full Control gets a distinct purple treatment so it reads at a glance as
  // higher-privilege than Editor (blue). Viewer stays neutral gray. Anything
  // unknown falls back to viewer styling — defensive default; the backend
  // validates role on write.
  if (role === 'full_control') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30">
        <Shield size={9} />
        Full Control
      </span>
    )
  }
  const isEditor = role === 'editor'
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${
        isEditor
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
          : 'bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 border-gray-200 dark:border-neutral-600'
      }`}
    >
      {isEditor ? <Pencil size={9} /> : <Eye size={9} />}
      {isEditor ? 'Editor' : 'Viewer'}
    </span>
  )
}

const Avatar = ({ name, email, size = 'sm' }) => {
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()
  const sizeCls = size === 'xs' ? 'w-6 h-6 text-xs' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs'
  return (
    <div className={`${sizeCls} rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center justify-center font-semibold flex-shrink-0`}>
      {initial}
    </div>
  )
}

// ─── Page shell ─────────────────────────────────────────────────────────────

const SharedPage = () => {
  const [tab, setTab] = useState(() => localStorage.getItem('sharingTab') || 'with-me')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTick, setComposeTick] = useState(0) // bump to force table refresh

  // "Shared with me" is always available — receiving access doesn't consume
  // YOUR plan's quota, only the OWNER's. Inviting + sharing OUT requires
  // team_members_max > 0. Free (max=0) hides the Share button and replaces
  // the Shared-by-me tab content with an upgrade prompt. Existing collabs
  // already added on a previous plan keep working — backend never strips
  // them retroactively.
  //
  // Default `canShareNew` to false until entitlements have loaded so the
  // UpgradeGate renders immediately if the user is on Free, instead of
  // briefly flashing the "Shared by me" data table before the gate kicks in.
  const { loaded: entLoaded, effective } = useEntitlements()
  const teamCap = effective?.team_members_max ?? 0
  const canShareNew = entLoaded && teamCap !== 0

  useEffect(() => {
    document.title = 'Pabbly AgenticAI | Sharing'
    return () => { document.title = 'Pabbly AgenticAI' }
  }, [])

  useEffect(() => { localStorage.setItem('sharingTab', tab) }, [tab])

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900 leading-normal">
      <div className="p-3 sm:p-6 overflow-x-hidden">
        {/* Page header — matches Dashboard. Heading on the left,
            tab toggle + Share button on the right. On mobile the right
            block wraps below the heading and spreads end-to-end. */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="min-w-0">
            <Tooltip content={tipLines('Sharing', 'One place for everything shared between you and your teammates — workflows you can access, and the ones you have given out.')} delay={300} position="bottom">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 inline-block cursor-default">
                Sharing
              </h1>
            </Tooltip>
            <p className="text-sm sm:text-base text-gray-600 dark:text-neutral-400 mt-0.5 sm:mt-1">
              Manage who has access to your workflows, and find what's been shared with you.
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-between w-full lg:w-auto lg:justify-end">
            <div className="inline-flex bg-gray-100 dark:bg-neutral-800 rounded-lg p-1">
              <Tooltip content={tipLines('Workflows shared with me', 'Workflows and folders other teammates have given me access to.')} delay={300} position="bottom">
                <TabButton active={tab === 'with-me'} onClick={() => setTab('with-me')}>
                  Shared with me
                </TabButton>
              </Tooltip>
              <Tooltip content={tipLines('Workflows I have shared', 'Grants I own — manage who has access to my workflows and folders.')} delay={300} position="bottom">
                <TabButton active={tab === 'by-me'} onClick={() => setTab('by-me')}>
                  Shared by me
                </TabButton>
              </Tooltip>
            </div>
            {/* Share button — hidden until entitlements load, then either
                "Share" (canShareNew) or "Upgrade to share" (Free). Holding
                back until loaded prevents a flicker between the two. */}
            {!entLoaded ? (
              <div className="min-w-[120px] h-[30px]" />
            ) : canShareNew ? (
              <Tooltip content={tipLines('Share a workflow or folder', 'Invite teammates as Editor or Viewer')} delay={300}>
                <button
                  onClick={() => setComposeOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 min-w-[120px] justify-center"
                >
                  <Share2 size={14} />
                  <span>Share</span>
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={tipLines('Sharing not in your plan', 'Upgrade to invite teammates as Editor or Viewer.')} delay={300}>
                <Link
                  to="/usage/plan"
                  className="bg-neutral-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-1.5 min-w-[120px] justify-center cursor-pointer transition-colors"
                >
                  <Share2 size={14} />
                  <span>Upgrade to share</span>
                </Link>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Both panels stay mounted across tab switches so data is fetched
            ONCE per session — not on every toggle. The `composeTick` key
            still forces a refetch after a successful share (it bumps when
            ShareComposeModal calls onShared). */}
        <div className={tab === 'with-me' ? '' : 'hidden'}>
          <SharedTable key={`with-me-${composeTick}`} mode="with-me" />
        </div>
        <div className={tab === 'by-me' ? '' : 'hidden'}>
          {!entLoaded ? (
            // Hold the section blank until entitlements resolve — otherwise
            // a Free user briefly sees the Shared-by-me data table before
            // the UpgradeGate replaces it. Keeps the "Shared with me" tab
            // rendering instantly because it doesn't need entitlements.
            <div className="min-h-[200px]" />
          ) : canShareNew ? (
            <SharedByMeView composeTick={composeTick} />
          ) : (
            <UpgradeGate
              feature="Sharing your workflows"
              description="Invite teammates as Editor or Viewer to collaborate on your workflows. Team sharing is included on the Standard and Premium plans."
            />
          )}
        </div>

        {composeOpen && (
          <ShareComposeModal
            onClose={() => setComposeOpen(false)}
            onShared={() => setComposeTick((t) => t + 1)}
          />
        )}
      </div>
    </div>
  )
}

const TabButton = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-2 sm:px-3 py-2 sm:py-1 text-xs sm:text-sm font-medium rounded-md transition-colors ${
      active
        ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm'
        : 'text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-neutral-200'
    }`}
  >
    {children}
  </button>
)

// ─── Shared by me — flat grants table ──────────────────────────────────────
//
// One row = one (resource, member) grant. Filters cover every management scope:
//   • Remove users from a folder      → Type=Folder + Folder=X
//   • Remove a folder from one user   → Member=X + Type=Folder
//   • Un-share one workflow entirely  → Search=name
//   • Strip everything from a user    → Member=X
// Bulk-select handles the "many at once" shape of all four.

const SharedByMeView = ({ composeTick }) => (
  <ByMeGrantsView key={`grants-${composeTick}`} />
)

const ByMeGrantsView = () => {
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [grants, setGrants] = useState([])
  const [members, setMembers] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  // Both member and folder filters use MultiSearchableSelect's include/exclude
  // shape so the dropdowns match Dashboard. Empty arrays = no filter applied.
  const [memberFilter, setMemberFilter] = useState({ include: [], exclude: [] })
  const [folderFilter, setFolderFilter] = useState({ include: [], exclude: [] })

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const saved = parseInt(localStorage.getItem('sharingPageSize') || '25', 10)
    return [10, 25, 50, 100].includes(saved) ? saved : 25
  })

  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [bulkRevoking, setBulkRevoking] = useState(false)
  const [manageTarget, setManageTarget] = useState(null)

  // Per-row 3-dot action menu — fixed-position popup (escapes table clipping),
  // right-anchored to the trigger button. Mirrors Dashboard's pattern.
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const rowMenuRef = useRef(null)

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

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [wfRes, fdRes, mbRes] = await Promise.all([
        teamAccessAPI.listSharedByMe({ section: 'workflows', limit: 200 }),
        teamAccessAPI.listSharedByMe({ section: 'folders', limit: 200 }),
        teamAccessAPI.listSharedByMe({ section: 'members', limit: 200 }),
      ])
      const wfs = wfRes.data?.workflows || []
      const fds = fdRes.data?.folders || []
      const mbs = mbRes.data?.team_members || []

      // Per-folder workflow counts — for the column display only.
      const folderResults = await Promise.all(
        fds.map((f) =>
          workflowsAPI.getAll({ folder_id: f.id }).catch(() => ({ data: { agents: [] } })),
        ),
      )

      const flat = []
      for (const w of wfs) {
        for (const c of (w.collaborators || [])) {
          flat.push({
            key: `wf-${w.id}-${c.user_id}`,
            type: 'workflow',
            resourceId: w.id,
            resourceName: w.name,
            slug: w.slug,
            status: w.status,
            updatedAt: w.updated_at,
            workflowCount: null,
            userId: c.user_id,
            userName: c.name,
            userEmail: c.email,
            role: c.role,
          })
        }
      }
      for (let i = 0; i < fds.length; i++) {
        const f = fds[i]
        const wfCount = (folderResults[i].data?.agents || []).length
        for (const c of (f.collaborators || [])) {
          flat.push({
            key: `fd-${f.id}-${c.user_id}`,
            type: 'folder',
            resourceId: f.id,
            resourceName: f.name,
            slug: null,
            status: null,
            updatedAt: null,
            workflowCount: wfCount,
            userId: c.user_id,
            userName: c.name,
            userEmail: c.email,
            role: c.role,
          })
        }
      }

      setGrants(flat)
      setMembers(
        mbs
          .map((m) => ({ id: m.user_id, name: m.name, email: m.email }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      )
      setFolders(
        fds
          .map((f) => ({ id: f.id, name: f.name }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      )
    } catch {
      toast.error('Failed to load')
      setGrants([])
      setMembers([])
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleClear = () => {
    setSearch('')
    setTypeFilter('all')
    setMemberFilter({ include: [], exclude: [] })
    setFolderFilter({ include: [], exclude: [] })
  }

  const memberFilterActive = memberFilter.include.length > 0 || memberFilter.exclude.length > 0
  const folderFilterActive = folderFilter.include.length > 0 || folderFilter.exclude.length > 0
  const activeFilterCount =
    (search ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (memberFilterActive ? 1 : 0) +
    (folderFilterActive ? 1 : 0)

  const filteredGrants = useMemo(() => {
    const q = search.trim().toLowerCase()
    return grants.filter((g) => {
      if (q) {
        const hay = `${g.resourceName || ''} ${g.userName || ''} ${g.userEmail || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (typeFilter !== 'all' && g.type !== typeFilter) return false
      if (memberFilterActive) {
        if (memberFilter.include.length > 0 && !memberFilter.include.includes(g.userId)) return false
        if (memberFilter.exclude.length > 0 && memberFilter.exclude.includes(g.userId)) return false
      }
      // Folder filter targets folder-type rows by id. When include/exclude is
      // active, workflow rows are dropped — folder context doesn't apply to
      // direct workflow shares.
      if (folderFilterActive) {
        if (g.type !== 'folder') return false
        if (folderFilter.include.length > 0 && !folderFilter.include.includes(g.resourceId)) return false
        if (folderFilter.exclude.length > 0 && folderFilter.exclude.includes(g.resourceId)) return false
      }
      return true
    })
  }, [grants, search, typeFilter, memberFilter, memberFilterActive, folderFilter, folderFilterActive])

  useEffect(() => {
    setPage(1)
    setSelectedKeys(new Set())
  }, [search, typeFilter, memberFilter, folderFilter])

  useEffect(() => {
    localStorage.setItem('sharingPageSize', String(pageSize))
  }, [pageSize])

  const totalPages = Math.max(1, Math.ceil(filteredGrants.length / pageSize))
  const safePage = Math.min(page, totalPages)
  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage, page])

  const pagedGrants = useMemo(
    () => filteredGrants.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredGrants, safePage, pageSize],
  )

  const selectablePagedKeys = useMemo(
    () => pagedGrants.map((g) => g.key),
    [pagedGrants],
  )

  const toggleSelect = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const allSelected = selectablePagedKeys.every((k) => next.has(k))
      if (allSelected) selectablePagedKeys.forEach((k) => next.delete(k))
      else selectablePagedKeys.forEach((k) => next.add(k))
      return next
    })
  }

  const clearSelection = () => setSelectedKeys(new Set())

  const handleRowRevoke = async (g) => {
    const target = g.userName || g.userEmail || 'this user'
    const ok = await confirm({
      title: 'Revoke access?',
      message: `${target} will lose access to "${g.resourceName}". This cannot be undone.`,
      confirmLabel: 'Revoke access',
      danger: true,
    })
    if (!ok) return
    try {
      if (g.type === 'workflow') {
        await teamAccessAPI.removeWorkflowCollaborator(g.resourceId, g.userId)
      } else {
        await teamAccessAPI.removeFolderCollaborator(g.resourceId, g.userId)
      }
      toast.success('Access revoked')
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Revoke failed')
    }
  }

  const handleBulkRevoke = async () => {
    if (selectedKeys.size === 0) return
    const n = selectedKeys.size
    const ok = await confirm({
      title: `Revoke ${n} grant${n === 1 ? '' : 's'}?`,
      message: `Each selected member loses access to the resource on that row. This cannot be undone.`,
      confirmLabel: 'Revoke selected',
      danger: true,
    })
    if (!ok) return

    setBulkRevoking(true)
    const selected = grants.filter((g) => selectedKeys.has(g.key))
    let success = 0
    let failed = 0
    // Sequential to keep the load on the API predictable; the volume is
    // human-curated bulk selection, never thousands.
    for (const g of selected) {
      try {
        if (g.type === 'workflow') {
          await teamAccessAPI.removeWorkflowCollaborator(g.resourceId, g.userId)
        } else {
          await teamAccessAPI.removeFolderCollaborator(g.resourceId, g.userId)
        }
        success++
      } catch {
        failed++
      }
    }
    setBulkRevoking(false)
    if (success > 0) toast.success(`Revoked ${success} grant${success === 1 ? '' : 's'}`)
    if (failed > 0) toast.error(`Failed to revoke ${failed}`)
    clearSelection()
    fetchAll()
  }

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: m.name || m.email || 'Unknown',
        hint: m.email && m.email !== m.name ? m.email : '',
      })),
    [members],
  )

  const folderOptions = useMemo(
    () => folders.map((f) => ({ value: f.id, label: f.name })),
    [folders],
  )

  const allOnPageSelected =
    selectablePagedKeys.length > 0 &&
    selectablePagedKeys.every((k) => selectedKeys.has(k))
  const someOnPageSelected =
    !allOnPageSelected && selectablePagedKeys.some((k) => selectedKeys.has(k))

  const handleManageWorkflow = (g) =>
    setManageTarget({ type: 'workflow', id: g.resourceId, name: g.resourceName })
  const handleManageFolder = (g) =>
    setManageTarget({ type: 'folder', id: g.resourceId, name: g.resourceName })

  return (
    <div>
      <ByMeFilterBar
        search={search}
        onSearchChange={setSearch}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        memberFilter={memberFilter}
        onMemberChange={setMemberFilter}
        memberOptions={memberOptions}
        folderFilter={folderFilter}
        onFolderChange={setFolderFilter}
        folderOptions={folderOptions}
        canClear={activeFilterCount > 0}
        onClear={handleClear}
      />

      {/* Bulk-actions bar — renders only when items are selected, so there's
          no empty space between the filter card and the table in the default
          state. The minor row shift on first selection is acceptable. */}
      {selectedKeys.size > 0 && (
        <div className="mb-3">
          <BulkActionBar
            count={selectedKeys.size}
            noun="grant"
            onCancel={clearSelection}
            onRevoke={handleBulkRevoke}
            revoking={bulkRevoking}
          />
        </div>
      )}

      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
        {loading ? (
          <GrantsTableSkeleton rows={5} />
        ) : grants.length === 0 ? (
          <EmptyBlock
            icon={Users}
            title="You haven't shared anything yet"
            message='Click the "Share" button above to invite a teammate to a workflow or folder.'
          />
        ) : filteredGrants.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-600 dark:text-neutral-400">
              No grants match the current filters.
            </p>
            <button
              onClick={handleClear}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <GrantsTable
              rows={pagedGrants}
              selectedKeys={selectedKeys}
              allSelected={allOnPageSelected}
              someSelected={someOnPageSelected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onOpenMenu={(g, rect) => {
                if (rect == null) {
                  setMenuOpenFor(null)
                  return
                }
                setMenuOpenFor(g.key)
                setMenuPos({
                  top: rect.bottom + 4,
                  right: window.innerWidth - rect.right,
                  triggerTop: rect.top,
                })
              }}
              menuOpenFor={menuOpenFor}
            />
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredGrants.length}
              itemsPerPage={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            />
          </>
        )}
      </div>

      {/* Three-dot row action menu — fixed-position popup, right-anchored
          to the trigger so it always opens leftward and stays on screen.
          Flips upward if it would overflow the bottom of the viewport. */}
      {menuOpenFor && menuPos && (() => {
        const grant = grants.find((g) => g.key === menuOpenFor)
        if (!grant) return null
        const isFolder = grant.type === 'folder'
        const close = () => setMenuOpenFor(null)
        const menuHeight = 120
        const wouldOverflowBottom = menuPos.top + menuHeight > window.innerHeight - 8
        const top = wouldOverflowBottom ? menuPos.triggerTop - menuHeight - 4 : menuPos.top
        return (
          <div
            ref={rowMenuRef}
            className="fixed w-56 rounded-lg border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999] overflow-hidden bg-white dark:bg-neutral-800"
            style={{
              top: `${Math.max(8, top)}px`,
              right: `${Math.max(8, menuPos.right)}px`,
            }}
          >
            {!isFolder && (
              <Link
                to={`/workflows/${grant.slug || grant.resourceId}`}
                onClick={close}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors no-underline"
              >
                <Workflow size={14} /> Open workflow
              </Link>
            )}
            <button
              onClick={() => { close(); isFolder ? handleManageFolder(grant) : handleManageWorkflow(grant) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
            >
              <Settings size={14} /> {isFolder ? 'Manage folder access' : 'Manage workflow access'}
            </button>
            <button
              onClick={() => { close(); handleRowRevoke(grant) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={14} /> Revoke access
            </button>
          </div>
        )
      })()}

      {manageTarget?.type === 'workflow' && (
        <TeamAccessModal
          agent={{ id: manageTarget.id, name: manageTarget.name }}
          onClose={(result) => {
            setManageTarget(null)
            if (result?.mutated) fetchAll()
          }}
        />
      )}
      {manageTarget?.type === 'folder' && (
        <TeamAccessModal
          folder={{ id: manageTarget.id, name: manageTarget.name }}
          onClose={(result) => {
            setManageTarget(null)
            if (result?.mutated) fetchAll()
          }}
        />
      )}
    </div>
  )
}

// Filter bar for the grants table — search · type · member · folder.
// Mirrors Dashboard's filter bar exactly: small `p-2 sm:p-3` card, mobile
// 2-col grid where Search spans both cols, desktop flex-wrap with intrinsic
// widths.
const ByMeFilterBar = ({
  search,
  onSearchChange,
  typeFilter,
  onTypeChange,
  memberFilter,
  onMemberChange,
  memberOptions,
  folderFilter,
  onFolderChange,
  folderOptions,
  canClear,
  onClear,
}) => {
  const typeOptions = useMemo(() => [
    { value: 'folder', label: 'Folders' },
    { value: 'workflow', label: 'Workflows' },
  ], [])

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-3 sm:mb-4">
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
        <FilterColumn
          label="Search"
          className="col-span-2 sm:col-span-1 sm:min-w-[180px] sm:max-w-[240px]"
        >
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by workflow, folder, or member…"
              className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded"
              >
                <X size={14} className="text-gray-400" />
              </button>
            )}
          </div>
        </FilterColumn>

        <div className="sm:min-w-[140px]">
          <MultiSearchableSelect
            label="Type"
            usePortal
            value={typeFilter === 'all' ? null : typeFilter}
            onChange={(v) => onTypeChange(v || 'all')}
            options={typeOptions}
            placeholder="All Types"
            searchPlaceholder="Search types…"
          />
        </div>

        <div className="sm:min-w-[160px]">
          <MultiSearchableSelect
            label="Shared with"
            multi
            usePortal
            value={memberFilter}
            onChange={onMemberChange}
            options={memberOptions}
            placeholder="All members"
            searchPlaceholder="Search members…"
          />
        </div>

        <div className="col-span-2 sm:col-span-1 sm:min-w-[160px]">
          <MultiSearchableSelect
            label="Folder"
            multi
            usePortal
            value={folderFilter}
            onChange={onFolderChange}
            options={folderOptions}
            placeholder="Any folder"
            searchPlaceholder="Search folders…"
          />
        </div>

        {canClear && (
          <div className="sm:self-end">
            <button
              onClick={onClear}
              className="px-3 py-1.5 text-xs sm:text-sm font-medium inline-flex items-center gap-1 rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <X size={13} />
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const TypePill = ({ type }) => {
  const isFolder = type === 'folder'
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border ${
        isFolder
          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
          : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
      }`}
    >
      {isFolder ? <Folder size={9} /> : <Workflow size={9} />}
      {isFolder ? 'Folder' : 'Workflow'}
    </span>
  )
}

const GrantsTable = ({
  rows,
  selectedKeys,
  allSelected,
  someSelected,
  onToggleSelect,
  onToggleSelectAll,
  onOpenMenu,
  menuOpenFor,
}) => (
  <>
    {/* Mobile / tablet (< md): card list. Each card is a flex row with
        checkbox · content · actions; content lays out 3 lines so the right
        side of every card stays filled by the action icons. */}
    <div className="md:hidden divide-y divide-gray-200 dark:divide-neutral-700">
      {rows.map((g) => {
        const isSelected = selectedKeys.has(g.key)
        const isFolder = g.type === 'folder'
        return (
          <div
            key={g.key}
            className={`flex items-start gap-2 px-3 py-3 transition-colors ${
              isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
            <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={isSelected} onChange={() => onToggleSelect(g.key)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <TypePill type={g.type} />
                {isFolder ? (
                  <Tooltip content={tipLines(g.resourceName || '', 'Manage folder access')} delay={300}>
                    <button
                      onClick={() => onManageFolder(g)}
                      className="text-sm font-semibold text-gray-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 truncate transition-colors text-left min-w-0"
                    >
                      {g.resourceName}
                    </button>
                  </Tooltip>
                ) : (
                  <Link
                    to={`/workflows/${g.slug || g.resourceId}`}
                    className="min-w-0 no-underline group"
                  >
                    <Tooltip content={tipLines(g.resourceName || '', 'Open · Ctrl/Cmd-click to open in a new tab')} delay={300}>
                      <span className="block text-sm font-semibold text-gray-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate transition-colors">
                        {g.resourceName}
                      </span>
                    </Tooltip>
                  </Link>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400 truncate">
                {isFolder
                  ? `${g.workflowCount || 0} ${g.workflowCount === 1 ? 'workflow' : 'workflows'}`
                  : (g.status ? <span className="capitalize">{g.status}</span> : '—')}
                {g.role && <> · <span className="text-gray-700 dark:text-neutral-200">{humanizeRole(g.role)}</span></>}
              </p>
              <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
                <span className="text-gray-700 dark:text-neutral-200">{g.userName || '—'}</span>
                {g.userEmail && <> · {g.userEmail}</>}
              </p>
            </div>
            <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <RowMenuTrigger
                isOpen={menuOpenFor === g.key}
                onOpen={(rect) => onOpenMenu(g, rect)}
              />
            </div>
          </div>
        )
      })}
    </div>

    {/* Desktop (md+): full table with all six columns. */}
    <div className="hidden md:block overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
      <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 lg:min-w-[1000px]">
        <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
          <tr>
            <th className="w-[44px] pl-3 lg:pl-4 pr-3 lg:pr-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
              <Tooltip content={tipLines(allSelected ? 'Clear all selected rows on this page' : 'Select every row on this page')} delay={300} position="bottom">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={onToggleSelectAll}
                  disabled={rows.length === 0}
                />
              </Tooltip>
            </th>
            <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[110px] select-none">
              <Tooltip content={tipLines('Type of resource', 'Folder shares grant access to every workflow inside; workflow shares are direct.')} delay={300} position="bottom">
                <span>Type</span>
              </Tooltip>
            </th>
            <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
              <Tooltip content={tipLines('Workflow or folder name', 'Click the name to open the resource.')} delay={300} position="bottom">
                <span>Resource</span>
              </Tooltip>
            </th>
            <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[260px] select-none">
              <Tooltip content={tipLines('Member who has access', 'Their email shows below the name.')} delay={300} position="bottom">
                <span>Shared with</span>
              </Tooltip>
            </th>
            <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[140px] select-none">
              <Tooltip content={tipLines('Full Control, Editor, or Viewer', 'Full Control reveals credentials and manages collaborators; Editors change steps; Viewers only run and read.')} delay={300} position="bottom">
                <span>Role</span>
              </Tooltip>
            </th>
            <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[120px] select-none">
              <Tooltip content={tipLines('Manage access or revoke this grant')} delay={300} position="bottom">
                <span>Actions</span>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
          {rows.map((g) => {
            const isSelected = selectedKeys.has(g.key)
            const isFolder = g.type === 'folder'
            return (
              <tr
                key={g.key}
                className={`transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    : 'hover:bg-blue-50/50 dark:hover:bg-neutral-700/50'
                }`}
              >
                <td className="pl-3 lg:pl-4 pr-3 lg:pr-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isSelected} onChange={() => onToggleSelect(g.key)} />
                </td>
                <td className="px-3 lg:px-4 py-3">
                  <TypePill type={g.type} />
                </td>
                <td className="px-3 lg:px-4 py-3 max-w-0">
                  <div className="min-w-0">
                    {isFolder ? (
                      <Tooltip content={tipLines(g.resourceName || '', 'Manage folder access')} delay={300}>
                        <button
                          onClick={() => onManageFolder(g)}
                          className="block text-sm font-semibold text-gray-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2 break-words text-left transition-colors w-full"
                        >
                          {middleTruncate(g.resourceName || '', 70)}
                        </button>
                      </Tooltip>
                    ) : (
                      <Link
                        to={`/workflows/${g.slug || g.resourceId}`}
                        className="block min-w-0 no-underline group"
                      >
                        <Tooltip content={tipLines(g.resourceName || '', 'Open · Ctrl/Cmd-click to open in a new tab')} delay={300}>
                          <div className="text-sm font-semibold text-gray-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2 break-words transition-colors">
                            {middleTruncate(g.resourceName || '', 70)}
                          </div>
                        </Tooltip>
                      </Link>
                    )}
                    <p className="text-xs text-gray-500 dark:text-neutral-500 truncate mt-0.5">
                      {isFolder
                        ? `${g.workflowCount || 0} ${g.workflowCount === 1 ? 'workflow' : 'workflows'} inside`
                        : g.status
                          ? <span className="capitalize">{g.status}</span>
                          : '—'}
                    </p>
                  </div>
                </td>
                <td className="px-3 lg:px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 dark:text-neutral-100 truncate">
                      {g.userName || '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
                      {g.userEmail}
                    </p>
                  </div>
                </td>
                <td className="px-3 lg:px-4 py-3">
                  {g.role ? <RoleBadge role={g.role} /> : <span className="text-sm text-gray-900 dark:text-neutral-100">—</span>}
                </td>
                <td className="px-3 lg:px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <RowMenuTrigger
                    isOpen={menuOpenFor === g.key}
                    onOpen={(rect) => onOpenMenu(g, rect)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </>
)

// Three-dot trigger for the row action menu. The popup itself lives at the
// page-level (in `ByMeGrantsView`) so it can use fixed positioning and
// escape table-cell / overflow-x clipping. Mirrors Dashboard's pattern —
// `data-action-trigger="row-menu"` lets the document-mousedown listener
// know not to close-then-reopen when this same button is clicked again.
const RowMenuTrigger = ({ isOpen, onOpen }) => (
  <Tooltip content="More actions" position="left">
    <button
      data-action-trigger="row-menu"
      onClick={(e) => {
        e.stopPropagation()
        // Same-trigger click closes the menu — caller distinguishes by
        // checking `isOpen`. Open-from-elsewhere just sets new menuOpenFor.
        if (isOpen) {
          onOpen(null)
          return
        }
        onOpen(e.currentTarget.getBoundingClientRect())
      }}
      aria-label="Grant actions"
      className="w-7 h-7 inline-flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
    >
      <MoreVertical size={15} />
    </button>
  </Tooltip>
)

// ─── Unified table view (shared by both tabs) ──────────────────────────────

const SharedTable = ({ mode }) => {
  const navigate = useNavigate()

  // Flat dataset + filter sources, both populated from the initial fetch.
  const [allRows, setAllRows] = useState([])
  const [allPeople, setAllPeople] = useState([])
  const [allFolders, setAllFolders] = useState([])
  const [loading, setLoading] = useState(true)

  // Filter state — both email/folder filters use MultiSearchableSelect's
  // include/exclude shape so the dropdowns match Dashboard.
  const [search, setSearch] = useState('')
  const [emailFilter, setEmailFilter] = useState({ include: [], exclude: [] })
  // Multi-select folder filter (include/exclude) matching Dashboard pattern.
  // Empty arrays = no filter. The reserved sentinel `'__direct__'` represents
  // "Direct shares (no folder)" and is matched against rows with no folder_id.
  const [folderFilter, setFolderFilter] = useState({ include: [], exclude: [] })

  // Pagination state — 1-indexed page number.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const saved = parseInt(localStorage.getItem('sharingPageSize') || '25', 10)
    return [10, 25, 50, 100].includes(saved) ? saved : 25
  })

  // Selection state for bulk actions (by-me only).
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkRevoking, setBulkRevoking] = useState(false)

  // Owner-side: modal targets for managing access on a single resource.
  const [manageWorkflow, setManageWorkflow] = useState(null)

  const buildWithMe = useCallback(async () => {
    const res = await teamAccessAPI.listSharedWithMe({ limit: 200 })
    const groups = res.data?.by_owner || []

    const flat = []
    const peopleMap = new Map()
    const foldersMap = new Map()

    for (const g of groups) {
      peopleMap.set(g.owner_id, { id: g.owner_id, name: g.owner_name, email: g.owner_email })
      for (const w of g.workflows || []) {
        flat.push({
          id: w.id,
          name: w.name,
          slug: w.slug,
          status: w.status,
          role: w.role,
          updated_at: w.updated_at,
          owner_id: g.owner_id,
          owner_name: g.owner_name,
          owner_email: g.owner_email,
          folder_id: null,
          folder_name: null,
        })
      }
      for (const f of g.folders || []) {
        foldersMap.set(f.id, { id: f.id, name: f.name, owner_id: g.owner_id, role: f.role })
      }
    }

    // Fetch each shared folder's workflows in parallel.
    const folderList = [...foldersMap.values()]
    const folderResults = await Promise.all(
      folderList.map((f) =>
        teamAccessAPI.listSharedFolderWorkflows(f.id).catch(() => ({ data: { workflows: [] } })),
      ),
    )
    folderList.forEach((f, i) => {
      const wfs = folderResults[i].data?.workflows || []
      const ownerGroup = groups.find((g) => g.owner_id === f.owner_id)
      for (const w of wfs) {
        flat.push({
          id: w.id,
          name: w.name,
          slug: w.slug,
          status: w.status,
          // Folder workflows inherit the folder share's role.
          role: f.role,
          updated_at: w.updated_at,
          owner_id: f.owner_id,
          owner_name: ownerGroup?.owner_name,
          owner_email: ownerGroup?.owner_email,
          folder_id: f.id,
          folder_name: f.name,
        })
      }
    })

    return {
      rows: flat,
      people: [...peopleMap.values()],
      folders: folderList.map((f) => ({ id: f.id, name: f.name })),
    }
  }, [])

  const buildByMeWorkflows = useCallback(async () => {
    // Workflows-only sub-tab: my directly-shared workflows. NO folder
    // inheritance — those live under the Folders sub-tab.
    const [wfRes, mbRes] = await Promise.all([
      teamAccessAPI.listSharedByMe({ section: 'workflows', limit: 200 }),
      teamAccessAPI.listSharedByMe({ section: 'members', limit: 200 }),
    ])
    const directWorkflows = wfRes.data?.workflows || []
    const teamMembers = mbRes.data?.team_members || []

    const rows = directWorkflows.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      status: w.status,
      updated_at: w.updated_at || null,
      collaborators: w.collaborators || [],
    }))

    return {
      rows,
      people: teamMembers.map((m) => ({
        id: m.user_id,
        name: m.name,
        email: m.email,
      })),
      folders: [], // workflows view doesn't filter by folder
    }
  }, [])

  const buildByMeFolders = useCallback(async () => {
    // Folders-only sub-tab: my shared folders. Each row is one folder
    // showing all its collaborators. Bulk-revoke un-shares the folder
    // entirely (cascades to every workflow inside).
    const [fdRes, mbRes] = await Promise.all([
      teamAccessAPI.listSharedByMe({ section: 'folders', limit: 200 }),
      teamAccessAPI.listSharedByMe({ section: 'members', limit: 200 }),
    ])
    const sharedFolders = fdRes.data?.folders || []
    const teamMembers = mbRes.data?.team_members || []

    // Per-folder workflow counts come from listing my own agents in each.
    const folderResults = await Promise.all(
      sharedFolders.map((f) =>
        workflowsAPI
          .getAll({ folder_id: f.id })
          .catch(() => ({ data: { agents: [] } })),
      ),
    )

    const rows = sharedFolders.map((f, i) => ({
      id: f.id,
      name: f.name,
      collaborators: f.collaborators || [],
      workflow_count: (folderResults[i].data?.agents || []).length,
    }))

    return {
      rows,
      people: teamMembers.map((m) => ({
        id: m.user_id,
        name: m.name,
        email: m.email,
      })),
      folders: [], // not applicable on folders view
    }
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      let data
      if (mode === 'with-me') data = await buildWithMe()
      else if (mode === 'by-me-workflows') data = await buildByMeWorkflows()
      else if (mode === 'by-me-folders') data = await buildByMeFolders()
      else data = { rows: [], people: [], folders: [] }
      setAllRows(data.rows)
      setAllPeople(data.people.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      setAllFolders(data.folders.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    } catch {
      toast.error('Failed to load')
      setAllRows([])
      setAllPeople([])
      setAllFolders([])
    } finally {
      setLoading(false)
    }
  }, [mode, buildWithMe, buildByMeWorkflows, buildByMeFolders])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleClear = () => {
    setSearch('')
    setEmailFilter({ include: [], exclude: [] })
    setFolderFilter({ include: [], exclude: [] })
  }

  const folderFilterApplies = mode === 'with-me'
  const emailFilterActive = emailFilter.include.length > 0 || emailFilter.exclude.length > 0
  const folderFilterActive = folderFilter.include.length > 0 || folderFilter.exclude.length > 0
  const activeFilterCount =
    (search ? 1 : 0) +
    (emailFilterActive ? 1 : 0) +
    (folderFilterApplies && folderFilterActive ? 1 : 0)

  // Helper: does this row match the include/exclude lists on emailFilter?
  // For with-me, the "person" is the owner; for by-me, any collaborator
  // counts as a match against their user_id.
  const rowMatchesEmail = (r) => {
    if (!emailFilterActive) return true
    let key
    if (mode === 'with-me') {
      key = r.owner_id
    }
    if (mode === 'with-me') {
      if (emailFilter.include.length > 0 && !emailFilter.include.includes(key)) return false
      if (emailFilter.exclude.length > 0 && emailFilter.exclude.includes(key)) return false
    } else {
      const collabIds = (r.collaborators || []).map((c) => c.user_id)
      if (emailFilter.include.length > 0 && !collabIds.some((id) => emailFilter.include.includes(id))) return false
      if (emailFilter.exclude.length > 0 && collabIds.some((id) => emailFilter.exclude.includes(id))) return false
    }
    return true
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter((r) => {
      if (q && !(r.name || '').toLowerCase().includes(q)) return false
      if (!rowMatchesEmail(r)) return false
      // Folder filter only applies to "Shared with me" — by-me sub-tabs
      // are already scoped to either workflows-only or folders-only. The
      // sentinel `'__direct__'` matches rows with no folder_id.
      if (mode === 'with-me' && folderFilterActive) {
        const key = r.folder_id || '__direct__'
        if (folderFilter.include.length > 0 && !folderFilter.include.includes(key)) return false
        if (folderFilter.exclude.length > 0 && folderFilter.exclude.includes(key)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, search, emailFilter, emailFilterActive, folderFilter, folderFilterActive, mode])

  // Reset to page 1 whenever the filter set changes — otherwise the user
  // would land on a non-existent page after narrowing the result count.
  useEffect(() => { setPage(1); setSelectedIds(new Set()) }, [search, emailFilter, folderFilter])
  useEffect(() => { setSelectedIds(new Set()) }, [mode])

  useEffect(() => {
    localStorage.setItem('sharingPageSize', String(pageSize))
  }, [pageSize])

  // Clamp page when filteredRows shrinks below the current page boundary
  // (e.g. on data refresh after a delete).
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage, page])

  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, safePage, pageSize],
  )

  // Bulk-selectable rows on the current page. Only by-me sub-tabs offer
  // bulk operations (with-me is read-only since I'm not the owner).
  const selectablePagedIds = useMemo(
    () =>
      mode === 'by-me-workflows' || mode === 'by-me-folders'
        ? pagedRows.map((r) => r.id)
        : [],
    [pagedRows, mode],
  )

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = selectablePagedIds.every((id) => next.has(id))
      if (allSelected) {
        selectablePagedIds.forEach((id) => next.delete(id))
      } else {
        selectablePagedIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkRevoke = async () => {
    if (selectedIds.size === 0) return
    const noun = mode === 'by-me-folders' ? 'folder' : 'workflow'
    const cascade = mode === 'by-me-folders'
      ? ' Every workflow inside these folders will also lose access for the affected collaborators.'
      : ''
    if (
      !window.confirm(
        `Revoke all sharing on ${selectedIds.size} ${noun}${selectedIds.size === 1 ? '' : 's'}? Every collaborator will lose access.${cascade} This cannot be undone.`,
      )
    )
      return
    setBulkRevoking(true)
    try {
      const ids = [...selectedIds]
      const res =
        mode === 'by-me-folders'
          ? await teamAccessAPI.bulkRevokeFolders(ids)
          : await teamAccessAPI.bulkRevokeWorkflows(ids)
      toast.success(
        `Revoked sharing on ${res.data?.modified ?? 0} ${noun}${res.data?.modified === 1 ? '' : 's'}`,
      )
      clearSelection()
      fetchAll()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk revoke failed')
    } finally {
      setBulkRevoking(false)
    }
  }

  // People dropdown options — render avatar + name with email as hint.
  const personOptions = useMemo(
    () =>
      allPeople.map((p) => ({
        value: p.id,
        label: p.name || p.email || 'Unknown',
        hint: p.email && p.email !== p.name ? p.email : '',
      })),
    [allPeople],
  )

  const folderOptions = useMemo(
    () => [
      { value: '__direct__', label: 'Direct shares', hint: 'No folder' },
      ...allFolders.map((f) => ({ value: f.id, label: f.name })),
    ],
    [allFolders],
  )

  return (
    <div>
      {/* ─── Filter bar ─── */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        emailFilter={emailFilter}
        onEmailChange={setEmailFilter}
        emailLabel={mode === 'with-me' ? 'Shared by' : 'Shared with'}
        emailPlaceholder="All people"
        emailOptions={personOptions}
        // Folder filter only makes sense on the "Shared with me" view.
        // The by-me sub-tabs are already scoped to one resource type.
        showFolderFilter={mode === 'with-me'}
        folderFilter={folderFilter}
        onFolderChange={setFolderFilter}
        folderOptions={folderOptions}
        canClear={activeFilterCount > 0}
        onClear={handleClear}
      />

      {/* Bulk-actions bar — only rendered when items are selected so there's
          no empty space between the filter card and the table. With-me is
          read-only so it never appears there. */}
      {(mode === 'by-me-workflows' || mode === 'by-me-folders') && selectedIds.size > 0 && (
        <div className="mb-3">
          <BulkActionBar
            count={selectedIds.size}
            noun={mode === 'by-me-folders' ? 'folder' : 'workflow'}
            onCancel={clearSelection}
            onRevoke={handleBulkRevoke}
            revoking={bulkRevoking}
          />
        </div>
      )}

      {/* ─── Table card — square corners, flat data surface (Dashboard) ─── */}
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
        {loading ? (
          mode === 'with-me' ? <WithMeTableSkeleton rows={5} /> : <GrantsTableSkeleton rows={5} />
        ) : allRows.length === 0 ? (
          <EmptyBlock
            icon={Users}
            title={mode === 'with-me' ? 'Nothing shared with you yet' : "You haven't shared anything yet"}
            message={
              mode === 'with-me'
                ? 'When teammates share a workflow or folder with you, it shows up here.'
                : 'Open a workflow or folder, click the Team Access icon, and invite a teammate.'
            }
          />
        ) : filteredRows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-600 dark:text-neutral-400">
              No workflows match the current filters.
            </p>
            <button
              onClick={handleClear}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <ResultTable
              rows={pagedRows}
              mode={mode}
              selectedIds={selectedIds}
              selectablePagedIds={selectablePagedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAllOnPage}
              onOpen={(r) => navigate(`/workflows/${r.slug || r.id}`)}
              onManage={(r) => setManageWorkflow({ id: r.id, name: r.name })}
            />
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredRows.length}
              itemsPerPage={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            />
          </>
        )}
      </div>

      {manageWorkflow && (
        <TeamAccessModal
          agent={manageWorkflow}
          onClose={() => {
            setManageWorkflow(null)
            fetchAll()
          }}
        />
      )}
    </div>
  )
}

// ─── Filter bar (matches the ptm-app reference) ─────────────────────────────

const FilterBar = ({
  search,
  onSearchChange,
  emailFilter,
  onEmailChange,
  emailLabel,
  emailPlaceholder,
  emailOptions,
  showFolderFilter = true,
  folderFilter,
  onFolderChange,
  folderOptions,
  canClear,
  onClear,
}) => (
  <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-3 sm:mb-4">
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
      <FilterColumn
        label="Search"
        className="col-span-2 sm:col-span-1 sm:min-w-[180px] sm:max-w-[240px]"
      >
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search workflow name…"
            className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 hover:border-neutral-300 dark:hover:border-neutral-500"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded"
            >
              <X size={14} className="text-gray-400" />
            </button>
          )}
        </div>
      </FilterColumn>

      <div className="sm:min-w-[160px]">
        <MultiSearchableSelect
          label={emailLabel}
          multi
          usePortal
          value={emailFilter}
          onChange={onEmailChange}
          options={emailOptions}
          placeholder={emailPlaceholder}
          searchPlaceholder="Search people…"
        />
      </div>

      {showFolderFilter && (
        <div className="sm:min-w-[160px]">
          <MultiSearchableSelect
            label="Folder"
            multi
            usePortal
            value={folderFilter}
            onChange={onFolderChange}
            options={folderOptions}
            placeholder="Any folder"
            searchPlaceholder="Search folders…"
          />
        </div>
      )}

      {canClear && (
        <div className="sm:self-end">
          <button
            onClick={onClear}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium inline-flex items-center gap-1 rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <X size={13} />
            Clear filters
          </button>
        </div>
      )}
    </div>
  </div>
)

// Filter-column label — sentence case (no uppercase) so "Shared by"
// reads as a phrase, not a header. Optional `tooltip` shows the meaning
// of the filter on hover via the same shared Tooltip component.
const FilterColumn = ({ label, tooltip, children, className = '' }) => {
  const labelEl = (
    <label className="text-xs font-medium text-gray-700 dark:text-neutral-300 mb-1 inline-flex items-center gap-1 cursor-default">
      {label}
    </label>
  )
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="block mb-1">
        {tooltip ? <Tooltip content={tooltip} delay={300} position="top">{labelEl}</Tooltip> : labelEl}
      </div>
      {children}
    </div>
  )
}

// ─── Results table ──────────────────────────────────────────────────────────

/**
 * Dispatch table — three distinct column sets per mode:
 *   - with-me: workflows shared with me (read-only, no checkbox)
 *   - by-me-workflows: my directly-shared workflows (bulk revoke)
 *   - by-me-folders: my shared folders (bulk revoke un-shares folder)
 */
const ResultTable = ({
  rows,
  mode,
  selectedIds = new Set(),
  selectablePagedIds = [],
  onToggleSelect,
  onToggleSelectAll,
  onOpen,
  onManage,
}) => {
  const allSelected =
    selectablePagedIds.length > 0 &&
    selectablePagedIds.every((id) => selectedIds.has(id))
  const someSelected =
    !allSelected && selectablePagedIds.some((id) => selectedIds.has(id))

  if (mode === 'with-me') {
    return (
      <WithMeTable rows={rows} onOpen={onOpen} />
    )
  }
  if (mode === 'by-me-workflows') {
    return (
      <ByMeWorkflowsTable
        rows={rows}
        selectedIds={selectedIds}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggleSelect={onToggleSelect}
        onToggleSelectAll={onToggleSelectAll}
        onOpen={onOpen}
        onManage={onManage}
      />
    )
  }
  // by-me-folders
  return (
    <ByMeFoldersTable
      rows={rows}
      selectedIds={selectedIds}
      allSelected={allSelected}
      someSelected={someSelected}
      onToggleSelect={onToggleSelect}
      onToggleSelectAll={onToggleSelectAll}
      onManage={onManage}
    />
  )
}

const WithMeTable = ({ rows }) => (
  <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
    <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[600px] lg:min-w-[1100px]">
      <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
        <tr>
          <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[360px] select-none">
            <Tooltip content={tipLines('Workflow name', 'Click the name to open. Ctrl/Cmd-click opens it in a new tab.')} delay={300} position="bottom">
              <span>Workflow</span>
            </Tooltip>
          </th>
          <th className="hidden sm:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[220px] select-none">
            <Tooltip content={tipLines('Owner of this workflow', 'They shared it with you and can revoke access.')} delay={300} position="bottom">
              <span>Shared by</span>
            </Tooltip>
          </th>
          <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[160px] select-none">
            <Tooltip content={tipLines('Containing folder', 'Direct shares show no folder.')} delay={300} position="bottom">
              <span>Folder</span>
            </Tooltip>
          </th>
          <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[110px] sm:w-[140px] select-none">
            <Tooltip content={tipLines('Workflow status', 'Active means the workflow is running. Inactive means it is paused.')} delay={300} position="bottom">
              <span>Status</span>
            </Tooltip>
          </th>
          <th className="hidden sm:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[140px] select-none">
            <Tooltip content={tipLines('Your access level', 'Full Control reveals credentials and manages collaborators; Editors change steps; Viewers only run and read.')} delay={300} position="bottom">
              <span>Your role</span>
            </Tooltip>
          </th>
          <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] select-none">
            <Tooltip content={tipLines('Last updated', 'The day this workflow was last edited.')} delay={300} position="bottom">
              <span>Updated</span>
            </Tooltip>
          </th>
        </tr>
      </thead>
      <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
        {rows.map((r) => (
          <tr
            key={`${r.id}-${r.folder_id || 'direct'}`}
            className="hover:bg-blue-50/50 dark:hover:bg-neutral-700/50 transition-colors"
          >
            <td className="px-3 lg:px-4 py-3 max-w-0">
              <Link
                to={`/workflows/${r.slug || r.id}`}
                className="block min-w-0 no-underline group"
              >
                <Tooltip content={tipLines(r.name || 'Untitled', 'Open · Ctrl/Cmd-click to open in a new tab')} delay={300}>
                  <div className="text-sm font-medium text-gray-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2 break-words transition-colors">
                    {middleTruncate(r.name || 'Untitled', 70)}
                  </div>
                </Tooltip>
              </Link>
              {/* Mobile-only owner + folder subtitle. Folder/Shared-by columns
                  are hidden below sm/md so the info collapses inline here. */}
              <div className="sm:hidden mt-0.5 text-xs text-gray-500 dark:text-neutral-500 truncate">
                {r.owner_name && <>{r.owner_name}</>}
                {r.folder_name && <> · 📁 {r.folder_name}</>}
              </div>
            </td>
            <td className="hidden sm:table-cell px-3 lg:px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 dark:text-neutral-100 truncate">
                  {r.owner_name || '—'}
                </p>
                <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
                  {r.owner_email}
                </p>
              </div>
            </td>
            <td className="hidden md:table-cell px-3 lg:px-4 py-3">
              {r.folder_name ? (
                <div className="flex items-center gap-1.5 text-sm text-gray-900 dark:text-neutral-100 truncate" title={r.folder_name}>
                  <Folder size={13} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <span className="truncate">{r.folder_name}</span>
                </div>
              ) : (
                <span className="text-sm text-gray-400 dark:text-neutral-500">—</span>
              )}
            </td>
            <td className="px-3 lg:px-4 py-3"><StatusBadge status={r.status} /></td>
            <td className="hidden sm:table-cell px-3 lg:px-4 py-3">
              {r.role ? <RoleBadge role={r.role} /> : <span className="text-sm text-gray-900 dark:text-neutral-100">—</span>}
            </td>
            <td className="hidden md:table-cell px-3 lg:px-4 py-3">
              <Tooltip content={fmtDateLong(r.updated_at)} delay={300}>
                <span className="text-sm text-gray-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                  {fmtDate(r.updated_at)}
                </span>
              </Tooltip>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const ByMeWorkflowsTable = ({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggleSelect,
  onToggleSelectAll,
  onOpen,
  onManage,
}) => (
  <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
    <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[600px] lg:min-w-[1100px]">
      <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
        <tr>
          <th className="w-[36px] sm:w-[44px] pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={onToggleSelectAll}
              disabled={rows.length === 0}
            />
          </th>
          <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">Workflow</th>
          <th className="hidden sm:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[260px] select-none">Shared with</th>
          <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] select-none">Status</th>
          <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] select-none">Updated</th>
          <th className="px-2 sm:px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[100px] select-none">
            <span className="hidden sm:inline-block">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
        {rows.map((r) => {
          const isSelected = selectedIds.has(r.id)
          return (
            <tr
              key={r.id}
              className={`transition-colors ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                  : 'hover:bg-blue-50/50 dark:hover:bg-neutral-700/50'
              }`}
            >
              <td className="pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isSelected} onChange={() => onToggleSelect(r.id)} />
              </td>
              <td className="px-3 lg:px-4 py-3 max-w-0">
                <Link
                  to={`/workflows/${r.slug || r.id}`}
                  className="block min-w-0 no-underline group"
                >
                  <Tooltip content={tipLines(r.name || 'Untitled', 'Open · Ctrl/Cmd-click to open in a new tab')} delay={300}>
                    <div className="text-sm font-medium text-gray-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2 break-words transition-colors">
                      {middleTruncate(r.name || 'Untitled', 70)}
                    </div>
                  </Tooltip>
                </Link>
              </td>
              <td className="hidden sm:table-cell px-3 lg:px-4 py-3"><CollabPills collaborators={r.collaborators} /></td>
              <td className="px-3 lg:px-4 py-3"><StatusBadge status={r.status} /></td>
              <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                <Tooltip content={fmtDateLong(r.updated_at)} delay={300}>
                  <span className="text-sm text-gray-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                    {fmtDate(r.updated_at)}
                  </span>
                </Tooltip>
              </td>
              <td className="pl-1 sm:pl-3 lg:pl-4 pr-2 sm:pr-3 lg:pr-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onManage(r)}
                  className="px-2.5 py-1 text-xs font-medium rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 inline-flex items-center gap-1 transition-colors"
                >
                  <Settings size={11} />
                  Manage
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const ByMeFoldersTable = ({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggleSelect,
  onToggleSelectAll,
  onManage,
}) => (
  <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
    <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[600px] lg:min-w-[1100px]">
      <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
        <tr>
          <th className="w-[36px] sm:w-[44px] pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={onToggleSelectAll}
              disabled={rows.length === 0}
            />
          </th>
          <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">Folder</th>
          <th className="hidden sm:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider select-none">Shared with</th>
          <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[130px] select-none">Workflows</th>
          <th className="px-2 sm:px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider w-[100px] select-none">
            <span className="hidden sm:inline-block">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
        {rows.map((r) => {
          const isSelected = selectedIds.has(r.id)
          return (
            <tr
              key={r.id}
              onClick={() => onToggleSelect(r.id)}
              className={`cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                  : 'hover:bg-blue-50/50 dark:hover:bg-neutral-700/50'
              }`}
            >
              <td className="pl-2 sm:pl-3 lg:pl-4 pr-1 sm:pr-3 lg:pr-4 py-3" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isSelected} onChange={() => onToggleSelect(r.id)} />
              </td>
              <td className="px-3 lg:px-4 py-3 max-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <Folder size={14} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <Tooltip content={r.name || ''} delay={300}>
                    <p className="text-sm font-medium text-gray-900 dark:text-neutral-100 line-clamp-2 break-words">
                      {r.name}
                    </p>
                  </Tooltip>
                </div>
              </td>
              <td className="hidden sm:table-cell px-3 lg:px-4 py-3"><CollabPillsAll collaborators={r.collaborators} /></td>
              <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                <span className="text-sm text-gray-600 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                  {r.workflow_count} {r.workflow_count === 1 ? 'workflow' : 'workflows'}
                </span>
              </td>
              <td className="pl-1 sm:pl-3 lg:pl-4 pr-2 sm:pr-3 lg:pr-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onManage(r)}
                  className="px-2.5 py-1 text-xs font-medium rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 inline-flex items-center gap-1 transition-colors"
                >
                  <Settings size={11} />
                  Manage
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const FolderPill = ({ name }) => (
  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300">
    <Folder size={11} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
    <span className="truncate max-w-[100px]">{name}</span>
  </span>
)

// Same as CollabPills but used in the Folders sub-tab — shows up to 4 names
// since the column is the only thing in the row that benefits from width.
const CollabPillsAll = ({ collaborators = [] }) => {
  if (collaborators.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-neutral-500">No collaborators</span>
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {collaborators.slice(0, 4).map((c) => (
        <Tooltip key={c.user_id} content={`${c.name || c.email} (${humanizeRole(c.role)})`}>
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 border border-gray-200 dark:border-neutral-600 truncate max-w-[100px]">
            <Avatar name={c.name} email={c.email} size="xs" />
            {(c.name || c.email || '').split(' ')[0] || '—'}
          </span>
        </Tooltip>
      ))}
      {collaborators.length > 4 && (
        <span className="text-xs text-gray-500 dark:text-neutral-400">
          +{collaborators.length - 4}
        </span>
      )}
    </div>
  )
}

// ─── Checkbox (PPM-style, blue fill matching Dashboard) ────────────────────

const Checkbox = ({ checked, indeterminate, onChange, disabled }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); if (!disabled) onChange?.() }}
    disabled={disabled}
    aria-checked={checked}
    role="checkbox"
    className={`w-[18px] h-[18px] rounded flex items-center justify-center flex-shrink-0 transition-colors ${
      disabled
        ? 'bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 cursor-not-allowed'
        : checked || indeterminate
          ? 'bg-blue-600 border-blue-600 cursor-pointer'
          : 'bg-white dark:bg-neutral-900 border border-gray-300 dark:border-neutral-500 hover:border-gray-400 dark:hover:border-neutral-400 cursor-pointer'
    }`}
  >
    {checked && (
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )}
    {indeterminate && !checked && <div className="w-2.5 h-[2px] bg-white rounded-full" />}
  </button>
)

// ─── Bulk action bar (sits above the table card per Dashboard pattern) ─────

const BulkActionBar = ({ count, noun = 'item', onCancel, onRevoke, revoking }) => (
  <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-3">
    <span className="text-sm font-medium text-gray-700 dark:text-neutral-200">
      {count} {noun}{count === 1 ? '' : 's'} selected
    </span>
    <div className="hidden sm:block h-5 w-px bg-gray-200 dark:bg-neutral-700" />
    <button
      onClick={onRevoke}
      disabled={revoking}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {revoking ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
      Revoke access
    </button>
    <button
      onClick={onCancel}
      className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
    >
      <X size={14} />
      Clear
    </button>
  </div>
)

const CollabPills = ({ collaborators = [] }) => {
  if (collaborators.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-neutral-500">—</span>
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {collaborators.slice(0, 2).map((c) => (
        <Tooltip key={c.user_id} content={`${c.name || c.email} (${humanizeRole(c.role)})`}>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 border border-gray-200 dark:border-neutral-600 truncate max-w-[80px]">
            {(c.name || c.email || '').split(' ')[0] || '—'}
          </span>
        </Tooltip>
      ))}
      {collaborators.length > 2 && (
        <span className="text-xs text-gray-500 dark:text-neutral-400">
          +{collaborators.length - 2}
        </span>
      )}
    </div>
  )
}

// ─── Pagination — local component matching the Sharing-page reference ─────
//
// Differs from the shared `components/ui/Pagination.jsx` in two ways the
// user specifically asked for:
//   1. Always renders (not hidden when totalPages === 1) so the rows-per-page
//      control stays reachable on small result sets.
//   2. Uses First / Prev / pages / Next / Last with double-chevron icons —
//      matches the reference screenshot.
//
// Prop names mirror the local one this file used originally so call sites
// don't have to translate. Tooltips on every nav button.

const Pagination = ({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange, onPageSizeChange }) => {
  const startRow = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const endRow = Math.min(totalItems, currentPage * itemsPerPage)
  const isFirst = currentPage <= 1
  const isLast = currentPage >= totalPages

  // Compact page-number list with `…` gaps for >7 pages.
  const pageNumbers = useMemo(() => {
    const out = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) out.push(i)
      return out
    }
    out.push(1)
    if (currentPage > 3) out.push('…')
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    for (let i = start; i <= end; i++) out.push(i)
    if (currentPage < totalPages - 2) out.push('…')
    out.push(totalPages)
    return out
  }, [currentPage, totalPages])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-2 sm:py-3 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
      {/* Range + size selector */}
      <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-500 dark:text-neutral-400">
        <Tooltip content={tipLines('Visible row range', 'Shows which rows from the full result set are on this page.')} delay={300} position="top">
          <span className="cursor-default">
            Showing <span className="font-medium text-gray-900 dark:text-neutral-100">{startRow}–{endRow}</span> of{' '}
            <span className="font-medium text-gray-900 dark:text-neutral-100">{totalItems}</span>
          </span>
        </Tooltip>
        <span className="hidden sm:inline-flex items-center gap-1.5">
          <Tooltip content={tipLines('Rows per page', 'Increase this if you want to see more rows on screen.')} delay={300} position="top">
            <span className="cursor-default">Rows per page:</span>
          </Tooltip>
          <select
            value={itemsPerPage}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
            className="h-7 px-1.5 text-xs sm:text-sm rounded-md border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </span>
      </div>

      {/* Page navigation */}
      <div className="flex items-center gap-1">
        <PageNavBtn label={tipLines('First page', 'Jump to the first page of results.')} disabled={isFirst} onClick={() => onPageChange(1)}>
          <ChevronsLeft size={16} strokeWidth={2.25} />
        </PageNavBtn>
        <PageNavBtn label={tipLines('Previous page', 'Go back one page.')} disabled={isFirst} onClick={() => onPageChange(currentPage - 1)}>
          <ChevronLeft size={16} strokeWidth={2.25} />
        </PageNavBtn>
        {pageNumbers.map((n, idx) =>
          n === '…' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-xs text-gray-400 dark:text-neutral-500">…</span>
          ) : (
            <Tooltip key={n} content={tipLines(`Page ${n}`, n === currentPage ? 'You are here.' : 'Jump to this page.')} delay={300} position="top">
              <button
                onClick={() => onPageChange(n)}
                className={`min-w-[28px] h-7 px-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                  n === currentPage
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'
                    : 'text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700'
                }`}
              >
                {n}
              </button>
            </Tooltip>
          ),
        )}
        <PageNavBtn label={tipLines('Next page', 'Go forward one page.')} disabled={isLast} onClick={() => onPageChange(currentPage + 1)}>
          <ChevronRight size={16} strokeWidth={2.25} />
        </PageNavBtn>
        <PageNavBtn label={tipLines('Last page', 'Jump to the last page of results.')} disabled={isLast} onClick={() => onPageChange(totalPages)}>
          <ChevronsRight size={16} strokeWidth={2.25} />
        </PageNavBtn>
      </div>
    </div>
  )
}

const PageNavBtn = ({ label, disabled, onClick, children }) => (
  <Tooltip content={label} delay={300} position="top">
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 flex items-center justify-center rounded-md text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 disabled:text-gray-300 dark:disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  </Tooltip>
)

// ─── Skeleton loaders ──────────────────────────────────────────────────────
//
// Replace the lonely spinner with structural placeholders so the user sees
// the page chrome populating in the right shape while data is still in
// flight. Each skeleton mirrors the matching real table's column widths
// and mobile-card layout so the swap from skeleton → data doesn't reflow.

const SkelBar = ({ className = '' }) => (
  <div className={`bg-gray-200 dark:bg-neutral-700 rounded animate-pulse ${className}`} />
)

// Skeleton for `GrantsTable` — used in the "Shared by me" tab.
const GrantsTableSkeleton = ({ rows = 5 }) => (
  <>
    {/* Mobile card skeleton — matches the real card flex layout. */}
    <div className="md:hidden divide-y divide-gray-200 dark:divide-neutral-700">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-3">
          <SkelBar className="w-[18px] h-[18px] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <SkelBar className="h-5 w-16 rounded-full flex-shrink-0" />
              <SkelBar className="h-4 flex-1 max-w-[180px]" />
            </div>
            <SkelBar className="h-3 w-2/5" />
            <SkelBar className="h-3 w-4/5" />
          </div>
          <SkelBar className="w-7 h-7 flex-shrink-0" />
        </div>
      ))}
    </div>

    {/* Desktop table skeleton — same column widths as the real GrantsTable. */}
    <div className="hidden md:block overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
      <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 lg:min-w-[1000px]">
        <thead className="bg-gray-50 dark:bg-neutral-700">
          <tr>
            <th className="w-[44px] pl-3 lg:pl-4 pr-3 lg:pr-4 py-3"><SkelBar className="w-[18px] h-[18px]" /></th>
            <th className="w-[110px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-10" /></th>
            <th className="px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-20" /></th>
            <th className="w-[260px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-24" /></th>
            <th className="w-[110px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-10" /></th>
            <th className="w-[120px] px-3 lg:px-4 py-3 text-right"><SkelBar className="h-3 w-14 ml-auto" /></th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td className="pl-3 lg:pl-4 pr-3 lg:pr-4 py-3"><SkelBar className="w-[18px] h-[18px]" /></td>
              <td className="px-3 lg:px-4 py-3"><SkelBar className="h-5 w-16 rounded-full" /></td>
              <td className="px-3 lg:px-4 py-3 space-y-1.5">
                <SkelBar className="h-4 w-3/5" />
                <SkelBar className="h-3 w-1/3" />
              </td>
              <td className="px-3 lg:px-4 py-3 space-y-1.5">
                <SkelBar className="h-4 w-3/4" />
                <SkelBar className="h-3 w-4/5" />
              </td>
              <td className="px-3 lg:px-4 py-3"><SkelBar className="h-4 w-12" /></td>
              <td className="px-3 lg:px-4 py-3 text-right"><SkelBar className="w-7 h-7 ml-auto" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
)

// Skeleton for `WithMeTable` — used in the "Shared with me" tab. Read-only
// rows; no checkbox / actions column.
const WithMeTableSkeleton = ({ rows = 5 }) => (
  <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
    <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[600px] lg:min-w-[1100px]">
      <thead className="bg-gray-50 dark:bg-neutral-700">
        <tr>
          <th className="lg:w-[360px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-16" /></th>
          <th className="hidden sm:table-cell w-[220px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-16" /></th>
          <th className="hidden md:table-cell w-[160px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-12" /></th>
          <th className="w-[110px] sm:w-[140px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-12" /></th>
          <th className="hidden sm:table-cell w-[110px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-14" /></th>
          <th className="hidden md:table-cell w-[130px] px-3 lg:px-4 py-3 text-left"><SkelBar className="h-3 w-14" /></th>
        </tr>
      </thead>
      <tbody className="bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700">
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i}>
            <td className="px-3 lg:px-4 py-3 space-y-1.5">
              <SkelBar className="h-4 w-3/4" />
              {/* Mobile-only secondary line that shows owner+folder inline. */}
              <SkelBar className="sm:hidden h-3 w-1/2" />
            </td>
            <td className="hidden sm:table-cell px-3 lg:px-4 py-3 space-y-1.5">
              <SkelBar className="h-4 w-3/4" />
              <SkelBar className="h-3 w-4/5" />
            </td>
            <td className="hidden md:table-cell px-3 lg:px-4 py-3"><SkelBar className="h-4 w-2/3" /></td>
            <td className="px-3 lg:px-4 py-3"><SkelBar className="h-5 w-16 rounded-full" /></td>
            <td className="hidden sm:table-cell px-3 lg:px-4 py-3"><SkelBar className="h-4 w-12" /></td>
            <td className="hidden md:table-cell px-3 lg:px-4 py-3"><SkelBar className="h-4 w-16" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

// ─── Misc atoms ─────────────────────────────────────────────────────────────

const FullSpinner = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 size={20} className="animate-spin text-blue-600" />
  </div>
)

const EmptyBlock = ({ icon: Icon, title, message }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center px-4">
    <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-neutral-700 flex items-center justify-center mb-4">
      <Icon size={22} className="text-gray-500 dark:text-neutral-400" />
    </div>
    <h2 className="text-base font-semibold text-gray-900 dark:text-neutral-100">
      {title}
    </h2>
    <p className="text-sm text-gray-600 dark:text-neutral-400 mt-2 max-w-md">
      {message}
    </p>
  </div>
)

export default SharedPage
