import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Brand } from './Brand'
import DirectoryStoryArticle from './DirectoryStoryArticle'
import { callStoryInterview, prepareStoryImage, readInterviewToken, StoryRequestError, type StoryDraft, type StoryInterview as Interview } from './lib/storyInterview'
import { applySeoMetadata } from './lib/seo'
import './storyInterview.css'

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
const Photo = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg>
const Spinner = () => <span className="story-interview__dots" aria-hidden="true"><i /><i /><i /></span>

function DraftEditor({ draft, imageAlt, busy, onSave, onCancel }: {
  draft: StoryDraft; imageAlt: string; busy: boolean; onSave: (draft: StoryDraft, alt: string) => void; onCancel: () => void
}) {
  const [value, setValue] = useState(draft)
  const [alt, setAlt] = useState(imageAlt)
  const update = (key: keyof StoryDraft, text: string) => setValue((current) => ({ ...current, [key]: key === 'opening' ? text.split(/\n\s*\n/).filter((p) => p.trim()) : text }))
  return <form className="story-interview__editor" onSubmit={(event) => { event.preventDefault(); onSave(value, alt) }}>
    <h1>Muuda lugu</h1>
    <label>Pealkiri<textarea required rows={2} maxLength={180} value={value.title} onChange={(event) => update('title', event.target.value)} /></label>
    <label>Sissejuhatus<textarea required rows={4} maxLength={900} value={value.intro} onChange={(event) => update('intro', event.target.value)} /></label>
    <label>Loo algus<textarea required rows={7} maxLength={15000} defaultValue={value.opening.join('\n\n')} onChange={(event) => update('opening', event.target.value)} /></label>
    <label>Tsitaat<textarea rows={2} maxLength={600} value={value.quote} onChange={(event) => update('quote', event.target.value)} /></label>
    {value.sections.map((section, index) => <fieldset key={index}>
      <legend>Osa {index + 1}</legend>
      <label>Alapealkiri<input required maxLength={160} value={section.title} onChange={(event) => setValue((current) => ({ ...current, sections: current.sections.map((item, i) => i === index ? { ...item, title: event.target.value } : item) }))} /></label>
      <label>Tekst<textarea required rows={8} maxLength={18000} defaultValue={section.paragraphs.join('\n\n')} onChange={(event) => setValue((current) => ({ ...current, sections: current.sections.map((item, i) => i === index ? { ...item, paragraphs: event.target.value.split(/\n\s*\n/).filter((p) => p.trim()) } : item) }))} /></label>
    </fieldset>)}
    <label>Pildiallkiri<input maxLength={300} value={value.imageCaption} onChange={(event) => update('imageCaption', event.target.value)} /></label>
    <label>Pildi kirjeldus<input required maxLength={300} value={alt} onChange={(event) => setAlt(event.target.value)} /></label>
    <div className="story-interview__actions"><button className="story-interview__secondary" type="button" disabled={busy} onClick={onCancel}>Tagasi</button><button className="story-interview__primary" disabled={busy}>{busy ? 'Salvestan…' : 'Salvesta'}</button></div>
  </form>
}

export default function StoryInterview() {
  const [token, setToken] = useState(readInterviewToken)
  useEffect(() => {
    applySeoMetadata({ title: 'Sinu lugu — Poeruum', description: '', canonicalUrl: `${window.location.origin}/lugu/`, noIndex: true })
    const sync = () => setToken(readInterviewToken())
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
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const pending = useRef<{ signature: string; requestId: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setUnavailable(false); setInterview(null); setEditing(false)
    if (!token) { setUnavailable(true); setLoading(false); return }
    callStoryInterview<{ interview: Interview }>({ action: 'load', token }).then(({ interview }) => {
      if (active) { setInterview(interview); heading.current?.focus() }
    }).catch((error) => {
      if (!active) return
      setUnavailable(error instanceof StoryRequestError && error.status === 410)
      setError(error instanceof Error ? error.message : 'Vestlust ei õnnestunud avada.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, reload])

  useEffect(() => {
    if (!interview || !['interview', 'photo'].includes(interview.status)) return
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
    void run('answer', async () => { await mutate('answer', { answer: answer.trim() }); setAnswer(''); input.current?.focus() })
  }
  const generate = async (current = interview) => { setBusy('generate'); await mutate('generate', {}, current); window.scrollTo({ top: 0, behavior: 'instant' }) }
  const upload = (file?: File) => {
    if (!file) return
    void run('upload', async () => {
      const image = await prepareStoryImage(file)
      const next = await mutate('upload', { image })
      if (next.status === 'photo') await generate(next)
    })
  }
  const count = interview?.messages.filter((message) => message.role === 'user').length ?? 0
  const preview = interview?.draft && interview.imageUrl ? { ...interview.draft,
    slug: '', category: 'Meie kaupmehed', author: interview.storeName, publishedAt: '',
    image: interview.imageUrl, imageAlt: interview.imageAlt, storeName: interview.storeName, storeSlug: interview.storeSlug,
  } : null

  return <main className={`story-interview${interview?.status === 'preview' ? ' story-interview--preview' : ''}`}>
    <header className="story-interview__header">
      <div className="story-interview__brand"><Brand /><span>lood</span></div>
      <span className="story-interview__shop">{interview?.storeName}</span>
    </header>
    <input ref={photoInput} className="story-interview__file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Lisa foto" disabled={Boolean(busy)} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} />
    {loading ? <div className="story-interview__center" role="status" aria-label="Avan vestlust"><Spinner /></div>
      : unavailable ? <div className="story-interview__center"><h1>See link ei kehti enam.</h1><a href="mailto:info@poeruum.ee">Küsi uut linki</a></div>
        : !interview ? <div className="story-interview__center"><p role="alert">{error}</p><button className="story-interview__primary" onClick={() => setReload((n) => n + 1)}>Proovi uuesti</button></div>
          : interview.status === 'published' ? <div className="story-interview__center story-interview__done">
            <span className="story-interview__check" aria-hidden="true">✓</span><h1>{interview.publishedUrl ? 'Sinu lugu on avaldatud.' : 'Sinu lugu on valmis.'}</h1>
            {interview.publishedUrl && <a className="story-interview__primary" href={interview.publishedUrl}>Vaata oma lugu <Arrow /></a>}
          </div>
            : interview.status === 'preview' && preview ? <div className="story-interview__preview">
              {editing ? <DraftEditor draft={interview.draft!} imageAlt={interview.imageAlt} busy={Boolean(busy)} onCancel={() => setEditing(false)}
                onSave={(draft, imageAlt) => void run('save', async () => { await mutate('save', { draft, imageAlt }); setEditing(false); window.scrollTo({ top: 0, behavior: 'instant' }) })} />
                : <><div className="directory-story-page"><DirectoryStoryArticle story={preview} preview /></div>
                  <div className="story-interview__preview-actions">
                    <button className="story-interview__secondary" disabled={Boolean(busy)} onClick={() => setEditing(true)}>Muuda</button>
                    <button className="story-interview__photo-change" disabled={Boolean(busy)} onClick={() => photoInput.current?.click()} aria-label="Vaheta fotot"><Photo /></button>
                    <button className="story-interview__primary" disabled={Boolean(busy)} onClick={() => void run('publish', async () => { await mutate('publish') })}>{busy === 'publish' ? 'Avaldan…' : 'Avalda Poeruumis'}</button>
                  </div></>}
              {error && <p className="story-interview__error" role="alert">{error}</p>}
            </div>
              : <div className="story-interview__conversation">
                <h1 ref={heading} tabIndex={-1} className="story-interview__title">Sinu poe lugu.</h1>
                <span className="story-interview__interviewer">Poeruumi AI-intervjueerija</span>
                <div className="story-interview__messages" role="log" aria-label="Intervjuu" aria-live="polite" aria-relevant="additions">
                  {interview.messages.map((message, index) => <div key={index} className={`story-interview__message story-interview__message--${message.role}`}><span className="story-interview__sr">{message.role === 'assistant' ? 'Intervjueerija: ' : 'Sina: '}</span>{message.content}</div>)}
                  {busy === 'answer' && <div className="story-interview__message story-interview__message--user">{answer}</div>}
                </div>
                {busy && <div className="story-interview__working" role="status"><Spinner /><span>{busy === 'generate' ? 'Kirjutan sinu lugu…' : busy === 'upload' ? 'Lisan fotot…' : 'Mõtlen kaasa…'}</span></div>}
                {error && <p className="story-interview__error" role="alert">{error}</p>}
                {interview.status === 'photo' && <div className="story-interview__photo">
                  {interview.imageUrl && <img src={interview.imageUrl} alt={interview.imageAlt} />}
                  <button className="story-interview__primary" disabled={Boolean(busy)} onClick={() => interview.imageUrl ? void run('generate', () => generate()) : photoInput.current?.click()}>
                    {interview.imageUrl ? 'Loo eelvaade' : <><Photo /> Lisa foto</>}
                  </button>
                  {interview.imageUrl && <button className="story-interview__secondary" disabled={Boolean(busy)} onClick={() => photoInput.current?.click()}>Vaheta fotot</button>}
                </div>}
                <div ref={end} className="story-interview__end" />
                {interview.status === 'interview' && <div className="story-interview__composer-wrap">
                  <form className="story-interview__composer" onSubmit={send}>
                    <textarea ref={input} aria-label="Sinu vastus" placeholder="Kirjuta siia…" rows={1} maxLength={4000} value={answer} readOnly={Boolean(busy)} onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { event.preventDefault(); if (!busy && answer.trim()) send(event) } }} />
                    <button type="submit" aria-label="Saada vastus" disabled={Boolean(busy) || !answer.trim()}><Arrow /></button>
                  </form>
                  {count >= 3 && <button className="story-interview__finish" disabled={Boolean(busy) || Boolean(answer.trim())} onClick={() => void run('finish', async () => { await mutate('finish') })}>Lõpeta vestlus</button>}
                </div>}
              </div>}
  </main>
}
