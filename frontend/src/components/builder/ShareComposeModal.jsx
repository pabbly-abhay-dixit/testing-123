import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Share2, X, UserPlus, Mail, Loader2, Workflow, Folder, Search, Check, ChevronDown, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { teamAccessAPI, workflowsAPI, foldersAPI } from '../../services/api'
import Select from '../ui/Select'

// The composer fans out to one or more resources owned by the current user
// (the picker only shows the user's own workflows/folders), so the inviter
// is always the resource Owner and may grant any of the three roles. If a
// future change exposes shared resources here, gate `full_control` on the
// resource's `effective_role === 'owner'`.
const ROLE_OPTIONS = [
  { value: 'full_control', label: 'Full Control' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

/**
 * Compose modal — single entry point to share any of my workflows or folders
 * with one or more emails. Wraps the per-resource invite endpoints in a
 * single composer:
 *   1. Pick resource type (workflow / folder)
 *   2. Pick the specific resource (searchable list of mine)
 *   3. Enter one or more emails (comma / newline separated)
 *   4. Pick role
 *   5. Submit — fans out add-collaborator calls per email
 */
const ShareComposeModal = ({ onClose, onShared, initialResourceType = 'workflow', initialResourceIds = null }) => {
  const [phase, setPhase] = useState('enter')
  const [resourceType, setResourceType] = useState(initialResourceType)
  // Selections are kept PER TYPE so the user can flip tabs to *look* at the
  // other side without losing their picks. But a single share targets
  // exactly one resource type — so the moment the user *picks* something
  // on the active tab, the other tab's selection is dropped. Net effect:
  // tab-flipping is harmless; tab-flipping + selecting commits you to
  // that type and forgets the other side's picks. Matches the user's
  // explicit rule: "either give workflow team access or folder team
  // access not both".
  const [workflowIds, setWorkflowIds] = useState(() =>
    initialResourceType === 'workflow' ? new Set(initialResourceIds || []) : new Set()
  )
  const [folderIds, setFolderIds] = useState(() =>
    initialResourceType === 'folder' ? new Set(initialResourceIds || []) : new Set()
  )
  const resourceIds = resourceType === 'workflow' ? workflowIds : folderIds
  const setResourceIds = (updater) => {
    const setter = resourceType === 'workflow' ? setWorkflowIds : setFolderIds
    const otherSetter = resourceType === 'workflow' ? setFolderIds : setWorkflowIds
    setter(updater)
    otherSetter(new Set())
  }
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState('editor')
  const [submitting, setSubmitting] = useState(false)

  const [workflows, setWorkflows] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase('visible')))
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') doClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    Promise.all([
      workflowsAPI.getAll().catch(() => ({ data: { agents: [] } })),
      foldersAPI.getAll().catch(() => ({ data: { folders: [] } })),
    ])
      .then(([wfRes, fdRes]) => {
        setWorkflows(wfRes.data?.agents || [])
        setFolders(fdRes.data?.folders || [])
      })
      .finally(() => setLoading(false))
  }, [])

  // Defensive re-sync: when the workflows/folders list finishes loading
  // after the modal mounts, re-apply caller-provided ids that match real
  // options to the *initial* type's set. Catches the edge case where
  // useState's initializer ran before the data was available.
  const initialAppliedRef = useRef(false)
  useEffect(() => {
    if (loading || initialAppliedRef.current) return
    if (!initialResourceIds || initialResourceIds.length === 0) {
      initialAppliedRef.current = true
      return
    }
    const pool = initialResourceType === 'folder' ? folders : workflows
    const valid = initialResourceIds.filter((id) => pool.some((r) => r.id === id))
    if (valid.length > 0) {
      const setter = initialResourceType === 'folder' ? setFolderIds : setWorkflowIds
      setter(new Set(valid))
    }
    initialAppliedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, workflows, folders])

  const options = useMemo(() => {
    if (resourceType === 'workflow') {
      return workflows.map((w) => ({
        value: w.id,
        label: w.name || 'Untitled',
        hint: w.status || '',
      }))
    }
    return folders.map((f) => ({
      value: f.id,
      label: f.name || 'Untitled',
      hint: f.agent_count != null ? `${f.agent_count} workflow${f.agent_count === 1 ? '' : 's'}` : '',
    }))
  }, [resourceType, workflows, folders])

  const doClose = () => {
    setPhase('exit')
    setTimeout(() => onClose?.(), 160)
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    const parsed = emails
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
    if (resourceIds.size === 0) {
      toast.error(`Pick at least one ${resourceType} to share`)
      return
    }
    if (parsed.length === 0) {
      toast.error('Add at least one email')
      return
    }
    const invalid = parsed.filter((em) => !em.includes('@'))
    if (invalid.length > 0) {
      toast.error(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`)
      return
    }

    const api = resourceType === 'workflow'
      ? teamAccessAPI.addWorkflowCollaborator
      : teamAccessAPI.addFolderCollaborator

    setSubmitting(true)
    let success = 0
    let pending = 0
    // Track failures per (resource, email) so the user sees which combo failed.
    // Sequential keeps server load predictable for human-curated bulk shares.
    const failures = []
    const ids = [...resourceIds]
    for (const id of ids) {
      for (const email of parsed) {
        try {
          const res = await api(id, { email, role })
          if (res.data?.pending) pending++
          else success++
        } catch (err) {
          failures.push(`${email} (${err.response?.data?.error || 'failed'})`)
        }
      }
    }
    setSubmitting(false)
    if (success + pending > 0) {
      const parts = []
      if (success > 0) parts.push(`${success} added`)
      if (pending > 0) parts.push(`${pending} pending signup`)
      toast.success(parts.join(', '))
      onShared?.()
      doClose()
    }
    if (failures.length > 0) {
      // Cap message length — bulk shares can produce many failures.
      const head = failures.slice(0, 3).join('; ')
      const tail = failures.length > 3 ? ` and ${failures.length - 3} more` : ''
      toast.error(`Failed: ${head}${tail}`)
    }
  }

  const isVisible = phase === 'visible'
  const isExit = phase === 'exit'
  const ResourceIcon = resourceType === 'workflow' ? Workflow : Folder

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="fixed inset-0 transition-opacity"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: isExit ? 0 : isVisible ? 1 : 0,
          transitionDuration: isExit ? '150ms' : '200ms',
        }}
        onClick={doClose}
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          className="w-full max-w-[520px]"
          style={{
            opacity: isExit ? 0 : isVisible ? 1 : 0,
            transform: isExit
              ? 'translateY(6px) scale(0.98)'
              : isVisible
              ? 'translateY(0) scale(1)'
              : 'translateY(10px) scale(0.97)',
            transition: isExit
              ? 'all 150ms ease-in'
              : 'all 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex flex-col"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)' }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-neutral-200/70 dark:border-neutral-700">
              <div className="flex-shrink-0 w-9 h-9 rounded-[10px] bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Share2 size={17} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <h2
                  className="text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-50"
                  style={{ letterSpacing: '-0.011em' }}
                >
                  Share Workflow or Folder
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Invite teammates to collaborate.
                </p>
              </div>
              <button
                onClick={doClose}
                aria-label="Close"
                className="flex-shrink-0 self-start w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col">
              {/* Body — scrolls if content overflows on small screens */}
              <div className="px-5 sm:px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(85vh-13rem)]">
                {/* Type segmented control — compact, sits inline with the section label */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Share a
                  </span>
                  <div className="inline-flex items-center bg-neutral-100 dark:bg-neutral-700/60 rounded-xl p-1">
                    <button
                      type="button"
                      onClick={() => setResourceType('workflow')}
                      className={`px-3 py-1 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                        resourceType === 'workflow'
                          ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                      }`}
                    >
                      <Workflow size={13} />
                      Workflow
                    </button>
                    <button
                      type="button"
                      onClick={() => setResourceType('folder')}
                      className={`px-3 py-1 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                        resourceType === 'folder'
                          ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                      }`}
                    >
                      <Folder size={13} />
                      Folder
                    </button>
                  </div>
                </div>

                {/* Resource picker */}
                <div>
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1.5 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <ResourceIcon size={13} />
                      <span className="capitalize">{resourceType}s</span>
                    </span>
                    {resourceIds.size > 0 && (
                      <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                        {resourceIds.size} selected
                      </span>
                    )}
                  </label>
                  {loading ? (
                    <div className="h-9 flex items-center justify-center text-sm text-neutral-400">
                      <Loader2 size={13} className="animate-spin mr-1.5" /> Loading…
                    </div>
                  ) : options.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 py-2">
                      You don't own any {resourceType}s yet.
                    </p>
                  ) : (
                    <MultiResourcePicker
                      options={options}
                      selected={resourceIds}
                      onToggle={(id) => {
                        setResourceIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(id)) next.delete(id)
                          else next.add(id)
                          return next
                        })
                      }}
                      onSelectAll={() => setResourceIds(new Set(options.map((o) => o.value)))}
                      onClearAll={() => setResourceIds(new Set())}
                      placeholder={`Choose ${resourceType}s…`}
                      searchPlaceholder={`Search ${resourceType}s…`}
                      hintLabel={resourceType === 'folder' ? 'Workflows' : 'Status'}
                      hintIsStatus={resourceType !== 'folder'}
                    />
                  )}
                </div>

                {/* Email + role grouped: emails take the full width, role
                    sits compact below — keeps the form vertically scannable
                    instead of the previous role-on-left / buttons-on-right
                    split that read as two unrelated rows. */}
                <div>
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1.5 flex items-center gap-1.5">
                    <Mail size={13} /> Invite by Email
                  </label>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    placeholder="alice@example.com, bob@example.com&#10;Or one email per line"
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 resize-none transition-shadow"
                  />
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5">
                    Separate multiple emails with commas or new lines.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 inline-flex items-center gap-1.5">
                    <Shield size={13} /> Permission
                  </label>
                  <Select
                    value={role}
                    onChange={setRole}
                    options={ROLE_OPTIONS}
                    size="md"
                    panelWidth="w-40"
                    triggerClassName="rounded-xl w-40"
                  />
                </div>
              </div>

              {/* Footer — bordered, right-aligned actions group together */}
              <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-900/40 rounded-b-2xl">
                <button
                  type="button"
                  onClick={doClose}
                  className="h-9 px-4 text-sm font-medium rounded-xl text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading || resourceIds.size === 0}
                  className="h-9 px-4 inline-flex items-center gap-1.5 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  Share
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

// Inline multi-select with search + checkbox list. Trigger renders the
// selected count + first label; expanded panel anchors directly below the
// trigger (no portal — the parent modal already centers in the viewport
// and is wide enough to host a 320-px tall list without clipping).
// Status meta — dot color per workflow status. Mirrors the dashboard's
// STATUS_META so the picker reads the same as the table users see daily.
const STATUS_DOT = {
  active: 'bg-emerald-500',
  ready: 'bg-neutral-400',
  draft: 'bg-blue-500',
  trashed: 'bg-red-500',
}

const STATUS_LABEL = {
  active: 'Active',
  ready: 'Inactive',
  draft: 'Draft',
  trashed: 'Trashed',
}

const MultiResourcePicker = ({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  placeholder,
  searchPlaceholder,
  hintLabel = 'Status',
  hintIsStatus = true,
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  // Panel is portaled to document.body so the modal's overflow / scroll
  // boundary doesn't clip it. We track viewport coordinates against the
  // trigger and reposition on open + scroll.
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0, openUp: false })

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const update = () => {
      const r = triggerRef.current.getBoundingClientRect()
      const estH = 360
      const spaceBelow = window.innerHeight - r.bottom
      const openUp = spaceBelow < estH && r.top > spaceBelow
      setPanelPos({
        top: openUp ? r.top - 4 : r.bottom + 4,
        left: r.left,
        width: r.width,
        openUp,
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const label = String(o.label || '').toLowerCase()
      const hint = String(o.hint || '').toLowerCase()
      return label.includes(q) || hint.includes(q)
    })
  }, [options, search])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((o) => selected.has(o.value))

  const triggerLabel = useMemo(() => {
    if (selected.size === 0) return placeholder
    const firstLabel = options.find((o) => selected.has(o.value))?.label || ''
    if (selected.size === 1) return firstLabel
    return `${firstLabel} +${selected.size - 1} more`
  }, [selected, options, placeholder])

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-9 px-3 inline-flex items-center justify-between gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 transition-colors"
      >
        <span className={`truncate ${selected.size === 0 ? 'text-neutral-400 dark:text-neutral-500' : 'first-letter:uppercase'}`}>
          {triggerLabel}
        </span>
        <ChevronDown
          size={13}
          className={`text-neutral-400 dark:text-neutral-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[10000] bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl overflow-hidden"
          style={{
            top: panelPos.openUp ? undefined : panelPos.top,
            bottom: panelPos.openUp ? window.innerHeight - panelPos.top : undefined,
            left: panelPos.left,
            width: panelPos.width,
          }}
        >
          {/* Search */}
          <div className="relative border-b border-neutral-200 dark:border-neutral-700">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 pl-8 pr-7 text-sm bg-transparent text-neutral-800 dark:text-neutral-100 placeholder-neutral-400 outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Table header — checkbox + NAME + STATUS/WORKFLOWS, mirrors
              the dashboard table so the visual reads "this is a list of
              things you'd see on the dashboard". Master checkbox state
              tracks the FILTERED set so selecting/clearing all respects
              the active search query. */}
          {options.length > 0 && (() => {
            const masterState = filtered.length === 0
              ? 'none'
              : allFilteredSelected
              ? 'all'
              : filtered.some((o) => selected.has(o.value))
              ? 'some'
              : 'none'
            const toggleMaster = () => {
              if (masterState === 'all') {
                filtered.forEach((o) => { if (selected.has(o.value)) onToggle(o.value) })
              } else if (search.trim()) {
                filtered.forEach((o) => { if (!selected.has(o.value)) onToggle(o.value) })
              } else {
                onSelectAll()
              }
            }
            return (
              <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-700 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                <button
                  type="button"
                  onClick={toggleMaster}
                  aria-label={masterState === 'all' ? 'Clear all' : 'Select all'}
                  className={`w-[15px] h-[15px] rounded flex items-center justify-center flex-shrink-0 transition-colors border-[1.5px] ${
                    masterState === 'all'
                      ? 'bg-blue-600 border-blue-600'
                      : masterState === 'some'
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-500'
                  }`}
                >
                  {masterState === 'all' && <Check size={10} className="text-white" strokeWidth={3} />}
                  {masterState === 'some' && <span className="block w-[7px] h-[1.5px] bg-white rounded-sm" />}
                </button>
                <span className="flex-1">Name</span>
                <span className="w-24 text-right">{hintLabel}</span>
              </div>
            )
          })()}

          {/* Rows — table-style, no row hover-selected merge so the
              status hint stays readable when the row is checked. */}
          <div className="max-h-[260px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
                No matches
              </p>
            ) : (
              filtered.map((opt) => {
                const isSelected = selected.has(opt.value)
                const statusKey = String(opt.hint || '').toLowerCase()
                return (
                  <button
                    type="button"
                    key={String(opt.value)}
                    onClick={() => onToggle(opt.value)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors border-b border-neutral-100 dark:border-neutral-700/50 last:border-b-0 ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-500/10'
                        : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                    }`}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span
                      className={`w-[15px] h-[15px] rounded flex items-center justify-center flex-shrink-0 transition-colors border-[1.5px] ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600'
                          : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-500'
                      }`}
                    >
                      {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex-1 truncate first-letter:uppercase text-neutral-800 dark:text-neutral-200">
                      {opt.label}
                    </span>
                    <span className="w-24 flex justify-end items-center flex-shrink-0">
                      {opt.hint ? (
                        hintIsStatus ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[statusKey] || 'bg-neutral-400'}`} />
                            {STATUS_LABEL[statusKey] || opt.hint}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                            {opt.hint}
                          </span>
                        )
                      ) : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default ShareComposeModal
