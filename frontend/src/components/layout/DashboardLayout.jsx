import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import DashboardSidebar from './DashboardSidebar'
import TopBar from './TopBar'
import useSystemStatus from '../../hooks/useSystemStatus'

const DashboardLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved ? JSON.parse(saved) : false
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const downtime = useSystemStatus()

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed))
  }, [sidebarCollapsed])
  const location = useLocation()

  const getActiveTab = () => {
    const path = location.pathname
    if (path.startsWith('/settings')) return 'dashboard'
    if (path.startsWith('/templates')) return 'templates'
    if (path.startsWith('/schedules')) return 'schedules'
    if (path.startsWith('/shared')) return 'shared'
    if (path.startsWith('/storage')) return 'storage'
    // /plans is a redirect to /usage/plan now (folded into Usage as a tab),
    // so it falls through to the /usage branch below.
    if (path.startsWith('/credits') || path.startsWith('/usage') || path.startsWith('/plans')) return 'usage'
    if (path.startsWith('/ai-settings')) return 'ai-settings'
    if (path.startsWith('/admin')) return 'admin'
    if (path.startsWith('/docs')) return 'docs'
    return 'dashboard'
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-800">
      <DashboardSidebar
        activeTab={getActiveTab()}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onMenuClick={() => setMobileOpen(true)}
          forcePinned={downtime.active}
          downtimeActive={downtime.active}
          downtimeMessage={downtime.message}
        />
        <main className="flex-1 overflow-auto scrollbar-hide bg-neutral-50 dark:bg-neutral-900 min-h-0 transition-colors">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
