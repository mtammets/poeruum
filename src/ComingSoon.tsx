import { useEffect } from 'react'
import { Brand, BrandMark } from './DemoApp'
import { applySeoMetadata } from './lib/seo'
import './coming-soon.css'

const showcaseProducts = [
  { name: 'Lamp Sammal', price: '79 €', image: '/images/demo/lamp_sammal.webp' },
  { name: 'Vaas Laine', price: '49 €', image: '/images/demo/vaas_laine.webp' },
  { name: 'Alus Täpe', price: '39 €', image: '/images/demo/alus_tape.webp' },
]

export default function ComingSoon() {
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
          <span>{product.price}</span>
        </footer>
      </article>)}
    </section>

    <div className="coming-soon__index"><span aria-hidden="true">01</span><i aria-hidden="true" /><span aria-hidden="true">03</span></div>
  </main>
}
