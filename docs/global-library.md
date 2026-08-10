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
    │   ├── chat.json
    │   ├── attachments/
    │   └── assets/
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

## Import and organization

### Zotero

The Zotero dialog discovers personal and group libraries. Users can select
which libraries to import, whether to copy attachments, and whether to include
unfiled items. Collection hierarchy has no artificial depth limit.

The importer uses Zotero versions to retrieve only changes when possible. Its
progress bar reports connection, collections, catalog, attachments, rebuilding,
and completion. Canceling preserves everything already retrieved; resuming does
not duplicate documents or attachments. Imported collections are a read-only
mirror. They can coexist with Nodus-owned collections, which can be created,
nested, moved, renamed, and deleted.

The Zotero plugin exposes three coordinated desktop actions: check clean-copy
status, import or refresh the library, and open the current document in the
clean reader. The Zotero original is never edited.

### Mendeley and other managers

The interoperable importer accepts RIS, BibTeX, and CSL JSON. Mendeley and other
managers can export one of these formats; Nodus imports the records, detects
duplicates, and lets users attach the corresponding files later. Nodus does not
need Mendeley credentials.

Users can also add PDF, EPUB, HTML, Markdown, plain text, and supported images
directly. A content hash prevents the same file from being imported twice.

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

The quality report counts double spaces, decomposed Unicode, soft hyphens,
broken words, empty pages, blocks, figures, tables, and OCR pages. A doubtful
result is marked `needs-review`; it is never silently presented as perfect. An
interrupted job can resume, and a failed job can be retried.

## Reader

The reader renders `reader.md`; it is not a layer placed over the PDF. It
includes:

- a collapsible section outline with exact navigation;
- structured figures and tables;
- a temporary view of the matching original page;
- independent opening of the complete original;
- six highlight colors, comments, and one reading bookmark per section;
- one compact bookmark menu for marking the current section or returning to the
  saved bookmark;
- a collapsible right sidebar whose inactive tabs are icons and whose active
  `Info`, `Notes`, or `Chat` tab displays its label;
- persistent document chat stored beside the document;
- an option to continue the same conversation in the main Assistant.

Saved selections include offsets, text, and surrounding context so they can be
re-anchored. Every annotation retains the document's stable identifier,
including when the item comes from Zotero.

Chat reuses the Nodus AI engine and model settings. It receives the clean
Markdown, annotations, and a bounded history window. It does not invent pages
or quotations: the prompt requires it to distinguish available content from
inference. With a local model, the context stays on the device. A remote provider
receives only the text needed for the question when the user asks it.

## Metadata and duplicates

The Nodus record supports title, type, creators, date, publication, publisher,
volume, issue, pages, edition, place, language, rights, URL, DOI, ISBN, ISSN,
abstract, and tags.

Identifier lookup uses:

- Crossref for DOI and ISSN;
- Open Library for ISBN.

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

## Backup, synchronization, and recovery

`nodus-library` is part of the selected backup folder. If another service
synchronizes that folder, it synchronizes manifests, originals, and sidecars,
but not the local SQLite catalog. Every item or collection change creates an
immutable record with a clock, revision, device, and hash. Divergent offline
edits are preserved; Nodus selects one deterministically and leaves the other
in `.nodus/conflicts/` for review.

To recover the Library:

1. preserve an unchanged copy of the affected folder;
2. restore the complete backup folder, including `nodus-library`;
3. select that folder in Nodus Settings;
4. open Library; changing the root invalidates the cache and rebuilds the
   catalog from manifests;
5. check the invalid-record and conflict counters;
6. open a sample of originals, Markdown files, figures, annotations, and chats;
7. retry only extractions marked for review or reported as failed.

Moving an item to trash only hides it and preserves its files. Physical deletion
of a backup must happen outside Nodus and only after checking the applicable
retention policy.

## Privacy, network access, and licenses

- Cataloging, reading, annotation, local OCR, and rebuilding run on the device.
- Zotero is accessed locally or through an API already authorized by the user,
  always in read-only mode.
- Crossref and Open Library receive only the requested identifier.
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
- `test-library-extraction.mjs`: Markdown, assets, OCR, quality, and queue;
- `test-global-library-operations.mjs`: collections, import, and trash;
- `test-library-metadata.mjs`: identifiers, formats, and duplicates;
- `test-global-library-reader.mjs`: reader, pages, annotations, and chat;
- `test-global-library-vault-integration.mjs`: vault linking and analysis;
- `test-global-library-hardening.mjs`: path containment and private sidecars;
- `e2e-global-library.mjs` and `e2e-library-reader.mjs`: the real Electron UI.

The delivery matrix is in
[global-library-acceptance.md](global-library-acceptance.md).
