import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import BannerForest from './BannerForest'
import { birdImage } from './krukHatMotion'
import useScreensaverFlight, { isFlightKey } from './useScreensaverFlight'
import type useWoodpeckerCall from './useWoodpeckerCall'
import ForestFlightAudio from './forestFlightAudio'
import useHatFlightGame from './useHatFlightGame'
import WoodpeckerClaws, { WoodpeckerClawDefs, WoodpeckerFootFeathers } from './WoodpeckerClaws'
import WoodpeckerWings, { wingCutouts } from './WoodpeckerWings'
import WoodpeckerHead, { headCutout } from './WoodpeckerHead'
import './blackFridayScreensaver.css'
import './hatFlightGame.css'

const idleDelay = 60_000
const activityEvents = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown', 'click', 'focusin'] as const

export type ScreensaverHandle = { open: () => void }
type WoodpeckerCall = ReturnType<typeof useWoodpeckerCall>

export default function BlackFridayScreensaver({ paused, call, ref }: { paused: boolean; call: WoodpeckerCall; ref?: Ref<ScreensaverHandle> }) {
  const [active, setActive] = useState(false)
  const [forestAudio] = useState(() => new ForestFlightAudio())
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
      forestAudio.stop()
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
      if (manual) void forestAudio.start()
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
      if (showing && isFlightKey(event)) { void forestAudio.start(); return }
      if (showing) {
        if (event.type === 'pointerdown' || event.type === 'touchstart') suppressClickUntil = performance.now() + 500
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      wake()
    }
    const visibility = () => { stopCall(); forestAudio.stop(); showing = false; setActive(false); schedule() }
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
      forestAudio.stop()
      activityEvents.forEach(name => window.removeEventListener(name, activity, true))
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [paused, stopCall, forestAudio])

  return active && !paused ? <FlightScene onClose={dismiss} call={call} audio={forestAudio} /> : null
}

function FlightScene({ onClose, call, audio }: { onClose: () => void; call: WoodpeckerCall; audio: ForestFlightAudio }) {
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

  const flight = useScreensaverFlight(root, onClose)
  const caught = useHatFlightGame(root, audio, flight)

  return createPortal(<dialog ref={root} className="black-friday-screensaver" aria-label="Rähni lennuvaade"
    aria-description="Juhtimist alustades hoia lendamiseks vasaknool all. Lahti lastes lind vajub, parem nool vabastab kogutud mütsid. Üles viib kaugemale ja alla lähemale. Ekraanilt alla kukkumine või Escape viib tagasi kaubamajja."
    onCancel={event => { event.preventDefault(); onClose() }}>
    <button type="button" className="black-friday-screensaver__scene" aria-label="Tagasi kaubamajja" onClick={onClose}>
      <BannerForest />
      <span className="hat-flight__hats" aria-hidden="true" />
      <span className="black-friday-screensaver__flight" aria-hidden="true">
        <span className="black-friday-screensaver__bird">
          <WoodpeckerWings clipId={clipId} />
          <WoodpeckerHead clipId={clipId} call={call} />
          <svg className="black-friday-screensaver__body" viewBox="0 0 1448 1086" width="1448" height="1086">
            <defs>
              <clipPath id={`${clipId}-body`}><path d={`M0 0 H1448 V1086 H0 Z ${headCutout} ${wingCutouts}`} clipRule="evenodd" /></clipPath>
            </defs>
            <WoodpeckerClawDefs clipId={clipId} />
            <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-body)`} mask={`url(#${clipId}-without-foot)`} />
            <WoodpeckerFootFeathers clipId={clipId} />
          </svg>
          <svg className="black-friday-screensaver__claw-layer" viewBox="775 830 210 240" width="210" height="240">
            <WoodpeckerClaws clipId={clipId} caught={caught} />
          </svg>
        </span>
      </span>
    </button>
  </dialog>, document.body)
}
