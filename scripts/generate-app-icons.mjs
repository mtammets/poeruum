/* global Image, document */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Both variants use BrandMark paths with a background filling the canvas.
const variants = [
  { source: 'poeruum-app-icon.svg', name: 'poeruum-app-icon', sizes: [180] },
  { source: 'admin-app-icon.svg', name: 'admin-icon', sizes: [180, 192, 512, 1024] },
]
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const variant of variants) {
    const svg = await readFile(`public/images/${variant.source}`, 'utf8')
    for (const size of variant.sizes) {
      const png = await page.evaluate(async ({ svg, size }) => {
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        canvas.getContext('2d').drawImage(image, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      }, { svg, size })
      await writeFile(`public/images/${variant.name}-${size}.png`, Buffer.from(png, 'base64'))
    }
  }
} finally { await browser.close() }
