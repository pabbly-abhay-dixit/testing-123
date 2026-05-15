import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2, Pencil, Save, X, Copy, Webhook, Info } from 'lucide-react'
import { adminAPI } from '../../services/api'

// Admin Subscription Tiers tab.
// Visual tokens follow the same patterns as PricingPlansTab in Admin.jsx:
//   - bg-white dark:bg-neutral-800 cards w/ rounded-xl + shadow-sm
//   - text-gray-700 / text-gray-500 / text-gray-900 hierarchy
//   - bg-blue-600 hover:bg-blue-700 primary
//   - rounded-xl on buttons + cards
//   - text-xs font-medium for buttons
//   - text-sm body
//
// What this tab does:
//   - Lists tier_registry rows (Free + Enterprise + paid plans)
//   - Add/edit/delete rows (Free row delete-protected server-side)
//   - For Free + Enterprise rows, edits propagate via local_limits
//   - Paid rows are display copy only — limits flow from PSB metadata at
//     webhook time

// Webhook URL the admin pastes into PSB — derived from the current origin
// so localhost / ngrok / agenticai.pabbly.com all show the right URL.
function buildWebhookUrl() {
  if (typeof window === 'undefined') return '/api/credits/pabbly-webhook'
  return `${window.location.origin}/api/credits/pabbly-webhook`
}

const EMPTY_FORM = {
  pabbly_plan_id: '',
  tier: 'standard',
  is_free: false,
  is_enterprise: false,
  enterprise_user_id: '',
  label: '',
  description: '',
  price_cents: 0,
  monthly_equivalent_cents: 0,
  icon: '',
  embed_script: '',
  checkout_url: '',
  sort_order: 100,
  popular: false,
  welcome_bonus_credits: null,
  local_limits: null,
}

const EMPTY_LIMITS = {
  workflows_max: 5,
  team_members_max: 0,
  schedulers_enabled: false,
  units_max_per_month: 100,
  support_tier: 'community',
}

function tierBadge(row) {
  if (row.is_free) {
    return (
      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Free
      </span>
    )
  }
  if (row.is_enterprise) {
    return (
      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Enterprise
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
      Paid
    </span>
  )
}

export default function SubscriptionTiersTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | 'new' | <_id>
  const [form, setForm] = useState(EMPTY_FORM)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.listTiers()
      setRows(data?.tiers || [])
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load tiers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const startEdit = (row) => {
    setEditing(row._id?.$oid || row._id || null)
    setForm({
      pabbly_plan_id: row.pabbly_plan_id || '',
      tier: row.tier || 'standard',
      is_free: !!row.is_free,
      is_enterprise: !!row.is_enterprise,
      enterprise_user_id: row.enterprise_user_id?.$oid || row.enterprise_user_id || '',
      label: row.label || '',
      description: row.description || '',
      price_cents: row.price_cents || 0,
      monthly_equivalent_cents: row.monthly_equivalent_cents || 0,
      icon: row.icon || '',
      embed_script: row.embed_script || '',
      checkout_url: row.checkout_url || '',
      sort_order: row.sort_order || 100,
      popular: !!row.popular,
      welcome_bonus_credits: row.welcome_bonus_credits ?? null,
      local_limits: row.local_limits || null,
    })
  }

  const startNew = () => {
    setEditing('new')
    setForm({ ...EMPTY_FORM })
  }

  const cancel = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  const save = async () => {
    try {
      const payload = { ...form }
      if (!payload.pabbly_plan_id) delete payload.pabbly_plan_id
      if (!payload.enterprise_user_id) delete payload.enterprise_user_id
      if (payload.welcome_bonus_credits == null || payload.welcome_bonus_credits === '') {
        delete payload.welcome_bonus_credits
      }
      if (!payload.is_free && !payload.is_enterprise) {
        // Limits don't apply to ordinary paid rows.
        payload.local_limits = null
      }

      if (editing === 'new') {
        await adminAPI.createTier(payload)
        toast.success('Tier created')
      } else {
        await adminAPI.updateTier(editing, payload)
        toast.success('Tier updated')
      }
      cancel()
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Save failed')
    }
  }

  const deleteRow = async (row) => {
    if (row.is_free) {
      toast.error('Cannot delete the Free tier row')
      return
    }
    if (!confirm(`Delete tier "${row.label}"? This is a soft-delete; existing subs keep working.`)) {
      return
    }
    try {
      const id = row._id?.$oid || row._id
      await adminAPI.removeTier(id)
      toast.success('Tier deleted')
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Delete failed')
    }
  }

  const editorHasLimits = form.is_free || form.is_enterprise
  const webhookUrl = buildWebhookUrl()

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-neutral-100">
            Subscription Tiers
          </h2>
          <p className="text-sm text-gray-600 dark:text-neutral-400 mt-0.5 max-w-2xl">
            Register PSB plan_ids and edit display copy. Paid-plan limits live in PSB metadata
            (paa_workflows, paa_team_members, …) and snapshot to subscriptions on every
            invoice_paid. Free + Enterprise rows carry their limits here.
          </p>
        </div>
        <button
          onClick={startNew}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
        >
          <Plus size={14} /> Add tier
        </button>
      </div>

      {/* Webhook URL callout — what the admin pastes into PSB */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex-shrink-0">
            <Webhook size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">
              PSB webhook URL
            </h3>
            <p className="text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
              Paste this into Pabbly Subscription Billing → Webhooks. The same endpoint handles
              credit-package purchases AND tier subscriptions (routed by metadata).
            </p>
            <div className="mt-3 flex items-center gap-2 bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl px-3 py-2">
              <code className="text-xs text-gray-900 dark:text-neutral-100 truncate flex-1 font-mono">
                {webhookUrl}
              </code>
              <button
                onClick={() => copy(webhookUrl)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                title="Copy"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <details className="mt-3">
              <summary className="text-xs text-gray-600 dark:text-neutral-400 cursor-pointer hover:text-gray-900 dark:hover:text-neutral-200 inline-flex items-center gap-1 select-none">
                <Info size={12} /> Required event_types + auth
              </summary>
              <div className="mt-2 text-xs text-gray-600 dark:text-neutral-400 space-y-1.5 pl-4 border-l-2 border-blue-100 dark:border-blue-900/40">
                <div>
                  <strong className="text-gray-700 dark:text-neutral-300">ADD events:</strong>{' '}
                  <code className="font-mono">invoice_paid</code>,{' '}
                  <code className="font-mono">subscription_activate</code>,{' '}
                  <code className="font-mono">payment_success</code>
                </div>
                <div>
                  <strong className="text-gray-700 dark:text-neutral-300">REMOVE events:</strong>{' '}
                  <code className="font-mono">subscription_cancel</code>,{' '}
                  <code className="font-mono">subscription_expire</code>,{' '}
                  <code className="font-mono">subscription_delete</code>,{' '}
                  <code className="font-mono">payment_failure</code>,{' '}
                  <code className="font-mono">invoice_dunning</code>,{' '}
                  <code className="font-mono">invoice_pending</code>
                </div>
                <div>
                  <strong className="text-gray-700 dark:text-neutral-300">Optional auth:</strong>{' '}
                  set <code className="font-mono">PABBLY_WEBHOOK_TOKEN</code> in backend{' '}
                  <code className="font-mono">.env</code> and append{' '}
                  <code className="font-mono">?token=&lt;same value&gt;</code> to the URL above.
                </div>
                <div>
                  <strong className="text-gray-700 dark:text-neutral-300">Required metadata keys:</strong>{' '}
                  <code className="font-mono">paa_tier</code>,{' '}
                  <code className="font-mono">paa_workflows</code>,{' '}
                  <code className="font-mono">paa_team_members</code>,{' '}
                  <code className="font-mono">paa_schedulers</code>,{' '}
                  <code className="font-mono">paa_units</code>. Optional:{' '}
                  <code className="font-mono">paa_welcome_credits</code>,{' '}
                  <code className="font-mono">paa_label</code>,{' '}
                  <code className="font-mono">paa_support_tier</code>. Values must be strings.
                  {' '}1 unit ≈ 30 sec of workflow runtime (min 1 per run).
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Tier list table */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500 dark:text-neutral-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-neutral-900/50">
              <tr className="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-neutral-400 border-b border-gray-200 dark:border-neutral-700">
                <th className="text-left px-4 py-3">Tier</th>
                <th className="text-left px-4 py-3">Label</th>
                <th className="text-left px-4 py-3">PSB plan_id</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-right px-4 py-3">Sort</th>
                <th className="text-center px-4 py-3">Active</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="text-sm text-gray-500 dark:text-neutral-400">
                      No tiers yet. Click "Add tier" to register your first PSB plan.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row._id?.$oid || row._id}
                    className="border-b border-gray-100 dark:border-neutral-700 last:border-0 hover:bg-gray-50 dark:hover:bg-neutral-900/50 transition-colors"
                  >
                    <td className="px-4 py-3">{tierBadge(row)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-neutral-100">
                      {row.label}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500 dark:text-neutral-400">
                      {row.pabbly_plan_id ||
                        (row.is_free ? '— (Free)' : row.is_enterprise ? '— (Enterprise)' : '—')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-neutral-300">
                      {row.price_cents > 0 ? `$${(row.price_cents / 100).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-neutral-300">
                      {row.sort_order}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.active ? (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-neutral-700 dark:text-neutral-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => startEdit(row)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {!row.is_free && (
                          <button
                            onClick={() => deleteRow(row)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            aria-label="Delete"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit / new modal-style card */}
      {editing && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-4 sm:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-neutral-100">
              {editing === 'new' ? 'New tier' : 'Edit tier'}
            </h3>
            <button
              onClick={cancel}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <Field
              label="Tier (paa_tier)"
              value={form.tier}
              onChange={(v) => setForm({ ...form, tier: v })}
            />
            <Field
              label="Label"
              value={form.label}
              onChange={(v) => setForm({ ...form, label: v })}
            />
            <Field
              label="PSB plan_id (paid only)"
              value={form.pabbly_plan_id}
              onChange={(v) => setForm({ ...form, pabbly_plan_id: v })}
              placeholder="69e0c225081315121a34de14"
            />
            <Field
              label="Description"
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
            />
            <Field label="Icon (emoji)" value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} />
            <Field
              label="Sort order"
              type="number"
              value={form.sort_order}
              onChange={(v) => setForm({ ...form, sort_order: parseInt(v) || 0 })}
            />
            <Field
              label="Price ($)"
              type="number"
              value={form.price_cents / 100}
              onChange={(v) => setForm({ ...form, price_cents: Math.round((parseFloat(v) || 0) * 100) })}
            />
            <Field
              label="Monthly equivalent ($)"
              type="number"
              value={form.monthly_equivalent_cents / 100}
              onChange={(v) =>
                setForm({ ...form, monthly_equivalent_cents: Math.round((parseFloat(v) || 0) * 100) })
              }
            />
            <Field
              label="Welcome bonus credits"
              type="number"
              value={form.welcome_bonus_credits ?? ''}
              onChange={(v) => setForm({ ...form, welcome_bonus_credits: v === '' ? null : parseInt(v) })}
            />
            <CheckField
              label="Free tier row (singleton)"
              checked={form.is_free}
              onChange={(v) =>
                setForm({
                  ...form,
                  is_free: v,
                  is_enterprise: v ? false : form.is_enterprise,
                  local_limits: v && !form.local_limits ? EMPTY_LIMITS : form.local_limits,
                })
              }
            />
            <CheckField
              label="Enterprise (admin-managed, paid by invoice)"
              checked={form.is_enterprise}
              onChange={(v) =>
                setForm({
                  ...form,
                  is_enterprise: v,
                  is_free: v ? false : form.is_free,
                  local_limits: v && !form.local_limits ? EMPTY_LIMITS : form.local_limits,
                })
              }
            />
            {form.is_enterprise && (
              <Field
                label="Enterprise user_id"
                value={form.enterprise_user_id}
                onChange={(v) => setForm({ ...form, enterprise_user_id: v })}
                placeholder="ObjectId hex of the customer's user"
              />
            )}
            <CheckField
              label="Popular badge"
              checked={form.popular}
              onChange={(v) => setForm({ ...form, popular: v })}
            />
            <Field
              label="Embed script (PSB checkout)"
              value={form.embed_script}
              onChange={(v) => setForm({ ...form, embed_script: v })}
              placeholder='<script src="https://payments.pabbly.com/api/checkoutv/embed.js?_p=…"></script>'
              full
            />
            <Field
              label="Checkout URL"
              value={form.checkout_url}
              onChange={(v) => setForm({ ...form, checkout_url: v })}
              full
            />
          </div>

          {editorHasLimits && (
            <div className="mt-4 sm:mt-5 bg-gray-50 dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-700 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-neutral-400 mb-3">
                Local limits (Free / Enterprise only)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <Field
                  label="Workflows max (-1 = unlimited)"
                  type="number"
                  value={form.local_limits?.workflows_max ?? 0}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      local_limits: { ...(form.local_limits || EMPTY_LIMITS), workflows_max: parseInt(v) || 0 },
                    })
                  }
                />
                <Field
                  label="Team members max"
                  type="number"
                  value={form.local_limits?.team_members_max ?? 0}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      local_limits: { ...(form.local_limits || EMPTY_LIMITS), team_members_max: parseInt(v) || 0 },
                    })
                  }
                />
                <Field
                  label="Compute units / month"
                  type="number"
                  value={form.local_limits?.units_max_per_month ?? 0}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      local_limits: {
                        ...(form.local_limits || EMPTY_LIMITS),
                        units_max_per_month: parseInt(v) || 0,
                      },
                    })
                  }
                />
                <CheckField
                  label="Schedulers enabled"
                  checked={!!form.local_limits?.schedulers_enabled}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      local_limits: { ...(form.local_limits || EMPTY_LIMITS), schedulers_enabled: v },
                    })
                  }
                />
                <Field
                  label="Support tier"
                  value={form.local_limits?.support_tier ?? 'community'}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      local_limits: { ...(form.local_limits || EMPTY_LIMITS), support_tier: v },
                    })
                  }
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100 dark:border-neutral-700">
            <button
              onClick={cancel}
              className="text-xs font-medium px-4 py-1.5 rounded-xl text-gray-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, full }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-xs font-medium text-gray-700 dark:text-neutral-300">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 hover:border-gray-300 dark:hover:border-neutral-600 transition-colors"
      />
    </label>
  )
}

function CheckField({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-neutral-300 cursor-pointer">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  )
}
