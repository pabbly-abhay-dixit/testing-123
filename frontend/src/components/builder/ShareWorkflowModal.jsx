import { useState, useEffect, useRef } from 'react'
import { Share2, Copy, Check, X, Trash2, Users, AlertTriangle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { shareAPI } from '../../services/api'
import { useConfirm } from '../ui/ConfirmModal'

const ShareWorkflowModal = ({ agent, onClose }) => {
  const [phase, setPhase] = useState('enter')
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState(null)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const confirm = useConfirm()

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase('visible')))
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') doClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!agent?.id && !agent?.slug) return
    const id = agent.slug || agent.id
    shareAPI.getStatus(id)
      .then((res) => setShare(res.data?.active ? res.data : null))
      .catch(() => setShare(null))
      .finally(() => setLoading(false))
  }, [agent?.id, agent?.slug])

  const doClose = () => {
    setPhase('exit')
    setTimeout(() => onClose?.(), 160)
  }

  const handleCreate = async () => {
    const id = agent.slug || agent.id
    setCreating(true)
    try {
      const res = await shareAPI.create(id)
      setShare({ active: true, ...res.data })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create share link')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async () => {
    const ok = await confirm({
      title: 'Revoke share link?',
      message: 'Anyone holding the current link will no longer be able to view or clone this workflow. You can create a new link afterwards.',
      confirmLabel: 'Revoke Link',
      danger: true,
    })
    if (!ok) return
    const id = agent.slug || agent.id
    setRevoking(true)
    try {
      await shareAPI.revoke(id)
      setShare(null)
      toast.success('Share link revoked')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to revoke link')
    } finally {
      setRevoking(false)
    }
  }

  const handleCopy = async () => {
    if (!share?.share_token) return
    const url = `${window.location.origin}/share/${share.share_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Fallback: select the input
      inputRef.current?.select()
      document.execCommand?.('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const isVisible = phase === 'visible'
  const isExit = phase === 'exit'
  const shareUrl = share?.share_token
    ? `${window.location.origin}/share/${share.share_token}`
    : ''

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
          className="w-full max-w-[480px]"
          style={{
            opacity: isExit ? 0 : isVisible ? 1 : 0,
            transform: isExit ? 'translateY(6px) scale(0.98)' : isVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: isExit ? 'all 150ms ease-in' : 'all 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative rounded-xl bg-white dark:bg-[#222222] border border-neutral-200/70 dark:border-[#484848] overflow-hidden flex flex-col"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)' }}
          >
            {/* Header */}
            <div className="relative z-10 flex items-start gap-3 px-5 pt-5 pb-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-[10px] bg-primary-100 dark:bg-primary-500/15 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                <Share2 size={17} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-50 truncate" style={{ letterSpacing: '-0.011em' }}>
                  Share Workflow
                </h2>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">{agent?.name}</p>
              </div>
              <button
                onClick={doClose}
                aria-label="Close"
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-[#383838]"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 pb-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={18} className="text-neutral-400 animate-spin" />
                </div>
              ) : share ? (
                <>
                  {/* Link row */}
                  <div className="flex items-stretch gap-2">
                    <input
                      ref={inputRef}
                      readOnly
                      value={shareUrl}
                      onClick={(e) => e.target.select()}
                      className="flex-1 min-w-0 h-9 rounded-lg border border-neutral-300 dark:border-[#484848] bg-neutral-50 dark:bg-[#0a0a0a] px-3 text-[12.5px] font-mono text-neutral-700 dark:text-neutral-300 outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/60"
                      style={{ boxShadow: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    />
                    <button
                      onClick={handleCopy}
                      className={`h-9 px-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium rounded-lg border transition-all active:scale-[0.97] ${
                        copied
                          ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'border-neutral-300 dark:border-[#484848] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-[#1f1f1f]'
                      }`}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} />
                      {share.clone_count || 0} clone{share.clone_count === 1 ? '' : 's'}
                    </span>
                    <span className="text-neutral-300 dark:text-neutral-600">•</span>
                    <span>Anyone with this link can clone the workflow</span>
                  </div>

                  {/* What gets shared */}
                  <div className="rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#1a1a1a] p-3">
                    <p className="text-[10.5px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
                      What's shared
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                      <div className="text-emerald-600 dark:text-emerald-400">✓ Workflow steps</div>
                      <div className="text-neutral-400 dark:text-neutral-500">✗ Credential values</div>
                      <div className="text-emerald-600 dark:text-emerald-400">✓ AI instructions</div>
                      <div className="text-neutral-400 dark:text-neutral-500">✗ Chat history</div>
                      <div className="text-emerald-600 dark:text-emerald-400">✓ Credential key names</div>
                      <div className="text-neutral-400 dark:text-neutral-500">✗ Task history</div>
                    </div>
                    <p className="mt-2 pt-2 border-t border-neutral-200 dark:border-[#2a2a2a] text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                      Recipients see the credential names you use (e.g.{' '}
                      <span className="font-mono text-neutral-700 dark:text-neutral-300">OPENWEATHERMAP_API_KEY</span>) but not their
                      values. They fill in their own connections after cloning.
                    </p>
                  </div>

                  {/* Revoke */}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleRevoke}
                      disabled={revoking}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      {revoking ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Revoke Link
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* No link yet */}
                  <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    Create a sharable link. Anyone with the link can clone this workflow into their own workspace — credential values are stripped, but the recipient sees which keys to fill in.
                  </p>

                  <div className="rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-500/10 p-3 flex gap-2.5">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <p className="text-[11.5px] text-amber-700 dark:text-amber-300 leading-relaxed">
                      Inline secrets we detect inside prompts and code (API keys, Bearer tokens) are auto-redacted before cloning. Always review the workflow before sharing.
                    </p>
                  </div>

                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-[13px] font-medium transition-colors disabled:opacity-50"
                  >
                    {creating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Creating link...
                      </>
                    ) : (
                      <>
                        <Share2 size={13} />
                        Create share link
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ShareWorkflowModal
