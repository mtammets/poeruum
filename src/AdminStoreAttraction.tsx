import { useId, useMemo, useState, type CSSProperties } from 'react'
import Icon, { type IconName } from './AdminUserIcon'
import { attractionPlot, attractionTrend, packAttractionBubbles } from './lib/storeAttraction'
import useStoreAttraction from './useStoreAttraction'
import './adminStoreAttraction.css'

const number = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 })
const percent = (value: number | null) => value === null ? '—' : `${number.format(value)}%`
const trendMark = (trend: ReturnType<typeof attractionTrend>) => trend.label.includes('%') ? trend.label : trend.tone === 'unknown' ? '—' : trend.tone === 'up' ? '+' : '0%'

export default function AdminStoreAttraction() {
  const [days, setDays] = useState(7)
  const [retry, setRetry] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { report, loading, error, live, updatedIds } = useStoreAttraction(days, retry)
  const descriptionId = useId()
  const detailId = useId()
  const stores = useMemo(() => [...(report?.stores ?? [])].sort((a, b) => b.current.store_clicks - a.current.store_clicks
    || b.current.impressions - a.current.impressions || a.name.localeCompare(b.name, 'et')).slice(0, 8), [report])
  const bubbles = useMemo(() => packAttractionBubbles(stores.map((store) => ({ id: store.id, clicks: store.current.store_clicks }))), [stores])
  const selected = stores.find((store) => store.id === selectedId)
  const trend = report ? attractionTrend(report.current.store_clicks, report.previous.store_clicks, report.comparison_available) : null
  const selectedTrend = selected && report ? attractionTrend(selected.current.store_clicks, selected.previous.store_clicks, report.comparison_available) : null
  const connectionLabel = error ? 'Kuvan viimati laaditud andmeid. Värskenda.' : live ? 'Reaalajaühendus aktiivne' : 'Reaalajaühendus taastub'

  return <section className="overview-panel overview-attraction" aria-label="Poodide tõmbejõud" aria-busy={!report && loading}
    onKeyDown={(event) => { if (event.key === 'Escape') setSelectedId(null) }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse' && !event.currentTarget.contains(document.activeElement)) setSelectedId(null) }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSelectedId(null) }}>
    <header className="overview-panel__header"><h2>Poodide tõmbejõud</h2><div className="attraction-actions">
      <button type="button" className={`attraction-live${live && !error ? ' is-live' : ''}${error ? ' is-error' : ''}`} title={connectionLabel} aria-label={connectionLabel} onClick={() => setRetry((value) => value + 1)}><Icon name={error ? 'refresh' : 'pulse'} /></button>
      <a className="overview-open" href="/admin/kaubamaja" aria-label={report && report.stores.length > 8 ? `Ava kõigi ${report.stores.length} poe statistika` : 'Ava Kaubamaja statistika'}><Icon name="arrow" /></a>
    </div></header>
    <div className="attraction-toolbar">
      <div className="attraction-headline" role="group" aria-label={report ? `Kaubamajast poe avamisi: ${number.format(report.current.store_clicks)}` : 'Laen poe avamisi'} title="Kaubamajast poe avamised"><Icon name="cursor" /><strong>{report ? number.format(report.current.store_clicks) : '—'}</strong>
        {trend && <span className={`attraction-trend is-${trend.tone}`} aria-label={trend.label} title={`${trend.label} võrreldes eelmise ${days} päevaga. Tänane päev on pooleli.`}>{trendMark(trend)}</span>}
      </div>
      <div className="overview-range" role="group" aria-label="Poodide tõmbejõu periood">{([7, 30, 90] as const).map((value) => <button type="button" key={value} aria-label={`${value} päeva`} title={`${value} päeva`} aria-pressed={days === value} onClick={() => { setDays(value); setSelectedId(null) }}>{value}</button>)}</div>
    </div>
    <div className="attraction-stage">
      {!report ? <div className="attraction-placeholder" role="status" aria-label={error ? 'Kaubamaja andmeid ei saanud laadida' : 'Laen poodide tõmbejõudu'}>
        {error ? <button type="button" title="Proovi uuesti" aria-label="Proovi uuesti" onClick={() => setRetry((value) => value + 1)}><Icon name="refresh" /></button> : <span className="overview-loading" />}
      </div> : stores.length ? <div className="attraction-plot" role="group" aria-label="Poodide avamised mullikaardil" aria-describedby={descriptionId}>
        {bubbles.map((bubble, index) => {
          const store = stores[index]
          const change = attractionTrend(store.current.store_clicks, store.previous.store_clicks, report.comparison_available)
          return <button key={store.id} type="button" className={`attraction-bubble is-${change.tone}${store.current.store_clicks === 0 ? ' is-zero' : ''}${updatedIds.includes(store.id) ? ' is-updated' : ''}`}
            style={{ left: `${bubble.x / attractionPlot.width * 100}%`, top: `${bubble.y / attractionPlot.height * 100}%`, width: `${bubble.r * 2 / attractionPlot.width * 100}%` } as CSSProperties}
            aria-label={`${store.name}: ${number.format(store.current.store_clicks)} avamist, klikimäär ${store.current.ctr === null ? 'teadmata' : percent(store.current.ctr)}, ${change.label.toLocaleLowerCase('et')}`}
            aria-pressed={selected?.id === store.id} aria-controls={detailId}
            onClick={() => setSelectedId(store.id)} onFocus={() => setSelectedId(store.id)}
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') setSelectedId(store.id) }}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? stores.length - 1 : null
              if (next === null) return
              event.preventDefault()
              event.currentTarget.parentElement?.querySelectorAll('button')[Math.max(0, Math.min(stores.length - 1, next))]?.focus()
            }}>
            <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="attraction-bubble__track" cx="50" cy="50" r="46" />{store.current.ctr !== null && <circle className="attraction-bubble__arc" cx="50" cy="50" r="46" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, store.current.ctr))} 100`} transform="rotate(-90 50 50)" />}</svg>
            <span className="attraction-bubble__content" aria-hidden="true"><strong>{number.format(store.current.store_clicks)}</strong></span>
          </button>
        })}
      </div> : <div className="attraction-placeholder" role="status" aria-label="Avalikke poode ega selle perioodi poeandmeid veel pole"><Icon name="store" /><span aria-hidden="true">—</span></div>}
      {selected && selectedTrend && <div className="attraction-detail" id={detailId} role="group" aria-label={`${selected.name}: näitajad`} aria-live="polite" aria-atomic="true">
        <div className="attraction-detail__heading"><strong>{selected.name}</strong><span className={`attraction-trend is-${selectedTrend.tone}`} title={selectedTrend.label} aria-label={selectedTrend.label}>{trendMark(selectedTrend)}</span><button type="button" aria-label="Sulge poe näitajad" onClick={() => setSelectedId(null)}><Icon name="close" /></button></div>
        <div className="attraction-detail__metrics">{([
          ['eye', 'Näitamised', number.format(selected.current.impressions)],
          ['cursor', 'Avamised', number.format(selected.current.store_clicks)],
          ['percent', 'Klikimäär', percent(selected.current.ctr)],
        ] as [IconName, string, string][]).map(([icon, label, value]) => <span key={label} role="group" aria-label={`${label}: ${value}`} title={label}><Icon name={icon} /><b>{value}</b></span>)}</div>
        {!selected.is_published && <span className="attraction-unpublished" title="Praegu avaldamata" aria-label="Praegu avaldamata"><Icon name="alert" /></span>}
      </div>}
    </div>
    <details className="attraction-help"><summary title="Mullikaardi selgitus" aria-label="Mullikaardi selgitus"><Icon name="info" /></summary><div id={descriptionId}>
      <p>Mulli suurus näitab Kaubamajast poe avamisi, kaar klikimäära. Roheline: kasv; virsik: langus; lilla: muutuseta. Võrdluse puudumisel on mull neutraalne.</p>
      <p>Vali mull, et näha poe nime ning näitamisi, avamisi ja klikimäära. Kuvatud on kuni kaheksa enim avatud poodi.</p>
      <p>Andmed uuenevad uue sündmuse saabumisel. Tänane päev on pooleli.</p>
    </div></details>
  </section>
}
