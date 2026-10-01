import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import './admin.css'
import './adminTheme.css'
import './adminUsers.css'
import { createRandomId } from './lib/randomId'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Brand } from './Brand'
import PasswordInput from './PasswordInput'
import { hasAdminRole } from './lib/adminAccess'
import { Storefront } from './App'
import { getShowcaseStore, listProducts, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { getCaptchaRequiredMessage, isCaptchaConfigured, Turnstile } from './Turnstile'
import type { Product } from './products'
import AdminLeads from './AdminLeads'
import AdminSupport from './AdminSupport'
import AdminPaymentReviews from './AdminPaymentReviews'
import { applySeoMetadata } from './lib/seo'
import { getHomepageSeoValidationError, seoTextLength } from './lib/homepageSeo'
import AdminUsers from './AdminUsers'
import AdminOverview from './AdminOverview'
import type { RevenueEvent, RevenueDashboard, AnalyticsRange, HomepageAnalyticsDashboard, HomepageEngagementDashboard, AnalyticsEngagementBucket } from './lib/adminDashboard'
import type { AdminUserRow, LatestEmailDelivery } from './lib/adminUserOverview'

const AdminBusinessCard = lazy(() => import('./AdminBusinessCard'))
const AdminKaubamaja = lazy(() => import('./AdminKaubamaja'))

type AdminView = 'payments' | 'overview' | 'analytics' | 'seo' | 'leads' | 'support' | 'users' | 'business-card' | 'directory'
type SocialPreviewPlatform = 'facebook' | 'linkedin' | 'slack'

const adminViewConfig: Record<AdminView, { path: string; title: string }> = {
  payments: { path: '/admin/payments', title: 'Maksete kontroll' },
  overview: { path: '/admin', title: 'Ülevaade' },
  analytics: { path: '/admin/analytics', title: 'Külastatavus' },
  seo: { path: '/admin/seo', title: 'SEO' },
  leads: { path: '/admin/leads', title: 'Kliendiotsing' },
  support: { path: '/admin/support', title: 'Klienditugi' },
  users: { path: '/admin/users', title: 'Kasutajad' },
  'business-card': { path: '/admin/business-card', title: 'Visiitkaart' },
  directory: { path: '/admin/kaubamaja', title: 'Kaubamaja' },
}

const getAdminView = (pathname = window.location.pathname): AdminView => {
  if (/^\/admin\/payments\/?$/i.test(pathname)) return 'payments'
  if (/^\/admin\/analytics\/?$/i.test(pathname)) return 'analytics'
  if (/^\/admin\/seo\/?$/i.test(pathname)) return 'seo'
  if (/^\/admin\/leads\/?$/i.test(pathname)) return 'leads'
  if (/^\/admin\/support\/?$/i.test(pathname)) return 'support'
  if (/^\/admin\/users\/?$/i.test(pathname)) return 'users'
  if (/^\/admin\/business-card\/?$/i.test(pathname)) return 'business-card'
  if (/^\/admin\/kaubamaja\/?$/i.test(pathname)) return 'directory'
  return 'overview'
}

const emptyRevenueDashboard: RevenueDashboard = {
  month_total_cents: 0,
  today_total_cents: 0,
  subscription_total_cents: 0,
  transaction_fee_total_cents: 0,
  refund_total_cents: 0,
  recent_events: [],
}

const emptyHomepageAnalytics: HomepageAnalyticsDashboard = {
  range_days: 30,
  sessions: 0,
  anonymous_sessions: 0,
  merchant_sessions: 0,
  average_engaged_seconds: 0,
  measured_sessions: 0,
  engaged_sessions: 0,
  signup_starts: 0,
  tracked_accounts: 0,
  demo_opens: 0,
  pricing_views: 0,
  accounts_created: 0,
  stores_started: 0,
  payments_connected: 0,
  stores_published: 0,
  daily: [],
  sources: [],
  engagement_buckets: [],
  devices: [],
  ctas: [],
  faqs: [],
}

const SOCIAL_IMAGE_WIDTH = 1200
const SOCIAL_IMAGE_HEIGHT = 630
const DEFAULT_SEO_TITLE = 'Poeruum – loo Eesti e-pood 10 minutiga'
const DEFAULT_SEO_DESCRIPTION = 'Loo professionaalne e-pood umbes 10 minutiga. Lisa tooted telefonist, võta vastu makseid ning halda tellimusi ja tarnet ühest lihtsast keskkonnast.'
const DEFAULT_SOCIAL_TITLE = 'Lihtne e-pood Eesti väikeettevõtjale'
const DEFAULT_SOCIAL_DESCRIPTION = 'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.'

type HomepageSeoSettings = {
  seo_title: string
  seo_description: string
  social_title: string
  social_description: string
  search_indexing_enabled: boolean
  seo_updated_at: string | null
}

const defaultHomepageSeoSettings: HomepageSeoSettings = {
  seo_title: DEFAULT_SEO_TITLE,
  seo_description: DEFAULT_SEO_DESCRIPTION,
  social_title: DEFAULT_SOCIAL_TITLE,
  social_description: DEFAULT_SOCIAL_DESCRIPTION,
  search_indexing_enabled: true,
  seo_updated_at: null,
}

const prepareSocialImage = async (file: File) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Vali JPG-, PNG- või WebP-pilt.')
  }
  if (file.size > 20_000_000) throw new Error('Algfail võib olla kuni 20 MB.')

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = SOCIAL_IMAGE_WIDTH
  canvas.height = SOCIAL_IMAGE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Brauser ei saanud pilti töödelda.')
  }

  const scale = Math.max(SOCIAL_IMAGE_WIDTH / bitmap.width, SOCIAL_IMAGE_HEIGHT / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, (SOCIAL_IMAGE_WIDTH - width) / 2, (SOCIAL_IMAGE_HEIGHT - height) / 2, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Pildi optimeerimine ebaõnnestus.')
  return blob
}

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
  : '—'

const formatPercent = (value: number, total: number) => total
  ? `${new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 }).format(value / total * 100)}%`
  : '0%'

const formatDuration = (value: number) => {
  const seconds = Math.max(0, Math.round(value))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (!minutes) return `${remainingSeconds} s`
  if (!remainingSeconds) return `${minutes} min`
  return `${minutes} min ${remainingSeconds} s`
}

const analyticsCtaLabels: Record<string, string> = {
  hero: 'Hero „Alusta tasuta“',
  nav: 'Menüü „Loo pood“',
  mobile_nav: 'Mobiilimenüü „Loo pood“',
  pricing_flexible: 'Paindlik pakett',
  pricing_fixed: 'Kindel pakett',
}

const analyticsFaqLabels: Record<string, string> = {
  pricing: 'Kui palju Poeruum maksab?',
  plan_features: 'Kas paketid erinevad?',
  requirements: 'Mida vajan poe avamiseks?',
  payments: 'Kuidas kliendid maksta saavad?',
  shipping: 'Milliseid tarneviise saab kasutada?',
  custom_domain: 'Kas saan kasutada oma domeeni?',
  google: 'Kas pood on Google’is leitav?',
  mobile_setup: 'Kas poe saab telefonis valmis teha?',
  buyer_account: 'Kas ostjal peab olema konto?',
  order_notice: 'Kuidas saan tellimusest teada?',
  refunds: 'Kas saan makse tagastada?',
  design: 'Kui palju saan kujundust muuta?',
  change_plan: 'Kas saan paketti vahetada?',
  support: 'Kust saan abi?',
}

const analyticsDeviceLabels: Record<string, string> = {
  mobile: 'Mobiil',
  tablet: 'Tahvel',
  desktop: 'Arvuti',
}

const analyticsEngagementBucketLabels: Record<AnalyticsEngagementBucket['bucket'], string> = {
  under_10: 'Alla 10 sekundi',
  '10_29': '10–29 sekundit',
  '30_119': '30 sekundit – 2 minutit',
  '120_plus': 'Vähemalt 2 minutit',
}

const formatRelativeTime = (value: string | null) => {
  if (!value) return 'Pole aktiivne olnud'
  const elapsed = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 2) return 'just nüüd'
  if (minutes < 60) return `${minutes} min tagasi`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h tagasi`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'eile'
  if (days < 30) return `${days} päeva tagasi`
  return formatDate(value)
}

type AdminIconName = 'home' | 'analytics' | 'seo' | 'leads' | 'users' | 'store' | 'message' | 'logout' | 'refresh' | 'check' | 'arrow' | 'alert' | 'search' | 'revenue' | 'card'

function AdminIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5M10 20v-5h4v5" /></>,
    analytics: <><path d="M5 19V11M12 19V5M19 19v-8" /><path d="M3 19h18" /></>,
    seo: <><circle cx="11" cy="11" r="7" /><path d="M4 11h14M11 4a11 11 0 0 1 0 14M11 4a11 11 0 0 0 0 14M16.5 16.5 21 21" /></>,
    leads: <><path d="M4 18.5V14l4-2 3 1.5 4-5 5-2.5" /><path d="m16.5 5.5 3.5.5-.5 3.5" /><circle cx="6" cy="7" r="2.5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.5 2.2-5.3 5.5-5.3s5.1 1.8 5.5 5.3" /><circle cx="17" cy="9" r="2.2" /><path d="M15.5 14.2c3.1-.4 4.8 1.2 5 4" /></>,
    store: <><path d="M4 9h16l-1-4H5L4 9Z"/><path d="M5 9v10h14V9M9 19v-5h6v5"/><path d="M4 9a3 3 0 0 0 5 2 3 3 0 0 0 6 0 3 3 0 0 0 5-2"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="10" r="1.5" /><path d="M5.5 15c.3-1.7 1.2-2.5 2.5-2.5s2.2.8 2.5 2.5M14 10h4M14 14h4" /></>,
    message: <><path d="M4.5 5.5h15v10h-10l-5 3.5V5.5Z"/><path d="M8 9h8M8 12h5"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9" /></>,
    refresh: <><path d="M19 8a7.5 7.5 0 1 0 .3 7" /><path d="M19 4v4h-4" /></>,
    check: <path d="m6 12 4 4 8-9" />,
    arrow: <><path d="M7 17 17 7M9 7h8v8" /></>,
    alert: <><path d="M12 7v6" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></>,
    revenue: <><circle cx="12" cy="12" r="8" /><path d="M15 8.5c-.7-.5-1.5-.7-2.4-.7-1.6 0-2.7.7-2.7 1.8 0 2.8 5.4 1.3 5.4 4.2 0 1.1-1.1 2-2.8 2-.9 0-1.9-.3-2.7-.8M12.5 6v12" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function AdminLogin({
  accessError,
  onSignInAttempt,
  onSignedIn,
}: {
  accessError: string
  onSignInAttempt: () => void
  onSignedIn: (session: Session) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    onSignInAttempt()
    setIsBusy(true)
    if (isCaptchaConfigured && !captchaToken) {
      setError(getCaptchaRequiredMessage())
      setIsBusy(false)
      return
    }
    const { data, error: authError } = await requireSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
      options: { captchaToken: captchaToken || undefined },
    })
    if (authError) setError('E-posti aadress või parool ei ole õige.')
    else if (data.session) onSignedIn(data.session)
    else setError('Sisselogimine ebaõnnestus. Proovi uuesti.')
    setIsBusy(false)
    setCaptchaToken('')
    setCaptchaResetKey((value) => value + 1)
  }

  return <main className="admin-auth">
    <a className="admin-auth__brand" href="/"><Brand /></a>
    <section className="admin-auth__card">
      <span>POERUUMI HALDUS</span>
      <h1>Administraatori töölaud</h1>
      <p>Logi sisse administraatori õigustega kontoga.</p>
      <form onSubmit={signIn}>
        <label>E-post<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
        <PasswordInput label="Parool" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        <Turnstile key={`admin-login-${captchaResetKey}`} action="admin_login" onToken={setCaptchaToken} />
        {(error || accessError) && <p className="admin-auth__error" role="alert">{error || accessError}</p>}
        <button type="submit" disabled={isBusy}>{isBusy ? 'Login sisse…' : 'Logi sisse'}<span aria-hidden="true">→</span></button>
      </form>
      <small>Ligipääs on ainult Poeruumi administraatoritele.</small>
    </section>
  </main>
}

export default function AdminApp() {
  const [activeView, setActiveView] = useState<AdminView>(() => getAdminView())
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [adminAccessGranted, setAdminAccessGranted] = useState(false)
  const [adminLoginError, setAdminLoginError] = useState('')
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set())
  const [presenceKnown, setPresenceKnown] = useState(false)
  const [onlineViews, setOnlineViews] = useState<Map<string, string>>(() => new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [userMetricsError, setUserMetricsError] = useState('')
  const [revenue, setRevenue] = useState<RevenueDashboard>(emptyRevenueDashboard)
  const [revenueError, setRevenueError] = useState('')
  const [isRevenueLoading, setIsRevenueLoading] = useState(true)
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(30)
  const [homepageAnalytics, setHomepageAnalytics] = useState<HomepageAnalyticsDashboard>(emptyHomepageAnalytics)
  const [analyticsError, setAnalyticsError] = useState('')
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false)
  const [liveRevenueEventId, setLiveRevenueEventId] = useState<string | null>(null)
  const [latestEmails, setLatestEmails] = useState<Map<string, LatestEmailDelivery>>(() => new Map())
  const [showcaseStore, setShowcaseStore] = useState<StoreRecord | null>(null)
  const [showcaseProducts, setShowcaseProducts] = useState<Product[]>([])
  const [, setIsShowcaseLoading] = useState(false)
  const [, setShowcaseError] = useState('')
  const [isManagingShowcase, setIsManagingShowcase] = useState(false)
  const [socialImagePath, setSocialImagePath] = useState<string | null>(null)
  const [isSocialImageUpdating, setIsSocialImageUpdating] = useState(false)
  const [socialImageError, setSocialImageError] = useState('')
  const [socialImageNotice, setSocialImageNotice] = useState('')
  const [socialPreviewPlatform, setSocialPreviewPlatform] = useState<SocialPreviewPlatform>('facebook')
  const [seoSettings, setSeoSettings] = useState<HomepageSeoSettings>(defaultHomepageSeoSettings)
  const [seoDraft, setSeoDraft] = useState<HomepageSeoSettings>(defaultHomepageSeoSettings)
  const [isSeoSaving, setIsSeoSaving] = useState(false)
  const [seoError, setSeoError] = useState('')
  const [seoNotice, setSeoNotice] = useState('')
  const dashboardRefreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const view = adminViewConfig[activeView]
    applySeoMetadata({
      title: `${view.title} — Poeruumi admin`,
      description: 'Poeruumi administraatori turvaline sisselogimine.',
      canonicalUrl: `https://poeruum.ee${view.path}`,
      noIndex: true,
    })
  }, [activeView])

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(getAdminView())
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigateToView = (event: ReactMouseEvent<HTMLAnchorElement>, view: AdminView) => {
    event.preventDefault()
    const nextPath = adminViewConfig[view].path
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setActiveView(view)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const openShowcaseManager = async () => {
    setIsShowcaseLoading(true)
    setShowcaseError('')
    try {
      const found = await getShowcaseStore()
      if (!found) throw new Error('Näidispoodi ei leitud. Rakenda esmalt näidispoe migratsioon.')
      const products = await listProducts(found.id)
      setShowcaseStore(found)
      setShowcaseProducts(products)
      setIsManagingShowcase(true)
    } catch (loadError) {
      setShowcaseError(loadError instanceof Error ? loadError.message : 'Näidispoodi ei õnnestunud avada.')
    } finally {
      setIsShowcaseLoading(false)
    }
  }

  const logOut = async () => {
    setIsSigningOut(true)
    try {
      await requireSupabase().auth.signOut({ scope: 'local' })
    } finally {
      window.location.replace('/')
    }
  }

  const loadRevenue = async () => {
    setIsRevenueLoading(true)
    const { data, error: queryError } = await requireSupabase().rpc('admin_revenue_dashboard')
    setIsRevenueLoading(false)
    if (queryError) {
      setRevenueError('Tulude andmeid ei õnnestunud laadida. Rakenda tulude migratsioon.')
      return
    }
    const result = Array.isArray(data) ? data[0] : data
    setRevenue({
      month_total_cents: Number(result?.month_total_cents ?? 0),
      today_total_cents: Number(result?.today_total_cents ?? 0),
      subscription_total_cents: Number(result?.subscription_total_cents ?? 0),
      transaction_fee_total_cents: Number(result?.transaction_fee_total_cents ?? 0),
      refund_total_cents: Number(result?.refund_total_cents ?? 0),
      recent_events: Array.isArray(result?.recent_events) ? result.recent_events.map((event: RevenueEvent) => ({ ...event, amount_cents: Number(event.amount_cents) })) : [],
    })
    setRevenueError('')
  }

  const loadHomepageAnalytics = async (range: AnalyticsRange = analyticsRange) => {
    setIsAnalyticsLoading(true)
    const client = requireSupabase()
    const [analyticsResponse, engagementResponse] = await Promise.all([
      client.rpc('admin_homepage_analytics', { requested_days: range }),
      client.rpc('admin_homepage_engagement', { requested_days: range }),
    ])
    if (analyticsResponse.error || engagementResponse.error) {
      setAnalyticsError('Külastatavuse andmeid ei õnnestunud laadida. Rakenda avalehe analüütika migratsioonid.')
      setIsAnalyticsLoading(false)
      return
    }
    const result = (analyticsResponse.data ?? {}) as Partial<HomepageAnalyticsDashboard>
    const engagement = (engagementResponse.data ?? {}) as Partial<HomepageEngagementDashboard>
    const numberValue = (value: unknown) => Number(value ?? 0)
    setHomepageAnalytics({
      range_days: numberValue(result.range_days) || range,
      sessions: numberValue(result.sessions),
      anonymous_sessions: numberValue(result.anonymous_sessions),
      merchant_sessions: numberValue(result.merchant_sessions),
      average_engaged_seconds: numberValue(engagement.average_engaged_seconds),
      measured_sessions: numberValue(engagement.measured_sessions),
      engaged_sessions: numberValue(engagement.engaged_sessions),
      signup_starts: numberValue(result.signup_starts),
      tracked_accounts: numberValue(result.tracked_accounts),
      demo_opens: numberValue(result.demo_opens),
      pricing_views: numberValue(result.pricing_views),
      accounts_created: numberValue(result.accounts_created),
      stores_started: numberValue(result.stores_started),
      payments_connected: numberValue(result.payments_connected),
      stores_published: numberValue(result.stores_published),
      daily: (result.daily ?? []).map((point) => ({
        date: point.date,
        sessions: numberValue(point.sessions),
        signup_starts: numberValue(point.signup_starts),
        accounts_created: numberValue(point.accounts_created),
      })),
      sources: (engagement.sources ?? []).map((row) => ({
        source: row.source,
        sessions: numberValue(row.sessions),
        measured_sessions: numberValue(row.measured_sessions),
        engaged_sessions: numberValue(row.engaged_sessions),
        average_engaged_seconds: numberValue(row.average_engaged_seconds),
      })),
      engagement_buckets: (engagement.engagement_buckets ?? []).map((row) => ({
        bucket: row.bucket,
        sessions: numberValue(row.sessions),
      })),
      devices: (result.devices ?? []).map((row) => ({ device: row.device, sessions: numberValue(row.sessions) })),
      ctas: (result.ctas ?? []).map((row) => ({ label: row.label, sessions: numberValue(row.sessions) })),
      faqs: (result.faqs ?? []).map((row) => ({ label: row.label, sessions: numberValue(row.sessions) })),
    })
    setAnalyticsError('')
    setIsAnalyticsLoading(false)
  }

  const loadOnlineUsers = async () => {
    let response = await requireSupabase().rpc('admin_user_presence')
    if (response.error?.code === 'PGRST202' || response.error?.code === '42883') response = await requireSupabase().rpc('admin_online_users')
    if (response.error) { setPresenceKnown(false); setOnlineUserIds(new Set()); setOnlineViews(new Map()); return }
    setPresenceKnown(true)
    setOnlineUserIds(new Set((response.data ?? []).map((row: { user_id: string }) => row.user_id)))
    setOnlineViews(new Map((response.data ?? []).filter((row: { current_view?: string }) => row.current_view).map((row: { user_id: string; current_view: string }) => [row.user_id, row.current_view])))
  }

  const [signupAlerts, setSignupAlerts] = useState<Array<{ requests: number; first_seen_at: string; last_seen_at: string }>>([])
  const loadSignupAlerts = async () => {
    const { data, error: queryError } = await requireSupabase().rpc('admin_signup_alerts')
    if (!queryError) setSignupAlerts(data ?? [])
  }

  const loadLatestEmails = async () => {
    const { data, error: queryError } = await requireSupabase().rpc('admin_latest_email_deliveries')
    if (queryError) return
    setLatestEmails(new Map(((data ?? []) as LatestEmailDelivery[]).map((delivery) => [delivery.user_id, delivery])))
  }

  const loadHomepageSettings = async () => {
    const { data, error: queryError } = await requireSupabase()
      .from('platform_settings')
      .select('social_image_path,seo_title,seo_description,social_title,social_description,search_indexing_enabled,seo_updated_at')
      .eq('id', 'homepage')
      .maybeSingle()
    if (queryError) {
      setSeoError('Avalehe seadistusi ei õnnestunud laadida.')
      return
    }
    setSocialImagePath(data?.social_image_path ?? null)
    const nextSeoSettings: HomepageSeoSettings = {
      seo_title: data?.seo_title ?? DEFAULT_SEO_TITLE,
      seo_description: data?.seo_description ?? DEFAULT_SEO_DESCRIPTION,
      social_title: data?.social_title ?? DEFAULT_SOCIAL_TITLE,
      social_description: data?.social_description ?? DEFAULT_SOCIAL_DESCRIPTION,
      search_indexing_enabled: data?.search_indexing_enabled ?? true,
      seo_updated_at: data?.seo_updated_at ?? null,
    }
    setSeoSettings(nextSeoSettings)
    setSeoDraft(nextSeoSettings)
    setSeoError('')
  }

  const saveSeoSettings = async () => {
    const cleaned: HomepageSeoSettings = {
      seo_title: seoDraft.seo_title.trim(),
      seo_description: seoDraft.seo_description.trim(),
      social_title: seoDraft.social_title.trim(),
      social_description: seoDraft.social_description.trim(),
      search_indexing_enabled: seoDraft.search_indexing_enabled,
      seo_updated_at: seoDraft.seo_updated_at,
    }
    const validationError = getHomepageSeoValidationError({
      seoTitle: cleaned.seo_title,
      seoDescription: cleaned.seo_description,
      socialTitle: cleaned.social_title,
      socialDescription: cleaned.social_description,
    })
    if (validationError) {
      setSeoError(validationError)
      return
    }

    setIsSeoSaving(true)
    setSeoError('')
    setSeoNotice('')
    const { data, error: updateError } = await requireSupabase().functions.invoke('admin-homepage-seo', {
      body: {
        seoTitle: cleaned.seo_title,
        seoDescription: cleaned.seo_description,
        socialTitle: cleaned.social_title,
        socialDescription: cleaned.social_description,
        searchIndexingEnabled: cleaned.search_indexing_enabled,
      },
    })
    if (updateError) {
      setSeoError(updateError.message || 'SEO seadistuste salvestamine ebaõnnestus.')
    } else {
      const result = data as {
        settings: HomepageSeoSettings
        deploy?: { status: 'queued' | 'failed'; warning?: string }
      }
      const saved = result.settings
      setSeoSettings(saved)
      setSeoDraft(saved)
      setSeoNotice(result.deploy?.status === 'failed'
        ? 'SEO seadistused on salvestatud, kuid automaatne tootmisdeploy ei käivitunud. Käivita Renderis deploy käsitsi.'
        : 'SEO seadistused on salvestatud ja tootmisdeploy on järjekorras.')
    }
    setIsSeoSaving(false)
  }

  const socialImageUrl = socialImagePath
    ? requireSupabase().storage.from('platform-assets').getPublicUrl(socialImagePath).data.publicUrl
    : null

  const changeSocialImage = async (file: File | undefined) => {
    if (!file || isSocialImageUpdating) return
    setIsSocialImageUpdating(true)
    setSocialImageError('')
    setSocialImageNotice('')
    const previousPath = socialImagePath
    let uploadedPath = ''
    try {
      const blob = await prepareSocialImage(file)
      const randomPart = createRandomId()
      uploadedPath = `social/homepage-${randomPart}.png`
      const client = requireSupabase()
      const { error: uploadError } = await client.storage.from('platform-assets').upload(uploadedPath, blob, {
        contentType: 'image/png',
        cacheControl: '300',
        upsert: false,
      })
      if (uploadError) throw uploadError

      const { data, error: updateError } = await client.rpc('admin_set_homepage_social_image', {
        next_path: uploadedPath,
      })
      if (updateError) throw updateError
      setSocialImagePath(String(data))
      setSocialImageNotice('Uus jagamispilt on salvestatud. Mõni sotsiaalvõrgustik võib vana eelvaadet veel ajutiselt puhverdada.')
      if (previousPath) void client.storage.from('platform-assets').remove([previousPath])
    } catch (uploadError) {
      if (uploadedPath) void requireSupabase().storage.from('platform-assets').remove([uploadedPath])
      setSocialImageError(uploadError instanceof Error ? uploadError.message : 'Jagamispildi salvestamine ebaõnnestus.')
    } finally {
      setIsSocialImageUpdating(false)
    }
  }

  const removeSocialImage = async () => {
    if (!socialImagePath || isSocialImageUpdating) return
    if (!window.confirm('Kas eemaldada avalehe jagamispilt?')) return
    setIsSocialImageUpdating(true)
    setSocialImageError('')
    setSocialImageNotice('')
    const previousPath = socialImagePath
    const client = requireSupabase()
    const { error: updateError } = await client.rpc('admin_set_homepage_social_image', { next_path: null })
    if (updateError) {
      setSocialImageError(updateError.message || 'Jagamispildi eemaldamine ebaõnnestus.')
    } else {
      setSocialImagePath(null)
      setSocialImageNotice('Jagamispilt on eemaldatud.')
      void client.storage.from('platform-assets').remove([previousPath])
    }
    setIsSocialImageUpdating(false)
  }

  const loadDashboard = async ({
    silent = false,
    refreshAuth = true,
    includeAnalytics = !silent,
  }: {
    silent?: boolean
    refreshAuth?: boolean
    includeAnalytics?: boolean
  } = {}) => {
    if (!silent) setIsLoading(true)
    setError('')
    // Refresh the JWT so a newly assigned server-side admin role is available
    // without requiring the user to manually clear their existing session.
    if (refreshAuth) await requireSupabase().auth.refreshSession()
    void loadRevenue()
    if (includeAnalytics) void loadHomepageAnalytics()
    void loadLatestEmails()
    void loadSignupAlerts()
    void loadHomepageSettings()
    const [usersResponse, metricsResponse] = await Promise.all([
      requireSupabase().rpc('admin_dashboard_users'),
      requireSupabase().rpc('admin_user_overview'),
    ])
    const { data, error: queryError } = usersResponse
    const metrics = new Map<string, Partial<AdminUserRow>>((Array.isArray(metricsResponse.data) ? metricsResponse.data : []).map((row: AdminUserRow) => [row.user_id, row]))
    setUserMetricsError(metricsResponse.error || (data ?? []).some((row: AdminUserRow) => metrics.get(row.user_id)?.metrics_version !== 1) ? 'unavailable' : '')
    if (queryError) {
      const forbidden = queryError.code === '42501' || queryError.message.toLowerCase().includes('admin access')
      setError(forbidden
        ? 'Sellel kontol puudub administraatori ligipääs.'
        : 'Admini andmeid ei õnnestunud laadida. Kontrolli, et uus Supabase’i migratsioon on rakendatud.')
      setRows([])
    } else {
      setRows(((data ?? []) as AdminUserRow[]).map((row) => ({
        ...row,
        ...metrics.get(row.user_id),
        product_count: Number(row.product_count),
        order_count: Number(row.order_count),
        gross_sales: Number(row.gross_sales),
        open_support_count: Number(row.open_support_count ?? 0),
      })))
    }
    if (!silent) setIsLoading(false)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthReady(true)
      return
    }
    let active = true
    requireSupabase().auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = requireSupabase().auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session) {
      setAdminAccessGranted(false)
      setRows([])
      setRevenue(emptyRevenueDashboard)
      setHomepageAnalytics(emptyHomepageAnalytics)
      setOnlineUserIds(new Set())
      setOnlineViews(new Map())
      setPresenceKnown(false)
      return
    }

    let active = true
    setAdminAccessGranted(false)
    const verifyAdminAccess = async () => {
      const client = requireSupabase()
      const { data, error: refreshError } = await client.auth.refreshSession()
      const refreshedSession = data.session
      if (!active) return

      if (refreshError || !refreshedSession || !hasAdminRole(refreshedSession.user)) {
        setAdminLoginError(refreshError
          ? 'Sisselogitud sessiooni ei õnnestunud kontrollida. Logi uuesti sisse.'
          : 'Sellel kontol puudub administraatori ligipääs.')
        try {
          await client.auth.signOut({ scope: 'local' })
        } finally {
          if (active) setSession(null)
        }
        return
      }

      setSession(refreshedSession)
      setAdminLoginError('')
      setAdminAccessGranted(true)
      void loadDashboard({ refreshAuth: false })
    }
    void verifyAdminAccess()
    return () => { active = false }
  }, [session?.user.id])

  useEffect(() => {
    if (!session || !adminAccessGranted) return
    const client = requireSupabase()
    void loadOnlineUsers()
    const channel = client.channel(`admin-online-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence_sessions' }, () => {
        void loadOnlineUsers()
      })
      .subscribe()
    const expiryRefresh = window.setInterval(() => { void loadOnlineUsers() }, 30_000)
    return () => {
      window.clearInterval(expiryRefresh)
      void client.removeChannel(channel)
    }
  }, [session?.user.id, adminAccessGranted])

  useEffect(() => {
    if (!session || !adminAccessGranted) return
    const client = requireSupabase()
    const channel = client.channel(`admin-revenue-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'revenue_events' }, (payload) => {
        const eventId = typeof payload.new.id === 'string' ? payload.new.id : null
        setLiveRevenueEventId(eventId)
        void loadRevenue()
        window.setTimeout(() => setLiveRevenueEventId((current) => current === eventId ? null : current), 3200)
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [session?.user.id, adminAccessGranted])

  useEffect(() => {
    if (!session || !adminAccessGranted) return
    const client = requireSupabase()
    const channel = client.channel(`admin-dashboard-${session.user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'admin_dashboard_refresh', filter: 'id=eq.true' }, () => {
        if (dashboardRefreshTimerRef.current !== null) window.clearTimeout(dashboardRefreshTimerRef.current)
        dashboardRefreshTimerRef.current = window.setTimeout(() => {
          dashboardRefreshTimerRef.current = null
          void loadDashboard({ silent: true, refreshAuth: false })
        }, 350)
      })
      .subscribe()
    // Recover missed realtime events and keep the rolling 30-day window current.
    const refreshVisibleDashboard = () => {
      if (document.visibilityState === 'visible') void loadDashboard({ silent: true, refreshAuth: false })
    }
    const refreshInterval = window.setInterval(refreshVisibleDashboard, 60_000)
    document.addEventListener('visibilitychange', refreshVisibleDashboard)
    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', refreshVisibleDashboard)
      if (dashboardRefreshTimerRef.current !== null) window.clearTimeout(dashboardRefreshTimerRef.current)
      dashboardRefreshTimerRef.current = null
      void client.removeChannel(channel)
    }
  }, [session?.user.id, adminAccessGranted])

  if (!authReady || isSigningOut || (session && !adminAccessGranted)) return <main className="admin-loading"><span /><p>{isSigningOut ? 'Login välja…' : 'Kontrollin administraatori ligipääsu…'}</p></main>
  if (!isSupabaseConfigured) return <main className="admin-auth"><section className="admin-auth__card"><span>SEADISTUS PUUDUB</span><h1>Supabase pole ühendatud</h1><p>Lisa lokaalsesse <code>.env</code> faili Supabase’i võtmed ja laadi leht uuesti.</p><a href="/">Tagasi Poeruumi</a></section></main>
  if (!session) return <AdminLogin
    accessError={adminLoginError}
    onSignInAttempt={() => setAdminLoginError('')}
    onSignedIn={setSession}
  />

  if (isManagingShowcase && showcaseStore) return <Storefront
    key={`admin-platform-${showcaseStore.id}`}
    storeId={showcaseStore.id}
    initialSettings={showcaseStore.settings}
    seedProducts={showcaseProducts}
    storeName={showcaseStore.name}
    storeSlug={showcaseStore.slug}
    paymentProvider={showcaseStore.payment_provider}
    paymentsReady={false}
    initialShipping={showcaseStore.shipping}
    pricingPlan={showcaseStore.pricing_plan}
    merchantMode
    adminShowcaseMode
    onStoreChange={setShowcaseStore}
    onExit={() => setIsManagingShowcase(false)}
  />

  const seoIsDirty = seoDraft.seo_title !== seoSettings.seo_title
    || seoDraft.seo_description !== seoSettings.seo_description
    || seoDraft.social_title !== seoSettings.social_title
    || seoDraft.social_description !== seoSettings.social_description
    || seoDraft.search_indexing_enabled !== seoSettings.search_indexing_enabled
  const analyticsMaxDailyValue = Math.max(
    1,
    ...homepageAnalytics.daily.flatMap((point) => [point.sessions, point.signup_starts, point.accounts_created]),
  )
  const analyticsFunnelSteps = [
    { label: 'Avalehe külastus', detail: 'Lehesessioonid', value: homepageAnalytics.sessions },
    { label: 'Poe loomise algus', detail: 'CTA vajutajad', value: homepageAnalytics.signup_starts },
    { label: 'Konto loodud', detail: 'Uued kontod', value: homepageAnalytics.accounts_created },
    { label: 'Pood seadistamisel', detail: 'Poe andmed loodud', value: homepageAnalytics.stores_started },
    { label: 'Maksed ühendatud', detail: 'Stripe valmis', value: homepageAnalytics.payments_connected },
    { label: 'Pood avaldatud', detail: 'Valmis poed', value: homepageAnalytics.stores_published },
  ]

  return <main className={`admin-shell${activeView === 'users' ? ' admin-shell--users' : ''}`}>
    <aside className="admin-sidebar">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <nav aria-label="Administraatori menüü">
        <a className={activeView === 'overview' ? 'is-active' : undefined} href="/admin" aria-current={activeView === 'overview' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'overview')}><span><AdminIcon name="home" /></span>Ülevaade</a>
        <a className={activeView === 'analytics' ? 'is-active' : undefined} href="/admin/analytics" aria-current={activeView === 'analytics' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'analytics')}><span><AdminIcon name="analytics" /></span>Külastatavus</a>
        <a className={activeView === 'seo' ? 'is-active' : undefined} href="/admin/seo" aria-current={activeView === 'seo' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'seo')}><span><AdminIcon name="seo" /></span>SEO</a>
        <a className={activeView === 'business-card' ? 'is-active' : undefined} href="/admin/business-card" aria-current={activeView === 'business-card' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'business-card')}><span><AdminIcon name="card" /></span>Visiitkaart</a>
        <a className={activeView === 'leads' ? 'is-active' : undefined} href="/admin/leads" aria-current={activeView === 'leads' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'leads')}><span><AdminIcon name="leads" /></span>Kliendiotsing</a>
        <button type="button" onClick={() => void openShowcaseManager()}><span><AdminIcon name="store" /></span>Näidispood</button>
        <a className={activeView === 'payments' ? 'is-active' : undefined} href="/admin/payments" aria-current={activeView === 'payments' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'payments')}><span><AdminIcon name="message" /></span>Maksete kontroll</a>
        <a className={activeView === 'support' ? 'is-active' : undefined} href="/admin/support" aria-current={activeView === 'support' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'support')}><span><AdminIcon name="message" /></span>Klienditugi</a>
        <a className={activeView === 'users' ? 'is-active' : undefined} href="/admin/users" aria-current={activeView === 'users' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'users')}><span><AdminIcon name="users" /></span>Kasutajad</a>
        <a className={activeView === 'directory' ? 'is-active' : undefined} href="/admin/kaubamaja" aria-current={activeView === 'directory' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'directory')}><span><AdminIcon name="store" /></span>Kaubamaja</a>
        <a href="http://127.0.0.1:4185/previews/payments.html" target="_blank" rel="noopener noreferrer" aria-label="Maksete eelvaade (kohalik server, avaneb uuel vahelehel)" title="Kohalik eelvaade · käivita npm run dev"><span><AdminIcon name="arrow" /></span>Maksete eelvaade</a>
      </nav>
      <div className="admin-sidebar__account"><span>{session.user.email?.charAt(0).toUpperCase()}</span><div><strong>Administraator</strong><small>{session.user.email}</small></div><button type="button" onClick={() => void logOut()} aria-label="Logi välja"><AdminIcon name="logout" /></button></div>
    </aside>

    <section className={`admin-main${activeView === 'business-card' ? ' admin-main--business-card' : ''}`}>
      {activeView !== 'users' && activeView !== 'overview' && <header className="admin-topbar"><div><h1>{adminViewConfig[activeView].title}</h1></div>{activeView !== 'payments' && activeView !== 'leads' && activeView !== 'business-card' && activeView !== 'directory' && <button type="button" onClick={() => void loadDashboard()} disabled={isLoading}><span className={isLoading ? 'is-spinning' : ''}><AdminIcon name="refresh" /></span>{isLoading ? 'Uuendan…' : 'Uuenda andmeid'}</button>}</header>}

      {activeView === 'business-card' && <Suspense fallback={<div className="admin-table__empty" role="status">Laadin visiitkaarti…</div>}><AdminBusinessCard key={session.user.id} userId={session.user.id} /></Suspense>}

      {error && activeView !== 'business-card' && <div className="admin-alert" role="alert"><span>!</span><div><strong>Ligipääs puudub</strong><p>{error}</p></div></div>}

      {!error && <>
        {activeView === 'payments' && <AdminPaymentReviews />}
        {activeView === 'directory' && <Suspense fallback={<div className="admin-table__empty" role="status">Laadin Kaubamaja…</div>}><AdminKaubamaja /></Suspense>}
        {activeView === 'seo' && <div className="admin-seo">
          <section className="admin-seo__summary">
            <div>
              <span>AVALEHE LEITAVUS</span>
              <h2>SEO juhtpaneel</h2>
              <p>Halda Google’i otsingutulemust ja linkide eelvaateid ühest kohast.</p>
              {seoSettings.seo_updated_at && <small>Viimati salvestatud {formatRelativeTime(seoSettings.seo_updated_at)}</small>}
            </div>
            <button type="submit" form="admin-seo-form" disabled={!seoIsDirty || isSeoSaving}>
              {isSeoSaving ? 'Salvestan…' : seoIsDirty ? 'Salvesta muudatused' : 'Salvestatud'}
            </button>
          </section>

          {(seoError || seoNotice) && <div className={`admin-seo__notice${seoError ? ' is-error' : ''}`} role={seoError ? 'alert' : 'status'}>{seoError || seoNotice}</div>}

          <form className="admin-seo__editor" id="admin-seo-form" onSubmit={(event) => {
            event.preventDefault()
            void saveSeoSettings()
          }}>
            <section>
              <header><div><span>GOOGLE</span><h2>Otsingutulemus</h2><p>Need tekstid määravad, kuidas Poeruumi avaleht Google’is kirjeldatakse.</p></div></header>
              <label>
                <span><strong>SEO pealkiri</strong><small className={seoTextLength(seoDraft.seo_title) > 60 ? 'is-warning' : undefined}>{seoTextLength(seoDraft.seo_title)}/70</small></span>
                <input value={seoDraft.seo_title} maxLength={70} onChange={(event) => setSeoDraft((current) => ({ ...current, seo_title: event.target.value }))} />
                <small>Parim pikkus on 30–60 tähemärki.</small>
              </label>
              <label>
                <span><strong>Meta kirjeldus</strong><small className={seoTextLength(seoDraft.seo_description) > 160 ? 'is-warning' : undefined}>{seoTextLength(seoDraft.seo_description)}/200</small></span>
                <textarea rows={4} value={seoDraft.seo_description} maxLength={200} onChange={(event) => setSeoDraft((current) => ({ ...current, seo_description: event.target.value }))} />
                <small>Google kuvab tavaliselt umbes 120–160 tähemärki.</small>
              </label>
              <label className="admin-seo__toggle">
                <span><strong>Luba otsingumootoritel avalehte indekseerida</strong><small>Väljalülitamisel lisatakse avalehele noindex ja see eemaldatakse sitemapist.</small></span>
                <input type="checkbox" checked={seoDraft.search_indexing_enabled} onChange={(event) => setSeoDraft((current) => ({ ...current, search_indexing_enabled: event.target.checked }))} />
                <i aria-hidden="true" />
              </label>
            </section>

            <aside className="admin-seo__google-preview" aria-label="Google’i otsingutulemuse eelvaade">
              <span>EELVAADE</span>
              <div><i>P</i><p><small>Poeruum</small><b>https://poeruum.ee</b></p></div>
              <h3>{seoDraft.seo_title || 'Avalehe pealkiri'}</h3>
              <p>{seoDraft.seo_description || 'Avalehe kirjeldus kuvatakse siin.'}</p>
            </aside>

            <section>
              <header><div><span>SOTSIAALMEEDIA</span><h2>Lingi tekstid</h2><p>Facebook, Messenger, LinkedIn ja Slack kasutavad neid tekste koos jagamispildiga.</p></div></header>
              <label>
                <span><strong>Jagamise pealkiri</strong><small>{seoTextLength(seoDraft.social_title)}/95</small></span>
                <input value={seoDraft.social_title} maxLength={95} onChange={(event) => setSeoDraft((current) => ({ ...current, social_title: event.target.value }))} />
                <small>Kuvatakse jagamiskaardi pealkirjana pildi all.</small>
              </label>
              <label>
                <span><strong>Jagamise kirjeldus</strong><small>{seoTextLength(seoDraft.social_description)}/200</small></span>
                <textarea rows={3} value={seoDraft.social_description} maxLength={200} onChange={(event) => setSeoDraft((current) => ({ ...current, social_description: event.target.value }))} />
                <small>Kuvatakse pealkirja järel, kui valitud kanal selleks ruumi jätab.</small>
              </label>
            </section>
          </form>

          <section className="admin-social-image" aria-labelledby="admin-social-image-title">
            <div className="admin-social-image__copy">
              <span>SEO JA JAGAMINE</span>
              <h2 id="admin-social-image-title">Avalehe jagamispilt</h2>
              <p>Seda pilti näidatakse, kui keegi jagab poeruum.ee linki Facebookis, LinkedInis, Slackis või sõnumirakenduses.</p>
              <div className="admin-social-image__actions">
                <label className={isSocialImageUpdating ? 'is-disabled' : undefined}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={isSocialImageUpdating} onChange={(event) => {
                    void changeSocialImage(event.target.files?.[0])
                    event.target.value = ''
                  }} />
                  {isSocialImageUpdating ? 'Töötlen pilti…' : socialImagePath ? 'Asenda pilt' : 'Laadi uus pilt'}
                </label>
                {socialImagePath && <button type="button" disabled={isSocialImageUpdating} onClick={() => void removeSocialImage()}>Eemalda pilt</button>}
              </div>
              <small>Pilt lõigatakse automaatselt mõõtu 1200 × 630 px. Hoia oluline sisu pildi keskel.</small>
              {socialImageError && <p className="is-error" role="alert">{socialImageError}</p>}
              {socialImageNotice && <p className="is-success" role="status">{socialImageNotice}</p>}
            </div>
            <div className="admin-social-image__previews">
              <div className="admin-social-image__tabs" role="tablist" aria-label="Jagamiskaardi kanali eelvaade">
                {([
                  ['facebook', 'Facebook'],
                  ['linkedin', 'LinkedIn'],
                  ['slack', 'Slack'],
                ] as const).map(([platform, label]) => <button
                  type="button"
                  role="tab"
                  aria-selected={socialPreviewPlatform === platform}
                  className={socialPreviewPlatform === platform ? 'is-active' : undefined}
                  key={platform}
                  onClick={() => setSocialPreviewPlatform(platform)}
                >{label}</button>)}
              </div>

              <div className={`admin-social-image__preview is-${socialPreviewPlatform}`} role="tabpanel">
                {socialPreviewPlatform !== 'slack' && <header>
                  <i>P</i>
                  <span><strong>Poeruum</strong><small>{socialPreviewPlatform === 'facebook' ? 'Jagatud link · 🌐' : '1 248 jälgijat · 1 min'}</small></span>
                  <b aria-hidden="true">•••</b>
                </header>}

                {socialPreviewPlatform === 'slack' && <header>
                  <i>P</i>
                  <span><strong>Poeruum</strong><small>10:11</small></span>
                </header>}

                <div className="admin-social-image__post-copy">
                  <span>{socialPreviewPlatform === 'slack' ? 'Jagaja kirjutatud sõnum või link' : 'Jagaja lisatud postituse tekst'}</span>
                  <small>Seda teksti ei määra veebilehe seaded.</small>
                </div>

                <div className="admin-social-image__card">
                  {socialImageUrl
                    ? <img src={socialImageUrl} alt="Poeruumi jagamispildi eelvaade" />
                    : <div className="admin-social-image__empty"><strong>Jagamispilt puudub</strong><span>Laadi pilt üles, et näha täielikku eelvaadet.</span></div>}
                  <div className="admin-social-image__card-copy">
                    <small>POERUUM.EE</small>
                    <strong>{seoDraft.social_title || 'Jagamise pealkiri'}</strong>
                    <span>{seoDraft.social_description || 'Jagamise kirjeldus kuvatakse siin.'}</span>
                  </div>
                </div>

                {socialPreviewPlatform !== 'slack' && <footer aria-hidden="true">
                  <span>{socialPreviewPlatform === 'facebook' ? '♡  Meeldib' : '♡  Meeldib'}</span>
                  <span>▢  Kommenteeri</span>
                  <span>↗  Jaga</span>
                </footer>}
              </div>
              <p>Tegelik välimus võib rakenduse ja seadme järgi veidi erineda. Eelvaade näitab, millist pilti ja teksti kanal kasutab.</p>
            </div>
          </section>

          <section className="admin-seo__technical">
            <header><div><span>TEHNILINE SEO</span><h2>Automaatne kontroll</h2></div><small>Poeruumi build loob need väljundid automaatselt.</small></header>
            <div>
              <article className={seoDraft.search_indexing_enabled ? 'is-ready' : 'is-warning'}><i>{seoDraft.search_indexing_enabled ? '✓' : '!'}</i><span><strong>Indekseerimine</strong><small>{seoDraft.search_indexing_enabled ? 'index, follow · suured pildieelvaated lubatud' : 'noindex, nofollow'}</small></span></article>
              <article className="is-ready"><i>✓</i><span><strong>Canonical URL</strong><small>https://poeruum.ee/</small></span></article>
              <article className="is-ready"><i>✓</i><span><strong>Sitemap</strong><small>Automaatselt genereeritud</small></span><a href="https://poeruum.ee/sitemap.xml" target="_blank" rel="noreferrer">Ava ↗</a></article>
              <article className="is-ready"><i>✓</i><span><strong>robots.txt</strong><small>Otsingurobotite reeglid</small></span><a href="https://poeruum.ee/robots.txt" target="_blank" rel="noreferrer">Ava ↗</a></article>
              <article className="is-ready"><i>✓</i><span><strong>Struktureeritud andmed</strong><small>WebSite + SoftwareApplication</small></span></article>
              <article className={socialImagePath ? 'is-ready' : 'is-warning'}><i>{socialImagePath ? '✓' : '!'}</i><span><strong>Open Graph</strong><small>{socialImagePath ? '1200 × 630 · Supabase Storage · versioonitud URL' : 'Jagamispilt puudub'}</small></span></article>
            </div>
          </section>

          <section className="admin-seo__search-console">
            <div><span>GOOGLE SEARCH CONSOLE</span><h2>Otsingu tulemuslikkus</h2><p>Search Console’i ühendamisel saab siin tulevikus näidata klikke, kuvamisi, positsioone ja enim otsitud märksõnu.</p></div>
            <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Ava Search Console ↗</a>
          </section>
        </div>}

        {activeView === 'overview' && <AdminOverview
          rows={rows}
          usersLoading={isLoading}
          onlineCount={presenceKnown ? onlineUserIds.size : null}
          revenue={revenue}
          revenueError={revenueError}
          revenueLoading={isRevenueLoading}
          liveRevenueEventId={liveRevenueEventId}
          analytics={homepageAnalytics}
          analyticsError={analyticsError}
          analyticsLoading={isAnalyticsLoading}
          range={analyticsRange}
          onRangeChange={(range) => {
            setAnalyticsRange(range)
            void loadHomepageAnalytics(range)
          }}
          onNavigate={navigateToView}
        />}

        {activeView === 'analytics' && <section className="admin-analytics">
          <header className="admin-analytics__header">
            <div><span>AVALEHT → AVALDATUD POOD</span><h2>Konversioon ja külastajate tegevus</h2><p>Anonüümne koondvaade; lehesessioone ei seota kasutajakontodega.</p></div>
            <label><span>Ajavahemik</span><select value={analyticsRange} onChange={(event) => {
              const range = Number(event.target.value) as AnalyticsRange
              setAnalyticsRange(range)
              void loadHomepageAnalytics(range)
            }} disabled={isAnalyticsLoading}>
              <option value={7}>7 päeva</option>
              <option value={30}>30 päeva</option>
              <option value={90}>90 päeva</option>
            </select></label>
          </header>

          {analyticsError ? <div className="admin-analytics__error" role="alert">{analyticsError}</div> : <>
            <div className="admin-analytics__kpis" aria-label="Külastatavuse kokkuvõte">
              <article><span>KÜLASTUSED</span><strong>{homepageAnalytics.sessions}</strong><small>{homepageAnalytics.anonymous_sessions} anonüümset · {homepageAnalytics.merchant_sessions} kaupmehe sessiooni</small></article>
              <article><span>KESKMINE AKTIIVNE AEG</span><strong>{homepageAnalytics.measured_sessions ? formatDuration(homepageAnalytics.average_engaged_seconds) : '—'}</strong><small>{homepageAnalytics.measured_sessions} mõõdetud sessiooni · ainult nähtaval ja fookuses olnud aeg</small></article>
              <article><span>KAASATUD KÜLASTUSED</span><strong>{formatPercent(homepageAnalytics.engaged_sessions, homepageAnalytics.measured_sessions)}</strong><small>{homepageAnalytics.engaged_sessions} / {homepageAnalytics.measured_sessions} mõõdetud sessiooni vähemalt 10 sekundit</small></article>
              <article><span>POE LOOMISE ALGUS</span><strong>{homepageAnalytics.signup_starts}</strong><small>{formatPercent(homepageAnalytics.signup_starts, homepageAnalytics.sessions)} külastustest</small></article>
              <article><span>NÄIDISPOE AVAMISED</span><strong>{homepageAnalytics.demo_opens}</strong><small>{formatPercent(homepageAnalytics.demo_opens, homepageAnalytics.sessions)} külastustest</small></article>
              <article><span>AVALDATUD POED</span><strong>{homepageAnalytics.stores_published}</strong><small>{formatPercent(homepageAnalytics.stores_published, homepageAnalytics.accounts_created)} perioodi uutest kontodest</small></article>
            </div>

            <section className="admin-analytics__funnel">
              <header><div><span>KONVERSIOONILEHTER</span><h3>Külastusest avaldatud poeni</h3></div><small>Konto ja poe sammud kasutavad olemasolevaid adminiandmeid.</small></header>
              <div>
                {analyticsFunnelSteps.map((step, index) => {
                  const previous = analyticsFunnelSteps[index - 1]?.value ?? step.value
                  const width = homepageAnalytics.sessions ? Math.min(100, Math.max(4, step.value / homepageAnalytics.sessions * 100)) : 0
                  return <article key={step.label}>
                    <span><i>{index + 1}</i><span><strong>{step.label}</strong><small>{step.detail}</small></span></span>
                    <div><i style={{ width: `${width}%` }} /></div>
                    <b>{step.value}<small>{index ? formatPercent(step.value, previous) : '100%'}</small></b>
                  </article>
                })}
              </div>
              <p>Lehtri esimesed sammud on anonüümsed sündmused. Konto ja poe sammud näitavad samal ajavahemikul loodud kontode praegust seisu, mitte üksikisiku jälitamist.</p>
            </section>

            <section className="admin-analytics__trend">
              <header><div><span>PÄEVANE TREND</span><h3>Külastused ja aktiveerumine</h3></div><div className="admin-analytics__legend"><span><i className="is-session" />Külastused</span><span><i className="is-start" />Poe loomise algus</span><span><i className="is-account" />Kontod</span></div></header>
              <div className="admin-analytics__chart-scroll">
                <div className="admin-analytics__chart" style={{ minWidth: `${Math.max(32, homepageAnalytics.daily.length * 1.35)}rem` }}>
                  {homepageAnalytics.daily.map((point, index) => <article key={point.date} title={`${formatDate(point.date)}: ${point.sessions} külastust, ${point.signup_starts} alustamist, ${point.accounts_created} kontot`}>
                    <div>
                      <i className="is-session" style={{ height: `${point.sessions / analyticsMaxDailyValue * 100}%` }} />
                      <i className="is-start" style={{ height: `${point.signup_starts / analyticsMaxDailyValue * 100}%` }} />
                      <i className="is-account" style={{ height: `${point.accounts_created / analyticsMaxDailyValue * 100}%` }} />
                    </div>
                    {(index === 0 || index === homepageAnalytics.daily.length - 1 || (homepageAnalytics.daily.length <= 30 && index % 7 === 0)) && <time dateTime={point.date}>{new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short' }).format(new Date(`${point.date}T12:00:00Z`))}</time>}
                  </article>)}
                </div>
              </div>
            </section>

            <div className="admin-analytics__breakdowns">
              <section>
                <header><div><span>LIIKLUSE ALLIKAD</span><h3>Kust külastajad tulid?</h3></div><small>Keskmine aktiivne aeg allika kohta</small></header>
                <div className="admin-analytics__rows">
                  {homepageAnalytics.sources.length ? homepageAnalytics.sources.map((row) => <article key={row.source}><span><strong>{row.source}</strong><i><b style={{ width: `${homepageAnalytics.sessions ? Math.min(100, row.sessions / homepageAnalytics.sessions * 100) : 0}%` }} /></i></span><b>{row.measured_sessions ? formatDuration(row.average_engaged_seconds) : '—'}<small>{row.sessions} sessiooni · {formatPercent(row.engaged_sessions, row.measured_sessions)} kaasatud</small></b></article>) : <p>Allikaid veel pole.</p>}
                </div>
              </section>
              <section>
                <header><div><span>AKTIIVSE AJA JAOTUS</span><h3>Kui kauaks avalehele jäädi?</h3></div></header>
                <div className="admin-analytics__rows">
                  {homepageAnalytics.measured_sessions ? homepageAnalytics.engagement_buckets.map((row) => <article key={row.bucket}><span><strong>{analyticsEngagementBucketLabels[row.bucket]}</strong><i><b style={{ width: `${Math.min(100, row.sessions / homepageAnalytics.measured_sessions * 100)}%` }} /></i></span><b>{row.sessions}<small>{formatPercent(row.sessions, homepageAnalytics.measured_sessions)}</small></b></article>) : <p>Aktiivse aja andmeid veel pole.</p>}
                </div>
              </section>
              <section>
                <header><div><span>CTA-D</span><h3>Mis pani poe loomist alustama?</h3></div></header>
                <div className="admin-analytics__rows">
                  {homepageAnalytics.ctas.length ? homepageAnalytics.ctas.map((row) => <article key={row.label}><span><strong>{analyticsCtaLabels[row.label] ?? row.label}</strong><i><b style={{ width: `${homepageAnalytics.signup_starts ? Math.min(100, row.sessions / homepageAnalytics.signup_starts * 100) : 0}%` }} /></i></span><b>{row.sessions}<small>{formatPercent(row.sessions, homepageAnalytics.signup_starts)}</small></b></article>) : <p>CTA vajutusi veel pole.</p>}
                </div>
              </section>
              <section>
                <header><div><span>SEADMED</span><h3>Kuidas avalehte vaadati?</h3></div></header>
                <div className="admin-analytics__device-grid">
                  {homepageAnalytics.devices.length ? homepageAnalytics.devices.map((row) => <article key={row.device}><strong>{analyticsDeviceLabels[row.device] ?? row.device}</strong><b>{row.sessions}</b><small>{formatPercent(row.sessions, homepageAnalytics.sessions)}</small></article>) : <p>Seadmete andmeid veel pole.</p>}
                </div>
              </section>
              <section>
                <header><div><span>KKK</span><h3>Millised küsimused huvitasid?</h3></div></header>
                <div className="admin-analytics__rows">
                  {homepageAnalytics.faqs.length ? homepageAnalytics.faqs.map((row) => <article key={row.label}><span><strong>{analyticsFaqLabels[row.label] ?? row.label}</strong></span><b>{row.sessions}</b></article>) : <p>KKK avamisi veel pole.</p>}
                </div>
              </section>
            </div>

            <footer className="admin-analytics__privacy">Avalehe sündmused kogunevad alates analüütika kasutuselevõtust; varasemaid külastusi tagasiulatuvalt ei lisata. Aktiivne aeg suureneb ainult siis, kui avaleht on nähtav ja brauseriaknal on fookus, ning ühe sessiooni ülempiir on 30 minutit. Toorandmed kustutatakse 90 päeva järel. Sessioonitunnus tekib juhuslikult lehe avamisel, püsib ainult brauseri mälus ning seda ei seota konto, e-posti ega IP-aadressiga.</footer>
          </>}
        </section>}

        {activeView === 'support' && <AdminSupport onCountsChanged={() => void loadDashboard({ silent: true, refreshAuth: false })} />}

        {activeView === 'leads' && <AdminLeads />}

        {activeView === 'users' && <>
          {signupAlerts.length > 0 && <div className="admin-signup-alert" role="status"><strong>Tavapärasest rohkem registreerumiskatseid</strong><p>{signupAlerts.length} võrgu puhul on viimase tunni jooksul vähemalt viis katset. Vaata uued kontod üle.</p></div>}
          <AdminUsers rows={rows} onlineUserIds={onlineUserIds} onlineViews={onlineViews} presenceKnown={presenceKnown} latestEmails={latestEmails} isLoading={isLoading} metricsError={userMetricsError} onRetry={() => void loadDashboard()} />
        </>}
      </>}
    </section>
  </main>
}
