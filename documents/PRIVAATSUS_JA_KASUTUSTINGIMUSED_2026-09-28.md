# Poeruumi privaatsus- ja kasutustingimuste analüüs

Koostatud 28.09.2026. Aluseks kohaliku rakenduse kood, migratsioonid ja ametlikud allikad. Töö alguse commit: `17bbcec`. Tootmiskeskkonna seadistusi, teenusepakkujate sõlmitud lepinguid ega käivituvate kustutustööde tulemusi selle analüüsi käigus ei kontrollitud.

**Tulemus:** rakenduse `/kasutustingimused` ja `/privaatsus` on ümber kirjutatud Poeruumi teenuse järgi, lähtudes kasutaja antud eeldusest, et Animaator OÜ on käibemaksukohustuslane. Tekstid on kohalikus tööversioonis; neid ei ole selle töö käigus tootmisse avaldatud ega olemasolevatele kaupmeestele saadetud. Allpool kirjeldatud korralduslikud kinnitused vajavad lahendamist enne uue versiooni kasutuselevõttu. Teksti valmimine ei ole kogu teenuse õigusliku vastavuse kinnitus.

## Kokkulepitud lähtekohad

- Teenuse osutaja on Animaator OÜ, registrikood 17135632.
- Tingimused koostatakse **eeldusega, et ettevõte on Eestis registreeritud käibemaksukohustuslane**. See on kasutaja antud koostamise lähtekoht, mitte käesoleva analüüsi käigus registrist kinnitatud staatus.
- Selle töö ulatus on tingimuste analüüs ja parandamine. Arvutusi, Stripe’i arveldust, hinnakirja ega olemasolevaid tehinguid siin ei muudeta.

Kasutustingimustes on tasud esitatud nii ilma käibemaksuta kui ka koos 24% käibemaksuga. Summad ja maksumäär loetakse samadest `src/storefrontConfig.ts` konstantidest, mida kasutavad rakenduse hinnavaated. Paindlik pakett on 4% + käibemaks ehk 4,96%, ülempiiriga 39 € + käibemaks ehk 48,36 € kuus. Kindel pakett maksab pärast 30-päevast prooviperioodi 29 € + käibemaks ehk 35,96 € kuus.

## Mida rakendus tegelikult teeb

| Tegevus | Andmed ja osapooled | Koodist kontrollitud alus |
| --- | --- | --- |
| Kaupmehe konto ja poe haldus | E-post, konto, ettevõtte- ja poeandmed; Poeruum vastutava töötlejana, Supabase taristuna | `src/PlatformApp.tsx`, `src/lib/database.ts`, `src/lib/supabase.ts` |
| Ostud, maksed ja dokumendid | Ostja nimi, e-post, telefon, tarne, arveandmed, ostukorv, tehingud; müüja vastutava töötlejana, Poeruum tema nimel | `src/StorefrontCart.tsx`, `supabase/functions/stripe-store-checkout/`, `supabase/functions/order-documents/` |
| Konto sulgemine | Konto, poe sisu ja failide eemaldamine; töövaate kontaktide muutmine, kuid arveandmete ja muude seotud koopiate säilimine | `supabase/functions/delete-account/`, migratsioonid `202607250003_data_retention.sql`, `202609240001_order_invoices.sql` |
| Kirjad ja tugi | Konto-, tellimus-, arve- ja tugikirjade sisu ning manused Resendis; eraldi kohalik saatmisjärjekord | `supabase/functions/_shared/order-email-queue.ts`, `supabase/functions/resend-webhook/`, `supabase/functions/support-actions/` |
| AI-tootekirjeldus | Valitud pilt, nimi ja olemasolev kirjeldus saadetakse OpenAI-le; kasutaja käivitab ja otsustab avaldamise | `src/ProductDescriptionGenerator.tsx`, `supabase/functions/_shared/product-description.ts` |
| Horoskoop | Üldised tekstid kõigile tähemärkidele; tähemärgivalik brauseris, isiklikke sünniandmeid päringusse ei lisata | `src/DailyHoroscope.tsx`, `supabase/functions/_shared/horoscope-generation.ts` |
| Ettevõtete tutvustuskirjad | Registriandmetest automaatne valik ja saatmisjärjekord; admin määrab ühise kirja, üksikkinnitust ega AI-valikut ei ole | `documents/KLIENDIOTSINGU_NOUDED.md`, `scripts/import-rik-outreach.mjs`, `supabase/functions/lead-outreach/` |
| Avalehe ja Kaubamaja statistika | Mälus juhuslik tunnus, tegevused, seadmeklass ja viitaja domeen; kontoga ei seota, otsinguteksti ei logita | `src/lib/homepageAnalytics.ts`, `src/lib/directoryAnalyticsSession.ts` |
| Brauseri salvestus | Jagatud autentimisküpsised kuni 365 päeva viimasest uuendusest; seansisalvestus maksekatsel ja naasmislingil; püsivad kuva- ja tähemärgivalikud | `src/lib/sharedAuthStorage.ts`, `src/lib/checkoutAttempt.ts`, `src/App.tsx`, `src/DailyHoroscope.tsx` |
| Välised päringud | Google Fonts, Turnstile, registri- ja aadressiotsing, pakiautomaatide loend ja välised logod | `src/platform.css`, `src/Turnstile.tsx`, `src/PlatformApp.tsx`, `src/StorefrontCart.tsx` |
| Poodide avastamine | Käsitsi muudetav kataloogijärjekord, juhuslikud toote-esiletõsted, nimel ja kirjeldusel põhinev otsing | `src/lib/directorySearch.ts`, `shared/store-directory.mjs`, kataloogi migratsioonid |

## Parandatud sisulised puudused

1. **Rollijaotus.** Eristatud Poeruumi enda töötlemine, kaupmehe vastutus ostjate eest ning makseteenuse iseseisev roll. Platvormi dokumente ei esitata kaupmehe müügitingimuste või privaatsusteate asendajana.
2. **Andmete eesmärk ja alus.** Lepingu täitmise alus on eristatud ettevõtte esindaja õigustatud huvi alusel töötlemisest; tutvumine privaatsusteatega ei ole üldine nõusolek.
3. **Tegelikud teenused.** Lisatud AI-tootekirjeldused, horoskoop, Google Fonts ja brauserist tehtavad välised päringud. Eemaldatud vale kirjeldus OpenAI-põhisest ja käsitsi kinnitatavast kliendiotsingust.
4. **Säilitamine.** Täpsustatud arvete ja nende alusandmete säilimine, tellimuskirjade sisu erinevus 90-päevasest kättetoimetamislogist ning saatmisjärjekorra kontaktide tegelik tähtajakriteerium. Kaheksat aastat ei nimetata iga üksiku andmevälja seaduslikuks miinimumiks. Arvestatud pikema erandliku majandusaasta võimalust.
5. **Andmetöötluskokkulepe.** Kirjeldatud töötlemise ese, andmed, juhised, konfidentsiaalsus, turvameetmed, rikkumisteavitused, abistamine, audit, alamtöötleja muudatus ja andmete tagastamise või kustutamise valik.
6. **Platvormileping.** Täiendatud esindusõigust, sisu kasutusluba, AI-mustandi vastutust, Kaubamaja järjestuse põhimõtteid, teavitamise ja vaidlustamise korda ning lõpetamise tagajärgi. Säilitatud kohustusliku vastutuse erandid.
7. **Muudatused ja jõustumine.** Dokumendi versioonikuupäev on eristatud olemasolevale kliendile jõustumisest. Lepingumuudatuste tavapärane etteteatamisaeg on 30 päeva e-postiga. Seda protsessi peab teenuseosutaja ka tegelikult täitma.
8. **Loetavus ja kättesaadavus.** Lisatud lühiülevaated, sisukorrad, punktide püsilingid, prindivaade ja versioon. Kaubamaja jaluses on tingimuste lingid nii Reacti kui ka serveri väljastatavas vaates.

## Enne avaldamist lahendatavad küsimused

### 1. Käibemaksukohustuslase andmed

Tingimuste 24% käibemaksuga hinnastus vastab rakenduse praegusele tasude arvutusele ja selle dokumendi koostamise eeldusele. Eesti standardmäär on 24%. [Maksu- ja Tolliameti käibemaksuinfo](https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks).

Animaator OÜ KMKR numbrit ega registreerimise jõustumiskuupäeva ei ole selle töö jaoks antud; neid ei mõeldud välja. Enne teksti kasutuselevõttu kinnitada registreeringu jõustumine ning lisada tegelik KMKR number teenuseosutaja andmetesse ja arvelduse seadistusse. Kaupmehe enda kauba käibemaks on Poeruumi teenustasu maksustamisest eraldi.

### 2. Teenusepakkujate tegelikud lepingud ja säilitamine

Kood näitab teenuse kasutamist, kuid ei tõenda Supabase’i projekti piirkonda, varukoopiate tsüklit, Renderi logide aega, Resendi säilitamist, OpenAI organisatsiooni andmeseadeid ega konkreetse juriidilise lepingupartneri andmeedastuse alust. `store: false` AI-päringus ei tõenda kõigi teenusepakkuja logide puudumist.

Enne avaldamist kinnitada teenusepakkujate juriidilised nimed, sõlmitud töötlemislepingud, tegelikud töötlusriigid, vajalikud edastamismehhanismid ning logide ja varukoopiate tähtajad. Uus tekst ei väida kontrollimata, et kõik andmed asuvad ELis, ega et kõik teenused kustutavad koopiad kohe. Artikli 28 kokkuleppe jaoks peab konkreetsete alamtöötlejate info olema kaupmehele kättesaadav. [AKI selgitus töötlejate rollide ja alamtöötlejate kohta](https://www.aki.ee/uudised/arvamus-vastutavate-ja-volitatud-tootlejate-ja-nende-alamtootlejate-rollide-ja-kohustuste).

### 3. Kaupmehe enda õigusteave ja ostu kinnitamine

`src/App.tsx` pakub müüjaandmeid, lühikest tagastusvälja ja üldist müügitingimuste dialoogi. Poes olev privaatsuslink viib praegu ainult Poeruumi dokumenti. Eraldi kaupmehe privaatsusteate sisestamise ja avaldamise lahendust ülevaadatud voos ei ole. Platvormi lepinguga kaupmehele vastutuse panemine ei loo seda funktsiooni.

Järgmises tootetöös võimaldada kaupmehe teavitus ja täielikud müügitingimused, kuvada need enne tellimust ning siduda tellimusega kehtinud tingimuste koopia. Kontrollida taganemisvormi, puudusega kauba korda, tarbijakaebusele vastamise tähtaega ja tarneinfot. [TTJA e-kaubanduse nõuded](https://ttja.ee/ariklient/ettevotlus/tarbijakaitsenouded-tegevusalale/e-kaubandus).

### 4. Nõustumise tõend ja dokumendiversioonid

Registreerumisel on märkeruut, kuid `auth.signUp` ei saada tingimuste versiooni ega nõustumise serveriaega. Puudub ülevaadatud eraldi muutmiskindel nõustumisregister. Kindla paketi nõustumiskast on `src/BillingPlanDialog.tsx` komponendis praegu eelmärgitud. Seda maksevoogu kasutaja piiratud tööulatuse tõttu siin ei muudetud.

Edasi: säilitada konto ja lepinguga seotud serveripoolne nõustumiskirje ja dokumendi täpne koopia; maksekohustuse kinnitus olgu aktiivne kasutaja tegevus. Mitte kasutada muudetavat kasutajametaandmestikku ainsa tõendina. Olemasolevatele kaupmeestele saata muudatused koos teksti püsiva koopiaga ja jõustumiskuupäevaga. Selle analüüsi käigus kirju ei saadetud.

### 5. Säilitamise minimaalsus ja kustutamise täielikkus

Uus privaatsustekst avaldab praeguse käitumise ausalt, kuid see ei tõenda iga säilitamise vajalikkust. `order_email_jobs.payload` võib sisaldada adressaati ja kirja sisu ning jääda alles tellimuse kustutamiseni. Kõigil tellimustel, sealhulgas mittetasutud katsetel, on üldine arhiivitähtaeg. Saatmata `queued` ettevõttekontakte praegune `apply_sales_lead_retention` tähtaja alusel ei kustuta.

Eraldi andmeminimaalsuse töö peab määrama lühemad tähtajad ebaõnnestunud ostukatsetele, tarneandmetele ja kättetoimetatud kirjade sisule ning saatmata kontaktidele. Raamatupidamise jaoks vajalik arve säilitada eraldi. Kustutamisel katta kopeeritud andmed, failid ja teenusepakkujad ning kontrollida ajastatud tööde tegelikke tulemusi. DPA tagastamise/kustutamise taotluse täitmiseks on vaja dokumenteeritud käsitsi või automaatset protsessi.

Kaheksa aastat tehingust ei kata alati seitset aastat erandliku kuni 18-kuulise majandusaasta lõpust; selliste juhtude säilitamispiirang tuleb eraldi rakendada. [Raamatupidamise seaduse §-d 13 ja 12](https://www.riigiteataja.ee/akt/125052012016?leiaKehtiv=).

### 6. Statistika, kohalik salvestus ja ettevõttekirjad

Küpsise puudumine ei tõenda iseenesest, et kogu töötlus oleks nõusolekust vabastatud. Dokumenteerida avalehe/Kaubamaja statistika õigustatud huvi kaalumine ja e-privaatsuse hinnang. `autoSwipe*` valikud salvestatakse ka vaikimisi, mitte ainult valiku muutmisel; kontrollida, kas iga kirjutamine on kasutaja soovitud teenusele vajalik. Sisselogimise 365-päevast küpsisekestust tuleb hinnata turva- ja minimaalsusvajaduse järgi.

Kontrollida Stripe’i/Turnstile’i tegelikku salvestust ning fontide ja väliste logode päringuid. Võimalusel majutada fondid ja logod ise. Vajadusel lisada tegelikku töötlust juhtiv nõusolekuhaldus, mitte ainult teavitusriba. [AKI interneti- ja veebitegevuste juhis](https://www.aki.ee/isikuandmed/kkk/interneti-ja-veebitegevused).

Kliendiotsingus ei taga aadressi kuju filter, et kontakt kuulub juriidilisele, mitte füüsilisele isikule. Kontrollida ettevõtlusvormi, isikukontaktide filtreid ja loobumiste rakendumist. Avalikust registrist päritolu ei anna automaatselt luba füüsilise isiku otseturustuseks; vastuväitele peab järgnema tegelik saatmise lõpetamine.

### 7. Platvormi õiguslik liigitus ja töökorraldus

Kaubamaja avalik kataloog koos ostuni suunamisega põhjendab P2B ja digiteenuste määruse kohaldumise eraldi hindamist. See on funktsioonidest tehtud järeldus, mitte ettevõtte suurust, turgu ja kõiki erandeid kinnitav õiguslik otsus. Tingimustesse lisatud järjestuse, sisu piirangute, teadete ja vaidlustamise kord peab olema igapäevases töös täidetav.

Kinnitada vastutaja `info@poeruum.ee` päringutele, andmeõiguste ja rikkumiste menetlemine, inimülevaatus ning 30-päevase lepingumuudatuse ja alamtöötleja teavitamise võimekus. Vajaduse korral hinnata ka P2B lepitus- ja DSA kaebemenetluse kohustusi ning väikeettevõtte erandeid. [P2B määrus 2019/1150](https://eur-lex.europa.eu/legal-content/ET/ALL/?uri=CELEX%3A32019R1150), [digiteenuste määrus 2022/2065](https://eur-lex.europa.eu/legal-content/ET/TXT/?uri=CELEX%3A32022R2065).

## Muud kasutatud esmased allikad

- [AKI: andmetöötluse läbipaistvus e-poes](https://www.aki.ee/1-andmetootlus-ja-labipaistvus) — teavitus peab vastama tegelikule töötlusele.
- [AKI: inimese õiguste tagamine](https://www.aki.ee/isikuandmed/andmetootlejale/inimese-oiguste-tagamine) — andmekaitseteabe sisu ja taotluste käsitlemine.
- [AKI: vastutav ja volitatud töötleja](https://www.aki.ee/vastutav-ja-volitatud-tootleja) — rollijaotus ja töötlemiskokkulepe.
- [AKI: rikkumisteated](https://www.aki.ee/rikkumisteated) — volitatud töötleja teavitus vastutavale töötlejale põhjendamatu viivituseta.
- [E-äriregister: Animaator OÜ](https://ariregister.rik.ee/est/company/17135632/Animaator-O%C3%9C) — nimi, registrikood ja aadress. Tingimuste käibemaksustaatus põhineb kasutaja antud koostamise eeldusel.

## Tehniline kontroll

- `npm run build:app` — läbitud (TypeScript ja Vite).
- Olemasolev Playwrighti test `legal routes render their dedicated documents` — läbitud.
- Brauseris kontrollitud mõlema dokumendi kõiki sisukorraviiteid (15 ja 13), vaateid laiustel 320, 390 ja 1280 px, otseviidet `#ai` ning PDF-printimist. Horisontaalset lehe ülevoolu ega JavaScripti vigu ei esinenud. Töölaua ja mobiili päiseid vaadati ka kuvatõmmistel.
- Serveri ja SEO-skripti süntaks ning `git diff --check` — läbitud.
- Vaikimisi `npm run lint` peatub tööga mitteseotud `.local-backups/payment-recovery-rollout-20260910/` failide 28 olemasoleval keskkonnaglobaalide veal. Sama lint-kontroll ainult selle kohaliku varukoopiakataloogi välistamisega (`--ignore-pattern '.local-backups/**'`) läbitud. Varukoopiaid ega lint-seadistust ei muudetud.
