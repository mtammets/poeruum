# Poeruumi andmete säilitamise kord

Rakenduse avalik privaatsuspoliitika ja tehniline kustutamisloogika kasutavad järgmisi tähtaegu.

| Andmed | Tähtaeg | Tehniline rakendus |
| --- | --- | --- |
| Konto, poe seaded, tooted ja tootepildid | Konto kustutamiseni | `delete-account` ja `handle_account_deletion()` |
| Ostja nimi, e-post ja tarneinfo | Tellimuse raamatupidamistähtajani; konto kustutamisel kohe anonüümseks | `orders.retention_expires_at` ja `handle_account_deletion()` |
| Tellimuse ja Poeruumi finantskirje | 8 aastat tehingu kuupäevast; see katab vähemalt 7 aastat majandusaasta lõpust | `apply_data_retention()` |
| Lahendatud tugipöördumine ja manus | 24 kuud lahendamisest või konto kustutamiseni | `data-retention-reaper` |
| E-kirja kättetoimetamislogi | 90 päeva | `apply_data_retention()` |
| Stripe’i webhook’i duplikaadikaitse | 90 päeva | `apply_data_retention()` |
| Resendi webhook’i duplikaadikaitse | 30 päeva | `apply_data_retention()` |
| Kasutaja online-oleku signaal | 24 tundi | `apply_data_retention()` |
| Lõpetatud välise ressursi koristuskirje | 90 päeva | `apply_data_retention()` |

Andmebaasi `pg_cron` käivitab `data-retention-reaper` funktsiooni iga päev kell 02:15 UTC. Funktsioon eemaldab esmalt aegunud tugimanused Storage API kaudu, kustutab tugivestlused ja rakendab seejärel ülejäänud andmebaasi säilitusreeglid.

Konto kustutamisel peab väliste ressursside eemaldamine õnnestuma enne autentimiskonto kustutamist. Tellimustest eemaldatakse isikut tuvastavad kontakt- ja tarneväljad enne poe muutmist ligipääsmatuks tombstone-kirjeks. Tombstone kustutatakse pärast viimase tellimus- ja finantskirje säilitustähtaja lõppu.

Õigusnõude või ametliku säilituskohustuse korral saab automaatse kustutamise konkreetse tellimuse või finantssündmuse jaoks peatada väljaga `retention_hold_until`. Pikenduse alus ja uus tähtaeg tuleb eraldi dokumenteerida; rakenduses ei ole selleks praegu kasutajaliidest.
