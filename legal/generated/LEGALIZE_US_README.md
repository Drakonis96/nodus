# legalize-us

United States legislation in Markdown, version-controlled as a git repository.

Each law is a file; each reform is a commit dated to the real official publication date. The `git log` of any law shows its full history — when it was enacted, which articles changed and by which norm.

This repository covers the United States Code (the codified general and permanent federal statutes) as published by the Office of the Law Revision Counsel in USLM XML format. Each norm is one section of the Code; the source bundles all sections of a title into a single XML release point, and the pipeline splits them to section granularity (roughly 60,000 sections across the 54 titles). Versioning is derived by diffing successive OLRC "release points" (complete snapshots of the Code current through a specific Public Law), so reform history is tracked at release-point resolution rather than per individual amending law.

## What's inside

- **United States Code sections** (`USC-T{title}-S{section}.md`) — `us/USC-T18-S1341.md`, `us/USC-T17-S105.md`

## Data source

- **United States Code, prepared and published by the Office of the Law Revision Counsel (OLRC) of the U.S. House of Representatives**
  - Portal: https://uscode.house.gov/
  - Downloads (USLM XML release points): https://uscode.house.gov/download/download.shtml
  - About the Code: https://uscode.house.gov/about_code.xhtml

## Coverage notes

- Source data is the OLRC USLM XML, not the Statutes at Large or the Code of Federal Regulations. Only the United States Code is included.
- Reforms are detected by comparing consecutive release points, so a single commit may bundle the effects of multiple Public Laws enacted between two snapshots. Publication dates fall back to the release-point date when section-level dates are absent.
- Images and other binary assets are not included.
- The OLRC download endpoint blocks non-U.S. IP addresses; the pipeline falls back to a Wayback Machine cached copy when fetching from outside the United States.

## Other countries

This repository is part of **Legalize**, which maintains the legislation of multiple countries as git repos. See https://legalize.dev for the full catalog.

## Support

Legalize is free and open. If this work is useful to you, you can help sustain its hosting and development: [Support this project](https://buymeacoffee.com/legalizedev).

## License

- **Pipeline code**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Data**: public domain (work of the U.S. Government, 17 U.S.C. § 105)
