import { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)
const SSO_REDIRECT_URL = import.meta.env.VITE_SSO_REDIRECT_URL
// Forward-channel single sign-out target. Mirrors how PabblyConnect's nav links
// the logout button directly at accounts.pabbly.com/logout/. Hitting this URL
// destroys the accounts session — without it we'd send the user to the SSO
// entry, accounts would see them still signed in there, and immediately re-mint
// a token and bounce them back into agentic AI (looking like logout did nothing).
const SSO_LOGOUT_URL = import.meta.env.VITE_SSO_LOGOUT_URL

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // On mount, always call /api/me. With SSO the JWT lives in an HttpOnly cookie we
  // cannot read from JS — the request just needs to go out with credentials so the
  // cookie travels. For local Google flow we still have a Bearer token in localStorage;
  // the axios request interceptor attaches it when present.
  useEffect(() => {
    let stopped = false
    const verify = ({ markLoading } = { markLoading: false }) =>
      api.get('/api/me')
        .then((res) => {
          if (stopped) return
          setUser(res.data)
          try { localStorage.setItem('user', JSON.stringify(res.data)) } catch { /* ignore */ }
        })
        .catch((err) => {
          if (stopped) return
          if (err.response?.status === 401) {
            // Definitively unauthenticated. Clear any stale dev token + cached user.
            // The axios 401 interceptor will redirect to the SSO entry next.
            localStorage.removeItem('token')
            localStorage.removeItem('user')
            setUser(null)
          } else if (markLoading) {
            // Initial mount only: tolerate network/server errors (e.g. backend
            // is restarting) so the UI doesn't blank out. Re-validation on
            // focus / visibility silently no-ops on transient errors.
            const cachedUser = localStorage.getItem('user')
            if (cachedUser) {
              try { setUser(JSON.parse(cachedUser)) } catch { /* ignore */ }
            }
          }
        })
        .finally(() => {
          if (markLoading && !stopped) setLoading(false)
        })

    // Initial mount — show loading skeleton until first /api/me lands.
    verify({ markLoading: true })

    // Cross-app logout detection: when the user comes back to this tab, re-check
    // their session. If they logged out of accounts.pabbly.com in another tab,
    // their JWT cookie may still be valid here, but the next /api/me will succeed
    // until our cookie expires (≤ JWT_EXPIRY_HOURS). On focus we verify proactively
    // so the staleness window is "tab focus" instead of "cookie TTL".
    const onFocus = () => verify()
    const onVisible = () => {
      if (document.visibilityState === 'visible') verify()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const logout = async () => {
    // HttpOnly cookies cannot be cleared from JS — the backend must do it.
    // Swallow errors so logout always proceeds even if the network is flaky.
    try { await api.post('/api/auth/logout') } catch { /* ignore */ }
    localStorage.removeItem('token')
    localStorage.removeItem('user')

    // CRITICAL ordering: redirect BEFORE setUser(null).
    // setUser(null) triggers a React re-render → ProtectedRoute sees no user →
    // <Navigate to="/login"> → Login.jsx mounts → its useEffect calls
    // window.location.replace(SSO_REDIRECT_URL). That second navigation races
    // ours and the browser CANCELS the first one (visible in DevTools Network
    // as "logout/ canceled" followed by access?project=paa). Net effect: user
    // gets bounced to the SSO entry where accounts.pabbly.com still has a live
    // session and re-mints a token — looks like logout did nothing.
    if (SSO_LOGOUT_URL) {
      window.location.replace(SSO_LOGOUT_URL)
      return
    }
    if (SSO_REDIRECT_URL) {
      // Fallback when no logout URL is configured. Will re-auth if accounts
      // session is alive, but better than leaving the user on a stale page.
      window.location.replace(SSO_REDIRECT_URL)
      return
    }
    // Local dev path (no SSO env vars): just clear the in-memory user so the
    // login page renders the Google button.
    setUser(null)
  }

  const updateUser = (userData) => {
    setUser(userData)
    try { localStorage.setItem('user', JSON.stringify(userData)) } catch { /* ignore */ }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
