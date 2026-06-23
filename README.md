# Nodus

**Local-first desktop app for doctoral researchers.** Nodus connects to your local
Zotero library, analyses your works on two levels, and weaves a navigable graph of
ideas and authors that helps you orient yourself in the literature, follow debates,
and detect research gaps.

Everything is local-first: your data lives on your machine. The only thing that
leaves your computer are the calls to the AI provider you configure.

> Quality priorities, in order: **(1)** data precision and traceability — every idea
> and connection traces back to a real passage; **(2)** unread works stay visible on
> the map; **(3)** a minimalist, fluid interface; **(4)** performance with libraries
> of thousands of items.

---

## Stack

| Layer | Technology |
| --- | --- |
| Shell | Electron + electron-builder (`dmg` / `nsis`), `contextIsolation: true`, `nodeIntegration: false` |
| Renderer | React + TypeScript + Vite |
| UI | Tailwind CSS, Framer Motion (respects `prefers-reduced-motion`) |
| Graph | Cytoscape.js |
| Database | SQLite via `better-sqlite3` (main process, transactional, versioned migrations) |
| Embeddings | Stored per idea; in-memory cosine similarity for fusion (sqlite-vec ready) |
| AI | Anthropic and/or OpenAI clients in main process; key stored with Electron `safeStorage` |
| Text extraction | `pdfjs-dist` (text only), `mammoth` (docx) |

## Architecture

```
electron/                Main process (Node)
  db/                    better-sqlite3, versioned migrations, repository pattern
  zotero/                Read-only Zotero 7 local API client (pagination + diff)
  ai/                    aiClient, the 3 core prompts, light/deep scan, fusion, research assistant, tutor
  extraction/            Clean text extraction (PDF/MD/docx) + chunking + Unpaywall
  pipeline/              Priority queue, retries w/ backoff, resume-after-restart
  sync/                  Full + realtime incremental sync with Zotero
  graph/                 Idea graph, derived author graph, gaps, reading path
  export/                .nodus export / import
  secrets/               Encrypted API-key storage (never crosses IPC)
  ipc.ts, preload.ts, main.ts
shared/types.ts          Domain types + the typed window.nodus IPC contract
src/                     React renderer (views, components)
```

The renderer never touches Node, the filesystem, or the network directly. Every
sensitive operation goes through the typed `window.nodus` bridge exposed by the
preload script.

## Prerequisites

- **Zotero 7+** running, with the local API enabled (it listens on
  `http://localhost:23119/api/`). Nodus is **read-only** and never writes to Zotero
  or touches `zotero.sqlite`.
- An **AI API key** for Anthropic or OpenAI. Embeddings (used for idea fusion)
  currently require an OpenAI key; with Anthropic only, fusion falls back to a
  conservative "new idea" policy.
- Node.js 20+.

## Setup

```bash
npm install
npm run dev      # launches Vite + Electron in development
```

## Build

```bash
npm run dist:mac   # produces a .dmg
npm run dist:win   # produces an NSIS installer
npm run dist       # current platform
```

## How it works

### Two-level scanning
- **Light scan** — title + abstract only, for *every* monitored work (read or not).
  Assigns coarse themes (Prompt 0). Cheap and incremental; this is what keeps unread
  works on the map so gaps stay visible.
- **Deep scan** — full clean text, for works that match either trigger:
  - **Tag** (configurable, default `leído`), or
  - **Manual selection** in the Collections modal / Library (`manual_deep`).

  A work is deep-scanned if it satisfies **either** condition. Deep scan extracts
  typed ideas (claim / finding / construct / method / framework), evidence anchored
  to exact passages (Prompt 1), then fuses each idea against the global graph
  (Prompt 2). The author layer is **derived** post-process from edges and external
  references — the model is never asked to infer global author relations.

### Tutor mode
A guided, step-by-step walkthrough of your own idea graph (`electron/ai/tutor.ts`,
launched from the graph toolbar). A long-context model you choose analyses **all**
ideas, themes and connections and proposes guided **routes**:
- **Recorrido completo** — several routes ordered by weight whose union covers the whole
  graph (so a single pass surfaces everything important and which lines weigh most).
- **Desde un objetivo** — you describe what you want to review and the Tutor traces a
  route through only the relevant ideas and connections.

There is **no artificial cap on stops**: the planner is told to traverse every relevant,
connected node and only skip what's clearly redundant — long, well-connected lines get
long routes rather than over-summarised ones.

You move with **previous/next** arrows (or ←/→). The narration is written as **one
continuous, progressive discourse** (each stop receives the tail of the previous one and
is told to avoid navigation filler like "stop 4" / "welcome" / "to finish"), grounded in
that node's ideas, occurrences and verbatim evidence and rendered as **Markdown**. As you
move, the real graph spotlights and frames the current node(s) with a slightly wide
perspective (close enough to read the label, wide enough to show the neighbourhood), and
the node's detail opens in the right sidebar so you can read it alongside the explanation.
The plan is one structured JSON call; each stop's explanation is streamed.

The left navigation collapses by clicking the **Nodus logo**, freeing space for the graph
and the tutor/detail panels. The research-assistant chat answers also render as Markdown.

### Writing workshop
The **Taller de escritura** turns the graph into an editable academic artifact rather
than another exploratory view. You choose the target form (state of the art,
theoretical framework, debate, gap justification, chapter section or research
question), describe the objective, and Nodus prepares a workbench of relevant
materials from the local graph:

- idea nodes with their developing works and anchored evidence,
- curated themes,
- mined gaps,
- contradictions,
- works from Zotero,
- saved Tutor routes.

You select what belongs in the draft, then the synthesis model generates a structured
result: outline, Markdown draft, support matrix, bibliography, next steps and
limitations. Citations use the same `nodus://idea`, `nodus://work`, `nodus://gap` and
`nodus://contradiction` links as the research assistant, so every important claim can
open the real source/evidence in Nodus. The result exports as Markdown for further
editing in an external writing tool.

### Notes
The **Notas** view is a local workspace to structure everything the rest of Nodus
generates. You create **folders and subfolders** — use them as chapters and
subheadings — and file notes into them:

- hand-written **Markdown notes** with a formatting toolbar (headings, bold, lists,
  quotes, code, links) and an edit/preview toggle;
- **assistant answers**, **writing-workshop drafts**, **debate syntheses** and single
  **ideas**, captured from their own surfaces with one click ("Guardar en notas").

Captured content keeps its `nodus://idea`, `nodus://work`, `nodus://gap`,
`nodus://contradiction` and `nodus://passage` citations, so they stay **clickable**
inside the notes editor and open the real source/evidence — the same NotebookLM-style
behaviour as the research assistant. Folders and notes live in `note_folders` / `notes`
(`electron/db/notesRepo.ts`); deleting a folder cascades to its subfolders and notes.

### Sync
Manual (button) or realtime (polls the Zotero library version every ~25s and diffs
with `?since=`). Each sync writes a `sync_log` entry.

### Large-PDF handling (detector chain)
Deep-scan text resolution escalates only as far as needed, so big/scanned PDFs stay
cheap and memory-safe:

1. **Zotero's own indexed full text** (`/items/{key}/fulltext`) — if Zotero already
   extracted the text, reuse it (no parsing). Used only when it's substantial and
   reasonably complete (≥90% of pages indexed).
2. **PDF analyzer** (`pdfAnalyzer.ts`) samples evenly-spaced pages to estimate
   text-layer coverage and classifies the document: `digital` / `hybrid` / `scanned`.
3. **Streaming extraction** (`extractPdfStreaming`) parses page-by-page (never loads
   all page text up front), prefixing each page with a `[[p. N]]` marker so the model
   can cite accurate `location`s.
4. **OCR** (opt-in, `ocrEnabled`) — only the image pages of `scanned`/`hybrid` PDFs are
   OCR-ed locally with Tesseract, with a per-work page cap (`ocrMaxPages`) and live
   per-page progress. A `scanned` PDF with OCR disabled exits fast (no full read) and
   is marked `skipped_no_text` with an explanatory badge.
5. **Fallbacks** — Unpaywall (by DOI) → abstract-only → none.

We deliberately do **not** pre-convert PDFs to Markdown: a separate conversion pass
adds cost and risks precision (priority #1). Preserving page markers + paragraph
breaks gives the model better `location` grounding at lower risk.

All phases report progress through the queue (`Extrayendo p. 8/22`, `OCR p. 12/340`),
shown live in the queue bar.

> OCR is local but Tesseract downloads its language data on first use (cached
> afterwards). It is **off by default**; enable it in Settings → *Extracción de texto*.

### Zotero API conformance
Verified against the Zotero 7 local API: base `http://localhost:23119/api/`, the
library is always addressed as **`users/0`** (the real numeric userID is not used
locally), and every request sends **`Zotero-Allowed-Request: 1`** — required because
Electron's `User-Agent` starts with `Mozilla/`, which Zotero otherwise rejects.
Pagination uses `limit`/`start` with the `Total-Results` and `Last-Modified-Version`
headers; incremental sync uses `?since=`. The client is strictly read-only.

### Traceability
Every idea, edge, and gap stores its `evidence` (verbatim quote + location +
`zotero_key`), so you can jump from any node or edge to the exact passage in Zotero.

## Data schema

See `electron/db/migrations.ts` for the authoritative schema. Core tables:

- `works` — central registry; each work gets a stable `nodus_id` (UUID), independent
  of its `zotero_key`. Tracks `light_status`/`deep_status`, `deep_trigger`, hashes.
- `work_aliases` — duplicate works (same DOI) unified under one `nodus_id`.
- `themes` / `work_themes` — light-scan theme clusters.
- `ideas` — canonical idea nodes with embeddings (`global_id` = `g-NNNN`, assigned by
  the app, never by the model).
- `idea_occurrences` — how each work develops an idea.
- `evidence` — anchored quotes.
- `edges` — typed, directed relations (solid = explicit, dashed = inferred).
- `authors` / `author_relations` (derived) / `work_authors`.
- `gaps`, `external_refs`, `settings`, `sync_log`.

## Export / import

Settings → Data → **Export** produces a single self-contained `*.nodus` archive
encrypted with a generated password. It contains a transactionally consistent
SQLite snapshot plus the selected model settings and API keys. The snapshot
preserves all Nodus data: works and graph, extracted-text cache, chat history,
and the Float32 embeddings for ideas, work summaries and full-text passages.
An internal inventory verifies table counts, embedding bytes and model selections
before an import is accepted.

On a new machine, import the file to restore the complete Nodus state without
rescanning or reindexing. Original Zotero attachment files are intentionally not
duplicated by Nodus; keep Zotero's own storage/sync available if you need to open
the original PDFs. Extracted text and every computed Nodus artifact are restored
from the backup.

## The three core prompts

The verbatim system prompts live in `electron/ai/prompts.ts`:

- **Prompt 0** — light scan (themes).
- **Prompt 1** — deep extraction (ideas, evidence, relations, gaps, authors).
- **Prompt 2** — fusion / idea resolution against the global graph.

All free-text fields are produced in Spanish; `quote` fields stay verbatim in the
source language. JSON output is validated and retried at `temperature 0` on parse
failure.

## License

MIT
