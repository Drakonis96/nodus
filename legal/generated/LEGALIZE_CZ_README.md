# legalize-cz

Česko — legislativa v Markdownu, verzovaná jako git repozitář.

Každý zákon je soubor; každá novela je commit datovaný ke skutečnému dni úředního vyhlášení. `git log` libovolného zákona ukazuje jeho úplnou historii — kdy byl přijat, které články se změnily a kterou normou.

Repozitář obsahuje právní předpisy publikované ve Sbírce zákonů (sbírkový kód „sb“) získané z e-Sbírky. Discovery sekvenčně prochází identifikátory /sb/{rok}/{číslo} pro každý rok od roku 1945 do současnosti. Každý soubor je jedna konsolidovaná norma; každá reforma je samostatný git commit datovaný k oficiálnímu datu vyhlášení.

## Co obsahuje

- **Zákon** (`SB-RRRR-N.md`) — `cz/SB-2012-89.md`, `cz/SB-2009-40.md`, `cz/SB-1992-586.md`
- **Ústavní zákon** (`SB-RRRR-N.md`) — `cz/SB-1993-1.md`
- **Novela** (`SB-RRRR-N.md`) — `cz/SB-2024-1.md`
- **Nařízení** (`SB-RRRR-N.md`) — Nařízení vlády (šablona *_NARIZENI), ranku „regulation“.
- **Vyhláška** (`SB-RRRR-N.md`) — Vyhláška (šablona *_VYHLASKA), ranku „ordinance“.
- **Dekret** (`SB-RRRR-N.md`) — Dekret / ústavní dekret (šablona *_DEKRET), ranku „decree“ nebo „constitutional_decree“.

## Zdroj dat

- **e-Sbírka — elektronická Sbírka zákonů a mezinárodních smluv (Ministerstvo vnitra České republiky)**
  - Portál: https://e-sbirka.gov.cz/
  - Otevřená data a veřejné API: https://zakony.gov.cz/gov/otevrena-data-a-verejna-api-systemu-e-sbirka-od-15-ledna/
  - API (cache): https://e-sbirka.gov.cz/sbr-cache

## Omezení

- Identifikátor souboru má tvar `SB-{rok}-{číslo}` (např. `SB-1993-1`), odvozený z `staleUrl` ve tvaru `/sb/{rok}/{číslo}`. Rang (zákon, ústavní zákon, nařízení, vyhláška, dekret) je uložen ve frontmatteru, nikoli ve struktuře adresářů — všechny soubory leží ploše v adresáři `cz/`.
- Obrázky a binární přílohy se nepřebírají (politika projektu); v textu jsou nahrazeny značkou `[image omitted]`.
- Seznam reforem (novel) je odvozen z metadat normy (úplná citace s novelami), nikoli z textu.

## Další země

Tento repozitář je součástí projektu **Legalize**, který spravuje legislativu více zemí jako git repozitáře. Úplný katalog najdete na https://legalize.dev.

## Podpora

Legalize je zdarma a otevřený. Pokud je pro vás tato práce užitečná, můžete pomoci financovat jeho hosting a vývoj: [Podpořit tento projekt](https://buymeacoffee.com/legalizedev).

## Licence

- **Kód pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: volné dílo (úřední díla podle § 3 písm. a) zákona č. 121/2000 Sb., autorského zákona)
