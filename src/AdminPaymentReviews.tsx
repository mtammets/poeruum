import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import './adminPaymentReviews.css'
type Payment = { id: string; order_number: string; store_name: string; stripe_mode: string; stripe_payment_intent_id: string; stripe_dispute_id: string | null; stripe_dispute_status: string | null; stripe_payment_issue: string | null; last_error: string | null; payment_status: string }
type Seller = { id: string; name: string; seller_name: string; stripe_account_id: string; stripe_account_mode: string; checked_at: string | null; stripe_ready: boolean | null; bank: { id?: string; bank_name?: string; last4?: string; account_holder_name?: string; country?: string; currency?: string } | null; identity_error: string | null; verified_at: string | null }
const dashboard = (mode: string, path: string) => `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}${path}`
export default function AdminPaymentReviews() {
  const [data, setData] = useState<{ orders: Payment[]; sellers: Seller[] }>({ orders: [], sellers: [] })
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const { data: rows, error: failure } = await requireSupabase().rpc('admin_payment_reviews')
    if (failure) { setError('Maksete kontrolli ei õnnestunud laadida.'); return }
    setData(rows); setLoaded(true); setError('')
  }, [])
  useEffect(() => { void load() }, [load])
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const { data: result, error: failure } = await requireSupabase().functions.invoke('payment-review', { body })
      if (failure || result?.error) throw new Error(result?.error || 'Toiming ebaõnnestus. Kontrolli konto andmeid ja proovi uuesti.')
      setNotice(body.action === 'retry-refund' ? 'Tagastus lisati uuesti tööjärjekorda.' : body.action === 'refresh-seller' ? 'Stripe’i andmed uuendatud.' : 'Ettevõtluskonto kinnitatud.')
      await load()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Toiming ebaõnnestus.') }
    finally { setBusy(false) }
  }
  return <div className="admin-payment-reviews">
    <button type="button" disabled={busy} onClick={() => void load()}>Uuenda maksete kontrolli</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section><h2>Kontrollimist vajavad maksed</h2>{data.orders.length > 0 && <p>Siin on maksed, mille tagastus või vaidlus vajab sinu abi.</p>}
      {loaded && !error && !data.orders.length && <p>Kontrollimist vajavaid makseid pole.</p>}
      {data.orders.map(order => <article key={order.id}><h3>{order.store_name} · {order.order_number}</h3>
        <p>{order.stripe_payment_issue === 'funds_required' ? 'Tagastuseks vajalik raha puudub Stripe’i saldolt.' : order.stripe_payment_issue === 'partial_refund' ? 'Osaline tagastus.' : order.stripe_payment_issue === 'dispute' ? `Maksevaidlus: ${order.stripe_dispute_status}` : 'Makse vajab kontrolli.'} {order.payment_status === 'refunded' && order.stripe_payment_issue === 'funds_required' && 'Ostja makse on juba tagastatud; lahendamist vajab müüja ülekande tagasipööramine.'}</p>
        {order.last_error && <p>{order.last_error.replace(/^FUNDS_REQUIRED:(?:reversal:|refund:)?\s*/, '')}</p>}
        <a href={dashboard(order.stripe_mode, order.stripe_dispute_id ? `disputes/${encodeURIComponent(order.stripe_dispute_id)}` : `payments/${encodeURIComponent(order.stripe_payment_intent_id)}`)} target="_blank" rel="noreferrer">Ava Stripe’is ↗</a>
        {order.stripe_payment_issue === 'funds_required' && <><p>Kontrolli Stripe’is müüja ja platvormi saadaolevat saldot. Pärast vajaliku raha lisamist käivita sama tagastus uuesti. Ära loo uut tagastust. Tagastamata Stripe’i algse maksetasu katab Poeruum; müüjalt lisaraha automaatselt ei võeta.</p><button type="button" disabled={busy} onClick={() => void act({ action: 'retry-refund', orderId: order.id })}>Saldo kontrollitud — proovi tagastust uuesti</button></>}
      </article>)}
    </section>
    <section><h2>Ettevõtluskontoga müüjad</h2><p>Siin näed, kas müüja peab veel Stripe’i seadistama või ootab tema ettevõtluskonto sinu kinnitust.</p>
      {!loaded && !error && <p role="status">Laadin andmeid…</p>}
      {loaded && !error && !data.sellers.length && <p>Ühendatud ettevõtluskontoga müüjaid pole.</p>}
      {data.sellers.map(seller => {
        const canReview = Boolean(seller.checked_at && seller.stripe_ready && !seller.identity_error
          && seller.bank?.id && seller.bank.country === 'EE' && seller.bank.currency === 'eur')
        return <article key={seller.id}><h3>{seller.name}</h3>
          {seller.name !== seller.seller_name && <p>Müüja: {seller.seller_name}</p>}
          <p><strong>{seller.verified_at ? 'Ettevõtluskonto kinnitatud' : !seller.checked_at ? 'Stripe’i andmed veel laadimata' : canReview ? 'Ootab sinu kinnitust' : 'Müüja seadistus on pooleli'}</strong>{seller.stripe_account_mode === 'test' && ' · Testkonto'}</p>
          {!seller.checked_at ? <p>Laadi Stripe’i andmed, et näha, kas müüja on seadistuse lõpetanud.</p>
            : !canReview && !seller.verified_at ? <p>Müüja peab Stripe’is oma andmed ja väljamaksekonto lõpuni seadistama. Praegu pole sul vaja midagi kinnitada.</p> : null}
          {seller.bank?.id && <p>{seller.bank.bank_name || 'Stripe’i väljamaksekonto'} {seller.bank.last4 && `•••• ${seller.bank.last4}`} {seller.bank.account_holder_name}</p>}
          {seller.checked_at && !seller.bank?.id && <p>Stripe’is pole praegu kasutusvalmis EUR-väljamaksekontot.</p>}
          {seller.identity_error && <p>Stripe’i andmete kontroll: {seller.identity_error}</p>}
          <a href={dashboard(seller.stripe_account_mode, `connect/accounts/${encodeURIComponent(seller.stripe_account_id)}`)} target="_blank" rel="noreferrer">Vaata müüja Stripe’i kontot ↗</a>
          <button type="button" disabled={busy} onClick={() => void act({ action: 'refresh-seller', storeId: seller.id })}>{seller.checked_at ? 'Uuenda Stripe’i andmeid' : 'Laadi Stripe’i andmed'}</button>
          {seller.verified_at && <p>Kinnitatud {new Date(seller.verified_at).toLocaleString('et-EE')}</p>}
          {!seller.verified_at && canReview && <>
            <p>Enne kinnitamist kontrolli, et Stripe’is valitud pangakonto on selle müüja aktiivne LHV ettevõtluskonto. Võrdle täielikku kontonumbrit müüja tõendiga ja kontrolli konto aktiivsust MTA ettevõtluskonto otsingus. Ainult siin kuvatud viimastest numbritest ei piisa.</p>
            <label>Konto kontrolli märkus<textarea maxLength={2000} value={evidence[seller.id] ?? ''} onChange={event => setEvidence(current => ({ ...current, [seller.id]: event.target.value }))} placeholder="Millal kontrollisid ja kus asub müüja tõend? Kontonumbrit ega isikukoodi pole siia vaja." /></label>
            <button type="button" disabled={busy || (evidence[seller.id]?.trim().length ?? 0) < 20} onClick={() => void act({ action: 'approve-seller', storeId: seller.id, bankId: seller.bank?.id, evidence: evidence[seller.id] })}>Kinnita ettevõtluskonto</button>
          </>}
        </article>
      })}
    </section>
  </div>
}
