import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrandMark } from '../Brand'
import StripeAddressGuide from '../StripeAddressGuide'
import type { StripeRequirementSummary } from '../lib/stripeRequirements'
import '../styles.css'
import '../platform.css'
import './stripeAddressPreview.css'

type PreviewMode = 'onboarding' | 'remediation' | 'management'

const rejectedDocument: StripeRequirementSummary = {
  dueCount: 1,
  pastDue: true,
  currentDeadline: null,
  pendingVerification: false,
  disabledReason: 'requirements.past_due',
  issues: [{ code: 'verification_document_address_mismatch', requirement: 'company.verification.document' }],
}

const titles: Record<PreviewMode, string> = {
  onboarding: 'Stripe’i konto seadistamine',
  remediation: 'Ettevõtte andmete kinnitamine',
  management: 'Stripe’i andmed',
}

function StripeAddressPreview() {
  const [mode, setMode] = useState<PreviewMode>(new URLSearchParams(window.location.search).get('vaade') === 'viga' ? 'remediation' : 'onboarding')
  const [mobile, setMobile] = useState(false)

  return <main className="address-preview">
    <header className="address-preview__intro">
      <span>Poeruum · Eelvaade</span>
      <h1>Maksete seadistamine</h1>
      <p>Poeruumi tegelik aadressijuhis näidisandmetega. Konto loomist pole vaja.</p>
    </header>
    <nav className="address-preview__controls" aria-label="Eelvaate valikud">
      <div aria-label="Olukord">
        {([['onboarding', 'Uus seadistamine'], ['remediation', 'Aadressi viga'], ['management', 'Andmete muutmine']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
      </div>
      <button type="button" aria-pressed={mobile} onClick={() => setMobile(!mobile)}>Telefonivaade</button>
    </nav>
    <div className={`address-preview__stage${mobile ? ' is-mobile' : ''}`}>
      <section className={`stripe-embedded is-${mode}`} aria-label={titles[mode]}>
        <header><div>
          {mode === 'remediation'
            ? <BrandMark className="stripe-embedded__poeruum-mark" />
            : <i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="" /></i>}
          <span><strong>{titles[mode]}</strong><small>{mode === 'onboarding' ? 'Maksete vastuvõtt' : 'Ettevõtte andmed ja kontrollid'}</small></span>
        </div></header>
        <StripeAddressGuide
          businessAddress="Näidise 7–3, Tartu linn, Tartu maakond, 51004"
          requirements={mode === 'onboarding' ? null : rejectedDocument}
          onManage={mode === 'remediation' ? () => setMode('management') : undefined}
        />
        <div className="address-preview__stripe-placeholder" aria-live="polite">
          <span>Stripe’i vormi asukoht</span>
          <h2>{mode === 'management' ? 'Ettevõtte andmete muutmine' : mode === 'remediation' ? 'Dokumendi uuesti esitamine' : 'Ettevõtte ja esindaja andmed'}</h2>
          <p>{mode === 'management'
            ? 'Päris kasutamisel avaneb siin Stripe’i kontohaldus, kus saab aadressi parandada.'
            : 'Päris kasutamisel avaneb siin Stripe’i turvaline vorm. Eelvaates saab tutvuda selle juurde lisatud juhistega.'}</p>
          <small>Stripe’i enda vorm pole selles eelvaates ühendatud.</small>
          {mode === 'management' && <button type="button" onClick={() => setMode('remediation')}>Tagasi aadressivea näitesse</button>}
        </div>
      </section>
    </div>
  </main>
}

// This standalone page is served by Vite during development and is not a
// production build entry. It never initializes Supabase or Stripe sessions.
if (import.meta.env.DEV) {
  createRoot(document.getElementById('root')!).render(<StripeAddressPreview />)
}
