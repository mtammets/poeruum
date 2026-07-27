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

## Deploy

Render käivitab `npm run build`, mis ehitab rakenduse ja genereerib SEO-varad,
ning serveerib tulemust käsuga `npm start`. Deploy toimub ainult pärast CI
kontrollide läbimist. Tootmissaladused ei tohi kasutada `VITE_` prefiksit;
brauserisse tohivad jõuda ainult `.env.example` failis avalikuks märgitud võtmed.
