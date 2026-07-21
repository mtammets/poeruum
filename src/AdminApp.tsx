import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Brand } from './DemoApp'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'

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
}

type UserFilter = 'all' | 'incomplete' | 'payments' | 'unpublished' | 'complete'

const setupSteps: SetupStep[] = [
  { key: 'has_store_details', label: 'Poe põhiandmed' },
  { key: 'has_payments', label: 'Maksed ühendatud' },
  { key: 'has_delivery', label: 'Tarneviis valitud' },
  { key: 'has_product', label: 'Esimene toode lisatud' },
  { key: 'has_business_details', label: 'Müüja andmed' },
  { key: 'has_published', label: 'Pood avalikustatud' },
]

const filters: Array<{ id: UserFilter; label: string }> = [
  { id: 'all', label: 'Kõik' },
  { id: 'incomplete', label: 'Pooleli' },
  { id: 'payments', label: 'Maksed puudu' },
  { id: 'unpublished', label: 'Avaldamata' },
  { id: 'complete', label: 'Valmis' },
]

const setupCount = (row: AdminUserRow) => setupSteps.filter((step) => row[step.key]).length
const setupPercent = (row: AdminUserRow) => Math.round(setupCount(row) / setupSteps.length * 100)

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

const getNextStep = (row: AdminUserRow) => setupSteps.find((step) => !row[step.key])?.label ?? 'Pood on valmis'

const isStalled = (row: AdminUserRow) => {
  if (setupPercent(row) === 100) return false
  const lastActivity = row.last_activity_at ?? row.user_created_at
  return Date.now() - new Date(lastActivity).getTime() > 7 * 86_400_000
}

type AdminIconName = 'home' | 'users' | 'logout' | 'refresh' | 'check' | 'arrow' | 'alert' | 'search'

function AdminIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5M10 20v-5h4v5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.5 2.2-5.3 5.5-5.3s5.1 1.8 5.5 5.3" /><circle cx="17" cy="9" r="2.2" /><path d="M15.5 14.2c3.1-.4 4.8 1.2 5 4" /></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9" /></>,
    refresh: <><path d="M19 8a7.5 7.5 0 1 0 .3 7" /><path d="M19 4v4h-4" /></>,
    check: <path d="m6 12 4 4 8-9" />,
    arrow: <><path d="M7 17 17 7M9 7h8v8" /></>,
    alert: <><path d="M12 7v6" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></>,
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
  return <div className="admin-progress">
    <div className="admin-progress__meta"><strong>{percent}%</strong><span>{completed}/{setupSteps.length} sammu</span></div>
    <div className="admin-progress__segments" role="progressbar" aria-label={`Poe seadistus ${percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      {setupSteps.map((step) => <i className={row[step.key] ? 'is-done' : ''} title={`${step.label}: ${row[step.key] ? 'tehtud' : 'tegemata'}`} key={step.key} />)}
    </div>
    <small>{percent === 100 ? 'Kõik sammud tehtud' : `Järgmine: ${getNextStep(row)}`}</small>
  </div>
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [search, setSearch] = useState('')

  const loadDashboard = async () => {
    setIsLoading(true)
    setError('')
    // Refresh the JWT so a newly assigned server-side admin role is available
    // without requiring the user to manually clear their existing session.
    await requireSupabase().auth.refreshSession()
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
    setIsLoading(false)
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
    else setRows([])
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
      .sort((left, right) => setupPercent(left) - setupPercent(right)
        || new Date(right.user_created_at).getTime() - new Date(left.user_created_at).getTime())
  }, [rows, filter, search])

  if (!authReady) return <main className="admin-loading"><span /><p>Avan administraatori töölauda…</p></main>
  if (!isSupabaseConfigured) return <main className="admin-auth"><section className="admin-auth__card"><span>SEADISTUS PUUDUB</span><h1>Supabase pole ühendatud</h1><p>Lisa lokaalsesse <code>.env</code> faili Supabase’i võtmed ja laadi leht uuesti.</p><a href="/">Tagasi Poeruumi</a></section></main>
  if (!session) return <AdminLogin onSignedIn={() => void loadDashboard()} />

  const completedCount = rows.filter((row) => setupPercent(row) === 100).length
  const paymentMissingCount = rows.filter((row) => row.store_id && !row.has_payments).length
  const unpublishedCount = rows.filter((row) => setupPercent(row) > 0 && !row.has_published).length
  const stalledCount = rows.filter(isStalled).length

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <nav aria-label="Administraatori menüü">
        <a className="is-active" href="/admin" aria-current="page"><span><AdminIcon name="home" /></span>Ülevaade</a>
        <a href="#kasutajad"><span><AdminIcon name="users" /></span>Kasutajad</a>
      </nav>
      <div className="admin-sidebar__account"><span>{session.user.email?.charAt(0).toUpperCase()}</span><div><strong>Administraator</strong><small>{session.user.email}</small></div><button type="button" onClick={() => void requireSupabase().auth.signOut()} aria-label="Logi välja"><AdminIcon name="logout" /></button></div>
    </aside>

    <section className="admin-main">
      <header className="admin-topbar"><div><h1>Ülevaade</h1></div><button type="button" onClick={() => void loadDashboard()} disabled={isLoading}><span className={isLoading ? 'is-spinning' : ''}><AdminIcon name="refresh" /></span>{isLoading ? 'Uuendan…' : 'Uuenda andmeid'}</button></header>

      {error && <div className="admin-alert" role="alert"><span>!</span><div><strong>Ligipääs puudub</strong><p>{error}</p></div></div>}

      {!error && <>
        <section className="admin-kpis" aria-label="Kokkuvõte">
          <article><span>KÕIK KASUTAJAD</span><strong>{rows.length}</strong><small>Poeruumi kontot</small><i className="is-neutral"><AdminIcon name="users" /></i></article>
          <article><span>VALMIS POED</span><strong>{completedCount}</strong><small>{rows.length ? `${Math.round(completedCount / rows.length * 100)}% kasutajatest` : 'Andmed puuduvad'}</small><i className="is-positive"><AdminIcon name="check" /></i></article>
          <article><span>MAKSED PUUDU</span><strong>{paymentMissingCount}</strong><small>vajavad ühendamist</small><i className="is-warning"><AdminIcon name="arrow" /></i></article>
          <article><span>VAJAVAD TÄHELEPANU</span><strong>{stalledCount}</strong><small>üle 7 päeva muutuseta</small><i className="is-danger"><AdminIcon name="alert" /></i></article>
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

        <section className="admin-users" id="kasutajad">
          <header><div><h2>Seadistuse edenemine</h2><p>Kõige rohkem tähelepanu vajavad kasutajad on eespool.</p></div><label className="admin-search"><span><AdminIcon name="search" /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Otsi poodi või e-posti" aria-label="Otsi kasutajaid" /></label></header>
          <div className="admin-filters" role="group" aria-label="Filtreeri kasutajaid">
            {filters.map((item) => <button type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
          </div>
          <div className="admin-table">
            <div className="admin-table__head"><span>Kasutaja</span><span>Liitus</span><span>Seadistus</span><span>Staatus</span><span>Viimane tegevus</span></div>
            {isLoading && !rows.length ? <div className="admin-table__empty"><span className="admin-table__loader" /><strong>Laadin kasutajaid…</strong></div> : visibleRows.length ? visibleRows.map((row) => {
              const percent = setupPercent(row)
              const status = percent === 100 ? 'Valmis' : percent === 0 ? 'Alustamata' : isStalled(row) ? 'Vajab tähelepanu' : 'Pooleli'
              return <article className="admin-user-row" key={row.user_id}>
                <div className="admin-user-row__identity"><span>{(row.store_name ?? row.email).charAt(0).toLocaleUpperCase('et')}</span><div><strong>{row.store_name || 'Poodi pole loodud'}</strong><a href={`mailto:${row.email}`}>{row.email}</a></div></div>
                <time dateTime={row.user_created_at}>{formatDate(row.user_created_at)}</time>
                <ProgressBar row={row} />
                <div><span className={`admin-status is-${percent === 100 ? 'complete' : percent === 0 ? 'empty' : isStalled(row) ? 'stalled' : 'progress'}`}><i />{status}</span>{row.store_id && <small>{row.pricing_plan === 'fixed' ? 'Kindel pakett' : 'Paindlik pakett'}</small>}</div>
                <div className="admin-user-row__activity"><strong>{formatRelativeTime(row.last_activity_at)}</strong><small>{row.order_count ? `${row.order_count} tellimust` : row.product_count ? `${row.product_count} toodet` : 'Tellimusi pole'}</small></div>
              </article>
            }) : <div className="admin-table__empty"><span>⌕</span><strong>Kasutajaid ei leitud</strong><p>Muuda otsingut või vali teine filter.</p></div>}
          </div>
        </section>
      </>}
    </section>
  </main>
}
