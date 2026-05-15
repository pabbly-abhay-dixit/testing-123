import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  HardDrive,
  FileText,
  FileCog,
  Search,
  RefreshCw,
  Loader2,
  Eye,
  Download,
  X,
  FolderOpen,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { storageAPI, workflowsAPI } from '../services/api'
import Tooltip from '../components/ui/Tooltip'
import SearchableSelect from '../components/ui/SearchableSelect'

// ─── Atoms ─────────────────────────────────────────────────────────────────

const fmtSize = (bytes) => {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const fmtRelative = (iso) => {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtAbsoluteLong = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} at ${time}`
}

// Two-line action/description tooltip — mirrors Dashboard.tipLines.
const tipLines = (action, description) => (
  <div className="leading-snug">
    <div className="text-white">{action}</div>
    {description && <div className="text-neutral-300 mt-1">{description}</div>}
  </div>
)

const FolderBadge = ({ folder }) => {
  const styles =
    folder === 'management'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
      : folder === 'generated'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-neutral-700/40 dark:text-neutral-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {folder || 'other'}
    </span>
  )
}

// ─── Usage card ────────────────────────────────────────────────────────────

const UsageCard = ({ usage }) => {
  if (!usage) return null
  const pct = Math.min(100, Math.round(((usage.bytes_used || 0) / Math.max(1, usage.bytes_limit || 1)) * 100))
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-3 sm:p-4 mb-4 sm:mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-neutral-200">
          <HardDrive size={16} className="text-gray-400" />
          <Tooltip content={tipLines(`${fmtSize(usage.bytes_used)} of ${fmtSize(usage.bytes_limit)}`, 'Bytes used out of your storage quota')} delay={300} position="bottom">
            <span className="font-semibold text-gray-900 dark:text-neutral-100 cursor-default">
              {fmtSize(usage.bytes_used)} <span className="text-gray-400">/ {fmtSize(usage.bytes_limit)}</span>
            </span>
          </Tooltip>
          <span className="text-gray-300 dark:text-neutral-600">·</span>
          <Tooltip content={tipLines(`${usage.file_count} of ${usage.file_limit} files`, 'File count against your quota')} delay={300} position="bottom">
            <span className="text-xs text-gray-500 dark:text-neutral-400 cursor-default">
              {usage.file_count} / {usage.file_limit} files
            </span>
          </Tooltip>
        </div>
        {usage.refreshed_at && (
          <Tooltip content={fmtAbsoluteLong(usage.refreshed_at)} delay={300} position="bottom">
            <span className="text-[11px] text-gray-400 cursor-default">
              updated {fmtRelative(usage.refreshed_at)}
            </span>
          </Tooltip>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-700/40">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Content preview modal ────────────────────────────────────────────────

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/x-ndjson',
])
const isTextMime = (m) => !m || m.startsWith('text/') || TEXT_MIMES.has(m)
const INLINE_CAP_BYTES = 1024 * 1024 // 1 MB

function PreviewModal({ open, file, agentId, onClose }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || !file) return
    let cancelled = false
    setContent(null)
    setError(null)
    setLoading(true)
    storageAPI
      .getFileContent(agentId, file.path)
      .then((res) => {
        if (cancelled) return
        const payload = res.data || {}
        try {
          const bin = atob(payload.body_base64 || '')
          if (isTextMime(payload.content_type) && bin.length <= INLINE_CAP_BYTES) {
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            const text = new TextDecoder('utf-8').decode(bytes)
            setContent({ kind: 'text', text, ...payload })
          } else {
            setContent({ kind: 'binary', base64: payload.body_base64, ...payload })
          }
        } catch (e) {
          setError(e.message || 'Failed to decode body')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || err.message || 'Failed to load file')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, file, agentId])

  if (!open || !file) return null

  const handleDownload = () => {
    const src = content?.body_base64 || content?.base64
    if (!src) return
    const bin = atob(src)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: content.content_type || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-neutral-700 px-4 py-3 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {file.folder === 'management' ? (
              <FileCog size={18} className="text-violet-500 flex-shrink-0" />
            ) : (
              <FileText size={18} className="text-amber-500 flex-shrink-0" />
            )}
            <span className="font-medium text-gray-900 dark:text-neutral-100 truncate" title={file.path}>
              {file.path}
            </span>
            <FolderBadge folder={file.folder} />
          </div>
          <div className="flex items-center gap-2">
            {content && (
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-xl transition-colors"
              >
                <Download size={14} /> Download
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-400"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading…
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {error}
            </div>
          )}
          {!loading && !error && content?.kind === 'text' && (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-gray-800 dark:text-neutral-200 leading-relaxed">
              {content.text}
            </pre>
          )}
          {!loading && !error && content?.kind === 'binary' && (
            <div className="text-sm text-gray-500 dark:text-neutral-400 py-4 text-center">
              {fmtSize(content.size)} of {content.content_type || 'binary content'} —
              <button
                onClick={handleDownload}
                className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
              >
                download to view
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────

const FOLDER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'generated', label: 'Generated' },
  { id: 'management', label: 'Management' },
]

export default function Storage() {
  const [workflows, setWorkflows] = useState([])
  const [selectedWorkflow, setSelectedWorkflow] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [files, setFiles] = useState([])
  const [usage, setUsage] = useState(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [filesError, setFilesError] = useState(null)
  const [preview, setPreview] = useState(null)

  // Load all workflows for the dropdown.
  useEffect(() => {
    let cancelled = false
    setLoadingWorkflows(true)
    workflowsAPI
      .getDashboard()
      .then((res) => {
        if (cancelled) return
        // axios returns the full response on success; data lives on `.data`.
        const list = (res.data?.workflows || []).filter((w) => !w.is_trashed)
        setWorkflows(list)
        if (list.length > 0 && !selectedWorkflow) {
          setSelectedWorkflow(list[0].id)
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load workflows')
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkflows(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load storage usage. Failures stay non-fatal — the UsageCard simply
  // doesn't render, the file list still works.
  // `force` = true when the user clicks Refresh — bypasses the 15-min cache
  // and re-lists R2 synchronously before returning. Mount calls pass false so
  // we don't list R2 on every navigation; the lazy refresh on the backend
  // handles staleness.
  const loadUsage = useCallback((force = false) => {
    storageAPI
      .getUsage(force)
      .then((res) => setUsage(res.data))
      .catch(() => {
        // Non-fatal — UsageCard renders null when usage is null.
      })
  }, [])
  useEffect(() => {
    loadUsage()
  }, [loadUsage])

  // Load files when the selected workflow changes. Folder filter is applied
  // CLIENT-SIDE from the loaded `files` array, so switching All / Generated /
  // Management does not trigger another upstream list call.
  const reloadCounter = useRef(0)
  const loadFiles = useCallback(() => {
    if (!selectedWorkflow) {
      setFiles([])
      return
    }
    const seq = ++reloadCounter.current
    // Clear stale results so the header count / table never shows the
    // previous workflow's data while the new one is loading or errored.
    setFiles([])
    setLoadingFiles(true)
    setFilesError(null)
    storageAPI
      .listWorkflowFiles(selectedWorkflow, { limit: 100 })
      .then((res) => {
        if (seq !== reloadCounter.current) return
        setFiles(res.data?.items || [])
      })
      .catch((err) => {
        if (seq !== reloadCounter.current) return
        if (err.response?.status === 503) {
          setFilesError(
            err.response.data?.error ||
              'This workflow predates the storage feature. Re-create it to enable storage.'
          )
        } else if (err.response?.status === 403) {
          setFilesError("You don't have permission to view this workflow's files.")
        } else {
          setFilesError(err.response?.data?.error || err.message || 'Failed to load files')
        }
      })
      .finally(() => {
        if (seq === reloadCounter.current) setLoadingFiles(false)
      })
  }, [selectedWorkflow])
  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const filtered = useMemo(() => {
    let rows = files
    if (folderFilter && folderFilter !== 'all') {
      rows = rows.filter((f) => f.folder === folderFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((f) => f.path.toLowerCase().includes(q))
    }
    return rows
  }, [files, folderFilter, search])

  const selectedName = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflow)?.name || '',
    [workflows, selectedWorkflow]
  )

  const fileCount = filtered.length
  const totalLabel = loadingFiles
    ? '…'
    : `${fileCount} File${fileCount === 1 ? '' : 's'}`

  return (
    <div className="min-h-full bg-neutral-50 dark:bg-neutral-900 leading-normal">
      <div className="p-3 sm:p-6 overflow-x-hidden">

        {/* Header — title left, refresh button right. Matches Dashboard / Schedules. */}
        <div className="flex flex-row items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="min-w-0">
            <div className="block">
              <Tooltip
                content={tipLines(
                  'Files saved by your workflows',
                  'generated/ auto-expires after 7 days · management/ persists forever'
                )}
                delay={300}
                position="bottom"
              >
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100 cursor-default">
                  Storage
                </h1>
              </Tooltip>
            </div>
            <div className="block mt-0.5 sm:mt-1">
              <p className="text-gray-600 dark:text-neutral-400 text-sm sm:text-base">
                {selectedName ? `${selectedName} · ${totalLabel}` : totalLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <Tooltip
              content={tipLines(
                'Refresh the file list for the selected workflow',
                'Quota counters update on their own every 15 minutes'
              )}
              delay={300}
              position="bottom"
            >
              <button
                type="button"
                onClick={() => {
                  // Only re-list the active workflow. The per-user quota
                  // aggregate is a heavy operation (one upstream list per
                  // workflow), so we leave it to the lazy 15-minute TTL
                  // refresh — pressing this button every time the user
                  // adds a file shouldn't trigger an N-workflow fan-out.
                  loadFiles()
                }}
                disabled={loadingFiles}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-xl transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingFiles ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Quota usage */}
        <UsageCard usage={usage} />

        {/* Filter card — same surface as Schedules. */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm p-2 sm:p-3 mb-4 sm:mb-6">
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-5">
            {/* Workflow picker — SearchableSelect matches the design system
                and adds keyboard search for users with many workflows. */}
            <div className="sm:min-w-[240px] sm:max-w-[360px] sm:flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">
                Workflow
              </label>
              <SearchableSelect
                value={selectedWorkflow || null}
                onChange={(v) => setSelectedWorkflow(v || '')}
                options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                placeholder={loadingWorkflows ? 'Loading…' : workflows.length === 0 ? 'No workflows' : 'Select a workflow'}
                searchPlaceholder="Search workflows…"
                disabled={loadingWorkflows || workflows.length === 0}
                allowClear={false}
                className="w-full"
                triggerClassName="w-full"
                panelClassName="min-w-[260px]"
                listMaxHeightPx={420}
                usePortal
              />
            </div>

            {/* Folder chips */}
            <div className="sm:min-w-[260px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">
                Folder
              </label>
              <div className="inline-flex rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 p-0.5">
                {FOLDER_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFolderFilter(f.id)}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      folderFilter === f.id
                        ? 'bg-gray-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                        : 'text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="sm:min-w-[200px] sm:max-w-[280px] sm:flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-neutral-400 mb-1">
                Search
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search filenames…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-sm leading-5 border rounded-xl border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-gray-900 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus:border-neutral-500 dark:focus:border-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-neutral-600 rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X size={12} className="text-gray-400" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error banner (workflow predates feature / forbidden / network).
            Suppress while still loading workflows — the banner would flash
            briefly on mount and disappear once the workflow auto-selects. */}
        {filesError && !loadingFiles && !loadingWorkflows && (
          <div className="bg-white dark:bg-neutral-800 border border-amber-200 dark:border-amber-900/40 shadow-sm p-4 mb-4 rounded-xl flex items-start gap-3">
            <FolderOpen size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200">{filesError}</p>
          </div>
        )}

        {/* Table card — flat surface, mirrors Schedules table. */}
        {!filesError && (
          <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-sm">
            <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <table className="w-full lg:table-fixed bg-white dark:bg-neutral-800 divide-y divide-gray-200 dark:divide-neutral-700 min-w-0 sm:min-w-[700px]">
                <thead className="bg-gray-50 dark:bg-neutral-700 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">
                      Path
                    </th>
                    <th className="hidden md:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[140px]">
                      Folder
                    </th>
                    <th className="px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[110px]">
                      Size
                    </th>
                    <th className="hidden lg:table-cell px-3 lg:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[160px]">
                      Modified
                    </th>
                    <th className="px-3 lg:px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider lg:w-[80px]">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
                  {/* Skeleton during the initial workflow fetch too — otherwise
                      the "Select a workflow" empty state flashes between
                      mount and the first auto-selection. */}
                  {(loadingFiles || loadingWorkflows) ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-3/4" /></td>
                        <td className="hidden md:table-cell px-3 lg:px-4 py-3"><div className="h-5 bg-gray-200 dark:bg-neutral-700 rounded-full animate-pulse w-20" /></td>
                        <td className="px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-16" /></td>
                        <td className="hidden lg:table-cell px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-20" /></td>
                        <td className="px-3 lg:px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded animate-pulse w-4 ml-auto" /></td>
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <FolderOpen size={36} className="text-gray-300 dark:text-neutral-600 mb-3" />
                          <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-1">
                            {selectedName
                              ? search
                                ? 'No files match your search'
                                : `No files in ${selectedName} yet`
                              : 'Select a workflow to view its files'}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-neutral-400 max-w-sm">
                            Workflows save files automatically via the storage SDK. Once your workflow runs and writes to <code className="px-1 bg-gray-100 dark:bg-neutral-700 rounded text-[11px]">generated/</code> or <code className="px-1 bg-gray-100 dark:bg-neutral-700 rounded text-[11px]">management/</code>, they appear here.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((f) => (
                      <tr
                        key={f.path}
                        className="hover:bg-gray-50 dark:hover:bg-neutral-700/40 transition-colors cursor-pointer"
                        onClick={() => setPreview(f)}
                      >
                        <td className="px-3 lg:px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {f.folder === 'management' ? (
                              <FileCog size={14} className="text-violet-500 flex-shrink-0" />
                            ) : (
                              <FileText size={14} className="text-amber-500 flex-shrink-0" />
                            )}
                            <span
                              className="font-mono text-xs text-gray-900 dark:text-neutral-100 truncate"
                              title={f.path}
                            >
                              {f.path}
                            </span>
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-3 lg:px-4 py-3">
                          <FolderBadge folder={f.folder} />
                        </td>
                        <td className="px-3 lg:px-4 py-3 text-xs text-gray-600 dark:text-neutral-300">
                          {fmtSize(f.size)}
                        </td>
                        <td className="hidden lg:table-cell px-3 lg:px-4 py-3 text-xs text-gray-500 dark:text-neutral-400">
                          <Tooltip content={fmtAbsoluteLong(f.last_modified)} delay={300} position="bottom">
                            <span className="cursor-default">{fmtRelative(f.last_modified)}</span>
                          </Tooltip>
                        </td>
                        <td className="px-3 lg:px-4 py-3 text-right">
                          <Tooltip content={tipLines('Preview file content')} delay={300} position="left">
                            <span className="inline-flex items-center justify-center p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">
                              <Eye size={14} />
                            </span>
                          </Tooltip>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <PreviewModal
        open={!!preview}
        file={preview}
        agentId={selectedWorkflow}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}
