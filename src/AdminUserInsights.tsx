import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { requireSupabase } from './lib/supabase'
import AdminPaymentDetails from './AdminPaymentDetails'
import AdminProductPreview from './AdminProductPreview'
import { paymentExplanation, type PaymentDiagnostics } from '../shared/paymentDiagnostics'
import { hasUserMetrics, salesDefinition, type AdminUserRow, type LatestEmailDelivery } from './lib/adminUserOverview'
import { date, emailStates, money, presenceViews, relative, storeUrl, supportUrl } from './lib/adminUserDisplay'
import Icon, { type IconName } from './AdminUserIcon'

export type UserInsights = {
  detail_version: 1; user_id: string; generated_at: string
  sales_days: { day: string; orders: number; net_cents: number }[]
  order_states: { paid: number; pending: number; failed: number; refunded: number }
  first_paid_order_at: string | null; first_product_at: string | null; last_product_at: string | null
  products_added_30d: number; support_resolved: number
  payments: { live: boolean | null; charges_enabled: boolean | null; payouts_enabled: boolean | null } | null
}
const shortDay = (day: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(`${day}T12:00:00Z`))
const setupSteps: { key: keyof AdminUserRow; label: string; icon: IconName; view: string }[] = [
  { key: 'has_store_details', label: 'Pood', icon: 'store', view: 'store' },
  { key: 'has_business_details', label: 'Müüja', icon: 'users', view: 'business' },
  { key: 'has_payments', label: 'Maksed', icon: 'card', view: 'payments' },
  { key: 'has_delivery', label: 'Tarne', icon: 'truck', view: 'shipping' },
  { key: 'has_product', label: 'Tooted', icon: 'box', view: 'product' },
  { key: 'has_published', label: 'Avalik', icon: 'arrow', view: 'publish' },
]

function SalesChart({ days }: { days: UserInsights['sales_days'] }) {
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const descriptionId = useId()
  const max = Math.max(1, ...days.map((day) => day.net_cents))
  const selected = highlighted === null ? null : days[highlighted]
  return <div className="user-insight-chart" onMouseLeave={() => setHighlighted(null)}>
    <div className="user-insight-chart__plot" role="group" aria-label="Müük päevade kaupa" aria-describedby={descriptionId}>
      <div className="user-insight-chart__grid" aria-hidden="true"><i /><i /><i /></div>
      {days.map((day, index) => <button key={day.day} type="button" tabIndex={index === (highlighted ?? days.length - 1) ? 0 : -1}
        className={`${day.net_cents ? 'has-sales' : ''}${highlighted === index ? ' is-selected' : ''}`}
        style={{ '--bar-height': `${day.net_cents / max * 100}%` } as CSSProperties}
        aria-label={`${shortDay(day.day)}: ${money(day.net_cents)}, ${day.orders} tasutud tellimust`}
        onPointerEnter={() => setHighlighted(index)} onFocus={() => setHighlighted(index)} onClick={() => setHighlighted(index)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : null
          if (next === null) return
          event.preventDefault()
          const buttons = event.currentTarget.parentElement?.querySelectorAll('button')
          buttons?.[Math.max(0, Math.min(days.length - 1, next))]?.focus()
        }}><span /></button>)}
      {max === 1 && !days.some((day) => day.orders) && <span className="user-insight-chart__empty">Veel müüki pole</span>}
    </div>
    <div className="user-insight-chart__axis" id={descriptionId}><span>{days[0] && shortDay(days[0].day)}</span><output aria-live="polite">{selected ? `${shortDay(selected.day)} · ${money(selected.net_cents)} · ${selected.orders} tell.` : '30 päeva'}</output><span>{days.at(-1) && shortDay(days.at(-1)!.day)}</span></div>
  </div>
}

export default function AdminUserInsights({ row, online, view, presenceKnown, email, paymentDiagnostic, onPaymentDiagnostic }: {
  row: AdminUserRow; online: boolean; view?: string; presenceKnown: boolean; email?: LatestEmailDelivery
  paymentDiagnostic?: PaymentDiagnostics | null; onPaymentDiagnostic: (diagnostic: PaymentDiagnostics) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const finishReveal = () => {
    // Release the temporary height before focus/scroll targets content that can grow.
    panelRef.current?.parentElement?.getAnimations().forEach((animation) => animation.finish())
  }
  useEffect(() => {
    const wrapper = panelRef.current?.parentElement
    if (!wrapper || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = wrapper.animate([
      { height: '0px', opacity: 0, overflow: 'clip' },
      { height: `${wrapper.getBoundingClientRect().height}px`, opacity: 1, overflow: 'clip' },
    ], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' })
    return () => animation.cancel()
  }, [])
  const [data, setData] = useState<UserInsights | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [showProducts, setShowProducts] = useState(false)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void requireSupabase().rpc('admin_user_insights', { target_user_id: row.user_id }).abortSignal(controller.signal).then(({ data: result, error: queryError }) => {
      if (!active) return
      if (queryError || result?.detail_version !== 1 || result?.user_id !== row.user_id || !Array.isArray(result?.sales_days)) {
        setData(null); setError(true)
      } else { setData(result as UserInsights); setError(false) }
    })
    return () => { active = false; controller.abort() }
  }, [row, retry])
  const known = hasUserMetrics(row)
  const payment = paymentExplanation(paymentDiagnostic, { state: row.payment_state, issues: row.stripe_account_requirement_issues })
  // A completed setup step is not the same thing as an operational live payment account.
  const steps = setupSteps.map((step) => ({ ...step, done: step.key === 'has_payments' ? payment.tone === 'good' : Boolean(row[step.key]), warning: step.key === 'has_payments' && (payment.tone === 'warning' || row.payment_state === 'test'), unknown: step.key === 'has_payments' && (!known || row.payment_state === 'unknown') }))
  const completed = steps.filter((step) => step.done).length
  const net = data ? data.sales_days.reduce((total, day) => total + day.net_cents, 0) : known ? row.net_sales_30d_cents : undefined
  const paid = data?.order_states.paid ?? (known ? row.paid_orders_30d : undefined)
  const average = paid && net != null ? Math.round(net / paid) : undefined
  const events = [
    { label: 'Liitus', at: row.user_created_at, icon: 'users' },
    { label: 'Pood loodud', at: row.store_created_at, icon: 'store' },
    { label: 'Esimene toode', at: data?.first_product_at, icon: 'box' },
    ...(data?.last_product_at !== data?.first_product_at ? [{ label: 'Toode lisatud', at: data?.last_product_at, icon: 'box' }] : []),
    { label: 'Esimene müük', at: data?.first_paid_order_at, icon: 'sales' },
    ...(row.last_paid_order_at !== data?.first_paid_order_at ? [{ label: 'Tasutud tellimus', at: row.last_paid_order_at, icon: 'sales' }] : []),
    { label: 'Sisselogimine', at: row.last_sign_in_at, icon: 'pulse' },
    { label: 'Tugivestlus', at: row.last_support_at, icon: 'message' },
  ].filter((event) => event.at).sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!)).slice(0, 4)
  const ringId = useId()
  const url = storeUrl(row)
  return <div className="user-insights" ref={panelRef} aria-busy={!data && !error} onPointerDownCapture={finishReveal} onFocusCapture={finishReveal} onWheelCapture={finishReveal}>
    <AdminPaymentDetails row={row} diagnostic={paymentDiagnostic} onUpdated={onPaymentDiagnostic} />
    <div className="user-insights__grid">
      <section className="user-insight-card user-insight-setup" aria-label="Poe seadistus">
        <header><h3>Seadistus</h3>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Ava pood" title="Ava pood"><Icon name="arrow" /></a> : <Icon name="store" />}</header>
        <div className="user-insight-setup__hero"><div className="user-insight-ring" role="meter" aria-label="Poe seadistus" aria-valuemin={0} aria-valuemax={6} aria-valuenow={completed} aria-valuetext={`${completed} sammu 6-st korras`}>
          <svg viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id={ringId}><stop stopColor="#75dbae" /><stop offset="1" stopColor="#ddfb83" /></linearGradient></defs><circle className="user-insight-ring__track" cx="48" cy="48" r="40" /><circle className="user-insight-ring__value" cx="48" cy="48" r="40" pathLength="100" stroke={`url(#${ringId})`} strokeDasharray={`${completed / 6 * 100} 100`} /></svg><strong>{completed}<small>/6</small></strong>
        </div><button type="button" className="user-insight-setup__product" aria-label="Vaata tooteid" aria-haspopup="dialog" disabled={!row.store_id} onClick={() => setShowProducts(true)}><Icon name="box" /><strong>{row.product_count}</strong><span>{row.product_count === 1 ? 'toode' : 'toodet'}</span>{data && data.products_added_30d > 0 && <small>+{data.products_added_30d} / 30 p</small>}</button></div>
        <div className="user-insight-steps">{steps.map((step) => {
          const className = `${step.done ? 'is-done' : step.warning ? 'is-warning' : ''}${online && view === step.view ? ' is-current' : ''}`
          const status = step.done ? 'Korras' : step.unknown ? 'Kontrollimata' : step.warning ? payment.title : 'Seadistamata'
          const content = <><Icon name={step.icon} /><span>{step.label}</span><i aria-label={status}><Icon name={step.done ? 'check' : step.unknown ? 'help' : step.warning ? 'alert' : 'minus'} /></i></>
          return step.key === 'has_product'
            ? <button key={step.key} type="button" className={className} aria-label="Tooted" aria-haspopup="dialog" disabled={!row.store_id} onClick={() => setShowProducts(true)}>{content}</button>
            : <div key={step.key} className={className} title={`${step.label}: ${status}`}>{content}</div>
        })}</div>
      </section>
      <section className="user-insight-card user-insight-sales" aria-label="Müügi ülevaade">
        <header><h3>Müük <span>30 p</span></h3><details className="user-insight-tip"><summary aria-label="Müüginäitajate selgitus"><Icon name="info" /></summary><p>{salesDefinition}</p></details></header>
        <div className="user-insight-sales__numbers"><strong>{money(net)}</strong><div><b>{paid ?? '—'}</b><span>tellimust</span></div><div><b>{money(average)}</b><span>keskmine</span></div></div>
        {data ? <SalesChart days={data.sales_days} /> : <div className={`user-insight-placeholder${error ? ' is-error' : ''}`} role="status">{error ? <><Icon name="alert" /><span>Graafik pole kättesaadav</span><button type="button" onClick={() => { setError(false); setRetry((value) => value + 1) }}>Proovi uuesti</button></> : <><span className="user-insight-skeleton" /><span className="users-sr-only">Laadin müügi ajalugu</span></>}</div>}
        <div className="user-insight-orders">{([{ key: 'paid', label: 'Tasutud', tone: 'good' }, { key: 'pending', label: 'Pooleli', tone: 'pending' }, { key: 'failed', label: 'Nurjunud', tone: 'warning' }, { key: 'refunded', label: 'Tagastatud', tone: 'muted' }] as const).map((state) => <span key={state.key} className={`is-${state.tone}`}><i aria-hidden="true" /><span>{state.label}</span><b>{data?.order_states[state.key] ?? '—'}</b></span>)}</div>
      </section>
      <section className="user-insight-card user-insight-activity" aria-label="Kasutaja aktiivsus">
        <header><h3>{online ? 'Praegu' : 'Viimati'}</h3><Icon name="pulse" /></header>
        <div className={`user-insight-presence${online ? ' is-online' : ''}`}><i aria-hidden="true" /><div><strong>{!presenceKnown ? '—' : online ? presenceViews[view ?? ''] || 'Ühendatud' : relative(row.last_sign_in_at)}</strong><span>{!presenceKnown ? 'Ühenduse seis teadmata' : online ? 'Avatud vaade' : 'Sisselogimine'}</span></div>{online && <span className="user-insight-presence__signal" aria-hidden="true"><i /><i /><i /></span>}</div>
        <ol className="user-insight-events">{events.map((event) => <li key={`${event.label}-${event.at}`}><span><Icon name={event.icon as IconName} /></span><strong>{event.label}</strong><time dateTime={event.at!} title={date(event.at)}>{relative(event.at)}</time></li>)}</ol>
      </section>
    </div>
    <div className="user-insights__states">
      <details className={`user-insight-state is-${row.email_confirmed && !row.email_is_disposable && !row.email_review_required ? 'good' : 'warning'}`}><summary><Icon name="shield" /><span><small>Konto</small><strong>{row.email_is_disposable ? 'Ajutine e-post' : row.email_review_required ? 'Vajab ülevaatust' : row.email_confirmed ? 'Kinnitatud' : 'Kinnitamata'}</strong></span><Icon name="chevron" /></summary><div className="user-insight-state__details"><p>{row.email}</p><p>Liitus: {date(row.user_created_at)}</p><p>E-post: {row.email_confirmed ? 'Kinnitatud' : 'Kinnitamata'}</p><p>{row.pricing_plan === 'fixed' ? 'Kindel pakett' : 'Paindlik pakett'}</p>{row.email_review_required && <p>Ülevaatus: 30 päeva tegevuseta</p>}</div></details>
      <details className={`user-insight-state is-${(row.awaiting_admin_count ?? 0) > 0 ? 'warning' : 'good'}`}><summary><Icon name="message" /><span><small>Klienditugi</small><strong>{known ? <span className="user-insight-support-counts"><span><b>{row.awaiting_admin_count ?? 0}</b> sina</span><span><b>{row.waiting_user_count ?? 0}</b> kasutaja</span></span> : '—'}</strong></span><Icon name="chevron" /></summary><div className="user-insight-state__details"><p>Ootab sinu vastust: {row.awaiting_admin_count ?? '—'}</p><p>Ootab kasutajat: {row.waiting_user_count ?? '—'}</p><p>Lahendatud: {data?.support_resolved ?? '—'}</p><a href={supportUrl(row)}>Ava klienditugi<Icon name="arrow" /></a></div></details>
      <details className={`user-insight-state is-${email && ['failed','bounced','complained','suppressed'].includes(email.status) ? 'warning' : 'muted'}`}><summary><Icon name="mail" /><span><small>Viimane kiri</small><strong>{email ? emailStates[email.status] : '—'}</strong></span><Icon name="chevron" /></summary><div className="user-insight-state__details">{email ? <><strong>{email.subject}</strong><p>{date(email.sent_at)}</p></> : <p>Saadetud kirju pole</p>}</div></details>
    </div>
    {showProducts && row.store_id && <AdminProductPreview key={row.store_id} storeId={row.store_id} storeName={row.store_name || row.email} onClose={() => setShowProducts(false)} />}
  </div>
}
