import { describe, expect, it } from 'vitest'
import { clawOpening, createHatFlight, releaseCarriedHats, resizeHatFlight, segmentDistance, stepHatFlight } from './hatFlightPhysics'

describe('hat flight catches', () => {
  it('detects a fast hat crossing the claws between frames, exactly once', () => {
    const game = createHatFlight(1440, 900)
    game.nextHat = Infinity
    game.hats = [{ id: 0, depth: .5, x: game.bird.x - 300, y: game.bird.y, lane: game.bird.y, age: 0,
      speed: 12000, size: 90, caught: null, from: { ...game.bird } }]
    expect(stepHatFlight(game, .05, true)).toHaveLength(1)
    expect(game.score).toBe(1)
    for (let i = 0; i < 30; i++) expect(stepHatFlight(game, .05, true)).toHaveLength(0)
    expect(game.score).toBe(1)
    expect(game.hats).toHaveLength(0)
  })

  it('does not count a hat flying above the feet, and lets it leave the frame', () => {
    const game = createHatFlight(1440, 900)
    game.nextHat = Infinity
    game.hats = [{ id: 0, depth: .5, x: game.bird.x - 100, y: game.bird.y - 200, lane: game.bird.y - 200,
      age: 0, speed: 500, size: 90, caught: null, from: { ...game.bird } }]
    for (let i = 0; i < 60; i++) stepHatFlight(game, .05, true)
    expect(game.score).toBe(0)
    expect(game.hats).toHaveLength(0)
  })

  it('offers a first catch without input and keeps the stream bounded', () => {
    const game = createHatFlight(1440, 900)
    for (let i = 0; i < 5 * 60; i++) stepHatFlight(game, 1 / 60)
    expect(game.score).toBeGreaterThan(0)
    for (let i = 0; i < 180 * 60; i++) stepHatFlight(game, 1 / 60)
    expect(game.hats.length).toBeLessThan(8)
  })

  it('preserves catches and finite coordinates through phone rotation', () => {
    const game = createHatFlight(390, 844)
    game.score = 4
    resizeHatFlight(game, 0, 0)
    expect(Number.isFinite(game.bird.x)).toBe(true)
    resizeHatFlight(game, 844, 390)
    expect(game.score).toBe(4)
    expect(game.bird.x).toBeGreaterThan(0)
    expect(game.bird.x).toBeLessThan(844)
    expect(game.bird.y).toBeLessThan(390)
    expect(segmentDistance({ x: 4, y: 3 }, { x: 0, y: 0 }, { x: 8, y: 0 })).toBe(3)
  })
  it('opens the toes only for an approaching cap within reach, then closes after contact', () => {
    const game = createHatFlight(1440, 900)
    game.nextHat = Infinity
    const hat = { id: 0, depth: .5, x: game.bird.x - 500, y: game.bird.y, lane: game.bird.y,
      age: 0, speed: 300, size: 90, caught: null, from: { ...game.bird } }
    game.hats = [hat]
    expect(clawOpening(game, -10)).toBe(0)
    hat.x = game.bird.x - 70
    expect(clawOpening(game, -10)).toBeGreaterThan(.7)
    hat.y = game.bird.y - 200
    expect(clawOpening(game, -10)).toBe(0)
    hat.y = game.bird.y
    hat.x = game.bird.x + 100
    expect(clawOpening(game, -10)).toBe(0)
    game.hats = []
    game.time = 4
    expect(clawOpening(game, 4)).toBe(1)
    game.time = 4.25
    expect(clawOpening(game, 4)).toBeCloseTo(.5)
    game.time = 4.5
    expect(clawOpening(game, 4)).toBe(0)
  })

  it('makes near caps larger than distant caps and keeps their depth through resizing', () => {
    const game = createHatFlight(1440, 900)
    game.serial = 4 // a near cap, followed by a distant cap
    game.nextHat = 0
    stepHatFlight(game, .01)
    game.nextHat = 0
    stepHatFlight(game, .01)
    const [near, far] = game.hats
    expect(near.depth).toBeGreaterThan(far.depth)
    expect(near.size).toBeGreaterThan(far.size * 2)
    const ratio = near.size / far.size
    resizeHatFlight(game, 390, 844)
    expect(near.size / far.size).toBeCloseTo(ratio)
    expect(near.size).toBeLessThan(100)
    expect(far.size).toBeLessThan(near.size)
  })

  it('spawns the first cap at the bird’s depth, with the same size relationship', () => {
    const far = createHatFlight(1440, 900)
    const near = createHatFlight(1440, 900)
    far.birdWidth = far.birdBaseWidth * .5
    near.birdWidth = near.birdBaseWidth * 1.5
    far.nextHat = near.nextHat = 0
    stepHatFlight(far, .01)
    stepHatFlight(near, .01)
    expect(near.hats[0].size / far.hats[0].size).toBeCloseTo(near.birdWidth / far.birdWidth)
  })

  it('releases all carried caps from their current poses without resetting catches or the incoming stream', () => {
    const game = createHatFlight(1440, 900)
    game.score = 9; game.carried = 6; game.nextHat = Infinity
    const poses = Array.from({ length: 6 }, (_, i) => ({ x: 800 + i * 5, y: 600 + i * 8, size: 90, rotation: i * 3 }))
    game.hats = [{ id: 8, depth: .5, x: 800, y: 600, lane: 600, age: 1, speed: 300,
      size: 90, caught: 0, from: { x: 800, y: 600 } },
    { id: 9, depth: .5, x: -90, y: 600, lane: 600, age: 0, speed: 300,
      size: 90, caught: null, from: { x: -90, y: 600 } }]
    releaseCarriedHats(game, poses)
    expect(game.carried).toBe(0)
    expect(game.score).toBe(9)
    expect(game.dropped).toHaveLength(6)
    poses.forEach((pose, i) => expect(game.dropped[i]).toMatchObject(pose))
    expect(game.hats.map(hat => hat.id)).toEqual([9])
    releaseCarriedHats(game, poses)
    expect(game.dropped).toHaveLength(6)
    for (let i = 0; i < 10; i++) stepHatFlight(game, .05, true)
    game.hats[0].x = game.bird.x; game.hats[0].lane = game.bird.y
    expect(stepHatFlight(game, .05, true)).toEqual([9])
    expect(game.score).toBe(10)
    expect(game.carried).toBe(1)
  })

  it('drops caps smoothly at consistent frame rates and removes them below the screen', () => {
    const games = [30, 120].map(fps => {
      const game = createHatFlight(1440, 900)
      game.carried = 1; game.score = 1; game.nextHat = Infinity
      releaseCarriedHats(game, [{ ...game.bird, size: 90, rotation: -13 }])
      for (let i = 0; i < fps / 2; i++) stepHatFlight(game, 1 / fps)
      expect(game.dropped[0].y).toBeGreaterThan(game.bird.y + 40)
      expect(game.score).toBe(1)
      return game
    })
    expect(games[0].dropped[0].y).toBeCloseTo(games[1].dropped[0].y, 5)
    for (let i = 0; i < 120; i++) stepHatFlight(games[0], .05)
    expect(games[0].dropped).toHaveLength(0)
  })

  it('does not catch again while the toes are opening to release, and preserves drops through resize', () => {
    const game = createHatFlight(1440, 900)
    game.carried = 1; game.score = 1; game.nextHat = Infinity
    releaseCarriedHats(game, [{ ...game.bird, size: 90, rotation: 14 }])
    game.hats = [{ id: 1, depth: .5, ...game.bird, lane: game.bird.y, age: 0,
      speed: 300, size: 90, caught: null, from: { ...game.bird } }]
    expect(stepHatFlight(game, .05, true)).toHaveLength(0)
    expect(game.carried).toBe(0)
    expect(game.dropped[0].rotation).toBe(14)
    const before = { ...game.dropped[0] }
    resizeHatFlight(game, 390, 844)
    expect(game.dropped[0].x).toBeCloseTo(before.x * 390 / 1440)
    expect(game.dropped[0].y).toBeCloseTo(before.y * 844 / 900)
    expect(game.dropped[0].size).toBeLessThan(before.size)
    expect(game.dropped[0].vy).toBeGreaterThan(0)
  })

})
