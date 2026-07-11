# Your first day with Nodus

This guide takes you from a fresh install to your first cited output. It follows
the natural path through the app — **connect Zotero → scan your readings →
explore the graph → produce a Deep Research report** — and ends with a map of
every sidebar section so nothing feels unlabeled.

Everything runs on your machine. The only network calls are to the AI provider
you configure; your library, keys, and embeddings never leave your computer.

> The interface is available in **English and Spanish**; you pick the language on
> first run. This guide uses the English section names. The screenshots use the
> built-in demo corpus (a small science-of-learning sample), so they match what
> you see before adding a single real reference.

---

## Table of contents

1. [Try it in two minutes (demo mode)](#1-try-it-in-two-minutes-demo-mode)
2. [Before you start](#2-before-you-start)
3. [The setup wizard](#3-the-setup-wizard)
4. [The core loop: scan → explore → produce](#4-the-core-loop-scan--explore--produce)
5. [The sidebar, mapped](#5-the-sidebar-mapped)
6. [Where your data lives](#6-where-your-data-lives)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Try it in two minutes (demo mode)

You don't need Zotero or an API key to see what Nodus is. On a fresh install with
an empty database, the app offers to **load a demo corpus**: six works on the
science of learning, nine ideas, six typed relations, four research gaps, and a
few notes.

Load it and click through **Graph**, **Ideas**, **Debates**, and **Gaps** — every
static view works offline. A banner at the top reminds you that you're in demo
mode; leave it with **Exit demo mode** (also in **Settings → Data**) whenever you
want to start with your own library. Exiting clears the sample completely.

![Home dashboard](screenshots/01-home.png)

The **Home** dashboard is your starting point every session: corpus status, what
has been analyzed, and the next actions Nodus suggests.

---

## 2. Before you start

To use Nodus with your own references you need two things:

- **Zotero 7 or newer**, running, with its **local API** enabled
  (`http://localhost:23119/api/`). Nodus talks to Zotero **read-only** — it never
  modifies your library. If Zotero is open, the local API is normally already on.
- **An AI provider key** for at least one of: Anthropic, OpenAI, OpenRouter,
  DeepSeek, or Gemini. You can also point Nodus at a **local model** via Ollama or
  LM Studio (no key required) — see **Settings → Providers**.

A note on embeddings: idea *fusion* (recognizing that two works express the same
idea) uses embeddings, which require **OpenAI, OpenRouter, Gemini, or a local
provider**. With an Anthropic-only setup everything still works, but fusion falls
back to a conservative "treat every idea as new" policy.

That's it. Keys are stored encrypted at rest with Electron `safeStorage` and are
never exposed to the interface.

---

## 3. The setup wizard

On first launch you choose your language, then a five-step wizard walks you
through setup. None of it is irreversible — every choice can be changed later in
**Settings**.

| Step | What you do |
|------|-------------|
| **1. Connect Zotero** | Click **Verify connection**. Nodus pings the local Zotero API and confirms your user ID. If it fails, open Zotero and try again. |
| **2. Collections** | Pick which Zotero collections Nodus should monitor. Only their metadata is imported at this stage — no analysis runs yet. |
| **3. Readings** | Set your **read tag** (the Zotero tag you use to mark things you've read; it can trigger deep scans automatically later) and, optionally, the path to your Zotero `storage` folder so Nodus can locate PDFs. |
| **4. AI provider** | Choose a provider, paste its key, load the model list, and pick a model. This model is used for extraction, synthesis, summaries, and fusion until you split those per-workload in Settings. |
| **5. First result** | Nodus runs the first sync. **This imports Zotero metadata only** — automatic analysis is off by default, so nothing is sent to your AI provider yet. |

When the wizard finishes you land in your **Library** with every monitored work
listed — but "unscanned." That's expected, and it's the subject of the next
section.

---

## 4. The core loop: scan → explore → produce

This is the rhythm of using Nodus. You scan readings to turn them into structured
ideas, explore how those ideas connect, and then produce writing grounded in them.

### Step 1 — Scan your readings

![Library](screenshots/07-library.png)

Nodus reads at **two levels**, and by default you trigger them yourself (you can
automate this in **Settings → Library**):

- **Light scan** — title + abstract only. Cheap and fast; assigns each work a
  coarse parent theme and keeps unread works visible on the map so gaps stay
  honest. A green **light ✓** badge marks a done light scan.
- **Deep scan** — the full cleaned text. This is where the value is: it extracts
  typed **ideas** (claim, finding, construct, method, framework), pulls **verbatim
  evidence** anchored to the exact passage, and **fuses** each idea against your
  existing graph. An indigo **deep ✓** badge marks a done deep scan.

In the Library, each row has actions to **analyze themes** (light), **analyze
ideas** (deep), or both. To scan in bulk, select the works you want (or "select
all filtered") and use **Process all**. Start with a light scan across everything,
then deep-scan the handful of works you care about most — deep scans cost the most
tokens, so target them.

> **Tip:** if a deep scan produces suspiciously few ideas from a long work, its
> PDF/EPUB probably wasn't available when it ran, so only the abstract was read.
> Those works get an **"abstract only"** badge; **Re-analyze "abstract only"**
> (in the Library toolbar) reruns just those once the file is in Zotero.

### Step 2 — Explore the graph

![Idea graph](screenshots/02-graph.png)

Open **Graph**. Every node is an idea or theme; every edge is a *typed* relation
(supports, contradicts, refines, extends…). Use the presets to switch lenses —
contradictions, gaps, reading focus, unread works, authors — filter by theme, or
search. Click any node to open a detail panel with its occurrences across works,
its evidence, and its connections.

![Argument map](screenshots/09-argument-map.png)

For a single claim, **Argument map** shows the logical structure around it — what
supports it, what pushes back — at a glance.

![Ideas](screenshots/03-ideas.png)

Prefer a list? **Ideas** gives you every extracted claim and finding with its
evidence and confidence, searchable and filterable.

### Step 3 — Read the derived surfaces

These sections are all *computed from the graph* — you don't create them, Nodus
derives them from what it scanned:

![Debates](screenshots/04-debates.png)

**Debates** renders contradictions head-to-head: two authors, their evidence, and
a chronology, with optional AI synthesis to explain the tension and where your own
position could sit.

![Research gaps](screenshots/05-gaps.png)

**Gaps** mines future work, limitations, and open questions across your corpus —
the raw material for a "future research" section or a thesis justification.

### Step 4 — Produce something, with citations

Now turn all of that into text. Two paths, sharing the same viewer, export, and
clickable-citation machinery:

![Writing workshop](screenshots/08-writing.png)

- **Writing** (the workshop) — pick a form (literature review, theoretical
  framework, debate synthesis, gap justification, chapter section, research
  question), describe your objective, select the materials to draw on (ideas,
  themes, gaps, contradictions, works, passages), and generate a structured
  result: outline, draft, a support matrix, a bibliography, next steps, and
  limitations.
- **Deep Research** — write one research idea and Nodus plans an outline, then
  writes it section by section, **guided by how much of your corpus each pass has
  already covered**, and assembles a 5–20 page academic report. Every substantive
  claim carries an inline `(Author, year)` citation and there's a full reference
  list at the end. The loop is bounded and **never invents a source** — any
  citation that doesn't trace to a really-scanned work is stripped.

Every `nodus://` citation in the output is clickable and resolves to the real
source and evidence inside Nodus. Drafts and reports can be saved locally and
reopened, or exported to Markdown.

![Notes](screenshots/06-notes.png)

Along the way, **Notes** is your Markdown workspace with folders, where those
`nodus://` citations stay live and clickable.

---

## 5. The sidebar, mapped

The sidebar groups sections into three phases of work — **Explore**, **Analyze**,
and **Write** — with **Home** pinned at the top and **Settings** at the bottom.
You can reorder or hide sections (within their group) from **Settings**. Here's
what each one is for:

### Explore — walk the corpus, the graph, and its ideas

| Section | What it's for |
|---------|---------------|
| **Search** | One box across everything — ideas, authors, works, notes. Results open a shared detail modal. |
| **Library** | Your monitored Zotero works with their scan/analysis status; where you trigger light and deep scans. |
| **Graph** | The interactive idea graph with typed relations, presets, and theme filters. |
| **Argument map** | The logical structure of support and rebuttal around one claim. |
| **Ideas** | Every extracted claim and finding as a searchable list, with evidence and confidence. |
| **Authors** | The author layer: author profiles and a synthesis matrix, derived after scanning. |

### Analyze — surfaces derived from the graph

| Section | What it's for |
|---------|---------------|
| **Study** | An AI-guided, step-by-step walkthrough (Tutor mode) of your graph — a full tour, or a route traced from a goal. |
| **Immersion** | A deep, narrative dive into a theme or idea, optionally with a decorative illustration. |
| **Gaps** | Future work, limitations, and open questions mined across the corpus. |
| **Debates** | Contradictions rendered as two-sided face-offs with evidence and chronology. |
| **Coverage** | Decompose a thesis question into sub-questions and see which your corpus covers, partially covers, or disputes. |
| **Hypotheses** | Turn a gap into a testable proposition — the hypothesis lab. |
| **Reading path** | An ordered reading plan justified by gap, foundational, recency, and connectivity scores. |
| **Deep Research** | The orchestrated, coverage-guided report builder (see Step 4). |

### Write — produce cited output

| Section | What it's for |
|---------|---------------|
| **Writing** | The writing workshop: outline + draft + support matrix + bibliography from selected graph material. |
| **Projects** | Organize longer work (thesis, article, chapter) into structured, writable pieces. |
| **Notes** | A Markdown workspace with folders and live, clickable `nodus://` citations. |

Pinned outside the groups: **Home** (corpus status and next steps) and
**Settings** (providers, models, library automation, integrations, data, backups).

---

## 6. Where your data lives

Nodus is local-first by design:

- Your corpus, ideas, embeddings, and notes live in a **SQLite database** on your
  machine.
- API keys are encrypted at rest and **never cross into the interface** or leave
  your computer.
- Zotero access is **read-only** — Nodus never writes to your library.
- The only outbound calls are to the AI provider you configured (or to nothing at
  all, if you run a local model via Ollama or LM Studio).

You can export an **encrypted backup** (Settings → Data), and Nodus can keep
automatic, retained backups for you. A single install can hold several separate
**vaults** (independent corpora) if you keep distinct projects apart.

---

## 7. Troubleshooting

**Zotero "not available" in step 1.**
Make sure Zotero 7+ is running. The local API listens on
`http://localhost:23119/api/`; opening Zotero normally enables it. Then click
**Verify connection** again.

**My works are listed but have no ideas.**
Metadata sync doesn't analyze anything — that's by design. Run a **deep scan** on
the works you care about (Library → analyze ideas, or select several and
**Process all**).

**A long book produced only two or three ideas.**
Its full text wasn't available at scan time, so only the abstract was read. Look
for the **"abstract only"** badge and use **Re-analyze "abstract only"** once the
PDF/EPUB is attached in Zotero. Setting your Zotero `storage` path in Settings
helps Nodus find files.

**Ideas from different works never merge.**
Fusion needs embeddings. Configure an embeddings-capable provider (OpenAI,
OpenRouter, Gemini, or a local one) in **Settings → Providers**. With Anthropic
only, Nodus deliberately keeps ideas separate rather than guessing.

**A local model errors with something about context length.**
Local servers load a model with a small, fixed context window. Increase it in your
server (Ollama's `num_ctx` / LM Studio's *Context Length*), pick a model with more
context, scan less text per batch, or use a cloud provider for the biggest tasks.

**I want a different model for scanning than for chatting.**
Model choice is per-workload. Split extraction, synthesis, summaries, fusion, chat,
Deep Research, writing, and more in **Settings → AI providers and models**.

---

Ready to go deeper? The [main README](../README.md) covers the full feature set,
and [docs/IMAGE_GENERATION.md](IMAGE_GENERATION.md) documents optional decorative
images. For the Word add-in beta, see [word-addin/README.md](../word-addin/README.md).
