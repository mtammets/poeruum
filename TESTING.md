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

## Staging E2E

`Staging E2E` on käsitsi käivitatav ja kasutab ainult GitHubi `staging` environment’i saladusi. Töövoos on kaks sõltumatut kaitset:

- tootmise Supabase’i projektiviide `foctericixquaogwboqg` on keelatud;
- Stripe’i võti peab algama `sk_test_`.

Eraldi staging-Supabase’i projektile tuleb lisada järgmised environment secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_FIXED_PLAN_PRICE_ID`
- `STRIPE_FIXED_PLAN_TAX_RATE_ID`

Stripe’i testrežiimis peab olema webhook endpoint:

`https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`

Endpoint kuulab vähemalt sündmusi `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` ja `invoice.payment_failed`. Selle signing secret läheb `STRIPE_WEBHOOK_SECRET` väärtuseks.

Testid loovad ainult ajutisi kasutajaid, poode, Stripe Checkout Sessioneid, kliente ja subscription’e ning koristavad need töö lõpus. Stagingu migratsioonid ja vajalikud Edge Functionid rakendatakse enne iga E2E käivitust.
