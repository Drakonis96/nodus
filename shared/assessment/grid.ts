/**
 * Gradebook → database grid adapter.
 *
 * The database vault's machinery — the formula engine, filters, sorting, the
 * statistics, the four SVG charts, CSV/XLSX export — is written against
 * `(DatabaseColumn[], DatabaseRow[])` and not against a database id. That means the
 * gradebook does not need any of it rebuilt: it needs ONE function that presents a
 * plan, its items and its marks in that shape, and everything downstream works.
 *
 * A deliberate constraint: this module is pure and one-directional. It renders a
 * gradebook AS a grid; it never writes back. Edits go through the repo, keyed on
 * (student, item, convocatoria), and the grid is re-derived. Trying to make the
 * adapter bidirectional would smuggle the EAV model's assumptions into a gradebook
 * whose rows are students, not free-form records.
 */
import type { DatabaseColumn, DatabaseRow } from '../databases';
import type { AssessmentItem, AssessmentPlan, CohortStats, GradeEntry } from './model';
import { computeGrade } from './engine';

/** The subset of a student a grid row needs. Keeps this module free of teachingGroups. */
export interface GridStudent {
  id: string;
  givenNames: string;
  surnames: string;
  pseudonymCode: string;
  position: number;
}

export interface GradebookGrid {
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  /** studentId → the full derivation, for the "why this grade?" panel. */
  results: Record<string, ReturnType<typeof computeGrade>>;
}

/** Synthetic column ids. Prefixed so they can never collide with a real item id. */
export const GRID_COL = {
  code: '__code__',
  givenNames: '__given__',
  surnames: '__surnames__',
  final: '__final__',
  qualitative: '__qualitative__',
} as const;

const ISO = '1970-01-01T00:00:00.000Z';

function column(
  id: string,
  name: string,
  type: DatabaseColumn['type'],
  position: number,
  config: DatabaseColumn['config'] = {},
): DatabaseColumn {
  return { id, databaseId: '__gradebook__', name, type, position, config, options: [] };
}

/**
 * Leaves become columns; blocks become columns too, because a teacher wants to see the
 * block subtotal next to the parts that made it. Ordered by a depth-first walk so the
 * grid reads in the same order as the plan.
 */
export function gradableColumns(items: AssessmentItem[]): AssessmentItem[] {
  const byParent = new Map<string | null, AssessmentItem[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  const out: AssessmentItem[] = [];
  const walk = (parentId: string | null) => {
    for (const item of (byParent.get(parentId) ?? []).slice().sort((a, b) => a.position - b.position)) {
      const children = byParent.get(item.id) ?? [];
      // Children first, then the block itself: the subtotal reads after its parts.
      if (children.length > 0) walk(item.id);
      out.push(item);
    }
  };
  walk(null);
  return out;
}

function findNode(trace: ReturnType<typeof computeGrade>['trace'], itemId: string): { fraction: number | null; points: number | null } | null {
  if (!trace) return null;
  if (trace.itemId === itemId) return { fraction: trace.fraction, points: trace.points };
  for (const child of trace.children) {
    const hit = findNode(child, itemId);
    if (hit) return hit;
  }
  return null;
}

export interface GradebookGridInput {
  plan: AssessmentPlan;
  items: AssessmentItem[];
  entries: GradeEntry[];
  students: GridStudent[];
  cohort?: CohortStats;
  track?: 'continua' | 'no_continua';
  /** studentId → itemId → previously achieved fraction, for the ratchet rule. */
  previous?: Record<string, Record<string, number>>;
  convocatoria?: string;
  /** Hide the identifier column when pseudonymisation is off. */
  showCodes?: boolean;
  /**
   * Display names for the synthetic columns.
   *
   * Injected rather than hardcoded because these names are not only painted: they are
   * also the header row of every CSV/XLSX export, so they have to follow the user's
   * language rather than this module's. Defaults are Spanish, the source language.
   */
  labels?: Partial<Record<'code' | 'givenNames' | 'surnames' | 'grade', string>>;
}

export function gradebookToGrid(input: GradebookGridInput): GradebookGrid {
  const { plan, items, students } = input;
  const gradable = gradableColumns(items);
  const decimals = plan.rules.decimals;

  const labels = {
    code: 'Identificador', givenNames: 'Nombre', surnames: 'Apellidos', grade: 'Calificación',
    ...input.labels,
  };
  const columns: DatabaseColumn[] = [];
  let position = 0;
  if (input.showCodes !== false) {
    columns.push(column(GRID_COL.code, labels.code, 'text', position++, { width: 110 }));
  }
  columns.push(column(GRID_COL.givenNames, labels.givenNames, 'text', position++, { width: 150 }));
  columns.push(column(GRID_COL.surnames, labels.surnames, 'text', position++, { width: 180 }));

  for (const item of gradable) {
    const isBlock = items.some((child) => child.parentId === item.id);
    columns.push(
      column(item.id, item.name || '—', 'number', position++, {
        numberFormat: decimals === 0 ? 'integer' : 'decimal',
        width: isBlock ? 110 : 90,
      }),
    );
  }

  // The record the plan actually emits. A qualitative-only plan gets no number here,
  // which is the whole point of the projection layer.
  if (plan.rules.record !== 'qualitative') {
    columns.push(column(GRID_COL.final, labels.grade, 'number', position++, {
      numberFormat: decimals === 0 ? 'integer' : 'decimal',
      width: 110,
    }));
  }
  if (plan.rules.record !== 'numeric') {
    columns.push(column(GRID_COL.qualitative, labels.grade, 'text', position++, { width: 110 }));
  }

  const entriesByStudent = new Map<string, GradeEntry[]>();
  for (const entry of input.entries) {
    const list = entriesByStudent.get(entry.studentId) ?? [];
    list.push(entry);
    entriesByStudent.set(entry.studentId, list);
  }

  const results: GradebookGrid['results'] = {};
  const rows: DatabaseRow[] = students
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((student, index) => {
      const result = computeGrade({
        plan,
        items,
        entries: entriesByStudent.get(student.id) ?? [],
        cohort: input.cohort,
        track: input.track,
        previous: input.previous?.[student.id],
      });
      results[student.id] = result;

      const cells: Record<string, string | null> = {
        [GRID_COL.code]: student.pseudonymCode,
        [GRID_COL.givenNames]: student.givenNames || null,
        [GRID_COL.surnames]: student.surnames || null,
      };
      for (const item of gradable) {
        const node = findNode(result.trace, item.id);
        // Blocks show their computed subtotal on the plan's scale; leaves show what
        // was actually typed, so a teacher always recognises their own number.
        const isBlock = items.some((child) => child.parentId === item.id);
        const value = isBlock
          ? node?.fraction == null ? null : node.fraction * plan.rules.scaleMax
          : node?.points ?? null;
        cells[item.id] = value == null ? null : String(round(value, decimals));
      }
      cells[GRID_COL.final] = result.record.numeric == null ? null : String(result.record.numeric);
      cells[GRID_COL.qualitative] = result.record.qualitative;

      return {
        id: student.id,
        databaseId: '__gradebook__',
        position: index,
        cells,
        createdAt: ISO,
        updatedAt: ISO,
      };
    });

  return { columns, rows, results };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Strips the identifying columns, for anything that leaves the machine.
 *
 * Analysis and AI features work on marks, not on names: handing them the roster
 * columns would leak minors' names into a payload for no analytical gain.
 */
export function anonymousGrid(grid: GradebookGrid): { columns: DatabaseColumn[]; rows: DatabaseRow[] } {
  // Dropped by ID, never by name: the names are translated and would stop matching.
  const drop = new Set<string>([GRID_COL.givenNames, GRID_COL.surnames]);
  const columns = grid.columns.filter((c) => !drop.has(c.id));
  const rows = grid.rows.map((row) => {
    const cells: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(row.cells)) if (!drop.has(key)) cells[key] = value;
    return { ...row, cells };
  });
  return { columns, rows };
}
