/**
 * The world chat: what the model is told, and what is read back out of it.
 *
 * This is designed KNOWING the other five sections exist, and that changes what it is.
 * **The chat does not reason about the world — Nodus calculates and the model writes.**
 * Which laws reach somebody, where they were on a given day, what moves in a scene, what
 * contradicts what, who knew a secret: every one of those is already a pure function over
 * the vault, and every one of them is arithmetic a model would get subtly and confidently
 * wrong. So they arrive as CALCULATED facts, and the system prompt says in one line that
 * they are not up for discussion.
 *
 * Three rules and no more, because a system prompt with fifteen is a system prompt whose
 * fifteenth is ignored:
 *
 *  1. The CALCULADO blocks are facts of Nodus: neither argued with nor recomputed.
 *  2. Every claim about the world carries its link.
 *  3. If the material does not contain the answer, say so — do not invent a plausible world.
 *
 * Pure, so all of it — the composition, the citation validator, the focus matcher — is
 * tested without a provider, a database or a renderer.
 */

import { normalizeForSearch } from './worldFilters';
import type { WorldFindingText } from './types';

export interface WorldChatRef {
  kind: string;
  id: string;
  title: string;
}

export interface WorldChatFacts {
  question: string;
  /** What the question is about. Resolved by the repo; never the whole vault. */
  focus: WorldChatRef[];
  /** The sheets' own words, verbatim. Canon, and the only prose here. */
  prose: { ref: WorldChatRef; field: string; text: string }[];
  /** CALCULATED BY NODUS. Not by the model, and not from the prose above. */
  computed: {
    effectiveRules?: { rule: string; ruleId: string; scope: string; overriddenBy: string[] }[];
    presenceAt?: { personName: string; placeName: string; worldDay: number | null }[];
    memberships?: { personName: string; groupName: string; fromWorldDay: number | null; toWorldDay: number | null }[];
    beatsAtScene?: { sceneTitle: string; threadTitle: string; mark: string; text: string | null }[];
    findings?: { headline: string; severity: string; subjects: string[] }[];
    knowersAt?: { secretTitle: string; people: string[]; worldDay: number | null }[];
  };
  /** Everything the answer is allowed to link to, with the link already written out. */
  citable: WorldChatRef[];
  /** The day the question named, when it named one. */
  worldDay: number | null;
}

export const WORLD_CHAT_SYSTEM = `Respondes preguntas sobre un mundo de ficción usando SOLO el material que se te da.

Tres reglas, sin excepción:
1. Los bloques marcados CALCULADO POR NODUS son hechos ya computados sobre el mundo del autor: no los discutas, no los recalcules y no los "corrijas". Si tu razonamiento no cuadra con ellos, el equivocado eres tú.
2. Toda afirmación sobre el mundo lleva su enlace, copiado tal cual de la lista CÓMO SE CITA: [Título](nodus://world/tipo/id). No te inventes enlaces ni ids.
3. Si el material no contiene la respuesta, dilo con esa misma claridad y di qué haría falta. No rellenes el hueco con un mundo verosímil.

Responde en la lengua de la pregunta, breve y directo, sin preámbulos y sin repetir la pregunta.`;

/** `{count}` and friends, substituted the way `tx()` does it in the renderer. The prompt is
 *  Spanish, and a finding's i18n key IS its Spanish sentence, so no translation is lost. */
export function plainFindingText(text: WorldFindingText): string {
  return Object.entries(text.vars ?? {}).reduce(
    (sentence, [name, value]) => sentence.replaceAll(`{${name}}`, value),
    text.key
  );
}

/**
 * The day the question is asking about.
 *
 * Read here rather than left to the model because everything downstream — which laws were
 * in force, who belonged to what, who knew the secret — is arithmetic ON that number, and a
 * model that reads «el día 4 120» as 4 is confidently wrong about all five. Thousands are
 * written with a space or a dot in Spanish, so both are accepted; when nothing is named the
 * answer is null and the context says the facts are listed without a date.
 */
export function readWorldDay(question: string): number | null {
  const match = /\bd[ií]a\s+(\d{1,3}(?:[.\s]\d{3})*|\d+)/i.exec(question ?? '');
  if (!match) return null;
  const digits = match[1].replace(/[.\s]/g, '');
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** A name is worth matching when it is long enough not to hit half the language. */
const MIN_NAME = 3;

/**
 * Which entries the question is about.
 *
 * Whole-word containment over folded text: «Vaël» in the question finds «Vael» the city,
 * and «vaelense» does not. Longest name first, so «Kaelen Vor» wins over a character called
 * «Vor» rather than both arriving and the focus filling up with the wrong one.
 */
export function matchFocus(
  question: string,
  entries: { key: string; names: string[] }[],
  limit = 6
): string[] {
  const haystack = ` ${normalizeForSearch(question ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const hits: { key: string; name: string }[] = [];
  for (const entry of entries) {
    let best = '';
    for (const name of entry.names) {
      const folded = normalizeForSearch(name ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (folded.length < MIN_NAME || !haystack.includes(` ${folded} `)) continue;
      if (folded.length > best.length) best = folded;
    }
    if (best) hits.push({ key: entry.key, name: best });
  }

  // Longest first, and a name CONTAINED in a longer accepted one is dropped rather than
  // ranked below it: «Kaelen Vor» in the question is not a mention of the character called
  // «Vor», and letting both in fills the focus — and the model's window — with a sheet
  // nobody asked about. Equal-length names never suppress each other: two things really
  // can share a name.
  const accepted: { key: string; name: string }[] = [];
  for (const hit of [...hits].sort((a, b) => b.name.length - a.name.length)) {
    if (accepted.some((other) => other.name.length > hit.name.length && other.name.includes(hit.name))) continue;
    accepted.push(hit);
    if (accepted.length >= limit) break;
  }
  return accepted.map((hit) => hit.key);
}

/**
 * True when there is anything at all to answer from.
 *
 * A question that names nothing in the world gets «no sé de qué me hablas» rather than an
 * answer, and that is the feature: this chat sees the focus and its computed facts, never
 * the whole vault, so a question it cannot anchor is one it cannot ground either.
 */
export function hasWorldChatMaterial(facts: WorldChatFacts): boolean {
  const computed = Object.values(facts.computed).some((value) => Array.isArray(value) && value.length > 0);
  return facts.prose.length > 0 || computed;
}

function worldLink(ref: WorldChatRef): string {
  return `[${ref.title}](nodus://world/${ref.kind}/${encodeURIComponent(ref.id)})`;
}

export function composeWorldChatContext(facts: WorldChatFacts): string {
  const lines: string[] = [];
  lines.push(`PREGUNTA: ${facts.question.trim()}`);
  if (facts.focus.length) {
    lines.push(`SOBRE: ${facts.focus.map((ref) => ref.title).join(' · ')}`);
  }
  lines.push(
    facts.worldDay != null
      ? `DÍA DEL MUNDO: ${facts.worldDay}`
      : 'DÍA DEL MUNDO: sin concretar — los hechos van con su vigencia, no en una fecha.'
  );

  if (facts.prose.length) {
    lines.push('');
    lines.push('── LO QUE DICEN LAS FICHAS (palabras del autor; es canon) ──');
    for (const block of facts.prose) {
      lines.push(`[${block.ref.title} · ${block.field}]`);
      lines.push(block.text.trim());
      lines.push('');
    }
  }

  const computed: string[] = [];
  const push = (heading: string, rows: string[]) => {
    if (!rows.length) return;
    computed.push(heading);
    computed.push(...rows.map((row) => `- ${row}`));
  };

  push(
    'LEYES QUE ALCANZAN AL FOCO:',
    (facts.computed.effectiveRules ?? []).map(
      (rule) =>
        `${rule.rule} (rige sobre ${rule.scope})${
          rule.overriddenBy.length ? ` — pero la muerde: ${rule.overriddenBy.join('; ')}` : ''
        }`
    )
  );
  push(
    'DÓNDE ESTABA CADA CUAL:',
    (facts.computed.presenceAt ?? []).map(
      (entry) => `${entry.personName}: ${entry.placeName}${entry.worldDay != null ? ` (día ${entry.worldDay})` : ''}`
    )
  );
  push(
    'A QUÉ PERTENECÍA CADA CUAL:',
    (facts.computed.memberships ?? []).map((entry) => {
      const from = entry.fromWorldDay != null ? `desde el día ${entry.fromWorldDay}` : null;
      const to = entry.toWorldDay != null ? `hasta el día ${entry.toWorldDay}` : null;
      const window = [from, to].filter(Boolean).join(' ');
      return `${entry.personName} — ${entry.groupName}${window ? ` (${window})` : ''}`;
    })
  );
  push(
    'LO QUE SE MUEVE EN LA ESCENA:',
    (facts.computed.beatsAtScene ?? []).map(
      (beat) => `${beat.sceneTitle} — ${beat.threadTitle}: ${beat.mark}${beat.text ? `: ${beat.text}` : ''}`
    )
  );
  push(
    'QUIÉN SABÍA QUÉ:',
    (facts.computed.knowersAt ?? []).map(
      (entry) =>
        `${entry.secretTitle}: ${entry.people.length ? entry.people.join(', ') : 'nadie'}${
          entry.worldDay != null ? ` (día ${entry.worldDay})` : ''
        }`
    )
  );
  push(
    'LO QUE YA CHOCA (continuidad):',
    (facts.computed.findings ?? []).map(
      (finding) => `${finding.headline} [${finding.severity}] — ${finding.subjects.join(', ')}`
    )
  );

  if (computed.length) {
    lines.push('── CALCULADO POR NODUS (hechos; no los discutas ni los recalcules) ──');
    lines.push(...computed);
    lines.push('');
  }

  if (facts.citable.length) {
    lines.push('── CÓMO SE CITA CADA COSA (copia el enlace tal cual) ──');
    for (const ref of facts.citable) lines.push(`- ${ref.title} → ${worldLink(ref)}`);
    lines.push('');
  }

  lines.push('Responde la pregunta con este material y nada más.');
  return lines.join('\n');
}

// ── Reading the answer back ──────────────────────────────────────────────────

const WORLD_LINK_RE = /\[([^\]\n]*)\]\(nodus:\/\/world\/([a-z]+)\/([^)\s]+)\)/g;

/**
 * Degrade the links the model made up to plain text.
 *
 * A citation is a promise that clicking it opens something, and one invented id turns the
 * whole answer into a thing the reader has to double-check — which is worse than an answer
 * with no links at all. The label survives, because the sentence is usually right even when
 * the id is not; only the promise is withdrawn.
 */
export function validateCitations(text: string, allowed: Set<string>): string {
  return (text ?? '').replace(WORLD_LINK_RE, (whole, label: string, kind: string, id: string) => {
    let decoded = id;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      // A hand-mangled `%` must not take the whole answer down.
    }
    return allowed.has(`${kind}:${decoded}`) ? whole : label;
  });
}
