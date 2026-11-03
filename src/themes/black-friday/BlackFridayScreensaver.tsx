import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import BannerForest from './BannerForest'
import { birdImage } from './krukHatMotion'
import useScreensaverFlight, { isFlightKey } from './useScreensaverFlight'
import type useWoodpeckerCall from './useWoodpeckerCall'
import WoodpeckerBeak, { lowerBeak } from './WoodpeckerBeak'
import './blackFridayScreensaver.css'

const idleDelay = 60_000
const activityEvents = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown', 'click', 'focusin'] as const

export type ScreensaverHandle = { open: () => void }
type WoodpeckerCall = ReturnType<typeof useWoodpeckerCall>

export default function BlackFridayScreensaver({ paused, call, ref }: { paused: boolean; call: WoodpeckerCall; ref?: Ref<ScreensaverHandle> }) {
  const [active, setActive] = useState(false)
  const awake = useRef<(() => void) | null>(null)
  const open = useRef<(() => void) | null>(null)
  const dismiss = useCallback(() => awake.current?.(), [])
  const stopCall = call.stop

  useImperativeHandle(ref, () => ({ open: () => open.current?.() }), [])

  useEffect(() => {
    if (paused) { setActive(false); return }
    let timer: number | undefined
    let showing = false
    let manuallyOpened = false
    let suppressClickUntil = 0
    const clear = () => window.clearTimeout(timer)
    const schedule = () => {
      clear()
      if (!document.hidden) timer = window.setTimeout(() => start(), idleDelay)
    }
    const wake = () => {
      if (showing) stopCall()
      showing = false
      manuallyOpened = false
      setActive(false)
      schedule()
    }
    const start = (manual = false) => {
      if (document.hidden || showing) return
      // Other directory dialogs can be opened outside this banner.
      const hasDialog = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')]
        .some(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'))
      if (hasDialog) { schedule(); return }
      clear()
      manuallyOpened = manual
      showing = true
      setActive(true)
    }
    const activity = (event: Event) => {
      if (event.type === 'click' && performance.now() < suppressClickUntil) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      // Opening/closing a modal restores focus and can adjust scroll, including
      // React's development effect replay. Only user input should wake it.
      if (showing && (event.type === 'focusin' || event.type === 'scroll')) return
      // A deliberately opened flight should survive normal pointer drift.
      if (showing && manuallyOpened && event.type === 'pointermove') return
      // The flight controller consumes arrows; all other activity still wakes
      // the directory, with the first click protected from buying anything.
      if (showing && isFlightKey(event)) return
      if (showing) {
        if (event.type === 'pointerdown' || event.type === 'touchstart') suppressClickUntil = performance.now() + 500
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      wake()
    }
    const visibility = () => { showing = false; setActive(false); schedule() }
    awake.current = wake
    open.current = () => start(true)
    activityEvents.forEach(name => window.addEventListener(name, activity, { capture: true, passive: false }))
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      clear()
      awake.current = null
      open.current = null
      stopCall()
      activityEvents.forEach(name => window.removeEventListener(name, activity, true))
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [paused, stopCall])

  return active && !paused ? <FlightScene onClose={dismiss} call={call} /> : null
}

function FlightScene({ onClose, call }: { onClose: () => void; call: WoodpeckerCall }) {
  const root = useRef<HTMLDialogElement>(null)
  const clipId = useId()

  useLayoutEffect(() => {
    const dialog = root.current
    if (!dialog) return
    const overflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      dialog.close()
    }
  }, [])

  useScreensaverFlight(root)

  return createPortal(<dialog ref={root} className="black-friday-screensaver" aria-label="Rähni lennuvaade"
    aria-description="Juhi nooleklahvidega: vasak lisab hoogu, parem aeglustab, üles viib kaugemale ja alla lähemale. Escape viib tagasi kaubamajja."
    onCancel={event => { event.preventDefault(); onClose() }}>
    <button type="button" className="black-friday-screensaver__scene" aria-label="Tagasi kaubamajja" onClick={onClose}>
      <BannerForest />
      <span className="black-friday-screensaver__flight" aria-hidden="true">
        <svg className="black-friday-screensaver__bird" viewBox="0 0 1448 1086" width="1448" height="1086">
          <defs>
            <clipPath id={`${clipId}-body`}><path d={`M0 0 H1448 V1086 H0 Z ${lowerBeak}`} clipRule="evenodd" /></clipPath>
            <clipPath id={`${clipId}-beak`}><path d={lowerBeak} /></clipPath>
          </defs>
          <image href={birdImage} width="1448" height="1086" clipPath={call.calling ? `url(#${clipId}-body)` : undefined} />
          <WoodpeckerBeak clipId={clipId} {...call} />
        </svg>
      </span>
    </button>
  </dialog>, document.body)
}
