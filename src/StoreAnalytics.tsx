import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { fetchStoreAnalytics, storeAnalyticsTrend, type StoreAnalyticsMetric, type StoreAnalyticsRange, type StoreAnalyticsReport } from './lib/storeAnalytics'
import './storeAnalytics.css'

const number = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 0 })
const euro = new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const labels = { visits: 'Külastused', orders: 'Tellimused', sales: 'Müük' }
const formatValue = (value: number, metric: StoreAnalyticsMetric) => metric === 'sales' ? euro.format(value) : number.format(value)
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('et-EE', { day: 'numeric', month: 'short', timeZone: 'Europe/Tallinn' })

function AnalyticsIcon({ name }: { name: 'chart' | 'close' | 'refresh' | 'arrow' | 'bag' | 'eye' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'chart' && <><path d="M4 4v16h16" /><path d="m7 14 4-4 4 2 5-7" /></>}
    {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
    {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15" /></>}
    {name === 'arrow' && <path d="m9 5 7 7-7 7" />}
    {name === 'bag' && <><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>}
    {name === 'eye' && <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>}
  </svg>
}

function Trend({ current, previous, available }: { current: number; previous: number; available: boolean }) {
  const trend = storeAnalyticsTrend(current, previous, available)
  return trend && <span className={`store-stats__trend is-${trend.direction}`} title="Võrreldes eelmise sama pika perioodiga sama kellaajani"
    aria-label={`${trend.label} võrreldes eelmise perioodiga`}>
    {!trend.label.includes('→') && <span aria-hidden="true">{trend.direction === 'up' ? '↗' : trend.direction === 'down' ? '↘' : '→'}</span>}{trend.label}
  </span>
}

export function StoreAnalyticsChart({ points, label, money = false }: {
  points: { date: string; value: number | null }[]; label: string; money?: boolean
}) {
  const id = useId()
  const [selection, setSelection] = useState<number | null>(null)
  const format = (value: number) => money ? euro.format(value) : number.format(value)
  const known = points.flatMap((point, index) => point.value === null ? [] : [index])
  const active = selection === null ? null : points[selection]
  const ceiling = Math.max(1, ...points.map((point) => point.value ?? 0)) * 1.15
  const x = (index: number) => 12 + index / Math.max(1, points.length - 1) * 576
  const y = (value: number) => 162 - value / ceiling * 140
  const segments: string[] = []
  let continuous = false
  points.forEach((point, index) => {
    if (point.value === null) { continuous = false; return }
    segments.push(`${continuous ? 'L' : 'M'}${x(index)},${y(point.value)}`)
    continuous = true
  })
  const first = known[0]
  const last = known.at(-1)
  const empty = known.length > 0 && points.every((point) => !point.value)
  const position = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    setSelection(Math.max(0, Math.min(points.length - 1, Math.round(((clientX - rect.left) / rect.width * 600 - 12) / 576 * (points.length - 1)))))
  }
  return <div className="store-stats-chart">
    <div className="store-stats-chart__readout" aria-live="polite" aria-atomic="true"><span>{active ? dateLabel(active.date) : label}</span>
      <strong>{active ? active.value === null ? 'Andmed puuduvad' : format(active.value) : money ? '€' : 'päevade kaupa'}</strong></div>
    <div className="store-stats-chart__plot" role="slider" tabIndex={0} aria-label={`${label} päevade kaupa`}
      aria-valuemin={1} aria-valuemax={points.length} aria-valuenow={(selection ?? points.length - 1) + 1}
      aria-valuetext={`${dateLabel((active ?? points.at(-1)!).date)}: ${(active ?? points.at(-1)!).value === null ? 'andmed puuduvad' : format((active ?? points.at(-1)!).value!)}`}
      onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }); position(event.clientX, event.currentTarget) }}
      onPointerMove={(event) => position(event.clientX, event.currentTarget)}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse' && document.activeElement !== event.currentTarget) setSelection(null) }}
      onFocus={() => setSelection((value) => value ?? points.length - 1)} onBlur={() => setSelection(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setSelection((value) => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
          : Math.max(0, Math.min(points.length - 1, (value ?? points.length - 1) + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))))
      }}>
      <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".24" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {[22, 92, 162].map((line) => <path key={line} className="store-stats-chart__grid" d={`M12,${line} H588`} />)}
        {first !== undefined && last !== undefined && <path d={`${segments.join(' ')} L${x(last)},162 L${x(first)},162 Z`} fill={`url(#${id})`} />}
        <path className="store-stats-chart__line" d={segments.join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {known.length === 1 && <circle cx={x(first)} cy={y(points[first].value!)} r="3.5" fill="currentColor" />}
      </svg>
      {active && <span className="store-stats-chart__cursor" style={{ left: `${x(selection!) / 6}%` }}>
        {active.value !== null && <i style={{ top: `${y(active.value) / 1.8}%` }} />}</span>}
      {empty && !active && <span className="store-stats-chart__empty">{money ? 'Müüki veel pole' : label === 'Tellimused' ? 'Tellimusi veel pole' : 'Ootame esimesi külastusi'}</span>}
    </div>
    <div className="store-stats-chart__dates" aria-hidden="true">{[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => <span key={index}>{dateLabel(points[index].date)}</span>)}</div>
  </div>
}

export default function StoreAnalytics({ storeId, storeName, onClose }: { storeId: string; storeName: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [days, setDays] = useState<StoreAnalyticsRange>(7)
  const [metric, setMetric] = useState<StoreAnalyticsMetric>('visits')
  const [attempt, setAttempt] = useState(0)
  const [report, setReport] = useState<StoreAnalyticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const titleId = useId()
  const productDetailId = useId()
  const matching = report?.store_id === storeId && report.range_days === days ? report : null
  const selectedProduct = matching?.products.find((product) => product.id === productId)

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      element.close()
      window.requestAnimationFrame(() => {
        if (!element.open && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void fetchStoreAnalytics(storeId, days, controller.signal).then((data) => {
      if (!controller.signal.aborted) setReport(data)
    }).catch(() => {
      if (!controller.signal.aborted) setError('Statistikat ei õnnestunud laadida.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [storeId, days, attempt])

  const value = (key: StoreAnalyticsMetric) => matching ? formatValue(matching.current[key], key) : '—'
  return <dialog ref={dialog} className="store-stats" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    } }}>
    <header className="store-stats__header">
      <span className="store-stats__mark"><AnalyticsIcon name="chart" /></span>
      <div><span className="store-stats__store">{storeName}</span><h2 id={titleId}>Kogu pood</h2></div>
      <button type="button" className="store-stats__icon-button" onClick={onClose} aria-label="Sulge statistika" autoFocus><AnalyticsIcon name="close" /></button>
    </header>
    <div className="store-stats__content">
      <div className="store-stats__toolbar">
        <div className="store-stats__period" role="group" aria-label="Statistika periood">
          {([7, 30] as const).map((range) => <button type="button" key={range} aria-pressed={days === range} onClick={() => { setDays(range); setProductId(null) }}>{range} päeva</button>)}
        </div>
        <button type="button" className="store-stats__icon-button" onClick={() => setAttempt((value) => value + 1)} disabled={loading} aria-label="Värskenda statistikat" title="Värskenda"><AnalyticsIcon name="refresh" /></button>
      </div>
      {error && <div className="store-stats__error" role="alert"><span>{error}{matching && ' Kuvan viimati laaditud andmeid.'}</span><button type="button" onClick={() => setAttempt((value) => value + 1)}>Proovi uuesti</button></div>}
      <div className={`store-stats__data${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        <button type="button" className="store-stats__hero" aria-pressed={metric === 'visits'} aria-label={`Külastused: ${value('visits')}. Kuva graafikul`} onClick={() => setMetric('visits')}>
          <span className="store-stats__eyebrow"><AnalyticsIcon name="eye" />Külastused</span>
          <span className="store-stats__headline"><strong>{value('visits')}</strong>{matching && <Trend current={matching.current.visits} previous={matching.previous.visits} available={matching.comparison_available} />}</span>
        </button>
        {matching ? <StoreAnalyticsChart key={`${days}-${metric}`} label={labels[metric]} money={metric === 'sales'} points={matching.daily.map((day) => ({ date: day.date, value: day[metric] }))} />
          : <div className="store-stats__chart-placeholder" role="status">{loading ? 'Laen statistikat…' : 'Graafik pole saadaval'}</div>}
        <div className="store-stats__metrics">
          {(['orders', 'sales'] as const).map((key) => <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)} aria-label={`${labels[key]}: ${value(key)}. Kuva graafikul`}>
            <span>{labels[key]}<span aria-hidden="true">↗</span></span><strong>{value(key)}</strong>
            {matching && <Trend current={matching.current[key]} previous={matching.previous[key]} available={matching.comparison_available} />}
          </button>)}
        </div>
        {matching && <>
          {new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn' }).format(new Date(matching.tracking_started_at)) >= matching.from_date && <p className="store-stats__history">Külastuste ajalugu alates {new Date(matching.tracking_started_at).toLocaleDateString('et-EE', { timeZone: 'Europe/Tallinn' })}</p>}
          <section className="store-stats__section" aria-labelledby={`${titleId}-products`}>
            <div className="store-stats__section-heading"><h3 id={`${titleId}-products`}>Kõige vaadatumad</h3><span>Vaatamised</span></div>
            {matching.products.length ? <div className="store-stats__products">{matching.products.map((product, index) => <div key={product.id}>
              <button type="button" className="store-stats__product" aria-expanded={productId === product.id} aria-controls={productId === product.id ? productDetailId : undefined} onClick={() => setProductId((id) => id === product.id ? null : product.id)}>
                <span className="store-stats__thumbnail">{product.image ? <img src={product.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <AnalyticsIcon name="bag" />}</span>
                <span className="store-stats__product-copy"><span>{product.name}</span><i><b style={{ '--bar-width': `${product.views / Math.max(1, matching.products[0].views) * 100}%`, '--bar-delay': `${index * 45}ms` } as CSSProperties} /></i></span>
                <strong>{number.format(product.views)}</strong><AnalyticsIcon name="arrow" />
              </button>
              {selectedProduct?.id === product.id && <div className="store-stats__product-detail" id={productDetailId}>
                <StoreAnalyticsChart key={`${days}-${product.id}`} label="Toote vaatamised" points={product.daily.map((day) => ({ date: day.date, value: day.views }))} />
              </div>}
            </div>)}</div> : <p className="store-stats__empty">Tootevaatamised ilmuvad siia.</p>}
          </section>
          <section className="store-stats__section" aria-labelledby={`${titleId}-sources`}>
            <div className="store-stats__section-heading"><h3 id={`${titleId}-sources`}>Kust tullakse</h3><span>Külastused</span></div>
            {matching.sources.length ? <div className="store-stats__sources">{matching.sources.map((source, index) => <div key={source.label} className="store-stats__source">
              <div><span>{source.label}</span><span><b>{number.format(source.visits)}</b><small>{Math.round(source.visits / Math.max(1, matching.current.visits) * 100)}%</small></span></div>
              <i><b style={{ '--bar-width': `${source.visits / Math.max(1, matching.current.visits) * 100}%`, '--bar-delay': `${index * 45}ms` } as CSSProperties} /></i>
            </div>)}</div> : <p className="store-stats__empty">Esimese külastusega ilmub ka liikluse allikas.</p>}
          </section>
        </>}
      </div>
      <footer className="store-stats__footer">
        <span role="status">{loading ? 'Uuendan…' : matching ? `Uuendatud ${new Date(matching.updated_at).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Tallinn' })}` : 'Andmed pole saadaval'}</span>
        <details><summary aria-label="Statistika selgitused">i</summary><div>
          <p>Külastus algab poe avamisel. Lehe uuesti laadimine, 30 minutit tegevusetust või uus Eesti kalendripäev alustab uut külastust. Sama toodet loetakse ühe külastuse jooksul üks kord.</p>
          <p>Sisselogitud kaupmeeste ja eelvaadete külastusi ei arvestata. Külastused ei võrdu erinevate inimeste arvuga.</p>
          <p>Tellimused on tasutud pärisostud, täielikult tagastatud ostud on välja jäetud. Müük sisaldab tarnet ja sellest on lahutatud tagastused. Testmakseid ei arvestata. Ostud on makse kuupäeva järgi; vanemate maksete puhul kasutatakse tellimuse kuupäeva.</p>
          <p>Perioodid on Eesti aja järgi. Tänane päev on pooleli; võrdlus lõpeb varasemas perioodis sama kellaajaga. Külastuste võrdlus ilmub piisava ajaloo kogunemisel.</p>
          <p>Liikluse allikas põhineb viitajal või tuntud kampaaniamärgendil. Puuduva viitaja korral kuvatakse „Otse / teadmata”. Andmed uuenevad avamisel, perioodi vahetamisel või värskendusnupust.</p>
        </div></details>
      </footer>
    </div>
  </dialog>
}
