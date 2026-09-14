# legalize-sk

Slovensko — legislatíva v Markdowne s verziovaním ako git repozitár.

Každý zákon je súbor; každá novela je commit s dátumom skutočného oficiálneho vyhlásenia. `git log` ktoréhokoľvek zákona zobrazuje celú jeho históriu — kedy bol prijatý, ktoré články sa zmenili a ktorou normou.

Repozitár obsahuje konsolidované znenia právnych predpisov Slovenskej republiky zo Zbierky zákonov (ZZ), získané z portálu Slov-Lex. Každý predpis je jeden súbor Markdown a každé účinné znenie (novela) je samostatný git commit datovaný dátumom nadobudnutia účinnosti. Katalóg Slov-Lex obsahuje približne 26 000 predpisov.

## Čo obsahuje

- **Zákon** (`ZZ-RRRR-NNN.md`) — Bežný zákon (typ Zakon / ZakonCeleZnenie).
- **Ústavný zákon** (`ZZ-RRRR-NNN.md`) — `sk/ZZ-1992-460.md`
- **Nariadenie vlády** (`ZZ-RRRR-NNN.md`) — Vykonávací predpis vlády (typ NariadenieVlady).
- **Vyhláška** (`ZZ-RRRR-NNN.md`) — Vyhláška ministerstva alebo iného orgánu (typ Vyhlaska).
- **Opatrenie** (`ZZ-RRRR-NNN.md`) — Opatrenie (typ Opatrenie).
- **Oznámenie** (`ZZ-RRRR-NNN.md`) — Oznámenie (typ Oznamenie), vrátane redakčného oznámenia (RedakcneOznamenie).
- **Nález** (`ZZ-RRRR-NNN.md`) — Nález Ústavného súdu (typ Nalez).
- **Rozhodnutie** (`ZZ-RRRR-NNN.md`) — Rozhodnutie orgánu verejnej moci (typ Rozhodnutie).
- **Uznesenie** (`ZZ-RRRR-NNN.md`) — Uznesenie (typ Uznesenie).
- **Zákonné opatrenie** (`ZZ-RRRR-NNN.md`) — Zákonné opatrenie (typ ZakonneOpatrenie).

## Zdroj údajov

- **Slov-Lex — elektronická Zbierka zákonov (e-Zbierka), Ministerstvo spravodlivosti Slovenskej republiky**
  - Portál: https://www.slov-lex.sk/
  - API: https://api-gateway.slov-lex.sk
  - Statické dáta: https://static.slov-lex.sk

## Pokrytie a obmedzenia

- Identifikátorom súboru je číslo predpisu v Zbierke zákonov vo formáte `ZZ-{rok}-{číslo}` (napr. predpis č. 460/1992 Z. z. → `ZZ-1992-460`).
- Vyhlásené znenie (`vyhlasene_znenie`, pôvodný text pred prvou konsolidáciou) sa vynecháva — jeho portálová adresa pri starších predpisoch často vracia chybu 404. História sa preto začína prvým konsolidovaným znením.
- Verzie bez dátumu nadobudnutia účinnosti alebo bez dostupného textu sa preskakujú.
- Obrázky sa zámerne nepreberajú (binárne prílohy zatiaľ nie sú podporované).

## Ďalšie krajiny

Tento repozitár je súčasťou projektu **Legalize**, ktorý spravuje legislatívu viacerých krajín ako git repozitáre. Úplný katalóg nájdete na https://legalize.dev.

## Podpora

Legalize je bezplatný a otvorený. Ak je pre vás táto práca užitočná, môžete pomôcť udržať jeho hosting a vývoj: [Podporte tento projekt](https://buymeacoffee.com/legalizedev).

## Licencia

- **Kód pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Údaje**: verejná doména (úradné texty vylúčené z autorskoprávnej ochrany)
