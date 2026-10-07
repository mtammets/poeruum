import { useEffect, type ReactNode } from 'react'
import { Brand } from './Brand'
import { applySeoMetadata } from './lib/seo'
import { PLATFORM_BUSINESS as PROVIDER } from '../shared/platform-business.mjs'
import {
  FIXED_PLAN_MONTHLY_FEE,
  FIXED_PLAN_MONTHLY_TOTAL,
  FIXED_PLAN_TRIAL_DAYS,
  formatPricingEuro,
  formatPricingPercent,
  PLATFORM_FEE_GROSS_CAP,
  PLATFORM_FEE_NET_CAP,
  PLATFORM_FEE_RATE,
  VAT_RATE,
} from './storefrontConfig'
import './legal.css'

export type LegalDocument = 'terms' | 'privacy'

const DOCUMENT_VERSION = '2026-10-01'
const DOCUMENT_DATE = '1. oktoober 2026'

type Section = { id: string; title: string; content: ReactNode }
const Contact = () => <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>

function ProviderDetails() {
  return <aside className="legal-provider" aria-label="Teenuse osutaja andmed">
    <strong>Teenuse osutaja ja kontakt</strong>
    <dl>
      <div><dt>Teenuse nimi</dt><dd>Poeruum</dd></div>
      <div><dt>Ärinimi</dt><dd>{PROVIDER.name}</dd></div>
      <div><dt>Registrikood</dt><dd>{PROVIDER.registryCode}</dd></div>
      <div><dt>KMKR number</dt><dd>{PROVIDER.vatNumber}</dd></div>
      <div><dt>Aadress</dt><dd>{PROVIDER.address}</dd></div>
      <div><dt>E-post</dt><dd><Contact /></dd></div>
    </dl>
  </aside>
}

function DocumentContent({ label, title, introduction, summary, sections }: {
  label: string; title: ReactNode; introduction: string; summary: ReactNode; sections: Section[]
}) {
  return <>
    <header className="legal-hero">
      <span>{label}</span>
      <h1>{title}</h1>
      <p>{introduction}</p>
      <div className="legal-document-meta">
        <small>Uuendatud <time dateTime={DOCUMENT_VERSION}>{DOCUMENT_DATE}</time> · versioon {DOCUMENT_VERSION}</small>
        <button type="button" onClick={() => window.print()}>Prindi / salvesta PDF</button>
      </div>
    </header>
    <aside className="legal-summary" aria-label="Dokumendi lühiülevaade">{summary}</aside>
    <ProviderDetails />
    <nav className="legal-toc" aria-label="Sisukord">
      <h2>Sisukord</h2>
      <ol>{sections.map(({ id, title }) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}</ol>
    </nav>
    {sections.map(({ id, title, content }, index) => <section id={id} key={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{index + 1}. {title}</h2>
      {content}
    </section>)}
  </>
}

function Terms() {
  const sections: Section[] = [
    { id: 'teenus', title: 'Teenuse ulatus ja lepingu pooled', content: <>
      <p>Poeruum on e-poe loomise ja haldamise teenus, mida osutab Animaator OÜ (edaspidi Poeruum). Kaupmees on teenust oma majandus- või kutsetegevuses kasutav ettevõtja või ettevõtluskontoga füüsiline isik. Kasutaja on kaupmehe nimel tegutsev füüsiline isik. Ostja on kaupmehe poes tellimuse esitaja.</p>
      <p>Need tingimused reguleerivad Poeruumi ja kaupmehe vahelist teenuslepingut. Lepingu osaks on allpool esitatud andmetöötluse kokkulepe. Isikuandmete kasutamist selgitavad <a href="/privaatsus">privaatsustingimused</a>; nendega tutvumine ei ole nõusolek turunduseks ega kõigiks andmetöötlustoiminguteks.</p>
      <p>Poeruum pakub poe majutust, toote- ja tellimushaldust, makseliidest, arveldust ning poodide avastamiseks Kaubamaja. Kauba müügilepingu sõlmivad ostja ja poes nimetatud kaupmees. Poeruum ei ole kauba müüja, tootja ega vedaja. See rollijaotus ei välista Poeruumi vastutust oma teenuse ja seadusest tulenevate kohustuste eest.</p>
      <p>Poeruumi sirvimiseks ei ole vaja kaupmehe kontot. Kaubamaja külastajale on asjakohased sisu kasutamise, keelatud tegevuste, rikkumisest teatamise ja privaatsuse sätted. Kaupmehe pakettide tasud ei kohaldu poe ostjale.</p>
    </> },
    { id: 'konto', title: 'Konto loomine ja lepingu sõlmimine', content: <>
      <p>Konto looja peab olema vähemalt 18-aastane ja tal peab olema õigus kaupmeest esindada. Teenusleping sõlmitakse konto registreerimisel kasutustingimustega nõustumisega. Tasuline pakett aktiveeritakse eraldi kinnituse ja maksete seadistamise järel.</p>
      <p>Kaupmees esitab õiged müüja-, kontakt- ja maksuandmed ning hoiab need ajakohased. Konto e-posti aadress peab toimima, sest sinna saadetakse lepingu, maksete ja turvalisusega seotud teated. Ajutise meiliteenuse aadressiga saab poe seadistamist proovida; poe avaldamiseks ning maksete ühendamiseks või seadistamise jätkamiseks tuleb kinnitada püsiv e-posti aadress. Isiklik e-post ja püsiv privaatsusaliase aadress sobivad samuti. Vajaduse korral võib Poeruum küsida esindusõiguse või andmete õigsuse tõendamist.</p>
      <p>Kasutaja hoiab sisselogimisandmeid turvaliselt ja teatab kahtlustatavast volitamata kasutusest viivitamata aadressil <Contact />. Konto kaudu tehtud toimingute eest vastutatakse vastavalt rikkumise asjaoludele ja kohaldatavale õigusele.</p>
    </> },
    { id: 'kaupmees', title: 'Kaupmehe kohustused ja ostjate õigused', content: <>
      <p>Kaupmees vastutab toodete õiguspärasuse, ohutuse, kirjelduse, hinna, laoseisu, maksude, tellimuste täitmise ja kliendisuhtluse eest. Enne müügi alustamist avaldab ta nõutud müüjaandmed, müügi- ja tarnetingimused, taganemis- ja pretensioonide esitamise korra ning oma isikuandmete töötlemise teabe.</p>
      <p>Poeruumi pakutud väljad ja näidistekstid tuleb kohandada kaupmehe tegeliku tegevusega. Poeruumi kasutus- ja privaatsustingimused ei asenda kaupmehe enda müügitingimusi ega andmekaitseteavitust.</p>
      <p>Tarbijale müümisel tuleb järgida kohustuslikke tarbijakaitsenõudeid, sealhulgas üldjuhul 14-päevast taganemisõigust, seaduslikke erandeid ja puudusega kauba suhtes kehtivaid õigusi. Eritellimuse või muu erandi olemasolu peab kaupmees hindama konkreetse toote järgi; pelgalt käsitööna valmistamine ei välista taganemisõigust.</p>
      <p>Kaupmees volitab Poeruumi koostama, säilitama ja edastama tema nimel tellimuste arveid ja kreeditarveid ning ettevõtluskontoga eraisiku puhul müügi- ja tagastustõendeid. Kaupmees kontrollib dokumentide õigsust ning vastutab oma raamatupidamise, deklareerimise ja säilitamiskohustuse eest. Praegune poe maksuarvestus toetab Eesti standardmääraga müüki ja käibemaksukohustuslasena registreerimata müüjat; erirežiimide või muude määrade sobivus tuleb enne kasutamist eraldi üle kontrollida.</p>
    </> },
    { id: 'hinnad', title: 'Paketid, tasud ja prooviperiood', content: <>
      <p><strong>Paindlik:</strong> kuutasu ei ole. Poeruumi teenustasu on {formatPricingPercent(PLATFORM_FEE_RATE)} toodete müügisummalt, millele lisandub {formatPricingPercent(VAT_RATE)} käibemaks. Kokku on tasu {formatPricingPercent(PLATFORM_FEE_RATE * (1 + VAT_RATE))} toodete müügisummalt. Tasu ülempiir poe kohta kalendrikuus on {formatPricingEuro(PLATFORM_FEE_NET_CAP)} ilma käibemaksuta ehk {formatPricingEuro(PLATFORM_FEE_GROSS_CAP)} koos käibemaksuga. Tarnetasu ei kuulu müügitasu arvestusse. Kuupiiri arvestatakse Eesti aja järgi. Müügi puudumisel Poeruumi müügitasu ei teki.</p>
      <p><strong>Kindel:</strong> uue prooviperioodi kestus on {FIXED_PLAN_TRIAL_DAYS} päeva. Seejärel on kuutasu {formatPricingEuro(FIXED_PLAN_MONTHLY_FEE)}, millele lisandub {formatPricingPercent(VAT_RATE)} käibemaks, kokku {formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} kuus. Poeruumi müügitasu on 0%. Varem kasutatud prooviperioodi paketi uuesti aktiveerimisel ei korrata.</p>
      <p>Prooviperioodi algus ja esimese makse kuupäev sõltuvad paketi aktiveerimisest ning kuvatakse kinnitamisel. Prooviperioodi lõppedes algab korduv tasuline arveldus, kui kaupmees ei ole paketti enne tühistanud. Pakettide vahetamise jõustumise aeg kuvatakse arveldusvaates.</p>
      <p>Stripe’i maksetöötlustasud ning kaupmehe domeeni registreerimise ja tarnepakkuja tasud lisanduvad eraldi. Olemasoleva domeeni ühendamise eest Poeruum lisatasu ei küsi. Kõik hinnad on eurodes. Konkreetse tellimuse hind ja makseperiood esitatakse enne kinnitamist.</p>
      <p><strong>Käibemaks:</strong> Animaator OÜ on Eestis registreeritud käibemaksukohustuslane alates <time dateTime={PROVIDER.vatRegistrationDate}>1. oktoobrist 2026</time> (KMKR number {PROVIDER.vatNumber}). Sellest kuupäevast lisandub Poeruumi teenustasudele Eesti standardmääraga käibemaks, praegu {formatPricingPercent(VAT_RATE)}. Eespool on eraldi näidatud tasud ilma käibemaksuta ja koos käibemaksuga. Poeruumi enda maksustaatus ei määra kaupmehe poes müüdava kauba maksustamist.</p>
      <p>Kehtiv pakettide hinnakiri asub <a href="/#hind">Poeruumi hinnavaates</a>. Tellimise kinnitus näitab tasutavat kogusummat ja arveldusperioodi. Hinna või kohaldatava maksumäära muutusest teavitatakse tingimuste muutmise korra järgi, arvestades seadusest tulenevaid nõudeid.</p>
    </> },
    { id: 'arveldus', title: 'Maksed, tagasimaksed ja paketi lõpetamine', content: <>
      <p>Poeruumi müügitasu arved ja kreeditarved väljastatakse elektrooniliselt ning on allalaaditavad poe arveldusvaatest. Kindla paketi kuutasu arved on kättesaadavad sama vaate kaudu Stripe’i arveldusportaalis. Kaupmees nõustub arvete sellise kättesaadavaks tegemisega.</p>
      <p>Makseid töötleb Stripe oma teenusetingimuste kohaselt. Kaupmees volitab Poeruumi korraldama kokkulepitud platvormitasude mahaarvamist müügilaekumistest ja kuutasu võtmist valitud makseviisilt. Stripe võib küsida ettevõtte, esindaja ja tegeliku kasusaaja andmeid ning piirata makseid või väljamakseid oma kontrollide või seadusest tulenevate nõuete tõttu.</p>
      <p>Kindla paketi korduv tellimus kestab tühistamiseni. Selle saab lõpetada poe arveldusvaates; lõpetamine jõustub üldjuhul käimasoleva prooviperioodi või tasutud arveldusperioodi lõpus. Pärast seda saab jätkata Paindliku paketiga. Alanud perioodi tasu üldjuhul osaliselt ei tagastata, välja arvatud seadusest tuleneva õiguse, Poeruumi rikkumise või eraldi kokkuleppe korral.</p>
      <p>Kindla paketi makse ebaõnnestumisel on makse parandamiseks seitse päeva armuaega, mille jooksul kehtib endiselt 0% Poeruumi müügitasu. Lahenduseta makse korral lõpeb Kindel pakett, tasumata kuuarve tühistatakse ja pood läheb Paindlikule paketile. Pood jääb avalikuks; müügitasu arvestatakse pärast armuaja lõppu tehtud uutelt müükidelt.</p>
      <p>Ostja tagasimakse ja maksevaidluse lahendab kaupmees. Poeruumi tellimushaldus võimaldab Stripe’iga tasutud tellimuse täielikku tagasimakset. Tagasimakse mõju maksetöötlustasudele ja väljamaksetele sõltub Stripe’i tingimustest ning tehingu seisust. Arveldusveast tuleb teatada <Contact /> ja lisada tehingu või arve tunnus.</p>
    </> },
    { id: 'sisu', title: 'Sisu, intellektuaalomand ja lubatud kasutus', content: <>
      <p>Kaupmehe tekstide, piltide, kaubamärkide ja muu sisu õigused jäävad õiguste omajale. Kaupmees annab Poeruumile mitteainuõigusliku tasuta loa sisu majutada, varundada, tehniliselt kohandada ning kuvada tema poes, Kaubamajas ja Poeruumi avalehe poe-eelvaadetes. Luba hõlmab selleks vajalikku edastamist teenusepakkujatele ega anna õigust müüa kaupmehe sisu eraldiseisva tootena.</p>
      <p>Sisu avaldamisel tuleb arvestada, et avalikke poelehti ja tootepilte võivad näha, jagada ning indekseerida ka kolmandad isikud ja otsingumootorid. Konfidentsiaalseid dokumente ega tellimuste isikuandmeid ei tohi lisada avalikele tootepiltidele või poe kirjeldusse.</p>
      <p>Keelatud on ebaseaduslike või võltsitud kaupade müük, eksitav teave, teiste isikute õiguste rikkumine, pahavara, loata juurdepääs, pettused ja teenuse tahtlik ülekoormamine. Kaupmees järgib ka oma makse- ja tarnepakkuja kasutuspiiranguid.</p>
      <p>Poeruumi tarkvara, kujunduse ja kaubamärgi õigused kuuluvad Poeruumile või tema litsentsiandjatele. Kaupmees saab lepingu ajaks õiguse kasutada teenust selle otstarbe kohaselt. Sisu kasutamise luba lõpeb sisu eemaldamisel või lepingu lõppemisel, välja arvatud piiratud säilitamine dokumentide, varukoopiate ja õigusnõuete jaoks.</p>
    </> },
    { id: 'kaubamaja', title: 'Kaubamaja ja poodide nähtavus', content: <>
      <p>Avaldatud pood ja selle avalikud tooted võivad ilmuda Kaubamajas, Poeruumi avalehel ning otsingumootorites. Kataloogi nähtavust ja esiletõsteid mõjutavad poe avaldamise olek, kataloogi seaded, sobiva pildi ja tooteandmete olemasolu ning Poeruumi toimetuslik valik. Kindlat külastuste, müügi või nähtavuse mahtu ei lubata.</p>
      <p>Kaubamaja poodide järjekorda saab Poeruum käsitsi muuta; tootevalikutes kasutatakse ka juhuslikku järjestust. Otsingus on peamine tegur päringu vastavus poe või toote nimele, seejärel kirjeldusele: täpne nimevaste on eespool osalist vastet. Võrdse sobivuse korral säilib kataloogi järjekord. Tulemusi ei isikupärastata ostja varasema ostuajaloo järgi.</p>
      <p>Paindliku või Kindla paketi valik ei anna tasulist eelisjärjestust. Poeruumi enda näidis- ja reklaamkaardid on tegelikest poodidest eristatavad ega kuulu tegelike toodete otsingutulemustesse. Kaupmees võib kasutada ka teisi müügikanaleid ja määrata seal oma hinnad.</p>
      <p>Kaupmees näeb oma poe tellimusi, arveldust ja teenuses kättesaadavaid poeandmeid. Poeruumil on teenuse osutamiseks, turvalisuseks ja arendamiseks vajalik ligipääs ning koondstatistika. Teiste kaupmeeste mitteavalikele kliendi- või müügiandmetele kaupmees ligipääsu ei saa.</p>
    </> },
    { id: 'tehisintellekt', title: 'Tehisintellekti abil loodud sisu', content: <>
      <p>Tootekirjelduse genereerimine on vabatahtlik abifunktsioon. Selle käivitamisel saadetakse valitud tootepilt, toote nimi ja olemasolev kirjeldus OpenAI teenusele. Ära sisesta sinna ostjate andmeid, eriliigilisi isikuandmeid, ärisaladusi ega materjali, mille edastamiseks sul õigust ei ole.</p>
      <p>Genereeritud tekst on mustand: enne avaldamist kontrollib kaupmees fakte, toote omadusi, ohutusväiteid ja teiste isikute õigusi. Tehisintellekt võib eksida ega taga teksti ainulaadsust või õiguskaitset. Poe tootekirjelduse eest vastutab kaupmees sõltumata selle koostamise viisist.</p>
      <p>Kaubamaja horoskoop on üldine meelelahutussisu. See ei ole isiklik nõustamine ega alus tervise-, õigus- või finantsotsustele.</p>
    </> },
    { id: 'andmetootlus', title: 'Andmetöötluse kokkulepe kaupmehega', content: <>
      <p>See punkt on Poeruumi ja kaupmehe vaheline isikuandmete kaitse üldmääruse artikli 28 kohane kokkulepe. Kaupmees on oma ostjate andmete vastutav töötleja; Poeruum on tema juhiste järgi tegutsev volitatud töötleja. Poeruumi enda konto-, arveldus-, turva- ja tugitegevuse puhul on Poeruum eraldi vastutav töötleja.</p>
      <h3>Töötlemise ulatus ja juhised</h3>
      <p>Töötlemine hõlmab ostjate ja nende esindajate nime, e-posti, telefoninumbrit, tarne- ja arveandmeid, ettevõtteandmeid, tellimuse sisu, makseolekut ning tehingutunnuseid. Toimingud on andmete kogumine, salvestamine, korrastamine, edastamine, dokumentide koostamine, pärimine ja kustutamine. Eesmärk on tellimuste, maksete, tarneinfo ja müügidokumentide haldamine lepingu kestel ning kokkulepitud arhiiviperioodil.</p>
      <p>Dokumenteeritud juhisteks on see leping, kaupmehe seadistused ja õiguspärased kirjalikud korraldused. Kaupmees tagab andmete kogumise õigusliku aluse, ostjate teavitamise ja juhiste seaduslikkuse. Poeruum ei kasuta kaupmehe ostjate andmeid oma otseturunduseks ega teiste kaupmeeste huvides.</p>
      <p>Kui juhis rikub Poeruumi hinnangul andmekaitseõigust, teavitab Poeruum kaupmeest viivitamata ja võib vastava toimingu selgitamiseni peatada. Seadusega nõutud juhistest erinevast töötlemisest teavitatakse kaupmeest enne toimingut, kui seadus seda ei keela.</p>
      <h3>Turvalisus ja abistamine</h3>
      <p>Poeruum piirab ligipääsu tööülesannetest lähtudes, kohustab andmetele ligi pääsevaid isikuid konfidentsiaalsusele ning rakendab riskile vastavaid tehnilisi ja korralduslikke turvameetmeid. Nende hulka kuuluvad krüpteeritud ühendused, autentimine, poodide andmete ligipääsupiirangud, privaatne tellimusdokumentide hoidla, turvalogimine ning teenuse taastamise meetmed.</p>
      <p>Poeruum teavitab kaupmeest ostjate andmeid puudutavast isikuandmetega seotud rikkumisest põhjendamatu viivituseta pärast sellest teadasaamist. Teates esitatakse teadaolev rikkumise laad, mõjutatud andmed, võimalikud tagajärjed, rakendatud või kavandatud meetmed ja kontakt; puuduvat teavet täiendatakse järk-järgult.</p>
      <p>Poeruum aitab töötlemise laadi ja kättesaadavat teavet arvestades täita inimeste õiguste taotlusi, turvakohustusi, rikkumisteavitusi, mõjuhinnanguid ja eelnevaid konsultatsioone. Kaupmehe nimel saadud taotlus edastatakse kaupmehele. Poeruum annab nõuete täitmise tõendamiseks vajalikku teavet ning võimaldab kaupmehe või sõltumatu audiitori põhjendatud auditit, kaitstes teiste klientide andmeid ja turvalisust. Erakorralise lisatöö tingimused lepitakse vajaduse korral eelnevalt kokku.</p>
      <h3>Alamtöötlejad ja rahvusvaheline edastamine</h3>
      <p>Kaupmees annab üldise loa kasutada <a href="/privaatsus#teenusepakkujad">privaatsustingimustes kirjeldatud teenusepakkujaid</a> ulatuses, milles nad töötlevad kaupmehe andmeid Poeruumi nimel. Stripe’i ja teiste iseseisvate vastutavate töötlejate enda tegevusele kohaldatakse nende tingimusi. Vabatahtliku tehisintellektifunktsiooni pakkuja kaasatakse selle funktsiooni kasutamisel.</p>
      <p>Uue alamtöötleja lisamisest või asendamisest teatab Poeruum kaupmehele e-posti teel vähemalt 30 päeva ette, et kaupmees saaks esitada põhjendatud andmekaitsealase vastuväite. Lahendamata vastuväite korral võib kaupmees mõjutatud teenuse enne muudatust lõpetada. Poeruum seab alamtöötlejale samaväärsed andmekaitsekohustused ja vastutab tema kohustuste täitmise eest. Väljapoole Euroopa Majanduspiirkonda edastamisel tuleb tagada üldmääruse V peatükis nõutud kaitse.</p>
      <h3>Andmete tagastamine ja kustutamine</h3>
      <p>Teenuse lõppemisel tagastab või kustutab Poeruum kaupmehe valikul tema nimel töödeldavad isikuandmed ja olemasolevad koopiad, välja arvatud õigusaktiga nõutud säilitamine. Andmete tagastamiseks kirjuta enne konto kustutamist <Contact />; olemasolevad arved saab alla laadida tellimuste vaatest.</p>
      <p>Teenuse tavapärane tellimuste ja müügidokumentide arhiivimine on kirjeldatud <a href="/privaatsus#sailitamine">säilitamistingimustes</a>. Kaupmehe nimel säilitamise juhis ja Poeruumi enda seadusest tulenev säilitamiskohustus on eraldi alused. Kui kaupmees soovib arhiivi üle võtta või juhist muuta, lepitakse vajalik tagastamine ja õiguspärane kustutamine eraldi kokku. Säilitatud andmete kasutus piiratakse säilitamise eesmärgiga.</p>
    </> },
    { id: 'toimimine', title: 'Teenuse toimimine ja kasutajatugi', content: <>
      <p>Poeruum hooldab ja arendab teenust ning lahendab teatatud tõrkeid nende mõju arvestades. Planeeritud olulistest katkestustest antakse võimaluse korral ette teada. Eraldi kokkuleppeta ei lubata kindlat käideldavusprotsenti, katkematut toimimist ega kindla aja jooksul vastamist.</p>
      <p>Kaupmees hoolitseb oma internetiühenduse ja seadmete eest ning säilitab oluliste äridokumentide koopiad. Kolmanda isiku makse-, domeeni- või tarneteenuse tõrked võivad mõjutada poe kasutamist. Poeruum aitab oma liidese piires tõrget lahendada.</p>
      <p>Kasutajatugi on kättesaadav teenuse tugikeskuses ja aadressil <Contact />. Makse- ja kontoandmeid või paroole ei tohi saata avalikku kanalisse.</p>
    </> },
    { id: 'rikkumisteated', title: 'Ebaseaduslikust sisust teatamine ja otsuste vaidlustamine', content: <>
      <p>Ebaseaduslikust tootest, sisust, õiguste rikkumisest või turvaohust saab teatada aadressil <Contact />. Lisa täpne poe või toote veebiaadress, rikkumise põhjendus, võimalusel tõendid ja vastamiseks kontakt. Kinnita, et esitatud teave on sinu parima teadmise järgi õige ja täielik.</p>
      <p>Poeruum hindab teadet hoolikalt ja proportsionaalselt ning võib küsida selgitusi. Meetmed võivad hõlmata parandamisnõuet, konkreetse sisu eemaldamist, nähtavuse piiramist, poe peatamist või lepingu lõpetamist. Teavitame teatajat ja mõjutatud kaupmeest otsusest ning selle põhjustest, kui teavitamine on lubatud.</p>
      <p>Piirangu või muu teenusega seotud otsuse läbivaatamist saab tasuta taotleda samal e-posti aadressil, lisades otsuse tunnuse või kirjelduse ja vastuväite põhjenduse. Pöördumise vaatab läbi inimene. Õigus pöörduda kohtusse või pädeva asutuse poole säilib.</p>
    </> },
    { id: 'lopetamine', title: 'Lepingu lõpetamine ja konto kustutamine', content: <>
      <p>Kaupmees võib tasulise paketi tühistada arveldusvaates või teenuslepingu lõpetamiseks konto kustutada. Paketi tühistamine ja konto kustutamine on erinevad toimingud. Enne konto kustutamist tuleb lahendada pooleliolevad tellimused ja maksevaidlused ning laadida alla vajalikud dokumendid või taotleda andmete väljastamist.</p>
      <p>Konto kustutamine lõpetab aktiivse Poeruumi kuupaketi ja ligipääsu haldusele, eemaldab poe avalikkusest, poe sisu, tootefailid ning domeeniühenduse. Tellimuse töövaatest eemaldatakse ostja kontakt- ja tarneandmed. Väljastatud arved, kreeditarved, nende alusandmed ja seotud säilitatavad kirjed võivad endiselt sisaldada isikuandmeid; konto kustutamine ei tähenda nende täielikku anonüümimist.</p>
      <p>Stripe’i iseseisvad säilitamiskohustused ning lõpetamata väljamaksed või vaidlused võivad takistada Stripe’i konto kohest sulgemist. Kaupmehe eraldiseisev Stripe’i konto võib jääda alles. Kustutamistoimingu tõrke korral tuleb pöörduda kasutajatoe poole. Pärast konto sulgemist saab säilitatud andmeid puudutava põhjendatud taotluse esitada <Contact />.</p>
      <p>Poeruum võib lõpetada teenuse olulise või korduva rikkumise, ebaseadusliku tegevuse või teenuse turvalisuse ohustamise korral. Parandatava rikkumise puhul antakse üldjuhul võimalus see kõrvaldada. Kogu teenussuhte lõpetamisest teatatakse koos põhjustega üldjuhul vähemalt 30 päeva ette. Viivitamatu piiramine või lõpetamine on lubatud seadusest tuleneva kohustuse, tõsise turvaohu või muu seadusega lubatud erandi korral; põhjustest teavitatakse niipea, kui see on lubatud.</p>
      <p>Vähemalt 180 päeva kasutamata, mitte kunagi avaldatud tühja poomustandi võib eemaldada, kui sellel pole tooteid, makseühendust, tasulist paketti, kohandatud domeeni, tellimusi ega finantskirjeid. Vähemalt seitse päeva varem saadetakse e-posti teade. Sisselogimine või seadistamise jätkamine tühistab eemaldamise ning kasutajakonto jääb alles.</p>
      <p>Kinnitamata e-postiga registreerumise eemaldame pärast seitset päeva, kui kontole pole sisse logitud ning puuduvad pood ja muud seotud kasutajaandmed. Kinnitatud või kasutatud kontosid see reegel ei puuduta.</p>
      <p>Lepingu lõppemine ei kaota varem tekkinud makse-, konfidentsiaalsus-, andmekaitse- ega ostjate ees võetud kohustusi.</p>
    </> },
    { id: 'vastutus', title: 'Vastutuse jaotus', content: <>
      <p>Pooled vastutavad oma lepingurikkumise eest kohaldatava õiguse järgi. Kaupmees vastutab oma toodete ja müügilepingute eest; Poeruum vastutab oma platvormiteenuse eest. Poeruum ei anna kaupmehe müügitulemuste, otsingumootorite positsiooni ega kolmandate teenuste iseseisvate otsuste kohta garantiid.</p>
      <p>Seaduses lubatud ulatuses ei hüvita Poeruum saamata jäänud tulu ega kaudset kahju. Poeruumi lepingulise vastutuse kogupiir on kaupmehe poolt kahju põhjustanud sündmusele eelnenud 12 kuu jooksul Poeruumile tasutud teenustasude summa.</p>
      <p>Piirangud ei kehti tahtluse, raske hooletuse, elu või tervise kahjustamise ega vastutuse suhtes, mida seadus ei luba piirata. Need ei piira inimese seadusest tulenevaid andmekaitseõigusi ega õigust nõuda isikuandmete kaitse rikkumisega tekitatud kahju hüvitamist.</p>
    </> },
    { id: 'muudatused', title: 'Tingimuste ja hindade muutmine', content: <>
      <p>Poeruum võib tingimusi muuta teenuse arendamise, õiguse muutumise, turvalisuse või põhjendatud ärikorraldusliku vajaduse tõttu. Kaupmehe õigusi, kohustusi või tasusid mõjutavast muudatusest teatatakse e-posti teel vähemalt 30 päeva ette; olulist kohanemist nõudva muudatuse korral antakse pikem mõistlik tähtaeg.</p>
      <p>Lühemat tähtaega kasutatakse ainult kohaldatava õigusega lubatud juhul, näiteks vältimatu õigusliku kohustuse või vahetu turvaohu kõrvaldamiseks. Muudatusi ei kohaldata tagasiulatuvalt juba täidetud tehingutele. Hinnamuudatuse jõustumise kuupäev ja mõju jooksvale paketile esitatakse teates.</p>
      <p>Kaupmees võib muudatusega mittenõustumisel lepingu enne muudatuse jõustumist lõpetada. Selle dokumendi kuupäev tähistab versiooni: olemasolevale kaupmehele jõustuvad muudatused talle edastatud teates märgitud korras. Dokumendi saab printida või salvestada PDF-ina.</p>
    </> },
    { id: 'vaidlused', title: 'Kohaldatav õigus ja kontakt', content: <>
      <p>Lepingule kohaldatakse Eesti õigust, arvestades kohustuslikke Euroopa Liidu õigusnorme. Vaidluse korral pöördutakse esmalt <Contact /> ja püütakse saavutada kokkulepe. Kokkuleppe puudumisel lahendab vaidluse seaduse järgi pädev kohus. Ühe sätte kehtetus ei muuda ülejäänud lepingut kehtetuks.</p>
      <p>Teenuse, andmekaitse ja ebaseadusliku sisu teadete kontakt on <Contact />. Samal aadressil saavad ühendust võtta pädevad asutused. Suhtluskeel on eesti keel; vastu võetakse ka ingliskeelseid pöördumisi.</p>
    </> },
  ]
  return <DocumentContent label="Kasutustingimused" title={<>Poeruumi teenuse<br />kasutamise tingimused</>}
    introduction="Kokkulepe Poeruumi ja kaupmehe vahel: teenuse kasutamine, tasud, vastutus ning ostjate andmete töötlemine."
    summary={<><strong>Enne alustamist</strong><p>Sina müüd oma poes kaupu ja vastutad ostja ees. Poeruum pakub poe toimimiseks platvormi. Siit leiad ka paketi lõpetamise, andmete tagastamise ja otsuste vaidlustamise korra.</p></>}
    sections={sections} />
}

function Privacy() {
  const sections: Section[] = [
    { id: 'vastutaja', title: 'Kellele tingimused kehtivad ja kes vastutab?', content: <>
      <p>Need tingimused kirjeldavad Poeruumi veebilehe, Kaubamaja, kaupmehe konto, kasutajatoe ja seotud teenuste andmetöötlust. Poeruumi enda tegevuse eest vastutab Animaator OÜ. Andmekaitseküsimuste ja taotluste kontakt on <Contact />.</p>
      <p>Poeruum on vastutav töötleja konto haldamisel, oma teenuse arveldamisel, kasutajatoe pakkumisel, teenuse turvalisuse tagamisel, kasutusstatistika kogumisel ja ettevõtetele suunatud kliendiotsingul.</p>
      <p><strong>Poe ostja jaoks on müüja eraldi vastutav töötleja.</strong> Tema otsustab tellimuse täitmise, tarne, raamatupidamise ja kliendisuhtluse eesmärgid. Poeruum töötleb tellimusandmeid tema nimel volitatud töötlejana. Müüja kontaktid leiab poe müüjaandmetest. See dokument ei asenda müüja enda privaatsustingimusi.</p>
      <p>Stripe töötleb makse-, isikusamasuse kontrolli ja õiguslike kohustustega seotud andmeid ka iseseisva vastutava töötlejana. Kaupmehe valitud vedajal ja teistel iseseisvatel teenusepakkujatel võivad olla oma privaatsustingimused.</p>
    </> },
    { id: 'andmed', title: 'Milliseid andmeid ja kust saame?', content: <>
      <ul>
        <li><strong>Konto ja kasutaja:</strong> e-posti aadress, konto tunnus, autentimis- ja sessiooniandmed, konto olek ning teenuse kasutamise aktiivsussignaalid. Paroolide autentimist korraldab Supabase Auth; paroole ei hoita Poeruumi tavapärastes kontoandmetes avatekstina.</li>
        <li><strong>Kaupmees ja avalik pood:</strong> ettevõtte või ettevõtluskontoga müüja nimi, ettevõtte registrikood ja käibemaksuandmed, müüja aadress, kontaktid, domeenid, poe seaded, tekstid, tooted, hinnad, laoseis ja pildid. Andmed pärinevad kasutajalt ning ettevõtteandmete otsingul e-äriregistrist. Ettevõtluskontoga eraisiku isikutuvastuse ja pangakonto andmed kogub Stripe oma vormil; neid ei avaldata poes ega ostudokumentidel.</li>
        <li><strong>Arveldus:</strong> pakett, arveldusperiood, summad, makseolek ning Stripe’i kliendi-, konto-, tellimuse ja tehingutunnused. Poeruum ei säilita täielikku maksekaardinumbrit ega kaardi turvakoodi.</li>
        <li><strong>Ost ja müügidokumendid:</strong> ostja nimi, e-post, telefoninumber, ostukorv, tarnevalik ja -aadress, pakiautomaat, tellimuse ja makseolek ning arve jaoks esitatud nimi, aadress ja ettevõtteandmed. Andmed saadakse ostjalt, kaupmehelt ja makse oleku kohta Stripe’ilt.</li>
        <li><strong>Kasutajatugi:</strong> pöördumise ja vastuste sisu, kontaktandmed, manused ning tõrke lahendamiseks vajalik lehe aadress ja tehniline teave. Andmed saadakse pöördujalt ja teenuse kasutamisel.</li>
        <li><strong>Tehnilised andmed:</strong> IP-aadress, brauseri ja seadme andmed, päringu aeg, turva- ja vealogid ning domeeni ühendamise kontrollid. Neid töötleb päringu teenindamisel ka võrgu- või majutusteenuse pakkuja.</li>
        <li><strong>Ettevõttekontaktid:</strong> ettevõtte avalik nimi, registrikood, tegevusala, veebileht, üld- või brändipostkast, allikas ning kirja saatmise, kättetoimetamise, vastuse ja loobumise olek. Allikaks on e-äriregistri avalikud andmed.</li>
      </ul>
      <p>Vormi kohustuslike andmeteta ei saa luua kontot, töödelda makset või täita tellimust. Vabatahtlikud väljad ja abifunktsioonid ei ole teenuse põhifunktsioonide kasutamise eelduseks. Ära lisa tooteandmetesse, tugimanustesse ega tehisintellekti päringusse kõrvaliste inimeste andmeid või tundlikku teavet, mida toimingu jaoks vaja ei ole.</p>
    </> },
    { id: 'eesmargid', title: 'Milleks ja millisel alusel andmeid kasutame?', content: <>
      <ul>
        <li><strong>Teenuse osutamine:</strong> konto, poe, paketi ja toe haldamine. Kui inimene on ise lepingupool, on aluseks lepingu täitmine või tema taotlusel lepingueelsed toimingud (IKÜM art 6 lg 1 p b). Ettevõtte esindaja andmete puhul on aluseks õigustatud huvi ettevõttega sõlmitud lepingut täita ja temaga suhelda (p f).</li>
        <li><strong>Raamatupidamine ja asutuste seaduslikud nõuded:</strong> Poeruumi enda dokumentide säilitamise ja avaldamise alus on kohaldatav seadusest tulenev kohustus (p c). Kaupmehe müügidokumente töötleme tema juhiste järgi, mitte Poeruumi üldise raamatupidamiskohustuse ettekäändel.</li>
        <li><strong>Turvalisus ja nõuete kaitsmine:</strong> pettuste, rünnete ja väärkasutuse ennetamine, tõrkeotsing ning nõuete esitamine ja kaitsmine põhinevad õigustatud huvil kaitsta teenust, kasutajaid ja vara (p f).</li>
        <li><strong>Kasutusstatistika:</strong> eesmärk on mõista lehe ja kataloogi kasutamist ning parandada nende toimimist. Lähtume õigustatud huvist (p f), piirame kogutavaid tunnuseid ja säilitamisaega ega koosta kontoga seotud reklaamiprofiile.</li>
        <li><strong>Ettevõtetele suunatud tutvustuskirjad:</strong> juriidilise isiku kontaktandmeid kasutatakse elektroonilise side seaduse otseturustusreegleid järgides. Kui kontakt sisaldab siiski isikuandmeid, hinnatakse lisaks õigustatud huvi (p f); avalikust allikast pärinemine ei asenda õiguslikku alust.</li>
        <li><strong>Eraldi nõusolek:</strong> kui mõni vabatahtlik töötlus vajab nõusolekut (p a), küsime selle konkreetse eesmärgi jaoks eraldi. Nõusoleku saab tagasi võtta. Kasutustingimustega nõustumine ei anna automaatselt turundusnõusolekut.</li>
      </ul>
      <p>Õigustatud huvi kasutamisel tuleb hinnata vajadust ja mõju inimese õigustele. Selle hindamise kohta saab küsida selgitusi ja esitada vastuväite <Contact />. Konto-, turva-, arveldus- ja seadistamisteated võivad olla teenuse osutamiseks vajalikud ka turundusest loobumise järel.</p>
    </> },
    { id: 'avalikkus', title: 'Poe avalikud andmed ja ligipääs', content: <>
      <p>Avaldatud poe müüjaandmed, kontaktid, tooted, pildid ja kirjeldused on avalikud. Neid võidakse kuvada Kaubamajas ja Poeruumi avalehe poe-eelvaadetes ning otsingumootorite tulemustes. Avaliku pildilingi saanud isik võib pilti vaadata; toote pildihoidla ei sobi privaatsete dokumentide jaoks.</p>
      <p>Tellimused, ostjate kontaktandmed, tugipöördumised ja arved ei ole avaliku kataloogi osa. Ligipääs on vastaval kaupmehel ning ülesande täitmiseks vajalikel Poeruumi töötajatel ja teenusepakkujatel. Ostjale saadetud tellimuse või dokumendi ligipääsulinki tuleb hoida privaatsena.</p>
      <p>Avaliku poe eemaldamine ei kustuta automaatselt otsingumootori vahemälu või kellegi varem salvestatud koopiat. Sellise koopia eemaldamiseks võib olla vaja pöörduda ka vastava teenuse poole.</p>
    </> },
    { id: 'teenusepakkujad', title: 'Teenusepakkujad ja teised andmesaajad', content: <>
      <p>Jagame andmeid ainult vastava toimingu jaoks vajalikus ulatuses. Teenusepakkuja roll sõltub konkreetsest toimingust: kõik allpool nimetatud osapooled ei ole kaupmehe andmete alamtöötlejad.</p>
      <ul>
        <li><strong>Supabase:</strong> konto autentimine, andmebaas, tootepildid, privaatsed dokumendid, tugimanused ja serverifunktsioonid. Töötleb vastavate funktsioonide jaoks salvestatud konto-, poe-, tellimus- ja tehnilisi andmeid.</li>
        <li><strong>Render:</strong> veebimajutus ja domeenide teenindamine; töötleb veebipäringute tehnilisi andmeid ning lehe edastamiseks vajalikke andmeid.</li>
        <li><strong>Stripe:</strong> ostjate maksed, kaupmehe väljamaksed, isikusamasuse kontroll ja Poeruumi paketi arveldus; saab makse, tellimuse, arvelduskontakti ja ühendatud müüja andmeid. Oma kontrollide ja seadusest tulenevate kohustuste puhul tegutseb iseseisvalt. Vt <a href="https://stripe.com/privacy">Stripe’i privaatsustingimusi</a>.</li>
        <li><strong>Resend:</strong> konto-, tellimus-, arve-, teenuse- ja tutvustuskirjade saatmine ning tugikirjade vastuvõtmine. Töötleb adressaati, kirja sisu ja manuseid ning kättetoimetamise andmeid.</li>
        <li><strong>OpenAI:</strong> kasutaja käivitatud tootekirjelduse koostamine valitud pildi, nime ja olemasoleva kirjelduse põhjal. Ostjate tellimusi selle funktsiooni jaoks ei saadeta. Üldise horoskoobi koostamiseks ei kasutata külastaja isiklikke andmeid.</li>
        <li><strong>Cloudflare Turnstile:</strong> sisselogimise ja teiste kaitstud toimingute kuritarvitusevastane kontroll; töötleb IP-aadressi, brauseri ja seadme signaale ning kontrolli tulemust.</li>
        <li><strong>Google Fonts:</strong> veebifontide laadimisel saab Google tehnilise päringu, sealhulgas IP-aadressi ja brauseri päringuandmed.</li>
        <li><strong>E-äriregister ning Maa- ja Ruumiameti aadressiteenus:</strong> ettevõtte või aadressi otsingu kasutamisel edastatakse vastav otsingusisend ja päringu tehnilised andmed.</li>
        <li><strong>Tarnepakkujad ja välise sisu pakkujad:</strong> näiteks Omniva pakiautomaatide loendi ning DPD ja SmartPosti logode laadimisel saab vastav veebiteenus päringu tehnilised andmed. Saadetise vormistamiseks vajalike ostjaandmete edastamise korraldab kaupmees vastavalt valitud tarneviisile.</li>
      </ul>
      <p>Vajaduse korral saavad andmeid nõuete kaitsmiseks audiitorid ja õigusnõustajad või seadusliku aluse olemasolul pädevad asutused. Isikuandmeid ei müüda. Kaupmehe andmete alamtöötlejate muutmise kord on <a href="/kasutustingimused#andmetootlus">andmetöötluse kokkuleppes</a>.</p>
    </> },
    { id: 'edastamine', title: 'Rahvusvaheline andmeedastus', content: <>
      <p>Poeruum kasutab rahvusvahelisi teenusepakkujaid. Andmete majutamine, tugiteenused ja tehniline töötlemine võivad hõlmata riike väljaspool Euroopa Majanduspiirkonda, sealhulgas Ameerika Ühendriike. Euroopa andmekeskuse kasutamine üksi ei välista ligipääsu teistest riikidest.</p>
      <p>Selline edastamine eeldab kohaldatavat kaitsemehhanismi: Euroopa Komisjoni piisavusotsust või standardseid andmekaitseklausleid koos vajaliku riskihindamise ja lisameetmetega. ELi–USA andmekaitseraamistikule saab tugineda üksnes juhul, kui konkreetne saaja on kehtivalt sertifitseeritud ja töötlemine kuulub sertifikaadi ulatusse.</p>
      <p>Konkreetse teenuse andmetöötluskohtade, saajate ja kaitsemeetmete ning asjakohaste tagatiste koopia kohta saab küsida <Contact />. Teiste klientide konfidentsiaalsed andmed ja ärisaladused vajaduse korral eemaldatakse.</p>
    </> },
    { id: 'sailitamine', title: 'Kui kaua andmeid säilitame?', content: <>
      <p>Säilitamisaeg sõltub andmete eesmärgist. Allpool on Poeruumi rakenduses kasutatavad tähtajad ja kriteeriumid. Teenusepakkujate enda logidele, varukoopiatele ja iseseisvatele seaduslikele kohustustele võivad kehtida eraldi tähtajad.</p>
      <ul>
        <li><strong>Konto ja poe sisu:</strong> konto kasutamise ajal; kustutamistaotluse täitmisel eemaldatakse konto, poe sisu, tootefailid, domeeniühendused ja kontoga seotud tugisisu. Tühja avaldamata poomustandi võib pärast 180 päeva tegevusetust ja vähemalt seitsmepäevast eelteadet eemaldada; autentimiskonto jääb siis alles.</li>
        <li><strong>Kinnitamata registreerumine:</strong> vähemalt seitse päeva registreerimisest. Kasutamata, poeta ja muude seotud kasutajaandmeteta kinnitamata konto eemaldatakse järgmise igapäevase puhastuse käigus.</li>
        <li><strong>Registreerumise turvaseire:</strong> registreerumiskatse aeg ja salajase soolaga IP-aadressist tuletatud räsi kuni 30 päeva. Algset IP-aadressi selles seiretabelis ei hoita; andmeid kasutatakse ebatavalise registreerumismahu märkamiseks.</li>
        <li><strong>Tellimused:</strong> rakenduse tavapärane arhiivitähtaeg on kaheksa aastat tellimuse kuupäevast. Kui seotud arve või kreeditarve väljastatakse hiljem, pikeneb seotud tellimuse säilitamine vähemalt kaheksa aastani dokumendi väljastamisest. Kaupmees peab hindama, milliseid andmeid ta oma raamatupidamiseks tegelikult vajab.</li>
        <li><strong>Arved ja kreeditarved:</strong> säilivad koos dokumendile kantud müüja- ja ostjaandmetega seotud tellimuse arhiivitähtaja lõpuni. Konto kustutamine eemaldab ostja kontakt- ja tarneandmed tellimuse töövaatest, kuid ei kustuta dokumente ega kõiki nende alusandmeid.</li>
        <li><strong>Tellimuskirjade sisu:</strong> tellimusega seotud saatmisjärjekorras võivad säilida adressaat ja kirja sisu kuni seotud tellimuse kustutamiseni. See on eraldi allpool nimetatud lühiajalisest kättetoimetamislogist.</li>
        <li><strong>Poeruumi finantskirjed:</strong> kaheksa aastat tehingust. Seaduslik säilitamiskohustus võib nõuda pikemat aega, näiteks erandliku majandusaasta või käimasoleva menetluse korral.</li>
        <li><strong>Tugipöördumised ja manused:</strong> konto kustutamiseni või 24 kuud pärast pöördumise lahendamist, olenevalt sellest, kumb saabub varem. Lahendamata pöördumist säilitatakse selle käsitlemise ajal.</li>
        <li><strong>E-kirjade kättetoimetamislogid:</strong> kuni 90 päeva; konto omaniku aadressiga seotud logid eemaldatakse konto kustutamisel. Stripe’i tehnilisi sündmusetunnuseid hoitakse kuni 90 päeva ja Resendi duplikaadikaitse tunnuseid kuni 30 päeva.</li>
        <li><strong>Ettevõtete kliendiotsing:</strong> saatmisjärjekorra kontakte hoitakse saatmise, loobumise või kliendiotsingu eesmärgi lõppemiseni. Ebaõnnestunud kontaktikirjed ja impordi tehnilised kirjed kustutatakse 90 päeva möödumisel vastavalt viimasest muutmisest või töö loomisest. Saadetud, vastatud, loobutud ja tagasipõrkunud kontaktide ajalugu hoitakse kuni 12 kuud viimasest tegevusest. Minimaalne loobumise või blokeerimise kirje säilib seni, kuni seda on vaja uue soovimatu kirja vältimiseks.</li>
        <li><strong>Avalehe statistika:</strong> kuni 90 päeva. Kaubamaja ja poe külastussündmusi säilitatakse 180 päeva ja poolelioleva Eesti kalendripäeva ulatuses.</li>
        <li><strong>Rakenduse veasündmused:</strong> kuni 30 päeva. Päringumahu piiramiseks hoitakse IP-aadressist või kasutajatunnusest tuletatud räsitud tunnust piiranguakna jooksul ning koristatakse aegunud loendurid. See tähtaeg ei kirjelda kõiki majutusteenuse võrgulogisid.</li>
        <li><strong>Konto aktiivsussignaalid:</strong> kuni 24 tundi viimasest signaalist.</li>
      </ul>
      <p>Tellimuste üldine arhiivitähtaeg ei tähenda, et iga üksik tellimuse andmeväli oleks seaduse järgi kaheksa aastat kohustuslik. Säilitamise vajalikkust ja võimalikku varasemat kustutamist saab kontrollida müüja kaudu või kirjutades <Contact />. Kui nõue või menetlus nõuab põhjendatult pikemat säilitamist, piiratakse andmete kasutus selle eesmärgiga.</p>
      <p>Varukoopiad võivad säilida teenusepakkuja varundustsükli lõpuni. Konto kustutamine ei tähenda, et kõik koopiad kaoksid kõigist teenustest samal hetkel. Varukoopiate kasutamisel tuleb arvestada varem esitatud kustutamisjuhiseid.</p>
    </> },
    { id: 'kupsised', title: 'Küpsised ja brauserisse salvestatavad valikud', content: <>
      <p>Kasutame sisselogimise, makse korduskatse ja kasutaja valikute toimimiseks küpsiseid ning brauseri kohalikku ja seansipõhist salvestust. Nõusoleku erand kehtib üksnes kasutaja soovitud teenuse jaoks vältimatult vajaliku salvestuse puhul, mitte automaatselt kõigi tehniliste tunnuste suhtes.</p>
      <div className="legal-table-wrap" role="region" aria-label="Brauseri salvestuse ülevaade" tabIndex={0}>
        <table className="legal-table">
          <caption>Poeruumi enda salvestus brauseris</caption>
          <thead><tr><th scope="col">Salvestus</th><th scope="col">Eesmärk ja kestus</th></tr></thead>
          <tbody>
            <tr><th scope="row">Sisselogimine</th><td>Supabase’i sessiooni küpsised kujul <code>sb-…-auth-token</code> ja nende osad võimaldavad kasutada kontot Poeruumi alamdomeenidel. Küpsise kestus on kuni 365 päeva viimasest uuendamisest; väljalogimine eemaldab sessiooni sisu. Väljalogimist tähistav tehniline marker võib alles jääda. Muul domeenil võib sessioon olla kohalikus salvestuses kuni väljalogimise või eemaldamiseni.</td></tr>
            <tr><th scope="row">Makse korduskatse</th><td><code>poeruum-checkout-attempt-v1</code> hoiab seansisalvestuses juhuslikku maksekatse tunnust ja sisendi räsi, et vältida korduvat tellimust. Säilib katse lõpetamise või brauseriseansi lõpuni; ostjaandmeid avatekstina sinna ei salvestata.</td></tr>
            <tr><th scope="row">Kaubamajja naasmine</th><td><code>poeruum:directory-return:…</code> säilitab brauseriseansi jooksul valiku näidata poes Kaubamajja naasmise linki.</td></tr>
            <tr><th scope="row">Kuva- ja tähemärgivalikud</th><td><code>autoSwipeEnabled</code>, <code>autoSwipeDelay</code>, <code>autoSwipeSpeed</code> ja <code>poeruum:horoscope-sign</code> säilitavad tootevaate või horoskoobi valiku kohalikus salvestuses kuni selle muutmise või brauserist eemaldamiseni. Neil ei ole automaatset aegumistähtaega.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Stripe ja Cloudflare võivad oma makse- ja turvafunktsioonide kasutamisel töödelda tehnilisi tunnuseid ning kasutada enda salvestust. Täpne koosseis sõltub kasutatavast funktsioonist ja nende seadistusest. Lisateave: <a href="https://stripe.com/cookie-settings">Stripe’i küpsised</a> ja <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’i privaatsustingimused</a>.</p>
      <p>Poeruumi avalehe, Kaubamaja ja poodide statistika ei kasuta püsivaid analüütikaküpsiseid ega brauseri kohalikku salvestust. Turundusküpsiste või muu nõusolekut vajava salvestuse lisamisel tuleb küsida eelnev eraldi nõusolek ja võimaldada selle tagasivõtmine.</p>
      <p>Salvestatud andmeid saab eemaldada brauseri veebisaidiandmete seadetest. Kõigi küpsiste blokeerimine võib takistada sisselogimist või maksefunktsiooni kasutamist. Privaatsustingimustega tutvumise märge ei ole küpsiste kasutamise nõusolek.</p>
    </> },
    { id: 'statistika', title: 'Kasutusstatistika ja automaatsed toimingud', content: <>
      <p>Avalehel kogume juhusliku lehesessiooni tunnusega lehe ja sektsiooni vaatamisi, konto loomise alustamist, näidispoe ja abiküsimuste avamist ning aktiivset kasutusaega kuni 30 minutit sessiooni kohta. Lisanduvad viitaja domeen, kampaaniamärgendid, üldine seadmeklass ning külastaja või kaupmehe kasutajarühm.</p>
      <p>Kaubamajas mõõdame poekaardi näitamist ja asukohta, poe- ja tootelingi avamist ning otsingu tulemuste arvu. <strong>Otsingu teksti statistikas ei salvestata.</strong> Mõlema vaate sündmustes jäetakse salvestamata täielik viitaja aadress ja IP-aadress; veebipäringu teenindamine võib siiski hõlmata tehnilist IP-töötlust.</p>
      <p>Poodides mõõdame külastusi ja tootevaatamisi juhusliku lehesessiooni tunnusega. Salvestame poe ja toote tunnuse, toote avaliku nime, sündmuse aja ning üldise liikluse allika (näiteks Kaubamaja või Google). Viitaja aadressi, kampaania teksti ja IP-aadressi statistikas ei salvestata. Sisselogitud kaupmeeste ja eelvaadete külastusi ei arvestata. Kaupmees saab vaadata ainult oma poe koondstatistikat, millele lisatakse tema tasutud tellimuste müüginäitajad.</p>
      <p>Juhuslik tunnus asub avatud lehe mälus ja kaob lehe uuesti laadimisel; Kaubamajas vahetub see ka 30-minutilise tegevusetuse või Eesti kuupäeva muutumise järel. Tunnust ei seota konto ega e-posti aadressiga. See ei tähenda, et kõik teenuse tehnilised logid oleksid anonüümsed.</p>
      <p>Automaatikat kasutatakse makseoleku uuendamisel, tasude arvutamisel, armuaja järel paketi vahetamisel, turvakontrollides ja ettevõttekontaktide valikul. Isiklikku krediidiskoori Poeruum ei koosta. Kui automaatne arveldus- või turvatoiming mõjutab sinu kontot, saad esitada selgitused ja paluda inimesel otsuse üle vaadata aadressil <Contact />. Stripe’i enda riskihindamist kirjeldavad tema tingimused.</p>
    </> },
    { id: 'ai', title: 'Tehisintellekti kasutamine', content: <>
      <p>Tootekirjelduse genereerimise nupu vajutamisel edastame OpenAI-le valitud tootepildi, toote nime ja olemasoleva kirjelduse. Saadud mustand kuvatakse kaupmehele ülevaatamiseks ja selle avaldamise otsustab kaupmees. Funktsioon ei vaja ega edasta eesmärgipäraselt ostjate tellimusandmeid.</p>
      <p>Kui sisestatud tekst või pilt sisaldab inimest puudutavat teavet, jõuab ka see teenusepakkujani. Kasuta ainult andmeid, mille edastamiseks sul on õigus. Teenusepakkuja võib päringuid töödelda oma turva- ja säilitamisreeglite kohaselt; Poeruum ei luba, et kõik päringu koopiad kustuvad vastuse saabumisel.</p>
      <p>Horoskoobitekstid luuakse üldise päevainfo järgi kõigile tähemärkidele. Sinu valitud tähemärk salvestatakse brauseris; sünnikuupäeva, sünnikohta ega isiklikku profiili selleks OpenAI-le ei saadeta. Praegune ettevõtete kliendiotsing ei kasuta OpenAI-d kontaktide valimiseks ega kirjade koostamiseks.</p>
    </> },
    { id: 'turundus', title: 'Ettevõtetele saadetavad tutvustuskirjad', content: <>
      <p>Poeruum kasutab e-äriregistri avaandmeid, et leida toodete valmistamise või jaemüügiga tegelevate ettevõtete üld- ja brändikontakte. Sobivus valitakse automaatselt registri staatuse, tegevusala ja tehniliste filtrite järgi. Iga kontakti ei kinnita inimene eraldi; administraator määrab kirja sisu ja saatmise piirangud.</p>
      <p>Nimega isiklikke aadresse püütakse automaatsete filtritega välistada. Avalik ettevõttekontakt võib siiski olla seotud füüsilise isikuga. Kirjas tuuakse välja saatja, kontakti allikas ja tasuta loobumise võimalus. Nõusolekut vajavat füüsilise isiku kontakti ei tohi käsitada pelgalt registris avaldamise tõttu vabalt turunduseks kasutatavana.</p>
      <p>Kirjadest saab loobuda kirjas oleva lingi kaudu või kirjutades <Contact />. Otseturustuse vastuväite järel lõpetatakse andmete kasutamine selleks eesmärgiks. Minimaalset blokeerimiskirjet võib säilitada, et loobumisest ka edaspidi kinni pidada. Teenuse vältimatud konto- ja makseteated on turunduskirjadest eraldi.</p>
    </> },
    { id: 'oigused', title: 'Sinu õigused ja taotluse esitamine', content: <>
      <p>Andmekaitseõiguses sätestatud tingimustel on sul õigus:</p>
      <ul>
        <li>saada teada, kas ja kuidas sinu andmeid töödeldakse, ning saada neist koopia;</li>
        <li>parandada ebaõigeid või puudulikke andmeid;</li>
        <li>nõuda andmete kustutamist või töötlemise piiramist;</li>
        <li>saada enda esitatud andmed masinloetaval kujul ja edastada need teisele teenusepakkujale, kui alus on nõusolek või leping ja töötlemine on automatiseeritud;</li>
        <li>esitada oma olukorrast lähtuv vastuväide õigustatud huvil põhinevale töötlemisele ning alati vastuväide otseturustusele;</li>
        <li>võtta nõusolek tagasi sama lihtsalt kui see anti, mõjutamata varasema töötlemise õiguspärasust.</li>
      </ul>
      <p>Kirjuta <Contact /> ja selgita, milliseid andmeid või toimingut taotlus puudutab. Võime küsida proportsionaalset lisateavet isikusamasuse kontrollimiseks. Vastame põhjendamatu viivituseta, hiljemalt ühe kuu jooksul. Keeruka või suure arvu taotluste korral võib tähtaega pikendada kuni kahe kuu võrra; sellest ja põhjusest teavitame esimese kuu jooksul.</p>
      <p>Taotlused on üldjuhul tasuta. Õiguste piiramine, keeldumine või põhjendatud tasu on võimalik ainult seaduses lubatud juhtudel ja seda tuleb selgitada. Näiteks seadusega nõutud arve säilitamine võib välistada selle kohese kustutamise.</p>
      <p>Poe ostuga seotud taotlus esita esmalt müüjale. Kui saadad selle Poeruumile, aitame kindlaks teha õige vastutaja ja abistame kaupmeest tema andmetöötluse piires. Õigus kaevata ei sõltu sellest, kas oled enne meiega ühendust võtnud.</p>
      <p>Kaebuse saad esitada <a href="https://www.aki.ee/isikuandmed/inimese-oigused">Andmekaitse Inspektsioonile</a> (<a href="mailto:info@aki.ee">info@aki.ee</a>) või oma elu- või töökohariigi pädevale järelevalveasutusele. Säilib õigus pöörduda kohtusse.</p>
    </> },
    { id: 'turvalisus', title: 'Turvalisus, alaealised ja muudatused', content: <>
      <p>Kasutame ligipääsupiiranguid, krüpteeritud ühendusi, konto autentimist, andmebaasi õigusi ning turvasündmuste jälgimist. Kaitsemeetmed peavad vastama andmete laadile ja riskile. Isikuandmetega seotud rikkumise korral hindame mõju, piirame tagajärgi ja teavitame mõjutatud kaupmeest, inimesi või järelevalveasutust seaduses nõutud juhtudel.</p>
      <p>Kaupmehe konto on mõeldud täisealisele ettevõtjat esindavale kasutajale. Kui alaealise andmed on teenusesse sisestatud põhjendamatult, palume sellest teatada. Poe ostjate puhul korraldab andmete õiguspärase kogumise vastav kaupmees.</p>
      <p>Uuendame tingimusi, kui muutub teenus, andmetöötlus või õigus. Uus versioon ja kuupäev avaldatakse siin; olulisest muudatusest anname teada teenuses või e-posti teel. Uus privaatsustekst ei asenda uut nõusolekut, kui muutunud töötlemine seda vajab. Küsimused ja varasema versiooni päringud saab saata <Contact />.</p>
    </> },
  ]
  return <DocumentContent label="Privaatsustingimused" title={<>Kuidas Poeruum<br />isikuandmeid kasutab</>}
    introduction="Selgitame, milliseid andmeid kogume, kellele neid edastame, kui kaua neid hoiame ja kuidas saad oma õigusi kasutada."
    summary={<><strong>Sinu jaoks oluline</strong><p>Kaupmehe konto ja Poeruumi teenuse andmete eest vastutab Animaator OÜ. Poes tehtud ostu andmete eest vastutab selle poe müüja. Konto kustutamisel võivad seaduslikult säilitatavad arved ja nende alusandmed alles jääda.</p></>}
    sections={sections} />
}

export default function LegalPage({ document }: { document: LegalDocument }) {
  const isTerms = document === 'terms'

  useEffect(() => {
    applySeoMetadata({
      title: `${isTerms ? 'Kasutustingimused' : 'Privaatsustingimused'} — Poeruum`,
      description: isTerms
        ? 'Poeruumi e-poeplatvormi kasutamise tingimused kaupmehele.'
        : 'Kuidas Poeruum kaupmeeste ja ostjate isikuandmeid töötleb ning kaitseb.',
      canonicalUrl: `https://poeruum.ee/${isTerms ? 'kasutustingimused' : 'privaatsus'}/`,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `${isTerms ? 'Kasutustingimused' : 'Privaatsustingimused'} — Poeruum`,
        url: `https://poeruum.ee/${isTerms ? 'kasutustingimused' : 'privaatsus'}/`,
        dateModified: DOCUMENT_VERSION,
        isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: 'https://poeruum.ee/' },
        publisher: {
          '@type': 'Organization', name: PROVIDER.name, identifier: PROVIDER.registryCode,
          vatID: PROVIDER.vatNumber,
          email: PROVIDER.email, address: PROVIDER.address,
        },
      },
    })
    // Keep links to individual clauses useful when entering from another page.
    const anchor = window.location.hash.slice(1)
    if (anchor) window.document.getElementById(anchor)?.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [isTerms])

  return <div className="legal-page">
    <header className="legal-nav">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <nav aria-label="Õigusdokumendid">
        <a className={isTerms ? 'is-active' : ''} aria-current={isTerms ? 'page' : undefined} href="/kasutustingimused">Kasutustingimused</a>
        <a className={!isTerms ? 'is-active' : ''} aria-current={!isTerms ? 'page' : undefined} href="/privaatsus">Privaatsus</a>
      </nav>
    </header>
    <main className="legal-content">{isTerms ? <Terms /> : <Privacy />}</main>
    <footer className="legal-footer"><a href="/">← Tagasi Poeruumi</a><span>© 2026 Poeruum</span></footer>
  </div>
}
