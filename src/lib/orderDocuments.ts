import type { InvoiceDocumentSummary } from '../../shared/order-invoice'
import type { ReceiptAccess } from '../../shared/order-receipt'
import { requireSupabase } from './supabase'

export type OrderDocumentAccess = ReceiptAccess | { storeId: string; orderNumber: string }

async function requestDocuments(body: OrderDocumentAccess & { documentId?: string }, signal?: AbortSignal) {
  const { data, error } = await requireSupabase().functions.invoke('order-documents', { body, signal })
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null
    const detail = await response?.clone().json().catch(() => null)
    throw new Error(detail?.error || 'Arvete laadimine ebaõnnestus. Proovi uuesti.')
  }
  return data
}

export async function listOrderDocuments(access: OrderDocumentAccess, signal?: AbortSignal): Promise<InvoiceDocumentSummary[]> {
  const data = await requestDocuments(access, signal)
  if (!Array.isArray(data?.documents) || data.documents.some((doc: InvoiceDocumentSummary) =>
    !doc || typeof doc.id !== 'string' || typeof doc.number !== 'string' || !['invoice','credit'].includes(doc.kind) || typeof doc.ready !== 'boolean')) {
    throw new Error('Arvete vastus oli puudulik. Proovi uuesti.')
  }
  return data.documents
}

export async function downloadOrderDocument(access: OrderDocumentAccess, document: InvoiceDocumentSummary) {
  const data = await requestDocuments({ ...access, documentId: document.id })
  if (!(data instanceof Blob) || data.type !== 'application/pdf') throw new Error('Arve fail oli vigane. Proovi uuesti.')
  const url = URL.createObjectURL(data)
  const link = window.document.createElement('a')
  link.href = url
  link.download = `${document.kind === 'credit' ? 'Kreeditarve' : 'Arve'}-${document.number.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
