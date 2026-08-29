# Poeruumi automaatse kliendiotsingu nõuded

Staatus: kinnitatud  
Kuupäev: 2026-08-29

## Eesmärk

Poeruumi kliendiotsing leiab avalikest allikatest uusi ettevõtete kontakte ja saadab neile automaatselt ühe Mareki kinnitatud tutvustuskirja. Süsteem ei nõua kontaktide ega kirjade igapäevast käsitsi kontrollimist.

## Põhitöövoog

1. Süsteem leiab avalikust allikast ettevõtte nime, e-posti aadressi ja allika.
2. Süsteem jätab välja olemasolevad Poeruumi kasutajad, varem kontaktitud aadressid, duplikaadid ja blokeeritud aadressid.
3. Uus kontakt lisatakse automaatselt saatmisjärjekorda.
4. Süsteem saadab päevas kuni seadistatud arv kirju, algse sihiga 50 kirja päevas.
5. Kõigile kontaktidele saadetakse täpselt sama administraatori määratud teema ja kirja põhitekst.
6. Pärast edukat saatmist märgitakse kontakt saadetuks ning talle ei saadeta uut müügikirja.
7. Vastused saabuvad Mareki tavapärasesse postkasti. Süsteem ei vasta neile automaatselt.

## Kohustuslikud nõuded

- Kliendi e-poe olemasolu või puudumine ei mõjuta tema lisamist.
- AI ei otsusta, kas ettevõte vajab Poeruumi.
- AI ei koosta ega muuda saadetavat kirja.
- Kontakt ei vaja enne saatmist administraatori kinnitust.
- Süsteem kasutab ainult avalikust allikast leitud e-posti aadressi ega mõtle aadresse välja.
- Sama e-posti aadress saab kõige rohkem ühe esmase müügikirja.
- Päevast saatmislimiiti ei tohi ületada ka paralleelsete või korduvate käivituste korral.
- Katkenud töö ega teenuse korduskatse ei tohi põhjustada topeltsaatmist.
- Automaatika peab olema administraatori poolt sisse ja välja lülitatav.
- Kõik enne ümbertegemist saadetud kirjad säilitatakse saatmisajaloos.
- Olemasolev blokeerimis- ja loobumisinfo säilitatakse.

## Administraatori vaade

Administraator saab:

- automaatika sisse või välja lülitada;
- määrata päevase limiidi;
- muuta ühte kirja teemat;
- muuta ühte kirja põhiteksti;
- näha järjekorras kontaktide arvu;
- näha täna saadetud kirjade arvu;
- näha viimase automaatse töö tulemust ja vigu;
- näha saadetud kontaktide ajalugu.

Administraator ei pea:

- ettevõtteid käsitsi otsima;
- kontakte ükshaaval kontrollima;
- kirju ükshaaval kinnitama;
- ettevõtte sobivust hindama;
- kirju ükshaaval saatma.

## Süsteem ei tee

- Ei välista ettevõtet olemasoleva e-poe tõttu.
- Ei hinda ettevõtte e-poe kvaliteeti.
- Ei tuvasta ega võrdle e-poeplatvorme.
- Ei loo erinevaid klienditüüpe ega kirjamalle.
- Ei loo sobivusskoore ega AI põhjendusi.
- Ei saada automaatseid vastuseid.
- Ei hoia vana ja uut kliendiotsingut paralleelselt kasutuses.

## Tehniline taustatöö

Saatmise tehniline olek, vigased aadressid, blokeeringud ja teenuse korduskatsed töödeldakse taustal. Need ei lisa administraatorile käsitsi tehtavaid samme ega muuda saadetava kirja põhiteksti.

## Kinnitatud valikud

- Sihtrühm on aktiivsed Eesti toodete müüjad ja valmistajad.
- 50 on maksimaalne päevane limiit. Kui nõuetele vastavaid uusi kontakte on vähem, saadetakse vähem kirju.
- Süsteem töötab kõigil kalendripäevadel.
- Kasutada võib avalikke ettevõtte üld- ja brändikontakte, sealhulgas ettevõtte Gmaili aadresse. Nimega isiklikke aadresse automaatselt ei kasutata.
