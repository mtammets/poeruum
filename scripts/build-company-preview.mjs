import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('previews/company-homepage')
const out = path.resolve('dist-company-preview')
await build({ configFile: false, root, envDir: false, plugins: [react()], publicDir: false,
  build: { outDir: out, emptyOutDir: true, sourcemap: false },
})
for (const asset of [
  'fonts/anton/Anton-Regular.ttf', 'fonts/business-card/NotoSans-Regular.ttf',
  'fonts/business-card/NotoSans-Bold.ttf', 'fonts/business-card/NotoSansMono-Regular.ttf',
  'images/campaigns/musta-rahni-forest-v1.webp', 'images/campaigns/musta-rahni-cutout-v2.webp',
  'images/campaigns/kruk-cap-cutout-v1.webp', 'images/campaigns/kruk-cap-forest-model-v1.webp',
  'images/campaigns/musta-rahni-paevad.webp', 'images/kruk-kruk/mark-sketches.jpg',
  'audio/campaigns/musta-rahni-call-1.mp3', 'audio/campaigns/musta-rahni-call-2.mp3',
]) {
  await mkdir(path.dirname(path.join(out, asset)), { recursive: true })
  await cp(path.join('public', asset), path.join(out, asset))
}
