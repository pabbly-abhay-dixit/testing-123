import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Key, Eye, EyeOff, Pencil, Trash2, Check, X, Loader2, ShieldCheck, Copy, ChevronDown } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import toast from 'react-hot-toast'
import { memoryAPI } from '../../services/api'

const StoredCredentialsCard = forwardRef(({ agentId, onNeedsRedeploy, role }, ref) => {
  // Reveal is gated to owner + full_control (backend gate); editor+ can
  // update/delete. Missing role (`role === undefined`) means the prop wasn't
  // wired — fall through to permissive defaults so legacy call-sites keep
  // working; backend re-validates regardless.
  const canReveal = !role || role === 'owner' || role === 'full_control'
  const canEdit = !role || role === 'owner' || role === 'editor' || role === 'full_control'
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [revealedValues, setRevealedValues] = useState({})
  const [visibleKeys, setVisibleKeys] = useState({})
  const [editingKey, setEditingKey] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [revealing, setRevealing] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [expanded, setExpanded] = useState(true)

  const fetchCredentials = useCallback(async () => {
    if (!agentId) return
    try {
      const res = await memoryAPI.list(agentId)
      setCredentials(res.data?.credentials || [])
    } catch {
      // silent — empty list is fine
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    fetchCredentials()
  }, [fetchCredentials])

  useImperativeHandle(ref, () => ({
    refresh: fetchCredentials,
  }), [fetchCredentials])

  const handleReveal = async (key) => {
    if (visibleKeys[key]) {
      setVisibleKeys((prev) => ({ ...prev, [key]: false }))
      return
    }
    setVisibleKeys({ [key]: true })
    if (!revealedValues[key]) {
      setRevealing((prev) => ({ ...prev, [key]: true }))
      try {
        const res = await memoryAPI.reveal(agentId, key)
        setRevealedValues((prev) => ({ ...prev, [key]: res.data.value }))
      } catch (err) {
        // Surface backend's actual error (e.g. "Only the workflow owner can
        // reveal credential values" for collaborators) instead of a generic
        // "Failed to reveal value".
        toast.error(err.response?.data?.error || 'Failed to reveal value')
        setVisibleKeys((prev) => ({ ...prev, [key]: false }))
      } finally {
        setRevealing((prev) => ({ ...prev, [key]: false }))
      }
    }
  }

  const handleCopy = async (key) => {
    const val = revealedValues[key]
    if (!val) return
    try {
      await navigator.clipboard.writeText(val)
      toast.success('Copied to clipboard')
      setVisibleKeys((prev) => ({ ...prev, [key]: false }))
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleEdit = async (key) => {
    if (!revealedValues[key]) {
      setRevealing((prev) => ({ ...prev, [key]: true }))
      try {
        const res = await memoryAPI.reveal(agentId, key)
        const val = res.data.value
        setRevealedValues((prev) => ({ ...prev, [key]: val }))
        setVisibleKeys((prev) => ({ ...prev, [key]: true }))
        setEditingKey(key)
        setEditValue(val || '')
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to reveal value')
      } finally {
        setRevealing((prev) => ({ ...prev, [key]: false }))
      }
      return
    }
    // Toggle edit off if already editing this key
    if (editingKey === key) {
      handleCancelEdit()
      return
    }
    setEditingKey(key)
    setEditValue(revealedValues[key])
  }

  const handleCancelEdit = () => {
    setEditingKey(null)
    setEditValue('')
  }

  const handleSaveEdit = async () => {
    if (!editingKey || !editValue.trim()) return
    setSaving(true)
    try {
      await memoryAPI.update(agentId, editingKey, { value: editValue.trim() })
      toast.success('Credential updated')
      setRevealedValues((prev) => {
        const next = { ...prev }
        delete next[editingKey]
        return next
      })
      setVisibleKeys((prev) => ({ ...prev, [editingKey]: false }))
      setEditingKey(null)
      setEditValue('')
      onNeedsRedeploy?.()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update credential')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (key) => {
    if (!window.confirm(`Delete credential "${key}"? This cannot be undone.`)) return
    setDeleting(key)
    try {
      await memoryAPI.delete(agentId, key)
      setCredentials((prev) => prev.filter((c) => c.key !== key))
      setRevealedValues((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast.success('Credential deleted')
      onNeedsRedeploy?.()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete credential')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      {/* ── Header + HR ── */}
      <hr className="border-neutral-200 dark:border-[#484848] mb-3" />
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 py-1 group"
      >
        <Key size={13} className="text-neutral-400 dark:text-neutral-500" />
        <Tooltip content="Secrets the workflow uses at runtime (API keys, webhook URLs, tokens) — encrypted at rest and injected into your steps when they run">
          <span className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-400 text-left">
            Stored Credentials
          </span>
        </Tooltip>
        <span className="flex-1" />
        {!loading && credentials.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-[#484848] text-neutral-500 dark:text-neutral-400 min-w-[18px] text-center">
            {credentials.length}
          </span>
        )}
        {loading && <Loader2 size={12} className="animate-spin text-neutral-400 dark:text-neutral-500" />}
        <ChevronDown size={13} className={`text-neutral-400 dark:text-neutral-500 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
      </button>

      {/* ── Expanded Content ── */}
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="py-3 flex items-center justify-center gap-2 text-neutral-400 dark:text-neutral-500">
              <Loader2 size={13} className="animate-spin" />
              <span className="text-[11px]">Loading...</span>
            </div>
          ) : credentials.length === 0 ? (
            <div className="border border-dashed border-neutral-200 dark:border-[#484848] rounded-lg p-3.5">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={13} className="text-neutral-300 dark:text-neutral-600 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
                  API keys and secrets will appear here when you provide them during conversation.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {credentials.map((cred) => {
                const isVisible = visibleKeys[cred.key]
                const isEditing = editingKey === cred.key
                const isRevealing = revealing[cred.key]
                const isDeleting = deleting === cred.key

                return (
                  <div key={cred.key}>
                    {/* Label */}
                    <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1 block truncate">
                      {cred.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </label>

                    {/* Value row — dots / revealed / edit input + action icons */}
                    <div className="flex items-center gap-1.5 border border-neutral-200 dark:border-[#484848] rounded-lg bg-neutral-50 dark:bg-[#2a2a2a] px-3 h-[36px]">
                      {/* ── Content area ── */}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          autoFocus
                          placeholder="Enter new value..."
                          className="flex-1 min-w-0 text-[12px] bg-transparent text-neutral-700 dark:text-neutral-300 outline-none border-none placeholder:text-neutral-400/50"
                          style={{ boxShadow: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                        />
                      ) : (
                        <span className={`flex-1 min-w-0 truncate text-[12px] font-mono text-neutral-700 dark:text-neutral-300 ${isVisible && revealedValues[cred.key] ? 'select-all' : ''}`}>
                          {isVisible && revealedValues[cred.key]
                            ? revealedValues[cred.key]
                            : '••••••••••••••••••••••••••••••'}
                        </span>
                      )}

                      {/* ── Contextual actions (left of fixed icons) ── */}
                      {isEditing && (
                        <Tooltip content="Save">
                          <button onClick={handleSaveEdit} disabled={saving || !editValue.trim()} aria-label="Save" className="p-1 text-emerald-500 hover:text-emerald-600 rounded transition-colors disabled:opacity-40">
                            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          </button>
                        </Tooltip>
                      )}
                      {!isEditing && isVisible && revealedValues[cred.key] && (
                        <Tooltip content="Copy value">
                          <button onClick={() => handleCopy(cred.key)} aria-label="Copy value" className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors">
                            <Copy size={13} />
                          </button>
                        </Tooltip>
                      )}

                      {/* ── Fixed actions (always same position on right) ── */}
                      {/* Reveal: owner-only (decrypted secret value). Hidden for collaborators. */}
                      {canReveal && (
                        isRevealing ? (
                          <span className="p-1"><Loader2 size={13} className="animate-spin text-neutral-400" /></span>
                        ) : (
                          <Tooltip content={isVisible ? 'Hide value' : 'Reveal value'}>
                            <button onClick={() => handleReveal(cred.key)} aria-label={isVisible ? 'Hide value' : 'Reveal value'} className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors">
                              {isVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </Tooltip>
                        )
                      )}
                      {/* Edit / Delete: editor+ (collaborators with edit access can rotate keys). */}
                      {canEdit && (
                        <>
                          <Tooltip content="Edit value">
                            <button onClick={() => handleEdit(cred.key)} aria-label="Edit value" className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors">
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete credential">
                            <button onClick={() => handleDelete(cred.key)} disabled={isDeleting} aria-label="Delete credential" className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors">
                              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

StoredCredentialsCard.displayName = 'StoredCredentialsCard'

export default StoredCredentialsCard
