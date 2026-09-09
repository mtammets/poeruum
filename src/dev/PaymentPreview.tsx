import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Brand } from '../Brand'
import '../styles.css'
import '../platform.css'
import './paymentPreview.css'

type Screen = 'store' | 'business' | 'payments' | 'shipping' | 'product' | 'publish'
type PaymentState = 'idle' | 'incomplete' | 'reviewing' | 'connected' | 'requirements'
type Preset = 'new' | 'business' | 'person' | 'address'
type Selection = { kind: 'app' | 'stripe'; screen: Screen; paymentState: PaymentState; preset: Preset }
const screens: Array<[Screen, string]> = [['store', 'Poe nimi'], ['business', 'Müüja andmed'], ['payments', 'Maksed'], ['shipping', 'Tarne'], ['product', 'Esimene toode'], ['publish', 'Avaldamine']]
const states: Array<[PaymentState, string]> = [['idle', 'Ühendamata'], ['incomplete', 'Seadistus pooleli'], ['reviewing', 'Kontrollimisel'], ['connected', 'Maksed aktiivsed'], ['requirements', 'Andmed vajavad parandamist']]
const presets: Array<[Preset, string, string]> = [
  ['new', 'Uus ühendamine', 'Sama algus nagu Poeruumis: ettevõtte nimi, registrikood ja e-post on teada.'],
  ['business', 'Ettevõtte andmed täidetud', 'Ettevõtte tegevuskoha aadress, liik ja telefon on juba lisatud.'],
  ['person', 'Esindaja andmed täidetud', 'Lisatud on ka ettevõtte esindaja, kes on ühtlasi omanik ja juhatuse liige.'],
  ['address', 'Aadressi kontroll ei õnnestu', 'Stripe’i testaadress käivitab ettevõtte aadressi täiendamise nõude.'],
]
const stepLabels: Record<string, string> = {
  business_type: 'Ettevõtte liik', business_details: 'Ettevõtte andmed', business_representative: 'Ettevõtte esindaja',
  business_owners: 'Omanikud', external_account: 'Pangakonto', summary: 'Andmete ülevaade',
  legal_entity: 'Ettevõtte andmed', individual: 'Isikuandmed', requirements: 'Andmete täiendamine',
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/__preview/${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Käivita maksete eelvaade käsuga npm run dev:payments ja ava http://127.0.0.1:4185/previews/payments.html.')
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Eelvaate avamine ebaõnnestus.')
  return result
}

function PaymentPreview() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'app', screen: 'payments', paymentState: 'idle', preset: 'new' })
  const [mobile, setMobile] = useState(true)
  const [frameUrl, setFrameUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [copied, setCopied] = useState('')
  const [attempt, setAttempt] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let active = true
    void request<{ ready: boolean }>('config').then((config) => { if (active) setReady(config.ready) })
      .catch((problem) => { if (active) setError(problem.message) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (ready === null || (selection.kind === 'stripe' && !ready)) { setFrameUrl(''); return }
    let active = true
    setBusy(true)
    setError('')
    setSteps([])
    setFrameUrl('')
    void request<{ url: string }>('sessions', selection).then((session) => {
      if (active) setFrameUrl(session.url)
    }).catch((problem) => { if (active) setError(problem.message) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [ready, selection, attempt])

  useEffect(() => {
    const observe = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'poeruum-stripe-step' || typeof event.data.step !== 'string') return
      setSteps((current) => current.at(-1) === event.data.step ? current : [...current, event.data.step].slice(-30))
    }
    window.addEventListener('message', observe)
    return () => window.removeEventListener('message', observe)
  }, [])

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value) }
    catch { setCopied('Kopeeri väärtus tekstist.') }
  }

  return <main className="payment-preview">
    <header className="payment-preview__header"><Brand /><span className="payment-preview__badge">Eelvaade</span>
      <span className={`payment-preview__connection${ready ? ' is-ready' : ''}`}>{ready === null ? 'Kontrollin ühendust…' : ready ? 'Stripe’i testvõtmed olemas' : 'Stripe’i testvõtmed lisamata'}</span>
    </header>
    <div className="payment-preview__workspace">
      <aside className="payment-preview__sidebar">
        <div className="payment-preview__tabs" aria-label="Eelvaate sisu">{([['app', 'Poeruumi vaated'], ['stripe', 'Stripe’i vorm']] as const).map(([kind, label]) => <button key={kind} type="button" aria-pressed={selection.kind === kind} onClick={() => setSelection((current) => current.kind === kind ? current : ({ ...current, kind }))}>{label}</button>)}</div>
        {selection.kind === 'app' ? <>
          <p className="payment-preview__section-label">Poe loomise samm</p>
          <nav className="payment-preview__screens" aria-label="Poe loomise samm">{screens.map(([screen, label], index) => <button key={screen} type="button" aria-current={selection.screen === screen ? 'step' : undefined} onClick={() => setSelection((current) => current.screen === screen ? current : ({ ...current, screen }))}><span>{String(index + 1).padStart(2, '0')}</span>{label}<b aria-hidden="true">→</b></button>)}</nav>
          <label className="payment-preview__select">Maksete olukord<select value={selection.paymentState} onChange={(event) => setSelection((current) => ({ ...current, paymentState: event.target.value as PaymentState }))}>{states.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="payment-preview__note">Need on rakenduse tegelikud vaated näidisandmetega. Olekud on ette valmistatud, et saaksid neid kohe võrrelda. Uue valikuga algab uus näidiskatse.</p>
        </> : <>
          <p className="payment-preview__section-label">Stripe’i testolukord</p>
          <div className="payment-preview__presets">{presets.map(([preset, label, detail]) => <button type="button" key={preset} aria-pressed={selection.preset === preset} onClick={() => setSelection((current) => current.preset === preset ? current : ({ ...current, preset }))}><strong>{label}</strong><small>{detail}</small></button>)}</div>
          <p className="payment-preview__note">Iga olukord avab uue Eesti ettevõtte testkonto. Stripe määrab nähtavad sammud puuduva info järgi; eeltäitmine ei taga kindla sammu avanemist.</p>
          <details className="payment-preview__test-data" open><summary>Andmed vormi proovimiseks</summary><p>Kasuta väljamõeldud ettevõtte ja inimese andmeid. Need väärtused on Stripe’i testimiseks.</p>
            {[
              ['SMS-i kinnituskood', '000000'], ['Sünnikuupäev', '01.01.1901'], ['Eesti test-IBAN', 'EE382200221020145685'],
            ].map(([label, value]) => <div key={label}><span>{label}<code>{value}</code></span><button type="button" onClick={() => void copy(value)} aria-label={`Kopeeri ${label}`}>{copied === value ? '✓' : 'Kopeeri'}</button></div>)}
            <a href="https://docs.stripe.com/connect/testing" target="_blank" rel="noreferrer">Stripe’i testandmed ja dokumendipildid ↗</a>
          </details>
          {steps.length > 0 && <details className="payment-preview__step-log"><summary>Vormis nähtud sammud ({steps.length})</summary><ol>{steps.map((step, index) => <li key={`${step}-${index}`}>{stepLabels[step] ?? step.replaceAll('_', ' ')}</li>)}</ol></details>}
        </>}
      </aside>
      <section className="payment-preview__stage" aria-label="Valitud vaate eelvaade">
        <div className="payment-preview__toolbar"><div aria-label="Ekraani suurus"><button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>Telefon</button><button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>Arvuti</button></div><button type="button" disabled={busy || (selection.kind === 'stripe' && !ready)} onClick={() => setAttempt((value) => value + 1)}>Alusta uuesti ↺</button></div>
        {error && <div className="payment-preview__error" role="alert">{error}</div>}
        {selection.kind === 'stripe' && ready === false ? <div className="payment-preview__empty"><span aria-hidden="true">↗</span><h2>Ühenda Stripe’i testkeskkond</h2><p>Vormi nägemiseks lisa sama Stripe’i testkeskkonna võtmed projekti <code>.env.local</code> faili.</p><pre>STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…{'\n'}STRIPE_TEST_SECRET_KEY=sk_test_…</pre><p>Seejärel käivita <code>npm run dev:payments</code> uuesti. Poeruumi vaateid saad juba praegu proovida.</p></div>
          : busy ? <div className="payment-preview__empty" role="status"><h2>Valmistan eelvaadet…</h2></div>
            : frameUrl && <div className={`payment-preview__device${mobile ? ' is-mobile' : ''}`}><iframe ref={frame} title="Poeruumi maksete teekonna eelvaade" src={frameUrl} allow="camera; microphone; clipboard-write" /></div>}
      </section>
    </div>
    <footer className="payment-preview__footer">Poeruumi andmed on selles eelvaates ajutised. Tugikirju ei saadeta. Stripe’i testkontod eemaldatakse eelvaateserveri tavalisel sulgemisel.</footer>
  </main>
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<PaymentPreview />)
