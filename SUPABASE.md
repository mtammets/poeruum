# Supabase'i käivitamine

## Kaubamaja avalehe tootevalik

Avaleht kuvab enne poeloendit kuni kaheksa päris toodet olemasolevast `storefront_seo_catalog()` kataloogist. Valik võtab admini määratud poodide järjekorras igast poest ühe toote korraga ning jätkab järgmise ringiga, kuni kaheksa kohta on täis või sobivad tooted otsas. Kuvatakse ainult avalikud, pildi ja hinnaga tooted, mille laoseis ei ole 0. Puuduv laopiirang ja nullhind on lubatud. Kaupmehe tootemuudatused kajastuvad automaatselt; eraldi sisestamist ega andmebaasimuudatust pole vaja.

Serveri HTML ja brauser kasutavad sama valikut. Kaardid sisaldavad poe nime, toote pilti, kehtivat hinda (sh soodushinda) ja otselinki tootele koos `from=kaubamaja` tagasiteega. Otsingu ajal valikut ei kuvata. Avalehe tootelingi avamine salvestatakse olemasoleva `product_click` sündmusena asukohaga `directory` ning kajastub admini üld- ja poestatistikas; poekaartide näitamiste arvu see ei muuda.

## Kaubamaja poekirjeldused

Migratsioon `202609200004_store_directory_description.sql` parandab kaupmehe tutvustuse valiku. `storefront_seo_catalog().directory_description` sisaldab esimest mittetühja teksti järjekorras `directoryDescription` → `storeDescription` → tühi tekst; ainult tühikutest ja reavahetustest koosnevad väärtused jäetakse vahele. Kaubamaja piirab tutvustuse 140 märgini ja kasutab mõlema tutvustuse puudumisel teksti „Avasta poe valikut.”. Kaupmees haldab neid välju jaotises **Seaded → Pood**.

SEO jaoks kasutatav `store_description` jääb eraldi väljaks. Tühi SEO kirjeldus ei saa enam Kaubamajas poe tutvustust varjata ja SEO tekst ei asenda kaupmehe tutvustust. Paigalda esmalt migratsioon, seejärel rakendus. SQL-test `scripts/test-store-directory-description.sql` katab kirjelduse eelistuse, puuduva/tühja SEO kirjelduse, tühikud, puuduva tutvustuse ja SEO väljundi säilimise. Ühiktest kontrollib ka serveri HTML-i algandmete uuesti lugemist brauseris.

Migratsioon rakendati tootmises 20. septembril 2026. Kõigil neljal avalikul poel oli kaupmehe sisestatud tutvustus juba olemas; kolme poe oma jäi varasema valikuloogika tõttu kuvamata. Avaliku API kaudu kontrolliti kõigi nelja poe Kaubamaja kirjelduse vastavust kaupmehe salvestatud tekstile. Kaupmeeste sisu ei muudetud.

## Kaubamaja statistika

Admini `/admin/kaubamaja` vaikimisi sakk on **Statistika**; senine järjestamine asub sakis **Poodide järjekord** (`?view=order`). Sakkide vahetamine säilitab salvestamata järjekorra.

Vajalikud on migratsioon `202609200003_directory_analytics.sql` ja Edge Function `directory-analytics` (`verify_jwt = false`). Paigalda esmalt migratsioon ja funktsioon, seejärel brauserirakendus. Funktsioon kasutab olemasolevaid `SUPABASE_URL`, `POERUUM_SUPABASE_SECRET_KEY` ja `RATE_LIMIT_SALT` saladusi. Avalik sisend lubatakse ainult Kaubamaja päritolult, valideeritakse (kuni 20 sündmust / 16 KiB) ja piiratakse IP-räsi järgi 120 päringuni minutis. Avalik päritolukontroll ei tõenda päris inimese külastust; numbrid on brauseripõhine kasutusstatistika, mitte auditeeritud müügiaruanne.

Brauser saadab juhusliku lehekülastuse tunnuse, nähtavale jõudnud poekaardi (vähemalt 50% ühe sekundi jooksul), poe- ja tootelingi avamise ning otsingu tulemuste arvu. Salvestatakse sündmuseaegne kaardi koht ja asukoht (loend/otsing), viitaja domeen, UTM-allikas ja seadmeklass. Otsinguteksti, täielikku viitaja URL-i, konto tunnust ega IP-aadressi sündmustesse ei salvestata. Poe ja toote avalikud nimed võetakse serveris kataloogist. Admini külastused, näidispoed, kohalik arendus ning lugude alamlehed on mõõtmisest väljas.

Külastuse tunnus elab ainult lehe mälus; küpsiseid ega brauseri püsisalvestust ei kasutata. Uus lehe avamine/uuesti laadimine, 30 minutit tegevusetust või Eesti kuupäeva vahetumine alustab uut külastust. Ühte poekaarti, poe avamist ja konkreetse toote avamist loetakse külastuse jooksul üks kord; loendi ja otsingu koondis eemaldatakse kattuvad külastused. Asukohtade detailtabeli read võivad seetõttu kattuda. Taaspäringud kasutavad sama sündmuse ID-d; andmebaas eemaldab ka semantilised duplikaadid. Tahtlik kaardi avamine loetakse ka näitamiseks, et klaviatuuriga avamised ei tõstaks klikimäära üle 100%.

`admin_directory_analytics(7|30|90, store_id|null)` kontrollib JWT `app_metadata.role = admin`; kaupmehed ega anonüümsed kasutajad ei saa lugeda sündmusi või koondeid. Näidatakse külastusi, näitamisi, poe/toote avamisi, klikimäära, allikaid, seadmeid, päevatrendi, poe keskmist kohta ning poe enim avatud tooteid. Perioodid on Eesti kalendripäevades ja sisaldavad pooleliolevat tänast päeva. Eelmise võrdse perioodi võrdlus kuvatakse alles pärast mõlema perioodi andmete kogunemist. Ajalugu enne mõõtmise algust ei taastata. Müüki ja tellimusi selles etapis ei omistata.

`poeruum-directory-analytics-retention` eemaldab iga päev kell 03:20 UTC sündmused, mis jäävad varasemaks kui 180 päeva tagasi alanud Eesti päev. See katab kaks 90-päevast võrdlusperioodi. Kustutatud poe/toote ajaloolised avalikud nimed säilivad sündmustega selle tähtajani. SQL-test `scripts/test-directory-analytics.sql` kontrollib õigusi, duplikaate, avaldamata poode, poe/toote seost, kalendripäevi, võrdlusperioodi ja kustutamisjärgset ajalugu; käivita lokaalselt/CI-s `supabase_admin` rolliga koos `safeupdate` kontrolliga.

Migratsioon ja funktsioon paigaldati tootmises 20. septembril 2026. Tegelik avalik API võttis sündmused vastu (`202`), korduspäring ei lisanud duplikaate, vale päritolu sai `403` ja vigane sündmus `400`. Anonüümne aruandepäring lükati tagasi; ajutise adminikontoga kontrolliti nii üldaruannet kui 90-päevast poe detailaruannet. Kontrollsündmused ja ajutine konto kustutati.

## Kaubamaja poodide järjekord

Admini vaade `/admin/kaubamaja` vajab migratsioone `202609200001_store_directory_order.sql` ja `202609200002_store_directory_order_safeupdate.sql`.
Admin saab avaldatud poode lohistades või noolenuppe kasutades järjestada ja järjekorra salvestada.
Salvestamine kontrollib serveris administraatori rolli ning lükkab tagasi aegunud või puuduliku poodide loendi.
Kaupmehed ei saa järjestust muuta. Uued poed lisanduvad salvestatud järjekorra lõppu;
enne esimest salvestamist säilib loomiskuupäeva järjekord. Näidiskaardid jäävad päris poodide järele.
Avalik brauserivaade ja serveri HTML kasutavad sama järjestatud kataloogi. Serveri vahemälu uueneb kuni 60 sekundiga.

Migratsioon `202609200001` rakendati tootmises 20. septembril 2026. Kontrolliti avaliku kataloogi laadimist ja seda, et sisselogimata külastaja ega kaupmees ei saa järjestust otse muuta.

Parandus `202609200002` asendab tingimuseta kustutamise aegunud kirjete eemaldamise ja olemasolevate kohtade uuendamisega. See on vajalik PostgRESTi `safeupdate` kontrolli jaoks. Järjestuse SQL-testid laadivad sama kontrolli ning käivitatakse lokaalses/CI andmebaasis `supabase_admin` rolliga; ainult `SET ROLE authenticated` seda kontrolli ei aktiveeri.

Parandus rakendati tootmises 20. septembril 2026. Ajutise admini autentitud REST-päring taasesitas enne parandust vea `400 / 21000: DELETE requires a WHERE clause`; pärast parandust andsid kaks järjestikust salvestust vastuse `200` ning kataloog kinnitas salvestuse. Kontroll säilitas poodide senise järjekorra. Ajutine kontrollkonto kustutati.

## Kaubamaja päevahoroskoop

Horoskoobi jaoks rakenda migratsioon `202609070001_daily_horoscope.sql` ja deploy funktsioon `daily-horoscope` (`verify_jwt = false`). Funktsioon kontrollib ise olemasolevat `ONBOARDING_CRON_SECRET` väärtust. Lisa funktsiooni saladustesse `OPENAI_API_KEY`; valikuline `OPENAI_HOROSCOPE_MODEL` on vaikimisi `gpt-5.4`. Kasutatakse ka olemasolevaid `SUPABASE_URL` ja `POERUUM_SUPABASE_SECRET_KEY` väärtusi.

Ajastaja kasutab Vaulti olemasolevaid `onboarding_reminders_url` ja `onboarding_cron_secret` väärtusi. Töö käib iga tunni 15. minutil ja loob ainult puuduvad tänase ning homse väljaande tekstid. Andmebaasilukk väldib sama päeva paralleelset genereerimist. Valmis tekstid avalduvad Eesti kuupäeva järgi; brauser loeb ainult tänaseid tekste ega käivita OpenAI päringuid.

Genereerimise lähteandmed arvutab `horoscope-sky.ts` Astronomy Engine'i teegiga kohapeal. Kasutatakse geotsentrilisi troopilise sodiaagi asukohti Eesti aja keskpäeval, Kuu faasi, päevast liikumist ja märgivahetusi. Aspektide ligikaudsed lähimad nurgahälbed leitakse kogu Eesti kalendripäeva tunniste proovide järgi; täpseid sündmuste kellaaegu ei väideta. Iga tähemärgi kontekstiks arvutatakse päikesemajad, kus vastav märk on esimene maja. Need on üldise meelelahutusliku horoskoobi lähteandmed, mitte isiklik sünnikaart.

Üks OpenAI päring kirjutab nende andmete põhjal kõik 12 teksti. Prompt suunab kasutama päeva muutuvaid seoseid, erinevaid vaatenurki ja varieeruvat lauseehitust. Püsivat näidisteksti ega kohustuslikku lausearvu ei ole. Genereerimine ei vaja varasemate väljaannete lugemist, uut andmebaasitabelit ega eraldi astronoomia-API võtit. Teegi versioon on fikseeritud nii `package.json` failis kui ka funktsiooni `daily-horoscope/deno.json` impordikaardis.

Generaatori või mudeli muutmisel tuleb lisaks ühiktestidele võrrelda sama märgi tekste mitme järjestikuse päeva lõikes: korduvad lausealgused, ülesehitus ja sisulised olukorrad võivad ilmneda alles väljaandeid kõrvuti lugedes. Ühiktestid kontrollivad andmete ja päringute korrektsust, mitte kirjanduslikku mitmekesisust. Juba loodud väljaandeid funktsiooni uuesti paigaldamine üle ei kirjuta; uus generaator rakendub järgmisele puuduvale väljaandele.

Tootmise Supabase'is rakendatud 8. septembril 2026: migratsioon `202609070001`, funktsioon `daily-horoscope` ja aktiivne ajastaja `poeruum-daily-horoscope` (`15 * * * *`). Funktsioon kasutab juba olemasolevaid serveri- ja Vaulti saladusi.

13. septembril 2026 paigaldati taevaseisudest lähtuv generaator funktsiooni versioonina 5. Kontrolliti 14 päeva jagu ehk 168 lõpliku generaatori teksti ning võrreldi sama esimese nädala 84 teksti vana generaatoriga. Tänase, 13. septembri ja homse, 14. septembri väljaanded asendati kontrollitud uute tekstidega. Paigalduse järel kontrolliti funktsiooni autentimise nõuet (`401`) ja kõigi 12 homse teksti vastavust andmebaasis. Tänaste tekstide vastavus kontrolliti avaliku API kaudu ja kõigi 12 tähemärgi kuvamine tootmislehel brauseris.

Rakendamise kontrollis lõi ajastajaga sama päring 8. ja 9. septembri väljaanded, mõlemas 12 tähemärki. Korduspäring tagastas `generated: 0`. Avalik API lubas lugeda ainult tänast väljaannet, autentimata genereerimispäring sai vastuse `401` ning brauser kuvas andmebaasi teksti ilma staatilist varufaili kasutamata.

`npm run horoscope:generate` loob kohaliku `.env` võtmega tänase staatilise väljaande faili `public/data/daily-horoscope.json`. See sobib eelvaateks ja sama päeva varuvariandiks; vananenud teksti ei kuvata. Kui tänast väljaannet pole saadaval, jääb rubriik nähtavaks tänase kuupäeva ja selgitusega ning proovib nähtaval lehel iga minuti järel uuesti. Tähemärgi valik säilib külastaja brauseris.

## Projekti seadistamine

1. Loo Supabase'is uus projekt.
2. Täida lokaalne `.env` fail. Brauserivõtmete kõrval on seal eraldi CLI ja serveripoolse halduse võtmed.
3. Kontrolli võtmeid käsuga `npm run supabase:check`.
4. Rakenda migratsioon automaatselt käsuga `npm run supabase:deploy`. See lingib projekti ja käivitab `supabase/migrations` kausta rakendamata migratsioonid.
5. Supabase Auth seadetes lisa rakenduse URL lubatud redirect URL-ide hulka. Arenduses on see tavaliselt `http://localhost:5173/**`.
6. Käivita `npm run dev`.

Avalik pood avaneb tootmises aadressil `poe-slug.poeruum.ee`. `/p/poe-slug` ja `?store=poe-slug` jäävad varuaadressidena tööle. Lokaalselt saab alamdomeeni proovida, seades `VITE_STOREFRONT_ROOT_DOMAIN=localhost` ja avades näiteks `http://minu-pood.localhost:5173`.

### Wildcard-domeen Renderis

1. Lisa sama Renderi teenuse **Custom Domains** alla `*.poeruum.ee`.
2. Lisa DNS-i Renderi näidatud kolm CNAME-kirjet: `*`, `_acme-challenge` ja `_cf-custom-hostname`. Nende täpsed väärtused sõltuvad Renderi teenuse ID-st.
3. Vajuta Renderis wildcard-domeeni juures **Verify** ja oota TLS-sertifikaadi väljastamist.
4. Sea frontendile `VITE_STOREFRONT_ROOT_DOMAIN=poeruum.ee` ning Supabase Edge Functionitele `STOREFRONT_ROOT_DOMAIN=poeruum.ee`.

Ilma Renderi wildcard-domeeni ja nende DNS-kirjeteta brauser alamdomeene rakenduseni ei suuna. Juurdomeen `poeruum.ee` peab samuti Renderile osutama.

### Klientide oma domeenid

Olemasoleva kliendidomeeni ühendamine kasutab Render Custom Domains API-t. Domeen jääb kliendi registripidaja juurde; Poeruum lisab selle Renderi teenusele, annab kasutajale vajaliku DNS-kirje ning märgib domeeni aktiivseks alles pärast Renderi DNS-kontrolli ja edukat HTTPS-päringut.

1. Loo Render Account Settings all API key.
2. Leia Poeruumi web service'i ID (`srv-...`) ja selle `onrender.com` hostinimi.
3. Lisa Supabase Edge Functionite saladustesse `RENDER_API_KEY`, `RENDER_SERVICE_ID`, `RENDER_SERVICE_HOSTNAME` ja soovi korral `RENDER_APEX_IPV4`. Viimase vaikeväärtus on Renderi avalik load balancer `216.24.57.1`.
4. Rakenda migratsioon `npm run supabase:deploy` ning funktsioonid `npm run supabase:functions:deploy`.

Näiteks:

```sh
npx supabase secrets set \
  RENDER_API_KEY=... \
  RENDER_SERVICE_ID=srv-... \
  RENDER_SERVICE_HOSTNAME=poeruum.onrender.com \
  RENDER_APEX_IPV4=216.24.57.1 \
  --project-ref "$SUPABASE_PROJECT_REF"
```

Alamdomeenile, näiteks `www.pood.ee`, näitab Poeruum CNAME-kirjet Renderi teenuse hostinimele. Juurdomeenile `pood.ee` näidatakse A-kirjet. Render lisab ja uuendab TLS-sertifikaadi automaatselt. Konto kustutamisel eemaldab `delete-account` domeenid enne kasutaja ja poe andmete kustutamist, et Renderisse ei jääks orbdomeene.

`SUPABASE_SECRET_KEY` või legacy `SUPABASE_SERVICE_ROLE_KEY` võib olla lokaalses `.env` failis ainult serveripoolseks halduseks. Sellel ei tohi olla `VITE_` prefiksit ning seda ei tohi importida `src/` koodi. Rakendus kasutab brauseris publishable/anon võtit ja turvalisus põhineb migratsioonis olevatel RLS-reeglitel.

Kui e-posti kinnitamine on Auth seadetes aktiivne, peab uus kasutaja enne esimest sisselogimist kinnitama Supabase'i saadetud kirja.

## Administraatori töölaud

Administraatori töölaud avaneb aadressil `/admin`. Ligipääs kontrollitakse serveris kasutaja `app_metadata.role` väärtuse järgi; tavakasutaja ei saa admini koondpäringut käivitada.

1. Rakenda uusimad migratsioonid käsuga `npm run supabase:deploy`.
2. Loo või vali Supabase Authis administraatori kasutaja.
3. Määra roll käsuga `npm run supabase:set-admin -- nimi@example.com`.
4. Kui kasutaja oli juba sisse logitud, logi välja ja uuesti sisse, et uus JWT sisaldaks admini rolli.

Admini roll eemaldatakse Supabase Auth Admin API kaudu, muutes kasutaja `app_metadata.role` väärtust. Ära paiguta admini rolli `user_metadata` alla, sest kasutaja saab seda ise muuta.

## Stripe’i päris maksed ja reaalaja tulu

Poe Stripe’i ostud kasutavad destination charge’i. Toodete summa pealt arvutatud Paindliku paketi teenustasu läheb Stripe’i `application_fee_amount` väljale; tarne ei kuulu tasu sisse. Kindla paketi kuutasu kasutab Stripe Billingu korduvat Price’i ja eraldi 24% Tax Rate’i.

1. Loo Stripe’is korduv kuine Price netohinnaga 29 € ja lisa selle ID `.env` faili muutujasse `STRIPE_FIXED_PLAN_PRICE_ID`.
2. Loo Stripe’is Eesti 24% mitte-inklusiivne Tax Rate ja lisa ID muutujasse `STRIPE_FIXED_PLAN_TAX_RATE_ID`. See on nõutav nii test- kui live-režiimis.
3. Sea `APP_URL` avalikule HTTPS-aadressile.
4. Sea `STRIPE_MODE` väärtuseks `test` või `live`. Funktsioonid keelduvad käivitumast, kui võtme, salvestatud Stripe’i objekti või webhooki režiim ei vasta sellele.
5. Laadi Edge Functionite serverisaladused Supabase’i: `STRIPE_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_FIXED_PLAN_PRICE_ID`, `STRIPE_FIXED_PLAN_TAX_RATE_ID` ja `APP_URL`.
6. Rakenda andmebaas `npm run supabase:deploy` ning funktsioonid `npm run supabase:functions:deploy`.

## OpenAI kliendiotsing

Administraatori aadressil `/admin/leads` saab OpenAI abil avalikest veebiallikatest sobivaid Eesti ettevõtteid otsida, allikaid kontrollida, kirjamustandit muuta ja kirja käsitsi kinnitada. Automaatset saatmist ei toimu: iga kiri nõuab eraldi administraatori klõpsu.

Kui Supabase, Resend ja nende webhook on juba seadistatud, lisa lokaalsesse `.env` faili ainult järgmine uus kohustuslik võti:

```dotenv
OPENAI_API_KEY=sk-...
```

Valikulised seaded on `OPENAI_LEAD_MODEL` (vaikimisi tasakaalustatud ja kiire `gpt-5.6-terra`), `OUTREACH_SENDER_NAME`, `OUTREACH_FROM_EMAIL`, `OUTREACH_REPLY_TO`, `OUTREACH_BCC_EMAIL` ja `OUTREACH_DAILY_SEND_LIMIT` (vaikimisi 20). `OUTREACH_BCC_EMAIL` saadab igast kliendiotsingu kirjast kontrollkoopia määratud aadressile; klient pimekoopia aadressi ei näe. Vaikimisi kuvatakse saatjana `Poeruum`; saatja domeen peab olema Resendis kinnitatud. Funktsioon kasutab ka olemasolevaid `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`, `RATE_LIMIT_SALT`, `POERUUM_SUPABASE_PUBLISHABLE_KEY` ja `POERUUM_SUPABASE_SECRET_KEY` väärtusi.

Pärast võtme lisamist teeb üks käsk kõik ülejäänu: sünkroonib kliendiotsingu seaded Supabase Edge Functionite secret’ideks, rakendab migratsioonid ning paigaldab kliendiotsingu, loobumise, Resendi webhooki ja säilitustähtaja funktsioonid.

```bash
npm run supabase:leads:deploy
```

Resendi webhook peab kuulama vähemalt sündmusi `email.sent`, `email.delivered`, `email.failed`, `email.bounced`, `email.complained` ja `email.received`. Bounce ja kaebus lisavad aadressi automaatselt blokeerimisnimekirja; tavaline vastus märgitakse administraatori vaates ning selge vastus „ei soovi” lisab aadressi automaatselt blokeerimisnimekirja.

Checkout kasutab kliendi päringu ID-d, Stripe’i idempotentsusvõtit ja atomaarset 30-minutilist laoreservatsiooni. Stripe’i aegumise või makse ebaõnnestumise webhook vabastab kauba; viieminutiline varukoristaja kontrollib aegunud reserveeringu Stripe’i sessiooni enne vabastamist ning asünkroonse pangamakse puhul hoitakse reserveeringut lõpliku succeeded/failed sündmuseni. Paindliku paketi 39 € neto-kuulimiit reserveeritakse samas poe-põhises andmebaasitehingus kui laoseis, mistõttu paralleelsed checkout’id ei saa limiiti ületada. Õnnestunud makse järel loetakse Stripe’i tegelik töötlemistasu ja müüjale tehakse eraldi ülekanne summas `ostusumma − Stripe’i tasu − Poeruumi teenustasu`. Ostjale eraldi maksetasu ei lisata.

Reserveeringu aegumise ja kuutasu konkurentsikontrolli saab käivitada käsuga `npm run test:reservation-cap`. Test loob ajutise poe, käivitab kaks paralleelset checkout’i, kontrollib 39 € atomaarset ülempiiri ja aegunud laoreserveeringu vabastamist ning koristab testandmed.

Arvelduse armuaja serveripoolse jõustamise kontroll käivitub käsuga `npm run test:billing-delinquency`. Test kinnitab, et aktiivse Kindla paketi ja kehtiva armuaja jooksul on müügitasu 0%, kuid lõppenud armuaja järel rakendub uuele tellimusele automaatselt Paindliku paketi 4% netotasu ning käibemaks.

Billingu brauseritest käivitub käsuga `npm run test:stripe-billing`, kui rakendus töötab aadressil `http://127.0.0.1:5173`. Test kasutab süsteemi Google Chrome’i, Stripe’i testkaarte ning ajutisi Supabase’i kasutajaid ja poode. See kontrollib edukat kaarti, 3D Secure’i, tagasilükatud kaarti, tagasisuunamist, päris webhooki, prooviperioodi, korduskaitset ja paketi lõpetamist ning koristab ajutised andmed.

Stripe’i platvormikonto webhook peab saatma `stripe-webhook` funktsioonile järgmised sündmused:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `application_fee.created`
- `application_fee.refunded`

Kindla paketi korduva makse ebaõnnestumisel algab rakenduse enda 7-päevane armuaeg. `stripe-billing-delinquency` töötab iga 15 minuti järel sama Vault URL-i ja cron-saladusega nagu teised hooldusfunktsioonid. Armuaeg ei lähtestu Stripe’i korduskatsetel. Selle lõppedes lõpetab funktsioon tellimuse, tühistab avatud tasumata arve ja viib poe Paindlikule paketile. Ostu teenustasu arvutav andmebaasifunktsioon kontrollib armuaja tähtaega iseseisvalt, nii et pärast tähtaega rakendub Paindliku paketi tasu ka siis, kui cron-töö hilineb.

Stripe Billing Portal peab olema Stripe Dashboardis aktiveeritud, et kaupmees saaks rakendusest makseviisi ja arveid hallata. Stripe’i automaatsed korduskatsed ning ebaõnnestunud makse e-kirjad võib jätta sisse; Poeruum saadab lisaks oma teavituse makse ebaõnnestumisel, vähem kui 24 tundi enne armuaja lõppu ja automaatse paketivahetuse järel.

Portaali kontrollitud konfiguratsiooni loob või uuendab käsk `npm run stripe:billing-portal -- apply`; kontrollimiseks kasuta `npm run stripe:billing-portal -- verify`. Portaal lubab makseviisi uuendada ja arveajalugu vaadata, kuid paketi muutmine ning tühistamine jäävad Poeruumi enda voo kontrolli alla.

Connecti webhook peab saatma `stripe-connect-webhook` funktsioonile connected account sündmused `account.updated` ja `account.application.deauthorized`.

### Live-režiimi üleminek

Test- ja live-režiimi Stripe’i kontod, Price’id, Tax Rate’id ning webhooki saladused on eraldi. Vahetult enne live-võtmete paigaldamist käivita kontrollitult [stripe-live-cutover.sql](supabase/stripe-live-cutover.sql), loo Stripe’i live-režiimis mõlemad webhook endpointid, 29 € kuine Price ja 24% Tax Rate ning paigalda nende live-väärtused koos `STRIPE_MODE=live` seadistusega. Cutover-skript katkestab töö, kui andmebaasis on juba live-viiteid.

Admini reaalaja tulukaart loeb ainult allkirjastatud webhook’ist tabelisse `revenue_events` jõudnud sündmusi. Brauser ega kaupmees ei saa tulukandeid ise lisada. Supabase Realtime’i publikatsioon lisatakse migratsiooniga automaatselt; tulutabelit saavad lugeda ainult kasutajad, kelle JWT `app_metadata.role` on `admin`.

Tagastus tuleb algatada Poeruumi tellimuse vaatest. Server saadab Stripe’ile korraga `reverse_transfer=true` ja `refund_application_fee=true`, mistõttu kaupmehele kantud summa ning Poeruumi 4% tasu pööratakse koos tagasi. Tagastatud teenustasu ilmub adminis negatiivse tulukandena.
