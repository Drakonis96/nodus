# legalize-uk

United Kingdom legislation in Markdown, version-controlled as a git repository.

Each law is a file; each reform is a commit dated to the real official publication date. The `git log` of any law shows its full history — when it was enacted, which articles changed and by which norm.

Covers UK primary legislation (Acts and Measures) and secondary legislation (Statutory Instruments) across all four jurisdictions. Documents are sourced as CLML (Crown Legislation Markup Language) XML and split across directories by jurisdiction: uk/ for UK-wide laws, uk-sct/ for Scotland, uk-wls/ for Wales, uk-nir/ for Northern Ireland. Each law's git history reconstructs its revised-text timeline: a bootstrap commit from the as-enacted text plus one commit per applied in-force amendment date, derived from the official point-in-time snapshots and change timeline feeds.

## What's inside

- **UK Public General Acts** (`uk/ukpga-YYYY-N.md`) — `uk/ukpga-1998-42.md`, `uk/ukpga-2018-12.md`
- **UK Statutory Instruments** (`uk/uksi-YYYY-N.md`) — `uk/uksi-2020-52.md`
- **Acts of the Scottish Parliament** (`uk-sct/asp-YYYY-N.md`) — `uk-sct/asp-2021-11.md`
- **Welsh primary legislation (Senedd Acts and Measures)** (`uk-wls/{asc|anaw|mwa}-YYYY-N.md`) — `uk-wls/asc-2020-1.md`
- **Acts of the Northern Ireland Assembly** (`uk-nir/nia-YYYY-N.md`) — `uk-nir/nia-2022-2.md`

## Data source

- **legislation.gov.uk, published by The National Archives**
  - Portal: https://www.legislation.gov.uk
  - Data (CLML XML / Atom): https://www.legislation.gov.uk/{type}/{year}/{number}/data.xml
  - Reuse documentation: https://legislation.github.io/data-documentation/reuse-licence.html

## Attribution

> © Crown and database right. Derived from content available under the Open Government Licence v3.0 from legislation.gov.uk.

## Coverage notes

- Reform history depends on legislation.gov.uk's revised/point-in-time data, which has the fullest schema coverage for post-1988 legislation; older Acts may carry fewer revision commits.
- Images are not included: image nodes are dropped during conversion and counted in the metadata.
- A small number of large Acts can be withheld on demand by the source's CloudFront/WAF layer (HTTP 202 with an empty body); such laws are flagged for reprocessing rather than committed empty.

## Other countries

This repository is part of **Legalize**, which maintains the legislation of multiple countries as git repos. See https://legalize.dev for the full catalog.

## Support

Legalize is free and open. If this work is useful to you, you can help sustain its hosting and development: [Support this project](https://buymeacoffee.com/legalizedev).

## License

- **Pipeline code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: Open Government Licence v3.0 (attribution required)
