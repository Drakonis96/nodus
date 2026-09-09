# legalize-pl

Polska — ustawodawstwo w formacie Markdown, wersjonowane jako repozytorium git.

Każda ustawa to plik; każda nowelizacja to commit z datą rzeczywistej, oficjalnej publikacji. `git log` dowolnej ustawy pokazuje jej pełną historię — kiedy została uchwalona, które artykuły uległy zmianie i na mocy której normy.

Repozytorium obejmuje akty prawne publikowane w Dzienniku Ustaw (wydawca DU) udostępniane przez ELI API Sejmu. Zakres wersji 1: wyłącznie akty z dostępną treścią HTML, od roku 2000 wzwyż (pokrycie HTML jest niemal pełne od ~2012 r.). Każdy plik odpowiada jednemu aktowi, każda reforma to commit git datowany na oficjalną datę ogłoszenia.

## Co zawiera

- **Ustawa** (`DU-RRRR-PPP.md`) — `pl/DU-2024-1907.md`, `pl/DU-2023-1963.md`
- **Rozporządzenie** (`DU-RRRR-PPP.md`) — `pl/DU-2024-1984.md`, `pl/DU-2024-1977.md`
- **Konstytucja** (`DU-RRRR-PPP.md`) — Konstytucja Rzeczypospolitej Polskiej (dostępna w ISAP głównie jako PDF — może nie występować w wersji v1).
- **Obwieszczenie** (`DU-RRRR-PPP.md`) — Obwieszczenia (m.in. teksty jednolite) publikowane w Dzienniku Ustaw.
- **Uchwała** (`DU-RRRR-PPP.md`)
- **Umowa międzynarodowa** (`DU-RRRR-PPP.md`) — Umowy i protokoły międzynarodowe ogłaszane w Dzienniku Ustaw.

## Źródło danych

- **ISAP — Internetowy System Aktów Prawnych / ELI API Sejmu Rzeczypospolitej Polskiej (Kancelaria Sejmu)**
  - Portal ISAP: https://isap.sejm.gov.pl/
  - Portal ELI: https://eli.gov.pl/
  - API ELI (Sejm): https://api.sejm.gov.pl/eli
  - Dokumentacja API: https://api.sejm.gov.pl/eli_pl.html

## Ograniczenia zakresu

- Uwzględniany jest wyłącznie wydawca **DU (Dziennik Ustaw)**; Monitor Polski (MP) i inne dzienniki urzędowe nie są obecnie pobierane.
- Pomijane są akty dostępne **tylko w formacie PDF** (np. Konstytucja z 1997 r., obwieszczenia z tekstami jednolitymi kodeksów, większość aktów sprzed 2012 r.), ponieważ pipeline przetwarza treść z HTML.
- **Obrazy są pomijane** — pipeline nie obsługuje jeszcze zasobów binarnych.
- Identyfikator pliku pochodzi z ELI: `{wydawca}-{rok}-{pozycja}` (forma ELI `DU/rok/pozycja` zapisana z myślnikami, bezpieczna dla systemu plików).

## Inne kraje

To repozytorium jest częścią projektu **Legalize**, który utrzymuje ustawodawstwo wielu krajów w postaci repozytoriów git. Pełny katalog dostępny jest pod adresem https://legalize.dev.

## Wsparcie

Legalize jest darmowy i otwarty. Jeśli ta praca jest dla Ciebie przydatna, możesz pomóc w utrzymaniu hostingu i dalszym rozwoju: [Wesprzyj ten projekt](https://buymeacoffee.com/legalizedev).

## Licencja

- **Kod pipeline'u**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Dane**: domena publiczna (urzędowe publikacje rządowe)
