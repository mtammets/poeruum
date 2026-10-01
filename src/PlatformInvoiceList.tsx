import { useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import './platformInvoices.css'

type Document = { id: string; number: string; kind: 'invoice' | 'credit'; issuedAt: string; totalCents: number; ready: boolean }
async function requestInvoices(body: Record<string, unknown>) {
  const { data, error } = await requireSupabase().functions.invoke('platform-invoices', { body })
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? await error.context.clone().json().catch(() => null) : null
    throw new Error(response?.error || 'Arvete laadimine ebaõnnestus.')
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
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    requestInvoices({ storeId, offset }).then((result) => {
      if (!Array.isArray(result?.documents) || typeof result?.hasMore !== 'boolean') throw new Error('Arvete laadimine ebaõnnestus.')
      if (active) { setDocuments(result.documents); setHasMore(result.hasMore) }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Arvete laadimine ebaõnnestus.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [storeId, offset, attempt])
  const download = async (document: Document) => {
    setBusy(document.id); setError('')
    try {
      const blob = await requestInvoices({ storeId, documentId: document.id })
      if (!(blob instanceof Blob) || blob.type !== 'application/pdf') throw new Error('Arve allalaadimine ebaõnnestus.')
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url; link.download = `${document.kind === 'credit' ? 'Kreeditarve' : 'Arve'}-${document.number}.pdf`
      window.document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Arve allalaadimine ebaõnnestus.') }
    finally { setBusy('') }
  }
  return <section className="platform-invoices" aria-label="Poeruumi müügitasu arved">
    <header><strong>Müügitasu arved</strong><button type="button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Värskenda</button></header>
    {loading ? <p>Laadin arveid…</p> : !documents.length && !error ? <p>Arve tekib pärast Poeruumi müügitasu kinnipidamist.</p> : null}
    {!loading && documents.map((document) => <button className="platform-invoices__document" key={document.id} type="button" disabled={Boolean(busy)} onClick={() => void download(document)}>
      <span><strong>{document.kind === 'credit' ? 'Kreeditarve' : 'Arve'} {document.number}</strong><small>{new Date(document.issuedAt).toLocaleDateString('et-EE', { timeZone: 'Europe/Tallinn' })}</small></span>
      <span>{((document.kind === 'credit' ? -1 : 1) * document.totalCents / 100).toFixed(2).replace('.', ',')} €<small>{busy === document.id ? 'Laadin…' : 'Laadi PDF'}</small></span>
    </button>)}
    {error && <p role="alert">{error}</p>}
    {(offset > 0 || hasMore) && <nav aria-label="Arvete leheküljed"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Eelmised</button><button type="button" disabled={loading || !hasMore} onClick={() => setOffset((value) => value + 50)}>Järgmised</button></nav>}
  </section>
}
