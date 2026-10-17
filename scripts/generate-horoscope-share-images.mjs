import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { zodiacPaths, zodiacSigns } from '../supabase/functions/_shared/zodiac.mjs'

// Reuse the website's zodiac marks. PNGs are committed so production needs no browser.
const root = new URL('../', import.meta.url)
const output = new URL('public/images/horoscope/', root)
const sans = await readFile(new URL('public/fonts/business-card/NotoSans-Regular.ttf', root), 'base64')
const serif = await readFile(new URL('public/fonts/business-card/NotoSerif-Regular.ttf', root), 'base64')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  for (const sign of zodiacSigns) {
    await page.setContent(`<!doctype html><html lang="et"><head><meta charset="utf-8"><style>
      @font-face { font-family: Sans; src: url(data:font/ttf;base64,${sans}); }
      @font-face { font-family: Serif; src: url(data:font/ttf;base64,${serif}); }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 48px; background: #f3f1e7; color: #173d2b; font-family: Sans, sans-serif; }
      main { height: 534px; border: 1px solid #ccd7c4; border-radius: 32px; padding: 40px 48px; background: #e9ecdf; }
      header { padding-bottom: 26px; border-bottom: 1px solid #c2cebb; font-size: 21px; letter-spacing: 3px; }
      section { display: flex; align-items: center; justify-content: space-between; gap: 24px; height: 308px; }
      h1 { margin: 0 0 18px; font-family: Serif, serif; font-size: 84px; line-height: 1.15; font-weight: 400; letter-spacing: -4px; }
      p { margin: 0; font-size: 28px; color: #536b53; }
      .emblem { display: grid; place-items: center; flex: 0 0 220px; height: 220px; border: 1px solid #b8c6ae; border-radius: 50%; position: relative; }
      .emblem::after { content: ''; position: absolute; inset: 12px; border: 1px solid #ced6c4; border-radius: 50%; }
      svg { width: 128px; height: 128px; fill: none; stroke: #56785a; stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; }
      footer { display: flex; justify-content: space-between; align-items: center; font-size: 19px; color: #536b53; }
      .arrow { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #e4f35b; }
      .arrow svg { width: 24px; height: 24px; stroke: #173d2b; stroke-width: 1.5; }
    </style></head><body><main><header>POERUUMI KAUBAMAJA</header>
      <section><div><h1>${sign.name}</h1><p>Tänane horoskoop</p></div>
        <div class="emblem"><svg viewBox="0 0 32 32"><path d="${zodiacPaths[sign.id]}" /></svg></div></section>
      <footer><span>kaubamaja.poeruum.ee</span><span class="arrow"><svg viewBox="0 0 24 24"><path d="M6 18 18 6M6 6h12v12" /></svg></span></footer>
    </main></body></html>`)
    await page.evaluate('document.fonts.ready')
    await page.screenshot({ path: fileURLToPath(new URL(`${sign.id}.png`, output)) })
  }
} finally {
  await browser.close()
}
console.log(`Generated ${zodiacSigns.length} horoscope sharing images (1200 × 630).`)
