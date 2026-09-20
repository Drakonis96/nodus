# Research chat in every vault

All nine vault types expose one **Research chat** entry under **Analyze**. Existing `dbChat`, `studyChat` and `worldChat` route IDs remain valid; academic, genealogy, primary-source, prosopography and testimony vaults use `researchChat`. The header and command-palette assistant shortcuts open the corresponding integrated view.

`ResearchAssistantModal` renders both the standalone modal reference and the embedded view. The header, model selector, messages, copy/save/regenerate actions, skills and effort composer share the same JSX and styles. Embedded mode changes the outer frame and adds collapsible history and context panels. Panel state retains the existing database/study/world local-storage keys. Compact layouts overlay the context panel instead of squeezing the composer.

The database, study/teaching and world views provide `ResearchChatAdapter` implementations. They retain their existing stores, retrieval engines, source selectors and transports, including native database charts, study citations and world references/focus. Older conversations need no migration. Scope keys persist per turn so changing sources cannot feed previous out-of-scope turns back into the next request, including after reopening a conversation.

The academic source filter remains opt-in. Native source panels keep their existing context rules. All Research chat transports pass the explicit effort through `researchGenerationOptions`; non-chat Study Assistant requests retain their existing settings. Nodi is unchanged.

## Offline validation

- `node --test scripts/test-sidebar-vault-filtering.mjs scripts/test-view-registry.mjs scripts/test-world-chat-parity.mjs`
- `node scripts/verify-research-chat-views.mjs` against the renderer-only harness on localhost:5198: modal/composer parity, five visual variants, native histories/citations/sources, effort payloads and collapsible responsive panels.
- `node scripts/test-research-native-effort.mjs`: real database/world/study orchestration with intercepted completion transports, old models plus Sol/Luna/Astra, Standard and High.
- Existing provider contract/localhost transport, source-filter, partial-cancellation and chat-skills regression suites.
- `npm run build` includes renderer and Electron type checks.

These checks use local fixtures and simulated generation; they make no paid inference calls.

## File attachments

Research chat alone exposes an integrated + button for conversation-owned files. All four native engines consume the same extracted document/table content and provider-specific vision parts. See [Research chat attachments](research-chat-attachments.md) for formats, persistence, bounds and the verification matrix.

## Study and Teaching source organization

The manual context picker shares the vault's courses, subjects and nested folders.
Search matches titles, filenames, tags and organizational paths without requiring
accents or matching case. Group checkboxes select current matching, usable source
keys (including descendants); hidden selections survive filtering and collapsing.
A material shown in several locations is selected once. Existing conversations
continue to store explicit `sourceKeys`, so adding/moving a material does not alter
an already saved context. Unusable or excluded materials remain visible but cannot
be added as evidence. Virtual rows keep large catalogues bounded in the DOM.

Users can create or rename folders in the picker and move individual materials via
its action menu. Materials uses the same movement dialog. The
`moveStudyMaterialPlacement(id, placementId, destination)` IPC operation validates
and updates one placement transactionally, infers organizational ancestors, and
preserves other placements and document provenance. A null origin is allowed only
for an unfiled material; an existing destination is reused. Files, versions,
annotations, material IDs and vectors are untouched. The source catalogue and
retrieval cache refresh organization without requesting AI extraction or embeddings.

Generated ideas and evidence keep their original subject and material provenance
after relocating or unlinking a live material, including on later background
knowledge sync. Notes, questions and review progress are not moved automatically.
Explicit knowledge purge and material lifecycle cleanup retain their existing paths.

Validation: `node --test scripts/test-study-source-tree.mjs scripts/test-study-materials.mjs scripts/test-study-assistant.mjs scripts/test-study-knowledge.mjs scripts/test-study-search.mjs`
and `node scripts/verify-study-source-picker.mjs` against the renderer-only harness
on port 5197 (or `NODUS_VISUAL_URL`). The UI check uses 5,000 material fixtures in
Study/light and Teaching/dark, including keyboard navigation, selection, folder
management, failed/successful relocation, requests and citation navigation.
