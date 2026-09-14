# legalize-lu

Lëtzebuerg / Luxembourg — législation en Markdown, versionnée sous forme de dépôt git.

Chaque loi est un fichier ; chaque réforme est un commit daté de la véritable date de publication officielle. Le `git log` de toute loi présente son historique complet — quand elle a été promulguée, quels articles ont été modifiés et par quelle norme.

Le dépôt couvre la législation primaire luxembourgeoise diffusée par Legilux dans le périmètre v1 : lois, règlements grand-ducaux et la Constitution. Chaque norme est un fichier Markdown et chaque consolidation (réforme) issue du modèle de données JOLux donne lieu à un commit git daté à sa date d'applicabilité.

## Contenu

- **Loi** (`leg-loi-AAAA-MM-JJ-aNNN.md`) — `lu/leg-loi-2022-05-27-a250.md`
- **Règlement grand-ducal** (`leg-rgd-AAAA-MM-JJ-aNNN.md`) — `lu/leg-rgd-2026-04-02-a185.md`
- **Constitution** (`leg-constitution-AAAA-MM-JJ-nN.md`) — `lu/leg-constitution-1868-10-17-n1.md`

## Source des données

- **Legilux — Journal officiel du Grand-Duché de Luxembourg (Service central de législation, Ministère d'État)**
  - Portail open data (Casemates): https://data.legilux.public.lu/
  - Point d'accès SPARQL: https://data.legilux.public.lu/sparqlendpoint
  - Filestore XML (Akoma Ntoso): https://data.legilux.public.lu/filestore
  - Jeu de données sur data.public.lu: https://data.public.lu/en/datasets/legilux-journal-officiel-du-grand-duche-de-luxembourg-1/

## Attribution

> Source : Legilux — Journal officiel du Grand-Duché de Luxembourg (Service central de législation, Ministère d'État). Données réutilisées sous licence Creative Commons Attribution 4.0 International (CC BY 4.0).

## Limites de couverture

- Seuls les actes disposant d'une manifestation XML (Akoma Ntoso) dans le filestore sont inclus ; environ 20 % des textes anciens (antérieurs à 1900) n'existent qu'en PDF et sont donc absents.
- L'historique des versions provient des consolidations JOLux (champ `dateApplicability`). Les chaînes de consolidations très longues sont plafonnées à 200 versions par norme.
- Les images sont volontairement omises (pas de prise en charge des binaires).

## Autres pays

Ce dépôt fait partie de **Legalize**, qui maintient la législation de plusieurs pays sous forme de dépôts git. Consultez https://legalize.dev pour le catalogue complet.

## Soutien

Legalize est libre et ouvert. Si ce travail vous est utile, vous pouvez contribuer à en financer l'hébergement et le développement : [Soutenir ce projet](https://buymeacoffee.com/legalizedev).

## Licence

- **Code du pipeline** : MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Données** : Creative Commons Attribution 4.0 International (CC BY 4.0)
