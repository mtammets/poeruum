import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const sampleRate = 16000
const step = .01
const calls = [1, 2].map(number => {
  const src = `/audio/campaigns/musta-rahni-call-${number}.mp3`
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', fileURLToPath(new URL(`public${src}`, root)),
    '-f', 'f32le', '-ac', '1', '-ar', String(sampleRate), 'pipe:1'])
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
  const hop = Math.round(sampleRate * step)
  // A centred 20 ms window follows the call without reacting to each audio cycle.
  const rms = Array.from({ length: Math.ceil(samples.length / hop) }, (_, frame) => {
    const start = Math.max(0, frame * hop - hop)
    const end = Math.min(samples.length, frame * hop + hop)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i] ** 2
    return Math.sqrt(sum / (end - start))
  })
  const peak = Math.max(...rms)
  const floor = peak * .075
  let level = 0
  const levels = rms.map(value => {
    const target = Math.max(0, (value - floor) / (peak - floor)) ** .65
    const response = 1 - Math.exp(-step / (target > level ? .012 : .035))
    level += (target - level) * response
    return Math.round(level * 100)
  })
  levels.push(0)
  return { src, duration: samples.length / sampleRate, step, levels }
})

writeFileSync(new URL('src/themes/black-friday/woodpeckerCalls.json', root), `${JSON.stringify(calls)}\n`)
console.log('Generated beak envelopes for both supplied woodpecker recordings.')
