/* global Image, document */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Use the existing BrandMark paths, with the green background filling the canvas.
const svg = await readFile('public/images/poeruum-app-icon.svg', 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [size, filename] of [[180, 'poeruum-app-icon-180.png'], [192, 'admin-icon-192.png'], [512, 'admin-icon-512.png']]) {
    const png = await page.evaluate(async ({ svg, size }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svg, size })
    await writeFile(`public/images/${filename}`, Buffer.from(png, 'base64'))
  }
} finally { await browser.close() }
