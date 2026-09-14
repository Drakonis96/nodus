# legalize-ie

Ireland legislation in Markdown, version-controlled as a git repository.

Each law is a file; each reform is a commit dated to the real official publication date. The `git log` of any law shows its full history — when it was enacted, which articles changed and by which norm.

Phase 1 covers **Acts of the Oireachtas (1922–present)** sourced from the official ELI XML. Statutory Instruments (~35,000, HTML only) and the Constitution (HTML only) are out of scope for Phase 1.

## What's inside

- **Acts of the Oireachtas** — every public Act, sourced as official ELI XML from the Irish Statute Book (e.g. `eli/2024/act/1`).

## Data source

- **Irish Statute Book (ISB) — Office of the Houses of the Oireachtas**
  - Portal: https://www.irishstatutebook.ie
  - Discovery API: https://api.oireachtas.ie/v1/legislation
  - Revised acts: https://revisedacts.lawreform.ie

## Attribution

> Contains Irish Public Sector Information licensed under the Oireachtas (Houses of the Oireachtas) Open Data PSI Licence / Creative Commons Attribution 4.0 International, sourced from https://www.irishstatutebook.ie.

## Known limitations

- **Statutory Instruments** (~35,000) are published as HTML only and are out of scope for Phase 1.
- The **Constitution of Ireland** (Bunreacht na hÉireann) has no XML — only a special HTML path — and is handled separately.
- Texts are sourced *as enacted*; consolidated/revised versions are cross-referenced from the Law Reform Commission's revised acts.

## Other countries

This repository is part of **Legalize**, which maintains the legislation of multiple countries as git repos. See https://legalize.dev for the full catalog.

## Support

Legalize is free and open. If this work is useful to you, you can help sustain its hosting and development: [Support this project](https://buymeacoffee.com/legalizedev).

## License

- **Pipeline code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: CC-BY 4.0 (Oireachtas Open Data PSI Licence)
