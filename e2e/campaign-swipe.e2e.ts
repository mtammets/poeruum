import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('campaign swipe moves the whole photo beneath stationary storefront controls', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { loadStoreMovie } = await import('/src/campaigns/storeMovie.ts')
    const solid = (color: string) => {
      const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 804
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 390, 804)
      return canvas.toDataURL('image/png')
    }
    const movie = await loadStoreMovie({
      snapshot: {
        id: 'swipe-regression', capturedAt: '2026-10-06T10:00:00.000Z',
        store: { id: 'swipe-store', name: 'Swipetest', slug: 'swipetest', settings: { storeLogo: 'asset:2', storeAccent: '#e5f25a' } },
        assets: { 'asset:0': solid('#ee2222'), 'asset:1': solid('#2244ee'), 'asset:2': solid('#22ee44') },
        products: [
          { id: 'red', name: 'Punane', alt: 'Punane', image: 'asset:0', gallery: ['asset:0'], price: 10, stock: 2 },
          { id: 'blue', name: 'Sinine', alt: 'Sinine', image: 'asset:1', gallery: ['asset:1'], price: 20, stock: 2 },
        ],
      },
      actions: [{ type: 'product', productId: 'red', duration: 2 }, { type: 'swipe', productId: 'blue', duration: 2 }],
    }, new AbortController().signal)
    try {
      const copy = (canvas: HTMLCanvasElement) => new Uint8ClampedArray(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length
      const still = copy(await movie.frameAt(0))
      const startDifference = difference(still, copy(await movie.frameAt(2)))
      const end = copy(await movie.frameAt(3))
      const endDifference = difference(end, copy(movie.stillAt(1)))
      const frames = []
      for (const time of [0, 2.2, 2.4, 2.6, 3]) {
        const canvas = await movie.frameAt(time), ctx = canvas.getContext('2d')!
        const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
        // Both samples are outside the controls, either side of the old 230px seam.
        frames.push({ time, topLeft: pixel(30, 210), lowerLeft: pixel(30, 300), topRight: pixel(750, 210), lowerRight: pixel(750, 300),
          logo: pixel(75, 125), image: canvas.toDataURL('image/png') })
      }
      // The same timestamp must be identical when consumed by the MP4 iterator.
      const exported = await movie.frames([2.4]).next()
      return { frames, startDifference, endDifference, exported: exported.value?.canvas.toDataURL('image/png') }
    } finally { movie.dispose() }
  })
  const red = (rgb: number[]) => rgb[0] - rgb[2]
  const blue = (rgb: number[]) => rgb[2] - rgb[0]
  for (const frame of result.frames.slice(1, 4)) {
    expect(red(frame.topLeft)).toBeGreaterThan(50)
    expect(red(frame.lowerLeft)).toBeGreaterThan(50)
    expect(blue(frame.topRight)).toBeGreaterThan(50)
    expect(blue(frame.lowerRight)).toBeGreaterThan(50)
    expect(frame.logo).toEqual(result.frames[0].logo)
    expect(frame.logo[1] - frame.logo[0]).toBeGreaterThan(80)
  }
  expect(blue(result.frames.at(-1)!.topLeft)).toBeGreaterThan(50)
  // Separating the photo and controls must preserve fonts, placement and colors.
  expect(result.startDifference).toBeLessThan(.1)
  expect(result.endDifference).toBeLessThan(.1)
  expect(result.exported).toBe(result.frames[2].image)
  for (const frame of result.frames) await writeFile(testInfo.outputPath(`swipe-${frame.time}.png`), Buffer.from(frame.image.split(',')[1], 'base64'))
})
