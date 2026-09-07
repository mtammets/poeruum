import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateDailyHoroscope } from '../_shared/horoscope-generation.ts'
import { nextHoroscopeDate, tallinnDate } from '../_shared/horoscope.ts'
import { captureEdgeError } from '../_shared/security.ts'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('ONBOARDING_CRON_SECRET')?.trim()
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401)

  try {
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const apiKey = requiredEnv('OPENAI_API_KEY')
    // Prepare tomorrow as well, so the next edition is ready at Tallinn midnight.
    const today = tallinnDate()
    const dates = [today, nextHoroscopeDate(today)]
    let generated = 0
    for (const date of new Set(dates)) {
      const { data: token, error: claimError } = await admin.rpc('claim_daily_horoscope', { edition_date: date })
      if (claimError) throw claimError
      if (!token) continue
      try {
        const horoscope = await generateDailyHoroscope(apiKey, date, Deno.env.get('OPENAI_HOROSCOPE_MODEL')?.trim() || undefined)
        const { error } = await admin.from('daily_horoscopes').update({
          entries: horoscope.entries, generated_at: new Date().toISOString(), claim_token: null, claim_expires_at: null,
        }).eq('date', date).eq('claim_token', token)
        if (error) throw error
        generated += 1
      } catch (error) {
        await admin.from('daily_horoscopes').update({ claim_token: null, claim_expires_at: null })
          .eq('date', date).eq('claim_token', token)
        throw error
      }
    }
    return json({ generated })
  } catch (error) {
    await captureEdgeError('daily-horoscope', error)
    return json({ error: 'Horoskoobi loomine ebaõnnestus.' }, 500)
  }
})
