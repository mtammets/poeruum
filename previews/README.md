# Maksete eelvaade

Käivita projekti juurkaustas:

```sh
npm run dev:payments
```

Ava http://127.0.0.1:4185/previews/payments.html. Brauseri automaatseks avamiseks
kasuta `npm run dev:payments -- --open`.

## Mida saab vaadata?

- **Poeruumi vaated** avab rakenduse enda poe nime, ettevõtte, maksete, tarne,
  esimese toote ja avaldamise sammud. Konto loomist pole vaja. Valikus on
  ühendamata, pooleli, kontrollimisel, valmis ja lisaandmeid vajavad maksed.
- **Stripe’i vorm** avab päris Stripe Connecti komponendi testkontoga. Valikus
  on uus konto, eeltäidetud ettevõte, eeltäidetud esindaja ja aadressi kontrolli
  veaks mõeldud testandmed. Aadressi vea ilmumine sõltub ülejäänud andmete
  esitamisest ja Stripe’i kontrollist.
- **Telefon / Arvuti** muudab vormi tegelikku laiust, säilitades poolelioleva
  sammu. Vaate või olukorra vahetamine ja **Alusta uuesti** loovad uue katse.

Poeruumi tekstide ja stiilide muudatused jõuavad arendusserveri kaudu ka
eelvaatesse. Stripe’i välimus ja kogutavad andmed kasutavad rakenduse enda
`StripeEmbeddedOnboarding` komponenti ning ühiseid serveri eeltäitmise ja
AccountSessioni seadistusi. Stripe määrab sammud konto andmete ja nõuete järgi:
eelvaade ei ole kõikide võimalike klientide fikseeritud ekraanigalerii.
Testrežiimis ei toimu päris isikusamasuse ega pangakonto kontrolli.

## Stripe’i testvõtmed

Lisa sama Stripe’i testkeskkonna võtmed `.env.local` või `.env` faili:

```dotenv
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
STRIPE_TEST_SECRET_KEY=sk_test_...
```

Pärast võtmete või eelvaateserveri koodi muutmist käivita server uuesti.
`.env.local` kirjutab üle `.env` väärtused; protsessi keskkonnamuutujad on
mõlemast eespool. Tootmisvõtmeid varuvariandina ei kasutata. Ilma testvõtmeteta
saab Poeruumi enda vaateid endiselt vaadata.

Stripe’i vorm kasutab testandmeid. Sobivad sisendid on näidatud eelvaate
külgpaanis; lisavariandid on [Stripe’i testimise juhendis](https://docs.stripe.com/connect/testing).

## Andmed ja sulgemine

Eelvaade käib eraldi, ainult `127.0.0.1` aadressil töötava arendusserveri kaudu.
Poed, kasutajad, tooted ja tugivestlused on ajutised näidisandmed serveri mälus.
Need ei lähe Supabase’i ja tugisõnumeid ei saadeta. See on maksete ja seotud
seadistamisvaadete eelvaade; kõik poe haldustoimingud ega failide üleslaadimine
ei kuulu kohaliku näidisserveri võimaluste hulka.

Stripe’i vormi avamine loob sinu testkeskkonda ajutise Connect-konto.
Serveri tavalisel sulgemisel (`Ctrl+C`) kustutatakse ainult selle käivituse
loodud testkontod. Jõuga lõpetamisel või võrguvea korral võivad need alles jääda;
kontod tunneb testkeskkonnas ära metaandmetest `poeruum_payment_preview` ja
`preview_session`. Eelvaade ei kustuta teisi Stripe’i kontosid.

## Kontrollimine

```sh
npm run test
npm run test:payment-preview
npm run build:app
```

Brauseritestid käivitavad eraldi serveri pordil 4186 ilma Stripe’i võtmeteta.
Need kontrollivad päris rakenduse samme, jätkamist, avaldamise piirangut,
näidisandmete lähtestamist, ekraanilaiusi ja päringute eraldatust.
Stripe’i päris vormi kontrollimiseks kasuta eelvaate testvõtmetega serverit.
