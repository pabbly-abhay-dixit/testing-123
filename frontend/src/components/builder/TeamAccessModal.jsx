import { useState, useEffect, useCallback, useRef } from 'react'
import { Users, X, UserPlus, Trash2, RotateCcw, Loader2, Mail, AlertTriangle, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { teamAccessAPI, creditsAPI } from '../../services/api'
import Select from '../ui/Select'

// Full set — visible to Owner inviters only. Full Control inviters cannot
// grant Full Control to anyone else (backend enforces this; frontend
// filters the option to keep the UX honest).
const ROLE_OPTIONS_OWNER = [
  { value: 'full_control', label: 'Full Control' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]
// Restricted set — visible to Full Control inviters. They may invite,
// promote, or demote between editor/viewer; they cannot create or promote
// to full_control.
const ROLE_OPTIONS_RESTRICTED = [
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]
const ROLE_LABELS = {
  full_control: 'Full Control',
  editor: 'Editor',
  viewer: 'Viewer',
}

// 1 credit = 1000 milli-credits (matches backend; see CLAUDE.md credit-system).
const MILLI_PER_CREDIT = 1000

const milliToCredits = (m) => (m == null ? 0 : m / MILLI_PER_CREDIT)
const creditsToMilli = (c) => Math.round(Number(c) * MILLI_PER_CREDIT)
const fmtCredits = (m) =>
  milliToCredits(m).toLocaleString(undefined, { maximumFractionDigits: 2 })

/**
 * Team Access modal — owner-side collaborator management.
 *
 * Modes:
 * - `agent` prop set → workflow-scope (`/api/workflows/:id/...`)
 * - `folder` prop set → folder-scope (`/api/folders/:id/...`)
 *
 * Styling matches ShareWorkflowModal — same rounded-xl shell, primary-X
 * accents, full dark mode.
 *
 * See docs/features/team-access.md §10.
 */
const TeamAccessModal = ({ agent, folder, onClose }) => {
  const isFolder = !!folder
  const targetId = isFolder ? folder?.id : agent?.id
  const targetName = isFolder ? folder?.name : agent?.name
  // Inviter's own role on this resource determines which roles they can grant.
  // Workflows expose `effective_role` on the agent doc; folders are owner-only
  // at the FE entry point today, so default to owner there. A missing/unknown
  // value also defaults to owner — the backend re-validates regardless.
  const inviterRole = isFolder ? 'owner' : (agent?.effective_role || 'owner')
  const inviterIsOwner = inviterRole === 'owner'
  const roleOptions = inviterIsOwner ? ROLE_OPTIONS_OWNER : ROLE_OPTIONS_RESTRICTED

  const [phase, setPhase] = useState('enter')
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState([])
  const [pending, setPending] = useState([])

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviting, setInviting] = useState(false)
  const [ownerBalanceMilli, setOwnerBalanceMilli] = useState(null)

  // Tracks whether any mutation that the parent grants table cares about
  // happened during this modal session (invite / role / remove). Cap changes
  // are intentionally excluded — the parent doesn't render cap state, so
  // refetching after a pure cap edit would just churn the list for nothing.
  const mutatedRef = useRef(false)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase('visible')))
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') doClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apiList = isFolder
    ? teamAccessAPI.listFolderCollaborators
    : teamAccessAPI.listWorkflowCollaborators
  const apiAdd = isFolder
    ? teamAccessAPI.addFolderCollaborator
    : teamAccessAPI.addWorkflowCollaborator
  const apiUpdate = isFolder
    ? teamAccessAPI.updateFolderCollaborator
    : teamAccessAPI.updateWorkflowCollaborator
  const apiRemove = isFolder
    ? teamAccessAPI.removeFolderCollaborator
    : teamAccessAPI.removeWorkflowCollaborator

  const refresh = useCallback(() => {
    if (!targetId) return
    setLoading(true)
    apiList(targetId)
      .then((res) => {
        setActive(res.data?.active || [])
        setPending(res.data?.pending || [])
      })
      .catch((err) => {
        toast.error(err.response?.data?.error || 'Failed to load team access')
      })
      .finally(() => setLoading(false))
  }, [targetId, apiList])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    creditsAPI
      .getBalance()
      .then((res) => setOwnerBalanceMilli(res.data?.balance ?? 0))
      .catch(() => setOwnerBalanceMilli(0))
  }, [])

  const doClose = () => {
    setPhase('exit')
    setTimeout(() => onClose?.({ mutated: mutatedRef.current }), 160)
  }

  // Suppress backdrop click while the user has an in-progress invite
  // they haven't sent yet. Role changes / removals are persisted server-
  // side the moment the user makes them (see handleRoleChange /
  // handleRemove), so those don't need protection — only the unsent
  // invite-email field could be lost to an accidental click-outside.
  // Escape and the header X button still close.
  const inviteDirty = inviteEmail.trim().length > 0
  const onBackdropClick = () => { if (!inviteDirty) doClose() }

  const handleInvite = async (e) => {
    e?.preventDefault?.()
    const emails = inviteEmail
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
    if (emails.length === 0) {
      toast.error('Enter at least one email')
      return
    }
    const invalid = emails.filter((em) => !em.includes('@'))
    if (invalid.length > 0) {
      toast.error(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`)
      return
    }
    setInviting(true)
    let successes = 0
    let pendings = 0
    const failures = []
    for (const email of emails) {
      try {
        const res = await apiAdd(targetId, { email, role: inviteRole })
        if (res.data?.pending) pendings++
        else successes++
      } catch (err) {
        failures.push(`${email} (${err.response?.data?.error || 'failed'})`)
      }
    }
    setInviting(false)
    if (successes + pendings > 0) {
      mutatedRef.current = true
      const parts = []
      if (successes > 0) parts.push(`${successes} added`)
      if (pendings > 0) parts.push(`${pendings} pending signup`)
      toast.success(parts.join(', '))
      setInviteEmail('')
    }
    if (failures.length > 0) {
      toast.error(`Failed: ${failures.join('; ')}`)
    }
    refresh()
  }

  const handleRoleChange = async (collabUserId, role) => {
    try {
      await apiUpdate(targetId, collabUserId, { role })
      mutatedRef.current = true
      toast.success('Role updated')
      refresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update role')
    }
  }

  const handleRemove = async (collabUserId, name) => {
    if (!window.confirm(
      `Remove ${name || 'this collaborator'} from the ${isFolder ? 'folder' : 'workflow'}?`
    )) return
    try {
      await apiRemove(targetId, collabUserId)
      mutatedRef.current = true
      toast.success('Removed')
      refresh()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove')
    }
  }

  const isVisible = phase === 'visible'
  const isExit = phase === 'exit'

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Visual backdrop only — pointer-events disabled so the centering
          wrapper below receives outside-clicks. */}
      <div
        className="fixed inset-0 transition-opacity pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: isExit ? 0 : isVisible ? 1 : 0,
          transitionDuration: isExit ? '150ms' : '200ms',
        }}
      />

      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onBackdropClick}>
        <div
          className="w-full max-w-[560px]"
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
            className="relative rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex flex-col max-h-[85vh]"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)' }}
          >
            {/* Header — icon + title row, subtitle = resource name on its own
                line so it doesn't compete with the H2 for hierarchy. */}
            <div className="flex items-start gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-neutral-200 dark:border-neutral-700">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Users size={17} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2
                  className="text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-50 truncate"
                  style={{ letterSpacing: '-0.011em' }}
                >
                  Team Access
                </h2>
                <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate first-letter:uppercase mt-0.5">
                  {isFolder ? 'Folder' : 'Workflow'} · {targetName || (isFolder ? 'this folder' : 'this workflow')}
                </p>
              </div>
              <button
                onClick={doClose}
                aria-label="Close"
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Invite form — email + permission row + invite cta on its
                  own line, not competing with the helper text. */}
              <form
                onSubmit={handleInvite}
                className="px-5 sm:px-6 py-5 border-b border-neutral-200 dark:border-neutral-700 space-y-4"
              >
                <div>
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1.5 flex items-center gap-1.5">
                    <Mail size={13} /> Invite by Email
                  </label>
                  <textarea
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="alice@example.com, bob@example.com&#10;Or one email per line"
                    rows={2}
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
                    value={inviteRole}
                    onChange={setInviteRole}
                    options={roleOptions}
                    size="md"
                    panelWidth="w-40"
                    align="right"
                    triggerClassName="rounded-xl w-40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={inviting}
                  className="w-full h-9 inline-flex items-center justify-center gap-1.5 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {inviting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  Send Invite
                </button>
              </form>

              {/* Collaborators section — title + count, then list or empty */}
              <div className="px-5 sm:px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-200 inline-flex items-center gap-1.5">
                    <Users size={13} /> Collaborators
                    {(active.length + pending.length) > 0 && (
                      <span className="text-xs font-normal text-neutral-400 dark:text-neutral-500">
                        · {active.length + pending.length}
                      </span>
                    )}
                  </h3>
                </div>

                {loading ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 size={18} className="animate-spin text-neutral-400" />
                  </div>
                ) : active.length === 0 && pending.length === 0 ? (
                  <div className="py-8 text-center bg-neutral-50 dark:bg-neutral-900/50 border border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl">
                    <div className="w-10 h-10 mx-auto mb-2.5 rounded-full bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center">
                      <Users size={16} className="text-neutral-400 dark:text-neutral-500" />
                    </div>
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                      No collaborators yet
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Invite a teammate using the form above.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-700 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                    {active.map((c) => (
                      <ActiveRow
                        key={c.user_id}
                        collab={c}
                        onRoleChange={handleRoleChange}
                        onRemove={handleRemove}
                        ownerBalanceMilli={ownerBalanceMilli}
                        inviterIsOwner={inviterIsOwner}
                      />
                    ))}
                    {pending.map((p) => (
                      <PendingRow key={`p-${p.email}`} pending={p} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const Avatar = ({ name, email }) => {
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[12px] font-semibold flex-shrink-0">
      {initial}
    </div>
  )
}

const ActiveRow = ({ collab, onRoleChange, onRemove, ownerBalanceMilli, inviterIsOwner }) => {
  const [showCap, setShowCap] = useState(false)
  // Role select: an Owner inviter can pick any of the three roles. A
  // FullControl inviter sees [editor, viewer]; if the row's current role
  // is full_control we still surface it as a non-selectable trailing
  // option so the dropdown displays the current value correctly. Picking
  // editor/viewer demotes the collaborator (allowed by backend); picking
  // full_control again would be rejected, so we keep it disabled.
  const baseOptions = inviterIsOwner ? ROLE_OPTIONS_OWNER : ROLE_OPTIONS_RESTRICTED
  const showStaticFullControl = !inviterIsOwner && collab.role === 'full_control'
  const options = showStaticFullControl
    ? [
        { value: 'full_control', label: 'Full Control', hint: 'Owner only', disabled: true },
        ...baseOptions,
      ]
    : baseOptions
  return (
    <li className="px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Avatar name={collab.name} email={collab.email} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate first-letter:uppercase">
              {collab.name || collab.email}
            </div>
            {collab.name && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {collab.email}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Select
            value={collab.role}
            onChange={(v) => onRoleChange(collab.user_id, v)}
            options={options}
            size="sm"
            panelWidth="w-32"
            align="right"
          />
          <button
            onClick={() => setShowCap((v) => !v)}
            className={`h-7 px-2 text-[11.5px] rounded-md border transition-colors ${
              showCap
                ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'
            }`}
            title="Set an AI Credit limit for this collaborator"
          >
            Limit AI credits
          </button>
          <button
            onClick={() => onRemove(collab.user_id, collab.name)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Remove"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {showCap && (
        <CapPanel
          collabUserId={collab.user_id}
          ownerBalanceMilli={ownerBalanceMilli}
        />
      )}
    </li>
  )
}

const PendingRow = ({ pending }) => (
  <li className="px-5 py-3 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
        <Mail size={13} />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
          {pending.email}
        </div>
        <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertTriangle size={11} />
          Pending — activates on signup
        </div>
      </div>
    </div>
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 flex-shrink-0">
      {ROLE_LABELS[pending.role] || pending.role}
    </span>
  </li>
)

const CapPanel = ({ collabUserId, ownerBalanceMilli }) => {
  const [cap, setCap] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingLimit, setSavingLimit] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [draftLimitCredits, setDraftLimitCredits] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    teamAccessAPI
      .getCap(collabUserId)
      .then((res) => {
        setCap(res.data)
        setDraftLimitCredits(
          res.data?.max_milli_limit != null
            ? String(milliToCredits(res.data.max_milli_limit))
            : '',
        )
      })
      .catch(() => setCap(null))
      .finally(() => setLoading(false))
  }, [collabUserId])

  useEffect(() => { load() }, [load])

  const ownerLimitCredits =
    ownerBalanceMilli != null ? milliToCredits(ownerBalanceMilli) : null

  const handleSaveLimit = async () => {
    const credits = Number(draftLimitCredits)
    if (Number.isNaN(credits) || credits < 0) {
      toast.error('Enter a non-negative number of AI credits')
      return
    }
    if (ownerLimitCredits != null && credits > ownerLimitCredits) {
      toast.error(
        `AI Credit limit can't exceed your current balance (${ownerLimitCredits.toLocaleString(undefined, { maximumFractionDigits: 2 })} AI credits).`,
      )
      return
    }
    setSavingLimit(true)
    try {
      await teamAccessAPI.updateCap(collabUserId, {
        max_milli_limit: creditsToMilli(credits),
      })
      toast.success('AI Credit limit updated')
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update AI Credit limit')
    } finally {
      setSavingLimit(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset usage for this collaborator?')) return
    setResetting(true)
    try {
      await teamAccessAPI.resetCap(collabUserId)
      toast.success('Usage reset')
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-2 ml-10 p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg flex justify-center border border-neutral-200/70 dark:border-neutral-700">
        <Loader2 size={14} className="animate-spin text-neutral-400" />
      </div>
    )
  }

  const used = cap?.used_milli ?? 0
  const limit = cap?.max_milli_limit
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return (
    <div className="mt-2 ml-10 p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg border border-neutral-200/70 dark:border-neutral-700 space-y-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-neutral-600 dark:text-neutral-400">
          Usage
        </span>
        <span className="text-neutral-600 dark:text-neutral-300">
          {fmtCredits(used)} / {limit != null ? fmtCredits(limit) : '∞'} AI credits
        </span>
      </div>
      {limit ? (
        <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step="0.01"
          max={ownerLimitCredits ?? undefined}
          value={draftLimitCredits}
          onChange={(e) => setDraftLimitCredits(e.target.value)}
          placeholder="AI Credit limit"
          className="flex-1 h-7 px-2 text-[11.5px] rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60"
          style={{ boxShadow: 'none' }}
        />
        <button
          onClick={handleSaveLimit}
          disabled={savingLimit}
          className="h-7 px-2.5 text-[11.5px] font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-all active:scale-[0.97]"
        >
          {savingLimit ? '…' : 'Save'}
        </button>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="h-7 px-2.5 text-[11.5px] font-medium rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-white dark:hover:bg-[#2c2c2c] inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
        >
          <RotateCcw size={11} />
          Reset
        </button>
      </div>
      {ownerLimitCredits != null && (
        <p className="text-[10.5px] text-neutral-500 dark:text-neutral-500">
          Maximum: {ownerLimitCredits.toLocaleString(undefined, { maximumFractionDigits: 2 })} AI credits
          (your current balance).
        </p>
      )}
    </div>
  )
}

export default TeamAccessModal
