export type FlightInput = { throttle: number; depth: number }
export type FlightPose = { x: number; y: number; bank: number; scale: number }
export type FlightMotion = {
  time: number
  controlled: boolean
  speed: number
  depth: number
  depthVelocity: number
  fall: number
  fallVelocity: number
  pose: FlightPose
  velocity: FlightPose
}

export const flightSpeeds = { cruise: 1.7, minimum: .35, maximum: 3.4 } as const

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const ease = (value: number, target: number, response: number, dt: number) => target + (value - target) * Math.exp(-response * dt)

function cruisePose(time: number): FlightPose {
  const phase = time * Math.PI * 2 / 28
  return {
    x: 10 * Math.cos(phase) + 4 * Math.sin(phase),
    y: 5 * Math.sin(phase) - 4 * Math.cos(phase),
    bank: -3 + 8 * Math.cos(phase),
    scale: .48 + 1.07 * (1 - Math.cos(phase)) / 2,
  }
}

export function createFlightMotion(): FlightMotion {
  const pose = cruisePose(4)
  return { time: 4, controlled: false, speed: flightSpeeds.cruise, depth: (pose.scale - .48) / 1.07,
    depthVelocity: 0, fall: 0, fallVelocity: 0, pose, velocity: { x: 0, y: 0, bank: 0, scale: 0 } }
}

// Position is in viewport percentages. Autopilot lasts until the first steering input;
// manual flight needs continuous forward thrust to retain height.
export function stepFlight(motion: FlightMotion, input: FlightInput, delta: number, reducedMotion = false) {
  const dt = clamp(delta, 0, 1 / 30)
  if (!dt) return
  motion.time += dt
  if (input.throttle || input.depth) motion.controlled = true
  if (!motion.controlled) {
    if (reducedMotion) return
    const next = cruisePose(motion.time)
    for (const key of ['x', 'y', 'bank', 'scale'] as const) {
      motion.velocity[key] = (next[key] - motion.pose[key]) / dt
    }
    motion.pose = next
    motion.depth = (next.scale - .48) / 1.07
    return
  }

  const powered = input.throttle > 0
  motion.speed = ease(motion.speed, powered ? flightSpeeds.maximum : flightSpeeds.minimum, powered ? 1.35 : .65, dt)
  const lift = clamp((motion.speed - flightSpeeds.minimum) / .6, 0, 1)
  // Releasing forward loses lift progressively, preserving vertical momentum.
  const descent = powered ? -Math.min(20, motion.fall * 1.8) * lift : 24
  motion.fallVelocity = ease(motion.fallVelocity, descent, powered ? 3.5 : .9, dt)
  const nextFall = motion.fall + motion.fallVelocity * dt
  motion.fall = Math.max(0, nextFall)
  if (nextFall !== motion.fall) motion.fallVelocity = 0
  const fallTilt = powered ? 0 : clamp(motion.fallVelocity / 24, 0, 1)
  // Reduced motion keeps deliberate depth steps and omits orbit/banking. The
  // vertical game mechanic still responds to holding/releasing forward.
  if (reducedMotion) return
  motion.depthVelocity = ease(motion.depthVelocity, input.depth * .32, 4, dt)
  const nextDepth = motion.depth + motion.depthVelocity * dt
  motion.depth = clamp(nextDepth, 0, 1)
  if (nextDepth !== motion.depth) motion.depthVelocity = 0

  const target: FlightPose = {
    x: 7 - 9 * motion.depth - (motion.speed - flightSpeeds.cruise) * 3,
    y: -4 + 9 * motion.depth + Math.sin(motion.time * 1.5) * .45,
    bank: -2 - (motion.speed - flightSpeeds.cruise) * 2 + motion.depthVelocity * 14
      + Math.sin(motion.time * .7) * .6 - fallTilt * 16 - motion.fallVelocity * .3,
    scale: .48 + 1.07 * motion.depth,
  }
  for (const key of ['x', 'y', 'bank', 'scale'] as const) {
    motion.velocity[key] += ((target[key] - motion.pose[key]) * 20 - motion.velocity[key] * 9) * dt
    motion.pose[key] += motion.velocity[key] * dt
  }
  const scale = clamp(motion.pose.scale, .48, 1.55)
  if (scale !== motion.pose.scale) motion.velocity.scale = 0
  motion.pose.scale = scale
}

export type FlightBounds = { left: number; top: number; width: number; height: number }

// Follow the bird with the camera so its beak, rider's head and feet remain in
// view even at full speed in the closest pass. Wings and tail can leave frame.
export function frameFlight(pose: FlightPose, bounds: FlightBounds, viewport: { width: number; height: number }, fall = 0) {
  const depth = clamp((pose.scale - .48) / 1.07, 0, 1)
  const angle = pose.bank * Math.PI / 180
  const points = [[.03, .43], [.52, .17], [.575, .32], [.54, .74]].map(([x, y]) => {
    const dx = (x - .58) * bounds.width * pose.scale
    const dy = (y - .45) * bounds.height * pose.scale
    return {
      x: bounds.left + bounds.width * .58 + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: bounds.top + bounds.height * .45 + dx * Math.sin(angle) + dy * Math.cos(angle),
    }
  })
  const margin = Math.min(viewport.width, viewport.height) * .025
  const follow = (wanted: number, positions: number[], extent: number) => {
    const min = margin - Math.min(...positions)
    const max = extent - margin - Math.max(...positions)
    return min > max ? (min + max) / 2 : clamp(wanted, min, max)
  }
  return {
    x: follow(viewport.width * (pose.x / 100 + (viewport.width <= 760 ? .52 * depth : 0)), points.map(point => point.x), viewport.width),
    // Apply lost height after framing, otherwise the camera cancels the fall.
    y: follow(viewport.height * pose.y / 100, points.map(point => point.y), viewport.height) + viewport.height * fall / 100,
  }
}

export type FlightGeometry = { pose: FlightPose; bounds: FlightBounds; position: { x: number; y: number }; releaseCount?: number; controlled?: boolean }

// Project a source-image point using the same pose that draws the bird. This
// avoids asking SVG to flush style/layout just to locate the claws each frame.
export function projectFlightPoint({ pose, bounds, position }: FlightGeometry, point: { x: number; y: number }) {
  const angle = pose.bank * Math.PI / 180
  const dx = (point.x - .58) * bounds.width * pose.scale
  const dy = (point.y - .45) * bounds.height * pose.scale
  return {
    x: bounds.left + bounds.width * .58 + position.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: bounds.top + bounds.height * .45 + position.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  }
}

// All four corners must clear the bottom. This covers the full rotated bird,
// including its wings, without forcing a DOM layout read on every frame.
export function flightHasFallenOut(geometry: FlightGeometry, viewportHeight: number) {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
    .every(point => projectFlightPoint(geometry, point).y > viewportHeight)
}
