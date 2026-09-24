# Ostuarved

Poeruum koostab uue ostuvoo tellimustele müüja nimel tasutud PDF-arve. Kassas küsitakse ostja arveaadressi; ettevõttele ostmisel ka ettevõtte nime, registrikoodi ja soovi korral Eesti KMKR numbrit. Maksuarvestus järgib poe olemasolevat Eesti 24% standardmäära või käibemaksukohustuseta müüja käsitlust. See muudatus ei lisa teisi maksumäärasid, ühendusesisest müüki ega osalisi tagastusi.

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
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/test-order-invoices.sql
node scripts/test-order-invoice-concurrency.mjs
node node_modules/@playwright/test/cli.js test --project=platform-auth -g 'checkout|receipt|invoice'
npm run build:app
```

Need arvetestid kasutavad kohalikku andmebaasi või asendavad võrgupäringud testvastustega. Päris makseid ega kirjade saatmist nad ei tee.

Viited: [MTA arve väljastamise juhend](https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks/kaibemaksuarvestus-ja-arved/arve-valjastamine), [MTA arve andmed](https://www.emta.ee/node/334/chapter/10090/pdf), [Stripe'i maksekviitungid ja arved](https://docs.stripe.com/receipts).
