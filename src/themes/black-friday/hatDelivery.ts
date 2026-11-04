import type { HatFlightGame } from './hatFlightPhysics'

export const deliveryFlightSeconds = 32
export const entranceSeconds = 6.4
export const deliveredSeconds = 9
export const returnToStoreSeconds = 12.8
export const deliveredHatsStorageKey = 'poeruum:woodpecker:delivered:v1'
export type DeliveryPhase = 'collecting' | 'approaching' | 'entering' | 'delivered'
export type HatDelivery = { phase: DeliveryPhase; flightTime: number; elapsed: number; cargo: number }

export const createHatDelivery = (): HatDelivery => ({ phase: 'collecting', flightTime: 0, elapsed: 0, cargo: 0 })

// Only cargo that actually crosses the shop threshold is credited. Released
// hats and earlier catches are deliberately unrelated to the delivery total.
export function stepHatDelivery(journey: HatDelivery, game: HatFlightGame, dt: number,
  interactive: boolean, destinationReady: boolean, releasing: boolean) {
  if (!interactive) return 0
  if (journey.phase === 'collecting') {
    journey.flightTime += dt
    if (journey.flightTime >= deliveryFlightSeconds && game.carried > 0 && destinationReady && !releasing) {
      journey.phase = 'approaching'
      journey.cargo = game.carried
      // The caller waits for the last catch to reach the claws before landing.
      game.hats = []; game.dropped = []
    }
    return 0
  }
  journey.elapsed += dt
  if (journey.elapsed >= deliveredSeconds && journey.phase !== 'delivered') {
    journey.phase = 'delivered'
    const delivered = game.carried
    game.carried = 0
    return delivered
  }
  if (journey.elapsed >= entranceSeconds && journey.phase === 'approaching') journey.phase = 'entering'
  return 0
}

export function readDeliveredHats() {
  try {
    const value = Number(localStorage.getItem(deliveredHatsStorageKey))
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

export function saveDeliveredHats(count: number) {
  try { localStorage.setItem(deliveredHatsStorageKey, String(count)) } catch { /* Play also works without storage. */ }
}
