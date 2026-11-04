import { describe, expect, it } from 'vitest'
import { createHatFlight, releaseCarriedHats } from './hatFlightPhysics'
import { createHatDelivery, deliveredSeconds, deliveryFlightSeconds, entranceSeconds, stepHatDelivery } from './hatDelivery'
import { destinationFrame } from './drawStoreArrival'

describe('the first hat delivery', () => {
  it('credits only hats still carried when the bird has entered the shop, exactly once', () => {
    const journey = createHatDelivery(), game = createHatFlight(1440, 900)
    game.score = 9; game.carried = 4
    expect(stepHatDelivery(journey, game, deliveryFlightSeconds, true, true, false)).toBe(0)
    expect(journey.phase).toBe('approaching')
    expect(journey.cargo).toBe(4)
    expect(stepHatDelivery(journey, game, entranceSeconds, true, true, false)).toBe(0)
    expect(journey.phase).toBe('entering')
    expect(game.carried).toBe(4)
    expect(stepHatDelivery(journey, game, deliveredSeconds - entranceSeconds, true, true, false)).toBe(4)
    expect(journey.phase).toBe('delivered')
    expect(game.carried).toBe(0)
    expect(stepHatDelivery(journey, game, 5, true, true, false)).toBe(0)
  })

  it('does not deliver dropped hats or an empty load and waits for a fresh catch', () => {
    const journey = createHatDelivery(), game = createHatFlight(390, 844)
    game.score = 3; game.carried = 3
    releaseCarriedHats(game, Array.from({ length: 3 }, () => ({ x: 100, y: 300, size: 60, rotation: 0 })))
    expect(stepHatDelivery(journey, game, 60, true, true, false)).toBe(0)
    expect(journey.phase).toBe('collecting')
    game.carried = 1
    stepHatDelivery(journey, game, .05, true, true, false)
    expect(journey.cargo).toBe(1)
    expect(stepHatDelivery(journey, game, deliveredSeconds, true, true, false)).toBe(1)
  })

  it('keeps the passive screensaver endless and waits for the photograph and releasing toes', () => {
    const journey = createHatDelivery(), game = createHatFlight(1440, 900)
    game.carried = 6
    stepHatDelivery(journey, game, 120, false, true, false)
    expect(journey.flightTime).toBe(0)
    stepHatDelivery(journey, game, 40, true, false, false)
    expect(journey.phase).toBe('collecting')
    stepHatDelivery(journey, game, 1, true, true, true)
    expect(journey.phase).toBe('collecting')
    stepHatDelivery(journey, game, .05, true, true, false)
    expect(journey.phase).toBe('approaching')
  })

  it('brings the shop in from the left and keeps its doorway and ground in the camera after rotation', () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const start = destinationFrame(viewport, 0)
      expect(start.left + start.width).toBe(0)
      const frame = destinationFrame(viewport, 1)
      expect(frame.left).toBeGreaterThan(start.left)
      expect(frame.left + frame.width * .85).toBeGreaterThan(0)
      expect(frame.left + frame.width * .85).toBeLessThan(viewport.width)
      expect(frame.top + frame.height * .89).toBeCloseTo(viewport.height * .86)
    }
  })
})
