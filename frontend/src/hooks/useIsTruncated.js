import { useState, useEffect } from 'react'

export function useIsTruncated(ref) {
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return truncated
}
