# Moving items in Study and Teaching vaults

The **Move to another location** action is available beside notes and imported materials in the organization list and grid, and beside notes in Materials. Subjects, folders and topics use the same folder-and-arrow icon for their existing move action.

Choose the source location and destination course, subject, folder or topic. Moving changes only the selected location; other locations, content, annotations and generated knowledge remain available. An existing destination is reused. Clearing the destination removes the selected location, leaving an item unfiled when it has no other locations.

Folders can move to a subject, course or the workspace root. A folder containing topics requires a destination subject. A folder or topic cannot move into its own descendants. Root folders, course folders and nested folders remain navigable after a move.

## Verification

Screenshots use synthetic data in disposable profiles, not personal or student data:

- [Study, light theme](study-move-dialog.png)
- [Teaching, dark theme](teaching-move-dialog.png)

`node scripts/verify-study-moves-ui.mjs` runs against a fresh `npx vite build` and verifies both vault types through the actual Electron renderer, preload, IPC and SQLite database. It exercises list/grid actions, current-location selection, destination collisions, material relocation, subtopics, unfiling/refiling, nested destinations, cancellation, keyboard focus and a destination deleted while the dialog is open. It asserts that no renderer errors occur.

Repository tests cover atomic failure, stale/wrong origins, archived destinations and placements, same-location moves, subtree integrity, cycle rejection, preserved content/tags, retained generated ideas/evidence/embeddings, and nested path labels.

## Data and privacy

No schema migration or new network access is introduced. Moves use the existing local database and preserve source identities. Note relocation does not start an AI analysis. Live notes retain generated knowledge, as live materials already do; explicit lifecycle cleanup and purge operations continue to work.
