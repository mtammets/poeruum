import { useEffect } from 'react'
import { Brand } from './DemoApp'
import './coming-soon.css'

const showcaseProducts = [
  { name: 'Kaktusekuju', price: '32 €', image: '/images/demo/kaktus_1.jpg' },
  { name: 'Puidust kass', price: '45 €', image: '/images/demo/kass_1.jpg' },
  { name: 'Inglitega taldrik', price: '29 €', image: '/images/demo/taldrik_1.jpg' },
]

export default function ComingSoon() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Poeruum — varsti avame'
    return () => { document.title = previousTitle }
  }, [])

  return <main className="coming-soon">
    <header className="coming-soon__header">
      <Brand />
      <span className="coming-soon__opening"><i /> Avame peagi</span>
    </header>

    <section className="coming-soon__intro">
      <span>POERUUM.EE</span>
      <h1>Varsti<br /><em>avame.</em></h1>
    </section>

    <section className="coming-soon__showcase" aria-label="Näide Poeruumi e-poest">
      <div className="coming-soon__halo" aria-hidden="true" />
      {showcaseProducts.map((product, index) => <article className={`coming-soon__product coming-soon__product--${index + 1}`} key={product.name}>
        <img src={product.image} alt="" />
        <div className="coming-soon__shade" />
        <div className="coming-soon__progress"><i /><i /><i /></div>
        <div className="coming-soon__shop">
          <span>VA</span>
          <strong>VEIDRAD ASJAD</strong>
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

    <div className="coming-soon__index" aria-hidden="true"><span>01</span><i /><span>03</span></div>
  </main>
}
