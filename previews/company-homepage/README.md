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

## Avalik koduleht ja kliendi domeen

`https://kruk-kruk.ee/` on avalik koduleht. `www.kruk-kruk.ee` suunab juurdomeenile.
Mõlemad domeenid kuuluvad Poeruumi olemasoleva Renderi teenuse alla. Veebimajutuses
on juurdomeeni A-kirje `216.24.57.1` ning `www` CNAME `poeruum-web.onrender.com`.
E-posti, FTP ja Elkdata nimeserverite kirjeid ei muudeta.

Kodulehe domeeni ei lisata poe peamiseks domeeniks: e-pood ja ostmine jäävad
`https://kruk-kruk.poeruum.ee/` aadressile. Avaliku lehe tekstid tulevad avaldatud
poe `settings.companyHomepage` väljast; privaatset eelvaatemustandit ei avaldata
automaatselt. Poe peitmine sulgeb ka kodulehe ning eemaldab sitemap'i.

Omanik logib sisse Poeruumi ja avab poe halduses **Muuda kodulehte**. Redaktor
asub `https://kruk-kruk.poeruum.ee/koduleht/`, kus omaniku sessioon on olemas.
Muutmisnupp ja salvestamine nõuavad selle poe omaniku sessiooni ning andmebaasi
RLS-õigusi. **Salvesta** avaldab tekstid ka eraldi domeenil. Kodulehe canonical
ja sitemap viitavad `https://kruk-kruk.ee/` aadressile.

Senine `https://poeruum.ee/eelvaade/kruk-kruk/` jääb parooliga kaitstud eraldi
mustandiks. Selle parool ei anna avaliku kodulehe muutmisõigust.

Kontrollid: `npm run test:company-homepage-server`,
`npm run test:smoke -- e2e/company-homepage.e2e.ts` ning
`npm run test:unit -- src/lib/companyHomepage.test.ts src/lib/storefrontUrl.test.ts src/lib/database.test.ts`.
