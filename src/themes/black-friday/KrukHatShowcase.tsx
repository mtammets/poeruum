import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import KrukKrukSpotlight from './KrukKrukSpotlight'
import type { useKrukPurchase } from './useKrukPurchase'
import { birdImage, capImage, capOutline, getHatOrigin, type HatOrigin } from './krukHatMotion'

type Pose = { x: number; y: number; scale: number; rotation: number }
const restingPose: Pose = { x: 0, y: 0, scale: 1, rotation: -6 }
const mix = (from: number, to: number, progress: number) => from + (to - from) * progress

export default function KrukHatShowcase({ store, purchase, origin, source, trigger, onClose }: {
  store: StoreDirectoryEntry
  purchase: ReturnType<typeof useKrukPurchase>
  origin: HatOrigin
  source: RefObject<SVGSVGElement | null>
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const clipId = useId()
  const root = useRef<HTMLDivElement>(null)
  const flight = useRef<HTMLDivElement>(null)
  const pose = useRef<Pose | null>(null)
  const originalOpacity = useRef(1)
  const [returning, setReturning] = useState(false)

  useEffect(() => {
    const app = document.getElementById('root')
    const wasInert = app?.inert ?? false
    const oldOverflow = document.body.style.overflow
    const returnTo = trigger.current
    if (app) app.inert = true
    document.body.style.overflow = 'hidden'
    const dialog = root.current
    dialog?.querySelector<HTMLButtonElement>('.kruk-hat__return')?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (!dialog || dialog.inert) return
      if (event.key === 'Escape') {
        event.preventDefault()
        dialog.querySelector<HTMLButtonElement>('.kruk-hat__return')?.click()
      }
      if (event.key !== 'Tab') return
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
        .filter(element => element.offsetParent !== null)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (app) app.inert = wasInert
      document.body.style.overflow = oldOverflow
      returnTo?.focus({ preventScroll: true })
    }
  }, [trigger])

  useLayoutEffect(() => {
    const element = flight.current
    if (!element) return
    const product = element.querySelector<HTMLElement>('.kruk-hat__product')!
    const original = element.querySelector<SVGSVGElement>('.kruk-hat__original')!
    // The untransformed stage stays responsive even if the viewport changes mid-flight.
    const stage = element.parentElement!
    const toPose = (target: HatOrigin): Pose => {
      const bounds = stage.getBoundingClientRect()
      return { x: target.x - bounds.left - bounds.width / 2, y: target.y - bounds.top - bounds.height / 2,
        scale: target.width / bounds.width, rotation: target.rotation }
    }
    const from = pose.current ?? toPose(origin)
    const fromOpacity = originalOpacity.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const duration = returning ? 680 : 1150
    const started = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const progress = motion.matches ? 1 : Math.min(1, (now - started) / duration)
      let next: Pose
      let opacity: number
      if (returning) {
        // Follow the live head position all the way home, not a stale click coordinate.
        const liveOrigin = source.current ? getHatOrigin(source.current) : null
        const target = toPose(liveOrigin ?? origin)
        const ease = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
        next = { x: mix(from.x, target.x, ease), y: mix(from.y, target.y, ease) - Math.sin(Math.PI * progress) * 80,
          scale: mix(from.scale, target.scale, ease), rotation: mix(from.rotation, target.rotation, ease) }
        opacity = mix(fromOpacity, 1, Math.max(0, (ease - .55) / .45))
      } else {
        const ease = 1 + 2.2 * (progress - 1) ** 3 + 1.2 * (progress - 1) ** 2
        next = { x: mix(from.x, 0, ease), y: mix(from.y, 0, ease) - Math.sin(Math.PI * progress) * 100,
          scale: mix(from.scale, 1, ease), rotation: mix(from.rotation, -6, ease) - Math.sin(Math.PI * progress) * 24 }
        opacity = 1 - Math.min(1, progress / .35)
      }
      pose.current = next
      originalOpacity.current = opacity
      element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) rotate(${next.rotation}deg) scale(${next.scale})`
      original.style.opacity = String(opacity)
      product.style.opacity = String(1 - opacity)
      if (progress < 1) frame = requestAnimationFrame(draw)
      else if (returning) onClose()
      else { pose.current = restingPose; root.current?.setAttribute('data-arrived', '') }
    }
    // Draw at time zero before paint so the hat never flashes in its final position.
    if (!returning) draw(started)
    else frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [origin, returning, onClose, source])

  return createPortal(<div ref={root} className="kruk-hat" role="dialog" aria-modal="true"
    aria-label="Krük-Krüki nokkmüts" data-returning={returning || undefined}
    inert={Boolean(purchase.purchase)} aria-hidden={purchase.purchase ? true : undefined}>
    <div className="kruk-hat__backdrop" onClick={() => { if (!purchase.busy) setReturning(true) }} aria-hidden="true" />
    <button className="kruk-hat__return" type="button" disabled={purchase.busy || returning}
      onClick={() => setReturning(true)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 6 6v3" /></svg> Tagasi pähe</button>
    <div className="kruk-hat__composition">
      <div className="kruk-hat__stage">
        <div ref={flight} className="kruk-hat__flight">
          <div className="kruk-hat__product"><img src={capImage} alt={purchase.product?.name ?? 'Krük-Krüki nokkmüts'} /></div>
          <svg className="kruk-hat__original" viewBox="655 170 144 108" aria-hidden="true">
            <defs><clipPath id={clipId}><path d={capOutline} /></clipPath></defs>
            <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId})`} />
          </svg>
        </div>
      </div>
      <div className="kruk-hat__details" inert={returning}>
        <KrukKrukSpotlight store={store} purchase={purchase} foreground />
      </div>
    </div>
  </div>, document.body)
}
