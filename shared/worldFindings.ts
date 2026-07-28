/**
 * A finding, and the silence that outlives it.
 *
 * THERE IS NO FINDINGS TABLE. A contradiction is a pure function of the vault, recomputed
 * whole every time the screen opens: a stored finding is a second truth that survives its
 * own correction, and the writer then fixes a date and keeps being told about it. What
 * DOES persist is what the author has decided to stop hearing about — and that is one book
 * for all five sections, not one per section.
 *
 * The fingerprint is the whole design in one line, so read it carefully:
 *
 *   `${checkId}|${subject},${subject},…`   with the subjects SORTED and NO NUMBERS.
 *
 *  1. Idempotent between runs: muting the same thing overwrites its own row instead of
 *     accumulating rows — and, with a content-derived primary key, tombstones.
 *  2. It converges across machines: silencing the same thing twice yields ONE row.
 *  3. It carries no figures. If the fingerprint held "day 412", changing the date to 411
 *     would resurrect an exception the author already judged; and worse, a DIFFERENT
 *     contradiction between the same two facts would arrive pre-silenced. The subjects are
 *     the identity of the problem; the numbers are its symptom.
 */

import type { WorldFinding, WorldFindingText, WorldNoticeMute } from './types';

export type FindingFamily =
  | 'presence'
  | 'lifespan'
  | 'travel'
  | 'affiliation'
  | 'secret'
  | 'containment'
  | 'calendar'
  | 'thread'
  | 'rule'
  | 'manuscript';

export interface FindingSubject {
  kind: string;
  id: string;
  title: string;
  /** Which field of the sheet, when the finding is about one. */
  field?: string;
}

export const FINDING_FAMILY_LABEL: Record<FindingFamily, string> = {
  presence: 'Presencia',
  lifespan: 'Vida y muerte',
  travel: 'Viajes',
  affiliation: 'Pertenencias',
  secret: 'Secretos',
  containment: 'Lugares',
  calendar: 'Calendario',
  thread: 'Conflictos y arcos',
  rule: 'Reglas',
  manuscript: 'Manuscrito',
};

export const MUTE_REASON_LABEL: Record<string, string> = {
  double: 'Tiene un doble',
  told: 'Se lo contaron',
  deliberate: 'Es a propósito',
  unknown: 'Todavía no lo sé',
};

/** `kind:id` or `kind:id#field` — the addressable half of a subject. */
export function subjectKey(subject: FindingSubject): string {
  return subject.field ? `${subject.kind}:${subject.id}#${subject.field}` : `${subject.kind}:${subject.id}`;
}

export function fingerprintOf(checkId: string, subjects: FindingSubject[]): string {
  // Sorted, so the same pair of characters fingerprints the same however the check
  // happened to iterate them.
  return `${checkId}|${subjects.map(subjectKey).sort().join(',')}`;
}

export function makeFinding(
  checkId: string,
  family: FindingFamily,
  severity: WorldFinding['severity'],
  headline: WorldFindingText,
  subjects: FindingSubject[],
  detail?: WorldFindingText | null
): WorldFinding & { family: FindingFamily } {
  return {
    checkId,
    family,
    severity,
    headline,
    detail: detail ?? null,
    subjects,
    fingerprint: fingerprintOf(checkId, subjects),
  };
}

/**
 * Drop what the author has silenced.
 *
 * Two scopes: a mute on a single finding, and a mute on a whole check for this world. The
 * second is a ROW rather than a setting because it has to travel with the world — a
 * writer who turned off "impossible journeys" on their laptop should not be shouted at by
 * their desktop.
 */
export function applyMutes<T extends WorldFinding>(findings: T[], mutes: WorldNoticeMute[]): T[] {
  const silenced = new Set(mutes.filter((mute) => mute.scope === 'finding').map((mute) => mute.fingerprint));
  const checksOff = new Set(mutes.filter((mute) => mute.scope === 'check').map((mute) => mute.checkId));
  return findings.filter((finding) => !silenced.has(finding.fingerprint) && !checksOff.has(finding.checkId));
}

/**
 * The findings that touch one entity — what the badge on a sheet shows.
 *
 * The same pure function over the snapshot the screen already loaded, so a badge costs no
 * second round of IPC. It is also why `checkCharacterCoherence` stops painting itself on
 * the character sheet: two renderings of the same problem, in two wordings, teaches a
 * writer that the app does not know what it thinks.
 */
export function findingsFor<T extends WorldFinding>(
  ref: { kind: string; id: string },
  findings: T[]
): T[] {
  return findings.filter((finding) =>
    finding.subjects.some((subject) => subject.kind === ref.kind && subject.id === ref.id)
  );
}

/** Counted by severity, for the badge and the empty state. */
export function countBySeverity(findings: WorldFinding[]): Record<WorldFinding['severity'], number> {
  const counts: Record<WorldFinding['severity'], number> = { contradiction: 0, warning: 0, gap: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Order for the list: contradictions first, then by family, then by headline.
 *
 * NOT by "how many entities it touches" or any other invented weight — a writer reads this
 * top to bottom, and a ranking they cannot predict makes them read all of it every time.
 */
const SEVERITY_ORDER: Record<WorldFinding['severity'], number> = { contradiction: 0, warning: 1, gap: 2 };

export function sortFindings<T extends WorldFinding>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.checkId.localeCompare(b.checkId) ||
      a.headline.key.localeCompare(b.headline.key)
  );
}
