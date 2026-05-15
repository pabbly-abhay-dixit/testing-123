import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Folder, Workflow, Loader2, User as UserIcon } from 'lucide-react'
import { teamAccessAPI } from '../services/api'
import toast from 'react-hot-toast'

const SharedFolderDetail = () => {
  const { folderId } = useParams()
  const [workflows, setWorkflows] = useState([])
  const [folder, setFolder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = folder?.name
      ? `Pabbly AgenticAI | ${folder.name}`
      : 'Pabbly AgenticAI | Shared Folder'
    return () => { document.title = 'Pabbly AgenticAI' }
  }, [folder?.name])

  useEffect(() => {
    teamAccessAPI
      .listSharedFolderWorkflows(folderId)
      .then((res) => {
        setWorkflows(res.data?.workflows || [])
        setFolder(res.data?.folder || null)
      })
      .catch(() => toast.error('Failed to load folder contents'))
      .finally(() => setLoading(false))
  }, [folderId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 size={20} className="animate-spin text-neutral-400 dark:text-neutral-500" />
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-4 max-w-[1600px] mx-auto">
      <Link
        to="/shared"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500 dark:text-neutral-400 hover:text-primary-600 dark:hover:text-primary-400 mb-4 transition-colors"
      >
        <ArrowLeft size={13} />
        Sharing
      </Link>

      {/* Page header — mirrors Dashboard pattern */}
      <div className="mb-6 flex items-start gap-3 sm:gap-4">
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm shadow-primary-500/20">
          <Folder size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1
            className="text-base sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 leading-tight truncate"
            style={{ letterSpacing: '-0.011em' }}
          >
            {folder?.name || 'Shared folder'}
          </h1>
          <p className="text-[12.5px] sm:text-[13px] text-neutral-500 dark:text-neutral-400 mt-0.5 flex items-center gap-1.5">
            {folder?.owner?.name && (
              <>
                <UserIcon size={11} className="flex-shrink-0" />
                <span>
                  Owned by{' '}
                  <span className="text-neutral-700 dark:text-neutral-300 font-medium">
                    {folder.owner.name}
                  </span>
                </span>
                <span className="text-neutral-300 dark:text-neutral-600">·</span>
              </>
            )}
            <span>
              {workflows.length} {workflows.length === 1 ? 'workflow' : 'workflows'}
            </span>
          </p>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4 bg-white dark:bg-[#2c2c2c] rounded-xl border border-neutral-200/70 dark:border-[#484848]">
          <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-500/15 flex items-center justify-center mb-4">
            <Folder size={22} className="text-primary-600 dark:text-primary-400" />
          </div>
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            This folder is empty
          </h2>
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400 mt-1.5">
            The owner hasn't created any workflows here yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {workflows.map((w) => (
            <Link
              key={w.id}
              to={`/workflows/${w.slug || w.id}`}
              className="group block p-4 rounded-xl border border-neutral-200/70 dark:border-[#484848] bg-white dark:bg-[#2c2c2c] hover:border-primary-300 dark:hover:border-primary-500/40 hover:shadow-sm transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-500/15 flex items-center justify-center mb-2.5">
                <Workflow size={16} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {w.name}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 capitalize">
                {w.status || 'draft'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default SharedFolderDetail
