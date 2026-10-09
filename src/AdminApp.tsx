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
import { adminViewConfig, type AdminView } from './lib/adminNavigation'
import { Storefront } from './App'
import { getShowcaseStore, listProducts, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { getCaptchaRequiredMessage, isCaptchaConfigured, Turnstile } from './Turnstile'
import type { Product } from './products'
import AdminLeads from './AdminLeads'
import AdminSupport from './AdminSupport'
import { applySeoMetadata } from './lib/seo'
import { getHomepageSeoValidationError, seoTextLength } from './lib/homepageSeo'
import AdminUsers from './AdminUsers'
import AdminOverview from './AdminOverview'
import AdminAnalytics from './AdminAnalytics'
import AdminStoryDeck, { type AdminStoryDeckHandle } from './AdminStoryDeck'
import useHomepageVisitFeedback from './useHomepageVisitFeedback'
import useAdminRevenue from './useAdminRevenue'
import useAdminWatch from './useAdminWatch'
import { savedPaymentStatuses } from './lib/adminPaymentStatus'
import AdminWatchScreen from './AdminWatchScreen'
import useAdminPush from './useAdminPush'
import AdminSettings from './AdminSettings'
import { disableAdminPush } from './lib/adminPush'
import type { AnalyticsRange, HomepageAnalyticsDashboard, HomepageEngagementDashboard } from './lib/adminDashboard'
import type { AdminUserRow, LatestEmailDelivery } from './lib/adminUserOverview'

const AdminBusinessCard = lazy(() => import('./AdminBusinessCard'))
const AdminKaubamaja = lazy(() => import('./AdminKaubamaja'))
const AdminCampaigns = lazy(() => import('./AdminCampaigns'))

type SocialPreviewPlatform = 'facebook' | 'linkedin' | 'slack'

const getAdminView = (pathname = window.location.pathname): AdminView => {
  if (/^\/admin\/analytics\/?$/i.test(pathname)) return 'analytics'
  if (/^\/admin\/seo\/?$/i.test(pathname)) return 'seo'
  if (/^\/admin\/leads\/?$/i.test(pathname)) return 'leads'
  if (/^\/admin\/support\/?$/i.test(pathname)) return 'support'
  if (/^\/admin\/users\/?$/i.test(pathname)) return 'users'
  if (/^\/admin\/business-card\/?$/i.test(pathname)) return 'business-card'
  if (/^\/admin\/kaubamaja\/?$/i.test(pathname)) return 'directory'
  if (/^\/admin\/campaigns\/?$/i.test(pathname)) return 'campaigns'
  if (/^\/admin\/settings\/?$/i.test(pathname)) return 'settings'
  return 'overview'
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

type AdminIconName = 'home' | 'analytics' | 'seo' | 'leads' | 'users' | 'store' | 'message' | 'logout' | 'refresh' | 'check' | 'arrow' | 'alert' | 'search' | 'revenue' | 'card' | 'campaigns' | 'settings'

function AdminIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    settings: <><path d="m9.5 3-.6 2.3-2 .9-2.2-.7-2.5 4.3 1.6 1.7v2.3L2.2 15.5l2.5 4.3 2.2-.7 2 .9.6 2.3h5l.6-2.3 2-.9 2.2.7 2.5-4.3-1.6-1.7v-2.3l1.6-1.7-2.5-4.3-2.2.7-2-.9-.6-2.3h-5Z" transform="translate(0 -1)" /><circle cx="12" cy="11.5" r="3" /></>,
    home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5M10 20v-5h4v5" /></>,
    analytics: <><path d="M5 19V11M12 19V5M19 19v-8" /><path d="M3 19h18" /></>,
    seo: <><circle cx="11" cy="11" r="7" /><path d="M4 11h14M11 4a11 11 0 0 1 0 14M11 4a11 11 0 0 0 0 14M16.5 16.5 21 21" /></>,
    leads: <><path d="M4 18.5V14l4-2 3 1.5 4-5 5-2.5" /><path d="m16.5 5.5 3.5.5-.5 3.5" /><circle cx="6" cy="7" r="2.5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.5 2.2-5.3 5.5-5.3s5.1 1.8 5.5 5.3" /><circle cx="17" cy="9" r="2.2" /><path d="M15.5 14.2c3.1-.4 4.8 1.2 5 4" /></>,
    store: <><path d="M4 9h16l-1-4H5L4 9Z"/><path d="M5 9v10h14V9M9 19v-5h6v5"/><path d="M4 9a3 3 0 0 0 5 2 3 3 0 0 0 6 0 3 3 0 0 0 5-2"/></>,
    campaigns: <><path d="m4 10 14-5v14L4 14v-4ZM7 15l1 5h3l-1-4M21 9v6" /></>,
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
        <Turnstile key={`admin-login-${captchaResetKey}`} action="admin_login" onToken={setCaptchaToken} size="responsive" theme="dark" />
        {(error || accessError) && <p className="admin-auth__error" role="alert">{error || accessError}</p>}
        <button type="submit" disabled={isBusy}>{isBusy ? 'Login sisse…' : 'Logi sisse'}<span aria-hidden="true">→</span></button>
      </form>
      <small>Ligipääs on ainult Poeruumi administraatoritele.</small>
    </section>
  </main>
}

export default function AdminApp() {
  const [activeView, setActiveView] = useState<AdminView>(() => getAdminView())
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('poeruum.admin.sidebar-hidden') === 'true' } catch { return false }
  })
  const hideMenuButton = useRef<HTMLButtonElement>(null)
  const showMenuButton = useRef<HTMLButtonElement>(null)
  const setMenuHidden = (hidden: boolean) => {
    setSidebarHidden(hidden)
    try { localStorage.setItem('poeruum.admin.sidebar-hidden', String(hidden)) } catch { /* Keep the control usable when browser storage is unavailable. */ }
    window.requestAnimationFrame(() => (hidden ? showMenuButton : hideMenuButton).current?.focus({ preventScroll: true }))
  }
  const storyDeck = useRef<AdminStoryDeckHandle>(null)
  const navigation = useRef<HTMLElement>(null)
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
  const [watchEnabled, setWatchEnabled] = useState(false)
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [usersStale, setUsersStale] = useState(false)
  const [usersLive, setUsersLive] = useState(false)
  const paymentSnapshotRevision = useRef(0)
  const [error, setError] = useState('')
  const [userMetricsError, setUserMetricsError] = useState('')
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(30)
  const [homepageAnalytics, setHomepageAnalytics] = useState<HomepageAnalyticsDashboard>(emptyHomepageAnalytics)
  const [analyticsError, setAnalyticsError] = useState('')
  const [analyticsStale, setAnalyticsStale] = useState(false)
  const [analyticsLive, setAnalyticsLive] = useState(false)
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true)
  const [analyticsRefreshRevision, setAnalyticsRefreshRevision] = useState(0)
  const loadedAnalyticsRef = useRef<{ userId: string; range: AnalyticsRange } | null>(null)
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
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const previousContent = viewport?.content
    if (viewport) {
      const baseContent = viewport.content
        .split(',')
        .map((part) => part.trim())
        .filter((part) => !/^(maximum-scale|user-scalable)\s*=/i.test(part))
        .join(', ')
      viewport.content = `${baseContent}, maximum-scale=1.0, user-scalable=no`
    }

    // Safari can ignore viewport zoom limits; cancel its native pinch gesture too.
    const preventZoom = (event: Event) => event.preventDefault()
    document.addEventListener('gesturestart', preventZoom, { passive: false })
    document.addEventListener('gesturechange', preventZoom, { passive: false })
    return () => {
      if (viewport && previousContent !== undefined) viewport.content = previousContent
      document.removeEventListener('gesturestart', preventZoom)
      document.removeEventListener('gesturechange', preventZoom)
    }
  }, [])

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

  const changeView = (view: AdminView) => {
    const nextPath = adminViewConfig[view].path
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setActiveView(view)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToView = (event: ReactMouseEvent<HTMLAnchorElement>, view: AdminView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (storyDeck.current) storyDeck.current.navigate(view)
    else changeView(view)
  }

  useEffect(() => {
    const nav = navigation.current
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !selected) return
    const bounds = nav.getBoundingClientRect(), item = selected.getBoundingClientRect()
    if (window.innerWidth <= 680) {
      if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left
      else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right
    } else {
      if (item.top < bounds.top) nav.scrollTop += item.top - bounds.top
      else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom
    }
  }, [activeView, adminAccessGranted])

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
      await disableAdminPush().catch(() => undefined)
      await requireSupabase().auth.signOut({ scope: 'local' })
    } finally {
      window.location.replace('/')
    }
  }

  const watchAvailable = Boolean(session && adminAccessGranted && !isManagingShowcase)
  const { revenue, error: revenueError, loading: isRevenueLoading, stale: revenueStale, live: revenueLive, notice: revenueNotice, refresh: loadRevenue } = useAdminRevenue(
    session && adminAccessGranted ? session.user.id : null, !isManagingShowcase && (activeView === 'overview' || watchEnabled),
  )
  const analyticsViewActive = !isManagingShowcase && (activeView === 'overview' || activeView === 'analytics' || watchEnabled)
  const pushFeedback = useAdminPush(session && adminAccessGranted ? session.user.id : null)
  const visitFeedback = useHomepageVisitFeedback({
    count: homepageAnalytics.sessions,
    accountCount: homepageAnalytics.accounts_created,
    scope: `${session?.user.id}:${analyticsRange}`,
    active: Boolean(session && adminAccessGranted && analyticsViewActive && !isAnalyticsLoading && !analyticsError && homepageAnalytics.range_days === analyticsRange),
  })
  const watch = useAdminWatch({
    enabled: watchEnabled && watchAvailable,
    onDisable: () => setWatchEnabled(false),
    initialScene: activeView === 'users' ? 'users' : activeView === 'overview' ? 'income' : 'analytics',
    scope: session?.user.id ?? '',
    rows, usersReady: usersLoaded && !usersStale && usersLive && !error,
    analytics: homepageAnalytics, analyticsReady: !isAnalyticsLoading && !analyticsError && !analyticsStale && analyticsLive,
    revenue, revenueNotice, revenueReady: !isRevenueLoading && !revenueError && !revenueStale && revenueLive,
  })

  useEffect(() => {
    if (!session || !adminAccessGranted || !analyticsViewActive) return
    let active = true
    let inFlight = false
    let queued = false
    let refreshTimer: number | undefined
    const controller = new AbortController()
    const client = requireSupabase()
    const range = analyticsRange
    let hasData = loadedAnalyticsRef.current?.userId === session.user.id && loadedAnalyticsRef.current.range === range
    setIsAnalyticsLoading(!hasData)
    setAnalyticsLive(false)
    setAnalyticsStale(false)
    if (!hasData) setAnalyticsError('')

    const refresh = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return
      if (!navigator.onLine) {
        setAnalyticsLive(false)
        setAnalyticsStale(true)
        setIsAnalyticsLoading(false)
        if (!hasData) setAnalyticsError('Külastatavuse laadimiseks on vaja võrguühendust.')
        return
      }
      inFlight = true
      try {
        const [analyticsResponse, engagementResponse] = await Promise.all([
          client.rpc('admin_homepage_analytics', { requested_days: range }).abortSignal(controller.signal),
          client.rpc('admin_homepage_engagement', { requested_days: range }).abortSignal(controller.signal),
        ])
        if (!active) return
        if (analyticsResponse.error || engagementResponse.error) throw analyticsResponse.error || engagementResponse.error
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
        loadedAnalyticsRef.current = { userId: session.user.id, range }
        hasData = true
        setAnalyticsError('')
        setAnalyticsStale(false)
      } catch {
        // Keep the last successful chart during a temporary background failure.
        if (active && !hasData) setAnalyticsError('Külastatavuse andmeid ei õnnestunud laadida. Proovime peagi uuesti.')
        if (active) setAnalyticsStale(true)
      } finally {
        inFlight = false
        if (active) setIsAnalyticsLoading(false)
        if (active && queued) { queued = false; schedule() }
      }
    }

    const schedule = () => {
      if (refreshTimer !== undefined) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        if (inFlight) queued = true
        else void refresh()
      }, 150)
    }
    const channel = client.channel(`admin-homepage-${session.user.id}-${range}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'admin_homepage_refresh' }, schedule)
      .subscribe((status) => {
        if (!active) return
        setAnalyticsLive(status === 'SUBSCRIBED')
        setAnalyticsStale(true)
        // Catch anything committed before the subscription was acknowledged.
        if (status === 'SUBSCRIBED') schedule()
      })
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 15_000)
    const refreshVisible = () => { void refresh() }
    const onVisibility = () => { setAnalyticsStale(true); void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', refreshVisible)
    const onOffline = () => { setAnalyticsLive(false); setAnalyticsStale(true) }
    window.addEventListener('offline', onOffline)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
      window.clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('online', refreshVisible)
      window.removeEventListener('offline', onOffline)
      void client.removeChannel(channel)
    }
  }, [session?.user.id, adminAccessGranted, analyticsViewActive, analyticsRange, analyticsRefreshRevision])

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
  }: {
    silent?: boolean
    refreshAuth?: boolean
  } = {}) => {
    const snapshotRevision = ++paymentSnapshotRevision.current
    if (!silent) setIsLoading(true)
    setError('')
    // Refresh the JWT so a newly assigned server-side admin role is available
    // without requiring the user to manually clear their existing session.
    if (refreshAuth) await requireSupabase().auth.refreshSession()
    void loadRevenue()
    void loadLatestEmails()
    void loadSignupAlerts()
    if (!silent) void loadHomepageSettings()
    const [usersResponse, metricsResponse] = await Promise.all([
      requireSupabase().rpc('admin_dashboard_users'),
      requireSupabase().rpc('admin_user_overview'),
    ])
    const { data, error: queryError } = usersResponse
    const metrics = new Map<string, Partial<AdminUserRow>>((Array.isArray(metricsResponse.data) ? metricsResponse.data : []).map((row: AdminUserRow) => [row.user_id, row]))
    setUserMetricsError(metricsResponse.error || (data ?? []).some((row: AdminUserRow) => metrics.get(row.user_id)?.metrics_version !== 1) ? 'unavailable' : '')
    if (queryError) {
      setUsersStale(true)
      const forbidden = queryError.code === '42501' || queryError.message.toLowerCase().includes('admin access')
      setError(forbidden
        ? 'Sellel kontol puudub administraatori ligipääs.'
        : 'Admini andmeid ei õnnestunud laadida. Kontrolli, et uus Supabase’i migratsioon on rakendatud.')
      setRows([])
    } else {
      setUsersLoaded(true)
      setUsersStale(false)
      setRows((current) => {
        const previous = new Map(current.map((row) => [row.user_id, row]))
        return ((data ?? []) as AdminUserRow[]).map((row) => {
          const old = previous.get(row.user_id)
          const overview = metrics.get(row.user_id)
          // Retain the last diagnosis while its replacement loads. A newer check
          // timestamp alone must not replace a known reason with a placeholder.
          const retainPayment = old?.store_id === row.store_id && row.payment_status !== 'idle'
            && overview?.payment_state !== 'not_connected'
          return {
            ...row,
            ...overview,
            payment_diagnostics: retainPayment ? old?.payment_diagnostics : undefined,
            product_count: Number(row.product_count),
            order_count: Number(row.order_count),
            gross_sales: Number(row.gross_sales),
            open_support_count: Number(row.open_support_count ?? 0),
          }
        })
      })
      const userIds = ((data ?? []) as AdminUserRow[]).filter((row) => row.store_id).map((row) => row.user_id)
      if (userIds.length) void savedPaymentStatuses(userIds).then((diagnostics) => {
        if (snapshotRevision !== paymentSnapshotRevision.current) return
        const byUser = new Map(diagnostics.map((item) => [item.userId, item]))
        setRows((current) => current.map((row) => {
          const diagnostic = byUser.get(row.user_id)
          return diagnostic?.storeId === row.store_id ? { ...row, payment_diagnostics: diagnostic } : row
        }))
      }).catch(() => { /* Row details offer a fresh Stripe lookup and an explicit retry. */ })
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
      setWatchEnabled(false)
      setUsersLoaded(false)
      setAdminAccessGranted(false)
      setRows([])
      setHomepageAnalytics(emptyHomepageAnalytics)
      loadedAnalyticsRef.current = null
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
    const channel = client.channel(`admin-dashboard-${session.user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'admin_dashboard_refresh', filter: 'id=eq.true' }, () => {
        if (dashboardRefreshTimerRef.current !== null) window.clearTimeout(dashboardRefreshTimerRef.current)
        dashboardRefreshTimerRef.current = window.setTimeout(() => {
          dashboardRefreshTimerRef.current = null
          void loadDashboard({ silent: true, refreshAuth: false })
        }, 350)
      })
      .subscribe((status) => {
        setUsersLive(status === 'SUBSCRIBED')
        setUsersStale(true)
        if (status === 'SUBSCRIBED') void loadDashboard({ silent: true, refreshAuth: false })
      })
    // Recover missed realtime events and keep the rolling 30-day window current.
    const refreshVisibleDashboard = () => {
      if (document.visibilityState === 'visible') void loadDashboard({ silent: true, refreshAuth: false })
    }
    const onVisibility = () => { setUsersStale(true); refreshVisibleDashboard() }
    const refreshInterval = window.setInterval(refreshVisibleDashboard, 60_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', onVisibility)
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

  return <main className={`admin-shell${activeView === 'users' ? ' admin-shell--users' : ''}${watch.active ? ' is-watching' : ''}${sidebarHidden ? ' is-menu-hidden' : ''}`}>
    {sidebarHidden && <button ref={showMenuButton} className="admin-sidebar-toggle admin-sidebar-toggle--restore" type="button" hidden={watch.active} aria-label="Näita menüüd" title="Näita menüüd" aria-expanded={false} aria-controls="admin-sidebar" onClick={() => setMenuHidden(false)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m5-11 3 3-3 3" /></svg>
    </button>}
    <aside id="admin-sidebar" className="admin-sidebar" hidden={sidebarHidden} inert={watch.active || sidebarHidden} aria-hidden={watch.active || sidebarHidden || undefined}>
      <div className="admin-sidebar__brand"><a href="/" aria-label="Poeruumi avaleht"><Brand /></a><button ref={hideMenuButton} className="admin-sidebar-toggle" type="button" aria-label="Peida menüü" title="Peida menüü" aria-expanded={true} aria-controls="admin-sidebar" onClick={() => setMenuHidden(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m7-11-3 3 3 3" /></svg>
      </button></div>
      <button className="admin-watch-toggle" type="button" aria-label="Vaatlusrežiim" aria-pressed={watchEnabled} title={watchEnabled ? 'Lülita vaatlusrežiim välja' : 'Vaatlusrežiim · käivitub pärast 3 sekundit pausi'} onClick={() => setWatchEnabled((current) => !current)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4M10 8l5 3-5 3V8Z"/></svg><span>Vaatlusrežiim</span>{watchEnabled && <i />}
      </button>
      <nav ref={navigation} aria-label="Administraatori menüü">
        <a className={activeView === 'overview' ? 'is-active' : undefined} href="/admin" aria-current={activeView === 'overview' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'overview')}><span><AdminIcon name="home" /></span>Ülevaade</a>
        <a className={activeView === 'analytics' ? 'is-active' : undefined} href="/admin/analytics" aria-current={activeView === 'analytics' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'analytics')}><span><AdminIcon name="analytics" /></span>Külastatavus</a>
        <a className={activeView === 'users' ? 'is-active' : undefined} href="/admin/users" aria-current={activeView === 'users' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'users')}><span><AdminIcon name="users" /></span>Kasutajad</a>
        <a className={activeView === 'campaigns' ? 'is-active' : undefined} href="/admin/campaigns" aria-current={activeView === 'campaigns' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'campaigns')}><span><AdminIcon name="campaigns" /></span>Kampaaniad</a>
        <a className={activeView === 'seo' ? 'is-active' : undefined} href="/admin/seo" aria-current={activeView === 'seo' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'seo')}><span><AdminIcon name="seo" /></span>SEO</a>
        <a className={activeView === 'business-card' ? 'is-active' : undefined} href="/admin/business-card" aria-current={activeView === 'business-card' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'business-card')}><span><AdminIcon name="card" /></span>Visiitkaart</a>
        <a className={activeView === 'leads' ? 'is-active' : undefined} href="/admin/leads" aria-current={activeView === 'leads' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'leads')}><span><AdminIcon name="leads" /></span>Kliendiotsing</a>
        <button type="button" onClick={() => void openShowcaseManager()}><span><AdminIcon name="store" /></span>Näidispood</button>
        <a className={activeView === 'support' ? 'is-active' : undefined} href="/admin/support" aria-current={activeView === 'support' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'support')}><span><AdminIcon name="message" /></span>Klienditugi</a>
        <a className={activeView === 'directory' ? 'is-active' : undefined} href="/admin/kaubamaja" aria-current={activeView === 'directory' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'directory')}><span><AdminIcon name="store" /></span>Kaubamaja</a>
        <a href="http://127.0.0.1:4185/previews/payments.html" target="_blank" rel="noopener noreferrer" aria-label="Maksete eelvaade (kohalik server, avaneb uuel vahelehel)" title="Kohalik eelvaade · käivita npm run dev"><span><AdminIcon name="arrow" /></span>Maksete eelvaade</a>
      </nav>
      <div className="admin-sidebar__account"><span>{session.user.email?.charAt(0).toUpperCase()}</span><div><strong>Administraator</strong><small>{session.user.email}</small></div><a className="admin-sidebar__settings" href="/admin/settings" aria-label="Seaded" title="Seaded" aria-current={activeView === 'settings' ? 'page' : undefined} onClick={(event) => navigateToView(event, 'settings')}><AdminIcon name="settings" /></a><button type="button" onClick={() => void logOut()} aria-label="Logi välja"><AdminIcon name="logout" /></button></div>
    </aside>

    <section inert={watch.active} aria-hidden={watch.active || undefined} className={`admin-main${activeView === 'business-card' ? ' admin-main--business-card' : activeView === 'overview' ? ' admin-main--overview' : activeView === 'analytics' ? ' admin-main--analytics' : ''}`}>
      <AdminStoryDeck ref={storyDeck} view={activeView} onNavigate={changeView} renderView={(view) => <>
      {view !== 'users' && view !== 'overview' && view !== 'analytics' && view !== 'campaigns' && <header className="admin-topbar"><div><h1>{adminViewConfig[view].title}</h1></div>{view !== 'leads' && view !== 'business-card' && view !== 'directory' && view !== 'settings' && <button type="button" onClick={() => { setAnalyticsRefreshRevision((value) => value + 1); void loadDashboard() }} disabled={isLoading}><span className={isLoading ? 'is-spinning' : ''}><AdminIcon name="refresh" /></span>{isLoading ? 'Uuendan…' : 'Uuenda andmeid'}</button>}</header>}

      {view === 'business-card' && <Suspense fallback={<div className="admin-table__empty" role="status">Laadin visiitkaarti…</div>}><AdminBusinessCard key={session.user.id} userId={session.user.id} /></Suspense>}

      {view === 'campaigns' && <Suspense fallback={<div className="admin-table__empty" role="status">Laadin kampaaniate loojat…</div>}><AdminCampaigns key={session.user.id} userId={session.user.id} /></Suspense>}

      {view === 'settings' && <AdminSettings push={pushFeedback} />}

      {error && view !== 'settings' && view !== 'business-card' && view !== 'campaigns' && <div className="admin-alert" role="alert"><span>!</span><div><strong>Ligipääs puudub</strong><p>{error}</p></div></div>}

      {!error && <>
        {view === 'directory' && <Suspense fallback={<div className="admin-table__empty" role="status">Laadin Kaubamaja…</div>}><AdminKaubamaja /></Suspense>}
        {view === 'seo' && <div className="admin-seo">
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

        {view === 'overview' && <AdminOverview
          rows={rows}
          usersLoading={isLoading}
          revenue={revenue}
          revenueError={revenueError}
          revenueLoading={isRevenueLoading}
          revenueNotice={revenueNotice}
          analytics={homepageAnalytics}
          analyticsError={analyticsError}
          analyticsLoading={isAnalyticsLoading}
          visitFeedback={visitFeedback}
          range={analyticsRange}
          onRangeChange={setAnalyticsRange}
          onNavigate={navigateToView}
        />}

        {view === 'analytics' && <AdminAnalytics data={homepageAnalytics} range={analyticsRange} active={activeView === 'analytics'}
            loading={isAnalyticsLoading} error={analyticsError} stale={analyticsStale} live={analyticsLive}
            feedback={visitFeedback} onRangeChange={setAnalyticsRange}
            onRefresh={() => setAnalyticsRefreshRevision((value) => value + 1)} />}
        {view === 'users' && <>
            {signupAlerts.length > 0 && <div className="admin-signup-alert" role="status"><strong>Tavapärasest rohkem registreerumiskatseid</strong><p>{signupAlerts.length} võrgu puhul on viimase tunni jooksul vähemalt viis katset. Vaata uued kontod üle.</p></div>}
            <AdminUsers rows={rows} onlineUserIds={onlineUserIds} onlineViews={onlineViews} presenceKnown={presenceKnown} latestEmails={latestEmails} isLoading={isLoading} metricsError={userMetricsError} onRetry={() => void loadDashboard()} onSupportChanged={() => void loadDashboard({ silent: true, refreshAuth: false })} />
        </>}

        {view === 'support' && <AdminSupport onCountsChanged={() => void loadDashboard({ silent: true, refreshAuth: false })} />}

        {view === 'leads' && <AdminLeads />}
      </>}
      </>} />
    </section>
    {watch.active && <AdminWatchScreen scene={watch.scene} event={watch.event} sequence={watch.key}
      live={analyticsLive && revenueLive && usersLive && !analyticsStale && !revenueStale && !usersStale && !error}
      loading={isAnalyticsLoading || isRevenueLoading || !usersLoaded}
      analytics={homepageAnalytics} analyticsKnown={!isAnalyticsLoading && !analyticsError}
      revenue={revenue} revenueKnown={!isRevenueLoading && !revenueError}
      userCount={usersLoaded && !error ? rows.length : null}
      rows={rows} onlineUserIds={onlineUserIds} presenceKnown={presenceKnown}
      onDisable={() => setWatchEnabled(false)}
    />}
  </main>
}
