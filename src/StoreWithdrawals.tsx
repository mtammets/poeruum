import { useEffect, useState } from 'react'
import { withdrawalTime, type StoreWithdrawal } from '../shared/withdrawal'
import { listWithdrawals, reviewWithdrawal } from './lib/withdrawals'

export default function StoreWithdrawals({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<StoreWithdrawal[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    listWithdrawals(storeId).then((value) => { if (active) { setItems(value); setError('') } }).catch((reason) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [storeId, revision])
  if (error && !items.length) return <div className="store-withdrawals" role="alert"><p>{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>Proovi uuesti</button></div>
  if (!items.length) return null
  const unread = items.filter((item) => item.status === 'new').length
  return <details className="store-withdrawals" open={unread > 0 ? true : undefined}>
    <summary>Taganemisavaldused <span>{unread ? `${unread} uut` : items.length}</span></summary>
    {error && <p role="alert">{error}</p>}
    {items.map((item) => <article key={item.id} aria-label={`Taganemisavaldus ${item.order_reference}`}>
      <header><strong>{item.order_reference}</strong><time dateTime={item.submitted_at}>{withdrawalTime(item.submitted_at)}</time></header>
      <p>{item.customer_name} · <a href={`mailto:${item.customer_email}`}>{item.customer_email}</a></p>
      <p className="store-withdrawals__statement">{item.statement}</p>
      {!item.order_id && <p className="store-withdrawals__hint">Leia tellimus esitatud andmete järgi.</p>}
      <footer><small>Avalduse vastuvõtmine ei tagasta makset automaatselt.</small>{item.status === 'reviewed' ? <span>Üle vaadatud</span> : <button type="button" disabled={busy === item.id} onClick={async () => {
        setBusy(item.id); setError('')
        try { await reviewWithdrawal(item.id); setItems((items) => items.map((current) => current.id === item.id ? { ...current, status: 'reviewed' } : current)) }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Uuendamine ebaõnnestus.') }
        finally { setBusy(null) }
      }}>{busy === item.id ? 'Salvestan…' : 'Märgi ülevaadatuks'}</button>}</footer>
    </article>)}
  </details>
}
