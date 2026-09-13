import { parseDailyHoroscope, zodiacSigns, type DailyHoroscope } from './horoscope.ts'
import { getHoroscopeSky } from './horoscope-sky.ts'

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
        'Kirjuta eestikeelne meelelahutuslik päevahoroskoop kõigile 12 tähemärgile, lähtudes sisendis arvutatud taevaseisudest.',
        'Vali iga märgi jaoks konkreetne tänane aspekt ja tõlgenda seda tema päikesemajade kaudu. Pelk maja üldteema või tähemärgi stereotüüp ei ole piisav alus.',
        'Päeva eripära otsi eeskätt Kuu liikumisest, märgivahetustest ja päeva jooksul muutuvatest aspektidest; aeglaste planeetide seisud on taust.',
        'Iga lõik arendab üht äratuntavat elulist olukorda või tabavat tähelepanekut. Ära loetle eluvaldkondi. Planeetide, aspektide ja majade nimetused jäävad lähteandmetesse; avalik tekst on nende eluline tõlgendus.',
        'Iga märgi kohta üks terviklik lõik, ligikaudu 140–300 tähemärki. Väljaandes peavad vahelduma nii lausearv kui ka rütm: üks pikk lause, mitu lühikest või nende loomulik kombinatsioon.',
        'Kirjuta loomulikus heas eesti keeles. Meeleolu ja huumor lähtuvad käsitletavast olukorrast.',
        'Anna tekstidele erinevad lausealgused, ülesehitus ja lõpetused. Ära kasuta läbivat ennustuse-ja-soovituse vormi, ühesuguseid vastandusi ega igas lõigus võrdlust või üleskutset.',
        'Iga märk peab saama oma vaatenurga; sama mõtte ümberütlemine teiste sõnadega ei ole piisav erinevus. Väldi klišeesid ja üldsõnalisi elutarkusi.',
        'Ära lisa pealkirju ega tähemärgi nime teksti.',
        'Ära kasuta emotikone, reklaami, ostusoovitusi, linke, tervise- ega finantsnõuandeid.',
        'Taevaseisude faktid võta ainult sisendist; ära mõtle juurde asendeid, aspekte ega sündmuste täpseid kellaaegu. Astroloogiline tõlgendus on mänguline, tulevikusündmused pole kindlad.',
      ].join(' '),
      input: JSON.stringify(getHoroscopeSky(date)),
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
