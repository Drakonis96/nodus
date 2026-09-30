# Nodus 5.7.3

## New features

- Nodus Drift lets you combine up to six ambient sounds, noises or binaural tones offline. Adjust each sound’s volume, save named mixes and find sounds through search, favourites or categories. It has a fullscreen view and a player that lets you control the mix while using other Nodus tools.

- The complete study guide generates chapters from the materials, notes and recordings you select. It includes cited explanations, concepts, formulas, self-check questions and a review sheet. You can add figures from your materials and optional web content, labelled separately. Before starting, it shows an estimate of cost and time. Export the guide to PDF, Word or Markdown, or download just the review sheet.

- In Settings, you can check which favourite models are absent from their provider’s catalogue. Remove them from favourites or replace them in every task that uses them. If a catalogue cannot be read, the check reports it. A model absent from the catalogue may still work as an alias.

## Enhancements

- The Library identifies works whose text was mainly recovered through OCR and shows how many pages were not processed because of the OCR limit. It distinguishes those pages from pages without recovered text and only shows the limit when it is recorded in the extraction data.

- Updating saved citations to the correct passages takes less time when opening a vault. The repair avoids repeated queries over the same sources, especially in large libraries.

- Research Chat prepares the source inventory faster in large corpora and reduces the text sent to the model to describe the query scope. Saved coverage includes only consulted sources. If a request exceeds the model’s limit, the notice explains which part is too large and what you can reduce.

## Fixes

- Nodus uses the context and input limits reported by each provider and also applies them to report generation. It preserves custom limits if catalogue discovery fails and budgets reasoning and response space separately. This avoids rejecting valid requests or exceeding the model’s limit.

- AI responses that keep sending text or reasoning no longer stop at three minutes. The timeout tracks inactivity, with a total limit that prevents requests from running indefinitely.

- Sync archives works in Nodus when they are trashed, deleted or merged in Zotero. It preserves their notes and analysis, lets you restore them if they return to Zotero and retries pending checks if the connection is interrupted.
