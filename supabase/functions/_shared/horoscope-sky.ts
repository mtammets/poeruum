import { Body, Ecliptic, GeoVector, MoonPhase } from 'astronomy-engine'
import { nextHoroscopeDate, zodiacSigns } from './horoscope.ts'

const hourMs = 60 * 60 * 1000
const bodies = [Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars,
  Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto]
const aspectAngles = [0, 60, 90, 120, 180]
const tallinnClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

const round = (value: number) => Math.round(value * 100) / 100
const signedAngle = (value: number) => ((value + 540) % 360) - 180
const signIndex = (longitude: number) => Math.floor(longitude / 30)

// Tallinn's clock changes after midnight, so both 00:00 and 12:00 can be
// resolved from the offset at the corresponding UTC hour, including DST days.
const tallinnTime = (date: string, hour: number) => {
  const utc = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`)
  const [localHour, localMinute] = tallinnClock.format(utc).split(':').map(Number)
  return new Date(utc.getTime() - ((localHour - hour) * 60 + localMinute) * 60_000)
}

const positionsAt = (time: Date) => bodies.map((body) => Ecliptic(GeoVector(body, time, true)).elon)

/** Astronomical facts for one Tallinn day; astrological interpretation belongs to the writer. */
export function getHoroscopeSky(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid horoscope date.')
  }

  const start = tallinnTime(date, 0)
  const end = tallinnTime(nextHoroscopeDate(date), 0)
  const noon = tallinnTime(date, 12)
  const positions = positionsAt(noon)
  const samples: number[][] = []
  // Hourly samples include lunar aspects that are absent at noon. Orbs are
  // explicitly approximate; these samples do not claim exact event times.
  for (let time = start.getTime(); time < end.getTime(); time += hourMs) {
    samples.push(positionsAt(new Date(time)))
  }
  samples.push(positionsAt(new Date(end.getTime() - 1)))
  const first = samples[0]
  const last = samples[samples.length - 1]

  const aspects: {
    bodies: Body[]; angleDegrees: number; closestOrbDegrees: number;
    startOrbDegrees: number; endOrbDegrees: number;
  }[] = []
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const separations = samples.map((sample) => Math.abs(signedAngle(sample[a] - sample[b])))
      for (const angle of aspectAngles) {
        const orbs = separations.map((separation) => Math.abs(separation - angle))
        const closest = Math.min(...orbs)
        if (closest <= 3) {
          aspects.push({
            bodies: [bodies[a], bodies[b]], angleDegrees: angle, closestOrbDegrees: round(closest),
            startOrbDegrees: round(orbs[0]), endOrbDegrees: round(orbs[orbs.length - 1]),
          })
        }
      }
    }
  }
  aspects.sort((a, b) => a.closestOrbDegrees - b.closestOrbDegrees)

  return {
    date,
    timeZone: 'Europe/Tallinn',
    day: { start: start.toISOString(), endExclusive: end.toISOString() },
    coordinates: 'Geocentric tropical zodiac; true ecliptic of date.',
    positionsAt: noon.toISOString(),
    moonPhase: { angleDegrees: round(MoonPhase(noon)), convention: '0=new, 90=first quarter, 180=full, 270=last quarter' },
    bodies: bodies.map((body, index) => ({
      body,
      longitudeDegrees: round(positions[index]),
      sign: zodiacSigns[signIndex(positions[index])].id,
      startsIn: zodiacSigns[signIndex(first[index])].id,
      endsIn: zodiacSigns[signIndex(last[index])].id,
      motionDegrees: round(signedAngle(last[index] - first[index])),
      retrograde: signedAngle(last[index] - first[index]) < 0,
    })),
    aspects,
    aspectSampling: 'Approximate closest orbs from hourly samples within this day; not exact aspect times.',
    readingMethod: 'Solar whole-sign houses: the reader’s sign is house 1. General sun-sign readings, not personal birth charts.',
    signs: zodiacSigns.map((sign, index) => ({
      ...sign,
      solarHouses: Object.fromEntries(bodies.map((body, bodyIndex) => [
        body, (signIndex(positions[bodyIndex]) - index + 12) % 12 + 1,
      ])),
    })),
  }
}
