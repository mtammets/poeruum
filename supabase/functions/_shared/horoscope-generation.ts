import { parseDailyHoroscope, zodiacSigns, type DailyHoroscope } from './horoscope.ts'

export async function generateDailyHoroscope(apiKey: string, date: string, model = 'gpt-5.4'): Promise<DailyHoroscope> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 4500,
      instructions: [
        'Kirjuta Poeruumi Kaubamajale eestikeelne meelelahutuslik päevahoroskoop.',
        'Iga tähemärgi tekst on täpselt kaks loomulikku lauset, kokku 140–260 tähemärki.',
        'Toon on soe, tähelepanelik ja kergelt humoorikas. Väldi tõlkekeelt ja klišeesid.',
        'Vali igale märgile üks konkreetne argine olukord: näiteks vestlus sõbraga, pooleli jäänud mõte või meeldiv vaheldus.',
        'Kirjuta lihtsas heas eesti keeles. Väldi abstraktseid sõnu nagu energia, tasakaal, loomingulisus ja enesekindlus.',
        'Näide soovitud stiilist: Üks pooleli jäänud mõte võib täna lõpuks paika loksuda. Räägi sellest kellelegi, kes oskab õigel hetkel hea küsimuse küsida.',
        'Anna igale tähemärgile oma mõte; ära korda lausealguseid. Ära lisa pealkirju ega tähemärgi nime teksti.',
        'Ära kasuta emotikone, reklaami, ostusoovitusi, linke, tervise- ega finantsnõuandeid.',
        'Ära väida tegelikke planeetide asendeid ega kindlaid tulevikusündmusi. Kirjuta mängulisi võimalusi.',
      ].join(' '),
      input: `Kuupäev Eestis: ${date}. Tähemärgid: ${zodiacSigns.map((sign) => `${sign.id} = ${sign.name}`).join(', ')}.`,
      text: { format: {
        type: 'json_schema', name: 'daily_horoscope', strict: true,
        schema: {
          type: 'object', additionalProperties: false,
          properties: Object.fromEntries(zodiacSigns.map((sign) => [sign.id, { type: 'string' }])),
          required: zodiacSigns.map((sign) => sign.id),
        },
      } },
    }),
  })
  if (!response.ok) throw new Error(`Horoscope generation returned HTTP ${response.status}.`)
  const result = await response.json()
  if (result.status !== 'completed') throw new Error('Horoscope generation did not complete.')
  const text = (result.output ?? []).filter((item: { type: string }) => item.type === 'message')
    .flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
    .filter((item: { type: string }) => item.type === 'output_text')
    .map((item: { text: string }) => item.text).join('')
  const horoscope = parseDailyHoroscope({ date, entries: JSON.parse(text) }, date)
  if (!horoscope) throw new Error('Horoscope generation returned invalid entries.')
  return horoscope
}
