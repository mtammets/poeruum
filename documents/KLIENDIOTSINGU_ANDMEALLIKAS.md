# Kliendiotsingu andmeallika otsus

Kuupäev: 2026-08-29  
Staatus: valitud

## Valitud allikas

Kliendikandidaadid imporditakse e-äriregistri avaandmete igapäevasest „Üldandmed“ JSON-failist.

Fail sisaldab süsteemile vajalikke avalikke andmeid:

- ettevõtte nimi ja registrikood;
- registri staatus;
- kehtivad tegevusalad;
- avalikud e-posti aadressid;
- avalik veebiaadress, kui ettevõte on selle registrile esitanud.

## Automaatne valik

Esimeses versioonis lisatakse järjekorda registrisse kantud ettevõtted, kelle kehtiv tegevusala näitab toodete valmistamist või jaemüüki. E-poe, ostukorvi ja e-poeplatvormi olemasolu ei kontrollita.

Enne järjekorda lisamist tehakse ainult automaatsed tehnilised välistused:

- e-posti aadress peab olema korrektse kujuga ja avaldatud registri sidevahendina;
- nimega isikuaadress jäetakse välja;
- ettevõtte üld- ja brändiaadressid on lubatud;
- ettevõtte brändi nimega Gmaili või muu tasuta postkasti aadress on lubatud;
- sama registrikoodi või e-posti aadressi ei lisata teist korda;
- varem kontaktitud, blokeeritud ja olemasoleva Poeruumi kasutaja aadress jäetakse välja.

## Mahu kontroll

2026-08-29 avaandmete faili mõõtmise tulemus:

- 376 826 juriidilist isikut;
- 41 302 tootmise või jaemüügi kehtiva tegevusalaga registrisse kantud ettevõtet;
- 12 983 ettevõtet, millel on pärast nimega isikuaadresside eemaldamist automaatseks saatmiseks sobiv üld- või brändiaadress.

See maht on 50 kirja päevas saatmiseks piisav. Veebiaadressi olemasolu ei ole kandidaadi nõue.

## Tehniline kasutus

Allikafail on pakituna umbes 229 MB ja lahtipakituna umbes 4,5 GB. Seda ei laadita iga kirja saatmise ajal serverifunktsiooni. Eraldi ajastatud import loeb faili voona, saadab andmebaasi ainult uued sobivad kandidaadid ja jätab ülejäänud andmed talletamata.

Kirjade saatmine töötab impordist sõltumatu järjekorra alusel. Kui registri import ühel päeval ebaõnnestub, saab saatja kasutada juba järjekorras olevaid uusi kontakte.

Allikas: [e-äriregistri avaandmed](https://avaandmed.ariregister.rik.ee/et/avaandmete-allalaadimine), litsents CC BY-SA 4.0.
