# Poeruumi testimine ja CI

## Kohalik kvaliteedikontroll

`npm run check` käivitab ESLinti, Vitesti üksustestid, rakenduse production-mode build’i ja production-sõltuvuste turvaauditi. CI build ei genereeri SEO-kataloogi, sest see nõuab välist Supabase’i keskkonda; väljalaskekäsk `npm run build` genereerib ka SEO-lehed.

Andmebaasi täielikuks kontrolliks peab Docker töötama:

```sh
npx supabase db start
npx supabase db reset --local --no-seed
npx supabase db lint --local --schema public,extensions --level warning --fail-on warning
npx supabase stop --no-backup
```

GitHub Actionsi `CI` töövoog teeb need kontrollid iga pull request’i ja `main` haru push’i järel puhtas keskkonnas. Ükski CI põhikontroll ei kasuta tootmise Supabase’i ega Stripe’i võtmeid.

## Ajutine staging E2E

`Ephemeral Staging E2E` on käsitsi käivitatav. See loob Micro-suuruses Supabase’i projekti ja Stripe’i testkonfiguratsiooni ainult testi ajaks ning kustutab mõlemad töö lõpus ka vea korral. Iga käivitus kasutab ligikaudu ühe tunni Micro compute’i. Eraldi kahe tunni järel töötav koristaja kustutab üle kolme tunni vanused `poeruum-e2e-*` projektid, mis võisid jääda alles katkestatud GitHub Actionsi job’ist.

Töövoos on kolm sõltumatut kaitset:

- ajutise projekti nimi peab algama `poeruum-e2e-`;
- tootmise Supabase’i projektiviidet `foctericixquaogwboqg` ei kustutata kunagi;
- Stripe’i võti peab algama `sk_test_`.

GitHubi `staging` environment vajab ainult kahte saladust:

- `SUPABASE_ACCESS_TOKEN`, millel on õigus ajutisi projekte luua ja kustutada;
- `STRIPE_SECRET_KEY`, mis peab olema Stripe’i testrežiimi `sk_test_` võti.

Test loob dünaamiliselt webhook endpoint’i, 29 € testhinna ja 24% testmaksumäära. Seejärel rakendatakse värskele Supabase’i projektile kõik migratsioonid ja vajalikud Edge Functionid. Testid loovad ainult ajutisi kasutajaid, poode, Stripe Checkout Sessioneid, kliente ja subscription’e.
