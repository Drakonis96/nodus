# Review of the 5.4.0 release notes

5.3.2 was prepared but not published. Its nine existing highlights are retained in
all eight interface languages under 5.4.0. The published 5.3.1 and older entries
remain unchanged. Release metadata is aligned to 5.4.0 and 2026-09-12.

The review compared first-parent changes after the 5.3.1 release (`cda37ecd`)
through `9871723b`, their implementation and supporting documentation, plus the
Research chat attachments in the working tree. Related fixes are grouped into
user-facing entries rather than listing CI-only changes separately.

| Changes reviewed | Notes |
| --- | --- |
| #763, `docs/research-chat-views.md`, reasoning, source-filter and prompt contracts | Shared Research chat, effort, sources and vault-local prompts |
| Current attachment implementation, `docs/research-chat-attachments.md` | File picker, drag/drop, processing, ownership/deletion and theme/accent readability |
| #734, #741 | Citation previews, reading position and retained partial answers |
| #767, `docs/implementation-document-skills.md` | Visual Skills in desktop Deep Research and Immersion, limits, persistence and exports |
| #767, map and vision contracts | Data-based cartography and bounded image relevance review |
| #732, #745, #749 | Chemical/SVG drawing acceptance and visible verification limits |
| #755 | Shared lexical/semantic vault search and saved filters |
| #736, #739, #761, `46808389` | Graph/Tutor controls, light context, Teaching navigation, send button and logo |
| `22e3b6b7`, #765, #767 | Signed packages, configuration/migration, rich results, 3D and packaged assets |
| #747, #752 | All three PDF Presenter highlights preserved |
| #751, package-card and installer fixes | Marketplace entry, unified skill cards and translated failures |
| #744 | Compact bookmarks and recovered site icons |
| #759 | Word selection whitespace and incomplete alternatives |

The on-disk migration journal keeps its original `5.3.2-capabilities.json` identifier
so a pre-release profile does not rerun a completed migration after the slug change.
Third-party dependency versions and signed package payloads are unchanged.

## Verification

- `node scripts/test-release-notes.mjs`: release identity, 25 entries, scope order,
  eight languages, content coverage and published history.
- `node scripts/verify-release-notes-ui.mjs`: exact rendered order in eight languages
  and both themes, active 5.4.0, and no unshipped 5.3.2 in the picker. Outputs screenshots
  and the complete Spanish list under `artifacts/release-5.4.0/`.
- Release/source/citation, artifact naming, server/Zotero version contracts and site
  metadata checks accompany the version promotion.
- A direct comparison with the previous exported release data confirms all nine
  prepared highlights and every published release are unchanged in eight languages.
