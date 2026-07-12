/**
 * Pure helpers for turning the evidence archive into an active research surface:
 * matching a person's name against a document's text (lexical discovery) and building
 * the text that gets embedded / used as a query (semantic discovery). Kept dependency-
 * free and unit-tested. Both are only ever used to PROPOSE a document↔person link; the
 * user confirms it — the archive never auto-links a document to a person.
 */

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Connectors that carry no identifying weight in a Spanish/Portuguese/generic name.
const NAME_STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'das', 'van', 'von', 'di', 'san', 'santa',
]);

/** Significant, accent/case-folded tokens of a name (connectors dropped). */
export function nameTokens(name: string): string[] {
  return fold(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/** The set of whole-word tokens present in a body of text. */
function textTokenSet(text: string): Set<string> {
  return new Set(
    fold(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Does a person named `name` (with optional spelling `variants`) appear in `text`?
 * Requires the name's significant tokens to be present as whole words — and, for a
 * multi-token name, at least two of them — so a lone common given name ("Juan") in a
 * long document is NOT taken as a match. Returns the matched name form, or null.
 */
export function nameAppearsInText(name: string, variants: string[], text: string): { matched: string } | null {
  if (!text) return null;
  const set = textTokenSet(text);
  for (const candidate of [name, ...variants]) {
    const tokens = nameTokens(candidate);
    if (tokens.length === 0) continue;
    const present = tokens.filter((t) => set.has(t));
    const need = tokens.length === 1 ? 1 : 2;
    if (present.length >= need && present.length === tokens.length) {
      return { matched: candidate };
    }
    // Allow a slightly loose match on long names: all-but-one token present.
    if (tokens.length >= 3 && present.length >= tokens.length - 1) {
      return { matched: candidate };
    }
  }
  return null;
}

export interface ArchiveEmbeddingSource {
  title?: string | null;
  description?: string | null;
  extractedText?: string | null;
  docType?: string | null;
}

/** The text an archive item is embedded from for semantic discovery. */
export function archiveEmbeddingText(item: ArchiveEmbeddingSource): string {
  const parts = [item.title, item.docType, item.description, item.extractedText]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.join('\n').slice(0, 8000);
}

export interface PersonProfileSource {
  name: string;
  variants?: string[];
  birthDate?: string | null;
  deathDate?: string | null;
  events?: { type: string; date: string | null; place: string | null }[];
  places?: string[];
}

/** A person's profile text, used as the query for semantic document discovery. */
export function personProfileText(p: PersonProfileSource): string {
  const lines: string[] = [p.name];
  for (const v of p.variants ?? []) if (v && v !== p.name) lines.push(v);
  if (p.birthDate) lines.push(`nacimiento ${p.birthDate}`);
  if (p.deathDate) lines.push(`defunción ${p.deathDate}`);
  for (const e of (p.events ?? []).slice(0, 30)) {
    lines.push([e.type, e.date, e.place].filter(Boolean).join(' '));
  }
  for (const pl of p.places ?? []) lines.push(pl);
  return lines.filter(Boolean).join('\n').slice(0, 8000);
}
