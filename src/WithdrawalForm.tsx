import { useRef, useState } from 'react'
import { withdrawalStatement, withdrawalTime, type WithdrawalConfirmation } from '../shared/withdrawal'
import { submitWithdrawal, type WithdrawalStore } from './lib/withdrawals'
import './withdrawal.css'

export default function WithdrawalForm({ store, storeName, orderReference = '' }: { store: WithdrawalStore; storeName: string; orderReference?: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reference, setReference] = useState(orderReference)
  const [scope, setScope] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<WithdrawalConfirmation | null>(null)
  const requestId = useRef(crypto.randomUUID())
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus())
  const values = { requestId: requestId.current, customerName: name.trim(), customerEmail: email.trim(), orderReference: reference.trim(), scope: scope.trim() }
  return <div className="withdrawal-form">
    <span className="withdrawal-form__store">{storeName}</span>
    <h2 tabIndex={-1} ref={heading}>{confirmation ? 'Avaldus on esitatud' : review ? 'Kontrolli avaldust' : 'Taganen lepingust'}</h2>
    {confirmation ? <div role="status">
      <p>Avaldus on müüjale edastatud. Saadame selle koopia e-postile {email.trim()}.</p>
      <dl><div><dt>Esitatud</dt><dd>{withdrawalTime(confirmation.submittedAt)} (Eesti aeg)</dd></div><div><dt>Avalduse number</dt><dd>{confirmation.id}</dd></div></dl>
      <p className="withdrawal-form__statement">{confirmation.statement}</p>
      <button type="button" onClick={() => {
        const content = `${storeName}\nTaganemisavaldus ${confirmation.id}\n${withdrawalTime(confirmation.submittedAt)} (Eesti aeg)\n${values.customerName}\n${values.customerEmail}\n\n${confirmation.statement}`
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = `taganemisavaldus-${confirmation.id}.txt`; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Laadi avaldus alla</button>
    </div> : <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      if (!review) { setError(''); setReview(true); focusHeading(); return }
      setBusy(true); setError('')
      try { setConfirmation(await submitWithdrawal(store, values)); focusHeading() }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Avalduse esitamine ebaõnnestus.') }
      finally { setBusy(false) }
    }}>
      {review ? <>
        <dl><div><dt>Nimi</dt><dd>{values.customerName}</dd></div><div><dt>E-post</dt><dd>{values.customerEmail}</dd></div></dl>
        <p className="withdrawal-form__statement">{withdrawalStatement(values)}</p>
        <p className="withdrawal-form__hint">Kinnitamisel edastatakse avaldus müüjale. Kauba tagastamine ja tagasimakse korraldatakse eraldi.</p>
      </> : <>
        <label>Sinu nimi<input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Tellimuse number või muu tellimust tuvastav teave<input required maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label>E-post kinnituse saamiseks<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Tagastatavad tooted <span>(kui tagastad osa tellimusest)</span><textarea rows={3} maxLength={2000} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="withdrawal-form__actions">
        {review && <button type="button" disabled={busy} onClick={() => { setReview(false); setError(''); requestId.current = crypto.randomUUID(); focusHeading() }}>Muuda</button>}
        <button className="withdrawal-form__primary" type="submit" disabled={busy}>{busy ? 'Esitan…' : review ? 'Kinnitan taganemise' : 'Vaata avaldus üle'}</button>
      </div>
    </form>}
  </div>
}
