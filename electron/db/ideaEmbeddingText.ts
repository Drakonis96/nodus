import crypto from 'node:crypto';

/**
 * The canonical text an idea is embedded from, and its content hash.
 *
 * Kept in its own module rather than `ideasRepo` so the database layer can register
 * the exact same computation as a SQL function (for readiness filters) without
 * importing the repository that depends on the database connection. Any change here
 * changes what counts as a "current" embedding everywhere.
 */
export function embeddingTextForIdea(input: {
  type?: string | null;
  label: string;
  statement: string;
  themes?: string[] | null;
}): string {
  const parts = [
    input.type ? `tipo: ${input.type}` : '',
    `etiqueta: ${input.label}`,
    `enunciado: ${input.statement}`,
    input.themes?.length ? `temas: ${input.themes.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * The theme labels an idea is embedded with, as SQL over an `ideas i` row. The pipeline,
 * the readiness filters and the reprocess pass must read the very same string (label
 * order included), or a theme rewrite that changes the embedded text goes unnoticed.
 */
export const IDEA_EMBEDDING_THEME_LABELS_SQL = `COALESCE((
  SELECT GROUP_CONCAT(DISTINCT t.label)
  FROM idea_theme_links it
  JOIN themes t ON t.theme_id = it.theme_id
  WHERE it.global_id = i.global_id
), '')`;

export function embeddingTextHash(text: string): string {
  return crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}
