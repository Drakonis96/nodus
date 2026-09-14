# legalize-nl

Nederland — wetgeving in Markdown, versiebeheerd als een git-repository.

Elke wet is een bestand; elke hervorming is een commit met de datum van de werkelijke officiële publicatiedatum. De `git log` van een wet toont de volledige geschiedenis ervan — wanneer ze is uitgevaardigd, welke artikelen zijn gewijzigd en door welke norm.

De dataset bevat de geconsolideerde, geldende Nederlandse wet- en regelgeving uit het Basis Wetten Bestand (BWB). De bootstrap haalt elke regeling op die vandaag geldig is (ongeveer 22.000 actieve regelingen, gemeten 2026-04-11) en downloadt elke historische expressie ("toestand") uit de repository, zodat de git-historie één commit per echte wijziging weergeeft.

## Wat zit erin

- **Wet** (`BWBR-XXXXXXX.md`) — `nl/BWBR0005291.md`
- **Grondwet** (`BWBR-XXXXXXX.md`) — `nl/BWBR0001840.md`
- **Algemene maatregel van bestuur (AMvB) en koninklijk besluit (KB)** (`BWBR-XXXXXXX.md`) — Inclusief rijks-AMvB en rijks-KB.
- **Ministeriële regeling** (`BWBR-XXXXXXX.md`) — `nl/BWBR0011353.md`
- **Beleidsregel, circulaire en reglement** (`BWBR-XXXXXXX.md`) — Inclusief BES-varianten.
- **Verdrag** (`BWBV-XXXXXXX.md`) — Internationale verdragen; identifier begint met BWBV.

## Gegevensbron

- **Basis Wetten Bestand (BWB) — KOOP (Kennis- en Exploitatiecentrum voor Officiële Overheidspublicaties), Ministerie van Binnenlandse Zaken en Koninkrijksrelaties**
  - Portaal: https://wetten.overheid.nl
  - Dataset: https://data.overheid.nl/dataset/basis-wetten-bestand
  - SRU-zoekdienst: https://zoekservice.overheid.nl/sru/Search?x-connection=BWB
  - Repository (XML): https://repository.officiele-overheidspublicaties.nl/bwb

## Beperkingen

- Per regeling worden maximaal 200 historische expressies opgenomen. Bij een handvol regelingen met langere ketens wordt afgekapt tot de 200 meest recente toestanden, zodat de huidige tekst altijd aanwezig blijft.
- Expressies die alleen als "gedrukte tekst" bestaan zonder XML-manifestatie worden overgeslagen.
- Afbeeldingen worden niet opgenomen; beeldknopen worden weggelaten.

## Andere landen

Deze repository maakt deel uit van **Legalize**, dat de wetgeving van meerdere landen als git-repositories beheert. Zie https://legalize.dev voor de volledige catalogus.

## Ondersteuning

Legalize is gratis en open. Als dit werk nuttig voor u is, kunt u helpen de hosting en ontwikkeling ervan te ondersteunen: [Steun dit project](https://buymeacoffee.com/legalizedev).

## Licentie

- **Pipelinecode**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Gegevens**: CC0 1.0 Universeel (publiek domein)
