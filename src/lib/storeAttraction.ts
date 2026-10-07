export function attractionTrend(current: number, previous: number, comparisonAvailable: boolean) {
  if (!comparisonAvailable) return { tone: 'unknown', label: 'Võrdlus koguneb' } as const
  if (current === previous) return { tone: 'steady', label: 'Muutuseta' } as const
  if (previous === 0) return { tone: 'up', label: 'Uued avamised' } as const
  const percent = (current - previous) / previous * 100
  return { tone: percent > 0 ? 'up' : 'down', label: `${percent > 0 ? '+' : ''}${percent.toLocaleString('et-EE', { maximumFractionDigits: 0 })}%` } as const
}

type Bubble = { id: string; x: number; y: number; r: number }
export const attractionPlot = { width: 360, height: 180 }

// Pack a small, ranked set without random positions or a running simulation.
// Zeroes retain an outlined, selectable circle; size otherwise follows sqrt(clicks).
export function packAttractionBubbles(items: { id: string; clicks: number }[]): Bubble[] {
  const maximum = Math.max(1, ...items.map((item) => item.clicks))
  const bubbles: Bubble[] = []
  for (const item of items) {
    const r = Math.max(27, 72 * Math.sqrt(Math.max(0, item.clicks) / maximum))
    if (!bubbles.length) { bubbles.push({ id: item.id, x: 0, y: 0, r }); continue }
    let best: Bubble | undefined
    let bestScore = Infinity
    for (const anchor of bubbles) {
      for (let angle = 0; angle < 48; angle++) {
        const radians = angle * Math.PI / 24
        const candidate = { id: item.id, x: anchor.x + Math.cos(radians) * (anchor.r + r + 8), y: anchor.y + Math.sin(radians) * (anchor.r + r + 8), r }
        if (bubbles.some((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) < r + other.r + 7.9)) continue
        const all = [...bubbles, candidate]
        const width = Math.max(...all.map((b) => b.x + b.r)) - Math.min(...all.map((b) => b.x - b.r))
        const height = Math.max(...all.map((b) => b.y + b.r)) - Math.min(...all.map((b) => b.y - b.r))
        const score = Math.max(width / attractionPlot.width, height / attractionPlot.height) + Math.hypot(candidate.x, candidate.y) * .0001
        if (score < bestScore) { best = candidate; bestScore = score }
      }
    }
    bubbles.push(best ?? { id: item.id, x: Math.max(...bubbles.map((b) => b.x + b.r)) + r + 8, y: 0, r })
  }
  if (!bubbles.length) return []
  const left = Math.min(...bubbles.map((b) => b.x - b.r))
  const right = Math.max(...bubbles.map((b) => b.x + b.r))
  const top = Math.min(...bubbles.map((b) => b.y - b.r))
  const bottom = Math.max(...bubbles.map((b) => b.y + b.r))
  const scale = Math.min(1.15, (attractionPlot.width - 16) / (right - left), (attractionPlot.height - 16) / (bottom - top))
  return bubbles.map((bubble) => ({ ...bubble,
    x: (bubble.x - (left + right) / 2) * scale + attractionPlot.width / 2,
    y: (bubble.y - (top + bottom) / 2) * scale + attractionPlot.height / 2,
    r: bubble.r * scale,
  }))
}
