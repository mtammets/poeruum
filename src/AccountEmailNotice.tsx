import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [busy, setBusy] = useState<'send' | 'change' | 'check' | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)
  const refreshId = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++refreshId.current
    try {
      const next = await getAccountEmailStatus()
      if (id === refreshId.current) { setStatus(next); setLoadFailed(false) }
      return next
    } catch {
      // An unavailable check says nothing about whether an address is confirmed.
      if (id === refreshId.current) setLoadFailed(true)
      return null
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let active = true
    const onFocus = () => { void refresh() }
    void refresh()
    const { data: { subscription } } = requireSupabase().auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'SIGNED_IN') queueMicrotask(() => { if (active) void refresh() })
    })
    window.addEventListener('focus', onFocus)
    return () => { active = false; refreshId.current++; subscription.unsubscribe(); window.removeEventListener('focus', onFocus) }
  }, [userId, refresh])

  useEffect(() => {
    if (!resendCooldown) return
    const timer = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const checkConfirmation = async () => {
    if (busy) return
    setBusy('check'); setError(''); setNotice('')
    const next = await refresh()
    if (next && (!next.activation_allowed || next.pending_email)) setNotice('Kinnitus pole veel meieni jõudnud. Ava Poeruumi saadetud kiri ja vajuta seal kinnituslingile.')
    setBusy(null)
  }

  const sendConfirmation = async () => {
    if (!status || busy || resendCooldown) return
    setBusy('send'); setError(''); setNotice('')
    try {
      if (isCaptchaConfigured && !captchaToken) throw new Error(getCaptchaRequiredMessage())
      const { error: sendError } = await requireSupabase().auth.resend({
        type: status.pending_email ? 'email_change' : 'signup',
        // Supabase looks up the account by its current address, including for changes.
        email: status.email,
        options: { emailRedirectTo: window.location.origin, captchaToken: captchaToken || undefined },
      })
      if (sendError) {
        if (sendError.status === 429) setResendCooldown(60)
        throw new Error(sendError.status === 429 ? 'Palun oota veidi, enne kui uut kirja küsid.' : 'Kinnituskirja ei saanud saata. Proovi uuesti.')
      }
      setResendCooldown(60)
      setNotice(status.pending_email ? 'Kinnituskirjad on uuesti saadetud. Kontrolli mõlemat postkasti.' : 'Kinnituskiri on saadetud. Ava e-postis Poeruumi kiri ja vajuta kinnituslingile.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kinnituskirja ei saanud saata. Proovi uuesti.')
    } finally { setBusy(null); setCaptchaToken(''); setCaptchaReset(value => value + 1) }
  }

  if (!userId || (!status && !loadFailed) || (status?.activation_allowed && !status.pending_email)) return null

  if (!status) return <aside className="account-email-notice" aria-label="Konto e-posti olek">
    <p>E-posti olekut ei saanud praegu kontrollida.</p>
    <div className="account-email-notice__actions"><button type="button" disabled={Boolean(busy)} onClick={() => void checkConfirmation()}>{busy ? 'Kontrollin…' : 'Proovi uuesti'}</button></div>
  </aside>

  const needsReplacement = status.is_disposable && !status.pending_email

  return <aside className="account-email-notice" aria-label="Konto e-posti kinnitamine">
    <div className="account-email-notice__heading">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
      <div><strong>{status.pending_email ? 'Kinnita uus e-posti aadress' : needsReplacement ? 'Lisa püsiv e-posti aadress' : 'Kinnita oma e-post'}</strong><span>{status.pending_email || status.email}</span></div>
    </div>
    <p>{status.pending_email
      ? <>Ava Poeruumi kinnituskirjad senises postkastis <strong>{status.email}</strong> ja uues postkastis. Vajuta mõlemas kirjas kinnituslingile.</>
      : needsReplacement
        ? 'See on ajutine e-posti aadress. Maksete seadistamiseks ja poe avaldamiseks lisa aadress, mida kasutad püsivalt.'
        : 'Maksete seadistamiseks ja poe avaldamiseks kinnita oma Poeruumi konto e-post.'}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {loadFailed && <p role="status">E-posti olekut ei saanud praegu uuendada. Proovi uuesti.</p>}
    {!editing ? <>
      {!needsReplacement && <Turnstile key={captchaReset} action="merchant_email_confirm" onToken={setCaptchaToken} />}
      <div className="account-email-notice__actions">
        {needsReplacement
          ? <button className="account-email-notice__primary" type="button" onClick={() => { setEditing(true); setError(''); setNotice('') }}>Muuda aadressi</button>
          : <>
            <button className="account-email-notice__primary" type="button" disabled={Boolean(busy) || resendCooldown > 0 || (isCaptchaConfigured && !captchaToken)} onClick={() => void sendConfirmation()}>{busy === 'send' ? 'Saadan…' : resendCooldown ? `Saada uuesti (${resendCooldown} s)` : status.pending_email ? 'Saada kiri uuesti' : 'Saada kinnituskiri'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void checkConfirmation()}>{busy === 'check' ? 'Kontrollin…' : 'Olen kinnitanud'}</button>
            <button className="account-email-notice__link" type="button" disabled={Boolean(busy)} onClick={() => { setEditing(true); setError(''); setNotice(''); setCaptchaToken('') }}>Muuda aadressi</button>
          </>}
      </div>
    </> : <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      setBusy('change'); setError(''); setNotice('')
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
        if (updateError) throw new Error('E-posti aadressi ei saanud muuta. Proovi uuesti.')
        setPassword(''); setEditing(false)
        setStatus({ ...current, pending_email: nextEmail })
        setResendCooldown(60)
        setNotice('Kinnituskirjad on saadetud. Kontrolli mõlemat postkasti.')
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'E-posti muutmine ebaõnnestus.')
      } finally { setBusy(null); setCaptchaToken(''); setCaptchaReset((value) => value + 1) }
    }}>
      <label>Uus e-posti aadress<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <PasswordInput label="Praegune parool" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <Turnstile key={captchaReset} action="merchant_email_change" onToken={setCaptchaToken} />
      <div className="account-email-notice__actions"><button className="account-email-notice__primary" type="submit" disabled={Boolean(busy) || (isCaptchaConfigured && !captchaToken)}>{busy ? 'Saadan…' : 'Saada kinnituskiri'}</button><button type="button" disabled={Boolean(busy)} onClick={() => { setEditing(false); setPassword(''); setCaptchaToken('') }}>Loobu</button></div>
    </form>}
  </aside>
}
