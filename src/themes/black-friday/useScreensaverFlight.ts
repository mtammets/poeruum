import { useLayoutEffect, type RefObject } from 'react'
import { clamp, createFlightMotion, frameFlight, stepFlight } from './screensaverFlight'

const flightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
export const isFlightKey = (event: Event): event is KeyboardEvent => event instanceof KeyboardEvent
  && flightKeys.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey

export default function useScreensaverFlight(root: RefObject<HTMLDialogElement | null>) {
  useLayoutEffect(() => {
    const dialog = root.current
    const bird = dialog?.querySelector<HTMLElement>('.black-friday-screensaver__bird')
    const flight = dialog?.querySelector<HTMLElement>('.black-friday-screensaver__flight')
    if (!dialog || !bird || !flight) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const keys = new Set<string>()
    let motion = createFlightMotion()
    let frame = 0
    let previous = 0
    let forestRate = 1
    let tracks: Animation[] = []
    let viewport = { width: window.innerWidth, height: window.innerHeight }
    let bounds = flight.getBoundingClientRect()

    const draw = () => {
      const position = frameFlight(motion.pose, bounds, viewport)
      bird.style.setProperty('--flight-x', `${position.x.toFixed(3)}px`)
      bird.style.setProperty('--flight-y', `${position.y.toFixed(3)}px`)
      bird.style.setProperty('--flight-bank', `${motion.pose.bank.toFixed(3)}deg`)
      bird.style.setProperty('--flight-scale', motion.pose.scale.toFixed(5))
      const depth = clamp((motion.pose.scale - .48) / 1.07, 0, 1)
      dialog.style.setProperty('--flight-landscape-y', preference.matches ? '0px' : `${((.5 - depth) * viewport.height * .018).toFixed(2)}px`)
      dialog.style.setProperty('--flight-landscape-scale', preference.matches ? '1' : (1 + depth * .06).toFixed(4))
      const rate = motion.speed * (.85 + depth * .3)
      if (Math.abs(rate - forestRate) > .005) {
        tracks.forEach(animation => animation.updatePlaybackRate(rate))
        forestRate = rate
      }
    }
    const tick = (now: number) => {
      if (previous) stepFlight(motion, {
        throttle: Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight')),
        depth: Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')),
      }, (now - previous) / 1000)
      previous = now
      draw()
      frame = requestAnimationFrame(tick)
    }
    const measure = () => {
      viewport = { width: window.innerWidth, height: window.innerHeight }
      bounds = flight.getBoundingClientRect()
      draw()
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      keys.clear()
      previous = 0
      motion = createFlightMotion()
      if (preference.matches) {
        motion.depth = .5
        motion.pose = { x: 0, y: 0, bank: 0, scale: .8 }
      }
      tracks = [...dialog.querySelectorAll('.banner-forest__track')].flatMap(track => track.getAnimations())
      forestRate = 1
      measure()
      if (!preference.matches) frame = requestAnimationFrame(tick)
    }
    const keydown = (event: KeyboardEvent) => {
      if (!isFlightKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      keys.add(event.key)
      motion.controlled = true
      // Reduced motion uses deliberate steps, without an automatic orbit,
      // continuous zoom, banking or inertia after releasing a key.
      if (preference.matches && !event.repeat) {
        motion.depth = clamp(motion.depth + (event.key === 'ArrowDown' ? .12 : event.key === 'ArrowUp' ? -.12 : 0), 0, 1)
        motion.speed = clamp(motion.speed + (event.key === 'ArrowLeft' ? .25 : event.key === 'ArrowRight' ? -.25 : 0), .35, 3.4)
        motion.pose = { x: (1 - motion.speed) * 1.5, y: (motion.depth - .5) * 4, bank: 0, scale: .575 + .45 * motion.depth }
        draw()
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (!flightKeys.has(event.key)) return
      keys.delete(event.key)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const release = () => keys.clear()
    const resize = new ResizeObserver(measure)
    resize.observe(flight)
    window.addEventListener('resize', measure)
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', release)
    preference.addEventListener('change', sync)
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', release)
      preference.removeEventListener('change', sync)
    }
  }, [root])
}
