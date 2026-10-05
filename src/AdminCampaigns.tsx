import { useEffect, useRef, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import { parseCampaignCopy } from '../supabase/functions/_shared/campaign-schema'
import { campaignCopyLimits, campaignLink, createCampaign, defaultMedia, templateCopy, templates, validateCampaign, type CampaignDocument, type CampaignCopy } from './campaigns/model'
import { prepareCampaignImage } from './campaigns/render'
import { campaignZip, downloadBlob, exportCampaign, zipName, type CampaignFile } from './campaigns/export'
import { listCampaignVersions, loadCampaignVersion, loadLocalCampaign, saveCampaignVersion, saveLocalCampaign, type CampaignVersion } from './campaigns/storage'
import CampaignEditor from './campaigns/CampaignEditor'
import PhoneContentEditor from './campaigns/PhoneContentEditor'
import { mediaSource } from './campaigns/phoneContent'
import './adminCampaigns.css'

const fieldLabels: Record<keyof typeof campaignCopyLimits, string> = {
  support: 'Toetav lause', cta: 'Üleskutse', captionShort: 'Lühike postitus', captionLong: 'Pikem postitus', adTitle: 'Reklaami pealkiri',
}
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Midagi läks valesti. Proovi uuesti.'

export default function AdminCampaigns({ userId }: { userId: string }) {
  const [doc, setDoc] = useState<CampaignDocument>(() => createCampaign())
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<'reel' | 'post' | 'story' | 'text'>('reel')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [storageError, setStorageError] = useState('')
  const [versions, setVersions] = useState<CampaignVersion[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [ai, setAi] = useState<{ available: boolean; estimatedCostUsd: number } | null>(null)
  const [useAI, setUseAI] = useState(false)
  const [files, setFiles] = useState<CampaignFile[]>([])
  const [videoUrl, setVideoUrl] = useState('')
  const [dirty, setDirty] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const generatedDoc = useRef<CampaignDocument | null>(null)
  const draftQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    mounted.current = true
    let canceled = false
    void loadLocalCampaign(userId).then((draft) => { if (!canceled && draft) setDoc(draft) })
      .catch(() => { if (!canceled) setStorageError('Brauseri mustandit ei saanud avada.') })
      .finally(() => { if (!canceled) setReady(true) })
    void listCampaignVersions(userId).then(({ versions }) => { if (!canceled) setVersions(versions) })
    void requireSupabase().functions.invoke('admin-campaign-copy', { body: { action: 'capabilities' } }).then(({ data, error }) => {
      if (!canceled) setAi({ available: !error && data?.available === true, estimatedCostUsd: typeof data?.estimatedCostUsd === 'number' ? data.estimatedCostUsd : .02 })
    }).catch(() => { if (!canceled) setAi({ available: false, estimatedCostUsd: .02 }) })
    return () => { canceled = true; mounted.current = false; controller.current?.abort() }
  }, [userId])

  useEffect(() => {
    if (!ready) return
    setSaveStatus('Salvestan mustandit…')
    draftQueue.current = draftQueue.current.catch(() => {}).then(() => saveLocalCampaign(userId, doc)).then(() => {
      if (mounted.current) { setSaveStatus('Mustand selles brauseris'); setStorageError('') }
    }).catch(() => { if (mounted.current) { setSaveStatus('Mustand salvestamata'); setStorageError('Brauserisse salvestamine ebaõnnestus. Laadi kampaaniapakett alla, et töö säiliks.') } })
  }, [doc, ready, userId])

  const video = files.find((f) => f.name === 'reels-heliga.mp4') ?? files.find((f) => f.kind === 'video')
  useEffect(() => {
    if (!video) { setVideoUrl(''); return }
    const url = URL.createObjectURL(video.blob); setVideoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [video])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [busy])

  function update(next: CampaignDocument) {
    setDoc(next); setDirty(true); setFiles([]); generatedDoc.current = null; setStatus(''); setError('')
  }
  function updateCopy(key: keyof CampaignCopy, value: string | string[]) { update({ ...doc, copy: { ...doc.copy, [key]: value } }) }
  function updateBrief(patch: Partial<CampaignDocument>) {
    const next = { ...doc, ...patch }
    // Keep authored text intact; untouched template copy follows the selected audience/goal.
    if (JSON.stringify(doc.copy) === JSON.stringify(templateCopy(doc))) next.copy = templateCopy(next)
    update(next)
  }

  async function saveVersion(next = doc) {
    const saved = await saveCampaignVersion(userId, next)
    if (mounted.current) {
      setVersions((rows) => [saved, ...rows.filter((v) => v.id !== saved.id)].slice(0, 30)); setDirty(false)
      setSaveStatus(saved.local ? 'Versioon selles brauseris · pilv pole kättesaadav' : 'Versioon pilve salvestatud')
    }
  }

  async function generate() {
    if (busy) return
    if (!validateCampaign(doc)) { setError('Kontrolli kampaania nime, pilte ja väljade pikkust.'); return }
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setError(''); setProgress(0)
    try {
      let next = doc
      const retry = generatedDoc.current === doc && files.length > 0
      if (useAI && !retry) {
        setStatus('Kirjutan kampaania tekste…')
        const { data, error } = await requireSupabase().functions.invoke('admin-campaign-copy', { body: { goal: doc.goal, audience: doc.audience, brief: doc.brief, textAmount: doc.textAmount }, signal: abort.signal })
        abort.signal.throwIfAborted()
        if (error) {
          const response = 'context' in error && error.context instanceof Response ? await error.context.json().catch(() => null) : null
          throw new Error(response?.error || 'AI tekstide loomine ebaõnnestus. Proovi uuesti või lülita AI tekstid välja.')
        }
        const copy = parseCampaignCopy(data?.copy)
        if (!copy) throw new Error('AI ei tagastanud sobivaid tekste. Proovi uuesti.')
        next = { ...doc, copy }; setDoc(next)
        // Further edits and export retries must not spend money or overwrite copy implicitly.
        setUseAI(false)
      }
      generatedDoc.current = next
      if (!retry) {
        try { await saveVersion(next) }
        catch { setStorageError('Versiooni salvestamine ebaõnnestus. Laadi valmis pakett alla, et töö säiliks.') }
      }
      abort.signal.throwIfAborted()
      await exportCampaign(next, retry ? files : [], abort.signal, (message, percent) => {
        if (mounted.current) { setStatus(message); setProgress(percent) }
      }, (readyFiles) => { if (mounted.current) setFiles(readyFiles) })
    } catch (cause) {
      if (mounted.current) {
        if (abort.signal.aborted) setStatus('Loomine peatatud. Valmis failid saad alla laadida.')
        else setError(errorMessage(cause))
      }
    } finally { if (mounted.current) setBusy(false); controller.current = null }
  }
  async function runAction(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (cause) { if (mounted.current) setError(errorMessage(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function replaceImage(index: number, file: File) {
    await runAction(async () => {
      const media = await prepareCampaignImage(file)
      if (mounted.current) update({ ...doc, media: doc.media.map((m, i) => i === index ? media : m) })
    })
  }
  const downloadAll = () => runAction(async () => { downloadBlob(await campaignZip(doc, files), zipName(doc)) })
  const copyText = (text: string) => runAction(async () => { await navigator.clipboard.writeText(text); setStatus('Tekst kopeeritud') })

  if (!ready) return <p role="status">Laadin kampaaniaid…</p>

  return <div className="campaigns">
    <header className="admin-topbar campaigns__header">
      <h1>Kampaaniad</h1>
      <div className="campaigns__header-actions">
        <button type="button" disabled={busy} onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>Versioonid <span>{versions.length}</span></button>
        <button type="button" disabled={busy} onClick={() => void runAction(async () => { if (dirty) await saveVersion(); update(createCampaign()) })}>Uus kampaania</button>
        <button type="button" className="campaigns__primary" disabled={busy} onClick={() => void generate()}>{busy ? 'Koostan…' : files.length > 0 && files.length < 10 ? 'Jätka loomist' : 'Loo failid'}</button>
      </div>
    </header>

    {historyOpen && <section className="campaigns__history" aria-label="Kampaaniate versioonid">
      <header><h2>Versioonid</h2><button type="button" disabled={busy} onClick={() => void runAction(async () => { const result = await listCampaignVersions(userId); setVersions(result.versions); if (!result.cloudAvailable) setStatus('Näitan brauserisse salvestatud versioone.') })}>Uuenda</button></header>
      {!versions.length && <p>Salvestatud versioone pole.</p>}
      <div>{versions.map((v) => <button type="button" key={v.id} disabled={busy} onClick={() => void runAction(async () => {
        if (dirty) await saveVersion()
        const restored = await loadCampaignVersion(userId, v)
        if (mounted.current) { update(restored); setDirty(false); setHistoryOpen(false); setStatus('Versioon avatud.') }
      })}><strong>{v.name}</strong><small>{new Date(v.created_at).toLocaleString('et-EE', { dateStyle: 'short', timeStyle: 'short' })} · {v.local ? 'Selles brauseris' : 'Pilves'}</small></button>)}</div>
    </section>}
    {storageError && <p className="campaigns__notice" role="alert">{storageError}</p>}
    {error && <p className="campaigns__error" role="alert">{error}</p>}

    <div className="campaigns__workspace">
      <aside className="campaigns__settings" aria-label="Kampaania seadistused">
        <fieldset disabled={busy}>
          <legend className="campaigns__sr-only">Kampaania seadistused</legend>
          <label>Kampaania nimi<input maxLength={100} value={doc.name} onChange={(e) => update({ ...doc, name: e.target.value })} /></label>
          <label>Eesmärk<select value={doc.goal} onChange={(e) => updateBrief({ goal: e.target.value as CampaignDocument['goal'] })}><option value="signup">Uued poeloojad</option><option value="showcase">Poeruumi tutvustus</option></select></label>
          <label>Sihtrühm<input maxLength={100} value={doc.audience} onChange={(e) => updateBrief({ audience: e.target.value })} /></label>
          <label>Teksti kujundusel<select value={doc.textAmount} onChange={(e) => update({ ...doc, textAmount: e.target.value as CampaignDocument['textAmount'] })}><option value="minimal">Vähe teksti</option><option value="standard">Koos selgitusega</option></select></label>
        </fieldset>

        <fieldset className="campaigns__design" disabled={busy}>
          <legend className="campaigns__sr-only">Kujundus</legend>
          <div className="campaigns__section-label" id="campaign-template-label">Kujundus</div>
          <div className="campaigns__templates" role="group" aria-labelledby="campaign-template-label">{templates.map((template) => <button type="button" key={template.id} aria-pressed={doc.template === template.id} onClick={() => update({ ...doc, template: template.id })}>{template.name}</button>)}</div>
          <label className="campaigns__background">Taust<select value={doc.variation} onChange={(e) => update({ ...doc, variation: Number(e.target.value) })}><option value={0}>1</option><option value={1}>2</option><option value={2}>3</option></select></label>
        </fieldset>

        <PhoneContentEditor document={doc} disabled={busy} onChange={update} onBusy={setBusy} />

        {(!doc.phoneContent || doc.template !== 'phone') && <details className="campaigns__media">
          <summary>Pildid <span>{doc.media.length}</span></summary>
          <fieldset disabled={busy}><legend className="campaigns__sr-only">Kampaania pildid</legend>
            {doc.media.map((media, index) => <div className="campaigns__media-row" key={index}>
              <img src={mediaSource(doc, media.src)} alt={media.alt} />
              <div><label className="campaigns__upload">Vaheta pilti {index + 1}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void replaceImage(index, file) }} /></label>
                <label>Alternatiivtekst {index + 1}<input maxLength={200} value={media.alt} onChange={(e) => update({ ...doc, media: doc.media.map((m, i) => i === index ? { ...m, alt: e.target.value } : m) })} /></label>
                <label className="campaigns__checkbox"><input type="checkbox" checked={media.kind === 'screen'} onChange={(e) => update({ ...doc, media: doc.media.map((m, i) => i === index ? { ...m, kind: e.target.checked ? 'screen' : 'photo' } : m) })} />Poe ekraanipilt</label>
              </div>
            </div>)}
            <button type="button" className="campaigns__text-button" onClick={() => update({ ...doc, media: structuredClone(defaultMedia) })}>Taasta näidispildid</button>
          </fieldset>
        </details>}

        <fieldset className="campaigns__ai" disabled={busy}>
          <legend className="campaigns__sr-only">AI tekstid</legend>
          <div className="campaigns__ai-option"><label className="campaigns__checkbox"><input type="checkbox" aria-label="Loo uued tekstid AI-ga" checked={useAI} disabled={!ai?.available} onChange={(e) => setUseAI(e.target.checked)} />AI tekstid</label><small>{ai === null ? 'Kontrollin…' : ai.available ? `~${ai.estimatedCostUsd.toLocaleString('et-EE')} USD / kord` : 'Pole saadaval'}</small></div>
          {useAI && <label>Lähteinfo<textarea rows={3} maxLength={700} placeholder="Kampaania sõnum" value={doc.brief} onChange={(e) => update({ ...doc, brief: e.target.value })} /><small>Asendab olemasolevad tekstid.</small></label>}
        </fieldset>
        <footer className="campaigns__save"><small>{saveStatus}</small><button type="button" disabled={busy} onClick={() => void runAction(() => saveVersion())}>Salvesta versioon</button></footer>
      </aside>

      <section className="campaigns__results" aria-label="Kampaania eelvaade">
        <div className="campaigns__tabs" role="tablist" aria-label="Kampaania väljundid">{([['reel', 'Reels'], ['post', 'Postitused'], ['story', 'Story’d'], ['text', 'Tekstid']] as const).map(([key, label]) => <button type="button" role="tab" id={`campaign-tab-${key}`} aria-controls="campaign-panel" key={key} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onKeyDown={(event) => {
          const keys = ['reel', 'post', 'story', 'text'] as const
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (keys.indexOf(key) + (event.key === 'ArrowRight' ? 1 : 3)) % 4
          setTab(keys[next]); window.document.getElementById(`campaign-tab-${keys[next]}`)?.focus()
        }} onClick={() => { setTab(key) }}>{label}</button>)}</div>
        <div id="campaign-panel" role="tabpanel" aria-labelledby={`campaign-tab-${tab}`}>
          {tab !== 'text' && <CampaignEditor key={tab} document={doc} format={tab} disabled={busy} onChange={update} videoUrl={tab === 'reel' ? videoUrl : undefined} />}
          {tab === 'text' && <div className="campaigns__copy"><fieldset disabled={busy}><legend className="campaigns__sr-only">Kampaania tekstid</legend>
            {doc.copy.headlines.map((headline, index) => <label key={index}>Pealkiri {index + 1}<input value={headline} maxLength={72} onChange={(e) => updateCopy('headlines', doc.copy.headlines.map((h, i) => i === index ? e.target.value : h))} /></label>)}
            {Object.entries(campaignCopyLimits).map(([key, max]) => <label key={key} className={key.startsWith('caption') ? 'campaigns__caption' : undefined}>{fieldLabels[key as keyof typeof fieldLabels]}<textarea rows={key.startsWith('caption') ? 4 : 2} maxLength={max} value={doc.copy[key as keyof typeof campaignCopyLimits]} onChange={(e) => updateCopy(key as keyof CampaignCopy, e.target.value)} />{key.startsWith('caption') && <button type="button" className="campaigns__text-button" onClick={() => void copyText(`${doc.copy[key as 'captionShort' | 'captionLong']}\n${campaignLink(doc)}`)}>Kopeeri koos lingiga</button>}</label>)}
            <button type="button" className="campaigns__text-button" onClick={() => update({ ...doc, copy: templateCopy(doc) })}>Taasta mallitekstid</button>
          </fieldset></div>}
        </div>
      </section>
    </div>

    {(busy || status || files.length > 0) && <section className="campaigns__exports" aria-label="Kampaania failid">
      <header><div><h2>Failid{files.length > 0 && <span>{files.length}/10</span>}</h2>{status && <p role="status" aria-live="polite">{status}</p>}</div>
        {busy && controller.current ? <button type="button" onClick={() => controller.current?.abort()}>Peata loomine</button> : files.length > 0 && <button type="button" className="campaigns__primary" disabled={busy} onClick={() => void downloadAll()}>{files.length === 10 ? 'Laadi ZIP' : 'Laadi valmis failid'}</button>}
      </header>
      {busy && controller.current && <progress max={100} value={progress} aria-label="Kampaania loomise edenemine" />}
      <div className="campaigns__file-list">{files.map((file) => <button type="button" key={file.name} onClick={() => downloadBlob(file.blob, file.name)}><span>{file.kind === 'video' ? 'MP4' : file.kind === 'image' ? 'JPG' : 'TXT'}</span><strong>{file.label}</strong><small>{(file.blob.size / 1024 / 1024).toFixed(1)} MB</small><span aria-hidden="true">↓</span></button>)}</div>
    </section>}
  </div>
}
