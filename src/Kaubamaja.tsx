import { useEffect, useMemo, useState } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import {
  formatStoreDirectoryPrice,
  getStoreDirectoryFeaturedUrl,
  normalizeStoreDirectoryCatalog,
} from '../shared/store-directory.mjs'
import { Brand } from './Brand'
import { listPublicStoreDirectory } from './lib/database'
import { applySeoMetadata } from './lib/seo'
import { isSupabaseConfigured } from './lib/supabase'

const directoryUrl = 'https://kaubamaja.poeruum.ee/'
const directoryName = 'Poeruumi Kaubamaja'
const directoryHeading = 'Avasta Poeruumis loodud Eesti e-poode'
const directoryDescription = 'Poeruumi Kaubamaja koondab ühte kohta Eesti ettevõtjate e-poed. Sirvi valikut ja leia uusi poode, tooteid ning tegijaid.'
const directoryHeroImage = `${directoryUrl}images/poeruumi-kaubamaja-hero.webp`

const ArrowUpRight = ({ className = '' }: { className?: string }) => <svg
  className={className}
  viewBox="0 0 20 20"
  fill="none"
  aria-hidden="true"
>
  <path d="M5 15 15 5M7 5h8v8" />
</svg>

const ArrowDown = ({ className = '' }: { className?: string }) => <svg
  className={className}
  viewBox="0 0 20 20"
  fill="none"
  aria-hidden="true"
>
  <path d="M10 4v12m-5-5 5 5 5-5" />
</svg>

const marqueeMessages = [
  'Avasta Eesti tegijaid',
  'Toeta kohalikku',
  'Leia uusi lemmikuid',
]

const readInitialStores = () => {
  const element = document.getElementById('poeruum-store-directory-data')
  if (!element?.textContent) return []
  try { return normalizeStoreDirectoryCatalog(JSON.parse(element.textContent)) }
  catch { return [] }
}

let directoryRequest: ReturnType<typeof listPublicStoreDirectory> | null = null
const loadStores = () => {
  directoryRequest ??= listPublicStoreDirectory().finally(() => { directoryRequest = null })
  return directoryRequest
}

const StoreCard = ({ store, index }: { store: StoreDirectoryEntry; index: number }) => {
  const product = store.featuredProduct
  const regularPrice = product?.price ?? null
  const salePrice = product?.salePrice ?? null
  const hasSale = regularPrice !== null && salePrice !== null && salePrice < regularPrice
  const currentPrice = hasSale ? salePrice : regularPrice
  const isSoldOut = product?.stock !== null && product?.stock !== undefined && product.stock <= 0
  const featuredUrl = getStoreDirectoryFeaturedUrl(store)
  const description = product?.description || store.description
  const featuredLabel = product ? `Vaata toodet ${product.name} poes ${store.name}` : `Ava pood ${store.name}`

  return <article className="store-directory__card">
    <span className="store-directory__media">
      <a className="store-directory__featured-link" href={featuredUrl} aria-label={featuredLabel}>
        {store.imageUrl ? <img
          className="store-directory__cover"
          src={store.imageUrl}
          alt=""
          loading={index < 2 ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : 'auto'}
          decoding="async"
          onError={(event) => event.currentTarget.remove()}
        /> : null}
        <span className="store-directory__card-shade" aria-hidden="true" />
        {product ? <span className="store-directory__product">
          <span className="store-directory__product-name">{product.name}</span>
          <span className="store-directory__product-side">
            {isSoldOut ? <small>Välja müüdud</small> : null}
            {currentPrice !== null ? <span className="store-directory__price">
              {hasSale ? <del>{formatStoreDirectoryPrice(regularPrice)}</del> : null}
              <strong>{formatStoreDirectoryPrice(currentPrice)}</strong>
            </span> : null}
          </span>
        </span> : null}
      </a>
      <a className="store-directory__identity" href={store.url} aria-label={`Ava pood ${store.name}`}>
        <span className="store-directory__identity-mark" aria-hidden="true">
          <b>{store.name.charAt(0).toLocaleUpperCase('et')}</b>
          {store.logoUrl ? <img src={store.logoUrl} alt="" loading="lazy" decoding="async" onError={(event) => event.currentTarget.remove()} /> : null}
        </span>
        <strong>{store.name.toLocaleUpperCase('et')}</strong>
      </a>
    </span>
    <div className="store-directory__card-copy">
      {description ? <p>{description}</p> : null}
      <a className="store-directory__card-cta" href={featuredUrl}>
        {product ? 'Vaata toodet' : 'Vaata poodi'}
      </a>
    </div>
  </article>
}

export default function Kaubamaja() {
  const [stores, setStores] = useState<StoreDirectoryEntry[]>(readInitialStores)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    isSupabaseConfigured ? 'loading' : 'ready',
  )

  const structuredData = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: directoryName,
    description: directoryDescription,
    url: directoryUrl,
    inLanguage: 'et',
    isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: 'https://poeruum.ee/' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: stores.length,
      itemListElement: stores.map((store, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: store.name,
        url: store.url,
      })),
    },
  }), [stores])

  useEffect(() => {
    applySeoMetadata({
      title: directoryName,
      description: directoryDescription,
      canonicalUrl: directoryUrl,
      imageUrl: directoryHeroImage,
      structuredData,
    })
  }, [structuredData])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    loadStores()
      .then((nextStores) => {
        if (!active) return
        setStores(nextStores)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => { active = false }
  }, [])

  return <main className="store-directory">
    <nav className="store-directory__nav" aria-label="Poeruumi Kaubamaja">
      <a className="store-directory__brand" href="https://poeruum.ee/" aria-label="Poeruumi avaleht">
        <Brand />
        <span className="store-directory__brand-rule" aria-hidden="true" />
        <span className="store-directory__brand-edition">Kaubamaja</span>
      </a>
      <div className="store-directory__merchant-entry">
        <span>Oled ettevõtja?</span>
        <a
          className="store-directory__create"
          href="https://poeruum.ee/#hind"
          aria-label="Loo oma e-pood"
        >
          <span className="store-directory__create-full" aria-hidden="true">Loo oma e-pood</span>
          <span className="store-directory__create-short" aria-hidden="true">Loo e-pood</span>
          <ArrowUpRight />
        </a>
      </div>
    </nav>

    <header className="store-directory__hero">
      <div className="store-directory__hero-media">
        <img src="/images/poeruumi-kaubamaja-hero.webp" alt="" fetchPriority="high" decoding="async" />
      </div>
      <div className="store-directory__intro">
        <span className="store-directory__eyebrow"><i aria-hidden="true" /> Kohalik kaubamaja</span>
        <h1 aria-label={directoryHeading}>
          <span aria-hidden="true">Avasta</span>
          <span aria-hidden="true">Poeruumis loodud</span>
          <span aria-hidden="true"><em>Eesti</em> e-poode</span>
        </h1>
        <p>{directoryDescription}</p>
        <div className="store-directory__hero-actions">
          <a className="store-directory__browse" href="#store-directory-heading">
            Sirvi poode
            <ArrowDown />
          </a>
          <span>Eesti ettevõtjatelt</span>
        </div>
      </div>
    </header>

    <div className="store-directory__marquee" aria-hidden="true">
      <div className="store-directory__marquee-track">
        {[0, 1].map((group) => <div className="store-directory__marquee-group" key={group}>
          {marqueeMessages.map((message) => <span key={`${group}-${message}`}>{message}<i>✦</i></span>)}
        </div>)}
      </div>
    </div>

    <section className="store-directory__stores" aria-labelledby="store-directory-heading">
      <div className="store-directory__section-head">
        <h2 id="store-directory-heading">Poed</h2>
        <span>Sirvi valikut</span>
      </div>
      {stores.length > 0 ? <div className="store-directory__grid">
        {stores.map((store, index) => <StoreCard key={store.id} store={store} index={index} />)}
      </div> : <div className="store-directory__empty" aria-live="polite">
        {status === 'loading'
          ? <span className="store-directory__loader" aria-label="Laadin poode" />
          : <p>{status === 'error' ? 'Poode ei õnnestunud praegu laadida.' : 'Uued poed jõuavad siia peagi.'}</p>}
      </div>}
    </section>

    <footer className="store-directory__footer">
      <span>© 2026 Poeruum</span>
      <div>
        <a href="https://poeruum.ee/mis-on-poeruum/">Mis on Poeruum?</a>
        <a href="https://poeruum.ee/#hind">Loo oma pood <ArrowUpRight /></a>
      </div>
    </footer>
  </main>
}
