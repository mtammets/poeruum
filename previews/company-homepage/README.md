# Krük-Krüki privaatne kliendieelvaade

Eraldi Renderi teenus kasutab sama `CompanyHomepage` komponenti, kujundust ja
tekstiredaktorit. Leht avaneb teenuse juuraadressil. Parooliga sisse loginud klient
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
`deploy` ja `status`. `prepare` loob korduvkasutatavad saladused Giti poolt
ignoreeritavasse `.env.company-preview` faili; seda ei tohi kopeerida hoidlasse.
`database` rakendab ainult eelvaate migratsiooni ja loob algmustandi, säilitades
olemasoleva. `deploy` loob tasuta Renderi teenuse üks kord. Teenuse ID ja URL
salvestuvad `deployment.json` faili, mis ei sisalda saladusi.

Render kasutab haru `codex/kruk-client-preview`, ehitab käsuga
`npm ci && npm run build:company-preview` ja käivitub käsuga
`npm run start:company-preview`. Automaatne juurutus on väljas: pärast testimist
juuruta sama teenuse konkreetne kontrollitud commit. Põhirakenduse Renderi teenus
ja `main` haru ei ole selle eelvaate juurutussiht.

## Kliendi domeen

Kui domeen on ostetud, lisa see **selle eelvaateteenuse** Custom Domains alla ja
seadista Renderi tagastatud DNS-kirjed. HTTPS-i sertifikaadi väljastab Render.
Leht ja salvestatud mustand jäävad samaks; uuel domeenil tuleb uuesti parool
sisestada. Domeeni ühendamine ei eemalda paroolikaitset.

Avalikuks käivitamine on eraldi muudatus: külastajavaade tuleb avada ilma
muutmisõiguseta ning redaktor peab jääma autentimise taha. Praegust parooliväravat
ei tohi lihtsalt eemaldada, sest see kaitseb ühtlasi kliendi muutmisõigust.
Tasuta Renderi teenuse esimene avamine pärast jõudeolekut võib võtta umbes minuti.
