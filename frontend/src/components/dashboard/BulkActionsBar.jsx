import { FolderInput, ToggleRight, ToggleLeft, Trash2, RotateCcw, X, Users, Loader2 } from 'lucide-react'

// Top selection bar styled in PPM's filter-bar visual language. Renders only
// when at least one row is selected. PPM doesn't ship a bulk-action toolbar
// of its own, so this is new — but uses the same surface tokens as PPM's
// filter container for visual consistency.
//
// In Trash mode the action set swaps to Restore / Delete Permanently. Every
// button delegates to a single `onAction(actionKey)` callback so the parent
// owns the API wiring (kept identical to the previous Dashboard handlers).
//
// Team Access opens the per-workflow collaborator modal for a single
// selection, or the multi-resource ShareComposeModal pre-loaded with the
// selected workflow ids when multiple rows are selected.
//
// `loading` is the in-flight action key ('activate' / 'deactivate' / 'delete'
// / etc.) when a bulk request is mid-flight. The matching button shows a
// spinner and every action button is disabled until the parent clears the
// state. Activate/deactivate now fan out per-agent PF toggle calls, so a
// 10-row selection can take several seconds — without this affordance the UI
// looked frozen.
const BulkActionsBar = ({ count, isTrash, onAction, onClear, loading }) => {
  const busy = !!loading
  const btnBase = 'inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const neutral = 'text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-neutral-600'
  const danger = 'text-gray-700 dark:text-white hover:bg-red-100 dark:hover:bg-red-500/20'
  const success = 'text-gray-700 dark:text-white hover:bg-emerald-100 dark:hover:bg-emerald-500/20'

  const Icon = ({ action, fallback: Fallback, size = 14 }) =>
    loading === action ? <Loader2 size={size} className="animate-spin" /> : <Fallback size={size} />

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-3">
      <span className="text-sm font-medium text-gray-700 dark:text-neutral-200">
        {count} selected
      </span>
      <div className="hidden sm:block h-5 w-px bg-gray-200 dark:bg-neutral-700" />

      {isTrash ? (
        <>
          <button
            onClick={() => onAction('restore')}
            disabled={busy}
            className={`${btnBase} ${neutral}`}
          >
            <Icon action="restore" fallback={RotateCcw} /> {loading === 'restore' ? 'Restoring…' : 'Restore'}
          </button>
          <button
            onClick={() => onAction('permanent_delete')}
            disabled={busy}
            className={`${btnBase} ${danger}`}
          >
            <Icon action="permanent_delete" fallback={Trash2} /> {loading === 'permanent_delete' ? 'Deleting…' : 'Delete Permanently'}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => onAction('move')}
            disabled={busy}
            className={`${btnBase} ${neutral}`}
          >
            <Icon action="move" fallback={FolderInput} /> Move
          </button>
          <button
            onClick={() => onAction('team_access')}
            disabled={busy}
            className={`${btnBase} ${neutral}`}
          >
            <Icon action="team_access" fallback={Users} /> Team Access
          </button>
          <button
            onClick={() => onAction('activate')}
            disabled={busy}
            className={`${btnBase} ${success}`}
          >
            <Icon action="activate" fallback={ToggleRight} /> {loading === 'activate' ? 'Activating…' : 'Activate'}
          </button>
          <button
            onClick={() => onAction('deactivate')}
            disabled={busy}
            className={`${btnBase} ${danger}`}
          >
            <Icon action="deactivate" fallback={ToggleLeft} /> {loading === 'deactivate' ? 'Deactivating…' : 'Deactivate'}
          </button>
          {/* "Trash" because the action soft-deletes (moves to trash).
              The actual hard "Delete" lives on the trash side under
              "Delete Permanently". */}
          <button
            onClick={() => onAction('delete')}
            disabled={busy}
            className={`${btnBase} ${danger}`}
          >
            <Icon action="delete" fallback={Trash2} /> {loading === 'delete' ? 'Trashing…' : 'Trash'}
          </button>
        </>
      )}

      <button
        onClick={onClear}
        disabled={busy}
        className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-sm text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={14} /> Clear
      </button>
    </div>
  )
}

export default BulkActionsBar
