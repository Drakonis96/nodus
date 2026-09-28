# Linking Workspace notes to courses, subjects and materials

In Study and Teaching vaults, a Workspace note can be linked to any number of places: a course, a subject, a folder, a topic (unit) or a specific material. The note is not copied. It stays in the Workspace and also appears in every linked place, where it can be read, edited, unlinked or moved to the trash.

## Where it appears

- **Workspace.** "Link to courses and materials…" in the note's context menu opens the link dialog: choose a course, subject, folder or topic, or search for a material. The row shows how many places the note is linked to, and the details panel lists them. Clicking a place opens it; the × removes that link only.
- **Courses and subjects.** Linked notes are listed under "Notes and materials" with a "Linked" badge, in list and grid layouts. A link to a topic also shows the note in the topic's folder, subject and course, as with study notes. Opening a linked note edits it in place with the same editor. Each row can open the note in the Workspace, manage its links, be removed from this section, or be moved to the Workspace trash after a confirmation. "Link note" links existing Workspace notes from the section itself.
- **Materials.** The material viewer's "Notes" button opens a side panel with the linked notes. A note can be read there, opened in the Workspace for editing, unlinked, moved to the trash, or linked from the panel.
- **Focus mode.** The focus rail's subject shelf includes the notes linked to the block's subject.

## Workspace visible by default

Study and Teaching vaults now show the Workspace in the sidebar by default, since notes are linked from there. Users can still hide it, and any sidebar customization they have saved is kept.

## Behaviour

- Moving a note to the Workspace trash hides it from every linked place. Restoring it brings its links back. Trashing or archiving a course, subject, folder, topic or material hides only the links to it. Study trash actions never delete Workspace notes.
- Moving a subject, folder or topic keeps its links, and the stored path follows.
- Deleting a note or material permanently removes its links.
- Linked notes are not yet used as Research Chat sources or by the study AI.

## Data

Migration 196 adds `study_note_links`, which contains only CREATE statements. It has no foreign keys, so a database migrated by a build with different numbering can recover it. Each row stores a resolved location or a material. The table syncs with the `study` group. It is not published to Nodus Server, which does not display these links.

Reading never deletes a link whose note is missing. Notes and study data sync in different groups, so a link can arrive before its note. Deleting that link would send a tombstone to other devices.

## Screenshots

Synthetic data in disposable profiles:

- [Link dialog from the Workspace, Study, light](estudio-link-dialog.png)
- [A linked note inside a unit, Study, light](estudio-unit-linked-note.png)
- [Editing the linked note in place, Study, light](estudio-edit-in-place.png)
- [Linking existing notes from a subject, Study, light](estudio-note-picker.png)
- [Linked places in the Workspace details, Teaching, dark](docencia-workspace-panel.png)
- [Notes beside a material, Teaching, dark](docencia-material-panel.png)
- [Trash confirmation, Teaching, dark](docencia-trash-confirm.png)

## Verification

`node scripts/verify-study-note-links-ui.mjs` builds on a fresh `npx vite build`. It uses disposable profiles and synthetic data to test the Electron renderer, preload, IPC and SQLite in an estudio vault (light theme) and a docencia vault (dark theme). It covers linking a note from the Workspace to a unit, another subject and a material; the row badge and details panel; the unit list; editing in place; unlinking from one subject; linking an existing note from a subject; the material panel; and trashing with confirmation and restoring. It also checks that there are no renderer errors.

`scripts/test-study-note-links.mjs` covers the repository and the migration against real SQLite.
