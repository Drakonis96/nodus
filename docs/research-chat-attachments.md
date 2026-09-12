# Research chat attachments

The + button is inside the left edge of the Research chat textbox. It opens the native multi-file picker without extension restrictions. Attachment chips support removing drafts and saving an original from a sent message. A message can contain just files. The shared composer covers academic/genealogy and the database, study/teaching and world adapters; Nodi and other assistants have no attachment picker.

Original bytes, extracted text, and normalized image/page previews live together under the owning vault's `research-attachments/<surface>/<conversationId>/<attachmentId>/` directory. Messages persist attachment references; unsent files are recoverable as drafts by reopening their conversation. Conversation deletion removes the whole directory through the repository, including originals and derivatives. Removing a draft deletes its bytes immediately. Attachment IDs cannot address another conversation or escape the storage directory. An import that outlives its conversation/vault cannot recreate the deleted files. Sources selected in the vault can change without losing explicitly attached files.

## Processing

- DOC and DOCX: body, headers, footers, footnotes, endnotes, annotations and text boxes using [word-extractor](https://github.com/morungos/node-word-extractor). DOCX embedded raster images also go to vision.
- PDF: per-page text and rendered pages, including scans. Text-only models receive the text layer. Scan-only pages require vision. Rendering uses bundled fonts, verified by checking pixels as well as extracted text.
- XLS/XLSX/XLSB/XLSM, ODS and the other spreadsheet formats recognized by [SheetJS 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/): sheet names, cell addresses, displayed values, and formulas. Formula code and macros are never executed. The current upstream package is pinned to its official distribution, rather than the older npm release.
- CSV, TSV, XML (including `.xlm` containing XML), JSON, source code, and files with any other extension containing UTF-8 or BOM-marked UTF-16: decoded text, preserving delimiters and quoted fields.
- PPTX, ODT/ODP, EPUB: extracted text; supported embedded images from Office/OpenDocument containers are included.
- PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG/BMP/HEIC/HEIF: normalized PNG for provider compatibility. Multiple GIF frames and TIFF pages are included within the image limit. HEIC is tested with a synthetic HEVC fixture.
- ZIP: readable text members and a directory of binary members. Binary members need attaching separately for interpretation.
- Other binary formats: the original can be stored, but the UI explicitly says there is no reader and prevents pretending the content was analyzed. Corrupt/password-protected files surface extraction errors. Audio/video transcription and arbitrary proprietary binary decoding are not implemented by this change.

All four Research chat engines append the same extracted source text to their real request and send images as multimodal parts. They preserve the exact selected provider/model. Empty native source selections do not block attached sources. Provider/runtime modality metadata takes precedence; unknown custom models can attempt image input. A text document whose optional images receive an explicit modality rejection is retried as extracted text on the same model, with instructions to disclose that visual details were not inspected. Scans and standalone images cannot take that fallback. Authentication/network errors are not retried by this fallback.

Transport fixes include Anthropic streaming image blocks, the three OpenCode Go protocols (Messages, Chat Completions, Responses), and distinguishing unknown Copilot vision support from explicitly unsupported vision. Codex uses localImage input in its ephemeral runtime; Copilot uses blob attachments. No base64 is placed in the prose prompt.

## Explicit bounds

50 MB per file; 20 files per conversation; 20 images/pages per request; 40 megapixels per decoded image; 100 MB expanded ZIP content and 10,000 ZIP entries. PDF extraction accepts up to 200 pages; PDFs above 20 pages provide text only and display that limitation. Such PDFs with scanned pages require splitting rather than presenting missing text as analyzed. Multi-image sources above 20 images display their truncation notice. Attachment text above 240,000 characters (or the smaller local context allocation) is rejected with instructions to split the files. Provider context and payload limits still apply. The application cannot promise that every arbitrary format or model accepts every file.

## Verification

- `node scripts/test-research-attachments.mjs`: 148 extraction/engine cases: 19 document cases, nine image formats, four engines × 15 providers × text/vision; byte-for-byte originals, academic message persistence, deletion through all four repositories, cross-conversation/path isolation, delete-during-import, corrupt files, scanned PDFs, visible PDF glyphs, multi-sheet formulas, context limits and modality-specific fallback.
- `node scripts/test-research-attachment-transport.mjs`: 32 real adapter contracts, using localhost responses. Tests both streaming and nonstreaming for 12 API routes, three OpenCode protocols, Codex localImage and Copilot blob input.
- `node scripts/verify-research-attachments.mjs` against `visual-tests/vite.config.ts` on port 5198: five native UI variants, + placement, multiple attachments, removing drafts, file-only messages, regeneration, reopening/follow-up, original-file save/delete controls, and light/dark/compact screenshots.
- Research chat view parity, effort/transport, source filters, cancellation, subscription, IPC and translation regression suites pass. Full `npm run build` passes.

Attachment cards use opaque light/dark surfaces and explicit neutral outlines, including inside colored user messages. Badge colors inherit `--vault-accent`. The visual check covers all nine canonical vault colors in both themes, measures a minimum 3:1 outline contrast and 4.5:1 filename/metadata/badge contrast, and writes `contrast-checks.json` alongside the screenshots.

The inference checks use fixture responses; no live commercial model was asked to interpret the files. The screenshots render the actual React component with fixture IPC, and are in `artifacts/research-attachments/`.

Files can also be dropped anywhere inside the Research chat window (including its composer, history and context panes). The drop affordance uses the active vault accent and theme. Picker and dropped paths share the same IPC import routine, extraction, limits, ownership checks and storage. Files resolve through Electron's existing `webUtils.getPathForFile` bridge; folders report individual errors. Text drags are left untouched, and imports are disabled while preparing files or generating an answer. Browser verification covers both themes, all five native variants and the modal, nested/cancelled/text/busy drops and file-only sends; the extraction suite also exercises the real drop IPC with all 19 document fixtures, mixed batches and invalid paths.
