import { useEffect, useRef, useState } from 'react'
import { BillingCardDemo, Storefront, type PaymentProvider, type PricingPlan } from './App'
import { createStore, getMyStore, getStoreBySlug, listProducts, updateStore, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import type { Product } from './products'

type Screen = 'landing' | 'login' | 'account' | 'store' | 'payments' | 'shipping' | 'publish' | 'storefront' | 'sample'

const steps: Array<{ screen: Screen; label: string }> = [
  { screen: 'account', label: 'Konto' },
  { screen: 'store', label: 'Pood' },
  { screen: 'payments', label: 'Maksed' },
  { screen: 'shipping', label: 'Tarne' },
  { screen: 'publish', label: 'Avalda' },
]

function SetupProgress({ screen }: { screen: Screen }) {
  const current = steps.findIndex((step) => step.screen === screen)
  return <div className="setup-progress-wrap">
    <div className="setup-progress" aria-label={`Poe loomine: samm ${current + 1} / ${steps.length}`}>
      {steps.map((step, index) => <div
        className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
        key={step.screen}
        aria-current={index === current ? 'step' : undefined}
      ><i aria-hidden="true" /><span className="sr-only">{step.label}</span></div>)}
    </div>
  </div>
}

const slugify = (value: string) => value
  .toLocaleLowerCase('et')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 38)

const phonePreviewProducts = [
  { name: 'Kaktusekuju', description: 'Skulptuurne kaktus tumedas potis. Taim, mida ei pea kunagi kastma.', price: 32, images: ['/images/demo/kaktus_1.jpg', '/images/demo/kaktus_2.jpg'] },
  { name: 'Puidust kass', description: 'Kõrge ja väärikas käsitsi maalitud puidust kassikuju.', price: 45, images: ['/images/demo/kass_1.jpg', '/images/demo/kass_2.jpg'] },
  { name: 'Inglitega taldrik', description: 'Kuldne dekoratiivtaldrik kolme ruumilise ingliga.', price: 29, images: ['/images/demo/taldrik_1.jpg'] },
]

function Brand() {
  return <div className="demo-brand" aria-label="Poeruum">
    <span className="demo-brand__mark" aria-hidden="true">
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

function FlowHeader({ onBack }: { onBack: () => void }) {
  return <header className="flow-header">
    <Brand />
    <button type="button" onClick={onBack} aria-label="Tagasi eelmisele lehele">← Tagasi</button>
  </header>
}

function SetupShell({ screen, children, onBack }: { screen: Screen; children: React.ReactNode; onBack: () => void }) {
  return <main className={`setup-page${screen === 'publish' ? ' setup-page--publish' : ''}`}>
    <FlowHeader onBack={onBack} />
    <SetupProgress screen={screen} />
    <section className="setup-card">{children}</section>
    <p className="demo-disclaimer">Poe seadistus salvestatakse turvaliselt.</p>
  </main>
}

function StripeConnectDemo({ email, onClose, onComplete }: { email: string; onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isVerifying, setIsVerifying] = useState(false)

  const finishOnboarding = () => {
    setIsVerifying(true)
    window.setTimeout(() => {
      setIsVerifying(false)
      setStep(3)
    }, 900)
  }

  return <div className="stripe-connect-overlay" role="dialog" aria-modal="true" aria-label="Stripe'i ühendamise demo">
    <section className="stripe-connect">
      <header>
        <div className="stripe-connect__brand"><span>S</span><strong>Stripe</strong><small>Connect</small></div>
        <button type="button" onClick={onClose} aria-label="Sulge Stripe'i ühendamine">×</button>
      </header>
      {step < 3 && <div className="stripe-connect__progress" aria-label={`Samm ${step} 2-st`}><span className="is-done" /><span className={step === 2 ? 'is-done' : ''} /></div>}

      {step === 1 && <form className="stripe-connect__form" onSubmit={(event) => { event.preventDefault(); setStep(2) }}>
        <span className="stripe-connect__eyebrow">SAMM 1 / 2</span>
        <h2>Alustame sinu ettevõttest</h2>
        <p>Stripe kasutab neid andmeid konto kontrollimiseks ja maksete vastuvõtmiseks.</p>
        <label>E-post<input required type="email" defaultValue={email} autoComplete="email" /></label>
        <label>Ettevõtte nimi<input required defaultValue="Mareki pood OÜ" autoComplete="organization" /></label>
        <div className="stripe-connect__row">
          <label>Riik<select defaultValue="EE"><option value="EE">Eesti</option></select></label>
          <label>Ettevõtte tüüp<select defaultValue="company"><option value="company">Ettevõte</option><option value="individual">FIE / eraisik</option></select></label>
        </div>
        <button className="stripe-connect__next" type="submit">Jätka <span>→</span></button>
      </form>}

      {step === 2 && <form className="stripe-connect__form" onSubmit={(event) => { event.preventDefault(); finishOnboarding() }}>
        <span className="stripe-connect__eyebrow">SAMM 2 / 2</span>
        <h2>Kuhu müügitulu kanda?</h2>
        <p>Lisa konto, kuhu Stripe teeb sinu poe väljamakseid.</p>
        <label>Kontoomaniku nimi<input required defaultValue="Mareki pood OÜ" autoComplete="organization" /></label>
        <label>IBAN<div className="stripe-connect__iban"><span>🇪🇪</span><input required defaultValue="EE38 2200 2210 2014 685" inputMode="text" /></div></label>
        <div className="stripe-connect__summary"><div><span>Väljamaksed</span><strong>Automaatselt</strong></div><div><span>Valuuta</span><strong>EUR</strong></div><div><span>Esimene väljamakse</span><strong>7–14 päeva</strong></div></div>
        <label className="stripe-connect__consent"><input required type="checkbox" defaultChecked /><span>Kinnitan, et andmed on õiged ja nõustun Stripe’i teenusetingimustega.</span></label>
        <div className="stripe-connect__buttons"><button type="button" onClick={() => setStep(1)}>← Tagasi</button><button className="stripe-connect__next" type="submit" disabled={isVerifying}>{isVerifying ? 'Kontrollin…' : 'Ühenda konto'} <span>{isVerifying ? '◌' : '→'}</span></button></div>
      </form>}

      {step === 3 && <div className="stripe-connect__success">
        <div className="stripe-connect__check">✓</div>
        <span className="stripe-connect__eyebrow">ÜHENDUS VALMIS</span>
        <h2>Stripe on sinu poega ühendatud</h2>
        <p>Kliendid saavad maksta kaardi, Apple Pay ja Google Payga. Müügitulu liigub otse sinu väljamaksekontole.</p>
        <div className="stripe-connect__account"><span>S</span><div><strong>Mareki pood OÜ</strong><small>Maksete vastuvõtmine aktiivne</small></div><b>AKTIIVNE</b></div>
        <button className="stripe-connect__next" type="button" onClick={onComplete}>Tagasi Poeruumi</button>
      </div>}
      <footer><span>🔒 Stripe’i turvaline ühendus</span><small>Interaktiivne demo · andmeid ei salvestata</small></footer>
    </section>
  </div>
}

function MontonioConnectDemo({ storeName, onClose, onComplete }: { storeName: string; onClose: () => void; onComplete: (status: 'connected' | 'pending') => void }) {
  const [step, setStep] = useState<'choice' | 'existing' | 'apply' | 'success'>('choice')
  const [connectionType, setConnectionType] = useState<'live' | 'sandbox'>('live')
  const [isConnecting, setIsConnecting] = useState(false)

  const connect = (type: 'live' | 'sandbox') => {
    setConnectionType(type)
    setIsConnecting(true)
    window.setTimeout(() => {
      setIsConnecting(false)
      setStep('success')
    }, 900)
  }

  return <div className="stripe-connect-overlay montonio-connect-overlay" role="dialog" aria-modal="true" aria-label="Montonio ühendamise demo">
    <section className="stripe-connect montonio-connect">
      <header><div className="stripe-connect__brand montonio-connect__brand"><span>M</span><strong>Montonio</strong><small>Partner System</small></div><button type="button" onClick={onClose} aria-label="Sulge Montonio ühendamine">×</button></header>

      {step === 'choice' && <div className="montonio-connect__content">
        <span className="stripe-connect__eyebrow">ÜHENDA MAKSED</span><h2>Alusta Montonioga</h2><p>Ühenda olemasolev kaupmehekonto või esita uue ettevõtte taotlus.</p>
        <div className="montonio-connect__choices">
          <button type="button" onClick={() => setStep('existing')}><span>→</span><div><strong>Mul on Montonio konto</strong><small>Vali Partnersüsteemist pood ja ühenda see Poeruumiga.</small></div></button>
          <button type="button" onClick={() => setStep('apply')}><span>＋</span><div><strong>Loo uus kaupmehekonto</strong><small>Lisa ettevõte, pood ja vajalikud kontrollandmed.</small></div></button>
        </div>
        <div className="stripe-connect__secure"><span>⌁</span><small>Päris ühenduses toimub sisselogimine ja isikutuvastus Montonio Partnersüsteemis.</small></div>
      </div>}

      {step === 'existing' && <form className="stripe-connect__form" onSubmit={(event) => { event.preventDefault(); connect('live') }}>
        <button className="montonio-connect__back" type="button" onClick={() => setStep('choice')}>← Tagasi</button>
        <span className="stripe-connect__eyebrow">OLEMASOLEV KONTO</span><h2>Vali ühendatav pood</h2><p>Demo eeldab, et oled Montonio Partnersüsteemi turvaliselt sisse loginud.</p>
        <label>Ettevõte<select defaultValue="mareki"><option value="mareki">Mareki pood OÜ · 14928374</option></select></label>
        <label>Pood<select defaultValue="store"><option value="store">{storeName || 'Minu pood'} · Live</option><option value="sandbox">{storeName || 'Minu pood'} testpood · Sandbox</option></select></label>
        <div className="montonio-connect__permissions"><strong>Poeruum saab ligipääsu</strong><span>✓ Pangamaksete loomine</span><span>✓ Makse staatuste ja tagastuste haldamine</span><span>✓ Aktiivsete makseviiside sünkroonimine</span></div>
        <button className="stripe-connect__next montonio-connect__next" type="submit" disabled={isConnecting}>{isConnecting ? 'Ühendan…' : 'Ühenda pood'} <span>{isConnecting ? '◌' : '→'}</span></button>
      </form>}

      {step === 'apply' && <form className="stripe-connect__form" onSubmit={(event) => { event.preventDefault(); connect('sandbox') }}>
        <button className="montonio-connect__back" type="button" onClick={() => setStep('choice')}>← Tagasi</button>
        <span className="stripe-connect__eyebrow">UUS TAOTLUS</span><h2>Ettevõte ja veebipood</h2><p>See on lühendatud demo. Päriselt lisanduvad esindajate, tegelike kasusaajate, tingimuste ja isikutuvastuse sammud.</p>
        <div className="stripe-connect__row"><label>Registrikood<input required defaultValue="14928374" inputMode="numeric" /></label><label>Riik<select defaultValue="EE"><option value="EE">Eesti</option></select></label></div>
        <label>Ettevõtte nimi<input required defaultValue="Mareki pood OÜ" /></label>
        <label>Poe nimi<input required defaultValue={storeName || 'Minu pood'} /></label>
        <label>Poe aadress<input required defaultValue={`${(storeName || 'minu-pood').toLocaleLowerCase('et').replace(/[^a-z0-9]+/g, '-')}.poeruum.ee`} /></label>
        <div className="montonio-connect__review"><span>Taotluse kontroll</span><strong>tavaliselt 1–2 tööpäeva</strong><small>Sandbox-maksed saad Poeruumis kohe läbi proovida.</small></div>
        <button className="stripe-connect__next montonio-connect__next" type="submit" disabled={isConnecting}>{isConnecting ? 'Saadan taotlust…' : 'Esita demo-taotlus'} <span>{isConnecting ? '◌' : '→'}</span></button>
      </form>}

      {step === 'success' && <div className="stripe-connect__success">
        <div className="stripe-connect__check montonio-connect__check">✓</div><span className="stripe-connect__eyebrow">{connectionType === 'live' ? 'POOD ÜHENDATUD' : 'TAOTLUS ESITATUD'}</span>
        <h2>{connectionType === 'live' ? 'Montonio maksed on aktiivsed' : 'Montonio kontrollib sinu andmeid'}</h2>
        <p>{connectionType === 'live' ? 'Poeruum sünkroonis sinu poe aktiivsed pangamaksed ja makseviisid.' : 'Taotlus ootab Montonio kontrolli. Seni saad teha testmakseid, kuid päris raha ei liigu.'}</p>
        <div className="stripe-connect__account montonio-connect__account"><span>M</span><div><strong>{storeName || 'Minu pood'}</strong><small>{connectionType === 'live' ? 'Pangamaksed ja kaardid' : 'Testkeskkond avatud'}</small></div><b>{connectionType === 'live' ? 'LIVE' : 'KONTROLLIMISEL'}</b></div>
        <button className="stripe-connect__next montonio-connect__next" type="button" onClick={() => onComplete(connectionType === 'live' ? 'connected' : 'pending')}>Tagasi Poeruumi</button>
      </div>}
      <footer><span>🔒 Montonio turvaline ühendus</span><small>Interaktiivne demo · andmeid ei saadeta</small></footer>
    </section>
  </div>
}

export default function DemoApp() {
  const [screen, setScreen] = useState<Screen>('landing')
  const [email, setEmail] = useState('')
  const [storeName, setStoreName] = useState('')
  const [slug, setSlug] = useState('')
  const [payment, setPayment] = useState<'stripe' | 'montonio'>('stripe')
  const [pricingPlan, setPricingPlan] = useState<PricingPlan>('flexible')
  const [fixedPlanTrialStartedAt, setFixedPlanTrialStartedAt] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'connected' | 'pending'>('idle')
  const [isStripeConnectOpen, setIsStripeConnectOpen] = useState(false)
  const [isMontonioConnectOpen, setIsMontonioConnectOpen] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const [shipping, setShipping] = useState<string[]>(['omniva', 'pickup'])
  const [isPublishing, setIsPublishing] = useState(false)
  const [isBillingCardOpen, setIsBillingCardOpen] = useState(false)
  const [phoneSlideIndex, setPhoneSlideIndex] = useState(1)
  const [isPhoneSwipeAnimated, setIsPhoneSwipeAnimated] = useState(true)
  const [isPhoneDetailsOpen, setIsPhoneDetailsOpen] = useState(false)
  const [store, setStore] = useState<StoreRecord | null>(null)
  const [storedProducts, setStoredProducts] = useState<Product[]>([])
  const [authError, setAuthError] = useState('')
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [publicStore, setPublicStore] = useState<StoreRecord | null>(null)
  const [publicProducts, setPublicProducts] = useState<Product[]>([])
  const phoneProductIndex = (phoneSlideIndex - 1 + phonePreviewProducts.length) % phonePreviewProducts.length

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const pathSlug = window.location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1]
    const requestedSlug = pathSlug || new URLSearchParams(window.location.search).get('store')
    if (!requestedSlug) return
    getStoreBySlug(decodeURIComponent(requestedSlug)).then(async (found) => {
      if (!found) return
      setPublicStore(found)
      setPublicProducts(await listProducts(found.id))
    }).catch((error) => setAuthError(error instanceof Error ? error.message : 'Poe laadimine ebaõnnestus.'))
  }, [])

  const applyStore = async (nextStore: StoreRecord) => {
    setStore(nextStore)
    setStoreName(nextStore.name)
    setSlug(nextStore.slug)
    setPayment(nextStore.payment_provider)
    setPaymentStatus(nextStore.payment_status)
    setPricingPlan(nextStore.pricing_plan)
    setFixedPlanTrialStartedAt(nextStore.trial_started_at)
    setShipping(nextStore.shipping)
    setStoredProducts(await listProducts(nextStore.id))
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const restore = async () => {
      const { data } = await requireSupabase().auth.getSession()
      if (!data.session || !active) return
      setEmail(data.session.user.email ?? '')
      const existing = await getMyStore()
      if (existing && active) { await applyStore(existing); setScreen('storefront') }
    }
    restore().catch((error) => active && setAuthError(error instanceof Error ? error.message : 'Andmete laadimine ebaõnnestus.'))
    const { data } = requireSupabase().auth.onAuthStateChange((_event, session) => {
      if (!session && active) { setStore(null); setStoredProducts([]) }
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError('')
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const form = new FormData(event.currentTarget)
      const { error } = await requireSupabase().auth.signInWithPassword({ email, password: String(form.get('password') ?? '') })
      if (error) throw error
      const existing = await getMyStore()
      if (existing) { await applyStore(existing); setScreen('storefront') } else setScreen('store')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Sisselogimine ebaõnnestus.') }
    finally { setIsAuthBusy(false) }
  }

  const signUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError('')
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const form = new FormData(event.currentTarget)
      const { data, error } = await requireSupabase().auth.signUp({ email, password: String(form.get('password') ?? '') })
      if (error) throw error
      if (!data.session) throw new Error('Konto on loodud. Kinnita e-posti aadress ja logi seejärel sisse.')
      setScreen('store')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Konto loomine ebaõnnestus.') }
    finally { setIsAuthBusy(false) }
  }

  const persistStore = async (published = false, overrides: Partial<StoreRecord> = {}) => {
    const payload = {
      name: storeName.trim(), slug: slug || slugify(storeName), payment_provider: payment, payment_status: paymentStatus,
      pricing_plan: pricingPlan, trial_started_at: fixedPlanTrialStartedAt, shipping, is_published: published, ...overrides,
    }
    const saved = store ? await updateStore(store.id, payload) : await createStore(payload)
    setStore(saved)
    return saved
  }

  const resetSetupScrollAfterKeyboard = () => {
    if (!storeName.trim()) return

    // Mobile Safari keeps the page offset after its virtual keyboard closes.
    // Wait for the visual viewport to settle, then bring the whole setup card back.
    window.setTimeout(() => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    }, 250)
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [screen])

  useEffect(() => {
    if (!isMobileNavOpen) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!mobileNavRef.current?.contains(event.target as Node)) setIsMobileNavOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileNavOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isMobileNavOpen])

  useEffect(() => {
    if (screen !== 'landing' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsPhoneDetailsOpen(false)
      return
    }
    let closeDetailsTimeout: ReturnType<typeof window.setTimeout> | undefined
    const showDetails = () => {
      setIsPhoneDetailsOpen(true)
      closeDetailsTimeout = window.setTimeout(() => setIsPhoneDetailsOpen(false), 3600)
    }
    const firstDetailsTimeout = window.setTimeout(showDetails, 7600)
    const detailsInterval = window.setInterval(showDetails, 15000)
    return () => {
      window.clearInterval(detailsInterval)
      window.clearTimeout(firstDetailsTimeout)
      if (closeDetailsTimeout !== undefined) window.clearTimeout(closeDetailsTimeout)
    }
  }, [screen])

  useEffect(() => {
    if (screen !== 'landing' || isPhoneDetailsOpen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const swipeInterval = window.setInterval(() => setPhoneSlideIndex((index) => index + 1), 3200)
    return () => window.clearInterval(swipeInterval)
  }, [screen, isPhoneDetailsOpen])

  useEffect(() => {
    if (phoneSlideIndex !== phonePreviewProducts.length + 1) return
    const normalizeTimeout = window.setTimeout(() => {
      setIsPhoneSwipeAnimated(false)
      setPhoneSlideIndex(1)
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsPhoneSwipeAnimated(true)))
    }, 560)
    return () => window.clearTimeout(normalizeTimeout)
  }, [phoneSlideIndex])

  const resetDemo = () => {
    setScreen('landing')
    setEmail('')
    setStoreName('')
    setSlug('')
    setPayment('stripe')
    setPricingPlan('flexible')
    setFixedPlanTrialStartedAt(null)
    setPaymentStatus('idle')
    setIsStripeConnectOpen(false)
    setIsMontonioConnectOpen(false)
    setIsBillingCardOpen(false)
    setShipping(['omniva', 'pickup'])
  }

  const backMap: Partial<Record<Screen, Screen>> = {
    login: 'landing', account: 'landing', store: 'account', payments: 'store', shipping: 'payments', publish: 'shipping',
  }
  const phoneProduct = phonePreviewProducts[phoneProductIndex]
  const selectPricingPlan = (plan: PricingPlan) => {
    setPricingPlan(plan)
  }
  const publishStore = async () => {
    if (pricingPlan === 'fixed' && !fixedPlanTrialStartedAt) {
      setIsBillingCardOpen(true)
      return
    }
    setIsPublishing(true); setAuthError('')
    try { await persistStore(true); setScreen('storefront') }
    catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe avaldamine ebaõnnestus.') }
    finally { setIsPublishing(false) }
  }

  if (publicStore) return <Storefront
    key={publicStore.id}
    storeId={publicStore.id}
    initialSettings={publicStore.settings}
    seedProducts={publicProducts}
    storeName={publicStore.name}
    storeSlug={publicStore.slug}
    paymentProvider={publicStore.payment_provider}
    paymentsReady={publicStore.payment_status === 'connected'}
    initialShipping={publicStore.shipping}
    pricingPlan={publicStore.pricing_plan}
    fixedPlanTrialStartedAt={publicStore.trial_started_at}
  />
  if (screen === 'sample') return <Storefront key="sample-storefront" onExit={() => setScreen('landing')} />
  if (screen === 'storefront') return <>
    <Storefront key="merchant-storefront" storeId={store?.id} initialSettings={store?.settings} seedProducts={storedProducts} storeName={storeName || 'Minu pood'} storeSlug={slug || 'minu-pood'} paymentProvider={payment} paymentsReady={paymentStatus === 'connected'} initialShipping={shipping} pricingPlan={pricingPlan} fixedPlanTrialStartedAt={fixedPlanTrialStartedAt} merchantMode onConnectPaymentProvider={(provider: PaymentProvider) => provider === 'stripe' ? setIsStripeConnectOpen(true) : setIsMontonioConnectOpen(true)} onExit={resetDemo} />
    {isStripeConnectOpen && <StripeConnectDemo email={email} onClose={() => setIsStripeConnectOpen(false)} onComplete={() => { setPayment('stripe'); setPaymentStatus('connected'); setIsStripeConnectOpen(false) }} />}
    {isMontonioConnectOpen && <MontonioConnectDemo storeName={storeName} onClose={() => setIsMontonioConnectOpen(false)} onComplete={(status) => { setPayment('montonio'); setPaymentStatus(status); setIsMontonioConnectOpen(false) }} />}
  </>

  if (screen === 'landing') return <main className="demo-landing">
    <nav><Brand /><div ref={mobileNavRef} className="demo-nav-actions">
      <a className="demo-nav-link" href="#hind">Hind</a>
      <a className="demo-nav-link" href="#kkk">KKK</a>
      <button className="demo-nav-link" onClick={() => setScreen('sample')}>Vaata näidispoodi</button>
      <button className="demo-nav-link demo-nav-login" onClick={() => setScreen('login')}>Logi sisse</button>
      <button className="demo-nav-cta" onClick={() => setScreen('account')}>Loo pood</button>
      <button className="demo-mobile-menu-toggle" type="button" aria-label={isMobileNavOpen ? 'Sulge menüü' : 'Ava menüü'} aria-expanded={isMobileNavOpen} onClick={() => setIsMobileNavOpen((open) => !open)}>
        {isMobileNavOpen
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>}
      </button>
      {isMobileNavOpen && <div className="demo-mobile-menu">
        <a href="#hind" onClick={() => setIsMobileNavOpen(false)}><span>Hind</span><b>→</b></a>
        <a href="#kkk" onClick={() => setIsMobileNavOpen(false)}><span>KKK</span><b>→</b></a>
        <button type="button" onClick={() => { setIsMobileNavOpen(false); setScreen('sample') }}><span>Näidispood</span><b>→</b></button>
        <button type="button" onClick={() => { setIsMobileNavOpen(false); setScreen('login') }}><span>Logi sisse</span><b>→</b></button>
        <button type="button" onClick={() => { setIsMobileNavOpen(false); setScreen('account') }}><span>Loo pood</span><b>→</b></button>
      </div>}
    </div></nav>
    <section className="demo-hero">
      <div className="demo-hero__copy">
        <span className="demo-eyebrow">Lihtsaim viis oma e-poeni</span>
        <h1>Sinu e-pood.<br /><em>10 minutiga.</em></h1>
        <p>Tee pilt, lisa hind ja vajuta „Avalda”. Kõige muu eest hoolitseme meie.</p>
        <button onClick={() => setScreen('account')}>Alusta tasuta <span>→</span></button>
        <small>Kaks paketti: 0 € kuutasu + müügitasu või 30 päeva tasuta, seejärel 29 € kuus + km</small>
      </div>
      <div className="demo-phone-stage">
      <div className={`demo-phone${isPhoneDetailsOpen ? ' is-details' : ''}`} role="link" tabIndex={0} aria-label="Ava näidispood" onClick={() => setScreen('sample')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setScreen('sample') } }}>
        <div className="demo-phone__screen"><div className="demo-phone__journey">
          <section className="demo-phone__story">
            <div className={`demo-phone__slides${isPhoneSwipeAnimated ? '' : ' is-jumping'}`} style={{ transform: `translateX(-${phoneSlideIndex * 100}%)` }}>
              {[phonePreviewProducts[phonePreviewProducts.length - 1], ...phonePreviewProducts, phonePreviewProducts[0]].map((product, index) => <img src={product.images[0]} alt={product.name} key={`${product.name}-${index}`} />)}
            </div>
            <div className="demo-phone__shade" />
            <div className="demo-phone__progress">{phonePreviewProducts.map((product, index) => <i className={index === phoneProductIndex ? 'is-active' : ''} key={product.name} />)}</div>
            <header className="demo-phone__header">
              <div><span>M</span><strong>MAREKI KÄSITÖÖ</strong></div>
              <aside><i><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></i><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg><b>0</b></i></aside>
            </header>
            {phoneProduct.images.length > 1 && <div className="demo-phone__thumbs">{phoneProduct.images.map((image, index) => <span className={index === 0 ? 'is-active' : ''} key={image}><img src={image} alt="" /></span>)}</div>}
            <div className="demo-phone__buy"><span>Osta</span><strong>{phoneProduct.price} €</strong></div>
          </section>
          <section className="demo-phone__details">
            <header><h3>{phoneProduct.name}</h3><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg></span></header>
            <div><small>Kirjeldus</small><p>{phoneProduct.description}</p></div>
            <div className="demo-phone__price"><small>Hind</small><strong>{phoneProduct.price} €</strong></div>
            <div className="demo-phone__cart">Lisa ostukorvi</div>
            <footer><strong>MAREKI KÄSITÖÖ</strong><small>Valmistatud hoolega Eestis</small></footer>
          </section>
        </div></div>
      </div>
      <div className="demo-mobile-sticker" aria-label="Seadista telefonis">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10 18.5h4"/><path d="m9 11 2 2 4-4"/></svg>
        <span><strong>Seadista telefonis</strong></span>
      </div>
      </div>
    </section>
    <section className="demo-benefits"><div><b>01</b><strong>Loo konto</strong><span>Alusta vaid mõne minutiga</span></div><div><b>02</b><strong>Seadista oma pood</strong><span>Lisa tooted, maksed ja tarne</span></div><div><b>03</b><strong>Avalda ja hakka müüma</strong><span>Sinu poe veebiaadressil</span></div></section>
    <section className="demo-pricing" id="hind">
      <div className="demo-pricing__copy">
        <span className="demo-eyebrow">Kaks lihtsat valikut</span>
        <h2>Vali, kuidas<br />maksad.</h2>
        <p>Alusta ilma kuutasuta või vali kindel kuukulu. Mõlemas paketis saad kasutada kõiki Poeruumi põhivõimalusi.</p>
        <ul><li><i>✓</i><span>Piiramatult tooteid ja tellimusi</span></li><li><i>✓</i><span>Oma domeen ning makse- ja tarneintegratsioonid hinnas</span></li><li><i>✓</i><span>Poeruumi tasu ei arvestata tarne ega tagastatud müügi pealt</span></li></ul>
      </div>
      <div className="demo-pricing__plans">
        <article className="demo-pricing__card is-featured">
          <span>PAINDLIK <b>ALUSTA SIIT</b></span>
          <div className="demo-pricing__rate"><strong>0 €</strong><p>kuus<br />+ 4% müügilt</p></div>
          <dl><div><dt>Müüki pole</dt><dd>0 €</dd></div><div><dt>Poeruumi müügitasu</dt><dd>4%</dd></div><div className="is-cap"><dt>Maksimum kuus</dt><dd>39 € + km</dd></div></dl>
          <small>Sobib alustamiseks ja ebaregulaarse müügiga poele.</small>
          <button onClick={() => { selectPricingPlan('flexible'); setScreen('account') }}>Vali Paindlik <span>→</span></button>
        </article>
        <article className="demo-pricing__card">
          <span>KINDEL <b>30 PÄEVA TASUTA</b></span>
          <div className="demo-pricing__rate"><strong>29 €</strong><p>kuus + km<br />0% müügilt</p></div>
          <dl><div><dt>Poeruumi müügitasu</dt><dd>0%</dd></div><div><dt>Kindel kuutasu</dt><dd>29 € + km</dd></div><div className="is-cap"><dt>Kasulik alates</dt><dd>725 € müügist</dd></div></dl>
          <small>Esimesed 30 päeva tasuta, seejärel 29 € kuus + km.</small>
          <button onClick={() => { selectPricingPlan('fixed'); setScreen('account') }}>Alusta tasuta <span>→</span></button>
        </article>
      </div>
      <p className="demo-pricing__note">Paketti saad iga kuu vahetada. Makseteenuse pakkuja tasud lisanduvad eraldi.</p>
    </section>
    <section className="demo-testimonials" aria-labelledby="testimonials-title">
      <header>
        <h2 id="testimonials-title">Mida müüjad hindavad</h2>
      </header>
      <div className="demo-testimonials__grid">
        <article className="demo-testimonial demo-testimonial--dark">
          <div className="demo-testimonial__bubble"><div className="demo-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>Tegin tootest pildi ja õhtuks oli pood päriselt üleval. Telefonist!</blockquote></div>
          <footer><span className="demo-testimonial__avatar">K</span><p><strong>Kadi</strong><small>Keraamika · Tartu</small></p></footer>
        </article>
        <article className="demo-testimonial demo-testimonial--cream">
          <div className="demo-testimonial__bubble"><div className="demo-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>Enam ei otsi ma tellimusi sõnumitest taga. Kõik on ühes kohas ja pilt on kohe selge.</blockquote></div>
          <footer><span className="demo-testimonial__avatar">M</span><p><strong>Maris</strong><small>Vintage-esemed · Tallinn</small></p></footer>
        </article>
        <article className="demo-testimonial demo-testimonial--green">
          <div className="demo-testimonial__bubble"><div className="demo-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>5/5 just selle eest, et kuutasu pole. Sain rahulikult proovida, mis päriselt müüb.</blockquote></div>
          <footer><span className="demo-testimonial__avatar">R</span><p><strong>Rasmus</strong><small>Väiketootja · Pärnu</small></p></footer>
        </article>
      </div>
      <small className="demo-testimonials__note">Illustratiivsed näidistekstid — asenda enne avaldamist päris klientide tagasisidega.</small>
    </section>
    <section className="demo-faq" id="kkk">
      <header>
        <h2>KKK</h2>
      </header>
      <div className="demo-faq__list">
        <details open><summary>Kui palju Poeruum maksab?<span>+</span></summary><p>Paindlik pakett maksab 0 € kuus ja 4% toodete müügilt, maksimaalselt 39 € kuus + km. Kindel pakett on esimesed 30 päeva tasuta, seejärel 29 € kuus + km ning Poeruumi müügitasu on 0%.</p></details>
        <details><summary>Kas saan kogu poe telefonis valmis teha?<span>+</span></summary><p>Jah. Telefonis saad pildistada tooted, lisada hinnad ja kirjeldused, kujundada poe, ühendada maksed ja tarne ning poe avaldada.</p></details>
        <details><summary>Kuidas kliendid maksta saavad?<span>+</span></summary><p>Saad ühendada Stripe’i või Montonio. Nii saad pakkuda pangalinke, kaardimakseid ning teenusepakkujast sõltuvalt Apple Pay ja Google Pay makseid.</p></details>
        <details><summary>Milliseid tarneviise saab kasutada?<span>+</span></summary><p>Toetatud on Omniva, DPD ja SmartPosti pakiautomaadid, kuller ning ise järele tulemine. Tarneviisid ja hinnad valid ise.</p></details>
        <details><summary>Kas saan kasutada oma domeeni ja kujundust?<span>+</span></summary><p>Jah. Võid kasutada Poeruumi aadressi või ühendada oma domeeni. Poe välimuse jaoks saad valida kujunduse, aktsentvärvi, logo ja ostunupu suuruse.</p></details>
        <details><summary>Kas saan paketti vahetada?<span>+</span></summary><p>Jah. Paketti saad vahetada iga kuu ja pikaajalist kohustust ei ole. Paindliku paketiga ei ole müügita kuul Poeruumi tasu.</p></details>
      </div>
    </section>
    <footer className="demo-footer">
      <div><Brand /><p>Lihtne e-pood Eesti väikeettevõtjale.</p></div>
      <div><span>© 2026 Poeruum</span><span>Interaktiivne demo</span></div>
    </footer>
  </main>

  if (screen === 'login') return <main className="auth-page auth-page--login">
    <FlowHeader onBack={() => setScreen('landing')} />
    <div className="auth-flow auth-flow--login">
      <div className="auth-content">
        <aside className="auth-intro auth-intro--login">
          <span className="demo-eyebrow">Tere tulemast tagasi</span>
          <h1>Jätka sealt, kus pooleli jäi.</h1>
          <p>Sinu poe mustand, tooted ja seadistus ootavad sind.</p>
          <div className="auth-resume-card" aria-hidden="true">
            <span>✓</span><p><strong>Poe mustand on alles</strong><small>Viimane muudatus salvestatud</small></p><b>→</b>
          </div>
        </aside>
        <section className="auth-card auth-card--login">
          <h1>Logi sisse</h1><p>Tagasi oma poe haldusesse.</p>
          <form onSubmit={signIn}>
            <label>E-posti aadress<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="sina@ettevote.ee" autoComplete="username" autoFocus /></label>
            <label>Parool<input required name="password" type="password" minLength={6} placeholder="Sinu parool" autoComplete="current-password" /></label>
            {authError && <p className="add-product-error" role="alert">{authError}</p>}
            <button type="submit" disabled={isAuthBusy}>{isAuthBusy ? 'Login sisse…' : 'Jätka oma poega'} <span>→</span></button>
          </form>
          <div className="auth-switch"><span>Pole veel kontot?</span><button type="button" onClick={() => setScreen('account')}>Loo pood</button></div>
          <small>Turvaline sisselogimine Supabase Authiga.</small>
        </section>
      </div>
    </div>
  </main>

  if (screen === 'account') return <main className="auth-page">
    <FlowHeader onBack={() => setScreen('landing')} />
    <div className="auth-flow">
      <SetupProgress screen="account" />
      <div className="auth-content">
        <aside className="auth-intro">
          <span className="demo-eyebrow">Sinu pood, sinu moodi</span>
          <h1>Alustamine on lihtne!</h1>
          <p>Poeruum juhib sind samm-sammult ideest avaldatud e-poeni. Tehnilisi oskusi pole vaja.</p>
          <ul>
            <li><i>✓</i><span><strong>Kõik vajalik ühes kohas</strong><small>Tooted, maksed, tarne ja tellimused.</small></span></li>
            <li><i>✓</i><span><strong>Alusta ilma kuutasuta</strong><small>Maksad ainult siis, kui päriselt müüd.</small></span></li>
            <li><i>✓</i><span><strong>Valmis ka telefonis</strong><small>Pildista toode ja lisa see kohe poodi.</small></span></li>
          </ul>
          <footer><span>1</span><p><strong>Konto</strong><small>Esimene samm viiest</small></p></footer>
        </aside>
        <section className="auth-card">
          <h1>Loo konto</h1><p>Valmis vähem kui minutiga.</p>
          <form onSubmit={signUp}>
            <label>E-posti aadress<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="sina@ettevote.ee" autoFocus /></label>
            <label>Parool<input required name="password" type="password" minLength={6} placeholder="Vähemalt 6 tähemärki" /></label>
            <label className="auth-consent">
              <input required type="checkbox" />
              <span className="auth-checkbox" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg></span>
              <span>Nõustun kasutustingimuste ja privaatsuspoliitikaga</span>
            </label>
            {authError && <p className="add-product-error" role="alert">{authError}</p>}
            <button type="submit" disabled={isAuthBusy}>{isAuthBusy ? 'Loon kontot…' : 'Loo konto ja jätka'} <span>→</span></button>
          </form>
          <div className="auth-switch"><span>Konto juba olemas?</span><button type="button" onClick={() => setScreen('login')}>Logi sisse</button></div>
          <small>Konto luuakse Supabase Authis.</small>
        </section>
      </div>
    </div>
  </main>

  const onBack = () => setScreen(backMap[screen] ?? 'landing')

  return <SetupShell screen={screen} onBack={onBack}>
    {screen === 'store' && <form className="setup-form" onSubmit={async (event) => { event.preventDefault(); setAuthError(''); try { await persistStore(false); setScreen('payments') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>
      <span className="setup-kicker">Alustame põhilisest</span><h1>Mis on sinu poe nimi?</h1><p>Seda näevad sinu kliendid poe päises ja otsingutulemustes.</p>
      <label>Poe nimi<input
        required
        autoFocus
        enterKeyHint="done"
        value={storeName}
        onChange={(event) => { const value = event.target.value; setStoreName(value); setSlug(slugify(value)) }}
        onBlur={resetSetupScrollAfterKeyboard}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !event.currentTarget.value.trim()) return
          event.preventDefault()
          event.currentTarget.blur()
        }}
        placeholder="Näiteks Mareki Käsitöö"
      /></label>
      <div className="domain-preview"><span>Sinu poe aadress</span><strong>{slug || 'minu-pood'}.poeruum.ee</strong><small>Aadressi saad hiljem muuta või lisada oma domeeni.</small></div>
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      <button className="setup-next" type="submit">Jätka maksetega <span>→</span></button>
    </form>}

    {screen === 'payments' && <div className="setup-form"><span className="setup-kicker">Maksete vastuvõtmine</span><h1>Kuidas kliendid maksavad?</h1>
      <div className="provider-list">
        <button className={payment === 'stripe' ? 'is-selected' : ''} onClick={() => { setPayment('stripe'); setPaymentStatus('idle') }}>
          <i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="" /></i><span><strong>Stripe <em>Kõige kiirem</em></strong><small>Kaardid, Apple Pay ja Google Pay</small></span><b>{payment === 'stripe' ? '✓' : ''}</b>
        </button>
        <button className={payment === 'montonio' ? 'is-selected' : ''} onClick={() => { setPayment('montonio'); setPaymentStatus('idle') }}>
          <i className="provider-logo provider-logo--montonio"><img src="/images/montonio-wordmark.svg" alt="" /></i><span><strong>Montonio</strong><small>Pangalingid, kaardid ja maksa hiljem</small></span><b>{payment === 'montonio' ? '✓' : ''}</b>
        </button>
      </div>
      {paymentStatus === 'idle' ? <button className={`connect-provider connect-provider--${payment}`} onClick={() => payment === 'stripe' ? setIsStripeConnectOpen(true) : setIsMontonioConnectOpen(true)}>
        <span className="connect-provider__identity"><i className={`provider-logo provider-logo--${payment}`}><img src={payment === 'stripe' ? '/images/stripe-wordmark.svg' : '/images/montonio-wordmark.svg'} alt="" /></i><span><strong>Ühenda {payment === 'stripe' ? 'Stripe' : 'Montonio'}</strong><small>{payment === 'stripe' ? 'Turvaline demoühendus · umbes 2 minutit' : 'Olemasolev konto või uus taotlus'}</small></span></span><b>→</b>
      </button> : <div className={`connected-provider${paymentStatus === 'pending' ? ' is-pending' : ''}`}><span>{paymentStatus === 'pending' ? '…' : '✓'}</span><div><strong>{paymentStatus === 'pending' ? 'Montonio taotlus on kontrollimisel' : payment === 'stripe' ? 'Kaardimaksed on valmis' : 'Montonio maksed on valmis'}</strong><small>{paymentStatus === 'pending' ? 'Kontroll võtab tavaliselt 1–2 tööpäeva. Päris maksed aktiveeruvad pärast kinnitamist.' : payment === 'stripe' ? 'Stripe kannab müügitulu otse sinu väljamaksekontole.' : 'Pangamaksed ja konto staatus on Poeruumiga sünkroonitud.'}</small></div></div>}
      <div className="setup-fee-note"><span>i</span><p><strong>Makseteenus ja Poeruum on eraldi.</strong> {payment === 'stripe' ? 'Stripe’i' : 'Montonio'} tasud lähevad teenusepakkujale. Sinu valitud {pricingPlan === 'flexible' ? 'Paindlik pakett maksab 0 € kuus ja 4% toodete müügilt' : 'Kindel pakett on esimesed 30 päeva tasuta, seejärel 29 € kuus + km ning Poeruumi müügitasu on 0%'}.</p></div>
      <button className="setup-next" disabled={paymentStatus === 'idle'} onClick={async () => { try { await persistStore(false); setScreen('shipping') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka tarnega <span>→</span></button>
      {isStripeConnectOpen && <StripeConnectDemo email={email} onClose={() => setIsStripeConnectOpen(false)} onComplete={() => { setPaymentStatus('connected'); setIsStripeConnectOpen(false) }} />}
      {isMontonioConnectOpen && <MontonioConnectDemo storeName={storeName} onClose={() => setIsMontonioConnectOpen(false)} onComplete={(status) => { setPaymentStatus(status); setIsMontonioConnectOpen(false) }} />}
    </div>}

    {screen === 'shipping' && <div className="setup-form"><span className="setup-kicker">Kauba kättesaamine</span><h1>Vali tarneviisid</h1>
      <div className="shipping-list">{[
        ['omniva', 'https://old.omniva.ee/public/banners/logo/Omniva_lockup_horizontal_orange.svg', 'Omniva pakiautomaat'],
        ['dpd', 'https://www.dpd.com/wp-content/themes/DPD_NoLogin/images/DPD_logo_redgrad_rgb_responsive.svg', 'DPD pakiautomaat'],
        ['smartposti', 'https://images.ctfassets.net/dvxpcmq06s7e/5LDF7M5UltxLRSteji1IIj/66fc61b81e453d12d154fcaceec04e42/Logo_SmartPosti.png', 'SmartPosti pakiautomaat'],
        ['pickup', '', 'Tulen ise järele'],
      ].map(([id, logo, name]) => <label key={id}><span className={`shipping-brand shipping-brand--${id}`}>{logo ? <img src={logo} alt="" loading="eager" decoding="async" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>}</span><div><strong>{name}</strong></div><input type="checkbox" checked={shipping.includes(id)} onChange={() => setShipping((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} /><i /></label>)}</div>
      <button className="setup-next" disabled={!shipping.length} onClick={async () => { try { await persistStore(false); setScreen('publish') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka avaldamisega <span>→</span></button>
    </div>}

    {screen === 'publish' && <div className="setup-form publish-step"><div className="publish-ready"><span className="publish-ready__logo" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="1" y="1" width="38" height="38" rx="11" /><path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z" /><path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18" /><path d="M15.5 22.2h9" /></svg></span><strong>Sinu Poeruum<br />on valmis.</strong></div>
      <section className="publish-store-card" aria-label="Avaldatava poe kokkuvõte">
        <div className="publish-store-address">
          <span><small>Sinu poe aadress</small><strong>{slug}<b>.poeruum.ee</b></strong></span>
          <button type="button" onClick={() => setScreen('store')} aria-label="Muuda poe nime ja aadressi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.5 6.7 2.8 2.8" /></svg></button>
        </div>
        <div className={`publish-payment-status${paymentStatus === 'pending' ? ' is-pending' : ''}`}>
          <i className={`provider-logo provider-logo--${payment}`}><img src={payment === 'stripe' ? '/images/stripe-wordmark.svg' : '/images/montonio-wordmark.svg'} alt={payment === 'stripe' ? 'Stripe' : 'Montonio'} /></i>
          <strong>{paymentStatus === 'pending' ? 'Kontrollimisel' : 'Maksed valmis'}</strong>
          <button type="button" onClick={() => setScreen('payments')} aria-label="Muuda makseteenust"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.5 6.7 2.8 2.8" /></svg></button>
        </div>
      </section>
      <div className="publish-plan-picker" role="radiogroup" aria-label="Vali Poeruumi pakett">
        <button type="button" role="radio" aria-checked={pricingPlan === 'flexible'} className={pricingPlan === 'flexible' ? 'is-selected' : ''} onClick={() => selectPricingPlan('flexible')}>
          <span className="publish-plan-name">Paindlik<i aria-hidden="true" /></span>
          <strong className="publish-plan-price">0 € <small>/ kuu</small></strong>
          <em>4% müügilt<br />kuni 39 € kuus</em>
          <b>{pricingPlan === 'flexible' ? 'Valitud' : 'Vali pakett'}<span aria-hidden="true">{pricingPlan === 'flexible' ? '✓' : '→'}</span></b>
        </button>
        <button type="button" role="radio" aria-checked={pricingPlan === 'fixed'} className={pricingPlan === 'fixed' ? 'is-selected' : ''} onClick={() => selectPricingPlan('fixed')}>
          <span className="publish-plan-name">Kindel · 30 päeva tasuta<i aria-hidden="true" /></span>
          <strong className="publish-plan-price">29 € <small>/ kuu + km</small></strong>
          <em>Seejärel 29 € / kuu + km<br />0% Poeruumi müügitasu</em>
          <b>{pricingPlan === 'fixed' ? '30 päeva tasuta' : 'Alusta tasuta'}<span aria-hidden="true">{pricingPlan === 'fixed' ? '✓' : '→'}</span></b>
        </button>
      </div>
      <small className="publish-fee-note">Paketti saad hiljem muuta · Maksetasud lisanduvad</small>
      <button className="publish-button" disabled={isPublishing} onClick={publishStore}>{isPublishing ? 'Avaldan poodi…' : pricingPlan === 'flexible' ? 'Avalda pood tasuta' : 'Alusta 30 päeva tasuta ja avalda'} <span>{isPublishing ? '◌' : '→'}</span></button><small className="publish-note">Avaldamisega nõustud kasutustingimustega.</small>
    </div>}
    {isBillingCardOpen && <BillingCardDemo confirmLabel="Kinnita ja avalda pood" onClose={() => setIsBillingCardOpen(false)} onConfirm={async (trialStartedAt) => {
      setFixedPlanTrialStartedAt(trialStartedAt); setIsBillingCardOpen(false); setIsPublishing(true)
      try { await persistStore(true, { trial_started_at: trialStartedAt, pricing_plan: 'fixed' }); setScreen('storefront') }
      catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe avaldamine ebaõnnestus.') }
      finally { setIsPublishing(false) }
    }} />}
  </SetupShell>
}
