# Maksete ja müüja kontroll

Avalik müüja peab kattuma Stripe’i konto õigusliku omanikuga. Nime või registrikoodi muutmisel muutub maksete olek pooleliolevaks. Kontroll toimub Stripe’i oleku küsimisel, Connecti sündmustel ja enne iga uue makselehe loomist. Poe kaubamärgi muutmine kinnitust ei tühista. Varasemate tellimuste müüjaandmete hetktõmmised säilivad.

Ettevõtluskonto kinnitamine toimub `/admin/payments` vaates. Vali „Kontrolli värskeid kontoandmeid”, kontrolli Stripe’i EUR-väljamaksekonto täielikku IBANit ja omanikku privaatse tõendi alusel ning sama konto aktiivsust MTA ettevõtluskonto otsingus. Kinnita alles siis, kui see on sama müüja aktiivne LHV ettevõtluskonto. Viimased neli numbrit või panga nimi pole piisav tõend. Lisa kontrolli kuupäev ja privaatse tõendi viide; ära kopeeri IBANit ega isikukoodi avalikesse seadetesse ega märkusesse. Kui täielikku kontot ei saa tõendada, jäta konto kinnitamata.

Kinnitus seotakse Stripe’i konto, režiimi, müüja identiteedi ja konkreetse väljamaksekonto tunnustega. Konto või omaniku muutus tühistab kinnituse. Konto kontrolli andmed on privaatses tabelis, kuhu müüja ja avalik veeb ei pääse. MTA aktiivsuse kontroll on käsitsi tehtud kontroll selle kuupäeval, mitte pidev MTA-integratsioon; kahtluse korral tuleb see uuesti teha.

`charge.refunded`, `refund.created/updated/failed` ja maksevaidluse sündmused loevad Stripe’ist värske seisu. Täistagastuseks loetakse ainult õnnestunud tagastuste summat. Ostja tagastus ja müüja ülekande tagasipööramine on eraldi seisundid: ostja tagastus ei muutu ebaõnnestunuks, kui müüja kontol raha napib. Täistagastuse dokument väljastatakse kohe andmebaasis. Osalised tagastused (sh osaliste tagastuste dokumentide ja tasude arvestus) ning vaidlused vajavad administraatori käsitlust Stripe’is; süsteem ei tee nende põhjal automaatselt uusi rahaliigutusi.

Kui tagastus jääb raha puudumise taha, näeb müüja selgitust ning juhtum ilmub maksete kontrolli. Kontrolli Stripe’is müüja ja platvormi saadaolevat saldot, lahenda rahastamine ja kasuta „Saldo kontrollitud — proovi tagastust uuesti”. Sama töö jätkub järjekorras. Uus idempotentsusvõti tekib ainult administraatori korduskatsel pärast selgelt kinnitatud ebapiisava saldo viga. Ebaselge võrgukatkestuse järel võtit ei vahetata. Poeruum katab Stripe’i tagastamata algse maksetasu; täiendavat müüja debiteerimist ei ole lisatud.

Müüja summa „Sinu Stripe’i kontole” ei tähenda kinnitatud pangalaekumist ega ettevõtluskonto maksu järgset summat. Stripe’i ülekande jaotust ei muudeta. Pangaväljamakseid ega LHV maksukandeid see uuendus ei sünkrooni.

## Avaldamine ja kontroll

1. Käivita `npm run check`, Edge-testid, brauseritestid ning `scripts/test-payment-safeguards.sql` lokaalses andmebaasis.
2. Avalda migratsioon `202609300009_payment_seller_safeguards.sql` ning maksete, tagastuste ja Connecti Edge-funktsioonid, sh uus `payment-review`. Ühiste failide muutuste tõttu avalda ka `stripe-reservation-reaper`, `order-receipt` ja `order-documents`.
3. Käivita `node scripts/configure-stripe-settlement-webhook.mjs apply` ja `check` mõlema kasutatava Stripe’i režiimi õigete võtmetega. Skript säilitab senised tellitud sündmused ja lisab ka Connecti väljamaksekonto muudatused.
4. Avalda veeb pärast edukat CI-d. Kontrolli `/admin/payments` ja maksete endpoint’ide ligipääsukontrolli.

Uued sündmused ei asenda ajaloolist auditit: enne selle uuenduse avaldamist Stripe’is tehtud osalised tagastused või vaidlused võivad vajada eraldi võrdlust. Kinnitamata ettevõtluskontolt ei saa uut makselehte avada ega poodi avaldada.
