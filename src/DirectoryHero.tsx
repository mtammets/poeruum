import { useEffect, useRef, useState } from 'react'
import { getStoreDirectoryVisitUrl } from '../shared/store-directory.mjs'
import type { DirectoryProductResult } from './lib/directorySearch'
import { trackDirectoryEvent } from './lib/directoryAnalytics'

export const directoryHeroSlides = [
  {
    heading: 'Avasta Poeruumis loodud Eesti e-poode',
    lines: ['Avasta', 'Poeruumis loodud'],
    headingSize: 'regular',
    highlight: 'Eesti',
    ending: 'e-poode',
    description: 'Poeruumi Kaubamaja koondab ühte kohta Eesti ettevõtjate e-poed. Sirvi valikut ja leia uusi poode, tooteid ning tegijaid.',
    action: { label: 'Sirvi poode', href: '#store-directory-heading', arrow: 'M10 4v12m-5-5 5 5 5-5' },
  },
  {
    heading: 'Too oma tooted nähtavale.',
    lines: ['Too oma tooted'],
    headingSize: 'large',
    highlight: 'nähtavale.',
    ending: '',
    description: 'Poeruumi Kaubamaja aitab ostjatel sinu tooteid avastada ja otse sinu e-poodi jõuda.',
    action: { label: 'Loo oma e-pood', href: 'https://poeruum.ee/#hind', arrow: 'M5 15 15 5M7 5h8v8' },
  },
]

const slideDuration = 7000

export default function DirectoryHero({ products }: { products: DirectoryProductResult[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [inView, setInView] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const hero = useRef<HTMLElement>(null)
  const playbackButton = useRef<HTMLButtonElement>(null)
  const activeSlide = directoryHeroSlides[activeIndex]

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = () => setReducedMotion(motion.matches)
    const onVisibilityChange = () => setVisible(!document.hidden)
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    if (hero.current) observer.observe(hero.current)
    motion.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      observer.disconnect()
      motion.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (paused || hovered || !visible || !inView || reducedMotion) return
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % directoryHeroSlides.length)
      setPhotoIndex((index) => (index + 1) % Math.max(products.length, 1))
    }, slideDuration)
    return () => window.clearTimeout(timer)
  }, [activeIndex, paused, hovered, visible, inView, reducedMotion, products.length])

  return <header
    ref={hero}
    className={`store-directory__hero${products.length ? '' : ' store-directory__hero--text-only'}`}
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true) }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={(event) => { if (event.target !== playbackButton.current) setPaused(true) }}
  >
    <div className="store-directory__intro">
      <h1 className="store-directory__hero-heading" aria-label={activeSlide.heading}>
        {directoryHeroSlides.map((slide, index) => <span
          key={slide.heading}
          className={`store-directory__hero-heading-slide store-directory__hero-heading-slide--${slide.headingSize}${activeIndex === index ? ' is-active' : ''}`}
          aria-hidden="true"
        >
          {slide.lines.map((line) => <span key={line}>{line}</span>)}
          <span><em>{slide.highlight}</em>{slide.ending && <>{' '}<span className="store-directory__hero-heading-ending">{slide.ending}</span></>}</span>
        </span>)}
      </h1>
      <div className="store-directory__hero-descriptions">
        {directoryHeroSlides.map((slide, index) => <p
          key={slide.heading}
          className={`store-directory__hero-description${activeIndex === index ? ' is-active' : ''}`}
          aria-hidden={activeIndex !== index}
        >{slide.description}</p>)}
      </div>
      <div className="store-directory__hero-actions">
        <a className="store-directory__browse" href={activeSlide.action.href}>
          <span className="store-directory__hero-action-labels">
            {directoryHeroSlides.map((slide, index) => <span key={slide.heading} aria-hidden={activeIndex !== index}>{slide.action.label}</span>)}
          </span>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={activeSlide.action.arrow} /></svg>
        </a>
        <div className="store-directory__hero-controls" role="group" aria-label="Avaosa vaated">
          {!reducedMotion && <button
            ref={playbackButton}
            className="store-directory__hero-playback"
            type="button"
            aria-label={paused ? 'Jätka vahetumist' : 'Peata vahetumine'}
            onClick={() => setPaused((value) => !value)}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {paused ? <path d="m7 4 8 6-8 6Z" /> : <path d="M7 5v10m6-10v10" />}
            </svg>
          </button>}
          {directoryHeroSlides.map((slide, index) => <button
            key={slide.heading}
            className="store-directory__hero-selector"
            type="button"
            aria-label={`Näita vaadet ${index + 1}: ${slide.heading}`}
            aria-pressed={activeIndex === index}
            onClick={() => { setPaused(true); setActiveIndex(index); setPhotoIndex(index % Math.max(products.length, 1)) }}
          >
            <span aria-hidden="true">0{index + 1}</span>
          </button>)}
        </div>
      </div>
    </div>
    {products.length > 0 && <div className="store-directory__hero-media">
      {products.map(({ store, product }, index) => {
        const active = photoIndex % products.length === index
        const open = () => trackDirectoryEvent({ event_name: 'product_click', store_id: store.id, product_id: product.id, placement: 'directory', position: index + 1 })
        return <a className={`store-directory__hero-photo${active ? ' is-active' : ''}`} key={`${store.id}:${product.id}`}
          href={getStoreDirectoryVisitUrl(store, product)} aria-label={`${product.name} – ${store.name}`}
          aria-hidden={!active} inert={!active}
          onClick={open} onAuxClick={(event) => { if (event.button === 1) open() }}>
          <img src={product.imageUrl!} alt="" fetchPriority={index === 0 ? 'high' : 'auto'} decoding="async"
            onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
        </a>
      })}
    </div>}
  </header>
}
