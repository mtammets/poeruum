# Musta rähni päevade heli

Kaubamaja, Krük-Krüki koduleht ja 15-sekundilised videoekspordid kasutavad kasutaja
antud salvestisi `rahn_1.mp3` ja `rahn_2.mp3`, kopeeritud muutmata kujul:

- `musta-rahni-call-1.mp3` — `rahn_1.mp3`, 1,071 s.
- `musta-rahni-call-2.mp3` — `rahn_2.mp3`, 2,821 s.

Vajutused esitavad neid vaheldumisi. Noka liikumise helitugevuskõverad on failis
`src/themes/black-friday/woodpeckerCalls.json`; need saab uuesti luua käsuga
`node scripts/generate-woodpecker-calls.mjs` (vajab FFmpegi). Liikumist juhib
helifaili taasesituse aeg, mitte eraldi CSS-taimer.
15-sekundilises videos algavad salvestused vastavalt 3,8 ja 10,7 sekundil.

Järgnev allikainfo puudutab varasemat helifaili ja vanu videoeksporte.

`musta-rahni-call.mp3` on 1,3-sekundiline lõik päris musträhni
(*Dryocopus martius*) salvestusest.

- Salvestus: [XC1107912](https://xeno-canto.org/1107912).
- Autor: Sonothèque ADVL; salvestaja Sébastien Provost.
- Koht ja aeg: Bacilly, Normandia, Prantsusmaa; 28. märts 2026.
- Litsents: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Algfail: `XC1107912-Pic-noir-28-mars-26-Chantore-8h20.mp3`.
- Töötlus: lõik 14,28–15,58 s; 650 Hz kõrgpääs- ja 9000 Hz madalpääsfilter;
  +10 dB; 25 ms algus- ja 120 ms lõpphajutus; mono MP3, 44,1 kHz, 96 kbit/s.

Allikas ja CC0-litsents on säilitatud ka MP3 metaandmetes.

## Lennuvaate taustamuusika

`musta-rahni-flight-music.mp3` on selle mängu jaoks kirjutatud originaalne
koomilise tagaajamise instrumentaal „Müts taga, rähn ees”. Kiire svingiv rütm,
kõndiv kontrabass, pizzicato-keelpillid, klarnet, ksülofon, fagotivastused ja
lühikesed trompetiaktsendid. Keskmine osa kasvatab pinget ja naaseb põhiteema juurde.
Varasema rahuliku 96 BPM loo asendas see versioon 03.11.2026.

- 32 takti, 49,23-sekundiline korduv fraas, 156 lööki minutis.
- Stereo MP3, 32 kHz, 96 kbit/s; umbes 592 KB.
- Originaalkompositsioon: `scripts/generate-flight-music.mjs`.
- Renderdamine: `scripts/render-flight-score.swift`, macOS-i süsteemne General MIDI
  pillipank (`gs_instruments.dls`) läbi AVAudioUnitSampleri. Pillipanka ei levitata;
  brauserisse jõuab üksnes valmis muusikapala. Olemasolevaid muusikapalu pole sämplitud.
- Taasloomine macOS-is: `node scripts/generate-flight-music.mjs`
  (vajab Swifti/Command Line Toolsi ja FFmpegi). Command Line Toolsi valimiseks võib
  käsule lisada `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- Kolmest renderdatud kordusest kasutatakse keskmist, et ruumikaja jätkuks loo piiril.
- Mäng laeb muusika käivitamisel ning esitab seda voona. Püüdmisel vaigistub see
  ajutiselt, et kasutaja antud rähnisalvestis jääks selgelt kuuldavaks.
