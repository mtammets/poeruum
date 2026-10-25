export type FlightInput = { throttle: number; depth: number }
export type FlightPose = { x: number; y: number; bank: number; scale: number }
export type FlightMotion = {
  time: number
  controlled: boolean
  speed: number
  depth: number
  depthVelocity: number
  pose: FlightPose
  velocity: FlightPose
}

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
  return { time: 4, controlled: false, speed: 1, depth: (pose.scale - .48) / 1.07,
    depthVelocity: 0, pose, velocity: { x: 0, y: 0, bank: 0, scale: 0 } }
}

// Position is in viewport percentages. Springs retain momentum when the pilot
// takes over; releasing the throttle gradually settles back into a glide.
export function stepFlight(motion: FlightMotion, input: FlightInput, delta: number) {
  const dt = clamp(delta, 0, 1 / 30)
  if (!dt) return
  motion.time += dt
  if (input.throttle || input.depth) motion.controlled = true
  if (!motion.controlled) {
    const next = cruisePose(motion.time)
    for (const key of ['x', 'y', 'bank', 'scale'] as const) {
      motion.velocity[key] = (next[key] - motion.pose[key]) / dt
    }
    motion.pose = next
    motion.depth = (next.scale - .48) / 1.07
    return
  }

  const targetSpeed = input.throttle > 0 ? 3.4 : input.throttle < 0 ? .35 : 1
  motion.speed = ease(motion.speed, targetSpeed, input.throttle ? 1.35 : .42, dt)
  motion.depthVelocity = ease(motion.depthVelocity, input.depth * .32, 4, dt)
  const nextDepth = motion.depth + motion.depthVelocity * dt
  motion.depth = clamp(nextDepth, 0, 1)
  if (nextDepth !== motion.depth) motion.depthVelocity = 0

  const target: FlightPose = {
    x: 7 - 9 * motion.depth - (motion.speed - 1) * 3,
    y: -4 + 9 * motion.depth + Math.sin(motion.time * 1.5) * .45,
    bank: -2 - (motion.speed - 1) * 2 + motion.depthVelocity * 14 + Math.sin(motion.time * .7) * .6,
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
export function frameFlight(pose: FlightPose, bounds: FlightBounds, viewport: { width: number; height: number }) {
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
    y: follow(viewport.height * pose.y / 100, points.map(point => point.y), viewport.height),
  }
}
