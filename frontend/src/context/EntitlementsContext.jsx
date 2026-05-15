import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { subscriptionsAPI } from '../services/api'
import { useAuth } from './AuthContext'

// Single source of truth for the current user's effective entitlements +
// usage meters. Loaded once on mount, refreshed on demand. Anything that
// gates UI on a tier (Schedules, Sharing's Shared-by-me, future buy-flow
// CTAs) reads from here so we make ONE network call per session, not N.
//
// Falls open: if the load fails (network blip, no sub row yet for a brand
// new user), we show the UI as if the user had no caps applied — better
// to render the page and let the backend refuse than to leave the user
// staring at a misleading "this is locked" wall.

const EntitlementsContext = createContext({
  loaded: false,
  effective: null,
  subscriptions: [],
  refresh: async () => {},
})

const PERMISSIVE_FALLBACK = {
  workflows_max: -1,
  workflows_used: 0,
  team_members_max: -1,
  team_members_used: 0,
  units_max_per_month: -1,
  units_used_this_period: 0,
  schedulers_enabled: true,
  display_tier: 'free',
  display_label: 'Free',
  support_tier: 'community',
  contributing_sub_count: 0,
}

export function EntitlementsProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [loaded, setLoaded] = useState(false)
  const [effective, setEffective] = useState(null)
  const [subs, setSubs] = useState([])

  const refresh = useCallback(async () => {
    if (!user) {
      setLoaded(false)
      setEffective(null)
      setSubs([])
      return
    }
    try {
      const { data } = await subscriptionsAPI.getMine()
      setEffective(data?.effective || PERMISSIVE_FALLBACK)
      setSubs(data?.subscriptions || [])
      setLoaded(true)
    } catch (e) {
      // Fall open — never let an entitlements load failure block the app.
      setEffective(PERMISSIVE_FALLBACK)
      setSubs([])
      setLoaded(true)
    }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    refresh()
  }, [authLoading, refresh])

  return (
    <EntitlementsContext.Provider value={{ loaded, effective, subscriptions: subs, refresh }}>
      {children}
    </EntitlementsContext.Provider>
  )
}

export function useEntitlements() {
  return useContext(EntitlementsContext)
}
