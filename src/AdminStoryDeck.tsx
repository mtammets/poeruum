import { useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import './adminStoryDeck.css'

export type AdminStoryView = 'analytics' | 'users'
export type AdminStoryDeckHandle = { navigate: (view: AdminStoryView) => void }
const order: AdminStoryView[] = ['analytics', 'users']
const labels = { analytics: 'Külastatavus', users: 'Kasutajad' }
const protectedTarget = 'a, button, input, select, textarea, summary, [contenteditable="true"], [role="slider"], [role="dialog"], [data-swipe-ignore]'

export default function AdminStoryDeck({ view, analytics, users, onNavigate, ref }: {
  view: AdminStoryView; analytics: ReactNode; users: ReactNode; onNavigate: (view: AdminStoryView) => void; ref?: Ref<AdminStoryDeckHandle>
}) {
  const scene = useRef<HTMLDivElement>(null)
  const turn = useRef<HTMLDivElement>(null)
  const navigate = useRef<(next: AdminStoryView) => void>(() => {})
  const onNavigateRef = useRef(onNavigate)
  useLayoutEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useImperativeHandle(ref, () => ({ navigate: (next) => navigate.current(next) }), [])

  useLayoutEffect(() => {
    const element = scene.current!, rotor = turn.current!
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const index = order.indexOf(view)
    let gesture: { x: number; y: number; time: number; lastX: number; locked: boolean } | null = null
    let progress = 0, settling = false, width = 1, suppressClickUntil = 0, wheelIdleAt = -Infinity
    let settleTimer: number | undefined, wheelTimer: number | undefined
    let complete: (() => void) | null = null
    const setProgress = (value: number) => {
      progress = value
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
    }
    const eligible = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest(protectedTarget) || document.querySelector('dialog[open], [aria-modal="true"]')) return false
      if (element.querySelector('.is-current .admin-users__filter-menu[open]')) return false
      if (window.getSelection()?.toString()) return false
      // Native horizontal lists/tables own their gesture, even at their edge.
      for (let node = target; node !== element && node instanceof HTMLElement; node = node.parentElement!) {
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
    const settle = (target: number, next?: AdminStoryView) => {
      if (settling) return
      settling = true
      gesture = null
      window.clearTimeout(wheelTimer)
      wheelTimer = undefined
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
      setProgress(canMove(fraction) ? Math.max(-1, Math.min(1, fraction)) : Math.max(-.035, Math.min(.035, fraction * .15)))
    }
    const finish = (distance: number, velocity: number) => {
      const target = order[index + Math.sign(distance)]
      const passes = Math.abs(distance) >= Math.min(120, Math.max(64, width * .22)) || (Math.abs(distance) >= 40 && velocity > .5)
      if (target && passes) settle(Math.sign(distance), target)
      else settle(0)
    }
    const startTouch = (event: TouchEvent) => {
      if (settling || event.touches.length !== 1 || !eligible(event.target)) { gesture = null; return }
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
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) < 2 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.5 || !eligible(event.target)) return
      if (event.cancelable) event.preventDefault()
      const now = performance.now()
      if (settling || (now - wheelIdleAt < 220 && !wheelTimer)) { wheelIdleAt = now; return }
      wheelIdleAt = now
      if (!wheelTimer) prepare()
      const delta = event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1)
      move(progress * width + delta)
      window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        wheelTimer = undefined
        finish(progress * width, 0)
      }, 110)
      if (Math.abs(progress) > .35) settle(Math.sign(progress), order[index + Math.sign(progress)])
    }
    const suppressClick = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation() }
    }
    const transitionEnd = (event: TransitionEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('.admin-story-panel.is-current') && event.propertyName === 'transform') complete?.()
    }
    const cancel = () => { window.clearTimeout(wheelTimer); wheelTimer = undefined; reset() }
    const onVisibility = () => { if (document.hidden) cancel() }
    navigate.current = (next) => {
      if (settling || next === view) return
      prepare()
      settle(order.indexOf(next) - index, next)
    }
    reset()
    element.addEventListener('touchstart', startTouch, { passive: true })
    element.addEventListener('touchmove', moveTouch, { passive: false })
    element.addEventListener('touchend', endTouch, { passive: false })
    element.addEventListener('touchcancel', cancelTouch)
    element.addEventListener('wheel', wheel, { passive: false })
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
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('click', suppressClick, true)
      rotor.removeEventListener('transitionend', transitionEnd)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [view])

  return <div className="admin-story-deck" ref={scene} data-view={view}>
    <div className="admin-story-position" aria-hidden="true">{order.map((item) => <i key={item} className={item === view ? 'is-current' : undefined} />)}</div>
    <div className="admin-story-turn" ref={turn}>{order.map((item) => <div key={item} className={`admin-story-panel admin-story-panel--${item}${item === view ? ' is-current' : ''}`} data-story-view={item} aria-hidden={item !== view} inert={item !== view} style={{ '--story-angle': `${(order.indexOf(item) - order.indexOf(view)) * 90}deg` } as CSSProperties}>
      {item === 'analytics' ? analytics : users}
    </div>)}</div>
    <span className="users-sr-only" role="status" aria-live="polite">{labels[view]}</span>
  </div>
}
