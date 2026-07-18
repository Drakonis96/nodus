import crypto from 'node:crypto';
import { getDb } from './database';
import { createStudyShortId } from '@shared/studyOrg';
import { generatePseudonymCode, type PseudonymStudent } from '@shared/studentPseudonyms';
import {
  clampExpectedSize,
  type TeachingGroup,
  type TeachingGroupInput,
  type TeachingStudent,
} from '@shared/teachingGroups';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

function toStudent(row: Row): TeachingStudent {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    givenNames: String(row.given_names ?? ''),
    surnames: String(row.surnames ?? ''),
    comments: String(row.comments ?? ''),
    pseudonymCode: String(row.pseudonym_code),
    position: Number(row.position ?? 0),
  };
}

function toGroup(row: Row): TeachingGroup {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    name: String(row.name ?? ''),
    subjectId: String(row.subject_id),
    academicYearId: row.academic_year_id ? String(row.academic_year_id) : null,
    expectedSize: Number(row.expected_size ?? 0),
    position: Number(row.position ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.student_count === undefined ? {} : { studentCount: Number(row.student_count) }),
  };
}

/** Codes are unique per group, so collisions are ruled out by construction, not by luck. */
function takenCodes(groupId: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT pseudonym_code FROM teaching_students WHERE group_id = ?')
    .all(groupId) as Row[];
  return new Set(rows.map((r) => String(r.pseudonym_code)));
}

// ── Groups ───────────────────────────────────────────────────────────────────

export function listTeachingGroups(
  options: { subjectId?: string | null; academicYearId?: string | null } = {},
): TeachingGroup[] {
  const clauses = ['g.deleted_at IS NULL'];
  const values: unknown[] = [];
  if (options.subjectId) {
    clauses.push('g.subject_id = ?');
    values.push(options.subjectId);
  }
  // `IS ?` rather than `= ?`: the pre-academic-year groups carry NULL, and `= NULL` is
  // never true in SQL, so `=` would silently hide them instead of scoping to them.
  if (options.academicYearId !== undefined) {
    clauses.push('g.academic_year_id IS ?');
    values.push(options.academicYearId);
  }
  const rows = getDb()
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM teaching_students s WHERE s.group_id = g.id) AS student_count
         FROM teaching_groups g
        WHERE ${clauses.join(' AND ')}
        ORDER BY g.position, g.updated_at DESC`,
    )
    .all(...values) as Row[];
  return rows.map(toGroup);
}

export function getTeachingGroup(id: string): TeachingGroup {
  const row = getDb().prepare('SELECT * FROM teaching_groups WHERE id = ? AND deleted_at IS NULL').get(id) as
    | Row
    | undefined;
  if (!row) throw new Error('Grupo no encontrado.');
  const students = getDb()
    .prepare('SELECT * FROM teaching_students WHERE group_id = ? ORDER BY position, rowid')
    .all(id) as Row[];
  return { ...toGroup(row), students: students.map(toStudent) };
}

export function createTeachingGroup(input: TeachingGroupInput): TeachingGroup {
  const db = getDb();
  const { id, shortId } = ids('grp');
  const stamp = now();
  const expected = clampExpectedSize(input.expectedSize ?? 0);
  const position =
    (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM teaching_groups WHERE subject_id = ?').get(
      input.subjectId,
    ) as Row).p as number;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO teaching_groups
         (id, short_id, name, subject_id, academic_year_id, expected_size, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, shortId, input.name.trim() || 'Grupo', input.subjectId, input.academicYearId ?? null, expected, Number(position) + 1, stamp, stamp);

    // The declared total pre-creates that many blank rows so the teacher types straight
    // into a grid instead of clicking "add" thirty times. Rows stay freely addable and
    // removable afterwards — the number is a head start, not a constraint.
    const taken = new Set<string>();
    for (let i = 0; i < expected; i++) {
      const code = generatePseudonymCode(taken);
      taken.add(code);
      db.prepare(
        `INSERT INTO teaching_students (id, group_id, given_names, surnames, comments, pseudonym_code, position, created_at, updated_at)
         VALUES (?, ?, '', '', '', ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), id, code, i, stamp, stamp);
    }
  })();

  return getTeachingGroup(id);
}

export function updateTeachingGroup(
  id: string,
  patch: Partial<Pick<TeachingGroup, 'name' | 'academicYearId' | 'expectedSize' | 'position'>>,
): TeachingGroup {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name.trim() || 'Grupo');
  }
  if (patch.academicYearId !== undefined) {
    sets.push('academic_year_id = ?');
    values.push(patch.academicYearId);
  }
  if (patch.expectedSize !== undefined) {
    sets.push('expected_size = ?');
    values.push(clampExpectedSize(patch.expectedSize));
  }
  if (patch.position !== undefined) {
    sets.push('position = ?');
    values.push(patch.position);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(now(), id);
    getDb().prepare(`UPDATE teaching_groups SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getTeachingGroup(id);
}

/** Soft delete, consistent with the rest of the study/teaching surfaces. */
export function deleteTeachingGroup(id: string): void {
  getDb().prepare('UPDATE teaching_groups SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

// ── Students ─────────────────────────────────────────────────────────────────

export function addTeachingStudent(groupId: string, count = 1): TeachingGroup {
  const db = getDb();
  const stamp = now();
  const taken = takenCodes(groupId);
  const start =
    Number((db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM teaching_students WHERE group_id = ?').get(groupId) as Row).p) + 1;
  db.transaction(() => {
    for (let i = 0; i < Math.max(1, count); i++) {
      const code = generatePseudonymCode(taken);
      taken.add(code);
      db.prepare(
        `INSERT INTO teaching_students (id, group_id, given_names, surnames, comments, pseudonym_code, position, created_at, updated_at)
         VALUES (?, ?, '', '', '', ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), groupId, code, start + i, stamp, stamp);
    }
  })();
  return getTeachingGroup(groupId);
}

export function updateTeachingStudent(
  id: string,
  patch: Partial<Pick<TeachingStudent, 'givenNames' | 'surnames' | 'comments' | 'position'>>,
): TeachingStudent {
  const columns: Record<string, string> = {
    givenNames: 'given_names',
    surnames: 'surnames',
    comments: 'comments',
    position: 'position',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof value === 'string' ? value : Number(value));
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(now(), id);
    getDb().prepare(`UPDATE teaching_students SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  const row = getDb().prepare('SELECT * FROM teaching_students WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Alumno no encontrado.');
  return toStudent(row);
}

export function deleteTeachingStudent(id: string): void {
  getDb().prepare('DELETE FROM teaching_students WHERE id = ?').run(id);
}

/**
 * Copies the student rows of another group into this one.
 *
 * A COPY, not a link: teaching two subjects to the same class means two groups whose
 * comments diverge from day one. This exists purely so nobody types thirty names twice.
 * New codes are minted — a code identifies a row in a group, not a person across groups.
 */
export function importStudentsFromGroup(targetGroupId: string, sourceGroupId: string): TeachingGroup {
  const db = getDb();
  const source = db
    .prepare('SELECT * FROM teaching_students WHERE group_id = ? ORDER BY position, rowid')
    .all(sourceGroupId) as Row[];
  const stamp = now();
  const taken = takenCodes(targetGroupId);
  const start =
    Number((db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM teaching_students WHERE group_id = ?').get(targetGroupId) as Row).p) + 1;

  db.transaction(() => {
    source.forEach((row, i) => {
      const code = generatePseudonymCode(taken);
      taken.add(code);
      db.prepare(
        `INSERT INTO teaching_students (id, group_id, given_names, surnames, comments, pseudonym_code, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        targetGroupId,
        String(row.given_names ?? ''),
        String(row.surnames ?? ''),
        code,
        start + i,
        stamp,
        stamp,
      );
    });
  })();
  return getTeachingGroup(targetGroupId);
}

/** The roster in the shape the pseudonymisation layer consumes. */
export function pseudonymStudentsForGroup(groupId: string): PseudonymStudent[] {
  const rows = getDb()
    .prepare('SELECT * FROM teaching_students WHERE group_id = ? ORDER BY position, rowid')
    .all(groupId) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.pseudonym_code),
    givenNames: String(row.given_names ?? ''),
    surnames: String(row.surnames ?? ''),
  }));
}
