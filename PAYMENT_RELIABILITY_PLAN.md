# Maksete töökindluse parandused

Töö on jagatud kuueks osaks. Iga osa sisaldab oma teste; tootmises rakendamine
ja sellele järgnev kontroll märgitakse eraldi. Testides ei kasutata päris
ostjate raha ega saadeta neile kirju.

## 1. Tasutud tellimuse kinnitamine

**Olek: kood teostatud ja kontrollitud. Tootmise juurutamine toimub alloleva järjekorra järgi.**

Edukalt kontrollitud makse märgib tellimuse tasutuks ja kinnitab laoseisu enne
teenustasu andmete laadimist või müüjale ülekannet. Kirjade saatmist ja
tasuarvestust proovitakse sõltumatult; kummagi tõrge säilitab korduskatse
võimaluse. Makse summa, valuuta, režiim ja seos tellimusega kontrollitakse
enne kinnitamist. Hilinenud korduskatse ei ava tagastatud tellimust uuesti.

Vastuvõtutingimus: puuduv Stripe'i teenustasu või ebaõnnestunud ülekanne ei
takista tasutud tellimust ega kinnituskirjade saatmiskatset. Andmebaasi
kinnituse tõrke korral ei saadeta kinnituskirju ega tehta ülekannet.

Esimese osa eraldi kontroll 9. septembril 2026:

- Kõik 252 üksustesti läbivad, sh 20 uut makse- ja tagastuse testi. Stripe'i
  ja meiliteenuse päringud on neis testides asendatud kontrollitud vastustega.
- Uus SQL-test kontrollib makse kinnitamist enne ülekannet, korduskatsete
  mõju laoseisule, makseviidete seost ning tagastuse säilimist.
- Kõik migratsioonid rakendusid eraldi tühjas kohalikus Supabase'i andmebaasis.
  SQL-test ja andmebaasi lint läbisid kontrolli.
- ESLint, Edge Functionite tüübikontroll, rakenduse build ja sõltuvuste audit
  läbisid kontrolli. Päris Stripe'i testkeskkonna kogu ostuvoogu selles etapis
  ei käivitatud.

Selle etapi seos järgmiste osadega:

- Tasuarvestuse ja tagastuse ajutised piirangud asendab allpool kirjeldatud osa 2.
- Kliendi- ja müüjakirjade eraldi püsiva järjekorra lisab osa 3.
- Tootmisesse juurutamine toimub osade 1–3 ühise komplektina.

## 2. Teenustasud ja müüjale ülekanne

**Olek: kood teostatud ja kontrollitud. Tootmise juurutamine toimub alloleva järjekorra järgi.**

- Maksekinnitus salvestab samas andmebaasitehingus püsiva tasuarvestuse töö.
  Serveri katkestus ei kaota ülesannet.
- Puuduvat Stripe'i teenustasu käsitletakse ootamisena. `charge.updated`
  jätkab tööd kohe; iga minuti järel käiv taustatöö katab ajutised tõrked
  ja puuduvad tasuandmete sündmused. Üldine puuduva maksekinnituse taastamine
  jääb ossa 5.
- Ülekanne ja tagastus kasutavad sama ühe tellimuse tööjärge. Korraga saab
  tööd teha üks töötleja; aegunud õigusega töötleja ei saa tulemust salvestada.
- Ülekande parameetrid salvestatakse enne Stripe'i päringut. Katkenud vastuse
  korral leitakse olemasolev ülekanne või korratakse sama päringut sama võtmega.
  Ülekande tulemus ja Poeruumi tulukanne salvestatakse koos ning ühekordselt.
- Tagastust saab algatada ka enne müüjale ülekannet. Pooleliolev ülekanne
  lahendatakse enne tagastust ja vajadusel pööratakse tagasi. Ootav tagastus
  ei muuda tellimust tagastatuks enne Stripe'i edukat kinnitust.
- Müüja näeb olekut „Tagastamisel”; vaade kontrollib pooleliolevat tagastust
  iga 15 sekundi järel ja aknasse naastes. Käsitsi kontrolli vajav tagastus
  kuvatakse eraldi.
- Ebaselge tulemusega rahaliigutust ei korrata automaatselt üle 20 tunni
  möödudes. Olemasolevat tulemust saab endiselt Stripe'ist taastada; kui seda
  ei leita, läheb töö olekusse `needs_review`. Osalised või mitmed välised
  tagastused vajavad samuti kontrolli.

Kontrollitud 9. septembril 2026:

- Kõik 273 üksustesti, ESLint, Edge Functionite tüübikontroll, rakenduse build
  ja sõltuvuste audit läbivad; audit ei leidnud turvanõrkusi.

- Üksustestid katavad 76 sekundit hilinenud teenustasu, samaaegsed käivitused,
  katkenud Stripe'i vastused, salvestusvead, tagastuse eri ajastused,
  ootava tagastuse ja aegunud korduskatse. Stripe'i ja kirjade päringud on
  neis asendatud kontrollitud vastustega.
- SQL-testid katavad ülesande atomaarse loomise, ligipääsupiirangud, töö
  lukustuse, aegunud töötleja tõrjumise, muutumatu päringu, ühekordse
  tulukande ning tulu salvestamise tõrke täieliku tagasipööramise.
- Kõik migratsioonid rakendusid eraldi tühjas kohalikus Supabase'i andmebaasis;
  mõlemad uued SQL-testid ja andmebaasi lint läbivad. Ajakava loomist kontrolliti
  eraldi tagasipööratud tehingus testseadistustega, HTTP-tööd käivitamata.
- 74 olemasolevat brauseritesti ja uus tagastuse brauseritest läbivad.
  Uus test kontrollib, et „Tagastamisel” muutub „Tagastatud” olekuks alles
  serveri kinnituse järel.
- Tootmise Stripe'i endpoint'i ainult lugemise kontroll kinnitas, et
  `charge.updated`, `refund.updated` ja `refund.failed` on veel lisamata.
  `scripts/configure-stripe-settlement-webhook.mjs check` kontrollib seadistust;
  `apply` lisab sündmused olemasolevaid tellimusi eemaldamata.
- Päris Stripe'i testkeskkonna kogu ostuvoogu selles etapis ei käivitatud.
  Stagingu E2E on uuendatud kasutama sama taustatööd.

Juurutamisel kuuluvad kokku:

1. Kontrollida enne migratsiooni Vaulti seadistusi `onboarding_reminders_url`
   ja `onboarding_cron_secret`; viimane peab vastama Edge'i saladusele
   `ONBOARDING_CRON_SECRET`. Puuduvate väärtuste korral migratsioon ajakava
   ei loo. Vajalikud väärtused tuleb seadistada enne migratsiooni.
2. Seada `STRIPE_SETTLEMENT_WORKER_ENABLED=false` ja
   `ORDER_EMAIL_WORKER_ENABLED=false`. Rakendada migratsioonid `202609090001`,
   `202609090002` ja `202609090003` ning juurutada `stripe-webhook`,
   `stripe-order-settlements`, `stripe-refund-order`, `order-emails`,
   `resend-webhook` ja uuendatud kasutajaliides. Uus töövoog salvestab sel ajal
   ülesanded ootele.
3. Kontrollida, et vana funktsiooniversiooni pooleliolevad päringud on
   lõppenud, enne kui uus rahaliigutuste töötleja sisse lülitatakse.
4. Käivitada õige keskkonna võtmetega
   `node scripts/configure-stripe-settlement-webhook.mjs apply` ning seejärel
   `check`. Resendi sündmuste jaoks kasutada
   `node scripts/configure-order-email-webhook.mjs apply` ja `check`.
   Kontrollida `cron.job` kirjeid `poeruum-stripe-order-settlements` ja
   `poeruum-order-emails`: mõlema aktiivne ajakava peab olema `* * * * *`.
5. Seada `STRIPE_SETTLEMENT_WORKER_ENABLED=true` ja
   `ORDER_EMAIL_WORKER_ENABLED=true`. Kontrollida taustatööde
   autentimist, õiget Stripe'i režiimi ja ülesannete tegelikku lõpetamist.
   Uue koodi kohalik test ei tähenda tootmise parandamist.

## 3. Kliendi- ja müüjakirjad

**Olek: kood teostatud ja kontrollitud. Tootmise juurutamine toimub alloleva järjekorra järgi.**

- Tellimuse tasutuks märkimine salvestab samas andmebaasitehingus kaks eraldi
  saatmisülesannet. Ühe saaja tõrge ei peata teise kirja saatmist ega müüjale
  ülekannet. Korduskatse jätkab ainult pooleliolevat saatmist.
- Saatmist proovitakse kohe maksekinnituse järel. Püsiv järjekord ja iga minuti
  järel käiv `order-emails` jätkavad pärast katkestust; ajutised vead kasutavad
  kasvavat korduskatse viivitust. Poe keelatud teavitused jäetakse vahele.
- Enne esimest saatmist kontrollitakse tellimuse makseolekut, poe seadistust
  ning saaja aadressi. Müüja aadressiks kasutatakse tellimuste e-posti, selle
  puudumisel poe kontaktaadressi või omaniku aadressi.
- Kirja täpne sisu, saaja ja saatmisvõti säilivad korduskatsete vahel. Resendi
  tagastatud kirjatunnus ning tellimuse saatmisaeg salvestatakse atomaarse
  toiminguna. Sama ülesande paralleelsed töötlejad ei saada iseseisvaid kirju.
- Resendi allkirjastatud sündmus salvestab kohaletoimetamise oleku ja sündmuse
  vastuvõtmise ühe tehinguga. Ka enne saatmispäringu vastust saabunud sündmus
  seotakse õige tellimuse ja saajaga. Hilinenud `email.sent` ei muuda juba
  kohaletoimetatud kirja olekut tagasi.
- Eraldi salvestatakse saatmise vastuvõtmine, kohaletoimetamise viivitus,
  kohaletoimetamine, püsiv viga, tagasipõrge, rämpspostikaebus ja blokeerimine.
  Administraatori kirjaloendis eristatakse vastuvõtmist ja kohaletoimetamist.
- Tootmise ainult lugemise kontroll kinnitas, et `email.delivery_delayed` ja
  `email.suppressed` tuleb Resendi olemasolevale endpoint'ile veel lisada.
  Ülejäänud vajalikud kohaletoimetamise sündmused on juba tellitud.

Kontrollitud 9. septembril 2026:

- 298 üksustesti, sealhulgas 25 uut kirjade järjekorra ja sündmuste testi;
  varasemad maksekinnituse testid kasutavad nüüd tegelikku uut kirjatöötlejat
  koos kontrollitud meiliteenuse vastustega.
- 75 brauseritesti, ESLint, Edge Functionite tüübikontroll, build ja audit.
- Tegelike Edge-käitlejate test kontrollib Resendi allkirja, andmebaasitõrke
  järel korduskatset ning taustatöö autentimist ja väljalülitamise lülitit.
  Kõik HTTP-päringud on selles testis asendatud; ühtegi kirja ei saadeta.
- SQL-test kontrollib atomaarset ülesannete loomist, saajate sõltumatust,
  ligipääsupiiranguid, aegunud tööõigust, muutumatut kirja, sündmuste eri
  järjekorda ja täielikku tagasipööramist salvestusvea korral.
- Migratsiooni test kontrollib vanade saadetud ja ebaselgete kirjade ülevõtmist
  ning ajakava loomist. Kõik migratsioonid rakendusid eraldi tühjas kohalikus
  andmebaasis; andmebaasi lint läbib.

Piirid ja juurutamine:

- Juba vastu võetud kirja ei saadeta uuesti pelgalt kohaletoimetamise viivituse
  või tagasipõrke tõttu. Püsiv viga vajab põhjuse kontrolli.
- Üle 20 tunni vanuse ebaselge saatmiskatse automaatne kordamine peatatakse
  enne meiliteenuse duplikaadikaitse aegumist. Hilisem allkirjastatud sündmus
  saab selle siiski lahendada. Vt [Resendi saatmisvõtmete kirjeldus](https://resend.com/docs/dashboard/emails/idempotency-keys)
  ja [kohaletoimetamise sündmused](https://resend.com/docs/webhooks/event-types).
- Varem tasutud tellimuste puuduvat saatmisaega ei tõlgendata tõendina, et kiri
  jäi saatmata: need ülesanded saavad oleku `needs_review`. Vanad kinnitatud
  saatmised võetakse üle ilma kordussaatmiseta, ka juurutamise ajal lõpetatud
  saatmise puhul. Vanade juhtumite üldine taastamine jääb ossa 5.
- Juurutamiseks tuleb järgida osade 1–3 ühist järjekorda eespool. Kood,
  andmebaasimigratsioon, kirjatöötleja ja Resendi sündmuste käitleja peavad
  olema kooskõlas enne saatmise lubamist.
- Päris kirju ega makseid selle etapi testides ei tehtud. Tootmise ostuvoo
  kontroll toimub pärast juurutamist.

## 4. Maksmine ja ostukinnitus

**Olek: kood teostatud ja kohalikult kontrollitud. Linki sisselogitud kasutaja
kogu ostuvoo eraldi kontroll on veel tegemata.**

- Nupp „Edasi maksma · summa” avab Stripe'i makselehe; selgitus eristab seda
  makse kinnitamisest. Linki salvestatud andmed võivad võimaldada maksmist
  eraldi pangakinnituseta. Stripe'i makseleht kasutab `submit_type=pay`.
- Püsiv tellimuse ülevaade näitab numbrit, summat, tooteid ja valikuid,
  tarneinfot ning tellimuse aega Eesti ajas. Uus vaade ei sõltu poe avalikkusest
  ega praegu müügil olevatest toodetest ning säilib värskendamisel.
- Uue tellimuse link sisaldab 256-bitist juhuslikku tunnust URL-i fragmendis.
  Tunnus asub eraldi privaatses tabelis; kliendile pole lubatud selle lugemine
  ega loomine. Korduskatse ei muuda sama tellimuse linki. Vanad tagasitulekud
  saavad kasutada Stripe'i juhuslikku Checkout Session ID-d.
- Server tagastab ainult tellimuse ülevaate jaoks vajaliku hetktõmmise.
  URL-i `success` ega `cancelled` väärtus ei kinnita tulemust. Tundmatu link
  ei anna tellimuse andmeid ning võrguviga ei muutu ebaõnnestunud makseks.
- Stripe'is tasutud, kuid veel kinnitamata tellimus kontrollitakse sama
  maksekinnituse loogikaga: tellimuse seos, summa, valuuta, režiim ja tegelik
  maksekanne. Alles salvestatud kinnitus annab oleku „Makse õnnestus”.
  Samas tehingus tekivad osade 2–3 taustatööd; kinnituspäring ei saada kirju
  ega tee ülekandeid. Sündmuse ja kinnituslehe võistlus ei dubleeri laoseisu.
- Vaade eristab kontrollimist, lõpetamata makset, edukat ja ebaõnnestunud
  makset, aegunud makselehte ning kinnitatud tagastust. Pooleliolevat makset
  kontrollitakse viie sekundi järel kuni kaks minutit; hiljem saab kontrolli
  uuesti käivitada. Aknasse naasmine ja võrgu taastumine alustavad uut kontrolli.
- Lõpetamata makset jätkatakse samal Stripe'i makselehel. Ootel maksele ei
  pakuta uut makset. Brauseri sulgemise järel jätkavad sündmused ja taustatööd.
- Ka tootmise Node-server serveerib kinnituslehte enne poe otsingut ja SEO
  ümbersuunamisi. Leht ja API on `no-store`, `noindex` ja `no-referrer`.

Kontrollitud 9. septembril 2026:

- 324 üksustesti, sh 26 uut maksekinnituse ja lingi ligipääsu testi;
  Edge'i tüübikontroll, ESLint, build ja sõltuvuste audit läbivad.
- 82 brauseritesti, sh seitse uut kinnitusvaate ja maksmise selgituse testi,
  läbivad. Arvuti ja telefoni vaated on ka visuaalselt üle vaadatud.
- Tegelike Edge-käitlejate test kontrollib privaatseid tagasituleku URL-e,
  seansi salvestusvea kordamist, ligipääsu ja päringupiirangut, makse kontrolli
  ning korduvat avamist. HTTP-päringud on selles testis asendatud.
- Tootmise HTTP-serveri test katab poe aadressi platvormi teel, alamdomeenil,
  oma domeenil ning vana tagasituleku; ükski neist ei kaota kinnituslinki.
- Uus SQL-test kontrollib tunnuse püsivust, ligipääsuõigusi, kustutamist ja
  ühekordseid järelülesandeid. Kõik migratsioonid rakendusid eraldi tühjas
  kohalikus andmebaasis; andmebaasi lint läbib.
- Stripe'i sandboxis kontrolliti uue kliendi maksevormi, Linki andmete
  salvestamise valikut ning uute tagasituleku URL-ide vastuvõtmist. Kogu
  Linki ostu ja sisselogitud korduvostja läbivat testi ei lõpetatud: Stripe'i
  agentidele näidatav vahevoog suunas eraldi Link CLI kasutamisele. Pärisostjate
  andmeid, kaarte, raha ega kirju kontrollimiseks ei kasutatud.
- Linki käitumise viide: [Stripe Link koos Checkoutiga](https://docs.stripe.com/payments/link/checkout-link).
  Maksekinnituse viide: [Stripe Checkouti tellimuste kinnitamine](https://docs.stripe.com/checkout/fulfillment).

Osade 1–4 ühine juurutamine:

1. Läbida eespool osade 1–3 ettevalmistus. Rakendada ka migratsioon
   `202609090004_private_order_receipts.sql` ja funktsioon `order-receipt`.
2. Juurutada uus Node-server ja kasutajaliides pärast edukat CI-d.
3. Alles uue kasutajaliidese järel juurutada `stripe-store-checkout`, et
   esimesed uued kinnituslingid avaneksid juba õiges vaates.
4. Kontrollida tootmises makstud tellimuse lugemist, vigase lingi tõrjumist,
   kinnituslehe HTTP-päiseid ja mõlema taustatöö tegelikku käivitumist.

## 5. Poolelijäänud tegevuste taastamine

**Olek: tegemata.**

- Leida Stripe'is tasutud, kuid Poeruumis ootel tellimused.
- Taastada poolelijäänud tasuarvestus ja kirjade saatmine.
- Võimaldada katkestatud sündmuse uuesti töötlemist ka siis, kui selle
  vastuvõtmine on juba salvestatud, kuid lõpetamise märge puudub.
- Kontrollida samaaegseid korduskatseid, sündmuste erinevat järjekorda ja
  juba tagastatud makseid. Tasutud tellimuse reserveeringut ei vabastata.

Vastuvõtutingimus: puuduva sündmuse või katkestatud töö järel taastub õige
olek automaatselt ilma topeltlaoseisu muutuse, ülekande või kirjadeta.

## 6. Alarmid ja kontrollitud taastumine

**Olek: tegemata.**

- Siduda maksealarm konkreetse tellimuse ja poolelioleva tegevusega.
- Hoida alarm avatuna kuni kontrollitud lahenduseni, sõltumata vealogi vanusest.
- Lisada alarmi pood, tellimuse number, mõju, kestus ja viimase katse tulemus.
- Saata taastumisteade alles pärast vastava tegevuse edukat lõpetamist.
- Sõnastada üldine vealoenduri normaliseerumine eraldi, ilma kogu süsteemi
  taastumist väitmata. Kuvada kasutajale aeg Eesti ajas.

Vastuvõtutingimus: 15 minuti jooksul uute vigade puudumine ei sulge alarmi,
kui tasutud tellimus või selle vajalik järeltoiming on ikka pooleli.
