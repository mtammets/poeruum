import { useCallback, useEffect, useRef, useState } from 'react'
import recordings from './woodpeckerCalls.json'
import { publicAssetUrl } from '../../lib/publicAssetUrl'

const calls = recordings.map(call => ({ ...call, src: publicAssetUrl(call.src) }))

export const woodpeckerCalls = calls

export function beakOpening(call: typeof calls[number], time: number) {
  if (!Number.isFinite(time) || time <= 0 || time >= call.duration) return 0
  const frame = time / call.step
  const index = Math.floor(frame)
  const from = call.levels[index] ?? 0
  const to = call.levels[index + 1] ?? 0
  return (from + (to - from) * (frame - index)) / 100
}

export default function useWoodpeckerCall() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const beakRef = useRef<SVGGElement>(null)
  const mouthRef = useRef<SVGPathElement>(null)
  const frame = useRef(0)
  const pending = useRef(false)
  const attempt = useRef(0)
  const selected = useRef(0)
  const next = useRef(0)
  const [calling, setCalling] = useState(false)

  const draw = useCallback((opening: number) => {
    const angle = -16 * opening
    beakRef.current?.setAttribute('transform', `rotate(${angle.toFixed(2)} 265 490)`)
    // Only the hinge is a dark mouth interior; the gap between the tips is air.
    const radians = angle * Math.PI / 180
    const x = 265 - 57 * Math.cos(radians) + 6 * Math.sin(radians)
    const y = 490 - 57 * Math.sin(radians) - 6 * Math.cos(radians)
    mouthRef.current?.setAttribute('d', opening > .001 ? `M208 484 L265 490 L${x.toFixed(2)} ${y.toFixed(2)} Z` : '')
  }, [])

  const stopMotion = useCallback(() => {
    cancelAnimationFrame(frame.current)
    draw(0)
  }, [draw])

  const finish = useCallback(() => {
    pending.current = false
    attempt.current++
    stopMotion()
    setCalling(false)
  }, [stopMotion])

  useEffect(() => {
    const sound = audioRef.current
    if (!sound) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const tick = () => {
      if (sound.paused || sound.ended || reducedMotion.matches) { stopMotion(); return }
      draw(beakOpening(calls[selected.current], sound.currentTime))
      frame.current = requestAnimationFrame(tick)
    }
    const animate = () => { stopMotion(); tick() }
    const playing = () => { setCalling(true); animate() }
    const visibility = () => {
      if (document.hidden) { sound.pause(); finish() }
    }
    sound.addEventListener('playing', playing)
    sound.addEventListener('pause', finish)
    sound.addEventListener('ended', finish)
    sound.addEventListener('error', finish)
    sound.addEventListener('waiting', stopMotion)
    sound.addEventListener('seeking', stopMotion)
    sound.addEventListener('seeked', animate)
    reducedMotion.addEventListener('change', animate)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      sound.removeEventListener('playing', playing)
      sound.removeEventListener('pause', finish)
      sound.removeEventListener('ended', finish)
      sound.removeEventListener('error', finish)
      sound.removeEventListener('waiting', stopMotion)
      sound.removeEventListener('seeking', stopMotion)
      sound.removeEventListener('seeked', animate)
      reducedMotion.removeEventListener('change', animate)
      document.removeEventListener('visibilitychange', visibility)
      attempt.current++
      pending.current = false
      sound.pause()
      stopMotion()
    }
  }, [draw, finish, stopMotion])

  const play = () => {
    const sound = audioRef.current
    if (!sound || pending.current || document.hidden) return
    pending.current = true
    selected.current = next.current
    const id = ++attempt.current
    const src = calls[selected.current].src
    if (sound.getAttribute('src') !== src || sound.error) {
      sound.src = src
      sound.load()
    }
    sound.currentTime = 0
    sound.volume = .75
    // Keep play() inside the click/keyboard gesture, including on mobile Safari.
    void sound.play().then(() => {
      if (attempt.current === id) next.current = (selected.current + 1) % calls.length
    }).catch(() => { if (attempt.current === id) finish() })
  }

  return { audioRef, beakRef, mouthRef, calling, play }
}
