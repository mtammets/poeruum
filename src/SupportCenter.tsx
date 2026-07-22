import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { BrandMark } from './DemoApp'

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

type SupportIconName = 'chat' | 'arrow' | 'close' | 'back' | 'clock' | 'upload' | 'check' | 'payments' | 'setup' | 'technical'

function SupportIcon({ name }: { name: SupportIconName }) {
  const paths: Record<SupportIconName, React.ReactNode> = {
    chat: <><path d="M5 5.5h14v10H9l-4 3v-13Z"/><path d="M9 9h6M9 12h4"/></>,
    arrow: <path d="m9 6 6 6-6 6"/>,
    close: <path d="m7 7 10 10M17 7 7 17"/>,
    back: <><path d="m10 6-6 6 6 6"/><path d="M4 12h16"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
    upload: <><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 14v5h14v-5"/></>,
    check: <path d="m6 12 4 4 8-9"/>,
    payments: <><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 10h16M8 14h3"/></>,
    setup: <><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></>,
    technical: <><path d="M8 5 4 9l4 4M16 5l4 4-4 4M14 3l-4 14"/></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export default function SupportCenter() {
  const [user, setUser] = useState<User | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [view, setView] = useState<'list' | 'new' | 'thread'>('list')
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [selected, setSelected] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [category, setCategory] = useState('question')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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

  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSupport()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen])

  const openSupport = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setIsClosing(false)
    setIsOpen(true)
  }

  const closeSupport = () => {
    if (isClosing) return
    setIsClosing(true)
    closeTimer.current = setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      closeTimer.current = null
    }, 190)
  }

  const loadConversations = async () => {
    if (!user) return
    const { data, error: queryError } = await requireSupabase().from('support_conversations')
      .select('id,subject,category,status,last_message_at,last_message_preview,user_read_at')
      .order('last_message_at', { ascending: false })
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
    setSelected(conversation)
    setView('thread')
    setError('')
    const { data, error: queryError } = await requireSupabase().from('support_messages')
      .select('id,sender_kind,body,attachment_path,attachment_name,delivery_status,created_at')
      .eq('conversation_id', conversation.id).order('created_at')
    if (queryError) setError('Vestlust ei õnnestunud avada.')
    else setMessages((data ?? []) as SupportMessage[])
    await requireSupabase().rpc('mark_support_conversation_read', { target_conversation_id: conversation.id })
  }

  const uploadAttachment = async () => {
    if (!attachment || !user) return null
    const extension = attachment.name.includes('.') ? `.${attachment.name.split('.').pop()?.toLowerCase()}` : ''
    const path = `${user.id}/${crypto.randomUUID()}${extension}`
    const { error: uploadError } = await requireSupabase().storage.from('support-attachments').upload(path, attachment, {
      contentType: attachment.type,
      upsert: false,
    })
    if (uploadError) throw new Error('Ekraanipilti ei õnnestunud lisada.')
    return path
  }

  const createConversation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user) return
    setIsBusy(true); setError(''); setNotice('')
    try {
      const attachmentPath = await uploadAttachment()
      const { data, error: invokeError } = await requireSupabase().functions.invoke('support-actions', { body: {
        action: 'create', category, subject, body,
        attachment_path: attachmentPath,
        attachment_name: attachment?.name ?? null,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
      } })
      if (invokeError || data?.error) throw new Error(data?.error || 'Küsimust ei õnnestunud saata.')
      setSubject(''); setBody(''); setAttachment(null); setNotice('Küsimus on saadetud. Vastame sulle esimesel võimalusel.')
      await loadConversations()
      const { data: created } = await requireSupabase().from('support_conversations')
        .select('id,subject,category,status,last_message_at,last_message_preview,user_read_at').eq('id', data.id).single()
      if (created) await openConversation(created as SupportConversation)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Küsimust ei õnnestunud saata.')
    } finally { setIsBusy(false) }
  }

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || !reply.trim()) return
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

  const chooseCategory = (nextCategory: string) => {
    setCategory(nextCategory)
    setView('new')
    setError('')
    setNotice('')
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

  if (!user) return null
  const unread = conversations.filter((item) => item.user_read_at === null).length

  return <>
    <button className="support-launcher" type="button" onClick={openSupport} aria-label="Ava Poeruumi klienditugi" aria-expanded={isOpen}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z"/><path d="M9 9h6M9 12h4"/></svg>
      <span>Abi</span>{unread > 0 && <b>{unread}</b>}
    </button>
    {isOpen && <div className={`support-modal${isClosing ? ' is-closing' : ''}`} role="dialog" aria-label="Poeruumi klienditugi">
      <section className={`support-panel is-${view}`}>
        <header>
          <div>{view !== 'list' ? <button type="button" onClick={() => { setView('list'); setSelected(null); setError(''); setNotice('') }} aria-label="Tagasi vestluste juurde"><SupportIcon name="back" /></button> : <BrandMark className="support-panel__logo" />}<span><strong>Poeruumi tugi</strong><small><i /> Oleme siin, et aidata</small></span></div>
          <button type="button" onClick={closeSupport} aria-label="Sulge"><SupportIcon name="close" /></button>
        </header>

        {view === 'list' && <div className="support-panel__content">
          <div className="support-welcome"><span className="support-welcome__icon"><SupportIcon name="chat" /></span><small>ABI ON LÄHEDAL</small><h2>Mis sind praegu takistab?</h2><p>Kirjelda olukorda oma sõnadega. Näeme sinu poe seadistuse seisu ja saame kohe asjast aru.</p>
            <div className="support-quick-topics">
              <button type="button" onClick={() => chooseCategory('setup')}><i><SupportIcon name="setup" /></i><span>Poe seadistamine</span><SupportIcon name="arrow" /></button>
              <button type="button" onClick={() => chooseCategory('payments')}><i><SupportIcon name="payments" /></i><span>Maksed</span><SupportIcon name="arrow" /></button>
              <button type="button" onClick={() => chooseCategory('technical')}><i><SupportIcon name="technical" /></i><span>Tehniline mure</span><SupportIcon name="arrow" /></button>
            </div>
            <button className="support-welcome__primary" type="button" onClick={() => chooseCategory('question')}>Kirjuta meile <SupportIcon name="arrow" /></button>
            <div className="support-response-time"><SupportIcon name="clock" /><span><strong>Vastame päris inimesena</strong><small>Tavaliselt samal tööpäeval</small></span></div>
          </div>
          {conversations.length > 0 && <div className="support-history"><h3>Varasemad vestlused</h3>{conversations.map((conversation) => <button type="button" onClick={() => void openConversation(conversation)} key={conversation.id}>
            <span><strong>{conversation.subject}</strong><small>{conversation.last_message_preview}</small></span><time>{formatTime(conversation.last_message_at)}</time>{conversation.user_read_at === null && <i />}
          </button>)}</div>}
        </div>}

        {view === 'new' && <form className="support-form" onSubmit={createConversation}>
          <div className="support-form__intro"><span><SupportIcon name="chat" /></span><div><small>UUS VESTLUS</small><h2>Kirjuta meile</h2><p>Mida täpsemalt kirjeldad, seda kiiremini saame aidata.</p></div></div>
          <div className="support-form__fields">
            <label><span>Millega vajad abi?</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Ühe lausega</span><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} placeholder="Näiteks: maksete ühendamine ei õnnestu" required /></label>
            <label><span>Mis juhtus?</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={5} placeholder="Kirjelda, mida nägid ja mida juba proovisid…" required /></label>
          </div>
          <div className="support-upload">
            <input id="support-attachment" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)} />
            <label htmlFor="support-attachment"><i><SupportIcon name="upload" /></i><span><strong>Lisa ekraanipilt või PDF</strong><small>JPG, PNG, WebP või PDF · kuni 5 MB</small></span><b>{attachment ? 'Vaheta' : 'Vali fail'}</b></label>
            {attachment && <div className="support-upload__file"><span><SupportIcon name="check" /></span><p><strong>{attachment.name}</strong><small>{(attachment.size / 1024 / 1024).toFixed(1)} MB</small></p><button type="button" onClick={() => setAttachment(null)} aria-label="Eemalda manus"><SupportIcon name="close" /></button></div>}
          </div>
          {error && <p className="support-error" role="alert">{error}</p>}{notice && <p className="support-notice">{notice}</p>}
          <div className="support-form__footer"><small>Saadame kinnituse aadressile {user.email}</small><button className="support-submit" type="submit" disabled={isBusy}>{isBusy ? 'Saadan…' : 'Saada küsimus'} <SupportIcon name="arrow" /></button></div>
        </form>}

        {view === 'thread' && selected && <div className="support-thread">
          <div className="support-thread__title"><span><small>{categories.find(([value]) => value === selected.category)?.[1]}</small><h2>{selected.subject}</h2></span><b className={`is-${selected.status}`}>{selected.status === 'resolved' ? 'Lahendatud' : selected.status === 'waiting_user' ? 'Ootab sinu vastust' : 'Vaatame üle'}</b></div>
          <div className="support-thread__messages">{messages.map((message) => <article className={`is-${message.sender_kind}`} key={message.id}>
            <span>{message.sender_kind === 'admin' ? 'Poeruumi tugi' : 'Sina'}</span><p>{message.body}</p>
            {message.attachment_path && <button type="button" onClick={() => void openAttachment(message)}>📎 {message.attachment_name || 'Ava manus'}</button>}
            <time>{formatTime(message.created_at)}</time>
          </article>)}</div>
          {selected.status !== 'resolved' ? <form className="support-reply" onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} placeholder="Kirjuta vastus…" /><div>{error && <p className="support-error">{error}</p>}<button type="submit" disabled={isBusy || !reply.trim()}>{isBusy ? 'Saadan…' : 'Saada'} →</button></div></form> : <div className="support-resolved">See vestlus on lahendatud. Uue küsimuse korral alusta uut vestlust.</div>}
        </div>}
      </section>
    </div>}
  </>
}
