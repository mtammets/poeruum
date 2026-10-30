# Krük-Krüki privaatne kliendieelvaade

Poeruumi olemasolev Renderi teenus kasutab sama `CompanyHomepage` komponenti, kujundust ja
tekstiredaktorit. Leht avaneb aadressil https://poeruum.ee/eelvaade/kruk-kruk/. Parooliga sisse loginud klient
saab vajutada **Muuda**, muuta tekste ja vajutada **Salvesta**. **Välju** sulgeb
sessiooni. E-poe ja toote lingid viivad Krük-Krüki olemasolevasse poodi.

## Käivitamine ja kontroll

```sh
npm run build:company-preview
npm run test:company-preview
npm run start:company-preview
```

Server vajab `COMPANY_REVIEW_PASSWORD_HASH`, `COMPANY_REVIEW_ACCESS_KEY`,
`SUPABASE_URL` ja `SUPABASE_ANON_KEY` keskkonnamuutujaid. See ei vaja Supabase'i
teenusevõtit. Ilma parooliseadistuseta keeldub server käivitumast. Renderis on
sessiooniküpsis Secure, HttpOnly ja SameSite=Strict; parooli vahetus tühistab
varasemad sessioonid. Sisselogimiskatseid piiratakse serveris.

Parool kaitseb HTML-i, JavaScripti, pilte, heli, fonte ja API-t. Vastuseid ei
puhverdata ning otsingumootorite indekseerimine on keelatud. Ainsad paroolita
tehnilised teekonnad on `/healthz` ja kõike keelav `/robots.txt`.

## Andmed

Migratsioon `202610300001_company_homepage_reviews.sql` lisab privaatsed
mustandite ja versioonide tabelid. Kliendi tekstid ei lähe `public_storefronts`
vaatesse ega muuda avaliku e-poe seadeid. Serveri juhuslik võti lubab lugeda ja
kirjutada ainult ühe poe mustandit. Andmebaasis hoitakse sellest üksnes SHA-256
räsi. Iga salvestus kontrollib versiooni ja jätab eelmise teksti alles.

`scripts/configure-company-review.mjs` toetab käske `prepare`, `database`,
`configure` ja `status`. `prepare` loob korduvkasutatavad saladused Giti poolt
ignoreeritavasse `.env.company-preview` faili; seda ei tohi kopeerida hoidlasse.
`database` rakendab ainult eelvaate migratsiooni ja loob algmustandi, säilitades
olemasoleva. `configure` lisab kaks eelvaate saladust olemasolevale Poeruumi
Renderi teenusele. `deployment.json` näitab sama teenuse ID-d ja kaitstud URL-i.

Eelvaade kasutab Poeruumi olemasolevat tasulist majutust. Eraldi serverit ega
majutuse kuutasu ei lisandu. Poeruumi `npm run build` ehitab nii põhirakenduse kui
ka eelvaate; `server.mjs` suunab `/eelvaade/kruk-kruk/` päringud parooliväravasse.
Kõik eelvaate failid asuvad kaitstud teekonna all. E-poe ja maksete marsruudid
kasutavad edasi olemasolevat serveriloogikat.

## Kliendi domeen

Kui domeen on ostetud, lisa see Poeruumi olemasoleva Renderi teenuse Custom
Domains alla ning seadista Renderi tagastatud DNS-kirjed. Lisa serverisse selle
domeeni juuraadressi suunamine kliendi kodulehele; DNS üksi ei määra, millist
Poeruumi lehte näidata. HTTPS-i sertifikaadi väljastab Render. Salvestatud
mustand jääb samaks. Domeeni ühendamine ei eemalda automaatselt paroolikaitset.

Avalikuks käivitamine on eraldi muudatus: külastajavaade tuleb avada ilma
muutmisõiguseta ning redaktor peab jääma autentimise taha. Praegust parooliväravat
ei tohi lihtsalt eemaldada, sest see kaitseb ühtlasi kliendi muutmisõigust.
