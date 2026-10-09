import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import './adminSupport.css'

export type AdminSupportConversation = {
  id: string
  user_id: string | null
  email: string
  contact_name: string | null
  origin: 'app' | 'email'
  store_id: string | null
  store_name: string | null
  pricing_plan: string | null
  subject: string
  category: string
  status: 'open' | 'waiting_user' | 'resolved'
  last_message_at: string
  last_message_preview: string
  is_unread: boolean
  created_at: string
}

type SupportMessage = {
  id: string
  sender_kind: 'user' | 'admin' | 'system'
  body: string
  source: 'app' | 'email'
  is_internal: boolean
  attachment_path: string | null
  attachment_name: string | null
  delivery_status: string | null
  created_at: string
}
type Filter = 'active' | 'open' | 'waiting_user' | 'resolved'
type Draft = { reply: string; note: string; internal: boolean }
const filters: Array<[Filter, string]> = [['active', 'Aktiivsed'], ['open', 'Vajavad vastust'], ['waiting_user', 'Ootavad kasutajat'], ['resolved', 'Lahendatud']]
const categoryLabel: Record<string, string> = { question: 'Üldine küsimus', setup: 'Poe seadistamine', payments: 'Maksed', orders: 'Tellimused', technical: 'Tehniline probleem', feedback: 'Ettepanek' }
const statusLabel = { open: 'Vajab vastust', waiting_user: 'Ootab kasutajat', resolved: 'Lahendatud' }
const contactLabel = (conversation: AdminSupportConversation) => conversation.store_name || conversation.contact_name || conversation.email
const formatTime = (value: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const dayLabel = (value: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
const shortTime = (value: string) => new Intl.DateTimeFormat('et-EE', new Date(value).toDateString() === new Date().toDateString() ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(new Date(value))
const emptyDraft = (): Draft => ({ reply: '', note: '', internal: false })
const iconPaths = {
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2',
  back: 'm14 6-6 6 6 6',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  collapse: 'M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7',
  send: 'm21 3-7 18-4-7-7-4 18-7ZM10 14l6-6',
  message: 'M4 4h16v12H9l-5 4V4ZM8 8h8M8 12h5',
  note: 'M14 3H5v18h14V8l-5-5ZM14 3v5h5M9 12h6M9 16h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  down: 'M12 4v16m-6-6 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  attachment: 'm8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',
}
function Icon({ name }: { name: keyof typeof iconPaths }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[name]} /></svg> }

export default function AdminSupport({ onCountsChanged }: { onCountsChanged?: () => void }) {
  const [conversations, setConversations] = useState<AdminSupportConversation[]>([])
  const [selected, setSelected] = useState<AdminSupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AdminSupportConversation | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const deleteTitleId = useId()
  const deleteDescriptionId = useId()
  const selectedId = useRef<string | null>(null)
  const deletedIds = useRef(new Set<string>())
  const filtersRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const drafts = useRef(new Map<string, Draft>())
  const sending = useRef(false)
  const stickToBottom = useRef(true)
  const listRequest = useRef(0)
  const messageRequest = useRef(0)
  const requestedConversationId = useRef(new URLSearchParams(window.location.search).get('conversation'))
  const initialSelection = useRef(true)

  const loadConversations = async () => {
    const request = ++listRequest.current
    const { data, error: queryError } = await requireSupabase().rpc('admin_support_conversations')
    if (request !== listRequest.current) return
    if (queryError) setListError('Vestlusi ei õnnestunud laadida. Proovi uuesti.')
    else {
      const next = ((data ?? []) as AdminSupportConversation[]).filter((item) => !deletedIds.current.has(item.id))
      setConversations(next)
      setSelected((current) => current ? next.find((item) => item.id === current.id) ?? null : null)
      setListError('')
      const requested = next.find((item) => item.id === requestedConversationId.current)
      requestedConversationId.current = null
      if (initialSelection.current) {
        initialSelection.current = false
        const first = requested ?? (window.matchMedia('(min-width: 901px)').matches ? next.find((item) => item.status !== 'resolved') : null)
        if (first) {
          if (first.status === 'resolved') setFilter('resolved')
          void openConversation(first)
        }
      }
    }
    setIsLoading(false)
  }

  const loadMessages = async (conversation: AdminSupportConversation) => {
    const request = ++messageRequest.current
    const { data, error: queryError } = await requireSupabase().from('support_messages')
      .select('id,sender_kind,body,source,is_internal,attachment_path,attachment_name,delivery_status,created_at')
      .eq('conversation_id', conversation.id).order('created_at')
    if (request !== messageRequest.current || selectedId.current !== conversation.id || deletedIds.current.has(conversation.id)) return
    setIsLoadingMessages(false)
    if (queryError) setMessageError('Vestluse sisu ei õnnestunud laadida.')
    else { setMessages((data ?? []) as SupportMessage[]); setMessageError('') }
  }

  const openConversation = async (conversation: AdminSupportConversation) => {
    if (selectedId.current === conversation.id) return
    selectedId.current = conversation.id
    const draft = drafts.current.get(conversation.id) ?? emptyDraft()
    setSelected(conversation); setError(''); setMessageError(''); setMessages([]); setIsLoadingMessages(true)
    setReply(draft.internal ? draft.note : draft.reply); setIsInternal(draft.internal); setIsExpanded(false)
    stickToBottom.current = true; setIsAtBottom(true)
    const [, read] = await Promise.all([
      loadMessages(conversation),
      requireSupabase().rpc('mark_support_conversation_read', { target_conversation_id: conversation.id }),
    ])
    if (!read.error) {
      setConversations((items) => items.map((item) => item.id === conversation.id ? { ...item, is_unread: false } : item))
      onCountsChanged?.()
    }
  }

  const closeConversation = () => {
    selectedId.current = null; setSelected(null); setMessages([]); setError(''); setIsExpanded(false)
    window.requestAnimationFrame(() => filtersRef.current?.querySelector<HTMLButtonElement>('button.is-active')?.focus())
  }

  const updateReply = (value: string) => {
    if (!selected) return
    const draft = drafts.current.get(selected.id) ?? emptyDraft()
    drafts.current.set(selected.id, { ...draft, [isInternal ? 'note' : 'reply']: value, internal: isInternal })
    setReply(value)
  }
  const changeMode = (internal: boolean) => {
    if (!selected) return
    const draft = drafts.current.get(selected.id) ?? emptyDraft()
    drafts.current.set(selected.id, { ...draft, internal })
    setIsInternal(internal); setReply(internal ? draft.note : draft.reply)
    textareaRef.current?.focus()
  }

  useEffect(() => { void loadConversations() }, [])
  useEffect(() => {
    if (!deleteTarget) return
    const element = deleteDialog.current!
    const trigger = deleteTrigger.current
    element.showModal()
    return () => {
      element.close()
      window.requestAnimationFrame(() => {
        if (!element.open && !deleteDialog.current?.open && trigger?.isConnected) trigger.focus({ preventScroll: true })
      })
    }
  }, [deleteTarget])
  useEffect(() => {
    const channel = requireSupabase().channel('admin-support-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, () => {
        void loadConversations()
        if (selected) void loadMessages(selected)
      }).subscribe()
    return () => { void requireSupabase().removeChannel(channel) }
  }, [selected?.id])
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element || isExpanded) return
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px` }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [reply, selected?.id, isExpanded])
  useLayoutEffect(() => {
    const element = messagesRef.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [messages, selected?.id, reply, isExpanded])

  const filtered = useMemo(() => conversations.filter((item) => (filter === 'active' ? item.status !== 'resolved' : item.status === filter)
    && (!search.trim() || [contactLabel(item), item.email, item.subject, item.last_message_preview].some((value) => value?.toLocaleLowerCase('et').includes(search.trim().toLocaleLowerCase('et'))))), [conversations, filter, search])
  const unreadCount = conversations.filter((item) => item.is_unread).length
  const invoke = async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', { body })
    if (invokeError || data?.error) throw new Error(data?.error || 'Toiming ebaõnnestus. Proovi uuesti.')
    return data
  }
  const refresh = async () => {
    setIsRefreshing(true)
    try { await Promise.all([loadConversations(), selected ? loadMessages(selected) : Promise.resolve()]) }
    finally { setIsRefreshing(false) }
  }
  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || !reply.trim() || sending.current) return
    const target = selected, mode = isInternal ? 'note' : 'reply'
    let sent = false
    sending.current = true; setIsSending(true); setError('')
    try {
      await invoke({ action: 'admin_reply', conversation_id: target.id, body: reply, is_internal: isInternal })
      const draft = drafts.current.get(target.id) ?? emptyDraft()
      drafts.current.set(target.id, { ...draft, [mode]: '' })
      sent = true
      if (selectedId.current === target.id) {
        setReply(''); setIsExpanded(false); stickToBottom.current = true; setIsAtBottom(true)
        await loadMessages(target)
      }
      await loadConversations(); onCountsChanged?.()
    } catch (sendError) {
      if (selectedId.current === target.id) setError(sendError instanceof Error ? sendError.message : 'Vastust ei õnnestunud saata.')
    } finally {
      sending.current = false; setIsSending(false)
      if (sent) window.requestAnimationFrame(() => { if (selectedId.current === target.id) textareaRef.current?.focus() })
    }
  }
  const setStatus = async (status: AdminSupportConversation['status']) => {
    if (!selected || sending.current) return
    const id = selected.id
    sending.current = true; setIsSending(true); setError('')
    try {
      await invoke({ action: 'status', conversation_id: id, status })
      await loadConversations(); onCountsChanged?.()
    } catch (statusError) {
      if (selectedId.current === id) setError(statusError instanceof Error ? statusError.message : 'Olekut ei õnnestunud muuta.')
    } finally { sending.current = false; setIsSending(false) }
  }
  const openAttachment = async (message: SupportMessage) => {
    if (!message.attachment_path) return
    const { data, error: signedError } = await requireSupabase().storage.from('support-attachments').createSignedUrl(message.attachment_path, 120)
    if (signedError) setError('Manust ei õnnestunud avada.')
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const deleteConversation = async () => {
    if (!deleteTarget || isDeleting) return
    const id = deleteTarget.id
    setIsDeleting(true); setDeleteError('')
    try {
      await invoke({ action: 'delete', conversation_id: id })
      deletedIds.current.add(id); drafts.current.delete(id)
      setConversations((current) => current.filter((item) => item.id !== id))
      closeConversation(); setReply(''); setIsInternal(false); setDeleteTarget(null)
      onCountsChanged?.(); void loadConversations()
    } catch (deleteFailure) { setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : 'Vestlust ei õnnestunud kustutada.') }
    finally { setIsDeleting(false) }
  }

  return <section className={`admin-support${selected ? ' has-conversation' : ''}`} id="klienditugi" aria-label="Klienditugi">
    <header className="admin-support__toolbar">
      <div className="admin-support__title"><h1>Klienditugi</h1>{unreadCount > 0 && <span aria-label={`${unreadCount} lugemata vestlust`}>{unreadCount} uut</span>}</div>
      <div className="admin-support__filters" ref={filtersRef} aria-label="Vestluste filtrid">{filters.map(([value, label]) => <button className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} type="button" onClick={() => setFilter(value)} key={value}>{label}<span>{value === 'active' ? conversations.filter((item) => item.status !== 'resolved').length : conversations.filter((item) => item.status === value).length}</span></button>)}</div>
      <button type="button" className={`admin-support__icon-button${isRefreshing ? ' is-refreshing' : ''}`} aria-label="Uuenda vestlusi" title="Uuenda vestlusi" disabled={isRefreshing} onClick={() => void refresh()}><Icon name="refresh" /></button>
    </header>
    <div className="admin-support__workspace">
      <aside className="admin-support__inbox" aria-label="Vestlused">
        <div className="admin-support__search"><Icon name="search" /><input type="search" aria-label="Otsi vestlusi" placeholder="Otsi nime, e-posti või teemat…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {listError && <div className="admin-support__load-error" role="alert">{listError}<button type="button" onClick={() => void refresh()}>Proovi uuesti</button></div>}
        <div className="admin-support__list">
          {isLoading ? <p className="admin-support__empty" role="status">Laadin vestlusi…</p> : filtered.length ? filtered.map((conversation) => <button className={`${selected?.id === conversation.id ? 'is-selected' : ''}${conversation.is_unread ? ' is-unread' : ''}`} aria-current={selected?.id === conversation.id ? 'true' : undefined} type="button" onClick={() => void openConversation(conversation)} key={conversation.id}>
            <i className="admin-support__avatar" aria-hidden="true">{contactLabel(conversation).charAt(0).toLocaleUpperCase('et')}</i>
            <span className="admin-support__list-copy"><span className="admin-support__list-meta"><b>{contactLabel(conversation)}</b><time dateTime={conversation.last_message_at} title={formatTime(conversation.last_message_at)}>{shortTime(conversation.last_message_at)}</time></span><strong>{conversation.subject}</strong><small>{drafts.current.get(conversation.id)?.reply || drafts.current.get(conversation.id)?.note ? <em>Mustand · </em> : null}{conversation.last_message_preview}</small><span className={`admin-support__status is-${conversation.status}`}><i />{statusLabel[conversation.status]}{conversation.origin === 'email' && <span> · E-kiri</span>}</span></span>
          </button>) : !listError && <div className="admin-support__empty"><Icon name={filter === 'open' ? 'check' : 'message'} /><strong>{search ? 'Vestlust ei leitud' : filter === 'open' ? 'Kõik vastused on saadetud' : 'Siin pole veel vestlusi'}</strong><p>{search ? 'Proovi teist nime või otsisõna.' : filter === 'open' ? 'Uued küsimused ilmuvad siia.' : 'Vali mõni teine vaade.'}</p></div>}
        </div>
      </aside>
      {selected ? <div className={`admin-support__conversation${isExpanded ? ' is-writing' : ''}`}>
        <header className="admin-support__contact">
          <button type="button" className="admin-support__icon-button admin-support__back" aria-label="Tagasi vestluste juurde" onClick={closeConversation}><Icon name="back" /></button>
          <i className="admin-support__avatar" aria-hidden="true">{contactLabel(selected).charAt(0).toLocaleUpperCase('et')}</i>
          <div className="admin-support__contact-copy"><div><h2>{contactLabel(selected)}</h2><span className="admin-support__plan">{selected.origin === 'email' ? 'E-kiri' : selected.pricing_plan === 'fixed' ? 'Kindel pakett' : 'Paindlik pakett'}</span></div><a href={`mailto:${selected.email}`}>{selected.email}</a></div>
          <div className="admin-support__actions"><select aria-label="Vestluse olek" value={selected.status} disabled={isSending} onChange={(event) => void setStatus(event.target.value as AdminSupportConversation['status'])}><option value="open">Vajab vastust</option><option value="waiting_user">Ootab kasutajat</option><option value="resolved">Lahendatud</option></select><button type="button" className="admin-support__icon-button admin-support__delete" aria-label="Kustuta vestlus" title="Kustuta vestlus" disabled={isSending} onClick={(event) => { deleteTrigger.current = event.currentTarget; event.currentTarget.focus({ preventScroll: true }); setDeleteError(''); setDeleteTarget(selected) }}><Icon name="trash" /></button></div>
        </header>
        <div className="admin-support__subject"><h3 title={selected.subject}>{selected.subject}</h3><span>{categoryLabel[selected.category] || 'Küsimus'}</span></div>
        <div className="admin-support__history">
          <div className="admin-support__messages" role="log" aria-label="Vestluse sõnumid" aria-busy={isLoadingMessages} ref={messagesRef} onScroll={(event) => { const el = event.currentTarget; const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 70; stickToBottom.current = bottom; setIsAtBottom(bottom) }}>
            {isLoadingMessages ? <p className="admin-support__empty" role="status">Laadin sõnumeid…</p> : messageError ? <div className="admin-support__load-error" role="alert">{messageError}<button type="button" onClick={() => void loadMessages(selected)}>Proovi uuesti</button></div> : messages.map((message, index) => <div className="admin-support__message-group" key={message.id}>
              {(index === 0 || dayLabel(message.created_at) !== dayLabel(messages[index - 1].created_at)) && <div className="admin-support__day"><span>{dayLabel(message.created_at)}</span></div>}
              <article className={`is-${message.sender_kind}${message.is_internal ? ' is-internal' : ''}`}>
                <span>{message.is_internal ? <><Icon name="note" />Sisemine märkus</> : message.sender_kind === 'admin' ? 'Poeruumi tugi' : message.sender_kind === 'system' ? 'Süsteem' : contactLabel(selected)}<time dateTime={message.created_at} title={formatTime(message.created_at)}>{new Intl.DateTimeFormat('et-EE', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at))}</time></span>
                <p>{message.body}</p>
                {message.attachment_path && <button type="button" className="admin-support__attachment" onClick={() => void openAttachment(message)}><Icon name="attachment" />{message.attachment_name || 'Ava manus'}</button>}
                {message.delivery_status && <small className={`is-${message.delivery_status}`}>{['delivered', 'sent'].includes(message.delivery_status) && <Icon name="check" />}{message.delivery_status === 'delivered' ? 'Kohale toimetatud' : message.delivery_status === 'sent' ? 'Saadetud' : message.delivery_status === 'failed' ? 'Saatmine ebaõnnestus' : message.delivery_status === 'bounced' ? 'Ei jõudnud kohale' : message.delivery_status}</small>}
              </article>
            </div>)}
          </div>
          {!isAtBottom && <button className="admin-support__latest" type="button" onClick={() => { const el = messagesRef.current; if (el) el.scrollTop = el.scrollHeight; stickToBottom.current = true; setIsAtBottom(true) }}><Icon name="down" />Viimased sõnumid</button>}
        </div>
        <form className={`admin-support__composer${isInternal ? ' is-internal' : ''}`} onSubmit={sendReply}>
          <div className="admin-support__composer-top"><div className="admin-support__modes" role="group" aria-label="Sõnumi tüüp"><button type="button" aria-pressed={!isInternal} disabled={isSending} onClick={() => changeMode(false)}><Icon name="message" />Vastus</button><button type="button" aria-pressed={isInternal} disabled={isSending} onClick={() => changeMode(true)}><Icon name="note" />Sisemine märkus</button></div><button type="button" className="admin-support__icon-button" aria-label={isExpanded ? 'Vähenda kirjutamisala' : 'Laienda kirjutamisala'} title={isExpanded ? 'Vähenda kirjutamisala' : 'Laienda kirjutamisala'} aria-expanded={isExpanded} onClick={() => { setIsExpanded((value) => !value); textareaRef.current?.focus() }}><Icon name={isExpanded ? 'collapse' : 'expand'} /></button></div>
          <textarea ref={textareaRef} aria-label={isInternal ? 'Sisemine märkus' : 'Vastus'} rows={5} maxLength={10000} disabled={isSending} value={reply} onChange={(event) => updateReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } if (event.key === 'Escape' && isExpanded) setIsExpanded(false) }} placeholder={isInternal ? 'Lisa märkus, mida saatja ei näe…' : 'Kirjuta saatjale vastus…'} />
          {error && <p className="admin-support__send-error" role="alert">{error}</p>}
          <footer><span className="admin-support__composer-hint">{isInternal ? 'Nähtav ainult administraatoritele' : <><span className="admin-support__shortcut">Ctrl / ⌘ + Enter saadab</span>{reply && <span className="admin-support__draft-label">Mustand</span>}</>}</span><button className="admin-support__send" type="submit" disabled={isSending || !reply.trim()}>{isSending ? 'Saadan…' : isInternal ? 'Lisa märkus' : 'Saada vastus'}<Icon name={isInternal ? 'note' : 'send'} /></button></footer>
        </form>
      </div> : <div className="admin-support__placeholder"><span><Icon name="message" /></span><strong>Hea kliendisuhe algab vastusest</strong><p>Vali vasakult vestlus ja jätka sealt, kus pooleli jäi.</p></div>}
    </div>
    {deleteTarget && <dialog ref={deleteDialog} className="admin-support__delete-dialog" role="alertdialog" aria-labelledby={deleteTitleId} aria-describedby={deleteDescriptionId} onCancel={(event) => { event.preventDefault(); if (!isDeleting) setDeleteTarget(null) }}>
      <h2 id={deleteTitleId}>Kustuta vestlus?</h2><p className="admin-support__delete-subject">{deleteTarget.subject}</p><p id={deleteDescriptionId}>Vestlus, sõnumid ja manused kustutatakse jäädavalt.</p>
      {deleteError && <p className="admin-support__delete-error" role="alert">{deleteError}</p>}
      <div><button type="button" autoFocus disabled={isDeleting} onClick={() => setDeleteTarget(null)}>Loobu</button><button type="button" className="is-danger" disabled={isDeleting} onClick={() => void deleteConversation()}>{isDeleting ? 'Kustutan…' : 'Kustuta'}</button></div>
    </dialog>}
  </section>
}
