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
        'Taevaseisude muutumine aitab valida päeva teema, kuid lugejale ei pea jutustama kogu päeva kulgu. Päeva alguse ja lõpu võrdlust kasuta kõige rohkem kahe märgi juures; ülejäänud tekstid keskendugu ühele olukorrale.',
        'Iga lõik keskendub ühele igapäevasele teemale, näiteks lähedastega suhtlemisele, kodustele tegemistele, koostööle või oma aja jagamisele. Ära loetle eluvaldkondi ega mõtle lugejale välja üksikasjalikku stseeni. Planeetide, aspektide ja majade nimetused jäävad lähteandmetesse; avalik tekst on nende eluline tõlgendus.',
        'Iga märgi kohta üks terviklik lõik, ligikaudu 140–300 tähemärki. Eelista lühikesi või keskmise pikkusega lauseid, kuid varieeri loomulikult lausearvu ja rütmi.',
        'Kirjuta soojas, rahulikus ja heatahtlikult nõuandvas toonis, loomulikus heas eesti keeles. Pöördu lugeja poole sina-vormis. Sõnasta tähelepanek selgelt ja lisa samast teemast lähtuv väike praktiline soovitus, kui see sobib.',
        'Praktiline soovitus peab nimetama teostatava tegevuse. Väldi häguseid väljendeid nagu „tee peas ruumi”, „vähenda müra” või „säti midagi enda sees paika”. Igal märgil olgu erinev olukord ja erinev tegevus.',
        'Pingelist võimalust käsitle taktitundeliselt: keskendu sellele, mida lugeja saab ise rahulikult teha. Väldi hirmutamist, saatuslikke lubadusi, ülepakutud optimismi ja käskivat tooni.',
        'Anna tekstidele erinevad lausealgused, ülesehitus ja lõpetused. Väldi kunstlikke nalju, otsitud võrdlusi, poeetilisi kujundeid ja puändiga minijutustusi. Ära alusta iga lõiku sõnaga „täna” ega kasuta kõigil märkidel sama ennustuse-ja-soovituse malli.',
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
