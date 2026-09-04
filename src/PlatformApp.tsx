import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import BillingPlanDialog from './BillingPlanDialog'
import { Brand } from './Brand'
import { createStore, getPublicShowcaseStore, getMyStore, getStoreByHostname, getStoreBySlug, invokeStripeConnect, listProducts, setStorePublication, startStripeBillingCheckout, updateStore, type PublicStoreRecord, type StoreContentInput, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { getPaymentSetupState, getStoreDestination, getStripeSetupMode, type OnboardingStep, type StripeSetupPurpose } from './lib/onboarding'
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS_TEXT } from './lib/passwordPolicy'
import { getRequestedProductSlug, getRequestedStoreSlug, isDedicatedStorefrontHostname, isReservedStoreSlug, STOREFRONT_ROOT_DOMAIN } from './lib/storefrontUrl'
import { isHomepageAnalyticsLocation, startHomepageEngagementTracking, trackHomepageEvent } from './lib/homepageAnalytics'
import { products as bundledProducts, type Product } from './products'
import { getCaptchaRequiredMessage, isCaptchaConfigured, Turnstile } from './Turnstile'
import { createRandomId } from './lib/randomId'
import { stripeRequirementsFromStore, type StripeRequirementSummary } from './lib/stripeRequirements'
import { getStripeRequirementsLinkIntent, getStripeRequirementsStoreTarget, removeStripeRequirementsLinkParam, type StripeRequirementsLinkIntent } from './lib/stripeRequirementsLink'
import {
  DEFAULT_RETURNS_TEXT,
  FIXED_PLAN_MONTHLY_FEE,
  FIXED_PLAN_MONTHLY_TOTAL,
  formatPricingEuro,
  formatPricingPercent,
  PLATFORM_FEE_GROSS_CAP,
  PLATFORM_FEE_NET_CAP,
  PLATFORM_FEE_RATE,
  VAT_RATE,
  type PricingPlan,
} from './storefrontConfig'
import './platform.css'

const Storefront = lazy(async () => {
  const module = await import('./App')
  return { default: module.Storefront }
})
const StripeEmbeddedOnboarding = lazy(() => import('./StripeEmbeddedOnboarding'))

type Screen = 'landing' | 'login' | 'forgot-password' | 'reset-password' | 'account' | 'store' | 'payments' | 'shipping' | 'business' | 'product' | 'publish' | 'storefront' | 'sample'
type RegistryLookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error'
const STRIPE_REQUIREMENTS_LINK_FAILURE = 'Seda linki ei saanud avada. Logi sisse õige Poeruumi kontoga.'

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

export function StorefrontLoadingScreen({ store, isLeaving = false }: { store: PublicStoreRecord | null; isLeaving?: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const logo = typeof store?.settings.storeLogo === 'string' ? store.settings.storeLogo : ''
  const storeName = typeof store?.settings.editableStoreName === 'string' && store.settings.editableStoreName.trim()
    ? store.settings.editableStoreName.trim()
    : store?.name ?? ''

  return <main className={`storefront-loading${isLeaving ? ' is-leaving' : ''}`} aria-label={storeName ? `Laadin poodi ${storeName}` : 'Laadin poodi'} aria-busy={!isLeaving}>
    {logo && !logoFailed ? <div className="storefront-loading__brand">
      <img src={logo} alt="" fetchPriority="high" decoding="async" onError={() => setLogoFailed(true)} />
    </div> : null}
  </main>
}

const onboardingActivityScreens = new Set<Screen>(['store', 'business', 'payments', 'shipping', 'product', 'publish'])
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

const steps: Array<{ screen: Screen; label: string }> = [
  { screen: 'account', label: 'Konto' },
  { screen: 'store', label: 'Pood' },
  { screen: 'business', label: 'Müüja' },
  { screen: 'payments', label: 'Maksed' },
  { screen: 'shipping', label: 'Tarne' },
  { screen: 'product', label: 'Toode' },
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
  if (authError.code === 'weak_password' || message.includes('password should') || message.includes('weak password')) {
    return PASSWORD_REQUIREMENTS_TEXT
  }
  return authError.message || fallback
}

function FlowHeader({
  onBack,
  onExit,
  onDiscardExit,
  isExiting = false,
}: {
  onBack: () => void
  onExit?: () => void
  onDiscardExit?: () => void
  isExiting?: boolean
}) {
  return <header className="flow-header">
    <Brand />
    <div className="flow-header__actions">
      {onExit && <button className="flow-header__exit" type="button" disabled={isExiting} onClick={onExit}>
        {isExiting ? 'Salvestan ja väljun…' : <><span className="flow-header__exit-long">Salvesta ja välju</span><span className="flow-header__exit-short">Salvesta ja välju</span></>}
      </button>}
      {onDiscardExit && <button className="flow-header__discard" type="button" disabled={isExiting} onClick={onDiscardExit}>
        <span className="flow-header__exit-long">Logi välja salvestamata</span><span className="flow-header__exit-short">Välju</span>
      </button>}
      <button type="button" disabled={isExiting} onClick={onBack} aria-label="Tagasi eelmisele lehele">← Tagasi</button>
    </div>
  </header>
}

function SetupShell({
  screen,
  children,
  onBack,
  onExit,
  onDiscardExit,
  isExiting,
}: {
  screen: Screen
  children: React.ReactNode
  onBack: () => void
  onExit?: () => void
  onDiscardExit?: () => void
  isExiting?: boolean
}) {
  return <main className={`setup-page${screen === 'publish' ? ' setup-page--publish' : ''}`}>
    <FlowHeader onBack={onBack} onExit={onExit} onDiscardExit={onDiscardExit} isExiting={isExiting} />
    <SetupProgress screen={screen} />
    <section className="setup-card">{children}</section>
  </main>
}

function PlatformFlow() {
  const requestedStoreSlug = getRequestedStoreSlug(window.location)
  const shouldLoadPublicStore = isSupabaseConfigured && (
    requestedStoreSlug !== null || isDedicatedStorefrontHostname(window.location.hostname)
  )
  const [screen, setScreen] = useState<Screen>('landing')
  const [showAllFaq, setShowAllFaq] = useState(false)
  const [email, setEmail] = useState('')
  const [onlineUserId, setOnlineUserId] = useState<string | null>(null)
  const [isAuthResolved, setIsAuthResolved] = useState(!isSupabaseConfigured)
  const onlinePresenceSessionIdRef = useRef(createRandomId())
  const [storeName, setStoreName] = useState('')
  const [slug, setSlug] = useState('')
  const [payment, setPayment] = useState<'stripe'>('stripe')
  const [pricingPlan, setPricingPlan] = useState<PricingPlan>('flexible')
  const [fixedPlanTrialStartedAt, setFixedPlanTrialStartedAt] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'connected' | 'pending'>('idle')
  const [isStripeConnecting, setIsStripeConnecting] = useState(false)
  const [isStripeOnboardingOpen, setIsStripeOnboardingOpen] = useState(false)
  const [stripeEmbeddedMode, setStripeEmbeddedMode] = useState<'onboarding' | 'management' | 'remediation'>('onboarding')
  const [stripeRequirements, setStripeRequirements] = useState<StripeRequirementSummary | null>(null)
  const [stripeDetailsSubmitted, setStripeDetailsSubmitted] = useState<boolean | null>(null)
  const [stripeRequirementsLinkIntent, setStripeRequirementsLinkIntent] = useState<StripeRequirementsLinkIntent>(() =>
    shouldLoadPublicStore ? 'none' : getStripeRequirementsLinkIntent(window.location))
  const stripeRequirementsLinkPending = stripeRequirementsLinkIntent === 'valid'
  const [initialMerchantSettingsSection, setInitialMerchantSettingsSection] = useState<'payments' | null>(null)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const [shipping, setShipping] = useState<string[]>(['omniva', 'pickup'])
  const [businessName, setBusinessName] = useState('')
  const [registryCode, setRegistryCode] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [vatRegistered, setVatRegistered] = useState(false)
  const [vatNumber, setVatNumber] = useState('')
  const [registryLookupStatus, setRegistryLookupStatus] = useState<RegistryLookupStatus>('idle')
  const [registryLookupCompanyName, setRegistryLookupCompanyName] = useState('')
  const [registryLookupAttempt, setRegistryLookupAttempt] = useState(0)
  const [businessEmail, setBusinessEmail] = useState('')
  const [returnsText, setReturnsText] = useState(DEFAULT_RETURNS_TEXT)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isSetupExiting, setIsSetupExiting] = useState(false)
  const [setupExitSaveFailed, setSetupExitSaveFailed] = useState(false)
  const [isBillingCardOpen, setIsBillingCardOpen] = useState(false)
  const [phoneSlideIndex, setPhoneSlideIndex] = useState(1)
  const [isPhoneSwipeAnimated, setIsPhoneSwipeAnimated] = useState(true)
  const [isPhoneDetailsOpen, setIsPhoneDetailsOpen] = useState(false)
  const [store, setStore] = useState<StoreRecord | null>(null)
  const [storedProducts, setStoredProducts] = useState<Product[]>([])
  const [authError, setAuthError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [authNotice, setAuthNotice] = useState('')
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false)
  const [confirmationResendCooldown, setConfirmationResendCooldown] = useState(0)
  const [isConfirmationRateLimited, setIsConfirmationRateLimited] = useState(false)
  const [publicStore, setPublicStore] = useState<PublicStoreRecord | null>(null)
  const [publicProducts, setPublicProducts] = useState<Product[]>([])
  const [isPublicStoreLoading, setIsPublicStoreLoading] = useState(shouldLoadPublicStore)
  const [isPublicStoreVisualReady, setIsPublicStoreVisualReady] = useState(false)
  const requestedProductSlug = getRequestedProductSlug(window.location)
  const [sampleStore, setSampleStore] = useState<PublicStoreRecord | null>(null)
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
    if (!isAuthResolved || screen !== 'landing' || !isHomepageAnalyticsLocation(window.location)) return
    const audience = onlineUserId ? 'merchant' : 'anonymous'
    trackHomepageEvent('page_view', '', audience)
    const stopEngagementTracking = startHomepageEngagementTracking(audience)
    if (!('IntersectionObserver' in window)) return stopEngagementTracking

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const label = entry.target.id === 'hind' ? 'pricing' : entry.target.id === 'kkk' ? 'faq' : ''
        if (label) trackHomepageEvent('section_view', label, audience)
        observer.unobserve(entry.target)
      }
    }, { threshold: 0.35 })
    for (const selector of ['#hind', '#kkk']) {
      const section = document.querySelector(selector)
      if (section) observer.observe(section)
    }
    return () => {
      observer.disconnect()
      stopEngagementTracking()
    }
  }, [isAuthResolved, onlineUserId, screen])

  const isCaptchaReady = !isCaptchaConfigured || Boolean(captchaToken)
  const handleCaptchaToken = (token: string) => {
    setCaptchaToken(token)
    if (token && authError === getCaptchaRequiredMessage()) setAuthError('')
  }

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
    if (!isStripeOnboardingOpen || (screen !== 'storefront' && screen !== 'product')) return
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
  }, [isStripeOnboardingOpen, screen])

  useEffect(() => {
    if (!shouldLoadPublicStore) return
    let active = true
    const loadRequestedStore = requestedStoreSlug
      ? getStoreBySlug(requestedStoreSlug)
      : getStoreByHostname(window.location.hostname)
    loadRequestedStore.then(async (found) => {
      if (!found || !active) return
      setPublicStore(found)
      const nextProducts = await listProducts(found.id)
      if (!active) return
      setPublicProducts(nextProducts)
    }).catch((error) => {
      if (active) {
        setPublicStore(null)
        setAuthError(error instanceof Error ? error.message : 'Poe laadimine ebaõnnestus.')
      }
    }).finally(() => {
      if (active) setIsPublicStoreLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!['landing', 'sample'].includes(screen) || !isSupabaseConfigured) return
    let active = true
    const refreshSampleStore = () => getPublicShowcaseStore().then(async (found) => {
      if (!found || !active) return
      const nextProducts = await listProducts(found.id)
      if (!active) return
      setSampleStore(found)
      setSampleProducts(nextProducts)
    }).catch(() => {
      // Keep the bundled sample as a safe fallback before the platform-store migration is deployed.
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
    setPayment('stripe')
    setPaymentStatus(nextStore.payment_provider === 'stripe' ? nextStore.payment_status : 'idle')
    setStripeRequirements(nextStore.stripe_account_id ? stripeRequirementsFromStore(nextStore) : null)
    if (!nextStore.stripe_account_id) setStripeDetailsSubmitted(null)
    setPricingPlan(nextStore.pricing_plan)
    setFixedPlanTrialStartedAt(nextStore.trial_started_at)
    setShipping(nextStore.shipping)
    setBusinessName(String(settings.businessName ?? ''))
    setRegistryCode(String(settings.registryCode ?? ''))
    setBusinessAddress(String(settings.businessAddress ?? ''))
    setVatRegistered(settings.vatRegistered === true)
    setVatNumber(String(settings.vatNumber ?? ''))
    setBusinessEmail(String(settings.contactEmail ?? '') || email)
    setReturnsText(String(settings.returnsText ?? DEFAULT_RETURNS_TEXT))
    const nextProducts = await listProducts(nextStore.id)
    setStoredProducts(nextProducts)
    return nextProducts
  }

  useEffect(() => {
    if (!onlineUserId || !store?.stripe_account_id) {
      if (!store?.stripe_account_id) setStripeRequirements(null)
      return
    }

    let active = true
    let syncInFlight = false
    let lastSyncAt = 0
    const syncStripeStatus = async (force = false) => {
      if (syncInFlight || (!force && Date.now() - lastSyncAt < 5 * 60_000)) return
      syncInFlight = true
      lastSyncAt = Date.now()
      try {
        const result = await invokeStripeConnect('status')
        if (!active) return
        if (result.status) setPaymentStatus(result.status)
        if (result.detailsSubmitted !== undefined) setStripeDetailsSubmitted(result.detailsSubmitted)
        if (result.requirements) setStripeRequirements(result.requirements)
        setStore((current) => current ? {
          ...current,
          ...(result.status ? { payment_status: result.status } : {}),
          ...(result.chargesEnabled !== undefined ? { stripe_account_charges_enabled: result.chargesEnabled } : {}),
          ...(result.payoutsEnabled !== undefined ? { stripe_account_payouts_enabled: result.payoutsEnabled } : {}),
          ...(result.requirements ? {
            stripe_account_requirements_due_count: result.requirements.dueCount,
            stripe_account_requirements_past_due: result.requirements.pastDue,
            stripe_account_requirements_deadline: result.requirements.currentDeadline,
            stripe_account_requirements_pending_verification: result.requirements.pendingVerification,
            stripe_account_requirements_disabled_reason: result.requirements.disabledReason,
            stripe_account_requirement_issues: result.requirements.issues,
            stripe_account_requirements_updated_at: new Date().toISOString(),
          } : {}),
        } : current)
      } catch {
        // Keep the last webhook-backed state if Stripe is temporarily unavailable.
      } finally {
        syncInFlight = false
      }
    }

    void syncStripeStatus(true)
    const handleFocus = () => { void syncStripeStatus() }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncStripeStatus()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [onlineUserId, store?.stripe_account_id])

  const openOwnedStore = async (nextStore: StoreRecord) => {
    const nextProducts = await applyStore(nextStore)
    setScreen(getStoreDestination(nextStore, nextProducts.length))
    const cleanUrl = new URL(window.location.href)
    if (cleanUrl.searchParams.has('continue_setup')) {
      cleanUrl.searchParams.delete('continue_setup')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    }
  }

  const clearStripeRequirementsLink = (notice = '') => {
    setStripeRequirementsLinkIntent('none')
    window.history.replaceState(
      window.history.state,
      '',
      removeStripeRequirementsLinkParam(window.location.href),
    )
    if (notice) setAuthNotice(notice)
  }

  const openStripeRequirementsSettings = async (nextStore: StoreRecord) => {
    await applyStore(nextStore)
    const target = getStripeRequirementsStoreTarget({
      isPublished: nextStore.is_published,
      hasStripeAccount: Boolean(nextStore.stripe_account_id),
    })
    setStripeEmbeddedMode('remediation')
    setIsStripeOnboardingOpen(target.openEmbeddedRemediation)
    setInitialMerchantSettingsSection(target.initialSettingsSection)
    setScreen(target.screen)
    // A published storefront confirms the settings panel actually opened
    // before the return intent is consumed. Draft stores use the dedicated
    // payments screen and can complete the intent immediately.
    if (!target.initialSettingsSection) {
      clearStripeRequirementsLink()
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    let recoveryMode = window.location.hash.includes('type=recovery')
    if (recoveryMode) setScreen('reset-password')
    const restore = async () => {
      const initialStripeRequirementsIntent = stripeRequirementsLinkIntent
      if (initialStripeRequirementsIntent === 'invalid') {
        clearStripeRequirementsLink(STRIPE_REQUIREMENTS_LINK_FAILURE)
      } else if (initialStripeRequirementsIntent === 'conflict') {
        clearStripeRequirementsLink()
      }
      const { data } = await requireSupabase().auth.getSession()
      if (!data.session || !active || recoveryMode) {
        if (!data.session && active && !recoveryMode) {
          if (initialStripeRequirementsIntent === 'valid') {
            setAuthNotice('Logi sisse, et Stripe’i andmeid täiendada.')
            setScreen('login')
          } else if (initialStripeRequirementsIntent === 'invalid') {
            setScreen('login')
          } else if (new URLSearchParams(window.location.search).get('continue_setup') === '1') setScreen('login')
        }
        return
      }
      const { data: refreshedData } = await requireSupabase().auth.refreshSession()
      const currentSession = refreshedData.session ?? data.session
      const hostname = window.location.hostname.toLowerCase().replace(/\.$/, '')
      const isPlatformHostname = hostname === 'localhost' || hostname === '127.0.0.1'
        || hostname === STOREFRONT_ROOT_DOMAIN || hostname.endsWith(`.${STOREFRONT_ROOT_DOMAIN}`)
      if (currentSession.user.app_metadata?.role === 'admin' && isPlatformHostname && !getRequestedStoreSlug(window.location)) {
        if (initialStripeRequirementsIntent === 'valid' || initialStripeRequirementsIntent === 'invalid') {
          clearStripeRequirementsLink(STRIPE_REQUIREMENTS_LINK_FAILURE)
          setScreen('login')
          return
        }
        window.location.replace('/admin')
        return
      }
      setOnlineUserId(currentSession.user.app_metadata?.role === 'admin' ? null : currentSession.user.id)
      setEmail(currentSession.user.email ?? '')
      let existing = await getMyStore()
      if (!active) return
      if (!existing) {
        if (initialStripeRequirementsIntent === 'valid' || initialStripeRequirementsIntent === 'invalid') {
          clearStripeRequirementsLink(STRIPE_REQUIREMENTS_LINK_FAILURE)
          setScreen('store')
        }
        return
      }

      if (initialStripeRequirementsIntent === 'valid') {
        await openStripeRequirementsSettings(existing)
        return
      }

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
        } else if (billingResult === 'manage') {
          existing = await getMyStore() ?? existing
          setAuthNotice(['active', 'trialing'].includes(String(existing.stripe_subscription_status))
            ? 'Arveldus on korras ja Kindel pakett on aktiivne.'
            : 'Arveldusandmed on uuendatud. Stripe proovib makset uuesti.')
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
    restore()
      .catch((error) => active && setAuthError(error instanceof Error ? error.message : 'Andmete laadimine ebaõnnestus.'))
      .finally(() => { if (active) setIsAuthResolved(true) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (stripeRequirementsLinkPending || isAuthBusy || !onlineUserId || !['login', 'forgot-password', 'account'].includes(screen)) return
    setScreen(store ? getStoreDestination(store, storedProducts.length) : 'store')
  }, [isAuthBusy, onlineUserId, screen, store, storedProducts.length, stripeRequirementsLinkPending])

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isCaptchaReady) {
      setAuthError(getCaptchaRequiredMessage())
      return
    }
    setIsAuthBusy(true); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false)
    try {
      const form = new FormData(event.currentTarget)
      const existing = await authenticateOwner(email, String(form.get('password') ?? ''), captchaToken)
      if (existing === 'admin') {
        if (stripeRequirementsLinkPending) {
          clearStripeRequirementsLink(STRIPE_REQUIREMENTS_LINK_FAILURE)
          setScreen('login')
          return
        }
        window.location.assign('/admin')
        return
      }
      if (existing) {
        if (stripeRequirementsLinkPending) await openStripeRequirementsSettings(existing)
        else await openOwnedStore(existing)
      }
      else {
        if (stripeRequirementsLinkPending) clearStripeRequirementsLink(STRIPE_REQUIREMENTS_LINK_FAILURE)
        setScreen('store')
      }
    } catch (error) {
      if (isEmailNotConfirmedError(error)) {
        setNeedsEmailConfirmation(true)
        setAuthError(getLocalizedAuthError(error, 'E-posti aadress pole veel kinnitatud.'))
      } else setAuthError(getLocalizedAuthError(error, 'Sisselogimine ebaõnnestus.'))
    }
    finally { setIsAuthBusy(false); setCaptchaToken(''); setCaptchaResetKey((value) => value + 1) }
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
    if (!isCaptchaReady) {
      setAuthError(getCaptchaRequiredMessage())
      return
    }
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { error } = await requireSupabase().auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: { emailRedirectTo: window.location.origin, captchaToken: captchaToken || undefined },
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
    } finally { setIsAuthBusy(false); setCaptchaToken(''); setCaptchaResetKey((value) => value + 1) }
  }

  const authenticateOwner = async (loginEmail: string, password: string, nextCaptchaToken = '') => {
    if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
    const normalizedEmail = loginEmail.trim().toLowerCase()
    const { data, error } = await requireSupabase().auth.signInWithPassword({
      email: normalizedEmail,
      password,
      options: { captchaToken: nextCaptchaToken || undefined },
    })
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

  const signInFromStore = async (loginEmail: string, password: string, nextCaptchaToken = '') => {
    const existing = await authenticateOwner(loginEmail, password, nextCaptchaToken)
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
    if (!isCaptchaReady) {
      setAuthError(getCaptchaRequiredMessage())
      return
    }
    setIsAuthBusy(true); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false)
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const form = new FormData(event.currentTarget)
      const normalizedEmail = email.trim().toLowerCase()
      const password = String(form.get('password') ?? '')
      const passwordError = getPasswordPolicyError(password)
      if (passwordError) throw new Error(passwordError)
      const { data, error } = await requireSupabase().auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: window.location.origin, captchaToken: captchaToken || undefined },
      })
      if (error) throw error
      trackHomepageEvent('account_created')
      setEmail(normalizedEmail)
      if (!data.session) {
        setNeedsEmailConfirmation(true)
        setAuthNotice('Konto on loodud. Kinnita e-posti aadress ja logi seejärel sisse.')
        setScreen('login')
        return
      }
      setOnlineUserId(data.user?.id ?? data.session.user.id)
      setScreen('store')
    } catch (error) { setAuthError(getLocalizedAuthError(error, 'Konto loomine ebaõnnestus.')) }
    finally { setIsAuthBusy(false); setCaptchaToken(''); setCaptchaResetKey((value) => value + 1) }
  }

  const requestPasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isCaptchaReady) {
      setAuthError(getCaptchaRequiredMessage())
      return
    }
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      if (!isSupabaseConfigured) throw new Error('Lisa esmalt Supabase’i võtmed .env faili.')
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
        captchaToken: captchaToken || undefined,
      })
      if (error) throw error
      setAuthNotice('Taastamislink on saadetud. Kontrolli oma e-posti.')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Taastamislingi saatmine ebaõnnestus.') }
    finally { setIsAuthBusy(false); setCaptchaToken(''); setCaptchaResetKey((value) => value + 1) }
  }

  const completePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsAuthBusy(true); setAuthError(''); setAuthNotice('')
    try {
      const form = new FormData(event.currentTarget)
      const password = String(form.get('password') ?? '')
      const confirmation = String(form.get('passwordConfirmation') ?? '')
      const passwordError = getPasswordPolicyError(password)
      if (passwordError) throw new Error(passwordError)
      if (password !== confirmation) throw new Error('Paroolid ei ühti.')
      const { error } = await requireSupabase().auth.updateUser({ password })
      if (error) throw error
      await requireSupabase().auth.signOut({ scope: 'global' })
      setAuthNotice('Parool on muudetud. Logi nüüd uue parooliga sisse.')
      setScreen('login')
      window.history.replaceState({}, '', window.location.pathname)
    } catch (error) { setAuthError(getLocalizedAuthError(error, 'Parooli muutmine ebaõnnestus.')) }
    finally { setIsAuthBusy(false) }
  }

  const persistStore = async (overrides: Partial<StoreContentInput> = {}, nextStep?: OnboardingStep) => {
    const existingSettings = (store?.settings ?? {}) as Record<string, unknown>
    const payload = {
      name: storeName.trim(), slug: slug || slugify(storeName), payment_provider: payment,
      shipping,
      settings: {
        ...existingSettings,
        businessName: businessName.trim(),
        registryCode: registryCode.trim(),
        businessAddress: businessAddress.trim(),
        vatRegistered,
        vatNumber: vatRegistered ? vatNumber.trim() : '',
        contactEmail: businessEmail.trim(),
        returnsText: returnsText.trim() || DEFAULT_RETURNS_TEXT,
        onboardingStep: store?.is_published ? 'complete' : nextStep ?? existingSettings.onboardingStep ?? 'business',
      },
      ...overrides,
    }
    const saved = store ? await updateStore(store.id, payload) : await createStore(payload)
    setStore(saved)
    return saved
  }

  const startStripeConnect = async (purpose?: StripeSetupPurpose) => {
    setIsStripeConnecting(true)
    setAuthError('')
    setAuthNotice('')
    try {
      const saved = await persistStore({ payment_provider: 'stripe' }, store?.is_published ? 'complete' : 'payments')
      setPayment('stripe')
      setPaymentStatus(saved.stripe_account_id ? saved.payment_status : 'pending')

      let detailsSubmitted = stripeDetailsSubmitted ?? undefined
      let latestStatus = saved.payment_status
      let latestRequirements = stripeRequirements
      if (saved.stripe_account_id && purpose === 'onboarding' && detailsSubmitted === undefined) {
        const stripeResult = await invokeStripeConnect('status')
        detailsSubmitted = stripeResult.detailsSubmitted
        latestStatus = stripeResult.status ?? latestStatus
        latestRequirements = stripeResult.requirements ?? latestRequirements
        setPaymentStatus(latestStatus)
        if (stripeResult.detailsSubmitted !== undefined) setStripeDetailsSubmitted(stripeResult.detailsSubmitted)
        if (stripeResult.requirements) setStripeRequirements(stripeResult.requirements)

        const setupState = getPaymentSetupState(latestStatus, true, latestRequirements)
        if (setupState === 'connected' || (setupState === 'reviewing' && detailsSubmitted !== false)) {
          const refreshedStore = await getMyStore()
          if (refreshedStore) await applyStore(refreshedStore)
          setAuthNotice(setupState === 'connected'
            ? 'Stripe on ühendatud ja maksed on aktiivsed.'
            : 'Kõik vajalik on esitatud. Stripe kontrollib andmeid; võid poe seadistamisega jätkata.')
          setIsStripeConnecting(false)
          return
        }
      }

      const nextMode = getStripeSetupMode(Boolean(saved.stripe_account_id), purpose, detailsSubmitted, latestRequirements)
      setStripeEmbeddedMode(nextMode)
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
      if (result.detailsSubmitted !== undefined) setStripeDetailsSubmitted(result.detailsSubmitted)
      if (result.requirements) setStripeRequirements(result.requirements)
      const refreshedStore = await getMyStore()
      if (refreshedStore) await applyStore(refreshedStore)
      setAuthNotice(stripeEmbeddedMode === 'remediation'
        ? result.requirements?.dueCount
          ? 'Stripe salvestas andmed. Mõni kinnitus on veel pooleli.'
          : 'Ettevõtte andmed on esitatud. Stripe kontrollib neid turvaliselt.'
        : result.status === 'connected'
          ? 'Stripe on ühendatud ja maksed on aktiivsed.'
          : 'Stripe salvestas andmed. Konto kontroll või seadistamine on veel pooleli.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stripe’i staatuse kontroll ebaõnnestus.'
      setAuthError(message)
      if (screen === 'storefront') setAuthNotice(message)
    } finally {
      setIsStripeOnboardingOpen(false)
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

  const resetPlatformFlow = () => {
    setScreen('landing')
    setEmail('')
    setOnlineUserId(null)
    setStore(null)
    setStoredProducts([])
    setStoreName('')
    setSlug('')
    setPayment('stripe')
    setPricingPlan('flexible')
    setFixedPlanTrialStartedAt(null)
    setPaymentStatus('idle')
    setStripeDetailsSubmitted(null)
    setIsStripeConnecting(false)
    setIsStripeOnboardingOpen(false)
    setStripeEmbeddedMode('onboarding')
    setStripeRequirements(null)
    setStripeRequirementsLinkIntent(shouldLoadPublicStore ? 'none' : getStripeRequirementsLinkIntent(window.location))
    setInitialMerchantSettingsSection(null)
    setIsBillingCardOpen(false)
    setIsPublishing(false)
    setIsMobileNavOpen(false)
    setShipping(['omniva', 'pickup'])
    setBusinessName('')
    setRegistryCode('')
    setBusinessAddress('')
    setVatRegistered(false)
    setVatNumber('')
    setBusinessEmail('')
    setReturnsText(DEFAULT_RETURNS_TEXT)
    setRegistryLookupStatus('idle')
    setRegistryLookupCompanyName('')
    setRegistryLookupAttempt(0)
    setAuthError('')
    setAuthNotice('')
    setIsAuthBusy(false)
    setNeedsEmailConfirmation(false)
    setConfirmationResendCooldown(0)
    setIsConfirmationRateLimited(false)
    setSetupExitSaveFailed(false)
  }

  const handleAccountDeleted = () => {
    setStore(null)
    setStoredProducts([])
    resetPlatformFlow()
  }

  const backMap: Partial<Record<Screen, Screen>> = {
    login: 'landing', 'forgot-password': 'login', 'reset-password': 'login', account: 'landing', store: 'account', business: 'store', payments: 'business', shipping: 'payments', product: 'shipping', publish: 'product',
  }
  const phoneProduct = phonePreviewProducts[phoneProductIndex]
  const selectPricingPlan = (plan: PricingPlan) => {
    setPricingPlan(plan)
  }
  const publishStore = async () => {
    if (!businessName.trim() || !/^\d{8}$/.test(registryCode.trim()) || !businessAddress.trim() || !businessEmail.trim()
      || (vatRegistered && !/^EE\d{9}$/.test(vatNumber.trim()))) {
      setAuthError('Enne avaldamist lisa täielikud müüja andmed.')
      setScreen('business')
      return
    }
    setIsPublishing(true); setAuthError('')
    try {
      if (!store) throw new Error('Poodi ei leitud. Salvesta poe andmed ja proovi uuesti.')

      if (paymentStatus !== 'connected' || !store.stripe_account_id) {
        const stripeResult = await invokeStripeConnect('status')
        if (stripeResult.status) setPaymentStatus(stripeResult.status)
        if (stripeResult.detailsSubmitted !== undefined) setStripeDetailsSubmitted(stripeResult.detailsSubmitted)
        if (stripeResult.requirements) setStripeRequirements(stripeResult.requirements)
        if (stripeResult.status !== 'connected') {
          const latestSetupState = getPaymentSetupState(
            stripeResult.status ?? paymentStatus,
            Boolean(store.stripe_account_id),
            stripeResult.requirements ?? stripeRequirements,
          )
          setAuthError(latestSetupState === 'reviewing'
            ? 'Stripe kontrollib veel esitatud andmeid. Pood on salvestatud ja saad selle avaldada kohe, kui maksed on aktiveeritud.'
            : 'Stripe vajab enne poe avaldamist veel andmeid. Ava maksete samm ja lõpeta seadistus.')
          return
        }
      }

      if (pricingPlan === 'fixed' && !['active', 'trialing'].includes(String(store.stripe_subscription_status))) {
        setIsBillingCardOpen(true)
        return
      }

      const publishedStore = await setStorePublication(store.id, true)
      setStore(publishedStore)
      setScreen('storefront')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Poe avaldamine ebaõnnestus.'
      setAuthError(message)
      if (message === 'Enne avaldamist lisa vähemalt üks toode.') setScreen('product')
    }
    finally { setIsPublishing(false) }
  }

  const continueFromFirstProduct = async () => {
    if (!store) throw new Error('Poodi ei leitud. Salvesta poe andmed ja proovi uuesti.')
    const nextProducts = await listProducts(store.id)
    if (!nextProducts.length) throw new Error('Lisa ja salvesta enne jätkamist vähemalt üks toode.')
    setStoredProducts(nextProducts)
    await persistStore({}, 'publish')
    setScreen('publish')
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  const resumeMerchantFlow = () => {
    setIsMobileNavOpen(false)
    setAuthError('')
    setAuthNotice('')
    setScreen(store ? getStoreDestination(store, storedProducts.length) : 'store')
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  const signOutFromLanding = async () => {
    if (isAuthBusy) return
    setIsAuthBusy(true)
    setIsMobileNavOpen(false)
    setAuthError('')
    setAuthNotice('')
    try {
      const { error } = await requireSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      resetPlatformFlow()
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Väljalogimine ebaõnnestus.')
      setIsAuthBusy(false)
    }
  }

  const startOrResumeMerchantFlow = (plan?: PricingPlan, placement: 'hero' | 'nav' | 'mobile_nav' = 'hero') => {
    if (onlineUserId) {
      resumeMerchantFlow()
      return
    }
    trackHomepageEvent('signup_start', plan ? `pricing_${plan}` : placement)
    if (plan) selectPricingPlan(plan)
    setScreen('account')
  }

  const openSampleStore = (placement: 'nav' | 'mobile_nav' | 'phone') => {
    trackHomepageEvent('demo_open', placement, onlineUserId ? 'merchant' : 'anonymous')
    setScreen('sample')
  }

  const trackFaqToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open || !event.nativeEvent.isTrusted) return
    const label = event.currentTarget.dataset.analyticsLabel
    if (label) trackHomepageEvent('faq_open', label, onlineUserId ? 'merchant' : 'anonymous')
  }

  const returnNotice = authNotice ? <div className="app-return-notice" role="status" aria-live="polite">
    <span>{authNotice}</span><button type="button" onClick={() => setAuthNotice('')} aria-label="Sulge teade">×</button>
  </div> : null
  const stripeEmbeddedDialogLabel = stripeEmbeddedMode === 'remediation' ? 'Ettevõtte andmete kinnitamine' : 'Stripe’i andmed'
  const stripeEmbeddedOverlay = isStripeOnboardingOpen && (screen === 'storefront' || screen === 'product')
    ? <div className="stripe-connect-overlay stripe-connect-overlay--embedded" role="dialog" aria-modal="true" aria-label={stripeEmbeddedDialogLabel}>
      <div className="stripe-connect-embedded-shell">
        <StripeEmbeddedOnboarding
          mode={stripeEmbeddedMode}
          onExit={finishStripeEmbeddedOnboarding}
          onClose={finishStripeEmbeddedOnboarding}
          onError={(message) => { setAuthError(message); setIsStripeConnecting(false) }}
          onNotificationsChange={(actionRequired) => setStripeRequirements((current) => ({
            dueCount: actionRequired,
            pastDue: actionRequired > 0 && current?.pastDue === true,
            currentDeadline: current?.currentDeadline ?? null,
            pendingVerification: actionRequired === 0 && current?.pendingVerification === true,
            disabledReason: current?.disabledReason ?? null,
            issues: current?.issues ?? [],
          }))}
        />
      </div>
    </div>
    : null

  if (isAuthBusy && onlineUserId && ['login', 'forgot-password', 'account'].includes(screen)) {
    return <main className="platform-loading" aria-label="Laadin sinu poodi" aria-busy="true"><span /></main>
  }

  if (shouldLoadPublicStore && (isPublicStoreLoading || publicStore)) return <div className="public-storefront-bootstrap">
    {!isPublicStoreLoading && publicStore && <Suspense key="storefront-content" fallback={null}><Storefront
      key={publicStore.id}
      storeId={publicStore.id}
      initialSettings={publicStore.settings}
      seedProducts={publicProducts}
      storeName={publicStore.name}
      storeSlug={publicStore.slug}
      paymentProvider={publicStore.payment_provider}
      paymentsReady={publicStore.payment_status === 'connected'}
      initialShipping={publicStore.shipping}
      initialProductSlug={requestedProductSlug}
      ownerEmail={email}
      onOwnerLogin={signInFromStore}
      onInitialVisualReady={() => setIsPublicStoreVisualReady(true)}
    /></Suspense>}
    <StorefrontLoadingScreen
      key="storefront-loading"
      store={publicStore}
      isLeaving={Boolean(publicStore && !isPublicStoreLoading && isPublicStoreVisualReady)}
    />
  </div>
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
  if (screen === 'product') return <>
  <Storefront
    key={`onboarding-product-${store?.id ?? 'new'}`}
    storeId={store?.id}
    initialSettings={store?.settings}
    seedProducts={storedProducts}
    storeName={storeName || 'Minu pood'}
    storeSlug={slug || 'minu-pood'}
    paymentProvider={payment}
    paymentsReady={paymentStatus === 'connected'}
    initialShipping={shipping}
    initialPublished={false}
    pricingPlan={pricingPlan}
    fixedPlanTrialStartedAt={fixedPlanTrialStartedAt}
    stripeSubscriptionStatus={store?.stripe_subscription_status}
    stripeRequirements={stripeRequirements}
    merchantMode
    ownerEmail={email}
    onOwnerLogin={signInFromStore}
    onBackToSetup={() => setScreen('shipping')}
    onContinueSetup={continueFromFirstProduct}
    onConnectPaymentProvider={(_provider, purpose) => void startStripeConnect(purpose)}
    onStoreChange={(nextStore) => {
      setStore(nextStore)
      setStoreName(nextStore.name)
      setPayment('stripe')
      setPaymentStatus(nextStore.payment_provider === 'stripe' ? nextStore.payment_status : 'idle')
      setPricingPlan(nextStore.pricing_plan)
      setFixedPlanTrialStartedAt(nextStore.trial_started_at)
      setShipping(nextStore.shipping)
    }}
    onAccountDeleted={handleAccountDeleted}
    onExit={() => setScreen('landing')}
  />
  {stripeEmbeddedOverlay}
  </>
  if (screen === 'storefront') return <>
    {returnNotice}
    <Storefront key={`merchant-storefront-${store?.id ?? 'new'}`} storeId={store?.id} initialSettings={store?.settings} seedProducts={storedProducts} storeName={storeName || 'Minu pood'} storeSlug={slug || 'minu-pood'} paymentProvider={payment} paymentsReady={paymentStatus === 'connected'} stripeRequirements={stripeRequirements} initialShipping={shipping} initialPublished={store?.is_published ?? false} pricingPlan={pricingPlan} fixedPlanTrialStartedAt={fixedPlanTrialStartedAt} stripeSubscriptionStatus={store?.stripe_subscription_status} billingGraceEndsAt={store?.billing_grace_ends_at} billingInvoiceUrl={store?.billing_last_failed_invoice_url} billingDowngradedAt={store?.billing_downgraded_at} initialSettingsSection={initialMerchantSettingsSection} onInitialSettingsSectionOpened={() => { setInitialMerchantSettingsSection(null); clearStripeRequirementsLink() }} merchantMode ownerEmail={email} onOwnerLogin={signInFromStore} onBackToSetup={() => setScreen('publish')} onConnectPaymentProvider={(_provider, purpose) => void startStripeConnect(purpose)} onStoreChange={(nextStore) => { setStore(nextStore); setStoreName(nextStore.name); setPayment('stripe'); setPaymentStatus(nextStore.payment_provider === 'stripe' ? nextStore.payment_status : 'idle'); setPricingPlan(nextStore.pricing_plan); setFixedPlanTrialStartedAt(nextStore.trial_started_at); setShipping(nextStore.shipping) }} onAccountDeleted={handleAccountDeleted} onExit={() => setScreen('landing')} />
    {stripeEmbeddedOverlay}
  </>

  if (screen === 'landing') return <main className="platform-landing">
    <nav><Brand /><div ref={mobileNavRef} className="platform-nav-actions">
      <a className="platform-nav-link" href="#hind">Hind</a>
      <a className="platform-nav-link" href="#kkk">KKK</a>
      <button className="platform-nav-link" onClick={() => openSampleStore('nav')}>Vaata näidispoodi</button>
      {onlineUserId
        ? <>
          <button className="platform-nav-link platform-nav-login" type="button" onClick={() => void signOutFromLanding()} disabled={isAuthBusy}>{isAuthBusy ? 'Login välja…' : 'Logi välja'}</button>
          <button className="platform-nav-cta" onClick={resumeMerchantFlow}>Minu pood</button>
        </>
        : <>
          <button className="platform-nav-link platform-nav-login" onClick={() => setScreen('login')}>Logi sisse</button>
          <button className="platform-nav-cta" onClick={() => startOrResumeMerchantFlow(undefined, 'nav')}>Loo pood</button>
        </>}
      <button className="platform-mobile-menu-toggle" type="button" aria-label={isMobileNavOpen ? 'Sulge menüü' : 'Ava menüü'} aria-expanded={isMobileNavOpen} onClick={() => setIsMobileNavOpen((open) => !open)}>
        {isMobileNavOpen
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>}
      </button>
      {isMobileNavOpen && <div className="platform-mobile-menu">
        <a href="#hind" onClick={() => setIsMobileNavOpen(false)}><span>Hind</span><b>→</b></a>
        <a href="#kkk" onClick={() => setIsMobileNavOpen(false)}><span>KKK</span><b>→</b></a>
        <button type="button" onClick={() => { setIsMobileNavOpen(false); openSampleStore('mobile_nav') }}><span>Näidispood</span><b>→</b></button>
        {onlineUserId
          ? <>
            <button type="button" onClick={resumeMerchantFlow}><span>Minu pood</span><b>→</b></button>
            <button type="button" onClick={() => void signOutFromLanding()} disabled={isAuthBusy}><span>{isAuthBusy ? 'Login välja…' : 'Logi välja'}</span><b>→</b></button>
          </>
          : <>
            <button type="button" onClick={() => { setIsMobileNavOpen(false); setScreen('login') }}><span>Logi sisse</span><b>→</b></button>
            <button type="button" onClick={() => { setIsMobileNavOpen(false); startOrResumeMerchantFlow(undefined, 'mobile_nav') }}><span>Loo pood</span><b>→</b></button>
          </>}
      </div>}
    </div></nav>
    {returnNotice}
    <section className="platform-hero">
      <div className="platform-hero__copy">
        <span className="platform-eyebrow">Lihtsaim viis oma e-poeni</span>
        <h1>Sinu e-pood.<br /><em>10 minutiga.</em></h1>
        <p>Loo, avalda ja halda oma e-poodi otse telefonist.</p>
        <button onClick={() => startOrResumeMerchantFlow()}>{onlineUserId ? 'Jätka oma poega' : 'Alusta tasuta'} <span>→</span></button>
      </div>
      <div className="platform-phone-stage">
        <div className={`platform-phone${isPhoneDetailsOpen ? ' is-details' : ''}`} role="link" tabIndex={0} aria-label="Ava näidispood" onClick={() => openSampleStore('phone')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSampleStore('phone') } }}>
          <div className="platform-phone__screen"><div className="platform-phone__journey">
            <section className="platform-phone__story">
              {phoneProduct
                ? <>
                  <div className={`platform-phone__slides${isPhoneSwipeAnimated ? '' : ' is-jumping'}`} style={{ transform: `translateX(-${phoneSlideIndex * 100}%)` }}>
                    {[phonePreviewProducts[phonePreviewProducts.length - 1], ...phonePreviewProducts, phonePreviewProducts[0]].map((product, index) => <img src={product.images[0]} alt={product.name} key={`${product.id}-${index}`} />)}
                  </div>
                  <div className="platform-phone__shade" />
                  <div className="platform-phone__progress" style={{ gridTemplateColumns: `repeat(${phonePreviewProducts.length}, 1fr)` }}>{phonePreviewProducts.map((product, index) => <i className={index === phoneProductIndex ? 'is-active' : ''} key={product.id} />)}</div>
                  <header className="platform-phone__header">
                    <div><img src="/images/poeruum-email-logo.svg" alt="" /><strong>POERUUM</strong></div>
                    <aside><i><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg></i><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6" /><circle cx="9" cy="19" r="1" /><circle cx="17" cy="19" r="1" /></svg><b>0</b></i></aside>
                  </header>
                  {phoneProduct.images.length > 1 && <div className="platform-phone__thumbs">{phoneProduct.images.map((image, index) => <span className={index === 0 ? 'is-active' : ''} key={image}><img src={image} alt="" /></span>)}</div>}
                  <div className="platform-phone__buy"><span>Osta</span><strong>{phoneProduct.price} €</strong></div>
                </>
                : <div className="platform-phone__empty" aria-hidden="true" />}
            </section>
            <section className="platform-phone__details">
              {phoneProduct
                ? <>
                  <header><h3>{phoneProduct.name}</h3><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></svg></span></header>
                  <div><small>Kirjeldus</small><p>{phoneProduct.description}</p></div>
                  <div className="platform-phone__price"><small>Hind</small><strong>{phoneProduct.price} €</strong></div>
                  <div className="platform-phone__cart">Lisa ostukorvi</div>
                  <footer><strong>POERUUM</strong><small>Valmistatud hoolega Eestis</small></footer>
                </>
                : null}
            </section>
          </div></div>
        </div>
      </div>
    </section>
    <section className="platform-benefits"><div><b>01</b><strong>Loo konto</strong><span>Alusta vaid mõne minutiga</span></div><div><b>02</b><strong>Seadista oma pood</strong><span>Lisa tooted, maksed ja tarne</span></div><div><b>03</b><strong>Avalda ja hakka müüma</strong><span>Sinu poe veebiaadressil</span></div></section>
    <section className="platform-pricing" id="hind">
      <div className="platform-pricing__copy">
        <span className="platform-eyebrow">Kaks lihtsat valikut</span>
        <h2>Vali, kuidas<br />maksad.</h2>
        <p>Alusta ilma kuutasuta või vali kindel kuukulu. Mõlemas paketis saad kasutada kõiki Poeruumi põhivõimalusi.</p>
      </div>
      <div className="platform-pricing__plans">
        <article className="platform-pricing__card is-featured">
          <span>PAINDLIK <b>ALUSTA SIIT</b></span>
          <div className="platform-pricing__rate"><strong>0 €</strong><p>kuus<br />teenustasu {formatPricingPercent(PLATFORM_FEE_RATE)} müügilt + km</p></div>
          <dl><div><dt>Müüki pole</dt><dd>0 €</dd></div><div><dt>Koos km-ga</dt><dd>{formatPricingPercent(PLATFORM_FEE_RATE * (1 + VAT_RATE))}</dd></div><div className="is-cap"><dt>Kuulagi</dt><dd>{formatPricingEuro(PLATFORM_FEE_NET_CAP)} + km</dd></div></dl>
          <small>Koos käibemaksuga maksimaalselt {formatPricingEuro(PLATFORM_FEE_GROSS_CAP)} kuus.</small>
          <button onClick={() => startOrResumeMerchantFlow('flexible')}>{onlineUserId ? 'Ava poe haldus' : 'Vali Paindlik'} <span>→</span></button>
        </article>
        <article className="platform-pricing__card">
          <span>KINDEL <b>30 PÄEVA TASUTA</b></span>
          <div className="platform-pricing__rate"><strong>{formatPricingEuro(FIXED_PLAN_MONTHLY_FEE)}</strong><p>kuus + km<br />0% müügilt</p></div>
          <dl><div><dt>Poeruumi müügitasu</dt><dd>0%</dd></div><div><dt>Käibemaks 24%</dt><dd>{formatPricingEuro(FIXED_PLAN_MONTHLY_FEE * VAT_RATE)}</dd></div><div className="is-cap"><dt>Tasutav kokku</dt><dd>{formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)}</dd></div></dl>
          <small>Esimesed 30 päeva tasuta, seejärel {formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} kuus koos km-ga.</small>
          <button onClick={() => startOrResumeMerchantFlow('fixed')}>{onlineUserId ? 'Ava poe haldus' : 'Alusta tasuta'} <span>→</span></button>
        </article>
      </div>
      <p className="platform-pricing__note">Paketti saad hiljem mugavalt vahetada. Paketi hind ei sisalda maksete töötlemise tasusid.</p>
    </section>
    <section className="platform-testimonials" aria-labelledby="testimonials-title">
      <header>
        <h2 id="testimonials-title">Mida müüjad hindavad</h2>
      </header>
      <div className="platform-testimonials__grid">
        <article className="platform-testimonial platform-testimonial--dark">
          <div className="platform-testimonial__bubble"><div className="platform-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>Tegin tootest pildi ja õhtuks oli pood päriselt üleval. Telefonist!</blockquote></div>
          <footer><span className="platform-testimonial__avatar">K</span><p><strong>Kadi</strong><small>Keraamika · Tartu</small></p></footer>
        </article>
        <article className="platform-testimonial platform-testimonial--cream">
          <div className="platform-testimonial__bubble"><div className="platform-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>Enam ei otsi ma tellimusi sõnumitest taga. Kõik on ühes kohas ja pilt on kohe selge.</blockquote></div>
          <footer><span className="platform-testimonial__avatar">M</span><p><strong>Maris</strong><small>Vintage-esemed · Tallinn</small></p></footer>
        </article>
        <article className="platform-testimonial platform-testimonial--green">
          <div className="platform-testimonial__bubble"><div className="platform-testimonial__rating" aria-label="Hinnang 5 punkti 5-st"><span aria-hidden="true">★★★★★</span><small aria-hidden="true">5/5</small></div><blockquote>5/5 just selle eest, et kuutasu pole. Sain rahulikult proovida, mis päriselt müüb.</blockquote></div>
          <footer><span className="platform-testimonial__avatar">R</span><p><strong>Rasmus</strong><small>Väiketootja · Pärnu</small></p></footer>
        </article>
      </div>
    </section>
    <section className="platform-faq" id="kkk">
      <header>
        <h2>KKK</h2>
      </header>
      <div className="platform-faq__list">
        <details open data-analytics-label="pricing" onToggle={trackFaqToggle}><summary>Kui palju Poeruum maksab?<span>+</span></summary><p>Valida saad kahe paketi vahel. Paindlikul paketil kuutasu ei ole: Poeruumi teenustasu on {formatPricingPercent(PLATFORM_FEE_RATE)} toodete müügisummalt + käibemaks ehk kokku {formatPricingPercent(PLATFORM_FEE_RATE * (1 + VAT_RATE))}. Tasu ei arvestata tarnelt ja see ei ületa {formatPricingEuro(PLATFORM_FEE_GROSS_CAP)} kuus koos käibemaksuga. Kui müüki ei ole, on Poeruumi tasu 0 €. Kindel pakett algab 30-päevase tasuta prooviperioodiga ja maksab seejärel {formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} kuus koos käibemaksuga; Poeruumi müügitasu selle paketiga ei ole. Stripe’i maksetöötlustasu lisandub mõlemas paketis.</p></details>
        <details data-analytics-label="plan_features" onToggle={trackFaqToggle}><summary>Kas paketid erinevad võimaluste poolest?<span>+</span></summary><p>Ei. Mõlemas paketis saad kasutada Poeruumi põhivõimalusi, sealhulgas oma domeeni. Erineb ainult hinnastamise viis: Paindlik pakett sobib müügipõhise tasuga alustamiseks ja Kindel pakett püsiva kuutasu eelistajale.</p></details>
        <details data-analytics-label="requirements" onToggle={trackFaqToggle}><summary>Mida vajan poe avamiseks?<span>+</span></summary><p>Vajad Poeruumi kontot, ettevõtte kontakt- ja registriandmeid, vähemalt üht toodet, valitud tarneviisi ning ühendatud Stripe’i kontot. Poe saad enne avaldamist rahulikult valmis seadistada ja üle vaadata.</p></details>
        <details data-analytics-label="payments" onToggle={trackFaqToggle}><summary>Kuidas kliendid maksta saavad?<span>+</span></summary><p>Pärast Stripe’i ühendamist saavad ostjad maksta Stripe’i turvalisel makselehel pangakaardiga ning sobivas seadmes Apple Pay või Google Payga. Poeruum ei salvesta ostjate kaardiandmeid.</p></details>
        <details data-analytics-label="shipping" onToggle={trackFaqToggle}><summary>Milliseid tarneviise saab kasutada?<span>+</span></summary><p>Saad pakkuda Omniva, DPD ja SmartPosti pakiautomaate, kullerit ning ise järele tulemist. Sina valid kasutatavad tarneviisid, hinnad ja tasuta tarne piiri. Ostja valib kassas sobiva pakiautomaadi; paki saatmise korraldad sina.</p></details>
        <details data-analytics-label="custom_domain" onToggle={trackFaqToggle}><summary>Kas saan kasutada oma domeeni?<span>+</span></summary><p>Jah. Poeruum annab poele automaatselt aadressi kujul poenimi.poeruum.ee, kuid soovi korral saad ühendada juba olemasoleva domeeni. Poeruum selle eest lisatasu ei küsi; domeeni teenusepakkuja tasu jääb sulle.</p></details>
        <details data-analytics-label="google" onToggle={trackFaqToggle}><summary>Kas minu pood ja tooted on Google’is leitavad?<span>+</span></summary><p>Jah. Poeruum hoolitseb automaatselt selle eest, et avaldatud pood ja otsingus nähtavad tooted oleksid Google’ile leitavad. Iga poe ja toote jaoks luuakse otsingusõbralik aadress, pealkiri, kirjeldus ning Google’ile vajalik tehniline info. Sina saad nähtavust parandada täpsete tootenimede, sisukate kirjelduste ja kvaliteetsete piltidega. Kõik see toimib ka oma domeeni kasutamisel.</p></details>
        <div className="platform-faq__more" id="faq-more" hidden={!showAllFaq}>
          <details data-analytics-label="mobile_setup" onToggle={trackFaqToggle}><summary>Kas saan kogu poe telefonis valmis teha?<span>+</span></summary><p>Jah. Telefonis saad luua konto, pildistada ja lisada tooted, määrata hinnad, seadistada tarne, kujundada poe ning selle avaldada.</p></details>
          <details data-analytics-label="buyer_account" onToggle={trackFaqToggle}><summary>Kas ostjal peab olema Poeruumi konto?<span>+</span></summary><p>Ei. Ostja lisab kassas kontakt- ja tarneandmed, tasub Stripe’is ning saab tellimuse kinnituse e-postile.</p></details>
          <details data-analytics-label="order_notice" onToggle={trackFaqToggle}><summary>Kuidas saan tellimusest teada ja millal raha laekub?<span>+</span></summary><p>Pärast kinnitatud makset ilmub tellimus poe haldusesse ja soovi korral saadetakse sulle e-kiri. Ostjale saadetakse tellimuse kinnitus. Makset töötleb Stripe ning raha jõuab sinu pangakontole Stripe’i väljamaksegraafiku järgi.</p></details>
          <details data-analytics-label="refunds" onToggle={trackFaqToggle}><summary>Kas saan ostjale makse tagastada?<span>+</span></summary><p>Jah. Stripe’iga tasutud tellimuse makse saad tellimuste vaates täielikult tagastada. Kauba tagastamise ja kliendisuhtluse korraldad oma müügitingimuste järgi.</p></details>
          <details data-analytics-label="design" onToggle={trackFaqToggle}><summary>Kui palju saan poe kujundust muuta?<span>+</span></summary><p>Poe ilme saad kohandada oma brändile sobivaks. Näiteks saad valida kujunduse ja värvid, lisada logo, muuta nuppude ja soodushindade välimust ning lisada teateriba. Valikuid saad hiljem alati muuta.</p></details>
          <details data-analytics-label="change_plan" onToggle={trackFaqToggle}><summary>Kas saan paketti hiljem vahetada?<span>+</span></summary><p>Jah. Paindlikult paketilt saad Kindlale üle minna poe halduses. Kindlalt paketilt Paindlikule minnes jääb senine pakett kehtima Stripe’is näidatud perioodi lõpuni ja seejärel rakendub Paindlik pakett.</p></details>
          <details data-analytics-label="support" onToggle={trackFaqToggle}><summary>Kust saan abi?<span>+</span></summary><p>Pärast sisselogimist saad küsimuse saata Abi-nupu kaudu. Vastuseid ja varasemat vestlust näed samas kohas ning vastus saadetakse ka sinu konto e-postile.</p></details>
        </div>
        <button className="platform-faq__toggle" type="button" aria-expanded={showAllFaq} aria-controls="faq-more" onClick={() => setShowAllFaq((current) => !current)}>
          {showAllFaq ? 'Näita vähem' : 'Vaata veel 7 küsimust'} <span aria-hidden="true">{showAllFaq ? '−' : '+'}</span>
        </button>
      </div>
    </section>
    <footer className="platform-footer">
      <div><Brand /><p>Lihtne e-pood Eesti väikeettevõtjale.</p></div>
      <div><a href="/mis-on-poeruum/">Mis on Poeruum?</a><a href="https://kaubamaja.poeruum.ee/">Kaubamaja</a><a href="/kasutustingimused">Kasutustingimused</a><a href="/privaatsus">Privaatsus</a><span>© 2026 Poeruum</span></div>
    </footer>
  </main>

  if (screen === 'login') return <main className="auth-page auth-page--login">
    <FlowHeader onBack={() => setScreen('landing')} />
    <div className="auth-flow auth-flow--login">
      <div className="auth-content">
        <aside className="auth-intro auth-intro--login">
          <span className="platform-eyebrow">Tere tulemast tagasi</span>
          <h1>Jätka sealt, kus pooleli jäi.</h1>
        </aside>
        <section className="auth-card auth-card--login">
          <h1>Logi sisse</h1><p>Tagasi oma poe haldusesse.</p>
          <form onSubmit={signIn}>
            <label>E-posti aadress<input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAuthError(''); setAuthNotice(''); setNeedsEmailConfirmation(false); setConfirmationResendCooldown(0); setIsConfirmationRateLimited(false) }} onBlur={restoreLoginScrollAfterKeyboard} placeholder="sina@ettevote.ee" autoComplete="username" enterKeyHint="next" autoFocus /></label>
            <label>Parool<input required name="password" type="password" placeholder="Sinu parool" autoComplete="current-password" enterKeyHint="done" onBlur={restoreLoginScrollAfterKeyboard} /></label>
            <button className="auth-password-link" type="button" onClick={() => { setAuthError(''); setAuthNotice(''); setScreen('forgot-password') }}>Unustasid parooli?</button>
            <Turnstile key={`login-${captchaResetKey}`} action="login" onToken={handleCaptchaToken} />
            {needsEmailConfirmation && <div className="auth-confirmation-prompt" role="alert">
              <span><strong>{authError || 'Kinnita e-posti aadress'}</strong><small>{isConfirmationRateLimited ? 'Kasuta kõige uuemat saabunud kirja või proovi umbes tunni pärast uuesti.' : 'Kasuta kõige uuemat kirja, mille Poeruum sulle saatis.'}</small></span>
              <button type="button" disabled={isAuthBusy || !isCaptchaReady || isConfirmationRateLimited || confirmationResendCooldown > 0} onClick={resendConfirmation}>
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
      <aside className="auth-intro auth-intro--login"><span className="platform-eyebrow">Parooli taastamine</span><h1>Saadame sulle turvalise lingi.</h1><p>Lingi kaudu saad valida uue parooli. Sinu pood ja andmed jäävad alles.</p></aside>
      <section className="auth-card auth-card--login">
        <h1>Unustasid parooli?</h1><p>Sisesta oma konto e-posti aadress.</p>
        <form onSubmit={requestPasswordReset}>
          <label>E-posti aadress<input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAuthError(''); setAuthNotice('') }} placeholder="sina@ettevote.ee" autoComplete="email" autoFocus /></label>
          <Turnstile key={`password-reset-${captchaResetKey}`} action="password_reset" onToken={handleCaptchaToken} />
          {authError && <p className="add-product-error" role="alert">{authError}</p>}
          {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
          <button type="submit" disabled={isAuthBusy || !email.trim() || !isCaptchaReady}>{isAuthBusy ? 'Saadan…' : 'Saada taastamislink'} <span>→</span></button>
        </form>
        <div className="auth-switch"><span>Parool tuli meelde?</span><button type="button" onClick={() => setScreen('login')}>Logi sisse</button></div>
      </section>
    </div></div>
  </main>

  if (screen === 'reset-password') return <main className="auth-page auth-page--login">
    <FlowHeader onBack={() => setScreen('login')} />
    <div className="auth-flow auth-flow--login"><div className="auth-content">
      <aside className="auth-intro auth-intro--login"><span className="platform-eyebrow">Uus parool</span><h1>Taasta ligipääs oma poele.</h1><p>Vali uus tugev parool, mida sa mujal ei kasuta.</p></aside>
      <section className="auth-card auth-card--login">
        <h1>Vali uus parool</h1><p>{email ? `Konto: ${email}` : 'Sisesta uus parool.'}</p>
        <form onSubmit={completePasswordReset}>
          <label>Uus parool<input required name="password" type="password" minLength={PASSWORD_MIN_LENGTH} placeholder={`Vähemalt ${PASSWORD_MIN_LENGTH} märki`} autoComplete="new-password" autoFocus /><small>{PASSWORD_REQUIREMENTS_TEXT}</small></label>
          <label>Korda uut parooli<input required name="passwordConfirmation" type="password" minLength={PASSWORD_MIN_LENGTH} placeholder="Korda parooli" autoComplete="new-password" /></label>
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
          <span className="platform-eyebrow">Sinu pood, sinu moodi</span>
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
            <label>Parool<input required name="password" type="password" minLength={PASSWORD_MIN_LENGTH} placeholder={`Vähemalt ${PASSWORD_MIN_LENGTH} märki`} autoComplete="new-password" /><small>{PASSWORD_REQUIREMENTS_TEXT}</small></label>
            <label className="auth-consent">
              <input required type="checkbox" />
              <span className="auth-checkbox" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg></span>
              <span>Nõustun <a href="/kasutustingimused" target="_blank" rel="noreferrer">kasutustingimustega</a> ja olen tutvunud <a href="/privaatsus" target="_blank" rel="noreferrer">privaatsuspoliitikaga</a>.</span>
            </label>
            <Turnstile key={`signup-${captchaResetKey}`} action="signup" onToken={handleCaptchaToken} />
            {authError && <p className="add-product-error" role="alert">{authError}</p>}
            <button type="submit" disabled={isAuthBusy || !isCaptchaReady}>{isAuthBusy ? 'Loon kontot…' : 'Loo konto ja jätka'} <span>→</span></button>
          </form>
          <div className="auth-switch"><span>Konto juba olemas?</span><button type="button" onClick={() => setScreen('login')}>Logi sisse</button></div>
          <small>Konto luuakse Supabase Authis.</small>
        </section>
      </div>
    </div>
  </main>

  const onBack = () => {
    setSetupExitSaveFailed(false)
    setAuthError('')
    setScreen(onlineUserId && screen === 'store' ? 'landing' : backMap[screen] ?? 'landing')
  }
  const signOutOfSetup = async () => {
    const { error: signOutError } = await requireSupabase().auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
    resetPlatformFlow()
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  const saveAndExitSetup = async () => {
    if (isSetupExiting) return
    setIsSetupExiting(true)
    setSetupExitSaveFailed(false)
    setAuthError('')
    try {
      const currentStep = screen as Exclude<OnboardingStep, 'complete'>
      const hasValidStoreIdentity = Boolean(storeName.trim() && (slug || slugify(storeName)))

      if (store || hasValidStoreIdentity) {
        if (!hasValidStoreIdentity) throw new Error('Poe nimi peab enne salvestamist olema täidetud.')
        await persistStore({}, currentStep)
      }

      if (isStripeOnboardingOpen) {
        setIsStripeOnboardingOpen(false)
        await invokeStripeConnect('status').catch(() => undefined)
      }

      await signOutOfSetup()
    } catch (error) {
      setSetupExitSaveFailed(true)
      setAuthError(error instanceof Error ? error.message : 'Poolelioleva poe salvestamine ebaõnnestus.')
    } finally {
      setIsSetupExiting(false)
    }
  }
  const discardAndExitSetup = async () => {
    if (isSetupExiting) return
    setIsSetupExiting(true)
    setAuthError('')
    try {
      setIsStripeOnboardingOpen(false)
      await signOutOfSetup()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Väljalogimine ebaõnnestus.')
    } finally {
      setIsSetupExiting(false)
    }
  }
  const paymentSetupState = getPaymentSetupState(paymentStatus, Boolean(store?.stripe_account_id), stripeRequirements)
  const paymentNeedsAction = paymentSetupState === 'setup-required'
  const paymentCanContinue = paymentSetupState !== 'setup-required'

  return <SetupShell
    screen={screen}
    onBack={onBack}
    onExit={() => void saveAndExitSetup()}
    onDiscardExit={setupExitSaveFailed ? () => void discardAndExitSetup() : undefined}
    isExiting={isSetupExiting}
  >
    {returnNotice}
    {screen === 'store' && <form className="setup-form" onSubmit={async (event) => { event.preventDefault(); setAuthError(''); try { await persistStore({}, 'business'); setScreen('business') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>
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
        </div></>}
      {isStripeOnboardingOpen ? <StripeEmbeddedOnboarding
        mode={stripeEmbeddedMode}
        onExit={finishStripeEmbeddedOnboarding}
        onClose={finishStripeEmbeddedOnboarding}
        onError={(message) => { setAuthError(message); setIsStripeConnecting(false) }}
      /> : <>{paymentNeedsAction ? <button className="payment-setup-action is-stripe" disabled={isStripeConnecting} onClick={() => void startStripeConnect('onboarding')}>
        <strong>{isStripeConnecting ? 'Avan Stripe’i…' : paymentStatus === 'pending' ? 'Jätka Stripe’i seadistamist' : 'Seadista Stripe'}</strong><span>→</span>
      </button> : paymentSetupState === 'reviewing' ? <div className="connected-provider is-pending" role="status">
        <span aria-hidden="true">…</span><div><strong>Stripe kontrollib andmeid</strong><small>Kõik vajalik on esitatud. Võid poe seadistamisega jätkata; maksed aktiveeruvad pärast Stripe’i kinnitust.</small></div>
      </div> : <div className="connected-provider"><span>✓</span><div><strong>Maksed on valmis</strong></div></div>}</>}
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      {!isStripeOnboardingOpen && paymentCanContinue && <button className="setup-next" onClick={async () => { try { await persistStore({}, 'shipping'); setScreen('shipping') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka tarnega <span>→</span></button>}
    </div>}

    {screen === 'shipping' && <div className="setup-form"><span className="setup-kicker">Kauba kättesaamine</span><h1>Vali tarneviisid</h1>
      <div className="shipping-list">{[
        ['omniva', 'https://old.omniva.ee/public/banners/logo/Omniva_lockup_horizontal_orange.svg', 'Omniva pakiautomaat'],
        ['dpd', 'https://www.dpd.com/wp-content/themes/DPD_NoLogin/images/DPD_logo_redgrad_rgb_responsive.svg', 'DPD pakiautomaat'],
        ['smartposti', 'https://images.ctfassets.net/dvxpcmq06s7e/5LDF7M5UltxLRSteji1IIj/66fc61b81e453d12d154fcaceec04e42/Logo_SmartPosti.png', 'SmartPosti pakiautomaat'],
        ['pickup', '', 'Tulen ise järele'],
      ].map(([id, logo, name]) => <label key={id}><span className={`shipping-brand shipping-brand--${id}`}>{logo ? <img src={logo} alt="" loading="eager" decoding="async" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>}</span><div><strong>{name}</strong></div><input type="checkbox" checked={shipping.includes(id)} onChange={() => setShipping((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} /><i /></label>)}</div>
      <button className="setup-next" disabled={!shipping.length} onClick={async () => { try { await persistStore({}, 'product'); setScreen('product') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Poe salvestamine ebaõnnestus.') } }}>Jätka esimese tootega <span>→</span></button>
    </div>}

    {screen === 'business' && <form className="setup-form setup-business" onSubmit={async (event) => {
      event.preventDefault()
      setAuthError('')
      if (!/^\d{8}$/.test(registryCode.trim())) { setAuthError('Registrikood peab olema 8-kohaline.'); return }
      if (vatRegistered && !/^EE\d{9}$/.test(vatNumber.trim())) { setAuthError('KMKR number peab olema kujul EE123456789.'); return }
      try { await persistStore({}, 'payments'); setScreen('payments') }
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
      <label className="setup-vat-toggle"><input type="checkbox" checked={vatRegistered} onChange={(event) => { setVatRegistered(event.target.checked); if (!event.target.checked) setVatNumber('') }} /><span><strong>Olen käibemaksukohustuslane</strong><small>Kasuta poes Eesti standardmäära 24%</small></span></label>
      {vatRegistered && <label>KMKR number<input required value={vatNumber} pattern="EE[0-9]{9}" maxLength={11} onChange={(event) => setVatNumber(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} placeholder="EE123456789" /><small>Tootehinnad sisestad koos käibemaksuga.</small></label>}
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
        <div className={`publish-payment-status${paymentSetupState !== 'connected' ? ' is-pending' : ''}`}>
          <i className="provider-logo provider-logo--stripe"><img src="/images/stripe-wordmark.svg" alt="Stripe" /></i>
          <span><strong>{paymentSetupState === 'reviewing' ? 'Stripe kontrollib andmeid' : paymentSetupState === 'setup-required' ? 'Stripe vajab seadistamist' : 'Maksed aktiivsed'}</strong>
            {paymentSetupState !== 'connected' && <small>{paymentSetupState === 'reviewing' ? 'Kõik vajalik on esitatud' : 'Lõpeta seadistus enne avaldamist'}</small>}
          </span>
          <button type="button" onClick={() => setScreen('payments')} aria-label="Muuda makseteenust"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.5 6.7 2.8 2.8" /></svg></button>
        </div>
        <div className="publish-seller-row">
          <span><strong>{businessName}</strong><small>· {registryCode}</small></span>
          <button type="button" onClick={() => setScreen('business')} aria-label="Muuda müüja andmeid">Muuda</button>
        </div>
        <div className="publish-seller-row">
          <span><strong>{storedProducts.length ? `${storedProducts.length} ${storedProducts.length === 1 ? 'toode' : 'toodet'}` : 'Esimene toode puudub'}</strong><small>{storedProducts.length ? '· valmis avaldamiseks' : '· lisa enne avaldamist'}</small></span>
          <button type="button" onClick={() => setScreen('product')} aria-label="Muuda poe tooteid">{storedProducts.length ? 'Muuda' : 'Lisa toode'}</button>
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
            <span className="publish-plan-details"><strong>Teenustasu {formatPricingPercent(PLATFORM_FEE_RATE)} müügilt + km</strong><small>Koos km-ga {formatPricingPercent(PLATFORM_FEE_RATE * (1 + VAT_RATE))} · kuni {formatPricingEuro(PLATFORM_FEE_NET_CAP)} + km ({formatPricingEuro(PLATFORM_FEE_GROSS_CAP)} koos km-ga)</small></span>
            <b>{pricingPlan === 'flexible' ? 'Valitud' : 'Vali pakett'}<span aria-hidden="true">{pricingPlan === 'flexible' ? '✓' : '→'}</span></b>
          </button>
          <button type="button" role="radio" aria-checked={pricingPlan === 'fixed'} className={pricingPlan === 'fixed' ? 'is-selected' : ''} onClick={() => selectPricingPlan('fixed')}>
            <span className="publish-plan-name">Kindel<i aria-hidden="true" /></span>
            <strong className="publish-plan-price">{formatPricingEuro(FIXED_PLAN_MONTHLY_FEE)} <small>/ kuu + km</small></strong>
            <span className="publish-plan-details"><strong>Esimesed 30 päeva tasuta</strong><small>{formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} koos km-ga · müügitasu 0%</small></span>
            <b>{pricingPlan === 'fixed' ? 'Valitud' : 'Vali Kindel'}<span aria-hidden="true">{pricingPlan === 'fixed' ? '✓' : '→'}</span></b>
          </button>
        </div>
        <small className="publish-fee-note">Paketti saad hiljem muuta · Maksetasud lisanduvad</small>
      </section>
      {authError && <p className="add-product-error" role="alert">{authError}</p>}
      <button className="publish-button" disabled={isPublishing || !storedProducts.length} onClick={publishStore}>
        {isPublishing
          ? paymentSetupState === 'connected' ? 'Avaldan poodi…' : 'Kontrollin Stripe’i…'
          : !storedProducts.length
            ? 'Lisa enne esimene toode'
          : paymentSetupState === 'reviewing'
            ? 'Kontrolli ja avalda pood'
          : paymentSetupState === 'setup-required'
            ? 'Kontrolli Stripe’i valmisolekut'
          : pricingPlan === 'fixed' && !fixedPlanTrialStartedAt
            ? 'Jätka maksekaardiga'
            : 'Avalda pood'}
        <span>{isPublishing ? '◌' : '→'}</span>
      </button>
      <div className="publish-notes">
        <small className="publish-note">{pricingPlan === 'fixed' && <><span className="publish-trial-copy">Prooviperiood algab avaldamisel.</span><span className="publish-note-separator" aria-hidden="true"> · </span></>}Avaldamisega nõustud <a href="/kasutustingimused" target="_blank" rel="noreferrer">kasutustingimustega</a> ja kinnitad, et oled tutvunud <a href="/privaatsus" target="_blank" rel="noreferrer">privaatsuspoliitikaga</a>.</small>
      </div>
    </div>}
    {isBillingCardOpen && <BillingPlanDialog confirmLabel="Jätka Stripe’is" onClose={() => setIsBillingCardOpen(false)} onConfirm={async (checkoutRequestId) => {
      await persistStore()
      const url = await startStripeBillingCheckout(checkoutRequestId)
      window.location.assign(url)
    }} />}
  </SetupShell>
}

export default function PlatformApp() {
  const fallback = document.documentElement.dataset.appSurface === 'storefront'
    ? <StorefrontLoadingScreen store={null} />
    : <main className="platform-loading" aria-label="Laadin Poeruumi"><span /></main>
  return <Suspense fallback={fallback}>
    <PlatformFlow />
  </Suspense>
}
