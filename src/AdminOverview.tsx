import { useId, useState, type CSSProperties, type MouseEvent } from 'react'
import AdminUserIcon, { type IconName } from './AdminUserIcon'
import type { AdminUserRow } from './lib/adminUserOverview'
import type { AnalyticsDailyPoint, AnalyticsRange, HomepageAnalyticsDashboard, RevenueDashboard } from './lib/adminDashboard'
import type { HomepageVisitFeedback } from './useHomepageVisitFeedback'
import { VisitBadge, VisitNumber } from './VisitFeedback'
import AdminPushToggle from './AdminPushToggle'
import type { AdminPushFeedback } from './useAdminPush'
import './adminOverview.css'

type OverviewDestination = 'users' | 'analytics' | 'support'
type Props = {
  rows: AdminUserRow[]
  usersLoading: boolean
  onlineCount: number | null
  revenue: RevenueDashboard
  revenueError: string
  revenueLoading: boolean
  liveRevenueEventId: string | null
  analytics: HomepageAnalyticsDashboard
  analyticsError: string
  analyticsLoading: boolean
  visitFeedback: HomepageVisitFeedback
  pushFeedback: AdminPushFeedback
  range: AnalyticsRange
  onRangeChange: (range: AnalyticsRange) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, view: OverviewDestination) => void
}

const number = new Intl.NumberFormat('et-EE')
const money = (cents: number, currency = 'eur') => new Intl.NumberFormat('et-EE', {
  style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100)
const shortDate = (date: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(date))
const metrics = [
  { key: 'sessions', label: 'Külastused', color: 'var(--admin-accent)' },
  { key: 'signup_starts', label: 'Alustamised', color: '#c3b1ed' },
  { key: 'accounts_created', label: 'Uued kontod', color: '#9ed8e4' },
] as const
type Metric = typeof metrics[number]['key']

const setupSteps: { key: keyof AdminUserRow; label: string; icon: IconName }[] = [
  { key: 'has_store_details', label: 'Poe andmed', icon: 'store' },
  { key: 'has_business_details', label: 'Müüja andmed', icon: 'shield' },
  { key: 'has_delivery', label: 'Tarne', icon: 'truck' },
  { key: 'has_product', label: 'Tooted', icon: 'box' },
  { key: 'has_payments', label: 'Maksed', icon: 'card' },
  { key: 'has_published', label: 'Avaldatud', icon: 'check' },
]

function DailyChart({ daily, metric }: { daily: AnalyticsDailyPoint[]; metric: typeof metrics[number] }) {
  const gradientId = useId()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const width = 800
  const height = 192
  const max = Math.max(1, ...daily.map((day) => day[metric.key]))
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const ceiling = Math.max(2, Math.ceil(max / magnitude) * magnitude)
  const points = daily.map((day, i) => ({
    x: daily.length === 1 ? width / 2 : i / (daily.length - 1) * width,
    y: height - day[metric.key] / ceiling * (height - 12),
    day,
  }))
  const selected = selectedIndex === null ? null : points[Math.min(selectedIndex, points.length - 1)]
  const line = points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
  const area = points.length > 1 ? `${line} L${points.at(-1)!.x},${height} L${points[0].x},${height} Z` : ''
  const dateIndexes = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])]

  if (!daily.length) return <div className="overview-chart__empty"><AdminUserIcon name="pulse" /><span>Päevased andmed puuduvad</span></div>

  return <div className="overview-chart" style={{ '--chart-color': metric.color } as CSSProperties}>
    <div className="overview-chart__readout" aria-live="polite" aria-atomic="true">
      {selected ? <><span>{shortDate(selected.day.date)}</span><strong>{number.format(selected.day[metric.key])}</strong><span>{metric.label.toLocaleLowerCase('et')}</span></> : <span>Päevade kaupa</span>}
    </div>
    <div className="overview-chart__plot"
      role="slider" tabIndex={0} aria-label={`${metric.label} päevade kaupa`}
      aria-valuemin={1} aria-valuemax={daily.length} aria-valuenow={Math.min(selectedIndex ?? daily.length - 1, daily.length - 1) + 1}
      aria-valuetext={`${shortDate((selected ?? points.at(-1)!).day.date)}: ${(selected ?? points.at(-1)!).day[metric.key]} ${metric.label.toLocaleLowerCase('et')}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setSelectedIndex(Math.max(0, Math.min(daily.length - 1, Math.round((event.clientX - rect.left) / rect.width * (daily.length - 1)))))
      }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse' && document.activeElement !== event.currentTarget) setSelectedIndex(null) }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setSelectedIndex(Math.max(0, Math.min(daily.length - 1, Math.round((event.clientX - rect.left) / rect.width * (daily.length - 1)))))
      }}
      onFocus={() => setSelectedIndex((current) => current ?? daily.length - 1)}
      onBlur={() => setSelectedIndex(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setSelectedIndex((current) => event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1
          : Math.max(0, Math.min(daily.length - 1, (current ?? daily.length - 1) + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))))
      }}>
      <div className="overview-chart__grid" aria-hidden="true">
        {[ceiling, ceiling / 2, 0].map((value) => <span key={value}>{number.format(value)}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={metric.color} stopOpacity=".28" /><stop offset="100%" stopColor={metric.color} stopOpacity=".015" /></linearGradient></defs>
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        <path d={line} fill="none" stroke={metric.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {(selected || points.length === 1) && <span className="overview-chart__cursor" style={{ left: `${(selected ?? points[0]).x / width * 100}%` }}>
        <i style={{ top: `${(selected ?? points[0]).y / height * 100}%` }} />
      </span>}
    </div>
    <div className="overview-chart__dates" aria-hidden="true">{dateIndexes.map((index) => <span key={index}>{shortDate(daily[index].date)}</span>)}</div>
  </div>
}

export default function AdminOverview({ rows, usersLoading, onlineCount, revenue, revenueError, revenueLoading, liveRevenueEventId, analytics, analyticsError, analyticsLoading, visitFeedback, pushFeedback, range, onRangeChange, onNavigate }: Props) {
  const [metricKey, setMetricKey] = useState<Metric>('sessions')
  const metric = metrics.find((item) => item.key === metricKey)!
  const metricNotice = (key: Metric) => key === 'sessions' ? visitFeedback.notice : key === 'accounts_created' ? visitFeedback.accountNotice : null
  const published = rows.filter((row) => row.is_published).length
  const settingUp = rows.filter((row) => row.store_id && !row.is_published).length
  const withoutStore = rows.length - published - settingUp
  const paymentMissing = rows.filter((row) => row.store_id && !row.has_payments).length
  const stalled = rows.filter((row) => row.store_id && !row.is_published && Date.now() - new Date(row.last_activity_at ?? row.user_created_at).getTime() > 7 * 86_400_000).length
  const conversations = rows.reduce((sum, row) => sum + row.open_support_count, 0)
  const states = [
    { label: 'Avalikud', value: published, color: 'var(--admin-accent)' },
    { label: 'Seadistamisel', value: settingUp, color: '#c3b1ed' },
    { label: 'Pood loomata', value: withoutStore, color: 'var(--admin-line-strong)' },
  ]
  const grossRevenue = Math.max(0, revenue.subscription_total_cents) + Math.max(0, revenue.transaction_fee_total_cents)
  const feesPercent = grossRevenue ? Math.max(0, revenue.transaction_fee_total_cents) / grossRevenue * 100 : 0
  const revenueKnown = !revenueError && !revenueLoading
  const analyticsKnown = !analyticsError && !analyticsLoading
  const usersKnown = !usersLoading

  const viewLink = (view: OverviewDestination, label: string) => <a className="overview-open" href={`/admin/${view}`} aria-label={label} onClick={(event) => onNavigate(event, view)}><AdminUserIcon name="arrow" /></a>

  return <div className="admin-overview">
    <section className={`overview-panel overview-traffic${visitFeedback.notice ? ' has-new-visits' : ''}${visitFeedback.accountNotice ? ' has-new-accounts' : ''}`} aria-label="Avalehe külastatavus" aria-busy={analyticsLoading}>
      <header className="overview-panel__header">
        <h2>Avalehe külastatavus</h2>
        <div className="overview-traffic__controls"><AdminPushToggle push={pushFeedback} /><div className="overview-range" role="group" aria-label="Külastatavuse periood">{([7, 30, 90] as const).map((days) => <button type="button" key={days} aria-pressed={range === days} disabled={analyticsLoading} onClick={() => onRangeChange(days)}>{days} p</button>)}</div></div>
      </header>
      <div className="overview-traffic__headline"><strong><VisitNumber value={analyticsKnown ? number.format(analytics[metricKey]) : '—'} notice={metricNotice(metricKey)} /></strong><span>{metric.label.toLocaleLowerCase('et')}<br /><small>{range} päeva</small></span><VisitBadge notice={metricNotice(metricKey)} />{viewLink('analytics', 'Ava külastatavuse üksikasjad')}</div>
      {analyticsLoading ? <div className="overview-chart__empty" role="status"><span className="overview-loading" />Laen graafikut…</div>
        : analyticsError ? <div className="overview-chart__empty is-error" role="alert"><AdminUserIcon name="alert" /><span>Graafik pole praegu saadaval</span></div>
          : <DailyChart key={`${range}-${metricKey}`} daily={analytics.daily} metric={metric} />}
      <div className="overview-metrics" role="group" aria-label="Graafiku näitaja">{metrics.map((item) => <button type="button" key={item.key} className={item.key === 'accounts_created' && visitFeedback.accountNotice ? 'has-new-accounts' : undefined} aria-pressed={metricKey === item.key} onClick={() => setMetricKey(item.key)} style={{ '--chart-color': item.color } as CSSProperties}><span><i />{item.label}</span><span className="overview-metrics__value"><strong><VisitNumber value={analyticsKnown ? number.format(analytics[item.key]) : '—'} notice={metricNotice(item.key)} /></strong>{item.key !== metricKey && <VisitBadge notice={metricNotice(item.key)} />}</span></button>)}</div>
    </section>

    <section className={`overview-panel overview-income${liveRevenueEventId ? ' is-live-update' : ''}`} aria-label="Poeruumi teenustasud" aria-busy={revenueLoading}>
      <header className="overview-panel__header"><h2>Teenustasud</h2><span className="overview-income__month">{new Intl.DateTimeFormat('et-EE', { month: 'long', timeZone: 'Europe/Tallinn' }).format(new Date())}</span></header>
      <div className="overview-income__amount">{revenueKnown ? money(revenue.month_total_cents) : '—'}</div>
      <span className="overview-income__basis">KM-ta · enne Stripe’i tasusid</span>
      {revenueError ? <p role="alert">Tulu pole praegu saadaval</p> : <>
        <div className="overview-income__today"><span>Täna</span><strong>{revenueKnown ? money(revenue.today_total_cents) : '—'}</strong></div>
        <div className="overview-income__composition" aria-hidden="true"><i style={{ width: revenueKnown ? `${feesPercent}%` : '0%' }} /><b style={{ width: revenueKnown ? `${grossRevenue ? 100 - feesPercent : 0}%` : '0%' }} /></div>
        <dl className="overview-income__breakdown"><div><dt><i />Müügitasud</dt><dd>{revenueKnown ? money(revenue.transaction_fee_total_cents) : '—'}</dd></div><div><dt><i />Kuutasud</dt><dd>{revenueKnown ? money(revenue.subscription_total_cents) : '—'}</dd></div>{revenueKnown && revenue.refund_total_cents !== 0 && <div><dt>Tagastused</dt><dd>{money(revenue.refund_total_cents)}</dd></div>}</dl>
      </>}
      <details className="overview-receipts"><summary>Laekumised <span>{liveRevenueEventId ? 'Uus' : <AdminUserIcon name="chevron" />}</span></summary>
        {revenueError ? <p>Laekumisi ei saanud laadida.</p> : revenueLoading ? <p>Laen laekumisi…</p> : revenue.recent_events.length ? <ul>{revenue.recent_events.slice(0, 4).map((event) => <li key={event.id} className={event.id === liveRevenueEventId ? 'is-new' : undefined}><span><strong>{event.store_name}</strong><small>{shortDate(event.occurred_at)} · {event.description}</small></span><b>{event.amount_cents > 0 ? '+' : ''}{money(event.amount_cents, event.currency)}</b></li>)}</ul> : <p>Laekumisi veel pole</p>}
      </details>
    </section>

    <section className="overview-panel overview-stores" aria-label="Kasutajad ja poed" aria-busy={usersLoading}>
      <header className="overview-panel__header"><h2>Kasutajad ja poed</h2>{viewLink('users', 'Ava kasutajad')}</header>
      <div className="overview-donut">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle className="overview-donut__track" cx="110" cy="110" r="88" />
          {usersKnown && rows.length > 0 && states.map((state, index) => {
            const share = state.value / rows.length * 100
            const offset = states.slice(0, index).reduce((sum, item) => sum + item.value / rows.length * 100, 0)
            return state.value > 0 && <circle key={state.label} cx="110" cy="110" r="88" pathLength="100" fill="none" stroke={state.color} strokeDasharray={`${Math.max(.1, share - 1.3)} ${100 - Math.max(.1, share - 1.3)}`} strokeDashoffset={-offset} transform="rotate(-90 110 110)" />
          })}
        </svg>
        <div><strong>{usersKnown ? number.format(rows.length) : '—'}</strong><span>kasutajat</span>{onlineCount !== null && <small><i />{onlineCount} ühendatud</small>}</div>
      </div>
      <ul className="overview-stores__legend">{states.map((state) => <li key={state.label}><span><i style={{ background: state.color }} />{state.label}</span><strong>{usersKnown ? number.format(state.value) : '—'}</strong></li>)}</ul>
    </section>

    <section className="overview-panel overview-setup" aria-label="Poodide seadistus" aria-busy={usersLoading}>
      <header className="overview-panel__header"><h2>Valmis avamiseks</h2><span>{usersKnown ? rows.length : '—'} kontot</span></header>
      <div className="overview-setup__steps">{setupSteps.map((step) => {
        const count = rows.filter((row) => row[step.key]).length
        const percent = rows.length ? count / rows.length * 100 : 0
        return <div className="overview-setup__step" key={step.key}>
          <span className="overview-setup__icon"><AdminUserIcon name={step.icon} /></span>
          <div><span>{step.label}</span><div className="overview-setup__track" role="meter" aria-label={step.label} aria-valuenow={usersKnown ? count : 0} aria-valuemin={0} aria-valuemax={rows.length || 1} aria-valuetext={usersKnown ? `${count} / ${rows.length} kontot` : 'Laen'}><i style={{ width: `${usersKnown ? percent : 0}%` }} /></div></div>
          <strong>{usersKnown ? count : '—'}</strong>
        </div>
      })}</div>
    </section>

    <section className="overview-panel overview-attention" aria-label="Tähelepanu vajavad kohad" aria-busy={usersLoading}>
      <header className="overview-panel__header"><h2>Tähelepanu</h2><span className={`overview-attention__status${usersKnown && !paymentMissing && !stalled && !conversations ? ' is-clear' : ''}`}><AdminUserIcon name={usersKnown && !paymentMissing && !stalled && !conversations ? 'check' : 'pulse'} /></span></header>
      {([
        { label: 'Maksed ühendamata', value: paymentMissing, icon: 'card', view: 'users', tone: 'peach' },
        { label: 'Pooleli · 7+ päeva', value: stalled, icon: 'clock', view: 'users', tone: 'lilac' },
        { label: 'Avatud vestlused', value: conversations, icon: 'message', view: 'support', tone: 'blue' },
      ] as const).map((item) => <a key={item.label} className={`overview-attention__item is-${item.tone}${!item.value ? ' is-zero' : ''}`} href={`/admin/${item.view}`} onClick={(event) => onNavigate(event, item.view)}><span className="overview-attention__icon"><AdminUserIcon name={item.icon} /></span><span><strong>{usersKnown ? number.format(item.value) : '—'}</strong><span>{item.label}</span></span><AdminUserIcon name="chevron" /></a>)}
    </section>
  </div>
}
