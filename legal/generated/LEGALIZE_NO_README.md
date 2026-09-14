# legalize-no

Norge — lovgivning i Markdown, versjonskontrollert som et git-repository.

Hver lov er en fil; hver reform er en commit datert til den faktiske offisielle publiseringsdatoen. `git log` for en hvilken som helst lov viser hele historikken — når den ble vedtatt, hvilke artikler som ble endret og av hvilken norm.

Dette repoet inneholder konsoliderte (oppdaterte) gjeldende norske lover hentet fra Lovdatas åpne data-API (datasettet `gjeldende-lover`). Hver lov er én Markdown-fil og hver reform er en git-commit datert til den offisielle kunngjøringsdatoen.

## Hva er inkludert

- **Grunnlov** (`LOV-1814-05-17.md`) — `no/LOV-1814-05-17.md`
- **Lov** (`LOV-ÅÅÅÅ-MM-DD-N.md`) — `no/LOV-2005-05-20-28.md`, `no/LOV-2023-06-09-26.md`
- **Forskrift** (`FOR-ÅÅÅÅ-MM-DD-N.md`) — Sentrale forskrifter; identifikator med prefiks FOR, rang `forskrift`. Foreløpig ikke inkludert i gjeldende uttrekk (`gjeldende-lover`).

## Datakilde

- **Lovdata (Stiftelsen Lovdata) — Lovdatas åpne data-API (publicData)**
  - Portal: https://lovdata.no
  - API: https://api.lovdata.no/v1/publicData
  - Datasett (gjeldende lover): https://api.lovdata.no/v1/publicData/get/gjeldende-lover.tar.bz2
  - Om API-tjenesten: https://api.lovdata.no/om-api-tjenesten/

## Kreditering

> Inneholder data under Norsk lisens for offentlige data (NLOD) distribuert av Stiftelsen Lovdata.

## Begrensninger

- Kun gjeldende lover. Bygger på Lovdatas frie datasett `gjeldende-lover.tar.bz2`, som inneholder konsoliderte gjeldende lover (ca. 781 dokumenter). Sentrale forskrifter ligger i et eget datasett (`gjeldende-sentrale-forskrifter`) og er foreløpig ikke inkludert, selv om rangtypen `forskrift` finnes i parseren.
- Ingen reformhistorikk ennå. Det frie datauttrekket eksponerer ikke historiske versjoner per paragraf, så git-historikken inneholder foreløpig kun den gjeldende teksten (bootstrap). Historiske versjoner krever Lovdatas autentiserte API.
- Nynorskvarianter hoppes over. Kun bokmålsversjonen tas med; for øyeblikket har bare Grunnloven en egen nynorskvariant i kilden.
- Bilder utelates. Binære vedlegg tas ikke med.

## Andre land

Dette repositoryet er en del av **Legalize**, som vedlikeholder lovgivningen til flere land som git-repositories. Se https://legalize.dev for hele katalogen.

## Støtte

Legalize er gratis og åpen. Hvis dette arbeidet er nyttig for deg, kan du bidra til å opprettholde hosting og utvikling: [Støtt dette prosjektet](https://buymeacoffee.com/legalizedev).

## Lisens

- **Pipeline-kode**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: NLOD 2.0 (Norsk lisens for offentlige data)
