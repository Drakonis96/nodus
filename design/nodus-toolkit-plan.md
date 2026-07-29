# Nodus Toolkit — Original Implementation Plan

> Status: **Nodus Convert implemented; expanded with Nodus Protect** (2026-07-19).
> This document preserves the historic decisions of the first release of the Toolkit.
> The current specification and acceptance matrix of the fourth card are in
> [`nodus-protect-parity-v0.4.1.md`](nodus-protect-parity-v0.4.1.md).

---

## 1. Vision and names

**Nodus Toolkit** is a new first-level section ("Tools" in the sidebar) that centralizes file
processing utilities for research, teaching and study, ConvertX style but with formats in the
academic field. It contains four tools, each with its own page:

| Tool | internal id | Status v1 | Description of card (ES) |
|---|---|---|---|
| **Nodus Convert** | `convert` | is now implemented | Convert documents, PDFs and images; light OCR and text utilities, individual or bulk. |
| **Nodus Protect** | `protect` | Available | Hide data, mark documents and create or verify traceable copies by local processing. |
| **PDF Present** | `presenter` | Coming soon. | It presents PDFs as slides for class. |
| **OCR Workspace** | `aiOcr` | Coming soon. | Transcription of difficult documents with vision models. |

Name decisions:
- The sidebar section is called **"Tools"** (key i18n in Spanish, like everything else).The brand
  name for release notes / web is **"Nodus Toolkit"**.
- The converter is called **"Nodus Convert"** — fits the trio of brand names in English and with
  precedents like Deep Research. On the card the subtitle in ES makes it self-explanatory.
- ⚠️ The third tool was implemented as **"OCR Workspace"**, not as "AI OCR" (the name used by the
  user when ordering it): the roadmap already visible in the app announces it as *Nodus OCR
  Workspace*, and to release the card with another name would make the app contradict itself.
  **Reversible decision**: if the user prefers "AI OCR", it must be changed in`ToolkitView.tsx`,
  in`NODUS_ROADMAP`And in the test.

** Guiding principle**: Toolkit is **deterministic and 100% offline** (except for the opt-in
download of Tesseract languages, see §7). No AI in Nodus Convert: AI lives in the future AI OCR
tool. No operation ever touches the original file.

**Key finding**: almost all the machinery is already in`package.json` — `pdf-lib`, `pdfjs-dist`,
`tesseract.js`, `mammoth`, `docx`, `turndown`, `adm-zip`, `@napi-rs/canvas`, `diff`— and there are
even OCRs running in`electron/extraction/ocr.ts`(image and PDF→PNG→Tesseract).The cost in bundle is
~0; the only new dependency planned is`heic-decode`(small WASM) in the imaging phase.

---

## 2. Navigation and integration into the shell

### 2.1 Sidebar
- `src/navigation.ts`: add`'toolkit'`to the union`View`and a`NAV_ITEMS`.
- New navigation group`tools` (`NavGroupId`), label **"Tools"**, rendered after`create`("Write"). A
  single item group is valid (`groupedNav`already tolerates arbitrary size groups and discards
  gaps).
- New and unique icon:`tools`Remember that`test-icons.mjs`validates the catalogue.
- **Universal view**: not added to`VAULT_TYPE_SCOPED_VIEWS`(appears in all types of vault) or to
  any`defaultHiddenViews`. Known limitation: the preview types (`docencia`, `worldbuilding`) allow
  only`home`; the Toolkit won't be there until they stop being previewed — accepted for v1.

### 2.2 Header
- Add a`HeaderAction`(icon`tools`) in the stock row of the top bar of`App.tsx`navigating in
  sight`toolkit`from anywhere. Same pattern`h-9 min-h-9 px-2.5`That's the rest of the header's
  stock.

### 2.3 Other areas
- `CommandPalette`: "Go to Tools" command (+ "Open Nodus Convert").
- `shared/nodiDocumentation.ts` (`NODUS_ROADMAP`): when launching, move the Toolkit item to "made"
  or remove it, and document the section so Nodi can explain it.
- `WhatsNewModal`: entry of news in the release that premieres it.

### 2.4 Internal navigation of Toolkit
`ToolkitView.tsx`manages a sub-state of its own (no more ids added to`View`):

```
type ToolkitPage = 'home' | 'convert' | 'presenter' | 'aiOcr'
```

- `home`= hub with the 3 cards.
- Each tool renders a header with **button back** (`chevronLeft`+ "Tools") and the title/icon of the
  tool — Breadcrumb style "Tools / Nodus Convert".
- The sub-state is conserved when you change your view and return (state in the App component or
  light status module, as does Study with`StudyNavigationTarget`).
- `presenter`and`aiOcr`in v1: disabled card (badge "Next", reduced opacity, no onClick). There is no
  navigable placeholder page — less surface than testing and no dead end.

---

## 3. Hub Design (Main Tool Page)

Explicit user design requirements, which become PR checklist:

- [ ] Margins and spacing rhythm identical to the rest of views (container`px-6 py-6`,
  `gap-3/gap-4`of the existing scale; compare side by side with Deep Research and Home).
- [ ] The 3 hub cards are **exactly the same size** (grid)`sm:grid-cols-2
  lg:grid-cols-3`with`h-full`on the card; the content cannot misalign heights).
- [ ] Brothers buttons with the same height (`btn` + `h-9 min-h-9`); never mix heights in the same
  row.
- [ ] Icons **perfectly centered**: the icon of each card goes on a fixed square "loset" (`h-12 w-12
  rounded-xl flex items-center justify-center`) and button icons carry`shrink-0`. Landmine known:
  never`animate-spin`in the same element as a`-translate-y-1/2`(the spinner "boot" and does not
  spin) — the center always goes on a wrapper.
- [ ] Dark and light: any new utilitarian class used only in dark needs its remap`.light
  .<utility>`in`index.css` (`test-light-theme-utilities.mjs`help, but visually review both topics).
- [ ] Dropdowns/selects inside containers`overflow-hidden`→ portal to`body`(landmine of Databases).

Structure of the hub:

```
┌────────────────────────────────────────────────────────┐
│ [🔧] Tools                                              │
│ File-processing utilities for research, teaching and   │
│ study. Everything stays local on your computer.        │
│                                                        │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│ │ [swap]   │  │ [presen.]│  │ [scanTxt]│               │
│ │ Nodus    │  │ PDF      │  │ AI OCR   │               │
│ │ Convert  │  │ Presenter│  │          │               │
│ │ subtitle │  │ subtitle │  │ subtitle │               │
│ │          │  │ Coming   │  │ Coming   │               │
│ │          │  │ soon     │  │ soon     │               │
│ └──────────┘  └──────────┘  └──────────┘               │
└────────────────────────────────────────────────────────┘
```

Color accent of the section: **ambar/bronze** (tone "workshop"), other than the base indigo, the
Crimson of Databases and the Study teal. It is used only in icons-loseta, badges and details — the
chrome remains neutral like the rest of the app.

New icons in`ICON_PATHS`(all feather strokes, unique):`tools`(English key),`swap`(exchange arrows,
for Convert),`scanText`(for AI OCR). PDF Presenter reuses the icon`presentation`existing.

---

## 4. Nodus Convert — functional specification

### 4.1 UI

```
┌ Tools / Nodus Convert ─────────────────────────────────────┐
│ [←] [swap] Nodus Convert                                   │
│                                                            │
│ ┌ Categories ┐ ┌ Main area ──────────────────────────────┐│
│ │ Documents  │ │  ┌ Drop zone ────────────────────────┐  ││
│ │ PDF        │ │  │  Drag files or folders here,      │  ││
│ │ OCR        │ │  │  or click to choose them          │  ││
│ │ Images     │ │  └───────────────────────────────────┘  ││
│ │ Text       │ │  File list (name, size, status/progress,││
│ └────────────┘ │  remove)                                 ││
│                │  ┌ Operation options ┐                   ││
│                │  │ Target format, quality,               ││
│                │  │ page ranges, language… │              ││
│                │  └───────────────────────────┘            ││
│                │  [Output folder ▾] [□ Open when done]    ││
│                │                         [ Convert ]       ││
│                └──────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

- Left category panel: pills/buttons ** of the same size**, visual sidebar pattern of
  Study/Databases.
- The operation is chosen with a select "From → A" filtered by the added files (e.g. if you
  release`.docx`only valid outputs are offered). Bulk = N files, same operation.
- Progress: list by file with status (`pending / processing (x%) / done / error`), button to cancel
  the lot. Job survives navigation (runs in main; renderer is re-subscribed via`backgroundJobs.ts`).
- Result per file: output path + "Show in Finder" (`shell.showItemInFolder`)
  + readable error if failed (no stack tracks to user).
- Empty states and errors with the tone of the rest of the app; ES texts as i18n keys.

### 4.2 Exit policy (gold rule)

- **Never change or overwrite the original.
- Default destination: next to the original with the new extension; if collision exists, incremental
  suffix` (2)`, ` (3)`... (never overwrite silent).
- Alternative: output folder chosen by the user (persisted in settings).
- Bulk retains base names; operations N→1 (merge, images→PDF) request name.

### 4.3 Catalogue of operations v1

Each operation lists its engine and its **real acceptance test** (see §6). *DoD rule: one operation
is only required with its actual green processing test.*

**A. Documents** —`electron/toolkit/convert/docs.ts`

| # | Operation | Engine | Actual test (main assertion) |
|---|---|---|---|
| A1 | PDF → TXT | pdfjs (reuses`pdfjsLoader`/`textExtractor`) | The TXT contains the known phrases of the 3 pages of the fixture, in order |
| A2 | PDF → Markdown | A1 + light heuristics (titles by font size, paragraphs) | Headers`#`present; full text |
| A3 | DOCX → Markdown / HTML / TXT | mammoth (+ turndown for MD) | `# Title`, `**bold**`, list and fixture table present |
| A4 | Markdown / HTML → DOCX | lib`docx` | Decompress the .docx (adm-zip) and assert text and styles of heating in`document.xml` |
| A5 | Markdown / HTML → PDF | render with CSS of the app + KaTeX →`printToPDF`(main, hidden window) | **e2e**: extract text from PDF with pdfjs and compare it; no pages > 0 |
| A6 | EPUB → Markdown / TXT | adm-zip + spine order OFP + turndown | Text of both chapters of the fixture, in spine order |
| A7 | Markdown → EPUB | manual zip (uncompressed mimetype + container.xml + OPF + XHTML) | Valid structure:`mimetype`first entry and STORED; container/OPF parseables; chapters with text |

**B. PDF Utilities** —`electron/toolkit/convert/pdfOps.ts`(pdf-lib)

| # | Operation | Actual test |
|---|---|---|
| B1 | Unite PDFs | pages = sum; text of both fixes present via pdfjs |
| B2 | Split / extract pages (ranges "1-3,5") | no pages and text of the specific page correct |
| B3 | Rotate Pages | `/Rotate`correct on page dict; re-openable |
| B4 | Reorder / Remove Pages | command verified by the text of each page |
| B5 | Extract embedded images | ≥1 image, canvas decodable, dimensions > 0 |
| B6 | Images → PDF (one per page) | no pages = no images; coherent page size |
| B7 | View/edit metadata (title, author, theme, date) | round-trip: write → reread → same |
| B8 | Compress scanned PDF (re-render to JPEG, configurable quality, labeled "with loss") | output < input; same no pages; OCR-able. * Late phase* |

**C. Light OCR** —`electron/toolkit/convert/ocrOps.ts`(reuses`extraction/ocr.ts`)

| # | Operation | Actual test |
|---|---|---|
| C1 | Image(s) → TXT | the recognized text contains the keywords of the fixture rendered at 300 dpi (standardized match) |
| C2 | PDF Scanned → TXT | about the PDF image of 2 pages |
| C3 | PDF scan → **PDF searchable** (sandwich: invisible text layer with Tesseract bboxes via pdf-lib) | pdfjs finds the words in the correct positions; the PDF visually intact (same as no pages, preserved images) |
| C4 | Preprocessed: gray scale / binarize (Otsu) | intact dimensions; binary histogram; C1 over preprocessed image continues to pass |
| C5 | Deskew (projection profile) | *Late phase*; angle detected ±1° in rotated fixture 3° |

- Tesseract languages downloadable on demand with management UI (Piper/Kokoro pattern), userData
  cache, consent reusing copy`ocrEnabled`(it's the only network call in the Toolkit).

**D. Images** —`electron/toolkit/convert/imageOps.ts`(@napi-rs/canvas;`heic-decode`new)

| # | Operation | Actual test |
|---|---|---|
| D1 | Convert PNG/JPEG/WebP (+AVIF if canvas supports it — *spike* at start of phase) | decodable output; intact dimensions; correct magic bytes |
| D2 | HEIC → JPEG/PNG | magic bytes detection in`npm test`; the actual conversion is verified **in local against an iPhone photo provided by the user, which is never committed** (see §6.2-bis) |
| D3 | Resize (max. / %) in bulk | Exact expected dimensions; undisturbed view ratio |
| D4 | Compress (JPEG/WebP quality) | output < input; decodable |

**E. Text** —`shared/toolkitText.ts`(pure, without Electron)

| # | Operation | Actual test |
|---|---|---|
| E1 | PDF glued text cleaner (de-tuned, join split lines respecting paragraphs, double spaces, quotes) | golden tests: real entry pasted from PDF → exact output expected |
| E2 | Shifts/minuscules (Prayer type / Title / MAYUS/minus, with ES rules: do not capitalize "of", "la"...) | golden tests |
| E3 | SRT/VTT → Clean TXT (without timestamps, lines attached by cue) | golden test on fixture interview |
| E4 | Checksum SHA-256 / MD5 files | known hash of fixture, byte a byte |

**F. Data and citations** — *v1.1 planned but out of first release* BibTeX ★ RIS ★ CSL-JSON (with
"importing Zotero" via existing bridge), CSV ↔ JSON ↔ Markdown table (reusing Robust Parser from
Databases).

---

## 5. Technical architecture

### 5.1 Modules

```
electron/toolkit/
  convert/
    docs.ts        # A* (mammath, docx, turndown, adm-zip, pdfjs — imports lazy)
    pdfOps.ts      # B* (pdf-lib, pdfjs)
    ocrOps.ts      # C* (testeract.js via extraction/ocr.ts, canvas)
    imageOps.ts    # D* (@napi-rs/canvas, heic-decode)
    index.ts       # Typed transaction log (id, category, inputs, outputs)
  toolkitWorker.ts # worker_thread runner (computeWorker pattern)
  toolkitJobs.ts   # Main queue: 1 active job, progress, cancellation, output naming
shared/
  toolkitText.ts   # E* pure
  toolkitTypes.ts  # ToolkitOpId, ToolkitJobRequest/Progress/FileResult
src/views/
  ToolkitView.tsx      # hub + sub-navigation
  ToolkitConvertView.tsx
```

** Hard rules:**
- The modules`convert/*`are **Electron-free** (as`databasesRepo`): Node imports and only libs, heavy
  deps with`import()`lazy (pattern of`ocr.ts`). This is what allows you to test them with esbuild +
  node:test.
- All the work runs in`toolkitWorker.ts`(worker_thread), **never** in the event loop of the main
  (historical landmine of the app). *Spike in F1*: verify`@napi-rs/canvas`+ tesseract within
  worker_threads on all 3 platforms; plan B:`utilityProcess`.
- Exception: A5 (`printToPDF`) you need`BrowserWindow`→ Runs in main with hidden window; is I/O
  asynchronous Chromium, does not block.
- Cooperative cancellation: the worker checks a flag between files and between pages; cancel never
  leaves files half (write a`.tmp`+ atomic rename).

### 5.2 IPC and status

- Channels:`toolkit:job:start`, `toolkit:job:cancel`, `toolkit:job:event`(push
  progress),`toolkit:ops:list`, `toolkit:pickFiles`, `toolkit:pickOutputDir`,
  `toolkit:showInFolder`. Typed in`NodusApi`(preload without leaking IPC names, like the rest).
- Renderer:`startBackgroundJob('toolkit:convert', …)`of`backgroundJobs.ts`so that progress survives
  navigation and is re-subscribed upon return.
- New settings in`AppSettings`(JSON of settings, **no schema
  migration**):`toolkitOcrLanguages`(default`'spa+eng'`), `toolkitOutputDir`(null = next to the
  original),`toolkitOpenFolderOnDone`"Recent jobs" on local Storage.

### 5.3 i18n

All new strings in ES as key + entries in EN/FR/DE/PT/PT-BR (`test-i18n-coverage.mjs`it requires;
budget this work at each stage, not at the end).

---

## 6. Testing strategy — "no operation passes without actual processing"

### 6.1 Actual Fixtures —`scripts/fixtures/toolkit/`

Generated once by`scripts/gen-toolkit-fixtures.mjs`and **committed** (determinists, < 200 KB each),
so that the tests are airtight:

| Fixture | Content |
|---|---|
| `sample-3pages.pdf` | PDF with text layer, 3 pages with well-known phrases ES/EN + titles with size hierarchy |
| `sample-b.pdf` | second PDF (for merge) |
| `scanned-2pages.pdf` | PDF **image only** (text rendered at 300 dpi, without text layer) |
| `scan-es.png`, `scan-en.jpg` | paragraphs rendered at 300 dpi for OCR |
| `scan-skewed.png` | Idem turned 3° (for C5) |
| `sample.docx` | Headings, bold, list, table |
| `sample.epub` | 2 chapters with defined spin |
| `sample.md`, `sample.html` | with headers, table and a KaTeX formula |
| `photo.jpg` | real small photo |
| ~~`photo.heic`~~ | * **DO NOT commit. See §6.2-bis** — a real HEIC photo is a personal user file and does not enter the repo under any circumstances. |
| `interview.srt` | 6 cues with timestamps |
| `pdf-paste.txt` + `pdf-paste.expected.txt` | golden cleaner E1 |

### 6.2 Unit tests (node --test, existing esbuild-bundle pattern)

`test-toolkit-docs.mjs`, `test-toolkit-pdf.mjs`, `test-toolkit-ocr.mjs`, `test-toolkit-images.mjs`,
`test-toolkit-text.mjs`, `test-toolkit-jobs.mjs`.

- Each test loads the actual module with esbuild (pattern`test-image-analysis.mjs`), processes the
  true **fixture** and serves **content of the result** (text extracted, not from pages, dimensions,
  hashes), never the mere existence of the archive.
- OCR:`langPath`pointing to a cache (`scripts/.cache/tessdata/`); first download
  run`spa`/`eng`(tessdata_fast); generous timeout. Without network and without cached the test
  **fault** — correct according to the rule ("without actual processing there is no green"). IC
  already has network (install npm).
- `test-toolkit-jobs.mjs`: tail semantics — anti-collision naming, clean cancellation (does not
  leave`.tmp`), monotonous progress, error in a file does not abort the lot.

### 6.2-bis HEIC: local verification, never a fixture

**Hard rule: no real photo of the user enters the repo.** A real HEIC is a personal file (carrying
device metadata, date and possibly GPS), and also the repo is public. It is not committed or
uploaded to GitHub in any way.

That clashes with the rule "without actual processing there is no green", because a real HEIC cannot
be generated in IC (there is no HEIC encoder in dependencies). It resolves as the repo already does
with Whisper and other heavy resources: a script`verify-*`manual, not a test of`npm test`.

- `scripts/verify-toolkit-heic.mjs`(pattern of`verify-study-whisper.mjs`), invoked as`npm run
  verify:toolkit-heic -- /path/to/a/photo.HEIC`, or via the `NODUS_HEIC_FIXTURE` variable. Process
  the REAL file and file the result (decode, correct dimensions, valid output JPEG/PNG). If you do
  not pass file, it fails with a message that explains how to contribute it — you never skip
  silently.
- In`npm test`/CI, D2 is covered only in its deterministic part: detection of HEIC by magic bytes /
  brand`ftyp`(minimum synthetic fixture of a few dozen bytes, built on the test itself, without
  being a photo), and error message when the decoder is not available.
- The HEIC conversion is not terminated until`verify:toolkit-heic`it happens locally against an
  actual iPhone photo. The user provides the file from outside the repo; the plan does not reference
  it by path within the tree.

### 6.3 e2e (actual app)

`scripts/e2e-toolkit.mjs`(pattern`e2e-smoke.mjs`: Electron real + playwright-core + disposable
profile:
1. Sidebar displays "Tools"; the hub renders 3 cards of equal size and the two "nextly" do not
   navigate.
2. Enter Nodus Convert, load`sample.md`, run **MD → real PDF** (`printToPDF`), assert that the
   output PDF exists and that pdfjs extracts the expected text (covers A5, impossible in unit).
3. Return to hub with the back button; no errors not captured in console.

Landmine known:`test:e2e`**no** rebuidea — execute`npm run build`before or the obsolete dist gives
false reds.

### 6.4 Quality doors per PR

`npm run typecheck` + `npm run lint` + `npm test`+ e2e affected, plus the revised §3 design
checklist on both themes (dark/light) and catches in the PR.

---

## 7. Implementation phases

Each phase ends with the complete suite in green and is mergeable on its own.

**F0 — Section and hub** **COMPLETATE** (2026-07-17)`View 'toolkit'`, nav group`tools`(after
writing, before Settings), icons`tools`/`swap`/`scanText`, `ToolkitView`with 3-card hub +
sub-navigation + back, HeaderAction in top bar (after Wizard), i18n complete (5 tables), Nodi
documentation updated with actual status. Tests:`test-toolkit-ui.mjs`(8 cases) + passage of hub
in`e2e-smoke.mjs`which measures in the real shell that the three cards have identical dimensions,
that the glyph is centered on its slab (±0.5 px), that the cards "nextly" do not navigate and that
the return button returns. Also verified with catches in dark and clear theme. Suite: 388/388 + e2e
in green.

Notes from what you learned in F0:
- The command palette displays the section automatically:`NAV_ITEMS`filtering by type of vault, so
  you didn't need to add a command by hand.
- `'Nodus Toolkit'`YA existed as a key i18n (comes from roadmap); duplicating it breaks the
  typecheck (TS1117). Before adding keys, check if they already exist.
- The brand name of the 3rd tool was aligned with the roadmap: **OCR Workspace** (not "AI OCR"),
  which is as already announced in`NODUS_ROADMAP`.

**F1 — Job engine** *(spike first)* Spike: canvas+tesseract+pdfjs within worker_thread on macOS (and
CI Linux). Then:`toolkitTypes`, `toolkitWorker`, `toolkitJobs`, IPC + preload, exit
policy,`startBackgroundJob`Tests:`test-toolkit-jobs.mjs`. **DoD**: a job dummy multi-archive with
progress and cancellation, main thread free (window responds during the job).

**F2 — PDF Utilities (B1–B7)** + category "PDF" in the UI.`test-toolkit-pdf.mjs`.

**F3 — Documents (A1–A7)** + category "Documents".`test-toolkit-docs.mjs`+ e2e MD→PDF.

**F4 — Light OCR (C1–C4)** + category "OCR" + language manager with consent.`test-toolkit-ocr.mjs`.
The searchable PDF (C3) is the flagship — prioritize it.

**F5 — Images (D1–D4)** + dep`heic-decode`+ AVIF spy.`test-toolkit-images.mjs`D2 closes with`npm run
verify:toolkit-heic`in local against a real photo of the user (§6.2-bis); that photo is never
committed.

**F6 — Text (E1-E4)** + category "Text".`test-toolkit-text.mjs`(goldens).

**F7 — Polished and released** Drag & drop folders, recent works, empty states, roadmap→made, What's
New, Nodi documentation, web/README captures, release notes (English, usual policy). Late pending
phases: B8, C5, category F (dates/data), contact sheet.

Order F2 before F3 by the way: pure pdf-lib is the firmest ground to validate the F1 engine before
inserting mammoth/turndown/printToPDF.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native (@napi-rs/canvas) or Tesseract fail within worker_threads on some platform | Spike in F1; plan B`utilityProcess`; plan C asynchronous cut in main (last resort) |
| AVIF not supported by canvas | Spike in F5; if not, hide select AVIF (the transaction log allows) |
| Download Traineddata (one network) surprises the user | Opt-in explicit reusing copy from`ocrEnabled`; persistent cache; visible language manager |
| Fidelity MD/HTML→PDF (not Word) | Tag as "Nodus-style re-layout"; never promise fidelity DOCX→PDF |
| Malformed real EPUBs | adm-zip tolerant + spin fallback in order of files; additional test with a real EPUB downloaded in F7 |
| Big PDFs → memory | Page-to-page process, without loading full rasterized; progress per page |
| New i18n chains break`test-i18n-coverage` | Translations within each phase, not at the end |

## 9. Out of range (explicit)

- ffmpeg / audio / video (Whisper already exists in Study; does not duplicate).
- Native binaries per platform (Ghostscript, LibreOffice, Calibre).
- AI in Nodus Convert (deterministic; AI OCR AI).
- Database schema changes (no new persistence in DB).
- PDF Presenter and AI OCR: only "Next" card; designed in own plans.
