import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loadDirectoryReport, type DirectoryMetrics, type DirectoryReport, type DirectoryStoreStats } from './lib/directoryAnalyticsAdmin'

const number = (value: number | null) => value === null ? '—' : value.toLocaleString('et-EE', { maximumFractionDigits: 1 })
const date = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('et-EE', { timeZone: 'Europe/Tallinn' })
const change = (current: number, previous: number, available: boolean) => !available ? 'Võrdlus koguneb'
  : previous === 0 ? (current === 0 ? 'Muutuseta' : 'Eelmisel perioodil 0')
    : `${current > previous ? '+' : ''}${number((current - previous) * 100 / previous)}% eelmise perioodiga`
const devices: Record<string, string> = { mobile: 'Telefon', tablet: 'Tahvel', desktop: 'Arvuti' }

function Breakdown({ title, entries }: { title: string; entries: DirectoryReport['sources'] }) {
  const max = Math.max(1, ...entries.map((entry) => entry.visits))
  return <section className="directory-analytics__box"><h3>{title}</h3>
    {entries.length ? <ul className="directory-analytics__breakdown">{entries.map((entry) => <li key={entry.label}>
      <span>{entry.label}</span><strong>{number(entry.visits)}</strong>
      <i aria-hidden="true" style={{ width: `${entry.visits / max * 100}%` }} />
    </li>)}</ul> : <p>Andmed veel puuduvad.</p>}
  </section>
}

function Trend({ report }: { report: DirectoryReport }) {
  const [selected, setSelected] = useState<string | null>(null)
  const daily = report.daily
  const active = daily.find((day) => day.date === selected) || daily[daily.length - 1]
  const max = Math.max(1, ...daily.flatMap((day) => [day.visits, day.store_clicks + day.product_clicks]))
  return <section className="directory-analytics__box directory-analytics__trend">
    <h3>Päevade lõikes</h3>
    <p className="directory-analytics__legend"><span>● {report.store ? 'Poega kokku puutunud külastused' : 'Külastused'}</span><span>● Poe- ja tootelingi avamised</span></p>
    <div className="directory-analytics__chart-scroll"><div className="directory-analytics__plot" style={{ '--day-count': daily.length } as CSSProperties}><div className="directory-analytics__chart" role="group" aria-label="Päevade statistika">
      {daily.map((day) => <button key={day.date} type="button" aria-label={`${date(day.date)}: ${day.visits} külastust, ${day.store_clicks} poe avamist, ${day.product_clicks} toote avamist`}
        className={active?.date === day.date ? 'is-selected' : ''}
        onFocus={() => setSelected(day.date)} onMouseEnter={() => setSelected(day.date)} onClick={() => setSelected(day.date)}>
        <span style={{ height: `${day.visits / max * 100}%` }} /><i style={{ height: `${(day.store_clicks + day.product_clicks) / max * 100}%` }} />
      </button>)}
    </div>
    <div className="directory-analytics__axis"><span>{date(report.from_date)}</span><span>{date(report.to_date)}</span></div>
    </div></div>
    <p className="directory-analytics__day" aria-live="polite">{active && <>{date(active.date)} · {number(active.visits)} külastust · {number(active.store_clicks)} poe avamist · {number(active.product_clicks)} toote avamist</>}</p>
  </section>
}

function StoreTable({ stores, comparison, onSelect }: { stores: DirectoryStoreStats[]; comparison: boolean; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<'store_clicks' | 'impressions' | 'product_clicks' | 'ctr'>('store_clicks')
  const sorted = useMemo(() => [...stores].sort((a, b) => (b.current[sort] ?? -1) - (a.current[sort] ?? -1) || a.name.localeCompare(b.name, 'et')), [stores, sort])
  return <section className="directory-analytics__box">
    <div className="directory-analytics__section-head"><h3>Poodide võrdlus</h3><label>Järjesta <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
      <option value="store_clicks">Poe avamised</option><option value="impressions">Kaardi näitamised</option><option value="product_clicks">Toote avamised</option><option value="ctr">Klikimäär</option>
    </select></label></div>
    {stores.length ? <div className="directory-analytics__table-scroll" tabIndex={0} role="region" aria-label="Poodide statistika"><table>
      <thead><tr><th>Pood</th><th>Näitamised</th><th>Poe avamised</th><th>Toote avamised</th><th>Klikimäär</th><th>Keskmine koht</th><th>Poe avamiste muutus</th></tr></thead>
      <tbody>{sorted.map((store) => <tr key={store.id}>
        <th scope="row"><button type="button" className="directory-analytics__store" onClick={() => onSelect(store.id)}>{store.name} <span aria-hidden="true">↗</span></button>{!store.is_published && <small>Praegu avaldamata</small>}</th>
        <td>{number(store.current.impressions)}</td><td>{number(store.current.store_clicks)}</td><td>{number(store.current.product_clicks)}</td>
        <td>{store.current.ctr === null ? '—' : `${number(store.current.ctr)}%`}</td><td>{number(store.current.average_position)}</td>
        <td>{change(store.current.store_clicks, store.previous.store_clicks, comparison)}</td>
      </tr>)}</tbody>
    </table></div> : <p>Kaubamajas pole veel avaldatud e-poode.</p>}
  </section>
}

export default function AdminDirectoryAnalytics() {
  const [days, setDays] = useState(30)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ report: DirectoryReport | null; loading: boolean; error: string }>({ report: null, loading: true, error: '' })
  useEffect(() => {
    let current = true
    loadDirectoryReport(days, storeId).then((report) => {
      if (current) setState({ report, loading: false, error: '' })
    }).catch((error: unknown) => {
      if (current) setState({ report: null, loading: false, error: error instanceof Error ? error.message : 'Statistikat ei õnnestunud laadida.' })
    })
    return () => { current = false }
  }, [days, storeId, revision])
  const reload = () => {
    setState({ report: null, loading: true, error: '' })
    setRevision((value) => value + 1)
  }
  const selectStore = (id: string | null) => {
    setState({ report: null, loading: true, error: '' })
    setStoreId(id)
    document.getElementById('directory-statistics-period')?.focus()
  }
  const report = state.report
  const metrics: { key: keyof DirectoryMetrics; label: string; note?: string; percent?: boolean }[] = [
    { key: 'visits', label: storeId ? 'Poega kokku puutunud külastused' : 'Kaubamaja külastused' },
    { key: 'impressions', label: 'Poekaardi näitamised' },
    { key: 'store_clicks', label: 'Poe avamised' },
    { key: 'product_clicks', label: 'Toote avamised' },
    { key: 'ctr', label: 'Poekaardi klikimäär', percent: true, note: 'Poe avamised / kaardi näitamised' },
    storeId ? { key: 'average_position', label: 'Keskmine koht loendis', note: 'Nähtavale jõudnud kaartide asukoht' }
      : { key: 'searches', label: 'Otsingud', note: report ? `${number(report.current.empty_searches)} otsingut tulemusteta` : '' },
  ]
  return <div className="directory-analytics">
    {storeId && <button className="directory-analytics__back" type="button" onClick={() => selectStore(null)}>← Kõik poed</button>}
    {storeId && <div className="directory-analytics__header"><div>
      <h2>{report?.store?.name || 'Poe statistika'}</h2>
      <p>Kaubamajast sellele poele jõudnud tähelepanu ja avamised.</p>
    </div></div>}
    <div className="directory-analytics__toolbar">
      <div id="directory-statistics-period" role="group" aria-label="Statistika periood" tabIndex={-1}>{[7, 30, 90].map((value) => <button type="button" key={value} aria-pressed={days === value} onClick={() => {
        if (value === days) return
        setState({ report: null, loading: true, error: '' }); setDays(value)
      }}>{value} päeva</button>)}</div>
      <button type="button" onClick={reload} disabled={state.loading}>Värskenda statistikat</button>
    </div>
    {state.loading && <p role="status" className="directory-analytics__notice">Laadin statistikat…</p>}
    {state.error && <div role="alert" className="directory-analytics__error"><p>{state.error}</p><button type="button" onClick={reload}>Proovi uuesti</button></div>}
    {report && <>
      {report.current.visits === 0 && <p role="status" className="directory-analytics__notice">Valitud perioodil pole veel külastusi registreeritud.</p>}
      <div className="directory-analytics__metrics">{metrics.map((metric) => <section key={metric.key} className="directory-analytics__metric">
        <h3>{metric.label}</h3><strong>{number(report.current[metric.key])}{metric.percent && report.current[metric.key] !== null ? '%' : ''}</strong>
        <small>{metric.note || change(report.current[metric.key] ?? 0, report.previous[metric.key] ?? 0, report.comparison_available)}</small>
      </section>)}</div>
      <Trend report={report} />
      {!storeId && <StoreTable stores={report.stores} comparison={report.comparison_available} onSelect={selectStore} />}
      {storeId && <>
        <section className="directory-analytics__box"><h3>Kus poekaart nähtavale jõudis?</h3>
          {report.placements.length ? <div className="directory-analytics__table-scroll"><table><thead><tr><th>Asukoht</th><th>Näitamised</th><th>Poe avamised</th><th>Keskmine koht</th></tr></thead><tbody>{report.placements.map((row) => <tr key={row.placement}>
            <th scope="row">{row.placement === 'directory' ? 'Poodide loend' : 'Otsingutulemused'}</th><td>{number(row.impressions)}</td><td>{number(row.clicks)}</td><td>{number(row.average_position)}</td>
          </tr>)}</tbody></table></div> : <p>Poekaardi näitamisi veel pole.</p>}
        </section>
        <section className="directory-analytics__box"><h3>Enim avatud tooted</h3><p>Kaubamaja avalehe valikust ja otsingust avatud tooted, kuni 20 esimest.</p>
          {report.products.length ? <div className="directory-analytics__table-scroll"><table><thead><tr><th>Toode</th><th>Avamised</th><th>Eelmine periood</th></tr></thead><tbody>{report.products.map((product) => <tr key={product.id}>
            <th scope="row">{product.name}</th><td>{number(product.clicks)}</td><td>{report.comparison_available ? number(product.previous_clicks) : '—'}</td>
          </tr>)}</tbody></table></div> : <p>Tootelinke pole valitud perioodil avatud.</p>}
        </section>
      </>}
      <div className="directory-analytics__columns">
        <Breakdown title="Kust külastajad tulid?" entries={report.sources} />
        <Breakdown title="Seadmed" entries={report.devices.map((entry) => ({ ...entry, label: devices[entry.label] || entry.label }))} />
      </div>
      <details className="directory-analytics__definitions"><summary>Kuidas neid numbreid lugeda?</summary>
        <p>Külastus tekib lehe avamisel ja kestab kuni lehe uuesti laadimiseni, 30 minutit tegevusetust või Eesti päeva vahetumiseni. Tunnus püsib ainult lehe mälus. See ei ole unikaalsete inimeste arv. Administraatori külastusi ja näidispoode ei arvestata.</p>
        <p>Näitamine tekib siis, kui vähemalt pool poekaardist on ühe sekundi nähtaval, või kui kaart avatakse. Ühte kaarti, poe avamist ja konkreetse toote avamist loetakse külastuse jooksul üks kord. Asukohtade tabelis võib sama külastus esineda nii loendi kui otsingu real.</p>
        <p>Poe külastuste arv näitab külastusi, kus selle poe kaart oli nähtav või avati poe- või tootelink. Allikas ja seade pärinevad Kaubamaja külastusest. Klikimäär arvestab poekaardi avamisi; tootelingid on eraldi.</p>
        <p>Keskmine koht näitab nähtavale jõudnud kaardi tegelikku asukohta poodide loendis. Otsingu puhul kogutakse tulemuste arvu, otsinguteksti ei salvestata. Tänane päev on pooleli; ostude ja müügitulu omistamist see vaade ei sisalda.</p>
      </details>
    </>}
  </div>
}
