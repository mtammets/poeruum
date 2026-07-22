import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Brand } from './DemoApp'
import { Storefront } from './App'
import { getDemoStore, listProducts, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import type { Product } from './products'

type AdminUserRow = {
  user_id: string
  email: string
  user_created_at: string
  last_sign_in_at: string | null
  store_id: string | null
  store_name: string | null
  store_slug: string | null
  store_created_at: string | null
  is_published: boolean
  payment_status: 'idle' | 'pending' | 'connected'
  pricing_plan: 'flexible' | 'fixed'
  product_count: number
  order_count: number
  gross_sales: number
  last_activity_at: string | null
  has_store_details: boolean
  has_payments: boolean
  has_delivery: boolean
  has_product: boolean
  has_business_details: boolean
  has_published: boolean
}

type SetupStep = {
  key: keyof Pick<AdminUserRow, 'has_store_details' | 'has_payments' | 'has_delivery' | 'has_product' | 'has_business_details' | 'has_published'>
  label: string
  nextLabel: string
}

type UserFilter = 'all' | 'incomplete' | 'payments' | 'unpublished' | 'complete'
type UserSort = 'attention' | 'newest' | 'oldest' | 'active' | 'progress'

type RevenueEvent = {
  id: string
  kind: 'subscription' | 'transaction_fee' | 'transaction_fee_refund'
  amount_cents: number
  currency: string
  description: string
  occurred_at: string
  store_id: string | null
  store_name: string
}

type RevenueDashboard = {
  month_total_cents: number
  today_total_cents: number
  subscription_total_cents: number
  transaction_fee_total_cents: number
  refund_total_cents: number
  recent_events: RevenueEvent[]
}

const emptyRevenueDashboard: RevenueDashboard = {
  month_total_cents: 0,
  today_total_cents: 0,
  subscription_total_cents: 0,
  transaction_fee_total_cents: 0,
  refund_total_cents: 0,
  recent_events: [],
}

const setupSteps: SetupStep[] = [
  { key: 'has_store_details', label: 'Poe põhiandmed', nextLabel: 'poe põhiandmete lisamine' },
  { key: 'has_payments', label: 'Maksed ühendatud', nextLabel: 'maksete ühendamine' },
  { key: 'has_delivery', label: 'Tarneviis valitud', nextLabel: 'tarneviisi valimine' },
  { key: 'has_product', label: 'Esimene toode lisatud', nextLabel: 'esimese toote lisamine' },
  { key: 'has_business_details', label: 'Müüja andmed', nextLabel: 'müüja andmete lisamine' },
  { key: 'has_published', label: 'Pood avalikustatud', nextLabel: 'poe avalikustamine' },
]

const filters: Array<{ id: UserFilter; label: string }> = [
  { id: 'all', label: 'Kõik' },
  { id: 'incomplete', label: 'Pooleli' },
  { id: 'payments', label: 'Maksed puudu' },
  { id: 'unpublished', label: 'Avaldamata' },
  { id: 'complete', label: 'Valmis' },
]

const sortOptions: Array<{ id: UserSort; label: string }> = [
  { id: 'attention', label: 'Vajavad tähelepanu' },
  { id: 'newest', label: 'Uuemad ees' },
  { id: 'oldest', label: 'Vanemad ees' },
  { id: 'active', label: 'Hiljuti aktiivsed' },
  { id: 'progress', label: 'Valmimad ees' },
]

const setupCount = (row: AdminUserRow) => setupSteps.filter((step) => row[step.key]).length
const setupPercent = (row: AdminUserRow) => Math.round(setupCount(row) / setupSteps.length * 100)

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
  : '—'

const formatMoney = (cents: number, currency = 'eur') => new Intl.NumberFormat('et-EE', {
  style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2,
}).format(cents / 100)

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

const getNextStep = (row: AdminUserRow) => setupSteps.find((step) => !row[step.key])?.nextLabel ?? 'pood on valmis'

const isStalled = (row: AdminUserRow) => {
  if (setupPercent(row) === 100) return false
  const lastActivity = row.last_activity_at ?? row.user_created_at
  return Date.now() - new Date(lastActivity).getTime() > 7 * 86_400_000
}

type AdminIconName = 'home' | 'users' | 'store' | 'logout' | 'refresh' | 'check' | 'arrow' | 'alert' | 'search' | 'revenue'

function AdminIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5M10 20v-5h4v5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.5 2.2-5.3 5.5-5.3s5.1 1.8 5.5 5.3" /><circle cx="17" cy="9" r="2.2" /><path d="M15.5 14.2c3.1-.4 4.8 1.2 5 4" /></>,
    store: <><path d="M4 9h16l-1-4H5L4 9Z"/><path d="M5 9v10h14V9M9 19v-5h6v5"/><path d="M4 9a3 3 0 0 0 5 2 3 3 0 0 0 6 0 3 3 0 0 0 5-2"/></>,
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

function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsBusy(true)
    const { error: authError } = await requireSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (authError) setError('E-posti aadress või parool ei ole õige.')
    else onSignedIn()
    setIsBusy(false)
  }

  return <main className="admin-auth">
    <a className="admin-auth__brand" href="/"><Brand /></a>
    <section className="admin-auth__card">
      <span>POERUUMI HALDUS</span>
      <h1>Administraatori töölaud</h1>
      <p>Logi sisse administraatori õigustega kontoga.</p>
      <form onSubmit={signIn}>
        <label>E-post<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
        <label>Parool<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="admin-auth__error" role="alert">{error}</p>}
        <button type="submit" disabled={isBusy}>{isBusy ? 'Login sisse…' : 'Logi sisse'}<span aria-hidden="true">→</span></button>
      </form>
      <small>Ligipääs on ainult Poeruumi administraatoritele.</small>
    </section>
  </main>
}

function ProgressBar({ row }: { row: AdminUserRow }) {
  const completed = setupCount(row)
  const percent = setupPercent(row)
  const progressState = percent === 100
    ? 'is-complete'
    : percent === 0
      ? 'is-not-started'
      : percent <= 33
        ? 'is-early'
        : percent <= 66
          ? 'is-midway'
          : 'is-nearly-complete'
  return <div className={`admin-progress ${progressState}`}>
    <div className="admin-progress__meta"><strong>{percent}%</strong><span>{completed} tehtud · {setupSteps.length - completed} teha</span></div>
    <div className="admin-progress__track" role="progressbar" aria-label="Poe seadistuse edenemine" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${completed} sammu ${setupSteps.length}-st tehtud`}>
      <span style={{ width: `${percent}%` }} />
    </div>
    <small>{percent === 100 ? 'Kõik sammud tehtud' : `Järgmine samm: ${getNextStep(row)}`}</small>
  </div>
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [sort, setSort] = useState<UserSort>('newest')
  const [search, setSearch] = useState('')
  const [revenue, setRevenue] = useState<RevenueDashboard>(emptyRevenueDashboard)
  const [revenueError, setRevenueError] = useState('')
  const [liveRevenueEventId, setLiveRevenueEventId] = useState<string | null>(null)
  const [demoStore, setDemoStore] = useState<StoreRecord | null>(null)
  const [demoProducts, setDemoProducts] = useState<Product[]>([])
  const [isDemoLoading, setIsDemoLoading] = useState(false)
  const [, setDemoError] = useState('')
  const [isManagingDemo, setIsManagingDemo] = useState(false)
  const dashboardRefreshTimerRef = useRef<number | null>(null)

  const openDemoManager = async () => {
    setIsDemoLoading(true)
    setDemoError('')
    try {
      const found = await getDemoStore()
      if (!found) throw new Error('Näidispoodi ei leitud. Rakenda esmalt näidispoe migratsioon.')
      const products = await listProducts(found.id)
      setDemoStore(found)
      setDemoProducts(products)
      setIsManagingDemo(true)
    } catch (loadError) {
      setDemoError(loadError instanceof Error ? loadError.message : 'Näidispoodi ei õnnestunud avada.')
    } finally {
      setIsDemoLoading(false)
    }
  }

  const loadRevenue = async () => {
    const { data, error: queryError } = await requireSupabase().rpc('admin_revenue_dashboard')
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

  const loadOnlineUsers = async () => {
    const { data, error: queryError } = await requireSupabase().rpc('admin_online_users')
    if (queryError) return
    setOnlineUserIds(new Set((data ?? []).map((row: { user_id: string }) => row.user_id)))
  }

  const loadDashboard = async ({ silent = false, refreshAuth = true }: { silent?: boolean; refreshAuth?: boolean } = {}) => {
    if (!silent) setIsLoading(true)
    setError('')
    // Refresh the JWT so a newly assigned server-side admin role is available
    // without requiring the user to manually clear their existing session.
    if (refreshAuth) await requireSupabase().auth.refreshSession()
    void loadRevenue()
    const { data, error: queryError } = await requireSupabase().rpc('admin_dashboard_users')
    if (queryError) {
      const forbidden = queryError.code === '42501' || queryError.message.toLowerCase().includes('admin access')
      setError(forbidden
        ? 'Sellel kontol puudub administraatori ligipääs.'
        : 'Admini andmeid ei õnnestunud laadida. Kontrolli, et uus Supabase’i migratsioon on rakendatud.')
      setRows([])
    } else {
      setRows(((data ?? []) as AdminUserRow[]).map((row) => ({
        ...row,
        product_count: Number(row.product_count),
        order_count: Number(row.order_count),
        gross_sales: Number(row.gross_sales),
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
    if (session) void loadDashboard()
    else { setRows([]); setRevenue(emptyRevenueDashboard); setOnlineUserIds(new Set()) }
  }, [session?.user.id])

  useEffect(() => {
    if (!session) return
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
  }, [session?.user.id])

  useEffect(() => {
    if (!session) return
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
  }, [session?.user.id])

  useEffect(() => {
    if (!session) return
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
    return () => {
      if (dashboardRefreshTimerRef.current !== null) window.clearTimeout(dashboardRefreshTimerRef.current)
      dashboardRefreshTimerRef.current = null
      void client.removeChannel(channel)
    }
  }, [session?.user.id])

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('et')
    return rows
      .filter((row) => {
        const percent = setupPercent(row)
        if (filter === 'incomplete' && (percent === 0 || percent === 100)) return false
        if (filter === 'payments' && row.has_payments) return false
        if (filter === 'unpublished' && (row.has_published || percent === 0)) return false
        if (filter === 'complete' && percent !== 100) return false
        return !normalizedSearch || `${row.store_name ?? ''} ${row.email} ${row.store_slug ?? ''}`.toLocaleLowerCase('et').includes(normalizedSearch)
      })
      .sort((left, right) => {
        const newestFirst = new Date(right.user_created_at).getTime() - new Date(left.user_created_at).getTime()
        if (sort === 'newest') return newestFirst
        if (sort === 'oldest') return -newestFirst
        const onlineDifference = Number(onlineUserIds.has(right.user_id)) - Number(onlineUserIds.has(left.user_id))
        const recentActivityFirst = new Date(right.last_activity_at ?? right.user_created_at).getTime()
          - new Date(left.last_activity_at ?? left.user_created_at).getTime()
        if (sort === 'active') return onlineDifference || recentActivityFirst || newestFirst
        if (sort === 'progress') return setupPercent(right) - setupPercent(left) || recentActivityFirst
        return setupPercent(left) - setupPercent(right) || newestFirst
      })
  }, [rows, filter, search, sort, onlineUserIds])

  if (!authReady) return <main className="admin-loading"><span /><p>Avan administraatori töölauda…</p></main>
  if (!isSupabaseConfigured) return <main className="admin-auth"><section className="admin-auth__card"><span>SEADISTUS PUUDUB</span><h1>Supabase pole ühendatud</h1><p>Lisa lokaalsesse <code>.env</code> faili Supabase’i võtmed ja laadi leht uuesti.</p><a href="/">Tagasi Poeruumi</a></section></main>
  if (!session) return <AdminLogin onSignedIn={() => void loadDashboard()} />

  if (isManagingDemo && demoStore) return <Storefront
    key={`admin-demo-${demoStore.id}`}
    storeId={demoStore.id}
    initialSettings={demoStore.settings}
    seedProducts={demoProducts}
    storeName={demoStore.name}
    storeSlug={demoStore.slug}
    paymentProvider={demoStore.payment_provider}
    paymentsReady={false}
    initialShipping={demoStore.shipping}
    pricingPlan={demoStore.pricing_plan}
    merchantMode
    adminDemoMode
    onStoreChange={setDemoStore}
    onExit={() => setIsManagingDemo(false)}
  />

  const completedCount = rows.filter((row) => setupPercent(row) === 100).length
  const paymentMissingCount = rows.filter((row) => row.store_id && !row.has_payments).length
  const unpublishedCount = rows.filter((row) => setupPercent(row) > 0 && !row.has_published).length
  const stalledCount = rows.filter(isStalled).length

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <nav aria-label="Administraatori menüü">
        <a className="is-active" href="/admin" aria-current="page"><span><AdminIcon name="home" /></span>Ülevaade</a>
        <button type="button" onClick={() => void openDemoManager()}><span><AdminIcon name="store" /></span>Näidispood</button>
        <a href="#kasutajad"><span><AdminIcon name="users" /></span>Kasutajad</a>
      </nav>
      <div className="admin-sidebar__account"><span>{session.user.email?.charAt(0).toUpperCase()}</span><div><strong>Administraator</strong><small>{session.user.email}</small></div><button type="button" onClick={() => void requireSupabase().auth.signOut()} aria-label="Logi välja"><AdminIcon name="logout" /></button></div>
    </aside>

    <section className="admin-main">
      <header className="admin-topbar"><div><h1>Ülevaade</h1></div><button type="button" onClick={() => void loadDashboard()} disabled={isLoading}><span className={isLoading ? 'is-spinning' : ''}><AdminIcon name="refresh" /></span>{isLoading ? 'Uuendan…' : 'Uuenda andmeid'}</button></header>

      {error && <div className="admin-alert" role="alert"><span>!</span><div><strong>Ligipääs puudub</strong><p>{error}</p></div></div>}

      {!error && <>
        <section className={`admin-revenue${liveRevenueEventId ? ' is-live-update' : ''}`} aria-label="Poeruumi tulu">
          <div className="admin-revenue__summary">
            <header><span><AdminIcon name="revenue" /></span><div><small>SELLE KUU TEENUSTASUD</small><strong>{formatMoney(revenue.month_total_cents)}</strong></div><b><i /> REAALAJAS</b></header>
            <div className="admin-revenue__today"><span>Täna</span><strong>{formatMoney(revenue.today_total_cents)}</strong></div>
            <dl>
              <div><dt>Kuutasud</dt><dd>{formatMoney(revenue.subscription_total_cents)}</dd></div>
              <div><dt>4% müügitasud</dt><dd>{formatMoney(revenue.transaction_fee_total_cents)}</dd></div>
              <div><dt>Tagastused</dt><dd>{formatMoney(revenue.refund_total_cents)}</dd></div>
            </dl>
          </div>
          <div className="admin-revenue__activity">
            <header><div><strong>Viimased laekumised</strong><small>Enne Stripe’i maksetöötluse tasusid</small></div>{liveRevenueEventId && <span>Uus laekumine</span>}</header>
            {revenueError ? <p className="admin-revenue__empty is-error">{revenueError}</p> : revenue.recent_events.length ? <div className="admin-revenue__events">
              {revenue.recent_events.slice(0, 4).map((event) => <article className={event.id === liveRevenueEventId ? 'is-new' : ''} key={event.id}>
                <i className={event.amount_cents < 0 ? 'is-refund' : event.kind === 'subscription' ? 'is-subscription' : ''}>{event.amount_cents < 0 ? '↩' : event.kind === 'subscription' ? 'K' : '%'}</i>
                <span><strong>{event.description}</strong><small>{event.store_name} · {formatRelativeTime(event.occurred_at)}</small></span>
                <b>{event.amount_cents > 0 ? '+' : ''}{formatMoney(event.amount_cents, event.currency)}</b>
              </article>)}
            </div> : <p className="admin-revenue__empty">Esimene kinnitatud kuutasu või müügitasu ilmub siia automaatselt.</p>}
          </div>
        </section>

        <section className="admin-kpis" aria-label="Kokkuvõte">
          <article><span>KÕIK KASUTAJAD</span><strong>{rows.length}</strong><small>Poeruumi kontot</small><i className="is-neutral"><AdminIcon name="users" /></i></article>
          <article><span>VALMIS POED</span><strong>{completedCount}</strong><small>{rows.length ? `${Math.round(completedCount / rows.length * 100)}% kasutajatest` : 'Andmed puuduvad'}</small><i className="is-positive"><AdminIcon name="check" /></i></article>
          <article><span>MAKSED PUUDU</span><strong>{paymentMissingCount}</strong><small>vajavad ühendamist</small><i className="is-warning"><AdminIcon name="arrow" /></i></article>
          <article><span>VAJAVAD TÄHELEPANU</span><strong>{stalledCount}</strong><small>üle 7 päeva muutuseta</small><i className="is-danger"><AdminIcon name="alert" /></i></article>
        </section>

        <section className="admin-users" id="kasutajad">
          <header><div><h2>Seadistuse edenemine</h2></div><div className="admin-users__controls"><label className="admin-sort"><span>Järjesta</span><select value={sort} onChange={(event) => setSort(event.target.value as UserSort)} aria-label="Järjesta kasutajad">{sortOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label className="admin-search"><span><AdminIcon name="search" /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Otsi poodi või e-posti" aria-label="Otsi kasutajaid" /></label></div></header>
          <div className="admin-filters" role="group" aria-label="Filtreeri kasutajaid">
            {filters.map((item) => <button type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
          </div>
          <div className="admin-table">
            <div className="admin-table__head"><span>Kasutaja</span><span>Liitus</span><span>Seadistus</span><span>Staatus</span><span>Viimane tegevus</span></div>
            {isLoading && !rows.length ? <div className="admin-table__empty"><span className="admin-table__loader" /><strong>Laadin kasutajaid…</strong></div> : visibleRows.length ? visibleRows.map((row) => {
              const percent = setupPercent(row)
              const isOnline = onlineUserIds.has(row.user_id)
              const status = percent === 100 ? 'Valmis' : percent === 0 ? 'Alustamata' : isStalled(row) ? 'Vajab tähelepanu' : null
              const statusClass = percent === 100 ? 'complete' : percent === 0 ? 'empty' : 'stalled'
              return <article className={`admin-user-row${percent === 100 ? ' is-complete' : ''}`} key={row.user_id}>
                <div className="admin-user-row__identity"><span className={isOnline ? 'is-online' : undefined}>{(row.store_name ?? row.email).charAt(0).toLocaleUpperCase('et')}</span><div><strong>{row.store_name || 'Poodi pole loodud'}</strong><a href={`mailto:${row.email}`}>{row.email}</a></div></div>
                <time dateTime={row.user_created_at}>{formatDate(row.user_created_at)}</time>
                <ProgressBar row={row} />
                <div>{status && <span className={`admin-status is-${statusClass}`}>{percent === 100 ? <AdminIcon name="check" /> : <i />}{status}</span>}{row.store_id && <small>{row.pricing_plan === 'fixed' ? 'Kindel pakett' : 'Paindlik pakett'}</small>}</div>
                <div className="admin-user-row__activity"><strong className={isOnline ? 'is-online' : undefined}>{isOnline ? 'Online' : formatRelativeTime(row.last_activity_at)}</strong><small>{row.order_count ? `${row.order_count} tellimust` : row.product_count ? `${row.product_count} toodet` : 'Tellimusi pole'}</small></div>
              </article>
            }) : <div className="admin-table__empty"><span>⌕</span><strong>Kasutajaid ei leitud</strong><p>Muuda otsingut või vali teine filter.</p></div>}
          </div>
        </section>

        <section className="admin-setup-overview">
          <header><div><h2>Seadistuse seis</h2></div><small>{unpublishedCount} alustatud poodi on veel avaldamata</small></header>
          <div className="admin-setup-overview__bars">
            {setupSteps.map((step) => {
              const count = rows.filter((row) => row[step.key]).length
              const percent = rows.length ? Math.round(count / rows.length * 100) : 0
              return <div key={step.key}><span><strong>{step.label}</strong><small>{count} kasutajat</small></span><i><b style={{ width: `${percent}%` }} /></i><em>{percent}%</em></div>
            })}
          </div>
        </section>
      </>}
    </section>
  </main>
}
