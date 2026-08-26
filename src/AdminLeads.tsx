import { useCallback, useEffect, useMemo, useState } from 'react'
import { requireSupabase } from './lib/supabase'

type LeadStatus = 'new' | 'ready' | 'sending' | 'sent' | 'replied' | 'unsubscribed' | 'bounced' | 'complained' | 'archived'

type LeadQualification = {
  decision?: 'eligible' | 'review' | 'reject'
  commerce_status?: string
  purchase_complexity?: string
  issues?: string[]
  last_recheck?: {
    verification_url?: string | null
    verified_observation?: string
  }
}

type LeadDraftQuality = {
  passed?: boolean
  score?: number
  issues?: string[]
}

const technicalVerificationIssue = /v[aä]rske kontrollitav ettev[oõ]tteallikas puudub|ei vasta veebidomeenile/iu

const displayLeadIssue = (value: unknown) => {
  const issue = String(value ?? '').trim()
  if (technicalVerificationIssue.test(issue)) {
    return 'Veebikontroll ei saanud ettevõtte lehte tehniliselt kinnitada. Proovi kirja koostamist uuesti.'
  }
  return issue
}

const displayLeadIssues = (issues: unknown) => Array.isArray(issues)
  ? issues.map(displayLeadIssue).filter(Boolean).join(' ')
  : ''

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
  qualification: LeadQualification
  status: LeadStatus
  draft_subject: string
  draft_body: string
  draft_quality: LeadDraftQuality
  delivery_status: 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | null
  sent_at: string | null
  replied_at: string | null
  created_at: string
  updated_at: string
}

type LeadDraft = Pick<SalesLead, 'company_name' | 'contact_email' | 'email_source_url' | 'draft_subject' | 'draft_body'>
type LeadFilter = 'active' | 'ready' | 'sent' | 'replied' | 'blocked' | 'archived'

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

const filters: Array<{ id: LeadFilter; label: string }> = [
  { id: 'active', label: 'Aktiivsed' },
  { id: 'ready', label: 'Saatmiseks valmis' },
  { id: 'sent', label: 'Saadetud' },
  { id: 'replied', label: 'Vastanud' },
  { id: 'blocked', label: 'Loobunud / blokeeritud' },
  { id: 'archived', label: 'Arhiiv' },
]

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
  const [researchLimit, setResearchLimit] = useState(4)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draftFeedback, setDraftFeedback] = useState('')

  const loadLeads = useCallback(async (preferredId?: string | null) => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await requireSupabase().from('sales_leads')
        .select('id,company_name,website_url,source_url,email_source_url,contact_email,contact_kind,location,segment,summary,fit_reason,evidence,fit_score,qualification,status,draft_subject,draft_body,draft_quality,delivery_status,sent_at,replied_at,created_at,updated_at')
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

  const selected = leads.find((lead) => lead.id === selectedId) ?? null
  const visibleLeads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('et')
    return leads.filter((lead) => {
      const matchesFilter = filter === 'active'
        ? ['new', 'ready', 'sending'].includes(lead.status)
        : filter === 'blocked'
          ? ['unsubscribed', 'bounced', 'complained'].includes(lead.status)
          : lead.status === filter
      if (!matchesFilter) return false
      return !needle || [lead.company_name, lead.contact_email, lead.segment, lead.location]
        .some((value) => String(value ?? '').toLocaleLowerCase('et').includes(needle))
    })
  }, [filter, leads, search])

  const counts = useMemo(() => ({
    active: leads.filter((lead) => ['new', 'ready', 'sending'].includes(lead.status)).length,
    ready: leads.filter((lead) => lead.status === 'ready').length,
    sent: leads.filter((lead) => lead.status === 'sent').length,
    replied: leads.filter((lead) => lead.status === 'replied').length,
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
      const skipped = Number(result.not_added_count ?? result.duplicate_or_rejected_count ?? 0)
      setNotice(inserted
        ? `Lisatud ${inserted} kontrollitud sobivat kandidaati${skipped ? `; ${skipped} ebapiisava tõendi, välistava tunnuse või duplikaadi tõttu ei lisatud` : ''}.`
        : `Sobivaid uusi kandidaate ei lisatud${skipped ? `; ${skipped} tulemust ei läbinud kontrolli või oli juba nimekirjas` : ''}.`)
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
        ? 'Kontakt ja kvaliteedikontrolli läbinud kiri on saatmiseks valmis.'
        : Array.isArray((result.quality as LeadDraftQuality | undefined)?.issues) && (result.quality as LeadDraftQuality).issues?.length
          ? `Kiri salvestati, kuid vajab parandamist: ${(result.quality as LeadDraftQuality).issues?.join(' ')}`
          : 'Kontakt on salvestatud, kuid saatmiseks on vaja kontrollitud üldkontakti ja kvaliteedikontrolli läbinud kirja.')
      await loadLeads(selected.id)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  const regenerateDraft = async () => {
    if (!selected) return
    const localDraftBeforeRequest = draft
    try {
      const result = await invoke('draft', { lead_id: selected.id, feedback: draftFeedback })
      if (result.verification_incomplete) {
        setError(String(result.reason || 'Veebikontroll ei saanud ettevõtte lehti kinnitada. Proovi uuesti.'))
        return
      }
      if (result.excluded) {
        setNotice(`Ettevõte eemaldati aktiivsete hulgast: ${String(result.reason || 'värske kontroll leidis selge välistava tunnuse')}`)
      } else if (result.needs_review) {
        setNotice(`Kirja ei koostatud, sest sobivus jäi ebaselgeks: ${String(result.reason || 'kontrolli allikaid ja proovi uuesti')}`)
        await loadLeads(selected.id)
        if (localDraftBeforeRequest) setDraft(localDraftBeforeRequest)
        return
      } else if ((result.quality as LeadDraftQuality | undefined)?.passed === false) {
        const issues = (result.quality as LeadDraftQuality).issues?.join(' ') || 'Mustand vajab käsitsi kontrolli.'
        setNotice(`OpenAI koostas mustandi, kuid kvaliteedivärav jättis selle kontrolli: ${issues}`)
      } else {
        setNotice('OpenAI kontrollis ettevõtet uuesti ja koostas kvaliteedivärava läbinud kirja. Vaata see enne saatmist üle.')
      }
      setDraftFeedback('')
      await loadLeads(result.excluded ? null : selected.id)
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
    const confirmed = window.confirm(`Saadan kirja ettevõttele ${selected.company_name} aadressil ${selected.contact_email}? Seda toimingut ei saa tagasi võtta.`)
    if (!confirmed) return
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

  const chooseLead = (lead: SalesLead) => {
    setSelectedId(lead.id)
    setDraft(toDraft(lead))
    setError('')
    setNotice('')
    setDraftFeedback('')
  }

  return <section className="admin-leads">
    <section className="admin-leads__research">
      <div>
        <span>AVALIKU VEEBI UURING</span>
        <h2>Leia Poeruumile sobivad ettevõtted</h2>
        <p>OpenAI kontrollib esmalt tooteid, olemasolevat ostukorvi ja tellimisteekonda. Kirja koostad pärast kandidaadi allikate ülevaatamist.</p>
      </div>
      <label>
        <span>Milliseid ettevõtteid otsida?</span>
        <textarea rows={3} maxLength={1000} value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} />
      </label>
      <div className="admin-leads__research-actions">
        <label><span>Tulemusi</span><select value={researchLimit} onChange={(event) => setResearchLimit(Number(event.target.value))}>{[2, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        <button type="button" onClick={() => void runResearch()} disabled={Boolean(busyAction) || researchQuery.trim().length < 10}>
          {busyAction === 'search' ? 'OpenAI otsib…' : 'Otsi uusi kliente'}
        </button>
      </div>
    </section>

    <section className="admin-leads__kpis" aria-label="Kliendiotsingu kokkuvõte">
      <article><span>Aktiivseid</span><strong>{counts.active}</strong></article>
      <article><span>Saatmiseks valmis</span><strong>{counts.ready}</strong></article>
      <article><span>Saadetud</span><strong>{counts.sent}</strong></article>
      <article><span>Vastanud</span><strong>{counts.replied}</strong></article>
    </section>

    {(error || notice) && <div className={`admin-leads__notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <section className="admin-leads__panel">
      <header>
        <div className="admin-leads__filters" role="group" aria-label="Filtreeri müügikontakte">
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
        <label className="admin-leads__search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Otsi nime või e-posti" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button className="admin-leads__refresh" type="button" onClick={() => void loadLeads()} disabled={loading}>↻</button>
      </header>

      <div className="admin-leads__workspace">
        <div className="admin-leads__list">
          {loading && !leads.length ? <div className="admin-leads__empty">Laadin kontakte…</div> : visibleLeads.length ? visibleLeads.map((lead) => <button
            type="button"
            key={lead.id}
            className={selectedId === lead.id ? 'is-active' : undefined}
            onClick={() => chooseLead(lead)}
          >
            <i>{lead.fit_score}</i>
            <span><strong>{lead.company_name}</strong><small>{lead.segment || lead.location || 'Segment määramata'}</small><em>{lead.contact_email || 'Üldkontakt puudub'}</em></span>
            <b className={`is-${lead.status}`}>{statusLabels[lead.status]}</b>
          </button>) : <div className="admin-leads__empty"><strong>Kontakte ei leitud</strong><span>Muuda filtrit või käivita uus otsing.</span></div>}
        </div>

        {selected && draft ? <article className="admin-leads__detail">
          <header>
            <div><span>SOBIVUS {selected.fit_score}/100</span><h2>{selected.company_name}</h2><p>{selected.summary || 'Kokkuvõte puudub.'}</p></div>
            <b className={`is-${selected.status}`}>{statusLabels[selected.status]}</b>
          </header>

          <div className="admin-leads__evidence">
            <div><span>{selected.qualification?.decision === 'reject' ? 'Esialgne sobivus' : 'Miks sobib'}</span><p>{displayLeadIssue(selected.fit_reason) || 'Põhjendus puudub.'}</p></div>
            <div><span>Avalik tõend</span><p>{selected.evidence || 'Tõend puudub.'}</p></div>
            {selected.qualification?.last_recheck?.verified_observation && <div><span>Kirja värske tähelepanek</span><p>{selected.qualification.last_recheck.verified_observation}</p></div>}
            {selected.qualification?.decision === 'review' && <div className="admin-leads__qualification"><span>Vajab sobivuse kontrolli</span><p>{displayLeadIssues(selected.qualification.issues) || 'Veebiallikad ei andnud sobivuse kohta ühest vastust.'}</p></div>}
            {selected.qualification?.decision === 'reject' && <div className="admin-leads__qualification is-reject"><span>Värske kontroll välistas kontakti</span><p>{displayLeadIssues(selected.qualification.issues) || 'Ettevõte ei vasta praegu Poeruumi sihtrühmale.'}</p></div>}
            <nav>
              <a href={selected.website_url} target="_blank" rel="noreferrer">Veebileht ↗</a>
              <a href={selected.source_url} target="_blank" rel="noreferrer">Sobivuse allikas ↗</a>
              {selected.qualification?.last_recheck?.verification_url && <a href={selected.qualification.last_recheck.verification_url} target="_blank" rel="noreferrer">Kirja faktiallikas ↗</a>}
              {selected.email_source_url && <a href={selected.email_source_url} target="_blank" rel="noreferrer">Kontakti allikas ↗</a>}
            </nav>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void saveLead() }}>
            <div className="admin-leads__fields">
              <label><span>Ettevõtte nimi</span><input value={draft.company_name} onChange={(event) => setDraft({ ...draft, company_name: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
              <label><span>Ettevõtte üldkontakt</span><input type="email" placeholder="info@ettevote.ee" value={draft.contact_email ?? ''} onChange={(event) => setDraft({ ...draft, contact_email: event.target.value || null })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            </div>
            <label><span>Leht, kus üldkontakt on avalik</span><input type="url" placeholder="https://ettevote.ee/kontakt" value={draft.email_source_url ?? ''} onChange={(event) => setDraft({ ...draft, email_source_url: event.target.value || null })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            <label><span>Kirja teema</span><input maxLength={160} value={draft.draft_subject} onChange={(event) => setDraft({ ...draft, draft_subject: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            <label><span>Kirja sisu</span><textarea rows={9} maxLength={5000} value={draft.draft_body} onChange={(event) => setDraft({ ...draft, draft_body: event.target.value })} disabled={!['new', 'ready', 'archived'].includes(selected.status)} /></label>
            {Boolean(draft.draft_body.trim()) && selected.draft_quality?.passed === false && Boolean(selected.draft_quality.issues?.length) && <div className="admin-leads__quality" role="status"><strong>Mustand vajab parandamist</strong><span>{displayLeadIssues(selected.draft_quality.issues)}</span></div>}
            {['new', 'ready'].includes(selected.status) && <label><span>Soov OpenAI-le järgmise variandi jaoks</span><textarea rows={2} maxLength={500} value={draftFeedback} onChange={(event) => setDraftFeedback(event.target.value)} placeholder="Soovi korral: vähem ametlik, rõhuta telefonist haldamist…" /></label>}
            <small className="admin-leads__policy">Saata saab ainult kontrollitud avalikule üldpostkastile. Süsteem kontrollib mustandi konkreetsust, tooni ja faktipiire ning lisab allkirja, kontakti allika ja loobumisvõimaluse.</small>
            <div className="admin-leads__buttons">
              {['new', 'ready', 'archived'].includes(selected.status) && <button type="submit" disabled={Boolean(busyAction)}>{busyAction === 'save' ? 'Salvestan…' : 'Salvesta'}</button>}
              {['new', 'ready'].includes(selected.status) && <button type="button" className="is-secondary" onClick={() => void regenerateDraft()} disabled={Boolean(busyAction)}>{busyAction === 'draft' ? 'Kontrollin ja koostan…' : draft.draft_body.trim() ? 'Koosta parem variant' : 'Kontrolli ja koosta kiri'}</button>}
              {selected.status === 'ready' && <button type="button" className="is-send" onClick={() => void sendLead()} disabled={Boolean(busyAction)}>{busyAction === 'send' ? 'Saadan…' : 'Kinnita ja saada'}</button>}
              {['new', 'ready'].includes(selected.status) && <button type="button" className="is-quiet" onClick={() => void simpleAction('archive')} disabled={Boolean(busyAction)}>Arhiveeri</button>}
              {selected.contact_email && !['unsubscribed', 'bounced', 'complained'].includes(selected.status) && <button type="button" className="is-danger" onClick={() => void simpleAction('suppress')} disabled={Boolean(busyAction)}>Ära enam kontakteeru</button>}
            </div>
          </form>

          {(selected.sent_at || selected.replied_at || selected.delivery_status) && <footer>
            {selected.sent_at && <span>Saadetud {formatDate(selected.sent_at)}</span>}
            {selected.delivery_status && <span>Tarne: {selected.delivery_status}</span>}
            {selected.replied_at && <span>Vastas {formatDate(selected.replied_at)}</span>}
          </footer>}
        </article> : <div className="admin-leads__placeholder">Vali kontakt, et näha allikaid ja kirjamustandit.</div>}
      </div>
    </section>
  </section>
}
