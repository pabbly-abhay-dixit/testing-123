import { useState, useMemo } from 'react'
import { X, Plus, Pencil, Trash2, Pin, PinOff, Search, FolderPlus, FolderOpen, Users } from 'lucide-react'

// Manage Folders modal — replaces the inline folder tree sidebar.
// Triggered from the Folder filter dropdown footer in Dashboard. Wired to the
// existing handleCreateFolder / handleRenameFolder / handlePinFolder /
// handleDeleteFolder handlers (Dashboard.jsx) so API behavior is unchanged;
// only the UI surface moves.
//
// Single-layer folders only — nesting is intentionally not supported in this
// modal. Any legacy subfolders are filtered out of the list and the create
// form has no parent selector. Pinned folders sort to the top.
const FolderManagementModal = ({
  open,
  onClose,
  folders,
  pinnedFolders,
  onCreate,
  onRename,
  onPin,
  onDelete,
  onTeamAccess,
}) => {
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const sortedFolders = useMemo(() => {
    return folders
      .filter(f => !f.parent_id)
      .slice()
      .sort((a, b) => {
        const ap = pinnedFolders.includes(a.id) ? 0 : 1
        const bp = pinnedFolders.includes(b.id) ? 0 : 1
        if (ap !== bp) return ap - bp
        return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name)
      })
  }, [folders, pinnedFolders])

  const filtered = useMemo(() => {
    if (!search.trim()) return sortedFolders
    const q = search.trim().toLowerCase()
    return sortedFolders.filter(f => f.name.toLowerCase().includes(q))
  }, [sortedFolders, search])

  if (!open) return null

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await onCreate(newName.trim())
      setNewName('')
      setShowCreate(false)
    } finally {
      setCreating(false)
    }
  }

  // Right-side slide-over panel — exact PPM pattern from
  // ptm-app/components/UserStoryModal.jsx:800-815. Wraps the panel in a
  // `fixed inset-0` container with a separate backdrop and an absolutely-
  // positioned panel anchored to the right. Width: full on mobile, 70vw
  // sm, 60vw md, 50% (1/2) on lg — matches PPM's responsive sizing
  // adjusted to the user's "50%" preference on desktop.
  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* Right panel */}
      <div
        className="absolute top-0 right-0 bottom-0 bg-white dark:bg-neutral-800 shadow-2xl w-full sm:w-[70vw] md:w-[60vw] lg:w-1/2 overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Manage folders"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — PPM tokens (px-6 py-4, text-lg font-semibold, neutral-100 border) */}
        <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Manage Folders</h2>
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-md transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar — search + create */}
        <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-700 flex items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search folders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
          </div>
          <button
            onClick={() => { setShowCreate(true); setNewName('') }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap"
          >
            <Plus size={14} /> New Folder
          </button>
        </div>

        {/* Inline create form — name only (single-layer folders).
            No leading icon: the input itself is the affordance. */}
        {showCreate && (
          <div className="px-6 py-4 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-700 flex flex-wrap items-center gap-2">
            <input
              type="text"
              autoFocus
              placeholder="Folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              className="flex-1 min-w-[160px] px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus-visible:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Folder table — body fills remaining height with scroll */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <FolderOpen size={36} className="text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {search.trim() ? 'No folders match your search.' : 'No folders yet. Create your first one above.'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50 dark:bg-neutral-900 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider w-[110px]">Workflows</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider w-[120px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {filtered.map(f => {
                  return (
                    <tr key={f.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50">
                      <td className="px-6 py-3">
                        <div className="text-sm text-neutral-900 dark:text-neutral-100 truncate" title={f.name}>
                          {f.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-neutral-500 dark:text-neutral-400 tabular-nums">
                        {f.agent_count || 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {onTeamAccess && (
                            <button
                              onClick={() => onTeamAccess(f)}
                              title="Manage team access"
                              className="p-1.5 text-neutral-500 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-600 rounded-md transition-colors"
                            >
                              <Users size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => onRename(f.id, f.name)}
                            title="Rename"
                            className="p-1.5 text-neutral-500 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-600 rounded-md transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => onDelete(f.id)}
                            title="Delete"
                            className="p-1.5 text-neutral-500 dark:text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* No footer — header X button is the only close affordance.
            Removed the redundant "Done" button per the simplified panel
            spec. */}
      </div>
    </div>
  )
}

export default FolderManagementModal
