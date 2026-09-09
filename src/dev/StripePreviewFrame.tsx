import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import StripeEmbeddedOnboarding, { type StripeEmbeddedMode } from '../StripeEmbeddedOnboarding'
import { SetupShell } from '../PlatformApp'
import SupportCenter from '../SupportCenter'
import type { StripeRequirementSummary } from '../lib/stripeRequirements'
import '../styles.css'
import '../brand.css'
import '../platform.css'

const sessionId = new URLSearchParams(window.location.search).get('session') ?? ''
async function stripe(action: 'start' | 'status', mode?: StripeEmbeddedMode) {
  const response = await fetch(`/__preview/sessions/${encodeURIComponent(sessionId)}/stripe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, mode }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Stripe’i testvormi avamine ebaõnnestus.')
  return result as { clientSecret?: string; requirements?: StripeRequirementSummary }
}

function StripePreviewFrame() {
  const [publishableKey, setPublishableKey] = useState('')
  const [mode, setMode] = useState<StripeEmbeddedMode>('onboarding')
  const [requirements, setRequirements] = useState<StripeRequirementSummary | null>(null)
  const [error, setError] = useState('')
  const onError = useCallback((message: string) => setError(message), [])
  useEffect(() => {
    let active = true
    void fetch('/__preview/config').then((response) => response.json()).then(async (configuration) => {
      if (!configuration.ready || !configuration.publishableKey?.startsWith('pk_test_')) throw new Error('Stripe’i testvõtmed on lisamata. Ava maksete eelvaade käsuga npm run dev:payments.')
      const status = await stripe('status')
      if (active) { setRequirements(status.requirements ?? null); setPublishableKey(configuration.publishableKey) }
    }).catch((problem) => { if (active) setError(problem.message) })
    return () => { active = false }
  }, [])
  const close = async () => {
    try { await stripe('status') } catch { /* The last known state is still available in the app preview. */ }
    window.location.assign(`/?preview_session=${encodeURIComponent(sessionId)}`)
  }
  return <><SetupShell screen="payments" onBack={() => void close()} onExit={() => void close()}>
    <div className="setup-form">
      {publishableKey ? <StripeEmbeddedOnboarding key={mode} mode={mode}
        requirements={requirements}
        connection={{ publishableKey, fetchClientSecret: async (nextMode) => {
          const result = await stripe('start', nextMode)
          if (!result.clientSecret) throw new Error('Stripe ei tagastanud testvormi sessiooni.')
          return result.clientSecret
        } }}
        onManage={() => setMode('management')} onClose={close} onExit={close} onError={onError}
        onStepChange={(step) => window.parent.postMessage({ type: 'poeruum-stripe-step', step }, window.location.origin)}
      /> : !error && <div role="status"><h2>Valmistan Stripe’i testkontot</h2><p>Hetk palun…</p></div>}
      {error && <p className="add-product-error" role="alert">{error}</p>}
    </div>
  </SetupShell><SupportCenter /></>
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<StripePreviewFrame />)
