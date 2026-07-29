// Contrastes: comparar lo que varios testimonios cuentan sobre lo mismo.
//
// LO QUE ESTE MÓDULO NO HACE es tan importante como lo que hace. No decide cuál relato es
// verdadero, no puntúa credibilidad y no resuelve contradicciones. Devuelve fragmentos
// puestos uno al lado de otro, los códigos que comparten y — esto es lo delicado — QUÉ
// ENTREVISTAS NO DIJERON NADA sobre lo buscado, marcado explícitamente como ausencia y no
// como negación. En historia oral el silencio de un narrador es un dato, pero convertirlo
// automáticamente en «no lo vivió» es una conclusión que ningún programa puede firmar.
//
// Todo funciona SIN IA (decisión 17 del plan): los filtros, la vista paralela, la matriz y
// el memo son consultas y texto del investigador. La síntesis asistida, si algún día se
// usa, se convierte en NOTA con sus referencias, nunca en un campo del contraste.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { formatShortId } from '@shared/testimonies';
import { listFragments } from './testimonyAnalysisRepo';
import type {
  TestimonyContrast,
  TestimonyContrastFilters,
  TestimonyContrastInput,
  TestimonyContrastItem,
  TestimonyContrastResult,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface ContrastRow {
  id: string;
  short_id: string;
  title: string;
  filters_json: string;
  memo_markdown: string | null;
  created_at: string;
  updated_at: string;
}

function parseFilters(json: string): TestimonyContrastFilters {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowToContrast(row: ContrastRow, pinned: TestimonyContrastItem[]): TestimonyContrast {
  return {
    id: row.id,
    shortId: row.short_id,
    title: row.title,
    filters: parseFilters(row.filters_json),
    memoMarkdown: row.memo_markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned,
  };
}

function nextShortId(): string {
  const row = getDb()
    .prepare("SELECT short_id FROM testimony_contrasts WHERE short_id LIKE 'CTR-%' ORDER BY LENGTH(short_id) DESC, short_id DESC LIMIT 1")
    .get() as { short_id: string } | undefined;
  const last = row ? Number(row.short_id.slice(4)) : 0;
  return formatShortId('CTR', (Number.isFinite(last) ? last : 0) + 1);
}

function itemsFor(contrastId: string): TestimonyContrastItem[] {
  return (getDb()
    .prepare('SELECT contrast_id, annotation_id, position, note FROM testimony_contrast_items WHERE contrast_id = ? ORDER BY position')
    .all(contrastId) as { contrast_id: string; annotation_id: string; position: number; note: string | null }[])
    .map((row) => ({ contrastId: row.contrast_id, annotationId: row.annotation_id, position: row.position, note: row.note }));
}

export function listContrasts(): TestimonyContrast[] {
  const rows = getDb().prepare('SELECT * FROM testimony_contrasts ORDER BY updated_at DESC').all() as ContrastRow[];
  return rows.map((row) => rowToContrast(row, itemsFor(row.id)));
}

export function getContrast(id: string): TestimonyContrast | null {
  const row = getDb().prepare('SELECT * FROM testimony_contrasts WHERE id = ?').get(id) as ContrastRow | undefined;
  return row ? rowToContrast(row, itemsFor(id)) : null;
}

export function createContrast(input: TestimonyContrastInput): TestimonyContrast {
  const id = `ctr_${uuid()}`;
  const ts = now();
  getDb()
    .prepare('INSERT INTO testimony_contrasts (id, short_id, title, filters_json, memo_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, nextShortId(), input.title.trim() || 'Contraste', JSON.stringify(input.filters ?? {}), input.memoMarkdown ?? null, ts, ts);
  return getContrast(id)!;
}

export function updateContrast(id: string, patch: Partial<TestimonyContrastInput>): TestimonyContrast | null {
  const existing = getContrast(id);
  if (!existing) return null;
  getDb()
    .prepare('UPDATE testimony_contrasts SET title = ?, filters_json = ?, memo_markdown = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
      JSON.stringify(patch.filters ?? existing.filters),
      patch.memoMarkdown !== undefined ? patch.memoMarkdown : existing.memoMarkdown,
      now(),
      id
    );
  return getContrast(id);
}

export function deleteContrast(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM testimony_contrast_items WHERE contrast_id = ?').run(id);
    db.prepare("DELETE FROM testimony_note_links WHERE target_kind = 'testimony_contrast' AND target_id = ?").run(id);
    db.prepare('DELETE FROM testimony_contrasts WHERE id = ?').run(id);
  });
  tx();
}

/** Fijar o soltar un fragmento. Fijar es lo que convierte una consulta en un argumento. */
export function pinFragment(contrastId: string, annotationId: string, pinned: boolean): TestimonyContrast | null {
  const db = getDb();
  if (pinned) {
    const position = (db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM testimony_contrast_items WHERE contrast_id = ?')
      .get(contrastId) as { n: number }).n;
    db.prepare('INSERT OR IGNORE INTO testimony_contrast_items (contrast_id, annotation_id, position, note, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(contrastId, annotationId, position, now());
  } else {
    db.prepare('DELETE FROM testimony_contrast_items WHERE contrast_id = ? AND annotation_id = ?').run(contrastId, annotationId);
  }
  db.prepare('UPDATE testimony_contrasts SET updated_at = ? WHERE id = ?').run(now(), contrastId);
  return getContrast(contrastId);
}

export function reorderItems(contrastId: string, annotationIds: string[]): TestimonyContrast | null {
  const db = getDb();
  const tx = db.transaction(() => {
    const update = db.prepare('UPDATE testimony_contrast_items SET position = ? WHERE contrast_id = ? AND annotation_id = ?');
    annotationIds.forEach((annotationId, index) => update.run(index, contrastId, annotationId));
    db.prepare('UPDATE testimony_contrasts SET updated_at = ? WHERE id = ?').run(now(), contrastId);
  });
  tx();
  return getContrast(contrastId);
}

export function setItemNote(contrastId: string, annotationId: string, note: string | null): TestimonyContrast | null {
  getDb()
    .prepare('UPDATE testimony_contrast_items SET note = ? WHERE contrast_id = ? AND annotation_id = ?')
    .run(note, contrastId, annotationId);
  return getContrast(contrastId);
}

/**
 * Ejecutar un contraste.
 *
 * `sharedCodeIds` son los códigos que aparecen en TODAS las entrevistas seleccionadas —
 * no en varias: en todas. Es la definición estricta a propósito, porque un «código
 * compartido» que en realidad solo está en dos de cinco entrevistas invita a escribir
 * una generalización que el material no sostiene.
 *
 * `silentInterviewIds` son las entrevistas seleccionadas que no aportan ni un fragmento.
 * Se devuelven por separado y sin adjetivo: que un narrador no hablara de algo puede
 * significar que no lo vivió, que no se le preguntó o que decidió no contarlo, y las tres
 * cosas se parecen mucho en una base de datos.
 */
export function runContrast(filters: TestimonyContrastFilters): TestimonyContrastResult {
  const fragments = listFragments(filters);
  const selected = filters.interviewIds ?? [...new Set(fragments.map((fragment) => fragment.interviewId))];

  const byInterview = new Map<string, Set<string>>();
  const matrixCounts = new Map<string, number>();
  for (const fragment of fragments) {
    const set = byInterview.get(fragment.interviewId) ?? new Set<string>();
    for (const code of fragment.codes) {
      set.add(code.id);
      const key = `${code.id}::${fragment.interviewId}`;
      matrixCounts.set(key, (matrixCounts.get(key) ?? 0) + 1);
    }
    byInterview.set(fragment.interviewId, set);
  }

  const sharedCodeIds = selected.length > 1
    ? [...(byInterview.get(selected[0]) ?? [])].filter((codeId) =>
        selected.every((interviewId) => byInterview.get(interviewId)?.has(codeId)))
    : [];

  const withFragments = new Set(fragments.map((fragment) => fragment.interviewId));
  const silentInterviewIds = selected.filter((id) => !withFragments.has(id));

  const matrix = [...matrixCounts.entries()].map(([key, count]) => {
    const [codeId, interviewId] = key.split('::');
    return { codeId, interviewId, count };
  });

  return { fragments, sharedCodeIds, silentInterviewIds, matrix };
}
