import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bot, Star, Webhook, FileText, MessageSquare, Loader2, Layers } from 'lucide-react'
import { templatesAPI } from '../services/api'
import toast from 'react-hot-toast'
import Card from '../components/ui/Card'

const categoryFilters = [
  { id: 'all', label: 'All' },
  { id: 'popular', label: 'Popular' },
  { id: 'automation', label: 'Automation' },
  { id: 'content', label: 'Content' },
  { id: 'messaging', label: 'Messaging' },
]

const iconMap = {
  webhook: Webhook,
  content: FileText,
  chat: MessageSquare,
  default: Bot,
}

const Templates = () => {
  useEffect(() => { document.title = 'Pabbly AgenticAI | Templates'; return () => { document.title = 'Pabbly AgenticAI' } }, [])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [cloning, setCloning] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    templatesAPI.getAll()
      .then((res) => setTemplates(res.data.templates || []))
      .catch(() => toast.error('Failed to load templates'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = templates.filter((t) => {
    const matchesCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'popular' && t.popular) ||
      t.category === selectedCategory
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const handleClone = async (template) => {
    setCloning(template.id)
    try {
      const res = await templatesAPI.clone(template.id)
      const agent = res.data.agent
      toast.success(`"${template.name}" cloned with ${agent.files_count} files!`)
      navigate(`/workflows/${agent.slug || agent.id}`)
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to clone template'
      toast.error(msg)
    } finally {
      setCloning(null)
    }
  }

  // Skeleton matches the real card grid so the layout doesn't jump when
  // data arrives. Renders 6 placeholder cards (2 rows × 3 cols on desktop).
  const renderSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-[#3a3a3a] flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 bg-neutral-100 dark:bg-[#3a3a3a] rounded" />
              <div className="h-2.5 w-1/2 bg-neutral-100 dark:bg-[#3a3a3a] rounded" />
            </div>
          </div>
          <div className="space-y-1.5 mb-3">
            <div className="h-2.5 w-full bg-neutral-100 dark:bg-[#3a3a3a] rounded" />
            <div className="h-2.5 w-4/5 bg-neutral-100 dark:bg-[#3a3a3a] rounded" />
          </div>
          <div className="flex items-center justify-between">
            <div className="h-2.5 w-16 bg-neutral-100 dark:bg-[#3a3a3a] rounded" />
            <div className="h-7 w-24 bg-neutral-100 dark:bg-[#3a3a3a] rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  )

  return (
    <div className="p-3 sm:p-4 max-w-[1600px] mx-auto">
      {/* Unified page header — same pattern across all top-level pages */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm shadow-primary-500/20">
            <Layers size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 leading-tight">Workflow Templates</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
              Start with a pre-built template. Files, steps, and code are pre-loaded — just add your credentials.
            </p>
          </div>
        </div>
        <div className="relative sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#2c2c2c] border border-neutral-200 dark:border-[#484848] rounded-lg text-sm dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-400 transition-all"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-5 -mx-1 px-1">
        {categoryFilters.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              selectedCategory === cat.id
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-white dark:bg-[#2c2c2c] text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-[#484848] hover:border-neutral-300 dark:hover:border-neutral-600'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Grid — skeleton while loading, otherwise the real cards */}
      {loading ? renderSkeleton() : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((template) => {
          const Icon = iconMap[template.icon] || iconMap.default
          return (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                  <Icon size={20} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{template.name}</h3>
                    {template.popular && <Star size={12} className="text-neutral-500 dark:text-neutral-400 fill-primary-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-neutral-400">{template.files_count} files</span>
                    <span className="text-[10px] text-neutral-300">·</span>
                    <span className="text-[10px] text-neutral-400">{template.steps_count} steps</span>
                    {template.credentials_needed?.length > 0 && (
                      <>
                        <span className="text-[10px] text-neutral-300">·</span>
                        <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{template.credentials_needed.length} credential{template.credentials_needed.length > 1 ? 's' : ''} needed</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed mb-3">{template.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">{template.clone_count.toLocaleString()} cloned</span>
                <button
                  onClick={() => handleClone(template)}
                  disabled={cloning === template.id}
                  className="px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/20 dark:hover:bg-primary-900/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {cloning === template.id ? (
                    <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Cloning...</span>
                  ) : (
                    'Clone Workflow'
                  )}
                </button>
              </div>
            </Card>
          )
        })}
      </div>
      )}

      {/* Empty states — differentiate between zero templates total vs zero
          matching the current search/filter so the message is actionable. */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-12">
          <Bot size={32} className="mx-auto text-neutral-300 dark:text-neutral-500 mb-3" />
          {templates.length === 0 ? (
            <>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">No templates available yet</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Check back soon — new templates are added regularly.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">No templates match your search</p>
              <button
                onClick={() => { setSearchTerm(''); setSelectedCategory('all') }}
                className="mt-2 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Templates
