# Poeruumi turva- ja seirekorraldus

## Päringumahu piiramine

Avalikud ning kasutaja algatatud tundlikud Edge Functionid kasutavad andmebaasis
atomaarset fikseeritud ajakna loendurit. Võti on `RATE_LIMIT_SALT` saladusega
SHA-256 räsi IP-aadressist või sisselogitud kasutaja ID-st.
Algandmeid rate limit'i tabelisse ei salvestata. Stripe'i webhook'e kaitseb
Stripe'i allkirja kontroll; neile ei rakendata IP-piirangut, et Stripe'i
korrektseid korduskatseid mitte blokeerida.

## Veaseire ja alarmid

Brauseri käsitlemata vead ning Edge Functionite kriitilised tõrked salvestatakse
`application_error_events` tabelisse. Kontekstist eemaldatakse saladuste ja
isikuandmetega väljad. Sündmused kustutatakse 30 päeva järel.

`poeruum-health-monitor` käivitub iga viie minuti järel ja kontrollib:

- avalehe HTTP vastust ning rakenduse juurelementi;
- vähemalt viit rakenduse viga viie minuti jooksul või üht kriitilist viga
  15 minuti jooksul;
- ebaõnnestunud `pg_cron` töid viimase 15 minuti jooksul.

Alarm saadetakse `SUPPORT_NOTIFICATION_EMAIL` aadressile Resendi kaudu kohe ning
jätkuva vea korral kõige rohkem kord tunnis. Taastumisel saadetakse eraldi teade.
Alarmide olekut hoitakse `monitor_alert_states` tabelis.

Poeruumil pole eraldi postkastiteenust, seega võtab Resend Inbound vastu
juurdomeeni `poeruum.ee` kirjad. `resend-webhook` lubab uue vestluse luua ainult
`SUPPORT_PUBLIC_EMAIL` või `SUPPORT_INBOUND_ADDRESS` täpsele aadressile saabunud
kirjast; teised `@poeruum.ee` saajad jäetakse töötlemata. Vestluse
vastuseaadress sisaldab vestluse UUID-d kujul
`vastus+<uuid>@poeruum.ee`; webhook kontrollib enne vastuse lisamist, et saatja
kattub vestluse kontaktiga. Automaatvastajad jäetakse töötlemata ning uute
väliste vestluste mahule rakendatakse saatja- ja üldpiirang. Kui juurdomeenile
lisatakse tulevikus eraldi postkastiteenus, tuleb inbound viia alamdomeenile ja
kasutada postiteenuse edasisuunamist.

Sisemisest seirest sõltumatu GitHub Actionsi `Production Health` töö kontrollib
iga 15 minuti järel avalehte, andmebaasiga seotud health endpoint'i ja olulisi
turvapäiseid. Töö ebaõnnestumine on nähtav Actionsi alarmi ning hoidla omaniku
GitHubi teavitusena.

## Tootmise seadistamine ja kontroll

```sh
npm run supabase:auth-security
npm run security:headers:apply
npm run security:headers:verify
npm run deploy:gate:verify
curl --fail https://foctericixquaogwboqg.supabase.co/functions/v1/health-check
```

Renderi päiseid haldab `scripts/configure-render-security.mjs`. Muudatuse järel
tuleb päris vastust kontrollida ka `curl -I https://poeruum.ee/` abil.
Renderi automaatne deploy peab olema väärtusega `After CI Checks Pass`; seda
rakendab `npm run deploy:gate:apply` ja kontrollib `npm run deploy:gate:verify`.

## Kaupmehe e-posti kvaliteet

Ajutise meiliteenuse aadressiga saab kinnitada konto ja seadistada poomustandit.
`publish_store`, `stripe-connect` (kõik `start` režiimid) ja `stripe-billing-checkout`
kontrollivad serveris värsket Auth konto aadressi ning kinnitust. Pooleliolev
`email_change` ei anna õigusi. Oleku lugemine, tagastused, paketi tühistamine ja konto
sulgemine jäävad kättesaadavaks. Aktiveeritud poe konto aadressi ei saa hiljem
ajutise teenuse aadressi vastu vahetada. E-posti kinnitamine ei tõesta isikusamasust.

Domeeninimekiri on andmebaasis `email_domain_rules`; kliendi e-posti ei edastata
kontrollimiseks välisele teenusele. Kohalikud erandid (`disposable=false`) on
kogukonna nimekirjast kõrgema prioriteediga, sh püsivad privaatsusaliased.
Kontrolli nimekirja uuendusi kord nädalas ja genereeri ülevaatuseks uus migratsioon:

```sh
node scripts/update-disposable-email-domains.mjs supabase/migrations/YYYYMMDDNNNN_disposable_email_domains.sql
```

Generaator ei muuda andmebaasi. Rakenda muudatus tavapärase migratsioonina pärast
erandite ning muutuste ülevaatust. Vale märgistuse korral saab haldur lisada kinnitatud
erandi tabelisse `email_domain_rules` ja klient kasutada kontaktlinki `info@poeruum.ee`.

`observe_signup` on Supabase Authi `before_user_created` hook, mis ainult salvestab
registreerumiskatse soolatud IP-räsi ning aja. See ei blokeeri registreerumist ega saada
kirju. Admini kasutajate vaade näitab hoiatust, kui samast võrgust on tunni jooksul
vähemalt viis katset. 30 päeva tegevuseta ajutise aadressiga kontod on eraldi filtris.

Juurutusjärjekord: migratsioonid, Edge Functionid `stripe-connect` ja
`stripe-billing-checkout`, veebirakendus ning seire hook:

```sh
node scripts/configure-signup-observation.mjs apply
node scripts/configure-signup-observation.mjs verify
npm run test:account-email-db
npm run test:account-email-edge
```

Hooki seadistamine ei kirjuta üle teise funktsiooni aktiivset hooki ega muuda CAPTCHA,
SMTP või e-posti kinnitamise seadeid. Tagasipööramisel keela esmalt Authi
`hook_before_user_created_enabled`; alles seejärel võib seire funktsiooni eemaldada.
Pelgalt ajutise domeeni tõttu kontot ei blokeerita ega kustutata. Kinnitatud
kuritarvitamise korral peata konto ligipääs ning säilita uurimiseks vajalikud logid.
