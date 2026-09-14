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

export function embeddingTextHash(text: string): string {
  return crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}
