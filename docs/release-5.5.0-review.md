# Review of the 5.5.0 release notes

5.5.0 collects everything merged after the 5.4.5 tag (`ef2e74ad`) up to `7b5c1920`,
plus the three interface languages that landed on 2026-09-17. The published 5.4.5
and older entries remain unchanged. Release metadata is aligned to 5.5.0 and
2026-09-18 in `package.json`, and `CITATION.cff`, the site JSON-LD and the sitemap
are regenerated from it.

The review read the merged pull requests, their diffs and the documentation they
carry, and grouped related fixes into user-facing entries instead of listing one
entry per commit. CI-only work (the CLA reminder) and repository or site-only work
(the README download counter, the Support Nodus page, the announcements feed) are
not in the modal.

| Changes reviewed | Notes |
| --- | --- |
| #883, `shared/types.ts`, the twelve catalogues | The interface speaks twelve languages: Traditional Chinese, Japanese and Korean join the nine |
| #664, `src/theme/themes.mjs`, Settings → Apariencia | Sixteen palettes, the theme editor with its contrast gate, per-vault or shared |
| #869, #851, `audit/local-ai-gpu/RESULTS.md` | The engine the machine can accelerate, what Settings reports, the bounded health checks and `local-ai/runtime.log`, the staged upgrade, Granite 4.0 Micro out of extraction and fusion |
| #872, #880 (connector) | The connector's thirteen languages and the messages it composes itself |
| #885, #802 | The on-device budget for a local custom endpoint, the unnamed-400 ladder, the trace-aware batch budgets |
| #880, #878 | The queue bar's forward-only counters and the graph post-processing that names its pass and its retry |
| #868, `src/evidenceJump.ts`, `npm run test:e2e:citation-jump` | Citations that open the page they name, including the Nodi overlay, study material and slide decks |
| #861, `nodus-clean-markdown/11` | Two-column pages read column by column, with the automatic re-extraction |
| #860, `electron/ai/documentProfile.ts` | Profiles that publish, the merged short chunks, the prompt language, the defined audit score, the translated failures |
| #870, `src/studyNoteFromChat.ts` | Chat answers saved as study notes with their provenance, and the Word (.docx) exports |
| #865, #881, Chemistry Studio 2.3.0 | RDKit inspection, the verified target context, the route drawings and the fix-steps chip |
| #887, `src/components/LocalModelWarning.tsx` | The red mark on every machine-local model and the wizard that no longer preselects one |
| #864, `electron/ai/providers.ts` | The unversioned DeepSeek ids and the refused `temperature` |
| #848 | Visual resources that follow the model chosen in the dialog, and the named refusal motives |
| #849, `scripts/test-release-artifact-names.mjs` | The RPM package next to the .deb and the AppImage |
| #687 | The native tooltips of the top bar |

The three new interface languages are the release's headline, so their note opens
the cluster and the connector keeps its own two notes next to it. The modal still
clusters by scope and orders the clusters by size, which puts the eight AI notes
first, then the five General notes, the three Library notes, the two Languages
notes and the three single-note scopes (Connector, Estudio, Word).

## Verification

- `node scripts/test-release-notes.mjs`: release identity, 21 entries, the scope
  order, the eight-language length floor, the ten translations that must not fall
  back to English, and the no-semicolon and no-em-dash rules in every language.
- `node scripts/verify-release-notes-ui.mjs`: the exact rendered order in all twelve
  interface languages and both themes, the version picker with 5.4.5 still offered
  and the unpublished 5.3.2 absent, and the four screenshots plus the Spanish order
  file under `docs/verification/release-5.5.0/` (also written to `artifacts/`).
- `node scripts/test-i18n-coverage.mjs`: every highlight of every release has a
  Turkish, Simplified Chinese, Traditional Chinese, Japanese and Korean column.
- `npm run typecheck`, `node scripts/test-v4-release-readiness.mjs`,
  `test-agpl-release`, `test-version-agreement`, `test-release-artifact-names`,
  `test-startup-update-modal`, `test-nodus-server-deployment`, `test-pipeline-logs`,
  `test-zotero-plugin`, `test-i18n-resource-regressions` and the eleven `test-site-*`
  checks accompany the version promotion.
- `npm run citation:sync` and `npm run site:metadata` regenerate `CITATION.cff`
  (dated 2026-09-18) and the three site pages from `package.json`.

## Decisions

- The changelog section that was `Unreleased` becomes `## 5.5.0 — 2026-09-18`, with
  the entries the merged work had not written yet (the interface languages, the
  palettes, the tooltips, the citations, the two-column reading, the profiles, the
  study note and Word exports, RDKit, the red warning, DeepSeek, the document
  skills and the RPM), and the usual closing line for the modal.
- `releaseMetadata.dateReleased` moves from 2026-09-15 to 2026-09-18, the day the
  tag is cut, and the release notes, the changelog heading and `CITATION.cff`
  carry the same date.
- The Japanese and Korean columns of the 5.5.0 notes are written by hand for this
  release rather than machine-translated, and `releaseNotes.ja.ts` and
  `releaseNotes.ko.ts` now map them from the release's own columns, the way the
  Italian, Turkish and both Chinese tables already did.
