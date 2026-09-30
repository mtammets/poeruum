# Maksete ja müüja kontroll

Avalik müüja peab kattuma Stripe’i konto õigusliku omanikuga. Nime või registrikoodi muutmisel muutub maksete olek pooleliolevaks. Kontroll toimub Stripe’i oleku küsimisel, Connecti sündmustel ja enne iga uue makselehe loomist. Poe kaubamärgi muutmine kinnitust ei tühista. Varasemate tellimuste müüjaandmete hetktõmmised säilivad.

Ettevõtluskontoga müüja kinnitab müüjaandmetes ise, et kasutab enda aktiivset LHV ettevõtluskontot ja suunab Stripe’i väljamaksed sellele. Kinnitus salvestub väljale `entrepreneurPayoutConfirmed` ning kehtib ka edaspidiste väljamaksete puhul: müüja peab kontoandmed ajakohased hoidma. Olemasolevale müüjale kinnitust automaatselt ei lisata. Varasem administraatori kontroll ei asenda müüja kinnitust.

Maksed aktiveeruvad automaatselt, kui müüja kinnitus ja andmed on olemas, nimi vastab Stripe’i õiguslikule omanikule, Stripe lubab makseid ja väljamakseid ning olemas on kasutusvalmis Eesti EUR-väljamaksekonto. Müüja kinnituse salvestamine käivitab veebis uue Stripe’i kontrolli. Kinnituse eemaldamine peatab uued maksed kohe. Konto või omaniku muutusi kontrollitakse uuesti automaatselt; administraatori tavapärast heakskiitu pole vaja. Konto või identiteedi muutumisel ei kasutata vana kontrolli tõendit uue konto kohta.

See on müüja enda kinnitus, mitte Poeruumi, Stripe’i ega MTA tõend ettevõtluskonto olemasolu kohta. Panga nimi, riik ja viimased numbrid ei tuvasta ettevõtluskonto maksurežiimi. MTA automaatset päringut pole lisatud. Kahtluse või andmete mittevastavuse korral võib küsida täiendavaid tõendeid; konto täielikke andmeid ei panda avalikesse seadetesse. Võimalikud platvormi aruandlus- ja muud seaduslikud kohustused on eraldi.

Olemasolevale müüjale saab platvormi haldaja selgesõnalise otsuse alusel teha eraldi ühekordse erandi. See salvestub privaatsesse `seller_payout_exceptions` tabelisse koos otsustaja, põhjuse ja kuupäevaga. Erand ei märgi `entrepreneurPayoutConfirmed` välja tõeseks ega tõenda konto maksurežiimi. Andmebaas arvutab kaitstud `entrepreneurPayoutAdminException` oleku; müüja ei saa seda ise lisada ega teise poodi kopeerida. Erand seotakse poe, omaniku, Stripe’i konto, režiimi, müüja identiteedi ja väljamaksekontoga. Nende muutmisel erand lõpeb. Stripe’i valmisoleku ja omaniku vastavuse kontrollid jäävad kehtima. Tavapärast administraatori kinnitamise töövoogu ega nuppu see ei lisa.

`/admin/payments` kuvab maksete probleemid ja müüjate seadistuse seisu, sealhulgas puuduva müüja kinnituse ning nime mittevastavuse. Administraatori kinnitamise nupp ja `approve_entrepreneur_payout` RPC on eemaldatud. Konto kontrolli andmed ja võimalikud varasemad tõendid jäävad privaatsesse tabelisse.

`charge.refunded`, `refund.created/updated/failed` ja maksevaidluse sündmused loevad Stripe’ist värske seisu. Täistagastuseks loetakse ainult õnnestunud tagastuste summat. Ostja tagastus ja müüja ülekande tagasipööramine on eraldi seisundid: ostja tagastus ei muutu ebaõnnestunuks, kui müüja kontol raha napib. Täistagastuse dokument väljastatakse kohe andmebaasis. Osalised tagastused (sh osaliste tagastuste dokumentide ja tasude arvestus) ning vaidlused vajavad administraatori käsitlust Stripe’is; süsteem ei tee nende põhjal automaatselt uusi rahaliigutusi.

Kui tagastus jääb raha puudumise taha, näeb müüja selgitust ning juhtum ilmub maksete kontrolli. Kontrolli Stripe’is müüja ja platvormi saadaolevat saldot, lahenda rahastamine ja kasuta „Saldo kontrollitud — proovi tagastust uuesti”. Sama töö jätkub järjekorras. Uus idempotentsusvõti tekib ainult administraatori korduskatsel pärast selgelt kinnitatud ebapiisava saldo viga. Ebaselge võrgukatkestuse järel võtit ei vahetata. Poeruum katab Stripe’i tagastamata algse maksetasu; täiendavat müüja debiteerimist ei ole lisatud.

Müüja summa „Sinu Stripe’i kontole” ei tähenda kinnitatud pangalaekumist ega ettevõtluskonto maksu järgset summat. Stripe’i ülekande jaotust ei muudeta. Pangaväljamakseid ega LHV maksukandeid see uuendus ei sünkrooni.

## Avaldamine ja kontroll

1. Käivita `npm run check`, Edge-testid, brauseritestid ning `scripts/test-payment-safeguards.sql` lokaalses andmebaasis.
2. Avalda migratsioonid `202609300009_payment_seller_safeguards.sql`, `202609300010_failed_external_refund_review.sql`, `202609300011_payment_review_setup_state.sql` ja `202609300012_seller_payout_declaration.sql` ja `202609300013_seller_payout_exception.sql` ning maksete, tagastuste ja Connecti Edge-funktsioonid, sh uus `payment-review`. Ühiste failide muutuste tõttu avalda ka `stripe-reservation-reaper`.
3. Käivita `node scripts/configure-stripe-settlement-webhook.mjs apply` ja `check` mõlema kasutatava Stripe’i režiimi õigete võtmetega. Skript säilitab senised tellitud sündmused ja lisab ka Connecti väljamaksekonto muudatused.
4. Avalda veeb pärast edukat CI-d. Kontrolli `/admin/payments` ja maksete endpoint’ide ligipääsukontrolli.

Uued sündmused ei asenda ajaloolist auditit: enne selle uuenduse avaldamist Stripe’is tehtud osalised tagastused või vaidlused võivad vajada eraldi võrdlust. Müüja enda kinnituse või eraldi administraatori erandita, samuti automaatseid kontrolle läbimata ettevõtluskontoga müüjal ei saa uut makselehte avada ega poodi avaldada.
