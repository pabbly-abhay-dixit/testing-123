import { Settings2, FileText, Code, Key, CheckCircle2, AlertCircle, Eye, EyeOff, Play, Loader2, Lock, Trash2 } from 'lucide-react'
import { useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { stepVerifyAPI } from '../../services/api'
import CodeView from './CodeView'
import Tooltip from '../ui/Tooltip'

// Escape backticks, ${, and backslashes so arbitrary text can be safely
// embedded inside a template-literal display. We are rendering this as
// readable JS, not executing it, but escaping keeps the rendered string
// valid JS in case a user copies it into a real Pabbly Function.
const escapeForTemplateLiteral = (s) =>
  (s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

// Convert a step name like "Analyze Image for Location" to a JS identifier
// like "analyzeImageForLocation". Falls back to a numbered name if the input
// has no alphanumerics (e.g. emoji-only step names).
const stepNameToVar = (stepName, fallbackIndex) => {
  const cleaned = stepName
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '')
  return cleaned || `prevStep${fallbackIndex + 1}`
}

// Wrap an AI step's system_prompt in a Pabbly-Functions-style code template
// that mirrors the shape of code steps:
//   • Header comment `// Step N: <name>` — same convention master agent uses
//     for code steps' first-line comment.
//   • Bare `OUTPUT = ...` (no const) — same wrapper convention as code steps.
//   • `INPUT.previous_steps['X']` reads surfaced at the top for any
//     {{step.X}} placeholder the prompt references.
//   • `INPUT.webhook` substitution if {{webhook}} is referenced.
//   • result.content — matches the pabbly-llm SDK's return shape.
// The runtime in bundled.rs::executeAIStep does the substitution differently
// (it appends webhook + previous outputs to the system prompt rather than
// inlining them), but this representation is more faithful to how a user
// would write the same logic as a code step.
const buildAiStepDisplayCode = (step, stepIndex) => {
  const rawPrompt = step?.system_prompt || ''

  // Discover {{step.X}} placeholders. Preserve first-seen order for stable output.
  const stepRefs = new Map() // canonical step name → js var name
  const placeholderRegex = /\{\{step\.([^}]+)\}\}/g
  let match
  while ((match = placeholderRegex.exec(rawPrompt)) !== null) {
    const name = match[1].trim()
    if (!stepRefs.has(name)) stepRefs.set(name, stepNameToVar(name, stepRefs.size))
  }
  const hasWebhookPlaceholder = /\{\{webhook\}\}/.test(rawPrompt)

  // Escape FIRST (so any literal backticks / ${ / \ in the user's prompt are
  // safe), THEN inject our ${varName} substitutions. The {{ and }} markers
  // are not JS-special so they survive the escape unchanged.
  let body = escapeForTemplateLiteral(rawPrompt)
  for (const [name, varName] of stepRefs) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    body = body.replace(new RegExp(`\\{\\{step\\.${escapedName}\\}\\}`, 'g'), '${' + varName + '}')
  }
  if (hasWebhookPlaceholder) {
    body = body.replace(/\{\{webhook\}\}/g, '${JSON.stringify(INPUT.webhook)}')
  }

  const stepReads = Array.from(stepRefs.entries())
    .map(([name, varName]) => `const ${varName} = INPUT.previous_steps[${JSON.stringify(name)}] || '';`)
    .join('\n')
  const header = stepReads ? `// Previous step outputs this step depends on\n${stepReads}\n\n` : ''

  // Header comment mirrors the code-step convention: `// Step N: <name>`.
  // stepIndex is 0-based; display as 1-based. Falls back to plain name if
  // index is unknown (-1) so the comment stays useful even if the parent
  // didn't pass it.
  const stepName = (step?.name || 'AI Step').replace(/[\r\n]+/g, ' ').trim()
  const stepComment = (typeof stepIndex === 'number' && stepIndex >= 0)
    ? `// Step ${stepIndex + 1}: ${stepName}`
    : `// ${stepName}`

  return `${stepComment}
const { LLM } = require('pabbly-llm');

${header}const result = await new LLM().complete({
  system: \`${body}\`,
  messages: [
    { role: 'user', content: 'Execute this step. The input data is provided in your system prompt. Use the available tools as needed.' }
  ]
});

OUTPUT = result.content;`
}

const ConfigPanel = ({ step, stepIndex = -1, agent, onStepUpdate, onDeleteStep, availableModels = [] }) => {
  const [showSecrets, setShowSecrets] = useState({})
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (!step) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8">
        <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-[#484848] flex items-center justify-center mb-3">
          <Settings2 size={24} className="text-neutral-300 dark:text-neutral-300" />
        </div>
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-300 mb-1">No step selected</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-300 leading-relaxed">
          Select a step from the pipeline to configure it.
        </p>
      </div>
    )
  }

  const handleVerify = async () => {
    setVerifying(true)
    setVerifyResult(null)
    onStepUpdate(step.id, { status: 'testing' })

    try {
      const res = await stepVerifyAPI.verify({
        name: step.name,
        description: step.description,
        tools: step.tools || [],
        credentials: (step.credentials || []).map((c) => ({ key: c.key, value: c.value })),
        test_data: null,
      })

      const result = res.data
      setVerifyResult(result)

      if (result.success) {
        onStepUpdate(step.id, { status: 'verified' })
        toast.success(`Step verified: ${result.message}`)
      } else {
        onStepUpdate(step.id, { status: 'failed' })
        toast.error(`Verification failed: ${result.error}`)
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Verification request failed'
      setVerifyResult({ success: false, error: msg })
      onStepUpdate(step.id, { status: 'failed' })
      toast.error(msg)
    } finally {
      setVerifying(false)
    }
  }

  const toggleSecretVisibility = (key) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleCredentialChange = (key, value) => {
    const existing = step.credentials || []
    const updated = existing.find((c) => c.key === key)
      ? existing.map((c) => (c.key === key ? { ...c, value } : c))
      : [...existing, { key, value }]
    onStepUpdate(step.id, { credentials: updated })
  }

  const getCredentialValue = (key) => {
    return (step.credentials || []).find((c) => c.key === key)?.value || ''
  }

  return (
    <div className="h-full flex flex-col">
      {/* Config form */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Read-only hint — every field below is driven by the Master Agent */}
        <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
          <Lock size={12} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            This step is read-only. To rename, edit the description, or change the code, ask the Master Agent in chat.
          </p>
        </div>

        {/* Step Name (read-only) */}
        <div>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5">
            <FileText size={14} /> Name
          </label>
          <input
            type="text"
            value={step.name || ''}
            readOnly
            disabled
            className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-neutral-50 dark:bg-[#383838]/50 text-neutral-700 dark:text-neutral-200 cursor-not-allowed outline-none"
          />
        </div>

        {/* Description (read-only) */}
        <div>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5">
            <FileText size={14} /> Description
          </label>
          <textarea
            value={step.description || ''}
            readOnly
            disabled
            rows={2}
            className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-[#484848] rounded-lg bg-neutral-50 dark:bg-[#383838]/50 text-neutral-700 dark:text-neutral-200 cursor-not-allowed outline-none resize-none"
          />
        </div>

        {/* Credentials Section */}
        {step.credentials_needed?.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-2">
              <Key size={14} /> Credentials Required
            </label>
            <div className="space-y-2.5">
              {step.credentials_needed.map((cred) => {
                const value = getCredentialValue(cred.key)
                const isVisible = showSecrets[cred.key]
                const isFilled = value.length > 0

                return (
                  <div key={cred.key} className={`border rounded-lg p-3 transition-all ${
                    isFilled ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/20' : 'border-neutral-200 dark:border-[#484848] bg-neutral-50/30 dark:bg-[#383838]/30'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{cred.label || cred.key}</span>
                      <Tooltip content={isFilled ? 'Credential set' : 'Credential missing'}>
                        {isFilled ? (
                          <CheckCircle2 size={12} className="text-emerald-500" />
                        ) : (
                          <AlertCircle size={12} className="text-neutral-500" />
                        )}
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        value={value}
                        onChange={(e) => handleCredentialChange(cred.key, e.target.value)}
                        placeholder={`Enter ${cred.label || cred.key}...`}
                        className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-neutral-200 dark:border-[#484848] rounded-md bg-white dark:bg-[#383838] text-neutral-900 dark:text-neutral-100 focus:border-primary-300 focus:ring-1 focus:ring-primary-100 outline-none transition-all"
                      />
                      <Tooltip content={isVisible ? 'Hide value' : 'Reveal value'}>
                        <button
                          onClick={() => toggleSecretVisibility(cred.key)}
                          aria-label={isVisible ? 'Hide value' : 'Reveal value'}
                          className="p-1.5 text-neutral-400 dark:text-neutral-300 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors"
                        >
                          {isVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </Tooltip>
                    </div>
                    {cred.type && (
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-300 mt-1">Type: {cred.type}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Verify Step Button */}
        {step.credentials_needed?.length > 0 && (
          <div>
            <button
              onClick={handleVerify}
              disabled={verifying || (step.credentials || []).length === 0}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                verifying
                  ? 'bg-neutral-200 dark:bg-[#484848] text-neutral-600 dark:text-neutral-300 cursor-wait'
                  : step.status === 'verified'
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-primary-500 hover:bg-primary-600 text-white'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {verifying ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Testing credentials...
                </>
              ) : step.status === 'verified' ? (
                <>
                  <CheckCircle2 size={14} />
                  Verified — Re-test
                </>
              ) : (
                <>
                  <Play size={14} />
                  Verify Step
                </>
              )}
            </button>

            {/* Verify result */}
            {verifyResult && (
              <div className={`mt-2 p-3 rounded-lg border text-xs ${
                verifyResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                  : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                <p className="font-medium">{verifyResult.success ? 'Success' : 'Failed'}</p>
                <p className="mt-0.5">{verifyResult.message || verifyResult.error}</p>
                {verifyResult.hint && (
                  <p className="mt-1 text-[10px] opacity-75">{verifyResult.hint}</p>
                )}
                {verifyResult.response_snippet && (
                  <pre className="mt-1.5 text-[10px] bg-white/50 rounded p-2 overflow-x-auto max-h-24 overflow-y-auto">
                    {verifyResult.response_snippet}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step code (read-only) — single unified viewer for both AI and code steps.
            For AI steps, the system_prompt is wrapped in a Pabbly-Functions-style
            template that mirrors how it actually runs on the function side.
            All edits flow through the Master Agent (set_step_prompt / set_step_code). */}
        <div>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider mb-1.5">
            <Code size={14} /> {step.step_type === 'code' ? 'JavaScript Code' : 'AI Step Code'}
          </label>
          <CodeView
            code={step.step_type === 'code' ? (step.code_body || '') : buildAiStepDisplayCode(step, stepIndex)}
            language="js"
            editable={false}
            rows={14}
            ariaLabel={step.step_type === 'code' ? 'Step code (read-only)' : 'AI step code (read-only)'}
            copyLabel="Copy code"
          />
        </div>

        {/* Delete Step */}
        {onDeleteStep && step?.id && (
          <div className="mt-6 mb-4">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
            >
              <Trash2 size={13} />
              Delete Step
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation — centered on main screen */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white dark:bg-[#2c2c2c] rounded-xl shadow-2xl border border-neutral-200 dark:border-[#484848] p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            <p className="text-[13px] text-neutral-800 dark:text-neutral-200 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold">"{step?.name}"</span>?
            </p>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-300 mt-1">This action cannot be undone.</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-3 py-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-[#484848] hover:bg-neutral-50 dark:hover:bg-[#383838] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  onDeleteStep(step.id)
                }}
                className="flex-1 px-3 py-2 text-[12px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConfigPanel
