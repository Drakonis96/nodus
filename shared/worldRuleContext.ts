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

import type { AppLanguage } from './types';
import { normalizeUiLanguage, worldBeatMarkLabel, worldEntryKindLabel, worldRuleHardnessHint, worldRuleHardnessLabel, worldRuleScopeLabel } from './worldPromptLanguage';
import { worldOperationSystemPrompt } from './worldOperationPrompts';

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

/** Localized system contract for direct users of this pure context module. */
export function worldRuleSystemPrompt(language: AppLanguage = 'es'): string {
  return worldOperationSystemPrompt('ruleDraft', normalizeUiLanguage(language));
}

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

export function composeWorldRuleContext(sources: WorldRuleSources, language: AppLanguage = 'es'): string {
  const locale = normalizeUiLanguage(language);
  const copy = RULE_CONTEXT_COPY[locale];
  const lines: string[] = [];
  lines.push(`${copy.law}: ${sources.title}`);
  lines.push(`${copy.hardness}: ${worldRuleHardnessLabel(sources.hardness, locale)} — ${worldRuleHardnessHint(sources.hardnessHint, locale)}`);
  lines.push(`${copy.scope}: ${worldRuleScopeLabel(sources.scope, locale)}`);
  if ((sources.statement ?? '').trim()) {
    // What the author already wrote is a draft to improve, never a text to replace: the
    // accepted proposal overwrites this field, so a rewrite that ignored it would quietly
    // delete their sentence.
    lines.push('');
    lines.push(`${copy.currentStatement}: ${sources.statement!.trim()}`);
  }
  if ((sources.cost ?? '').trim()) lines.push(`${copy.cost}: ${sources.cost!.trim()}`);
  if ((sources.limits ?? '').trim()) lines.push(`${copy.limits}: ${sources.limits!.trim()}`);

  if (sources.calendar?.eras.length) {
    lines.push('');
    lines.push(`${copy.calendar} — ${copy.eras}: ${sources.calendar.eras.join(', ')}`);
  }

  if (sources.exceptions.length) {
    lines.push('');
    lines.push(copy.exceptions);
    for (const exception of sources.exceptions) lines.push(`- ${exception}`);
  }

  if (sources.tests.length) {
    lines.push('');
    lines.push(copy.tests);
    for (const test of sources.tests) {
      const who = test.subjectName ? `${test.subjectName}: ` : '';
      const price =
        test.paid === false ? ` [${copy.priceAbsent}]` : test.paid ? ` [${copy.pricePaid}]` : '';
      lines.push(`- ${test.sceneTitle} — ${who}${worldBeatMarkLabel(test.mark, locale)}${test.text ? `: ${test.text}` : ''}${price}`);
    }
  }

  if (sources.mentions.length) {
    lines.push('');
    lines.push(copy.mentions);
    for (const mention of sources.mentions) {
      lines.push(`- ${mention.title} (${worldEntryKindLabel(mention.kind, locale)})${mention.summary ? `: ${mention.summary}` : ''}`);
    }
  }

  lines.push('');
  lines.push(copy.writeStatement);
  return lines.join('\n');
}

const RULE_CONTEXT_COPY: Record<AppLanguage, {
  law: string; hardness: string; scope: string; currentStatement: string; cost: string; limits: string;
  calendar: string; eras: string; exceptions: string; tests: string; priceAbsent: string; pricePaid: string;
  mentions: string; writeStatement: string;
}> = {
  es: { law: 'LEY', hardness: 'DUREZA', scope: 'RIGE SOBRE', currentStatement: 'ENUNCIADO ACTUAL (mejóralo, no lo tires)', cost: 'LO QUE CUESTA ROMPERLA (otro campo; no lo repitas)', limits: 'HASTA DÓNDE NO LLEGA (otro campo; no lo repitas)', calendar: 'CALENDARIO DE ESTE MUNDO (no uses ningún otro)', eras: 'eras', exceptions: 'EXCEPCIONES QUE YA TIENE (el enunciado no debe contradecirlas):', tests: 'CÓMO LA PONE A PRUEBA EL RELATO (es lo que la ley significa de verdad):', priceAbsent: 'el precio NO está en la página', pricePaid: 'el precio se paga', mentions: 'QUIÉN LA MENCIONA (úsalo; no inventes nada fuera de aquí):', writeStatement: 'Escribe el enunciado de esta ley.' },
  en: { law: 'LAW', hardness: 'HARDNESS', scope: 'GOVERNS', currentStatement: 'CURRENT STATEMENT (improve it, do not discard it)', cost: 'COST OF BREAKING IT (another field; do not repeat it)', limits: 'WHERE IT DOES NOT REACH (another field; do not repeat it)', calendar: 'THIS WORLD’S CALENDAR (use no other)', eras: 'eras', exceptions: 'EXISTING EXCEPTIONS (the statement must not contradict them):', tests: 'HOW THE STORY TESTS IT (what the law really means):', priceAbsent: 'the price is NOT on the page', pricePaid: 'the price is paid', mentions: 'WHO MENTIONS IT (use them; invent nothing beyond this):', writeStatement: 'Write this law’s statement.' },
  fr: { law: 'LOI', hardness: 'DURETÉ', scope: 'S’APPLIQUE À', currentStatement: 'ÉNONCÉ ACTUEL (améliore-le, ne le supprime pas)', cost: 'PRIX DE LA TRANSGRESSION (autre champ ; ne le répète pas)', limits: 'LÀ OÙ ELLE NE S’APPLIQUE PAS (autre champ ; ne le répète pas)', calendar: 'CALENDRIER DE CE MONDE (n’en utilise aucun autre)', eras: 'ères', exceptions: 'EXCEPTIONS EXISTANTES (l’énoncé ne doit pas les contredire) :', tests: 'COMMENT LE RÉCIT LA MET À L’ÉPREUVE (ce que la loi signifie vraiment) :', priceAbsent: 'le prix n’est PAS indiqué', pricePaid: 'le prix est payé', mentions: 'QUI LA MENTIONNE (utilise-le ; n’invente rien au-delà) :', writeStatement: 'Rédige l’énoncé de cette loi.' },
  de: { law: 'GESETZ', hardness: 'STRENGE', scope: 'GILT FÜR', currentStatement: 'AKTUELLER WORTLAUT (verbessern, nicht verwerfen)', cost: 'PREIS DES BRUCHS (anderes Feld; nicht wiederholen)', limits: 'WO ES NICHT GREIFT (anderes Feld; nicht wiederholen)', calendar: 'KALENDER DIESER WELT (keinen anderen verwenden)', eras: 'Epochen', exceptions: 'VORHANDENE AUSNAHMEN (der Wortlaut darf ihnen nicht widersprechen):', tests: 'WIE DIE ERZÄHLUNG ES PRÜFT (was das Gesetz wirklich bedeutet):', priceAbsent: 'der Preis steht NICHT im Text', pricePaid: 'der Preis wird bezahlt', mentions: 'WER ES ERWÄHNT (verwenden; nichts darüber hinaus erfinden):', writeStatement: 'Den Wortlaut dieses Gesetzes schreiben.' },
  pt: { law: 'LEI', hardness: 'DUREZA', scope: 'REGE SOBRE', currentStatement: 'ENUNCIADO ATUAL (melhora-o, não o elimines)', cost: 'PREÇO DE A QUEBRAR (outro campo; não o repitas)', limits: 'ATÉ ONDE NÃO CHEGA (outro campo; não o repitas)', calendar: 'CALENDÁRIO DESTE MUNDO (não uses outro)', eras: 'eras', exceptions: 'EXCEÇÕES EXISTENTES (o enunciado não as deve contradizer):', tests: 'COMO O RELATO A PÕE À PROVA (o verdadeiro significado da lei):', priceAbsent: 'o preço NÃO está na página', pricePaid: 'o preço é pago', mentions: 'QUEM A MENCIONA (usa-o; não inventes para além daqui):', writeStatement: 'Escreve o enunciado desta lei.' },
  'pt-BR': { law: 'LEI', hardness: 'RIGIDEZ', scope: 'REGE SOBRE', currentStatement: 'ENUNCIADO ATUAL (melhore-o, não o descarte)', cost: 'CUSTO DE QUEBRÁ-LA (outro campo; não o repita)', limits: 'ATÉ ONDE NÃO ALCANÇA (outro campo; não o repita)', calendar: 'CALENDÁRIO DESTE MUNDO (não use outro)', eras: 'eras', exceptions: 'EXCEÇÕES EXISTENTES (o enunciado não deve contradizê-las):', tests: 'COMO A NARRATIVA A TESTA (o que a lei realmente significa):', priceAbsent: 'o custo NÃO está na página', pricePaid: 'o custo é pago', mentions: 'QUEM A MENCIONA (use-o; não invente além daqui):', writeStatement: 'Escreva o enunciado desta lei.' },
  it: { law: 'LEGGE', hardness: 'RIGIDITÀ', scope: 'VALE PER', currentStatement: 'ENUNCIATO ATTUALE (miglioralo, non eliminarlo)', cost: 'COSTO DELLA VIOLAZIONE (altro campo; non ripeterlo)', limits: 'DOVE NON VALE (altro campo; non ripeterlo)', calendar: 'CALENDARIO DI QUESTO MONDO (non usarne altri)', eras: 'ere', exceptions: 'ECCEZIONI ESISTENTI (l’enunciato non deve contraddirle):', tests: 'COME LA STORIA LA METTE ALLA PROVA (il vero significato della legge):', priceAbsent: 'il prezzo NON è indicato', pricePaid: 'il prezzo viene pagato', mentions: 'CHI LA MENZIONA (usalo; non inventare oltre):', writeStatement: 'Scrivi l’enunciato di questa legge.' },
  tr: { law: 'KURAL', hardness: 'SERTLİK', scope: 'GEÇERLİ OLDUĞU YER', currentStatement: 'MEVCUT İFADE (geliştir, atma)', cost: 'ÇİĞNEME BEDELİ (başka alan; tekrarlama)', limits: 'GEÇERLİ OLMADIĞI SINIR (başka alan; tekrarlama)', calendar: 'BU DÜNYANIN TAKVİMİ (başka takvim kullanma)', eras: 'çağlar', exceptions: 'MEVCUT İSTİSNALAR (ifade bunlarla çelişmemeli):', tests: 'ÖYKÜNÜN ONU SINAMA BİÇİMİ (kuralın gerçek anlamı):', priceAbsent: 'bedel sayfada YOK', pricePaid: 'bedel ödenir', mentions: 'ONDAN SÖZ EDENLER (kullan; bunun dışında uydurma):', writeStatement: 'Bu kuralın ifadesini yaz.' },
};
