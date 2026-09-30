import { useEffect, useState } from 'react'
import { Brand } from './Brand'
import { invokeStripeConnect, invokeStripeHosted } from './lib/database'
import { clearStripeReturnContext, readStripeReturnContext, stripeRedirectUrl } from './lib/stripeHosted'
import './platform.css'

const context = readStripeReturnContext()
const refresh = new URLSearchParams(window.location.search).get('refresh') === '1'
window.history.replaceState({}, '', window.location.pathname)
let attempt: Promise<void> | null = null

const completeReturn = async () => {
  if (!context) throw new Error('Ava maksete seadistus oma poest uuesti.')
  if (refresh) {
    const result = await invokeStripeHosted('hosted-refresh', context.mode, context.storeId)
    window.location.replace(stripeRedirectUrl(result.url))
    return
  }
  // Returning from Stripe never marks payments ready. Stripe may also send the
  // seller back after “Save for later”; only the server can determine readiness.
  const result = await invokeStripeConnect('status')
  if (result.setupError) throw new Error(result.setupError)
  clearStripeReturnContext()
  window.location.replace(context.returnTo)
}

export default function StripeConnectReturn() {
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    attempt ??= completeReturn()
    attempt.catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Maksete olekut ei saanud kontrollida.') })
    return () => { active = false }
  }, [retry])
  return <main className="stripe-return">
    <Brand />
    {error ? <><p role="alert">{error}</p>
      {context && <button type="button" onClick={() => { attempt = null; setError(''); setRetry(value => value + 1) }}>Proovi uuesti</button>}
      <a href={context?.returnTo || '/'} onClick={clearStripeReturnContext}>Tagasi poodi</a>
    </> : <p role="status">{refresh ? 'Avan maksete seadistust…' : 'Kontrollin maksete olekut…'}</p>}
  </main>
}
