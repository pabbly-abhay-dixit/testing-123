import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Bot, Zap, Key } from 'lucide-react'
import { shareAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

const SharePage = () => {
  const { token } = useParams()
  const navigate = useNavigate()
  const { isAuthenticated, loading: authLoading } = useAuth()

  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cloning, setCloning] = useState(false)

  useEffect(() => {
    shareAPI.getPreview(token)
      .then((res) => setPreview(res.data))
      .catch((err) => setError(err.response?.data?.error || 'This share link is invalid or has been revoked.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleClone = async () => {
    if (!isAuthenticated) {
      // Production: SSO redirect URL is set, send straight to accounts.
      // Local dev: fall back to /login. Either way, after login the user
      // lands back on /share/:token via the redirect parameter.
      const ssoUrl = import.meta.env.VITE_SSO_REDIRECT_URL
      const returnPath = `/share/${token}`
      if (ssoUrl) {
        sessionStorage.setItem('post_login_redirect', returnPath)
        window.location.replace(ssoUrl)
      } else {
        navigate(`/login?redirect=${encodeURIComponent(returnPath)}`)
      }
      return
    }
    setCloning(true)
    try {
      const res = await shareAPI.clone(token)
      const newAgent = res.data
      const credCount = newAgent.credential_keys?.length || 0
      toast.success(
        credCount > 0
          ? `Workflow added! Fill in ${credCount} credential${credCount === 1 ? '' : 's'} to activate.`
          : 'Workflow added to your workspace!',
      )
      navigate(`/workflows/${newAgent.slug || newAgent.id}`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add workflow. Please try again.')
    } finally {
      setCloning(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#1a1a1a]">
        <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-700 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#1a1a1a] p-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <Bot size={28} className="text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-2">Link not found</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-[#1a1a1a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white dark:bg-[#2c2c2c] rounded-2xl shadow-xl border border-neutral-200 dark:border-[#484848] overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-neutral-100 dark:border-[#484848]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
                <Bot size={20} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-bold text-neutral-900 dark:text-neutral-100 truncate">{preview.name}</h1>
                {preview.owner_name && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">Shared by {preview.owner_name}</p>
                )}
                {preview.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5 line-clamp-2">{preview.description}</p>
                )}
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="p-6">
            {/* Steps summary */}
            {preview.steps && preview.steps.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
                  {preview.steps.length} Workflow Step{preview.steps.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-1">
                  {preview.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                      <span className="w-4 h-4 rounded-full bg-neutral-100 dark:bg-[#383838] flex items-center justify-center text-[9px] font-bold text-neutral-500 flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="truncate">{step.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-neutral-100 dark:bg-[#383838] rounded text-neutral-400 capitalize flex-shrink-0">
                        {step.step_type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Credential keys you'll need to fill in */}
            {preview.credential_keys && preview.credential_keys.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-500/10 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Key size={12} className="text-amber-600 dark:text-amber-400" />
                  <p className="text-[10.5px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                    Credentials you'll need ({preview.credential_keys.length})
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.credential_keys.map((k) => (
                    <span
                      key={k}
                      className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-white/70 dark:bg-[#1a1a1a]/70 border border-amber-200/60 dark:border-amber-700/30 text-amber-800 dark:text-amber-200 truncate max-w-full"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] text-amber-700/80 dark:text-amber-300/80 leading-snug">
                  Only the key names are shared. You'll fill in your own values after cloning.
                </p>
              </div>
            )}

            {/* What's included/excluded */}
            <div className="flex gap-6 mb-5 p-3 bg-neutral-50 dark:bg-[#2c2c2c] rounded-lg">
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">Included</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Workflow steps</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ AI instructions</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Credential key names</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">Not included</p>
                <p className="text-[11px] text-neutral-400">✗ Credential values</p>
                <p className="text-[11px] text-neutral-400">✗ Chat history</p>
                <p className="text-[11px] text-neutral-400">✗ Task history</p>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleClone}
              disabled={cloning || authLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
            >
              {cloning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Adding to workspace...
                </>
              ) : (
                <>
                  <Zap size={14} />
                  {authLoading ? 'Loading…' : isAuthenticated ? 'Add to my workspace' : 'Sign in to add to workspace'}
                </>
              )}
            </button>

            <p className="text-center text-[10px] text-neutral-400 dark:text-neutral-500 mt-3">
              This creates a copy in your workspace. Credentials are not shared.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-neutral-400 mt-4">
          Powered by Pabbly AgenticAI
        </p>
      </div>
    </div>
  )
}

export default SharePage
