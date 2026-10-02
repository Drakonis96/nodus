/**
 * What a recorded reaction was run with, as the Chemistry Studio worker reads it from an index's
 * conditions table (tools/reaction-index/conditions.py): reagents, catalysts and solvents by name,
 * temperature, time, atmosphere, yield and the reference (a DOI, or the patent for USPTO data).
 * Validated here because it comes from a package, and shortened for a one-line citation.
 */

export interface ReactionConditions {
  /** The recorded reaction it belongs to (an Open Reaction Database id). */
  id: string;
  reagents?: string[];
  catalysts?: string[];
  solvents?: string[];
  temperature?: string;
  time?: string;
  atmosphere?: string;
  /** Percent, 0–100. */
  yield?: number;
  /** "doi:10…", a patent number or a URL. */
  ref?: string;
}

const MAX_PER_ROLE = 4;
const MAX_NAME = 60;
const MAX_TEXT = 40;
const MAX_REF = 160;
/** At most this many recorded reactions' conditions per precedent. */
export const MAX_CONDITIONS = 2;

function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/[\r\n\t|`]+/g, ' ').trim().slice(0, MAX_NAME)).filter(Boolean).slice(0, MAX_PER_ROLE);
  return out.length ? out : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.replace(/[\r\n\t|`]+/g, ' ').trim().slice(0, MAX_TEXT);
  return out || undefined;
}

function reference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ref = value.trim();
  if (ref.length > MAX_REF) return undefined;
  return /^(doi:10\.\S+|https?:\/\/\S+|[A-Z]{2}[0-9A-Z]+)$/.test(ref) ? ref : undefined;
}

/** The package's `conditions` list, kept only where it is well formed; [] when absent. */
export function normalizeReactionConditions(value: unknown, idPattern: RegExp): ReactionConditions[] {
  if (!Array.isArray(value)) return [];
  const out: ReactionConditions[] = [];
  for (const raw of value) {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!item || typeof item.id !== 'string' || !idPattern.test(item.id)) continue;
    const yieldValue = typeof item.yield === 'number' && Number.isFinite(item.yield) && item.yield > 0 && item.yield <= 100 ? Math.round(item.yield * 10) / 10 : undefined;
    const entry: ReactionConditions = {
      id: item.id,
      ...(names(item.reagents) ? { reagents: names(item.reagents) } : {}),
      ...(names(item.catalysts) ? { catalysts: names(item.catalysts) } : {}),
      ...(names(item.solvents) ? { solvents: names(item.solvents) } : {}),
      ...(text(item.temperature) ? { temperature: text(item.temperature) } : {}),
      ...(text(item.time) ? { time: text(item.time) } : {}),
      ...(text(item.atmosphere) ? { atmosphere: text(item.atmosphere) } : {}),
      ...(yieldValue !== undefined ? { yield: yieldValue } : {}),
      ...(reference(item.ref) ? { ref: reference(item.ref) } : {}),
    };
    if (Object.keys(entry).length > 1) out.push(entry);
    if (out.length >= MAX_CONDITIONS) break;
  }
  return out;
}

/** A name for Markdown: a SMILES-like name ("[Na]", "CCO") in a code span, so its brackets and
 *  asterisks stay literal. */
function display(name: string): string {
  return !/\s/.test(name) && /[[\]=#@]/.test(name) ? `\`${name}\`` : name.replace(/([*_[\]])/g, '\\$1');
}

/** "Pd-C, ethanol · 25 °C · 8 h · yield 92% · US05320776": one line, the reagents, catalysts and
 *  solvents first, then what else is known. */
export function conditionsText(conditions: ReactionConditions, withRef = true): string {
  const parts: string[] = [];
  const agents = [...(conditions.reagents ?? []), ...(conditions.catalysts ?? []), ...(conditions.solvents ?? [])];
  if (agents.length) parts.push(agents.map(display).join(', '));
  if (conditions.temperature) parts.push(conditions.temperature);
  if (conditions.time) parts.push(conditions.time);
  if (conditions.atmosphere) parts.push(`${conditions.atmosphere} atmosphere`);
  if (conditions.yield !== undefined) parts.push(`yield ${conditions.yield}%`);
  if (withRef && conditions.ref) parts.push(conditions.ref);
  return parts.join(' · ');
}

/** The same line without Markdown, for the model's evidence payload. */
export function conditionsPlainText(conditions: ReactionConditions): string {
  const parts: string[] = [];
  const agents = [...(conditions.reagents ?? []), ...(conditions.catalysts ?? []), ...(conditions.solvents ?? [])];
  if (agents.length) parts.push(agents.join(', '));
  if (conditions.temperature) parts.push(conditions.temperature);
  if (conditions.time) parts.push(conditions.time);
  if (conditions.atmosphere) parts.push(`${conditions.atmosphere} atmosphere`);
  if (conditions.yield !== undefined) parts.push(`yield ${conditions.yield}%`);
  if (conditions.ref) parts.push(conditions.ref);
  return parts.join(' · ');
}
