import { useEffect, useState } from 'react'
import { Brand } from './Brand'
import { applySeoMetadata } from './lib/seo'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import './unsubscribe.css'

type UnsubscribeState = 'idle' | 'loading' | 'success' | 'invalid' | 'error'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function OutreachUnsubscribe() {
  const [state, setState] = useState<UnsubscribeState>('idle')
  const [token, setToken] = useState('')

  useEffect(() => {
    applySeoMetadata({
      title: 'Kirjadest loobumine — Poeruum',
      description: 'Poeruumi ettevõtetele suunatud kirjadest loobumine.',
      canonicalUrl: 'https://poeruum.ee/loobu/',
      noIndex: true,
    })
    const queryToken = new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
    if (!isSupabaseConfigured || !uuidPattern.test(queryToken)) {
      setState('invalid')
      return
    }
    setToken(queryToken)
  }, [])

  const unsubscribe = async () => {
    if (!uuidPattern.test(token)) return
    setState('loading')
    const { data, error } = await requireSupabase().rpc('unsubscribe_sales_outreach', { target_token: token })
    if (error) setState('error')
    else setState(data === true ? 'success' : 'invalid')
  }

  const content = state === 'idle'
    ? { eyebrow: 'Kirjadest loobumine', title: 'Kas loobud Poeruumi kirjadest?', body: 'Pärast kinnitamist lisame aadressi loobumisnimekirja ega saada sellele enam müügikirju.' }
    : state === 'loading'
      ? { eyebrow: 'Üks hetk', title: 'Kinnitan loobumist…', body: 'Palun oota, kuni salvestame sinu valiku.' }
    : state === 'success'
      ? { eyebrow: 'Valik salvestatud', title: 'Rohkem kirju ei tule', body: 'Aadress lisati Poeruumi loobumisnimekirja. Sama aadressi ei kasutata edaspidi müügikirjadeks.' }
      : state === 'invalid'
        ? { eyebrow: 'Link ei kehti', title: 'Loobumislinki ei leitud', body: 'Link võib olla vigane. Kirjuta meile aadressil info@poeruum.ee ja lisame aadressi käsitsi loobumisnimekirja.' }
        : { eyebrow: 'Ajutine tõrge', title: 'Valikut ei saanud salvestada', body: 'Proovi mõne hetke pärast uuesti või kirjuta aadressil info@poeruum.ee.' }

  return <main className="unsubscribe-page">
    <a className="unsubscribe-page__brand" href="/" aria-label="Poeruumi avaleht"><Brand /></a>
    <section>
      <div className={`unsubscribe-page__mark is-${state}`} aria-hidden="true">{state === 'success' ? '✓' : state === 'loading' ? '…' : '!'}</div>
      <span>{content.eyebrow}</span>
      <h1>{content.title}</h1>
      <p>{content.body}</p>
      {state === 'idle' && <button type="button" onClick={() => void unsubscribe()}>Jah, loobun kirjadest</button>}
      {state === 'error' && <button type="button" onClick={() => window.location.reload()}>Proovi uuesti</button>}
      <a href="/">Tagasi Poeruumi avalehele</a>
    </section>
    <footer>Animaator OÜ · info@poeruum.ee</footer>
  </main>
}
