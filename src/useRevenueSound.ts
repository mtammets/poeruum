import { useCallback, useEffect, useRef, useState } from 'react'

const preferenceKey = 'poeruum:revenue-sound'

export default function useRevenueSound() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === 'on' } catch { return false }
  })
  const [unavailable, setUnavailable] = useState(false)
  const context = useRef<AudioContext | null>(null)
  const lastPlayed = useRef(-Infinity)

  const unlock = useCallback(() => {
    try {
      context.current ??= new AudioContext()
      if (context.current.state === 'suspended') void context.current.resume().catch(() => {})
    } catch { setUnavailable(true) }
  }, [])

  const play = useCallback(() => {
    const audio = context.current
    if (!audio || audio.state !== 'running' || document.visibilityState !== 'visible') return
    if (audio.currentTime - lastPlayed.current < .8) return
    lastPlayed.current = audio.currentTime
    // A soft E–B interval with a faint upper partial, rounded attack and a long decay.
    for (const [index, frequency] of [659.25, 987.77].entries()) {
      const start = audio.currentTime + .015 + index * .13
      for (const [harmonic, volume] of [[1, .075], [2, .009]]) {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency * harmonic
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(volume, start + .018)
        gain.gain.exponentialRampToValueAtTime(.0001, start + .7)
        oscillator.connect(gain)
        gain.connect(audio.destination)
        oscillator.start(start)
        oscillator.stop(start + .72)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // A remembered preference still needs a user gesture after a page reload.
    document.addEventListener('pointerdown', unlock)
    document.addEventListener('keydown', unlock)
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [enabled, unlock])

  useEffect(() => () => { void context.current?.close().catch(() => {}); context.current = null }, [])

  const toggle = () => {
    if (!enabled) unlock()
    else {
      // Closing also discards ringing notes, so re-enabling cannot replay an old sale.
      void context.current?.close().catch(() => {})
      context.current = null
      lastPlayed.current = -Infinity
    }
    setEnabled(!enabled)
    try { localStorage.setItem(preferenceKey, enabled ? 'off' : 'on') } catch { /* Preference is optional. */ }
  }
  return { enabled: enabled && !unavailable, unavailable, toggle, play }
}
