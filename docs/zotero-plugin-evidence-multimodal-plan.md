# Nodus for Zotero: evidence retrieval and multimodal reading

## Outcome

The plugin must answer against the complete set of selected Zotero attachments
without silently dropping the middle of long documents. Answers must cite an
evidence object that resolves to an exact stored passage, page, section and
source item. PDF pages and selected regions must also be usable as visual
context so scanned text, figures, tables, equations and diagrams can be read.

## Evidence pipeline

1. Read the complete attachment:
   - PDF through `Zotero.PDFWorker.getFullText`, preserving form-feed page
     boundaries.
   - EPUB, HTML and plain text through Zotero's complete full-text cache.
2. Split every logical page/section into overlapping, sentence-aligned chunks.
   Each chunk stores an immutable evidence id, attachment/item keys, title,
   page index/label, section, offsets and exact text.
3. Reconstruct open PDFs from Zotero's PDF.js reader layout: order columns,
   rebuild paragraphs, dehyphenate line endings, remove repeated headers and
   footers, and retain page-coordinate spans for exact navigation/highlights.
4. Persist cache metadata in a profile-local SQLite database, compressed page
   and chunk data in gzip JSON, and embeddings in compact Float32 sidecars.
   Invalidate them when the attachment modification time, size or text
   signature changes.
5. Create multilingual embeddings locally in a dedicated worker using pinned
   `Xenova/multilingual-e5-small` INT8 weights. The model is automatic, cached
   by Zotero after its first download and never needs an embedding provider or
   API key. Combine cosine similarity with BM25-style lexical scoring.
   Lexical retrieval remains available if the local runtime cannot start.
6. Diversify results across documents and include neighbouring chunks when
   needed. Small source sets can use complete-text mode; large source sets use
   retrieval while retaining on-demand access to every indexed chunk.
7. For long documents, let a bounded retrieval planner run at most two
   expansion rounds. It may issue up to three focused semantic queries and
   inspect up to four short ranges from known source ids; every request is
   validated and merged with the existing evidence before reranking.
8. Give the model an explicit evidence catalogue and require
   `[[e:EVIDENCE_ID]]` citations.

## Citation contract and audit

- Only ids in the catalogue sent for the current answer are accepted.
- Page, idea, gap and Zotero tokens are also checked against their respective
  allow-lists. Invalid tokens are removed before rendering.
- Every accepted evidence citation resolves to the exact stored passage and
  opens its Zotero source/page.
- The client segments the answer into factual claims, measures citation
  coverage and flags missing or weakly related support.
- Each answer exposes an expandable evidence audit containing claims, exact
  quotations, source titles, sections and pages.
- The catalogue and audit travel with conversation history, so reopening a
  conversation cannot silently bind old citations to a different document.

## Multimodal pipeline

1. Capture the current rendered PDF page or the rectangle associated with a
   text/image selection and resize it to a bounded JPEG data URL.
2. Attach one or more captures to chat requests using provider-native vision
   message content.
3. Offer visual extraction that returns structured OCR plus descriptions of
   figures, tables, equations and diagrams. Store that extraction against the
   source page and add it to the searchable evidence index.
4. Mark pages with little or no extracted text as visual/OCR candidates. A
   user-triggered scan walks those pages, restores the reader position and
   updates the index incrementally.
5. Use a page capture automatically as a fallback when the current PDF page has
   no useful extracted text.
6. EPUB and HTML attachments participate in complete-text indexing; visual
   capture is PDF-specific because Zotero exposes a rendered PDF canvas.

## Product controls

- Context strategy: Auto, semantic retrieval or complete text.
- Automatic local multilingual semantic model with download progress.
- Index selected/open sources, rebuild stale indexes and show progress.
- Attach current page, index visual page and OCR text-poor pages.
- Clear indication of active sources, indexed chunks, visual attachments and
  whether semantic or lexical retrieval was used.
- Cancellation and bounded document/image/batch sizes.

## Verification gates

- Unit tests for page splitting, section/chunk offsets, BM25, cosine/hybrid
  ranking, source diversity, citation allow-listing, claim coverage and visual
  feature parsing.
- Provider tests for embeddings and multimodal request bodies.
- Packaging tests for the worker, pinned model metadata, WASM runtime and icon.
- Connected-server tests for evidence catalogues and images.
- Syntax, lint, typecheck, build and the complete repository test suite.
- Live Zotero 9 install/update smoke test:
  - index a normal PDF and a multi-document selection;
  - retrieve a passage from the middle/end and open its citation;
  - reject a fabricated citation;
  - attach and analyse a page containing visual content;
  - OCR/index a text-poor page;
  - reopen the conversation and audit its sources.
- A low-cost real-provider run checks semantic ranking, answer coherence,
  passage support and multimodal interpretation.
