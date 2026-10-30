import { useEffect, useId, useRef } from 'react'
import { COMPANY_HOMEPAGE_IMAGE, companyHomepageMetadata } from '../shared/company-homepage.mjs'
import type { PublicStoreRecord } from './lib/database'
import { applySeoMetadata, isLocalSeoPreview } from './lib/seo'
import { getCompanyHomepagePath, getProductUrlSlug, getStorefrontPath, isDedicatedStorefrontHostname } from './lib/storefrontUrl'
import { getProductPrice, getResponsiveImageProps } from './storefrontModel'
import type { Product } from './products'
import BannerForest from './themes/black-friday/BannerForest'
import useWoodpeckerCall, { woodpeckerCalls } from './themes/black-friday/useWoodpeckerCall'
import WoodpeckerBeak, { lowerBeak } from './themes/black-friday/WoodpeckerBeak'
import { birdImage } from './themes/black-friday/krukHatMotion'
import useCompanyHomepageEditor, { type CompanyHomepageReview } from './useCompanyHomepageEditor'
import { publicAssetUrl } from './lib/publicAssetUrl'
import './companyHomepage.css'

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const externalUrl = (value: unknown) => {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export default function CompanyHomepage({ store, products, review }: { store: PublicStoreRecord; products: Product[]; review?: CompanyHomepageReview }) {
  const hero = useRef<HTMLDivElement>(null)
  const clipId = useId()
  const call = useWoodpeckerCall()
  const { settings } = store
  const featured = products.find(product => product.slug === 'nokkmuts') ?? products[0]
  const editor = useCompanyHomepageEditor(store, featured, review)
  const { copy, editable: edit } = editor
  const name = copy.brand
  const logo = text(settings.storeLogo)
  const { description } = companyHomepageMetadata(name, copy)
  const email = copy.email.trim()
  const phone = copy.phone.trim()
  const company = copy.company
  const address = copy.address
  const registry = copy.registry
  const isSignatureHat = featured?.slug === 'nokkmuts'
  const dedicated = isDedicatedStorefrontHostname(window.location.hostname)
  const shopPath = review?.shopUrl ?? (dedicated ? '/' : getStorefrontPath(store.slug))
  const homepagePath = review ? review.homePath || '/' : getCompanyHomepagePath(store.slug)
  const productPath = (product: Product) => review ? new URL(`/toode/${encodeURIComponent(getProductUrlSlug(product))}/`, review.shopUrl).href : dedicated ? `/toode/${encodeURIComponent(getProductUrlSlug(product))}/` : getStorefrontPath(store.slug, product)
  const socials = [['instagramLabel', settings.instagramUrl], ['facebookLabel', settings.facebookUrl], ['tiktokLabel', settings.tiktokUrl]]
    .map(([label, value]) => ({ label: String(label), url: externalUrl(value) })).filter(item => item.url)

  useEffect(() => {
    const element = hero.current
    if (!element) return
    const motion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    let frame = 0
    const reset = () => {
      cancelAnimationFrame(frame)
      for (const axis of ['x', 'y', 'bank']) element.style.removeProperty(`--company-pointer-${axis}`)
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const bounds = element.getBoundingClientRect()
      const x = (event.clientX - bounds.left) / bounds.width - .5
      const y = (event.clientY - bounds.top) / bounds.height - .5
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--company-pointer-x', `${x * 16}px`)
        element.style.setProperty('--company-pointer-y', `${y * 12}px`)
        element.style.setProperty('--company-pointer-bank', `${x * 1.2}deg`)
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

  useEffect(() => {
    const canonicalUrl = new URL(homepagePath, window.location.origin).href
    applySeoMetadata({
      title: companyHomepageMetadata(name).title, description, canonicalUrl, imageUrl: COMPANY_HOMEPAGE_IMAGE,
      noIndex: Boolean(review) || isLocalSeoPreview() || window.location.hostname.endsWith('.localhost'), searchConsoleVerification: text(settings.searchConsoleVerification),
      structuredData: {
        '@context': 'https://schema.org', '@type': 'Organization', name: company, url: canonicalUrl,
        description, ...(logo ? { logo } : {}), ...(email ? { email } : {}), ...(phone ? { telephone: phone } : {}),
      },
    })
  }, [company, description, email, homepagePath, logo, name, phone, settings, review])

  return <div className={`company-homepage${editor.editing ? ' is-editing' : ''}${editor.active ? ' has-editor' : ''}`}
    onClickCapture={event => {
      if (editor.editing && event.target instanceof Element && event.target.closest('a')) event.preventDefault()
    }}>
    {editor.toolbar}
    <a className="company-homepage__skip" href="#meist">Liigu põhisisu juurde</a>
    <section className="company-hero" aria-labelledby="company-title">
      <header className="company-header">
        <a className="company-brand" href={homepagePath} aria-label={`${name} koduleht`}>
          {logo && <img src={logo} width="44" height="44" alt="" />}
          <span>{edit('brand')}</span>
        </a>
        <nav aria-label="Kodulehe menüü">
          <a href="#meist">{edit('navStory')}</a>
          {featured && <a href="#looming">{edit('navWork')}</a>}
          <a href="#kontakt">{edit('navContact')}</a>
        </nav>
        <a className="company-header__shop" href={shopPath}>{edit('headerShop')} <Arrow /></a>
      </header>
      <div className="company-hero__body" ref={hero}>
        <BannerForest />
        <div className="company-hero__copy">
          <div className="company-hero__heading">
            <p className="company-eyebrow">{edit('heroEyebrow')}</p>
            <h1 id="company-title">{edit('heroTitle')}<br /><span className="company-hero__accent">{edit('heroAccent')}</span></h1>
          </div>
          <div className="company-hero__intro">
            <p>{edit('heroIntro')}</p>
            <a className="company-button" href={shopPath}><span>{edit('heroShop')}</span><Arrow /></a>
          </div>
        </div>
        <div className="company-hero__art" data-calling={call.calling || undefined}>
          <button className="company-hero__image" type="button" onClick={call.play} aria-label="Pane rähn häälitsema" aria-busy={call.calling || undefined}>
            <svg className="company-hero__bird-image" viewBox="0 0 1448 1086" width="1448" height="1086" role="img" aria-label="Fantaasiapilt suure musta rähni seljas lendavast Krük-Krüki nokkmütsiga ratsanikust">
              <defs>
                <clipPath id={`${clipId}-body`}><path d={`M0 0 H1448 V1086 H0 Z ${lowerBeak}`} clipRule="evenodd" /></clipPath>
                <clipPath id={`${clipId}-beak`}><path d={lowerBeak} /></clipPath>
              </defs>
              <image href={birdImage} width="1448" height="1086" clipPath={call.calling ? `url(#${clipId}-body)` : undefined} />
              <WoodpeckerBeak clipId={clipId} {...call} />
            </svg>
          </button>
        </div>
        <audio ref={call.audioRef} src={woodpeckerCalls[0].src} preload="auto" hidden />
      </div>
      <div className="company-hero__foot">
        <a className="company-hero__scroll" href="#meist"><span aria-hidden="true">↓</span><span>{edit('navStory')}</span></a>
        <span className="company-hero__signature">{edit('location')}</span>
      </div>
    </section>

    <main id="meist" className="company-main">
      <section className="company-about" aria-labelledby="company-about-title">
        <div className="company-section-heading">
          <p className="company-eyebrow">{edit('storyLabel')} <span aria-hidden="true">/ 01</span></p>
          <h2 id="company-about-title">{edit('storyTitle')}</h2>
        </div>
        <div className="company-about__body">
          <figure className="company-about__portrait">
            <img src={publicAssetUrl('/images/campaigns/kruk-cap-forest-model-v1.webp')} alt="Krük-Krüki kahe rähniga nokkmütsi kandev mees päikeselises metsas" width="1254" height="1254" loading="lazy" decoding="async" />
            <figcaption>{edit('portraitCaption')}{edit('portraitCredit')}</figcaption>
          </figure>
          <div className="company-about__copy">
            <h3 className="company-about__statement">{edit('storyStatement')}</h3>
            <p>{edit('storyIntro')}</p>
            <h3 className="company-about__subheading">{edit('nameTitle')}</h3>
            <p>{edit('nameStory')}</p>
            <p>{edit('nameOutro')}</p>
            <a className="company-text-link" href="#visandid"><span>{edit('sketchesLink')}</span><Arrow /></a>
          </div>
        </div>
        <div className="company-sketchbook" id="visandid">
          <div className="company-sketchbook__copy">
            <p className="company-eyebrow">{edit('sketchesLabel')} <span aria-hidden="true">/ 02</span></p>
            <h3>{edit('sketchesTitle')}</h3>
            <p>{edit('sketchesIntro')}</p>
            <p>{edit('sketchesOutro')}</p>
            <a className="company-text-link" href={featured ? '#looming' : shopPath}><span>{edit('sketchesShop')}</span><Arrow /></a>
          </div>
          <figure className="company-sketchbook__photo">
            <img src={publicAssetUrl('/images/kruk-kruk/mark-sketches.jpg')} alt="Krük-Krüki kahe punase pealaega rähni märgi käsitsi joonistatud visandid täpilisel paberil" width="1368" height="1824" loading="lazy" decoding="async" />
            <figcaption>{edit('sketchesCaption')}{edit('sketchesCredit')}</figcaption>
          </figure>
        </div>
      </section>

      {featured && <section className="company-feature" id="looming" aria-labelledby="company-feature-title">
        <div className="company-feature__heading"><p className="company-eyebrow">{edit('workLabel')} <span aria-hidden="true">/ 03</span></p><p>{edit('workHeading')}</p></div>
        <div className="company-feature__body">
        <a className="company-feature__image" href={productPath(featured)} aria-label={`Vaata toodet ${featured.name}`}>
          {isSignatureHat && <span className="company-feature__edition" aria-hidden={editor.editing ? undefined : true}>{edit('productEdition')}</span>}
          <img {...(isSignatureHat ? { src: publicAssetUrl('/images/campaigns/kruk-cap-cutout-v1.webp'), width: 1448, height: 1086 } : getResponsiveImageProps(featured, featured.image))} className={isSignatureHat ? 'is-cutout' : undefined} alt={featured.alt || featured.name} loading="lazy" decoding="async" />
          <span className="company-feature__caption"><span>{edit('productCaption')}</span><Arrow /></span>
        </a>
        <div className="company-feature__copy">
          <p className="company-eyebrow">{edit('productEyebrow')}</p>
          <h2 id="company-feature-title">{edit('productTitle')}</h2>
          {(copy.productStory || editor.editing) && <p className="company-feature__story">{edit('productStory')}</p>}
          {featured.price !== undefined && <div className="company-feature__price">
            <strong>{new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' }).format(getProductPrice(featured))}</strong>
            {featured.price !== undefined && getProductPrice(featured) < featured.price && <del>{new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' }).format(featured.price)}</del>}
          </div>}
          <a className="company-button company-button--paper" href={productPath(featured)}><span>{edit('productButton')}</span><Arrow /></a>
          {products.length > 1 && <a className="company-text-link" href={shopPath}><span>{edit('allProducts')}</span><Arrow /></a>}
        </div>
        </div>
      </section>}
    </main>

    <footer className="company-contact" id="kontakt" aria-labelledby="company-contact-title">
      <div className="company-contact__top">
        <div><p className="company-eyebrow">{edit('contactLabel')}</p><h2 id="company-contact-title">{edit('contactTitle')}</h2></div>
        <div className="company-contact__links">
          {(email || editor.editing) && <a href={`mailto:${email}`}>{edit('email')} <Arrow /></a>}
          {(phone || editor.editing) && <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{edit('phone')} <Arrow /></a>}
          {socials.length > 0 && <nav aria-label="Sotsiaalmeedia">{socials.map(item => <a key={item.label} href={item.url!} target="_blank" rel="noopener noreferrer">{edit(item.label)} ↗</a>)}</nav>}
        </div>
      </div>
      <div className="company-contact__details"><strong>{edit('company')}</strong>{(registry || editor.editing) && <span>{edit('registryLabel')} {edit('registry')}</span>}{(address || editor.editing) && <span>{edit('address')}</span>}</div>
      <div className="company-contact__wordmark" aria-hidden={editor.editing ? undefined : true}>{edit('footerWordmark')}</div>
      <div className="company-contact__bottom"><span>© {new Date().getFullYear()} {edit('copyright')}</span><a href={shopPath}>{edit('footerShop')} <Arrow /></a><a href="https://poeruum.ee/" target="_blank" rel="noopener noreferrer">{edit('credit')} ↗</a></div>
    </footer>
  </div>
}
