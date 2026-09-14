# legalize-lv

Latvija — tiesību akti Markdown formātā, versiju kontrolē kā git repozitorijs.

Katrs likums ir fails; katra reforma ir commit ar datumu, kas atbilst reālajam oficiālās publikācijas datumam. Jebkura likuma `git log` parāda tā pilnu vēsturi — kad tas tika pieņemts, kuri panti tika grozīti un ar kuru tiesību normu.

Repozitorijs satur Latvijas konsolidētos (spēkā esošos) tiesību aktus, kas iegūti no likumi.lv portāla. Katrs tiesību akts ir viens Markdown fails ar konsolidēto tekstu un metadatiem; tiesību akta veids (rangs) ir norādīts faila frontmatter laukā "rank", nevis mapju struktūrā.

## Kas ir iekšā

- **Satversme (Konstitūcija)** (`{id}.md`) — `lv/57980.md`
- **Likums** (`{id}.md`) — `lv/225418.md`, `lv/68488.md`
- **Konstitucionālais likums** (`{id}.md`)
- **Ministru kabineta noteikumi** (`{id}.md`) — Veids "noteikumi".
- **Saistošie noteikumi** (`{id}.md`) — Pašvaldību saistošie noteikumi.
- **Rīkojums** (`{id}.md`)
- **Lēmums** (`{id}.md`)
- **Instrukcija** (`{id}.md`)
- **Līgums / starptautiskais līgums / konvencija** (`{id}.md`) — Veidi "ligums", "starptautiskais-ligums", "konvencija".

## Datu avots

- **Likumi.lv — Latvijas Republikas tiesību akti (oficiālais izdevējs "Latvijas Vēstnesis")**
  - Portāls: https://likumi.lv
  - Tiesību akta lapa: https://likumi.lv/ta/id/{id}
  - Vietnes karte (sitemap): https://likumi.lv/sitemap-index.xml
  - Oficiālais izdevums: https://www.vestnesis.lv

## Tvēruma ierobežojumi

- Faila nosaukums ir likumi.lv ciparu identifikators (piem., `lv/57980.md` = Satversme). Avota URL: `https://likumi.lv/ta/id/{id}`.
- Iekļauti tikai konsolidētie tiesību akti. Grozījumu dokumenti (URL ar prefiksiem "grozijumi-", "grozijums-", "par-grozijumiem-") tiek izlaisti, jo tie izmanto atšķirīgu HTML formātu bez konsolidētas struktūras.
- Aptuveni 483 identifikatori, ko aizliedz likumi.lv `robots.txt`, ir izslēgti.
- Vēsturiskās redakcijas (`/redakcijas-datums/`) `robots.txt` aizliedz iegūt, tāpēc katrs tiesību akts tiek saglabāts kā viena pašreizējā konsolidētā versija — atsevišķa reformu (grozījumu) git vēsture katram aktam nav pieejama.
- Attēli netiek saglabāti.

## Citas valstis

Šis repozitorijs ir daļa no **Legalize**, kas uztur vairāku valstu tiesību aktus kā git repozitorijus. Pilnu katalogu skatiet https://legalize.dev.

## Atbalsts

Legalize ir bezmaksas un atvērts. Ja šis darbs jums ir noderīgs, jūs varat palīdzēt uzturēt tā mitināšanu un izstrādi: [Atbalstīt šo projektu](https://buymeacoffee.com/legalizedev).

## Licence

- **Pipeline kods**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Dati**: brīvi pieejams (oficiālie valsts izdevumi nav aizsargāti ar autortiesībām)
