import { useEffect, useRef, useState } from 'react'
import api from '../services/api'

// Smart event-driven status polling — NO continuous 24/7 polling.
//
// Triggers (single fetch each):
//   1. Component mount                       — catches deploy in progress on cold load
//   2. Tab visibility → visible              — catches deploy that started while tab was bg
//   3. Browser `online` event                — catches state across network reconnects
//   4. `check-system-status` custom event    — fired by api.js on 5xx responses
//
// When active === true is detected: start 10s polling until active flips to
// false (then stop). Hard cap 5 min so a stuck flag never burns CPU forever.
//
// Net effect: zero idle polling. Brief polling burst only during the actual
// deploy window. DevTools stays clean unless something is happening.

const ACTIVE_POLL_MS = 10000             // 10s while downtime active
const MAX_ACTIVE_POLL_MS = 5 * 60 * 1000 // 5 min hard cap (defensive)

export default function useSystemStatus() {
  const [downtime, setDowntime] = useState({ active: false, message: null, startedAt: 0 })
  const intervalRef = useRef(null)
  const pollStartedAtRef = useRef(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    const fetchOnce = async () => {
      try {
        const { data } = await api.get('/api/system/status')
        if (cancelledRef.current) return
        const d = data?.deploy_downtime || {}
        const next = {
          active: !!d.active,
          message: d.message || null,
          startedAt: d.started_at || 0,
        }
        setDowntime(next)

        if (next.active) {
          // Active detected — start 10s polling if not already running.
          if (!intervalRef.current) {
            pollStartedAtRef.current = Date.now()
            intervalRef.current = setInterval(() => {
              if (Date.now() - pollStartedAtRef.current > MAX_ACTIVE_POLL_MS) {
                stopPolling()
                return
              }
              fetchOnce()
            }, ACTIVE_POLL_MS)
          }
        } else {
          // Cleared — stop polling immediately so DevTools goes silent.
          stopPolling()
        }
      } catch {
        // Network blip — keep last known state. Next trigger will reconcile.
      }
    }

    fetchOnce() // 1. mount

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOnce()
    }
    const onOnline = () => fetchOnce()
    const onCheck = () => fetchOnce()

    document.addEventListener('visibilitychange', onVisible)         // 2.
    window.addEventListener('online', onOnline)                      // 3.
    window.addEventListener('check-system-status', onCheck)          // 4.

    return () => {
      cancelledRef.current = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('check-system-status', onCheck)
    }
  }, [])

  return downtime
}
