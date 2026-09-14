# legalize-se

Sverige — lagstiftning i Markdown, versionshanterad som ett git-repository.

Varje lag är en fil; varje reform är en commit daterad till det faktiska officiella publiceringsdatumet. `git log` för en lag visar dess fullständiga historik — när den antogs, vilka artiklar som ändrades och genom vilken norm.

Innehåller svenska grundförfattningar ur Svensk författningssamling (SFS) hämtade via Riksdagens öppna data. Varje författning är en fil och varje ändring (ändrings-SFS) blir en git-commit daterad till det officiella publiceringsdatumet.

## Innehåll

- **Grundlag** (`SFS-XXXX-XX.md`) — `se/SFS-1974-152.md`
- **Balk** (`SFS-XXXX-XX.md`) — `se/SFS-1962-700.md`
- **Lag** (`SFS-XXXX-XX.md`) — Lagar — den vanligaste typen av SFS-författning.
- **Förordning** (`SFS-XXXX-XX.md`) — `se/SFS-2011-1108.md`

## Datakälla

- **Sveriges riksdag — Riksdagens öppna data (Svensk författningssamling, SFS)**
  - Portal: https://www.riksdagen.se/sv/dokument-och-lagar/riksdagens-oppna-data/
  - API/dataset: https://data.riksdagen.se/dokumentlista/?doktyp=sfs&format=json
  - Dokument: https://data.riksdagen.se/dokument/{dok_id}.json
  - Ändringsregister (SFSR): https://rkrattsbaser.gov.se/sfsr?bet={SFS}

## Tillskrivning

> Källa: Sveriges riksdag (Riksdagens öppna data). Detta projekt drivs inte av och är inte godkänt av Sveriges riksdag.

## Avgränsningar

Ändrings-SFS (titlar med "om ändring i" eller "om upphävande av") sparas inte som egna filer — de tillämpas på den grundförfattning de ändrar och registreras som ändringshistorik. Ändringsregistret (SFSR) hämtas separat från rkrattsbaser.gov.se. För äldre författningar utan registrerat publiceringsdatum används den 1 januari det år SFS-numret avser som ungefärligt datum. Bilder och andra binära tillgångar tas inte med.

## Andra länder

Detta repository är en del av **Legalize**, som upprätthåller flera länders lagstiftning som git-repositorier. Se https://legalize.dev för hela katalogen.

## Stöd

Legalize är gratis och öppen. Om detta arbete är användbart för dig kan du hjälpa till att finansiera dess hosting och utveckling: [Stöd detta projekt](https://buymeacoffee.com/legalizedev).

## Licens

- **Pipeline-kod**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: Fri användning med källhänvisning (Riksdagens öppna data)
