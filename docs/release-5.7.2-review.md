# Review of the 5.7.2 release notes

Prepared from local `main` at `6dba8d8c`, in a new worktree on
`zcode/v5.7.2-release`. The reviewed range is `v5.7.1..6dba8d8c`, which is 25
commits and 4 merged pull requests. The release date is 2026-09-29.

The modal contains twelve entries in all twelve interface languages: Spanish,
English, French, German, Portuguese, Brazilian Portuguese, Italian, Turkish,
Simplified Chinese, Traditional Chinese, Japanese and Korean. The notes describe
implemented behavior in literal language. Published historical release notes
retain their original text.

Unlike 5.7.1, this release carries new behaviour, so the modal is new rather than
a repeat of the 5.7.0 one.

## Scope and order

The existing modal groups entries by area, largest group first, with stable ties.
The new array follows that order directly: six academic, four library, one AI and
one general. The UI check compares every rendered entry, its translation and its
scope against the array in every language.

| Order | Reviewed change | Implementation evidence |
| --- | --- | --- |
| 1 | Research Chat plans the turn, looks up the catalogue by author, title or keyword with accents folded and one typo tolerated, reads several sources and refuses a thin answer | #991, `electron/ai/researchTurnPlanner.ts`, `shared/researchCatalog.ts`, `scripts/test-research-catalog.mjs` |
| 2 | Follow-ups keep the conversation's topic, earlier citations are carried, the scope lists only the sources that took part, and the answer no longer reports an indexed work as unindexed or Zotero as unavailable | #991, `scripts/test-research-chat-agent.mjs`, `scripts/test-research-scope-prompt.mjs`, `electron/ai/researchAssistant.ts` |
| 3 | The window no longer freezes while an answer is written, and a question no longer fails on a stored idea with no statement | #992, `scripts/test-research-null-idea-statement.mjs`, `scripts/test-documentary-inventory-indexes.mjs` |
| 4 | Document preparation overlaps two documents and four vector batches, requests remote vectors in parallel, rechecks the source at most every five seconds, stores vectors once as Float32 and compacts the store | #990, `electron/ai/documentaryPreparation.ts`, `electron/db/documentaryVectors.ts`, `electron/workers/documentaryMaintenanceWorker.ts`, `scripts/test-documentary-binary-vectors.mjs`, `scripts/test-documentary-compaction.mjs` |
| 5 | Only real scans wait for OCR, with one shared rule for the preparation preview and the preparation | #990, `electron/extraction/scanDetection.ts`, `electron/extraction/researchOriginal.ts`, `scripts/test-documentary-scan-detection.mjs` |
| 6 | Graph health detects and repairs relations from an idea to itself | #990, `electron/db/graphIntegrity.ts`, `scripts/audit-graph-integrity.mjs`, `scripts/test-graph-integrity-repair.mjs` |
| 7 | A citation rests on the passage holding the quote, in its own source and nearest its page, and stored supports are re-pointed once | #990, `passageForQuote` in `electron/ai/documentProfile.ts`, `electron/ai/documentSupportRepair.ts` |
| 8 | A section's page range stays inside its own source | #990, `electron/db/documentProfilesRepo.ts` |
| 9 | No relation from an idea to itself, no same-scan duplicates, no superseded checkpoints | #990, `electron/db/ideaDedupe.ts`, `scripts/test-library-integrity-fixes.mjs` |
| 10 | Extracted text is complete after NUL replacement, and a failed document profile says so and offers the retry | #990, `electron/extraction/textCleanup.ts`, `src/i18n.documentUnderstanding.ts` |
| 11 | Re-embedding is scoped to the ideas whose theme text changed, once each | #990, `electron/ai/reprocessConnections.ts`, `electron/ai/embeddingPipeline.ts` |
| 12 | The Linux packages start on glibc older than 2.38, built on Ubuntu 22.04, with a release check on the glibc floor | #994, `scripts/verify-linux-glibc.mjs`, `scripts/test-linux-glibc-floor.mjs` |

The range's intermediate corrections are folded into what entered. #990 carries
sixteen commits, and the notes state the general outcome of each area rather than
each commit: the two self-loop fixes are one entry with entry 6's repair, the
checkpoint keying and the stored-support re-pointing are sentences inside entries
9 and 7, and the contributor's patches and the adjustments they needed are not
separated in the modal because a reader cannot act on that distinction.

Two boundaries are worth stating. Deep Research, the Dictionary and notebook reads
keep the previous supervisor, so entries 1 and 2 describe Research Chat only. The
reaction-precedent and capability-pin work of earlier releases is untouched.

Not presented as a new feature: the artifact name `Nodus-linux-x86_64.AppImage` is
unchanged because it is the public download and updater contract, and the legacy
AppImage runtime is still the one electron-builder marks beta. #994's own body
records both decisions.

## Release references

The preparation updates active release references in the desktop and server
packages, lockfile root records, both extension manifests, source-offer links,
Docker/Compose/Portainer configuration, server image workflow, map request user
agent, citation and generated website metadata. Historical entries, historical test
fixtures and dependency version ranges are not release references. Two substring
hazards in `package-lock.json` were avoided by hand: `buffer@5.7.1` and
`@types/prop-types@15.7.15` contain the slug as a substring and must not move.

## Verification

- `node scripts/test-release-notes.mjs`: passed. Checks the new 5.7.2 entry, its
  date, the twelve scopes in display order, all twelve translations against a
  fallback to English and the no-semicolon, no-em-dash rule, plus fifteen phrases
  from the English notes.
- Version and metadata suites: **22 tests passed** (`test-version-agreement`,
  `test-agpl-release`, `test-v4-release-readiness`,
  `test-nodus-server-deployment`, `test-release-artifact-names`,
  `test-superseded-versions`, `test-whats-new-support`).
- i18n and release-adjacent suites: **78 tests passed** (`test-i18n-coverage`,
  `test-i18n-no-duplicate-keys`, `test-i18n-resource-regressions`,
  `test-i18n-server-clobber`, `test-modal-animation-performance`,
  `test-linux-glibc-floor`, `test-macos-release-security`).
- `scripts/test-zotero-plugin.mjs`: **87 tests passed** with the new version.
- `npm run site:verify`: **101 tests passed**. `npm run site:metadata` regenerated
  the three pages, including the visible `Released` line on the citation page that
  a hand edit would have left at 28 September. `npm run site:sitemap` wrote 25 URLs
  and moved four `lastmod` dates to 2026-09-29.
- `node scripts/verify-release-notes-ui.mjs`: passed in all twelve languages, both
  light and dark. Checks the active v5.7.2, the exact text, order and scope of all
  twelve entries, that the modal differs from the 5.7.0 one, v5.7.1 and v5.7.0
  present in the picker, unpublished v5.3.2 absent and no renderer errors.
- `npm run citation:check`, `npm run release:verify-source` and `git diff --check`:
  passed.
- `npx tsc --noEmit -p tsconfig.json`: the renderer project is clean. The Electron
  project reports two `TS2307` errors for `linkedom` and `@mozilla/readability` in
  `electron/websearch/webPageExtract.ts`, both declared dependencies missing from
  the borrowed `node_modules` of the main checkout. No changed file is involved.
- Screenshots were visually inspected in both themes. Full screenshots lift the
  scroll cap to show every entry. Normal screenshots preserve the modal viewport.

No production installer or Docker image was built, and no release was published.
Translations were written for this release and were checked for coverage and
rendered text, not by native reviewers.

## Reproduce the screenshots

```sh
npx vite --config visual-tests/vite.release-notes.config.mjs --port 5199
NODUS_RELEASE_NOTES_URL=http://127.0.0.1:5199 node scripts/verify-release-notes-ui.mjs
```

Port 5198 belongs to another session's harness, so the 5.7.2 pass used 5199. The
script writes captures and the ordered Spanish text under
`artifacts/release-5.7.2/`.
