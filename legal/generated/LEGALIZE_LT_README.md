# legalize-lt

Lietuva teisės aktai Markdown formatu, su versijų valdymu kaip git saugykla.

Kiekvienas įstatymas yra failas; kiekviena reforma yra commit'as, datuojamas pagal tikrąją oficialią paskelbimo datą. Bet kurio įstatymo `git log` rodo visą jo istoriją — kada jis priimtas, kurie straipsniai pasikeitė ir kuriuo teisės aktu.

Saugykloje skelbiami pagrindiniai galiojantys ir negaliojantys Lietuvos teisės aktai — apie 15 tūkst. normų. Įtraukti tik esminiai teisės aktų tipai (Konstitucija, konstituciniai įstatymai, įstatymai, kodeksai); administraciniai aktai (nutarimai, įsakymai, dekretai ir kt.) į pagrindinę apimtį neįtraukti, nors kasdienių atnaujinimų metu jie gali būti apdorojami, jei keičia įstatymus.

## Kas viduje

- **Įstatymas** (`TAR.XXXXXXXXXXXX.md`) — Pagrindinė teisės aktų rūšis (apie 14,9 tūkst. normų). Failo pavadinimas = dokumento_id su priešdėliu TAR.
- **Kodeksas** (`TAR.XXXXXXXXXXXX.md`) — Kodeksai (pvz., Civilinis, Baudžiamasis); frontmatter rango laukas — istatymas.
- **Konstitucinis įstatymas** (`TAR.XXXXXXXXXXXX.md`) — Konstituciniai įstatymai.
- **Konstitucija** (`TAR.XXXXXXXXXXXX.md`) — Lietuvos Respublikos Konstitucija ir su ja susiję aktai.

## Duomenų šaltinis

- **Teisės aktų registras (TAR) — Lietuvos Respublikos teisingumo ministerija / VĮ Registrų centras; duomenys gaunami per Lietuvos atvirų duomenų portalą (data.gov.lt, Spinta API)**
  - Teisės aktų registras: https://www.e-tar.lt/
  - Atvirų duomenų rinkinys (Teisės aktų registro duomenys): https://data.gov.lt/datasets/2613/
  - Spinta API: https://get.data.gov.lt/datasets/gov/lrsk/teises_aktai/Dokumentas

## Priskyrimas

> Duomenų šaltinis: Teisės aktų registras (TAR), Lietuvos atvirų duomenų portalas (data.gov.lt). Licencija: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.lt). Duomenys gali būti pakeisti (konvertuoti į Markdown formatą).

## Šaltinio ypatumai

Metaduomenys ir pilnas tekstas gaunami iš to paties data.gov.lt Spinta API (`tekstas_lt` laukas), o ne tiesiogiai iš e-tar.lt. Frontmatter nurodyta `source` nuoroda veda į oficialų e-tar.lt aktą.

Tekstas teikiamas kaip grynasis tekstas (be HTML), todėl turinys struktūrizuojamas pagal lietuviškus struktūros žymenis (straipsnis, skyrius, skirsnis, dalis). Reformų istorija (commit'ai) atkuriama iš Suvestinė lentelės — kiekviena suvestinės versija tampa atskira teksto būsena nustatytą galiojimo datą.

## Kitos šalys

Ši saugykla yra **Legalize** dalis, kuri tvarko kelių šalių teisės aktus kaip git saugyklas. Visą katalogą rasite https://legalize.dev.

## Parama

Legalize yra nemokamas ir atviras. Jei šis darbas jums naudingas, galite padėti išlaikyti jo prieglobą ir plėtrą: [Paremkite šį projektą](https://buymeacoffee.com/legalizedev).

## Licencija

- **Pipeline kodas**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Duomenys**: Creative Commons Priskyrimas 4.0 tarptautinė (CC BY 4.0)
