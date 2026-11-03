import { clamp } from './screensaverFlight'

export type Point = { x: number; y: number }
export type FlyingHat = Point & { id: number; depth: number; lane: number; age: number; speed: number; size: number; caught: number | null; from: Point }
export type ReleasedHatPose = Point & { size: number; rotation: number }
export type FallingHat = ReleasedHatPose & { id: number; vx: number; vy: number; gravity: number; spin: number }
export type HatFlightGame = {
  width: number; height: number; time: number; bird: Point; previousBird: Point
  birdWidth: number; birdBaseWidth: number; score: number; carried: number; releaseUntil: number
  nextHat: number; serial: number; dropSerial: number; hats: FlyingHat[]; dropped: FallingHat[]
}

// The catch point is the real curled claw in the 1448 × 1086 bird photograph.
export const claw = { x: 850 / 1448, y: 900 / 1086 }
export const gameCapImage = '/images/campaigns/kruk-cap-cutout-v2.webp'
export const capWidthInBirdImage = 177
export const carriedHatPlacement = (index: number) => ({
  x: 776 + (index % 2) * 61 - Math.floor(index / 2) * 8,
  y: 871 + Math.floor(index / 2) * 45 + (index % 2) * 15,
  rotation: index % 2 ? 14 : -13,
})
const baseFlightWidth = (width: number, height: number) => Math.min(width * (width <= 760 ? 1.1 : .74), height * (width <= 760 ? 1.05 : 1.12))
const hatSizeAtDepth = (baseWidth: number, depth: number) => baseWidth * (.48 + 1.07 * depth) * capWidthInBirdImage / 1448

export function createHatFlight(width: number, height: number): HatFlightGame {
  const bird = { x: width * .66, y: height * .62 }
  return { width, height, time: 0, bird, previousBird: { ...bird }, birdWidth: width * .62, birdBaseWidth: baseFlightWidth(width, height),
    score: 0, carried: 0, releaseUntil: 0, nextHat: .6, serial: 0, dropSerial: 0, hats: [], dropped: [] }
}

export function resizeHatFlight(game: HatFlightGame, width: number, height: number) {
  if (width <= 0 || height <= 0) return
  const sx = width / game.width, sy = height / game.height
  game.bird.x *= sx; game.bird.y *= sy
  game.previousBird = { ...game.bird }
  for (const hat of game.hats) {
    hat.x *= sx; hat.y *= sy; hat.lane *= sy
    hat.from.x *= sx; hat.from.y *= sy
  }
  game.width = width; game.height = height
  const baseWidth = baseFlightWidth(width, height)
  for (const hat of game.dropped) {
    hat.x *= sx; hat.y *= sy; hat.vx *= sx; hat.vy *= sy; hat.gravity *= sy
    hat.size *= baseWidth / game.birdBaseWidth
  }
  game.birdWidth *= baseWidth / game.birdBaseWidth
  game.birdBaseWidth = baseWidth
  for (const hat of game.hats) hat.size = hatSizeAtDepth(baseWidth, hat.depth)
}

export function releaseCarriedHats(game: HatFlightGame, poses: ReleasedHatPose[]) {
  const count = Math.min(game.carried, poses.length)
  if (!count) return
  for (let i = 0; i < count; i++) {
    const pose = poses[i]
    game.dropped.push({ ...pose, id: game.dropSerial++, vx: (i % 2 ? 12 : -12) + i * 3, vy: 0,
      gravity: Math.max(260, game.height * .75) * pose.size / (game.birdBaseWidth * capWidthInBirdImage / 1448),
      spin: (i % 2 ? 1 : -1) * (25 + i * 9) })
  }
  game.carried = 0
  game.releaseUntil = Math.max(game.releaseUntil, game.time + .45)
  // Recently caught caps may still be completing their arrival animation.
  game.hats = game.hats.filter(hat => hat.caught === null)
}

export function segmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x, dy = to.y - from.y
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
  return Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t)
}

export function stepHatFlight(game: HatFlightGame, delta: number, reducedMotion = false) {
  const dt = clamp(delta, 0, .05)
  game.time += dt
  const radius = Math.max(18, game.birdWidth * .035)
  if (game.time >= game.nextHat) {
    const id = game.serial++
    // Caps cross the depths already reachable with the original flight controls.
    const depths = [.15, .65, .35, .85, .05, .5]
    const baseWidth = game.birdBaseWidth
    const depth = id === 0 ? clamp((game.birdWidth / baseWidth - .48) / 1.07, 0, 1)
      : depths[(id - 1) % depths.length]
    const lane = id === 0 ? game.bird.y : clamp(game.height * (.39 + .09 * depth)
      + baseWidth * .75 * (-.05 + (claw.y - .45) * (.48 + 1.07 * depth)), 40, game.height - 40)
    const size = hatSizeAtDepth(baseWidth, depth)
    game.hats.push({ id, depth, x: -size, y: lane, lane, age: 0, speed: Math.max(105, game.width * .24),
      size, caught: null, from: { x: -size, y: lane } })
    game.nextHat = game.time + 2.65
  }
  const caught: number[] = []
  for (const hat of game.hats) {
    hat.size = hatSizeAtDepth(game.birdBaseWidth, hat.depth)
    if (hat.caught !== null) continue
    const before = { x: hat.x - game.previousBird.x, y: hat.y - game.previousBird.y }
    hat.age += dt
    hat.x += hat.speed * dt
    hat.y = hat.lane + (reducedMotion ? 0 : Math.sin(hat.age * 2.5 + hat.id) * 10)
    const after = { x: hat.x - game.bird.x, y: hat.y - game.bird.y }
    if (game.time >= game.releaseUntil && segmentDistance({ x: 0, y: 0 }, before, after) <= radius + hat.size * .18) {
      hat.caught = game.time
      hat.from = { x: hat.x, y: hat.y }
      game.score++; game.carried = Math.min(6, game.carried + 1); caught.push(hat.id)
    }
  }
  game.previousBird = { ...game.bird }
  game.hats = game.hats.filter(hat => hat.caught === null ? hat.x < game.width + hat.size : game.time - hat.caught < .48)
  for (const hat of game.dropped) {
    hat.x += hat.vx * dt
    hat.y += hat.vy * dt + .5 * hat.gravity * dt * dt
    hat.vy += hat.gravity * dt
    hat.vx *= Math.exp(-dt * .35)
    if (!reducedMotion) hat.rotation += hat.spin * dt
  }
  game.dropped = game.dropped.filter(hat => hat.y - hat.size <= game.height)
  return caught
}

// Open only for caps within reach and on course for the feet. After contact,
// hold open briefly while the cap arrives, then curl around its crown.
export function clawOpening(game: HatFlightGame, caughtAt: number) {
  const sinceCatch = game.time - caughtAt
  if (sinceCatch >= 0 && sinceCatch < .44) {
    const close = clamp((sinceCatch - .06) / .38, 0, 1)
    return 1 - close * close * (3 - 2 * close)
  }
  let opening = 0
  for (const hat of game.hats) {
    if (hat.caught !== null || hat.x > game.bird.x + hat.size * .2) continue
    const contact = Math.max(18, game.birdWidth * .035) + hat.size * .18
    if (Math.abs(hat.y - game.bird.y) > contact * 1.25) continue
    const reach = contact + Math.max(65, game.birdWidth * .14)
    const distance = Math.hypot(hat.x - game.bird.x, hat.y - game.bird.y)
    const proximity = clamp((reach - distance) / (reach - contact), 0, 1)
    opening = Math.max(opening, proximity * proximity * (3 - 2 * proximity))
  }
  return opening
}
