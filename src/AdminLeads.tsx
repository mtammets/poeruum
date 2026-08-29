import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'

type LeadStatus = 'queued' | 'sending' | 'sent' | 'replied' | 'unsubscribed' | 'bounced' | 'complained' | 'failed'
type LeadFilter = 'queued' | 'sent' | 'replied' | 'problems'

type SalesLead = {
  id: string
  registry_code: string | null
  company_name: string
  contact_email: string | null
  website_url: string | null
  source_url: string
  activity_labels: string[]
  status: LeadStatus
  delivery_status: 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | null
  sent_at: string | null
  replied_at: string | null
  suppressed_at: string | null
  last_error: string | null
  created_at: string
}

type OutreachSettings = {
  enabled: boolean
  daily_limit: number
  subject: string
  body: string
  updated_at: string
}

type OutreachCounts = {
  queued: number
  sending: number
  failed: number
  replied: number
  blocked: number
  sent_today: number
  sent_total: number
}

type OutreachRun = {
  id: string
  status: 'running' | 'completed' | 'failed'
  scanned_count: number
  candidate_count: number
  imported_count: number
  sent_count: number
  failed_count: number
  error_message: string | null
  completed_at: string | null
  created_at: string
}

type OutreachOverview = {
  settings: OutreachSettings
  counts: OutreachCounts
  last_import: OutreachRun | null
  last_send: OutreachRun | null
}

type SettingsDraft = Pick<OutreachSettings, 'enabled' | 'daily_limit' | 'subject' | 'body'>

const emptyOverview: OutreachOverview = {
  settings: { enabled: false, daily_limit: 50, subject: '', body: '', updated_at: '' },
  counts: { queued: 0, sending: 0, failed: 0, replied: 0, blocked: 0, sent_today: 0, sent_total: 0 },
  last_import: null,
  last_send: null,
}

const statusLabels: Record<LeadStatus, string> = {
  queued: 'Järjekorras',
  sending: 'Saatmisel',
  sent: 'Saadetud',
  replied: 'Vastas',
  unsubscribed: 'Blokeeritud',
  bounced: 'Ei jõudnud kohale',
  complained: 'Rämpspostikaebus',
  failed: 'Saatmine ebaõnnestus',
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Toiming ebaõnnestus.'
}

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('et-EE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
  : '—'

const invokeOutreach = async (action: string, body: Record<string, unknown> = {}) => {
  const { data, error } = await requireSupabase().functions.invoke('lead-outreach', {
    body: { action, ...body },
  })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null
      if (payload?.error) message = String(payload.error)
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as Record<string, unknown>
}

const filterStatuses = (filter: LeadFilter): LeadStatus[] => {
  if (filter === 'queued') return ['queued', 'sending']
  if (filter === 'problems') return ['failed', 'unsubscribed', 'bounced', 'complained']
  return [filter]
}

export default function AdminLeads() {
  const [overview, setOverview] = useState<OutreachOverview>(emptyOverview)
  const [settings, setSettings] = useState<SettingsDraft>(emptyOverview.settings)
  const [leads, setLeads] = useState<SalesLead[]>([])
  const [filter, setFilter] = useState<LeadFilter>('sent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadOverview = useCallback(async () => {
    const result = await invokeOutreach('overview')
    const next = {
      settings: result.settings,
      counts: result.counts,
      last_import: result.last_import,
      last_send: result.last_send,
    } as OutreachOverview
    setOverview(next)
    setSettings({
      enabled: next.settings.enabled,
      daily_limit: next.settings.daily_limit,
      subject: next.settings.subject,
      body: next.settings.body,
    })
  }, [])

  const loadLeads = useCallback(async () => {
    const statuses = filterStatuses(filter)
    let query = requireSupabase().from('sales_leads')
      .select('id,registry_code,company_name,contact_email,website_url,source_url,activity_labels,status,delivery_status,sent_at,replied_at,suppressed_at,last_error,created_at')
      .in('status', statuses)
      .limit(150)
    query = filter === 'queued'
      ? query.order('created_at', { ascending: false })
      : query.order(filter === 'replied' ? 'replied_at' : 'sent_at', { ascending: false, nullsFirst: false })
    const { data, error: loadError } = await query
    if (loadError) throw loadError
    const next = (data ?? []) as SalesLead[]
    setLeads(next)
    setSelectedId((current) => next.some((lead) => lead.id === current) ? current : next[0]?.id ?? null)
  }, [filter])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadOverview(), loadLeads()])
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [loadLeads, loadOverview])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const saveSettings = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await invokeOutreach('save-settings', settings)
      setNotice(settings.enabled
        ? `Automaatne kliendiotsing on sees ja saadab kuni ${settings.daily_limit} kirja päevas.`
        : 'Automaatne kliendiotsing on välja lülitatud.')
      await loadOverview()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const suppressLead = async (lead: SalesLead) => {
    if (!lead.contact_email || !window.confirm(`Kas blokeerin aadressi ${lead.contact_email}?`)) return
    setBusy(true)
    setError('')
    try {
      await invokeOutreach('suppress', { lead_id: lead.id })
      setNotice('Aadress blokeeriti ja sellele rohkem müügikirju ei saadeta.')
      await Promise.all([loadOverview(), loadLeads()])
    } catch (suppressError) {
      setError(getErrorMessage(suppressError))
    } finally {
      setBusy(false)
    }
  }

  const selected = leads.find((lead) => lead.id === selectedId) ?? null
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify({
    enabled: overview.settings.enabled,
    daily_limit: overview.settings.daily_limit,
    subject: overview.settings.subject,
    body: overview.settings.body,
  })

  const filters: Array<{ id: LeadFilter; label: string; count: number }> = [
    { id: 'queued', label: 'Järjekord', count: overview.counts.queued + overview.counts.sending },
    { id: 'sent', label: 'Saadetud', count: overview.counts.sent_total },
    { id: 'replied', label: 'Vastanud', count: overview.counts.replied },
    { id: 'problems', label: 'Blokeeritud / vead', count: overview.counts.blocked + overview.counts.failed },
  ]

  return <section className="admin-leads">
    {(error || notice) && <div className={`admin-leads__notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
      <span>{error || notice}</span>
      <button type="button" aria-label="Sulge teade" onClick={() => { setError(''); setNotice('') }}>×</button>
    </div>}

    <section className="admin-leads__automation">
      <header>
        <div>
          <span>Automaatne kliendiotsing</span>
          <h2>{overview.settings.enabled ? 'Töötab' : 'Välja lülitatud'}</h2>
          <p>Äriregister täidab järjekorda ja süsteem saadab igal päeval ühe kinnitatud kirjaga kuni määratud piirini.</p>
        </div>
        <button
          type="button"
          className={`admin-leads__switch${settings.enabled ? ' is-on' : ''}`}
          aria-pressed={settings.enabled}
          onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
        >
          <span aria-hidden="true" />{settings.enabled ? 'Sees' : 'Väljas'}
        </button>
      </header>

      <div className="admin-leads__metrics">
        <div><span>Täna saadetud</span><strong>{overview.counts.sent_today} / {overview.settings.daily_limit}</strong></div>
        <div><span>Järjekorras</span><strong>{overview.counts.queued}</strong></div>
        <div><span>Kokku saadetud</span><strong>{overview.counts.sent_total}</strong></div>
        <div><span>Vastanud</span><strong>{overview.counts.replied}</strong></div>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void saveSettings() }}>
        <label className="admin-leads__limit">
          <span>Päevane ülempiir</span>
          <input type="number" min={1} max={50} value={settings.daily_limit} onChange={(event) => setSettings({ ...settings, daily_limit: Number(event.target.value) })} />
        </label>
        <label>
          <span>Kirja teema</span>
          <input maxLength={160} value={settings.subject} onChange={(event) => setSettings({ ...settings, subject: event.target.value })} />
        </label>
        <label>
          <span>Kirja sisu</span>
          <textarea rows={9} maxLength={5000} value={settings.body} onChange={(event) => setSettings({ ...settings, body: event.target.value })} />
        </label>
        <div className="admin-leads__settings-footer">
          <small>Sama teema ja sisu saadetakse kõigile. Saatja nimi ning allkiri lisatakse automaatselt.</small>
          <button type="submit" disabled={busy || !settingsChanged || !settings.subject.trim() || !settings.body.trim()}>{busy ? 'Salvestan…' : 'Salvesta seaded'}</button>
        </div>
      </form>

      <footer className="admin-leads__runs">
        <span>Viimane registri import: <strong>{overview.last_import ? `${formatDate(overview.last_import.completed_at || overview.last_import.created_at)} · ${overview.last_import.imported_count} uut` : 'pole veel käivitatud'}</strong></span>
        <span>Viimane saatmine: <strong>{overview.last_send ? `${formatDate(overview.last_send.completed_at || overview.last_send.created_at)} · ${overview.last_send.sent_count} saadetud${overview.last_send.failed_count ? ` · ${overview.last_send.failed_count} viga` : ''}` : 'pole veel käivitatud'}</strong></span>
        {(overview.last_import?.error_message || overview.last_send?.error_message) && <em>{overview.last_send?.error_message || overview.last_import?.error_message}</em>}
      </footer>
    </section>

    <section className="admin-leads__panel">
      <header>
        <div className="admin-leads__filters" role="group" aria-label="Filtreeri kontakte">
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}
        </div>
        <button className="admin-leads__refresh" type="button" onClick={() => void refresh()} disabled={loading}>↻</button>
      </header>

      {loading && !leads.length ? <div className="admin-leads__empty-state">Laadin kontakte…</div> : leads.length ? <div className="admin-leads__workspace">
        <div className="admin-leads__list">
          {leads.map((lead) => <button type="button" key={lead.id} className={selectedId === lead.id ? 'is-active' : undefined} onClick={() => setSelectedId(lead.id)}>
            <span><strong>{lead.company_name}</strong><small>{lead.activity_labels[0] || 'Toodete müük või valmistamine'}</small><em>{lead.contact_email || 'Kontakt puudub'}</em></span>
            <b className={`is-${lead.status}`}>{statusLabels[lead.status]}</b>
          </button>)}
        </div>

        {selected ? <article className="admin-leads__detail">
          <header>
            <div><span>{selected.registry_code ? `REGISTRIKOOD ${selected.registry_code}` : 'VARASEM KONTAKT'}</span><h2>{selected.company_name}</h2><p>{selected.activity_labels.join(' · ') || 'Varasemast süsteemist säilitatud saatmisajalugu.'}</p></div>
            <b className={`is-${selected.status}`}>{statusLabels[selected.status]}</b>
          </header>
          <dl className="admin-leads__contact-summary">
            <div><dt>E-post</dt><dd>{selected.contact_email || '—'}</dd></div>
            <div><dt>Saadetud</dt><dd>{formatDate(selected.sent_at)}</dd></div>
            <div><dt>Tarne</dt><dd>{selected.delivery_status || '—'}</dd></div>
            <div><dt>Vastus</dt><dd>{formatDate(selected.replied_at)}</dd></div>
          </dl>
          <nav className="admin-leads__source-links">
            {selected.website_url && <a href={selected.website_url} target="_blank" rel="noreferrer">Ettevõtte veebileht ↗</a>}
            <a href={selected.source_url} target="_blank" rel="noreferrer">Avalik allikas ↗</a>
          </nav>
          {selected.last_error && <p className="admin-leads__lead-error">{selected.last_error}</p>}
          {selected.contact_email && !['unsubscribed', 'bounced', 'complained'].includes(selected.status) && <div className="admin-leads__detail-actions">
            <button type="button" onClick={() => void suppressLead(selected)} disabled={busy || selected.status === 'sending'}>Ära enam kontakteeru</button>
          </div>}
        </article> : null}
      </div> : <div className="admin-leads__empty-state">
        <strong>Selles vaates kontakte pole</strong>
        <span>Automaatne import lisab uued ettevõtted järjekorda.</span>
      </div>}
    </section>
  </section>
}
