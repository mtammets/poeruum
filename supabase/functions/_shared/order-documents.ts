import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { InvoiceDocument } from '../../../shared/order-invoice.ts'

const bucket = 'order-documents'
export const documentPath = (id: string) => `${id}.pdf`
export const documentFilename = (doc: Pick<InvoiceDocument, 'number' | 'kind'>) => `${doc.kind === 'credit' ? 'Kreeditarve' : 'Arve'}-${doc.number}.pdf`
export const bytesBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(text)
}
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('')

export async function readDocumentPdf(admin: SupabaseClient, document: InvoiceDocument) {
  if (document.status !== 'ready' || !document.pdf_sha256) throw new Error('Arve PDF on koostamisel. Proovi mõne hetke pärast uuesti.')
  const { data, error } = await admin.storage.from(bucket).download(documentPath(document.id))
  if (error || !data) throw new Error('Arve PDF-i laadimine ebaõnnestus.')
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (await sha256(bytes) !== document.pdf_sha256) throw new Error('Arve PDF-i kontrollsumma ei vasta salvestatud dokumendile.')
  return bytes
}

export async function processOrderDocument(admin: SupabaseClient, mode: 'test' | 'live', documentId?: string,
  render?: (document: InvoiceDocument) => Promise<Uint8Array>): Promise<InvoiceDocument | null> {
  const { data, error } = await admin.rpc('claim_order_document', { mode_value: mode, target_document_id: documentId ?? null })
  if (error) throw error
  const document = data?.[0] as InvoiceDocument | undefined
  if (!document) return null
  const finish = async (outcome: string, hash: string | null, message: string | null) => {
    const { data, error } = await admin.rpc('finish_order_document', {
      target_document_id: document.id, token_value: document.lease_token, outcome_value: outcome,
      sha256_value: hash, error_value: message,
    })
    if (error) throw error
    return data as InvoiceDocument
  }
  try {
    // Recover an upload whose response/DB write was lost. Never overwrite an
    // issued file, even after a font or renderer deployment.
    const path = documentPath(document.id)
    const existing = await admin.storage.from(bucket).download(path)
    let bytes: Uint8Array
    if (existing.data) bytes = new Uint8Array(await existing.data.arrayBuffer())
    else {
      if (existing.error && !['404', '400'].includes(String((existing.error as { statusCode?: string }).statusCode))) throw existing.error
      const renderer = render ?? (await import('./order-invoice-pdf.ts')).renderOrderInvoice
      bytes = await renderer(document)
      const uploaded = await admin.storage.from(bucket).upload(path, new Uint8Array(bytes), { contentType: 'application/pdf', upsert: false })
      if (uploaded.error) {
        // A reclaimed worker might have won the upload. Its immutable PDF is
        // the authoritative artifact; this lease still gates the DB write.
        const recovered = await admin.storage.from(bucket).download(path)
        if (!recovered.data) throw uploaded.error
        bytes = new Uint8Array(await recovered.data.arrayBuffer())
      }
    }
    if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Salvestatud arve fail on vigane.')
    return await finish('ready', await sha256(bytes), null)
  } catch (error) {
    return finish('retry', null, error instanceof Error ? error.message : 'Arve koostamine ebaõnnestus.')
  }
}

export async function invoiceForEmail(admin: SupabaseClient, orderId: string, kind: 'invoice' | 'credit') {
  const read = async () => {
    const { data, error } = await admin.from('order_documents').select('*').eq('order_id', orderId).eq('kind', kind).single()
    if (error) throw error
    return data as InvoiceDocument
  }
  let document = await read()
  if (document.status !== 'ready') {
    await processOrderDocument(admin, document.stripe_mode, document.id)
    document = await read()
  }
  return { document, bytes: await readDocumentPdf(admin, document) }
}

export async function cleanupOrderDocuments(admin: SupabaseClient) {
  const { data, error } = await admin.from('order_document_cleanup').select('document_id').order('created_at').limit(50)
  if (error) throw error
  if (!data?.length) return 0
  const { error: removeError } = await admin.storage.from(bucket).remove(data.map((row) => documentPath(row.document_id)))
  if (removeError) throw removeError
  const { error: deleteError } = await admin.from('order_document_cleanup').delete().in('document_id', data.map((row) => row.document_id))
  if (deleteError) throw deleteError
  return data.length
}
