import { useEffect, useRef, useState } from 'react'
import { campaignDate as date, campaignDuration as duration, campaignMoney as money, campaignNumber as number, campaignPercent as percent, downloadCampaignCsv, fetchWoodpeckerReport, type WoodpeckerRange, type WoodpeckerReport } from './lib/woodpeckerAnalytics'
import { birdImage } from './themes/black-friday/krukHatMotion'
import './adminWoodpecker.css'

const surfaces = [{ key: 'directory', name: 'Kaubamaja', url: 'kaubamaja.poeruum.ee', color: '#ef6453', icon: 'shop' },
  { key: 'homepage', name: 'Krük Krüki koduleht', url: 'kruk-kruk.ee', color: '#b5bb8a', icon: 'home' },
  { key: 'store', name: 'Krük Krüki e-pood', url: 'kruk-kruk.poeruum.ee', color: '#e6b875', icon: 'bag' }] as const
const ranges: { value: WoodpeckerRange; label: string }[] = [{ value: 'all', label: 'Kogu kampaania' }, { value: 'today', label: 'Täna' }, { value: '24h', label: '24 tundi' }, { value: '7d', label: '7 päeva' }]
const deviceName: Record<string, string> = { mobile: 'Telefon', tablet: 'Tahvel', desktop: 'Arvuti' }
function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'shop' ? <><path d="M3 10h18l-2-6H5l-2 6ZM5 10v10h14V10M9 20v-6h6v6M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0" /></> : name === 'home' ? <><path d="m3 11 9-8 9 8M5 9v11h14V9M9 20v-7h6v7" /></> : name === 'bag' ? <><path d="M5 7h14l1 14H4L5 7ZM8 8V6a4 4 0 0 1 8 0v2" /></> : name === 'game' ? <><path d="M7 7h10c4 0 6 12 2 12l-4-4H9l-4 4C1 19 3 7 7 7ZM6 11h4M8 9v4M16 11h.01M18 13h.01" /></> : name === 'refresh' ? <><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" /></> : name === 'download' ? <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></> : <><path d="M4 18V9m8 9V4m8 14v-6M2 21h20" /></>}</svg>
}
function Bars({ rows, total }: { rows: { label: string; visits: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map(row => row.visits))
  return <div className="woodpecker-bars">{rows.length ? rows.map(row => <div key={row.label}><div><span>{deviceName[row.label] ?? row.label}</span><b>{number(row.visits)} <small>{percent(row.visits, total)}</small></b></div><span className="woodpecker-bars__track"><i style={{ width: `${row.visits / max * 100}%` }} /></span></div>) : <div className="woodpecker-empty">Andmeid veel pole</div>}</div>
}
function Traffic({ data }: { data: WoodpeckerReport }) {
  const [selected, setSelected] = useState<number | null>(null)
  const max = Math.max(1, ...data.timeline.map(t => t.directory + t.homepage + t.store))
  const row = selected === null ? null : data.timeline[selected]
  return <section className="woodpecker-panel woodpecker-traffic">
    <div className="woodpecker-panel__heading"><div><span className="woodpecker-eyebrow">KOLM KESKKONDA</span><h2>Külastuste rütm</h2></div><span>{data.bucket === 'hour' ? 'Tundide kaupa' : 'Päevade kaupa'} · Eesti aeg</span></div>
    <div className="woodpecker-legend">{surfaces.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    {row && <div className="woodpecker-chart-value" role="status"><b>{date(row.time, true)}</b>{surfaces.map(s => <span key={s.key}>{s.name} <strong>{row.measured ? number(row[s.key]) : '—'}</strong></span>)}</div>}
    <div className="woodpecker-chart" aria-label="Külastused ajas">
      <div className="woodpecker-chart__axis"><span>{number(max)}</span><span>{number(Math.round(max / 2))}</span><span>0</span></div>
      <div className="woodpecker-chart__plot">{data.timeline.map((point, i) => <button type="button" key={point.time} className={!point.measured ? 'is-unmeasured' : undefined}
        aria-label={`${date(point.time, true)}: ${point.measured ? surfaces.map(s => `${s.name} ${point[s.key]}`).join(', ') : 'Mõõtmine puudub'}`}
        onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
        {surfaces.map(s => <i key={s.key} style={{ height: `${point[s.key] / max * 100}%`, background: s.color }} />)}
      </button>)}</div>
    </div>
    <div className="woodpecker-chart__labels">{[data.timeline[0], data.timeline[Math.floor(data.timeline.length / 2)], data.timeline.at(-1)].map((p, i) => <span key={i}>{p ? date(p.time, data.bucket === 'hour') : '—'}</span>)}</div>
  </section>
}
export default function AdminWoodpecker({ active = true }: { active?: boolean }) {
  const [range, setRange] = useState<WoodpeckerRange>('all')
  const [page, setPage] = useState(0), [search, setSearch] = useState(''), [query, setQuery] = useState('')
  const [data, setData] = useState<WoodpeckerReport | null>(null), [error, setError] = useState('')
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [exporting, setExporting] = useState(false)
  const exportController = useRef<AbortController | null>(null)
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(0) }, 300); return () => clearTimeout(timer) }, [search])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let busy = false
    const load = async () => {
      if (busy || document.hidden) return
      busy = true; setLoading(true)
      try { const report = await fetchWoodpeckerReport(range, page, query, controller.signal); if (!controller.signal.aborted) { setData(report); setError('') } }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Andmed pole saadaval.') }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => void load(), 30000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [range, page, query, revision, active])
  useEffect(() => () => exportController.current?.abort(), [])
  const exportPlayers = async () => {
    if (!data || exporting) return
    const controller = new AbortController(); exportController.current = controller; setExporting(true)
    try {
      const rows: (string | number | null)[][] = [['Mängija ID', 'Ostja nimi', 'Mänge', 'Mütse', 'Rekord', 'Mänguaeg (s)', 'Viimati (Eesti aeg)', 'Seade', 'Allikas', 'Tasutud tellimusi', 'Müügitulu (€)']]
      let next = 0
      do {
        const report = await fetchWoodpeckerReport(range, next, query, controller.signal, data.updated_at)
        rows.push(...report.players.map(p => [p.visitor_id, p.customer_name, p.games, p.hats, p.best, p.seconds, date(p.last_seen, true), deviceName[p.device], p.source, p.orders, p.sales]))
        next++
        if (next * 25 >= report.player_count) break
      } while (!controller.signal.aborted)
      if (!controller.signal.aborted) downloadCampaignCsv(rows, 'musta-rahni-mangijad.csv')
    } catch { if (!controller.signal.aborted) setError('Mängijate eksport ebaõnnestus. Proovi uuesti.') }
    finally { setExporting(false) }
  }
  const exportSummary = () => {
    if (!data) return
    downloadCampaignCsv([['Musta rähni päevad', date(data.from, true), date(data.to, true)], ['Näitaja', 'Väärtus'],
      ['Külastusi', data.totals.visits], ['Mängijaid', data.totals.players], ['Mänge', data.totals.games], ['Kogutud mütse', data.totals.hats], ['Tasutud tellimusi', data.totals.orders], ['Müügitulu (€)', data.totals.sales], ['Tagastatud (€)', data.totals.refunds], [],
      ['Keskkond', 'Külastusi', 'Lehesessioone', 'Klikke', 'Keskmine aeg (s)'], ...data.surfaces.map(s => [surfaces.find(x => x.key === s.surface)!.name, s.visits, s.visitors, s.clicks, s.seconds]), [],
      ['Eesti aeg', 'Kaubamaja', 'Koduleht', 'E-pood', 'Mõõdetud'], ...data.timeline.map(t => [date(t.time, true), t.measured ? t.directory : null, t.measured ? t.homepage : null, t.measured ? t.store : null, t.measured ? 'Jah' : 'Ei'])], 'musta-rahni-statistika.csv')
  }
  const metric = (name: string) => data?.actions.find(a => a.label === name)?.sessions ?? 0
  const events = (name: string) => data?.actions.find(a => a.label === name)?.events ?? 0
  const t = data?.totals
  const phase = data && Date.parse(data.updated_at) < Date.parse(data.starts_at) ? 'Algab peagi' : data?.ends_at && Date.parse(data.updated_at) >= Date.parse(data.ends_at) ? 'Lõppenud' : 'Kampaania periood'
  return <div className="woodpecker" aria-busy={loading}>
    <header className="woodpecker-header"><div><span className="woodpecker-eyebrow">KAMPAANIA ÜLEVAADE</span><h1>Musta rähni päevad<span>.</span></h1><div className="woodpecker-meta"><span className="woodpecker-status"><i />{phase}</span><span>04.11.2026 · 06.00{data?.ends_at ? ` — ${date(data.ends_at, true)}` : ''}</span></div></div><img src={birdImage} alt="" /></header>
    <div className="woodpecker-toolbar"><div className="woodpecker-ranges" aria-label="Statistika periood">{ranges.map(r => <button type="button" key={r.value} aria-pressed={range === r.value} onClick={() => { setRange(r.value); setPage(0); setData(null) }}>{r.label}</button>)}</div><div className="woodpecker-tools"><span>{data ? `${date(data.updated_at, true)}` : 'Laadin…'}</span><button type="button" aria-label="Uuenda statistikat" disabled={loading} onClick={() => setRevision(v => v + 1)}><Icon name="refresh" /></button><button type="button" disabled={!data} onClick={exportSummary}><Icon name="download" />CSV</button></div></div>
    {error && <div className="woodpecker-error" role="alert">{error} <button type="button" onClick={() => setRevision(v => v + 1)}>Proovi uuesti</button></div>}
    {!data ? <div className="woodpecker-loading" role="status">{loading ? 'Laadin kampaania statistikat…' : 'Statistika pole saadaval'}</div> : <>
      {Date.parse(data.tracking_started_at) > Date.parse(data.starts_at) + 60000 && <div className="woodpecker-coverage"><span />Külastuste ja mängude mõõtmine alates {date(data.tracking_started_at, true)}</div>}
      <div className="woodpecker-kpis">{[
        ['Külastusi', number(t!.visits), `${number(t!.active)} aktiivset · viimased 5 min`, 'chart'],
        ['Mängijaid', number(t!.players), `${number(t!.games)} mängu`, 'game'],
        ['Tasutud tellimusi', number(t!.orders), `${number(t!.attributed_orders)} seotud külastusega`, 'bag'],
        ['Krük Krüki müügitulu', money(t!.sales), `${money(t!.refunds)} tagastatud`, 'shop'],
      ].map(([label, value, detail, icon]) => <section className="woodpecker-kpi" key={label}><div><span>{label}</span><Icon name={icon} /></div><strong>{value}</strong><small>{detail}</small></section>)}</div>
      <div className="woodpecker-surfaces">{surfaces.map(s => {
        const value = data.surfaces.find(x => x.surface === s.key)!
        return <section className="woodpecker-surface" key={s.key} style={{ '--surface-color': s.color } as React.CSSProperties}><div className="woodpecker-surface__title"><span><Icon name={s.icon} /></span><div><h2>{s.name}</h2><a href={`https://${s.url}/`} target="_blank" rel="noreferrer">{s.url} ↗</a></div></div><strong>{number(value.visits)} <small>külastust</small></strong><div className="woodpecker-surface__metrics"><div><b>{number(value.visitors)}</b><span>Lehesessioone</span></div><div><b>{number(s.key === 'store' ? value.product_views : value.clicks)}</b><span>{s.key === 'store' ? 'Tootevaatamisi' : 'Edasiklikke'}</span></div><div><b>{duration(value.seconds)}</b><span>Keskmine aeg</span></div></div></section>
      })}</div>
      <Traffic data={data} />
      <div className="woodpecker-two"><section className="woodpecker-panel"><div className="woodpecker-panel__heading"><div><span className="woodpecker-eyebrow">OSTUHUVI</span><h2>Külastusest kassani</h2></div><Icon name="bag" /></div><div className="woodpecker-funnel">{[
        ['Toodet vaadanud', metric('product_interest')], ['Ostukorvi lisanud', metric('add_to_cart')], ['Tellimust alustanud', metric('checkout_start')], ['Makselehele jõudnud', metric('checkout_redirect')],
      ].map(([label, count], i, rows) => <div key={label}><span>{String(i + 1).padStart(2, '0')}</span><div><div><b>{label}</b><strong>{number(Number(count))}</strong></div><i style={{ width: `${Math.max(0, Number(count) / Math.max(1, ...rows.map(r => Number(r[1]))) * 100)}%` }} /></div></div>)}</div><div className="woodpecker-footnote"><span>Tegevusega külastusi</span><span>Makse avamise vigu <b>{number(events('checkout_error'))}</b></span></div></section>
      <section className="woodpecker-panel woodpecker-game"><div className="woodpecker-panel__heading"><div><span className="woodpecker-eyebrow">MÜTSIKOGUMINE</span><h2>Mütsikogumise mäng</h2></div><Icon name="game" /></div><div className="woodpecker-game__score"><strong>{number(t!.hats)}</strong><span>kogutud mütsi</span></div><div className="woodpecker-game__metrics"><div><strong>{number(t!.best)}</strong><span>Parim tulemus</span></div><div><strong>{duration(t!.game_seconds)}</strong><span>Keskmine mäng</span></div><div><strong>{number(t!.game_buyers)}</strong><span>Mängijast ostjaid</span></div></div><div className="woodpecker-footnote"><span>{number(events('game_view'))} lennuvaate avamist</span><span>{number(events('bird_call'))} rähnihüüdu</span></div></section></div>
      <div className="woodpecker-two"><section className="woodpecker-panel"><div className="woodpecker-panel__heading"><h2>Kust tullakse</h2><span>{number(t!.visits)} külastust</span></div><Bars rows={data.sources} total={t!.visits} /></section><section className="woodpecker-panel"><div className="woodpecker-panel__heading"><h2>Millega vaadatakse</h2></div><Bars rows={data.devices} total={t!.visits} /><div className="woodpecker-scrolls">{surfaces.map(s => { const v = data.surfaces.find(x => x.surface === s.key)!; return <div key={s.key}><span>{s.name} lõpuni</span><b>{percent(v.full_scrolls, v.visits)}</b></div> })}</div></section></div>
      <section className="woodpecker-panel woodpecker-players"><div className="woodpecker-panel__heading"><div><span className="woodpecker-eyebrow">PÄRISELT MÄNGU ALUSTANUD</span><h2>Mängijad <span className="woodpecker-count">{number(data.player_count)}</span></h2></div><button type="button" onClick={() => void exportPlayers()} disabled={exporting || !data.player_count}><Icon name="download" />{exporting ? 'Ekspordin…' : 'Mängijate CSV'}</button></div><input className="woodpecker-search" type="search" aria-label="Otsi mängijat" placeholder="Otsi ostja nime või mängija ID-d" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="woodpecker-table-wrap" data-swipe-ignore><table><thead><tr><th>Mängija / ostja</th><th>Mänge</th><th>Mütse</th><th>Rekord</th><th>Mänguaeg</th><th>Allikas · seade</th><th>Ostud</th><th>Viimati</th></tr></thead><tbody>{data.players.map(p => <tr key={p.visitor_id}><td><strong>{p.customer_name ?? `Mängija ${p.visitor_id.slice(0, 8).toUpperCase()}`}</strong><small title={p.visitor_id}>{p.customer_name ? `Ostja · ${p.visitor_id.slice(0, 8).toUpperCase()}` : 'Anonüümne lehesessioon'}</small></td><td>{number(p.games)}</td><td>{number(p.hats)}</td><td><span className="woodpecker-score">{number(p.best)}</span></td><td>{duration(p.seconds)}</td><td>{p.source}<small>{deviceName[p.device]}</small></td><td>{p.orders ? <><strong>{money(p.sales)}</strong><small>{number(p.orders)} tellimust</small></> : '—'}</td><td>{date(p.last_seen, true)}</td></tr>)}</tbody></table></div>
        {!data.players.length && <div className="woodpecker-empty">{query ? 'Mängijaid ei leitud' : 'Esimene mängija on veel tulekul'}</div>}
        <div className="woodpecker-pagination"><span>{data.player_count ? `${data.player_page * 25 + 1}–${Math.min((data.player_page + 1) * 25, data.player_count)} / ${number(data.player_count)}` : '0 mängijat'}</span><div><button type="button" disabled={!page || loading} onClick={() => setPage(p => p - 1)}>← Eelmised</button><button type="button" disabled={(page + 1) * 25 >= data.player_count || loading} onClick={() => setPage(p => p + 1)}>Järgmised →</button></div></div>
      </section>
      <div className="woodpecker-two"><section className="woodpecker-panel"><div className="woodpecker-panel__heading"><h2>Toodete huvi</h2></div>{data.products.length ? <div className="woodpecker-products">{data.products.map(p => <div key={p.product_id}>{p.image && <img src={p.image} alt="" />}<div><strong>{p.name ?? p.product_id}</strong><span>{number(p.views)} vaatamist · {number(p.clicks)} klikki</span></div><b>{number(p.carts)}<small>ostukorvi</small></b></div>)}</div> : <div className="woodpecker-empty">Tootevaatamisi veel pole</div>}</section><section className="woodpecker-panel"><div className="woodpecker-panel__heading"><h2>Kampaanialingid</h2></div><Bars rows={data.utms.map(u => ({ label: `${u.campaign} · ${u.source}`, visits: u.visits }))} total={t!.visits} /></section></div>
    </>}
  </div>
}
