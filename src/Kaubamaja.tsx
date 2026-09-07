import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryVisitUrl, normalizeStoreDirectoryCatalog, storeDirectoryExamples } from '../shared/store-directory.mjs'
import { getDirectoryStory } from '../shared/directory-stories.mjs'
import DailyHoroscope from './DailyHoroscope'
import DirectoryStories from './DirectoryStories'
import DirectoryStoryPage from './DirectoryStoryPage'
import StoreDirectoryLayout, { ArrowUpRight } from './StoreDirectoryLayout'
import { listPublicStoreDirectory } from './lib/database'
import { createStoreDirectorySearch, type DirectoryProductResult } from './lib/directorySearch'
import { applySeoMetadata } from './lib/seo'
import { isSupabaseConfigured } from './lib/supabase'

const directoryUrl = 'https://kaubamaja.poeruum.ee/'
const directoryName = 'Poeruumi Kaubamaja'
const directoryHeading = 'Avasta Poeruumis loodud Eesti e-poode'
const directoryDescription = 'Poeruumi Kaubamaja koondab ühte kohta Eesti ettevõtjate e-poed. Sirvi valikut ja leia uusi poode, tooteid ning tegijaid.'
const directoryHeroImage = `${directoryUrl}images/poeruumi-kaubamaja-hero.webp`
const productPageSize = 24

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
// Each repeated group must cover the full ribbon, including on wide screens.
const marqueeLoop = [...marqueeMessages, ...marqueeMessages]

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

const StoreCard = ({ store, index, visitUrl, isExample = false }: {
  store: Pick<StoreDirectoryEntry, 'name' | 'description' | 'imageUrl' | 'logoUrl'>
  index: number
  visitUrl: string
  isExample?: boolean
}) => {
  const description = store.description || 'Avasta poe valikut.'

  return <article className="store-directory__card">
    <a className="store-directory__card-link" href={visitUrl} aria-label={isExample ? `${store.name} – loo oma pood Poeruumis` : `Ava pood ${store.name}`}>
      <div className="store-directory__media">
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
      </div>
      <div className="store-directory__card-copy">
        <div className="store-directory__identity">
          <span className="store-directory__identity-mark" aria-hidden="true">
            <b>{isExample ? '+' : store.name.charAt(0).toLocaleUpperCase('et')}</b>
            {store.logoUrl ? <img src={store.logoUrl} alt="" loading="lazy" decoding="async" onError={(event) => event.currentTarget.remove()} /> : null}
          </span>
          <div>
            <h3>{store.name}</h3>
            <p>{description}</p>
          </div>
        </div>
        <span className="store-directory__card-cta" aria-hidden="true">
          {isExample ? 'Loo oma pood' : 'Ava pood'}
          <ArrowUpRight />
        </span>
      </div>
    </a>
  </article>
}

const ProductCard = ({ store, product }: DirectoryProductResult) => <article className="store-directory__product">
  <a href={getStoreDirectoryVisitUrl(store, product)} aria-label={`${product.name} – ${store.name}`}>
    <div className="store-directory__product-media">
      {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" decoding="async"
        onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : null}
      {product.stock === 0 ? <span className="store-directory__sold-out">Välja müüdud</span> : null}
    </div>
    <div className="store-directory__product-copy">
      <span className="store-directory__product-store">{store.name}</span>
      <h3>{product.name}</h3>
      {product.price !== null ? <p className="store-directory__product-price">
        <strong>{formatStoreDirectoryPrice(product.salePrice ?? product.price)}</strong>
        {product.salePrice !== null ? <del>{formatStoreDirectoryPrice(product.price)}</del> : null}
      </p> : null}
      <ArrowUpRight />
    </div>
  </a>
</article>

export default function Kaubamaja() {
  if (/^\/lood(?:\/|$)/.test(window.location.pathname)) {
    return <DirectoryStoryPage story={getDirectoryStory(window.location.pathname)} />
  }
  return <StoreDirectory />
}

function StoreDirectory() {
  const [stores, setStores] = useState<StoreDirectoryEntry[]>(readInitialStores)
  const [query, setQuery] = useState(() => (new URLSearchParams(window.location.search).get('q') || '').slice(0, 160))
  const [productLimit, setProductLimit] = useState(productPageSize)
  const searchInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    isSupabaseConfigured ? 'loading' : 'ready',
  )
  const search = useMemo(() => createStoreDirectorySearch(stores), [stores])
  const results = useMemo(() => search(query), [search, query])
  const isSearching = query.trim().length > 0
  const hasResults = results.stores.length > 0 || results.products.length > 0

  const changeQuery = (value: string) => {
    setQuery(value)
    setProductLimit(productPageSize)
    const url = new URL(window.location.href)
    if (value.trim()) url.searchParams.set('q', value)
    else url.searchParams.delete('q')
    window.history.replaceState(window.history.state, '', url)
  }

  const clearSearch = () => {
    changeQuery('')
    searchInput.current?.focus()
  }

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

  useEffect(() => {
    if (status === 'loading') return
    // The directory is loaded lazily, after the browser first resolves the fragment.
    const target = window.location.hash.slice(1)
    if (target === 'poeruumi-lood' || target === 'store-directory-heading') {
      document.getElementById(target)?.scrollIntoView({ behavior: 'instant' })
    }
  }, [status])

  return <StoreDirectoryLayout>
    <header className="store-directory__hero">
      <div className="store-directory__hero-media">
        <img src="/images/poeruumi-kaubamaja-hero.webp" alt="" fetchPriority="high" decoding="async" />
      </div>
      <div className="store-directory__intro">
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
        </div>
      </div>
    </header>

    <div className="store-directory__marquee" aria-hidden="true">
      <div className="store-directory__marquee-track">
        {[0, 1].map((group) => <div className="store-directory__marquee-group" key={group}>
          {marqueeLoop.map((message, index) => <span key={`${group}-${index}`}>{message}<i>✦</i></span>)}
        </div>)}
      </div>
    </div>

    <section className="store-directory__stores" aria-labelledby="store-directory-heading">
      <div className="store-directory__section-head">
        <h2 id="store-directory-heading">Leia oma uus lemmikpood</h2>
        <form className="store-directory__search" role="search" onSubmit={(event) => event.preventDefault()}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input
            ref={searchInput}
            type="search"
            aria-label="Otsi poode ja tooteid"
            aria-controls="store-directory-results"
            placeholder="Otsi poode ja tooteid"
            value={query}
            maxLength={160}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') clearSearch() }}
          />
          {query ? <button type="button" aria-label="Tühjenda otsing" onClick={clearSearch}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button> : null}
        </form>
      </div>
      <p className="store-directory__search-status" role="status">
        {isSearching && stores.length > 0 ? `${results.products.length} ${results.products.length === 1 ? 'toode' : 'toodet'}, ${results.stores.length} ${results.stores.length === 1 ? 'pood' : 'poodi'}.` : ''}
      </p>
      <div id="store-directory-results">
        {stores.length === 0 && status !== 'ready' ? <p className="store-directory__notice" role="status">
          {status === 'loading' ? 'Laadin poode…' : 'Poode ei õnnestunud praegu laadida.'}
        </p> : null}
        {isSearching ? <>
          {results.products.length > 0 ? <section className="store-directory__result-group" aria-label="Leitud tooted">
            <p className="store-directory__results-heading">Tooted <span>{results.products.length}</span></p>
            <div className="store-directory__product-grid">
              {results.products.slice(0, productLimit).map((result) => <ProductCard
                key={`${result.store.id}:${result.product.id}`} {...result} />)}
            </div>
            {results.products.length > productLimit ? <button
              className="store-directory__show-more"
              type="button"
              onClick={() => setProductLimit((limit) => limit + productPageSize)}
            >Näita veel tooteid</button> : null}
          </section> : null}
          {results.stores.length > 0 ? <section className="store-directory__result-group" aria-label="Leitud poed">
            <p className="store-directory__results-heading">Poed <span>{results.stores.length}</span></p>
            <div className="store-directory__grid">
              {results.stores.map((store, index) => <StoreCard key={store.id} store={store} index={index} visitUrl={getStoreDirectoryVisitUrl(store)} />)}
            </div>
          </section> : null}
          {!hasResults && (stores.length > 0 || status === 'ready') ? <div className="store-directory__empty"><p>Vasteid ei leitud. Proovi teist märksõna.</p></div> : null}
        </> : <div className="store-directory__grid">
          {stores.map((store, index) => <StoreCard key={store.id} store={store} index={index} visitUrl={getStoreDirectoryVisitUrl(store)} />)}
          {storeDirectoryExamples.map((store, index) => <StoreCard key={store.id} store={store} index={stores.length + index} visitUrl={store.url} isExample />)}
        </div>}
      </div>
      {!isSearching ? <>
        <DailyHoroscope />
        <DirectoryStories />
      </> : null}
    </section>
  </StoreDirectoryLayout>
}
