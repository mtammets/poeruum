import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Icon, { type IconName } from './AdminUserIcon'
import { VisitBadge, VisitNumber } from './VisitFeedback'
import type { HomepageVisitFeedback } from './useHomepageVisitFeedback'
import type { AnalyticsDailyPoint, AnalyticsRange, HomepageAnalyticsDashboard } from './lib/adminDashboard'
import { ctaLabels, deviceLabels, durationBuckets, faqLabels, trafficDate, trafficDuration, trafficNumber as number, trafficPercent as percent } from './lib/trafficAnalytics'
import './adminAnalytics.css'

const metrics = [
  { key: 'sessions', label: 'Külastused', icon: 'eye', color: '#d0f578' },
  { key: 'signup_starts', label: 'Alustamised', icon: 'cursor', color: '#c3b1ed' },
  { key: 'accounts_created', label: 'Kontod', icon: 'users', color: '#9ed8e4' },
] as const
type Metric = typeof metrics[number]
type Detail = 'about' | 'audience' | 'engagement' | 'activation' | 'sources' | 'ctas' | 'faqs' | 'devices' | 'demo' | 'pricing'
const detailTitles: Record<Detail, string> = { about: 'Kuidas andmeid lugeda', audience: 'Külastused', engagement: 'Külastajate huvi', activation: 'Uute kontode edenemine', sources: 'Liikluse allikad', ctas: 'Poe loomise alustamised', faqs: 'Avatud küsimused', devices: 'Seadmed', demo: 'Näidispoe avamised', pricing: 'Hinnastuse vaatamised' }
const colorStyle = (color: string): CSSProperties => ({ '--traffic-color': color } as CSSProperties)

function IconButton({ icon, label, onClick, className = '' }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return <button type="button" className={`traffic-icon-button ${className}`} aria-label={label} title={label} onClick={onClick}><Icon name={icon} /></button>
}

function DetailDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => { dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className="traffic-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')]
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onClick={(event) => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }
  }}><header><h2 id={titleId}>{title}</h2><IconButton icon="close" label="Sulge üksikasjad" onClick={onClose} /></header><div className="traffic-dialog__body">{children}</div></dialog>
}

function TrafficChart({ daily, metric, arrival }: { daily: AnalyticsDailyPoint[]; metric: Metric; arrival: boolean }) {
  const gradientId = useId()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  if (!daily.length) return <div className="traffic-empty" role="status" aria-label="Päevased andmed puuduvad"><Icon name="pulse" /><span>—</span></div>
  const max = Math.max(1, ...daily.map((day) => day[metric.key]))
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const ceiling = Math.max(2, Math.ceil(max / magnitude) * magnitude)
  const points = daily.map((day, index) => ({ x: daily.length === 1 ? 400 : index / (daily.length - 1) * 800, y: 180 - day[metric.key] / ceiling * 168, day }))
  const selected = selectedIndex === null ? null : points[Math.min(selectedIndex, points.length - 1)]
  const last = points.at(-1)!
  const line = points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ')
  const dateIndexes = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])]
  return <div className={`traffic-chart${arrival ? ' is-arriving' : ''}`}>
    <div className="traffic-chart__readout" aria-live="polite" aria-atomic="true">{selected ? <><time>{trafficDate(selected.day.date)}</time><b>{number.format(selected.day[metric.key])}</b></> : <><span>{metric.label}</span><span>{daily.length} p</span></>}</div>
    <div className="traffic-chart__plot" tabIndex={0} role="slider" aria-label={`${metric.label} päevade kaupa`} aria-valuemin={1} aria-valuemax={daily.length} aria-valuenow={(selectedIndex ?? daily.length - 1) + 1} aria-valuetext={`${trafficDate((selected ?? last).day.date)}: ${(selected ?? last).day[metric.key]} ${metric.label.toLocaleLowerCase('et')}`}
      onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setSelectedIndex(Math.max(0, Math.min(daily.length - 1, Math.round((event.clientX - rect.left) / rect.width * (daily.length - 1))))) }}
      onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setSelectedIndex(Math.max(0, Math.min(daily.length - 1, Math.round((event.clientX - rect.left) / rect.width * (daily.length - 1))))) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse' && document.activeElement !== event.currentTarget) setSelectedIndex(null) }}
      onFocus={() => setSelectedIndex((index) => index ?? daily.length - 1)} onBlur={() => setSelectedIndex(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return
        event.preventDefault()
        setSelectedIndex((index) => event.key === 'Escape' ? null : event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1 : Math.max(0, Math.min(daily.length - 1, (index ?? daily.length - 1) + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))))
      }}>
      <div className="traffic-chart__grid" aria-hidden="true">{[ceiling, ceiling / 2, 0].map((value) => <span key={value}>{number.format(value)}</span>)}</div>
      <svg viewBox="0 0 800 192" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={metric.color} stopOpacity=".3" /><stop offset="100%" stopColor={metric.color} stopOpacity=".01" /></linearGradient></defs>
        {points.length > 1 && <path d={`${line} L800,180 L0,180 Z`} fill={`url(#${gradientId})`} />}
        <path className="traffic-chart__line" d={line} stroke={metric.color} strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="traffic-chart__point" style={{ left: `${(selected ?? last).x / 800 * 100}%`, top: `${(selected ?? last).y / 192 * 100}%` }} />
      {selected && <span className="traffic-chart__cursor" style={{ left: `${selected.x / 800 * 100}%` }} />}
    </div>
    <div className="traffic-chart__dates" aria-hidden="true">{dateIndexes.map((index) => <time key={index}>{trafficDate(daily[index].date)}</time>)}</div>
  </div>
}

type Props = { data: HomepageAnalyticsDashboard; range: AnalyticsRange; loading: boolean; error: string; stale: boolean; live: boolean; feedback: HomepageVisitFeedback; onRangeChange: (range: AnalyticsRange) => void; onRefresh: () => void }

export default function AdminAnalytics({ data, range, loading, error, stale, live, feedback, onRangeChange, onRefresh }: Props) {
  const [metricKey, setMetricKey] = useState<Metric['key']>('sessions')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [breakdown, setBreakdown] = useState<'sources' | 'ctas' | 'faqs'>('sources')
  const [chosenDevice, setChosenDevice] = useState<string | null>(null)
  const metric = metrics.find((item) => item.key === metricKey)!
  const known = !loading && !error && data.range_days === range
  const value = (n: number) => known ? number.format(n) : '—'
  const ratio = (n: number, total: number) => known ? percent(n, total) : '—'
  const notice = metricKey === 'sessions' ? feedback.notice : metricKey === 'accounts_created' ? feedback.accountNotice : null
  const deviceColors = { mobile: '#c3b1ed', desktop: '#d0f578', tablet: '#9ed8e4' }
  const devices = (['mobile', 'desktop', 'tablet'] as const).map((device) => ({ device, sessions: data.devices.find((row) => row.device === device)?.sessions ?? 0 }))
  const deviceTotal = devices.reduce((sum, row) => sum + row.sessions, 0)
  const selectedDevice = devices.find((row) => row.device === chosenDevice) ?? [...devices].sort((a, b) => b.sessions - a.sessions)[0]
  const ranked = breakdown === 'sources' ? data.sources.map((row) => ({ label: row.source, sessions: row.sessions })) : data[breakdown].map((row) => ({ ...row, label: (breakdown === 'ctas' ? ctaLabels : faqLabels)[row.label] ?? row.label }))
  const rankedRows = [...ranked].sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label, 'et'))
  const rankTotal = breakdown === 'ctas' ? data.signup_starts : breakdown === 'sources' ? data.sessions : ranked.reduce((sum, row) => sum + row.sessions, 0)
  const stages: { label: string; description: string; count: number; icon: IconName; color: string }[] = [
    { label: 'Kontod', description: 'Perioodil loodud kontod', count: data.accounts_created, icon: 'users', color: '#9ed8e4' },
    { label: 'Pood', description: 'Neist poe andmetega kontod', count: data.stores_started, icon: 'store', color: '#c3b1ed' },
    { label: 'Maksed', description: 'Neist ühendatud maksetega kontod', count: data.payments_connected, icon: 'card', color: '#aec78c' },
    { label: 'Avalik', description: 'Neist avaldatud poega kontod', count: data.stores_published, icon: 'check', color: '#d0f578' },
  ]
  const connectionLabel = stale || error ? 'Värskendamine ebaõnnestus. Proovi uuesti.' : live ? 'Reaalajaühendus aktiivne' : 'Reaalajaühendus taastub'

  const detailContent = () => {
    switch (detail) {
      case 'about': return <><p>Külastused on avalehe lehesessioonid, mitte unikaalsed inimesed. Avalehe sündmused on anonüümsed ning neid ei seota kontodega.</p><p>Uute kontode kaart näitab valitud perioodil loodud kontode praegust seisu. See ei ole külastusest ostuni jälgitav lehter.</p><p>7 / 30 / 90 on Eesti kalendripäevad koos poolelioleva tänase päevaga. Varasema perioodi võrdlust siin ei näidata.</p><p>Andmed uuenevad salvestatud sündmuste saabumisel. Ühenduse katkedes jäävad viimased andmed nähtavale ja neid kontrollitakse iga 15 sekundi järel.</p><p>Aktiivne aeg koguneb ainult nähtaval ja fookuses oleval avalehel, kuni 30 minutit sessiooni kohta. Juhuslik sessioonitunnus püsib brauseri mälus; seda ei seota konto, e-posti ega IP-aadressiga. Toorandmed kustutatakse 90 päeva järel.</p></>
      case 'audience': return <><dl><div><dt>Külastused</dt><dd>{value(data.sessions)}</dd></div><div><dt>Anonüümsed sessioonid</dt><dd>{value(data.anonymous_sessions)}</dd></div><div><dt>Kaupmehe sessioonid</dt><dd>{value(data.merchant_sessions)}</dd></div><div><dt>Poe loomist alustanud sessioonid</dt><dd>{value(data.signup_starts)} · {ratio(data.signup_starts, data.sessions)}</dd></div><div><dt>Avalehel mõõdetud registreerumised</dt><dd>{value(data.tracked_accounts)}</dd></div></dl><p>Üks inimene võib alustada mitu sessiooni. Registreeritud kontode arv tuleb eraldi kontode andmetest.</p></>
      case 'engagement': return <><dl><div><dt>Keskmine aktiivne aeg</dt><dd>{known && data.measured_sessions ? trafficDuration(data.average_engaged_seconds) : '—'}</dd></div><div><dt>Vähemalt 10 s aktiivsed</dt><dd>{value(data.engaged_sessions)} / {value(data.measured_sessions)} · {ratio(data.engaged_sessions, data.measured_sessions)}</dd></div>{durationBuckets.map((bucket) => <div key={bucket.key}><dt>{bucket.label}</dt><dd>{value(data.engagement_buckets.find((row) => row.bucket === bucket.key)?.sessions ?? 0)}</dd></div>)}</dl><p>Osakaalu ja keskmise aluseks on ainult mõõdetud sessioonid. Mõõtmata aeg ei tähenda null sekundit.</p></>
      case 'activation': return <><dl>{stages.map((stage) => <div key={stage.label}><dt>{stage.description}</dt><dd>{value(stage.count)} · {ratio(stage.count, data.accounts_created)}</dd></div>)}</dl><p>Kõik osakaalud on sama perioodi uutest kontodest. Poe, maksete ja avaldamise staatused on hetkeseisud; need ei tõenda sammude läbimise järjekorda ega seost konkreetse avalehe külastusega.</p></>
      case 'sources': return <>{data.sources.length ? <dl>{data.sources.map((row) => <div key={row.source}><dt>{row.source}<small>{known && row.measured_sessions ? trafficDuration(row.average_engaged_seconds) : '—'} · {ratio(row.engaged_sessions, row.measured_sessions)} kaasatud</small></dt><dd>{value(row.sessions)}<small>{ratio(row.sessions, data.sessions)}</small></dd></div>)}</dl> : <p>Allikaid veel pole.</p>}<p>Allikas on UTM-allikas, viitaja domeen või „Otse“. Aruanne sisaldab kuni kaheksat suurimat allikat.</p></>
      case 'ctas': case 'faqs': return <>{data[detail].length ? <dl>{data[detail].map((row) => <div key={row.label}><dt>{(detail === 'ctas' ? ctaLabels : faqLabels)[row.label] ?? row.label}</dt><dd>{value(row.sessions)}</dd></div>)}</dl> : <p>Tegevusi veel pole.</p>}<p>{detail === 'ctas' ? 'Poe loomise nuppude asukohad. Sama sessioon võib kasutada mitut nuppu, seega ridade summa võib ületada alustamiste arvu.' : 'Küsimuse avanud sessioonide arv. Üks sessioon võib avada mitu küsimust.'}</p></>
      case 'devices': return <dl>{devices.map((row) => <div key={row.device}><dt>{deviceLabels[row.device]}</dt><dd>{value(row.sessions)} · {ratio(row.sessions, deviceTotal)}</dd></div>)}</dl>
      case 'demo': case 'pricing': return <><strong className="traffic-dialog__number">{value(detail === 'demo' ? data.demo_opens : data.pricing_views)}</strong><p>{detail === 'demo' ? 'Sessioonid, mille jooksul avati näidispood.' : 'Sessioonid, mille jooksul vaadati hinnastuse jaotist.'} {ratio(detail === 'demo' ? data.demo_opens : data.pricing_views, data.sessions)} kõigist külastustest.</p></>
    }
  }

  return <section className="admin-analytics traffic-dashboard" aria-label="Külastatavuse ülevaade" aria-busy={loading}>
    <header className="traffic-topbar"><h1>Külastatavus</h1><div className="traffic-topbar__actions">
      <div className="traffic-range" role="group" aria-label="Ajavahemik">{([7, 30, 90] as const).map((days) => <button type="button" key={days} aria-label={`${days} päeva`} title={`${days} päeva`} aria-pressed={range === days} onClick={() => onRangeChange(days)}>{days}<span aria-hidden="true"> p</span></button>)}</div>
      <IconButton icon={stale || error ? 'refresh' : 'pulse'} label={`${connectionLabel} Uuenda andmeid`} onClick={onRefresh} className={`traffic-connection${live && !stale && !error ? ' is-live' : ''}${stale || error ? ' is-stale' : ''}${loading ? ' is-loading' : ''}`} />
      <IconButton icon="info" label="Kuidas andmeid lugeda" onClick={() => setDetail('about')} />
    </div></header>
    {error && <div className="traffic-error" role="alert"><Icon name="alert" /><span>Andmed pole saadaval</span><IconButton icon="refresh" label="Proovi uuesti" onClick={onRefresh} /></div>}
    <div className={`traffic-grid${!known ? ' is-pending' : ''}`}>
      <section className={`traffic-card traffic-hero${feedback.notice ? ' has-new-visits' : ''}`} style={colorStyle(metric.color)} aria-label="Päevane trend">
        <header><h2>{metric.label}</h2><div className="traffic-tabs" role="group" aria-label="Trendi näitaja">{metrics.map((item) => <button type="button" key={item.key} aria-label={item.label} title={item.label} aria-pressed={item.key === metricKey} style={colorStyle(item.color)} onClick={() => setMetricKey(item.key)}><Icon name={item.icon} /></button>)}</div></header>
        <div className="traffic-hero__headline"><strong><VisitNumber value={value(data[metricKey])} notice={notice} /></strong><VisitBadge notice={notice} /><IconButton icon="arrow" label="Külastuste üksikasjad" onClick={() => setDetail('audience')} /></div>
        {known ? <TrafficChart key={`${range}-${metricKey}`} daily={data.daily} metric={metric} arrival={Boolean(notice)} /> : <div className="traffic-empty" role="status" aria-label={loading ? 'Laen külastatavust' : 'Külastatavus teadmata'}><Icon name={loading ? 'pulse' : 'alert'} /></div>}
        <div className="traffic-totals" role="group" aria-label="Perioodi näitajad">{metrics.map((item) => <button type="button" key={item.key} aria-label={`${item.label}: ${value(data[item.key])}`} aria-pressed={metricKey === item.key} style={colorStyle(item.color)} onClick={() => setMetricKey(item.key)}><i /><span>{item.label}</span><b>{value(data[item.key])}</b></button>)}</div>
      </section>

      <section className="traffic-card traffic-engagement" aria-label="Külastajate huvi"><header><h2>Huvi</h2><IconButton icon="arrow" label="Huvi üksikasjad" onClick={() => setDetail('engagement')} /></header>
        <div className="traffic-engagement__body"><button type="button" className="traffic-ring traffic-ring--engagement" aria-label={`Vähemalt 10 sekundit aktiivsed: ${ratio(data.engaged_sessions, data.measured_sessions)}`} onClick={() => setDetail('engagement')}>
          <svg viewBox="0 0 180 180" aria-hidden="true"><circle className="traffic-ring__track" cx="90" cy="90" r="72" />{known && data.measured_sessions > 0 && data.engaged_sessions > 0 && <circle className="traffic-ring__value" cx="90" cy="90" r="72" pathLength="100" strokeDasharray={`${Math.min(100, data.engaged_sessions / data.measured_sessions * 100)} 100`} transform="rotate(-90 90 90)" />}</svg>
          <span><strong>{ratio(data.engaged_sessions, data.measured_sessions)}</strong><small>10+ s</small></span></button>
          <button type="button" className="traffic-time" onClick={() => setDetail('engagement')} aria-label={`Keskmine aktiivne aeg: ${known && data.measured_sessions ? trafficDuration(data.average_engaged_seconds) : 'teadmata'}`}><Icon name="clock" /><strong>{known && data.measured_sessions ? trafficDuration(data.average_engaged_seconds) : '—'}</strong><span>Aktiivne aeg</span></button>
        </div>
        <button type="button" className="traffic-duration" aria-label="Aktiivse aja jaotus" onClick={() => setDetail('engagement')}><span className="traffic-duration__bar" aria-hidden="true">{durationBuckets.map((bucket) => <i key={bucket.key} style={{ background: bucket.color, width: `${known && data.measured_sessions ? (data.engagement_buckets.find((row) => row.bucket === bucket.key)?.sessions ?? 0) / data.measured_sessions * 100 : 0}%` }} />)}</span><span className="traffic-duration__legend">{durationBuckets.map((bucket) => <span key={bucket.key}><i style={{ background: bucket.color }} />{bucket.label}</span>)}</span></button>
      </section>

      <section className="traffic-card traffic-activation" aria-label="Uute kontode edenemine"><header><h2>Uued kontod</h2><IconButton icon="info" label="Kontode edenemise selgitus" onClick={() => setDetail('activation')} /></header>
        <div className="traffic-activation__headline"><span><Icon name="store" /><strong>{ratio(data.stores_published, data.accounts_created)}</strong></span><span>avaliku poeni</span></div>
        <div className="traffic-stages">{stages.map((stage, index) => <button type="button" key={stage.label} style={colorStyle(stage.color)} aria-label={`${stage.description}: ${value(stage.count)}, ${ratio(stage.count, data.accounts_created)}`} onClick={() => setDetail('activation')} className={index === 0 && feedback.accountNotice ? 'has-new-accounts' : ''}>
          <span className="traffic-stages__track" aria-hidden="true"><i style={{ height: `${known && data.accounts_created ? Math.min(100, stage.count / data.accounts_created * 100) : 0}%` }} /><Icon name={stage.icon} /></span>
          <strong><VisitNumber value={value(stage.count)} notice={index === 0 ? feedback.accountNotice : null} /></strong>{index === 0 && <VisitBadge notice={feedback.accountNotice} />}<span className="traffic-stages__label">{stage.label}</span>
        </button>)}</div>
      </section>

      <section className="traffic-card traffic-acquisition" aria-label="Liikluse ja tegevuste jaotus"><header><h2>{breakdown === 'sources' ? 'Allikad' : breakdown === 'ctas' ? 'Alustamised' : 'Küsimused'}</h2><div className="traffic-tabs" role="group" aria-label="Jaotuse valik">{([['sources', 'globe', 'Allikad'], ['ctas', 'cursor', 'Alustamised'], ['faqs', 'help', 'Küsimused']] as const).map(([tab, icon, label]) => <button type="button" key={tab} title={label} aria-label={label} aria-pressed={breakdown === tab} onClick={() => setBreakdown(tab)}><Icon name={icon} /></button>)}</div></header>
        <div className="traffic-ranking">{known && rankedRows.length ? rankedRows.slice(0, 4).map((row, index) => <button type="button" key={row.label} onClick={() => setDetail(breakdown)} aria-label={`${row.label}: ${number.format(row.sessions)}, ${percent(row.sessions, rankTotal)}`} title={row.label}>
          <span className="traffic-ranking__position">{String(index + 1).padStart(2, '0')}</span><span className="traffic-ranking__name">{row.label}</span><b>{number.format(row.sessions)}</b><span className="traffic-ranking__bar" aria-hidden="true"><i style={{ width: `${rankTotal ? Math.min(100, row.sessions / rankTotal * 100) : 0}%` }} /></span>
        </button>) : <div className="traffic-empty" role="status" aria-label={known ? 'Selle jaotuse andmeid veel pole' : 'Jaotuse andmed teadmata'}><Icon name={breakdown === 'sources' ? 'globe' : breakdown === 'ctas' ? 'cursor' : 'help'} /><span>—</span></div>}</div>
        <button type="button" className="traffic-more" onClick={() => setDetail(breakdown)} aria-label={`Ava ${detailTitles[breakdown].toLocaleLowerCase('et')}`}><span>{known && rankedRows.length > 4 ? `+${rankedRows.length - 4}` : ''}</span><Icon name="arrow" /></button>
      </section>

      <section className="traffic-card traffic-devices" aria-label="Seadmed ja avastamine"><header><h2>Seadmed</h2><IconButton icon="arrow" label="Seadmete üksikasjad" onClick={() => setDetail('devices')} /></header>
        <div className="traffic-devices__body"><button type="button" className="traffic-ring traffic-ring--devices" aria-label={`${deviceLabels[selectedDevice.device]}: ${ratio(selectedDevice.sessions, deviceTotal)}`} onClick={() => setDetail('devices')}>
          <svg viewBox="0 0 180 180" aria-hidden="true"><circle className="traffic-ring__track" cx="90" cy="90" r="72" />{devices.map((row, index) => {
            const share = known && deviceTotal ? row.sessions / deviceTotal * 100 : 0
            const offset = known && deviceTotal ? devices.slice(0, index).reduce((sum, item) => sum + item.sessions, 0) / deviceTotal * 100 : 0
            const arc = share - Math.min(1.5, share * .15)
            return share > 0 && <circle key={row.device} className="traffic-ring__segment" cx="90" cy="90" r="72" pathLength="100" stroke={deviceColors[row.device]} strokeDasharray={`${arc} ${100 - arc}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />
          })}</svg><span><Icon name={selectedDevice.device} /><strong>{ratio(selectedDevice.sessions, deviceTotal)}</strong></span></button>
          <div className="traffic-device-picker" role="group" aria-label="Seadme valik">{devices.map((row) => <button type="button" key={row.device} aria-label={`${deviceLabels[row.device]}: ${value(row.sessions)}`} aria-pressed={selectedDevice.device === row.device} title={deviceLabels[row.device]} style={colorStyle(deviceColors[row.device])} onClick={() => setChosenDevice(row.device)}><Icon name={row.device} /><b>{value(row.sessions)}</b></button>)}</div>
        </div>
        <div className="traffic-discovery"><button type="button" aria-label={`Näidispoe avamised: ${value(data.demo_opens)}`} title="Näidispoe avamised" onClick={() => setDetail('demo')}><Icon name="play" /><strong>{value(data.demo_opens)}</strong></button><button type="button" aria-label={`Hinnastuse vaatamised: ${value(data.pricing_views)}`} title="Hinnastuse vaatamised" onClick={() => setDetail('pricing')}><Icon name="card" /><strong>{value(data.pricing_views)}</strong></button></div>
      </section>
    </div>
    {detail && <DetailDialog title={detailTitles[detail]} onClose={() => setDetail(null)}>{detailContent()}</DetailDialog>}
  </section>
}
