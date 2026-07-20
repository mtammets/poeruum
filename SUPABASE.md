# Supabase'i käivitamine

1. Loo Supabase'is uus projekt.
2. Ava **SQL Editor**, kleebi sinna `supabase/migrations/202607200001_initial_schema.sql` ja käivita see üks kord.
3. Kopeeri `.env.example` failiks `.env` ning lisa projekti URL ja **Publishable key** (sobib ka legacy `anon` key).
4. Supabase Auth seadetes lisa rakenduse URL lubatud redirect URL-ide hulka. Arenduses on see tavaliselt `http://localhost:5173/**`.
5. Käivita `npm run dev`.

Avalik pood avaneb aadressil `/p/poe-slug` (arenduses näiteks `http://localhost:5173/p/minu-pood`). Sama poe saab avada ka `?store=minu-pood` päringuga.

`service_role` võtit ei tohi Vite'i `.env` faili lisada. Rakendus kasutab brauseris publishable/anon võtit ja turvalisus põhineb migratsioonis olevatel RLS-reeglitel.

Kui e-posti kinnitamine on Auth seadetes aktiivne, peab uus kasutaja enne esimest sisselogimist kinnitama Supabase'i saadetud kirja.
