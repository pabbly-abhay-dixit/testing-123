import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Key, Save, Check, ChevronDown, Search, X, RefreshCw, ExternalLink, Loader2,
  Zap, Eye, EyeOff, Pencil, Trash2, Cpu, Globe, ShieldCheck, Copy,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Tooltip from '../ui/Tooltip'
import { ProviderLogo } from '../../utils/providerLogos'
import { useConfirm } from '../ui/ConfirmModal'
import { keysAPI, adminAPI } from '../../services/api'

const PINNED_HEIGHT = 260

const EMPTY_CUSTOM_FORM = {
  provider_name: '',
  auth_header_prefix: 'Bearer',
  base_url: '',
  api_key: '',
  model_id: '',
}

export default function ProviderCard({
  provider,
  providerName,
  providerColor,
  hasKey = false,
  keyMasked,
  keyPlaceholder,
  keyHintText,
  isActiveProvider = false,
  badgeLabel = 'Key Set',
  subtitle,
  models,
  activeModel,
  preferredModel,
  toggling,
  docsUrl,
  docsLabel,
  showTestButton = false,
  saving = false,
  onSaveKey,
  onRemoveKey,
  onTestKey,
  onActivateModel,
  onSelectPreferred,
  defaultExpanded,
  providers,
  // ── Custom provider variant ──
  isCustom = false,
  customConfig = null,
  isActivePlatformModel = false,
  onCustomSaved,
  onCustomDeleted,
  onCustomActivate,
  mode = 'user',
  // Optional slot rendered inside the expanded body, right after the
  // standard API-key / Models sections. Used by AISettings to render the
  // multi-connection extras list + "+ Add another" affordance INSIDE the
  // card so the layout reads as one unit instead of a floating ml-indent
  // tree below the card.
  extraBodySection,
}) {
  const confirm = useConfirm()
  const isCustomConnected = isCustom && !!customConfig

  const [isOpen, setIsOpen] = useState(defaultExpanded ?? (isCustom ? !customConfig : false))
  const [isEditing, setIsEditing] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(null)

  // Model dropdown state (standard providers)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownRect, setDropdownRect] = useState(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  // Custom provider form state
  const [customEditing, setCustomEditing] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [customForm, setCustomForm] = useState(() => {
    if (customConfig) {
      return {
        provider_name: customConfig.provider_name || '',
        auth_header_prefix: customConfig.auth_header_prefix || 'Bearer',
        base_url: customConfig.base_url || '',
        api_key: '',
        model_id: customConfig.model_id || '',
      }
    }
    return { ...EMPTY_CUSTOM_FORM }
  })
  const updateCustomField = (field, value) => setCustomForm(prev => ({ ...prev, [field]: value }))

  const showEditing = !isCustom && (!hasKey || isEditing)
  const showCustomForm = isCustom && (!isCustomConnected || customEditing)

  // ── Dropdown positioning (standard) ──────────────────────────────────
  useEffect(() => {
    if (!dropdownOpen) { setDropdownRect(null); return }
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const margin = 16
      const gap = 4
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      const flipped = spaceBelow < PINNED_HEIGHT && spaceAbove > spaceBelow
      setDropdownRect({
        left: rect.left,
        width: rect.width,
        placement: {
          top: flipped ? rect.top - PINNED_HEIGHT - gap : rect.bottom + gap,
          maxHeight: PINNED_HEIGHT,
          flipped,
        },
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [dropdownOpen])

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target)
      const inPopover = popoverRef.current?.contains(e.target)
      if (!inTrigger && !inPopover) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  // ── Standard provider handlers ──────────────────────────────────────
  const handleSave = async () => {
    if (!keyInput || !onSaveKey) return
    setBusy('save')
    try {
      await onSaveKey(keyInput)
      setKeyInput('')
      setIsEditing(false)
    } finally { setBusy(null) }
  }

  const handleRemove = async () => {
    if (!onRemoveKey) return
    const ok = await confirm({
      title: `Remove ${providerName} API key?`,
      message: 'Any active model from this provider will be deactivated until a new key is set.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusy('delete')
    try {
      await onRemoveKey()
      setKeyInput('')
      setIsEditing(true)
    } finally { setBusy(null) }
  }

  const handleTest = async () => {
    if (!keyInput || !onTestKey) return
    setBusy('test')
    try { await onTestKey(keyInput) } finally { setBusy(null) }
  }

  // ── Custom provider handlers ────────────────────────────────────────
  // Test requires a real key in the field (you can't test a saved-but-blank
  // submission — the backend doesn't expose the decrypted key, so the test
  // call has no key to send). Save is more permissive: when editing an
  // existing connection, an empty api_key means "keep the saved one", so
  // only base_url + model_id are required.
  const canCustomTest = customForm.api_key.trim() && customForm.base_url.trim() && customForm.model_id.trim()
  const canCustomSave = isCustomConnected
    ? customForm.base_url.trim() && customForm.model_id.trim()
    : canCustomTest

  const handleCustomTest = async () => {
    if (!canCustomTest) return
    setBusy('test')
    try {
      const res = await keysAPI.test({
        provider: 'custom',
        api_key: customForm.api_key.trim(),
        base_url: customForm.base_url.trim(),
        model_id: customForm.model_id.trim(),
        auth_header_prefix: customForm.auth_header_prefix.trim() || 'Bearer',
      })
      if (res.data?.valid) toast.success('Custom provider key is valid')
      else toast.error(res.data?.message || 'Invalid — check your URL, key, and model')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test failed — check your configuration')
    } finally { setBusy(null) }
  }

  const handleCustomSave = async () => {
    if (!canCustomSave) return
    setBusy('save')
    try {
      const providerNameClean = customForm.provider_name.trim()
      const fields = {
        api_key: customForm.api_key.trim(),
        base_url: customForm.base_url.trim(),
        model_id: customForm.model_id.trim(),
        auth_header_prefix: customForm.auth_header_prefix.trim() || 'Bearer',
        provider_name: providerNameClean || undefined,
      }
      if (mode === 'admin') {
        const { api_key, ...extra } = fields
        await adminAPI.updatePlatformKey('custom', api_key, extra)
      } else {
        // Multi-connection: derive the connection's `name` (used by the
        // backend's unique compound index `(user_id, provider, name)`) from
        // the user-facing `provider_name`. Editing an existing connection
        // preserves its name so we don't accidentally rename + collide on
        // save. New connections need a non-empty provider_name when another
        // custom already exists — backend will return 409 with a helpful
        // message if the name collides.
        const name = customConfig?.name
          || providerNameClean
          || 'Default'
        await keysAPI.create({ provider: 'custom', name, ...fields })
      }
      toast.success('Custom provider connected')
      setCustomEditing(false)
      setShowKey(false)
      setCustomForm(prev => ({ ...prev, api_key: '' }))
      onCustomSaved?.()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save custom provider')
    } finally { setBusy(null) }
  }

  const handleCustomDelete = async () => {
    const ok = await confirm({
      title: 'Disconnect custom provider?',
      message: 'Your workflows will fall back to other configured providers or platform AI Credits.',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    setBusy('delete')
    try {
      if (mode === 'admin') {
        await adminAPI.updatePlatformKey('custom', '')
      } else {
        if (!customConfig?.id) return
        await keysAPI.delete(customConfig.id)
      }
      toast.success('Custom provider disconnected')
      setCustomEditing(false)
      setIsOpen(false)
      setCustomForm({ ...EMPTY_CUSTOM_FORM })
      onCustomDeleted?.()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to disconnect')
    } finally { setBusy(null) }
  }

  const enterCustomEdit = () => {
    setCustomEditing(true)
    setIsOpen(true)
    setCustomForm({
      provider_name: customConfig?.provider_name || '',
      auth_header_prefix: customConfig?.auth_header_prefix || 'Bearer',
      base_url: customConfig?.base_url || '',
      api_key: '',
      model_id: customConfig?.model_id || '',
    })
  }

  const cancelCustomEdit = () => {
    setCustomEditing(false)
    setShowKey(false)
    setCustomForm({
      provider_name: customConfig?.provider_name || '',
      auth_header_prefix: customConfig?.auth_header_prefix || 'Bearer',
      base_url: customConfig?.base_url || '',
      api_key: '',
      model_id: customConfig?.model_id || '',
    })
  }

  // ── Standard model helpers ──────────────────────────────────────────
  const hasModels = models && models.length > 0
  const query = searchQuery.trim().toLowerCase()
  const filtered = hasModels
    ? (query
        ? models.filter(m => (m.display_name || '').toLowerCase().includes(query) || (m.model || '').toLowerCase().includes(query))
        : models)
    : []
  const currentActive = hasModels ? models.find(m => m.model === activeModel && isActiveProvider) : null
  const preferredId = preferredModel || ''
  const preferredObj = preferredId && hasModels ? models.find(m => m.model === preferredId) : null
  const isPreferredActive = preferredId && currentActive && currentActive.model === preferredId

  const fmtCost = (microUsd) => (!microUsd || microUsd <= 0) ? '—' : `$${(microUsd / 1_000_000).toFixed(2)}/Mtok`

  const buildPriceTooltip = (m) => (
    <div className="text-[11px] space-y-1 min-w-[200px]">
      <div className="font-semibold text-white pb-1 border-b border-white/20 mb-1">{m.display_name} pricing</div>
      <div className="flex justify-between gap-3"><span className="text-neutral-300">Input:</span><span className="font-mono text-white">{fmtCost(m.input_cost_per_mtok)}</span></div>
      <div className="flex justify-between gap-3"><span className="text-neutral-300">Output:</span><span className="font-mono text-white">{fmtCost(m.output_cost_per_mtok)}</span></div>
      <div className="flex justify-between gap-3"><span className="text-neutral-300">Cache read:</span><span className="font-mono text-white">{fmtCost(m.cache_read_cost_per_mtok)}</span></div>
      <div className="flex justify-between gap-3"><span className="text-neutral-300">Cache write:</span><span className="font-mono text-white">{fmtCost(m.cache_write_cost_per_mtok)}</span></div>
      {(m.user_input_cost_per_mtok > 0 || m.user_output_cost_per_mtok > 0) && (
        <div className="pt-1 mt-1 border-t border-white/20">
          <div className="flex justify-between gap-3"><span className="text-neutral-400">User input:</span><span className="font-mono text-neutral-200">{fmtCost(m.user_input_cost_per_mtok)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-neutral-400">User output:</span><span className="font-mono text-neutral-200">{fmtCost(m.user_output_cost_per_mtok)}</span></div>
        </div>
      )}
    </div>
  )

  const triggerModel = currentActive || preferredObj

  // ── Derived header values ───────────────────────────────────────────
  const headerTitle = isCustom ? 'OpenAI Compatible' : providerName
  const headerSubtitle = isCustom
    ? (isCustomConnected
        ? `${customConfig.provider_name || 'Custom'} — ${customConfig.model_id || 'configured'}`
        : 'Connect any OpenAI-compatible API — Friendli, Baseten, Together, Groq, and more.')
    : subtitle
  const showConnectedBadge = isCustom ? isCustomConnected : hasKey
  const showActiveBadge = isCustom ? isActivePlatformModel : isActiveProvider

  return (
    <div className={`bg-white dark:bg-neutral-800 rounded-xl overflow-hidden ${
      isCustom && !isCustomConnected
        ? 'border-[1.5px] border-dashed border-neutral-300 dark:border-neutral-600'
        : 'border border-neutral-200 dark:border-neutral-700'
    }`}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700/40 transition-colors"
        onClick={() => setIsOpen(o => !o)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: (isCustom ? '#3b82f6' : providerColor) + '15',
              color: isCustom ? '#3b82f6' : providerColor,
            }}
          >
            {isCustom ? <Zap size={18} /> : <ProviderLogo providerId={provider} fallbackLetter={providerName?.[0]} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{headerTitle}</h3>
              {showConnectedBadge && (
                <Tooltip content="API key is saved and ready to use">
                  <span className="inline-flex items-center gap-1 text-[9px] lg:text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700/60 text-neutral-600 dark:text-neutral-300 font-medium uppercase tracking-wider flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {isCustom ? 'Connected' : badgeLabel}
                  </span>
                </Tooltip>
              )}
              {showActiveBadge && (
                <Tooltip content="Currently the platform default — used by all users without their own BYOK key">
                  <span className="text-[9px] lg:text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-bold uppercase tracking-wider flex-shrink-0">
                    Active
                  </span>
                </Tooltip>
              )}
            </div>
            <p className="text-[11px] lg:text-xs text-neutral-500 dark:text-neutral-400 truncate">{headerSubtitle}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded content */}
      {isOpen && (
        isCustom ? (
          /* ── Custom provider body ───────────────────────────────────── */
          <>
          <div className="px-4 py-4 bg-neutral-50 dark:bg-neutral-900/30 border-t border-neutral-200 dark:border-neutral-700">
            {showCustomForm ? (
              <div className="space-y-3">
                {/* Row 1: Provider Name + Auth Header Prefix */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Provider Name
                      <span className="text-neutral-400 dark:text-neutral-500 ml-1">(optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Friendli, Baseten, Together..."
                      value={customForm.provider_name}
                      onChange={(e) => updateCustomField('provider_name', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Auth Header Prefix
                      <span className="text-neutral-400 dark:text-neutral-500 ml-1">(default: Bearer)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Bearer"
                      value={customForm.auth_header_prefix}
                      onChange={(e) => updateCustomField('auth_header_prefix', e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                    />
                  </div>
                </div>

                {/* Row 2: Base URL */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    Base URL<span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://api.friendli.ai/serverless/v1"
                    value={customForm.base_url}
                    onChange={(e) => updateCustomField('base_url', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                  />
                </div>

                {/* Row 3: API Key with show/hide. When editing an existing
                    connection we tell the user they can leave the field blank
                    to preserve the saved key — backend handles the empty-key
                    case by reusing the existing encrypted value, so changing
                    only the model / endpoint never requires re-pasting. */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    API Key
                    {isCustomConnected ? (
                      <span className="text-neutral-400 dark:text-neutral-500 ml-1 font-normal">(leave blank to keep)</span>
                    ) : (
                      <span className="text-red-400 ml-0.5">*</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      placeholder={isCustomConnected
                        ? `Saved · ${customConfig.key_hint || '••••'} — leave blank to keep`
                        : "Your provider's API key"}
                      value={customForm.api_key}
                      onChange={(e) => updateCustomField('api_key', e.target.value)}
                      className="w-full px-3 py-1.5 pr-9 text-xs font-mono bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                    />
                    <Tooltip content={showKey ? 'Hide key' : 'Reveal key'}>
                      <button
                        type="button"
                        onClick={() => setShowKey(v => !v)}
                        aria-label={showKey ? 'Hide key' : 'Reveal key'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* Row 4: Model ID — full-width for visual balance with Base URL and API Key above */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    Model ID<span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. zai-org/GLM-5.1"
                    value={customForm.model_id}
                    onChange={(e) => updateCustomField('model_id', e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Tooltip content="Test the connection to your provider" position="top">
                    <button
                      type="button"
                      onClick={handleCustomTest}
                      disabled={!canCustomTest || busy === 'test'}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                      {busy === 'test' && <Loader2 className="w-3 h-3 animate-spin" />}
                      Test
                    </button>
                  </Tooltip>
                  <Tooltip content="Save this custom provider configuration" position="top">
                    <button
                      type="button"
                      onClick={handleCustomSave}
                      disabled={!canCustomSave || busy === 'save'}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                      {busy === 'save' && <Loader2 className="w-3 h-3 animate-spin" />}
                      Save
                    </button>
                  </Tooltip>
                  {isCustomConnected && customEditing && (
                    <button
                      type="button"
                      onClick={cancelCustomEdit}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* ── Connected read-only view ────────────────────────────── */
              /* All three saved values (Model, Endpoint, API Key) get the
                 SAME bordered-container treatment so users see them as
                 equally weighted config data — no second-class "key hint
                 pill" hidden up top. Each row: small uppercase label →
                 read-only data field with mono value + copy button. Auth
                 header prefix is only shown when non-default (Bearer). */
              <div className="space-y-3">
                <CustomInfoRow
                  icon={Cpu}
                  label="Model"
                  value={customConfig.model_id}
                  onCopy={() => {
                    navigator.clipboard?.writeText(customConfig.model_id || '')
                    toast.success('Model ID copied')
                  }}
                />
                <CustomInfoRow
                  icon={Globe}
                  label="Endpoint"
                  value={customConfig.base_url}
                  onCopy={() => {
                    navigator.clipboard?.writeText(customConfig.base_url || '')
                    toast.success('Endpoint copied')
                  }}
                />
                <CustomInfoRow
                  icon={Key}
                  label="API Key"
                  value={customConfig.key_hint || '••••'}
                  // No onCopy — the masked hint isn't a real key; copying
                  // it would just be 8 chars of ellipsis-prefixed gibberish.
                />
                {customConfig.auth_header_prefix && customConfig.auth_header_prefix !== 'Bearer' && (
                  <CustomInfoRow
                    icon={ShieldCheck}
                    label="Auth Header"
                    value={customConfig.auth_header_prefix}
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'admin' && (
                    <Tooltip
                      content={isActivePlatformModel
                        ? 'This custom provider is the platform active model'
                        : 'Make this the platform default for all users without BYOK'}
                      position="top"
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          setBusy('activate')
                          try { await onCustomActivate?.() } finally { setBusy(null) }
                        }}
                        disabled={isActivePlatformModel || !!busy}
                        className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          isActivePlatformModel
                            ? 'border-emerald-500 text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-400'
                            : 'border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10'
                        }`}
                      >
                        {/* Spinner during activation; no icon on the resting
                            "Activate" or already-"Active" states — admin
                            requested cleaner labels without checkmarks. */}
                        {busy === 'activate' && <Loader2 className="w-3 h-3 animate-spin" />}
                        {isActivePlatformModel ? 'Active' : busy === 'activate' ? 'Activating...' : 'Activate'}
                      </button>
                    </Tooltip>
                  )}
                  <div className="flex-1" />
                  <Tooltip content="Replace this custom provider's API key / configuration" position="top">
                    <button
                      type="button"
                      onClick={enterCustomEdit}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
                    >
                      Update
                    </button>
                  </Tooltip>
                  <Tooltip content="Remove this custom provider — workflows will fall back to other providers" position="top">
                    <button
                      type="button"
                      onClick={handleCustomDelete}
                      disabled={busy === 'delete'}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                      {busy === 'delete' && <Loader2 className="w-3 h-3 animate-spin" />}
                      Remove
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
          {/* Custom-provider multi-connection slot — mirrors the standard
              branch's extraBodySection (rendered after the main body with a
              divider). Used by AISettings.jsx to tuck the "+ Add another
              OpenAI-compatible provider" button INSIDE the last custom card
              instead of leaving it floating below. */}
          {extraBodySection && (
            <div className="border-t border-neutral-100 dark:border-neutral-700">
              {extraBodySection}
            </div>
          )}
          </>
        ) : (
          /* ── Standard provider body ─────────────────────────────────── */
          <>
            {/* API Key Section */}
            <div className="px-4 py-3 bg-neutral-50 dark:bg-neutral-900/30 border-t border-neutral-200 dark:border-neutral-700">
              {showEditing && (
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="text-[11px] lg:text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {docsUrl ? 'Your API Key / Access Token' : 'Platform API Key / Access Token'}
                  </span>
                  {docsUrl && (
                    <Tooltip content={`Opens ${docsLabel} in a new tab`} position="top" className="ml-auto">
                      <a
                        href={docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] lg:text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Get key from {docsLabel}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </Tooltip>
                  )}
                </div>
              )}

              {showEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    placeholder={keyPlaceholder || 'Paste your API key'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    className="flex-1 basis-full sm:basis-[180px] min-w-0 px-3 py-1.5 text-xs font-mono bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                    autoFocus={hasKey}
                  />
                  {showTestButton && (
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={!keyInput || busy === 'test'}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                      {busy === 'test' && <Loader2 className="w-3 h-3 animate-spin" />}
                      Test
                    </button>
                  )}
                  <Tooltip content={`Save this ${providerName} key`} position="top">
                    <button
                      onClick={handleSave}
                      disabled={saving || busy === 'save' || !keyInput}
                      className="px-3 py-1.5 text-sm font-medium rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                    >
                      {busy === 'save' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {busy === 'save' ? 'Saving...' : 'Save'}
                    </button>
                  </Tooltip>
                  {hasKey && (
                    <Tooltip content="Cancel — keep the saved key" position="top">
                      <button
                        onClick={() => { setIsEditing(false); setKeyInput('') }}
                        className="px-3 py-1.5 text-sm font-medium rounded-xl border border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                      >
                        Cancel
                      </button>
                    </Tooltip>
                  )}
                </div>
              ) : (
                /* Connected (read-only) view — mirrors the custom provider
                   card's API Key row so all providers look identical on the
                   AI Settings page: small uppercase label, bordered
                   data-container with mono key hint, Update + Remove actions
                   in a separate aligned row below. */
                <div className="space-y-3">
                  <CustomInfoRow
                    icon={Key}
                    label="API Key"
                    value={keyMasked || '••••'}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Tooltip content={`Replace this ${providerName} key with a new one`} position="top">
                      <button
                        onClick={() => { setIsEditing(true); setKeyInput('') }}
                        className="px-3 py-1.5 text-sm font-medium rounded-xl border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
                      >
                        Update
                      </button>
                    </Tooltip>
                    <Tooltip content={`Delete this ${providerName} key`} position="top">
                      <button
                        onClick={handleRemove}
                        disabled={saving || busy === 'delete'}
                        className="px-3 py-1.5 text-sm font-medium rounded-xl border border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                      >
                        Remove
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )}
              {showEditing && keyHintText && <p className="text-[10px] lg:text-[11px] text-neutral-400 mt-1.5">{keyHintText}</p>}
            </div>

            {/* Models Section (admin only) */}
            {hasModels && (
              <div className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 bg-neutral-50/30 dark:bg-neutral-900/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Active Model</span>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500">{models.length} {models.length === 1 ? 'model' : 'models'}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Dropdown trigger */}
                  <div className="relative flex-1 basis-full sm:basis-[200px] min-w-0" ref={triggerRef}>
                    <Tooltip content={triggerModel ? buildPriceTooltip(triggerModel) : null} position="top" className="!flex w-full">
                      <button
                        type="button"
                        onClick={() => hasKey && setDropdownOpen(o => !o)}
                        disabled={!hasKey}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm bg-white dark:bg-[#2c2c2c] border rounded-lg transition-colors ${
                          dropdownOpen
                            ? 'border-primary-500 ring-2 ring-primary-500/20'
                            : 'border-neutral-200 dark:border-[#484848] hover:border-neutral-300 dark:hover:border-[#4a4a4a]'
                        } ${hasKey ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {currentActive ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                              <span className="text-neutral-900 dark:text-neutral-100 font-medium truncate">{currentActive.display_name}</span>
                              <span className="text-[10px] text-neutral-400 font-mono truncate">active</span>
                            </>
                          ) : preferredObj ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                              <span className="text-neutral-700 dark:text-neutral-300 font-medium truncate">{preferredObj.display_name}</span>
                              <span className="text-[10px] text-neutral-400 font-mono truncate">selected — click Activate</span>
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600 flex-shrink-0" />
                              <span className="text-neutral-500 dark:text-neutral-400">— Select a model —</span>
                            </>
                          )}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-neutral-400 flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </Tooltip>

                    {/* Popover via portal */}
                    {dropdownOpen && hasKey && dropdownRect && createPortal(
                      <div
                        ref={popoverRef}
                        className="fixed z-[9999] bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-lg shadow-2xl overflow-hidden animate-fade-in flex flex-col"
                        style={{
                          top: dropdownRect.placement.top,
                          left: dropdownRect.left,
                          width: dropdownRect.width,
                          maxHeight: dropdownRect.placement.maxHeight,
                        }}
                      >
                        {/* Search */}
                        <div className="p-2 border-b border-neutral-100 dark:border-[#484848]">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
                            <input
                              type="text"
                              autoFocus
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder={`Search ${models.length} models\u2026`}
                              className="w-full pl-8 pr-8 py-1.5 text-xs bg-neutral-50 dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#484848] rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
                            />
                            {searchQuery && (
                              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {query && <p className="text-[10px] text-neutral-400 mt-1 px-1">{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</p>}
                        </div>

                        {/* List */}
                        <div className="flex-1 min-h-0 overflow-y-auto">
                          {filtered.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[11px] text-neutral-400 dark:text-neutral-500">No models match &ldquo;{searchQuery}&rdquo;</div>
                          ) : (
                            filtered.map((m) => {
                              const isActive = m.model === activeModel && isActiveProvider
                              const isPreferred = !isActive && m.model === preferredId
                              const slashIdx = (m.model || '').indexOf('/')
                              const vendor = slashIdx > 0 ? m.model.slice(0, slashIdx) : null
                              const namePart = slashIdx > 0 ? m.model.slice(slashIdx + 1) : m.model
                              const cleanName = (m.display_name && m.display_name !== m.model) ? m.display_name : namePart
                              const vendorColor = vendor && providers ? providers[vendor]?.color : null
                              const vendorName = vendor && providers ? (providers[vendor]?.name || vendor) : null
                              return (
                                <Tooltip key={m.model || m.id} content={buildPriceTooltip(m)} position="left" className="!flex w-full">
                                  <button
                                    type="button"
                                    onClick={() => { onSelectPreferred?.(m.model); setDropdownOpen(false); setSearchQuery('') }}
                                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                                      isActive ? 'bg-emerald-50/60 dark:bg-emerald-900/20'
                                      : isPreferred ? 'bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                      : 'hover:bg-neutral-50 dark:hover:bg-[#383838]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                        isActive ? 'border-emerald-500 bg-emerald-500'
                                        : isPreferred ? 'border-amber-400'
                                        : 'border-neutral-300 dark:border-neutral-600'
                                      }`}>
                                        {isActive && <div className="w-1 h-1 rounded-full bg-white" />}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm text-neutral-900 dark:text-neutral-100 truncate">{cleanName}</div>
                                        <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono truncate">{m.model}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                      {vendorName && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border"
                                          style={{ backgroundColor: (vendorColor || '#888') + '15', color: vendorColor || '#888', borderColor: (vendorColor || '#888') + '40' }}>
                                          <ProviderLogo providerId={vendor} fallbackLetter={vendorName[0]} className="[&_svg]:w-2.5 [&_svg]:h-2.5" />
                                          {vendorName}
                                        </span>
                                      )}
                                      {isActive && <Tooltip content="This is the active platform model"><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold">ACTIVE</span></Tooltip>}
                                      {isPreferred && <Tooltip content="Picked but not yet activated — click Activate to make it the platform default"><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-bold">SELECTED</span></Tooltip>}
                                      {toggling === m.model && <RefreshCw className="w-3 h-3 animate-spin text-neutral-400" />}
                                    </div>
                                  </button>
                                </Tooltip>
                              )
                            })
                          )}
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>

                  {/* Activate button */}
                  <Tooltip
                    content={
                      !hasKey ? 'Set an API key first' :
                      !preferredId ? 'Pick a model from the dropdown first' :
                      isPreferredActive ? 'This model is already the platform active model' :
                      `Make ${preferredObj?.display_name || preferredId} the platform active model`
                    }
                    position="top"
                  >
                    <button
                      type="button"
                      onClick={() => onActivateModel?.(preferredId)}
                      disabled={!hasKey || !preferredId || isPreferredActive || toggling === preferredId}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        isPreferredActive
                          ? 'border-emerald-500 text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-400'
                          : 'border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-500/10'
                      }`}
                    >
                      {/* Spinner only during activation; no checkmark on the
                          resting "Activate" or already-"Active" states. */}
                      {toggling === preferredId && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {isPreferredActive ? 'Active' : 'Activate'}
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}

            {!hasKey && hasModels && (
              <div className="px-4 py-3 text-center text-[11px] text-neutral-400 border-t border-neutral-100 dark:border-neutral-700">
                Set an API key above to activate models from this provider
              </div>
            )}

            {/* Multi-connection slot — extras + Add button render here so they
                live INSIDE the card body, not as floating siblings below. */}
            {extraBodySection && (
              <div className="border-t border-neutral-100 dark:border-neutral-700">
                {extraBodySection}
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}

/**
 * Stacked info row used inside the custom provider connected view.
 * Label sits on its own row above the value so long values (full model
 * paths, multi-segment URLs) get the entire card width and wrap via
 * `break-all` instead of being aggressively truncated with ellipsis.
 * The optional copy button is right-aligned on the label row so it never
 * competes with the value for horizontal space.
 */
function CustomInfoRow({ icon: Icon, label, value, onCopy }) {
  // Read-only "input-field" style — mirrors what users see in the add form
  // (where Model/Endpoint are typed into input boxes). Polished pattern used
  // by GitHub / Stripe / Anthropic dashboards for saved config values:
  //   ┌─ Label ─────┐
  //   ┌────────────────────────────────────────────────────┐
  //   │ monospace value text                          [📋] │
  //   └────────────────────────────────────────────────────┘
  // The bordered container gives the data visual weight without using
  // colored backgrounds; copy button sits inside the container so it
  // always has a clear hit target even when value is short.
  return (
    <div className="group">
      <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-neutral-400">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors">
        <span className="flex-1 min-w-0 font-mono text-[12px] text-neutral-800 dark:text-neutral-200 break-all leading-snug select-all">
          {value}
        </span>
        {onCopy && (
          <Tooltip content={`Copy ${label.toLowerCase()}`} position="top">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCopy() }}
              aria-label={`Copy ${label}`}
              className="opacity-60 group-hover:opacity-100 transition-opacity p-1 rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 flex-shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
