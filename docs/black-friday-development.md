# Musta reede kujunduse arendus

Branch: `codex/black-friday`. Eraldi Git worktree: `../Poeruum-black-friday`.
Alguspunkt on `main`-i commit `b512dbd`; põhikausta commit'imata muudatused
ei kuulu sellesse töökataloogi.

## Käivitamine

Kasuta Node.js 22 (nvm-i korral `nvm use 22`). Sõltuvused paigalda esimesel korral
käsuga `npm ci`.

```sh
cd ../Poeruum-black-friday
npm run dev:black-friday
```

Käsk avab brauseris
<http://kaubamaja.localhost:5175/?theme=black-friday>.
Tavakujunduse eelvaade: <http://kaubamaja.localhost:5175/?theme=default>.
Avalik, salvestatud seadistust järgiv vaade: <http://kaubamaja.localhost:5175/>.
Lehe ülaservas on teema vahetamise lingid. Muudatused ilmuvad salvestamisel.
Port 5175 on selle töö jaoks eraldi; hõivatud pordi korral annab käsk vea.
Serveri sulgemiseks vajuta `Ctrl+C`.

Telefonist vaatamiseks ühenda telefon arvutiga samasse WiFi-võrku. Server
kuulab ka kohalikus võrgus; ava telefonis
`http://ARVUTI-IP:5175/?preview=kaubamaja&theme=black-friday`.
Maci WiFi IP-aadressi saad käsuga `ipconfig getifaddr en0`. Arvuti peab olema
ärkvel ja arendusserver töötama. `preview=kaubamaja` valib IP-aadressi kaudu
kaubamaja vaate ainult arenduskeskkonnas; teema vahetamise lingid säilitavad selle.

Avaliku kataloogi laadimiseks võib kohalikus, Gitist välja jäetud `.env.local`
failis kasutada `VITE_SUPABASE_URL` ja `VITE_SUPABASE_PUBLISHABLE_KEY` väärtusi.
Serverisaladusi pole kujunduse arenduseks vaja. Ilma ühenduseta näeb kaubamaja
olemasolevaid näidispoekaarte. Muuda ainult selle worktree `.env.local` faili.

## Kujunduse muutmine

- `src/themes/black-friday/BlackFridayBanner.tsx`: kampaaniabänneri tekst ja struktuur.
- `src/themes/black-friday/BannerForest.tsx` ja `bannerForest.css`: kolm sujuvalt liikuvat metsakihti rähni all.
- `src/themes/black-friday/KrukKrukSpotlight.tsx`: bännerisse sobitatud mütsi ostupakkumine.
- `src/themes/black-friday/KrukStoreCard.tsx`: Krük-Krüki eripakkumine poodide nimekirjas.
- `src/themes/black-friday/KrukModelAd.tsx` ja `krukModelAd.css`: modelliga mütsireklaam poodide ruudustiku viimases vabas lahtris.
- `src/themes/black-friday/useKrukPurchase.ts`: mütsi ja ostunupu ühine ostu avamise olek.
- `src/themes/black-friday/KrukHatShowcase.tsx`: mütsi lend esiplaanile, tootevaade ja tagasilend.
- `src/themes/black-friday/krukHatMotion.ts`: mütsi pildikihid ning asukoht liikuval ratsanikul.
- `src/themes/black-friday/krukPurchase.ts`: ostu avamiseks värske toote- ja poeinfo laadimine.
- `src/themes/black-friday/KrukCheckout.tsx`: olemasolev tellimusvorm kampaanialehe dialoogis.
- `src/themes/black-friday/blackFriday.css`: kampaania värvid ja kujundus.
- `src/StoreDirectoryLayout.tsx`: päis, bänneri asukoht ja jalus.
- `src/Kaubamaja.tsx`: kaubamaja sisu, avaosa, tooted ja poed.
- `src/lib/directoryTheme.ts`: teema valimine.
- `src/DirectoryCampaignProvider.tsx`: salvestatud kampaania olek, ajastus ja admini eelvaade.
- `src/AdminDirectoryCampaign.tsx`: admini kampaania haldus Kaubamaja vahekaardil.
- `src/lib/directoryCampaign.ts`: kampaania laadimine/salvestamine ja Eesti aja teisendus.

Kampaania nimi on **MUSTA RÄHNI PÄEVAD**. Bänneris on kampaania nimi,
Krük-Krüki mütsi ostuvõimalus ja kasutaja antud foto põhjal eraldatud rähn ja ratsanik.
Kasutusel on uus kompositsioon:
paberikarva pind, bordoopunane Bodoni Moda ja kompaktne pealkiri linnu kõrval.
Kogu nimi on tumeda täistekstina; lind liigub kohati pealkirja ette.
Rähni all liigub vasakult paremale kolm fotolikku männimetsa kihti üle kogu
ekraani laiuse, ka üle bänneri sisulaiuse ulatuvate tiibade all. Kaugema
metsa tsükkel kestab 84, keskmise 48 ja lähema 30 sekundit; eri kiirus annab
üle metsa lendamise tunde. Igas kihis kordub sama pildi peegelpaar kaks korda,
nii et kõrvuti olevad servad sobituvad ja korduse lõpus ei teki hüpet.
Udu meenutavad üleminekud jätavad pealkirja ja ostunupu tausta heledaks.
Telefonis asub mets linnu taga, pealkirja ridade vahel. Mets on dekoratiivne
ega püüa hiire- või puutesündmusi. Animatsioon peatub väljaspool vaatevälja
ja peidetud vahelehel; vähendatud liikumise korral on maastik paigal.
Metsapilt `public/images/campaigns/musta-rahni-forest-v1.webp` loodi
sisseehitatud imagegeniga. Täpne juhis on
`docs/campaigns/image-prompts/musta-rahni-forest-v1.txt`.
Mobiilis on pilt ja tekst eraldi ridadel, lähiplaan riivab alumist pealkirja.
Praegune läbipaistva taustaga pildikiht on
`public/images/campaigns/musta-rahni-cutout-v2.webp`; algne foto on endiselt failis
`public/images/campaigns/musta-rahni-paevad.webp`.
Taust eraldati sisseehitatud imagegeniga; täpne töötlusjuhis on failis
`docs/campaigns/image-prompts/musta-rahni-cutout-v2-prompt.txt`.
Bodoni Moda fondid asuvad `public/fonts/bodoni-moda/` koos OFL-litsentsiga.
Rähni saab hiire, puute või klaviatuuriga häälitsema panna.
Lind ja ratsanik triivivad 20-sekundilisel lennukaarel ning püsivad esiplaanil.
Skaala muutub töölaual 110–138% ja mobiilis 110–128%; laskumisel pöördub
nokk kuni 7° alla ja tõusul 5° üles. Horisontaalne kaar on lühem ja nihutatud
vasakule, et lind liiguks kohati kampaania pealkirja ette. Ostupakkumise korral
on töölaua lennukaar veidi kõrgem, et ostutekst püsiks loetav. Tiivaserv võib liikuda
ekraani taha. Ühtlase kiirusega animeeritud CSS-nurk juhib siinus- ja
koosinuskõveraid: lennukaarel puuduvad vahepeatuste või tsüklivahetuse jõnksud.
Kõrguse muutus on lähenemisest nihkes, nii et lind triivib edasi ka lähimas
ja kaugeimas asendis. Esimene lähiplaan saabub umbes viie sekundi pärast;
lennukaar jätkub häälitsuse ajal katkematult. Vajutus ei lisa kogu linnule
eraldi pöördeid ega nõksatusi.
Alumine nokapool liigub SVG-kihina 1,3-sekundilise musträhni salvestuse rütmis.
Häälitsuse ajal paiskub nokast täht haaval välja „KRÜK-KRÜK“ koos väikeste
tindipritsmetega. Sõnad paisuvad ja lendavad kahe järjestikuse tõukega üle
ekraaniserva; mobiilis liiguvad need esmalt pildi kohale ja siis üles-paremale.
Heli mängib ainult vajutamisel; pooleliolevat helilõiku kordusklõpsuga ei kihistata.
Salvestise allikas, CC0-litsents ja töötlus on kirjas
`public/audio/campaigns/SOURCES.md`. Vähendatud liikumise korral mängib ainult heli.
Sisenemisanimatsioon, hõljumine, hiireliikumine ja noka animatsioon arvestavad vähendatud liikumise eelistust.
Kampaaniavaates ei kuvata tavalist loo avaplokki ega liikuvat tekstiriba.

Kui lehel pole 60 sekundit hiire-, puute-, kerimis- ega klaviatuuritegevust,
avaneb täisekraani lennuvaade. Alles jäävad kolm liikuvat metsakihti ning rähn
koos ratsanikuga. 28-sekundilisel sujuval lennukaarel muutub linnu skaala
0,48-st 1,55-ni; lähiplaanil võivad tiivad ulatuda üle ekraani serva.
Rähnile või püsivale „Alusta mängu” sildile vajutamine avab sama vaate mänguna.
Alguses kuvatakse neli klahvi klaviatuuri paigutuses: ↑ ülal ning ← ↓ → alumises
reas. Taustakasti pole; iga klahvi kohal on selle juhis: „Hoia all”, „Kaugemale”,
„Lähemale” või „Vabasta mütsid”. Vasaknool on bordoopunane ja vajub kaks korda
õrnalt alla, näidates hoidmist. Arvutis on juhis allservas, telefonis üleval.
Juhised kasutavad suuremat, kergelt kaldu Caveat-käsikirja; „HOIA ALL” on rõhutatud
kampaania Anton-fondiga. Klahvide nooled jäävad selgesse tavakirja.
Juhis hajub kaheksa sekundi möödudes; vähendatud liikumise korral animatsioon puudub.
Nooleklahvid võtavad lennu juhtimise üle:
vasakut tuleb õhus püsimiseks all hoida, parem vabastab kogutud mütsid,
üles viib linnu kaugemale ja alla toob lähemale. Hoida saab mitut noolt korraga.
Puuteekraanil on vasakus alanurgas suur lennunupp ning paremal kauguse ja mütside
vabastamise nupud. Need toetavad mitut sõrme korraga; sõrme nihkumisel nupult
välja kestab hoidmine kuni vabastamise või puute tühistamiseni.
Hoog muudab ka metsakihtide möödumise kiirust; lind kaldub ja kaamera järgib
lähenemist nii, et nokk ja ratsanik püsivad ka kitsal ekraanil nähtaval.
Kiirendus ja sügavuse muutus on sujuvad. Lennunupu vabastamisel lind vajub;
uuesti hoidmine taastab kõrguse. Valitud kaugus säilib. Kui juhtimist
ei kasutata, jätkub automaatne lennukaar. Brauseri fookuse kaotamisel vabastatakse
kõik all hoitud juhtnupud. Nooled ei kerita peidetud lehte ega sule lennuvaadet.
Automaatselt avanenud lennuvaate sulgeb hiire liigutamine, puudutus, kerimine
või muu klahv. Teadlikult avatud või nooleklahvidega üle võetud mäng sulgub
ristinupust, Escape'iga või linnu ekraanilt välja kukkumisel; tavaline puudutus
mängu ei lõpeta. Leht taastub senise kerimiskoha ja klaviatuurifookusega.
Äratusvajutus ei aktiveeri peidus
ostunuppu. Mütsi tootevaate, ostukorvi ja teiste dialoogide ajal lennuvaade
ei käivitu. Peidetud brauserivahelehel taimer peatub; naasmisel algab uus minut.
Vähendatud liikumise eelistuse korral puudub automaatne lennukaar ja kaugus muutub
väikeste sammudega. Pärast juhtimise ülevõtmist toimivad endiselt mänguks vajalik
vajumine ja kõrguse taastamine.
Teostus: `src/themes/black-friday/BlackFridayScreensaver.tsx` ja
`blackFridayScreensaver.css`, juhtimine `useScreensaverFlight.ts` ja
`screensaverFlight.ts`; käitumiskontrollid:
`e2e/black-friday-screensaver.e2e.ts` ning `screensaverFlight.test.ts`.

Bänneri sisse on sobitatud kataloogi poe `kruk-kruk` nokkmütsi `nokkmuts`
ostuvõimalus. Käsikirjaline „Müts” (kohalik Caveat font) ja vabakäelise ilmega
lühike kaarjas nool osutavad mütsile, jättes nooleotsa ja mütsi vahele õhuvahe.
Rähni all on samas käekirjas püsiv „Alusta mängu” koos linnule osutava kaarja
noolega; täiendavat juhtimisteksti ega klahvimärke bänneris pole.
Silt on eraldi nupp, mis avab sama mängu
nagu rähn. See püsib linnu liikumise ajal paigal, et jääda loetavaks ja vajutatavaks.
Hiirega või klaviatuuriga rähnile liikudes joonistub mängukutse alla joon.
„Müts” märkus ilmub endiselt ainult hiirega või klaviatuurifookusega.
Hiire või klaviatuuri fookuse korral muutub ainult müts heledamaks ja saab
heleda serva; käsikirjaline märkus muutub punaseks ning allajoonituks.
Ratsaniku mütsil on eraldi vajutatav ala: sellele vajutades
lendab müts 1,15 sekundiga peast esiplaanile, suureneb ning jääb hõljuma.
Mütsi lend algab SVG tegelikust asukohast; esimestes kaadrites kasutatakse
algse foto mütsi ning lähenedes eraldatud tootepilti. Ratsaniku pähe ilmub
mütsita pildikiht. „Tagasi pähe”, taustale vajutamine või Escape saadab
mütsi 0,68 sekundiga tagasi; sihtkohta arvutatakse iga kaader uuesti, et
müts maanduks jätkuvalt liikuva ratsaniku pähe. Vähendatud liikumise korral
avanevad ja sulguvad vaated kohe. Lendamise tootevaatest saab avada ostu;
tellimusvormi sulgemine toob tagasi sama mütsi juurde.
Pildikihid ja imagegeni täpsed juhised on failis
`docs/campaigns/image-prompts/kruk-hat-flight.txt`.
Ostu avab ka bänneri allosas taustata mütsi pilt koos käsikirjalise „Võta nokkmüts”
ja hinnaga. Mütsi suurendati veerandi võrra üles-vasakule, hoides hinna senises
asukohas. Seitsmesekundiline hõljumine tõstab mütsi 6 pikslit ja kallutab 1,5°;
hiire või klaviatuurifookuse korral läheneb müts veel veidi. Liikumine peatub
väljaspool vaatevälja, peidetud vahelehel, ostu laadimisel ja lennuvaate ajal.
Vähendatud liikumise eelistuse korral on müts paigal. Telefonis on ostupakkumine
pealkirja all samal taustal ning mütsi suurus kohandub vaba ruumiga.
Eraldi tootekaarti pole.
Nimi, hind, soodushind ja saadavus tulevad samast avalikust kataloogist
nagu ülejäänud kaubamajal. Bänneri ja mütsi tootevaate ostunupud avavad olemasoleva
tellimusvormi samal lehel, üks müts juba valitud. Enne avamist laaditakse üle
toote hind, laoseis, maksete valmidus ja poe tarneviisid. Mitme valikuga
toote korral suunab veateate link tootelehele valikuid tegema.
Veateate juures olev link avab tootelehe ning säilitab kaubamaja külastuse päritolu.
Kui müts pole saadaval või pood puudub kataloogist, ostupakkumist ei kuvata.
Krük-Krüki tooteid ei korrata selle vaate üldises kingiideede valikus;
otsingus ja poodide nimekirjas on need endiselt leitavad.

Poodide nimekirjas on Krük-Krük kampaaniavaates esimene ja ulatub üle mõlema
veeru. Ühel bordoopunasel pinnal on suur taustast eraldatud nokkmüts,
jämedas Anton-kirjas „MUSTA RÄHNI”, selgelt loetav „ERIPAKKUMINE” ning poe nimi.
Müts pöördub ja tõuseb veidi, kui sellele hiirega liikuda; vähendatud liikumise
korral efekt puudub. Kataloogist tuleva hinna kõrval on hele „Osta nokkmüts” nupp,
mis avab sama tellimusvormi nagu bänneris. Poe nimi ja „Ava pood” viivad kogu poodi.
Tavalised poekaardid algavad järgmisest reast. Telefonis on pealkiri, müts ja
osturida üksteise all. Kui müts pole saadaval, kuvatakse tavaline poekaart.
Otsingu tulemuste järjestust ja tavakujundust esiletõstmine ei muuda.

Kui kampaaniavaate poekaartide viimane rida jätab ühe lahtri vabaks, täidab
selle modelliga mütsireklaam. Kasutaja foto mees on algsest metsast ja linnust
eraldatud ning paigutatud uude, pehme õhtuvalgusega männimetsa. Pealkiri on
„Loodusest nokk ees.” jämedas Manrope'i kirjas; samale fotopinnale on sobitatud kataloogist
tulev tootenimi ja hind ning „Vaata kodulehte”, mis avab `https://kruk-kruk.ee/`.
Link on hinna all vasakul tekstilise, õhukese alajoone ja paremale noolega;
eraldi heledat kasti pole. Puuteala kõrgus on vähemalt 44 pikslit.
Sama lingi vajutatav pind katab kogu reklaami: foto ja tekst avavad kodulehe.
Logo ja poe nime link jääb eraldi vajutatavaks ning avab samuti kodulehe.
Ülanurgas on kataloogist tulev Krük-Krüki logo ja poe nimega link.
Telefonis on reklaam viimase poekaardi järel. Otsingus, tavavaates ning
saadaval oleva mütsi puudumisel reklaami ei kuvata. Näitamiste ja klikkide
analüütika kasutab reklaami tegelikku asukohta nimekirjas.
Modellipilt `public/images/campaigns/kruk-cap-forest-model-v1.webp` loodi
sisseehitatud imagegeniga eraldatud modelli põhjal; täpne juhis on
`docs/campaigns/image-prompts/kruk-cap-forest-model-v1.txt`. Telefonis jääb
pealkiri foto kohale, müts tervenisti nähtavale ja ostunupp pildi alaserva.

Horoskoop kasutab ka kampaania ajal algset kujundust ja tavalisi igapäevaseid
tekste. Horoskoobile ei lisata kampaaniabrändingut ega reklaampilte.
Tähemärgi valimine, kuupäeva vahetumine, meeldejätmine ja jagamine toimivad
tavalise `DailyHoroscope` komponendi kaudu.

Uued kampaaniastiilid
lisa selektori `.store-directory[data-directory-theme='black-friday']` alla.
Nii saab ka teisi kaubamaja elemente muuta, näiteks:

```css
.store-directory[data-directory-theme='black-friday'] .store-directory__marquee {
  background: var(--black-friday-surface);
  color: var(--black-friday-accent);
}
```

## Kampaania haldus ja avaldamine

Adminis **Kaubamaja → Kampaania** (`/admin/kaubamaja?view=campaign`) saab valida:

- **Väljas**: tavaline kujundus sõltumata varem salvestatud ajavahemikust.
- **Kohe sees**: kampaania on aktiivne kuni käsitsi väljalülitamiseni.
- **Ajastatud**: aktiivne algushetkest kuni lõpuhetkeni; lõpuhetk enam kampaaniasse ei kuulu.

Valik jõustub nupuga „Salvesta kampaania”. Ajad sisestatakse alati Eesti aja järgi,
ka muus ajavööndis asuvast arvutist. Suveajale üleminekul puuduv või talveajale
üleminekul korduv kellaaeg lükatakse tagasi. Salvestatakse UTC ajatemplid.
Eelvaade ei salvesta ega käivita kampaaniat. Production build lubab URL-i
eelvaatevalikut ainult Supabase Authi kaudu kontrollitud administraatorile;
külastaja URL-parameeter ei saa avalikku kampaaniat sisse ega välja lülitada.

Andmebaasimuudatus: `supabase/migrations/202610220001_directory_campaign.sql`.
Uus kampaania on vaikimisi **väljas**. Enne avalikku kasutamist tuleb migratsioon
ja rakenduse muudatused avaldada. Arenduse käigus tootmisandmebaasi ei muudeta.
Migratsioon lisab ainult ühe kampaania seadistuse, avaliku lugemisfunktsiooni
ning admini õigusi kontrolliva salvestusfunktsiooni. Avalik vastus ei sisalda
salvestaja identiteeti. Muudatuse versioon kaitseb kahe admini samaaegse
salvestamise eest. Andmebaasitesti saab käivitada migreeritud testandmebaasis:
`psql "$TEST_DATABASE_URL" -f scripts/test-directory-campaign.sql` (test lõpeb rollback'iga).

Avalik vaade kasutab andmebaasi kella ja monotoonset brauseritaimerit.
Kampaania algab/lõpeb juba avatud lehel ilma värskendamiseta; käsitsi muudetud
seadistust kontrollitakse kuni 30-sekundilise intervalliga ning lehele naastes.
Eraldi cron-tööd pole vaja. Kui seadistust ei saa lugeda, kasutatakse tavavaadet.
Pooleliolevat tellimusvormi kampaania lõppedes ei suleta: ostja saab selle lõpetada
või sulgeda, misjärel rakendub tavavaade. Soodushinnad ja laoseis tulevad endiselt
poe tootekataloogist; kampaania ajastus ei muuda tootehinda.

## Mängu esimene lennuring

Ülanurgas olev suur Anton-number kasvab iga püütud mütsiga, kohe lennu ajal.
See on käesoleva lennu punktisumma; mahapillamine juba saadud punkte ei kustuta.
Peenike teekonnajoon liigub Poeruumi kotimärgi poole. Pärast 32 sekundit algab
kaubamajja laskumine, kui küüniste vahel on vähemalt üks müts. Tühja koormaga
lendab mäng edasi järgmise püügini. Pildid laaditakse mängu avamisel ette;
poolelioleva püügi või vabastamise ajal maandumine ei alga.

Kaubamaja on läbipaistva taustaga objekt samas metsas. Hoone ja lagendik
liiguvad vasakult kaadrisse, kaamera peatub, rähn laskub parempoolse sissepääsu
juurde ning lendab senises suunas vasakule, fassaadi taha. Metsapilti ei vahetata
ega hajutata uueks stseeniks. Hoone sildil kasutatakse lehe olemasolevat `Brand`
komponenti koos kampaania värvidega. Ukse ees vähenevad tiivalöögid; varju ja
fassaadi kihid seovad linnu sissepääsuga. Suur punktisumma jääb alles, selle kõrvale
ilmub lõpetamisel linnuke. Seejärel avaneb tegelik kaubamaja poodide nimekiri.

`hatDelivery.ts` eristab lennu punkte ja päriselt kohale viidud koormat. Ainult
ukse taha jõudnud mütsid lisatakse kohalikku kohaletoimetamiste arvestusse
(`poeruum:woodpecker:delivered:v1`); see ei ole poe laoseis ega üle kasutajate
jagatud tulemus. Uue lennu nähtav punktisumma algab nullist. Sulgemine enne
sisenemist koormat kohaleviiduks ei loe. Passiivne ekraanisäästja jääb lõputuks.

Vaate failid: `DepartmentStoreArrival.tsx`, `departmentStoreArrival.css` ja
`drawStoreArrival.ts`. Sisseehitatud imagegeniga loodud fotokihid on
`public/images/campaigns/poeruum-flight-destination-v2.webp` ning
`public/images/campaigns/poeruum-flight-clearing-v1.webp`. Täpsed juhised asuvad
samanimelistes failides `docs/campaigns/image-prompts/` all.

## Kontrollimine ja Git

```sh
npm run lint
npm run build:app
npm run test:unit -- src/themes/black-friday/krukPurchase.test.ts
npm run test:unit -- src/lib/directoryCampaign.test.ts
npm run test:smoke -- e2e/directory-campaign.e2e.ts e2e/admin-directory.e2e.ts
npm run test:smoke -- e2e/directory-hero.e2e.ts e2e/directory-stories.e2e.ts
```

Vaata kujundust nii arvuti- kui telefonilaiuses. Võrdle eelvaate linkide abil
tavakujundust ja kampaaniakujundust. Tee kõik kujunduse commit'id selles kaustas.
`main`-i uusi commit'e saab branch'i tuua käsuga `git merge main`, kui oma
muudatused on commit'itud. Kui muudatused on valmis, ühenda branch PR-i kaudu.
