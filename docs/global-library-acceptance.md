# Cross-vault Library acceptance

This matrix tracks the complete Nodus 4 Library. `Verified` means the behavior is
executed by a mechanical or end-to-end test; it does not merely mean that a
button exists.

| Area | Criterion | Status | Primary evidence |
|---|---|---|---|
| Compatibility | A v3 profile opens the complete This-vault corpus by default | Verified | `test-library-scope-compatibility`, `e2e-global-library` |
| Compatibility | Global activation is optional and the last scope is shared across vaults | Verified | `test-library-scope-compatibility`, `e2e-global-library` |
| Compatibility | Health cards enter the exact traditional filter | Verified | `test-library-scope-compatibility`, `test-search-health` |
| Compatibility | Legacy corpus and Zotero-collection IPC remains wired | Verified | `test-library-scope-compatibility`, `test-ipc-contract` |
| Compatibility | Zotero reader links enter Global without changing ordinary defaults | Verified | `test-library-scope-compatibility` |
| Compatibility | Desktop v4 keeps Server 3.2.7 operation sizes when capability fields are absent | Verified | `test-v4-release-readiness`, server sync suite |
| Compatibility | Plugin v4 hides Global-only actions with desktop v3, while desktop v4 keeps plugin-v3 chat and warns non-blockingly | Verified | `test-v4-release-readiness`, `test-global-library-ui`, Zotero plugin suite |
| Storage | `nodus-library` is created inside the backup folder | Verified | `test-library-storage`, `e2e-global-library` |
| Storage | Originals and derived files share a folder and stable identity | Verified | `test-library-storage`, `test-global-library-reader` |
| Storage | The SQLite catalog is excluded from backups and can be rebuilt | Verified | `test-library-storage` |
| Storage | Invalid records are counted and excluded | Verified | `test-library-storage` |
| Upgrade | The first v4 launch verifies a pre-v4 copy before any database migration or manifest-v2 write | Verified | `test-pre-v4-recovery`, `test-v4-release-readiness` |
| Upgrade | Disk-full, permission, corruption, and interruption paths never create a trusted checkpoint or modify 3.x data | Verified | `test-pre-v4-recovery`, backup fault injection |
| Upgrade | Nodus 4 opens released 3.x backup formats and documents that migrated v4 data may not open in 3.x | Verified | `test-backup-vaults`, `test-v4-release-readiness` |
| Identity | v1 manifests read safely and publish as v2 without folder renames | Verified | `test-library-identity-v2` |
| Identity | Nodus IDs are independent from exact manager identities | Verified | `test-library-identity-v2`, `test-zotero-library-import` |
| Identity | Equal Zotero keys in different libraries do not collide | Verified | `test-library-identity-v2` |
| Identity | Former and merged IDs remain permanent aliases after a cache rebuild | Verified | `test-library-identity-v2`, `test-library-metadata` |
| Identity | Unicode, dot segments, and reserved cross-platform paths are encoded safely | Verified | `test-library-identity-v2`, `test-global-library-hardening` |
| Synchronization | Divergent edits are preserved and exposed as conflicts | Verified | `test-library-storage` |
| Security | Identifiers and paths cannot escape the Library | Verified | `test-global-library-hardening` |
| Security | External symbolic links are neither read nor written | Verified | `test-global-library-hardening` |
| Security | New sidecars are written atomically and privately | Verified | `test-global-library-hardening` |
| Migration | Two vaults migrate without duplicating the same Zotero item | Verified | `test-library-migration` |
| Migration | Existing Markdown and originals are not overwritten | Verified | `test-library-migration` |
| Migration | Nodus-only works retain their original per-vault `workId` | Verified | `test-library-migration` |
| Migration | Preview is read-only, estimates space and initially selects local academic vaults | Verified | `test-library-migration-sessions`, `e2e-global-library` |
| Migration | Cancellation persists a recoverable checkpoint and resume remains idempotent | Verified | `test-library-migration-sessions` |
| Migration | Completion verifies catalog, manifests, files and links | Verified | `test-library-migration-sessions`, `e2e-global-library` |
| Migration | Rollback removes only session-created state and retains later edits as conflicts | Verified | `test-library-migration-sessions` |
| Zotero | Personal and group libraries are discovered | Verified | `test-zotero-library-import` |
| Zotero | Keys, hierarchy, and membership retain unlimited depth | Verified | `test-zotero-library-import`, `test-global-library-ui` |
| Zotero | Version-based refresh resumes and does not duplicate attachments | Verified | `test-zotero-library-import` |
| Zotero | Cancellation preserves retrieved progress | Verified | `test-zotero-library-import` |
| Zotero | Deleted items and libraries become source-missing without deleting Nodus content | Verified | `test-zotero-library-import` |
| Zotero | Local metadata, collections, tags, notes, and attachments survive every refresh | Verified | `test-zotero-library-import`, `test-library-item-management` |
| Zotero | Attachment hashes reuse unchanged files and invalidate content derivatives after primary-file changes | Verified | `test-zotero-library-import`, `test-library-revisions` |
| Zotero | Interrupted and partial sessions persist reports and can resume from the import dialog | Verified | `test-zotero-library-import`, `test-global-library-ui` |
| Zotero | A real local library is validated only through an integrity-checked temporary SQLite copy; the source database and original vault are never opened for writes | Verified | `test-zotero-isolated-copy` |
| Plugin | Status, import, and reader opening reach the desktop | Verified | `test-global-library-ui`, Zotero plugin suite |
| Plugin | Protocol capabilities let v4 desktop/plugin degrade non-blockingly with their v3 counterpart | Verified | `test-global-library-ui`, Zotero plugin suite |
| Interoperability | RIS, BibTeX/BibLaTeX, CSL-JSON, EndNote XML, Zotero RDF, CSV, and Markdown import and export | Verified | `test-library-metadata`, `test-global-library-ui` |
| Interoperability | Unknown fields survive same-format import, editing, and export through `metadata.extra` | Verified | `test-library-metadata` |
| Citations | Citation keys are stable, editable, and collision-free | Verified | `test-library-metadata` |
| Citations | APA 7, Chicago author-date, MLA 9, IEEE, and Vancouver render offline; repository, local-file, dependent-parent, and Zotero-profile styles preserve their metadata | Verified | `test-global-library-reader`, `test-global-library-ui`, `e2e-library-reader`, `e2e-global-library` |
| Citations | Selection, collection, and smart-search exports use the same typed export contract | Verified | `test-global-library-ui`, `e2e-global-library` |
| Interoperability | Repeated local files are detected by hash | Verified | `test-global-library-operations` |
| Organization | Collections and subcollections support arbitrary depth | Verified | `test-global-library-operations`, `test-global-library-ui` |
| Organization | Zotero collections are mirrored and Nodus collections are editable | Verified | `test-global-library-operations` |
| Organization | Search, filters, pagination, and bulk actions work | Verified | `test-global-library-ui`, `e2e-global-library` |
| Organization | Drag-and-drop moves and reorders Nodus collections while rejecting cycles and imported collection edits | Verified | `test-library-smart-collections`, `e2e-global-library` |
| Organization | Individual and bulk membership copy, move, and removal do not invalidate analysis | Verified | `test-library-smart-collections` |
| Smart searches | Nested all/any/not rules cover metadata, authors, tags, dates, sources, attachments, extraction, trash, vaults, and analysis | Verified | `test-library-smart-collections`, `test-global-library-ui` |
| Smart searches | Results and counts are live and never materialize duplicate item records | Verified | `test-library-smart-collections` |
| Catalogue view | Zotero-style bibliography columns can be shown, hidden, drag-reordered, keyboard/button-reordered, resized, and multi-sorted, with the complete view persisting across restart | Verified | `test-library-smart-collections`, `e2e-global-library` |
| Item management | Empty references, independent duplicates, and Nodus copies work without Zotero | Verified | `test-library-item-management`, `test-global-library-ui` |
| Item management | All 37 current citeable Zotero types, including canonical `book-chapter`, and ordered personal or institutional creator roles round-trip | Verified | `test-library-item-management`, `test-library-metadata`, `test-zotero-isolated-copy` |
| Item management | Magic add auto-detects DOI, ISBN, ISSN, PMID, PMCID, and arXiv; manual creation exposes the complete type and metadata flow | Verified | `test-library-metadata`, `verify-library-metadata-live`, `e2e-global-library` |
| Attachments | Multiple supported files can be added, opened, revealed, renamed, reordered, classified, replaced, and removed | Verified | `test-library-item-management`, `e2e-global-library` |
| Attachments | Selecting or replacing the primary file drives revision invalidation and extraction | Verified | `test-library-item-management`, `test-library-revisions` |
| Notes | Local Markdown notes are editable and Zotero notes remain read-only | Verified | `test-library-item-management`, `test-zotero-library-import` |
| Relations | Item relations are symmetric and inverse relation types remain consistent | Verified | `test-library-item-management` |
| Tags | Colored tags and bulk add/remove remain user-owned | Verified | `test-library-item-management`, `test-global-library-ui` |
| Extraction | Text-based PDFs produce normalized Markdown | Verified | `test-library-extraction` |
| Extraction | Text contains no double spaces or avoidable broken words | Verified | `test-library-extraction`, phase 0 prototypes |
| Extraction | Figures are extracted and tables retain structure | Verified | `test-library-extraction`, `e2e-library-reader` |
| Extraction | The map links blocks to pages and coordinates | Verified | `test-library-extraction`, `test-global-library-reader` |
| Extraction | Local OCR covers pages without a text layer | Verified | `test-library-extraction` |
| Extraction | Remote OCR requires an explicitly selected model | Verified | `test-library-extraction`, service contract |
| Extraction | The queue resumes, cancels, retries, and publishes progress | Verified | `test-library-extraction`, `test-global-library-ui` |
| Quality | The report measures Unicode, whitespace, hyphens, empty pages, and assets | Verified | `test-library-extraction` |
| Revisions | Independent bibliographic, extraction, content, embedding, and summary fingerprints drive narrow invalidation | Verified | `test-library-revisions` |
| Revisions | Organizational changes leave analysis current while content changes stale every content derivative | Verified | `test-library-revisions` |
| Revisions | Replacement extraction is staged atomically and a failure retains the last readable copy | Verified | `test-library-extraction` |
| Revisions | Active vault invalidation retains prior results and closed vaults receive durable pending work | Verified | `test-library-revisions`, vault integration suite |
| Reader | Markdown, images, and tables render | Verified | `e2e-library-reader` |
| Reader | The source chooser switches between clean Markdown and every preserved attachment and remembers the selection per item | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | PDF, EPUB, HTML/text, DOCX/OpenDocument/PowerPoint, spreadsheets, and images have safe internal viewers; legacy binaries expose an explicit external fallback | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | Text-bearing viewers support scoped highlights/comments and images support durable normalized region highlights | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | A temporary page and the complete original open separately | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | Highlights, comments, and bookmarks persist | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | Both sidebars can be independently shown and hidden | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | The traced outline stays above a collapsible file chooser for every selected source | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | Dark and light clean-reading surfaces follow the application theme | Verified | `e2e-library-reader` |
| Reader | Paged viewers use balanced icon-only navigation controls | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | The right rail and chat composer remain reachable after resizing and notifications never cover them | Verified | `e2e-library-reader` |
| Reader | The bookmark icon exposes marking and return actions | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | Inactive document tabs are icons and the active tab shows its label | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | Annotations reanchor to the exact content fingerprint or remain in an orphan inbox | Verified | `test-library-revisions`, `e2e-library-reader` |
| Reader | The Info tab exposes clean-content and extraction provenance | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Chat | The shared engine and model receive document context | Verified | `test-global-library-ui`, `test-global-library-reader` |
| Chat | The reader uses Nodi's active-vault retrieval and opens stable reader and vault citations | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Chat | The reader model menu exposes the configured featured models and persists the Nodi selection | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Chat | History persists beside the document and can be cleared | Verified | `test-global-library-reader` |
| Metadata | Local edits survive future source refreshes | Verified | `test-library-metadata`, `e2e-global-library` |
| Metadata | DOI/ISSN use Crossref, ISBN uses Open Library, PMID/PMCID use NCBI, and arXiv uses its Atom API | Verified | `test-library-metadata` |
| Metadata | Candidates require review before being applied | Verified | `test-global-library-ui`, `e2e-global-library` |
| Metadata | Bulk resolution is rate-limited, cancelable, partial-result safe, and requires a second confirmation | Verified | `test-library-metadata`, `test-global-library-ui`, `e2e-global-library` |
| Duplicates | Explicit detection and merging preserve derived files | Verified | `test-library-metadata`, `test-global-library-ui` |
| Trash | A dedicated view restores individual or bulk records and manual emptying requires an impact preview | Verified | `test-library-recovery`, `test-global-library-ui`, `e2e-global-library` |
| Trash | Active vault links block emptying and vault analyses are never cascade-deleted | Verified | `test-library-recovery` |
| Trash | Emptying archives a recoverable package outside the active catalogue instead of destroying the only copy | Verified | `test-library-recovery` |
| Duplicates | Merge impact covers attachments, annotations, chats, notes, aliases, relations, and vault works | Verified | `test-library-recovery`, `test-global-library-ui` |
| Duplicates | Aliases and inbound relations remap to the canonical record while vault works remain separate | Verified | `test-library-recovery` |
| Recovery | Attachment hashes, missing files, invalid records, conflicts, and orphan folders are auditable | Verified | `test-library-recovery`, `test-global-library-ui` |
| Recovery | Catalogue, aliases, searches, and vault links rebuild from `nodus-library` without SQLite | Verified | `test-library-recovery`, `test-library-storage` |
| Recovery | Full-state encrypted backups include originals, Markdown, sidecars, records, and the Global Library and restore it through staging | Verified | `test-backup-vaults`, `test-v4-release-readiness` |
| Performance | Hot queries over 50,000 items and 10,000 collections remain below one second in CI | Verified | `test-library-scale` |
| Vaults | Linking is idempotent and does not duplicate the original | Verified | `test-global-library-vault-integration` |
| Vaults | Analysis resolves the global clean Markdown | Verified | `test-global-library-vault-integration` |
| Vaults | A connected read-only vault rejects writes | Verified | `test-global-library-vault-integration` |
| Reuse | Canonical identities and permanent aliases resolve existing references without approximate metadata matching | Verified | `test-vaults`, `test-global-library-vault-integration` |
| Reuse | Light, deep, summary, ideas, passages, and embeddings require exact document, pipeline, and model provenance independently | Verified | `test-vaults`, `test-global-library-vault-integration` |
| Reuse | Incompatible components stay pending while exact components avoid duplicate work | Verified | `test-global-library-vault-integration` |
| Reuse | Per-work copies are atomic and cancellation cannot leave partial rows | Verified | `test-vaults` |
| Reuse | Private notes, manual flags, pinned state, and scan checkpoints are not copied | Verified | `test-vaults`, `test-global-library-vault-integration` |
| Reuse | Every linked vault exposes component state and cause | Verified | `test-global-library-ui`, `e2e-global-library` |
| Navigation | Library is cross-vault and available in every sidebar | Verified | `test-global-library-ui` |
| Accessibility | Primary controls have roles, labels, and keyboard navigation | Verified | UI and i18n coverage, Electron E2E |
| Languages | Every UI string is covered in all eight interface languages | Verified | `test-i18n-coverage` |
| Privacy | Network, AI, backups, and sidecars are documented | Verified | `PRIVACY.md`, `global-library.md` |
| Licenses | Nodus 4 is AGPL-3.0-only, every distribution offers exact source, and no external extraction engine was added | Verified | `test-agpl-release`, `release:verify-source`, license verification |

## Final gate

The phase is accepted only when the following commands pass on a clean worktree
apart from unrelated fixtures:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run licenses:verify
npm run privacy:verify
npm run test:e2e:global-library
npm run test:e2e:library-reader
npm run test:e2e
npm run zotero:xpi
```

Both E2E tests launch the real Electron application, save screenshots, and fail
on unhandled renderer errors.
