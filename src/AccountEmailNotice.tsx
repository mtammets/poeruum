import { useEffect, useState } from 'react'
import { getAccountEmailStatus, type AccountEmailStatus } from './lib/accountEmail'
import { requireSupabase } from './lib/supabase'
import PasswordInput from './PasswordInput'
import { getCaptchaRequiredMessage, isCaptchaConfigured, Turnstile } from './Turnstile'
import './accountEmail.css'

export default function AccountEmailNotice({ userId }: { userId: string | null }) {
  const [status, setStatus] = useState<AccountEmailStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)

  useEffect(() => {
    if (!userId) return
    let active = true
    const refresh = () => {
      void getAccountEmailStatus().then((next) => {
        if (active) { setStatus(next); setError('') }
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'E-posti kontroll ebaõnnestus.')
      })
    }
    refresh()
    const { data: { subscription } } = requireSupabase().auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'SIGNED_IN') queueMicrotask(() => { if (active) refresh() })
    })
    window.addEventListener('focus', refresh)
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener('focus', refresh) }
  }, [userId])

  if (!userId || (!error && (!status || (status.activation_allowed && !status.pending_email)))) return null

  return <aside className="account-email-notice" aria-label="Konto e-posti kinnitamine">
    <strong>{status?.is_disposable ? 'Kasuta poe jaoks püsivat e-posti aadressi' : 'Kinnita konto e-posti aadress'}</strong>
    <p>{status?.is_disposable
      ? 'Sinu konto kasutab ajutist postkasti. Saad poodi edasi seadistada, kuid avaldamiseks ja maksete ühendamiseks vaheta aadress ning kinnita see. Sobib ka isiklik e-post või püsiv privaatsusaliase aadress.'
      : 'Poe avaldamiseks ja maksete ühendamiseks peab konto e-posti aadress olema kinnitatud.'}</p>
    {status?.pending_email && <p role="status">Ootab kinnitamist: <strong>{status.pending_email}</strong>. Kinnita aadressi vahetus saadetud kirjades; seni kehtib praegune aadress.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!editing ? <div className="account-email-notice__actions">
      <button type="button" onClick={() => { setEditing(true); setError(''); setNotice('') }}>Muuda konto e-posti</button>
      <button type="button" onClick={() => { void getAccountEmailStatus().then((next) => { setStatus(next); setError('') }).catch((cause: Error) => setError(cause.message)) }}>Kontrolli kinnitust</button>
      <a href="mailto:info@poeruum.ee">Vajan abi</a>
    </div> : <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError(''); setNotice('')
      try {
        const nextEmail = email.trim()
        const current = await getAccountEmailStatus(nextEmail)
        if (nextEmail.toLowerCase() === current.email.toLowerCase()) throw new Error('Sisesta praegusest erinev aadress.')
        if (current.candidate_is_disposable) throw new Error('See aadress kuulub ajutisele meiliteenusele. Kasuta püsivat aadressi.')
        if (isCaptchaConfigured && !captchaToken) throw new Error(getCaptchaRequiredMessage())
        const client = requireSupabase()
        const { error: authError } = await client.auth.signInWithPassword({
          email: current.email, password, options: { captchaToken: captchaToken || undefined },
        })
        if (authError) throw new Error('Parooli kontroll ebaõnnestus. Kontrolli parooli ja botikaitset.')
        const { error: updateError } = await client.auth.updateUser({ email: nextEmail }, { emailRedirectTo: window.location.origin })
        if (updateError) throw updateError
        setPassword(''); setEditing(false)
        setNotice('Kinnituskirjad on saadetud. Kinnita aadressi vahetus kirjades olevate linkidega.')
        setStatus(await getAccountEmailStatus())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'E-posti muutmine ebaõnnestus.')
      } finally { setBusy(false); setCaptchaToken(''); setCaptchaReset((value) => value + 1) }
    }}>
      <label>Uus e-posti aadress<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <PasswordInput label="Praegune parool" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <Turnstile key={captchaReset} action="merchant_email_change" onToken={setCaptchaToken} />
      <div className="account-email-notice__actions"><button type="submit" disabled={busy || (isCaptchaConfigured && !captchaToken)}>{busy ? 'Saadan…' : 'Saada kinnituskiri'}</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setPassword('') }}>Loobu</button></div>
    </form>}
  </aside>
}
