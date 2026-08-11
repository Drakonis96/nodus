# Unified Library and clean reader

The Library is one screen with two explicit scopes. **This vault** is the full
traditional Nodus corpus, including monitored Zotero collections, scans,
summaries, embeddings, passages, analyses, health filters, and bulk actions.
**Global** is the optional cross-vault catalog: it keeps one canonical copy of
each document and lets vaults link that copy for analysis without modifying the
original.

Nodus 3 users start in **This vault** after updating. Global is never enabled by
the upgrade itself. The scope bar offers it as a non-blocking option; selecting
it either activates the already configured backup location or opens backup
settings. After activation Nodus remembers the last scope across vaults.
Contextual navigation remains deterministic: a corpus-health card opens the
matching traditional filter, while a Zotero clean-reader link opens Global.
The Zotero collections manager also remains available from the command palette
and from the This-vault toolbar.

## Architecture decisions

- The two scopes share navigation but not ownership: vault analysis remains in
  the vault database, while canonical documents remain in `nodus-library`.
- All pre-v4 corpus IPC channels remain registered as compatibility adapters;
  the This-vault scope uses the same typed calls and repositories as Nodus 3.
- The source of truth lives in the backup folder selected by the user, inside
  `nodus-library`.
- The SQLite catalog is a disposable local cache. It is rebuilt from manifests
  and is not synchronized.
- The original, clean Markdown, extracted assets, page map, annotations, and
  chat are stored together under one stable identifier.
- Zotero is accessed in read-only mode. A refresh never writes to Zotero or
  removes Nodus-owned corrections.
- The Library and vaults have different responsibilities: the former preserves
  and organizes documents; the latter hold analysis, ideas, passages, notes,
  and other vault-specific work.

## On-disk structure

```text
<backup-folder>/
└── nodus-library/
    ├── library.json
    ├── <stable-identifier>/
    │   ├── metadata.json
    │   ├── original.pdf                 # or the path declared in metadata.json
    │   ├── reader.md
    │   ├── source-map.json
    │   ├── quality-report.json
    │   ├── annotations.json
    │   ├── orphaned-annotations.json
    │   ├── chat.json
    │   ├── attachments/
    │   └── .nodus/extractions/
    │       └── <extraction-fingerprint>/
    │           ├── reader.md
    │           ├── source-map.json
    │           ├── quality-report.json
    │           └── assets/
    └── .nodus/
        ├── collections/
        ├── records/
        │   ├── items/
        │   └── collections/
        └── conflicts/
```

The exact names of derived files are declared in `metadata.json`. Every path is
resolved inside the document folder; paths or symbolic links that attempt to
escape it are ignored. New annotation and chat sidecars are written atomically
and, on POSIX systems, with mode `0600`.

The local catalog lives in the Nodus profile at `library/catalog.sqlite`. It is
deliberately disposable: deleting it does not delete documents, collections,
or annotations.

### Identity

- Format-v2 manifests assign every new work an immutable Nodus ID. A Zotero,
  Mendeley, or import key is a `LibrarySourceIdentity`; it never becomes the
  canonical ID.
- Zotero equality uses library type, library ID, and item key together. Equal
  item keys in a personal and group library are therefore distinct.
- `storageId` resolves the physical folder independently. A v1 upgrade retains
  its existing folder byte-for-byte; Nodus does not rename it to match a new
  identity convention.
- Former IDs and IDs merged as duplicates become permanent aliases. Legacy IPC,
  reader links, and vault links resolve an alias to the live canonical record.
- A file added from Nodus receives a stable Nodus ID that is independent from
  its visible title.
- The `citationKey`, when available, is retained as bibliographic data but does
  not replace the stable identifier.

Both v1 and v2 item and collection manifests are readable. The next ordinary
write publishes a normalized v2 manifest in the same location. The local SQLite
cache indexes aliases and source identities, but those mappings are rebuilt
entirely from the manifests. Folder encoding handles Unicode, path separators,
dot segments, and Windows device names such as `CON`, `NUL`, `COM1`, and `LPT1`.

Legacy vault migration records the original `workId` per vault in the canonical
item manifest. Relinking that item reuses the original work instead of creating
a second corpus entry.

### Opt-in migration sessions

The Global Library migration is an explicit assistant, not an upgrade side
effect. Its first step opens every candidate SQLite vault in read-only mode and
shows an inventory, projected deduplication, warnings, and an estimated storage
cost. Local academic vaults are initially selected; teaching, creative, remote,
or unavailable vaults remain visible but are not silently included.

Each run is stored under `.nodus/migrations/` as a session plus an append-only
mutation journal. Checkpoints make cancellation and process interruption safe:
resuming replays the same idempotent identities, so an item or collection is not
created twice. Source vaults are never written. Their scans, summaries, notes,
ideas, passages, embeddings, existing Markdown, and files remain authoritative
and are represented by durable vault links.

Completion requires a verification pass across the catalog, manifests, declared
files, and vault links. Rollback removes only records and links created by that
session. A record edited after migration fails its optimistic revision check and
is retained as an explicit rollback conflict instead of being overwritten or
deleted. The historical `library:migrateVaults` IPC remains an adapter over the
same session engine for older clients.

## Import and organization

### Zotero

The Zotero dialog discovers personal and group libraries. Users can select
which libraries to import, whether to copy attachments, and whether to include
unfiled items. Collection hierarchy has no artificial depth limit.

The importer uses Zotero versions to retrieve only changes when possible. Its
progress bar reports connection, collections, catalog, attachments, rebuilding,
and completion. Each run is checkpointed under `.nodus/zotero-sync`; canceled
and failed sessions can be resumed from the import dialog without duplicating
documents or attachments. A partial run commits the valid libraries and returns
a structured report for unavailable libraries, credentials, rate limits, files,
and conflicts.

A Zotero deletion never becomes a Nodus deletion. The record is retained with a
`source-missing` state, including local files, notes, corrections, tags, Nodus
collection memberships, aliases, and vault links. A missing group library is
handled the same way at library scope. When the source reappears, its stable
identity reactivates the existing record.

Attachments are compared by SHA-256. An unchanged file reuses its immutable
copy; a changed primary file queues extraction and marks content-derived output
stale through the revision contract. A file not downloaded by Zotero retains
its previous readable copy with `not-downloaded` state. Imported collections
are a read-only mirror. They coexist with Nodus-owned collections, which can be
created, nested, moved, renamed, and deleted.

The Zotero plugin exposes three coordinated desktop actions: check clean-copy
status, import or refresh the library, and open the current document in the
clean reader. Desktop and plugin advertise a numeric protocol and capabilities.
Desktop v4 keeps plugin-v3 chat available and displays a non-blocking update
warning; plugin v4 keeps desktop-v3 chat available and omits unsupported Global
Library actions. The traditional monitored-collection flow and its IPC adapters
remain available. The Zotero original is never edited.

### Mendeley and other managers

The interoperable importer accepts RIS, BibTeX, and CSL JSON. Mendeley and other
managers can export one of these formats; Nodus imports the records, detects
duplicates, and lets users attach the corresponding files later. Nodus does not
need Mendeley credentials.

Users can also add PDF, EPUB, HTML/XML/JATS, Markdown, plain text, Word,
OpenDocument, PowerPoint, spreadsheets, and supported images directly. A
content hash prevents the same file from being imported twice. Formats that do
not have a safe internal renderer remain available through the operating
system's associated application; Nodus never converts that fallback into an
unsafe embedded browser document.

## Clean Markdown extraction

The pipeline runs in the background and always keeps the original separate. For
each document, it:

1. identifies the format and retrieves text and layout;
2. removes repeated header and footer noise and normalizes Unicode, whitespace,
   end-of-line hyphenation, and paragraph breaks;
3. preserves headings, lists, quotations, and tables as structured Markdown;
4. extracts figures and images into `assets/` and references them with relative
   paths;
5. applies local OCR to pages without a text layer when enabled;
6. uses remote OCR only when the user explicitly selects it and has configured
   a vision model;
7. writes `source-map.json` with page and coordinate mappings and
   `quality-report.json` with metrics and warnings;
8. publishes all derived files atomically and updates the item state.

An extraction is built in a private staging directory and is renamed to an
immutable fingerprinted directory only after its Markdown, map, report, and
assets have been flushed successfully. The manifest pointer changes last. A
failed or canceled replacement therefore leaves the last readable copy intact;
the reader labels that copy as previous instead of presenting it as current.

### Revisions and invalidation

Each manifest records independent SHA-256 provenance for extraction settings,
analytical bibliography, published clean content, embedding configuration, and
summary configuration. Organizational collection, order, and tag changes do
not affect analysis. Analytical title, abstract, or creator changes stale only
light analysis and summaries. A primary attachment or clean-content change
stales deep analysis, passages, ideas, embeddings, and summaries. Changing an
embedding model affects only embeddings; changing a summary model or prompt
affects only summaries.

The active writable vault receives these state changes in one transaction while
retaining the preceding rows and hashes. Closed, unavailable, or read-only
vaults receive explicit pending invalidations in the canonical manifest, which
are settled when the vault is next active. A derived result is marked
`current`, `stale`, `failed`, or another explicit freshness state and retains
the fingerprint and generation time needed to prove its source revision.

The quality report counts double spaces, decomposed Unicode, soft hyphens,
broken words, empty pages, blocks, figures, tables, and OCR pages. A doubtful
result is marked `needs-review`; it is never silently presented as perfect. An
interrupted job can resume, and a failed job can be retried.

## Reader

The reader opens from any Library row that has either clean Markdown or at least
one available attachment. A persistent source chooser in the top toolbar and a
matching **Versions and files** group in the left sidebar switch between the
clean `reader.md` copy and every preserved attachment. The last selection is
remembered per stable item identifier. The clean copy is not a layer placed
over the original. The source selector reserves a fixed icon gutter, and its
status badge, file list, annotation palette, and document surface use explicit
light and dark palettes so switching themes never leaves dark controls behind.

The internal viewers include:

- PDF rendering with a selectable text layer, page navigation, zoom, comments,
  and highlights scoped to the exact page;
- reflowable EPUB chapters with selectable text and chapter-scoped annotations;
- HTML, XML/JATS, Markdown, plain text, DOCX, RTF, ODT, PPTX/ODP, CSV/TSV,
  XLSX, and ODS as safe, selectable reading surfaces;
- supported images with normalized rectangular region highlights;
- an explicit **Open outside Nodus** fallback for legacy or unknown binaries.

The reader also includes:

- a traced section outline at the top of the left rail, independent of the
  selected source, with exact navigation back to clean Markdown;
- a compact, collapsible **Versions and files** control below the outline;
- structured figures and tables;
- a temporary view of the matching original page;
- independent opening of the complete original;
- icon-only previous/next controls in paged viewers;
- six highlight colors, comments, and one reading bookmark per section;
- one compact bookmark menu for marking the current section or returning to the
  saved bookmark;
- a collapsible right sidebar whose inactive tabs are icons and whose active
  `Info`, `Notes`, or `Chat` tab displays its label;
- persistent document chat stored beside the document and run through the same
  Nodi engine as the main Assistant. It combines the currently selected clean
  or attached source, annotations, and active-vault context; cites traced
  sections, pages, passages, works, ideas, authors, gaps, and contradictions;
  and safely falls back to the clean copy when a binary source cannot yield
  readable text;
- a compact model menu containing the user's featured chat models, with the
  selection shared with Nodi;
- an option to continue the same conversation in the main Assistant.

Saved selections include offsets, text, and surrounding context so they can be
re-anchored. Every annotation retains the document's stable identifier,
including when the item comes from Zotero.

When clean Markdown changes, Nodus scores the saved quote, prefix, suffix, and
relative position against the new copy. Recovered annotations receive the new
content fingerprint. Unrecoverable selections are not deleted: they appear in
the right sidebar's orphaned-annotation inbox and remain in the dedicated
recovery sidecar until the user reviews them.

Chat reuses the Nodi engine, active-vault retrieval, featured model settings,
and a bounded history window. Reader citations return to the exact traced
section or page; vault citations open the existing source modal. It does not
invent pages or quotations: the prompt requires it to distinguish available
content from inference. With a local model, the context stays on the device. A
remote provider receives only the text needed for the question when the user
asks it.

## Metadata and duplicates

The Nodus record supports title, type, creators, date, publication, publisher,
volume, issue, pages, edition, place, language, rights, URL, DOI, ISBN, ISSN,
PMID, PMCID, arXiv, abstract, tags, and lossless extra fields.

Identifier lookup uses:

- Crossref for DOI and ISSN;
- Open Library for ISBN;
- NCBI for PMID and PMCID;
- arXiv for arXiv identifiers.

Nodus shows candidates and a change preview; nothing is applied without review.
Corrections live in a Nodus-owned layer and survive future source-manager
refreshes. Duplicate detection uses DOI, ISBN, or a normalized bibliographic
record. Merging is explicit: it preserves collections, attachments, Markdown,
annotations, and chat in the chosen record and moves the others to recoverable
trash.

## Relationship with vaults

`Add to vault` creates an analyzable reference with the document's identity. It
does not copy the original or move `reader.md`. Vault extraction, search,
summaries, passages, and analysis resolve text from the Library. The operation
is idempotent, and the global record shows which vaults contain the reference
and the state of their analysis.

Connected read-only vaults reject this write. Deleting the working reference
inside a vault does not destroy the global copy.

### Exact cross-vault analysis reuse

Linking resolves a work through its canonical Library identity, permanent
aliases, Zotero library identity, and migrated `workId`. A title, DOI, author,
or year similarity is never enough to copy derived data.

Nodus evaluates light analysis, deep analysis, summaries, ideas, passages, and
embeddings independently. Automatic reuse requires all of the following for
that component:

- the same canonical Library item and exact content or bibliographic revision;
- the same pipeline version;
- the same provider, model, and applicable configuration;
- a complete provenance record produced by Nodus 4.

Older results without provenance remain readable in their original vault but
are reported as pending and are not copied. An incompatible component also
stays pending while compatible components can be reused in the same operation.
Each target-vault transaction is atomic and the multi-item operation can be
canceled between transactions.

The copy includes derived rows only. It never copies work notes, read flags,
manual deep-scan choices, archive state, pinned themes, or in-flight scan
checkpoints. Connected reader vaults and inactive replicas reject the operation.
The item inspector exposes a component-by-component state and the reason a
result is current, reused, pending, unavailable, or incompatible.

## Nodus-only bibliography management

The Global scope is a complete local reference manager even when Zotero is not
installed. A reference can be created before it has a file, duplicated as an
independent Nodus record, or copied out of an imported read-only mirror. The
source mirror remains intact so a later refresh cannot overwrite the Nodus copy.

The creation and metadata editors expose every current citeable Zotero item
type. Nodus stores `bookSection` as the clearer canonical `book-chapter` while
continuing to read the older `book-section` and `chapter` aliases. Preprints,
standards, datasets, broadcasts, legal records, software, and the complete
bibliographic set can be created without Zotero. Personal and institutional
creators are ordered, and all current Zotero creator roles remain distinct.
Source-specific primitive fields that do not have a common Nodus field are
preserved in `metadata.extra` and can also be edited manually.

Each record accepts multiple PDF, EPUB, office, text, HTML/XML/JATS, spreadsheet,
dataset, and image attachments. The item manager can add, open, reveal, rename,
reorder, classify, replace, remove, and select the primary attachment. A rename
or replacement publishes a new referenced copy; the old immutable blob is left
unreferenced for recovery and later safe trash collection. Changing the primary
attachment queues extraction and invalidates only its content-derived outputs.

Local notes are Markdown and editable. Imported Zotero child notes are converted
to readable Markdown but remain a read-only mirror. Item relations are written
to both records with the correct inverse (`cites`/`is-cited-by` and
`corrects`/`is-corrected-by`). Tags support bulk add/remove operations and a
library-wide color registry stored in `.nodus/tags.json`.

### Identifiers, citations, and file exchange

The Library toolbar includes a Zotero-style magic-add action. Pasting a DOI,
ISBN, ISSN, PMID, PMCID, or arXiv identifier detects its kind, retrieves the
best matching record, and creates it on Enter. The adjacent manual action first
selects any supported item type and then opens the complete metadata editor.
The metadata editor resolves DOI and ISSN through Crossref, ISBN through Open
Library, PMID and PMCID through the public NCBI services, and arXiv identifiers
through the arXiv Atom API. Every individual lookup produces a field-by-field
preview. Bulk lookup is sequential and rate-limited, can be canceled, retains a
partial result report, and still requires explicit confirmation before writing
any candidate to a manifest.

Every live record has a stable, editable, collision-free citation key. Nodus
formats in-text citations and bibliography entries locally with citeproc-js and
standard Citation Style Language files. APA 7, Chicago author-date, MLA 9, IEEE,
and Vancouver ship in the local style data; any other style can be cached from
the Zotero Style Repository. Once a style and any independent parent are
installed, formatting is deterministic and requires no network connection.

The style manager can install a repository style by identifier or URL, import a
local `.csl`, or copy the complete set of custom styles from the user's Zotero
profile. Dependent institutional styles automatically resolve and cache their
independent parent. Original CSL XML, embedded authors/contributors, rights,
license, and update metadata are preserved. Unlicensed private styles remain
only in the user's `nodus-library` and are never redistributed by Nodus.

Official CSL styles are CC BY-SA 3.0 and require attribution to the
[Citation Style Language project](https://citationstyles.org/). citeproc-js is
used under its GNU AGPL v3 option. These terms are compatible with Nodus 4's
AGPL distribution; full details are recorded in `THIRD_PARTY_NOTICES.md`.

RIS, BibTeX, BibLaTeX, CSL-JSON, EndNote XML, Zotero RDF, CSV, and Markdown can
be imported and exported. Unknown source fields are stored in `metadata.extra`
and emitted again by the corresponding exporter. Export can target the current
selection, a collection, or a live smart search; sorting and citation keys make
the generated file deterministic.

## Editable collections and live smart searches

Nodus collections can be nested, reordered, and moved with drag and drop.
Dropping a collection on another collection nests it directly; dropping it on
the Library root moves it back to the top level. Every local collection and
subcollection also exposes compact rename, move, and delete controls. The move
dialog presents the complete hierarchy, disables the current subtree to prevent
cycles, and makes the destination explicit. Deleting a collection removes only
that grouping and its nested groupings: items, attachments, notes, annotations,
and analyses remain in the Library. Dropping one or more document rows copies
their memberships without changing their files or analysis. The bulk bar also
exposes explicit copy, move, and remove operations.
Imported Zotero collection nodes and their mirrored memberships are locked;
local organization belongs in Nodus collections and survives source refreshes.

Saved searches are declarative records in `.nodus/saved-searches.json`. Their
recursive rule tree supports `all`, `any`, and `not` groups over metadata,
creators, tags, dates, source, item type, collections, attachments, extraction,
trash state, vault links, and per-component analysis freshness. Results and
counts are evaluated against the current SQLite cache and are never materialized
as item copies. Deleting a saved search therefore cannot delete an item.

The result page returns live source, type, extraction, attachment, year, tag,
and vault facets. Its Zotero-style column chooser covers title, creators, item
type, publication, publisher, date, year, edition, volume, issue, pages, every
supported identifier, language, citation key, tags, source, analysis state,
attachments, and created/modified dates. Columns can be shown, hidden,
drag-reordered, moved accessibly with buttons, and assigned a custom width.
The exact order, widths, and up to three stable sort keys are stored in
`.nodus/view-preferences.json`. These two small JSON files are source data in
`nodus-library`; rebuilding the SQLite catalog does not discard them.

## Backup, synchronization, and recovery

`nodus-library` is part of the selected backup folder. If another service
synchronizes that folder, it synchronizes manifests, originals, and sidecars,
but not the local SQLite catalog. Every item or collection change creates an
immutable record with a clock, revision, device, and hash. Divergent offline
edits are preserved; Nodus selects one deterministically and leaves the other
in `.nodus/conflicts/` for review.

Nodus 4 encrypted full-state backups include the canonical Library as well as
every vault database, preference sidecar, history, attachment, clean Markdown
file, annotation, note, chat, and immutable record. The disposable
`library/catalog.sqlite` cache is not included. Pre-v4 and pre-restore recovery
trees are also excluded from ordinary archives because each is already a full
copy and embedding one copy inside the next would multiply storage recursively.
Every included file is authenticated by the encrypted payload manifest before
restore. The Library is rebuilt in a sibling staging directory and swapped only
after all paths and hashes validate.

### Updating from Nodus 3.2.7

The first Nodus 4 launch creates a one-time recovery copy before opening SQLite
or publishing a format-v2 Library manifest. With a backup folder configured it
lives under `nodus-library/.nodus/recovery/pre-v4/`; otherwise it lives under
the local Nodus profile at `recovery/pre-v4/`. The copy contains a consistent
SQLite snapshot of every registered vault, its schema number, profile and vault
sidecars, and every existing canonical Library file. Symbolic links are recorded
but never followed. Every file is hashed and each database must pass SQLite
`quick_check` before the completion marker is written.

An interrupted copy, a full disk, a corrupt database, or a permission failure
therefore stops before migration and leaves the 3.x profile untouched. The next
launch retries from the beginning. Once the verified marker exists, later v4
launches reuse it instead of duplicating the snapshot. Recovery validates every
hash before replacing any file and restores database files through recoverable
sibling swaps while the databases are closed.

Nodus 4 accepts all released Nodus 3 encrypted backup formats and migrates an
older database only after validating its archive and inventory. Restoring a 3.x
archive that has no Global Library leaves an existing `nodus-library` untouched.
Data that Nodus 4 has already migrated or newly created may not open in a Nodus
3 application. Use the retained pre-v4 recovery copy when an actual return to
3.2.7 is required rather than pointing Nodus 3 at a v4 profile.

The optional Global Library migration is separate from the application upgrade.
Its assistant can still be cancelled, resumed, verified, or rolled back. That
rollback removes only the records and links created by its own session and
preserves anything edited afterward as a conflict.

To recover the Library:

1. preserve an unchanged copy of the affected folder;
2. restore the complete backup folder, including `nodus-library`;
3. select that folder in Nodus Settings;
4. open Library; changing the root invalidates the cache and rebuilds the
   catalog from manifests;
5. check the invalid-record and conflict counters;
6. open a sample of originals, Markdown files, figures, annotations, and chats;
7. retry only extractions marked for review or reported as failed.

Moving an item to trash only hides it and preserves its files. The Trash view can
restore individual or bulk selections and shows an exact impact preview before
manual emptying: attachments and bytes, annotations, orphaned annotations,
reader chats, local notes, aliases, relations, and linked vault works. An active
vault link blocks emptying. Nodus never cascades that action into a vault or its
analysis tables.

Manual emptying removes the selected record from the active manifests and
catalogue, but moves its item folder and immutable record history to a dated
`.nodus/recovery/purged/` package. This makes the operation recoverable and keeps
it separate from normal search and rebuild. Apply the organization's retention
policy before deleting those recovery packages from the backup itself.

Duplicate merging has a separate impact preview. It copies unique attachments,
clean Markdown and assets, annotations, orphaned annotations, chat messages,
local notes, metadata, collections, identities, aliases, and relations into the
chosen canonical record. Inbound relations and catalogue vault links are
remapped to the permanent canonical alias. Nodus does not merge or delete the
corresponding works inside a vault; those remain available until a user performs
an explicit vault reconciliation.

The Review and recovery panel checks attachment existence and SHA-256 hashes,
missing clean Markdown, invalid records, offline conflicts, orphan folders,
saved-search JSON, and the durable vault-link manifest. Vault links are stored in
`.nodus/vault-links.json`, while smart searches remain in
`.nodus/saved-searches.json`; both survive deletion and reconstruction of the
local SQLite cache.

## Privacy, network access, and licenses

- Cataloging, reading, annotation, local OCR, and rebuilding run on the device.
- Zotero is accessed locally or through an API already authorized by the user,
  always in read-only mode.
- Crossref, Open Library, NCBI, and arXiv receive only the identifier selected
  for metadata resolution. Bulk resolution is never started implicitly.
- Remote OCR and chat contact the selected AI provider only when the user runs
  the corresponding action.
- Linking a Library item to a vault does not publish originals or derived files
  to Nodus Server.
- This implementation adds no Firecrawl, Anydoc, or other extraction
  dependency. It reuses the pipeline already included in Nodus and introduces
  no tool with an incompatible license.

The backup folder may contain copyrighted documents or personal data. Protect
it with appropriate permissions, disk encryption, and the organization's backup
policy.

## Tests and maintenance

The main tests are:

- `test-library-storage.mjs`: manifests, conflicts, and rebuilding;
- `test-library-migration.mjs`: lossless migration from vaults;
- `test-zotero-library-import.mjs`: differential import and attachments;
- `test-zotero-isolated-copy.mjs`: a read-only filesystem snapshot of an
  available real Zotero database, SQLite integrity, real item-type mapping,
  collection hierarchy, and an import into temporary Nodus storage only;
- `test-library-extraction.mjs`: Markdown, assets, OCR, quality, and queue;
- `test-global-library-operations.mjs`: collections, import, and trash;
- `test-library-item-management.mjs`: Nodus-only records, creators, attachments,
  notes, symmetric relations, and colored tags;
- `test-library-smart-collections.mjs`: cycle-safe movement, reversible item
  memberships, nested live rules, facets, and persisted table preferences;
- `test-library-metadata.mjs`: six identifier kinds, cancelable bulk lookup,
  all Zotero record types, eight import/export formats, five local citation
  styles, keys, and duplicates. `verify-library-metadata-live.mjs` is the
  explicit network smoke test for live DOI and ISBN recovery;
- `test-library-recovery.mjs`: trash impact, linked-vault purge blocking,
  recoverable emptying, lossless duplicate merges, checksum audits, and rebuilds;
- `test-pre-v4-recovery.mjs`: first-launch snapshot, disk-full interruption,
  idempotence, hashes, SQLite verification, and restoration;
- `test-library-scale.mjs`: hot catalogue queries with 50,000 items and 10,000
  collections, each held below one second in CI;
- `test-backup-vaults.mjs`: complete encrypted vault and Global Library backup,
  staging, recovery rollback, and older-schema compatibility;
- `test-global-library-reader.mjs`: reader, pages, annotations, and chat;
- `test-global-library-vault-integration.mjs`: vault linking and analysis;
- `test-vaults.mjs`: exact component reuse, cancellation, aliases, and private-state isolation;
- `test-global-library-hardening.mjs`: path containment and private sidecars;
- `e2e-global-library.mjs` and `e2e-library-reader.mjs`: the real Electron UI.

The delivery matrix is in
[global-library-acceptance.md](global-library-acceptance.md).
