# legalize-fr

France — législation en Markdown, versionnée sous forme de dépôt git.

Chaque loi est un fichier ; chaque réforme est un commit daté de la véritable date de publication officielle. Le `git log` de toute loi présente son historique complet — quand elle a été promulguée, quels articles ont été modifiés et par quelle norme.

Ce dépôt couvre les textes consolidés de la base LEGI de Légifrance. La phase initiale du pipeline se limite aux textes en vigueur dont la nature est « CODE » ou « CONSTITUTION » : les codes français consolidés et la Constitution du 4 octobre 1958. Chaque texte est un fichier Markdown ; chaque modification correspond à un commit git daté à la date de prise d'effet de la version, ce qui reconstitue l'historique des réformes article par article.

## Contenu

- **Codes consolidés** (`LEGITEXTXXXXXXXXXXXX.md`) — `fr/LEGITEXT000006069414.md`
- **Constitution** (`LEGITEXTXXXXXXXXXXXX.md`) — `fr/LEGITEXT000006071194.md`
- **Lois, lois organiques, ordonnances et décrets** (`LEGITEXTXXXXXXXXXXXX.md`) — Natures LEGI LOI, LOI ORGANIQUE, ORDONNANCE, DÉCRET reconnues par le parseur (textes JORF). Hors périmètre de la phase initiale d'amorçage.

## Source des données

- **Légifrance — base LEGI (Direction de l'information légale et administrative, DILA, services du Premier ministre)**
  - Portail : https://www.legifrance.gouv.fr
  - Jeu de données LEGI (data.gouv.fr) : https://www.data.gouv.fr/datasets/legi-codes-lois-et-reglements-consolides
  - Dump Open Data LEGI (DILA) : https://echanges.dila.gouv.fr/OPENDATA/LEGI/
  - Open data et API : https://www.legifrance.gouv.fr/contenu/pied-de-page/open-data-et-api

## Attribution

> Source : Direction de l'information légale et administrative (DILA) — base LEGI / Légifrance (https://www.legifrance.gouv.fr). Données réutilisées sous Licence Ouverte / Open Licence (Etalab) v2.0. Les textes ont été convertis au format Markdown par Legalize ; ils peuvent différer de la version officielle. Seules les versions publiées au Journal officiel et sur Légifrance font foi.

## Précisions

- Les identifiants de fichiers sont les identifiants LEGI officiels (préfixe `LEGITEXT` suivi de 12 chiffres).
- La date de chaque version est la date de début (`debut`) de l'article ou de la section dans la base LEGI ; la valeur sentinelle `2999-01-01` (validité indéterminée) est traitée comme absente.
- Les images sont volontairement écartées (le pipeline ne gère pas encore les fichiers binaires).
- La portée actuelle est restreinte aux codes et à la Constitution ; les lois, ordonnances et décrets isolés (textes JORF) sont reconnus par le parseur mais ne sont pas inclus dans cette phase d'amorçage.

## Autres pays

Ce dépôt fait partie de **Legalize**, qui maintient la législation de plusieurs pays sous forme de dépôts git. Consultez https://legalize.dev pour le catalogue complet.

## Soutien

Legalize est libre et ouvert. Si ce travail vous est utile, vous pouvez contribuer à en financer l'hébergement et le développement : [Soutenir ce projet](https://buymeacoffee.com/legalizedev).

## Licence

- **Code du pipeline** : MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Données** : Licence Ouverte / Open Licence (Etalab) v2.0
