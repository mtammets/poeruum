import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { paymentExplanation, type PaymentDiagnostics } from '../shared/paymentDiagnostics'
import { preferredPaymentDiagnostic } from './lib/adminPaymentStatus'
import { date, relative, money, supportUrl, storeState, presenceViews } from './lib/adminUserDisplay'
import Icon, { type IconName } from './AdminUserIcon'
import AdminUserInsights from './AdminUserInsights'
import './adminUserInsights.css'
import { hasUserMetrics, matchesUserFilter, salesDefinition, sortUserRows, type AdminUserRow, type LatestEmailDelivery, type UserFilter, type UserSort } from './lib/adminUserOverview'


const metrics: { id: UserFilter; label: string; icon: IconName; description: string }[] = [
  { id: 'all', label: 'Kasutajad', icon: 'users', description: 'Kõik kasutajad' },
  { id: 'published', label: 'Avalikud poed', icon: 'store', description: 'Avaldatud poed; maksete seis on eraldi veerus' },
  { id: 'selling', label: 'Müügiga · 30 p', icon: 'sales', description: salesDefinition },
  { id: 'payments', label: 'Maksetakistus', icon: 'alert', description: 'Salvestatud maksekontrollis tuvastatud takistusega poed' },
  { id: 'reply', label: 'Ootab vastust', icon: 'message', description: 'Kasutajad, kelle vestlus ootab administraatori vastust' },
]
const extraFilters: { id: UserFilter; label: string }[] = [
  { id: 'setup', label: 'Seadistamisel' },
  { id: 'temporary-email', label: 'Ajutine e-post' },
  { id: 'email-review', label: 'E-posti ülevaatus' },
]

function UserRow({ row, online, expanded, onToggle, children }: { row: AdminUserRow; online: boolean; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const hue = [...row.user_id].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) | 0, 0)
  return <article ref={ref} onClick={(event) => {
    if ((event.target as Element).closest('button, a, summary, details, .user-insights') || window.getSelection()?.toString()) return
    onToggle()
    ref.current?.querySelector<HTMLButtonElement>('.admin-user-row__expand')?.focus({ preventScroll: true })
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); onToggle(); ref.current?.querySelector<HTMLButtonElement>('.admin-user-row__expand')?.focus() }
  }} className={`admin-user-row${expanded ? ' is-expanded' : ''}${online ? ' is-online' : ''}${row.payment_state === 'restricted' ? ' needs-attention' : ''}`} style={{ '--avatar-hue': [152, 29, 214, 267, 345][Math.abs(hue) % 5] } as CSSProperties}>{children}</article>
}

export default function AdminUsers({ rows, onlineUserIds, onlineViews, presenceKnown, latestEmails, isLoading, metricsError, onRetry }: {
  rows: AdminUserRow[]; onlineUserIds: Set<string>; onlineViews: Map<string, string>; presenceKnown: boolean; latestEmails: Map<string, LatestEmailDelivery>; isLoading: boolean; metricsError: string; onRetry: () => void
}) {
  const [filter, setFilter] = useState<UserFilter>('all')
  const [sort, setSort] = useState<UserSort>('newest')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [freshPayments, setFreshPayments] = useState<Map<string, PaymentDiagnostics>>(() => new Map())
  const updatePayment = useCallback((diagnostic: PaymentDiagnostics) => setFreshPayments((current) => new Map(current).set(diagnostic.userId, diagnostic)), [])
  const [, tick] = useState(0)
  const filterMenu = useRef<HTMLDetailsElement>(null)
  const workspace = useRef<HTMLElement>(null)
  const metricsKnown = !metricsError && !isLoading && rows.every(hasUserMetrics)
  const onlineCount = rows.filter((row) => onlineUserIds.has(row.user_id)).length
  const counts = useMemo(() => Object.fromEntries([...metrics, ...extraFilters].map((item) => [item.id, rows.filter((row) => matchesUserFilter(row, item.id)).length])), [rows])
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('et')
    return sortUserRows(rows.filter((row) => matchesUserFilter(row, filter) && (!query || `${row.store_name ?? ''} ${row.email} ${row.store_slug ?? ''} ${row.custom_hostname ?? ''}`.toLocaleLowerCase('et').includes(query))), sort, onlineUserIds)
  }, [rows, filter, sort, search, onlineUserIds])
  useEffect(() => {
    const interval = window.setInterval(() => tick((value) => value + 1), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => { workspace.current?.scrollTo({ top: 0 }) }, [filter, search, sort])
  const chooseFilter = (next: UserFilter) => { setSelectedId(null); setFilter(next); if (filterMenu.current) filterMenu.current.open = false }
  return <section className="admin-users" ref={workspace}>
    <header><div className="admin-users__heading"><h1>Kasutajad</h1><span className={`admin-users__online${onlineCount ? ' is-online' : ''}`} title="Avatud sessioon saatis ühenduse signaali viimase 95 sekundi jooksul. See ei näita, millist tegevust kasutaja teeb."><i aria-hidden="true" /><strong>{presenceKnown ? onlineCount : '—'}</strong> ühendatud</span></div><label className="admin-search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Otsi kasutajat või poodi" aria-label="Otsi kasutajaid" /></label></header>
    <div className="admin-users__metrics" role="group" aria-label="Filtreeri kasutajaid">
      {metrics.map((item) => {
        const unavailable = !['all', 'published'].includes(item.id) && !metricsKnown
        return <button key={item.id} type="button" className={`admin-users__metric admin-users__metric--${item.id}${filter === item.id ? ' is-active' : ''}`} aria-label={item.id === 'all' ? 'Kõik' : item.label} aria-description={unavailable ? 'Andmed puuduvad' : `${counts[item.id]} kasutajat. ${item.description}`} aria-pressed={filter === item.id} disabled={unavailable} onClick={() => chooseFilter(item.id)}>
          <span className="admin-users__metric-label">{item.label}<Icon name={item.icon} /></span><strong key={counts[item.id]}>{unavailable || (isLoading && !rows.length) ? '—' : counts[item.id]}</strong>
        </button>
      })}
    </div>
    <div className="admin-users__toolbar"><details className="admin-users__filter-menu" ref={filterMenu}><summary><Icon name="filter" />{extraFilters.find((item) => item.id === filter)?.label ?? 'Filtrid'}<span className="admin-users__filter-chevron" /></summary><div className="admin-filters">{extraFilters.map((item) => <button type="button" key={item.id} aria-label={item.label} aria-pressed={filter === item.id} onClick={() => chooseFilter(filter === item.id ? 'all' : item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}</div></details><label className="admin-sort"><select aria-label="Järjesta kasutajad" value={sort} onChange={(event) => setSort(event.target.value as UserSort)}><option value="newest">Uuemad ees</option><option value="sales">Suurem müük ees</option><option value="attention">Vajavad tähelepanu</option><option value="signin">Hiljuti sisse loginud</option></select></label></div>
    {metricsError && <div className="admin-users__notice" role="status">Müügi- ja tugiseis pole kättesaadav.<button type="button" onClick={onRetry}>Proovi uuesti</button></div>}
    <div className="admin-table" tabIndex={0} role="region" aria-label="Kasutajate nimekiri">
      <div className="admin-table__head"><span>Kasutaja</span><span>Pood</span><span>Maksed</span><span title={salesDefinition}>Müük · 30 p</span><span>Klienditugi</span><span>Sisselogimine</span><span className="users-sr-only">Üksikasjad</span></div>
      {isLoading && !rows.length ? <div className="admin-table__empty" role="status"><span className="admin-table__loader" />Laadin kasutajaid…</div> : visibleRows.length ? visibleRows.map((row) => {
        const online = onlineUserIds.has(row.user_id)
        const known = hasUserMetrics(row)
        const fresh = freshPayments.get(row.user_id)
        const diagnostic = preferredPaymentDiagnostic(row.payment_diagnostics,
          fresh?.storeId === row.store_id && row.payment_status !== 'idle' && row.payment_state !== 'not_connected' ? fresh : undefined)
        const payment = paymentExplanation(diagnostic, { state: row.payment_state, issues: row.stripe_account_requirement_issues })
        const expanded = selectedId === row.user_id
        const toggle = () => setSelectedId(expanded ? null : row.user_id)
        const detailId = `user-insights-${row.user_id}`
        return <UserRow expanded={expanded} onToggle={toggle} row={row} online={online} key={row.user_id}>
          <div className="admin-user-row__identity"><span className={online ? 'is-online' : undefined}>{(row.store_name || row.email).charAt(0).toLocaleUpperCase('et')}</span><div><button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={toggle} title={row.store_name || row.email}>{row.store_name || row.email.split('@')[0]}</button><a href={`mailto:${row.email}`} title={row.email}>{row.email}</a></div>{(row.email_is_disposable || row.email_confirmed === false || row.email_review_required) && <button className="admin-user-row__flag" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={toggle} aria-label={`${row.email}: ${row.email_is_disposable ? 'Ajutine e-post' : 'Konto vajab ülevaatust'}`} title={row.email_is_disposable ? 'Ajutine e-post' : 'Konto vajab ülevaatust'}><Icon name="alert" /></button>}</div>
          <div className="admin-user-row__store-state" data-label="Pood"><span className={`admin-status is-${row.is_published ? 'good' : 'muted'}`}><Icon name={row.is_published ? 'store' : 'clock'} />{storeState(row)}</span>{row.store_id && <small>{row.product_count} {row.product_count === 1 ? 'toode' : 'toodet'}</small>}</div>
          <div className="admin-user-row__payment" data-label="Maksed"><button type="button" className={`admin-status is-${row.store_id ? payment.tone : 'muted'}`} aria-expanded={expanded} aria-controls={detailId} onClick={toggle} aria-label={`${row.store_name || row.email}: maksed ${row.store_id ? payment.title : 'poodi pole'}`}><Icon name={row.store_id ? payment.icon : 'minus'} />{row.store_id ? payment.title : '—'}</button></div>
          <div className={`admin-user-row__sales${known && row.net_sales_30d_cents ? ' has-sales' : ''}`} data-label="Müük · 30 p"><strong>{known ? money(row.net_sales_30d_cents) : '—'}</strong><small>{known ? `${row.paid_orders_30d} ${row.paid_orders_30d === 1 ? 'tellimus' : 'tellimust'}` : 'Andmed puuduvad'}</small></div>
          <div className="admin-user-row__support" data-label="Klienditugi">{!known ? <span title="Tugiseis pole kättesaadav">—</span> : (row.awaiting_admin_count ?? 0) > 0 ? <a className="admin-users__reply" href={supportUrl(row)}><Icon name="message" />Vasta<span>{row.awaiting_admin_count}</span></a> : (row.waiting_user_count ?? 0) > 0 ? <span className="admin-users__waiting"><Icon name="clock" />Ootab kasutajat{(row.waiting_user_count ?? 0) > 1 && <small>{row.waiting_user_count} vestlust</small>}</span> : <span className="admin-users__clear" aria-label="Vastamist ootavaid vestlusi pole"><Icon name="check" /></span>}</div>
          <div className="admin-user-row__activity" data-label="Sisselogimine"><strong className={online ? 'is-online' : undefined} title={online ? 'Avatud sessioon; see ei kirjelda kasutaja tegevust.' : `Viimane sisselogimine: ${date(row.last_sign_in_at)}`}>{online && <i aria-hidden="true" />}{online ? 'Ühendatud' : relative(row.last_sign_in_at)}</strong>{online && presenceViews[onlineViews.get(row.user_id) ?? ''] && <small>Vaade: {presenceViews[onlineViews.get(row.user_id)!]}</small>}</div>
          <button className="admin-user-row__expand" type="button" aria-label={`${row.store_name || row.email}: üksikasjad`} aria-expanded={expanded} aria-controls={detailId} onClick={toggle}><Icon name="chevron" /></button>
          {expanded && <div className="admin-user-row__insights" id={detailId} role="region" aria-label={`${row.store_name || row.email}: ülevaade`}><AdminUserInsights row={row} online={online} view={onlineViews.get(row.user_id)} presenceKnown={presenceKnown} email={latestEmails.get(row.user_id)} paymentDiagnostic={diagnostic} onPaymentDiagnostic={updatePayment} /></div>}
        </UserRow>
      }) : <div className="admin-table__empty"><Icon name="search" /><strong>Kasutajaid ei leitud</strong></div>}
    </div>

  </section>
}
