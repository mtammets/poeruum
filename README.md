# Poeruum

Poeruum on Eesti väikeettevõtjale mõeldud e-poeplatvorm. Rakendus ühendab
poe loomise ja halduse, avaliku storefront'i, Stripe'i maksed, tarne,
tellimused, klienditoe ning administraatori tööriistad.

## Tehniline ülesehitus

```text
Node HTTP server
  ├─ staatilised Vite'i failid
  ├─ poe- ja tootepõhine SEO HTML
  └─ robots.txt / sitemap.xml
          │
          ▼
React 19 + Vite
  ├─ avaleht ja autentimine
  ├─ kaupmehe onboarding
  ├─ avalik pood ja checkout
  └─ admin ning klienditugi
          │
          ▼
Supabase
  ├─ Auth ja Row Level Security
  ├─ PostgreSQL-i tehingud ja migratsioonid
  ├─ Storage ning Realtime
  └─ Edge Functions
          │
          ├─ Stripe Connect ja Billing
          ├─ Resend
          ├─ Render Custom Domains
          └─ Cloudflare Turnstile
```

Marsruutide valideerimise lähtekood on ühine Node serverile ja brauserile
failis `shared/storefront-route.mjs`. Maksete summa, laoseis ja valikud
kontrollitakse alati serveris; brauseri saadetud hindu ei usaldata.

## Olulisemad kataloogid

- `src/` – Reacti kasutajaliides ja brauseri andmekiht.
- `src/lib/` – Supabase, SEO, URL-ide ja veaseire adapterid.
- `shared/` – brauseri ja Node serveri ühine isomorfne loogika.
- `supabase/migrations/` – andmemudel, RLS-poliitikad ja atomaarne äriloogika.
- `supabase/functions/` – Stripe'i, e-posti, domeenide ja seire Edge Functionid.
- `e2e/` – tootmisbuildist sõltumatud Playwrighti smoke-testid.
- `scripts/` – haldus-, preview- ja integratsioonitestide tööriistad.

## Kohalik käivitamine

Nõutud on Node.js 22 ja npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Ilma Supabase'i võtmeteta saab avada avalehe, autentimisvaated,
juriidilised lehed ja admini suletud oleku. Täieliku keskkonna seadistamine on
kirjeldatud failis [SUPABASE.md](SUPABASE.md).

`npm run dev` käivitab nii põhirakenduse kui ka maksete eelvaate. Eelvaate saab
avada admini menüüst **Maksete eelvaade** või aadressilt
http://127.0.0.1:4185/previews/payments.html; konto loomist pole vaja.
`Ctrl+C` sulgeb mõlemad serverid. Ainult põhirakenduse käivitamiseks kasuta
`npm run dev:app`, ainult eelvaate jaoks `npm run dev:payments`.
Päris Stripe’i testvormi võtmed ja kasutusjuhend on failis
[previews/README.md](previews/README.md).

## Kvaliteedikontroll

```sh
npm run check
npm run test:smoke
```

`npm run check` käivitab ESLinti, Edge Functionite Deno tüübikontrolli,
Vitesti üksustestid, production build'i ja sõltuvuste turvaauditi.
`npm run test:smoke` käivitab Chromiumis põhilised anonüümsed kasutajavood.

Andmebaasi kontrollimiseks:

```sh
npx supabase db start
npx supabase db reset --local --no-seed
npx supabase db lint --local --schema public,extensions --level warning --fail-on warning
npx supabase stop --no-backup
```

Põhjalikum testimisstrateegia on failis [TESTING.md](TESTING.md), turbe- ja
seirekorraldus failis [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md) ning
andmete elutsükkel failis [DATA_RETENTION.md](DATA_RETENTION.md).

Ostuarvete töövoog, ligipääs ja juurutusjärjekord: [ostuarvete juhend](docs/order-invoices.md).

Admini telefoni märguanded ja seadistamine: [push-teavituste juhend](docs/admin-push.md).

Kaupmehe poe statistika avaneb haldusriba graafikunupust. Ülevaade küsib andmeid
ainult avamisel, 7/30 päeva valimisel ja käsitsi värskendamisel. Külastuste
mõõtmine vajab migratsiooni `202610070003_store_analytics.sql` ning avalikku
`store-analytics` Edge Functionit (`verify_jwt = false`); need tuleb juurutada
enne uut kasutajaliidest. Tavapärane `supabase:functions:deploy` sisaldab uut
funktsiooni. Ligipääsu ja müügiarvutusi kontrollib `scripts/test-store-analytics.sql`.

Admini maksete täpsed põhjused vajavad `admin-payment-status` Edge Functionit
(`verify_jwt = false`; funktsioon kontrollib sessiooni ja administraatori rolli).
Tootepiltide eelvaade vajab migratsiooni `202610090001_admin_store_products.sql`.
Mõlemad tuleb juurutada enne kasutajaliidest; eelvaade võimaldab administraatoril
vaadata ka avaldamata poe tooteid ilma poe avalikkust muutmata.

## Poeruumi lood ja kaupmehe intervjuu

Adminis **Kaubamaja → Poeruumi lood** (`/admin/kaubamaja?view=stories`) saab
valida avaldatud poe ja luua personaalse intervjuulingi. **Kopeeri link** annab SMS-i
lisatava aadressi; **Ava SMS-is** avab seadme sõnumirakenduse eeltäidetud tekstiga.
Rakendus ise sõnumeid ei saada. Link kehtib 30 päeva; **Uuenda linki** säilitab
vestluse ja muudab eelmise lingi kehtetuks. **Sulge link** lõpetab ligipääsu.

Kaupmees avab `/lugu/#token=…` ilma kontosse sisenemata. AI küsib ühe küsimuse
kaupa ja kasutab jätkuküsimusteks salvestatud vastuseid. Enne loo kinnitamisele
saatmist saab päises valida **Alusta uuesti**. Pärast eraldi kinnitust
kustutatakse vastused, mustand ja mõlemad fotod ning alustatakse nime küsimisest.
Sama intervjuulink jääb kehtima; selle aegumisaeg ja AI kasutuspiirang ei muutu.
Intervjuule järgnevad
avafoto, valikuline teine foto artikli sisse ning muudetav eelvaade, mis kasutab
sama kujundust nagu avaldatud artikkel. **Valmis** saadab loo administraatorile
kinnitamiseks. Olekus **Ootab kinnitamist** jäävad lugu ja fotod privaatseks;
kaupmees enam teksti ega fotosid muuta ei saa. Admin avab **Vaata üle** ja
avaldab loo nupuga **Kinnita ja avalda**. Intervjuulingi aegumine ei kustuta
kinnitamise ootel lugu ega takista administraatori kinnitust.
Uusim avaldatud lugu asendab kaubamaja avabänneri ja avaneb samas lehes;
varasemad lood jäävad lehe lõppu. Iga lugu saab oma `/lood/…/` aadressi,
jagamismetadata ja sitemap-kirje. Admin saab loo peita või uuesti avaldada.

Juurutusjärjekord:

1. Rakenda migratsioonid `202610180001_story_interviews.sql`,
   `202610180002_story_body_image.sql` ja `202610190001_story_approval.sql`.
   Kinnitamise migratsioon sulgeb vana otseavaldamise funktsiooni. Seejärel
   uuenda `story-interview` funktsioon enne kasutajaliidest: vanade avatud
   lehtede `publish` päring saadab samuti loo ainult kinnitamisele.
2. Juuruta `story-interview` (`verify_jwt = false`) ning uuendatud
   `data-retention-reaper`. Funktsioon kontrollib iga privaatse päringu
   intervjuuvõtit ja iga adminitoimingu puhul administraatori sessiooni.
3. Serveriseaded: olemasolevad `SUPABASE_URL`, `POERUUM_SUPABASE_SECRET_KEY`,
   `RATE_LIMIT_SALT`, `OPENAI_API_KEY`; valikuline `OPENAI_STORY_MODEL`
   (vaikimisi `gpt-5.4-mini`). Ükski salajane võti ei lähe brauserisse.
4. Ehita ja juuruta veebirakendus koos `server.mjs` muudatustega.

Intervjuuvõti paikneb URL-i fragmendis ja andmebaasis hoitakse ainult selle
SHA-256 räsi. Mustandid, vestlused ja fotod on privaatsed; foto avalik endpoint
kontrollib avaldatud artikli olemasolu. Muudatused kasutavad versioonikontrolli
ning päringu identifikaatorit, avaldamine on üks andmebaasitehing. AI päringud
kasutavad [Responses API struktureeritud väljundit](https://developers.openai.com/api/docs/guides/structured-outputs)
ja `store: false`; väljamõeldud väljatõstetud tsitaat eemaldatakse.

Kontrollid: `npm run test:story-interview-edge`, `npm run test:story-server`,
`npm run test:smoke -- e2e/story-interview.e2e.ts e2e/directory-stories.e2e.ts`,
ning kohalikus andmebaasis `scripts/test-story-interviews.sql`. Veebitestid
kasutavad isoleeritud API vastuseid; need ei avalda päris kaupmeeste lugusid.

## Deploy

Render käivitab `npm run build`, mis ehitab rakenduse ja genereerib SEO-varad,
ning serveerib tulemust käsuga `npm start`. Deploy toimub ainult pärast CI
kontrollide läbimist. Tootmissaladused ei tohi kasutada `VITE_` prefiksit;
brauserisse tohivad jõuda ainult `.env.example` failis avalikuks märgitud võtmed.
