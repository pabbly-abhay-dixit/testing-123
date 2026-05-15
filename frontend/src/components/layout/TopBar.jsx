import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowUpCircle, Menu, LogOut, Workflow, Search, Plus, ChevronDown, Sun, Moon, Coins, Pin, PinOff, CreditCard, ExternalLink, Gauge } from 'lucide-react'
import toast from 'react-hot-toast'
import { subscriptionsAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../context/AgentsContext'
import { useEntitlements } from '../../context/EntitlementsContext'
import { useTheme } from '../../context/ThemeContext'
import Tooltip from '../ui/Tooltip'
import UserAvatar from '../ui/UserAvatar'

const TopBar = ({ onMenuClick, hideAgentSwitcher = false, currentAgentName, mode = 'pinned', forcePinned = false, downtimeActive = false, downtimeMessage = null }) => {
  const { user, logout } = useAuth()
  const { agents } = useAgents()
  const { effective: entitlements } = useEntitlements()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [showMenu, setShowMenu] = useState(false)
  const [showAgentSwitcher, setShowAgentSwitcher] = useState(false)
  const [agentSearch, setAgentSearch] = useState('')
  const switcherRef = useRef(null)
  const searchInputRef = useRef(null)
  const menuRef = useRef(null)

  const isAutoHide = mode === 'auto-hide'
  // Default pinned ON (header visible). The user's preference persists in
  // localStorage so it's restored on the next page load. One-time migration
  // (`topbar_pinned_v2`) wipes any stale '0' from earlier testing so existing
  // users get the new visible-by-default behavior on next load; after that
  // the pin toggle persists normally.
  const [pinned, setPinned] = useState(() => {
    if (!isAutoHide) return true
    try {
      if (localStorage.getItem('topbar_pinned_v2') !== '1') {
        localStorage.removeItem('topbar_pinned')
        localStorage.setItem('topbar_pinned_v2', '1')
        return true
      }
      return localStorage.getItem('topbar_pinned') !== '0'
    } catch { return true }
  })
  const [hovered, setHovered] = useState(false)
  const showTimerRef = useRef(null)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    if (!isAutoHide) return
    try { localStorage.setItem('topbar_pinned', pinned ? '1' : '0') } catch {}
  }, [isAutoHide, pinned])

  useEffect(() => () => {
    clearTimeout(showTimerRef.current)
    clearTimeout(hideTimerRef.current)
  }, [])

  // Show immediately (no intent delay) so the header feels responsive; hide
  // after a tiny 150ms grace period so a 1-pixel mouse jitter doesn't yank
  // it away. The visual smoothness comes from the CSS transition, not from
  // the timer.
  const handleEnter = () => {
    clearTimeout(hideTimerRef.current)
    clearTimeout(showTimerRef.current)
    setHovered(true)
  }
  const handleLeave = () => {
    clearTimeout(showTimerRef.current)
    hideTimerRef.current = setTimeout(() => setHovered(false), 150)
  }

  // Auto-hide is paused while any dropdown / mobile-menu trigger is open so
  // the header doesn't yank itself out from under the user mid-interaction.
  // `forcePinned` is set during deploy-downtime so the warning banner +
  // pinned header remain visible regardless of the user's pin preference;
  // it does NOT mutate `pinned` itself, so the user's choice is restored
  // automatically when downtime ends.
  const anyDropdownOpen = showMenu || showAgentSwitcher
  const visible = !isAutoHide || pinned || hovered || anyDropdownOpen || forcePinned

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(agentSearch.toLowerCase())
  )

  // Close dropdowns on outside click. Single listener handles both the
  // agent switcher and the profile menu — the previous backdrop-overlay
  // approach (`<div fixed inset-0>`) for the profile menu broke in auto-hide
  // mode because the header's `transform` class makes nested fixed children
  // scope to the header rect, leaving clicks on the chat below uncaught.
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) {
        setShowAgentSwitcher(false)
        setAgentSearch('')
      }
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search when switcher opens
  useEffect(() => {
    if (showAgentSwitcher && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showAgentSwitcher])

  // "My Subscription" — server-mints a single-use PSB portal access_url
  // and we open it in a new tab. Mirrors PabblyConnect's
  // `go_to_client_portal()`. Toast surfaces backend reason on failure
  // (PSB unreachable, portal disabled, customer not yet linked).
  //
  // Popup-blocker dance: we MUST call `window.open()` synchronously inside
  // the click handler before any `await` so the browser keeps the
  // user-gesture context. Opening it AFTER the network round-trip used to
  // get blocked (Chrome, Firefox, Safari all flag post-await `window.open`
  // as programmatic) and the fallback `location.href = url` would replace
  // the current tab — exactly the "doesn't open in new tab" symptom users
  // hit. We seed the popup with `about:blank` here, then redirect it once
  // the access_url lands. `noopener` is set post-navigation by nulling
  // `win.opener` (passing `noopener` to `window.open` returns `null` and
  // we'd lose the handle we need).
  const [portalLoading, setPortalLoading] = useState(false)
  const handleOpenPortal = async () => {
    if (portalLoading) return
    setPortalLoading(true)
    const win = window.open('about:blank', '_blank')
    try {
      const { data } = await subscriptionsAPI.createPortalSession()
      const url = data?.access_url
      if (!url) throw new Error('No access_url returned')
      if (win && !win.closed) {
        // Null opener BEFORE navigating — there is a TOCTOU window if we
        // navigate first and null after: the newly loaded page can read
        // `window.opener` synchronously on its own `load` event and grab
        // a handle back to this tab before our nulling line runs. PSB is
        // trusted today, but defense-in-depth says order matters.
        win.opener = null
        win.location.replace(url)
      } else {
        // Popup blocker killed our pre-opened tab — surface a hint
        // instead of silently hijacking the current tab (which loses
        // the user's place on the Plans page).
        toast.error('Allow popups for Pabbly to open the subscription portal in a new tab.')
      }
      setShowMenu(false)
    } catch (e) {
      if (win && !win.closed) win.close()
      toast.error(e?.response?.data?.message || e?.response?.data?.error || 'Could not open Pabbly portal')
    } finally {
      setPortalLoading(false)
    }
  }

  const handleLogout = async () => {
    // logout() is async — it must complete (cookie cleared server-side) before
    // we navigate, otherwise the next /api/me call still has the old cookie.
    // logout() also handles the post-logout redirect itself (to accounts in prod
    // or stays on the page in local dev), so no manual navigate() here.
    await logout()
  }

  // Auto-hide is desktop-only — on mobile (<sm) the header always sits in
  // normal flow and the absolute-positioning classes are gated with sm: so
  // they never fire below the breakpoint. Parent must be `relative` for the
  // absolute anchor to land in the right place.
  const headerExtraCls = isAutoHide
    ? ` sm:absolute sm:top-0 sm:inset-x-0 sm:z-40 sm:transition-transform sm:duration-300 sm:ease-out sm:will-change-transform ${visible ? 'sm:translate-y-0' : 'sm:-translate-y-full'}`
    : ''

  return (
    <>
      {/* Hover-trigger band — only rendered when unpinned. The 10px tall zone
          carries the pointer events; inside, a 1px top line + a centered
          pull-tab handle make the affordance visible so users know where to
          aim. Header (z-40) covers this when revealed (z-30), so the indicator
          is only seen in the hidden state. */}
      {isAutoHide && !pinned && !forcePinned && (
        <div
          className="hidden sm:block absolute top-0 inset-x-0 h-2.5 z-30 cursor-pointer group"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          aria-hidden="true"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-neutral-300 dark:bg-neutral-600 group-hover:bg-primary-400 dark:group-hover:bg-primary-400 transition-colors duration-200" />
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-14 h-1 rounded-b-full bg-neutral-300 dark:bg-neutral-600 group-hover:w-20 group-hover:h-1.5 group-hover:bg-primary-500 transition-all duration-200 shadow-sm" />
        </div>
      )}
      {/* Desktop spacer — always rendered in auto-hide mode; height animates
          with `visible` so chat panels below shift up/down in sync with the
          header slide-in/out (sidebar-style reflow, not overlay). h-0 when
          hidden = chat takes full height; h-16 when revealed = chat slides
          down to make room. Mobile keeps the in-flow header so the spacer is
          gated to sm+. */}
      {isAutoHide && (
        <div
          className={`hidden sm:block flex-shrink-0 transition-[height] duration-300 ease-out ${visible ? 'h-16' : 'h-0'}`}
          aria-hidden="true"
        />
      )}
    <header
      className={`h-14 sm:h-16 bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 flex items-center px-3 sm:px-6 flex-shrink-0 transition-colors${headerExtraCls}`}
      onMouseEnter={isAutoHide ? handleEnter : undefined}
      onMouseLeave={isAutoHide ? handleLeave : undefined}
    >
      <div className="flex items-center flex-shrink-0">
        {/* Mobile menu button */}
        <Tooltip content="Open menu" position="bottom">
          <button
            onClick={onMenuClick}
            aria-label="Open menu"
            className="lg:hidden p-2 -ml-1 mr-1 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
          >
            <Menu size={20} />
          </button>
        </Tooltip>

        {/* Agent Switcher */}
        {user && !hideAgentSwitcher && (
          <div className="relative flex items-center" ref={switcherRef}>
            <Tooltip content={currentAgentName ? `Switch workflow — ${currentAgentName}` : 'Switch workflow'} position="bottom">
            <button
              onClick={() => setShowAgentSwitcher(!showAgentSwitcher)}
              aria-label="Switch workflow"
              aria-haspopup="menu"
              aria-expanded={showAgentSwitcher}
              className={`flex items-center space-x-2 pl-2 sm:pl-3 pr-2 sm:pr-3 -ml-2 sm:-ml-3 py-1.5 rounded-xl text-sm transition-colors ${
                showAgentSwitcher
                  ? 'bg-neutral-100 dark:bg-neutral-700'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-700'
              }`}
            >
              <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-neutral-900 dark:bg-neutral-900 text-white flex-shrink-0 shadow-sm">
                <Workflow size={14} />
              </div>
              <span className="font-medium text-neutral-900 dark:text-neutral-100 text-[13px] sm:text-sm">{(() => {
                const name = currentAgentName || 'Workflows'
                const limit = typeof window !== 'undefined' && window.innerWidth >= 640 ? 50 : 20
                if (name.length <= limit) return name
                const start = Math.ceil(limit * 0.6)
                const end = Math.floor(limit * 0.3)
                return name.slice(0, start) + '...' + name.slice(-end)
              })()}</span>
              <ChevronDown
                size={16}
                className={`text-neutral-400 flex-shrink-0 transition-transform duration-200 ${showAgentSwitcher ? 'rotate-180' : ''}`}
              />
            </button>
            </Tooltip>

            {/* Agent Switcher Dropdown */}
            {showAgentSwitcher && (
              <div className="absolute -left-2 sm:-left-3 top-full mt-2 bg-white dark:bg-neutral-800 rounded-2xl shadow-dropdown border border-neutral-100 dark:border-neutral-700 z-[60] animate-fade-in max-sm:fixed max-sm:left-3 max-sm:top-14 max-sm:w-64" style={{ minWidth: '280px' }}>
                <div className="py-2">
                  {/* Search */}
                  <div className="px-3 pb-2">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search workflows..."
                        value={agentSearch}
                        onChange={(e) => setAgentSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg placeholder-neutral-400 dark:text-neutral-100"
                      />
                    </div>
                  </div>

                  <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />

                  {/* View All Agents */}
                  <Link
                    to="/dashboard"
                    onClick={() => { setShowAgentSwitcher(false); setAgentSearch('') }}
                    className="flex items-center px-4 py-2 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/70 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    View All Workflows
                  </Link>

                  <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />

                  {/* Agents List — Link items so middle-click / Cmd+click
                      opens the agent in a new tab. */}
                  {filteredAgents.length > 0 ? (
                    <div className="max-h-64 overflow-y-auto py-1">
                      {filteredAgents.map((agent) => (
                        <Link
                          key={agent.id}
                          to={`/workflows/${agent.slug || agent.id}`}
                          onClick={() => {
                            setShowAgentSwitcher(false)
                            setAgentSearch('')
                          }}
                          className="w-full flex items-center px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/70 transition-colors"
                        >
                          <span className="truncate first-letter:uppercase">{agent.name}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-sm text-neutral-400 dark:text-neutral-500 text-center">
                      {agents.length === 0 ? 'No workflows yet' : 'No matching workflows'}
                    </div>
                  )}

                  <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />

                  {/* Create New Agent — Link with ?create=1 so middle-click
                      opens the dashboard with the create modal pre-open in a
                      new tab, and single-click does the same in-place. */}
                  <Link
                    to="/dashboard?create=1"
                    onClick={() => setShowAgentSwitcher(false)}
                    className="w-full flex items-center px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  >
                    <Plus size={16} className="mr-2 text-blue-600 dark:text-blue-400" />
                    Create New Workflow
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center spacer — desktop-only inline pill. Mobile renders a separate
          full-width banner below the header (see end of this component). */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-2">
        {downtimeActive && (
          <Tooltip
            content={downtimeMessage || "System update underway: You may experience brief chat disconnections (up to 2 minutes). Everything else will work as usual. Thanks for your patience!"}
            position="bottom"
            maxWidth={360}
          >
            <div
              role="status"
              aria-live="polite"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-400 dark:border-amber-500 bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 text-[13px] font-semibold cursor-help max-w-full shadow-sm dark:shadow-amber-500/20 animate-pulse"
            >
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-600 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600"></span>
              </span>
              <span className="truncate">System update underway · Brief chat disconnections (up to 2 min) · Other features work normally</span>
            </div>
          </Tooltip>
        )}
      </div>

      {/* Right: Units remaining + Pin + Profile */}
      <div className="flex items-center gap-3">
        {/* Compute-units-remaining badge. Reads from EntitlementsContext —
            same cached data as the /usage/plan tab, no extra network. Color
            shifts amber at ≤25 % left and red at ≤10 % so heavy users notice
            before they hit the cap and dispatch_run starts 402'ing. Hidden
            entirely on unlimited plans (`units_max_per_month === -1`) and
            when the context hasn't primed yet. Click to deep-link into the
            Plan tab where the bar + reset countdown live. */}
        {user && entitlements && entitlements.units_max_per_month !== -1 && entitlements.units_max_per_month > 0 && (() => {
          const used = entitlements.units_used_this_period || 0
          const max = entitlements.units_max_per_month
          const remaining = Math.max(0, max - used)
          const pct = remaining / max
          const tone = remaining === 0
            ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50'
            : pct <= 0.10
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50'
              : pct <= 0.25
                ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
          return (
            <Tooltip
              content={`${used.toLocaleString()}/${max.toLocaleString()} compute units used. 1 unit = 30 seconds of workflow runtime.`}
              position="bottom"
            >
              <button
                onClick={() => navigate('/usage/plan')}
                aria-label={`${remaining.toLocaleString()} compute units remaining`}
                className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs sm:text-sm transition-colors ${tone}`}
              >
                <Gauge size={14} className="sm:w-[15px] sm:h-[15px]" />
                <span className="font-medium tabular-nums">
                  {remaining.toLocaleString()}
                  <span className="hidden sm:inline"> CU left</span>
                </span>
              </button>
            </Tooltip>
          )
        })()}

        {/* Pin toggle — only in auto-hide mode (BuilderPage), desktop only.
            Persists to localStorage; default is unpinned so chat takes the
            full height on first visit. */}
        {isAutoHide && (
          <Tooltip content={pinned ? 'Unpin header (auto-hide)' : 'Pin header (always visible)'} position="bottom">
            <button
              onClick={() => setPinned((p) => !p)}
              aria-label={pinned ? 'Unpin header' : 'Pin header'}
              aria-pressed={pinned}
              className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                pinned
                  ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30'
                  : 'text-neutral-400 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              }`}
            >
              {pinned ? <Pin size={15} className="fill-current" /> : <PinOff size={15} />}
            </button>
          </Tooltip>
        )}

        {/* User profile dropdown — PPM-style: avatar + name + chevron in
            one rounded button. Name hides below sm breakpoint. */}
        <div className="relative" ref={menuRef}>
        <Tooltip content="Account menu" position="bottom">
          <button
            onClick={() => setShowMenu(!showMenu)}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={showMenu}
            className="flex items-center gap-2 sm:gap-3 px-1.5 sm:px-3 py-1 sm:py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors duration-200"
          >
            <UserAvatar user={{ name: user?.name || user?.email, avatar: user?.avatar_url }} size="md" />
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 hidden sm:block max-w-[140px] truncate">
              {user?.name || user?.email}
            </span>
            <ChevronDown size={16} className={`text-neutral-400 hidden sm:block transition-transform duration-200 ${showMenu ? 'rotate-180' : ''}`} />
          </button>
        </Tooltip>

        {showMenu && (
          <>
            {/* Outside-click close is handled by the document mousedown listener
                (see useEffect above) — using a ref-based check works in
                auto-hide mode where the header's transform breaks nested fixed
                overlays. */}
            <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-neutral-800 rounded-2xl shadow-dropdown border border-neutral-100 dark:border-neutral-700 py-2 z-50 animate-scale-in">
              {/* Name + email header */}
              {user && (
                <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{user.name || user.email}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">{user.email}</p>
                </div>
              )}

              <div className="py-1">
                {/* Theme toggle — PPM tokens: bg-neutral-100 wrapper, rounded-lg
                    p-1, each pill is rounded-md with shadow-sm when active. */}
                <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">Theme</p>
                  <div className="flex bg-neutral-100 dark:bg-neutral-700 rounded-lg p-1">
                    {[
                      { id: 'light', icon: Sun, label: 'Light' },
                      { id: 'dark', icon: Moon, label: 'Dark' },
                    ].map(({ id, icon: Icon, label }) => (
                      <button
                        key={id}
                        onClick={() => setTheme(id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          theme === id
                            ? 'bg-white dark:bg-neutral-600 text-neutral-900 dark:text-neutral-100 shadow-sm'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                        }`}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* My Subscription — auto-logs into the PSB customer portal
                    via /api/me/portal-session. Mirrors PabblyConnect's
                    "My Subscription" entry. */}
                <button
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  <span className="flex items-center">
                    <CreditCard size={18} className="mr-3 text-neutral-400" />
                    My Subscription
                  </span>
                  <ExternalLink size={14} className="text-neutral-400" />
                </button>

                {/* Sign out — divider above + red text */}
                <div className="border-t border-neutral-100 dark:border-neutral-700 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut size={18} className="mr-3" />
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </header>

    {/* Mobile-only maintenance pill — full-width pill under the header,
        same colors as the desktop pill. Uses the available row width so
        the longer desktop copy can fit without truncation. */}
    {downtimeActive && (
      <div className="sm:hidden px-3 py-2">
        <div
          role="status"
          aria-live="polite"
          className="flex w-full items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-400 dark:border-amber-500 bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 text-[12px] font-semibold shadow-sm dark:shadow-amber-500/20 animate-pulse"
        >
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-600 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600"></span>
          </span>
          <span className="truncate">System update underway · Brief chat disconnections · Other features work normally</span>
        </div>
      </div>
    )}
    </>
  )
}

export default TopBar
