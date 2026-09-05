# Stellar research canvas

The idea graph uses one WebGL2 infinite canvas across the corpus, complete-work view, Study, Immersion excerpts, and published Server Web spaces. Argument Map and the distinct person and primary-source networks retain their specialized views.

## Following a research thread

Search for a starting idea, then use **Next** or **Play**. Exploration follows stored relationships breadth-first, prioritizing confirmed and explicit relationships where the source supports those attributes. Incoming relationships are traversable without reversing their native arrows. Playback never generates AI relationships. The default limit is 25; the unlimited option continues until the reachable component is exhausted.

**Previous** rewinds the exploration; **Next** replays existing history before discovering more relationships. Changing the starting idea retains the canvas and truncates any undone continuation. A complete-work graph includes every eligible idea and internal relationship, including isolated ideas, and retains this baseline when rewinding.

Each playback step frames both endpoints above the controls, using a 550 ms camera transition. The current relationship, direction, and endpoint labels stand out against the dimmed context. Play advances immediately and leaves 3.5 seconds between steps at normal speed. Reduced-motion preferences disable the camera animation.

Dragging, zooming, Fit all, and Seed pause playback for manual exploration. Play, Previous, and Next automatically resume framing; no follow checkbox is required. Previous at the beginning centers the starting idea. View connection recenters the current relationship without advancing.

Clicking an idea or relationship opens its evidence detail and pauses playback. Resuming keeps that detail and its reading position open; the camera uses the remaining canvas width. The bottom bar continues to show the current relationship. The sidebar header sits outside the scrolling content, with an opaque background and 24 px of separation below it.

The header search supports pagination, arrow keys, Enter, Escape, and stale-request cancellation. Selected-idea actions live in the bottom bar. Source rings are optional, and the sidebar retains the full evidence list.

Connected components and isolated ideas receive a compact two-dimensional layout in a worker. Existing coordinates remain stable during exploration. Reorganize recalculates positions without changing topology or history. Legacy automatic horizontal work layouts are repaired on opening; customized coordinates are retained.

## Data, persistence, and compatibility

- `exploration.ts` implements paginated traversal, cancellation, and reversible history.
- `stellarService.ts` queries eligible neighbors, complete works, and specific elements in pages of at most 200 relationships, without an implicit total cap.
- `source.ts` preserves the data scope of Study and Immersion.
- `StellarCanvas.tsx`, `presentation.ts`, and `gpu.ts` handle navigation, endpoint framing, labels, and rendering. Lower detail reduces label density and drawing cost without deleting stored relationships.
- Migration **175** adds `stellar_sessions` per vault. These sessions contain local navigation state and are explicitly excluded from record synchronization. Saving checks the active vault identity; restoration revalidates identifiers and starts paused. Existing research records are unchanged.
- Published Web endpoints remain behind the existing space authorization boundary. Browser sessions are stored in IndexedDB under a user-and-space key. The published corpus is read-only.

The previous Sigma idea renderer, thematic atlas, Louvain supernodes, and overview/backbone endpoints are removed. Topology services used by research, tutoring, and analysis remain available.

A stored relationship is not a validated claim. Dashed lines distinguish inferred relationships; the detail panel exposes available provenance, direction, rationale, evidence, and review controls. Breadth-first exploration is a topological itinerary, not a logical proof.

## Validation

Run `npm test` for traversal, pagination, cancellation, complete works, stable placement, session boundaries, and camera geometry. `npm run test:e2e:stellar` exercises the real application with an isolated demonstration profile, including search, playback, framing, rewind, persistence, and sidebar behavior. The normal repository lint, builds, and E2E smoke also apply.

Local review copies can use `NODUS_USERDATA` with `NODUS_STELLAR_PREVIEW=1` to skip startup background integrations. QA uses the existing database-path guard. Profiles, copied vault content, reports, and recordings are local artifacts and are not distributed with the source.
