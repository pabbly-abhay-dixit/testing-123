import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { workflowsAPI } from '../services/api'
import { useAuth } from './AuthContext'

const AgentsContext = createContext(null)

export const useAgents = () => {
  const ctx = useContext(AgentsContext)
  if (!ctx) throw new Error('useAgents must be used within AgentsProvider')
  return ctx
}

export const AgentsProvider = ({ children }) => {
  const { isAuthenticated } = useAuth()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchAgents = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      // Slim dashboard endpoint — only TopBar (workflow switcher) and the
      // BuilderPage's `allAgents` prop consume this list, both of which only
      // read `id` / `name` / `slug`. Saves ~33 KB on every authenticated
      // page load (47 KB full LIST → 15 KB slim). Envelope key is
      // `workflows`, not `agents`.
      const res = await workflowsAPI.getDashboard()
      setAgents(res.data.workflows || [])
    } catch {
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // Fetch agents when user authenticates
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const createAgent = async (name, description) => {
    const res = await workflowsAPI.create({ name, description })
    const newAgent = res.data
    setAgents((prev) => [newAgent, ...prev])
    return newAgent
  }

  const updateAgent = async (id, data) => {
    const res = await workflowsAPI.update(id, data)
    const updated = res.data
    setAgents((prev) => prev.map((a) => (a.id === id ? updated : a)))
    return updated
  }

  const removeAgent = async (id) => {
    await workflowsAPI.delete(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <AgentsContext.Provider
      value={{
        agents,
        loading,
        fetchAgents,
        createAgent,
        updateAgent,
        removeAgent,
      }}
    >
      {children}
    </AgentsContext.Provider>
  )
}
