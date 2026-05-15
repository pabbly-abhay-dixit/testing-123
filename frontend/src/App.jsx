import { Routes, Route, Navigate, useParams } from 'react-router-dom'

// Legacy URL redirects → canonical /workflows/:agentId path. The DB column
// + backend route + code identifier remain `agent` (Phase 2 rename intentional
// per CLAUDE.md), but the user-facing URL is part of the "Workflow" rebrand.
function BuilderRedirect() {
  const { agentId } = useParams()
  return <Navigate to={`/workflows/${agentId}`} replace />
}

function LegacyAgentsRedirect() {
  const { agentId } = useParams()
  return <Navigate to={`/workflows/${agentId}`} replace />
}
import DashboardLayout from './components/layout/DashboardLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Schedules from './pages/Schedules'
import Storage from './pages/Storage'
import Templates from './pages/Templates'
import SharedWithMe from './pages/SharedWithMe'
import SharedFolderDetail from './pages/SharedFolderDetail'
import AISettings from './pages/AISettings'
import Usage from './pages/Usage'
import Admin from './pages/Admin'
import BuilderPage from './pages/BuilderPage'
import SharePage from './pages/SharePage'
import DocsPage from './pages/DocsPage'
import ThanksPage from './pages/ThanksPage'
import PlanThanksPage from './pages/PlanThanksPage'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/thanks" element={<ThanksPage />} />
      {/* Subscription thanks — public so PSB's PayPal/Razorpay redirect
          callback can land here regardless of session state. The page
          auto-navigates to /usage/plan after 5s; unauthenticated users
          will get bounced to /login by the protected route guard. */}
      <Route path="/plan/thanks" element={<PlanThanksPage />} />

      {/* Dashboard routes */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        {/* /plans was a standalone page; folded into Usage as the "Plan" tab. */}
        <Route path="/plans" element={<Navigate to="/usage/plan" replace />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/shared" element={<SharedWithMe />} />
        <Route path="/shared/folders/:folderId" element={<SharedFolderDetail />} />
        <Route path="/templates" element={<Navigate to="/dashboard" replace />} />
        <Route path="/tools" element={<Navigate to="/dashboard" replace />} />
        <Route path="/ai-settings" element={<AISettings />} />
        <Route path="/settings/:tab?" element={<Navigate to="/dashboard" replace />} />
        <Route path="/credits" element={<Navigate to="/usage/credits" replace />} />
        <Route path="/usage/:tab?" element={<Usage />} />
        <Route path="/admin/:tab?" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
        <Route path="/docs" element={<DocsPage />} />
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Workflow builder — single view for all workflow interaction */}
      <Route
        path="/workflows/:agentId"
        element={
          <ProtectedRoute>
            <BuilderPage />
          </ProtectedRoute>
        }
      />

      {/* Public share page */}
      <Route path="/share/:token" element={<SharePage />} />

      {/* Legacy redirects: old /agents/:id and /builder/:id URLs keep working */}
      <Route path="/agents/:agentId" element={<LegacyAgentsRedirect />} />
      <Route path="/builder/:agentId" element={<BuilderRedirect />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
