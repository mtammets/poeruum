import { useEffect } from 'react'
import './coming-soon.css'

export default function ComingSoon() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Poeruum — varsti avame'
    return () => { document.title = previousTitle }
  }, [])

  return <main className="coming-soon">
    <div className="coming-soon__shape" aria-hidden="true">
      <span />
    </div>

    <section className="coming-soon__content">
      <div className="coming-soon__wordmark" aria-label="Poeruum">Poe<span>ruum</span></div>
      <h1>Varsti avame.</h1>
    </section>
  </main>
}
