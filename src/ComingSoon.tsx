import { useEffect, useState } from 'react'
import { Brand, BrandMark } from './Brand'
import { applySeoMetadata } from './lib/seo'
import { getPublicShowcaseStore, listProducts } from './lib/database'
import { isSupabaseConfigured } from './lib/supabase'
import type { Product } from './products'
import './coming-soon.css'

const isSupabaseImage = (value: string) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return Boolean(supabaseUrl && value.startsWith(`${supabaseUrl}/storage/v1/`))
}

export default function ComingSoon() {
  const [showcaseProducts, setShowcaseProducts] = useState<Product[]>([])

  useEffect(() => {
    applySeoMetadata({
      title: 'Poeruum — varsti avame',
      description: 'Poeruum on lihtne Eesti e-poeplatvorm toodete, maksete, tarne ja tellimuste haldamiseks.',
      canonicalUrl: 'https://poeruum.ee/',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Poeruum',
        url: 'https://poeruum.ee/',
      },
    })
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    getPublicShowcaseStore()
      .then((store) => store ? listProducts(store.id) : [])
      .then((items) => {
        if (active) setShowcaseProducts(items.filter((product) => isSupabaseImage(product.image)).slice(0, 3))
      })
      .catch(() => {
        if (active) setShowcaseProducts([])
      })
    return () => { active = false }
  }, [])

  return <main className="coming-soon">
    <header className="coming-soon__header">
      <Brand />
    </header>

    <section className="coming-soon__intro">
      <h1>Varsti<br /><em>avame.</em></h1>
    </section>

    <section className="coming-soon__showcase" aria-label="Näide Poeruumi e-poest">
      <div className="coming-soon__halo" aria-hidden="true" />
      {showcaseProducts.map((product, index) => <article className={`coming-soon__product coming-soon__product--${index + 1}`} key={product.name}>
        <img src={product.image} alt="" />
        <div className="coming-soon__shade" />
        <div className="coming-soon__progress"><i /><i /><i /></div>
        <div className="coming-soon__shop">
          <BrandMark className="coming-soon__shop-mark" />
          <strong>POERUUM</strong>
        </div>
        <button type="button" tabIndex={-1} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M7 9V7a5 5 0 0 1 10 0v2M5 9h14l-1 11H6L5 9Z" /></svg>
        </button>
        <footer>
          <div><small>UUS LEID</small><strong>{product.name}</strong></div>
          <span>{product.price == null ? '' : `${product.price.toFixed(0)} €`}</span>
        </footer>
      </article>)}
    </section>

    <div className="coming-soon__index"><span aria-hidden="true">01</span><i aria-hidden="true" /><span aria-hidden="true">03</span></div>
  </main>
}
