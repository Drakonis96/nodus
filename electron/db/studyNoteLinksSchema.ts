/**
 * Migration 196: a Workspace note linked to places of a study or teaching vault.
 *
 * One row is either a LOCATION (course, subject, folder and/or topic, stored already
 * resolved like `study_placements`, so a note linked to a topic also shows in its
 * folder, subject and course) or a MATERIAL. The note keeps living in the Workspace;
 * the row only says where else it should be seen.
 *
 * No foreign keys, deliberately, as with `workspace_library_links`: notes leave by many
 * roads (the Workspace trash, a sync, a permanent delete) and a cascading clause would
 * also stop this body from being create-only, which is what lets a database migrated
 * by a differently-numbered build get the table back. Reads hide orphans instead of
 * deleting them; why is in `studyNoteLinksRepo.ts`.
 *
 * The `study_` prefix and the scope column names are load-bearing: moving a subject,
 * folder or topic rewrites every `study_%` table that has them
 * (`updateStudyScopeReferences`), and the `study` sync group picks tables up by prefix.
 */
export const STUDY_NOTE_LINKS_SQL = `
CREATE TABLE IF NOT EXISTS study_note_links (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  course_id   TEXT,
  subject_id  TEXT,
  folder_id   TEXT,
  topic_id    TEXT,
  material_id TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (
    (material_id IS NOT NULL AND course_id IS NULL AND subject_id IS NULL AND folder_id IS NULL AND topic_id IS NULL)
    OR (material_id IS NULL AND (course_id IS NOT NULL OR subject_id IS NOT NULL OR folder_id IS NOT NULL OR topic_id IS NOT NULL))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_note_links_unique
  ON study_note_links(note_id, IFNULL(course_id, ''), IFNULL(subject_id, ''), IFNULL(folder_id, ''), IFNULL(topic_id, ''), IFNULL(material_id, ''));
CREATE INDEX IF NOT EXISTS idx_study_note_links_note ON study_note_links(note_id, position);
CREATE INDEX IF NOT EXISTS idx_study_note_links_course ON study_note_links(course_id);
CREATE INDEX IF NOT EXISTS idx_study_note_links_subject ON study_note_links(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_note_links_folder ON study_note_links(folder_id);
CREATE INDEX IF NOT EXISTS idx_study_note_links_topic ON study_note_links(topic_id);
CREATE INDEX IF NOT EXISTS idx_study_note_links_material ON study_note_links(material_id);
`;
