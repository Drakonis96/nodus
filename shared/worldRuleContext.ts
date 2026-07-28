/**
 * The prompt and the context for drafting the statement of a law.
 *
 * The whole of "Analizar" is arithmetic over what the author typed, and this is one of the
 * two places where a model is allowed in at all. What it is for is narrow and worth saying
 * out loud: **the blank page**. An author who has written «La sangre paga la sangre» as a
 * title and then stared at an empty field does not need an analysis of their world — they
 * need a first sentence to disagree with.
 *
 * So the model writes ONE field, the statement, and never the price or the limits: those
 * are separate fields precisely because the diagnostics ask a different question of each,
 * and a model that filled all three would be inventing two answers to buy one.
 *
 * Pure, so what the model is actually told can be asserted without a provider, a database
 * or a network.
 */

/** One scene that put the law to the test, as the prompt wants it. */
export interface WorldRuleTest {
  /** The four-word mark, translated: obedece / la dobla / la rompe / la establece. */
  mark: string;
  sceneTitle: string;
  /** What changed, when the author bothered to write it. */
  text: string | null;
  subjectName: string | null;
  /** Rules only, and only for a break: whether the price is on the page. */
  paid: boolean | null;
}

export interface WorldRuleSources {
  title: string;
  hardness: string;
  /** What a breach MEANS under that hardness — a continuity error, a cheat, or a plot. */
  hardnessHint: string;
  /** «Todo el mundo», or the faction or place it governs, by name. */
  scope: string;
  statement: string | null;
  cost: string | null;
  limits: string | null;
  /** The narrower rules hanging off it. A law is defined by what escapes it. */
  exceptions: string[];
  tests: WorldRuleTest[];
  mentions: { title: string; kind: string; summary: string | null }[];
  /** Era names, when the vault has an invented calendar, so no earthly one is assumed. */
  calendar: { eras: string[] } | null;
}

export const WORLD_RULE_SYSTEM = `Redactas el ENUNCIADO de una ley de un mundo de ficción inventado por un autor.

Reglas, sin excepción:
- Lo que consta en el material es CANON. No lo contradigas, no lo "corrijas" y no lo suavices.
- No introduzcas nombres propios (personas, lugares, facciones, objetos) que no aparezcan en el material.
- Copia literalmente los nombres y las fechas tal como los escribe el autor: no los traduzcas, normalices ni conviertas a un calendario terrestre.
- Escribe SOLO el enunciado: qué ocurre siempre, o qué no puede ocurrir nunca. El precio de romperla y sus límites son otros campos de la ficha y NO se escriben aquí.
- Una o dos frases. En presente, en tercera persona y en la voz del mundo, no en la de un manual de juego.
- Si las escenas ya la ponen a prueba, el enunciado tiene que ser compatible con TODAS ellas.
- Empieza directamente por el enunciado: sin preámbulos, sin comillas, sin repetir el título y sin explicar lo que vas a hacer.`;

/**
 * True when there is something to write FROM.
 *
 * A title on its own is not nothing — it is the blank page this feature exists for — but a
 * title in a vault that has never used the law produces a sentence that would fit any
 * fantasy novel, and an author deletes that once and never presses the button again. So one
 * more signal is required: a scope with a name, a line the author started, an exception, a
 * scene that tested it, or a text that mentions it. Every one of them is a click away, and
 * the message that replaces the draft says which.
 */
export function hasWorldRuleMaterial(sources: WorldRuleSources): boolean {
  if (!sources.title.trim()) return false;
  return Boolean(
    (sources.statement ?? '').trim() ||
      (sources.cost ?? '').trim() ||
      (sources.limits ?? '').trim() ||
      sources.exceptions.length > 0 ||
      sources.tests.length > 0 ||
      sources.mentions.length > 0
  );
}

export function composeWorldRuleContext(sources: WorldRuleSources): string {
  const lines: string[] = [];
  lines.push(`LEY: ${sources.title}`);
  lines.push(`DUREZA: ${sources.hardness} — ${sources.hardnessHint}`);
  lines.push(`RIGE SOBRE: ${sources.scope}`);
  if ((sources.statement ?? '').trim()) {
    // What the author already wrote is a draft to improve, never a text to replace: the
    // accepted proposal overwrites this field, so a rewrite that ignored it would quietly
    // delete their sentence.
    lines.push('');
    lines.push(`ENUNCIADO ACTUAL (mejóralo, no lo tires): ${sources.statement!.trim()}`);
  }
  if ((sources.cost ?? '').trim()) lines.push(`LO QUE CUESTA ROMPERLA (otro campo; no lo repitas): ${sources.cost!.trim()}`);
  if ((sources.limits ?? '').trim()) lines.push(`HASTA DÓNDE NO LLEGA (otro campo; no lo repitas): ${sources.limits!.trim()}`);

  if (sources.calendar?.eras.length) {
    lines.push('');
    lines.push(`CALENDARIO DE ESTE MUNDO (no uses ningún otro) — eras: ${sources.calendar.eras.join(', ')}`);
  }

  if (sources.exceptions.length) {
    lines.push('');
    lines.push('EXCEPCIONES QUE YA TIENE (el enunciado no debe contradecirlas):');
    for (const exception of sources.exceptions) lines.push(`- ${exception}`);
  }

  if (sources.tests.length) {
    lines.push('');
    lines.push('CÓMO LA PONE A PRUEBA EL RELATO (es lo que la ley significa de verdad):');
    for (const test of sources.tests) {
      const who = test.subjectName ? `${test.subjectName}: ` : '';
      const price =
        test.paid === false ? ' [el precio NO está en la página]' : test.paid ? ' [el precio se paga]' : '';
      lines.push(`- ${test.sceneTitle} — ${who}${test.mark}${test.text ? `: ${test.text}` : ''}${price}`);
    }
  }

  if (sources.mentions.length) {
    lines.push('');
    lines.push('QUIÉN LA MENCIONA (úsalo; no inventes nada fuera de aquí):');
    for (const mention of sources.mentions) {
      lines.push(`- ${mention.title} (${mention.kind})${mention.summary ? `: ${mention.summary}` : ''}`);
    }
  }

  lines.push('');
  lines.push('Escribe el enunciado de esta ley.');
  return lines.join('\n');
}
