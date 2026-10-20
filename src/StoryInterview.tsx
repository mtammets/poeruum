import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Brand } from './Brand'
import DirectoryStoryHero from './DirectoryStoryHero'
import { callStoryInterview, prepareStoryImage, readInterviewToken, storyInterviewPreview, StoryRequestError, type StoryDraft, type StoryInterview as Interview } from './lib/storyInterview'
import { applySeoMetadata } from './lib/seo'
import { NAME_QUESTION, storyAnswerCount } from '../supabase/functions/_shared/story-interview'
import './storyInterview.css'

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
const Photo = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg>
const Spinner = () => <span className="story-interview__dots" aria-hidden="true"><i /><i /><i /></span>

type PhotoSlot = 'cover' | 'body'

function useInterviewDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const { overflow, paddingRight } = document.body.style
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [])
  return dialog
}

function PhotoUploadProgress() {
  const dialog = useInterviewDialog()
  return <dialog ref={dialog} className="story-interview__upload-progress" aria-label="Foto lisamine" onCancel={(event) => event.preventDefault()}>
    <div role="status" aria-atomic="true"><Spinner /><p>Lisan fotot…</p></div>
  </dialog>
}

function RestartInterviewDialog({ busy, error, onCancel, onConfirm }: {
  busy: boolean; error: string; onCancel: () => void; onConfirm: () => void
}) {
  const dialog = useInterviewDialog()
  const titleId = useId(), descriptionId = useId()
  return <dialog ref={dialog} className="story-interview__restart-dialog" role="alertdialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2 id={titleId}>Alustad intervjuud uuesti?</h2>
    <p id={descriptionId}>Senised vastused, loo mustand ja lisatud fotod kustutatakse. Seda ei saa tagasi võtta.</p>
    {error && <p className="story-interview__error" role="alert">{error}</p>}
    <div className="story-interview__actions">
      <button type="button" className="story-interview__secondary" autoFocus disabled={busy} onClick={onCancel}>Jätka intervjuud</button>
      <button type="button" className="story-interview__primary" disabled={busy} onClick={onConfirm}>{busy ? 'Alustan uuesti…' : 'Alusta uuesti'}</button>
    </div>
  </dialog>
}

function StoryPhotos({ interview, busy, onPick, onRemove }: {
  interview: Interview; busy: boolean; onPick: (slot: PhotoSlot) => void; onRemove: () => void
}) {
  return <div className="story-interview__photos" aria-busy={busy}>
    <div className="story-interview__photo-card">
      <h2>Avafoto</h2><p>Artikli pealkirja kõrval.</p>
      {interview.imageUrl && <img src={interview.imageUrl} alt={interview.imageAlt} />}
      <button type="button" className="story-interview__secondary" disabled={busy} onClick={() => onPick('cover')}><Photo />{interview.imageUrl ? 'Vaheta avafotot' : 'Lisa foto'}</button>
    </div>
    {interview.bodyImageUrl !== undefined && <div className="story-interview__photo-card">
      <h2>Foto artikli sees</h2><p>Valikuline. Näiteks tööprotsess või mõni detail.</p>
      {interview.bodyImageUrl && <img src={interview.bodyImageUrl} alt={interview.bodyImageAlt || ''} />}
      <div className="story-interview__photo-buttons">
        <button type="button" className="story-interview__secondary" disabled={busy} onClick={() => onPick('body')}><Photo />{interview.bodyImageUrl ? 'Vaheta teist fotot' : 'Lisa teine foto'}</button>
        {interview.bodyImageUrl && <button type="button" className="story-interview__secondary" disabled={busy} onClick={onRemove}>Eemalda teine foto</button>}
      </div>
    </div>}
  </div>
}

function DraftEditor({ draft, interview, photosOnly, busy, onPick, onRemove, onSave, onCancel }: {
  draft: StoryDraft; interview: Interview; photosOnly: boolean; busy: boolean
  onPick: (slot: PhotoSlot) => void; onRemove: () => void
  onSave: (draft: StoryDraft, alt: string, bodyAlt: string, bodyCaption: string) => void; onCancel: () => void
}) {
  const [value, setValue] = useState(draft)
  const [alt, setAlt] = useState(interview.imageAlt)
  const [bodyAlt, setBodyAlt] = useState(interview.bodyImageAlt || interview.storeName)
  const [bodyCaption, setBodyCaption] = useState(interview.bodyImageCaption || '')
  const update = (key: keyof StoryDraft, text: string) => setValue((current) => ({ ...current, [key]: key === 'opening' ? text.split(/\n\s*\n/).filter((p) => p.trim()) : text }))
  return <form className="story-interview__editor" onSubmit={(event) => { event.preventDefault(); onSave(value, alt, bodyAlt, bodyCaption) }}>
    <h1>{photosOnly ? 'Fotod' : 'Muuda lugu'}</h1>
    {!photosOnly && <><label>Pealkiri<textarea required rows={2} maxLength={180} value={value.title} onChange={(event) => update('title', event.target.value)} /></label>
    <label>Sissejuhatus<textarea required rows={4} maxLength={900} value={value.intro} onChange={(event) => update('intro', event.target.value)} /></label>
    <label>Loo algus<textarea required rows={7} maxLength={15000} defaultValue={value.opening.join('\n\n')} onChange={(event) => update('opening', event.target.value)} /></label>
    <label>Tsitaat<textarea rows={2} maxLength={600} value={value.quote} onChange={(event) => update('quote', event.target.value)} /></label>
    {value.sections.map((section, index) => <fieldset key={index}>
      <legend>Osa {index + 1}</legend>
      <label>Alapealkiri<input required maxLength={160} value={section.title} onChange={(event) => setValue((current) => ({ ...current, sections: current.sections.map((item, i) => i === index ? { ...item, title: event.target.value } : item) }))} /></label>
      <label>Tekst<textarea required rows={8} maxLength={18000} defaultValue={section.paragraphs.join('\n\n')} onChange={(event) => setValue((current) => ({ ...current, sections: current.sections.map((item, i) => i === index ? { ...item, paragraphs: event.target.value.split(/\n\s*\n/).filter((p) => p.trim()) } : item) }))} /></label>
    </fieldset>)}</>}
    <StoryPhotos interview={interview} busy={busy} onPick={onPick} onRemove={onRemove} />
    <label>Pildiallkiri<input maxLength={300} value={value.imageCaption} onChange={(event) => update('imageCaption', event.target.value)} /></label>
    <label>Pildi kirjeldus<input required maxLength={300} value={alt} onChange={(event) => setAlt(event.target.value)} /></label>
    {interview.bodyImageUrl && <>
      <label>Teise foto allkiri<input maxLength={300} value={bodyCaption} onChange={(event) => setBodyCaption(event.target.value)} /></label>
      <label>Teise foto kirjeldus<input required maxLength={300} value={bodyAlt} onChange={(event) => setBodyAlt(event.target.value)} /></label>
    </>}
    <div className="story-interview__actions"><button className="story-interview__secondary" type="button" disabled={busy} onClick={onCancel}>Tagasi</button><button className="story-interview__primary" disabled={busy}>{busy ? 'Salvestan…' : 'Salvesta'}</button></div>
  </form>
}

export default function StoryInterview() {
  const [token, setToken] = useState(readInterviewToken)
  useEffect(() => {
    applySeoMetadata({ title: 'Intervjuu — Poeruum', description: '', canonicalUrl: `${window.location.origin}/lugu/`, noIndex: true })
    // A generic canonical URL can replace a personal invitation in link previews.
    document.head.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach(element => element.remove())
    const sync = () => {
      const nextToken = readInterviewToken()
      if (nextToken) {
        const url = new URL(window.location.href)
        url.searchParams.delete('token')
        url.hash = new URLSearchParams({ token: nextToken }).toString()
        if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
      setToken(nextToken)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return <InterviewSession key={token || 'invalid'} token={token} />
}

function InterviewSession({ token }: { token: string | null }) {
  const [interview, setInterview] = useState<Interview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [answer, setAnswer] = useState('')
  const [sendingAnswer, setSendingAnswer] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [editing, setEditing] = useState<'story' | 'photos' | null>(null)
  const [restartOpen, setRestartOpen] = useState(false)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const pending = useRef<{ signature: string; requestId: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const bodyPhotoInput = useRef<HTMLInputElement>(null)
  const pickPhoto = (slot: PhotoSlot) => (slot === 'body' ? bodyPhotoInput : photoInput).current?.click()

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setUnavailable(false); setInterview(null); setEditing(null)
    if (!token) { setUnavailable(true); setLoading(false); return }
    callStoryInterview<{ interview: Interview }>({ action: 'load', token }).then(({ interview }) => {
      if (active) setInterview(interview)
    }).catch((error) => {
      if (!active) return
      setUnavailable(error instanceof StoryRequestError && error.status === 410)
      setError(error instanceof Error ? error.message : 'Vestlust ei õnnestunud avada.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, reload])

  useEffect(() => {
    if (busy === 'upload' || !interview || (!interview.needsName && !['interview', 'photo'].includes(interview.status))) return
    end.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' })
  }, [interview, busy])

  useEffect(() => {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`
  }, [answer])

  const mutate = async (action: string, data: Record<string, unknown> = {}, current = interview) => {
    if (!current || !token) throw new Error('Vestlust ei leitud.')
    const signature = JSON.stringify({ action, data, version: current.version })
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() }
    const { interview: next } = await callStoryInterview<{ interview: Interview }>({ action, token, version: current.version, requestId: pending.current.requestId, ...data })
    pending.current = null
    setInterview(next)
    return next
  }

  const run = async (label: string, work: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(label); setError('')
    try { await work() } catch (error) {
      if (error instanceof StoryRequestError && error.status === 410) setUnavailable(true)
      setError(error instanceof Error ? error.message : 'Ühendus katkes. Proovi uuesti.')
      // Reconcile a changed tab or a committed operation whose response was lost.
      if (token && error instanceof StoryRequestError && error.status === 409) {
        try {
          const { interview: next } = await callStoryInterview<{ interview: Interview }>({ action: 'load', token })
          if (next.lastRequestId === pending.current?.requestId) { setAnswer(''); setError(''); pending.current = null }
          setInterview(next)
        } catch { /* Keep the original action error and the unsent input. */ }
      }
    } finally { inFlight.current = false; setBusy('') }
  }

  const send = (event: FormEvent) => {
    event.preventDefault()
    if (!answer.trim()) return
    void run('answer', async () => {
      const submittedAnswer = answer
      setSendingAnswer(submittedAnswer.trim()); setAnswer('')
      try {
        const next = await mutate(interview?.needsName ? 'name' : 'answer', { answer: submittedAnswer.trim() })
        input.current?.focus()
        if (next.status === 'preview') window.scrollTo({ top: 0, behavior: 'instant' })
      } catch (error) {
        setAnswer(submittedAnswer)
        throw error
      } finally { setSendingAnswer('') }
    })
  }
  const generate = async (current = interview) => { setBusy('generate'); await mutate('generate', {}, current); window.scrollTo({ top: 0, behavior: 'instant' }) }
  const upload = (slot: PhotoSlot, file?: File) => {
    if (!file) return
    void run('upload', async () => {
      // Older servers treat every upload as the cover; never send them a body photo.
      if (slot === 'body' && interview?.bodyImageUrl === undefined) throw new Error('Teise foto lisamine pole veel saadaval.')
      const image = await prepareStoryImage(file)
      await mutate('upload', { image, slot })
    })
  }
  const removeBodyPhoto = () => void run('remove-image', async () => { await mutate('remove-image', { slot: 'body' }) })
  const restart = () => void run('restart', async () => {
    await mutate('restart')
    setAnswer(''); setSendingAnswer(''); setEditing(null); setRestartOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  })
  const count = interview ? storyAnswerCount(interview.messages) : 0
  const preview = storyInterviewPreview(interview)
  const canRestart = !loading && !unavailable && interview && ['interview', 'photo', 'preview'].includes(interview.status)
    && Boolean(interview.messages.some((message) => message.role === 'user') || interview.draft || interview.imageUrl || interview.bodyImageUrl || answer.trim())
  const showRestart = restartOpen && canRestart

  return <main className={`story-interview${interview?.status === 'preview' && !interview.needsName ? ' story-interview--preview' : ''}`}>
    <header className="story-interview__header">
      <div className="story-interview__brand"><Brand /></div>
      <div className="story-interview__header-actions">
        <span className="story-interview__shop">{interview?.storeName}</span>
        {canRestart && <button type="button" className="story-interview__restart" disabled={Boolean(busy)} onClick={() => { setError(''); setRestartOpen(true) }}>Alusta uuesti</button>}
      </div>
    </header>
    <input ref={photoInput} className="story-interview__file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Lisa foto" disabled={Boolean(busy)} onChange={(event) => { upload('cover', event.target.files?.[0]); event.target.value = '' }} />
    <input ref={bodyPhotoInput} className="story-interview__file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Lisa teine foto" disabled={Boolean(busy)} onChange={(event) => { upload('body', event.target.files?.[0]); event.target.value = '' }} />
    {loading ? <div className="story-interview__center" role="status" aria-label="Avan vestlust"><Spinner /></div>
      : unavailable ? <div className="story-interview__center">
        <h1>{token ? 'See link ei kehti enam.' : 'Intervjuulink on poolik.'}</h1>
        {!token && <p>Ava sulle saadetud täispikk intervjuulink. Sõnumirakenduses proovi link kopeerida ja avada telefoni veebibrauseris.</p>}
        <a href="mailto:info@poeruum.ee">Küsi uut linki</a>
      </div>
        : !interview ? <div className="story-interview__center"><p role="alert">{error}</p><button className="story-interview__primary" onClick={() => setReload((n) => n + 1)}>Proovi uuesti</button></div>
          : interview.status === 'pending_review' ? <div className="story-interview__center story-interview__done">
            <span className="story-interview__check" aria-hidden="true">✓</span><h1>Aitäh! Sinu lugu on valmis.</h1>
            <p>Lugu ootab Poeruumi administraatori kinnitust. Pärast kinnitamist ilmub see Poeruumis.</p>
            <a className="story-interview__primary" href="https://kaubamaja.poeruum.ee/">Vaata kaubamaja</a>
          </div>
          : interview.status === 'published' ? <div className="story-interview__center story-interview__done">
            <span className="story-interview__check" aria-hidden="true">✓</span><h1>{interview.publishedUrl ? 'Sinu lugu on avaldatud.' : 'Sinu lugu on valmis.'}</h1>
            {interview.publishedUrl && <a className="story-interview__primary" href={interview.publishedUrl}>Vaata oma lugu <Arrow /></a>}
            <a className={interview.publishedUrl ? 'story-interview__secondary' : 'story-interview__primary'} href="https://kaubamaja.poeruum.ee/">Vaata kaubamaja</a>
          </div>
            : interview.status === 'preview' && preview && !interview.needsName ? <div className="story-interview__preview">
              {editing ? <DraftEditor draft={interview.draft!} interview={interview} photosOnly={editing === 'photos'} busy={Boolean(busy)}
                onPick={pickPhoto} onRemove={removeBodyPhoto} onCancel={() => setEditing(null)}
                onSave={(draft, imageAlt, bodyImageAlt, bodyImageCaption) => void run('save', async () => { await mutate('save', { draft, imageAlt, bodyImageAlt, bodyImageCaption }); setEditing(null); window.scrollTo({ top: 0, behavior: 'instant' }) })} />
                : <><DirectoryStoryHero story={preview} preview />
                  <div className="story-interview__preview-actions">
                    <button className="story-interview__secondary" disabled={Boolean(busy)} onClick={() => setEditing('story')}>Muuda</button>
                    <button className="story-interview__photo-change" disabled={Boolean(busy)} onClick={() => { setEditing('photos'); window.scrollTo({ top: 0, behavior: 'instant' }) }} aria-label="Fotod" title="Lisa või muuda fotosid"><Photo /></button>
                    <button className="story-interview__primary" disabled={Boolean(busy)} onClick={() => void run('submit', async () => { await mutate('submit'); window.scrollTo({ top: 0, behavior: 'instant' }) })}>{busy === 'submit' ? 'Saadan…' : 'Valmis'}</button>
                  </div></>}
              {error && !showRestart && <p className="story-interview__error" role="alert">{error}</p>}
            </div>
              : <div className="story-interview__conversation">
                <div className="story-interview__messages" role="log" aria-label="Intervjuu" aria-live="polite" aria-relevant="additions">
                  {(interview.needsName ? [{ role: 'assistant', content: NAME_QUESTION }] : interview.messages).map((message, index) => <div key={index} className={`story-interview__message story-interview__message--${message.role}`}><span className="story-interview__sr">{message.role === 'assistant' ? 'Intervjueerija: ' : 'Sina: '}</span>{message.content}</div>)}
                  {sendingAnswer && <div className="story-interview__message story-interview__message--user"><span className="story-interview__sr">Sina: </span>{sendingAnswer}</div>}
                </div>
                {busy && busy !== 'upload' && <div className="story-interview__working" role="status"><Spinner /><span>{busy === 'generate' ? 'Kirjutan sinu lugu…' : 'Mõtlen kaasa…'}</span></div>}
                {error && !showRestart && <p className="story-interview__error" role="alert">{error}</p>}
                {interview.status === 'photo' && !interview.needsName && <div className="story-interview__photo">
                  <StoryPhotos interview={interview} busy={Boolean(busy)} onPick={pickPhoto} onRemove={removeBodyPhoto} />
                  {interview.imageUrl && <button className="story-interview__primary" disabled={Boolean(busy)} onClick={() => void run('generate', () => generate())}>Loo eelvaade</button>}
                </div>}
                <div ref={end} className="story-interview__end" />
                {(interview.status === 'interview' || interview.needsName) && <div className="story-interview__composer-wrap">
                  <form className="story-interview__composer" onSubmit={send}>
                    <textarea ref={input} aria-label="Sinu vastus" placeholder="Kirjuta siia…" rows={1} maxLength={interview.needsName ? 120 : 4000} autoComplete={interview.needsName ? 'name' : 'off'} value={answer} readOnly={Boolean(busy)} onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { event.preventDefault(); if (!busy && answer.trim()) send(event) } }} />
                    <button type="submit" aria-label="Saada vastus" disabled={Boolean(busy) || !answer.trim()}><Arrow /></button>
                  </form>
                  {!interview.needsName && count >= 3 && <button className="story-interview__finish" disabled={Boolean(busy) || Boolean(answer.trim())} onClick={() => void run('finish', async () => { await mutate('finish') })}>Lõpeta vestlus</button>}
                </div>}
              </div>}
    {busy === 'upload' && <PhotoUploadProgress />}
    {showRestart && <RestartInterviewDialog busy={Boolean(busy)} error={error} onCancel={() => { setRestartOpen(false); setError('') }} onConfirm={restart} />}
  </main>
}
