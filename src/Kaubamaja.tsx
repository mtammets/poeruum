import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryHighlights, getStoreDirectoryVisitUrl, normalizeStoreDirectoryCatalog, storeDirectoryExamples } from '../shared/store-directory.mjs'
import { getHoroscopeShareMetadata, getHoroscopeSignFromLocation } from '../shared/horoscope-share.mjs'
import DailyHoroscope from './DailyHoroscope'
import DirectoryHero, { directoryHeroSlides } from './DirectoryHero'
import DirectoryStories from './DirectoryStories'
import DirectoryStoryHero from './DirectoryStoryHero'
import { useDirectoryStories } from './useDirectoryStories'
import DirectoryStoryPage from './DirectoryStoryPage'
import StoreDirectoryLayout, { ArrowUpRight } from './StoreDirectoryLayout'
import StoreDirectoryCardContent from './StoreDirectoryCardContent'
import { listPublicStoreDirectory } from './lib/database'
import { createStoreDirectorySearch, type DirectoryProductResult } from './lib/directorySearch'
import { applySeoMetadata } from './lib/seo'
import { isSupabaseConfigured } from './lib/supabase'
import { startDirectoryAnalytics, trackDirectoryEvent } from './lib/directoryAnalytics'
import { useDirectoryImpression } from './useDirectoryImpression'
import { useDirectoryTheme } from './lib/directoryTheme'
import DirectoryCampaignProvider from './DirectoryCampaignProvider'
import KrukStoreCard from './themes/black-friday/KrukStoreCard'
import KrukModelAd from './themes/black-friday/KrukModelAd'

const directoryUrl = 'https://kaubamaja.poeruum.ee/'
const directoryName = 'Poeruumi Kaubamaja'
const directorySeoTitle = `${directoryName} – avasta Eesti väikeettevõtjate e-poode`
const directoryDescription = directoryHeroSlides[0].description
const productPageSize = 24

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

const readHighlightSeed = () => {
  const value = document.getElementById('poeruum-store-directory-data')?.dataset.highlightSeed
  const seed = value ? Number(value) : Number.NaN
  return Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 ? seed : Math.floor(Math.random() * 2 ** 32)
}

let directoryRequest: ReturnType<typeof listPublicStoreDirectory> | null = null
const loadStores = () => {
  directoryRequest ??= listPublicStoreDirectory().finally(() => { directoryRequest = null })
  return directoryRequest
}

const StoreCard = ({ store, index, visitUrl, isExample = false, placement = 'directory' }: {
  store: Pick<StoreDirectoryEntry, 'id' | 'name' | 'description' | 'imageUrl' | 'logoUrl'>
  index: number
  visitUrl: string
  isExample?: boolean
  placement?: 'directory' | 'search'
}) => {
  const ref = useDirectoryImpression(isExample ? null : store.id, placement, index + 1)
  const open = () => {
    if (!isExample) trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement, position: index + 1 })
  }

  return <article className="store-directory__card" ref={ref}>
    <a className="store-directory__card-link" href={visitUrl} onClick={open} onAuxClick={(event) => { if (event.button === 1) open() }} aria-label={isExample ? `${store.name} – loo oma pood Poeruumis` : `Ava pood ${store.name}`}>
      <StoreDirectoryCardContent store={store} index={index} isExample={isExample} />
    </a>
  </article>
}

const ProductCard = ({ store, product, index, placement = 'search' }: DirectoryProductResult & { index: number; placement?: 'directory' | 'search' }) => {
  const open = () => trackDirectoryEvent({ event_name: 'product_click', store_id: store.id, product_id: product.id, placement, position: index + 1 })
  return <article className={`store-directory__product${placement === 'directory' ? ' store-directory__product--highlight' : ''}`}>
  <a href={getStoreDirectoryVisitUrl(store, product)} onClick={open} onAuxClick={(event) => { if (event.button === 1) open() }} aria-label={`${product.name} – ${store.name}`}>
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
      {placement === 'directory' ? <span className="store-directory__product-action" aria-hidden="true">Vaata toodet <ArrowUpRight /></span> : <ArrowUpRight />}
    </div>
  </a>
</article>
}

export default function Kaubamaja() {
  return <DirectoryCampaignProvider>
    {/^\/lood(?:\/|$)/.test(window.location.pathname) ? <DirectoryStoryPage /> : <StoreDirectory />}
  </DirectoryCampaignProvider>
}

function StoreDirectory() {
  const stories = useDirectoryStories()
  const isBlackFriday = useDirectoryTheme().theme === 'black-friday'
  const featuredStory = isBlackFriday ? undefined : stories.published[0]
  const storyAnchorHandled = useRef(false)
  const [sharedHoroscopeSign, setSharedHoroscopeSign] = useState(() => getHoroscopeSignFromLocation(window.location))
  const [stores, setStores] = useState<StoreDirectoryEntry[]>(readInitialStores)
  const [highlightSeed] = useState(readHighlightSeed)
  const [query, setQuery] = useState(() => (new URLSearchParams(window.location.search).get('q') || '').slice(0, 160))
  const [productLimit, setProductLimit] = useState(productPageSize)
  const searchInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    isSupabaseConfigured ? 'loading' : 'ready',
  )
  const campaignStore = isBlackFriday ? stores.find(store => store.slug === 'kruk-kruk') : undefined
  const directoryStores = useMemo(() => campaignStore
    ? [campaignStore, ...stores.filter(store => store.id !== campaignStore.id)]
    : stores, [stores, campaignStore])
  const search = useMemo(() => createStoreDirectorySearch(stores), [stores])
  const highlights = useMemo(() => getStoreDirectoryHighlights(
    campaignStore ? stores.filter(store => store.id !== campaignStore.id) : stores,
    highlightSeed,
  ), [stores, highlightSeed, campaignStore])
  const heroProducts = useMemo(() => highlights.slice(0, 4), [highlights])
  const directoryHeroImage = featuredStory ? new URL(featuredStory.image, directoryUrl).href : heroProducts[0]?.product.imageUrl || `${directoryUrl}images/poeruum-email-logo.png`
  const results = useMemo(() => search(query), [search, query])
  const isSearching = query.trim().length > 0
  const hasResults = results.stores.length > 0 || results.products.length > 0
  const lastSearch = useRef('')

  useEffect(() => startDirectoryAnalytics(), [])
  useEffect(() => {
    const normalized = query.trim().toLocaleLowerCase('et')
    if (!normalized) { lastSearch.current = ''; return }
    if (normalized.length < 2 || status !== 'ready' || normalized === lastSearch.current) return
    const timer = setTimeout(() => {
      lastSearch.current = normalized
      trackDirectoryEvent({ event_name: 'search', result_count: Math.min(100000, results.stores.length + results.products.length) })
    }, 700)
    return () => clearTimeout(timer)
  }, [query, status, results])

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
    const sharedHoroscope = getHoroscopeShareMetadata(sharedHoroscopeSign)
    applySeoMetadata({
      title: sharedHoroscope?.title || directorySeoTitle,
      description: sharedHoroscope?.description || directoryDescription,
      canonicalUrl: sharedHoroscope?.url || directoryUrl,
      socialUrl: sharedHoroscope?.url,
      imageUrl: sharedHoroscope?.image || directoryHeroImage,
      imageWidth: sharedHoroscope?.imageWidth,
      imageHeight: sharedHoroscope?.imageHeight,
      imageType: sharedHoroscope?.imageType,
      structuredData,
    })
  }, [structuredData, directoryHeroImage, sharedHoroscopeSign])

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
    const sharedHoroscope = getHoroscopeShareMetadata(getHoroscopeSignFromLocation(window.location))
    const target = window.location.hash.slice(1) || (sharedHoroscope ? 'horoskoop' : '')
    if (target === 'store-directory-heading' || target === 'horoskoop') {
      document.getElementById(target)?.scrollIntoView({ behavior: 'instant' })
    }
  }, [status])

  useEffect(() => {
    if (!stories.published.length || storyAnchorHandled.current) return
    storyAnchorHandled.current = true
    if (window.location.hash === '#poeruumi-lood') {
      document.getElementById('poeruumi-lood')?.scrollIntoView({ behavior: 'instant' })
    }
  }, [stories.published.length])

  return <StoreDirectoryLayout campaignStore={campaignStore}>
    {!isBlackFriday && (featuredStory ? <DirectoryStoryHero key={featuredStory.slug} story={featuredStory} isOnlyStory={stories.published.length === 1} />
      : <DirectoryHero products={heroProducts} />)}

    {!isBlackFriday && <div className="store-directory__marquee" aria-hidden="true">
      <div className="store-directory__marquee-track">
        {[0, 1].map((group) => <div className="store-directory__marquee-group" key={group}>
          {marqueeLoop.map((message, index) => <span key={`${group}-${index}`}>{message}<i>✦</i></span>)}
        </div>)}
      </div>
    </div>}


    {!isSearching && highlights.length > 0 && <section className="store-directory__highlights" aria-labelledby="directory-products-heading">
      <div className="store-directory__section-head"><div>
        <h2 id="directory-products-heading">Parimad kingiideed</h2>
        <p className="store-directory__highlights-intro">Valik tooteid Eesti e-poodidest.</p>
      </div></div>
      <div className="store-directory__product-grid">
        {highlights.map((result, index) => <ProductCard key={`${result.store.id}:${result.product.id}`} {...result} index={index} placement="directory" />)}
      </div>
    </section>}

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
              {results.products.slice(0, productLimit).map((result, index) => <ProductCard
                key={`${result.store.id}:${result.product.id}`} {...result} index={index} />)}
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
              {results.stores.map((store, index) => <StoreCard key={store.id} store={store} index={index} visitUrl={getStoreDirectoryVisitUrl(store)} placement="search" />)}
            </div>
          </section> : null}
          {!hasResults && (stores.length > 0 || status === 'ready') ? <div className="store-directory__empty"><p>Vasteid ei leitud. Proovi teist märksõna.</p></div> : null}
        </> : <div className="store-directory__grid">
          {directoryStores.map((store, index) => store.id === campaignStore?.id
            ? <KrukStoreCard key={store.id} store={store} index={index} />
            : <StoreCard key={store.id} store={store} index={index} visitUrl={getStoreDirectoryVisitUrl(store)} />)}
          {storeDirectoryExamples.map((store, index) => <StoreCard key={store.id} store={store} index={stores.length + index} visitUrl={store.url} isExample />)}
          {campaignStore && (directoryStores.length - 1 + storeDirectoryExamples.length) % 2 === 1 &&
            <KrukModelAd store={campaignStore} index={directoryStores.length + storeDirectoryExamples.length} />}
        </div>}
      </div>
      {!isSearching ? <>
        <DailyHoroscope onSignChange={() => setSharedHoroscopeSign(getHoroscopeSignFromLocation(window.location))} />
        <DirectoryStories {...stories} published={stories.published.slice(featuredStory ? 1 : 0)} />
      </> : null}
    </section>
  </StoreDirectoryLayout>
}
