import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { requireSupabase } from './lib/supabase'
import { date, supportUrl } from './lib/adminUserDisplay'
import type { AdminUserRow } from './lib/adminUserOverview'
import Icon from './AdminUserIcon'
import './adminUserMessage.css'

type Conversation = { id: string; subject: string; status: 'open' | 'waiting_user' | 'resolved'; last_message_at: string }
const statusLabel = { open: 'Ootab sinu vastust', waiting_user: 'Ootab kasutaja vastust', resolved: 'Lahendatud' }

export default function AdminUserMessage({ row, onSent }: { row: AdminUserRow; onSent: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const [sentId, setSentId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyRevision, setHistoryRevision] = useState(0)
  const requestId = useRef<string | null>(null)
  const sending = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const subjectId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current!
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    dialog.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    setHistoryState('loading')
    void Promise.resolve(requireSupabase().from('support_conversations')
      .select('id,subject,status,last_message_at').eq('user_id', row.user_id)
      .order('last_message_at', { ascending: false }).limit(10).abortSignal(controller.signal))
      .then(({ data, error: queryError }) => {
        if (controller.signal.aborted) return
        if (queryError) { setHistoryState('error'); return }
        setConversations((data ?? []) as Conversation[])
        setHistoryState('ready')
      }).catch(() => { if (!controller.signal.aborted) setHistoryState('error') })
    return () => controller.abort()
  }, [isOpen, row.user_id, historyRevision])

  const open = () => {
    if (sentId) {
      setSubject(''); setBody(''); setSentId(null); setSavedId(null); setError(''); setAttempted(false)
      requestId.current = null
    }
    setIsOpen(true)
  }
  const close = () => { if (!sending.current) setIsOpen(false) }
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current || sentId || subject.trim().length < 2 || body.trim().length < 2) return
    sending.current = true
    setIsSending(true); setError(''); setAttempted(true)
    try {
      requestId.current ??= crypto.randomUUID()
      const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', {
        body: { action: 'admin_create', request_id: requestId.current, user_id: row.user_id, subject: subject.trim(), body: body.trim() },
      })
      if (invokeError || data?.error) {
        const failure = invokeError?.context instanceof Response
          ? await invokeError.context.json().catch(() => null) : data
        if (failure?.conversation_id) setSavedId(failure.conversation_id)
        // Validation/auth errors precede saving; the draft can still be edited.
        if (!attempted && invokeError?.context instanceof Response && [400, 401, 403, 404, 429].includes(invokeError.context.status)) setAttempted(false)
        throw new Error(failure?.error || 'Kirja saatmist ei õnnestunud kinnitada. Proovi uuesti.')
      }
      if (!data?.conversation_id) throw new Error('Kirja saatmist ei õnnestunud kinnitada. Proovi uuesti.')
      setSentId(data.conversation_id)
      onSent()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kirja saatmine ebaõnnestus. Proovi uuesti.')
    } finally { sending.current = false; setIsSending(false) }
  }

  return <>
    <div className="user-insights__contact">
      <span>{sentId ? <><Icon name="check" />Kiri saadetud</> : <><Icon name="message" />Klienditugi</>}</span>
      <div>{(row.awaiting_admin_count ?? 0) > 0 && <a href={supportUrl(row)}>Vasta kasutajale<Icon name="arrow" /></a>}
        <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={open}><Icon name="mail" />Kirjuta kasutajale</button>
      </div>
    </div>
    {isOpen && createPortal(<dialog ref={dialogRef} className="admin-user-message" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close() }}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), summary')].filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <header><div><span>POERUUMI KLIENDITUGI</span><h2 id={titleId}>Kirjuta kasutajale</h2></div><button type="button" className="admin-user-message__close" disabled={isSending} aria-label="Sulge kirjutamispaneel" onClick={close}><Icon name="close" /></button></header>
      <div className="admin-user-message__recipient"><span>Saaja</span><strong>{row.store_name || row.email.split('@')[0]}</strong><span>{row.email}</span></div>
      <p id={descriptionId} className="admin-user-message__description">Sõnum saadetakse e-postile ja salvestatakse klienditoe vestlusse. Kasutaja saab vastata kirjale või Poeruumis.</p>
      {sentId ? <div className="admin-user-message__success" role="status"><Icon name="check" /><h3>Kiri saadetud</h3><p>Vestlus ootab kasutaja vastust. Kirja kohaletoimetamise seisu näed klienditoes.</p><a href={`/admin/support?conversation=${encodeURIComponent(sentId)}`}>Ava vestlus<Icon name="arrow" /></a><button type="button" onClick={close}>Valmis</button></div>
        : <>
          <details className="admin-user-message__history"><summary>Varasemad vestlused{historyState === 'ready' ? ` (${conversations.length}${conversations.length === 10 ? '+' : ''})` : ''}</summary>
            {historyState === 'loading' ? <p role="status">Laadin vestlusi…</p> : historyState === 'error' ? <p role="status">Vestlusi ei õnnestunud laadida. <button type="button" onClick={() => setHistoryRevision((value) => value + 1)}>Proovi uuesti</button></p>
              : conversations.length ? <ul>{conversations.map((conversation) => <li key={conversation.id}><a href={`/admin/support?conversation=${encodeURIComponent(conversation.id)}`}><strong>{conversation.subject}</strong><span>{statusLabel[conversation.status]} · {date(conversation.last_message_at)}</span></a></li>)}</ul> : <p>Selle kasutajaga pole veel vestlusi.</p>}
          </details>
          <form onSubmit={send} aria-busy={isSending}>
            <div className="admin-user-message__field"><label htmlFor={subjectId}>Teema</label><input id={subjectId} required minLength={2} maxLength={160} value={subject} readOnly={attempted} disabled={isSending} onChange={(event) => setSubject(event.target.value)} placeholder="Millest soovid kirjutada?" /></div>
            <div className="admin-user-message__field admin-user-message__body"><label htmlFor={bodyId}>Sõnum</label><textarea id={bodyId} required minLength={2} maxLength={10000} rows={9} value={body} readOnly={attempted} disabled={isSending} onChange={(event) => setBody(event.target.value)} placeholder="Tere!" /></div>
            {error && <div className="admin-user-message__error" role="alert"><p>{error}</p>{savedId && <a href={`/admin/support?conversation=${encodeURIComponent(savedId)}`}>Ava salvestatud vestlus</a>}</div>}
            <footer><span>Vastused leiad klienditoest.</span><button type="submit" disabled={isSending || subject.trim().length < 2 || body.trim().length < 2}><Icon name="mail" />{isSending ? 'Saadan…' : attempted ? 'Proovi saatmist uuesti' : 'Saada kiri'}</button></footer>
          </form>
        </>}
    </dialog>, document.body)}
  </>
}
