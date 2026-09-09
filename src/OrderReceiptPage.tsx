import { useEffect, useRef, useState } from 'react'
import type { OrderReceipt, ReceiptStatus } from '../shared/order-receipt'
import { fetchOrderReceipt, ReceiptLoadError, type ReceiptLocation } from './lib/orderReceipt'
import './orderReceipt.css'

const euro = (amount: number) => new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' }).format(amount)
const copy: Record<ReceiptStatus, { title: string; message: string }> = {
  pending: { title: 'Kontrollime makset', message: 'Ootame makse kinnitust. Ära tee uut makset. Tellimuse töötlemine jätkub ka siis, kui selle lehe sulged.' },
  unpaid: { title: 'Makse on lõpetamata', message: 'Selle tellimuse eest pole veel kinnitatud makset. Saad jätkata samal makselehel.' },
  paid: { title: 'Makse õnnestus', message: 'Tellimus on kinnitatud. Müüja saab selle täitmisega edasi minna.' },
  failed: { title: 'Makse ebaõnnestus', message: 'Viimane maksekatse ei õnnestunud. Saad samal makselehel valida teise makseviisi või uuesti proovida.' },
  expired: { title: 'Makseleht on aegunud', message: 'Selle tellimuse eest pole kinnitatud makset. Uue tellimuse saad vormistada poes.' },
  refunded: { title: 'Makse on tagastatud', message: 'Tagastus on kinnitatud. Raha jõudmine kontole sõltub sinu makseviisist ja pangast.' },
}

export default function OrderReceiptPage({ location }: { location: ReceiptLocation }) {
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(Boolean(location.access))
  const [pollingPaused, setPollingPaused] = useState(false)
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    if (!location.access) return
    const access = location.access
    let active = true
    let running = false
    let timer = 0
    let deadline = Date.now() + 120000
    const controller = new AbortController()
    const check = async () => {
      if (!active || running || document.visibilityState === 'hidden') return
      running = true
      window.clearTimeout(timer)
      setBusy(true)
      let shouldPoll = true
      try {
        const result = await fetchOrderReceipt(access, controller.signal)
        if (!active) return
        setReceipt(result)
        setError('')
        shouldPoll = ['pending', 'unpaid', 'failed'].includes(result.status)
      } catch (reason) {
        if (!active) return
        setError(reason instanceof ReceiptLoadError ? reason.message : 'Ühendus katkes. Tellimuse oleku kontrollimiseks proovi uuesti.')
        shouldPoll = !(reason instanceof ReceiptLoadError) || reason.retryable
      } finally {
        running = false
        if (active) {
          setBusy(false)
          setPollingPaused(shouldPoll && Date.now() >= deadline)
          if (shouldPoll && Date.now() < deadline) timer = window.setTimeout(() => void check(), 5000)
        }
      }
    }
    const restart = () => {
      deadline = Date.now() + 120000
      setPollingPaused(false)
      void check()
    }
    refresh.current = restart
    window.addEventListener('focus', restart)
    window.addEventListener('online', restart)
    const visible = () => { if (document.visibilityState === 'visible') restart() }
    document.addEventListener('visibilitychange', visible)
    void check()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener('focus', restart)
      window.removeEventListener('online', restart)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [location])

  const current = receipt ? copy[receipt.status] : null
  return <main className="order-receipt">
    <div className="order-receipt__sheet">
      <header><span>{receipt?.storeName || 'Poeruum'}</span><span>Tellimuse ülevaade</span></header>
      <section className="order-receipt__status" aria-live="polite" aria-atomic="true">
        <span className={`order-receipt__symbol order-receipt__symbol--${receipt?.status || 'pending'}`} aria-hidden="true">{receipt?.status === 'paid' ? '✓' : receipt?.status === 'failed' ? '!' : '· · ·'}</span>
        <h1>{current?.title || (error || !location.access ? 'Tellimuse olek pole teada' : 'Kontrollime makset')}</h1>
        <p>{current?.message || (!location.access ? 'Sellel aadressil puudub tellimuse isiklik kinnituslink. Makse tulemust ei saa selle järgi kinnitada. Kontrolli tellimuse e-kirja või võta poega ühendust.' : 'Laadime tellimuse andmeid. Ära tee uut makset enne, kui tulemus on selge.')}</p>
      </section>
      {error && <p className="order-receipt__error" role="alert">{error}</p>}
      {pollingPaused && <p className="order-receipt__note">Kinnituse saamine võtab oodatust kauem. Saad olekut uuesti kontrollida või selle lehe hiljem avada.</p>}
      {receipt && <>
        <dl className="order-receipt__details"><div><dt>Tellimuse number</dt><dd>{receipt.orderNumber}</dd></div><div><dt>Tellimuse aeg</dt><dd>{new Intl.DateTimeFormat('et-EE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(receipt.createdAt))}</dd></div></dl>
        <section className="order-receipt__items" aria-label="Tellitud tooted">
          {receipt.items.map((item, index) => <div className="order-receipt__item" key={index}>
            <div><strong>{item.name}</strong>{Object.keys(item.options).length > 0 && <small>{Object.entries(item.options).map(([name, value]) => `${name}: ${value}`).join(' · ')}</small>}<small>{item.quantity} × {euro(item.unitPrice)}</small></div><span>{euro(item.unitPrice * item.quantity)}</span>
          </div>)}
          <div className="order-receipt__amount"><span>Tarne</span><span>{euro(receipt.deliveryTotal)}</span></div>
          <div className="order-receipt__amount order-receipt__total"><strong>Kokku</strong><strong>{euro(receipt.total)}</strong></div>
        </section>
        <section className="order-receipt__delivery"><h2>Tarne</h2><p>{receipt.delivery || 'Tarne üksikasjad lepitakse kokku müüjaga.'}</p></section>
        <p className="order-receipt__note">Selle isikliku lingi kaudu saad tellimuse ülevaate hiljem uuesti avada. Lingiga pääseb ligi sinu tellimuse andmetele.</p>
      </>}
      <div className="order-receipt__actions">
        {receipt?.resumeUrl && ['unpaid', 'failed'].includes(receipt.status) && !error && <a className="order-receipt__primary" href={receipt.resumeUrl} referrerPolicy="no-referrer">Jätka maksmist</a>}
        {location.access && <button type="button" disabled={busy} onClick={() => refresh.current()}>{busy ? 'Kontrollin…' : 'Kontrolli olekut uuesti'}</button>}
        <a href={location.storePath} referrerPolicy="no-referrer">Tagasi poodi</a>
      </div>
    </div>
  </main>
}
