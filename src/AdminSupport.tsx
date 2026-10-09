import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { requireSupabase } from './lib/supabase'

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

const categoryLabel: Record<string, string> = {
  question: 'Üldine küsimus', setup: 'Poe seadistamine', payments: 'Maksed',
  orders: 'Tellimused', technical: 'Tehniline probleem', feedback: 'Ettepanek',
}

const formatTime = (value: string) => new Intl.DateTimeFormat('et-EE', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

export default function AdminSupport({ onCountsChanged }: { onCountsChanged?: () => void }) {
  const [conversations, setConversations] = useState<AdminSupportConversation[]>([])
  const [selected, setSelected] = useState<AdminSupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [filter, setFilter] = useState<Filter>('active')
  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
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
  const requestedConversationId = useRef(new URLSearchParams(window.location.search).get('conversation'))

  const loadConversations = async () => {
    const { data, error: queryError } = await requireSupabase().rpc('admin_support_conversations')
    if (queryError) {
      setError(queryError.code === '42883' ? 'Rakenda klienditoe andmebaasimigratsioon.' : 'Klienditoe vestlusi ei õnnestunud laadida.')
      setConversations([])
    } else {
      const next = ((data ?? []) as AdminSupportConversation[]).filter((item) => !deletedIds.current.has(item.id))
      setConversations(next)
      setSelected((current) => current ? next.find((item) => item.id === current.id) ?? null : null)
      setError('')
      const requested = next.find((item) => item.id === requestedConversationId.current)
      requestedConversationId.current = null
      if (requested) void openConversation(requested)
    }
    setIsLoading(false)
  }

  const loadMessages = async (conversation: AdminSupportConversation) => {
    const { data, error: queryError } = await requireSupabase().from('support_messages')
      .select('id,sender_kind,body,source,is_internal,attachment_path,attachment_name,delivery_status,created_at')
      .eq('conversation_id', conversation.id).order('created_at')
    if (selectedId.current !== conversation.id || deletedIds.current.has(conversation.id)) return
    if (queryError) setError('Vestluse sisu ei õnnestunud laadida.')
    else setMessages((data ?? []) as SupportMessage[])
  }

  const openConversation = async (conversation: AdminSupportConversation) => {
    selectedId.current = conversation.id
    setSelected(conversation); setError(''); setReply(''); setIsInternal(false)
    await Promise.all([
      loadMessages(conversation),
      requireSupabase().rpc('mark_support_conversation_read', { target_conversation_id: conversation.id }),
    ])
    await loadConversations()
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
  useEffect(() => {
    const messagesElement = messagesRef.current
    if (!messagesElement) return
    messagesElement.scrollTop = messagesElement.scrollHeight
  }, [messages.length, selected?.id])

  const filtered = useMemo(() => conversations.filter((item) => filter === 'active'
    ? item.status !== 'resolved'
    : item.status === filter), [conversations, filter])
  const unreadCount = conversations.filter((item) => item.is_unread).length
  const contactLabel = (conversation: AdminSupportConversation) =>
    conversation.store_name || conversation.contact_name || conversation.email

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', { body })
    if (invokeError || data?.error) throw new Error(data?.error || 'Toiming ebaõnnestus.')
    return data
  }

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || !reply.trim()) return
    setIsSending(true); setError('')
    try {
      await invoke({ action: 'admin_reply', conversation_id: selected.id, body: reply, is_internal: isInternal })
      setReply(''); setIsInternal(false)
      await Promise.all([loadMessages(selected), loadConversations()])
      onCountsChanged?.()
    } catch (sendError) { setError(sendError instanceof Error ? sendError.message : 'Vastust ei õnnestunud saata.') }
    finally { setIsSending(false) }
  }

  const setStatus = async (status: AdminSupportConversation['status']) => {
    if (!selected) return
    setIsSending(true); setError('')
    try {
      await invoke({ action: 'status', conversation_id: selected.id, status })
      await loadConversations(); onCountsChanged?.()
      setSelected((current) => current ? { ...current, status } : current)
    } catch (statusError) { setError(statusError instanceof Error ? statusError.message : 'Olekut ei õnnestunud muuta.') }
    finally { setIsSending(false) }
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
      deletedIds.current.add(id)
      selectedId.current = null
      setConversations((current) => current.filter((item) => item.id !== id))
      setSelected(null); setMessages([]); setReply(''); setIsInternal(false); setError('')
      setDeleteTarget(null)
      onCountsChanged?.()
      void loadConversations()
      window.requestAnimationFrame(() => filtersRef.current?.querySelector<HTMLButtonElement>('button.is-active')?.focus())
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : 'Vestlust ei õnnestunud kustutada.')
    } finally { setIsDeleting(false) }
  }

  return <section className="admin-support" id="klienditugi">
    <header><div><span>KLIENDITUGI</span><h2>Vestlused</h2><p>Poeruumi kasutajate küsimused ja aadressile info@poeruum.ee saabunud kirjad.</p></div><b>{unreadCount ? `${unreadCount} uut` : 'Kõik loetud'}</b></header>
    <div className="admin-support__filters" ref={filtersRef}>{([
      ['active', 'Aktiivsed'], ['open', 'Vajavad vastust'], ['waiting_user', 'Ootavad kasutajat'], ['resolved', 'Lahendatud'],
    ] as Array<[Filter, string]>).map(([value, label]) => <button className={filter === value ? 'is-active' : ''} type="button" onClick={() => setFilter(value)} key={value}>{label}<span>{value === 'active' ? conversations.filter((item) => item.status !== 'resolved').length : conversations.filter((item) => item.status === value).length}</span></button>)}</div>
    <div className="admin-support__workspace">
      <div className="admin-support__list">
        {isLoading ? <p className="admin-support__empty">Laadin vestlusi…</p> : error && !conversations.length ? <p className="admin-support__empty is-error">{error}</p> : filtered.length ? filtered.map((conversation) => <button className={`${selected?.id === conversation.id ? 'is-selected' : ''}${conversation.is_unread ? ' is-unread' : ''}`} type="button" onClick={() => void openConversation(conversation)} key={conversation.id}>
          <i>{contactLabel(conversation).charAt(0).toLocaleUpperCase('et')}</i><span><b>{contactLabel(conversation)}{conversation.origin === 'email' ? ' · E-kiri' : ''}</b><strong>{conversation.subject}</strong><small>{conversation.last_message_preview}</small></span><time>{formatTime(conversation.last_message_at)}</time>
        </button>) : <p className="admin-support__empty">Selles vaates pole vestlusi.</p>}
      </div>
      {selected ? <div className="admin-support__conversation">
        <header><div><small>{selected.origin === 'email' ? 'E-kiri aadressile info@poeruum.ee' : categoryLabel[selected.category] || 'Küsimus'}</small><h3>{selected.subject}</h3><p>{selected.origin === 'email' ? selected.contact_name || 'Väline saatja' : selected.store_name || 'Poodi pole loodud'} · <a href={`mailto:${selected.email}`}>{selected.email}</a>{selected.origin === 'app' && <> · {selected.pricing_plan === 'fixed' ? 'Kindel pakett' : 'Paindlik pakett'}</>}</p></div><div className="admin-support__actions"><select aria-label="Vestluse olek" value={selected.status} disabled={isSending} onChange={(event) => void setStatus(event.target.value as AdminSupportConversation['status'])}><option value="open">Vajab vastust</option><option value="waiting_user">Ootab kasutajat</option><option value="resolved">Lahendatud</option></select><button type="button" className="admin-support__delete" aria-label="Kustuta vestlus" title="Kustuta vestlus" disabled={isSending} onClick={(event) => { deleteTrigger.current = event.currentTarget; event.currentTarget.focus({ preventScroll: true }); setDeleteError(''); setDeleteTarget(selected) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button></div></header>
        <div className="admin-support__messages" ref={messagesRef}>{messages.map((message) => <article className={`is-${message.sender_kind}${message.is_internal ? ' is-internal' : ''}`} key={message.id}>
          <span>{message.is_internal ? 'Sisemine märkus' : message.sender_kind === 'admin' ? 'Poeruumi tugi' : contactLabel(selected)}<time>{formatTime(message.created_at)}</time></span><p>{message.body}</p>
          {message.attachment_path && <button type="button" onClick={() => void openAttachment(message)}>📎 {message.attachment_name || 'Ava manus'}</button>}
          {message.delivery_status && <small className={`is-${message.delivery_status}`}>{message.delivery_status === 'delivered' ? 'Kohale toimetatud' : message.delivery_status === 'sent' ? 'Saadetud' : message.delivery_status === 'failed' ? 'Saatmine ebaõnnestus' : message.delivery_status === 'bounced' ? 'Ei jõudnud kohale' : message.delivery_status}</small>}
        </article>)}</div>
        <form className={isInternal ? 'is-internal' : ''} onSubmit={sendReply}><textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={isInternal ? 'Lisa märkus, mida saatja ei näe…' : 'Kirjuta saatjale vastus…'} /><div><label><input type="checkbox" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} /> Sisemine märkus</label>{error && <p>{error}</p>}<button type="submit" disabled={isSending || !reply.trim()}>{isSending ? 'Saadan…' : isInternal ? 'Lisa märkus' : 'Saada vastus'} →</button></div></form>
      </div> : <div className="admin-support__placeholder"><span>✉</span><strong>Vali vestlus</strong><p>Siin näed kogu vestlust ning saatja või poe konteksti.</p></div>}
    </div>
    {deleteTarget && <dialog ref={deleteDialog} className="admin-support__delete-dialog" role="alertdialog" aria-labelledby={deleteTitleId} aria-describedby={deleteDescriptionId} onCancel={(event) => { event.preventDefault(); if (!isDeleting) setDeleteTarget(null) }}>
      <h2 id={deleteTitleId}>Kustuta vestlus?</h2>
      <p className="admin-support__delete-subject">{deleteTarget.subject}</p>
      <p id={deleteDescriptionId}>Vestlus, sõnumid ja manused kustutatakse jäädavalt.</p>
      {deleteError && <p className="admin-support__delete-error" role="alert">{deleteError}</p>}
      <div><button type="button" autoFocus disabled={isDeleting} onClick={() => setDeleteTarget(null)}>Loobu</button><button type="button" className="is-danger" disabled={isDeleting} onClick={() => void deleteConversation()}>{isDeleting ? 'Kustutan…' : 'Kustuta'}</button></div>
    </dialog>}
  </section>
}
