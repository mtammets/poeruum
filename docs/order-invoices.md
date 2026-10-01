# Ostuarved

Poeruum koostab uue ostuvoo tellimustele müüja nimel tasutud PDF-arve. Kassas küsitakse ostja arveaadressi; ettevõttele ostmisel ka ettevõtte nime, registrikoodi ja soovi korral Eesti KMKR numbrit. Maksuarvestus järgib poe olemasolevat Eesti 24% standardmäära või käibemaksukohustuseta müüja käsitlust. See muudatus ei lisa teisi maksumäärasid, ühendusesisest müüki ega osalisi tagastusi.

Ettevõtluskontoga eraisikule koostatakse müügitõend ja täielikul tagastusel tagastustõend. Dokumendis on müüja ees- ja perekonnanimi, aadress ja kontakt-e-post; müüja registrikoodi, isikukoodi ega pangakonto andmeid sinna ei lisata. Müük on käibemaksuta. Ettevõttest ostja arveandmed säilivad ka eraisikult ostes. Dokumendi nimetus, PDF-manus ja allalaadimisnupp lähtuvad ostu hetkel salvestatud müüja tüübist.

Poeruumi teenustasu käibemaks on müüja kauba käibemaksust eraldi: ettevõtluskonto kasutajale kehtib samuti teenustasu koos käibemaksuga. Migratsioon `202609300008_cap_gross_platform_fees.sql` piirab uusi paindliku paketi tasureserveeringuid nii 39 € neto- kui ka 48,36 € brutokuulaega. See arvestab iga makse käibemaksu sendiümardust ning hoiab test- ja pärismaksete limiidid eraldi. Olemasolevaid makseid ega tasusid ei arvutata ümber. Kaupmehe kuuülevaade liidab salvestatud netotasud ja käibemaksu eraldi; tagastamisel ja pärast tagastust ei kuvata algset summat tulevase laekumisena.

PDF-i ühikuhinnad ja summad kuvatakse kahe komakohaga. Kui ümardatud netoühikuhind korda kogus erineb salvestatud netoreasummast, lisatakse tabelisse „Ümardus” veerg: reasumma = kogus × hind KM-ta + ümardus. Nii jäävad arve algsed netosumma, käibemaks ja tasutud summa muutumatuks ning sendivahe on nähtav. Kreeditarvel pööratakse ka ümarduse märk ümber. Juba salvestatud PDF-e ei kirjutata üle.

Ostukorv ja Stripe'i makse algatamine kasutavad ühist sendipõhist summade ja tasuta tarne piiri arvutust (`shared/order-pricing.ts`). Eurodeks teisendatakse summad alles kuvamisel.

## Poeruumi käibemaksukohustus

Animaator OÜ (registrikood 17135632) on kasutaja esitatud MTA 01.10.2026 teate järgi käibemaksukohustuslane alates 01.10.2026, KMKR number EE103036036. Ühised teenusepakkuja andmed asuvad `shared/platform-business.mjs`; kasutustingimused, nende struktureeritud andmed ja Stripe'i arved kasutavad neid. Maksumäära algus on Eesti kesköö ehk `2026-09-30T21:00:00Z`. Uute maksete tasureserveeringud arvestavad registreerimise algust; olemasolevaid tasusid ja väljastatud dokumente ei arvutata ümber.

Poeruumi enda teenustasu arve on müüja ostjale väljastatavast tellimuse dokumendist eraldi. Poeruumi registreerimine ei tee ettevõtluskontoga eraisikut käibemaksukohustuslaseks ega lisa tema kauba hinnale käibemaksu. Näiteks 100 € toodete müügilt on Poeruumi tasu 4 € + 0,96 € KM; kuulae korral kuni 39 € + 9,36 € KM. Kuutasu on 29 € + 6,96 € KM. Stripe'i tegelik maksetöötlustasu peetakse kinni eraldi.

### Paindliku paketi arved

Migratsioon `202610010001_platform_fee_invoices.sql` loob eraldi `platform_fee_documents` tabeli ja globaalse aastapõhise nummerduse `PF-2026-000001`. Testrežiimi dokumendid kasutavad eraldi järjestust ning `TEST-` eesliidet. Arve luuakse samas andmebaasitehingus teenustasu tulukandega pärast kinnitatud Stripe'i arveldust. Nulltasule arvet ei tehta. Summa ja käibemaks võetakse tegelikust salvestatud tasust; arve saaja on ostu hetkel jäädvustatud müüja juriidiline nimi ja aadress. Hilisem poeandmete muutmine arvet ei muuda.

Täieliku tagastuse kreeditarve luuakse pärast teenustasu tagastamise tulukannet. See viitab algsele arvele ning säilitab selle maksu- ja isikuandmed. Kaupmehe isikukoodi ega pangakontot dokumendile ei lisata. PDF ütleb „Tasutud tasaarvestusega” või „Teenustasu krediteeritud”, sest teenustasu arveldatakse müügilaekumisest.

`order-emails` koostab need PDF-id ka peatatud kirjasaatmise korral. Müüja saab need alla laadida poe seadete arveldusvaatest. `platform-invoices` nõuab sisselogitud poe omanikku ning kontrollib poe ja Stripe'i režiimi kuuluvust. Ostja tellimuse token ei anna ligipääsu Poeruumi tasuarvele. Failid on privaatsed, muutumatud ja räsi kontrolliga; säilitamine ja kustutamisjärjekord järgivad olemasolevate ostuarvete korda. Eraldi tasuarve e-kirja ei saadeta; elektrooniline kättesaadavus on kirjeldatud kasutustingimustes.

### Kindla paketi Stripe'i arved

Kuutasu makse alustamine nõuab kaupmehe juriidilist nime, aadressi ja kontaktandmeid. Ettevõtte puhul salvestatakse Stripe'i kliendi arveandmetesse ka registrikood ning vajaduse korral KMKR; ettevõtluskonto kasutajale ei jäeta alles varasema ettevõtte maksu-ID-d. Poeruumi täielikud väljastajaandmed, sh aadress ja KMKR, lisatakse arve jalusesse. `invoice.created` uuendab korduva arve mustandi andmeid; hilinenud sündmus ei kirjuta üle kinnitatud arvet.

01.10.2026 lisati Stripe'i päriskontole EE103036036 ning kasutaja määras selle töölaual vaikimisi kasutatavaks. Järgnev API kontroll kinnitas `taxIdExists=true` ja `defaultForInvoices=true`. `npm run stripe:platform-vat -- verify live` kontrollib seda uuesti. Oma konto vaikimisi maksu-ID-d ei saa muuta Connected Accounts API kaudu. Testkonto seadistus on eraldi.

Tulude ülevaade kasutab tasutud arve soodustuste järgset netosummat, mitte KM-ga laekumist ega soodustuseelset vahesummat. Kliendisaldo kasutamine ei muuda arve teenuse netosummat. Kreeditarved vähendavad tulu ühe korra ka korduvate või teises järjekorras sündmuste korral. Tasumata arve krediit ei vähenda veel kogutud tulu; tasutuks muutudes arvestatakse algne arve ja selle kehtivad krediidid koos. Teiste rakenduste arved ning testmaksete tulud ei kuulu Poeruumi päristulude ülevaatesse. Kuutasu arved ja kreeditarved jäävad kättesaadavaks Stripe'i arveldusportaalis ka pärast Paindlikule paketile naasmist.

Kaupmehe tellimused laaditakse lehekülgede kaupa, et andmebaasi vastuse suuruse piir ei jätaks suurema müügimahuga poe kuu tasusid arvestusest välja. Päris- ja testtellimused eristatakse poe Stripe'i konto režiimi järgi ning kalendrikuu määratakse Eesti ajas.

### Eraldi lahendamist vajav maksuarvestus

- Enne registreerimist oli kahest pärismaksest kinni peetud kokku 0,25 € platvormitasu käibemaksu. Seda ei ole automaatselt tagastatud ega uue numbriga tagantjärele arveldatud. Korrigeerimise ja võimaliku deklareerimise peab määrama raamatupidaja.
- Arvete loomine ja administraatori netotulude ülevaade ei koosta KMD-d ega asenda raamatupidamist. Arved, Stripe'i kulud, sisendkäibemaks ja võimalik välismaiste teenuste pöördmaksustamine tuleb raamatupidamisse võtta.
- Stripe'ile endale makstavate teenustasude maksuandmed vajavad eraldi kontrolli Stripe'i ettevõtte maksuandmetes. Arvetel kuvatava KMKR määramine üksi ei tõenda teenusepakkuja kulude maksukäsitlust.
- Ettevõtluskontole jõuab praeguse arveldusmudeliga müük pärast Poeruumi ja Stripe'i tasusid. Ettevõtluskonto kulude mahaarvamise keelu tõttu vajab selle netolaekumise mudeli maksukäsitlus MTA kirjalikku kinnitust; käibemaksukohustuslaseks registreerimine seda küsimust ei lahenda.
- Stripe'i maksetöötluskulu edasikandmise dokumenteerimine ja käibemaksukäsitlus vajavad raamatupidaja hinnangut lepingulisele rollijaotusele. Tarkvara kasutab tegelikku Stripe'i kulu ega lisa sellele oletuslikku käibemaksu.
- DAC7 aruandluse väljastamist ega selle jaoks täielikku eraldi protsessi ei ole lisatud. Käibemaksukohustus ei kõrvalda platvormi võimalikku aruandluskohustust.

## Andmed ja väljastamine

- `create_invoiced_stripe_order` reserveerib kauba ning salvestab `orders.invoice_snapshot` samas tehingus. Müüja, ostja, hinnad, käibemaks ja tarne on pärast seda muutumatud. Korduspäring ei muuda vana müüjaandmestikku; ostja arveandmete muutmine nõuab uut ostukatset.
- `complete_invoiced_stripe_order` saab kontrollitud Stripe Charge'i aja, kinnitab makse ja käivitab arve väljastamise. `order_documents` sisaldab ühe tellimuse kohta maksimaalselt üht arvet ja üht täieliku tagastuse kreeditarvet.
- Number on näiteks `PR12-2026-000123`. Püsiv `PR12` tähistab poodi; poe ja aasta sees kasutatakse ühist järjestust arvetele ja kreeditarvetele. Testrežiimil on eraldi järjestus ja `TEST-` eesliide. Nummerdus ja dokumendi loomine on tehingulised ning taluvad samaaegseid makseid.
- Kreeditarve luuakse alles pärast `payment_status = refunded` kinnitamist. Selle aluseks on algse arve muutumatu andmestik ja algse arve number. PDF-il on summad negatiivsed.
- Varem loodud ostudele ei koostata tagantjärele arveid praeguste poeandmete põhjal. Enne uuendust juba Stripe'i saadetud maksekatse säilitab varasema käitumise.

## PDF, kirjad ja ligipääs

`order_documents` on ühtlasi PDF-i koostamise järjekord: töö saab aeguvaks ajaks lukustada ning ebaõnnestunud katset korratakse. `order-emails` töötleb seda olemasoleva minutipõhise ajastusega. Aktiivse ostu kinnituskirja koostamine võib PDF-i kohe valmis teha, ootamata järgmist ajastatud käivitust.

Fail asub privaatses `order-documents` hoidlas kujul `<dokumendi UUID>.pdf`. Faili ei kirjutata üle. Katkenud üleslaadimise või andmebaasivastuse järel kasutatakse olemasolevat faili; allalaadimisel kontrollitakse SHA-256 räsi. Noto Sans on SIL OFL litsentsiga manustatud serverikoodi, nii et PDF-i koostamine ei sõltu välisest fondivõrgupäringust ega eraldi staatiliste failide juurutusest.

Arve ja kreeditarve päisesse lisatakse ostu andmestikku salvestatud poe logo, kui see on kättesaadav. PNG- ja JPEG-pildid manustatakse otse, poe üleslaadimisel tekkiv WebP teisendatakse läbipaistvust säilitades PNG-ks. Logo mahutatakse proportsioone muutmata 160 × 52 pt alale. Laadimine piirdub oma Supabase'i avaliku pildihoidlaga, kolme sekundi ja 2 MB-ga; puuduv või vigane logo ei takista arve koostamist. Logo jääb valmis PDF-i sisse ning hilisem poe logo muutmine juba väljastatud arvet ei muuda. WebP dekooder on koos litsentsidega manustatud kausta `_shared/invoice-image`, et teisendamine ei vajaks välist teenust ega käitusajal lisafailide laadimist.

Ostja arve ja kreeditarve saadetakse alati. Müüja kirjad järgivad müüja teavituste eelistust. Algne kinnituskirja kujundus säilib; arve lisatakse manusena ja kirjale lisandub tellimuse privaatne link. Saatmisel säilitatakse olemasolev lukustus, täpne salvestatud kirjasisu, Resendi idempotentsus ja kättetoimetamise sündmuste kontroll. Kreeditarvel on eraldi saatmisülesanded ja võtmed, mis ei kirjuta üle algse kinnituse olekut.

`order-documents` Edge Function lubab ainult POST-päringuid. Ostja kasutab olemasolevat salajast tellimuse tokenit; müüja peab olema sisse logitud ja vastava poe omanik. Tellimuse number või dokumendi UUID üksi ligipääsu ei anna. Dokumendi kuuluvust tellimusele ja Stripe'i režiimi kontrollitakse enne faili lugemist. Avalikke failiaadresse ei väljastata.

Arved säilivad ka poe konto kustutamisel. Olemasoleva tellimuste säilitamise tähtaja lõppu pikendatakse vajadusel kaheksa aastani viimase dokumendi väljastamisest; õigusliku säilitamispiiranguga tellimusi ei kustutata. Tellimuse tähtajaline kustutamine lisab PDF-id eraldi kustutusjärjekorda, mida töötleb `order-emails`. Nii ei jää salvestusruumi orvuks jäänud arvefaile.

## Juurutamine

01.10.2026 uuenduse avaldamisjärjekord (Stripe'i päriskonto KMKR seadistus on kinnitatud):

1. Rakenda `202610010001_platform_fee_invoices.sql`. Selle eelduseks on varasemad ostuarvete, ettevõtluskonto ja tasureserveeringute migratsioonid. Tagantjärele luuakse ainult registreerimise järel kinnitatud tasude arved, mille muutumatud müüjaandmed on olemas.
2. Avalda `stripe-billing-checkout`, `stripe-webhook`, `order-emails`, `order-documents`, `order-receipt` ja uus `platform-invoices`, samuti ühiseid arvefaile kasutavad funktsioonid. `supabase:deploy` täielik loend sisaldab uut funktsiooni.
3. Lisa Poeruumi olemasolevale Stripe'i webhookile `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `credit_note.created`, `credit_note.voided`; `node scripts/configure-stripe-settlement-webhook.mjs apply` säilitab muud sündmused ja kontrollib režiimi.
4. Avalda veebirakendus pärast CI läbimist. Kontrolli seadete arveldusvaatest PDF-i ja Stripe'i arveldusportaali. Testkonto KMKR tuleb enne seal kuutasu päristesti eraldi seadistada.

Enne 01.10.2026 uuenduse avaldamist puudusid olemasolevast webhookist `invoice.created`, `credit_note.created` ja `credit_note.voided`; need tuleb lisada pärast uue serverikoodi avaldamist. Kohaliku testvõtmega konto ei läbinud Animaator OÜ ettevõtteandmete kontrolli ja seda ei muudetud. Seetõttu ei ole päris Stripe'i testkeskkonnas uut kuutasu arvet väljastatud; serveritestid kasutavad kontrollitud testvastuseid.

Esialgse ostuarvete lahenduse eeldused:

1. Rakenda `202609240001_order_invoices.sql` enne uue serverikoodi avaldamist.
2. Juuruta `stripe-store-checkout`, `stripe-webhook`, `stripe-reservation-reaper`, `order-receipt`, `order-emails`, `resend-webhook` ning uus `order-documents`. Uuenda ka ühiseid makse- või kirjamooduleid kasutavaid teisi funktsioone; `npm run supabase:functions:deploy` sisaldab täielikku loendit.
3. Avalda veebirakendus. Uus kassa saadab nõutud arveaadressi; vanas avatud kassas tuleb lehte uuendada.
4. Kontrolli olemasolevat `poeruum-order-emails` ajastust ning Vaulti `onboarding_reminders_url` ja `onboarding_cron_secret` väärtusi. Vajalikud on ka senised `APP_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY` ning Supabase'i serverivõti.

`ORDER_EMAIL_WORKER_ENABLED=false` peatab kirjade saatmise, kuid ajastatud PDF-i koostamine ja aegunud failide koristamine jätkuvad. Stripe Checkouti `invoice_creation` jääb välja lülitatuks. Stripe'i enda maksekviitungite e-posti seadistust see muudatus ei muuda.

## Kontrollid

```sh
npm test
npm run check:edge
npm run test:order-invoice-edge
npm run test:order-email-edge
npm run test:order-receipt-edge
npm run test:payment-recovery-edge
npm run test:entrepreneur-sellers
npm run test:platform-billing-db
npm run test:platform-invoices-edge
npm run test:subscription-invoices-edge
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/test-order-invoices.sql
node scripts/test-order-invoice-concurrency.mjs
node node_modules/@playwright/test/cli.js test --project=platform-auth -g 'checkout|receipt|invoice'
npm run build:app
```

Need arvetestid kasutavad kohalikku andmebaasi või asendavad võrgupäringud testvastustega. Päris makseid ega kirjade saatmist nad ei tee.

01.10.2026 kohaliku kontrolli tulemus: 515 ühiktesti; arve, kviitungi, kirjatöötluse, maksete taastamise, maksekaitsete, platvormiarvete ja allkirjastatud kuutasusündmuste Edge-testid; ettevõtluskonto ja uue platvormiarvelduse SQL-testid; olemasolevad arvelduse, arvete, taastamise ja maksekaitsete SQL-testid uue migratsiooniga; kolm seotud brauseritesti (tagastus, tasuarve allalaadimine/veast taastumine/telefonivaade, kuu käibemaksu ümardused). Lint, Edge-tüübikontroll ja rakenduse ehitus läbisid. Kaug-CI ja avaldatud rakenduse järelkontroll on eraldi avaldamissammud.

Kassa Edge-test võrdleb 36 ettevõtluskonto ja ettevõtte ostustsenaariumis Stripe'i, andmebaasi ja dokumendi summasid: eraisikust/ettevõttest ostja, soodushind, kogused, tasuline tarne, järeletulemine ning tasuta tarne piir. Ettevõtluskonto andmebaasitest kontrollib ka väikeste ostude kuulae ümardust, testmaksete eraldatust, korduspäringuid ja aegunud tasureserveeringu vabanemist. Uus kuulae migratsioon tuleb rakendada enne selle paranduse veebiversiooni avaldamist.

Viited: [MTA arve väljastamise juhend](https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks/kaibemaksuarvestus-ja-arved/arve-valjastamine), [MTA arve andmed](https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks/kaibemaksuarvestus-ja-arved/arvele-margitavad-andmed), [MTA ettevõtluskonto juhend](https://www.emta.ee/eraklient/maksud-ja-tasumine/maksustatavad-tulud/ettevotluskonto), [Stripe'i maksekviitungid ja arved](https://docs.stripe.com/receipts), [Stripe'i konto maksu-ID](https://docs.stripe.com/tax/invoicing/tax-ids), [Stripe'i kreeditarved](https://docs.stripe.com/invoicing/dashboard/credit-notes).
