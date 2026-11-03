import { useLayoutEffect, useRef, type RefObject } from 'react'
import { clamp, createFlightMotion, flightHasFallenOut, flightSpeeds, frameFlight, stepFlight, type FlightGeometry } from './screensaverFlight'

const flightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
export const isFlightKey = (event: Event): event is KeyboardEvent => event instanceof KeyboardEvent
  && flightKeys.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey

export default function useScreensaverFlight(root: RefObject<HTMLDialogElement | null>, onFallOut: () => void) {
  const geometry = useRef<FlightGeometry | null>(null)
  useLayoutEffect(() => {
    const dialog = root.current
    const bird = dialog?.querySelector<HTMLElement>('.black-friday-screensaver__bird')
    const flight = dialog?.querySelector<HTMLElement>('.black-friday-screensaver__flight')
    const forest = dialog?.querySelector<HTMLElement>('.banner-forest')
    if (!dialog || !bird || !flight || !forest) return
    const farWing = bird.querySelector<SVGSVGElement>('.woodpecker-wing--far')
    const nearWing = bird.querySelector<SVGSVGElement>('.woodpecker-wing--near')
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const keys = new Set<string>()
    let motion = createFlightMotion()
    let frame = 0
    let previous = 0
    let finished = false
    let forestRate = 1
    let wingPhase = 0, wingPower = .45
    let releaseCount = 0
    let tracks: Animation[] = []
    let viewport = { width: window.innerWidth, height: window.innerHeight }
    let bounds = flight.getBoundingClientRect()

    const draw = () => {
      const position = frameFlight(motion.pose, bounds, viewport, motion.fall)
      geometry.current = { pose: { ...motion.pose }, bounds, position, releaseCount }
      // Direct properties keep pose changes from invalidating inherited custom
      // properties throughout the large SVG and forest subtrees.
      bird.style.translate = `${position.x.toFixed(3)}px ${position.y.toFixed(3)}px`
      bird.style.rotate = `${motion.pose.bank.toFixed(3)}deg`
      bird.style.scale = motion.pose.scale.toFixed(5)
      const depth = clamp((motion.pose.scale - .48) / 1.07, 0, 1)
      forest.style.translate = preference.matches ? '0px' : `0px ${((.5 - depth) * viewport.height * .018).toFixed(2)}px`
      forest.style.scale = preference.matches ? '1' : (1 + depth * .06).toFixed(4)
      const rate = motion.speed * (.85 + depth * .3)
      if (Math.abs(rate - forestRate) > .005) {
        tracks.forEach(animation => animation.updatePlaybackRate(rate))
        forestRate = rate
      }
    }
    const exitIfFallen = () => {
      if (!finished && motion.fall > 0 && geometry.current && flightHasFallenOut(geometry.current, viewport.height)) {
        finished = true
        onFallOut()
      }
      return finished
    }
    const tick = (now: number) => {
      if (finished) return
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 30) : 0
      if (!preference.matches) {
        const effort = !motion.controlled ? .45 : keys.has('ArrowLeft') ? 1 : .08
        wingPower += (effort - wingPower) * (1 - Math.exp(-dt * 4))
        wingPhase += dt * Math.PI * 2 * (.45 + wingPower * .65)
        const stroke = (1 - Math.cos(wingPhase)) / 2 * wingPower
        const returnStroke = (1 - Math.cos(wingPhase - .12)) / 2 * wingPower
        if (farWing) farWing.style.transform = `rotate(${(-stroke * 4).toFixed(3)}deg) scale(1,${(1 - stroke * .06).toFixed(4)})`
        if (nearWing) nearWing.style.transform = `rotate(${(returnStroke * 4.5).toFixed(3)}deg) scale(${(1 - returnStroke * .02).toFixed(4)},${(1 - returnStroke * .08).toFixed(4)})`
      }
      if (previous) stepFlight(motion, {
        throttle: Number(keys.has('ArrowLeft')),
        depth: preference.matches ? 0 : Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')),
      }, (now - previous) / 1000, preference.matches)
      previous = now
      draw()
      if (exitIfFallen()) return
      frame = requestAnimationFrame(tick)
    }
    const measure = () => {
      viewport = { width: window.innerWidth, height: window.innerHeight }
      bounds = flight.getBoundingClientRect()
      draw()
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = 0
      keys.clear()
      previous = 0
      finished = false
      motion = createFlightMotion()
      wingPhase = 0; wingPower = .45
      if (farWing) farWing.style.transform = 'none'
      if (nearWing) nearWing.style.transform = 'none'
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
      // Releasing cargo is independent of flight, including while forward is held.
      if (event.key === 'ArrowRight') {
        if (!event.repeat) { releaseCount++; draw() }
        return
      }
      keys.add(event.key)
      motion.controlled = true
      // Reduced motion retains discrete depth steps. Once the user takes over,
      // only the essential descent/recovery continues between key events.
      if (preference.matches && !event.repeat) {
        motion.depth = clamp(motion.depth + (event.key === 'ArrowDown' ? .12 : event.key === 'ArrowUp' ? -.12 : 0), 0, 1)
        motion.speed = clamp(motion.speed + (event.key === 'ArrowLeft' ? .25 : 0), flightSpeeds.minimum, flightSpeeds.maximum)
        motion.pose = { x: (flightSpeeds.cruise - motion.speed) * 1.5, y: (motion.depth - .5) * 4, bank: 0, scale: .575 + .45 * motion.depth }
        draw()
        if (!frame) frame = requestAnimationFrame(tick)
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
      geometry.current = null
      resize.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', release)
      preference.removeEventListener('change', sync)
    }
  }, [root, onFallOut])
  return geometry
}
