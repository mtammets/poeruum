import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Original cartoon-chase score: swung clarinet hook, plucked strings, walking
// bass and comic bassoon answers. Rendered once, never in the game loop.
const bpm = 156, beat = 60 / bpm, duration = 128 * beat
const output = fileURLToPath(new URL('../output/', import.meta.url))
mkdirSync(output, { recursive: true })
const instruments = [
  { program: 32, gain: -5, pan: 0, percussion: false }, // Upright bass
  { program: 45, gain: -9, pan: -22, percussion: false }, // Pizzicato strings
  { program: 71, gain: -10, pan: -8, percussion: false }, // Clarinet
  { program: 13, gain: -13, pan: 27, percussion: false }, // Xylophone replies
  { program: 70, gain: -7, pan: 14, percussion: false }, // Bassoon
  { program: 0, gain: -12, pan: 0, percussion: true }, // Dry acoustic kit
  { program: 59, gain: -15, pan: 20, percussion: false }, // Muted trumpet punctuation
]
const notes = []
let seed = 24042
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
function note(track, pitch, at, length = .3, velocity = 80) {
  // Light swing and velocity variation keep the groove from becoming a metronome.
  const swing = Math.abs(at % 1 - .5) < .001 ? .09 : 0
  notes.push({ track, pitch, start: (at + swing) * beat, duration: length * beat,
    velocity: Math.max(1, Math.min(127, Math.round(velocity + (random() - .5) * 7))) })
}
const harmony = {
  a: { chord: [57, 60, 64, 67], bass: [45, 52, 55, 56] },
  d: { chord: [57, 60, 62, 65], bass: [38, 45, 48, 50] },
  e: { chord: [56, 59, 62, 64], bass: [40, 47, 50, 44] },
  f: { chord: [57, 60, 64, 65], bass: [41, 48, 52, 53] },
  c: { chord: [55, 60, 64, 67], bass: [36, 43, 47, 48] },
  b: { chord: [56, 59, 62, 65], bass: [47, 53, 56, 44] },
}
const progression = 'a a d e a f b e c c f e d d b e a a d d f f b e a a d e a f b e'.split(' ')

// Entries are [beat within bar, pitch, note length]. Leave room for comic replies.
const phrases = [
  [[0, 76, .3], [.5, 76, .2], [1.5, 79, .25], [2, 81, .4], [3, 79, .25], [3.5, 76, .22]],
  [[0, 72, .65], [1.5, 76, .25], [2, 74, .3]],
  [[0, 77, .3], [.5, 77, .2], [1.5, 76, .25], [2, 74, .4], [3, 72, .25], [3.5, 69, .22]],
  [[0, 71, .25], [.5, 74, .25], [1, 76, .6], [2.5, 75, .22], [3, 74, .22], [3.5, 71, .22]],
  [[0, 76, .3], [.5, 76, .2], [1.5, 79, .25], [2, 81, .4], [3, 84, .35]],
  [[0, 81, .4], [1, 79, .25], [1.5, 76, .2], [2, 72, .4]],
  [[0, 77, .25], [.5, 74, .25], [1, 71, .25], [1.5, 68, .25], [2.5, 71, .25], [3, 74, .35]],
  [[0, 76, .3], [1, 71, .3], [2, 68, .3]],
  [[0, 79, .3], [1, 76, .3], [1.5, 74, .2], [2.5, 72, .35]],
  [[.5, 76, .25], [1, 79, .3], [2, 84, .4], [3, 83, .25], [3.5, 79, .2]],
  [[0, 81, .3], [.5, 79, .25], [1.5, 77, .3], [2, 76, .25], [3, 72, .35]],
  [[0, 71, .4], [1.5, 68, .25], [2, 71, .25], [2.5, 74, .2], [3, 76, .4]],
  [[0, 77, .3], [.5, 76, .2], [1.5, 74, .3], [2, 69, .4]],
  [[.5, 69, .2], [1, 72, .25], [1.5, 74, .25], [2, 77, .5], [3.5, 76, .2]],
  [[0, 77, .2], [.5, 74, .2], [1, 71, .2], [1.5, 68, .2], [2.5, 65, .3]],
  [[0, 64, .4], [1, 68, .25], [1.5, 71, .25], [2, 74, .3]],
]

for (let bar = 0; bar < 32; bar++) {
  const start = bar * 4, h = harmony[progression[bar]]
  const suspense = bar >= 16 && bar < 24
  const final = bar >= 24
  const pause = bar === 7 || bar === 15 || bar === 23 || bar === 31
  const cutoff = pause ? 2.6 : 4

  // Walking bass + clipped, syncopated chord chops make the forward motion.
  h.bass.forEach((pitch, index) => {
    if (index < cutoff) note(0, pitch, start + index, .58, index % 2 ? 88 : 101)
  })
  for (const offset of [.5, 1.5, 2.5, 3.5]) {
    if (offset >= cutoff) continue
    h.chord.slice(0, 3).forEach(pitch => note(1, pitch, start + offset, .19, suspense ? 69 : 82))
  }
  for (const offset of [0, 1.5, 2]) if (offset < cutoff) note(5, 36, start + offset, .13, offset === 0 ? 93 : 72)
  for (const offset of [1, 3]) if (offset < cutoff) note(5, final ? 38 : 37, start + offset, .1, final ? 76 : 86)
  for (let eighth = 0; eighth < 8; eighth++) {
    if (eighth / 2 < cutoff) note(5, 42, start + eighth / 2, .08, eighth % 2 ? 50 : 35)
  }

  if (suspense) {
    // A tiptoe break rises through the registers, then the full hook returns.
    const climb = Math.floor((bar - 16) / 2) * 2
    const pattern = [0, 1, 2, 1, 0, 1, 3, 2]
    pattern.forEach((index, step) => {
      const pitch = h.chord[index] + (bar >= 20 ? 12 : 0)
      note(step % 2 ? 3 : 4, pitch, start + step * .5, .2, 72 + climb * 2)
    })
    if (bar >= 20) h.chord.slice(1, 3).forEach(pitch => note(6, pitch, start + 2.5, .24, 72))
  } else {
    const phrase = phrases[bar < 16 ? bar : bar - 24]
    phrase.forEach(([offset, pitch, length], index) => {
      note(2, pitch, start + offset, length, index === 0 ? 94 : 85)
      if (final && index % 2 === 0) note(3, pitch, start + offset, .16, 64)
    })
    if ([1, 5, 8, 12, 25, 29].includes(bar)) {
      ;[h.chord[2] - 12, h.chord[1] - 12, h.chord[0] - 12].forEach((pitch, index) =>
        note(4, pitch, start + 2.75 + index * .375, .21, 91 - index * 5))
    }
  }
  if (pause) {
    // Little pratfall/fill, then an immediate clean pickup into the next phrase.
    ;[76, 74, 71, 68].forEach((pitch, index) => note(3, pitch, start + 3 + index * .25, .14, 80 + index * 4))
    note(5, 43, start + 3, .12, 73)
    note(5, 45, start + 3.5, .12, 79)
    note(5, 38, start + 3.75, .1, 74)
  } else if (bar % 4 === 2) {
    note(5, 76, start + 3.5, .12, 68)
  }
}

const score = `${output}/flight-music-score.json`, render = `${output}/flight-music-render.caf`
writeFileSync(score, JSON.stringify({ duration, instruments, notes }))
execFileSync('swift', [fileURLToPath(new URL('./render-flight-score.swift', import.meta.url)), score, render], { stdio: 'inherit' })
const destination = fileURLToPath(new URL('../public/audio/campaigns/musta-rahni-flight-music.mp3', import.meta.url))
const frames = Math.round(duration * 32000)
// Normalize a settled middle cycle, retaining the previous phrase's room tail.
execFileSync('ffmpeg', ['-v', 'error', '-i', render,
  '-af', `atrim=start_sample=${frames}:end_sample=${frames * 2},asetpts=PTS-STARTPTS,highpass=f=55,lowpass=f=12500,loudnorm=I=-17:TP=-2:LRA=7`,
  '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '96k', '-write_xing', '1',
  '-metadata', 'title=Müts taga, rähn ees', '-metadata', 'comment=Original cartoon-chase composition, 156 BPM; rendered with macOS General MIDI instruments.', '-y', destination])
writeFileSync(`${output}/flight-music-render.json`, JSON.stringify({ bpm, duration: frames / 32000, sampleRate: 32000,
  channels: 2, bytes: statSync(destination).size, notes: notes.length, instruments }, null, 2))
console.log(`Created ${(frames / 32000).toFixed(2)}s original chase loop: ${destination}`)
