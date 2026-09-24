import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { emailShell } from './order-email-template.ts'
import type { OrderEmailKind, OrderEmailPayload } from './order-email.ts'
import { bytesBase64, documentFilename, invoiceForEmail } from './order-documents.ts'

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`

export async function buildOrderDocumentEmail(admin: SupabaseClient, orderId: string, kind: OrderEmailKind, jobId: string, refunded: boolean): Promise<OrderEmailPayload> {
  const credit = kind.endsWith('_credit')
  const customer = kind.startsWith('customer')
  const { document, bytes } = await invoiceForEmail(admin, orderId, credit ? 'credit' : 'invoice')
  const snapshot = document.snapshot
  const { data: access, error } = await admin.from('order_receipt_access').select('token').eq('order_id', orderId).single()
  if (error) throw error
  if (!/^[0-9a-f]{64}$/.test(access?.token ?? '')) throw new Error('Tellimuse kinnituslink puudub.')
  const appUrl = Deno.env.get('APP_URL')?.trim()
  if (!appUrl) throw new Error('Puudub APP_URL.')
  const receiptUrl = `${appUrl.replace(/\/$/, '')}/p/${encodeURIComponent(snapshot.storeSlug)}?checkout=status#receipt=${access.token}`
  const title = credit ? `Kreeditarve ${document.number}` : `Tellimus ${document.order_number} on kinnitatud`
  const intro = credit
    ? `Tellimuse ${document.order_number} makse on tagastatud. Kirjale on lisatud kreeditarve, mis viitab arvele ${document.original_number}.`
    : refunded
      ? 'Kirjale on lisatud tasutud tellimuse arve. Selle tellimuse makse on tagastatud; kreeditarve saadame eraldi kirjaga.'
      : customer ? 'Aitäh tellimuse eest! Makse õnnestus. Tasutud arve on selle kirja manuses.'
        : 'Sinu poodi saabus tasutud tellimus. Müügiarve on selle kirja manuses.'
  const total = money(snapshot.totalCents * (credit ? -1 : 1))
  const configuredFrom = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
  const senderAddress = configuredFrom.match(/<([^<>]+)>/)?.[1]?.trim() || configuredFrom
  const storeName = snapshot.storeName.replace(/[\r\n<>"]/g, '').slice(0, 70)
  return {
    from: `${storeName} via Poeruum <${senderAddress}>`,
    to: [customer ? snapshot.buyer.email : snapshot.sellerEmail],
    reply_to: customer ? snapshot.seller.email : snapshot.buyer.email,
    subject: `${title} · ${snapshot.storeName}`,
    attachments: [{ filename: documentFilename(document), content: bytesBase64(bytes), content_type: 'application/pdf' }],
    tags: [{ name: 'email_type', value: kind === 'customer' ? 'order_customer_confirmation' : kind === 'seller' ? 'order_seller_notification' : `order_${kind}` },
      { name: 'order_id', value: orderId }, { name: 'order_email_job_id', value: jobId }],
    html: emailShell({ title, intro, seller: !customer, credit, canReply: true, actionUrl: receiptUrl,
      note: credit ? 'Kreeditarve on kirja manuses.' : refunded ? 'Tellimuse makse on tagastatud. Kreeditarve saadame eraldi.' : 'Hakkame tellimust ette valmistama. Arve on kirja manuses.',
      store: { id: '', owner_id: '', name: snapshot.storeName, settings: {} },
      settings: { editableStoreName: snapshot.storeName, businessName: snapshot.seller.name, contactEmail: snapshot.seller.email,
        storeAccent: snapshot.storeAccent, storeLogo: snapshot.storeLogo },
      order: { id: orderId, store_id: '', order_number: document.order_number,
        customer_name: snapshot.buyer.name, customer_email: snapshot.buyer.email, delivery: snapshot.delivery,
        items: snapshot.lines.filter((line) => line.kind !== 'shipping')
          .map((line) => ({ name: line.name + (line.options ? ` · ${line.options}` : ''), image: line.image, quantity: line.quantity, price: line.unitGrossCents * (credit ? -1 : 1) / 100 })),
        product_subtotal: snapshot.lines.filter((line) => line.kind !== 'shipping')
          .reduce((sum, line) => sum + line.grossCents, 0) * (credit ? -1 : 1) / 100,
        total: snapshot.totalCents * (credit ? -1 : 1) / 100,
        seller_vat_registered: snapshot.vatRate !== null, seller_vat_number: snapshot.seller.vatNumber,
        seller_vat_rate: snapshot.vatRate, seller_vat_amount: snapshot.vatCents * (credit ? -1 : 1) / 100,
        customer_confirmation_sent_at: null, seller_notification_sent_at: null,
      },
    }),
    text: `${title}\n\n${intro}\n\n${snapshot.lines.map((line) => `${line.name} ${line.options} × ${line.quantity}: ${money(line.grossCents * (credit ? -1 : 1))}`).join('\n')}\n\nKokku: ${total}\nTarne: ${snapshot.delivery}\n\nTellimus ja arved: ${receiptUrl}\n\n${snapshot.seller.name} · ${snapshot.seller.email}`,
  }
}
