# Visiitkaardi editor

Admini vaade asub aadressil `/admin/business-card`. Kasutaja peab läbima olemasoleva admini sessiooni- ja rollikontrolli. Kujundus ei loo avalikku veebilehte ega avalikke pildifaile.

## Salvestamine

- Igal administraatoril on üks kahepoolne kujundus tabelis `admin_business_card_drafts`.
- RLS lubab lugeda ainult enda kujundust ja ainult serveri `app_metadata.role = admin` rolliga. Tavakasutaja, anonüümne külastaja ja teine administraator ei saa kujundust lugeda.
- Kirjutamine käib funktsiooni `admin_save_business_card(next_document, expected_revision)` kaudu. Otsesed INSERT/UPDATE/DELETE õigused puuduvad; funktsioon määrab omaniku sessiooni järgi ning suurendab versiooni ise.
- `expected_revision = null` loob ainult puuduva kujunduse. Olemasoleva kujunduse salvestamine nõuab viimati loetud versiooni; sama versiooni põhjal tehtud järgnev salvestus saab SQLSTATE `40001`. Konflikti ei proovita automaatselt uuema versiooniga üle kirjutada.
- Kujunduse PNG- ja JPEG-pildid on JSON-is andme-URL-idena. Kogumahu piir on 12 MB; kummalgi küljel saab olla kuni 60 elementi.
- Kohalik taastekoopia asub IndexedDB andmebaasis `poeruum-business-card-drafts`, objektipoes `drafts`, kasutaja ID võtme all. Koopia sisaldab kujundust, pilte, pilve baasversiooni, muudatuste olekut ja salvestusaega.
- Kohaliku salvestuse õnnestumist kinnitatakse alles IndexedDB tehingu lõpuleviimisel. Kvoodi-, ligipääsu- ja laadimisvead tagastatakse kasutajaliidesele; ebaõnnestunud pilvelaadimist ei käsitleta puuduva kujundusena.

IndexedDB koopia kuulub brauseriprofiilile, pilvekoopia administraatori kontole. Brauseri saidiandmete kustutamine eemaldab kohaliku koopia. Administraatori konto kustutamine eemaldab pilvekoopia välisvõtme `on delete cascade` kaudu.

## Kasutuselevõtt

Enne avaldamist peavad läbima rakenduse ja andmebaasi kontrollid.

Pilves salvestamise eeltingimus on `supabase/migrations/202609050001_admin_business_card.sql`. Rakenda see tavapärase kinnitatud väljalaske käigus enne uut kasutajaliidest. Migreerimata keskkonna viga peab jätma kohaliku mustandi alles.

PDF-i tehnilised seaded ja värviprofiili piirangud on kirjeldatud failis [public/print/README.md](../public/print/README.md); fontide päritolu ja litsentsid failis [public/fonts/business-card/README.md](../public/fonts/business-card/README.md).

## Kontrollid

```sh
npx vitest run src/businessCard/storage.test.ts
npx playwright test e2e/business-card-storage.e2e.ts --project chromium
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres --file scripts/test-business-card-drafts.sql
```

SQL-test vajab kohalikku migreeritud Supabase'i andmebaasi; testandmed eemaldatakse tehingu tagasipööramisega. Test kontrollib administraatorite eraldatust, tavakasutaja ja anonüümse kasutaja piiranguid, otseste kirjutuste keeldu, versioonikonflikte ning vigase ja liiga suure dokumendi tagasilükkamist. Sama test on lisatud CI andmebaasikontrollidesse.
