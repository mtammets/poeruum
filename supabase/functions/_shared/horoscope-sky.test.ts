import { describe, expect, it } from 'vitest'
import { getHoroscopeSky } from './horoscope-sky'

describe('horoscope sky', () => {
  it.each([
    ['2026-01-15', '2026-01-14T22:00:00.000Z', '2026-01-15T22:00:00.000Z', '2026-01-15T10:00:00.000Z'],
    ['2026-07-15', '2026-07-14T21:00:00.000Z', '2026-07-15T21:00:00.000Z', '2026-07-15T09:00:00.000Z'],
    ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T21:00:00.000Z', '2026-03-29T09:00:00.000Z'],
    ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z', '2026-10-25T10:00:00.000Z'],
  ])('uses the whole Tallinn day and local noon for %s', (date, start, endExclusive, noon) => {
    const sky = getHoroscopeSky(date)
    expect(sky.day).toEqual({ start, endExclusive })
    expect(sky.positionsAt).toBe(noon)
  })

  it('finds the Sun–Moon conjunction on the 2024 total solar eclipse day', () => {
    // Independent reference: https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2024Apr08Tbeselm.html
    const sky = getHoroscopeSky('2024-04-08')
    const conjunction = sky.aspects.find((aspect) => aspect.bodies.join() === 'Sun,Moon' && aspect.angleDegrees === 0)
    expect(conjunction).toBeDefined()
    expect(conjunction!.closestOrbDegrees).toBeLessThan(0.5)
    // The event occurs in the evening; a noon-only aspect calculation misses it.
    expect(conjunction!.startOrbDegrees).toBeGreaterThan(3)
    expect(conjunction!.endOrbDegrees).toBeLessThan(3)
    expect(sky.bodies.find((body) => body.body === 'Sun')?.sign).toBe('aries')
    expect(sky.bodies.find((body) => body.body === 'Moon')?.sign).toBe('aries')
  })

  it('keeps motion small and positive through the Pisces–Aries boundary', () => {
    const sky = getHoroscopeSky('2024-03-20')
    const sun = sky.bodies.find((body) => body.body === 'Sun')!
    expect(sun.startsIn).toBe('pisces')
    expect(sun.endsIn).toBe('aries')
    expect(sun.motionDegrees).toBeGreaterThan(0)
    expect(sun.motionDegrees).toBeLessThan(2)
    expect(sun.retrograde).toBe(false)
  })

  it('gives the same sky a different solar-house context for each sign', () => {
    const sky = getHoroscopeSky('2024-04-08')
    expect(sky.signs.find((sign) => sign.id === 'aries')?.solarHouses.Sun).toBe(1)
    expect(sky.signs.find((sign) => sign.id === 'taurus')?.solarHouses.Sun).toBe(12)
    expect(sky.signs.find((sign) => sign.id === 'pisces')?.solarHouses.Sun).toBe(2)
    expect(new Set(sky.signs.map((sign) => sign.solarHouses.Moon)).size).toBe(12)
  })

  it('changes lunar positions and aspects between consecutive editions', () => {
    const today = getHoroscopeSky('2026-09-13')
    const tomorrow = getHoroscopeSky('2026-09-14')
    expect(today.bodies.find((body) => body.body === 'Moon')).not.toEqual(tomorrow.bodies.find((body) => body.body === 'Moon'))
    expect(today.aspects).not.toEqual(tomorrow.aspects)
    expect(getHoroscopeSky('2026-09-13')).toEqual(today)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-9-13', 'invalid'])('rejects an invalid edition date: %s', (date) => {
    expect(() => getHoroscopeSky(date)).toThrow('Invalid horoscope date')
  })
})
