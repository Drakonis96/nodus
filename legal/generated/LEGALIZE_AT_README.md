# legalize-at

Österreich — Gesetzgebung in Markdown, versioniert als Git-Repository.

Jedes Gesetz ist eine Datei; jede Reform ist ein Commit, datiert auf das tatsächliche amtliche Veröffentlichungsdatum. Das `git log` eines jeden Gesetzes zeigt seine vollständige Historie — wann es erlassen wurde, welche Artikel sich geändert haben und durch welche Norm.

Abgedeckt ist das österreichische Bundesrecht in der konsolidierten Fassung (Applikation „BrKons" der RIS-OGD-Schnittstelle). Jede Norm wird über ihre RIS-Gesetzesnummer identifiziert und aus allen zugehörigen NOR-Dokumenten (Paragrafen/Artikeln) zu einem konsolidierten Dokument zusammengesetzt.

## Inhalt

- **Bundesgesetz** (`AT-XXXXXXXX.md`) — `at/AT-10001848.md`
- **Bundesverfassungsgesetz** (`AT-XXXXXXXX.md`) — RIS-Typ „BVG".
- **Verordnung** (`AT-XXXXXXXX.md`) — `at/AT-10002333.md`
- **Kundmachung** (`AT-XXXXXXXX.md`) — RIS-Typ „K".
- **Erlass** (`AT-XXXXXXXX.md`) — RIS-Typ „E".
- **Staatsvertrag** (`AT-XXXXXXXX.md`) — RIS-Typ „Vertrag"; auch zusammengesetzte Typen wie „Vertrag – Schweiz".
- **Sonstige** (`AT-XXXXXXXX.md`) — Fallback-Rang für nicht zugeordnete RIS-Typen.

## Datenquelle

- **RIS – Rechtsinformationssystem des Bundes (Bundeskanzleramt der Republik Österreich)**
  - Portal: https://www.ris.bka.gv.at/
  - Bundesrecht konsolidiert: https://www.ris.bka.gv.at/Bundesrecht/
  - OGD-API (v2.6, Applikation BrKons): https://data.bka.gv.at/ris/api/v2.6
  - Open Government Data / Lizenz: https://www.ris.bka.gv.at/UI/Ogd.aspx

## Quellenangabe

> Quelle: RIS – Rechtsinformationssystem des Bundes, Bundeskanzleramt der Republik Österreich (https://www.ris.bka.gv.at/). Lizenziert unter CC BY 4.0 (Creative Commons Namensnennung 4.0 International). Aus den Daten können keinerlei Rechtsansprüche abgeleitet werden.

## Dateinamen

Der Dateiname ist `AT-` gefolgt von der RIS-Gesetzesnummer (z. B. `at/AT-10002333.md`). Alle Normen liegen flach im Verzeichnis `at/`; der Rang steht im YAML-Frontmatter, nicht im Verzeichnisbaum.

## Bekannte Einschränkungen

- Die vollständige Novellen-/Reformhistorie wird derzeit nicht aus dem separaten Novellen-Endpunkt zusammengeführt (`extract_reforms` liefert noch keine Reformpunkte aus den Metadaten).
- Abgedeckt ist ausschließlich Bundesrecht konsolidiert — Landesrecht, Judikatur und Erlässe außerhalb des konsolidierten Bundesrechts sind nicht enthalten.
- Bilder/binäre Inhalte werden ausgelassen.

## Weitere Länder

Dieses Repository ist Teil von **Legalize**, das die Gesetzgebung mehrerer Länder als Git-Repositories pflegt. Den vollständigen Katalog finden Sie unter https://legalize.dev.

## Unterstützung

Legalize ist kostenlos und offen. Wenn diese Arbeit für Sie nützlich ist, können Sie dazu beitragen, ihr Hosting und ihre Weiterentwicklung zu sichern: [Dieses Projekt unterstützen](https://buymeacoffee.com/legalizedev).

## Lizenz

- **Pipeline-Code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Daten**: CC BY 4.0 (Creative Commons Namensnennung 4.0 International)
