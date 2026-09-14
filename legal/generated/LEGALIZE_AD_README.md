# legalize-ad

Andorra — legislació en Markdown, amb control de versions com a repositori git.

Cada llei és un fitxer; cada reforma és un commit datat amb la data de publicació oficial real. El `git log` de qualsevol llei mostra el seu historial complet: quan es va promulgar, quins articles van canviar i per quina norma.

Aquest repositori recull les normes de rang superior publicades al BOPA per quatre organismes emissors: Lleis i Lleis qualificades i la Constitució (Consell General), i Legislació delegada i Reglaments (Govern). El BOPA és la publicació oficial d'Andorra; la versió electrònica és la jurídicament autèntica des de la Llei 25/2014. La cobertura històrica arrenca el 1989.

## Què conté

- **Lleis i lleis qualificades** (`BOPA-L-XXXX-NN.md`) — `ad/BOPA-L-2024-18.md`
- **Reglaments (decrets)** (`BOPA-D-XXXX-NN.md`) — `ad/BOPA-D-2024-501.md`
- **Legislació delegada (decrets legislatius)** (`BOPA-LD-XXXX-NN.md`) — `ad/BOPA-LD-2024-5.md`
- **Constitució del Principat d'Andorra** (`BOPA-C-1993.md`) — `ad/BOPA-C-1993.md`

## Font de les dades

- **Butlletí Oficial del Principat d'Andorra (BOPA) — Govern del Principat d'Andorra i Consell General**
  - Portal: https://www.bopa.ad/
  - API (Azure Functions): https://bopaazurefunctions.azurewebsites.net/api/
  - Magatzem de documents (Azure Blob): https://bopadocuments.blob.core.windows.net/bopa-documents/

## Atribució

> Font: Butlletí Oficial del Principat d'Andorra (BOPA) — Govern del Principat d'Andorra i Consell General (https://www.bopa.ad/). Els textos oficials estan exclosos de la protecció del dret d'autor segons l'article 4.2 de la Llei sobre drets d'autor i drets veïns (1999). Aquest repositori és un mirall **no oficial**; el BOPA continua sent l'única font autèntica de la legislació andorrana.

## Limitacions conegudes

- L'API `GetDocumentsByBOPA` està limitada a 132 resultats per butlletí independentment del total real; els organismes objectiu (02. Consell General, 03. Govern) ocupen els primers llocs de l'ordre, de manera que rarament queden truncats.
- Coexisteixen dos formats HTML d'origen: el modern (InDesign, ≈2015 endavant) amb classes CSS semàntiques i alta fidelitat, i el llegat (1989–≈2014) en text pla amb només salts de línia, de fidelitat inferior (la Constitució de 1993 és en format llegat).
- El BOPA no publica textos consolidats: cada document publicat és una unitat legal autònoma. Per tant, cada modificació es publica com a norma independent i no com a refosa del text original.

## Altres països

Aquest repositori forma part de **Legalize**, que manté la legislació de múltiples països com a repositoris git. Consulteu https://legalize.dev per al catàleg complet.

## Suport

Legalize és gratuït i obert. Si aquesta feina us és útil, podeu ajudar a sostenir-ne l'allotjament i el desenvolupament: [Doneu suport a aquest projecte](https://buymeacoffee.com/legalizedev).

## Llicència

- **Codi del pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Dades**: Domini públic — els textos oficials estan exclosos de la protecció del dret d'autor (art. 4.2 de la Llei sobre drets d'autor i drets veïns, 1999)
