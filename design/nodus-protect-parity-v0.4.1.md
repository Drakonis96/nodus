# Nodus Protect — parity matrix with IDprotector v0.4.1

Matrix version: **1.0.0 · 2026-07-19**

Original reference: **IDprotector v0.4.1**, commit `9f523158de3d597bdfe6bf35a6319c5f45c5c70c`

License: MIT; full attribution in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

This array is the port output contract. `A-*` identifies an automated check and `M-*` a reproducible
manual scenario. A row can only be considered covered when implementation and evidence exist;
`TODO`, `skip` or rows without scenario are not allowed.

## Executable evidence

- `A-ENG`: `node scripts/test-protect-engine.mjs` — fixed IDPS vectors, cross-test against original
  JavaScript, geometry and gold patterns.
- `A-DB`: `node scripts/test-protect-persistence.mjs` — migration v90, CRUD, SHA-256 and headstones
  without BLOB. The table initially planned for v88 was moved because `main` already reserved
  v88–v89 for the tightening of synchronization.
- `A-SYNC`: `node scripts/test-sync-package.mjs` — export/mixture `.nodussync`, newest-wins and
  logical deletion.
- `A-I18N`: `node scripts/test-i18n-coverage.mjs` — same exact set of keys in seven languages and
  without visible fallback.
- `A-UI`: `node scripts/test-toolkit-ui.mjs` and `node scripts/e2e-smoke.mjs` — Electron hub,
  navigation, states and smoke.
- `A-IPC`: `node scripts/test-protect-ipc.mjs` — references, formats, MIME/signature, artifacts and
  unauthorized paths.
- `A-BUILD`: `npm run typecheck && npm run build`.

## Integration and session cycle

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| UI-01 | Hub 2×2 with Convert and Protect in development, Presenter and upcoming OCR | `ToolkitView.tsx`; A-UI | D |
| UI-02 | Port React/TypeScript, without iframe or WebView | `ToolkitProtectView.tsx`, `src/lib/protect/*`; A-UI | D |
| UI-03 | Cover with Protect and Verify | `ProtectHome`; A-UI | D |
| UI-04 | Style, theme, headers, back, upload, warnings, confirmation and amber accent | Toolkit/`ConfirmModal` components; M-UI-01 | D |
| UI-05 | Global language without duplicate selector | `t/tx`, `AppLanguage`; A-I18N | D |
| UI-06 | Keep flow when exiting and returning to Toolkit | singleton `protectSession`; M-UI-02 | D |
| UI-07 | ‘Protect more’ restarts document/adjustments and retains record | `resetDocument` retains `issuedCopies`; A-REG/M-UI-03 | D |
| UI-08 | Close Nodus deletes registration and phrases | renderer module memory; A-REG | D |

## Entry, composition and documentary security

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| IN-01 | Disk and vault in protection and verification | `SourcePicker`, IPC Protect; A-IPC/M-IN-01 | D |
| IN-02 | Native selector and drag/drop | preload `webUtils.getPathForFile`; A-IPC/A-UI | D |
| IN-03 | Ordered multiple protection; single verification | selector, rearrangement and discriminated mode; M-IN-02 | D |
| IN-04 | PDF, PNG, JPEG/JPG, GIF, WebP, BMP, HEIC and HEIF | signature+MIME+extension; fixtures A-IPC | D |
| IN-05 | Concatenated mix and default PDF if any | `loadProtectPages`; A-UI | D |
| IN-06 | PDF encrypted, damaged or empty with actionable error | errors `PasswordException`/`InvalidPDFException`/without pages; A-IPC | D |
| IN-07 | PDF at 1600 px and images ≤2600 px | engine constants; A-ENG | D |
| IN-08 | Deferred decoding, LRU 3 and sequential export without arbitrary limit | `ensureProtectPage`, LRU and sequential loops; A-ENG | D |
| IN-09 | HEIC/HEIF consisting of the main process | `normalizeHeic`, `@napi-rs/canvas`; A-IPC/M-PKG-01 | D |
| IN-10 | First decodable GIF/WebP animated frame | `createImageBitmap`; fixture A-IPC | D |
| IN-11 | Original unchanged | read only, hash fixture before/after; A-SEC | D |
| IN-12 | Result without text, layers or source metadata | composer raster + new PDF; A-SEC | D |

## Vault fountains and insulation

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| VAULT-01 | Local Zotero; cloud disabled and without automatic download | `listZoteroSources`; A-IPC/M-VLT-01 | D |
| VAULT-02 | Genealogy file/sources/testimonies | adapter `archive_items`; A-IPC | D |
| VALULT-03 | Study materials/docency | adapter `study_materials`; A-IPC | D |
| VAULT-04 | Base attachments with base, row and field | adapter `db_attachments`; A-IPC | D |
| VAULT-05 | Secured copies in any vault | `protect_copies`; A-DB | D |
| VALULT-06 | Empty state if no compatible sources | `SourcePicker`; M-VLT-02 | D |
| VAULT-07 | Vault change invalidates references and confirms discard | `vaultId` + `onVaultChanged`; A-IPC/M-VLT-03 | D |
| VAULT-08 | Renderer does not access routes or IDs from another vault | permission list + `ensureActiveVault`; A-IPC | D |

## Hide Editor

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| ED-01 | Multipage navigation | `RedactionEditor`; M-ED-01 | D |
| ED-02 | Black bar opaque, straight and at any angle | `fillRotatedRect`; A-ENG | D |
| ED-03 | Thickness 10/20/34/52/74 | exact control; A-UI | D |
| ED-04 | Unfocus area 16–160, intensity 2–30, initial 52/8 | editor/UI; A-ENG | D |
| ED-05 | Select, move, end, delete | `ProtectEditor`; A-ENG/M-ED-02 | D |
| ED-06 | Undo highs, changes and deletions per page | discriminated battery; A-ENG | D |
| ED-07 | Proportional copy to all pages | `cloneRedactionForPage`; A-ENG | D |
| ED-08 | Pan, zoom ±, adjust, wheel to pointer, maximum 8× and clamp | `ProtectEditor`; A-ENG/M-ED-03 | D |
| ED-09 | Visual trim, delete and apply with minimum 24 px | `MIN_PROTECT_CROP`; A-ENG | D |
| ED-10 | Rotate 90° left/right | `rotateProtectPage`; A-ENG | D |
| ED-11 | Straightening −10°...+10° in 0.5°, non-destructive | preview + consolidation; A-ENG | D |
| ED-12 | Transform marks when trimming/rotating; empty crop history; rotate consolidate straighten | editor geometry; A-ENG | D |
| ED-13 | Gray scale complete | composer; A-SEC | D |
| ED-14 | Contextual controls and adapted continuation text | UI per tool/counter; A-UI | D |
| ED-15 | Delete/Regress unless form focus | keyboard handler; A-ENG/M-ED-04 | D |
| ED-16 | Pointer capture, mouse, trackpad and touch | pointer events + touch-action; M-ED-05 | D |

## Watermark and legal foot

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| WM-01 | Switch and text ≤100 | model/UI; A-UI | D |
| WM-02 | Seven algorithms: dense, topographic, diagonal, mesh, grid, unique, manual | `watermark.ts`; gold A-ENG | D |
| WM-03 | Opacity 4–80 % (18 %) and size 10–60 (22) | defaults/ranges; A-ENG | D |
| WM-04 | Six colors and free selector | `PROTECT_SWATCHES`; gold A-ENG | D |
| WM-05 | Signature Nodus Protect with version | copy of the composer; A-ENG | D |
| WM-06 | Manual: an initial, unlimited, text, normalized position and angle ±45° | UI/model; A-ENG/M-WM-01 | D |
| WM-07 | Drag, reset, add/remove without deleting the last | `PreviewCanvas`/UI; M-WM-02 | D |
| WM-08 | Deterministic variation per page and preview=export | PRNG/unique composer; gold A-ENG | D |
| WM-09 | Multipage Live Preview | `PreviewCanvas`; M-WM-03 | D |
| FT-01 | Folding foot, white strip, fit, blue and prominent message | composer/UI; gold A-ENG | D |
| FT-02 | GDPR EUR-Lex located | map of seven languages; A-ENG | D |
| FT-03 | 32 official authorities and URLs | `PROTECT_AUTHORITIES`; A-ENG | D |
| FT-04 | Country by language until manual change | `DEFAULT_AUTHORITY`; A-ENG | D |
| FT-05 | Optional e-mail/telephone | model/UI/compositor; A-ENG | D |
| FT-06 | Message ≤260, global language until first edition | `messageCustom`; A-I18N/M-FT-01 | D |
| FT-07 | Continuation adapted without mark/foot | UI result; A-UI | D |

## Export, registration and library

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| EX-01 | Multipage Preview and Selector Image/PDF | `ResultStep`; A-UI | D |
| EX-02 | One page image→PNG; several→ZIP ordered | `buildProtectArtifact`; A-ENG | D |
| EX-03 | PDF raster: JPEG 0.92 without trace; PNG with trace | `pdf-lib` composer; A-ENG/A-SEC | D |
| EX-04 | Suffix located in seven languages | `SUFFIX`; A-I18N | D |
| EX-05 | Save, vault and share independent | `ResultStep`/IPC; A-UI | D |
| EX-06 | New ID per completed action; cancellation without registration | device by action + registration after success; A-REG | D |
| EX-07 | ShareMenu Electron and default save | main process; M-PKG-02 | D |
| EX-08 | Temporary Writing+Rename and System Overwriting | `writeArtifactAtomically` + native dialogue; A-IPC | D |
| EX-09 | exact and escaped CSV; `nodus-protect-registro.csv` | `issuedCopiesCsv`; A-REG | D |
| LIB-01 | Migration v90 with UUID, MIME, SHA, BLOB, origin, dates and deletion | migration/repo; A-DB | D |
| LIB-02 | List, read, save, download, reuse and delete with confirmation | IPC + UI list; A-DB/M-LIB-01 | D |
| LIB-03 | Empty erasing BLOB and preserving headstone | repo; A-DB | D |
| LIB-04 | Full backup includes table | integral copy of SQLite; A-DB | D |
| LIB-05 | `.nodussync` retrocompatible, merge UUID/updated_at/tombstone and summary | `syncPackage`; A-SYNC | D |

## IDPS v1 and verification

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| IDPS-01 | Traceability off; label ≤120 and optional phrase | defaults/UI; A-UI | D |
| IDPS-02 | 24 bytes record `IDPS`, version, flags and random 8 bytes ID | `stego.ts`; A-ENG vectors | D |
| IDPS-03 | HMAC-SHA256 truncated | Web Crypto; A-ENG vectors | D |
| IDPS-04 | Open and PBKDF2, original public salt, 310,000 iterations | byte parity A-ENG | D |
| IDPS-05 | Cyclic LSB RGB, majority and 4096 candidates | `decodeIdps`; A-ENG | D |
| IDPS-06 | Uncompressed PNG iTXt and PDF Title/Subject/Keywords | metadata port; A-ENG | D |
| IDPS-07 | Technical keys `idprotector`, `idps1`, `copyId:<hex>`; Producer/Creator Nodus | engine; A-ENG | D |
| IDPS-08 | Two-way compatibility with IDprotector v0.4.1 | Original JavaScript ↔ TypeScript; A-ENG | D |
| IDPS-09 | Log only in session and never phrases | `session.ts`; A-REG | D |
| IDPS-10 | Explanation: authentic, not encrypted; transformations destroy brand | Localized UI; A-I18N | D |
| VER-01 | PDF/image from disk, vault or library | common selector; A-UI | D |
| VER-02 | Change phrase and retry without rereading | cache `verifyPayloadCache`; A-UI | D |
| VER-03 | iTXt PNG and PDF metadata | parser; A-ENG | D |
| VER-04 | First Exact XObject; Raster Fallback with Warning | `exactPdfPageImageData`; A-ENG | D |
| VER-05 | All pages; verified prevails; if not, first not authenticated | verification loop; A-ENG | D |
| VIEW-06 | Separation pixels/metadata and three states | `VerifyStep`; A-UI | D |
| VER-07 | ID, key, match, candidates, page and session log | result UI; A-UI | D |
| VER-08 | Never claim he wasn't protected. | localized copy; A-I18N | D |
| VER-09 | Without Web Crypto: visible metadata and unavailable authentication | branch `idpsAvailable`; A-ENG | D |

## Italian, documentation and packaging

| ID | Parity required | Implementation/evidence | State |
| --- | --- | --- | --- |
| I18N-01 | `AppLanguage=it`, normalization, settings, tutorial, recovery/runtime | shared tables/UI; A-I18N | D |
| I18N-02 | Complete Italian table, exactly the same keys | `i18n.it.ts`; A-I18N | D |
| I18N-03 | Dominion, kinship and all historical notes in Italian | modules `.it.ts`; A-I18N | D |
| I18N-04 | Complete protection in seven languages | `i18n.protect.ts`; A-I18N | D |
| I18N-05 | `PromptLanguage` without Italian | types/tutorial/Settings; A-I18N | D |
| DOC-01 | Help, Toolkit, News and Accurate Privacy | README, FAQ, Nodi docs, release notes | D |
| PKG-01 | macOS/Windows/Linux: worker PDF, HEIC, save and share failback | M-PKG-01/M-PKG-02 by IC device | Scenario |
| NET-01 | Zero network access during Protect processing | no network API in engine/service; A-IPC/M-NET-01 | D |
| REG-01 | Zero regressions in Nodus Convert | existing Toolkit suite + build; A-UI/A-BUILD | D |

## Reproducible manual scripts

1. **M-UI-01...03**: open Protect in clear and dark and in each language; start a document, go out
   to another view and return; issue a copy, press "Protect more" and check that the document is
   empty but the record remains.
2. **M-IN-01...02**: drag a PDF/PNG/HEIC mixture, reorder it, check the default PDF output; in
   Verify confirm that only one source is supported.
3. **M-VLT-01...03**: in each type of vault list its source; check local/non-local Zotero; change
   vault with changes and accept/reject discard.
4. **M-ED-01...05**: go through a four-page PDF with mouse, trackpad and touch;
   create/move/resize/delete; use wheel, zoom pointer, clamp, bread and keys Delete/Regress inside
   and outside an input.
5. **M-WM-01...03 / M-FT-01**: create multiple handmarks, drag them, vary page, try deleting the
   last and compare pixel to pixel preview/export; edit the legal message and change language to
   check that it is not overwritten.
6. **M-LIB-01**: save a copy in the vault, reuse, download and delete it after confirmation;
   synchronize and check the tombstone on the second device.
7. **M-PKG-01...02**: run the IC installer of each OS with real HEIC and multipage PDF; save with
   overwrite and share (ShareMenu in macOS, save dialog in Windows/Linux).
8. **M-NET-01**: block/register outgoing traffic from the process, complete protection and
   verification and check zero requests; other Nodus functions are out of this scenario.

## Exit criterion

Delivery is blocked if any previous test fails, a pending row appears, changes an IDPS vector, there
is removable text in a protected PDF, the hash of an original is modified, Protect makes a network
request or Convert/Protect cards cease to appear as available.
