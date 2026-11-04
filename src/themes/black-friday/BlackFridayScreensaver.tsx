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
import DepartmentStoreArrival, { DeliveryCounter } from './DepartmentStoreArrival'
import { createHatDelivery } from './hatDelivery'
import './blackFridayScreensaver.css'
import './hatFlightGame.css'

const idleDelay = 60_000
const activityEvents = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown', 'click', 'focusin'] as const

export type ScreensaverHandle = { open: () => void }
type WoodpeckerCall = ReturnType<typeof useWoodpeckerCall>

export default function BlackFridayScreensaver({ paused, call, ref }: { paused: boolean; call: WoodpeckerCall; ref?: Ref<ScreensaverHandle> }) {
  const [active, setActive] = useState<'idle' | 'game' | null>(null)
  const [forestAudio] = useState(() => new ForestFlightAudio())
  const awake = useRef<(() => void) | null>(null)
  const open = useRef<(() => void) | null>(null)
  const dismiss = useCallback(() => awake.current?.(), [])
  const complete = useCallback(() => {
    awake.current?.()
    requestAnimationFrame(() => {
      const heading = document.getElementById('store-directory-heading')
      if (!heading) return
      heading.tabIndex = -1
      heading.scrollIntoView({ behavior: 'instant', block: 'start' })
      heading.focus({ preventScroll: true })
    })
  }, [])
  const stopCall = call.stop

  useImperativeHandle(ref, () => ({ open: () => open.current?.() }), [])

  useEffect(() => {
    if (paused) { setActive(null); return }
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
      setActive(null)
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
      setActive(manual ? 'game' : 'idle')
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
      if (showing && isFlightKey(event)) {
        manuallyOpened = true
        setActive('game')
        void forestAudio.start()
        return
      }
      // Deliberate play ends with Close, Escape or falling out. Let pointer
      // events reach the touch controls instead of dismissing the game.
      if (showing && manuallyOpened) return
      // The passive screensaver still wakes on activity, without clicking
      // through to the covered shop.
      if (showing) {
        if (event.type === 'pointerdown' || event.type === 'touchstart') suppressClickUntil = performance.now() + 500
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      wake()
    }
    const visibility = () => { stopCall(); forestAudio.stop(); showing = false; setActive(null); schedule() }
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

  return active && !paused ? <FlightScene onClose={dismiss} onComplete={complete} call={call} audio={forestAudio} interactive={active === 'game'} /> : null
}

function FlightScene({ onClose, onComplete, call, audio, interactive }: { onClose: () => void; onComplete: () => void; call: WoodpeckerCall; audio: ForestFlightAudio; interactive: boolean }) {
  const root = useRef<HTMLDialogElement>(null)
  const journey = useRef(createHatDelivery())
  const clipId = useId()
  const [hint, setHint] = useState(true)
  const dismissHint = useCallback(() => setHint(false), [])

  useEffect(() => {
    if (!interactive) return
    const timer = window.setTimeout(dismissHint, 8_000)
    return () => window.clearTimeout(timer)
  }, [interactive, dismissHint])

  useLayoutEffect(() => {
    const dialog = root.current
    if (!dialog) return
    const overflow = document.body.style.overflow
    dialog.showModal()
    dialog.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      dialog.close()
    }
  }, [])

  const flight = useScreensaverFlight(root, onClose, journey)
  const { caught, score, phase } = useHatFlightGame(root, audio, flight, journey, onComplete)

  return createPortal(<dialog ref={root} className="black-friday-screensaver" aria-label="Rähni lennuvaade" tabIndex={-1}
    data-interactive={interactive || undefined}
    data-level-phase={phase}
    aria-description="Kogu mütse ja vii need kaubamajja. Hoia lendamiseks vasaknoolt või ekraani lennunuppu all. Lahti lastes lind vajub, parem nool vabastab kogutud mütsid. Üles viib kaugemale ja alla lähemale. Lennu lõpus maandub rähn kaubamajas. Loendur näitab selle lennu jooksul püütud mütse. Sulgemisnupp, Escape või ekraanilt alla kukkumine viib tagasi kaubamajja."
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="black-friday-screensaver__scene" aria-hidden="true">
      <BannerForest />
      <DepartmentStoreArrival />
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
    </div>
    {interactive && <>
      <DeliveryCounter total={score} phase={phase} />
      <button type="button" className="black-friday-screensaver__close" aria-label="Sulge mäng" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
      <div className="black-friday-screensaver__hint" data-dismissed={!hint || undefined} aria-hidden={!hint || undefined}>
        <dl className="black-friday-screensaver__hint-keys">
          <div className="black-friday-screensaver__hint-thrust"><dt><kbd>←</kbd></dt><dd>Hoia all</dd></div>
          <div className="black-friday-screensaver__hint-far"><dt><kbd>↑</kbd></dt><dd>Kaugemale</dd></div>
          <div className="black-friday-screensaver__hint-near"><dt><kbd>↓</kbd></dt><dd>Lähemale</dd></div>
          <div className="black-friday-screensaver__hint-release"><dt><kbd>→</kbd></dt><dd>Vabasta mütsid</dd></div>
        </dl>
      </div>
      <div className="black-friday-screensaver__controls" role="group" aria-label="Mängu juhtimine">
        <button type="button" className="black-friday-screensaver__thrust" data-flight-key="ArrowLeft" aria-label="Lenda: hoia all" title="Lenda: hoia all">
          <span aria-hidden="true">←</span><small>Hoia</small>
        </button>
        <div className="black-friday-screensaver__steering">
          <button type="button" data-flight-key="ArrowUp" aria-label="Lenda kaugemale" title="Lenda kaugemale"><span aria-hidden="true">↑</span></button>
          <button type="button" data-flight-key="ArrowDown" aria-label="Lenda lähemale" title="Lenda lähemale"><span aria-hidden="true">↓</span></button>
          <button type="button" data-flight-key="ArrowRight" aria-label="Vabasta mütsid" title="Vabasta mütsid"><span aria-hidden="true">→</span></button>
        </div>
      </div>
    </>}
  </dialog>, document.body)
}
