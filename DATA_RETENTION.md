# Poeruumi andmete säilitamise kord

Rakenduse avalik privaatsuspoliitika ja tehniline kustutamisloogika kasutavad järgmisi tähtaegu.

| Andmed | Tähtaeg | Tehniline rakendus |
| --- | --- | --- |
| Konto, poe seaded, tooted ja tootepildid | Konto kustutamiseni | `delete-account` ja `handle_account_deletion()` |
| Kinnitamata ja kasutamata e-postiga registreerumine | Vähemalt 7 päeva; olemasolevatele kontodele lisaks 7 päeva reegli kasutuselevõtust | `cleanup_unconfirmed_accounts()`, iga päev 02:30 UTC, kuni 100 kontot |
| Registreerumiskatse aeg ja salajase soolaga IP-räsi | 30 päeva | `signup_observations`, koristus iga päev 02:40 UTC |
| Ostja nimi, e-post ja tarneinfo | Tellimuse raamatupidamistähtajani; konto kustutamisel kohe anonüümseks | `orders.retention_expires_at` ja `handle_account_deletion()` |
| Tellimuse ja Poeruumi finantskirje | 8 aastat tehingu kuupäevast; see katab vähemalt 7 aastat majandusaasta lõpust | `apply_data_retention()` |
| Lahendatud tugipöördumine ja manus, sh `info@poeruum.ee` kaudu saabunud kiri | 24 kuud lahendamisest või kontoga seotud pöördumisel konto kustutamiseni | `data-retention-reaper` |
| E-kirja kättetoimetamislogi | 90 päeva | `apply_data_retention()` |
| Stripe’i webhook’i duplikaadikaitse | 90 päeva | `apply_data_retention()` |
| Resendi webhook’i duplikaadikaitse | 30 päeva | `apply_data_retention()` |
| Avalehe anonüümne koondstatistika | 90 päeva | `apply_data_retention()` |
| Kaubamaja külastuste ja suunamiste statistika | 180 päeva ja pooleliolev Eesti kalendripäev | `poeruum-directory-analytics-retention`, iga päev 03:20 UTC |
| Poe külastuste ja tootevaatamiste statistika | 180 päeva ja pooleliolev Eesti kalendripäev; omaniku eemaldamisel järgmise koristuseni | `poeruum-store-analytics-retention`, iga päev 03:25 UTC |
| Rakenduse veasündmus | 30 päeva | `cleanup_security_observability()` |
| Rate limit'i soolatud räsi ja loendur | Piiranguaken + kuni 5 minutit | `cleanup_security_observability()` |
| Kasutaja online-oleku signaal | 24 tundi | `apply_data_retention()` |
| Lõpetatud välise ressursi koristuskirje | 90 päeva | `apply_data_retention()` |

Andmebaasi `pg_cron` käivitab `data-retention-reaper` funktsiooni iga päev kell 02:15 UTC. Funktsioon eemaldab esmalt aegunud tugimanused Storage API kaudu, kustutab tugivestlused ja rakendab seejärel ülejäänud andmebaasi säilitusreeglid.

Administraator saab klienditoe vestluse varem käsitsi kustutada, näiteks rämpskirja eemaldamiseks. `support-actions` kontrollib administraatori rolli, eemaldab vestluse manused Storage API kaudu ning kustutab vestluse koos sõnumitega. Teistes vestlustes kasutusel olevad manused säilivad. Kustutamine vajab kasutajaliideses kinnitust; saatjale teadet ei saadeta.

Konto kustutamisel peab väliste ressursside eemaldamine õnnestuma enne autentimiskonto kustutamist. Tellimustest eemaldatakse isikut tuvastavad kontakt- ja tarneväljad enne poe muutmist ligipääsmatuks tombstone-kirjeks. Tombstone kustutatakse pärast viimase tellimus- ja finantskirje säilitustähtaja lõppu.

Õigusnõude või ametliku säilituskohustuse korral saab automaatse kustutamise konkreetse tellimuse või finantssündmuse jaoks peatada väljaga `retention_hold_until`. Pikenduse alus ja uus tähtaeg tuleb eraldi dokumenteerida; rakenduses ei ole selleks praegu kasutajaliidest.

Kinnitamata kontode puhastus jätab alati alles kinnitatud või sisselogimiseks kasutatud kontod,
blokeeritud kontod (võimalikud tõendid), administraatorid, SSO-, telefoni- ja anonüümsed kontod.
Poe, tugipöördumise, faili, aktiivsusajaloo või poolelioleva aadressivahetusega kontot ei kustutata.
Kontroll ja eemaldamine on ühes andmebaasitehingus; konto lukustamine väldib võistlust
samal ajal toimuva e-posti kinnitamisega. Vaikimisi `cleanup_unconfirmed_accounts()` ainult
loendab kandidaate (`dry_run=true`). Stripe'iga seotud kontodele jääb kehtima eraldi
`delete-account` protsess. Ajutise e-postiga 30 päeva tegevuseta konto märgitakse ainult
administraatori ülevaatuseks, seda automaatselt ei kustutata.
