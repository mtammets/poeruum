import { describe, expect, it } from 'vitest'
import { formatDispatchTime, getDispatchTimeError } from './dispatchTime'

describe('dispatch time', () => {
  it.each([
    [1, 1, 'business_days', 'Saadame 1 tööpäevaga'],
    [3, 5, 'business_days', 'Saadame 3–5 tööpäevaga'],
    [1, 1, 'weeks', 'Saadame 1 nädalaga'],
    [2, 3, 'weeks', 'Saadame 2–3 nädalaga'],
  ])('formats %s–%s %s without parsing free text', (min, max, unit, text) => {
    expect(formatDispatchTime({ enabled: true, min, max, unit })).toBe(text)
  })

  it.each([undefined, null, { enabled: false, min: 3, max: 5, unit: 'business_days' }])('makes no promise for unset or hidden time: %j', (value) => {
    expect(getDispatchTimeError(value)).toBeNull()
    expect(formatDispatchTime(value)).toBe('')
  })

  it.each([
    {}, 'Saadame 1–2 tööpäevaga',
    { enabled: true, min: null, max: 5, unit: 'business_days' },
    { enabled: true, min: 3, max: null, unit: 'business_days' },
    { enabled: true, min: 0, max: 5, unit: 'business_days' },
    { enabled: true, min: -1, max: 5, unit: 'business_days' },
    { enabled: true, min: 1.5, max: 5, unit: 'business_days' },
    { enabled: true, min: 5, max: 3, unit: 'business_days' },
    { enabled: true, min: '3', max: 5, unit: 'business_days' },
    { enabled: true, min: 3, max: Infinity, unit: 'business_days' },
    { enabled: true, min: 3, max: 5, unit: 'months' },
    { enabled: 'true', min: 3, max: 5, unit: 'weeks' },
  ])('rejects invalid data and does not display a promise: %j', (value) => {
    expect(getDispatchTimeError(value)).not.toBeNull()
    expect(formatDispatchTime(value)).toBe('')
  })
})
