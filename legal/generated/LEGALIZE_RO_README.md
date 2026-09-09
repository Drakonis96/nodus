# legalize-ro

România — legislația în Markdown, cu istoric de versiuni într-un repository git.

Fiecare lege este un fișier; fiecare reformă este un commit datat la data reală a publicării oficiale. `git log` al oricărei legi îi arată întregul istoric — când a fost adoptată, ce articole s-au modificat și prin ce normă.

Acoperă corpusul legislativ principal al României în formă consolidată: Constituția, legi (inclusiv legi constituționale), coduri, ordonanțe și ordonanțe de urgență, hotărâri, decrete și decrete-lege, regulamente, norme și statute. Sunt excluse intenționat tipurile de acte secundare/administrative (de exemplu comunicate, anexe, instrucțiuni, protocoale). Descoperirea pornește de la anul 1989.

## Ce conține

- **Constituție** (`RO-XXXXX.md`) — `ro/RO-798.md`
- **Lege (inclusiv lege constituțională)** (`RO-XXXXX.md`) — Legi ordinare, organice și constituționale.
- **Cod** (`RO-XXXXX.md`) — Codul civil, Codul penal, Codul fiscal, Codul muncii, Codul de procedură civilă și Codul de procedură penală.
- **Ordonanță și ordonanță de urgență** (`RO-XXXXX.md`) — Ordonanțe (OG) și ordonanțe de urgență ale Guvernului (OUG).
- **Hotărâre** (`RO-XXXXX.md`) — Hotărâri (de regulă ale Guvernului).
- **Decret și decret-lege** (`RO-XXXXX.md`)
- **Regulament, normă și statut** (`RO-XXXXX.md`)

## Sursa datelor

- **Portalul Legislativ (legislatie.just.ro), administrat de Ministerul Justiției — texte consolidate provenite din Monitorul Oficial al României**
  - Portal: https://legislatie.just.ro
  - Pagină text consolidat: https://legislatie.just.ro/Public/DetaliiDocumentAfis/{ID}
  - Pagină detaliu (metadate + istoric versiuni): https://legislatie.just.ro/Public/DetaliiDocument/{ID}
  - API SOAP (descoperire): https://legislatie.just.ro/apiws/FreeWebService.svc?wsdl

## Identificator și nume de fișier

Identificatorul fiecărui act este `RO-{ID}`, unde `{ID}` este identificatorul numeric al documentului folosit de Portalul Legislativ (de exemplu, documentul 798 pentru Constituție devine `RO-798`). Numele fișierului este `ro/RO-{ID}.md`, structură plată, fără subdirectoare; rangul (tipul actului) este înregistrat în frontmatter, nu în calea fișierului.

## Istoricul reformelor

Fiecare versiune consolidată are propriul identificator de document pe portal. Istoricul de com-uri este reconstruit din secțiunea „istoric consolidări" de pe pagina de detaliu: fiecare consolidare devine un commit datat la data intrării în vigoare a versiunii respective.

## Imagini

Imaginile sunt eliminate (nu se publică active binare); numărul lor este consemnat în `extra.images_dropped`.

## Alte țări

Acest repository face parte din **Legalize**, care menține legislația mai multor țări sub formă de repository-uri git. Vezi https://legalize.dev pentru catalogul complet.

## Susținere

Legalize este gratuit și open. Dacă această lucrare îți este utilă, poți contribui la susținerea găzduirii și dezvoltării sale: [Susține acest proiect](https://buymeacoffee.com/legalizedev).

## Licență

- **Codul pipeline-ului**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Date**: Domeniu public (texte oficiale, Legea nr. 8/1996, art. 9)
