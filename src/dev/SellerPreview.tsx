import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Brand } from '../Brand'
import '../styles.css'
import './sellerPreview.css'

type View = 'setup' | 'settings' | 'buyer' | 'document' | 'credit'
const views: Array<[View, string]> = [['setup', 'Poe loomine'], ['settings', 'Müüja seaded'], ['buyer', 'Ostja vaade'], ['document', 'Müügitõend'], ['credit', 'Tagastus']]

function SellerPreview() {
  const [session, setSession] = useState('')
  const [showTestData, setShowTestData] = useState(false)
  const [view, setView] = useState<View>('setup')
  const [mobile, setMobile] = useState(new URLSearchParams(window.location.search).get('phone') === '1')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError(''); setSession('')
    const existing = new URLSearchParams(window.location.search).get('session')
    const resume = existing && attempt === 0
    fetch(resume ? `/__preview/sessions/${existing}/data` : '/__preview/sessions', resume ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'app', screen: 'store', sellerPreview: true, sellerType: 'entrepreneur' }),
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        if (!active) return
        const id = resume ? existing : data.id
        const url = new URL(window.location.href)
        url.searchParams.set('session', id)
        window.history.replaceState({}, '', url)
        setSession(id)
      })
      .catch(() => { if (active) setError('Eelvaade aegus. Vali „Alusta uuesti”.') })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (mobile) url.searchParams.set('phone', '1')
    else url.searchParams.delete('phone')
    window.history.replaceState({}, '', url)
  }, [mobile])
  const url = view === 'setup' ? `/?preview_session=${session}`
    : view === 'document' || view === 'credit' ? `/__preview/sessions/${session}/document${view === 'credit' ? '?kind=credit' : ''}`
      : `/previews/seller-store.html?session=${session}&view=${view}`
  return <main className="seller-preview">
    <header><Brand /><span className="seller-preview__badge">Eelvaade · testandmed</span><button type="button" onClick={() => { setView('setup'); setAttempt((value) => value + 1) }}>Alusta uuesti ↺</button></header>
    <div className="seller-preview__bar">
      <nav aria-label="Eelvaate vaated">{views.map(([key, label]) => <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => { setError(''); setView(key) }}>{label}</button>)}</nav>
      <div className="seller-preview__devices" aria-label="Ekraani suurus"><button aria-pressed={!mobile} onClick={() => setMobile(false)}>Arvuti</button><button aria-pressed={mobile} onClick={() => setMobile(true)}>Telefon</button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className={`seller-preview__stage${mobile ? ' is-mobile' : ''}`}>
      {session ? <iframe key={`${view}-${session}`} title="Poeruumi müüja eelvaade" src={url} allow="camera; microphone" /> : <span role="status">Avan eelvaadet…</span>}
    </div>
    <footer><span>Stripe’i testkeskkond · päris raha ei liigu</span><button type="button" aria-expanded={showTestData} aria-controls="seller-test-data" onClick={() => setShowTestData((value) => !value)}>Testandmed {showTestData ? '−' : '+'}</button></footer>
    {showTestData && <aside id="seller-test-data" className="seller-preview__test-data" aria-label="Stripe’i testandmed">
      <header><h2>Testandmed</h2><button type="button" onClick={() => setShowTestData(false)} aria-label="Sulge testandmed">×</button></header>
      <p>Kasuta neid andmeid Stripe’i vormis.</p>
      <dl>{[
        ['Sünnikuupäev', '01.01.1902'], ['Telefon', '+372 0000000'], ['Tänav ja maja', 'address_full_match'],
        ['Linn', 'Tallinn'], ['Maakond', 'Harjumaa'], ['Postiindeks', '10111'], ['Isikukood, kui küsitakse', '000000000'],
        ['Tegevusvaldkond', 'Jaemüük → Muud kaubad'],
        ['IBAN', 'EE382200221020145685'], ['Veebileht', 'https://accessible.stripe.com'], ['SMS-kood, kui küsitakse', '000000'],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><input aria-label={label} readOnly value={value} onFocus={(event) => event.currentTarget.select()} /></dd></div>)}</dl>
      <a href="https://d37ugbyn3rpeym.cloudfront.net/docs/identity/success.png" target="_blank" rel="noreferrer">Stripe’i näidisdokument ↗</a>
    </aside>}
  </main>
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<SellerPreview />)
