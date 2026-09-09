# legalize-ch

Schweiz — Gesetzgebung in Markdown, versioniert als Git-Repository.

Jedes Gesetz ist eine Datei; jede Reform ist ein Commit, datiert auf das tatsächliche amtliche Veröffentlichungsdatum. Das `git log` eines jeden Gesetzes zeigt seine vollständige Historie — wann es erlassen wurde, welche Artikel sich geändert haben und durch welche Norm.

Erfasst wird das eidgenössische Bundesrecht aus der Systematischen Rechtssammlung (SR / Classified Compilation, ELI-Pfad eli/cc/) auf Deutsch. Jede Norm ist eine Markdown-Datei, jede Reform ein Git-Commit, datiert auf das Datum der Inkraftsetzung der jeweiligen Konsolidierung (jolux:dateApplicability).

## Inhalt

- **Bundesverfassung** (`cc-YYYY-N.md`) — `ch/cc-1999-404.md`
- **Bundesgesetz (inkl. Kodifikationen wie ZGB, OR, StGB)** (`cc-YYYY-N.md`) — `ch/cc-24-233_245_233.md`
- **Verordnung (des Bundesrates, eines Departements, eines Amtes, der Bundesversammlung)** (`cc-YYYY-N.md`) — Untergesetzliche Erlasse der Exekutive.
- **Bundesbeschluss (auch dem fakultativen bzw. obligatorischen Referendum unterstehend)** (`cc-YYYY-N.md`)
- **Völkerrechtliche Verträge (bilateral / multilateral)** (`cc-YYYY-N.md`) — Internationale Rechtstexte in der SR.
- **Weitere Erlasstypen** (`cc-YYYY-N.md`) — Reglement, Beschluss, Richtlinie, Weisung u. a.; nicht klassifizierbare Typen erhalten den Rang "andere". Der Dateiname leitet sich aus der ELI-URI eli/cc/YYYY/N ab (z. B. eli/cc/1999/404 → cc-1999-404; Unterstriche in Alt-IDs bleiben erhalten).

## Datenquelle

- **Fedlex — Die Publikationsplattform des Bundesrechts (Bundeskanzlei / Schweizerische Eidgenossenschaft)**
  - Portal: https://www.fedlex.admin.ch/
  - Linked-Data / SPARQL-Endpoint: https://fedlex.data.admin.ch/sparqlendpoint
  - Filestore (Akoma-Ntoso-XML): https://fedlex.data.admin.ch/filestore
  - ELI-Basis: https://fedlex.data.admin.ch/eli/

## Abdeckung und Grenzen

- Geltungsbereich v1: nur Erlasse der Systematischen Rechtssammlung (eli/cc/), die mindestens eine deutschsprachige Akoma-Ntoso-3.0-XML-Konsolidierung besitzen — rund 5'139 von etwa 17'258 SR-Nummern. Erlasse, die ausschliesslich als PDF/DOC vorliegen, werden in v1 übersprungen.
- Historie ist bei älteren Erlassen unvollständig: Die XML-Konsolidierungen beginnen frühestens um 2011 (alte Kodifikationen), für die meisten Erlasse erst ab 2021. Wo die Versionsgeschichte abgeschnitten ist, wird dies pro Norm in `extra.history_from` vermerkt.
- Daten stammen ausschliesslich aus der deutschen Sprachfassung; Titel in anderen Amtssprachen (z. B. `title_fr`) werden, soweit vorhanden, im `extra`-Feld mitgeführt.
- Bilder werden nicht übernommen; Tabellen, Fett-/Kursivauszeichnung, Querverweise und Fussnoten werden nach Markdown überführt.

## Weitere Länder

Dieses Repository ist Teil von **Legalize**, das die Gesetzgebung mehrerer Länder als Git-Repositories pflegt. Den vollständigen Katalog finden Sie unter https://legalize.dev.

## Unterstützung

Legalize ist kostenlos und offen. Wenn diese Arbeit für Sie nützlich ist, können Sie dazu beitragen, ihr Hosting und ihre Weiterentwicklung zu sichern: [Dieses Projekt unterstützen](https://buymeacoffee.com/legalizedev).

## Lizenz

- **Pipeline-Code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Daten**: gemeinfrei (amtliche Texte, von Gesetzes wegen vom Urheberrechtsschutz ausgenommen)
