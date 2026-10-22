// Reproducible 15-second campaign motion poster: portrait Reel or landscape YouTube.
// node scripts/render-black-friday-reel.mjs [--youtube] [--preview | --audio-only]
// Requires Chromium from Playwright and ffmpeg on PATH. Does not contact the app or its API.
/* global window, document */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const youtube = process.argv.includes('--youtube')
const width = youtube ? 1920 : 1080, height = youtube ? 1080 : 1920
const out = path.join(root, youtube ? 'output/musta-rahni-youtube' : 'output/musta-rahni-reel')
const outputName = youtube ? 'musta-rahni-paevad-youtube-full-hd.mp4' : 'musta-rahni-paevad-reels.mp4'
const previewOnly = process.argv.includes('--preview')
const audioOnly = process.argv.includes('--audio-only')
const duration = 15, fps = 30
await mkdir(out, { recursive: true })
const server = createServer(async (req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = path.resolve(root, '.' + relative)
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
  try {
    const body = await readFile(file)
    const types = { '.html': 'text/html', '.webp': 'image/webp', '.ttf': 'font/ttf' }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
}).listen(0, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch()
let encoder
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', error => { throw error })
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/black-friday-${youtube ? 'youtube' : 'reel'}.html`)
  console.log('Composition:', JSON.stringify(await page.evaluate(() => window.ready)))
  for (const t of [0, 3.9, 7.5, 11, 14.9667, 15]) {
    const data = await page.evaluate(t => {
      window.renderFrame(t)
      return document.querySelector('canvas').toDataURL('image/png').split(',')[1]
    }, t)
    await writeFile(path.join(out, `frame-${t}.png`), Buffer.from(data, 'base64'))
  }
  if (!previewOnly) {
    if (!audioOnly) {
      encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-vf', `scale=${width}:${height}:out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level:v', '4.1', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', path.join(out, 'musta-rahni-paevad-silent.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] })
      const completion = once(encoder, 'close')
      for (let frame = 0; frame < duration * fps; frame++) {
        const data = await page.evaluate(t => {
          window.renderFrame(t)
          return document.querySelector('canvas').toDataURL('image/png').split(',')[1]
        }, frame / fps)
        if (!encoder.stdin.write(Buffer.from(data, 'base64'))) await once(encoder.stdin, 'drain')
        if (frame % 60 === 0) console.log(`Rendered ${frame}/${duration * fps} frames`)
      }
      encoder.stdin.end()
      const [code] = await completion
      if (code !== 0) throw new Error(`ffmpeg exited ${code}`)
      console.log('Silent master rendered.')
    }
    // A quiet original wind/needle-rustle bed beneath the existing CC0 woodpecker call.
    // Two calls match the mandible animation; no music or voiceover is introduced.
    const soundGraph = [
      "[2:a]highpass=f=200,lowpass=f=1900,volume='0.30+0.07*sin(2*PI*t/15)':eval=frame,pan=stereo|c0=c0|c1=0.94*c0[wind]",
      "[3:a]highpass=f=2400,lowpass=f=6500,volume='0.035+0.018*sin(4*PI*t/15+0.6)':eval=frame,pan=stereo|c0=0.75*c0|c1=c0[leaves]",
      '[1:a]aformat=channel_layouts=stereo,asplit=2[c1][c2]',
      '[c1]volume=1.7,adelay=3800|3800[call1]',
      '[c2]volume=1.5,adelay=10700|10700[call2]',
      '[wind][leaves][call1][call2]amix=inputs=4:duration=longest:normalize=0,volume=2,afade=t=in:st=0:d=0.2,afade=t=out:st=14.8:d=0.2,alimiter=limit=0.85:level=0[a]',
    ].join(';')
    const mix = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', path.join(out, 'musta-rahni-paevad-silent.mp4'),
      '-i', path.join(root, 'public/audio/campaigns/musta-rahni-call.mp3'),
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.8:sample_rate=48000:duration=15:seed=4927',
      '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.35:sample_rate=48000:duration=15:seed=1783',
      '-filter_complex', soundGraph, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(duration),
      '-map_metadata', '-1', '-metadata', 'title=MUSTA RÄHNI PÄEVAD',
      '-movflags', '+faststart', path.join(out, outputName),
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    const [mixCode] = await once(mix, 'close')
    if (mixCode !== 0) throw new Error(`Audio mix exited ${mixCode}`)
    console.log(`Final ${youtube ? 'YouTube video' : 'Reel'} ready: 15 s, ${width}×${height}, 30 fps, H.264 + AAC stereo.`)
  }
} finally { encoder?.kill(); await browser.close(); await new Promise(resolve => server.close(resolve)) }
