import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { LayoutDashboard, Layers, ChevronsLeft, ChevronsRight, BarChart2, ShieldCheck, BookOpen, Key, Users, CalendarClock, HardDrive } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Tooltip from '../ui/Tooltip'

// Typewriter label — shows characters appearing/disappearing one by one
// Fixed width container prevents DOM shaking
const SidebarLabel = ({ text, expanded, delay = 0, className = '' }) => {
  const [count, setCount] = useState(expanded ? text.length : 0)
  const timerRef = useRef(null)
  const delayRef = useRef(null)
  const prevExpandedRef = useRef(expanded)
  const prevTextRef = useRef(text)

  useEffect(() => {
    const expandedChanged = expanded !== prevExpandedRef.current
    const textChanged = text !== prevTextRef.current
    prevExpandedRef.current = expanded
    prevTextRef.current = text

    // If text changed while expanded (e.g. "Collapse" ↔ "Expand"), snap to full length
    if (textChanged && expanded && !expandedChanged) {
      if (timerRef.current) clearInterval(timerRef.current)
      if (delayRef.current) clearTimeout(delayRef.current)
      setCount(text.length)
      return
    }

    if (!expandedChanged) return
    if (timerRef.current) clearInterval(timerRef.current)
    if (delayRef.current) clearTimeout(delayRef.current)

    const run = () => {
      const target = expanded ? text.length : 0
      // When expanding with a new text, start from 0
      if (expanded && textChanged) setCount(0)
      const step = expanded ? 1 : -1
      timerRef.current = setInterval(() => {
        setCount(c => {
          const next = c + step
          if ((expanded && next >= target) || (!expanded && next <= 0)) {
            clearInterval(timerRef.current)
            return expanded ? target : 0
          }
          return next
        })
      }, expanded ? 28 : 18)
    }

    if (delay > 0 && expanded) {
      delayRef.current = setTimeout(run, delay)
    } else {
      run()
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); if (delayRef.current) clearTimeout(delayRef.current) }
  }, [expanded, text, delay])

  if (count === 0) return null
  return (
    <span className={`ml-2.5 inline-block whitespace-nowrap overflow-hidden ${className}`}>
      {text.slice(0, count)}
    </span>
  )
}

const navSections = [
  {
    label: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', tip: 'All your workflows in one place' },
      { id: 'schedules', label: 'Schedules', icon: CalendarClock, path: '/schedules', tip: 'Recurring runs across all your workflows' },
      { id: 'storage', label: 'Storage', icon: HardDrive, path: '/storage', tip: 'Files saved by your workflows — generated outputs + persistent state' },
      { id: 'shared', label: 'Sharing', icon: Users, path: '/shared', tip: 'Workflows shared by you and with you, plus team-member management' },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { id: 'usage', label: 'Plans & Usage', icon: BarChart2, path: '/usage', tip: 'Subscription plan, AI Credit balance, and BYOK token usage' },
      // BYOK API key management — sits above Admin Panel in the sidebar.
      // Visible to all users (admin and non-admin alike) so anyone can plug in
      // their own Anthropic / OpenAI / Google / OpenRouter key.
      { id: 'ai-settings', label: 'AI Settings', icon: Key, path: '/ai-settings', tip: 'Connect your own AI provider API keys (BYOK)' },
    ],
  },
]

const DashboardSidebar = ({ activeTab, collapsed, onToggleCollapse, mobileOpen, onCloseMobile }) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [hovered, setHovered] = useState(false)
  const isExpanded = !collapsed || hovered

  // Build sections dynamically — filter out adminOnly sections for non-admins,
  // and append the Admin Panel section when the user is an admin.
  const sections = user?.is_admin
    ? [...navSections, { label: 'ADMIN', items: [{ id: 'admin', label: 'Admin Panel', icon: ShieldCheck, path: '/admin', tip: 'Platform-wide settings, providers, pricing, users' }] }]
    : navSections.filter(s => !s.adminOnly)

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        onMouseEnter={() => collapsed && window.innerWidth >= 1024 && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`
          bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 flex flex-col flex-shrink-0 z-50 transition-[width] duration-[400ms] ease-in-out overflow-hidden
          ${!isExpanded ? 'w-16' : 'w-52'}
          ${collapsed && hovered ? 'shadow-xl' : ''}
          fixed inset-y-0 left-0 lg:relative
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo — anchor element so middle-click / Cmd+click opens dashboard
            in a new tab, matching the rest of the sidebar nav (which uses
            <Link>). The previous div+navigate version blocked native browser
            shortcuts. */}
        {/* Tooltip wrapper forced w-full in BOTH collapsed and expanded
            modes so the inner Link spans the entire sidebar width.
            Without this, the Tooltip's default `inline-flex` shrinks to
            the icon's content width — causing two visible problems in
            collapsed mode: (1) the Pabbly logo no longer centers in the
            64px sidebar (it sits at the inline-flex's left edge), and
            (2) the Link's border-b stops at the icon's right edge
            instead of reaching the sidebar's right edge, so it visually
            disconnects from the TopBar's border-b at the corner. */}
        <Tooltip content="Go to dashboard" position="right" className="w-full">
          <Link
            to="/dashboard"
            aria-label="Go to dashboard"
            className={`flex items-center border-b border-neutral-200 dark:border-neutral-700 h-14 sm:h-16 cursor-pointer group overflow-hidden whitespace-nowrap w-full ${!isExpanded ? 'justify-center px-0' : 'px-3'}`}
          >
            <img src="/favicon.svg" alt="Pabbly" className="w-8 h-8 flex-shrink-0 transition-transform duration-200 group-hover:scale-105" />
            <SidebarLabel text="Pabbly AgenticAI" expanded={isExpanded} delay={50} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100" />
          </Link>
        </Tooltip>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto py-4 ${!isExpanded ? 'flex flex-col items-center px-0' : 'px-3'}`}>
          {(() => { let itemIdx = 0; return sections.map((section, idx) => (
            <div key={section.label} className={`${idx > 0 ? 'mt-1' : ''} ${!isExpanded ? 'w-full flex flex-col items-center' : ''}`}>
              <div className={`space-y-1 ${!isExpanded ? 'flex flex-col items-center' : ''}`}>
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  const staggerDelay = (itemIdx++) * 60 // 60ms stagger between each item

                  const btn = (
                    <Link
                      key={item.id}
                      to={item.path}
                      onClick={() => onCloseMobile()}
                      className={`flex items-center justify-center text-sm font-medium transition-all duration-150 no-underline
                        ${!isExpanded ? 'h-10 w-10' : 'w-full px-3 h-10 justify-start'}
                        rounded-2xl
                        ${isActive
                          ? 'bg-neutral-900 dark:bg-neutral-700 text-white shadow-sm'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-800 dark:hover:text-neutral-200'
                        }
                      `}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={isActive ? 2 : 1.5} />
                      <SidebarLabel text={item.label} expanded={isExpanded} delay={staggerDelay} />
                    </Link>
                  )

                  // Always wrap in Tooltip to prevent unmount/remount killing typewriter animation.
                  // When collapsed, show the label (since label is hidden); when expanded,
                  // show the descriptive tip so the tooltip adds info beyond the visible label.
                  // className="w-full" required when expanded so the Tooltip's inline-flex
                  // wrapper doesn't shrink the nav item to content width.
                  return (
                    <Tooltip key={item.id} content={isExpanded ? (item.tip || '') : item.label} position="right" className={isExpanded ? 'w-full' : ''}>
                      {btn}
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          )) })()}
        </nav>

        {/* Docs link */}
        <div className={`${!isExpanded ? 'flex justify-center px-0' : 'px-3'} pb-1`}>
          <Tooltip content={isExpanded ? 'User guide, API reference, and admin docs' : 'Docs'} position="right" className={!isExpanded ? '' : 'w-full'}>
            <Link
              to="/docs"
              onClick={() => onCloseMobile()}
              className={`flex items-center text-sm font-medium transition-all duration-150 no-underline rounded-2xl
                ${!isExpanded ? 'justify-center h-10 w-10' : 'w-full px-3 h-10'}
                ${activeTab === 'docs'
                  ? 'bg-neutral-900 dark:bg-neutral-700 text-white shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-800 dark:hover:text-neutral-200'
                }
              `}
            >
              <BookOpen className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={activeTab === 'docs' ? 2 : 1.5} />
              <SidebarLabel text="Docs" expanded={isExpanded} />
            </Link>
          </Tooltip>
        </div>

        {/* Collapse toggle */}
        <div className={`border-t border-neutral-100 dark:border-neutral-700 ${!isExpanded ? 'flex justify-center py-3' : 'px-3 py-3'}`}>
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} position="right" className={!isExpanded ? '' : 'w-full'}>
            <button
              onClick={onToggleCollapse}
              className={`flex items-center rounded-lg text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-all duration-150
                ${!isExpanded ? 'justify-center h-10 w-10' : 'w-full px-3 h-10'}
              `}
            >
              {collapsed ? <ChevronsRight className="w-[18px] h-[18px] flex-shrink-0" /> : <ChevronsLeft className="w-[18px] h-[18px] flex-shrink-0" />}
              {isExpanded && <span className="ml-2.5 text-sm whitespace-nowrap">{collapsed ? 'Expand' : 'Collapse'}</span>}
            </button>
          </Tooltip>
        </div>
      </aside>
    </>
  )
}

export default DashboardSidebar
