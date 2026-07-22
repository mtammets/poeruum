import { useEffect, useRef, useState } from 'react'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js'
import { BillingCardDemo, DEFAULT_RETURNS_TEXT, Storefront, type PaymentProvider, type PricingPlan } from './App'
import { createStore, getDemoStore, getMyStore, getStoreBySlug, invokeStripeConnect, listProducts, startStripeBillingCheckout, updateStore, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { getRequestedStoreSlug, isReservedStoreSlug } from './lib/storefrontUrl'
import { products as bundledProducts, type Product } from './products'

type Screen = 'landing' | 'login' | 'forgot-password' | 'reset-password' | 'account' | 'store' | 'payments' | 'shipping' | 'business' | 'publish' | 'storefront' | 'sample'
type OnboardingStep = 'business' | 'payments' | 'shipping' | 'publish' | 'complete'
type RegistryLookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error'

type RegistryCompany = {
  reg_code: number | string
  name: string
  legal_address: string
  status: string
}

type RegistryLookupResponse = {
  status?: string
  data?: RegistryCompany[]
}

const onboardingSteps = new Set<OnboardingStep>(['business', 'payments', 'shipping', 'publish', 'complete'])
const onboardingActivityScreens = new Set<Screen>(['store', 'business', 'payments', 'shipping', 'publish'])
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim()
const isStripeTestMode = stripePublishableKey?.startsWith('pk_test_') === true
const isIOSWebKit = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const restoreIOSViewportScale = () => {
  if (!isIOSWebKit) return
  if ((window.visualViewport?.scale ?? 1) <= 1.01) return
  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!viewportMeta) return

  const focusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  focusedElement?.blur()
  const baseContent = viewportMeta.content
    .replace(/,?\s*(?:maximum-scale|user-scalable)\s*=\s*[^,]+/gi, '')
    .replace(/,{2,}/g, ',')
    .replace(/^,|,$/g, '')
  viewportMeta.content = `${baseContent}, maximum-scale=1.0, user-scalable=no`

  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    viewportMeta.content = baseContent
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }))
}

const getStoreDestination = (store: StoreRecord): Screen => {
  if (store.is_published) return 'storefront'

  const settings = store.settings as Record<string, unknown>
  const savedStep = settings.onboardingStep
  if (typeof savedStep === 'string' && onboardingSteps.has(savedStep as OnboardingStep) && savedStep !== 'complete') {
    return savedStep as Screen
  }

  // Older drafts do not have an onboarding step yet. Infer the first
  // unfinished screen once, then persist an explicit step on the next save.
  const hasSellerDetails = Boolean(
    String(settings.businessName ?? '').trim()
    && /^\d{8}$/.test(String(settings.registryCode ?? '').trim())
    && String(settings.businessAddress ?? '').trim()
    && String(settings.contactEmail ?? '').trim(),
  )
  if (!hasSellerDetails) return 'business'
  if (store.payment_status === 'idle') return 'payments'
  if (!store.shipping.length) return 'shipping'
  return 'publish'
}

const steps: Array<{ screen: Screen; label: string }> = [
  { screen: 'account', label: 'Konto' },
  { screen: 'store', label: 'Pood' },
  { screen: 'business', label: 'Müüja' },
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

const slugify = (value: string) => {
  const slug = value
    .toLocaleLowerCase('et')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 38)
  return isReservedStoreSlug(slug) ? `${slug}-pood` : slug
}

const isEmailNotConfirmedError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const authError = error as { code?: string; message?: string }
  return authError.code === 'email_not_confirmed'
    || authError.message?.toLowerCase().includes('email not confirmed') === true
}

const isEmailRateLimitError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const authError = error as { code?: string; message?: string }
  return authError.code === 'over_email_send_rate_limit'
    || authError.message?.toLowerCase().includes('email rate limit') === true
}

const getLocalizedAuthError = (error: unknown, fallback: string) => {
  if (!error || typeof error !== 'object') return fallback
  const authError = error as { code?: string; message?: string }
  const message = authError.message?.toLowerCase() ?? ''
  if (isEmailNotConfirmedError(error)) return 'E-posti aadress pole veel kinnitatud.'
  if (isEmailRateLimitError(error)) return 'Saatmislimiit on täis.'
  if (authError.code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'E-posti aadress või parool ei ole õige.'
  }
  return authError.message || fallback
}

export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`demo-brand__mark${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <rect x="1" y="1" width="38" height="38" rx="11" />
        <path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z" />
        <path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18" />
        <path d="M15.5 22.2h9" />
      </svg>
    </span>
}

export function Brand() {
  return <div className="demo-brand" aria-label="Poeruum">
    <BrandMark />
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
  </main>
}

function StripeEmbeddedOnboarding({ onExit, onClose, onError }: { onExit: () => Promise<void>; onClose: () => Promise<void>; onError: (message: string) => void }) {
  const [loadPhase, setLoadPhase] = useState<'connecting' | 'loading' | 'ready' | 'error'>('connecting')
  const [isClosing, setIsClosing] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [renderAttempt, setRenderAttempt] = useState(0)
  const [connectInstance] = useState(() => stripePublishableKey ? loadConnectAndInitialize({
    publishableKey: stripePublishableKey,
    locale: 'et-EE',
    appearance: {
      overlays: 'drawer',
      variables: {
        colorPrimary: '#226748',
        colorBackground: '#ffffff',
        colorText: '#14261c',
        colorSecondaryText: '#66736b',
        colorBorder: '#d7ded7',
        colorDanger: '#a4433b',
        formBackgroundColor: '#fcfdfb',
        formHighlightColorBorder: '#226748',
        formAccentColor: '#226748',
        formPlaceholderTextColor: '#7b857e',
        buttonPrimaryColorBackground: '#226748',
        buttonPrimaryColorBorder: '#226748',
        buttonPrimaryColorText: '#ffffff',
        buttonLabelFontSize: '13px',
        buttonLabelFontWeight: '700',
        buttonPaddingX: '12px',
        buttonPaddingY: '10px',
        inputFieldPaddingX: '10px',
        inputFieldPaddingY: '10px',
        fontSizeBase: '13px',
        bodyMdFontSize: '13px',
        bodySmFontSize: '12px',
        headingXlFontSize: '22px',
        headingLgFontSize: '18px',
        headingMdFontSize: '16px',
        headingSmFontSize: '15px',
        labelMdFontSize: '13px',
        labelMdFontWeight: '700',
        labelSmFontSize: '11px',
        borderRadius: '12px',
        formBorderRadius: '10px',
        buttonBorderRadius: '10px',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        spacingUnit: '6px',
      },
    },
    fetchClientSecret: async () => {
      const result = await invokeStripeConnect('start')
      if (!result.clientSecret) throw new Error('Stripe ei tagastanud AccountSessioni võtit.')
      return result.clientSecret
    },
  }) : null)

  useEffect(() => {
    if (!connectInstance) onError('Stripe’i publishable key puudub.')
  }, [connectInstance, onError])

  useEffect(() => {
    if (loadPhase !== 'loading') return
    // StepChange normally reveals the form first. Keep a fallback so a future
    // Stripe step that omits that event can never leave our loader stuck.
    const fallback = window.setTimeout(() => setLoadPhase('ready'), 8000)
    return () => window.clearTimeout(fallback)
  }, [loadPhase])

  const closeStripeForm = async () => {
    if (isClosing) return
    setIsClosing(true)
    try {
      await onClose()
    } finally {
      setIsClosing(false)
    }
  }

  const retryStripeForm = () => {
    onError('')
    setLoadPhase('connecting')
    setRenderAttempt((attempt) => attempt + 1)
  }

  const completeStripeForm = async () => {
    if (isCompleting) return
    setIsCompleting(true)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    try {
      await onExit()
    } finally {
      setIsCompleting(false)
    }
  }

  if (!connectInstance) return null
  return <section className="stripe-embedded" aria-label="Stripe’i konto seadistamine">
    <header><div><i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="" /></i><span><strong>Stripe’i konto seadistamine</strong><small>Maksete vastuvõtt{isStripeTestMode ? ' · Testkeskkond' : ''}</small></span></div><aside><button type="button" disabled={isClosing} onClick={() => void closeStripeForm()}>{isClosing && <i aria-hidden="true" />}<span>{isClosing ? 'Sulgen…' : 'Sulge'}</span></button></aside></header>
    <div className={`stripe-embedded__component is-${loadPhase}${isCompleting ? ' is-completing' : ''}`}>
      {isCompleting && <div className="stripe-completing" role="status" aria-live="polite">
        <span aria-hidden="true" />
        <h2>Kontrollime maksete valmisolekut</h2>
        <p>Stripe salvestas andmed. Hetk palun…</p>
      </div>}
      {loadPhase !== 'ready' && <div className={`stripe-preparing${loadPhase === 'error' ? ' is-error' : ''}`} aria-live="polite">
        {loadPhase === 'error' ? <>
          <span className="stripe-preparing__error" aria-hidden="true">!</span>
          <h2>Vormi ei õnnestunud avada</h2>
          <p>Stripe’i vormi laadimine võttis liiga kaua.</p>
          <button type="button" onClick={retryStripeForm}>Proovi uuesti</button>
        </> : <>
          <span className="stripe-preparing__loader" aria-hidden="true"><i /></span>
          <h2>{loadPhase === 'connecting' ? 'Ühendame Stripe’iga' : 'Avame Stripe’i vormi'}</h2>
          <p>Hetk palun…</p>
        </>}
      </div>}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          key={renderAttempt}
          collectionOptions={{ fields: 'eventually_due', futureRequirements: 'include' }}
          onExit={() => void completeStripeForm()}
          onLoaderStart={() => setLoadPhase((current) => current === 'connecting' ? 'loading' : current)}
          onStepChange={() => {
            onError('')
            setLoadPhase('ready')
          }}
          onLoadError={() => {
            setLoadPhase('error')
            onError('Stripe’i vormi avamine ebaõnnestus. Proovi uuesti.')
          }}
        />
      </ConnectComponentsProvider>
    </div>
  </section>
}

function MontonioConnectDemo({ storeName, businessName, registryCode, onClose, onComplete }: { storeName: string; businessName: string; registryCode: string; onClose: () => void; onComplete: (status: 'connected' | 'pending') => void }) {
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
        <label>Ettevõte<select defaultValue="seller"><option value="seller">{businessName} · {registryCode}</option></select></label>
        <label>Pood<select defaultValue="store"><option value="store">{storeName || 'Minu pood'} · Live</option><option value="sandbox">{storeName || 'Minu pood'} testpood · Sandbox</option></select></label>
        <div className="montonio-connect__permissions"><strong>Poeruum saab ligipääsu</strong><span>✓ Pangamaksete loomine</span><span>✓ Makse staatuste ja tagastuste haldamine</span><span>✓ Aktiivsete makseviiside sünkroonimine</span></div>
        <button className="stripe-connect__next montonio-connect__next" type="submit" disabled={isConnecting}>{isConnecting ? 'Ühendan…' : 'Ühenda pood'} <span>{isConnecting ? '◌' : '→'}</span></button>
      </form>}

      {step === 'apply' && <form className="stripe-connect__form" onSubmit={(event) => { event.preventDefault(); connect('sandbox') }}>
        <button className="montonio-connect__back" type="button" onClick={() => setStep('choice')}>← Tagasi</button>
        <span className="stripe-connect__eyebrow">UUS TAOTLUS</span><h2>Ettevõte ja veebipood</h2><p>See on lühendatud demo. Päriselt lisanduvad esindajate, tegelike kasusaajate, tingimuste ja isikutuvastuse sammud.</p>
        <div className="stripe-connect__prefill"><div><small>Ettevõte</small><strong>{businessName}</strong></div><div><small>Registrikood</small><strong>{registryCode}</strong></div><div><small>Riik</small><strong>Eesti</strong></div></div>
        <label>Ettevõtte esindaja nimi<input required placeholder="Ees- ja perekonnanimi" autoComplete="name" /></label>
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
  const [onlineUserId, setOnlineUserId] = useState<string | null>(null)
  const onlinePresenceSessionIdRef = useRef(crypto.randomUUID())
  const [storeName, setStoreName] = useState('')
  const [slug, setSlug] = useState('')
  const [payment, setPayment] = useState<'stripe' | 'montonio'>('stripe')
  const [pricingPlan, setPricingPlan] = useState<PricingPlan>('flexible')
  const [fixedPlanTrialStartedAt, setFixedPlanTrialStartedAt] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'connected' | 'pending'>('idle')
  const [isStripeConnecting, setIsStripeConnecting] = useState(false)
  const [isStripeOnboardingOpen, setIsStripeOnboardingOpen] = useState(false)
  const [isMontonioConnectOpen, setIsMontonioConnectOpen] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const [shipping, setShipping] = useState<string[]>(['omniva', 'pickup'])
  const [businessName, setBusinessName] = useState('')
  const [registryCode, setRegistryCode] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [registryLookupStatus, setRegistryLookupStatus] = useState<RegistryLookupStatus>('idle')
  const [registryLookupCompanyName, setRegistryLookupCompanyName] = useState('')
  const [registryLookupAttempt, setRegistryLookupAttempt] = useState(0)
  const [businessEmail, setBusinessEmail] = useState('')
  const [returnsText, setReturnsText] = useState(DEFAULT_RETURNS_TEXT)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isBillingCardOpen, setIsBillingCardOpen] = useState(false)
  const [phoneSlideIndex, setPhoneSlideIndex] = useState(1)
  const [isPhoneSwipeAnimated, setIsPhoneSwipeAnimated] = useState(true)
  const [isPhoneDetailsOpen, setIsPhoneDetailsOpen] = useState(false)
  const [store, setStore] = useState<StoreRecord | null>(null)
  const [storedProducts, setStoredProducts] = useState<Product[]>([])
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false)
  const [confirmationResendCooldown, setConfirmationResendCooldown] = useState(0)
  const [isConfirmationRateLimited, setIsConfirmationRateLimited] = useState(false)
  const [publicStore, setPublicStore] = useState<StoreRecord | null>(null)
  const [publicProducts, setPublicProducts] = useState<Product[]>([])
  const [sampleStore, setSampleStore] = useState<StoreRecord | null>(null)
  const [sampleProducts, setSampleProducts] = useState<Product[]>([])
  const phonePreviewProducts = (sampleStore ? sampleProducts : bundledProducts)
    .filter((product) => product.searchVisible !== false)
    .map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description ?? '',
      price: product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
        ? product.salePrice
        : product.price ?? 0,
      images: Array.from(new Set([product.image, ...(product.gallery ?? [])])).filter(Boolean),
    }))
  const phoneProductIndex = phonePreviewProducts.length
    ? (phoneSlideIndex - 1 + phonePreviewProducts.length) % phonePreviewProducts.length
    : 0

  useEffect(() => {
    if (screen !== 'business' || !email) return
    setBusinessEmail((currentEmail) => currentEmail || email)
  }, [screen, email])

  useEffect(() => {
    if (!onlineUserId || !isSupabaseConfigured || !onboardingActivityScreens.has(screen)) return
    let active = true
    const touchActivity = () => {
      if (active && document.visibilityState === 'visible') {
        void requireSupabase().rpc('touch_onboarding_activity', { target_step: screen }).then(() => undefined)
      }
    }
    touchActivity()
    const heartbeat = window.setInterval(touchActivity, 60_000)
    document.addEventListener('visibilitychange', touchActivity)
    return () => {
      active = false
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', touchActivity)
    }
  }, [onlineUserId, screen])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('onboarding_reminders') !== 'off') return
    const token = params.get('token') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return
    void requireSupabase().rpc('disable_onboarding_reminders', { target_token: token }).then(({ data, error }) => {
      if (!error && data === true) {
        setAuthNotice('Poe seadistamise meeldetuletused on välja lülitatud.')
        setScreen('login')
      }
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('onboarding_reminders')
      cleanUrl.searchParams.delete('token')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    })
  }, [])

  useEffect(() => {
    if (!onlineUserId || !isSupabaseConfigured) return
    const client = requireSupabase()
    const presenceSessionId = onlinePresenceSessionIdRef.current
    let active = true
    const touchPresence = () => {
      if (active) void client.rpc('touch_user_presence', { target_session_id: presenceSessionId }).then(() => undefined)
    }
    const leavePresence = () => {
      void client.rpc('leave_user_presence', { target_session_id: presenceSessionId }).then(() => undefined)
    }
    touchPresence()
    const heartbeat = window.setInterval(touchPresence, 30_000)
    const handleVisibility = () => { if (document.visibilityState === 'visible') touchPresence() }
    window.addEventListener('online', touchPresence)
    window.addEventListener('pagehide', leavePresence)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      window.clearInterval(heartbeat)
      window.removeEventListener('online', touchPresence)
      window.removeEventListener('pagehide', leavePresence)
      document.removeEventListener('visibilitychange', handleVisibility)
      leavePresence()
    }
  }, [onlineUserId])

  useEffect(() => {
    if (screen !== 'business' || !/^\d{8}$/.test(registryCode)) {
      setRegistryLookupStatus('idle')
      setRegistryLookupCompanyName('')
      return
    }

    // Do not overwrite seller details restored from an existing saved store.
    if (businessName.trim() && businessAddress.trim()) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setRegistryLookupStatus('loading')
      setRegistryLookupCompanyName('')
      try {
        const response = await fetch(`https://ariregister.rik.ee/est/api/autocomplete?q=${encodeURIComponent(registryCode)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`Äriregistri päring ebaõnnestus (${response.status}).`)

        const result = await response.json() as RegistryLookupResponse
        const company = result.data?.find((item) => String(item.reg_code) === registryCode && item.status === 'R')
        if (!company) {
          setRegistryLookupStatus('not-found')
          return
        }

        setBusinessName(company.name)
        setBusinessAddress(company.legal_address)
        setRegistryLookupCompanyName(company.name)
        setRegistryLookupStatus('found')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setRegistryLookupStatus('error')
      }
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [registryCode, registryLookupAttempt, screen])

  useEffect(() => {
    if (confirmationResendCooldown <= 0) return
    const timer = window.setInterval(() => {
      setConfirmationResendCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [confirmationResendCooldown > 0])

  useEffect(() => {
    if (!isBillingCardOpen) return
    const scrollY = window.scrollY
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.position = previous.position
      document.body.style.top = previous.top
      document.body.style.width = previous.width
      document.body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [isBillingCardOpen])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const requestedSlug = getRequestedStoreSlug(window.location)
    if (!requestedSlug) return
    getStoreBySlug(requestedSlug).then(async (found) => {
      if (!found) return
      setPublicStore(found)
      setPublicProducts(await listProducts(found.id))
    }).catch((error) => setAuthError(error instanceof Error ? error.message : 'Poe laadimine ebaõnnestus.'))
  }, [])

  useEffect(() => {
    if (!['landing', 'sample'].includes(screen) || !isSupabaseConfigured) return
    let active = true
    const refreshSampleStore = () => getDemoStore().then(async (found) => {
        if (!found || !active) return
        const nextProducts = await listProducts(found.id)
        if (!active) return
        setSampleStore(found)
        setSampleProducts(nextProducts)
      }).catch(() => {
        // Keep the bundled sample as a safe fallback before the demo-store migration is deployed.
      })
    void refreshSampleStore()
    window.addEventListener('focus', refreshSampleStore)
    return () => {
      active = false
      window.removeEventListener('focus', refreshSampleStore)
    }
  }, [screen])

  const applyStore = async (nextStore: StoreRecord) => {
    const settings = nextStore.settings as Record<string, unknown>
    setStore(nextStore)
    setStoreName(nextStore.name)
    setSlug(nextStore.slug)
    setPayment(nextStore.payment_provider)
    setPaymentStatus(nextStore.payment_status)
    setPricingPlan(nextStore.pricing_plan)
    setFixedPlanTrialStartedAt(nextStore.trial_started_at)
    setShipping(nextStore.shipping)
    setBusinessName(String(settings.businessName ?? ''))
    setRegistryCode(String(settings.registryCode ?? ''))
    setBusinessAddress(String(settings.businessAddress ?? ''))
    setBusinessEmail(String(settings.contactEmail ?? '') || email)
    setReturnsText(String(settings.returnsText ?? DEFAULT_RETURNS_TEXT))
    setStoredProducts(await listProducts(nextStore.id))
  }

  const openOwnedStore = async (nextStore: StoreRecord) => {
    await applyStore(nextStore)
    setScreen(getStoreDestination(nextStore))
    const cleanUrl = new URL(window.location.href)
    if (cleanUrl.searchParams.has('continue_setup')) {
      cleanUrl.searchParams.delete('continue_setup')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    let recoveryMode = window.location.hash.includes('type=recovery')
    if (recoveryMode) setScreen('reset-password')
    const restore = async () => {
      const { data } = await requireSupabase().auth.getSession()
      if (!data.session || !active || recoveryMode) {
        if (!data.session && active && !recoveryMode && new URLSearchParams(window.location.search).get('continue_setup') === '1') setScreen('login')
        return
      }
      const { data: refreshedData } = await requireSupabase().auth.refreshSession()
      const currentSession = refreshedData.session ?? data.session
      if (currentSession.user.app_metadata?.role === 'admin' && !getRequestedStoreSlug(window.location)) {
        window.location.replace('/admin')
        return
      }
      setOnlineUserId(currentSession.user.app_metadata?.role === 'admin' ? null : currentSession.user.id)
      setEmail(currentSession.user.email ?? '')
      let existing = await getMyStore()
      if (!existing || !active) return

      const urlParams = new URLSearchParams(window.location.search)
      const billingResult = urlParams.get('billing')
      if (billingResult) {
        if (billingResult === 'success') {
          for (let attempt = 0; attempt < 10 && !existing.stripe_subscription_id; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 500))
            existing = await getMyStore() ?? existing
          }
          setAuthNotice(existing.stripe_subscription_id
            ? 'Kindel pakett ja 30-päevane prooviperiood on aktiveeritud.'
            : 'Stripe kinnitas valiku. Paketi olek uueneb mõne hetke pärast.')
        } else {
          setAuthNotice('Kindla paketi aktiveerimine katkestati. Sinu senine pakett jäi kehtima.')
        }
        const cleanUrl = new URL(window.location.href)
        cleanUrl.searchParams.delete('billing')
        window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
        await openOwnedStore(existing)
        return
      }

      const stripeConnectResult = urlParams.get('stripe_connect')
      if (!stripeConnectResult) {
        await openOwnedStore(existing)
        return
      }

      await applyStore(existing)
      setScreen('payments')
      setIsStripeConnecting(true)
      try {
        if (stripeConnectResult === 'refresh') setIsStripeOnboardingOpen(true)
        const result = await invokeStripeConnect('status')
        const refreshedStore = await getMyStore()
        if (refreshedStore && active) await applyStore(refreshedStore)
        setAuthNotice(result.status === 'connected'
          ? 'Stripe on ühendatud ja maksed on aktiivsed.'
          : 'Stripe sai andmed kätte. Konto kontroll või seadistamine on veel pooleli.')
      } finally {
        setIsStripeConnecting(false)
        const cleanUrl = new URL(window.location.href)
        cleanUrl.searchParams.delete('stripe_connect')
        window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
      }
    }
    const { data } = requireSupabase().auth.onAuthStateChange((event, session) => {
      // `restore` owns the initial session. Ignoring INITIAL_SESSION here avoids
      // a late empty callback clearing a user who just signed in through the UI.
      if (event !== 'INITIAL_SESSION') {
        setOnlineUserId(session?.user.app_metadata?.role === 'admin' ? null : session?.user.id ?? null)
      }
      if (event === 'PASSWORD_RECOVERY' && active) {
        recoveryMode = true
        setEmail(session?.user.email ?? '')
        setAuthError('')
        setAuthNotice('')
        setScreen('reset-password')
        return
      }
      // Keep the loaded store in memory after sign-out so the merchant can
      // continue viewing it as a customer. Account deletion clears it explicitly.
    })
    restore().catch((error) => active && setAuthError(error instanceof Error ? error.message : 'Andmete laadimine ebaõnnestus.'))
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false)
    try {
      const form = new FormData(event.currentTarget)
      const existing = await authenticateOwner(email, String(form.get('password') ?? ''))
      if (existing === 'admin') {
        window.location.assign('/admin')
        return
      }
      if (existing) await openOwnedStore(existing)
      else setScreen('store')
    } catch (error) {
      if (isEmailNotConfirmedError(error)) {
        setNeedsEmailConfirmation(true)
        setAuthError(getLocalizedAuthError(error, 'E-posti aadress pole veel kinnitatud.'))
      } else setAuthError(getLocalizedAuthError(error, 'Sisselogimine ebaõnnestus.'))
    }
    finally { setIsAuthBusy(false) }
  }

  const restoreLoginScrollAfterKeyboard = (event: React.FocusEvent<HTMLInputElement>) => {
    if (event.relatedTarget || !window.matchMedia('(max-width: 700px)').matches) return
    window.setTimeout(() => {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) return
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 250)
  }

  const resendConfirmation = async () => {
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { error } = await requireSupabase().auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setEmail(normalizedEmail)
      setIsConfirmationRateLimited(false)
      setConfirmationResendCooldown(60)
      setAuthNotice('Uus kinnituskiri on saadetud. Kontrolli ka rämpsposti kausta.')
    } catch (error) {
      const message = getLocalizedAuthError(error, 'Kinnituskirja saatmine ebaõnnestus.')
      setAuthError(message)
      if (isEmailRateLimitError(error)) {
        setIsConfirmationRateLimited(true)
        setConfirmationResendCooldown(0)
      }
    } finally { setIsAuthBusy(false) }
  }

  const authenticateOwner = async (loginEmail: string, password: string) => {
    if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
    const normalizedEmail = loginEmail.trim().toLowerCase()
    const { data, error } = await requireSupabase().auth.signInWithPassword({ email: normalizedEmail, password })
    if (error) throw error
    setEmail(normalizedEmail)
    if (data.user.app_metadata?.role === 'admin') {
      setOnlineUserId(null)
      return 'admin' as const
    }
    setOnlineUserId(data.user.id)
    void requireSupabase().rpc('touch_user_presence', { target_session_id: onlinePresenceSessionIdRef.current }).then(() => undefined)
    return getMyStore()
  }

  const signInFromStore = async (loginEmail: string, password: string) => {
    const existing = await authenticateOwner(loginEmail, password)
    if (existing === 'admin') {
      window.location.assign('/admin')
      return
    }
    if (existing) {
      await openOwnedStore(existing)
      setPublicStore(null)
      return
    }
    setScreen('store')
    setPublicStore(null)
  }

  const signUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false)
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const form = new FormData(event.currentTarget)
      const normalizedEmail = email.trim().toLowerCase()
      const { data, error } = await requireSupabase().auth.signUp({
        email: normalizedEmail,
        password: String(form.get('password') ?? ''),
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setEmail(normalizedEmail)
      if (!data.session) {
        setNeedsEmailConfirmation(true)
        setAuthNotice('Konto on loodud. Kinnita e-posti aadress ja logi seejärel sisse.')
        setScreen('login')
        return
      }
      setScreen('store')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Konto loomine ebaõnnestus.') }
    finally { setIsAuthBusy(false) }
  }

  const requestPasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
      if (error) throw error
      setAuthNotice('Taastamislink on saadetud. Kontrolli oma e-posti.')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Taastamislingi saatmine ebaõnnestus.') }
    finally { setIsAuthBusy(false) }
  }

  const completePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      const form = new FormData(event.currentTarget)
      const password = String(form.get('password') ?? '')
      const confirmation = String(form.get('passwordConfirmation') ?? '')
      if (password.length < 8) throw new Error('Parool peab olema vähemalt 8 tähemärki pikk.')
      if (password !== confirmation) throw new Error('Paroolid ei ühti.')
      const { error } = await requireSupabase().auth.updateUser({ password })
      if (error) throw error
      await requireSupabase().auth.signOut({ scope: 'global' })
      setAuthNotice('Parool on muudetud. Logi nüüd uue parooliga sisse.')
      setScreen('login')
      window.history.replaceState({}, '', window.location.pathname)
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Parooli muutmine ebaõnnestus.') }
    finally { setIsAuthBusy(false) }
  }

  const persistStore = async (published = false, overrides: Partial<StoreRecord> = {}, nextStep?: OnboardingStep) => {
    const existingSettings = (store?.settings ?? {}) as Record<string, unknown>
    const payload = {
      name: storeName.trim(), slug: slug || slugify(storeName), payment_provider: payment, payment_status: paymentStatus,
      pricing_plan: pricingPlan, trial_started_at: fixedPlanTrialStartedAt, shipping, is_published: published,
      settings: {
        ...existingSettings,
        businessName: businessName.trim(),
        registryCode: registryCode.trim(),
        businessAddress: businessAddress.trim(),
        contactEmail: businessEmail.trim(),
        returnsText: returnsText.trim() || DEFAULT_RETURNS_TEXT,
        onboardingStep: published ? 'complete' : nextStep ?? existingSettings.onboardingStep ?? 'business',
      },
      ...overrides,
    }
    const saved = store ? await updateStore(store.id, payload) : await createStore(payload)
    setStore(saved)
    return saved
  }

  const completePaymentConnection = async (provider: PaymentProvider, status: 'connected' | 'pending', nextStep?: OnboardingStep) => {
    setPayment(provider)
    setPaymentStatus(status)
    try {
      if (store) {
        const settings = nextStep
          ? { ...(store.settings as Record<string, unknown>), onboardingStep: nextStep }
          : store.settings
        setStore(await updateStore(store.id, { payment_provider: provider, payment_status: status, settings }))
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Makseühenduse salvestamine ebaõnnestus.')
    }
  }

  const startStripeConnect = async () => {
    setIsStripeConnecting(true)
    setAuthError('')
    setAuthNotice('')
    try {
      const saved = await persistStore(store?.is_published ?? false, { payment_provider: 'stripe', payment_status: 'pending' }, store?.is_published ? 'complete' : 'payments')
      setPayment('stripe')
      setPaymentStatus('pending')
      setStore(saved)
      setIsStripeOnboardingOpen(true)
      setIsStripeConnecting(false)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Stripe’i ühendamine ebaõnnestus.')
      setIsStripeConnecting(false)
    }
  }

  const finishStripeEmbeddedOnboarding = async () => {
    setIsStripeConnecting(true)
    setAuthError('')
    try {
      const result = await invokeStripeConnect('status')
      const refreshedStore = await getMyStore()
      if (refreshedStore) await applyStore(refreshedStore)
      setIsStripeOnboardingOpen(false)
      setAuthNotice(result.status === 'connected'
        ? 'Stripe on ühendatud ja maksed on aktiivsed.'
        : 'Stripe salvestas andmed. Konto kontroll või seadistamine on veel pooleli.')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Stripe’i staatuse kontroll ebaõnnestus.')
    } finally {
      setIsStripeConnecting(false)
    }
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
    if (!isStripeOnboardingOpen) restoreIOSViewportScale()
  }, [screen, isStripeOnboardingOpen])

  useEffect(() => {
    if (!isIOSWebKit || !isStripeOnboardingOpen) return
    const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!viewportMeta) return

    const previousContent = viewportMeta.content
    const baseContent = previousContent
      .replace(/,?\s*(?:maximum-scale|user-scalable)\s*=\s*[^,]+/gi, '')
      .replace(/,{2,}/g, ',')
      .replace(/^,|,$/g, '')
    // Stripe's embedded fields live outside our CSS boundary, so their font
    // size can't be corrected with the app's normal 16px input rule.
    viewportMeta.content = `${baseContent}, maximum-scale=1.0, user-scalable=no`

    return () => {
      viewportMeta.content = previousContent
      window.requestAnimationFrame(restoreIOSViewportScale)
    }
  }, [isStripeOnboardingOpen])

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
    if (!phonePreviewProducts.length || phoneSlideIndex !== phonePreviewProducts.length + 1) return
    const normalizeTimeout = window.setTimeout(() => {
      setIsPhoneSwipeAnimated(false)
      setPhoneSlideIndex(1)
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsPhoneSwipeAnimated(true)))
    }, 560)
    return () => window.clearTimeout(normalizeTimeout)
  }, [phoneSlideIndex, phonePreviewProducts.length])

  useEffect(() => {
    setIsPhoneSwipeAnimated(false)
    setPhoneSlideIndex(1)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsPhoneSwipeAnimated(true)))
  }, [phonePreviewProducts.length])

  const resetDemo = () => {
    setScreen('landing')
    setEmail('')
    setStoreName('')
    setSlug('')
    setPayment('stripe')
    setPricingPlan('flexible')
    setFixedPlanTrialStartedAt(null)
    setPaymentStatus('idle')
    setIsStripeConnecting(false)
    setIsStripeOnboardingOpen(false)
    setIsMontonioConnectOpen(false)
    setIsBillingCardOpen(false)
    setShipping(['omniva', 'pickup'])
    setBusinessName('')
    setRegistryCode('')
    setBusinessAddress('')
    setBusinessEmail('')
    setReturnsText(DEFAULT_RETURNS_TEXT)
  }

  const handleAccountDeleted = () => {
    setStore(null)
    setStoredProducts([])
    resetDemo()
  }

  const backMap: Partial<Record<Screen, Screen>> = {
    login: 'landing', 'forgot-password': 'login', 'reset-password': 'login', account: 'landing', store: 'account', business: 'store', payments: 'business', shipping: 'payments', publish: 'shipping',
  }
  const phoneProduct = phonePreviewProducts[phoneProductIndex]
  const selectPricingPlan = (plan: PricingPlan) => {
    setPricingPlan(plan)
  }
  const publishStore = async () => {
    if (!businessName.trim() || !/^\d{8}$/.test(registryCode.trim()) || !businessAddress.trim() || !businessEmail.trim()) {
      setAuthError('Enne avaldamist lisa täielikud müüja andmed.')
      setScreen('business')
      return
    }
    if (pricingPlan === 'fixed' && !['active', 'trialing'].includes(String(store?.stripe_subscription_status))) {
      setIsBillingCardOpen(true)
      return
    }
    setIsPublishing(true); setAuthError('')
    try { await persistStore(true); setScreen('storefront') }
    catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe avaldamine ebaõnnestus.') }
    finally { setIsPublishing(false) }
  }

  const returnNotice = authNotice ? <div className="app-return-notice" role="status" aria-live="polite">
    <span>{authNotice}</span><button type="button" onClick={() => setAuthNotice('')} aria-label="Sulge teade">×</button>
  </div> : null

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
    ownerEmail={email}
    onOwnerLogin={signInFromStore}
  />
  if (screen === 'sample') return <Storefront
    key={`sample-storefront-${sampleStore?.id ?? 'bundled'}`}
    storeId={sampleStore?.id}
    initialSettings={sampleStore?.settings}
    seedProducts={sampleStore ? sampleProducts : undefined}
    storeName={sampleStore?.name}
    storeSlug={sampleStore?.slug}
    paymentProvider={sampleStore?.payment_provider}
    paymentsReady={false}
    initialShipping={sampleStore?.shipping}
    onExit={() => setScreen('landing')}
  />
  if (screen === 'storefront') return <>
    {returnNotice}
    <Storefront key={`merchant-storefront-${store?.id ?? 'new'}`} storeId={store?.id} initialSettings={store?.settings} seedProducts={storedProducts} storeName={storeName || 'Minu pood'} storeSlug={slug || 'minu-pood'} paymentProvider={payment} paymentsReady={paymentStatus === 'connected'} initialShipping={shipping} pricingPlan={pricingPlan} fixedPlanTrialStartedAt={fixedPlanTrialStartedAt} merchantMode ownerEmail={email} onOwnerLogin={signInFromStore} onBackToSetup={() => setScreen('publish')} onConnectPaymentProvider={(provider: PaymentProvider) => provider === 'stripe' ? void startStripeConnect() : setIsMontonioConnectOpen(true)} onStoreChange={(nextStore) => { setStore(nextStore); setStoreName(nextStore.name); setPayment(nextStore.payment_provider); setPaymentStatus(nextStore.payment_status); setPricingPlan(nextStore.pricing_plan); setFixedPlanTrialStartedAt(nextStore.trial_started_at); setShipping(nextStore.shipping) }} onAccountDeleted={handleAccountDeleted} onExit={resetDemo} />
    {isMontonioConnectOpen && <MontonioConnectDemo storeName={storeName} businessName={businessName} registryCode={registryCode} onClose={() => setIsMontonioConnectOpen(false)} onComplete={(status) => { completePaymentConnection('montonio', status); setIsMontonioConnectOpen(false) }} />}
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
              {[phonePreviewProducts[phonePreviewProducts.length - 1], ...phonePreviewProducts, phonePreviewProducts[0]].map((product, index) => <img src={product.images[0]} alt={product.name} key={`${product.id}-${index}`} />)}
            </div>
            <div className="demo-phone__shade" />
            <div className="demo-phone__progress" style={{ gridTemplateColumns: `repeat(${phonePreviewProducts.length}, 1fr)` }}>{phonePreviewProducts.map((product, index) => <i className={index === phoneProductIndex ? 'is-active' : ''} key={product.id} />)}</div>
            <header className="demo-phone__header">
              <div><img src="/images/poeruum-email-logo.svg" alt="" /><strong>POERUUM</strong></div>
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
            <footer><strong>POERUUM</strong><small>Valmistatud hoolega Eestis</small></footer>
          </section>
        </div></div>
      </div>
      </div>
    </section>
    <section className="demo-benefits"><div><b>01</b><strong>Loo konto</strong><span>Alusta vaid mõne minutiga</span></div><div><b>02</b><strong>Seadista oma pood</strong><span>Lisa tooted, maksed ja tarne</span></div><div><b>03</b><strong>Avalda ja hakka müüma</strong><span>Sinu poe veebiaadressil</span></div></section>
    <section className="demo-pricing" id="hind">
      <div className="demo-pricing__copy">
        <span className="demo-eyebrow">Kaks lihtsat valikut</span>
        <h2>Vali, kuidas<br />maksad.</h2>
        <p>Alusta ilma kuutasuta või vali kindel kuukulu. Mõlemas paketis saad kasutada kõiki Poeruumi põhivõimalusi.</p>
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
      <p className="demo-pricing__note">Paketti saad hiljem mugavalt vahetada. Paketi hind ei sisalda maksete töötlemise tasusid.</p>
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
        <details><summary>Kas saan paketti vahetada?<span>+</span></summary><p>Jah. Paketti saad hiljem mugavalt vahetada. Paindliku paketiga ei ole müügita kuul Poeruumi tasu.</p></details>
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
        </aside>
        <section className="auth-card auth-card--login">
          <h1>Logi sisse</h1><p>Tagasi oma poe haldusesse.</p>
          <form onSubmit={signIn}>
            <label>E-posti aadress<input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false); setConfirmationResendCooldown(0); setIsConfirmationRateLimited(false) }} onBlur={restoreLoginScrollAfterKeyboard} placeholder="sina@ettevote.ee" autoComplete="username" enterKeyHint="next" autoFocus /></label>
            <label>Parool<input required name="password" type="password" minLength={6} placeholder="Sinu parool" autoComplete="current-password" enterKeyHint="done" onBlur={restoreLoginScrollAfterKeyboard} /></label>
            <button className="auth-password-link" type="button" onClick={() => { setAuthError(''); setAuthNotice(''); setScreen('forgot-password') }}>Unustasid parooli?</button>
            {needsEmailConfirmation && <div className="auth-confirmation-prompt" role="alert">
              <span><strong>{authError || 'Kinnita e-posti aadress'}</strong><small>{isConfirmationRateLimited ? 'Kasuta kõige uuemat saabunud kirja või proovi umbes tunni pärast uuesti.' : 'Kasuta kõige uuemat kirja, mille Poeruum sulle saatis.'}</small></span>
              <button type="button" disabled={isAuthBusy || isConfirmationRateLimited || confirmationResendCooldown > 0} onClick={resendConfirmation}>
                {isAuthBusy ? 'Saadan…' : isConfirmationRateLimited ? 'Proovi hiljem' : confirmationResendCooldown > 0 ? `Proovi ${confirmationResendCooldown} s pärast` : 'Saada kiri uuesti'}
              </button>
            </div>}
            {authError && !needsEmailConfirmation && <p className="add-product-error" role="alert">{authError}</p>}
            {authNotice && !needsEmailConfirmation && <p className="auth-notice" role="status">{authNotice}</p>}
            <button type="submit" disabled={isAuthBusy}>{isAuthBusy ? 'Login sisse…' : 'Jätka oma poega'} <span>→</span></button>
          </form>
          <div className="auth-switch"><span>Pole veel kontot?</span><button type="button" onClick={() => setScreen('account')}>Loo pood</button></div>
          <small>Turvaline sisselogimine. Sinu andmed on kaitstud.</small>
        </section>
      </div>
    </div>
  </main>

  if (screen === 'forgot-password') return <main className="auth-page auth-page--login">
    <FlowHeader onBack={() => { setAuthError(''); setAuthNotice(''); setScreen('login') }} />
    <div className="auth-flow auth-flow--login"><div className="auth-content">
      <aside className="auth-intro auth-intro--login"><span className="demo-eyebrow">Parooli taastamine</span><h1>Saadame sulle turvalise lingi.</h1><p>Lingi kaudu saad valida uue parooli. Sinu pood ja andmed jäävad alles.</p></aside>
      <section className="auth-card auth-card--login">
        <h1>Unustasid parooli?</h1><p>Sisesta oma konto e-posti aadress.</p>
        <form onSubmit={requestPasswordReset}>
          <label>E-posti aadress<input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAuthError(''); setAuthNotice('') }} placeholder="sina@ettevote.ee" autoComplete="email" autoFocus /></label>
          {authError && <p className="add-product-error" role="alert">{authError}</p>}
          {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
          <button type="submit" disabled={isAuthBusy || !email.trim()}>{isAuthBusy ? 'Saadan…' : 'Saada taastamislink'} <span>→</span></button>
        </form>
        <div className="auth-switch"><span>Parool tuli meelde?</span><button type="button" onClick={() => setScreen('login')}>Logi sisse</button></div>
      </section>
    </div></div>
  </main>

  if (screen === 'reset-password') return <main className="auth-page auth-page--login">
    <FlowHeader onBack={() => setScreen('login')} />
    <div className="auth-flow auth-flow--login"><div className="auth-content">
      <aside className="auth-intro auth-intro--login"><span className="demo-eyebrow">Uus parool</span><h1>Taasta ligipääs oma poele.</h1><p>Vali uus tugev parool, mida sa mujal ei kasuta.</p></aside>
      <section className="auth-card auth-card--login">
        <h1>Vali uus parool</h1><p>{email ? `Konto: ${email}` : 'Sisesta uus parool.'}</p>
        <form onSubmit={completePasswordReset}>
          <label>Uus parool<input required name="password" type="password" minLength={8} placeholder="Vähemalt 8 tähemärki" autoComplete="new-password" autoFocus /></label>
          <label>Korda uut parooli<input required name="passwordConfirmation" type="password" minLength={8} placeholder="Korda parooli" autoComplete="new-password" /></label>
          {authError && <p className="add-product-error" role="alert">{authError}</p>}
          <button type="submit" disabled={isAuthBusy}>{isAuthBusy ? 'Muudan…' : 'Salvesta uus parool'} <span>→</span></button>
        </form>
      </section>
    </div></div>
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
          <h1>Loo konto</h1>
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
  const paymentNeedsAction = paymentStatus === 'idle' || (payment === 'stripe' && paymentStatus === 'pending')
  const paymentCanContinue = paymentStatus === 'connected' || (payment === 'montonio' && paymentStatus === 'pending')

  return <SetupShell screen={screen} onBack={onBack}>
    {returnNotice}
    {screen === 'store' && <form className="setup-form" onSubmit={async (event) => { event.preventDefault(); setAuthError(''); try { await persistStore(false, {}, 'business'); setScreen('business') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>
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
      <div className="domain-preview"><span>Poe aadress</span><strong>{slug || 'minu-pood'}.poeruum.ee</strong><small>Aadressi saad hiljem muuta või lisada oma domeeni.</small></div>
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      <button className="setup-next" type="submit">Jätka müüja andmetega <span>→</span></button>
    </form>}

    {screen === 'payments' && <div className="setup-form">
      {!isStripeOnboardingOpen && <><span className="setup-kicker">Maksete vastuvõtmine</span><h1>Kuidas kliendid maksavad?</h1>
      <div className="provider-list">
        <button className={payment === 'stripe' ? 'is-selected' : ''} onClick={() => {
          setPayment('stripe')
          setPaymentStatus(store?.stripe_account_id
            ? store.stripe_account_charges_enabled && store.stripe_account_payouts_enabled ? 'connected' : 'pending'
            : 'idle')
        }}>
          <i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="" /></i><span><strong>Stripe <em>Kõige kiirem</em></strong><small>Kaardid, Apple Pay ja Google Pay</small></span><b>{payment === 'stripe' ? '✓' : ''}</b>
        </button>
        <button className={payment === 'montonio' ? 'is-selected' : ''} onClick={() => { setPayment('montonio'); setPaymentStatus('idle'); setIsStripeOnboardingOpen(false) }}>
          <i className="provider-logo provider-logo--montonio"><img src="/images/montonio-wordmark.svg" alt="" /></i><span><strong>Montonio</strong><small>Pangalingid, kaardid ja maksa hiljem</small></span><b>{payment === 'montonio' ? '✓' : ''}</b>
        </button>
      </div></>}
      {payment === 'stripe' && isStripeOnboardingOpen ? <StripeEmbeddedOnboarding
        onExit={finishStripeEmbeddedOnboarding}
        onClose={finishStripeEmbeddedOnboarding}
        onError={(message) => { setAuthError(message); setIsStripeConnecting(false) }}
      /> : <>{paymentNeedsAction ? <button className={`payment-setup-action is-${payment}`} disabled={isStripeConnecting && payment === 'stripe'} onClick={() => payment === 'stripe' ? void startStripeConnect() : setIsMontonioConnectOpen(true)}>
        <strong>{isStripeConnecting && payment === 'stripe' ? 'Avan Stripe’i…' : paymentStatus === 'pending' ? 'Jätka Stripe’i seadistamist' : `Seadista ${payment === 'stripe' ? 'Stripe' : 'Montonio'}`}</strong><span>→</span>
      </button> : <div className={`connected-provider${paymentStatus === 'pending' ? ' is-pending' : ''}`}><span>{paymentStatus === 'pending' ? '…' : '✓'}</span><div><strong>{paymentStatus === 'pending' ? 'Montonio taotlus on kontrollimisel' : 'Maksed on valmis'}</strong></div></div>}</>}
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      {!isStripeOnboardingOpen && paymentCanContinue && <button className="setup-next" onClick={async () => { try { await persistStore(false, {}, 'shipping'); setScreen('shipping') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka tarnega <span>→</span></button>}
      {isMontonioConnectOpen && <MontonioConnectDemo storeName={storeName} businessName={businessName} registryCode={registryCode} onClose={() => setIsMontonioConnectOpen(false)} onComplete={(status) => { void completePaymentConnection('montonio', status, 'shipping'); setIsMontonioConnectOpen(false) }} />}
    </div>}

    {screen === 'shipping' && <div className="setup-form"><span className="setup-kicker">Kauba kättesaamine</span><h1>Vali tarneviisid</h1>
      <div className="shipping-list">{[
        ['omniva', 'https://old.omniva.ee/public/banners/logo/Omniva_lockup_horizontal_orange.svg', 'Omniva pakiautomaat'],
        ['dpd', 'https://www.dpd.com/wp-content/themes/DPD_NoLogin/images/DPD_logo_redgrad_rgb_responsive.svg', 'DPD pakiautomaat'],
        ['smartposti', 'https://images.ctfassets.net/dvxpcmq06s7e/5LDF7M5UltxLRSteji1IIj/66fc61b81e453d12d154fcaceec04e42/Logo_SmartPosti.png', 'SmartPosti pakiautomaat'],
        ['pickup', '', 'Tulen ise järele'],
      ].map(([id, logo, name]) => <label key={id}><span className={`shipping-brand shipping-brand--${id}`}>{logo ? <img src={logo} alt="" loading="eager" decoding="async" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>}</span><div><strong>{name}</strong></div><input type="checkbox" checked={shipping.includes(id)} onChange={() => setShipping((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} /><i /></label>)}</div>
      <button className="setup-next" disabled={!shipping.length} onClick={async () => { try { await persistStore(false, {}, 'publish'); setScreen('publish') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka avaldamisega <span>→</span></button>
    </div>}

    {screen === 'business' && <form className="setup-form setup-business" onSubmit={async (event) => {
      event.preventDefault()
      setAuthError('')
      if (!/^\d{8}$/.test(registryCode.trim())) { setAuthError('Registrikood peab olema 8-kohaline.'); return }
      try { await persistStore(false, {}, 'payments'); setScreen('payments') }
      catch (error) { setAuthError(error instanceof Error ? error.message : 'Müüja andmete salvestamine ebaõnnestus.') }
    }}>
      <span className="setup-kicker">Kes kliendile müüb?</span><h1>Sinu ettevõte</h1>
      <label>Registrikood<input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={registryCode} onChange={(event) => {
        const nextRegistryCode = event.target.value.replace(/\D/g, '').slice(0, 8)
        if (nextRegistryCode !== registryCode) {
          setBusinessName('')
          setBusinessAddress('')
          setRegistryLookupStatus('idle')
          setRegistryLookupCompanyName('')
        }
        setRegistryCode(nextRegistryCode)
      }} placeholder="12345678" /></label>
      {registryLookupStatus !== 'idle' && <div className={`setup-business__registry-note is-${registryLookupStatus}`} role={registryLookupStatus === 'not-found' || registryLookupStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
        <span>{registryLookupStatus === 'found' ? '✓' : registryLookupStatus === 'loading' ? '…' : '!'}</span>
        <p>{registryLookupStatus === 'loading'
          ? 'Otsin ettevõtet Äriregistrist…'
          : registryLookupStatus === 'found'
            ? `Ettevõte leitud: ${registryLookupCompanyName}`
            : registryLookupStatus === 'not-found'
              ? 'Sellise registrikoodiga aktiivset ettevõtet ei leitud.'
              : <>Äriregistri päring ebaõnnestus. <button type="button" onClick={() => setRegistryLookupAttempt((attempt) => attempt + 1)}>Proovi uuesti</button></>}</p>
      </div>}
      <label>Ettevõtte nimi<input required value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Minu Ettevõte OÜ" /></label>
      <label>Ettevõtte aadress<input required value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} placeholder="Tänav 1, Tallinn, Eesti" /></label>
      <label>Klientide kontakt-e-post<input required type="email" value={businessEmail} onChange={(event) => setBusinessEmail(event.target.value)} placeholder="tere@minupood.ee" /></label>
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      <button className="setup-next" type="submit">Jätka maksetega <span>→</span></button>
    </form>}

    {screen === 'publish' && <div className="setup-form publish-step"><div className="publish-ready">
      <div className="publish-ready__copy">
        <strong>Sinu Poeruum<br />on valmis!</strong>
      </div>
      <span className="publish-celebration" aria-hidden="true">
        <svg viewBox="0 0 140 120">
          <circle className="publish-celebration__halo" cx="72" cy="62" r="48" />
          <ellipse className="publish-celebration__shadow" cx="72" cy="103" rx="38" ry="6" />
          <g className="publish-celebration__sparkles">
            <path d="m21 37 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" />
            <path d="m119 25 1.5 3.5L124 30l-3.5 1.5L119 35l-1.5-3.5L114 30l3.5-1.5L119 25Z" />
            <circle cx="121" cy="75" r="3" />
          </g>
          <g className="publish-celebration__shop">
            <rect className="publish-celebration__building" x="38" y="42" width="68" height="58" rx="8" />
            <path className="publish-celebration__roof" d="M34 48 43 30h60l9 18Z" />
            <g className="publish-celebration__awning">
              <path d="M34 48h78v10c0 6-9 9-13 2-4 7-13 7-17 0-4 7-13 7-17 0-4 7-13 7-17 0-5 7-14 4-14-2Z" />
              <path d="M49 48 55 30h12l-2 18M82 48l-2-18h12l6 18" />
            </g>
            <rect className="publish-celebration__window" x="47" y="68" width="25" height="21" rx="4" />
            <path className="publish-celebration__window-line" d="M59.5 69v19M48 78.5h23" />
            <rect className="publish-celebration__interior" x="80" y="66" width="17" height="34" rx="4" />
            <g className="publish-celebration__door">
              <rect className="publish-celebration__door-panel" x="80" y="66" width="17" height="34" rx="4" />
              <circle className="publish-celebration__handle" cx="84" cy="83" r="1.7" />
            </g>
          </g>
        </svg>
      </span>
    </div>
      <section className="publish-store-card" aria-label="Avaldatava poe kokkuvõte">
        <div className="publish-store-address">
          <span><small>Poe aadress</small><strong>{slug}<b>.poeruum.ee</b></strong></span>
          <button type="button" onClick={() => setScreen('store')} aria-label="Muuda poe nime ja aadressi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.5 6.7 2.8 2.8" /></svg></button>
        </div>
        <div className={`publish-payment-status${paymentStatus === 'pending' ? ' is-pending' : ''}`}>
          <i className={`provider-logo provider-logo--${payment}`}><img src={payment === 'stripe' ? '/images/stripe-wordmark.svg' : '/images/montonio-wordmark.svg'} alt={payment === 'stripe' ? 'Stripe' : 'Montonio'} /></i>
          <strong>{paymentStatus === 'pending' ? 'Kontrollimisel' : 'Maksed aktiivsed'}</strong>
          <button type="button" onClick={() => setScreen('payments')} aria-label="Muuda makseteenust"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.5 6.7 2.8 2.8" /></svg></button>
        </div>
        <div className="publish-seller-row">
          <span><strong>{businessName}</strong><small>· {registryCode}</small></span>
          <button type="button" onClick={() => setScreen('business')} aria-label="Muuda müüja andmeid">Muuda</button>
        </div>
      </section>
      <section className="publish-plan-section" aria-labelledby="publish-plan-heading">
        <header className="publish-plan-heading">
          <span><small>Hinnastus</small><h2 id="publish-plan-heading">Vali pakett</h2></span>
          <p>Vali alustamiseks sobiv pakett.</p>
        </header>
        <div className="publish-plan-picker" role="radiogroup" aria-labelledby="publish-plan-heading">
          <button type="button" role="radio" aria-checked={pricingPlan === 'flexible'} className={pricingPlan === 'flexible' ? 'is-selected' : ''} onClick={() => selectPricingPlan('flexible')}>
            <span className="publish-plan-name">Paindlik<i aria-hidden="true" /></span>
            <strong className="publish-plan-price">0 € <small>/ kuu</small></strong>
            <span className="publish-plan-details"><strong>4% müügilt</strong><small>Maksimaalselt 39 € kuus</small></span>
            <b>{pricingPlan === 'flexible' ? 'Valitud' : 'Vali pakett'}<span aria-hidden="true">{pricingPlan === 'flexible' ? '✓' : '→'}</span></b>
          </button>
          <button type="button" role="radio" aria-checked={pricingPlan === 'fixed'} className={pricingPlan === 'fixed' ? 'is-selected' : ''} onClick={() => selectPricingPlan('fixed')}>
            <span className="publish-plan-name">Kindel<i aria-hidden="true" /></span>
            <strong className="publish-plan-price">29 € <small>/ kuu + km</small></strong>
            <span className="publish-plan-details"><strong>Esimesed 30 päeva tasuta</strong><small>0% Poeruumi müügitasu</small></span>
            <b>{pricingPlan === 'fixed' ? 'Valitud' : 'Vali Kindel'}<span aria-hidden="true">{pricingPlan === 'fixed' ? '✓' : '→'}</span></b>
          </button>
        </div>
        <small className="publish-fee-note">Paketti saad hiljem muuta · Maksetasud lisanduvad</small>
      </section>
      <button className="publish-button" disabled={isPublishing} onClick={publishStore}>
        {isPublishing
          ? 'Avaldan poodi…'
          : pricingPlan === 'fixed' && !fixedPlanTrialStartedAt
            ? 'Jätka maksekaardiga'
            : 'Avalda pood'}
        <span>{isPublishing ? '◌' : '→'}</span>
      </button>
      <div className="publish-notes">
        <small className="publish-note">{pricingPlan === 'fixed' && <><span className="publish-trial-copy">Prooviperiood algab avaldamisel.</span><span className="publish-note-separator" aria-hidden="true"> · </span></>}Avaldamisega nõustud <a href="/kasutustingimused" target="_blank" rel="noreferrer">kasutustingimustega</a>.</small>
      </div>
    </div>}
    {isBillingCardOpen && <BillingCardDemo confirmLabel="Jätka Stripe’is" onClose={() => setIsBillingCardOpen(false)} onConfirm={async (checkoutRequestId) => {
      await persistStore(false, { pricing_plan: store?.pricing_plan ?? 'flexible' })
      const url = await startStripeBillingCheckout(checkoutRequestId)
      window.location.assign(url)
    }} />}
  </SetupShell>
}
