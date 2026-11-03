import { useLayoutEffect, useState, type RefObject } from 'react'
import { capWidthInBirdImage, claw, clawOpening, createHatFlight, gameCapImage, releaseCarriedHats, resizeHatFlight, stepHatFlight } from './hatFlightPhysics'
import { beakOpening } from './useWoodpeckerCall'
import recordings from './woodpeckerCalls.json'
import { projectFlightPoint, type FlightGeometry } from './screensaverFlight'
import type ForestFlightAudio from './forestFlightAudio'

// The existing flight controller alone moves the bird. This layer observes its
// real, transformed claws and adds hats; it does not handle any user input.
export default function useHatFlightGame(root: RefObject<HTMLDialogElement | null>, audio: ForestFlightAudio, flight: RefObject<FlightGeometry | null>) {
  const [caught, setCaught] = useState(0)
  useLayoutEffect(() => {
    const stage = root.current
    if (!stage) return
    const bird = stage.querySelector<HTMLElement>('.black-friday-screensaver__bird')!
    const hats = stage.querySelector<HTMLElement>('.hat-flight__hats')!
    const cargo = bird.querySelector<SVGGElement>('.hat-flight__cargo')!
    const beak = bird.querySelector('.woodpecker-beak')!
    const mouth = bird.querySelector('.woodpecker-mouth')!
    const foot = bird.querySelector('.woodpecker-claws')!
    const rearToes = bird.querySelector('.woodpecker-claws__rear')!
    const frontToes = bird.querySelector('.woodpecker-claws__front')!
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const game = createHatFlight(stage.clientWidth || innerWidth, stage.clientHeight || innerHeight)
    const elements = new Map<number, HTMLDivElement>()
    const drops = new Map<number, HTMLDivElement>()
    const attributes = new WeakMap<Element, Map<string, string>>()
    const setAttribute = (element: Element, name: string, value: string) => {
      let current = attributes.get(element)
      if (!current) { current = new Map(); attributes.set(element, current) }
      if (current.get(name) !== value) { element.setAttribute(name, value); current.set(name, value) }
    }
    let frame = 0, previous = 0, catchTime = -10, catchRecording = 0
    let reduced = preference.matches
    let grip = 0
    let lastRelease = 0, releaseAt = -Infinity, released = true
    const createCap = (className: string) => {
      const element = document.createElement('div'); element.className = className
      element.style.width = `${capWidthInBirdImage}px`
      const image = new Image(); image.src = gameCapImage; image.alt = ''; image.draggable = false
      element.appendChild(image); hats.appendChild(element)
      return element
    }
    const resize = () => {
      if (stage.clientWidth && stage.clientHeight) resizeHatFlight(game, stage.clientWidth, stage.clientHeight)
    }
    const motionChange = () => { reduced = preference.matches }
    const tick = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, .05) : 0
      const geometry = flight.current
      if (geometry) {
        game.bird = projectFlightPoint(geometry, claw)
        game.birdBaseWidth = geometry.bounds.width
        game.birdWidth = geometry.bounds.width * geometry.pose.scale
        if (!previous) game.previousBird = { ...game.bird }
        if ((geometry.releaseCount ?? 0) !== lastRelease) {
          lastRelease = geometry.releaseCount ?? 0
          if (game.carried && released) {
            releaseAt = game.time; released = false
            game.releaseUntil = game.time + .6
          }
        }
      }
      previous = now
      const catches = stepHatFlight(game, dt, reduced)
      if (catches.length) {
        catchTime = game.time; catchRecording = (game.score - 1) % recordings.length
        audio.catchHat(catchRecording)
        cargo.style.visibility = ''
        setCaught(game.carried)
        stage.dataset.caught = String(game.score)
      }
      const releasing = game.time - releaseAt < .6
      const wantedGrip = releasing ? 1 : reduced ? 0 : clawOpening(game, catchTime)
      grip = reduced ? wantedGrip : grip + (wantedGrip - grip) * (1 - Math.exp(-dt * 22))
      const held = game.carried > 0 ? 1 - grip : 0
      setAttribute(rearToes, 'transform', `rotate(${(-grip * 22 + held * 5).toFixed(3)} 818 886)`)
      setAttribute(frontToes, 'transform', `rotate(${(grip * 42 + held * 14).toFixed(3)} 818 890)`)
      setAttribute(foot, 'data-grip', releasing ? 'releasing' : grip > .1 ? (game.time - catchTime < .5 ? 'grasping' : 'reaching') : game.carried ? 'holding' : 'resting')
      if (game.carried && !reduced) cargo.style.transform = `rotate(${(Math.sin(game.time * 3) * 4).toFixed(2)}deg)`
      if (!released && game.time - releaseAt >= .12) {
        // Read the photographed caps' exact on-screen transforms once per release,
        // including banking and cargo sway, after the toes have opened.
        const poses = [...cargo.querySelectorAll<SVGImageElement>('image')].flatMap(image => {
          const matrix = image.getScreenCTM()
          if (!matrix) return []
          const point = new DOMPoint(image.x.baseVal.value + image.width.baseVal.value / 2,
            image.y.baseVal.value + image.height.baseVal.value / 2).matrixTransform(matrix)
          return [{ x: point.x, y: point.y, size: image.width.baseVal.value * Math.hypot(matrix.a, matrix.b),
            rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI }]
        })
        if (poses.length === game.carried) {
          releaseCarriedHats(game, poses)
          cargo.style.visibility = 'hidden'; setCaught(0); released = true
        }
      }
      for (const hat of game.hats) {
        let element = elements.get(hat.id)
        if (!element) {
          element = createCap('hat-flight__hat')
          element.dataset.hat = String(hat.id)
          element.dataset.depth = hat.depth.toFixed(3)
          // Keep layout fixed; perspective is a cheap compositor transform.
          elements.set(hat.id, element)
        }
        const progress = hat.caught === null ? 0 : Math.min(1, (game.time - hat.caught) / .48)
        const ease = 1 - (1 - progress) ** 3
        const x = progress ? hat.from.x + (game.bird.x - hat.from.x) * ease : hat.x
        const y = progress ? hat.from.y + (game.bird.y + 22 - hat.from.y) * ease - Math.sin(progress * Math.PI) * 30 : hat.y
        const heldSize = game.birdWidth * capWidthInBirdImage / 1448
        const size = hat.size + (heldSize - hat.size) * ease
        element.style.opacity = (1 - progress ** 2).toFixed(3)
        element.style.transform = `translate3d(${x - capWidthInBirdImage / 2}px,${y - capWidthInBirdImage * .375}px,0) rotate(${reduced ? 0 : Math.sin(hat.age * 2 + hat.id) * 18 + progress * 40}deg) scale(${size / capWidthInBirdImage})`
        setAttribute(element, 'data-caught', String(hat.caught !== null))
      }
      for (const [id, element] of elements) if (!game.hats.some(hat => hat.id === id)) { element.remove(); elements.delete(id) }
      for (const hat of game.dropped) {
        let element = drops.get(hat.id)
        if (!element) { element = createCap('hat-flight__drop'); drops.set(hat.id, element) }
        element.style.transform = `translate3d(${hat.x - capWidthInBirdImage / 2}px,${hat.y - capWidthInBirdImage * .375}px,0) rotate(${hat.rotation.toFixed(3)}deg) scale(${hat.size / capWidthInBirdImage})`
      }
      for (const [id, element] of drops) if (!game.dropped.some(hat => hat.id === id)) { element.remove(); drops.delete(id) }
      if (game.score) {
        const open = reduced ? 0 : beakOpening(recordings[catchRecording], game.time - catchTime), angle = -16 * open
        setAttribute(beak, 'transform', `rotate(${angle.toFixed(3)} 265 490)`)
        const radians = angle * Math.PI / 180
        setAttribute(mouth, 'd', open > .001 ? `M208 484 L265 490 L${265 - 57 * Math.cos(radians) + 6 * Math.sin(radians)} ${490 - 57 * Math.sin(radians) - 6 * Math.cos(radians)} Z` : '')
      }
      frame = requestAnimationFrame(tick)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    preference.addEventListener('change', motionChange)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); elements.forEach(element => element.remove())
      drops.forEach(element => element.remove())
      preference.removeEventListener('change', motionChange)
    }
  }, [root, audio, flight])
  return caught
}
