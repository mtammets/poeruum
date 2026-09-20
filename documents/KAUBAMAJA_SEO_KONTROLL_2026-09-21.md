# Kaubamaja SEO kontroll — 21. september 2026

Ulatus: `https://kaubamaja.poeruum.ee/` ja selle avalik lugu. Põhilehte `poeruum.ee` kontrolliti Kaubamaja avastamise ja Search Console’i võimaliku domeenivara kontekstis.

**Search Console’i indekseerimis- ja päringuandmed on veel kontrollimata.** Töökeskkonnas puudub autentitud Search Console’i ühendus. Allpool on avaliku veebilehe tehnilised kontrollitulemused; need ei tõenda Google’i indeksis olemist ega otsinguliikluse olemasolu või puudumist.

## Avaliku lehe kontrollitulemused

| Leht või väljund | Tulemus |
| --- | --- |
| [Kaubamaja avaleht](https://kaubamaja.poeruum.ee/) | HTTP 200; `index, follow, max-image-preview:large`; `X-Robots-Tag` keeldu pole; canonical viitab samale HTTPS-aadressile. |
| [Lugu „See üks tass“](https://kaubamaja.poeruum.ee/lood/see-uks-tass/) | HTTP 200; indekseerimine lubatud; canonical viitab loo enda aadressile. |
| [Kaubamaja robots.txt](https://kaubamaja.poeruum.ee/robots.txt) | `User-agent: *`, `Allow: /` ning viide Kaubamaja sitemap’ile. |
| [Kaubamaja sitemap](https://kaubamaja.poeruum.ee/sitemap.xml) | HTTP 200; sisaldab nii avalehte kui ka olemasolevat lugu, kokku kaks URL-i. |
| Avalehe algne HTML | Põhipealkiri, poodide andmed ja tootekaardid on serveri HTML-is olemas. |
| [Poeruumi põhileht](https://poeruum.ee/) | HTTP 200; indekseerimine lubatud; algses HTML-is leidub link Kaubamajja. |
| Domeeni `poeruum.ee` DNS | Google’i kinnituse TXT-kirje on olemas. See üksi ei kinnita konkreetse Search Console’i vara olemasolu, andmete seisu ega kasutaja õigusi. |

Nendes kontrollides ei ilmnenud Kaubamaja kahe avaliku lehe robots/noindex/canonical/HTTP-taseme takistust. Google’i indekseerimisotsus tuleb eraldi üle vaadata [URL Inspectioni aruandest](https://support.google.com/webmasters/answer/9012289).

## Väike pealkirjaparandus

Senine SEO-pealkiri: **Poeruumi Kaubamaja**.

Täpsustatud SEO-pealkiri: **Poeruumi Kaubamaja – avasta Eesti väikeettevõtjate e-poode**.

Sama pealkiri rakendub serveri HTML-is ja brauseris, sealhulgas Open Graphi ja Twitteri pealkirjas. Struktureeritud andmetes säilib lehe lühinimi „Poeruumi Kaubamaja“. Pealkiri kirjeldab lehe tegelikku sisu ning järgib [Google’i soovitust kasutada sisulisi ja lühikesi pealkirju](https://developers.google.com/search/docs/appearance/title-link).

## Search Console’is veel kontrollitav

- **Õige vara ja filter.** Domeenivara `poeruum.ee` hõlmab alamdomeene; URL-prefiksi vara `https://poeruum.ee/` Kaubamaja alamdomeeni ei hõlma. Domeenivara tulemuslikkuse raport tuleb piirata lehtedega, mille aadress algab `https://kaubamaja.poeruum.ee/`. [Google’i varatüüpide selgitus](https://support.google.com/webmasters/answer/34592).
- **Indekseerimine.** Kontrollida mõlema sitemap’i URL-i kohta Google’i indeksi olekut, viimast roomamist, Google’i valitud canonical’i ning võimalikke väljajätmise põhjuseid. Värske lehe test ja Google’i indeksis oleva versiooni aruanne on eraldi tulemused. [URL Inspection](https://support.google.com/webmasters/answer/9012289), [Page indexing](https://support.google.com/webmasters/answer/7440203).
- **Sitemap’i vastuvõtmine.** Kontrollida, kas `https://kaubamaja.poeruum.ee/sitemap.xml` on esitatud, millal Google seda viimati luges ning kas lugemisel oli vigu. Avalik HTTP 200 ei kinnita sitemap’i esitamist Search Console’i.
- **Otsingupäringud.** Võtta veebitulemuste viimase kolme kuu päringud ja sihtlehed koos klikkide, kuvamiste, CTR-i ja keskmise positsiooniga. Võrrelda viimast 28 päeva eelneva 28 päevaga ainult olemasoleva võrreldava ajaloo piires. Eristada Poeruumi nimega seotud ja üldisemaid päringuid; muutuste põhjusi ei saa pealkirjavahetusele omistada ainult enne/pärast võrdluse põhjal. [Performance report](https://support.google.com/webmasters/answer/7576553).

Search Analytics nõuab autentimist ning tagastab piiratud hulga nähtavaid päringuridu; puuduvat päringurida ei saa võrdsustada kogu liikluse puudumisega. [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

Ligipääsu alternatiiv on Search Console’i eksporditud Performance’i (päringud ja lehed), indekseerimise ja sitemap’i andmed koos kahe URL Inspectioni tulemusega. Kuni neid andmeid pole, jäävad Google’i indeksistaatus, tegelikud päringud, klikid, kuvamised ja positsioonid teadmata.
