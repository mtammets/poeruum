import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import KrukKrukSpotlight from './KrukKrukSpotlight'
import KrukCheckout from './KrukCheckout'
import { useKrukPurchase } from './useKrukPurchase'
import KrukHatShowcase from './KrukHatShowcase'
import BannerForest from './BannerForest'
import { bareheadedImage, birdImage, capImage, capOutline, getHatOrigin, headPatch, type HatOrigin } from './krukHatMotion'

// The lower mandible in the original image's 1448 × 1086 coordinate space.
const lowerBeak = 'M 39 468 L 265 488 L 272 506 L 247 520 L 209 519 L 147 506 L 83 487 Z'
const cryLetters = [...'KRÜK-KRÜK']
const cryDrops = [[1.1, -2.5], [3.6, -.5], [1.8, .7], [4.8, -2.8], [2.7, -3.2], [.8, 1.1]]

export default function BlackFridayBanner({ store }: { store?: StoreDirectoryEntry }) {
  const purchase = useKrukPurchase(store)
  const clipId = useId()
  const banner = useRef<HTMLElement>(null)
  const bird = useRef<SVGSVGElement>(null)
  const hatButton = useRef<HTMLButtonElement>(null)
  const callAudio = useRef<HTMLAudioElement>(null)
  const callPending = useRef(false)
  const [calling, setCalling] = useState(false)
  const [hatOrigin, setHatOrigin] = useState<HatOrigin | null>(null)
  const [hatReady, setHatReady] = useState(false)
  const closeHat = useCallback(() => setHatOrigin(null), [])

  useEffect(() => {
    if (!purchase.product) return
    let cancelled = false
    const images = [capImage, bareheadedImage].map(src => { const image = new Image(); image.src = src; return image.decode() })
    void Promise.all(images).then(() => { if (!cancelled) setHatReady(true) }).catch(() => { /* The regular buy button remains available. */ })
    return () => { cancelled = true }
  }, [purchase.product])

  const finishCall = () => {
    callPending.current = false
    setCalling(false)
  }

  const startCall = () => {
    const sound = callAudio.current
    if (!sound || callPending.current) return
    callPending.current = true
    sound.currentTime = 0
    sound.volume = .75
    // Start inside the user gesture so mobile browsers can play the sound.
    void sound.play().catch(finishCall)
  }

  useEffect(() => {
    const element = banner.current
    const sound = callAudio.current
    if (!element || !sound) return
    const motion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    let frame = 0
    const reset = () => {
      cancelAnimationFrame(frame)
      element.style.removeProperty('--pointer-x')
      element.style.removeProperty('--pointer-y')
      element.style.removeProperty('--pointer-bank')
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const bounds = element.getBoundingClientRect()
      const x = ((event.clientX - bounds.left) / bounds.width - .5) * 1.2
      const y = ((event.clientY - bounds.top) / bounds.height - .5) * .8
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--pointer-x', `${x}cqw`)
        element.style.setProperty('--pointer-y', `${y}cqw`)
        element.style.setProperty('--pointer-bank', `${x * 2}deg`)
      })
    }
    const sync = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', reset)
      reset()
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setCalling(false)
      if (motion.matches) {
        element.addEventListener('pointermove', move)
        element.addEventListener('pointerleave', reset)
      }
    }
    const stopWhenHidden = () => {
      if (!document.hidden) return
      sound.pause()
    }
    sync()
    motion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      motion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', stopWhenHidden)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', reset)
      sound.pause()
      reset()
    }
  }, [])

  return <section ref={banner} className="black-friday-banner" data-hat-away={Boolean(hatOrigin) || undefined} data-shopping={Boolean(purchase.product) || undefined} data-calling={calling || undefined} aria-labelledby="black-friday-heading">
    <BannerForest />
    <h1 id="black-friday-heading" className="black-friday-banner__title" aria-label="MUSTA RÄHNI PÄEVAD">
      <span className="black-friday-banner__musta" aria-hidden="true">MUSTA</span>
      <span className="black-friday-banner__closing" aria-hidden="true">
        <span className="black-friday-banner__rahni">RÄHNI</span>
        <span className="black-friday-banner__paevad">PÄEVAD</span>
      </span>
    </h1>
    <div className="black-friday-banner__flight">
      <div className="black-friday-banner__arrival">
        <button
          type="button"
          className="black-friday-banner__bird"
          aria-label="Pane rähn häälitsema"
          onClick={startCall}
        >
          <svg
            ref={bird}
            className="black-friday-banner__image"
            viewBox="0 0 1448 1086"
            width="1448"
            height="1086"
            role="img"
            aria-label="Täiesti tõsine ratsanik lendava hiiglasliku musta rähni seljas."
          >
            <defs>
              <clipPath id={`${clipId}-body`}>
                <path d={`M 0 0 H 1448 V 1086 H 0 Z ${calling ? lowerBeak : ''} ${hatOrigin ? headPatch : ''}`} clipRule="evenodd" />
              </clipPath>
              <clipPath id={`${clipId}-head`}><path d={headPatch} /></clipPath>
              <clipPath id={`${clipId}-hat`}><path d={capOutline} /></clipPath>
              <clipPath id={`${clipId}-beak`}>
                <path d={lowerBeak} />
              </clipPath>
            </defs>
            <path className="black-friday-banner__mouth" d="M 208 484 L 272 486 L 274 529 L 239 524 Z" fill="#201818" />
            <image href={birdImage} width="1448" height="1086" clipPath={calling || hatOrigin ? `url(#${clipId}-body)` : undefined} />
            {hatOrigin && <image href={bareheadedImage} width="1448" height="1086" clipPath={`url(#${clipId}-head)`} />}
            {!hatOrigin && <g className="black-friday-banner__hat-highlight" aria-hidden="true">
              <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-hat)`} />
              <path d={capOutline} />
            </g>}
            <g className="black-friday-banner__beak">
              <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-beak)`} />
            </g>
          </svg>
          <span className="black-friday-banner__beak-note" aria-hidden="true">
            <span>Nokk</span>
            <svg viewBox="0 0 100 60" fill="none"><path d="M28 36C8 34 6 24 10 8M10 8l-8 9M10 8l6 10" /></svg>
          </span>
          <span className="black-friday-banner__cry" aria-hidden="true">
            {cryLetters.map((letter, index) => <span
              key={index}
              className="black-friday-banner__cry-letter"
              style={{
                '--letter-index': index,
                '--letter-delay': `${80 + (index > 4 ? 180 : 0) + (index % 5) * 18}ms`,
              } as CSSProperties}
            >{letter}</span>)}
            {cryDrops.map(([x, y], index) => <span
              key={index}
              className="black-friday-banner__cry-drop"
              style={{ '--drop-x': `${x}em`, '--drop-y': `${y}em`, '--drop-delay': `${110 + index * 65}ms` } as CSSProperties}
            />)}
          </span>
        </button>
        {purchase.product && hatReady && <button ref={hatButton} type="button" className="black-friday-banner__hat"
          aria-label="Võta ratsaniku müts maha" aria-haspopup="dialog"
          onClick={() => { if (bird.current) setHatOrigin(getHatOrigin(bird.current)) }}>
          <span className="black-friday-banner__hat-note" aria-hidden="true">
            <span>Müts</span>
            <svg viewBox="0 0 100 60" fill="none"><path d="M60 22C73 20 72 32 70 44M70 44l-7-9M70 44l8-8" /></svg>
          </span>
        </button>}
      </div>
    </div>
    {store && purchase.product && <KrukKrukSpotlight store={store} purchase={purchase} />}
    {store && !purchase.product && <a className="black-friday-banner__shop" href={getStoreDirectoryVisitUrl(store)}
      aria-label={`Ava ${store.name} pood`}
      onClick={() => trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement: 'directory', position: 1 })}
      onAuxClick={event => { if (event.button === 1) trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement: 'directory', position: 1 }) }}>
      {store.name} <span aria-hidden="true">↗</span>
    </a>}
    {hatOrigin && store && purchase.product && <KrukHatShowcase store={store} purchase={purchase}
      origin={hatOrigin} source={bird} trigger={hatButton} onClose={closeHat} />}
    {purchase.purchase && <KrukCheckout purchase={purchase.purchase} onClose={purchase.close} returnFocusTo={purchase.returnFocusTo} />}
    <audio
      ref={callAudio}
      src="/audio/campaigns/musta-rahni-call.mp3"
      preload="auto"
      onPlaying={() => {
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setCalling(true)
      }}
      onEnded={finishCall}
      onPause={finishCall}
      onError={finishCall}
    />
  </section>
}
