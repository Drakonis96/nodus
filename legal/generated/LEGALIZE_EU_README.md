# legalize-eu

European Union legislation in Markdown, version-controlled as a git repository.

Each law is a file; each reform is a commit dated to the real official publication date. The `git log` of any law shows its full history — when it was enacted, which articles changed and by which norm.

Scope (v1) is EU regulations only — base regulations plus implementing, delegated and financial regulations — that are currently in force and have an English XHTML/HTML expression in CELLAR. Directives, decisions, treaties and case law are not included. Each regulation's git history is built from its consolidated-text versions: the original act plus every consolidated version, one commit per reform dated to the consolidation's document date.

## What's inside

- **Regulation** (`3YYYYR-XXXX.md`) — `eu/32016R0679.md`, `eu/32014R0596.md`, `eu/32024R1689.md`
- **Implementing Regulation** (`3YYYYR-XXXX.md`) — Commission implementing regulations (resource type REG_IMPL). Same CELEX-number filename scheme; regulation_type recorded in frontmatter extra.
- **Delegated Regulation** (`3YYYYR-XXXX.md`) — Commission delegated regulations (resource type REG_DEL).
- **Financial Regulation** (`3YYYYR-XXXX.md`) — Financial regulations (resource type REG_FINANC).

## Data source

- **EUR-Lex / CELLAR — Publications Office of the European Union**
  - Portal: https://eur-lex.europa.eu
  - SPARQL endpoint (CELLAR): https://publications.europa.eu/webapi/rdf/sparql
  - REST API (CELLAR): https://publications.europa.eu/resource/cellar/
  - Consolidated texts: https://eur-lex.europa.eu/collection/eu-law/consleg.html

## Attribution

> © European Union, https://eur-lex.europa.eu — Source: EUR-Lex (Publications Office of the European Union). Reused under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence. Only EU legislation published in the printed Official Journal of the European Union is deemed authentic; consolidated texts are reproduced here for documentation purposes and have been reformatted to Markdown.

## Coverage and limitations

- **English texts only.** The fetcher requests the English-language expression (`language/ENG`) for every norm; other official languages are not fetched.
- **In-force regulations only.** Discovery filters on `resource_legal_in-force = true`; repealed or expired regulations are excluded. Corrigenda (`CORRIGENDUM`) are filtered out.
- **HTML/XHTML availability required.** Regulations that exist in CELLAR only as PDF are skipped, because the parser cannot extract their text.
- **Version cap.** A small number of heavily amended codes have their consolidated history truncated to the 200 most recent versions to bound bootstrap cost.
- **Images are dropped** — binary assets are not reproduced.
- **Identifier = CELEX number.** Filenames use the EUR-Lex CELEX number (e.g. `32016R0679`), with `eli`, `celex` and `regulation_type` recorded in the frontmatter `extra` block. Only the version published in the Official Journal is legally authentic.

## Other countries

This repository is part of **Legalize**, which maintains the legislation of multiple countries as git repos. See https://legalize.dev for the full catalog.

## Support

Legalize is free and open. If this work is useful to you, you can help sustain its hosting and development: [Support this project](https://buymeacoffee.com/legalizedev).

## License

- **Pipeline code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: Creative Commons Attribution 4.0 International (CC BY 4.0)
