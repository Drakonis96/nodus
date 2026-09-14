# legalize-li

Liechtenstein — Gesetzgebung in Markdown, versioniert als Git-Repository.

Jedes Gesetz ist eine Datei; jede Reform ist ein Commit, datiert auf das tatsächliche amtliche Veröffentlichungsdatum. Das `git log` eines jeden Gesetzes zeigt seine vollständige Historie — wann es erlassen wurde, welche Artikel sich geändert haben und durch welche Norm.

Dieses Repository enthält das konsolidierte Landesrecht Liechtensteins (Gesetze und Verordnungen) sowie die in Lilex konsolidierten Staatsverträge, jeweils aus der Gesetzesdatenbank Lilex (gesetze.li). Erfasst werden die in Kraft stehenden konsolidierten Normen samt ihrer historischen Fassungen: Jede frühere Fassung einer Norm wird als eigener Git-Commit auf das jeweilige Inkrafttretensdatum der Fassung datiert.

## Inhalt

- **Landesrecht (Gesetze)** (`LGBl-JJJJ-NNN.md`) — `li/LGBl-1921-015.md`, `li/LGBl-1926-004.md`
- **Verordnungen und sonstige Erlasse** (`LGBl-JJJJ-NNN.md`) — `li/LGBl-1988-037.md`
- **Staatsverträge** (`LGBl-JJJJ-NNN.md`) — `li/LGBl-2024-076.md`

## Datenquelle

- **Lilex — Gesetzesdatenbank des Fürstentums Liechtenstein (Liechtensteinisches Landesgesetzblatt, LGBl), herausgegeben von der Regierung des Fürstentums Liechtenstein**
  - Portal: https://www.gesetze.li
  - Konsolidiertes Recht (Gebietssystematik): https://www.gesetze.li/konso/gebietssystematik
  - Neueste Landesgesetzblätter: https://www.gesetze.li/chrono/neueste-lgbl

## Identifikator und Dateinamen

Jede Norm wird als `li/LGBl-{Jahr}-{Nummer}.md` abgelegt, wobei die dreistellige LGBl-Nummer mit führenden Nullen aufgefüllt ist (z. B. `li/LGBl-1921-015.md`). Der Identifikator leitet sich aus der LGBl-Nummer in punktierter Form (z. B. `1921.015`) ab.

## Versionsgeschichte

Lilex stellt pro Norm ein Versions-Dropdown mit allen konsolidierten Fassungen bereit; die Pipeline holt jede historische Fassung einzeln und erzeugt daraus eine Commit-Historie. Wenn für eine Fassung kein datierter Eintrag vorliegt, wird ersatzweise der 1. Januar des LGBl-Jahrgangs als Datum verwendet.

## Bekannte Einschränkungen

Lilex bietet keine öffentliche API; die Daten werden per HTML-Scraping über gesetze.li bezogen. Bilder/Binärinhalte werden ausgelassen. Der Rang (`rank`) wird heuristisch aus dem Titel abgeleitet und kann in Einzelfällen ungenau sein.

## Weitere Länder

Dieses Repository ist Teil von **Legalize**, das die Gesetzgebung mehrerer Länder als Git-Repositories pflegt. Den vollständigen Katalog finden Sie unter https://legalize.dev.

## Unterstützung

Legalize ist kostenlos und offen. Wenn diese Arbeit für Sie nützlich ist, können Sie dazu beitragen, ihr Hosting und ihre Weiterentwicklung zu sichern: [Dieses Projekt unterstützen](https://buymeacoffee.com/legalizedev).

## Lizenz

- **Pipeline-Code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Daten**: gemeinfrei (amtliche Werke des Staates)
