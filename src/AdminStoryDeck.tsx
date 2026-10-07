import { useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { adminViewConfig, adminViewOrder as order, type AdminView } from './lib/adminNavigation'
import './adminStoryDeck.css'

export type AdminStoryDeckHandle = { navigate: (view: AdminView) => void }
const protectedTarget = 'a, button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="dialog"], [draggable="true"], [data-swipe-ignore]'

export default function AdminStoryDeck({ view, renderView, onNavigate, ref }: {
  view: AdminView; renderView: (view: AdminView) => ReactNode; onNavigate: (view: AdminView) => void; ref?: Ref<AdminStoryDeckHandle>
}) {
  const scene = useRef<HTMLDivElement>(null)
  const turn = useRef<HTMLDivElement>(null)
  const navigate = useRef<(next: AdminView) => void>(() => {})
  const [preview, setPreview] = useState<AdminView | null>(null)
  const onNavigateRef = useRef(onNavigate)
  useLayoutEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useImperativeHandle(ref, () => ({ navigate: (next) => navigate.current(next) }), [])

  useLayoutEffect(() => {
    const element = scene.current!, rotor = turn.current!
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mobileLayout = window.matchMedia('(max-width: 680px)')
    const index = order.indexOf(view)
    let gesture: { x: number; y: number; time: number; lastX: number; locked: boolean } | null = null
    let settling = false, width = 1, suppressClickUntil = 0
    let settleTimer: number | undefined
    let complete: (() => void) | null = null
    const setProgress = (value: number) => {
      element.style.setProperty('--story-progress', String(value))
      element.style.setProperty('--story-shade', String(Math.min(.25, Math.abs(value) * .25)))
    }
    const reset = () => {
      delete element.dataset.motion
      element.style.removeProperty('--story-offset')
      setProgress(0)
      settling = false
      gesture = null
      complete = null
      window.clearTimeout(settleTimer)
      setPreview(null)
    }
    const eligible = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest(protectedTarget) || document.querySelector('dialog[open], [aria-modal="true"]')) return false
      if (element.querySelector('.is-current .admin-users__filter-menu[open]')) return false
      if (window.getSelection()?.toString()) return false
      // Native horizontal lists/tables own their gesture, even at their edge.
      for (let node: Element | null = target; node && node !== element; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return false
      }
      return true
    }
    const prepare = () => {
      width = Math.max(1, element.clientWidth)
      element.style.setProperty('--story-depth', `${width / 2}px`)
      element.style.setProperty('--story-origin-y', `${window.innerHeight / 2 - element.getBoundingClientRect().top}px`)
      // Align the incoming header with where it will land after scroll-to-top.
      element.style.setProperty('--story-offset', `${window.scrollY}px`)
      if (!reducedMotion.matches) element.dataset.motion = 'dragging'
    }
    const settle = (target: number, next?: AdminView) => {
      if (settling) return
      settling = true
      gesture = null
      complete = () => {
        const callback = complete
        complete = null
        if (!callback) return
        if (next) {
          // State updates replace the cube's front face in the same layout pass.
          onNavigateRef.current(next)
        } else reset()
      }
      if (reducedMotion.matches) { complete(); return }
      rotor.getBoundingClientRect()
      element.dataset.motion = 'settling'
      setProgress(target)
      settleTimer = window.setTimeout(() => complete?.(), 340)
    }
    const canMove = (value: number) => index + Math.sign(value) >= 0 && index + Math.sign(value) < order.length
    const move = (delta: number) => {
      const fraction = delta / width
      setPreview(order[index + Math.sign(fraction)] ?? null)
      setProgress(canMove(fraction) ? Math.max(-1, Math.min(1, fraction)) : Math.max(-.035, Math.min(.035, fraction * .15)))
    }
    const finish = (distance: number, velocity: number) => {
      const target = order[index + Math.sign(distance)]
      const passes = Math.abs(distance) >= Math.min(120, Math.max(64, width * .22)) || (Math.abs(distance) >= 40 && velocity > .5)
      if (target && passes) settle(Math.sign(distance), target)
      else settle(0)
    }
    const startTouch = (event: TouchEvent) => {
      if (!mobileLayout.matches || settling) return
      if (event.touches.length !== 1 || !eligible(event.target)) { cancelTouch(); return }
      const touch = event.touches[0]
      // Leave the browser's back/forward edge gestures available.
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return
      gesture = { x: touch.clientX, y: touch.clientY, lastX: touch.clientX, time: performance.now(), locked: false }
    }
    const moveTouch = (event: TouchEvent) => {
      if (!gesture) return
      if (event.touches.length !== 1) { if (gesture.locked) settle(0); else gesture = null; return }
      const touch = event.touches[0]
      const dx = gesture.x - touch.clientX, dy = gesture.y - touch.clientY
      if (!gesture.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return
        if (Math.abs(dy) >= Math.abs(dx)) { gesture = null; return }
        if (Math.abs(dx) < Math.abs(dy) * 1.35) return
        gesture.locked = true
        prepare()
      }
      if (!event.cancelable) { settle(0); return }
      event.preventDefault()
      gesture.lastX = touch.clientX
      suppressClickUntil = performance.now() + 700
      move(dx)
    }
    const endTouch = (event: TouchEvent) => {
      if (!gesture) return
      const last = gesture
      gesture = null
      if (!last.locked) return
      if (event.cancelable) event.preventDefault()
      const distance = last.x - (event.changedTouches[0]?.clientX ?? last.lastX)
      finish(distance, Math.abs(distance) / Math.max(1, performance.now() - last.time))
    }
    const cancelTouch = () => { if (gesture?.locked) settle(0); else gesture = null }
    const suppressClick = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation() }
    }
    const transitionEnd = (event: TransitionEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('.admin-story-panel.is-current') && event.propertyName === 'transform') complete?.()
    }
    const cancel = () => reset()
    const onVisibility = () => { if (document.hidden) cancel() }
    navigate.current = (next) => {
      if (next === view) return
      // Menu links navigate immediately on every screen size.
      cancel()
      onNavigateRef.current(next)
    }
    reset()
    element.addEventListener('touchstart', startTouch, { passive: true })
    element.addEventListener('touchmove', moveTouch, { passive: false })
    element.addEventListener('touchend', endTouch, { passive: false })
    element.addEventListener('touchcancel', cancelTouch)
    element.addEventListener('click', suppressClick, true)
    rotor.addEventListener('transitionend', transitionEnd)
    window.addEventListener('resize', cancel)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancel()
      element.removeEventListener('touchstart', startTouch)
      element.removeEventListener('touchmove', moveTouch)
      element.removeEventListener('touchend', endTouch)
      element.removeEventListener('touchcancel', cancelTouch)
      element.removeEventListener('click', suppressClick, true)
      rotor.removeEventListener('transitionend', transitionEnd)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [view])

  // Preserve the existing analytics/users state while moving between those views.
  // Other screens mount only when active or being revealed by a touch gesture.
  const panels = order.filter((item) => item === view || item === preview
    || ((view === 'analytics' || view === 'users') && (item === 'analytics' || item === 'users')))

  return <div className="admin-story-deck" ref={scene} data-view={view}>
    <div className="admin-story-position" aria-hidden="true">{order.map((item) => <i key={item} className={item === view ? 'is-current' : undefined} />)}</div>
    <div className="admin-story-turn" ref={turn}>{panels.map((item) => <div key={item} className={`admin-story-panel admin-story-panel--${item}${item === view ? ' is-current' : ''}${item === preview && item !== view ? ' is-incoming' : ''}`} data-story-view={item} aria-hidden={item !== view} inert={item !== view} style={{ '--story-angle': `${Math.sign(order.indexOf(item) - order.indexOf(view)) * 90}deg` } as CSSProperties}>
      {renderView(item)}
    </div>)}</div>
    <span className="users-sr-only" role="status" aria-live="polite">{adminViewConfig[view].title}</span>
  </div>
}
