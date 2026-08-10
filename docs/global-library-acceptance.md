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
| Storage | `nodus-library` is created inside the backup folder | Verified | `test-library-storage`, `e2e-global-library` |
| Storage | Originals and derived files share a folder and stable identity | Verified | `test-library-storage`, `test-global-library-reader` |
| Storage | The SQLite catalog is excluded from backups and can be rebuilt | Verified | `test-library-storage` |
| Storage | Invalid records are counted and excluded | Verified | `test-library-storage` |
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
| Plugin | Status, import, and reader opening reach the desktop | Verified | `test-global-library-ui`, Zotero plugin suite |
| Interoperability | RIS, BibTeX, and CSL JSON are imported | Verified | `test-library-metadata` |
| Interoperability | Repeated local files are detected by hash | Verified | `test-global-library-operations` |
| Organization | Collections and subcollections support arbitrary depth | Verified | `test-global-library-operations`, `test-global-library-ui` |
| Organization | Zotero collections are mirrored and Nodus collections are editable | Verified | `test-global-library-operations` |
| Organization | Search, filters, pagination, and bulk actions work | Verified | `test-global-library-ui`, `e2e-global-library` |
| Extraction | Text-based PDFs produce normalized Markdown | Verified | `test-library-extraction` |
| Extraction | Text contains no double spaces or avoidable broken words | Verified | `test-library-extraction`, phase 0 prototypes |
| Extraction | Figures are extracted and tables retain structure | Verified | `test-library-extraction`, `e2e-library-reader` |
| Extraction | The map links blocks to pages and coordinates | Verified | `test-library-extraction`, `test-global-library-reader` |
| Extraction | Local OCR covers pages without a text layer | Verified | `test-library-extraction` |
| Extraction | Remote OCR requires an explicitly selected model | Verified | `test-library-extraction`, service contract |
| Extraction | The queue resumes, cancels, retries, and publishes progress | Verified | `test-library-extraction`, `test-global-library-ui` |
| Quality | The report measures Unicode, whitespace, hyphens, empty pages, and assets | Verified | `test-library-extraction` |
| Reader | Markdown, images, and tables render | Verified | `e2e-library-reader` |
| Reader | A temporary page and the complete original open separately | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | Highlights, comments, and bookmarks persist | Verified | `test-global-library-reader`, `e2e-library-reader` |
| Reader | Both sidebars can be independently shown and hidden | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | The bookmark icon exposes marking and return actions | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Reader | Inactive document tabs are icons and the active tab shows its label | Verified | `test-global-library-ui`, `e2e-library-reader` |
| Chat | The shared engine and model receive document context | Verified | `test-global-library-ui`, `test-global-library-reader` |
| Chat | History persists beside the document and can be cleared | Verified | `test-global-library-reader` |
| Metadata | Local edits survive future source refreshes | Verified | `test-library-metadata`, `e2e-global-library` |
| Metadata | DOI/ISSN use Crossref and ISBN uses Open Library | Verified | `test-library-metadata` |
| Metadata | Candidates require review before being applied | Verified | `test-global-library-ui`, `e2e-global-library` |
| Duplicates | Explicit detection and merging preserve derived files | Verified | `test-library-metadata`, `test-global-library-ui` |
| Vaults | Linking is idempotent and does not duplicate the original | Verified | `test-global-library-vault-integration` |
| Vaults | Analysis resolves the global clean Markdown | Verified | `test-global-library-vault-integration` |
| Vaults | A connected read-only vault rejects writes | Verified | `test-global-library-vault-integration` |
| Navigation | Library is cross-vault and available in every sidebar | Verified | `test-global-library-ui` |
| Accessibility | Primary controls have roles, labels, and keyboard navigation | Verified | UI and i18n coverage, Electron E2E |
| Languages | Every UI string is covered in all eight interface languages | Verified | `test-i18n-coverage` |
| Privacy | Network, AI, backups, and sidecars are documented | Verified | `PRIVACY.md`, `global-library.md` |
| Licenses | No external extraction engine was added | Verified | lockfile unchanged; architecture documentation |

## Final gate

The phase is accepted only when the following commands pass on a clean worktree
apart from unrelated fixtures:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:global-library
npm run test:e2e:library-reader
```

Both E2E tests launch the real Electron application, save screenshots, and fail
on unhandled renderer errors.
