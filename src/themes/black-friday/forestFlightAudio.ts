import recordings from './woodpeckerCalls.json'

const musicUrl = '/audio/campaigns/musta-rahni-flight-music.mp3?v=chase-1'
const musicLevel = .42

// Distant, intermittent air above the canopy. Calls are the owner's recordings.
export default class ForestFlightAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private buffers: (AudioBuffer | null)[] = []
  private voice: AudioBufferSourceNode | null = null
  private music: HTMLAudioElement | null = null
  private musicGain: GainNode | null = null
  private musicSource: MediaElementAudioSourceNode | null = null
  ready: Promise<void> = Promise.resolve()

  start() {
    if (this.context) {
      if (this.music?.paused && !this.music.error) void this.music.play().catch(() => undefined)
      return this.context.resume().catch(() => undefined)
    }
    try {
      const context = new AudioContext()
      this.context = context
      this.master = context.createGain()
      this.master.gain.value = .8
      this.master.connect(context.destination)
      const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate)
      for (let channel = 0; channel < 2; channel++) {
        const values = buffer.getChannelData(channel)
        let softened = 0
        for (let i = 0; i < values.length; i++) {
          softened += .18 * (Math.random() * 2 - 1 - softened)
          // Several very soft swells, fading almost to silence between them.
          // Whole cycles also fade the noise to zero at the loop boundary.
          const phase = i / (values.length - 1)
          const swell = Math.sin(Math.PI * phase) ** 2
            * (.12 + .88 * (.5 + .5 * Math.sin(phase * Math.PI * 4 + channel * .6)) ** 2)
          values[i] = softened * swell
        }
      }
      const air = context.createBufferSource(), highpass = context.createBiquadFilter()
      const lowpass = context.createBiquadFilter(), volume = context.createGain()
      air.buffer = buffer; air.loop = true
      // Remove road-like low rumble and the bright, continuous waterfall hiss.
      highpass.type = 'highpass'; highpass.frequency.value = 420; highpass.Q.value = .5
      lowpass.type = 'lowpass'; lowpass.frequency.value = 1900; lowpass.Q.value = .5
      volume.gain.value = .055
      air.connect(highpass).connect(lowpass).connect(volume).connect(this.master)
      const breeze = context.createOscillator(), depth = context.createGain()
      breeze.frequency.value = .073; depth.gain.value = .015
      breeze.connect(depth).connect(volume.gain)
      air.start(); breeze.start()
      // Resume synchronously inside the bird/button gesture, including on phones.
      const resume = context.resume().catch(() => undefined)
      // Stream a pre-rendered loop; no music synthesis or large decoded music
      // buffer is added to the animation loop or the page's initial download.
      const music = new Audio(musicUrl)
      music.loop = true; music.preload = 'auto'
      const musicGain = context.createGain()
      musicGain.gain.value = 0
      const musicSource = context.createMediaElementSource(music)
      musicSource.connect(musicGain).connect(this.master)
      this.music = music; this.musicGain = musicGain; this.musicSource = musicSource
      music.addEventListener('playing', () => {
        if (this.context === context && this.music === music) musicGain.gain.setTargetAtTime(musicLevel, context.currentTime, .65)
      }, { once: true })
      void music.play().catch(() => undefined)
      this.ready = Promise.all(recordings.map(async recording => {
        try {
          const response = await fetch(recording.src)
          if (!response.ok) return null
          return await context.decodeAudioData(await response.arrayBuffer())
        } catch { return null }
      })).then(buffers => { if (this.context === context) this.buffers = buffers })
      return resume
    } catch { return Promise.resolve() }
  }

  catchHat(index: number) {
    const context = this.context, buffer = this.buffers[index % recordings.length]
    if (!context || !buffer || !this.master || context.state !== 'running') return
    this.voice?.stop()
    const source = context.createBufferSource(), gain = context.createGain()
    source.buffer = buffer; gain.gain.value = .9
    source.connect(gain).connect(this.master)
    source.start(); this.voice = source
    if (this.musicGain) {
      const volume = this.musicGain.gain, now = context.currentTime
      volume.cancelScheduledValues(now)
      volume.setTargetAtTime(.16, now, .045)
      volume.setTargetAtTime(musicLevel, now + buffer.duration + .12, .35)
    }
    source.onended = () => { if (this.voice === source) this.voice = null; source.disconnect(); gain.disconnect() }
  }

  stop() {
    const context = this.context
    const music = this.music
    this.music = null
    if (music) { music.pause(); music.removeAttribute('src'); music.load() }
    this.musicSource?.disconnect(); this.musicGain?.disconnect()
    this.musicSource = null; this.musicGain = null
    this.context = null; this.master = null; this.voice = null; this.buffers = []
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }
}
