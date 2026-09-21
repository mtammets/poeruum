# Kaubamaja SEO kontroll — 21. september 2026

Ulatus: `https://kaubamaja.poeruum.ee/` ja selle avalik lugu. Põhilehte `poeruum.ee` kontrolliti Kaubamaja avastamise ja Search Console’i võimaliku domeenivara kontekstis.

**Search Console kinnitab Kaubamaja avalehe indekseerimist ja sitemap’i edukat töötlemist; lugu „See üks tass“ ei ole veel indeksis.** Kaubamaja viimase kolme kuu filtreeritud veebitulemuste aruandes on avalehel 10 näitamist ja 0 klikki; päringutabelis nähtavaid otsingusõnu pole. Kasutaja jagatud 21. septembri ekraanipildid täiendavad avalikke tehnilisi kontrolle. Töökeskkonnas puudub otsene autentitud Search Console’i ühendus.

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

Nendes kontrollides ei ilmnenud Kaubamaja kahe avaliku lehe robots/noindex/canonical/HTTP-taseme takistust. URL Inspectioni ekraanipildid kinnitavad avalehe indekseerimist ning näitavad loo kohta olekut `URL is unknown to Google`.

## Kasutaja Search Console’i ekraanipiltide tulemused

Kõik pildid on 21. septembrist 2026. Vara on domeenivara `poeruum.ee`, mis hõlmab ka alamdomeene. Domeeni koondandmeid ei saa omistada ainult Kaubamajale.

| Ekraanipildi aeg ja vaade | Kinnitatud tulemus |
| --- | --- |
| 06.10.44 — Overview | Kogu domeeni kohta 23 indekseeritud ja 10 indekseerimata lehte. Väljajätmise põhjuseid pildilt ei näe. |
| 06.12.08 ja 06.17.44 — Kaubamaja avalehe URL Inspection | `URL is on Google` ja `Page is indexed`. Viimane roomamine kuvatud kujul 20.09.2026 kell 03.42.39; Googlebot smartphone; roomamine ja indekseerimine lubatud; lehe laadimine õnnestus. Google’i valitud canonical ühtib aadressiga `https://kaubamaja.poeruum.ee/`. |
| 06.17.44 — Discovery | Viitav leht on `https://poeruum.ee/mis-on-poeruum/`. Raportis `No referring sitemaps detected`; see ei tõenda sitemap-faili puudumist serveris. |
| 06.19.49 — Sitemaps | Esitatud oli ainult `https://poeruum.ee/sitemap.xml`: `Success`, viimati loetud 20.09.2026, neli leitud lehte. |
| 06.20.59 — Kaubamaja sitemap’i esitamine | `https://kaubamaja.poeruum.ee/sitemap.xml` esitamine võeti vastu (`Sitemap submitted successfully`). See kinnitus ei tähenda veel faili edukat lugemist. |
| 06.26.19 — Sitemaps | Kaubamaja sitemap: `Couldn't fetch`, tüüp `Unknown`, null leitud lehte, viimane lugemine täitmata. Põhidomeeni sitemap on endiselt `Success`. Täpne veapõhjus pole sellel pildil nähtav. |
| 06.26.41 — Performance | Valitud kolm kuud ja otsingutüüp Web; lehefiltrit pole. Kogu domeen: 5 klikki, 40 näitamist, CTR 12,5%, keskmine positsioon 11. Päringutabeli read pole nähtavad. |
| 06.26.31 — Generative AI features (Beta) | Valitud kolm kuud; kogu domeenile 4 näitamist. Nähtav leherida `https://kaubamaja.poeruum.ee/` näitab 2 näitamist. Pildilt ei selgu konkreetsed päringud, vastused ega see, kas mõnes vastuses Poeruumi soovitati. |
| 06.31.05 — Kaubamaja sitemap’i detailvaade | `Sitemap processed successfully`; viimati loetud 21.09.2026; leitud kaks lehte ja null videot. Varasem lugemisviga enam ei esine. |
| 06.33.33 — Kaubamaja filtreeritud Performance | Valitud kolm kuud, Web ja lehefilter „URL sisaldab kaubamaja.poeruum.ee“. Aruandes 0 klikki, 10 näitamist, CTR 0%, keskmine positsioon 11,9. Vaade hoiatab, et filtreeritud diagrammi ja tabeli andmed võivad olla osalised. |
| 06.34.26 — Kaubamaja Queries | Sama periood ja lehefilter; päringutabelis `No data`. Ühtegi konkreetset otsingusõna ei ole nähtav. |
| 06.37.09 — Kaubamaja Pages | Sama periood ja lehefilter; tabelis üks rida: `https://kaubamaja.poeruum.ee/`, 0 klikki ja 10 näitamist. Kõik selles aruandes nähtavad näitamised kuuluvad avalehele. |
| 06.38.06 — Loo URL Inspection | `https://kaubamaja.poeruum.ee/lood/see-uks-tass/`: `URL is not on Google`; põhjus `URL is unknown to Google`. Viimane roomamine ja roomamise väljad on `N/A`; viitavat lehte ega sitemap’i selles vaates ei tuvastata. See ei tühista eraldi sitemap’i aruande kinnitust edukast töötlemisest. |
| 06.44.23 — Loo indekseerimistaotlus | `Indexing requested`: URL lisati prioriteetsesse roomamisjärjekorda. Taotluse vastuvõtmine on kinnitatud; tegelik indekseerimine ei ole veel kinnitatud. Teate järgi ei muuda sama lehe korduv esitamine selle järjekorrakohta ega prioriteeti. |

Avalehe viimane kuvatud roomamine eelneb värskele SEO-pealkirja muudatusele, seega ei tõenda see Google’i uuendatud pealkirja kasutamist. Andmemaht on väike; pealkirja mõju ega otsingute üldist trendi selle põhjal hinnata ei saa.

Tühi päringutabel ei tühista koondaruande kümmet näitamist. Google jätab privaatsuse kaitseks osa haruldasi päringuid tabelist välja, kuid loeb need koondnäitajatesse, kui päringufiltrit pole. Ka sisemised andmepiirangud võivad päringuridu vähendada. Selle väikese mahu juures on päringute anonüümimine tõenäoline selgitus; ekraanipilt üksi ei kinnita täpset põhjust. Puuduvate päringusõnade põhjal ei saa eristada brändiotsinguid üldistest tooteotsingutest. [Google’i selgitus aruande andmete erinevuste kohta](https://support.google.com/webmasters/answer/17010575), [päringuridade piirangud](https://support.google.com/webmasters/answer/17011259).

### Sitemap’i vea järelkontroll

Pärast veateate saamist kontrolliti tootmist uuesti: Kaubamaja sitemap vastas HTTP 200 ilma ümbersuunamiseta, sisutüübiga `application/xml; charset=utf-8`, ning sisaldas avalehte ja lugu. Kaubamaja `robots.txt` vastas HTTP 200, lubas roomamist ja viitas õigele sitemap’ile. Sama sitemap vastas 200 ka Googlebot desktopi, Googlebot smartphone’i ja Google-InspectionTooli User-Agent väärtustega päringutele ning HEAD-päringule. Need päringud tehti kohalikust töökeskkonnast, mitte Google’i võrgust; need ei tõenda Google’i ligipääsu ega välista ajutist või võrgupõhist tõrget.

Kell 06.31.05 jagatud detailvaade kinnitab, et Google on sitemap’i edukalt töödelnud ja leidnud mõlemad URL-id. Viga kadus ilma rakenduse muudatusteta; esialgse ebaõnnestumise täpne põhjus jäi teadmata. Sitemap’i edukas töötlemine ei kinnita automaatselt mõlema lehe indekseerimist. [Google’i sitemap’i aruande juhend](https://support.google.com/webmasters/answer/7451001).

## Väike pealkirjaparandus

Senine SEO-pealkiri: **Poeruumi Kaubamaja**.

Täpsustatud SEO-pealkiri: **Poeruumi Kaubamaja – avasta Eesti väikeettevõtjate e-poode**.

Sama pealkiri rakendub serveri HTML-is ja brauseris, sealhulgas Open Graphi ja Twitteri pealkirjas. Struktureeritud andmetes säilib lehe lühinimi „Poeruumi Kaubamaja“. Pealkiri kirjeldab lehe tegelikku sisu ning järgib [Google’i soovitust kasutada sisulisi ja lühikesi pealkirju](https://developers.google.com/search/docs/appearance/title-link).

## Järeldus ja järgmised sammud

- **Kontrolli tulemus.** Avaleht on Google’i indeksis ja kõik kümme nähtavat veebitulemuste näitamist kuuluvad sellele. Klikke pole ning nähtavaid päringusõnu Google selles vaates ei avalda. Sitemap on edukalt töödeldud; selle esialgne lugemisviga ei nõudnud koodiparandust.
- **Loo indekseerimise taotlus on vastu võetud.** Kasutaja esitas taotluse ning kell 06.44.23 jagatud kinnitus näitab `Indexing requested`. Lugu on roomamisjärjekorras; tegelik indekseerimine pole veel kinnitatud. Korduvat taotlust pole praegu vaja. Loo indeksi olekut tasub URL Inspectioniga uuesti kontrollida umbes nädala pärast, näiteks 28.09.2026; see on soovituslik kontrolliaeg, mitte lubatud indekseerimistähtaeg ega seadistatud automaatne kontroll. [URL Inspectioni juhend](https://support.google.com/webmasters/answer/9012289#request_indexing).
- **Hilisem tulemuslikkuse kontroll.** Päringutabel on vaadatud, kuid otsingusõnu ei avaldata. Uue pealkirja mõju hindamiseks on vaja hilisemat roomamist ja piisavat võrreldavat andmemahtu. Muutuste põhjusi ei saa pealkirjavahetusele omistada ainult enne/pärast võrdluse põhjal. [Performance report](https://support.google.com/webmasters/answer/7576553).

Search Analytics nõuab autentimist ning tagastab piiratud hulga nähtavaid päringuridu; puuduvat päringurida ei saa võrdsustada kogu liikluse puudumisega. [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

Mõlema sitemap’i URL-i indeksi olek, sitemap’i töötlemine ning Kaubamaja koond- ja lehepõhised veebitulemused on kasutaja ekraanipiltidelt kontrollitud. Päringute kontrolli tulemus on dokumenteeritud piiranguna: Google ei kuva valitud vaates päringusõnu. Loo indekseerimistaotlus on vastu võetud. Praegune kontroll on tehtud; järgnev tulemus sõltub Google’i roomamisest ja indekseerimisotsusest.
