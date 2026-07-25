import { useEffect } from 'react'
import { Brand } from './Brand'
import { applySeoMetadata } from './lib/seo'
import {
  FIXED_PLAN_MONTHLY_FEE,
  FIXED_PLAN_MONTHLY_TOTAL,
  FIXED_PLAN_MONTHLY_VAT,
  formatPricingEuro,
  formatPricingPercent,
  PLATFORM_FEE_GROSS_CAP,
  PLATFORM_FEE_NET_CAP,
  PLATFORM_FEE_RATE,
  VAT_RATE,
} from './storefrontConfig'
import './legal.css'

export type LegalDocument = 'terms' | 'privacy'

const EFFECTIVE_DATE = '25. juuli 2026'
const PROVIDER = {
  name: 'Animaator OÜ',
  registryCode: '17135632',
  address: 'Alle, Pudisoo küla, Kuusalu vald, Harju maakond 74626, Eesti',
  email: 'info@animaator.ee',
} as const

function ProviderDetails() {
  return <aside className="legal-provider" aria-label="Teenuse osutaja andmed">
    <strong>Teenuse osutaja</strong>
    <dl>
      <div><dt>Teenuse nimi</dt><dd>Poeruum</dd></div>
      <div><dt>Ärinimi</dt><dd>{PROVIDER.name}</dd></div>
      <div><dt>Registrikood</dt><dd>{PROVIDER.registryCode}</dd></div>
      <div><dt>Aadress</dt><dd>{PROVIDER.address}</dd></div>
      <div><dt>E-post</dt><dd><a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a></dd></div>
    </dl>
  </aside>
}

function Terms() {
  return <>
    <header className="legal-hero">
      <span>Kasutustingimused</span>
      <h1>Poeruumi teenuse<br />kasutamise tingimused</h1>
      <p>Need tingimused reguleerivad Poeruumi e-poeplatvormi kasutamist kaupmehe ja Poeruumi vahel.</p>
      <small>Kehtivad alates {EFFECTIVE_DATE}</small>
    </header>

    <ProviderDetails />

    <section>
      <h2>1. Tingimuste ulatus</h2>
      <p>Poeruum on ettevõtjale mõeldud veebiteenus e-poe loomiseks, avaldamiseks ja haldamiseks. Konto loomisel või poe avaldamisel kinnitab kasutaja, et on tingimused läbi lugenud ja nendega nõus.</p>
      <p>Poeruum ei ole kaupmehe poes müüdavate toodete müüja ega ostja ja kaupmehe vahel sõlmitava müügilepingu pool. Poe omanik müüb oma nimel ning vastutab toodete, hindade, maksude, tarne, tagastuste, pretensioonide ja tarbijale esitatava teabe eest.</p>
    </section>

    <section>
      <h2>2. Konto ja kasutaja vastutus</h2>
      <p>Kasutaja esitab õiged ning ajakohased kontakt- ja ettevõtteandmed, hoiab oma sisselogimisandmed salajas ning teavitab Poeruumi võimalikust väärkasutusest. Konto toiminguid käsitatakse konto omaniku toimingutena, välja arvatud juhul, kui ta teatab volitamata kasutusest.</p>
      <p>Teenust ei tohi kasutada ebaseadusliku, eksitava, teiste õigusi rikkuva või tehniliselt kahjustava sisu ja tegevuse jaoks. Kasutajal peavad olema õigused kõigile üles laaditud tekstidele, fotodele, kaubamärkidele ja muule sisule.</p>
    </section>

    <section>
      <h2>3. Poe pidamine ja ostjad</h2>
      <p>Kaupmees määrab oma müügi- ja tagastustingimused ning avaldab poes nõutud müüjaandmed. Kaupmees vastutab tellimuste täitmise, klienditoe, toodete nõuetele vastavuse ja tarbija õiguste järgimise eest.</p>
      <p>Poeruum pakub tehnilist taristut tellimuste vastuvõtmiseks. Makseid töötleb Stripe ning tarneandmeid võivad töödelda kaupmehe valitud tarnepakkujad. Nende teenuste kasutamisele võivad lisanduda vastava pakkuja tingimused ja tasud.</p>
    </section>

    <section>
      <h2>4. Paketid ja tasud</h2>
      <p><strong>Paindlik:</strong> 0 € kuutasu ja netotasu {formatPricingPercent(PLATFORM_FEE_RATE)} toodete müügisummalt, millele lisandub 24% käibemaks. Tasutav summa on seega {formatPricingPercent(PLATFORM_FEE_RATE * (1 + VAT_RATE))} ning selle ülempiir on {formatPricingEuro(PLATFORM_FEE_NET_CAP)} + käibemaks ehk {formatPricingEuro(PLATFORM_FEE_GROSS_CAP)} kuus koos käibemaksuga. Tarne hind ei kuulu Poeruumi müügitasu arvestusse.</p>
      <p><strong>Kindel:</strong> esimesed 30 päeva tasuta, seejärel {formatPricingEuro(FIXED_PLAN_MONTHLY_FEE)} kuus + 24% käibemaks ehk kokku {formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} ({formatPricingEuro(FIXED_PLAN_MONTHLY_VAT)} käibemaks). Poeruumi müügitasu on 0%.</p>
      <p>Mõlemas paketis saab oma olemasoleva domeeni ühendada ilma Poeruumi lisatasuta. Domeeni registreerimise ja teenusepakkuja tasud maksab kasutaja ise. Maksevahendaja tehingutasud ei sisaldu Poeruumi hinnas.</p>
      <p>Jooksev hind, arveldusperiood ja kohaldatavad maksud kuvatakse enne tasulise paketi kinnitamist. Korduv tellimus kestab kuni tühistamiseni. Tühistamine jõustub arveldusvaates näidatud ajal ning juba alanud perioodi eest tasutud summat ei tagastata, välja arvatud juhul, kui seadus nõuab teisiti.</p>
    </section>

    <section>
      <h2>5. Maksekorraldus</h2>
      <p>Kasutaja volitab Stripe’i ja Poeruumi võtma paketi- ning platvormitasusid valitud makseviisilt või arvestama neid müügilaekumistest. Poeruum ei säilita täielikke maksekaardiandmeid. Stripe võib kasutajalt nõuda eraldi isikusamasuse ja ettevõtte kontrolli.</p>
    </section>

    <section>
      <h2>6. Kasutaja sisu</h2>
      <p>Sisu omandiõigus jääb kasutajale. Kasutaja annab Poeruumile teenuse osutamiseks vajaliku mitteainuõigusliku loa sisu majutada, töödelda, kuvada, kohandada tehnilisse vormingusse ja edastada. Luba lõpeb üldjuhul sisu või konto kustutamisel, arvestades varukoopiaid ja seadusest tulenevaid säilituskohustusi.</p>
    </section>

    <section>
      <h2>7. Andmetöötlus kaupmehe nimel</h2>
      <p>Ostjate tellimusandmete puhul tegutseb Poeruum kaupmehe volitatud töötlejana. Töötlemise ese on e-poe tellimuste vastuvõtmine, makse- ja tarneoleku edastamine ning kaupmehele tellimuste haldamise võimaldamine teenuse kasutamise ajal. Töödeldakse ostja nime, kontakt-, tellimus-, makseoleku ja tarneandmeid ning nendega seotud tehnilisi tunnuseid.</p>
      <p>Poeruum töötleb neid andmeid üksnes kaupmehe dokumenteeritud juhiste ja käesolevate tingimuste alusel, tagab andmetele ligi pääsevate isikute konfidentsiaalsuse, rakendab asjakohaseid turvameetmeid ning aitab mõistlikus ulatuses täita andmesubjekti taotlusi, turvaintsidendi kohustusi ja mõjuhinnanguid. Poeruum teeb nõuete täitmise tõendamiseks vajaliku teabe kättesaadavaks ja lubab põhjendatud ulatuses auditit, kaitstes seejuures teiste klientide andmeid ja teenuse turvalisust.</p>
      <p>Kaupmees annab üldise loa kasutada privaatsuspoliitikas nimetatud alamtöötlejaid. Olulisest uuest alamtöötlejast teatatakse enne selle kasutuselevõttu ning põhjendatud andmekaitsealase vastuväite korral otsivad pooled sobiva lahenduse. Poeruum kohustab alamtöötlejaid kaitsma andmeid vähemalt samaväärselt. Teenuse lõppemisel kustutatakse või anonüümitakse kaupmehe nimel töödeldavad isikuandmed vastavalt privaatsuspoliitika säilitustähtaegadele, välja arvatud juhul, kui säilitamine on seadusest tulenevalt vajalik.</p>
    </section>

    <section>
      <h2>8. Teenuse toimimine ja muudatused</h2>
      <p>Poeruum võib teha hooldust, turvaparandusi ja teenuse arendamiseks vajalikke muudatusi. Katkestustest püütakse võimaluse korral ette teatada. Katkematut või veatut teenust ei garanteerita, kuid tõrkeid lahendatakse mõistliku aja jooksul.</p>
      <p>Olulistest tingimuste või tasude muudatustest teatatakse mõistliku aja ette e-posti või teenuse kaudu. Kui kasutaja muudatusega ei nõustu, saab ta teenuse enne muudatuse jõustumist lõpetada.</p>
    </section>

    <section>
      <h2>9. Konto piiramine ja lõpetamine</h2>
      <p>Kasutaja võib konto teenuses kustutada või paketi lõpetada. Enne kustutamist peab kasutaja eksportima talle vajalikud andmed ning lahendama täitmata tellimused ja maksekohustused.</p>
      <p>Konto kustutamisel lõpetatakse aktiivne Poeruumi kuupakett, eemaldatakse poe sisu ja failid ning anonüümitakse tellimustes olevad ostja kontakt- ja tarneandmed. Seadusest tuleneva säilituskohustuse täitmiseks vajalikud isikustamata finantskirjed säilivad privaatsuspoliitikas kirjeldatud tähtaja lõpuni.</p>
      <p>Poeruum võib teenust piirata või konto sulgeda, kui kasutaja rikub oluliselt tingimusi või seadust, ohustab teenuse turvalisust või jätab tasud maksmata. Kiiret sekkumist mittevajava rikkumise korral antakse võimalus rikkumine mõistliku aja jooksul kõrvaldada.</p>
    </section>

    <section>
      <h2>10. Vastutus</h2>
      <p>Kumbki pool vastutab enda põhjustatud otsese kahju eest seaduses lubatud ulatuses. Poeruum ei vastuta kaupmehe toodete, ostjaga sõlmitud müügilepingu, kasutaja sisestatud andmete ega kolmanda teenusepakkuja iseseisva tegevuse eest.</p>
      <p>Poeruumi koguvastutus on seaduses lubatud ulatuses piiratud summaga, mille kasutaja tasus Poeruumile kahju tekkimisele eelnenud 12 kuu jooksul. Piirang ei kehti tahtliku rikkumise ega muu vastutuse suhtes, mida seadus ei luba piirata.</p>
    </section>

    <section>
      <h2>11. Kohaldatav õigus</h2>
      <p>Tingimustele kohaldatakse Eesti õigust. Vaidlused püütakse esmalt lahendada läbirääkimiste teel. Kui kokkulepet ei saavutata, lahendab vaidluse Eesti pädev kohus.</p>
    </section>

    <section>
      <h2>12. Kontakt</h2>
      <p>Tingimuste, arvelduse või teenuse kohta saab kirjutada aadressil <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>. Sisselogitud kasutaja saab pöörduda ka Poeruumi tugikeskuse kaudu.</p>
    </section>
  </>
}

function Privacy() {
  return <>
    <header className="legal-hero">
      <span>Privaatsuspoliitika</span>
      <h1>Kuidas Poeruum<br />isikuandmeid kasutab</h1>
      <p>Siin selgitame, milliseid andmeid Poeruum töötleb, miks seda teeb ja millised õigused on inimesel.</p>
      <small>Kehtib alates {EFFECTIVE_DATE}</small>
    </header>

    <ProviderDetails />

    <section>
      <h2>1. Kes andmete eest vastutab?</h2>
      <p>Poeruumi konto, teenuse kasutamise, arvelduse, toe ja turvalisusega seotud andmete vastutav töötleja on Poeruumi teenuse osutaja.</p>
      <p>Kui inimene teeb Poeruumi abil loodud poes tellimuse, on tellimuse ja müügilepingu andmete vastutav töötleja vastava poe müüja. Müüja andmed leiab poe jalusest. Poeruum töötleb neid andmeid müüja nimel platvormi pakkujana; makseteenuse pakkuja võib oma kohustuste täitmisel olla eraldi vastutav töötleja.</p>
    </section>

    <section>
      <h2>2. Milliseid andmeid töödeldakse?</h2>
      <ul>
        <li><strong>Kontoandmed:</strong> e-post, autentimis- ja sessiooniandmed ning konto olek. Parooli haldab Supabase Auth; Poeruum ei näe parooli avatekstina.</li>
        <li><strong>Kaupmehe andmed:</strong> nimi, ärinimi, registrikood, aadress, kontaktid, poe seaded, domeenid, tooted, pildid, hinnad, laoseis ja tarnevalikud.</li>
        <li><strong>Arveldus- ja makseandmed:</strong> valitud pakett, arvelduse olek, summad ning Stripe’i kliendi-, konto-, tellimuse ja tehingu tunnused. Täielikke kaardiandmeid töötleb Stripe.</li>
        <li><strong>Tellimuse andmed:</strong> ostja nimi ja kontaktandmed, tarne- või pakiautomaadi valik, aadress, ostukorv, summad ning tellimuse ja makse olek.</li>
        <li><strong>Toeandmed:</strong> tugivestlused, manused, vastused ning tõrke lahendamiseks vajalik lehe aadress ja brauseri tehniline teave.</li>
        <li><strong>Tehnilised andmed:</strong> IP-aadress, seadme ja brauseri andmed, ajatemplid, turva- ja vealogid ning DNS-i ja TLS-i kontrolli tulemused.</li>
      </ul>
    </section>

    <section>
      <h2>3. Eesmärgid ja õiguslikud alused</h2>
      <ul>
        <li><strong>Lepingu täitmine:</strong> konto ja poe loomine, majutamine, tellimuste edastamine, maksete ja pakettide haldus, domeeni ühendamine ning kasutajatugi.</li>
        <li><strong>Seadusest tulenev kohustus:</strong> raamatupidamis-, maksu-, pettuse tõkestamise ja õigustatud päringute täitmine.</li>
        <li><strong>Õigustatud huvi:</strong> teenuse turvalisus, väärkasutuse ennetamine, tõrkeotsing, nõuete kaitsmine ning kasutajale teenusega seotud oluliste teadete saatmine. Enne töötlemist kaalutakse Poeruumi huvi ja inimese õigusi.</li>
        <li><strong>Nõusolek:</strong> ainult siis, kui küsime seda eraldi vabatahtliku funktsiooni, turunduse või mittevajaliku küpsise jaoks. Nõusoleku saab igal ajal tagasi võtta.</li>
      </ul>
    </section>

    <section>
      <h2>4. Kellele andmeid edastatakse?</h2>
      <p>Andmeid saavad vajalikus ulatuses poe müüja ning Poeruumi lepingulised teenusepakkujad:</p>
      <ul>
        <li>Supabase — andmebaas, autentimine, failid ja serverifunktsioonid;</li>
        <li>Render — veebimajutus, võrguühendus ja domeenide tehniline teenindamine;</li>
        <li>Stripe — maksed, väljamaksed, kaupmehe tuvastamine ja korduv arveldus;</li>
        <li>Resend — tehingulised e-kirjad ja tugisuhtlus;</li>
        <li>Cloudflare — Turnstile’i kuritarvitusevastane kontroll;</li>
        <li>valitud tarnepakkujad — tarnevalikute ja saadetiste korraldamine;</li>
        <li>ametlikud registrid ja aadressiteenused — ettevõtte- ja aadressiandmete kontrollimine.</li>
      </ul>
      <p>Andmeid võidakse avaldada ka audiitorile, õigusnõustajale või pädevale asutusele, kui see on vajalik nõude kaitsmiseks või tuleneb seadusest. Isikuandmeid ei müüda.</p>
    </section>

    <section>
      <h2>5. Andmete asukoht</h2>
      <p>Eelistame Euroopa Majanduspiirkonnas asuvaid teenuseid ja andmekeskusi. Kui teenusepakkuja töötleb andmeid väljaspool Euroopa Majanduspiirkonda, kasutatakse kohaldatava andmekaitseõiguse nõutud kaitsemehhanismi, näiteks Euroopa Komisjoni piisavusotsust või standardseid andmekaitseklausleid.</p>
    </section>

    <section>
      <h2>6. Säilitamine</h2>
      <ul>
        <li><strong>Konto ja poe sisu:</strong> säilivad konto kasutamise ajal ning kustutatakse konto kustutamisel. Tootepildid, kohandatud domeenid, autentimiskonto ja avatud tugisisu eemaldatakse kustutamistoimingu käigus.</li>
        <li><strong>Tellimused:</strong> säilivad kaheksa aastat tellimuse kuupäevast. See katab raamatupidamisdokumentide nõutud seitsmeaastase säilitamise ka juhul, kui kaupmehe majandusaasta ei ühti kalendriaastaga. Konto kustutamisel eemaldatakse tellimustest kohe ostja nimi, e-post ja tarneinfo; summad, kaubaread, makseolek ja tehingutunnused säilivad tähtaja lõpuni raamatupidamise ja nõuete kaitsmise eesmärgil.</li>
        <li><strong>Poeruumi finantskirjed:</strong> säilivad kaheksa aastat tehingu kuupäevast, et katta vähemalt seitse aastat vastava majandusaasta lõpust.</li>
        <li><strong>Tugipöördumised ja manused:</strong> kustutatakse konto kustutamisel või 24 kuud pärast pöördumise lahendamist, olenevalt sellest, kumb saabub varem.</li>
        <li><strong>Tehinguliste e-kirjade kättetoimetamislogid:</strong> kuni 90 päeva; konto omaniku aadressiga seotud logid kustutatakse konto kustutamisel.</li>
        <li><strong>Webhook’i duplikaadikaitse:</strong> Stripe’i tehnilised sündmusetunnused kuni 90 päeva ja Resendi sündmusetunnused kuni 30 päeva.</li>
        <li><strong>Aktiivsuse olek:</strong> kuni 24 tundi pärast viimast signaali.</li>
      </ul>
      <p>Kui andmeid on vaja kauem säilitada poolelioleva õigusnõude, ametliku päringu või muu seadusest tuleneva kohustuse tõttu, piiratakse nende kasutamine vastava eesmärgiga ja need kustutatakse vajaduse lõppemisel. Teenusepakkujate varukoopiad kustuvad nende tavapärase varundustsükli jooksul.</p>
    </section>

    <section>
      <h2>7. Küpsised ja kohalik salvestus</h2>
      <p>Poeruum kasutab sisselogimise, turvalisuse, ostukorvi ja kasutaja valikute säilitamiseks hädavajalikku brauseri salvestusruumi ning teenusepakkujate tehnilisi küpsiseid. Hädavajalik salvestus ei vaja nõusolekut. Kui lisame analüütika- või turundusküpsised, küsime enne nende kasutamist eraldi nõusoleku.</p>
    </section>

    <section>
      <h2>8. Inimese õigused</h2>
      <p>Inimesel on tingimuste täitumisel õigus küsida juurdepääsu oma andmetele ja nende parandamist, kustutamist, töötlemise piiramist või andmete ülekandmist ning esitada vastuväide õigustatud huvil põhinevale töötlemisele. Nõusoleku saab alati tagasi võtta, ilma et see muudaks varasema töötlemise õigusvastaseks.</p>
      <p>Taotluse saab saata aadressile <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>. Vastame üldjuhul ühe kuu jooksul ja võime enne vastamist paluda isikusamasust kinnitada. Samuti on õigus esitada kaebus <a href="https://www.aki.ee" target="_blank" rel="noreferrer">Andmekaitse Inspektsioonile</a>.</p>
      <p>Poe tellimust puudutava taotlusega tuleks esmalt pöörduda poe müüja poole. Poeruum aitab müüjal taotlust tehniliselt täita.</p>
    </section>

    <section>
      <h2>9. Turvalisus ja automaatsed otsused</h2>
      <p>Rakendame ligipääsukontrolli, krüpteeritud ühendusi, andmebaasi reaõigusi, varundamist ja muid mõistlikke tehnilisi ning korralduslikke meetmeid. Ükski süsteem ei ole täiesti riskivaba; intsidendi korral tegutseme seaduses ette nähtud korras.</p>
      <p>Poeruum ei tee isiku kohta üksnes automatiseeritud töötlemisel põhinevaid otsuseid, millel on talle õiguslik või samaväärselt oluline mõju.</p>
    </section>

    <section>
      <h2>10. Muudatused ja kontakt</h2>
      <p>Poliitikat ajakohastatakse, kui teenus või õigusnõuded muutuvad. Olulisest muudatusest teatatakse teenuses või e-posti teel. Küsimuste ja taotluste jaoks kirjuta aadressil <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>.</p>
    </section>
  </>
}

export default function LegalPage({ document }: { document: LegalDocument }) {
  const isTerms = document === 'terms'

  useEffect(() => {
    applySeoMetadata({
      title: `${isTerms ? 'Kasutustingimused' : 'Privaatsuspoliitika'} — Poeruum`,
      description: isTerms
        ? 'Poeruumi e-poeplatvormi kasutamise tingimused kaupmehele.'
        : 'Kuidas Poeruum kaupmeeste ja ostjate isikuandmeid töötleb ning kaitseb.',
      canonicalUrl: `https://poeruum.ee/${isTerms ? 'kasutustingimused' : 'privaatsus'}/`,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `${isTerms ? 'Kasutustingimused' : 'Privaatsuspoliitika'} — Poeruum`,
        url: `https://poeruum.ee/${isTerms ? 'kasutustingimused' : 'privaatsus'}/`,
        isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: 'https://poeruum.ee/' },
        publisher: {
          '@type': 'Organization',
          name: PROVIDER.name,
          identifier: PROVIDER.registryCode,
          email: PROVIDER.email,
          address: PROVIDER.address,
        },
      },
    })
    window.scrollTo(0, 0)
  }, [isTerms])

  return <div className="legal-page">
    <header className="legal-nav">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <nav aria-label="Õigusdokumendid">
        <a className={isTerms ? 'is-active' : ''} href="/kasutustingimused">Kasutustingimused</a>
        <a className={!isTerms ? 'is-active' : ''} href="/privaatsus">Privaatsus</a>
      </nav>
    </header>
    <main className="legal-content">
      {isTerms ? <Terms /> : <Privacy />}
    </main>
    <footer className="legal-footer">
      <a href="/">← Tagasi Poeruumi</a>
      <span>© 2026 Poeruum</span>
    </footer>
  </div>
}
