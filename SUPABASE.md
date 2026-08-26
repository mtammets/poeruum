# Supabase'i käivitamine

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

Valikulised seaded on `OPENAI_LEAD_MODEL` (vaikimisi parimale kirjakvaliteedile suunatud `gpt-5.6-sol`), `OUTREACH_SENDER_NAME`, `OUTREACH_FROM_EMAIL`, `OUTREACH_REPLY_TO` ja `OUTREACH_DAILY_SEND_LIMIT` (vaikimisi 20). Kiirema ja soodsama, kuid veidi ebaühtlasema tulemuse jaoks võib mudeli teadlikult vahetada. Vaikimisi kuvatakse saatjana `Marek Tammets | Poeruum`; saatja domeen peab olema Resendis kinnitatud. Funktsioon kasutab ka olemasolevaid `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`, `RATE_LIMIT_SALT`, `POERUUM_SUPABASE_PUBLISHABLE_KEY` ja `POERUUM_SUPABASE_SECRET_KEY` väärtusi.

Kliendiotsing ja kirja koostamine on kaks eraldi etappi. Otsing kontrollib kuni nelja kandidaadi puhul vähemalt toote- ja tellimisvoo allikaid ning ei koosta veel kirja. Olemasolev ostukorv või kassa, teenuseäri, suur kett või täielikult eritellimusel hinnapäringuvoog välistab kandidaadi; ebakindel tulemus jääb administraatorile kontrollimiseks. Valitud kandidaadi kirja koostamisel tehakse värske veebikontroll, seejärel rakendatakse serveripoolset tooni-, konkreetsuse- ja faktipiiride kvaliteediväravat. Ainult kontrolli läbinud mustand saab oleku „Saatmiseks valmis”.

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
