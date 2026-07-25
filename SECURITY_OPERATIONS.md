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

Sisemisest seirest sõltumatu GitHub Actionsi `Production Health` töö kontrollib
iga 15 minuti järel avalehte, andmebaasiga seotud health endpoint'i ja olulisi
turvapäiseid. Töö ebaõnnestumine on nähtav Actionsi alarmi ning hoidla omaniku
GitHubi teavitusena.

## Tootmise seadistamine ja kontroll

```sh
npm run supabase:auth-security
npm run security:headers:apply
npm run security:headers:verify
curl --fail https://foctericixquaogwboqg.supabase.co/functions/v1/health-check
```

Renderi päiseid haldab `scripts/configure-render-security.mjs`. Muudatuse järel
tuleb päris vastust kontrollida ka `curl -I https://poeruum.ee/` abil.
