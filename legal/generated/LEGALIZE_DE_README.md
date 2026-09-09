# legalize-de

Deutschland — Gesetzgebung in Markdown, versioniert als Git-Repository.

Jedes Gesetz ist eine Datei; jede Reform ist ein Commit, datiert auf das tatsächliche amtliche Veröffentlichungsdatum. Das `git log` eines jeden Gesetzes zeigt seine vollständige Historie — wann es erlassen wurde, welche Artikel sich geändert haben und durch welche Norm.

Bundesrecht der Bundesrepublik Deutschland: konsolidierte Fassungen von rund 6.900 Gesetzen und Rechtsverordnungen, wie sie über das Inhaltsverzeichnis (gii-toc.xml) von gesetze-im-internet.de bereitgestellt werden. Jede Norm ist eine Markdown-Datei; jede dokumentierte Änderung ist ein Git-Commit. Landesrecht (Recht der Bundesländer) ist nicht enthalten.

## Inhalt

- **Grundgesetz** (`GG.md`) — `de/GG.md`
- **Bundesgesetz** (`{ABK}.md`) — `de/BGB.md`, `de/STGB.md`
- **Rechtsverordnung** (`{ABK}.md`) — Verordnungen des Bundes (rank: rechtsverordnung).
- **Bekanntmachung** (`{ABK}.md`) — Amtliche Bekanntmachungen (rank: bekanntmachung).
- **Satzung** (`{ABK}.md`) — Satzungen (rank: satzung).

## Datenquelle

- **Gesetze im Internet — Bundesministerium der Justiz (BMJ) und Bundesamt für Justiz, technisch betrieben durch die juris GmbH**
  - Portal: https://www.gesetze-im-internet.de/
  - Inhaltsverzeichnis (TOC-XML): https://www.gesetze-im-internet.de/gii-toc.xml
  - XML-Download je Gesetz: https://www.gesetze-im-internet.de/{slug}/xml.zip

## Hinweise

- Die hier veröffentlichten konsolidierten Fassungen sind nicht die amtliche Verkündungsfassung. Maßgeblich bleibt der im Bundesgesetzblatt (BGBl.) verkündete Text; die jeweilige Fundstelle ist im Frontmatter unter `extra.bgbl_reference` vermerkt.
- Der Dateiname entspricht der amtlichen bzw. juris-Abkürzung (`jurabk`) in Großbuchstaben, Leerzeichen durch Bindestriche ersetzt (z. B. `GG`, `BGB`, `STGB`). Weitere Kennungen wie die juris-Dokumentnummer (`doknr`, beginnend mit „BJNR…") und der URL-Slug stehen im Frontmatter unter `extra`.
- Bilder werden nicht übernommen; Tabellen, Listen sowie Fett- und Kursivauszeichnungen bleiben als Markdown erhalten.

## Weitere Länder

Dieses Repository ist Teil von **Legalize**, das die Gesetzgebung mehrerer Länder als Git-Repositories pflegt. Den vollständigen Katalog finden Sie unter https://legalize.dev.

## Unterstützung

Legalize ist kostenlos und offen. Wenn diese Arbeit für Sie nützlich ist, können Sie dazu beitragen, ihr Hosting und ihre Weiterentwicklung zu sichern: [Dieses Projekt unterstützen](https://buymeacoffee.com/legalizedev).

## Lizenz

- **Pipeline-Code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Daten**: gemeinfrei (amtliche Werke nach § 5 UrhG; freie Nutzung und Weiterverwendung)
