import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import './adminPaymentReviews.css'
type Payment = { id: string; order_number: string; store_name: string; stripe_mode: string; stripe_payment_intent_id: string; stripe_dispute_id: string | null; stripe_dispute_status: string | null; stripe_payment_issue: string | null; last_error: string | null; payment_status: string }
type Seller = { id: string; name: string; seller_name: string; stripe_account_id: string; stripe_account_mode: string; bank: { id?: string; bank_name?: string; last4?: string; account_holder_name?: string } | null; identity_error: string | null; verified_at: string | null }
const dashboard = (mode: string, path: string) => `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}${path}`
export default function AdminPaymentReviews() {
  const [data, setData] = useState<{ orders: Payment[]; sellers: Seller[] }>({ orders: [], sellers: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const { data: rows, error: failure } = await requireSupabase().rpc('admin_payment_reviews')
    if (failure) { setError('Maksete kontrolli ei õnnestunud laadida.'); return }
    setData(rows); setError('')
  }, [])
  useEffect(() => { void load() }, [load])
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const { data: result, error: failure } = await requireSupabase().functions.invoke('payment-review', { body })
      if (failure || result?.error) throw new Error(result?.error || 'Toiming ebaõnnestus. Kontrolli konto andmeid ja proovi uuesti.')
      setNotice(body.action === 'retry-refund' ? 'Tagastus lisati uuesti tööjärjekorda.' : 'Konto kontroll salvestatud.')
      await load()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Toiming ebaõnnestus.') }
    finally { setBusy(false) }
  }
  return <div className="admin-payment-reviews">
    <button type="button" disabled={busy} onClick={() => void load()}>Uuenda maksete kontrolli</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section><h2>Kontrollimist vajavad maksed</h2><p>Osalise tagastuse ja vaidluse arvestus tuleb lahendada Stripe’is. Poeruum peatab nende maksete automaatsed rahaliigutused.</p>
      {!data.orders.length && <p>Kontrollimist vajavaid makseid pole.</p>}
      {data.orders.map(order => <article key={order.id}><h3>{order.store_name} · {order.order_number}</h3>
        <p>{order.stripe_payment_issue === 'funds_required' ? 'Tagastuseks vajalik raha puudub Stripe’i saldolt.' : order.stripe_payment_issue === 'partial_refund' ? 'Osaline tagastus.' : order.stripe_payment_issue === 'dispute' ? `Maksevaidlus: ${order.stripe_dispute_status}` : 'Makse vajab kontrolli.'} {order.payment_status === 'refunded' && 'Ostja makse on juba tagastatud; lahendamist vajab müüja ülekande tagasipööramine.'}</p>
        {order.last_error && <p>{order.last_error.replace(/^FUNDS_REQUIRED:(?:reversal:|refund:)?\s*/, '')}</p>}
        <a href={dashboard(order.stripe_mode, order.stripe_dispute_id ? `disputes/${encodeURIComponent(order.stripe_dispute_id)}` : `payments/${encodeURIComponent(order.stripe_payment_intent_id)}`)} target="_blank" rel="noreferrer">Ava Stripe’is ↗</a>
        {order.stripe_payment_issue === 'funds_required' && <><p>Kontrolli Stripe’is müüja ja platvormi saadaolevat saldot. Pärast vajaliku raha lisamist käivita sama tagastus uuesti. Ära loo uut tagastust. Tagastamata Stripe’i algse maksetasu katab Poeruum; müüjalt lisaraha automaatselt ei võeta.</p><button type="button" disabled={busy} onClick={() => void act({ action: 'retry-refund', orderId: order.id })}>Saldo kontrollitud — proovi tagastust uuesti</button></>}
      </article>)}
    </section>
    <section><h2>Ettevõtluskontode kontroll</h2><p>Kontrolli täieliku IBANi järgi, et Stripe’i EUR-väljamakse saaja on sama müüja aktiivne LHV ettevõtluskonto. Kasuta MTA ettevõtluskonto otsingut ja konto omaniku tõendit. Panga nimi ja neli viimast numbrit üksi ei ole piisavad.</p>
      {!data.sellers.length && <p>Ühendatud ettevõtluskontosid pole.</p>}
      {data.sellers.map(seller => <article key={seller.id}><h3>{seller.name} · {seller.seller_name}</h3>
        <p>{seller.verified_at ? `Kontrollitud ${new Date(seller.verified_at).toLocaleString('et-EE')}` : 'Ootab kontrolli'} · {seller.stripe_account_mode === 'test' ? 'Testkonto' : 'Päriskonto'}</p>
        <p>{seller.bank?.bank_name || 'Pangakonto puudub'} {seller.bank?.last4 && `•••• ${seller.bank.last4}`} {seller.bank?.account_holder_name}</p>
        {seller.identity_error && <p role="alert">{seller.identity_error}</p>}
        <a href={dashboard(seller.stripe_account_mode, `connect/accounts/${encodeURIComponent(seller.stripe_account_id)}`)} target="_blank" rel="noreferrer">Ava Stripe’i konto ↗</a>
        <button type="button" disabled={busy} onClick={() => void act({ action: 'refresh-seller', storeId: seller.id })}>Kontrolli värskeid kontoandmeid</button>
        {!seller.verified_at && <><label>Kontrolli tõend ja kuupäev<textarea maxLength={2000} value={evidence[seller.id] ?? ''} onChange={event => setEvidence(current => ({ ...current, [seller.id]: event.target.value }))} placeholder="MTA kontrolli kuupäev ja privaatse tõendi viide. Ära kopeeri siia IBANit ega isikukoodi." /></label><button type="button" disabled={busy || !seller.bank?.id || !!seller.identity_error || (evidence[seller.id]?.trim().length ?? 0) < 20} onClick={() => void act({ action: 'approve-seller', storeId: seller.id, bankId: seller.bank?.id, evidence: evidence[seller.id] })}>Täielik IBAN, aktiivne ettevõtluskonto ja omanik kontrollitud — kinnita</button></>}
      </article>)}
    </section>
  </div>
}
