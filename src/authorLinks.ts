/**
 * Matching bylines to author records.
 *
 * A work's byline and the author's own record rarely agree letter for letter: the
 * bibliography abbreviates the given name, the record keeps it whole. This is the
 * one place that reconciles the two, so the citation workspace can turn a printed
 * name into a link to the person.
 */
import type { AuthorSummary } from '@shared/types';

export interface AuthorIndex {
  /** Exact matches on either stored form of the name. */
  byName: Map<string, AuthorSummary>;
  /**
   * Surname plus the initial of the given name. Bibliographies abbreviate ("García
   * Simón, A.") where the author record keeps the full given name, so the exact form
   * never matches. Names that collapse onto the same key are dropped rather than
   * guessed: sending a reader to the wrong author is worse than plain text.
   */
  byInitial: Map<string, AuthorSummary | null>;
}

export function buildAuthorIndex(authors: AuthorSummary[]): AuthorIndex {
  const byName = new Map<string, AuthorSummary>();
  const byInitial = new Map<string, AuthorSummary | null>();
  for (const author of authors) {
    byName.set(normalizeAuthorName(author.name), author);
    byName.set(normalizeAuthorName(author.fullName), author);
    for (const key of [initialKey(author.firstName, author.lastName), initialKeyFromDisplay(author.name), initialKeyFromDisplay(author.fullName)]) {
      if (!key) continue;
      const seen = byInitial.get(key);
      if (seen === undefined) byInitial.set(key, author);
      else if (seen && seen.author_id !== author.author_id) byInitial.set(key, null);
    }
  }
  return { byName, byInitial };
}

export function lookupAuthor(index: AuthorIndex, name: string): AuthorSummary | null {
  const exact = index.byName.get(normalizeAuthorName(name));
  if (exact) return exact;
  const key = initialKeyFromDisplay(name);
  return key ? index.byInitial.get(key) ?? null : null;
}

/** "Jesús" + "Cabornero Domingo" → "j|cabornero domingo". */
function initialKey(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  const given = plainAuthorText(firstName ?? '');
  const family = plainAuthorText(lastName ?? '');
  if (!given || !family) return null;
  return `${given[0]}|${family}`;
}

/**
 * The same key from a byline as printed, where the split has to be guessed: the
 * comma marks it when there is one, otherwise the first word is the given name.
 */
function initialKeyFromDisplay(value: string): string | null {
  const plain = plainAuthorText(value.replace(/,/g, ' , '));
  if (!plain) return null;
  if (plain.includes(' , ')) {
    const [family, given] = plain.split(' , ', 2).map((part) => part.trim());
    return initialKey(given, family);
  }
  const parts = plain.split(' ');
  if (parts.length < 2) return null;
  return initialKey(parts[0], parts.slice(1).join(' '));
}

function plainAuthorText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9, ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAuthorName(value: string): string {
  const plain = plainAuthorText(value);
  if (!plain.includes(',')) return plain;
  const [last, first] = plain.split(',', 2).map((part) => part.trim());
  return `${first} ${last}`.trim();
}
