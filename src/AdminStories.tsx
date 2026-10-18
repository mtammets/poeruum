import { useEffect, useState } from 'react'
import { callStoryInterview, interviewLink, type StoryAdminData } from './lib/storyInterview'
import './adminStories.css'

const statuses = { interview: 'Vestlus', photo: 'Foto ootel', preview: 'Eelvaade', published: 'Avaldatud', revoked: 'Link suletud' }

export default function AdminStories() {
  const [data, setData] = useState<StoryAdminData | null>(null)
  const [storeId, setStoreId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<{ id: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const stores = data?.stores.filter((store) => store.is_published) ?? []
  const selectedStoreId = stores.some((store) => store.id === storeId) ? storeId : ''
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    callStoryInterview<StoryAdminData>({ action: 'admin-list' }, true).then((result) => { if (active) { setData(result); setError('') } })
      .catch((error) => { if (active) setError(error instanceof Error ? error.message : 'Lugusid ei õnnestunud laadida.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  const action = async (body: Record<string, unknown>) => {
    if (busy) return
    setBusy(true); setError(''); setCopied(false)
    try {
      const result = await callStoryInterview<{ id: string; token?: string }>(body, true)
      if (result.token) setInvite({ id: result.id, url: interviewLink(result.token) })
      else if (body.action === 'admin-revoke' && body.id === invite?.id) setInvite(null)
      setRefresh((n) => n + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Toiming ebaõnnestus.') }
    finally { setBusy(false) }
  }
  const copy = async () => {
    if (!invite) return
    try { await navigator.clipboard.writeText(invite.url); setCopied(true) }
    catch { setError('Kopeeri link lingiväljalt.') }
  }
  return <section className="admin-stories" aria-labelledby="admin-stories-title">
    <header className="admin-stories__heading"><h2 id="admin-stories-title">Poeruumi lood</h2><button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={busy || loading}>Värskenda</button></header>
    {error && <p role="alert" className="admin-stories__error">{error}</p>}
    {loading && !data && <p role="status">Laadin lugusid…</p>}
    {data && <>
      <form className="admin-stories__create" onSubmit={(event) => { event.preventDefault(); void action({ action: 'admin-create', storeId: selectedStoreId }) }}>
        <label htmlFor="story-store">Kaupmees</label>
        <div><select id="story-store" required value={selectedStoreId} onChange={(event) => setStoreId(event.target.value)} disabled={busy}>
          <option value="">Vali pood</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select><button type="submit" className="admin-stories__primary" disabled={busy || !selectedStoreId || !data.aiAvailable}>{busy ? 'Oota…' : 'Loo intervjuulink'}</button></div>
      </form>
      {!data.aiAvailable && <p role="alert" className="admin-stories__error">AI-intervjuu pole seadistatud. Lisa serverisse OPENAI_API_KEY.</p>}
      {invite && <div className="admin-stories__invite">
        <label htmlFor="story-invite-link">Intervjuulink</label>
        <input id="story-invite-link" readOnly value={invite.url} onFocus={(event) => event.target.select()} />
        <div><button className="admin-stories__primary" onClick={() => void copy()}>{copied ? 'Kopeeritud' : 'Kopeeri link'}</button>
          <a href={`sms:?&body=${encodeURIComponent(`Jaga oma poe lugu Poeruumis: ${invite.url}`)}`}>Ava SMS-is</a>
          <a href={invite.url} target="_blank" rel="noopener noreferrer">Ava intervjuu ↗</a></div>
      </div>}
      <ul className="admin-stories__list" aria-label="Intervjuud">
        {data.interviews.map((interview) => {
          const expired = new Date(interview.expires_at).getTime() < Date.now()
          const active = !['published', 'revoked'].includes(interview.status)
          return <li key={interview.id}>
            <div className="admin-stories__identity"><strong>{interview.store_name || data.stores.find((store) => store.id === interview.store_id)?.name || 'Pood'}</strong>
              <span>{interview.article && !interview.article.is_published ? 'Peidetud' : active && expired ? 'Link aegunud' : statuses[interview.status]} · {new Date(interview.created_at).toLocaleDateString('et-EE')}</span></div>
            <div className="admin-stories__row-actions">
              {active && <><button disabled={busy} onClick={() => void action({ action: 'admin-renew', id: interview.id })}>Uuenda linki</button>
                <button disabled={busy} onClick={() => void action({ action: 'admin-revoke', id: interview.id })}>Sulge link</button></>}
              {interview.article && <>
                {interview.article.is_published && <a href={`https://kaubamaja.poeruum.ee/lood/${interview.article.slug}/`} target="_blank" rel="noopener noreferrer">Vaata lugu ↗</a>}
                <button disabled={busy} onClick={() => void action({ action: 'admin-visibility', id: interview.id, published: !interview.article!.is_published })}>{interview.article.is_published ? 'Peida lugu' : 'Avalda uuesti'}</button>
              </>}
            </div>
          </li>
        })}
      </ul>
      {!data.interviews.length && <p className="admin-stories__empty">Intervjuusid veel pole.</p>}
    </>}
  </section>
}
