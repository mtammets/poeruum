import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import KrukKrukSpotlight from './KrukKrukSpotlight'
import KrukCheckout from './KrukCheckout'
import { useKrukPurchase } from './useKrukPurchase'
import KrukHatShowcase from './KrukHatShowcase'
import BannerForest from './BannerForest'
import BlackFridayScreensaver, { type ScreensaverHandle } from './BlackFridayScreensaver'
import useWoodpeckerCall, { woodpeckerCalls } from './useWoodpeckerCall'
import WoodpeckerBeak, { lowerBeak } from './WoodpeckerBeak'
import { bareheadedImage, birdImage, capImage, capOutline, getHatOrigin, headPatch, type HatOrigin } from './krukHatMotion'

const cryLetters = [...'KRÜK-KRÜK']
const cryDrops = [[1.1, -2.5], [3.6, -.5], [1.8, .7], [4.8, -2.8], [2.7, -3.2], [.8, 1.1]]

export default function BlackFridayBanner({ store }: { store?: StoreDirectoryEntry }) {
  const purchase = useKrukPurchase(store)
  const clipId = useId()
  const banner = useRef<HTMLElement>(null)
  const bird = useRef<SVGSVGElement>(null)
  const hatButton = useRef<HTMLButtonElement>(null)
  const screensaver = useRef<ScreensaverHandle>(null)
  const call = useWoodpeckerCall()
  const { calling } = call
  const [hatOrigin, setHatOrigin] = useState<HatOrigin | null>(null)
  const [hatReady, setHatReady] = useState(false)
  const closeHat = useCallback(() => setHatOrigin(null), [])
  const startGame = () => { call.play(); screensaver.current?.open() }

  useEffect(() => {
    if (!purchase.product) return
    let cancelled = false
    const images = [capImage, bareheadedImage].map(src => { const image = new Image(); image.src = src; return image.decode() })
    void Promise.all(images).then(() => { if (!cancelled) setHatReady(true) }).catch(() => { /* The regular buy button remains available. */ })
    return () => { cancelled = true }
  }, [purchase.product])

  useEffect(() => {
    const element = banner.current
    if (!element) return
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
      if (motion.matches) {
        element.addEventListener('pointermove', move)
        element.addEventListener('pointerleave', reset)
      }
    }
    sync()
    motion.addEventListener('change', sync)
    return () => {
      motion.removeEventListener('change', sync)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', reset)
      reset()
    }
  }, [])

  return <section ref={banner} className="black-friday-banner" data-hat-away={Boolean(hatOrigin) || undefined} data-shopping={Boolean(purchase.product) || undefined} data-calling={calling || undefined} aria-labelledby="black-friday-heading">
    <BlackFridayScreensaver ref={screensaver} call={call} paused={Boolean(hatOrigin || purchase.purchase || purchase.busy)} />
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
          aria-label="Alusta rähnimängu"
          aria-haspopup="dialog"
          aria-busy={calling || undefined}
          onClick={startGame}
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
            <image href={birdImage} width="1448" height="1086" clipPath={calling || hatOrigin ? `url(#${clipId}-body)` : undefined} />
            {hatOrigin && <image href={bareheadedImage} width="1448" height="1086" clipPath={`url(#${clipId}-head)`} />}
            {!hatOrigin && <g className="black-friday-banner__hat-highlight" aria-hidden="true">
              <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-hat)`} />
              <path d={capOutline} />
            </g>}
            <WoodpeckerBeak clipId={clipId} {...call} />
          </svg>
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
    <button type="button" className="black-friday-banner__game-note" aria-label="Alusta mängu"
      aria-description="Juhi nooleklahvide või ekraaninuppudega." aria-haspopup="dialog" onClick={startGame}>
      <svg aria-hidden="true" className="black-friday-banner__game-arrow" viewBox="0 0 80 100" fill="none"><path d="M24 94C-10 63 10 14 70 9M70 9 58 2M70 9 60 20" /></svg>
      <span className="black-friday-banner__game-title">Alusta mängu
        <svg aria-hidden="true" className="black-friday-banner__game-underline" viewBox="0 0 190 9" fill="none" preserveAspectRatio="none"><path pathLength="1" d="M2 6Q83 0 187 4" /></svg>
      </span>
    </button>
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
    <audio ref={call.audioRef} src={woodpeckerCalls[0].src} preload="auto" hidden />
  </section>
}
