# Supabase'i käivitamine

1. Loo Supabase'is uus projekt.
2. Täida lokaalne `.env` fail. Brauserivõtmete kõrval on seal eraldi CLI ja serveripoolse halduse võtmed.
3. Kontrolli võtmeid käsuga `npm run supabase:check`.
4. Rakenda migratsioon automaatselt käsuga `npm run supabase:deploy`. See lingib projekti ja käivitab `supabase/migrations` kausta rakendamata migratsioonid.
5. Supabase Auth seadetes lisa rakenduse URL lubatud redirect URL-ide hulka. Arenduses on see tavaliselt `http://localhost:5173/**`.
6. Käivita `npm run dev`.

Avalik pood avaneb aadressil `/p/poe-slug` (arenduses näiteks `http://localhost:5173/p/minu-pood`). Sama poe saab avada ka `?store=minu-pood` päringuga.

`SUPABASE_SECRET_KEY` või legacy `SUPABASE_SERVICE_ROLE_KEY` võib olla lokaalses `.env` failis ainult serveripoolseks halduseks. Sellel ei tohi olla `VITE_` prefiksit ning seda ei tohi importida `src/` koodi. Rakendus kasutab brauseris publishable/anon võtit ja turvalisus põhineb migratsioonis olevatel RLS-reeglitel.

Kui e-posti kinnitamine on Auth seadetes aktiivne, peab uus kasutaja enne esimest sisselogimist kinnitama Supabase'i saadetud kirja.

## Administraatori töölaud

Administraatori töölaud avaneb aadressil `/admin`. Ligipääs kontrollitakse serveris kasutaja `app_metadata.role` väärtuse järgi; tavakasutaja ei saa admini koondpäringut käivitada.

1. Rakenda uusimad migratsioonid käsuga `npm run supabase:deploy`.
2. Loo või vali Supabase Authis administraatori kasutaja.
3. Määra roll käsuga `npm run supabase:set-admin -- nimi@example.com`.
4. Kui kasutaja oli juba sisse logitud, logi välja ja uuesti sisse, et uus JWT sisaldaks admini rolli.

Admini roll eemaldatakse Supabase Auth Admin API kaudu, muutes kasutaja `app_metadata.role` väärtust. Ära paiguta admini rolli `user_metadata` alla, sest kasutaja saab seda ise muuta.
