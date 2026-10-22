// Six-second YouTube bumper from the approved landscape film.
// Render the source first: node scripts/render-black-friday-reel.mjs --youtube
// Then: node scripts/render-black-friday-bumper.mjs
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'output/musta-rahni-campaign-pack')
await mkdir(out, { recursive: true })
const output = path.join(out, '10-youtube-bumper-6s-1920x1080.mp4')
const encoder = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', path.join(root, 'output/musta-rahni-youtube/musta-rahni-paevad-youtube-full-hd.mp4'),
  '-t', '6', '-map', '0:v:0', '-map', '0:a:0',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
  '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-af', 'afade=t=out:st=5.8:d=0.2',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-metadata', 'title=MUSTA RÄHNI PÄEVAD – 6 s',
  '-movflags', '+faststart', output,
], { stdio: ['ignore', 'inherit', 'inherit'] })
const [code] = await once(encoder, 'close')
if (code !== 0) throw new Error('Bumper encoding failed: ' + code)
console.log(output)
