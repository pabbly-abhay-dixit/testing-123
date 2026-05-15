import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Read sidebar collapsed state from localStorage at render time so the
// skeleton sidebar uses the SAME width the real sidebar will use after auth
// resolves. Default to expanded (false) on first visit, matching DashboardLayout.
const readCollapsed = () => {
  try {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved ? JSON.parse(saved) : false
  } catch {
    return false
  }
}

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { isAuthenticated, loading, user } = useAuth()
  const location = useLocation()

  if (loading) {
    const collapsed = readCollapsed()
    return (
      <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-800">
        {/* Sidebar — width matches real DashboardSidebar (w-52 / w-16). */}
        <aside
          className={`hidden sm:flex flex-col flex-shrink-0 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 overflow-hidden ${collapsed ? 'w-16' : 'w-52'}`}
        >
          {/* Brand row — h-14 sm:h-16, px-3 expanded / centered collapsed */}
          <div className={`flex items-center border-b border-neutral-200 dark:border-neutral-700 h-14 sm:h-16 ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
            <div className="w-8 h-8 rounded-lg bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
            {!collapsed && <div className="ml-2.5 h-3.5 w-28 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />}
          </div>

          {/* Nav — flex-1 py-4, px-3 expanded / centered collapsed; 6 items
              (Dashboard, Sharing, Usage, AI Settings, Admin Panel, …) match
              the real sidebar's item count for an admin user. */}
          <nav className={`flex-1 overflow-hidden py-4 ${collapsed ? 'flex flex-col items-center px-0' : 'px-3'}`}>
            <div className={`space-y-1 ${collapsed ? 'flex flex-col items-center' : ''}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex items-center rounded-2xl ${collapsed ? 'h-10 w-10 justify-center' : 'h-10 w-full px-3 justify-start'}`}
                >
                  <div className="w-[18px] h-[18px] rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
                  {!collapsed && <div className="ml-2.5 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />}
                </div>
              ))}
            </div>
          </nav>

          {/* Docs link — pb-1, same item shape as nav */}
          <div className={`pb-1 ${collapsed ? 'flex justify-center px-0' : 'px-3'}`}>
            <div className={`flex items-center rounded-2xl ${collapsed ? 'h-10 w-10 justify-center' : 'h-10 w-full px-3'}`}>
              <div className="w-[18px] h-[18px] rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
              {!collapsed && <div className="ml-2.5 h-3 w-12 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />}
            </div>
          </div>

          {/* Collapse toggle — separate bordered section, h-10 button */}
          <div className={`border-t border-neutral-100 dark:border-neutral-700 ${collapsed ? 'flex justify-center py-3' : 'px-3 py-3'}`}>
            <div className={`flex items-center ${collapsed ? 'h-10 w-10 justify-center' : 'h-10 w-full px-3'}`}>
              <div className="w-[18px] h-[18px] rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
              {!collapsed && <div className="ml-2.5 h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />}
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar — h-14 sm:h-16, matches TopBar.jsx chrome */}
          <header className="h-14 sm:h-16 bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 flex items-center px-3 sm:px-6 flex-shrink-0">
            {/* Workflow switcher chip — w-6 h-6 logo + label + chevron */}
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-6 h-6 rounded-lg bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
              <div className="h-3.5 w-24 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
              <div className="w-4 h-4 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Right cluster — avatar+name button */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 sm:gap-3 px-1.5 sm:px-3 py-1 sm:py-1.5 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 animate-pulse flex-shrink-0" />
                <div className="h-3.5 w-20 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse hidden sm:block" />
                <div className="w-4 h-4 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse hidden sm:block" />
              </div>
            </div>
          </header>

          {/* Content area — bg matches DashboardLayout's <main>. Empty surface;
              the real page mounts inside this background after auth resolves
              and renders its own per-page skeleton (no chrome flash). */}
          <main className="flex-1 overflow-hidden bg-neutral-50 dark:bg-neutral-900" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Admin-only routes: non-admins are bounced to the dashboard rather than
  // shown an error page, matching how the sidebar hides these entries.
  if (adminOnly && !user?.is_admin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default ProtectedRoute
