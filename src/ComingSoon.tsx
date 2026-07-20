import { useEffect } from 'react'
import './coming-soon.css'

function PoeruumLogo() {
  return <div className="coming-soon__brand" aria-label="Poeruum">
    <span className="coming-soon__logo" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <rect x="1" y="1" width="38" height="38" rx="11" />
        <path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z" />
        <path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18" />
        <path d="M15.5 22.2h9" />
      </svg>
    </span>
    <strong>Poe<span>ruum</span></strong>
  </div>
}

export default function ComingSoon() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Poeruum — varsti avame'
    return () => { document.title = previousTitle }
  }, [])

  return <main className="coming-soon">
    <div className="coming-soon__glow coming-soon__glow--top" aria-hidden="true" />
    <div className="coming-soon__glow coming-soon__glow--bottom" aria-hidden="true" />

    <header className="coming-soon__header">
      <PoeruumLogo />
      <span className="coming-soon__status"><i aria-hidden="true" /> Valmistame ette</span>
    </header>

    <section className="coming-soon__content">
      <p className="coming-soon__eyebrow"><span>✦</span> UUS E-POE PLATVORM</p>
      <h1>Paneme veel viimased asjad <em>riiulisse.</em></h1>
      <p className="coming-soon__lead">Poeruum avab peagi uksed. Tule tagasi varsti — loome midagi head Eesti väikestele poodidele.</p>
      <div className="coming-soon__notice">
        <span aria-hidden="true">→</span>
        <div><small>UKSED AVANEVAD</small><strong>Varsti.</strong></div>
      </div>
    </section>

    <aside className="coming-soon__scene" aria-hidden="true">
      <div className="coming-soon__arch">
        <div className="coming-soon__door">
          <span className="coming-soon__door-logo"><PoeruumLogo /></span>
          <i />
        </div>
        <div className="coming-soon__step coming-soon__step--one" />
        <div className="coming-soon__step coming-soon__step--two" />
      </div>
      <span className="coming-soon__spark coming-soon__spark--one">✦</span>
      <span className="coming-soon__spark coming-soon__spark--two">✦</span>
    </aside>

    <footer className="coming-soon__footer">
      <span>© {new Date().getFullYear()} Poeruum</span>
      <span>Üks hea pood vajab natuke ruumi.</span>
    </footer>
  </main>
}
