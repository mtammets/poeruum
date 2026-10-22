import { useEffect, useState } from 'react'
import {
  campaignStatus, DirectoryCampaignConflict, fromTallinnInput, loadDirectoryCampaign,
  saveDirectoryCampaign, toTallinnInput, type CampaignMode, type DirectoryCampaign,
} from './lib/directoryCampaign'
import './adminStoreDirectory.css'
import './adminDirectoryCampaign.css'

const options = [
  ['off', 'Väljas', 'Kaubamajas on tavaline kujundus.'],
  ['on', 'Kohe sees', 'Kampaania kestab, kuni selle välja lülitad.'],
  ['scheduled', 'Ajastatud', 'Algab ja lõpeb valitud ajal automaatselt.'],
] as const
const labels = { off: 'Väljas', active: 'Praegu aktiivne', waiting: 'Ootab algusaega', ended: 'Lõppenud' }
const draftOf = (campaign: DirectoryCampaign) => ({
  mode: campaign.mode, start: toTallinnInput(campaign.startsAt), end: toTallinnInput(campaign.endsAt),
})

function previewUrl() {
  const url = import.meta.env.DEV ? new URL('/', window.location.href) : new URL('https://kaubamaja.poeruum.ee/')
  if (import.meta.env.DEV) url.searchParams.set('preview', 'kaubamaja')
  url.searchParams.set('theme', 'black-friday')
  return url.href
}

export default function AdminDirectoryCampaign() {
  const [saved, setSaved] = useState<DirectoryCampaign | null>(null)
  const [receivedAt, setReceivedAt] = useState(0)
  const [draft, setDraft] = useState<{ mode: CampaignMode; start: string; end: string }>({ mode: 'off', start: '', end: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [, setClock] = useState(0)
  const dirty = !!saved && JSON.stringify(draft) !== JSON.stringify(draftOf(saved))
  const busy = loading || saving
  const editable = !!saved && !busy && !conflict
  const state = campaignStatus(saved, saved ? Date.parse(saved.serverNow) + performance.now() - receivedAt : 0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    setLoading(true); setError(''); setNotice('')
    void loadDirectoryCampaign(controller.signal).then(campaign => {
      if (!active) return
      setSaved(campaign); setReceivedAt(performance.now()); setDraft(draftOf(campaign)); setConflict(false)
    }).catch(error => {
      if (active) { setSaved(null); setError(error instanceof Error ? error.message : 'Kampaaniat ei õnnestunud laadida.') }
    }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false) })
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [reload])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async () => {
    if (!editable || !saved || !dirty) return
    setError(''); setNotice('')
    let startsAt: string | null = saved.startsAt
    let endsAt: string | null = saved.endsAt
    try {
      if (draft.mode === 'scheduled') {
        startsAt = fromTallinnInput(draft.start)
        endsAt = fromTallinnInput(draft.end)
        if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Lõpuaeg peab olema algusajast hilisem.')
      }
    } catch (cause) { setError((cause as Error).message); return }
    setSaving(true)
    try {
      const campaign = await saveDirectoryCampaign({ mode: draft.mode, startsAt, endsAt, revision: saved.revision })
      setSaved(campaign); setReceivedAt(performance.now()); setDraft(draftOf(campaign))
      setNotice(campaign.mode === 'off' ? 'Kampaania on välja lülitatud.'
        : campaign.mode === 'on' ? 'Kampaania on sisse lülitatud.' : 'Kampaania ajastus on salvestatud.')
    } catch (cause) {
      setConflict(cause instanceof DirectoryCampaignConflict)
      setError(cause instanceof Error ? cause.message : 'Kampaaniat ei õnnestunud salvestada.')
    } finally { setSaving(false) }
  }

  return <section className="admin-directory directory-campaign" aria-labelledby="directory-campaign-heading" aria-busy={busy}>
    <header className="admin-directory__header">
      <div><h2 id="directory-campaign-heading">Musta rähni päevad</h2><p>Halda Kaubamaja kampaaniakujundust ja selle kestust.</p></div>
      <a href={previewUrl()} target="_blank" rel="noopener noreferrer">Ava kampaania eelvaade ↗</a>
    </header>
    {saved && <p className="directory-campaign__state" data-state={state}><span>Salvestatud olek</span><strong>{labels[state]}</strong></p>}
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset disabled={!editable} className="directory-campaign__modes">
        <legend>Kampaania kuvamine</legend>
        {options.map(([mode, label, hint]) => <label key={mode}>
          <input type="radio" name="directory-campaign-mode" value={mode} checked={draft.mode === mode}
            onChange={() => { setDraft(current => ({ ...current, mode })); setNotice(''); setError('') }} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
      </fieldset>
      {draft.mode === 'scheduled' && <fieldset disabled={!editable} className="directory-campaign__dates">
        <legend>Algus ja lõpp · Eesti aeg</legend>
        <label>Algusaeg<input type="datetime-local" required value={draft.start}
          onChange={event => { setDraft(current => ({ ...current, start: event.target.value })); setError('') }} /></label>
        <label>Lõpuaeg<input type="datetime-local" required value={draft.end}
          onChange={event => { setDraft(current => ({ ...current, end: event.target.value })); setError('') }} /></label>
        <p>Kõik kellaajad on Eesti aja järgi. Lõpuajal taastub automaatselt tavaline kujundus.</p>
      </fieldset>}
      <div className="admin-directory__actions">
        <button type="submit" className="admin-directory__save" disabled={!editable || !dirty}>{saving ? 'Salvestan…' : 'Salvesta kampaania'}</button>
        <button type="button" disabled={!editable || !dirty} onClick={() => { if (saved) setDraft(draftOf(saved)); setError(''); setNotice('Muudatused on tühistatud.') }}>Tühista muudatused</button>
        <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{dirty || conflict ? 'Laadi salvestatud seadistus' : 'Uuenda olekut'}</button>
      </div>
    </form>
    {error && <p className="admin-directory__error" role="alert">{error}</p>}
    <p className="admin-directory__notice" role="status">{loading ? 'Laadin kampaaniat…' : notice || (dirty ? 'Muudatused on salvestamata.' : '')}</p>
    <p className="directory-campaign__hint">Juba avatud Kaubamaja vaated võtavad muudatuse üle kuni 30 sekundiga. Eelvaade ei muuda külastajate vaadet.</p>
  </section>
}
