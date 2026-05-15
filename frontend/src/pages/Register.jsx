import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Registration is handled exclusively on accounts.pabbly.com. This route just
// bounces to the same SSO entry as /login.
const SSO_REDIRECT_URL = import.meta.env.VITE_SSO_REDIRECT_URL

const Register = () => {
  useEffect(() => {
    document.title = 'Pabbly AgenticAI | Register'
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
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <div className="max-w-md text-center text-sm text-neutral-700">
          <p className="font-medium mb-2">Sign-up is misconfigured.</p>
          <p className="text-neutral-500">
            VITE_SSO_REDIRECT_URL is not set. Sign up at Pabbly Accounts directly,
            or configure the environment variable.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="text-sm text-neutral-500">Redirecting to Pabbly Accounts…</div>
    </div>
  )
}

export default Register
