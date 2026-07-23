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

Checkout kasutab kliendi päringu ID-d, Stripe’i idempotentsusvõtit ja atomaarset 30-minutilist laoreservatsiooni. Stripe’i aegumise või makse ebaõnnestumise webhook vabastab kauba; asünkroonse pangamakse puhul hoitakse reservatsiooni lõpliku succeeded/failed sündmuseni. Õnnestunud makse järel loetakse Stripe’i tegelik töötlemistasu ja müüjale tehakse eraldi ülekanne summas `ostusumma − Stripe’i tasu − Poeruumi teenustasu`. Ostjale eraldi maksetasu ei lisata.

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

Connecti webhook peab saatma `stripe-connect-webhook` funktsioonile connected account sündmused `account.updated` ja `account.application.deauthorized`.

### Live-režiimi üleminek

Test- ja live-režiimi Stripe’i kontod, Price’id, Tax Rate’id ning webhooki saladused on eraldi. Vahetult enne live-võtmete paigaldamist käivita kontrollitult [stripe-live-cutover.sql](supabase/stripe-live-cutover.sql), loo Stripe’i live-režiimis mõlemad webhook endpointid, 29 € kuine Price ja 24% Tax Rate ning paigalda nende live-väärtused koos `STRIPE_MODE=live` seadistusega. Cutover-skript katkestab töö, kui andmebaasis on juba live-viiteid.

Admini reaalaja tulukaart loeb ainult allkirjastatud webhook’ist tabelisse `revenue_events` jõudnud sündmusi. Brauser ega kaupmees ei saa tulukandeid ise lisada. Supabase Realtime’i publikatsioon lisatakse migratsiooniga automaatselt; tulutabelit saavad lugeda ainult kasutajad, kelle JWT `app_metadata.role` on `admin`.

Tagastus tuleb algatada Poeruumi tellimuse vaatest. Server saadab Stripe’ile korraga `reverse_transfer=true` ja `refund_application_fee=true`, mistõttu kaupmehele kantud summa ning Poeruumi 4% tasu pööratakse koos tagasi. Tagastatud teenustasu ilmub adminis negatiivse tulukandena.
