import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { BrandMark } from './Brand'
import { createRandomId } from './lib/randomId'
import { SupportContext } from './SupportContext'
import './supportCenter.css'

type SupportConversation = {
  id: string
  subject: string
  category: string
  status: 'open' | 'waiting_user' | 'resolved'
  last_message_at: string
  last_message_preview: string
  user_read_at: string | null
}

type SupportMessage = {
  id: string
  sender_kind: 'user' | 'admin' | 'system'
  body: string
  attachment_path: string | null
  attachment_name: string | null
  delivery_status: string | null
  created_at: string
}

const categories = [
  ['question', 'Üldine küsimus'],
  ['setup', 'Poe seadistamine'],
  ['payments', 'Maksed'],
  ['orders', 'Tellimused'],
  ['technical', 'Tehniline probleem'],
  ['feedback', 'Ettepanek'],
] as const

const formatTime = (value: string) => new Intl.DateTimeFormat('et-EE', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

const formatDate = (value: string) => new Intl.DateTimeFormat('et-EE', {
  day: 'numeric', month: 'short',
}).format(new Date(value))

type SupportIconName = 'chat' | 'arrow' | 'close' | 'back' | 'attachment' | 'check' | 'send'

function SupportIcon({ name }: { name: SupportIconName }) {
  const paths: Record<SupportIconName, React.ReactNode> = {
    chat: <><path d="M5 5.5h14v10H9l-4 3v-13Z"/><path d="M9 9h6M9 12h4"/></>,
    arrow: <path d="m9 6 6 6-6 6"/>,
    close: <path d="m7 7 10 10M17 7 7 17"/>,
    back: <><path d="m10 6-6 6 6 6"/><path d="M4 12h16"/></>,
    attachment: <path d="m8 12 6-6a3 3 0 0 1 4.2 4.2l-8 8a4.5 4.5 0 0 1-6.4-6.4l8-8M7 13l7-7"/>,
    check: <path d="m6 12 4 4 8-9"/>,
    send: <><path d="M12 19V5m-6 6 6-6 6 6"/></>,
  }
  return <svg className="support-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export default function SupportCenter({ children }: { children?: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const messageList = useRef<HTMLDivElement | null>(null)
  const messageRequest = useRef(0)
  const [view, setView] = useState<'list' | 'new' | 'thread'>('list')
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [selected, setSelected] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [category, setCategory] = useState('question')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [isLoadingConversations, setIsLoadingConversations] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    requireSupabase().auth.getUser().then(({ data }) => {
      if (active && data.user?.app_metadata?.role !== 'admin') setUser(data.user ?? null)
    })
    const { data } = requireSupabase().auth.onAuthStateChange((_event, session) => {
      setUser(session?.user.app_metadata?.role === 'admin' ? null : session?.user ?? null)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const openSupport = useCallback(() => {
    if (!isOpen) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setIsClosing(false)
    setIsOpen(true)
  }, [isOpen])

  const closeSupport = useCallback(() => {
    if (closeTimer.current) return
    setIsClosing(true)
    closeTimer.current = setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      closeTimer.current = null
      opener.current?.focus()
    }, 190)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeSupport()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen, closeSupport])

  useEffect(() => {
    if (isOpen) heading.current?.focus({ preventScroll: true })
  }, [isOpen, view])

  useEffect(() => {
    if (view === 'thread') messageList.current?.scrollTo({ top: messageList.current.scrollHeight })
  }, [isOpen, view, messages])

  const loadConversations = async () => {
    if (!user) return
    setIsLoadingConversations(true)
    const { data, error: queryError } = await requireSupabase().from('support_conversations')
      .select('id,subject,category,status,last_message_at,last_message_preview,user_read_at')
      .order('last_message_at', { ascending: false })
    setIsLoadingConversations(false)
    if (queryError) {
      if (queryError.code !== '42P01') setError('Vestlusi ei õnnestunud laadida.')
      return
    }
    setConversations((data ?? []) as SupportConversation[])
  }

  useEffect(() => { if (isOpen && user) void loadConversations() }, [isOpen, user?.id])

  useEffect(() => {
    if (!isOpen || !user) return
    const channel = requireSupabase().channel(`support-user-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => {
        void loadConversations()
        if (selected) void openConversation(selected)
      }).subscribe()
    return () => { void requireSupabase().removeChannel(channel) }
  }, [isOpen, user?.id, selected?.id])

  const openConversation = async (conversation: SupportConversation) => {
    const request = ++messageRequest.current
    const isDifferentConversation = selected?.id !== conversation.id
    setSelected(conversation)
    setView('thread')
    setError('')
    if (isDifferentConversation) { setMessages([]); setReply(''); setIsLoadingMessages(true) }
    const { data, error: queryError } = await requireSupabase().from('support_messages')
      .select('id,sender_kind,body,attachment_path,attachment_name,delivery_status,created_at')
      .eq('conversation_id', conversation.id).order('created_at')
    if (request !== messageRequest.current) return
    setIsLoadingMessages(false)
    if (queryError) setError('Vestlust ei õnnestunud avada.')
    else setMessages((data ?? []) as SupportMessage[])
    if (!queryError) {
      const { error: readError } = await requireSupabase().rpc('mark_support_conversation_read', { target_conversation_id: conversation.id })
      if (!readError) setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, user_read_at: new Date().toISOString() } : item))
    }
  }

  const uploadAttachment = async () => {
    if (!attachment || !user) return null
    const extension = attachment.name.includes('.') ? `.${attachment.name.split('.').pop()?.toLowerCase()}` : ''
    const path = `${user.id}/${createRandomId()}${extension}`
    const { error: uploadError } = await requireSupabase().storage.from('support-attachments').upload(path, attachment, {
      contentType: attachment.type,
      upsert: false,
    })
    if (uploadError) throw new Error('Ekraanipilti ei õnnestunud lisada.')
    return path
  }

  const createConversation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user || isBusy || body.trim().length < 2) return
    setIsBusy(true); setError('')
    try {
      const message = body.trim()
      const summary = message.replace(/\s+/g, ' ')
      const subject = summary.length > 80 ? `${summary.slice(0, 79).trimEnd()}…` : summary
      const attachmentPath = await uploadAttachment()
      const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', { body: {
        action: 'create', category, subject, body: message,
        attachment_path: attachmentPath,
        attachment_name: attachment?.name ?? null,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
      } })
      if (invokeError || data?.error) throw new Error(data?.error || 'Küsimust ei õnnestunud saata.')
      setBody(''); setAttachment(null)
      await loadConversations()
      const { data: created } = await requireSupabase().from('support_conversations')
        .select('id,subject,category,status,last_message_at,last_message_preview,user_read_at').eq('id', data.id).single()
      if (created) await openConversation(created as SupportConversation)
      else { setView('list'); setError('Sõnum on saadetud. Vestluse avamiseks laadi tugi uuesti.') }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Küsimust ei õnnestunud saata.')
    } finally { setIsBusy(false) }
  }

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || isBusy || !reply.trim()) return
    setIsBusy(true); setError('')
    const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', { body: {
      action: 'user_reply', conversation_id: selected.id, body: reply,
    } })
    if (invokeError || data?.error) setError(data?.error || 'Vastust ei õnnestunud saata.')
    else { setReply(''); await openConversation(selected) }
    setIsBusy(false)
  }

  const openAttachment = async (message: SupportMessage) => {
    if (!message.attachment_path) return
    const { data, error: signedError } = await requireSupabase().storage.from('support-attachments').createSignedUrl(message.attachment_path, 60)
    if (signedError) setError('Manust ei õnnestunud avada.')
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const startConversation = () => {
    messageRequest.current += 1
    setSelected(null)
    setView('new')
    setError('')
  }

  const showConversations = () => {
    messageRequest.current += 1
    setView('list')
    setSelected(null)
    setError('')
  }

  const selectAttachment = (file: File | null) => {
    if (file && file.size > 5 * 1024 * 1024) {
      setAttachment(null)
      setError('Fail on suurem kui 5 MB. Vali palun väiksem fail.')
      return
    }
    setAttachment(file)
    setError('')
  }

  const unread = conversations.filter((item) => item.user_read_at === null).length
  const support = useMemo(() => user ? { openSupport, unread } : null, [user, openSupport, unread])

  return <SupportContext.Provider value={support}>
    {children}
    {user && <>
      <button className="support-launcher" type="button" onClick={openSupport} aria-label="Ava Poeruumi klienditugi" aria-expanded={isOpen} aria-controls="support-panel">
        <SupportIcon name="chat" />
        <span>Abi</span>{unread > 0 && <b>{unread}</b>}
      </button>
      {isOpen && <div className={`support-modal${isClosing ? ' is-closing' : ''}`}>
        <section id="support-panel" className={`support-panel is-${view}`} role="dialog" aria-labelledby="support-heading">
          <header className="support-panel__header">
            <div>
              {view !== 'list'
                ? <button className="support-icon-button" type="button" disabled={isBusy} onClick={showConversations} aria-label="Tagasi vestluste juurde"><SupportIcon name="back" /></button>
                : <BrandMark className="support-panel__logo" />}
              <h2 id="support-heading" ref={heading} tabIndex={-1}>{view === 'new' ? 'Uus vestlus' : 'Poeruumi tugi'}</h2>
            </div>
            <button className="support-icon-button" type="button" onClick={closeSupport} aria-label="Sulge tugi"><SupportIcon name="close" /></button>
          </header>
          {error && <p className="support-error" role="alert">{error}</p>}

          {view === 'list' && <div className="support-panel__content">
            <button className="support-new-conversation" type="button" onClick={startConversation}>
              <span className="support-new-conversation__icon"><SupportIcon name="chat" /></span>
              <span>Kirjuta meile</span>
              <span className="support-new-conversation__arrow"><SupportIcon name="arrow" /></span>
            </button>
            {(conversations.length > 0 || isLoadingConversations) && <section className="support-history" aria-labelledby="support-history-heading" aria-busy={isLoadingConversations}>
              <h3 id="support-history-heading">Vestlused</h3>
              {conversations.map((conversation) => <button className={conversation.user_read_at === null ? 'is-unread' : ''} type="button" onClick={() => void openConversation(conversation)} key={conversation.id}>
                <span className={`support-history__icon${conversation.status === 'resolved' ? ' is-resolved' : ''}`}>
                  <SupportIcon name={conversation.status === 'resolved' ? 'check' : 'chat'} />
                  {conversation.user_read_at === null && <i aria-label="Lugemata" />}
                </span>
                <span className="support-history__text"><strong>{conversation.subject}</strong><span>{conversation.last_message_preview}</span></span>
                <span className="support-history__meta"><time dateTime={conversation.last_message_at} title={formatTime(conversation.last_message_at)}>{formatDate(conversation.last_message_at)}</time><SupportIcon name="arrow" /></span>
              </button>)}
              {isLoadingConversations && conversations.length === 0 && <div className="support-loading" role="status" aria-label="Laadin vestlusi"><span /><span /></div>}
            </section>}
          </div>}

          {view === 'new' && <form className="support-form" onSubmit={createConversation}>
            <label className="support-form__category"><span id="support-category-label">Teema</span><select aria-labelledby="support-category-label" value={category} disabled={isBusy} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <div className="support-compose">
              <textarea aria-label="Sõnum" value={body} disabled={isBusy} onChange={(event) => setBody(event.target.value)} minLength={2} maxLength={10000} rows={7} placeholder="Kirjuta oma küsimus…" required />
              {attachment && <div className="support-attachment">
                <SupportIcon name="attachment" /><span title={attachment.name}>{attachment.name}</span>
                <button className="support-icon-button" type="button" disabled={isBusy} onClick={() => setAttachment(null)} aria-label="Eemalda manus"><SupportIcon name="close" /></button>
              </div>}
              <div className="support-compose__actions">
                <div className="support-upload">
                  <input id="support-attachment" type="file" disabled={isBusy} accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={(event) => { selectAttachment(event.target.files?.[0] ?? null); event.target.value = '' }} />
                  <label htmlFor="support-attachment" title="Ekraanipilt või PDF · kuni 5 MB"><SupportIcon name="attachment" /><span>{attachment ? 'Vaheta faili' : 'Lisa fail'}</span></label>
                </div>
                <button className="support-send" type="submit" disabled={isBusy || body.trim().length < 2}>{isBusy ? 'Saadan…' : 'Saada'}<SupportIcon name="send" /></button>
              </div>
            </div>
          </form>}

          {view === 'thread' && selected && <div className="support-thread">
            <div className="support-thread__title">
              <h3>{selected.subject}</h3>
              <span className={`support-status is-${selected.status}`}>
                {selected.status === 'resolved' ? <SupportIcon name="check" /> : <i />}
                {selected.status === 'resolved' ? 'Lahendatud' : selected.status === 'waiting_user' ? 'Sinu kord' : 'Ootab vastust'}
              </span>
            </div>
            <div className="support-thread__messages" ref={messageList} role="log" aria-label="Vestluse sõnumid" aria-busy={isLoadingMessages}>
              {isLoadingMessages && <div className="support-loading" role="status" aria-label="Laadin sõnumeid"><span /><span /></div>}
              {messages.map((message) => <article className={`is-${message.sender_kind}`} key={message.id} aria-label={message.sender_kind === 'user' ? 'Sina' : 'Poeruumi tugi'}>
                <p>{message.body}</p>
                {message.attachment_path && <button className="support-message-attachment" type="button" onClick={() => void openAttachment(message)}><SupportIcon name="attachment" />{message.attachment_name || 'Ava manus'}</button>}
                <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
              </article>)}
            </div>
            {selected.status !== 'resolved'
              ? <form className="support-reply" onSubmit={sendReply}>
                <textarea aria-label="Vastus" value={reply} disabled={isBusy} onChange={(event) => setReply(event.target.value)} rows={2} maxLength={10000} placeholder="Kirjuta vastus…" required />
                <button className="support-send support-send--icon" type="submit" disabled={isBusy || isLoadingMessages || !reply.trim()} aria-label={isBusy ? 'Saadan vastust' : 'Saada vastus'} title="Saada vastus"><SupportIcon name="send" /></button>
              </form>
              : <div className="support-resolved"><button type="button" onClick={startConversation}>Uus vestlus <SupportIcon name="arrow" /></button></div>}
          </div>}
        </section>
      </div>}
    </>}
  </SupportContext.Provider>
}
