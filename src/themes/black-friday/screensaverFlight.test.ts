import { describe, expect, it } from 'vitest'
import { createFlightMotion, frameFlight, stepFlight, type FlightInput, type FlightMotion } from './screensaverFlight'

function fly(motion: FlightMotion, input: FlightInput, seconds: number, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame++) stepFlight(motion, input, 1 / fps)
}

describe('screensaver flight', () => {
  it('keeps acceleration consistent at different frame rates and coasts after release', () => {
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
    expect(fast.speed).toBeCloseTo(1, 2)
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
    fly(motion, { throttle: -1, depth: -1 }, 1)
    expect(motion.depth).toBeLessThan(.8)
    fly(motion, { throttle: -1, depth: -1 }, 20)
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
