# legalize-be

Belgique — législation en Markdown, versionnée sous forme de dépôt git.

Chaque loi est un fichier ; chaque réforme est un commit daté de la véritable date de publication officielle. Le `git log` de toute loi présente son historique complet — quand elle a été promulguée, quels articles ont été modifiés et par quelle norme.

Le dépôt couvre la législation primaire fédérale et fédérée consolidée publiée via Justel : la Constitution coordonnée (1994), les lois (depuis 1831), les décrets des parlements régionaux et communautaires (depuis 1972) et les ordonnances de la Région de Bruxelles-Capitale (depuis 1989). La législation secondaire (arrêtés royaux et ministériels, ~150 000 textes) est explicitement exclue de cette version. Chaque norme correspond à un fichier ; chaque version archivée (réforme) devient un commit git daté à la date de publication de la loi modificative.

## Contenu

- **Constitution** (`{NUMAC}.md`) — `be/1994021048.md`
- **Loi** (`{NUMAC}.md`) — `be/1867060850.md`, `be/2024000164.md`
- **Décret** (`{NUMAC}.md`) — Décrets des parlements de communauté et de région, depuis 1972.
- **Ordonnance** (`{NUMAC}.md`) — Ordonnances de la Région de Bruxelles-Capitale, depuis 1989.

## Source des données

- **Justel — Législation consolidée (Moniteur belge / Belgisch Staatsblad), Service public fédéral Justice (SPF Justice)**
  - Portail Justel : https://www.ejustice.just.fgov.be/cgi_loi/welcome.pl?language=fr
  - Hôte des textes (ELI) : https://www.ejustice.just.fgov.be/eli/
  - SPF Justice — Moniteur belge : https://justice.belgium.be/fr/service_public_federal_justice/organisation/moniteur_belge
  - Cadre open data fédéral : https://data.gov.be/fr

## Identifiant et nommage

Le nom de fichier est le NUMAC officiel à 10 chiffres (numéro d'identification du Moniteur belge), au format `be/{NUMAC}.md`. L'identifiant interne de découverte (`dt:aaaa:mm:jj:numac`) sert à reconstruire l'URL ELI, mais seul le NUMAC est conservé comme nom de fichier.

## Source et encodage

Justel ne dispose ni d'API REST ni de dump en masse : les textes sont extraits par scraping des pages HTML ELI, encodées en ISO-8859-1 (converties en UTF-8 en sortie). Les images sont ignorées ; les tableaux sont convertis en tableaux Markdown.

## Dates des réformes

L'historique des versions est reconstruit depuis la barre latérale d'archives de Justel. Lorsque la date d'entrée en vigueur d'une version est « indéterminée » ou non chronologique, la date de publication de la loi modificative est utilisée comme date effective de repli.

## Autres pays

Ce dépôt fait partie de **Legalize**, qui maintient la législation de plusieurs pays sous forme de dépôts git. Consultez https://legalize.dev pour le catalogue complet.

## Soutien

Legalize est libre et ouvert. Si ce travail vous est utile, vous pouvez contribuer à en financer l'hébergement et le développement : [Soutenir ce projet](https://buymeacoffee.com/legalizedev).

## Licence

- **Code du pipeline** : MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Données** : Licence ouverte / open data fédéral belge (CC0 par défaut)
