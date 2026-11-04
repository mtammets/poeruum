import { useLayoutEffect, useRef, type RefObject } from 'react'
import { clamp, createFlightMotion, flightHasFallenOut, flightSpeeds, frameFlight, stepFlight, type FlightGeometry } from './screensaverFlight'
import type { HatDelivery } from './hatDelivery'
import { createDepartmentStoreArrival } from './drawStoreArrival'

const flightKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
export type FlightKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
export const isFlightKey = (event: Event): event is KeyboardEvent & { key: FlightKey } => event instanceof KeyboardEvent
  && flightKeys.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey

export default function useScreensaverFlight(root: RefObject<HTMLDialogElement | null>, onFallOut: () => void, journey: RefObject<HatDelivery>) {
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
    const drawArrival = createDepartmentStoreArrival(dialog)
    // Keyboard and each finger own their input separately, so releasing one
    // finger cannot cancel another finger or a held hardware key.
    const inputs = new Map<string, FlightKey>()
    const held = (key: FlightKey) => [...inputs.values()].includes(key)
    const paintControls = () => {
      dialog.querySelectorAll<HTMLButtonElement>('[data-flight-key]').forEach(button => {
        button.dataset.pressed = String(held(button.dataset.flightKey as FlightKey))
      })
    }
    const release = () => { inputs.clear(); paintControls() }
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
      let current: FlightGeometry = { pose: { ...motion.pose }, bounds, position, releaseCount }
      if (journey.current.phase !== 'collecting') {
        current = { ...drawArrival(journey.current, current, viewport, preference.matches), releaseCount }
      }
      geometry.current = current
      // Direct properties keep pose changes from invalidating inherited custom
      // properties throughout the large SVG and forest subtrees.
      bird.style.translate = `${current.position.x.toFixed(3)}px ${current.position.y.toFixed(3)}px`
      bird.style.rotate = `${current.pose.bank.toFixed(3)}deg`
      bird.style.scale = current.pose.scale.toFixed(5)
      const depth = clamp((motion.pose.scale - .48) / 1.07, 0, 1)
      forest.style.translate = preference.matches ? '0px' : `0px ${((.5 - depth) * viewport.height * .018).toFixed(2)}px`
      forest.style.scale = preference.matches ? '1' : (1 + depth * .06).toFixed(4)
      const rate = journey.current.phase === 'collecting' ? motion.speed * (.85 + depth * .3) : Math.max(0, 1 - journey.current.elapsed / 4.8)
      if (Math.abs(rate - forestRate) > .005) {
        tracks.forEach(animation => animation.updatePlaybackRate(rate))
        forestRate = rate
      }
    }
    const exitIfFallen = () => {
      if (journey.current.phase === 'collecting' && !finished && motion.fall > 0 && geometry.current && flightHasFallenOut(geometry.current, viewport.height)) {
        finished = true
        onFallOut()
      }
      return finished
    }
    const tick = (now: number) => {
      if (finished) return
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 30) : 0
      const arriving = journey.current.phase !== 'collecting'
      if (arriving && inputs.size) release()
      if (!preference.matches) {
        const landing = arriving ? clamp((journey.current.elapsed - 4.8) / 1.6, 0, 1) : 0
        const effort = arriving ? .35 * (1 - landing) : !motion.controlled ? .45 : held('ArrowLeft') ? 1 : .08
        wingPower += (effort - wingPower) * (1 - Math.exp(-dt * 4))
        wingPhase += dt * Math.PI * 2 * (.45 + wingPower * .65)
        const stroke = (1 - Math.cos(wingPhase)) / 2 * wingPower
        const returnStroke = (1 - Math.cos(wingPhase - .12)) / 2 * wingPower
        if (farWing) farWing.style.transform = `rotate(${(-stroke * 4 - landing * 12).toFixed(3)}deg) scale(1,${(1 - stroke * .06 - landing * .15).toFixed(4)})`
        if (nearWing) nearWing.style.transform = `rotate(${(returnStroke * 4.5 + landing * 14).toFixed(3)}deg) scale(${(1 - returnStroke * .02 - landing * .08).toFixed(4)},${(1 - returnStroke * .08 - landing * .2).toFixed(4)})`
      }
      if (previous && !arriving) stepFlight(motion, {
        throttle: Number(held('ArrowLeft')),
        depth: preference.matches ? 0 : Number(held('ArrowDown')) - Number(held('ArrowUp')),
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
      release()
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
      // The destination sequence also runs with reduced motion (no orbit or
      // camera zoom), even when the player has never pressed a flight key.
      frame = requestAnimationFrame(tick)
    }
    const press = (key: FlightKey, source: string) => {
      if (journey.current.phase !== 'collecting') return
      const repeat = held(key)
      inputs.set(source, key)
      paintControls()
      // Releasing cargo is independent of flight, including while forward is held.
      if (key === 'ArrowRight') {
        if (!repeat) { releaseCount++; draw() }
        return
      }
      motion.controlled = true
      // Reduced motion retains discrete depth steps. Once the user takes over,
      // only the essential descent/recovery continues between key events.
      if (preference.matches && !repeat) {
        motion.depth = clamp(motion.depth + (key === 'ArrowDown' ? .12 : key === 'ArrowUp' ? -.12 : 0), 0, 1)
        motion.speed = clamp(motion.speed + (key === 'ArrowLeft' ? .25 : 0), flightSpeeds.minimum, flightSpeeds.maximum)
        motion.pose = { x: (flightSpeeds.cruise - motion.speed) * 1.5, y: (motion.depth - .5) * 4, bank: 0, scale: .575 + .45 * motion.depth }
        draw()
        if (!frame) frame = requestAnimationFrame(tick)
      }
    }
    const control = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLButtonElement>('[data-flight-key]') : null
    const keydown = (event: KeyboardEvent) => {
      const button = control(event.target)
      const key = isFlightKey(event) ? event.key as FlightKey
        : button && (event.key === ' ' || event.key === 'Enter') ? button.dataset.flightKey as FlightKey : null
      if (!key) return
      event.preventDefault()
      event.stopImmediatePropagation()
      press(key, `key:${event.code || event.key}`)
    }
    const keyup = (event: KeyboardEvent) => {
      if (!inputs.delete(`key:${event.code || event.key}`)) return
      paintControls()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const pointerdown = (event: PointerEvent) => {
      const button = control(event.target)
      if (!button || event.button !== 0) return
      event.preventDefault()
      button.setPointerCapture(event.pointerId)
      press(button.dataset.flightKey as FlightKey, `pointer:${event.pointerId}`)
    }
    const pointerup = (event: PointerEvent) => {
      inputs.delete(`pointer:${event.pointerId}`)
      paintControls()
    }
    const resize = new ResizeObserver(measure)
    resize.observe(flight)
    window.addEventListener('resize', measure)
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', release)
    dialog.addEventListener('pointerdown', pointerdown)
    dialog.addEventListener('pointerup', pointerup)
    dialog.addEventListener('pointercancel', pointerup)
    dialog.addEventListener('lostpointercapture', pointerup)
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
      dialog.removeEventListener('pointerdown', pointerdown)
      dialog.removeEventListener('pointerup', pointerup)
      dialog.removeEventListener('pointercancel', pointerup)
      dialog.removeEventListener('lostpointercapture', pointerup)
      preference.removeEventListener('change', sync)
    }
  }, [root, onFallOut, journey])
  return geometry
}
