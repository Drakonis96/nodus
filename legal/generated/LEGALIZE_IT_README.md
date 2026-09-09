# legalize-it

Italia — legislazione in Markdown, sotto controllo di versione come repository git.

Ogni legge è un file; ogni riforma è un commit datato alla data ufficiale di pubblicazione reale. Il `git log` di qualsiasi legge ne mostra la storia completa: quando è stata promulgata, quali articoli sono cambiati e per effetto di quale norma.

Il repository raccoglie la legislazione statale italiana consolidata pubblicata su Normattiva. L'ambito della versione 1 comprende: Costituzione, leggi costituzionali, leggi ordinarie, decreti legislativi, decreti-legge, decreti del Presidente della Repubblica (DPR), decreti del Presidente del Consiglio dei Ministri (DPCM) e decreti. La cronologia delle riforme è ricostruita seguendo le versioni temporali (vigenza) di ciascun articolo: ogni data di inizio vigenza successiva alla prima genera un commit di riforma datato. Le immagini sono escluse.

## Cosa contiene

- **Costituzione** (`{codiceRedazionale}.md`) — La Costituzione della Repubblica Italiana (un solo atto).
- **Legge costituzionale** (`{codiceRedazionale}.md`) — rank: legge_costituzionale
- **Legge** (`{codiceRedazionale}.md`) — Leggi ordinarie dello Stato. rank: legge
- **Decreto legislativo** (`{codiceRedazionale}.md`) — rank: decreto_legislativo
- **Decreto-legge** (`{codiceRedazionale}.md`) — rank: decreto_legge
- **Decreto del Presidente della Repubblica (DPR)** (`{codiceRedazionale}.md`) — rank: decreto_presidente_repubblica
- **Decreto del Presidente del Consiglio dei Ministri (DPCM)** (`{codiceRedazionale}.md`) — rank: decreto_presidente_consiglio
- **Decreto** (`{codiceRedazionale}.md`) — rank: decreto

## Fonte dei dati

- **Normattiva — Il Portale della legge vigente (Presidenza del Consiglio dei Ministri, Istituto Poligrafico e Zecca dello Stato)**
  - Portale: https://www.normattiva.it
  - Open Data: https://dati.normattiva.it
  - API Open Data: https://api.normattiva.it/t/normattiva.api
  - Documentazione API: https://dati.normattiva.it/assets/come_fare_per/API_Normattiva_OpenData.pdf

## Identificatore e nomi dei file

L'identificatore usato nel nome del file è il «codice redazionale» di Normattiva (campo `codiceRedazionale`), non l'URN. Il percorso del file è `it/{codiceRedazionale}.md`, struttura piatta con un'unica cartella `it/`. Il rango (`rank`) dell'atto è registrato nel frontmatter YAML, non nella struttura delle cartelle. Il campo `source` del frontmatter contiene invece un URN Normattiva (`urn:nir:stato:...`).

## Date e cronologia

Le date di pubblicazione derivano dalla data di emanazione dell'atto (con fallback sulla data della Gazzetta Ufficiale). Le riforme sono dedotte dalle date di inizio vigenza degli articoli; gli atti senza versioni temporali successive risultano con il solo commit iniziale.

## Recupero del testo

Il testo consolidato è ottenuto in via primaria dall'API Open Data via URN; per alcuni tipi di atto (es. DPR, DPCM) in cui l'endpoint URN restituisce 404 si ricorre allo scraping della pagina web normattiva.it. Il bootstrap massivo usa le raccolte «multivigente» precompilate (ZIP) fornite da Normattiva.

## Altri paesi

Questo repository fa parte di **Legalize**, che mantiene la legislazione di più paesi come repository git. Consulta https://legalize.dev per il catalogo completo.

## Sostieni il progetto

Legalize è gratuito e aperto. Se questo lavoro ti è utile, puoi contribuire a sostenerne l'hosting e lo sviluppo: [Sostieni questo progetto](https://buymeacoffee.com/legalizedev).

## Licenza

- **Codice della pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Dati**: Pubblico dominio (testi ufficiali, art. 5 L. 633/1941)
