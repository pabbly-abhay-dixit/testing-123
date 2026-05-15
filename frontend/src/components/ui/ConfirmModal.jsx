import { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react'

const ConfirmContext = createContext(null)

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

export const ConfirmProvider = ({ children }) => {
  const [state, setState] = useState(null)

  // confirm({ ..., action }) — when `action` (an async fn) is passed,
  // the modal shows a loading spinner on the confirm button while the
  // action runs and stays open until the promise settles. Closes on
  // resolve, stays open with the original UI on reject (caller handles
  // its own toast/error). Without `action` the modal behaves classic:
  // resolves true on confirm, false on cancel.
  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', danger = false, warning = false, input = false, inputPlaceholder = '', inputDefault = '', inputMaxLength = null, action = null }) => {
    return new Promise((resolve) => {
      setState({ title, message, confirmLabel, danger, warning, input, inputPlaceholder, inputDefault, inputMaxLength, action, onResolve: resolve })
    })
  }, [])

  const handleConfirm = (value) => { state?.onResolve(value !== undefined ? value : true); setState(null) }
  const handleCancel = () => { state?.onResolve(false); setState(null) }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmModal
          {...state}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  )
}

const ConfirmModal = ({ title, message, confirmLabel, danger, warning, input, inputPlaceholder, inputDefault, inputMaxLength, action, onConfirm, onCancel }) => {
  const [inputValue, setInputValue] = useState(inputDefault || '')
  const [phase, setPhase] = useState('enter') // enter | visible | exit
  const [submitting, setSubmitting] = useState(false)
  const cancelRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase('visible')))
  }, [])

  useEffect(() => {
    if (!input) return
    const t = setTimeout(() => { inputRef.current?.focus() }, 80)
    return () => clearTimeout(t)
  }, [input])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !submitting) doClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [submitting])

  const doClose = () => {
    if (submitting) return // ignore closes while an action is in flight
    setPhase('exit')
    setTimeout(() => onCancel(), 160)
  }

  // Backdrop click is suppressed once the user has changed the input
  // value (rename folder, etc.) so an accidental off-modal click can't
  // wipe their in-progress edit. Cancel button + Escape still close.
  // For confirm-only modals (no input — e.g. delete confirms), the
  // backdrop always closes because there's nothing for the user to
  // "lose".
  const dirty = input && inputValue.trim() !== (inputDefault || '').trim()
  const onBackdropClick = () => { if (!dirty) doClose() }

  // When `action` is provided, run it inside the modal so the user sees
  // a loading spinner on the confirm button. Modal closes only after
  // the action's promise resolves; on rejection the modal stays open
  // and the caller's toast/error handling fires.
  const doConfirm = async () => {
    if (input && !inputValue.trim()) return
    if (action) {
      try {
        setSubmitting(true)
        const result = input ? await action(inputValue.trim()) : await action()
        setSubmitting(false)
        setPhase('exit')
        setTimeout(() => onConfirm(result === undefined ? true : result), 160)
      } catch (err) {
        // Stay open so the user can retry. Caller is responsible for
        // surfacing the error (toast, inline message, etc.).
        setSubmitting(false)
      }
      return
    }
    setPhase('exit')
    setTimeout(() => input ? onConfirm(inputValue.trim()) : onConfirm(), 160)
  }

  const btnStyles = danger
    ? 'bg-red-600 hover:bg-red-700'
    : warning
    ? 'bg-amber-500 hover:bg-amber-600'
    : 'bg-blue-600 hover:bg-blue-700'

  const isVisible = phase === 'visible'
  const isExit = phase === 'exit'

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Visual backdrop only — pointer-events disabled so the centering
          wrapper below receives outside-clicks (the wrapper sits on top
          in DOM order). */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: isExit ? 0 : isVisible ? 1 : 0,
          transition: `opacity ${isExit ? '150ms' : '200ms'}`,
        }}
      />

      {/* Centered dialog — matches PremiumModal shell used by Create Workflow / Create Folder */}
      <div className="fixed inset-0 flex items-center justify-center p-4" onClick={onBackdropClick}>
        <div
          className="w-full max-w-[440px]"
          style={{
            opacity: isExit ? 0 : isVisible ? 1 : 0,
            transform: isExit ? 'translateY(6px) scale(0.98)' : isVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: isExit ? 'all 150ms ease-in' : 'all 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="relative rounded-xl bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 overflow-hidden flex flex-col"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)' }}
          >
            <div className="relative z-10 px-6 py-6 flex flex-col">
              <h2 className="text-base font-semibold text-gray-900 dark:text-neutral-50">{title}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">{message}</p>

              {input && (
                <div className="mt-4">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && inputValue.trim() && doConfirm()}
                    placeholder={inputPlaceholder}
                    maxLength={inputMaxLength || undefined}
                    className="w-full h-9 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-sm text-gray-900 dark:text-neutral-100 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                  />
                  {inputMaxLength && (
                    <p className="mt-1.5 text-[11px] text-gray-400 dark:text-neutral-500 text-right tabular-nums">
                      {inputValue.length}/{inputMaxLength}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  ref={cancelRef}
                  onClick={doClose}
                  disabled={submitting}
                  className="h-9 px-4 text-sm font-medium rounded-xl border border-gray-300 dark:border-neutral-600 text-gray-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={doConfirm}
                  disabled={(input && !inputValue.trim()) || submitting}
                  className={`h-9 px-4 text-sm font-medium rounded-xl text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${btnStyles}`}
                >
                  {submitting && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                    </svg>
                  )}
                  {submitting ? 'Processing…' : confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
