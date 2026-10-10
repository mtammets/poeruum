import { useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import { getMerchantLoginUrl } from './lib/storefrontUrl'
import './platformInvoices.css'

type Document = { id: string; number: string; kind: 'invoice' | 'credit'; issuedAt: string; totalCents: number; ready: boolean }
class InvoiceAuthError extends Error {
  constructor() { super('Arvete vaatamiseks on vaja uuesti sisse logida.') }
}

async function requestInvoices(body: Record<string, unknown>, signal?: AbortSignal) {
  const client = requireSupabase()
  const { data: auth, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw new Error('Sisselogimise kontroll ebaõnnestus. Proovi uuesti.')
  if (!auth.session) throw new InvoiceAuthError()
  const invoke = (token: string) => {
    signal?.throwIfAborted()
    return client.functions.invoke('platform-invoices', {
      body, signal, headers: { Authorization: `Bearer ${token}` },
    })
  }
  let { data, error } = await invoke(auth.session.access_token)
  signal?.throwIfAborted()
  const response = error && 'context' in error && error.context instanceof Response ? error.context : null
  if (response?.status === 401) {
    // The shop can stay open after its session expires. Recover once before
    // asking the merchant to sign in, including when downloading a PDF.
    const refreshed = await client.auth.refreshSession()
    if (refreshed.error && ![400, 401, 403].includes(refreshed.error.status ?? 0)) {
      throw new Error('Sisselogimise uuendamine ebaõnnestus. Proovi uuesti.')
    }
    if (refreshed.error || !refreshed.data.session) throw new InvoiceAuthError()
    const retried = await invoke(refreshed.data.session.access_token)
    data = retried.data; error = retried.error
  }
  if (error) {
    const failedResponse = 'context' in error && error.context instanceof Response ? error.context : null
    if (failedResponse?.status === 401) throw new InvoiceAuthError()
    const detail = await failedResponse?.clone().json().catch(() => null)
    throw new Error(detail?.error || 'Arvete laadimine ebaõnnestus.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export default function PlatformInvoiceList({ storeId }: { storeId: string }) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loginRequired, setLoginRequired] = useState(false)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true); setError(''); setLoginRequired(false)
    requestInvoices({ storeId, offset }, controller.signal).then((result) => {
      if (!Array.isArray(result?.documents) || typeof result?.hasMore !== 'boolean') throw new Error('Arvete laadimine ebaõnnestus.')
      if (active) { setDocuments(result.documents); setHasMore(result.hasMore) }
    }).catch((reason) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Arvete laadimine ebaõnnestus.')
      if (reason instanceof InvoiceAuthError) { setLoginRequired(true); setDocuments([]); setHasMore(false) }
    })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [storeId, offset, attempt])
  const download = async (document: Document) => {
    setBusy(document.id); setError(''); setLoginRequired(false)
    try {
      const blob = await requestInvoices({ storeId, documentId: document.id })
      if (!(blob instanceof Blob) || blob.type !== 'application/pdf') throw new Error('Arve allalaadimine ebaõnnestus.')
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url; link.download = `${document.kind === 'credit' ? 'Kreeditarve' : 'Arve'}-${document.number}.pdf`
      window.document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Arve allalaadimine ebaõnnestus.')
      if (reason instanceof InvoiceAuthError) { setLoginRequired(true); setDocuments([]); setHasMore(false) }
    }
    finally { setBusy('') }
  }
  const signInAgain = async () => {
    setBusy('login')
    try {
      // Clear the old local session only after the merchant chooses to sign in,
      // otherwise the login page can restore it and return to the same error.
      const { error } = await requireSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      window.location.assign(getMerchantLoginUrl(window.location))
    } catch {
      setError('Sisselogimise avamine ebaõnnestus. Proovi uuesti.')
      setBusy('')
    }
  }
  return <section className="platform-invoices" aria-label="Poeruumi müügitasu arved">
    <header><strong>Müügitasu arved</strong><button type="button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Värskenda</button></header>
    {loading ? <p>Laadin arveid…</p> : !documents.length && !error ? <p>Arve tekib pärast Poeruumi müügitasu kinnipidamist.</p> : null}
    {!loading && documents.map((document) => <button className="platform-invoices__document" key={document.id} type="button" disabled={Boolean(busy)} onClick={() => void download(document)}>
      <span><strong>{document.kind === 'credit' ? 'Kreeditarve' : 'Arve'} {document.number}</strong><small>{new Date(document.issuedAt).toLocaleDateString('et-EE', { timeZone: 'Europe/Tallinn' })}</small></span>
      <span>{((document.kind === 'credit' ? -1 : 1) * document.totalCents / 100).toFixed(2).replace('.', ',')} €<small>{busy === document.id ? 'Laadin…' : 'Laadi PDF'}</small></span>
    </button>)}
    {error && <p role="alert">{error}</p>}
    {loginRequired && <button className="platform-invoices__login" type="button" disabled={Boolean(busy)} onClick={() => void signInAgain()}>{busy === 'login' ? 'Avan…' : 'Logi uuesti sisse'}</button>}
    {!loginRequired && (offset > 0 || hasMore) && <nav aria-label="Arvete leheküljed"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Eelmised</button><button type="button" disabled={loading || !hasMore} onClick={() => setOffset((value) => value + 50)}>Järgmised</button></nav>}
  </section>
}
