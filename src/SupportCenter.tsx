import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'

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

export default function SupportCenter() {
  const [user, setUser] = useState<User | null>(null)
  const [isOpen, setIsOpen] = useState(false)
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

  if (!user) return null
  const unread = conversations.filter((item) => item.user_read_at === null).length

  return <>
    <button className="support-launcher" type="button" onClick={() => setIsOpen(true)} aria-label="Ava Poeruumi klienditugi">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z"/><path d="M9 9h6M9 12h4"/></svg>
      <span>Abi</span>{unread > 0 && <b>{unread}</b>}
    </button>
    {isOpen && <div className="support-modal" role="dialog" aria-modal="true" aria-label="Poeruumi klienditugi">
      <button className="support-modal__backdrop" type="button" onClick={() => setIsOpen(false)} aria-label="Sulge klienditugi" />
      <section className="support-panel">
        <header>
          <div>{view !== 'list' && <button type="button" onClick={() => { setView('list'); setSelected(null); setError(''); setNotice('') }} aria-label="Tagasi vestluste juurde">←</button>}<span><strong>Poeruumi abi</strong><small>Vastame tavaliselt esimesel võimalusel</small></span></div>
          <button type="button" onClick={() => setIsOpen(false)} aria-label="Sulge">×</button>
        </header>

        {view === 'list' && <div className="support-panel__content">
          <div className="support-welcome"><span>👋</span><h2>Kuidas saame aidata?</h2><p>Kirjuta meile poe seadistamise, maksete või mõne muu küsimuse kohta.</p><button type="button" onClick={() => { setView('new'); setError(''); setNotice('') }}>Saada küsimus <span>→</span></button></div>
          {conversations.length > 0 && <div className="support-history"><h3>Varasemad vestlused</h3>{conversations.map((conversation) => <button type="button" onClick={() => void openConversation(conversation)} key={conversation.id}>
            <span><strong>{conversation.subject}</strong><small>{conversation.last_message_preview}</small></span><time>{formatTime(conversation.last_message_at)}</time>{conversation.user_read_at === null && <i />}
          </button>)}</div>}
        </div>}

        {view === 'new' && <form className="support-form" onSubmit={createConversation}>
          <div><h2>Kirjuta meile</h2><p>Kirjelda lühidalt, millega vajad abi.</p></div>
          <label>Teema<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Pealkiri<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} placeholder="Näiteks: maksete ühendamine ei õnnestu" required /></label>
          <label>Küsimus<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={6} placeholder="Kirjelda, mis juhtus ja mida proovisid…" required /></label>
          <label className="support-file"><span>Lisa ekraanipilt või PDF <small>kuni 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />{attachment && <b>{attachment.name}</b>}</label>
          {error && <p className="support-error" role="alert">{error}</p>}{notice && <p className="support-notice">{notice}</p>}
          <button className="support-submit" type="submit" disabled={isBusy}>{isBusy ? 'Saadan…' : 'Saada küsimus'} <span>→</span></button>
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
