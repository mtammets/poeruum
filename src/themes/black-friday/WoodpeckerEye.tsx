import { useEffect, useRef } from 'react'
import { birdImage } from './krukHatMotion'

// A tiny overlay in the original photograph's coordinates. The photographed
// iris moves inside a fixed eye rim; a curved membrane briefly crosses it.
export default function WoodpeckerEye({ clipId }: { clipId: string }) {
  const iris = useRef<SVGGElement>(null)
  const lid = useRef<SVGGElement>(null)

  useEffect(() => {
    if (!iris.current || !lid.current) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const timers = new Set<number>()
    const animations = new Set<Animation>()
    let stopped = false
    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); if (!stopped) callback() }, delay)
      timers.add(timer)
    }
    const animate = (element: SVGGElement, frames: Keyframe[], duration: number) => {
      const animation = element.animate(frames, { duration, easing: 'linear' })
      animations.add(animation)
      animation.onfinish = () => animations.delete(animation)
    }
    const blink = () => {
      animate(lid.current!, [
        { transform: 'translateX(-28px)', offset: 0 },
        { transform: 'translateX(17px)', offset: .38, easing: 'ease-out' },
        { transform: 'translateX(17px)', offset: .48, easing: 'ease-in-out' },
        { transform: 'translateX(-28px)', offset: 1 },
      ], 190)
      later(blink, 18_000 + Math.random() * 14_000)
    }
    const glance = () => {
      const x = (Math.random() < .65 ? -1 : 1) * (.7 + Math.random() * .5)
      const y = (Math.random() - .5) * 1.1
      const gaze = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`
      animate(iris.current!, [
        { transform: 'translate(0px,0px)', offset: 0, easing: 'cubic-bezier(.15,.8,.2,1)' },
        { transform: gaze, offset: .12 },
        { transform: gaze, offset: .72, easing: 'ease-in-out' },
        { transform: 'translate(0px,0px)', offset: 1 },
      ], 850 + Math.random() * 350)
      later(glance, 22_000 + Math.random() * 16_000)
    }
    const clear = () => {
      timers.forEach(timer => clearTimeout(timer)); timers.clear()
      animations.forEach(animation => { animation.onfinish = null; animation.cancel() }); animations.clear()
    }
    const sync = () => {
      clear()
      if (preference.matches) return
      later(blink, 12_000 + Math.random() * 8_000)
      later(glance, 8_000 + Math.random() * 6_000)
    }
    preference.addEventListener('change', sync)
    sync()
    return () => { stopped = true; clear(); preference.removeEventListener('change', sync) }
  }, [])

  return <svg className="woodpecker-eye" viewBox="282 442 50 48" width="50" height="48">
    <defs>
      <radialGradient id={`${clipId}-eye-edge`}>
        <stop offset=".76" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity="0" />
      </radialGradient>
      <mask id={`${clipId}-iris-opening`} maskUnits="userSpaceOnUse" x="289" y="449" width="34" height="34">
        <ellipse cx="306" cy="466" rx="14.5" ry="14.5" fill={`url(#${clipId}-eye-edge)`} />
      </mask>
      <radialGradient id={`${clipId}-lid-edge`}>
        <stop offset=".91" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity="0" />
      </radialGradient>
      <mask id={`${clipId}-lid-opening`} maskUnits="userSpaceOnUse" x="289" y="449" width="34" height="34">
        <ellipse cx="306.5" cy="466" rx="14.5" ry="13.8" fill={`url(#${clipId}-lid-edge)`} />
      </mask>
      <linearGradient id={`${clipId}-eye-membrane`} x1="0" y1="0" x2="1" y2=".3">
        <stop stopColor="#73796e" /><stop offset=".75" stopColor="#a7aa9b" /><stop offset="1" stopColor="#d1cfb9" />
      </linearGradient>
    </defs>
    <g mask={`url(#${clipId}-iris-opening)`}>
      <g ref={iris} className="woodpecker-eye__iris"><image href={birdImage} width="1448" height="1086" /></g>
    </g>
    <g mask={`url(#${clipId}-lid-opening)`}>
      <g ref={lid} className="woodpecker-eye__lid" style={{ transform: 'translateX(-28px)' }}>
        <path d="M265 442 H306 Q323 466 306 490 H265 Z" fill={`url(#${clipId}-eye-membrane)`} fillOpacity=".88" />
      </g>
    </g>
  </svg>
}
