# Admini telefoni märguanded

Admini menüüriba hammasratas avab **Seaded** (`/admin/settings`).
**Märguanded selles seadmes** lubab teavitused. **Avalehe külastused**, **Kaubamaja külastused**,
**Uued kontod**, **Uued tugipöördumised** ja **Teenustasude laekumised** saab eraldi sisse või välja lülitada. Valikud salvestatakse
automaatselt selle seadme tellimusele. **Saada prooviteavitus** kontrollib tarnet.
Märguannete heli juhitakse telefoni või brauseri seadetes.

iPhone’is ava `/admin` Safaris, vali jagamismenüüst **Lisa avaekraanile**, ava
tekkinud ikoon, logi sisse ning ava **Seaded** ning luba **Märguanded selles seadmes**. Vajalik on iOS 16.4 või uuem.
Heli ja kuvamist juhivad ka telefoni märguannete ning Focusi seaded.

Admini avaekraani ikoon on laimirohelise tausta ja tumeda Poeruumi märgiga,
nimega **Poeruum Admin**. Avaleht ja Kaubamaja kasutavad rohelist ikooni.
Allikad on `public/images/admin-app-icon.svg` ja
`public/images/poeruum-app-icon.svg`; taust täidab mõlemal kogu ikooni. PNG-failid saab uuesti luua käsuga `node scripts/generate-app-icons.mjs`.
Kaupmeeste poodidele seda platvormi ikooni ei lisata.

## Juurutus

1. `node scripts/configure-admin-push.mjs prepare` genereerib võtmed ignoreeritud
   `.env` faili, kui kohalikke ega serverivõtmeid veel pole. Olemasolevaid võtmeid
   ei vahetata; privaatvõti ei tohi jõuda brauserisse.
2. Rakenda `202610050002_admin_push.sql`, `202610060001_admin_push_preferences.sql`, `202610120001_admin_support_push.sql`, `202610130001_admin_revenue_push.sql`, `202610130002_admin_revenue_push_store_name.sql` ja `202610170001_admin_directory_push.sql` tavapärase migratsioonivooga.
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

Olemasoleva paigalduse tugiteavituste uuendamisel juuruta esmalt `admin-push-dispatch`,
mis tunneb uut `support` liiki, seejärel uus migratsioon, `admin-push` ja frontend.
Tugiteavitused on olemasolevatel ja uutel seadmetel vaikimisi lubatud. Vanema
brauseriversiooni valikute salvestamine säilitab tugiteavituste senise valiku.

Teenustasude teavituste lisamisel juuruta esmalt `admin-push-dispatch`, mis tunneb
uut `revenue` liiki ja summat, seejärel `202610130001_admin_revenue_push.sql`,
`admin-push` ja frontend. Uus liik on seadmetel vaikimisi lubatud; varasemad
brauseriversioonid säilitavad selle valiku ka teiste liikide salvestamisel.
Migratsioon laiendab privaatse claim-RPC vastust ning taastab selle õigused.

Poe nimega lühiteavituste jaoks avalda esmalt frontend, mille service worker säilitab
teadlikult tühja teavituse sisu. Seejärel rakenda `202610130002_admin_revenue_push_store_name.sql`
ja juuruta `admin-push-dispatch` ning `admin-push`. Migratsioon lisab poe nime ka
olemasolevatele järjekorra kirjetele. Ava telefonis Poeruum uuesti, et worker uueneks.

Kaubamaja külastuste lisamisel juuruta esmalt `admin-push-dispatch`, mis tunneb
uut `directory_visit` liiki, seejärel `202610170001_admin_directory_push.sql`,
`admin-push` ja frontend koos uuendatud service worker'iga. Uus liik on olemasolevatel
ja uutel seadmetel vaikimisi lubatud; varasemate brauseriversioonide salvestused
säilitavad selle valiku. Ava telefonis Poeruum uuesti, et worker saaks uue sihtlehe toe.
Vanem worker kuvab teate, kuid suunab vajutuse admini ülevaatesse.

## Töövoog

INSERT-triggerid lisavad uued `page_view` sündmused, mitte-admini `auth.users`
kontod ja kliendi avalikud `support_messages` sõnumid vastava liigiga nõustunud
seadmete järjekorda. Tugiteavitus saadetakse rakendusest või e-kirjaga saabunud
pöördumise ning kliendi uue vastuse korral. Admini vastused, admini algatatud
vestlused ja sisemised või süsteemi märkmed seda ei käivita. Korduv e-kirja
webhook ei lisa sama sõnumit ega teavitust uuesti. Liigi väljalülitamine
eemaldab ka selle seadme vastava liigi ootel tööd; juba saadetud teavitust
tagasi kutsuda ei saa. Kõigi liikide väljalülitamine säilitab seadme tellimuse. Varasemaid sündmusi liitumisel ei saadeta.
`pg_net` äratab saatja pärast commit'i; minutiline cron taastab katkenud saatmised.
Töödel on kaheminutiline lease, kasvav retry-viivitus, kuni viis katset ning tund
maksimaalset vanust. Saatmisel on kaheksasekundiline timeout. Sama töö kordused
kasutavad sama topic'ut ja notification-tag'i. Võrgutarne pole täpselt ühekordne.

Kaubamaja `directory_analytics_events.page_view` saadab **Uus Kaubamaja külastus**
teate, mille sisu on **Keegi avas Poeruumi Kaubamaja.** Vajutus avab
`/admin/kaubamaja` statistika. Sama analüütikaseansi korduv sündmus või päringu
kordus uut teadet ei lisa; otsingud, kaartide näitamised ja lingiklikid ei käivita
eraldi külastusteadet. Lehe uuesti laadimine alustab olemasoleva analüütikaloogika
järgi uut külastust. Sisselogitud admini enda sirvimist Kaubamaja ei mõõda.
Kaubamaja lüliti on avalehe külastuste lülitist sõltumatu.

Teenustasu teavitus käivitub `revenue_events` tabelisse lisatud positiivsest
müügitasust või kuutasust. Pealkiri näitab ainult poe nime ja summat, näiteks
**Näidispood +1,25 €**, ning teavitusel ei ole lisateksti. Puuduva poe nime korral
kasutatakse **Pood +1,25 €**.
Summa on admini ülevaatega samal alusel: käibemaksuta ja enne Stripe’i tasusid.
Poe nimi, summa ning valuuta kopeeritakse järjekorda, et korduskatse kuvaks sama laekumist ka poe ümbernimetamisel.
Testmaksed (ka tellimuse testrežiimi järgi), tagastused ja arvelduskorrektsioonid
teavitust ei käivita. Korduv makse-webhook ega olemasoleva tulurea muutmine uut
teavitust ei tekita. Märguande vajutus avab admini ülevaate. Liitumine või liigi
uuesti lubamine varasemaid laekumisi ei saada.

404/410 eemaldab aegunud seadme ja selle järjekorra. Adminiõiguste eemaldamine
peatab järgmisel claim'il tarned. Väljalülitamine eemaldab ainult praeguse brauseri
tellimuse; admini väljalogimine proovib samuti selle lõpetada. Endpoint'id ja
krüptovõtmed pole brauseri andmebaasirollidele loetavad. Payload ei sisalda
kasutajate isikuandmeid. Service worker ei puhverda adminilehti ega API vastuseid.
Tugiteavituse vajutus avab `/admin/support`, Kaubamaja külastus `/admin/kaubamaja`
ja teiste märguannete vajutus `/admin`, kõik tavapärase sisselogimiskontrolliga. Kliendi nime, e-posti ega sõnumi sisu
lukuekraani teavitusse ei lisata.

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
Päris iPhone’is: luba märguanded, vajuta **Saada prooviteavitus**, lukusta telefon ning ava
teisest seadmest Poeruumi avaleht. Kontrolli lukuekraani teadet ja selle vajutusest
admini avanemist. Seejärel lülita märguanded välja ja korda külastust; uut teadet
enam tulla ei tohi. Internetiühendus ja Focusi seaded võivad tarnet mõjutada.
