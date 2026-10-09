import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { BrandMark } from './Brand'
import Icon from './AdminUserIcon'
import type { HomepageAnalyticsDashboard, RevenueDashboard } from './lib/adminDashboard'
import type { AdminUserRow } from './lib/adminUserOverview'
import { watchDay, type WatchEvent, type WatchScene } from './lib/adminWatch'
import './adminWatch.css'

const number = new Intl.NumberFormat('et-EE')
const currency = new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' })
const money = (cents: number) => currency.format(cents / 100)
const figureSize = (value: string) => ({ '--watch-digits': Math.max(2, value.replace(/\s/g, '').length) } as CSSProperties)
const dayLabel = (day: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(`${day}T12:00:00Z`))
const titles = { analytics: 'Külastatavus', users: 'Kasutajad', income: 'Poeruumi tulu' }

type Props = {
  scene: WatchScene; event: WatchEvent | null; sequence: number
  live: boolean; loading: boolean
  analytics: HomepageAnalyticsDashboard; analyticsKnown: boolean
  revenue: RevenueDashboard; revenueKnown: boolean
  rows: AdminUserRow[]; userCount: number | null
  onlineUserIds: Set<string>; presenceKnown: boolean
  onDisable: () => void
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <time className="watch-clock" dateTime={now.toISOString()}>{new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Tallinn' }).format(now)}</time>
}

function Amount({ cents, plus = false }: { cents: number; plus?: boolean }) {
  return <>{plus && '+'}{currency.formatToParts(cents / 100).map((part, index) => <span className={`watch-amount-${part.type}`} key={index}>{part.value}</span>)}</>
}

function Visits({ data, known, event, today }: { data: HomepageAnalyticsDashboard; known: boolean; event: WatchEvent | null; today: number }) {
  const arrival = event?.kind === 'visit' ? event : null
  const figure = known ? `${arrival ? '+' : ''}${number.format(arrival?.count ?? today)}` : '—'
  const daily = known ? data.daily : []
  const max = Math.max(1, ...daily.map((point) => point.sessions))
  const sources = [...data.sources].sort((a, b) => b.sessions - a.sessions).slice(0, 3)
  return <div className="watch-visits watch-layout">
    <section className="watch-lead">
      <span className="watch-eyebrow">{arrival ? 'Uued külastused' : 'Avaleht · täna'}</span>
      <strong className="watch-big-number" style={figureSize(figure)} key={arrival?.id ?? today}>{figure}</strong>
      <span className="watch-number-label">{arrival ? (arrival.count === 1 ? 'uus külastus' : 'uut külastust') : 'külastust'}</span>
      <div className="watch-lead-detail"><span>{data.range_days} päeva</span><strong>{known ? number.format(data.sessions) : '—'}</strong></div>
      <div className="watch-mini-stats"><div><strong>{known ? number.format(data.signup_starts) : '—'}</strong><span>Alustamisi</span></div><div><strong>{known ? number.format(data.accounts_created) : '—'}</strong><span>Uusi kontosid</span></div></div>
    </section>
    <section className="watch-traffic-field">
      <div className="watch-section-label"><span>Külastused päevade kaupa</span><span>{daily.length ? number.format(Math.max(...daily.map((point) => point.sessions))) : '—'}</span></div>
      <div className="watch-histogram" role="img" aria-label={`Külastused viimase ${data.range_days} päeva jooksul`}>
        <div className="watch-chart-guides" aria-hidden="true"><i /><i /><i /></div>
        {daily.length ? <div className="watch-bars">{daily.map((point, index) => <div className={`watch-bar-column${point.date === watchDay(Date.now()) ? ' is-today' : ''}`} key={point.date}>
          <i style={{ '--bar-height': `${point.sessions / max * 100}%`, '--bar-delay': `${Math.min(index * 16, 450)}ms`, borderTopWidth: point.sessions > 0 ? 2 : 0 } as CSSProperties} />
        </div>)}</div> : <span className="watch-empty">{known ? 'Andmeid veel pole' : 'Andmed pole saadaval'}</span>}
      </div>
      <div className="watch-chart-dates">{daily.length > 0 && <><span>{dayLabel(daily[0].date)}</span><span>{dayLabel(daily[Math.floor((daily.length - 1) / 2)].date)}</span><span>{daily.at(-1)!.date === watchDay(Date.now()) ? 'Täna' : dayLabel(daily.at(-1)!.date)}</span></>}</div>
      <div className="watch-sources">{known && sources.map((source) => <div key={source.source}><span>{source.source}</span><strong>{number.format(source.sessions)}</strong><i style={{ '--source-share': `${Math.min(100, source.sessions / Math.max(1, data.sessions) * 100)}%` } as CSSProperties} /></div>)}</div>
    </section>
  </div>
}

function Users({ rows, known, online, presenceKnown, event }: { rows: AdminUserRow[]; known: boolean; online: Set<string>; presenceKnown: boolean; event: WatchEvent | null }) {
  const sorted = [...rows].sort((a, b) => Date.parse(b.user_created_at) - Date.parse(a.user_created_at))
  const published = rows.filter((row) => row.is_published).length
  const arrival = event?.userId ? event : null
  const figure = known ? arrival ? '+1' : number.format(rows.length) : '—'
  return <div className="watch-people watch-layout">
    <section className={`watch-lead${arrival ? ' watch-lead--arrival' : ''}`}>
      <span className="watch-eyebrow">{arrival ? arrival.title : 'Kokku'}</span>
      <strong className="watch-big-number" style={figureSize(figure)} key={arrival?.id ?? rows.length}>{figure}</strong>
      <span className="watch-number-label">{arrival?.kind === 'published' ? 'avalik pood' : arrival ? 'kasutaja' : 'kasutajat'}</span>
      {arrival ? <div className="watch-person-name" key={`person:${arrival.id}`}>{arrival.detail}</div> : <div className="watch-lead-detail"><span>Praegu siin</span><strong>{presenceKnown ? number.format(rows.filter((row) => online.has(row.user_id)).length) : '—'}</strong></div>}
      <div className="watch-publication"><div><span>Avalikud poed</span><strong>{known ? number.format(published) : '—'}</strong></div><div className="watch-publication-track"><i style={{ width: `${known && rows.length ? published / rows.length * 100 : 0}%` }} /></div></div>
    </section>
    <section className="watch-roster">
      <div className="watch-section-label"><span>Viimati liitunud</span><span>{known ? `${number.format(rows.length)}` : '—'}</span></div>
      <div className="watch-roster-list" data-watch-scroll>
        {known && sorted.length ? sorted.map((row) => <article className={`watch-person${arrival?.userId === row.user_id ? ' is-watch-spotlight' : ''}`} data-user-id={row.user_id} key={row.user_id}>
          <span className="watch-monogram">{(row.store_name || row.email).slice(0, 1).toLocaleUpperCase('et')}{presenceKnown && online.has(row.user_id) && <i />}</span>
          <div><strong>{row.store_name || row.email.split('@')[0]}</strong><span>{row.email}</span></div>
          <span className={`watch-person-state${row.is_published ? ' is-published' : ''}`}><i />{row.is_published ? 'Avalik' : row.store_id ? 'Seadistab' : 'Poodi pole'}</span>
        </article>) : <span className="watch-empty">{known ? 'Kasutajaid veel pole' : 'Andmed pole saadaval'}</span>}
      </div>
    </section>
  </div>
}

function Income({ revenue, known, event }: { revenue: RevenueDashboard; known: boolean; event: WatchEvent | null }) {
  const income = event?.kind === 'income' ? event : null
  const positive = Math.max(0, revenue.subscription_total_cents) + Math.max(0, revenue.transaction_fee_total_cents)
  return <div className={`watch-income watch-layout${income ? ' is-arriving' : ''}`}>
    <section className="watch-income__total watch-lead">
      <span className="watch-eyebrow">{income ? 'Uus teenustasu' : new Intl.DateTimeFormat('et-EE', { month: 'long', year: 'numeric', timeZone: 'Europe/Tallinn' }).format(new Date())}</span>
      <strong className="watch-big-number watch-money" style={figureSize(`${income ? '+' : ''}${money(income?.amount ?? revenue.month_total_cents)}`)} key={income?.id ?? revenue.month_total_cents}>{known ? <Amount cents={income?.amount ?? revenue.month_total_cents} plus={Boolean(income)} /> : '—'}</strong>
      <span className="watch-number-label">{income ? income.detail : 'Poeruumi teenustasud'}</span>
      <div className="watch-income__breakdown"><div><span>Täna</span><b>{known ? money(revenue.today_total_cents) : '—'}</b></div><div><span>Sel kuul</span><b>{known ? money(revenue.month_total_cents) : '—'}</b></div></div>
      <div className="watch-revenue-mix"><div className="watch-revenue-track"><i style={{ width: `${known && positive ? Math.max(0, revenue.subscription_total_cents) / positive * 100 : 0}%` }} /></div><div><span>Kuutasud <b>{known ? money(revenue.subscription_total_cents) : '—'}</b></span><span>Müügitasud <b>{known ? money(revenue.transaction_fee_total_cents) : '—'}</b></span></div>{known && revenue.refund_total_cents !== 0 && <small>Tagastused {money(revenue.refund_total_cents)}</small>}</div>
      <small className="watch-accounting-note">KM-ta · enne Stripe’i tasusid</small>
    </section>
    <section className="watch-receipts"><div className="watch-section-label"><span>Viimased laekumised</span><Icon name="arrow" /></div><div data-watch-scroll>{known && revenue.recent_events.length ? revenue.recent_events.slice(0, 12).map((item) => <article key={item.id} className={income?.revenueIds?.includes(item.id) ? 'is-spotlight' : ''}>
      <span className="watch-receipt-mark"><Icon name={item.kind === 'subscription' ? 'store' : item.kind === 'transaction_fee_refund' ? 'minus' : 'arrow'} /></span>
      <div><strong>{item.store_name || 'Poeruum'}</strong><span>{item.kind === 'subscription' ? 'Kuutasu' : item.kind === 'transaction_fee_refund' ? 'Tagastus' : 'Müügitasu'} · {new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Tallinn' }).format(new Date(item.occurred_at))}</span></div>
      <b>{new Intl.NumberFormat('et-EE', { style: 'currency', currency: item.currency }).format(item.amount_cents / 100)}</b>
    </article>) : <span className="watch-empty">{known ? 'Laekumisi veel pole' : 'Andmed pole saadaval'}</span>}</div></section>
  </div>
}

export default function AdminWatchScreen(props: Props) {
  const { scene, event, sequence, live, loading, onDisable } = props
  const screen = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { screen.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (!event?.userId) return
    const row = Array.from(content.current?.querySelectorAll<HTMLElement>('[data-user-id]') ?? []).find((item) => item.dataset.userId === event.userId)
    const table = row?.closest('[data-watch-scroll]')
    if (row && table) table.scrollTop += row.getBoundingClientRect().top - table.getBoundingClientRect().top - table.clientHeight / 2 + row.clientHeight / 2
  }, [scene, event?.id, event?.userId])
  useEffect(() => {
    if (event) return
    const host = content.current
    if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scrollable = host.querySelector<HTMLElement>('[data-watch-scroll]')
    if (!scrollable || scrollable.scrollHeight <= scrollable.clientHeight) return
    let frame = 0
    const start = performance.now()
    const scroll = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start - 5000) / 8000))
      scrollable.scrollTop = Math.max(0, scrollable.scrollHeight - scrollable.clientHeight) * progress * progress * (3 - 2 * progress)
      if (progress < 1) frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(frame)
  }, [scene, sequence, event])
  const todayVisits = props.analytics.daily.find((point) => point.date === watchDay(Date.now()))?.sessions ?? 0
  return <section ref={screen} className={`admin-watch-screen${!live ? ' is-stale' : ''}${event ? ` has-event is-${event.kind}` : ''}`} role="dialog" aria-modal="true" aria-label="Vaatlusrežiim" tabIndex={-1} data-scene={scene} data-event={event?.kind}>
    <header className="watch-header">
      <div className="watch-brand"><BrandMark /><strong>Poeruum</strong></div>
      <div className="watch-heading"><h1>{titles[scene]}</h1></div>
      <span className={`watch-connection${live && !loading ? ' users-sr-only' : ''}`} role="status">{loading ? 'Laadin' : live ? 'Otse' : 'Ühendus taastub'}</span>
      <Clock />
      <button data-watch-control type="button" className="watch-close" onClick={onDisable} aria-label="Lõpeta vaatlusrežiim" title="Lõpeta vaatlusrežiim · Esc"><Icon name="close" /></button>
    </header>
    <div ref={content} className={`watch-content watch-content--${scene}`} key={scene}>
      {scene === 'analytics' ? <Visits data={props.analytics} known={props.analyticsKnown} event={event} today={todayVisits} /> : scene === 'users' ? <Users rows={props.rows} known={props.userCount !== null} online={props.onlineUserIds} presenceKnown={props.presenceKnown} event={event} /> : <Income revenue={props.revenue} known={props.revenueKnown} event={event} />}
    </div>
    <footer className="watch-footer">
      <div className="watch-metrics"><div><Icon name="eye" /><span>Täna</span><strong>{props.analyticsKnown ? number.format(todayVisits) : '—'}</strong></div><div><Icon name="users" /><span>Kasutajaid</span><strong>{props.userCount === null ? '—' : number.format(props.userCount)}</strong></div><div><Icon name="card" /><span>Täna</span><strong>{props.revenueKnown ? money(props.revenue.today_total_cents) : '—'}</strong></div></div>
    </footer>
    <span className="users-sr-only" role="status" aria-live="polite" aria-atomic="true">{event ? `${event.title}. ${event.detail}${event.amount ? `. ${money(event.amount)}` : event.count ? `. ${event.count}` : ''}` : titles[scene]}</span>
  </section>
}
