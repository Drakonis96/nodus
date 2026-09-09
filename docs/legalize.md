# Legalize

One optional skill for legislation in the 32 reviewed country/EU repositories
of [legalize-dev](https://github.com/legalize-dev). Enable **Legalize** in the
chat's Skills control. Assistant activation covers the shared chat surfaces;
Nodi can be enabled independently. No Git, account or API key is required.

Examples:

- `España: Constitución Española, artículo 14`
- `United States: 17 U.S.C. § 105`
- `España: BOE-A-1978-31229, artículo 14`

The model selects the explicitly named country and copies the requested law
name, subject or identifier into a `legal-plan`. The application validates the
request, downloads the actual source and replaces the model's accompanying
prose with the retrieved result. A `legal-result` produced by a model is refused.
Incomplete requests, multiple plans, disabled skills and cancelled/deleted
sessions cannot produce a successful tool result.

## Retrieval and limits

Exact identifiers first try the country's standard path; title searches and
regional/other paths use a ZIP snapshot of the latest repository commit. The
first title search downloads the country snapshot and builds a local index of
actual document titles, identifiers and paths. It can take several minutes and
consume substantial bandwidth; later searches reuse the index while that
commit remains current. The archive is not extracted or executed. There are
explicit limits (256 MB compressed, 4 GB declared uncompressed, 350,000 entries,
10 MB per source file, four minutes); a larger catalogue produces an error,
not an assertion that its laws do not exist. Exact standard-path identifiers
can still work without downloading the catalogue.

Search matches original-language title words or identifiers, ignoring case and
accents. It is not a semantic or full-text search engine. Up to five candidates
are shown; a single or unique exact-title/identifier match is read automatically.
For multiple candidates, ask again with the identifier and country. Complete
text is returned up to 200,000 characters. Larger laws require an article or the
repository link; no silently truncated article is presented. Article extraction
recognizes unambiguous Markdown Artículo/Article/Art./Section/§ headings and
preserves the entire section until the next heading at the same or higher
level. Other heading conventions require reading the whole norm.

Only the latest fetched GitHub snapshot is implemented. Publication dates,
repository commits and effective legal dates are distinct. No historical-date
lookup, automatic official-source freshness verification or guarantee of
current validity is provided. US coverage is the United States Code, not the
CFR, state laws or case law. Other jurisdictions have their upstream coverage
gaps. The result displays source-provided metadata and links the official text.

## Licences and future countries

See [the reviewed country register](../legal/LEGALIZE.md). Both LICENSE and
README must match their reviewed SHA-256 at the fetched commit before any law
is read. Changed notices stop retrieval pending a new review; laws themselves
may update without changing these notices. Country licences, citations,
original metadata, revision and Nodus extraction/presentation statements are
included in results and text downloads. About includes every supported source.

Denmark's placeholder repository and Ukraine's pipeline-only repository are
not enabled as legislative corpora. Future countries are added to the same
`shared/legalize-countries.json` register after reviewing their own LICENSE,
README, official source terms, attribution and data layout; pin the exact
notices in `legal/remote-notices.json`. Never infer data licensing from an MIT
pipeline licence. There is no unrestricted custom-repository input.

## Defaults and migration

New installations activate **SVG Studio** and **Image Atelier** only. Chemistry,
AlphaGenome, Legalize, Socratic Tutor and all general skills start disabled.
Version 12 adds Legalize once, disabled, preserving earlier edits, deletions and
per-surface activation. At startup, older profiles without a saved skill library
retain the previously implicit Chemistry activation; new profiles are seeded
before their first database/preferences are created. Explicit restoration resets
the built-ins to the new defaults. Newly created personal skills start disabled.

## Verification

`node --test scripts/test-legalize.mjs scripts/test-chat-skills.mjs` checks
country grounding, real execution dispatch, title-index paths/cache, article
boundaries, licence changes, cancellation, notices, fresh-profile defaults and
legacy migration using synthetic source fixtures.

`node scripts/verify-legalize-live.mjs` performs only two read-only real lookups:
Spain's Constitution by title (article 14) and 17 U.S.C. § 105. Both passed on
2026-09-09. The first verified “Los españoles son iguales ante la ley”; the second
verified the U.S. Government works provision. No text-model API was used by
this live retrieval check. The normal build and licence verification also run.

Renderer QA used `visual-tests/legalize-harness.html` with real chat/skill/licence components and clearly labelled synthetic text. Verified the two default active skills, independent Legalize activation, readable source text, BOE attribution and the complete country list in the licence modal.
