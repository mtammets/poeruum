import { useEffect, useState } from 'react'
import { orderDocumentLabel, type InvoiceDocumentSummary } from '../shared/order-invoice'
import { downloadOrderDocument, listOrderDocuments, type OrderDocumentAccess } from './lib/orderDocuments'
import './orderDocuments.css'

export default function OrderDocumentLinks({ access, refunded = false, lazy = false }: { access: OrderDocumentAccess; refunded?: boolean; lazy?: boolean }) {
  const [expanded, setExpanded] = useState(!lazy)
  const [documents, setDocuments] = useState<InvoiceDocumentSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [attempt, setAttempt] = useState(0)
  const accessKey = JSON.stringify(access)
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    let timer = 0
    let polls = 0
    const read = async () => {
      try {
        const next = await listOrderDocuments(JSON.parse(accessKey), controller.signal)
        if (controller.signal.aborted) return
        setDocuments(next); setError('')
        const pending = !next.length || next.some((doc) => !doc.ready) || (refunded && !next.some((doc) => doc.kind === 'credit'))
        if (pending && polls++ < 12) timer = window.setTimeout(read, 5000)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Dokumentide laadimine ebaõnnestus.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [accessKey, attempt, refunded, expanded])
  const download = async (document: InvoiceDocumentSummary) => {
    setBusy(document.id); setError('')
    try { await downloadOrderDocument(access, document) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Dokumendi allalaadimine ebaõnnestus.') }
    finally { setBusy('') }
  }
  if (!expanded) return <div className="order-documents"><button type="button" onClick={() => setExpanded(true)}>Ostudokumendid</button></div>
  const pending = !documents.length || documents.some((doc) => !doc.ready) || (refunded && !documents.some((doc) => doc.kind === 'credit'))
  return <div className="order-documents" aria-label="Ostudokumendid">
    {documents.map((document) => <button key={document.id} type="button" disabled={!document.ready || Boolean(busy)} onClick={() => void download(document)}>
      {busy === document.id ? 'Laadin…' : `${orderDocumentLabel(document.kind, document.sellerType)} ${document.number}${document.ready ? ' · PDF' : ' · koostamisel'}`}
    </button>)}
    {loading ? <small>Laadin…</small> : pending && !error ? <small>Dokumenti koostatakse. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Värskenda</button></small> : null}
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Proovi uuesti</button></p>}
  </div>
}
