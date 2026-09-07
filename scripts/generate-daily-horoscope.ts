/* global Deno */
import { generateDailyHoroscope } from '../supabase/functions/_shared/horoscope-generation.ts'
import { tallinnDate } from '../supabase/functions/_shared/horoscope.ts'

const key = Deno.env.get('OPENAI_API_KEY')?.trim()
if (!key) throw new Error('Puudub OPENAI_API_KEY.')
const horoscope = await generateDailyHoroscope(key, tallinnDate(), Deno.env.get('OPENAI_HOROSCOPE_MODEL')?.trim() || undefined)
await Deno.mkdir('public/data', { recursive: true })
await Deno.writeTextFile('public/data/daily-horoscope.json', `${JSON.stringify(horoscope, null, 2)}\n`)
console.log(`Valmis ${horoscope.date}: ${Object.keys(horoscope.entries).length} tähemärki.`)
