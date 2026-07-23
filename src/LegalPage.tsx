import { useEffect } from 'react'
import { Brand } from './DemoApp'
import './legal.css'

export type LegalDocument = 'terms' | 'privacy'

const EFFECTIVE_DATE = '23. juuli 2026'

function ProviderDetails() {
  return <aside className="legal-provider" aria-label="Teenuse osutaja andmed">
    <strong>Teenuse osutaja</strong>
    <dl>
      <div><dt>Teenuse nimi</dt><dd>Poeruum</dd></div>
      <div><dt>Ärinimi ja registrikood</dt><dd className="is-missing">Lisatakse enne teenuse avalikku avamist</dd></div>
      <div><dt>Aadress</dt><dd className="is-missing">Lisatakse enne teenuse avalikku avamist</dd></div>
      <div><dt>E-post</dt><dd><a href="mailto:mtammets@gmail.com">mtammets@gmail.com</a></dd></div>
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
      <p><strong>Paindlik:</strong> 0 € kuutasu ja netotasu 4% toodete müügisummalt, millele lisandub 24% käibemaks. Tasutav summa on seega 4,96% ning selle ülempiir on 48,36 € kuus (39 € netotasu + 9,36 € käibemaks). Tarne hind ei kuulu Poeruumi müügitasu arvestusse.</p>
      <p><strong>Kindel:</strong> esimesed 30 päeva tasuta, seejärel 35,96 € kuus (29 € netohind + 6,96 € käibemaks). Poeruumi müügitasu on 0%.</p>
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
      <h2>7. Teenuse toimimine ja muudatused</h2>
      <p>Poeruum võib teha hooldust, turvaparandusi ja teenuse arendamiseks vajalikke muudatusi. Katkestustest püütakse võimaluse korral ette teatada. Katkematut või veatut teenust ei garanteerita, kuid tõrkeid lahendatakse mõistliku aja jooksul.</p>
      <p>Olulistest tingimuste või tasude muudatustest teatatakse mõistliku aja ette e-posti või teenuse kaudu. Kui kasutaja muudatusega ei nõustu, saab ta teenuse enne muudatuse jõustumist lõpetada.</p>
    </section>

    <section>
      <h2>8. Konto piiramine ja lõpetamine</h2>
      <p>Kasutaja võib konto teenuses kustutada või paketi lõpetada. Enne kustutamist peab kasutaja eksportima talle vajalikud andmed ning lahendama täitmata tellimused ja maksekohustused.</p>
      <p>Poeruum võib teenust piirata või konto sulgeda, kui kasutaja rikub oluliselt tingimusi või seadust, ohustab teenuse turvalisust või jätab tasud maksmata. Kiiret sekkumist mittevajava rikkumise korral antakse võimalus rikkumine mõistliku aja jooksul kõrvaldada.</p>
    </section>

    <section>
      <h2>9. Vastutus</h2>
      <p>Kumbki pool vastutab enda põhjustatud otsese kahju eest seaduses lubatud ulatuses. Poeruum ei vastuta kaupmehe toodete, ostjaga sõlmitud müügilepingu, kasutaja sisestatud andmete ega kolmanda teenusepakkuja iseseisva tegevuse eest.</p>
      <p>Poeruumi koguvastutus on seaduses lubatud ulatuses piiratud summaga, mille kasutaja tasus Poeruumile kahju tekkimisele eelnenud 12 kuu jooksul. Piirang ei kehti tahtliku rikkumise ega muu vastutuse suhtes, mida seadus ei luba piirata.</p>
    </section>

    <section>
      <h2>10. Kohaldatav õigus</h2>
      <p>Tingimustele kohaldatakse Eesti õigust. Vaidlused püütakse esmalt lahendada läbirääkimiste teel. Kui kokkulepet ei saavutata, lahendab vaidluse Eesti pädev kohus.</p>
    </section>

    <section>
      <h2>11. Kontakt</h2>
      <p>Tingimuste, arvelduse või teenuse kohta saab kirjutada aadressil <a href="mailto:mtammets@gmail.com">mtammets@gmail.com</a>. Sisselogitud kasutaja saab pöörduda ka Poeruumi tugikeskuse kaudu.</p>
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
      <p>Konto- ja poeandmeid säilitatakse konto kasutamise ajal ning need kustutatakse konto kustutamisel, välja arvatud andmed, mida tuleb hoida seaduse, poolelioleva tehingu või õigusnõude tõttu. Raamatupidamise algdokumente säilitatakse seaduses nõutud aja jooksul.</p>
      <p>Tellimuse säilitamisaja määrab eelkõige vastav müüja. Tugivestlust säilitatakse konto eluea jooksul või kuni selle varasem kustutamine ei kahjusta poolelioleva pöördumise lahendamist. Turva- ja vealoge hoitakse ainult nii kaua, kui on vaja turvalisuse ja tõrkeotsingu eesmärgil. Teenusepakkujate varukoopiad kustuvad nende tavapärase varundustsükli jooksul.</p>
    </section>

    <section>
      <h2>7. Küpsised ja kohalik salvestus</h2>
      <p>Poeruum kasutab sisselogimise, turvalisuse, ostukorvi ja kasutaja valikute säilitamiseks hädavajalikku brauseri salvestusruumi ning teenusepakkujate tehnilisi küpsiseid. Hädavajalik salvestus ei vaja nõusolekut. Kui lisame analüütika- või turundusküpsised, küsime enne nende kasutamist eraldi nõusoleku.</p>
    </section>

    <section>
      <h2>8. Inimese õigused</h2>
      <p>Inimesel on tingimuste täitumisel õigus küsida juurdepääsu oma andmetele ja nende parandamist, kustutamist, töötlemise piiramist või andmete ülekandmist ning esitada vastuväide õigustatud huvil põhinevale töötlemisele. Nõusoleku saab alati tagasi võtta, ilma et see muudaks varasema töötlemise õigusvastaseks.</p>
      <p>Taotluse saab saata aadressile <a href="mailto:mtammets@gmail.com">mtammets@gmail.com</a>. Vastame üldjuhul ühe kuu jooksul ja võime enne vastamist paluda isikusamasust kinnitada. Samuti on õigus esitada kaebus <a href="https://www.aki.ee" target="_blank" rel="noreferrer">Andmekaitse Inspektsioonile</a>.</p>
      <p>Poe tellimust puudutava taotlusega tuleks esmalt pöörduda poe müüja poole. Poeruum aitab müüjal taotlust tehniliselt täita.</p>
    </section>

    <section>
      <h2>9. Turvalisus ja automaatsed otsused</h2>
      <p>Rakendame ligipääsukontrolli, krüpteeritud ühendusi, andmebaasi reaõigusi, varundamist ja muid mõistlikke tehnilisi ning korralduslikke meetmeid. Ükski süsteem ei ole täiesti riskivaba; intsidendi korral tegutseme seaduses ette nähtud korras.</p>
      <p>Poeruum ei tee isiku kohta üksnes automatiseeritud töötlemisel põhinevaid otsuseid, millel on talle õiguslik või samaväärselt oluline mõju.</p>
    </section>

    <section>
      <h2>10. Muudatused ja kontakt</h2>
      <p>Poliitikat ajakohastatakse, kui teenus või õigusnõuded muutuvad. Olulisest muudatusest teatatakse teenuses või e-posti teel. Küsimuste ja taotluste jaoks kirjuta aadressil <a href="mailto:mtammets@gmail.com">mtammets@gmail.com</a>.</p>
    </section>
  </>
}

export default function LegalPage({ document }: { document: LegalDocument }) {
  const isTerms = document === 'terms'

  useEffect(() => {
    const previousTitle = window.document.title
    window.document.title = `${isTerms ? 'Kasutustingimused' : 'Privaatsuspoliitika'} — Poeruum`
    window.scrollTo(0, 0)
    return () => { window.document.title = previousTitle }
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
