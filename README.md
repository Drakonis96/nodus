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
  ai/                    aiClient, the 3 core prompts, light/deep scan, fusion
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

### Sync
Manual (button) or realtime (polls the Zotero library version every ~25s and diffs
with `?since=`). Each sync writes a `sync_log` entry.

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
(`database.sqlite` + `manifest.json` + non-secret `settings.json`). The AI key is
never exported. On a new machine, import the file, re-enter the AI key, and point
Nodus at the local Zotero `storage` folder — the graph and all derived data are
available immediately without rescanning.

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
