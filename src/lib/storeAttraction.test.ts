import { describe, expect, it } from 'vitest'
import { attractionPlot, attractionTrend, packAttractionBubbles } from './storeAttraction'

describe('attraction comparisons', () => {
  it('distinguishes unavailable history, growth from zero, and real decline', () => {
    expect(attractionTrend(20, 0, false)).toEqual({ tone: 'unknown', label: 'Võrdlus koguneb' })
    expect(attractionTrend(20, 0, true)).toEqual({ tone: 'up', label: 'Uued avamised' })
    expect(attractionTrend(0, 20, true)).toEqual({ tone: 'down', label: '−100%' })
    expect(attractionTrend(24, 12, true)).toEqual({ tone: 'up', label: '+100%' })
    expect(attractionTrend(0, 0, true)).toEqual({ tone: 'steady', label: 'Muutuseta' })
  })
})

describe('attraction bubble layout', () => {
  it.each([[24, 8, 4, 0], [0, 0, 0, 0, 0, 0, 0, 0], [100000, 7, 5, 3, 2, 1, 0, 0], [1]])('keeps circles separated, in bounds, and stable for %j', (...clicks) => {
    const items = clicks.map((count, i) => ({ id: String(i), clicks: count }))
    const bubbles = packAttractionBubbles(items)
    expect(packAttractionBubbles(items)).toEqual(bubbles)
    expect(bubbles).toHaveLength(items.length)
    for (const [i, bubble] of bubbles.entries()) {
      expect(bubble.x - bubble.r).toBeGreaterThanOrEqual(0)
      expect(bubble.y - bubble.r).toBeGreaterThanOrEqual(0)
      expect(bubble.x + bubble.r).toBeLessThanOrEqual(attractionPlot.width)
      expect(bubble.y + bubble.r).toBeLessThanOrEqual(attractionPlot.height)
      for (const other of bubbles.slice(i + 1)) expect(Math.hypot(bubble.x - other.x, bubble.y - other.y)).toBeGreaterThanOrEqual(bubble.r + other.r)
    }
    expect(bubbles[0].r).toBeGreaterThanOrEqual(bubbles.at(-1)!.r)
  })
  it('leaves an empty dataset empty', () => { expect(packAttractionBubbles([])).toEqual([]) })
})
