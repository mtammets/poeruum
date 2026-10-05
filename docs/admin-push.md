# Admini telefoni märguanded

Ülevaate ja analüütika **Märguanded** lubab selles seadmes uute avalehe külastuste
ja uute kontode teavitused. **Proovi** saadab serverist prooviteavituse. **Heli**
juhib endiselt ainult nähtava adminilehe heli.

iPhone’is ava `/admin` Safaris, vali jagamismenüüst **Lisa avaekraanile**, ava
tekkinud ikoon, logi sisse ning luba **Märguanded**. Vajalik on iOS 16.4 või uuem.
Heli ja kuvamist juhivad ka telefoni märguannete ning Focusi seaded.

## Juurutus

1. `node scripts/configure-admin-push.mjs prepare` genereerib võtmed ignoreeritud
   `.env` faili, kui kohalikke ega serverivõtmeid veel pole. Olemasolevaid võtmeid
   ei vahetata; privaatvõti ei tohi jõuda brauserisse.
2. Rakenda `202610050002_admin_push.sql` tavapärase migratsioonivooga.
3. `node scripts/configure-admin-push.mjs apply` salvestab võtmed Edge’i ja
   kontrollib olemasolevat Vaulti/cron’i seadistust.
4. Juuruta `admin-push` ja `admin-push-dispatch` käsuga
   `supabase functions deploy <nimi> --no-verify-jwt`. Esimene kontrollib ise
   Supabase Authist kasutajat ja tema praegust adminirolli; teine kontrollib
   `ONBOARDING_CRON_SECRET` väärtust. Mõlemad vajavad olemasolevat
   `POERUUM_SUPABASE_SECRET_KEY` serverisaladust.
5. Avalda frontend ja Node server tavapärase CI/Renderi voo kaudu.
6. `node scripts/configure-admin-push.mjs verify` ning allolev seadmekontroll.

Cron kasutab olemasolevaid Vaulti väärtusi `onboarding_reminders_url` ja
`onboarding_cron_secret`, mille seadistus on `SUPABASE.md` failis. VAPID-võtmete
vahetamine nõuab brauserites märguannete uuesti lubamist. Skript keeldub
olemasolevaid serverivõtmeid teistsuguste kohalike võtmetega asendamast.

## Töövoog

INSERT-triggerid lisavad uued `page_view` sündmused ja mitte-admini `auth.users`
kontod iga lubatud seadme järjekorda. Varasemaid sündmusi liitumisel ei saadeta.
`pg_net` äratab saatja pärast commit'i; minutiline cron taastab katkenud saatmised.
Töödel on kaheminutiline lease, kasvav retry-viivitus, kuni viis katset ning tund
maksimaalset vanust. Saatmisel on kaheksasekundiline timeout. Sama töö kordused
kasutavad sama topic'ut ja notification-tag'i. Võrgutarne pole täpselt ühekordne.

404/410 eemaldab aegunud seadme ja selle järjekorra. Adminiõiguste eemaldamine
peatab järgmisel claim'il tarned. Väljalülitamine eemaldab ainult praeguse brauseri
tellimuse; admini väljalogimine proovib samuti selle lõpetada. Endpoint'id ja
krüptovõtmed pole brauseri andmebaasirollidele loetavad. Payload ei sisalda
kasutajate isikuandmeid. Service worker ei puhverda adminilehti ega API vastuseid.
Märguande vajutus avab admini tavapärase sisselogimiskontrolliga.

## Kontroll

```sh
npm run test:admin-push-edge
npm run test:smoke -- e2e/admin-push.e2e.ts --workers=1
npm run build:app
node scripts/test-admin-push-worker.mjs
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres --file scripts/test-admin-push.sql
```

SQL-test on transaktsioonis ja keelab fixture'ite võrgusaatmise. Brauseritestid
simuleerivad seadme permission/subscription API-sid; need ei tõenda iOS-i tarnet.
Päris iPhone’is: luba märguanded, vajuta **Proovi**, lukusta telefon ning ava
teisest seadmest Poeruumi avaleht. Kontrolli lukuekraani teadet ja selle vajutusest
admini avanemist. Seejärel lülita märguanded välja ja korda külastust; uut teadet
enam tulla ei tohi. Internetiühendus ja Focusi seaded võivad tarnet mõjutada.
