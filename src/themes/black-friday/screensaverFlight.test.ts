import { describe, expect, it } from 'vitest'
import { createFlightMotion, flightHasFallenOut, flightSpeeds, frameFlight, stepFlight, type FlightInput, type FlightMotion } from './screensaverFlight'

function fly(motion: FlightMotion, input: FlightInput, seconds: number, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame++) stepFlight(motion, input, 1 / fps)
}

describe('screensaver flight', () => {
  it('keeps acceleration consistent at different frame rates and loses speed after release', () => {
    const slow = createFlightMotion()
    const fast = createFlightMotion()
    fly(slow, { throttle: 1, depth: 1 }, 2, 30)
    fly(fast, { throttle: 1, depth: 1 }, 2, 120)
    expect(slow.speed).toBeCloseTo(fast.speed, 4)
    expect(slow.pose.scale).toBeCloseTo(fast.pose.scale, 1)
    expect(slow.pose.x).toBeCloseTo(fast.pose.x, 0)
    const boosted = fast.speed
    fly(fast, { throttle: 0, depth: 0 }, .5, 120)
    expect(fast.speed).toBeLessThan(boosted)
    expect(fast.speed).toBeGreaterThan(2)
    fly(fast, { throttle: 0, depth: 0 }, 15)
    expect(fast.speed).toBeCloseTo(flightSpeeds.minimum, 2)
    expect(fast.fall).toBeGreaterThan(100)
  })

  it('cruises faster and descends gradually after taking over without thrust', () => {
    const motion = createFlightMotion()
    expect(motion.speed).toBeGreaterThan(1.5)
    fly(motion, { throttle: 0, depth: 0 }, 30)
    expect(motion.fall).toBe(0)
    motion.controlled = true
    stepFlight(motion, { throttle: 0, depth: 0 }, 1 / 60)
    expect(motion.speed).toBeGreaterThan(1.5)
    expect(motion.fall).toBeGreaterThan(0)
    expect(motion.fallVelocity).toBeLessThan(.5)
    fly(motion, { throttle: 0, depth: 0 }, 10)
    expect(motion.fall).toBeGreaterThan(100)
  })

  it('needs forward held after any steering input, including a depth-only input', () => {
    const motion = createFlightMotion()
    fly(motion, { throttle: 1, depth: 0 }, 20)
    expect(motion.fall).toBe(0)
    expect(motion.speed).toBeCloseTo(flightSpeeds.maximum)
    stepFlight(motion, { throttle: 0, depth: 0 }, 1 / 60)
    expect(motion.fall).toBeGreaterThan(0)
    expect(motion.fallVelocity).toBeLessThan(.5)
    expect(motion.speed).toBeGreaterThan(3)
    fly(motion, { throttle: 0, depth: 0 }, .2)
    expect(motion.fall).toBeLessThan(1)
    fly(motion, { throttle: 0, depth: 0 }, 2)
    expect(motion.fall).toBeGreaterThan(20)
    const depthOnly = createFlightMotion()
    stepFlight(depthOnly, { throttle: 0, depth: 1 }, 1 / 60)
    expect(depthOnly.controlled).toBe(true)
    expect(depthOnly.fall).toBeGreaterThan(0)
    const untouched = createFlightMotion()
    fly(untouched, { throttle: 0, depth: 0 }, 90)
    expect(untouched.controlled).toBe(false)
    expect(untouched.fall).toBe(0)
  })

  it('pitches down without thrust and can recover before leaving the screen', () => {
    const motion = createFlightMotion()
    const initialDepth = motion.depth
    motion.controlled = true
    fly(motion, { throttle: 0, depth: 0 }, 2)
    expect(motion.speed).toBeLessThan(flightSpeeds.cruise)
    expect(motion.fall).toBeGreaterThan(8)
    expect(motion.fallVelocity).toBeGreaterThan(10)
    expect(motion.pose.bank).toBeLessThan(-10)
    expect(motion.depth).toBe(initialDepth)
    const before = { ...motion }
    stepFlight(motion, { throttle: 1, depth: 0 }, 1 / 60)
    expect(Math.abs(motion.fall - before.fall)).toBeLessThan(.5)
    fly(motion, { throttle: 1, depth: 0 }, 5)
    expect(motion.fall).toBeLessThan(.1)
    expect(motion.pose.bank).toBeGreaterThan(-8)
  })

  it('continues falling beyond the former limit at consistent frame rates', () => {
    const slow = createFlightMotion(), fast = createFlightMotion()
    slow.controlled = fast.controlled = true
    fly(slow, { throttle: 0, depth: 0 }, 3, 30)
    fly(fast, { throttle: 0, depth: 0 }, 3, 120)
    expect(slow.fall).toBeCloseTo(fast.fall, 0)
    for (const motion of [slow, fast]) {
      fly(motion, { throttle: 0, depth: 0 }, 5)
      expect(motion.fall).toBeGreaterThan(150)
      expect(motion.fallVelocity).toBeGreaterThan(20)
    }
  })

  it('waits for the whole rotated bird to pass the bottom before ending flight', () => {
    const geometry = { pose: { x: 0, y: 0, bank: -25, scale: 1 },
      bounds: { left: 0, top: 0, width: 200, height: 150 }, position: { x: 0, y: 100 } }
    expect(flightHasFallenOut(geometry, 180)).toBe(false)
    geometry.position.y = 250
    expect(flightHasFallenOut(geometry, 180)).toBe(true)
  })

  it('takes over without jumping and recovers immediately from held depth limits', () => {
    const motion = createFlightMotion()
    fly(motion, { throttle: 0, depth: 0 }, 6)
    const previous = { ...motion.pose }
    stepFlight(motion, { throttle: 1, depth: 1 }, 1 / 60)
    expect(Math.abs(motion.pose.scale - previous.scale)).toBeLessThan(.01)
    expect(Math.abs(motion.pose.x - previous.x)).toBeLessThan(.1)
    fly(motion, { throttle: 1, depth: 1 }, 20)
    expect(motion.depth).toBe(1)
    expect(motion.pose.scale).toBeLessThanOrEqual(1.55)
    fly(motion, { throttle: 0, depth: -1 }, 1)
    expect(motion.depth).toBeLessThan(.8)
    fly(motion, { throttle: 0, depth: -1 }, 20)
    expect(motion.depth).toBe(0)
    expect(motion.pose.scale).toBeGreaterThanOrEqual(.48)
    expect(motion.speed).toBeCloseTo(.35)
    fly(motion, { throttle: 0, depth: 1 }, 1)
    expect(motion.depth).toBeGreaterThan(.2)
  })

  it('keeps the beak and rider in the frame during the closest, fastest pass', () => {
    for (const width of [390, 1280, 1680]) {
      const height = width === 390 ? 844 : 1050
      const imageWidth = Math.min(width * (width <= 760 ? 1.1 : .74), height * (width <= 760 ? 1.05 : 1.12))
      const bounds = { left: (width - imageWidth) / 2, top: height * .43 - imageWidth * .75 / 2, width: imageWidth, height: imageWidth * .75 }
      const pose = { x: -12, y: 8, bank: -9, scale: 1.55 }
      const offset = frameFlight(pose, bounds, { width, height })
      const angle = pose.bank * Math.PI / 180
      for (const [x, y] of [[.03, .43], [.52, .17], [.575, .32], [.54, .74]]) {
        const dx = (x - .58) * bounds.width * pose.scale
        const dy = (y - .45) * bounds.height * pose.scale
        const screenX = bounds.left + bounds.width * .58 + dx * Math.cos(angle) - dy * Math.sin(angle) + offset.x
        const screenY = bounds.top + bounds.height * .45 + dx * Math.sin(angle) + dy * Math.cos(angle) + offset.y
        expect(screenX).toBeGreaterThan(0)
        expect(screenX).toBeLessThan(width)
        expect(screenY).toBeGreaterThan(0)
        expect(screenY).toBeLessThan(height)
      }
    }
  })
})
