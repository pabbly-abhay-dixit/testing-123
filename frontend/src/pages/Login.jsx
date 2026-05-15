import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Single-gate auth: every unauthenticated visit goes through Pabbly Accounts SSO.
// VITE_SSO_REDIRECT_URL is required at build time — without it, the login page
// has no way to authenticate anyone and intentionally renders a blocking error.
const SSO_REDIRECT_URL = import.meta.env.VITE_SSO_REDIRECT_URL

const Login = () => {
  useEffect(() => {
    document.title = 'Pabbly AgenticAI | Login'
    return () => { document.title = 'Pabbly AgenticAI' }
  }, [])

  const { isAuthenticated, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (authLoading) return
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
      return
    }
    if (SSO_REDIRECT_URL) {
      window.location.replace(SSO_REDIRECT_URL)
    }
  }, [authLoading, isAuthenticated, navigate])

  if (!SSO_REDIRECT_URL) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#383838] px-4">
        <div className="max-w-md text-center text-sm text-neutral-700 dark:text-neutral-200">
          <p className="font-medium mb-2">Login is misconfigured.</p>
          <p className="text-neutral-500 dark:text-neutral-400">
            VITE_SSO_REDIRECT_URL is not set. Single sign-on through Pabbly
            Accounts is the only supported authentication method — set this
            variable in the deploy environment to enable login.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#383838] px-4">
      <div className="text-sm text-neutral-500 dark:text-neutral-400">
        Redirecting to Pabbly Accounts…
      </div>
    </div>
  )
}

export default Login
