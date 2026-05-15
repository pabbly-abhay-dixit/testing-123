import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'

const Tooltip = ({ children, content, position = 'top', delay = 200, className, isTable = false, maxWidth: maxWidthProp }) => {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: -9999, left: -9999 })
  // Arrow offset (in px) from the tooltip's leading edge — kept in sync
  // with the trigger's center so the arrow always points AT the trigger
  // even when the tooltip itself is shifted away from being centered
  // (because of the viewport-edge clamp).
  const [arrowOffset, setArrowOffset] = useState(null)
  const defaultMaxWidth = maxWidthProp ?? (isTable ? 600 : 260)
  const [maxWidth, setMaxWidth] = useState(defaultMaxWidth)
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const timeoutRef = useRef(null)

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
    // Reset coords so the next show cycle re-runs the measurement
    // pass before the tooltip becomes visible again — prevents the
    // tooltip from briefly appearing at its previous position when
    // re-shown over a different trigger.
    setCoords({ top: -9999, left: -9999 })
    setArrowOffset(null)
  }

  // useLayoutEffect runs synchronously before paint so the tooltip
  // never flashes at the wrong position before the viewport-clamp
  // logic runs.
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return

    const padding = 8
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Cap the tooltip's max-width so a long single line can't make it
    // wider than the viewport itself. With this cap the browser will
    // wrap the text inside the tooltip, and the subsequent
    // getBoundingClientRect() reflects that wrapped width — so the
    // edge-clamp calculation always sees a tooltip that CAN fit.
    // Hard cap chosen smaller than the previous 300 so even on
    // narrower laptop widths the tooltip never wins the right-edge
    // tug-of-war with a far-right trigger (e.g. the Actions column
    // header). Long-form content wraps inside the cap.
    // Caller can override via `maxWidth` prop for rich content
    // (e.g. multi-column tables) that needs more room.
    const hardCap = maxWidthProp ?? (isTable ? 600 : 260)
    const safeCap = Math.min(hardCap, viewportWidth - padding * 2)
    if (safeCap !== maxWidth) {
      setMaxWidth(safeCap)
      // Bail and re-run on next layout pass with the new max-width
      // applied, so tooltipRect reflects the wrapped width — otherwise
      // the clamp below uses the OLD too-wide rect and overshoots.
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    // Use offsetWidth/offsetHeight (layout dimensions) instead of
    // getBoundingClientRect (visual dimensions). The wrapper has the
    // `tooltipPop` CSS animation which transforms `scale(0.92) → 1`
    // over 140ms; if useLayoutEffect samples mid-animation, the rect
    // returns the SCALED-DOWN size, the position math reserves a
    // smaller box, and the tooltip then animates past the right edge
    // we just calculated. offset* is unaffected by transforms.
    const tooltipWidth = tooltipRef.current.offsetWidth
    const tooltipHeight = tooltipRef.current.offsetHeight

    let top = 0
    let left = 0

    switch (position) {
      case 'top':
        top = triggerRect.top - tooltipHeight - 6
        left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2
        break
      case 'bottom':
        top = triggerRect.bottom + 6
        left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2
        break
      case 'left':
        top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2
        left = triggerRect.left - tooltipWidth - 6
        break
      case 'right':
        top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2
        left = triggerRect.right + 6
        break
    }

    // Keep tooltip within viewport — clamp horizontal AND vertical.
    // Order matters: clamp the right-side overflow first, THEN clamp
    // negative left so a too-wide tooltip ends up flush at left:8
    // rather than crashing through the right edge.
    if (left + tooltipWidth > viewportWidth - padding) {
      left = viewportWidth - tooltipWidth - padding
    }
    if (left < padding) left = padding
    if (top + tooltipHeight > viewportHeight - padding) {
      top = viewportHeight - tooltipHeight - padding
    }
    if (top < padding) top = padding

    // Compute where the arrow should sit on the tooltip's leading
    // edge so it points at the trigger's CENTER, not the tooltip's
    // center. After clamping the tooltip's `left` to fit the viewport,
    // the trigger may be far from the tooltip's middle — the arrow
    // needs to slide along the tooltip's edge to track it.
    // Clamped 8px in from each end so the arrow never falls off the
    // tooltip's rounded corners.
    const arrowEdgePadding = 10
    let arrow = null
    if (position === 'top' || position === 'bottom') {
      const triggerCenterX = triggerRect.left + triggerRect.width / 2
      const offsetFromTooltipLeft = triggerCenterX - left
      arrow = Math.max(
        arrowEdgePadding,
        Math.min(tooltipWidth - arrowEdgePadding, offsetFromTooltipLeft),
      )
    } else {
      const triggerCenterY = triggerRect.top + triggerRect.height / 2
      const offsetFromTooltipTop = triggerCenterY - top
      arrow = Math.max(
        arrowEdgePadding,
        Math.min(tooltipHeight - arrowEdgePadding, offsetFromTooltipTop),
      )
    }

    setCoords({ top, left })
    setArrowOffset(arrow)
  }, [visible, position, content, isTable, maxWidth])

  // Hide tooltip immediately when content becomes empty (e.g. sidebar expand)
  useEffect(() => {
    if (!content) { clearTimeout(timeoutRef.current); setVisible(false) }
  }, [content])

  // 2a: On unmount, force-hide before clearing the timeout. setVisible(false)
  // here forces React to commit the portal teardown in the same render cycle
  // as the host, closing the race where the portal can outlive the trigger
  // by a paint frame.
  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current)
      setVisible(false)
    }
  }, [])

  // 2b: Self-heal if the trigger element is detached from the DOM while the
  // tooltip is visible (route change, conditional unmount, modal close).
  // mouseLeave doesn't fire when an element is removed mid-hover, so the
  // tooltip would otherwise be orphaned in the document.body portal until
  // the next user click.
  useEffect(() => {
    if (!visible) return
    let frame
    const check = () => {
      const el = triggerRef.current
      if (!el || !el.isConnected) {
        hide()
        return
      }
      frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame)
  }, [visible])

  // 2c: Belt-and-braces — force-hide on every route change. Redundant with
  // 2b in router-driven unmounts but covers tooltips wrapping
  // layout-persistent elements whose trigger node survives navigation.
  const location = useLocation()
  useEffect(() => { hide() }, [location.pathname])

  if (!content) return children

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onMouseDown={hide}
        onClick={hide}
        data-tooltip-wrapper="true"
        className={`inline-flex ${className || ''}`}
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className={`fixed z-[9999] rounded-lg pointer-events-none animate-tooltip-pop break-words ${
            isTable
              ? 'bg-white dark:bg-[#383838] border border-neutral-200 dark:border-[#484848] p-0 shadow-xl'
              : 'px-2.5 py-1.5 text-[11px] leading-snug font-medium text-white bg-neutral-900 dark:bg-neutral-800 border border-neutral-700 dark:border-neutral-600 shadow-xl whitespace-normal'
          }`}
          style={{
            top: coords.top,
            left: coords.left,
            width: 'max-content',
            maxWidth,
            // Hide via visibility (not display) so the tooltip still
            // takes up layout space and getBoundingClientRect() returns
            // the real measured width on the FIRST useLayoutEffect run.
            // Once coords are computed (anything other than the
            // off-screen sentinel), make it visible.
            visibility: coords.top === -9999 ? 'hidden' : 'visible',
          }}
        >
          {isTable ? (
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {Array.isArray(content) ? content.map((row, idx) => (
                  <tr key={idx} className={`border-b border-neutral-200 dark:border-[#484848] ${idx % 2 === 0 ? 'bg-white dark:bg-[#383838]' : 'bg-neutral-50 dark:bg-[#484848]/30'}`}>
                    <td className="px-3 py-2 font-semibold text-neutral-900 dark:text-neutral-200 whitespace-nowrap">{row.name}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{row.description}</td>
                  </tr>
                )) : content}
              </tbody>
            </table>
          ) : (
            content
          )}
          {/* Arrow tip — a small rotated square placed against the
              tooltip edge so it visually points at the trigger. After
              `rotate-45`, only the two borders facing AWAY from the
              tooltip body should show, otherwise you get a visible
              seam where the arrow's "back" border draws over the
              tooltip body.
              Position is dynamic via inline style — the arrow tracks
              the trigger's center even when the tooltip itself is
              shifted away from being centered (e.g. clamped against
              the viewport's right edge). */}
          <div
            className={`absolute w-2 h-2 rotate-45 ${
              isTable
                ? 'bg-white dark:bg-[#383838]'
                : 'bg-neutral-900 dark:bg-neutral-800'
            } ${
              isTable
                ? 'border-neutral-200 dark:border-[#484848]'
                : 'border-neutral-700 dark:border-neutral-600'
            } ${
              position === 'top'
                ? 'bottom-0 translate-y-1/2 -translate-x-1/2 border-r border-b'
                : position === 'bottom'
                ? 'top-0 -translate-y-1/2 -translate-x-1/2 border-l border-t'
                : position === 'left'
                ? 'right-0 translate-x-1/2 -translate-y-1/2 border-t border-r'
                : 'left-0 -translate-x-1/2 -translate-y-1/2 border-b border-l'
            }`}
            style={
              arrowOffset == null
                ? undefined
                : position === 'top' || position === 'bottom'
                ? { left: arrowOffset }
                : { top: arrowOffset }
            }
          />
        </div>,
        document.body
      )}
    </>
  )
}

export default Tooltip
