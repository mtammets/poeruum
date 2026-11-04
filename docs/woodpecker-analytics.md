# Musta rähni kampaania statistika

Admini menüü **Musta rähni päevad** avab `/admin/musta-rahni`.
Kampaania algus on 4.11.2026 kell 06.00 Europe/Tallinn ehk 04.00 UTC.
Lõpp loetakse olemasolevast Musta rähni kampaania ajastusest, kui see on
algusest hilisem. Statistika lisamine ei muuda avaliku kampaania ajastust.

## Avaldamine

Rakenda `202611040001_woodpecker_analytics.sql`, avalda Edge Functionid
`woodpecker-analytics` ja `stripe-store-checkout` ning rakenduse uus build.
`woodpecker-analytics` kasutab `verify_jwt = false`; lubatud päritolu,
sündmuste sisu, päringu suurus ja päringukiirus kontrollitakse funktsioonis.
Andmete vastuvõtmise ja tellimuse sidumise RPC-d on ainult `service_role`-ile.
Raporti RPC kontrollib administraatori õigust andmebaasis.

Kliendi- ja andmebaasikell takistavad sündmuste kogumist enne algusaega.
Uus tabel salvestab vastuvõtuaja. Enne avaldamist kogumata sündmusi ei taastata;
vaates on näha mõõtmise algus. Tasutud tellimuste ajalugu on olemasolevas
tellimustabelis ja hõlmab tervet valitud kampaaniaperioodi.

## Näitajad

- Kolm keskkonda: `kaubamaja.poeruum.ee`, `kruk-kruk.ee` / `www.kruk-kruk.ee`
  ning `kruk-kruk.poeruum.ee`.
- Külastus on keskkonna sessioon. Uus sessioon algab 30 minuti katkestuse,
  lehe uuesti laadimise või Eesti kuupäeva vahetumise järel. Statistika tunnus
  püsib ainult avatud lehe mälus; analüütikaküpsiseid ega brauserisalvestust pole.
- „Lehesessioone” ja „Mängijaid” ei tohi tõlgendada tuvastatud inimeste arvuna.
  Domeenide vahel ühtset inimese tunnust ei kanta. Allikad ja edasiklikid
  näitavad keskkondade vahel liikumist koondtasemel.
- Mäng algab esimese lennujuhtimise sisendiga. Automaatne lennuvaade on eraldi
  sündmus ega suurenda mängijate arvu. Ühe mängu tulemuses võetakse suurim
  kumulatiivne mütside arv ja kestus, mitte vahearuannete summa.
- Mänguaeg ja tulemused saadetakse ka vahepeal, sulgemisel ja lehelt lahkumisel.
  Brauseri sunniviisilise sulgemise korral võib viimane vahearuanne jääda puudu.
- Mängija ost seotakse ainult samalt avatud lehelt esitatud tellimusega. Näiteks
  kaubamaja kampaaniast saab mütsi otse tellida. Teisel lehel, teises brauseris
  või pärast taaslaadimist tehtud ostu ei omistata oletuse põhjal mängijale.
- Nimi on tasutud tellimusel esitatud ostja nimi, mitte kontrollitud mängijakonto.
  Ost peab olema mängu alustamisest hilisem. Raport ei tagasta e-posti ega telefoni.
- Müük: ainult Krük Krüki päris Stripe'i tellimused, mis on tasutud või tagastatud;
  tagastused vähendavad tulu. Test- ja pooleliolevad maksed on välja jäetud.
  Poe kogu müük perioodil ja jälgitud külastusega seotud tellimused on eraldi.
- Ostuhuvi ribad näitavad tegevuse teinud sessioone, mitte kohustuslikult
  järjest läbitud samme. Üks sessioon loetakse etapis üks kord.
- Kestus loeb ainult nähtavat vahelehte. „Aktiivset” tähendab sündmust viimase
  viie minuti jooksul. Administraatoreid, sisselogitud kaupmehi, kohalikku
  arendust ja eelvaateid ei mõõdeta.
- Säilitamine: sündmused ja tellimusega sidumine kuni 180 päeva. Tellimuse
  kustutamine kustutab ka selle kampaaniaseose.

Raport värskendub avatud vaates 30 sekundi järel ja vahelehele naastes.
Mängijatel on nime/ID otsing, 25 rea kaupa lehitsemine ning kogu filtreeritud
nimekirja CSV-eksport fikseeritud lõpuajaga. Eraldi CSV sisaldab põhinäitajaid,
keskkondade kokkuvõtet ja ajagraafiku andmeid. CSV neutraliseerib valemimärgid.
Vigast andmepäringut ei kuvata nulltulemusena.

## Kontrollimine

```sh
npm run test:unit -- src/lib/woodpeckerAnalytics.test.ts src/lib/woodpeckerTracking.test.ts
npm run test:smoke -- e2e/woodpecker-analytics.e2e.ts --project=chromium
npm run build:app
node_modules/.bin/deno check --node-modules-dir=auto --frozen --minimum-dependency-age=0 supabase/functions/woodpecker-analytics/index.ts supabase/functions/stripe-store-checkout/index.ts
```

Brauseritestide numbrid ja ostjanimed on testfixtuurid; rakendus ise näidisandmeid
statistikana ei esita. Ekraanipildid tekivad `output/woodpecker-*.png` alla.

SQL-i migratsiooni ja raportit saab kontrollida eraldatud PGlite'i andmebaasis
(tootmisühendust ei kasutata). Test katab õigused, domeenipiirangu, korduvad
sündmused, mängutulemused, päris-/testmaksed, tagastused, tellimusega sidumise,
otsingu, lehitsemise ja ajapiirid. Testiteek paigaldatakse ajutisse kausta:

```sh
npm install --prefix /tmp/poeruum-analytics-check --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE=/tmp/poeruum-analytics-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-woodpecker-analytics.mjs
```
