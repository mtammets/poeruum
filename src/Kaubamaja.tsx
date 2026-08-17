import { useEffect, useMemo, useState } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { normalizeStoreDirectoryCatalog } from '../shared/store-directory.mjs'
import { Brand } from './Brand'
import { listPublicStoreDirectory } from './lib/database'
import { applySeoMetadata } from './lib/seo'
import { isSupabaseConfigured } from './lib/supabase'

const directoryUrl = 'https://kaubamaja.poeruum.ee/'
const directoryDescription = 'Avasta Poeruumi poed.'

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

const StoreCard = ({ store, index }: { store: StoreDirectoryEntry; index: number }) => (
  <a className="store-directory__card" href={store.url} aria-label={`Ava pood ${store.name}`}>
    <span className="store-directory__media">
      <span className="store-directory__monogram" aria-hidden="true">{store.name.charAt(0)}</span>
      {store.imageUrl ? <img
        src={store.imageUrl}
        alt=""
        loading={index < 2 ? 'eager' : 'lazy'}
        fetchPriority={index === 0 ? 'high' : 'auto'}
        decoding="async"
        onError={(event) => event.currentTarget.remove()}
      /> : null}
    </span>
    <span className="store-directory__card-shade" aria-hidden="true" />
    <span className="store-directory__card-title"><strong>{store.name}</strong><i aria-hidden="true">↗</i></span>
  </a>
)

export default function Kaubamaja() {
  const [stores, setStores] = useState<StoreDirectoryEntry[]>(readInitialStores)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    isSupabaseConfigured ? 'loading' : 'ready',
  )

  const structuredData = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Kaubamaja',
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
      title: 'Kaubamaja — Poeruum',
      description: directoryDescription,
      canonicalUrl: directoryUrl,
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
    <nav className="store-directory__nav" aria-label="Kaubamaja">
      <a className="store-directory__brand" href="https://poeruum.ee/" aria-label="Poeruumi avaleht"><Brand /></a>
      <a className="store-directory__create" href="https://poeruum.ee/#hind">Loo oma pood <span aria-hidden="true">↗</span></a>
    </nav>

    <header className="store-directory__hero">
      <h1>Kaubamaja</h1>
      <p>{directoryDescription}</p>
    </header>

    {stores.length > 0 ? <section className="store-directory__grid" aria-label="Poed">
      {stores.map((store, index) => <StoreCard key={store.id} store={store} index={index} />)}
    </section> : <section className="store-directory__empty" aria-live="polite">
      {status === 'loading'
        ? <span className="store-directory__loader" aria-label="Laadin poode" />
        : <p>{status === 'error' ? 'Poode ei õnnestunud praegu laadida.' : 'Uued poed jõuavad siia peagi.'}</p>}
    </section>}

    <footer className="store-directory__footer">
      <a href="https://poeruum.ee/">Poeruum</a>
      <a href="https://poeruum.ee/#hind">Loo oma pood <span aria-hidden="true">→</span></a>
    </footer>
  </main>
}
