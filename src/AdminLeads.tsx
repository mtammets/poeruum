import { useCallback, useEffect, useMemo, useState } from 'react'
import { requireSupabase } from './lib/supabase'

type LeadStatus = 'new' | 'ready' | 'sending' | 'sent' | 'replied' | 'unsubscribed' | 'bounced' | 'complained' | 'archived'

type SalesLead = {
  id: string
  company_name: string
  website_url: string
  source_url: string
  email_source_url: string | null
  contact_email: string | null
  contact_kind: 'general_business' | 'personal_or_unclear' | 'missing'
  location: string
  segment: string
  summary: string
  fit_reason: string
  evidence: string
  fit_score: number
  status: LeadStatus
  draft_subject: string
  draft_body: string
  delivery_status: 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | null
  sent_at: string | null
  replied_at: string | null
  created_at: string
  updated_at: string
}

type LeadDraft = Pick<SalesLead, 'company_name' | 'contact_email' | 'email_source_url' | 'draft_subject' | 'draft_body'>
type LeadFilter = 'active' | 'sent' | 'replied' | 'incomplete' | 'blocked' | 'archived'

const defaultQuery = 'Leia Eesti mikro- ja väikeettevõtteid, kes müüvad enda valmistatud füüsilisi tooteid ning võtavad tellimusi sotsiaalmeedias, kontaktivormi või e-posti kaudu.'

const statusLabels: Record<LeadStatus, string> = {
  new: 'Vajab kontrolli',
  ready: 'Saatmiseks valmis',
  sending: 'Saatmisel',
  sent: 'Saadetud',
  replied: 'Vastas',
  unsubscribed: 'Loobus',
  bounced: 'Ei jõudnud kohale',
  complained: 'Rämpspostikaebus',
  archived: 'Arhiveeritud',
}

const primaryFilters: Array<{ id: 'active' | 'sent' | 'replied'; label: string }> = [
  { id: 'active', label: 'Uued' },
  { id: 'sent', label: 'Saadetud' },
  { id: 'replied', label: 'Vastanud' },
]

const hasReviewableContact = (lead: SalesLead) => lead.contact_kind === 'general_business'
  && Boolean(lead.contact_email && lead.email_source_url)

const isActiveLead = (lead: SalesLead) => ['ready', 'sending'].includes(lead.status)
  || (lead.status === 'new' && hasReviewableContact(lead))

const isIncompleteLead = (lead: SalesLead) => lead.status === 'new' && !hasReviewableContact(lead)

const statusLabel = (lead: SalesLead) => lead.status === 'new'
  ? hasReviewableContact(lead) ? 'Kiri puudub' : 'Kontakt puudub'
  : statusLabels[lead.status]

const toDraft = (lead: SalesLead): LeadDraft => ({
  company_name: lead.company_name,
  contact_email: lead.contact_email,
  email_source_url: lead.email_source_url,
  draft_subject: lead.draft_subject,
  draft_body: lead.draft_body,
})

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '—'

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Toiming ebaõnnestus.'
}

export default function AdminLeads() {
  const [leads, setLeads] = useState<SalesLead[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<LeadDraft | null>(null)
  const [filter, setFilter] = useState<LeadFilter>('active')
  const [search, setSearch] = useState('')
  const [researchQuery, setResearchQuery] = useState(defaultQuery)
  const [researchLimit, setResearchLimit] = useState(8)
  const [researchOpen, setResearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadLeads = useCallback(async (preferredId?: string | null) => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await requireSupabase().from('sales_leads')
        .select('id,company_name,website_url,source_url,email_source_url,contact_email,contact_kind,location,segment,summary,fit_reason,evidence,fit_score,status,draft_subject,draft_body,delivery_status,sent_at,replied_at,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(250)
      if (loadError) throw loadError
      const nextLeads = (data ?? []) as SalesLead[]
      setLeads(nextLeads)
      const nextId = preferredId === undefined ? selectedId : preferredId
      const nextSelected = nextLeads.find((lead) => lead.id === nextId) ?? nextLeads[0] ?? null
      setSelectedId(nextSelected?.id ?? null)
      setDraft(nextSelected ? toDraft(nextSelected) : null)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadLeads(null)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const selected = leads.find((lead) => lead.id === selectedId) ?? null
  const visibleLeads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('et')
    return leads.filter((lead) => {
      const matchesFilter = filter === 'active'
        ? isActiveLead(lead)
        : filter === 'incomplete'
          ? isIncompleteLead(lead)
        : filter === 'blocked'
          ? ['unsubscribed', 'bounced', 'complained'].includes(lead.status)
          : lead.status === filter
      if (!matchesFilter) return false
      return !needle || [lead.company_name, lead.contact_email, lead.segment, lead.location]
        .some((value) => String(value ?? '').toLocaleLowerCase('et').includes(needle))
    })
  }, [filter, leads, search])

  useEffect(() => {
    if (visibleLeads.some((lead) => lead.id === selectedId)) return
    const nextSelected = visibleLeads[0] ?? null
    setSelectedId(nextSelected?.id ?? null)
    setDraft(nextSelected ? toDraft(nextSelected) : null)
  }, [selectedId, visibleLeads])

  const counts = useMemo(() => ({
    active: leads.filter(isActiveLead).length,
    sent: leads.filter((lead) => lead.status === 'sent').length,
    replied: leads.filter((lead) => lead.status === 'replied').length,
    incomplete: leads.filter(isIncompleteLead).length,
    blocked: leads.filter((lead) => ['unsubscribed', 'bounced', 'complained'].includes(lead.status)).length,
    archived: leads.filter((lead) => lead.status === 'archived').length,
  }), [leads])

  const invoke = async (action: string, body: Record<string, unknown> = {}) => {
    setBusyAction(action)
    setError('')
    setNotice('')
    try {
      const { data, error: invokeError } = await requireSupabase().functions.invoke('lead-outreach', {
        body: { action, ...body },
      })
      if (invokeError) {
        let message = invokeError.message
        const context = (invokeError as { context?: Response }).context
        if (context) {
          const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null
          if (payload?.error) message = String(payload.error)
        }
        throw new Error(message)
      }
      if (data?.error) throw new Error(String(data.error))
      return data as Record<string, unknown>
    } finally {
      setBusyAction('')
    }
  }

  const runResearch = async () => {
    try {
      const result = await invoke('search', { query: researchQuery, limit: researchLimit })
      const inserted = Number(result.inserted_count ?? 0)
      const rejected = Number(result.duplicate_or_rejected_count ?? 0)
      setNotice(`Leidsin ${inserted} kontrollitud ${inserted === 1 ? 'kandidaadi' : 'kandidaati'}${rejected ? `; ${rejected} duplikaati või ebapiisava infoga tulemust jäeti välja` : ''}.`)
      setResearchOpen(false)
      await loadLeads(null)
    } catch (researchError) {
      setError(getErrorMessage(researchError))
    }
  }

  const saveLead = async () => {
    if (!selected || !draft) return
    try {
      const result = await invoke('save', { lead_id: selected.id, ...draft })
      setNotice(result.status === 'ready'
        ? 'Kontakt ja kiri on salvestatud ning saatmiseks valmis.'
        : 'Kontakt on salvestatud, kuid saatmiseks on vaja ettevõtte üldkontakti, selle avalikku allikat ning valmis kirja.')
      await loadLeads(selected.id)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  const restoreTemplate = async () => {
    if (!selected) return
    if (!window.confirm('Kas taastan kinnitatud kirjamalli? Praegune kirja teema ja sisu asendatakse.')) return
    try {
      await invoke('draft', { lead_id: selected.id })
      setNotice('Kirjamall taastati. Vaata see enne saatmist üle.')
      await loadLeads(selected.id)
    } catch (draftError) {
      setError(getErrorMessage(draftError))
    }
  }

  const sendLead = async () => {
    if (!selected || !draft) return
    if (JSON.stringify(draft) !== JSON.stringify(toDraft(selected))) {
      setError('Sul on salvestamata muudatusi. Salvesta kiri enne saatmist.')
      return
    }
    try {
      await invoke('send', { lead_id: selected.id })
      setNotice(`Kiri saadeti aadressile ${selected.contact_email}.`)
      await loadLeads(selected.id)
    } catch (sendError) {
      setError(getErrorMessage(sendError))
      await loadLeads(selected.id)
    }
  }

  const simpleAction = async (action: 'archive' | 'suppress') => {
    if (!selected) return
    if (action === 'suppress' && !window.confirm(`Kas blokeerin aadressi ${selected.contact_email}? Sellele aadressile enam müügikirju ei saadeta.`)) return
    try {
      await invoke(action, { lead_id: selected.id })
      setNotice(action === 'archive' ? 'Kontakt arhiveeriti.' : 'Aadress lisati loobumisnimekirja.')
      await loadLeads(null)
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  const deleteLead = async () => {
    if (!selected) return
    const confirmed = window.confirm(`Kas kustutan ettevõtte ${selected.company_name} kliendiotsingust jäädavalt? Seda ei saa tagasi võtta.`)
    if (!confirmed) return
    try {
      await invoke('delete', { lead_id: selected.id })
      setNotice('Ettevõte kustutati kliendiotsingust.')
      await loadLeads(null)
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  const chooseLead = (lead: SalesLead) => {
    setSelectedId(lead.id)
    setDraft(toDraft(lead))
    setError('')
    setNotice('')
  }

  return <section className="admin-leads">
    {(error || notice) && <div className={`admin-leads__notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
      <span>{error || notice}</span>
      <button type="button" aria-label="Sulge teade" onClick={() => { setError(''); setNotice('') }}>×</button>
    </div>}

    <section className="admin-leads__panel">
      <header>
        <div className="admin-leads__filters" role="group" aria-label="Filtreeri müügikontakte">
          {primaryFilters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}
          <select
            className={['incomplete', 'blocked', 'archived'].includes(filter) ? 'is-active' : undefined}
            aria-label="Muud kontaktid"
            value={['incomplete', 'blocked', 'archived'].includes(filter) ? filter : ''}
            onChange={(event) => setFilter(event.target.value as LeadFilter)}
          >
            <option value="" disabled>Veel</option>
            <option value="incomplete">Vajab kontrolli ({counts.incomplete})</option>
            <option value="blocked">Loobunud / blokeeritud ({counts.blocked})</option>
            <option value="archived">Arhiiv ({counts.archived})</option>
          </select>
        </div>
        <label className="admin-leads__search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Otsi nime või e-posti" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button className="admin-leads__refresh" type="button" onClick={() => void loadLeads()} disabled={loading}>↻</button>
        <button className="admin-leads__new" type="button" onClick={() => setResearchOpen((open) => !open)} aria-expanded={researchOpen}>
          {researchOpen ? 'Sulge' : 'Leia ettevõtteid'}
        </button>
      </header>

      {researchOpen && <div className="admin-leads__research-form">
        <label>
          <span>Milliseid ettevõtteid otsida?</span>
          <textarea rows={3} maxLength={1000} value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} />
        </label>
        <div className="admin-leads__research-actions">
          <label><span>Tulemusi</span><select value={researchLimit} onChange={(event) => setResearchLimit(Number(event.target.value))}>{[4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <button type="button" onClick={() => void runResearch()} disabled={Boolean(busyAction) || researchQuery.trim().length < 10}>
            {busyAction === 'search' ? 'Otsin…' : 'Alusta otsingut'}
          </button>
        </div>
      </div>}

      {loading && !leads.length ? <div className="admin-leads__empty-state">Laadin kontakte…</div> : visibleLeads.length ? <div className="admin-leads__workspace">
        <div className="admin-leads__list">
          {visibleLeads.map((lead) => <button
            type="button"
            key={lead.id}
            className={selectedId === lead.id ? 'is-active' : undefined}
            onClick={() => chooseLead(lead)}
          >
            <span><strong>{lead.company_name}</strong><small>{lead.segment || lead.location || 'Segment määramata'}</small><em>{lead.contact_email || 'Üldkontakt puudub'}</em></span>
            <b className={`is-${lead.status}`}>{statusLabel(lead)}</b>
          </button>)}
        </div>

        {selected && draft ? <article className="admin-leads__detail">
          <header>
            <div><span>{selected.segment || selected.location || 'KLIENDIKANDIDAAT'}</span><h2>{selected.company_name}</h2><p>{selected.summary || 'Kokkuvõte puudub.'}</p><a href={selected.website_url} target="_blank" rel="noreferrer">Ava veebileht ↗</a></div>
            <b className={`is-${selected.status}`}>{statusLabel(selected)}</b>
          </header>

          <div className="admin-leads__reason">
            <div><span>Miks valitud</span><p>{selected.fit_reason || selected.evidence || 'Põhjendus puudub.'}</p></div>
            <a href={selected.source_url} target="_blank" rel="noreferrer">Vaata allikat ↗</a>
          </div>

          <details className="admin-leads__research-details">
            <summary>Uuringu detailid</summary>
            <div><span>Leitud info</span><p>{selected.evidence || 'Lisainfo puudub.'}</p></div>
            <nav>
              <a href={selected.website_url} target="_blank" rel="noreferrer">Veebileht ↗</a>
              <a href={selected.source_url} target="_blank" rel="noreferrer">Uuringu allikas ↗</a>
              {selected.email_source_url && <a href={selected.email_source_url} target="_blank" rel="noreferrer">Kontakti allikas ↗</a>}
            </nav>
          </details>

          <form onSubmit={(event) => { event.preventDefault(); void saveLead() }}>
            <label><span>Kirja teema</span><input maxLength={160} value={draft.draft_subject} onChange={(event) => setDraft({ ...draft, draft_subject: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            <label><span>Kirja sisu</span><textarea rows={9} maxLength={5000} value={draft.draft_body} onChange={(event) => setDraft({ ...draft, draft_body: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            <details className="admin-leads__contact-details">
              <summary><span>Kontakti andmed</span><small>{draft.contact_email || 'Kontakt puudub'}</small></summary>
              <div className="admin-leads__fields">
                <label><span>Ettevõtte nimi</span><input value={draft.company_name} onChange={(event) => setDraft({ ...draft, company_name: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
                <label><span>Ettevõtte üldkontakt</span><input type="email" placeholder="info@ettevote.ee" value={draft.contact_email ?? ''} onChange={(event) => setDraft({ ...draft, contact_email: event.target.value || null })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
              </div>
              <label><span>Kontakti allikas</span><input type="url" placeholder="https://ettevote.ee/kontakt" value={draft.email_source_url ?? ''} onChange={(event) => setDraft({ ...draft, email_source_url: event.target.value || null })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            </details>
            <small className="admin-leads__policy">Süsteem lisab saatja allkirja automaatselt.</small>
            <div className="admin-leads__buttons">
              {['new', 'ready', 'archived'].includes(selected.status) && <button type="submit" disabled={Boolean(busyAction)}>{busyAction === 'save' ? 'Salvestan…' : 'Salvesta'}</button>}
              {['new', 'ready'].includes(selected.status) && <button type="button" className="is-secondary" onClick={() => void restoreTemplate()} disabled={Boolean(busyAction)}>{busyAction === 'draft' ? 'Taastan…' : 'Taasta kirjamall'}</button>}
              {selected.status === 'ready' && <button type="button" className="is-send" onClick={() => void sendLead()} disabled={Boolean(busyAction)}>{busyAction === 'send' ? 'Saadan…' : 'Saada kiri'}</button>}
              {['new', 'ready'].includes(selected.status) && <button type="button" className="is-quiet" onClick={() => void simpleAction('archive')} disabled={Boolean(busyAction)}>Jäta vahele</button>}
              {selected.contact_email && !['unsubscribed', 'bounced', 'complained'].includes(selected.status) && <button type="button" className="is-danger" onClick={() => void simpleAction('suppress')} disabled={Boolean(busyAction)}>Ära enam kontakteeru</button>}
              {['new', 'ready', 'archived'].includes(selected.status) && <button type="button" className="is-delete" onClick={() => void deleteLead()} disabled={Boolean(busyAction)}>{busyAction === 'delete' ? 'Kustutan…' : 'Kustuta'}</button>}
            </div>
          </form>

          {(selected.sent_at || selected.replied_at || selected.delivery_status) && <footer>
            {selected.sent_at && <span>Saadetud {formatDate(selected.sent_at)}</span>}
            {selected.delivery_status && <span>Tarne: {selected.delivery_status}</span>}
            {selected.replied_at && <span>Vastas {formatDate(selected.replied_at)}</span>}
          </footer>}
        </article> : <div className="admin-leads__placeholder">Vali kontakt, et näha allikaid ja kirjamustandit.</div>}
      </div> : <div className="admin-leads__empty-state">
        <strong>Siin pole veel ettevõtteid</strong>
        <span>Vali teine filter või käivita uus otsing.</span>
        <button type="button" onClick={() => setResearchOpen(true)}>Leia uusi ettevõtteid</button>
      </div>}
    </section>
  </section>
}
