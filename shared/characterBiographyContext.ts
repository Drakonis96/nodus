/**
 * Assemble a worldbuilding character's biography context from their SHEET.
 *
 * The genealogy equivalent (biographyContext.ts) reads evidence — quotes, records,
 * documents — and forbids invention because a real person's life is a claim that must
 * be corroborated. Here the relationship is inverted: the author IS the source, the
 * sheet IS canon, and there is nothing to corroborate. What must not happen is the
 * model ADDING to the canon, or quietly rewriting it (translating an epithet,
 * "fixing" a pronoun, moving an invented date onto an Earth calendar).
 *
 * Pure so it is unit-tested without the DB or a provider.
 */

import { CHARACTER_EVENT_TYPE_LABEL, CHARACTER_LIFE_STATUS_LABEL, CHARACTER_ROLE_LABEL } from './characterLabels';
import { eventTypeLabel } from './eventTypes';
import type { CharacterBiographyMode, CharacterLifeStatus, CharacterNarrativeRole, EventTypeValue } from './types';

export interface CharacterBiographySources {
  name: string;
  aliases: { name: string; kind: string | null }[];
  species: string | null;
  gender: string | null
  pronouns: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  birthDate: string | null;
  deathDate: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
  relations: { role: string; target: string }[];
  events: { type: EventTypeValue; date: string | null; place: string | null; worldYear: number | null; notes: string | null }[];
  notes: string | null;
}

export const CHARACTER_BIOGRAPHY_SYSTEM = `Eres un escritor que redacta la biografía de un PERSONAJE DE FICCIÓN a partir de la ficha que te da su autor. Reglas estrictas:
- La ficha es canon: no la contradigas ni la "corrijas".
- No añadas hechos, nombres, lugares, poderes ni parentescos que no estén en la ficha. Si algo no consta, no lo inventes: simplemente no lo cuentes.
- Usa el nombre, los epítetos y los PRONOMBRES exactamente como aparecen. No los traduzcas, no los normalices y no los sustituyas por otros.
- Las fechas y los años pertenecen a un calendario inventado: cópialos tal cual, sin convertirlos ni reinterpretarlos.
- Escribe prosa continua y narrativa, de 150 a 250 palabras aproximadamente, en tercera persona.
- Si la ficha es escasa, escribe una biografía corta en lugar de rellenar con conjeturas.
- No incluyas encabezados, viñetas, comillas de apertura ni notas: solo el texto de la biografía.`;

/**
 * The propose mode. It relaxes exactly one rule — the model may add — and tightens two
 * in exchange: what it added has to be visibly marked, and canon still cannot be
 * contradicted. Without the marking requirement the author cannot tell their own
 * decisions from the model's, which is the whole reason the proposal is quarantined.
 */
export const CHARACTER_BIOGRAPHY_PROPOSE_SYSTEM = `Eres un escritor que redacta la biografía de un PERSONAJE DE FICCIÓN a partir de la ficha que te da su autor, y que además PROPONE lo que falta. Reglas estrictas:
- Lo que consta en la ficha es canon: no lo contradigas ni lo "corrijas".
- Donde la ficha calle, PUEDES proponer: episodios, motivaciones, lugares o vínculos verosímiles con lo que ya hay.
- Marca SIEMPRE lo que has añadido tú encerrándolo entre corchetes, así: [propuesta: creció en el barrio de los curtidores]. El autor debe poder distinguir de un vistazo sus decisiones de las tuyas.
- Usa el nombre, los epítetos y los PRONOMBRES exactamente como aparecen. No los traduzcas, no los normalices y no los sustituyas por otros.
- Las fechas y los años pertenecen a un calendario inventado: cópialos tal cual y no inventes un sistema de fechas nuevo.
- Escribe prosa continua y narrativa, de 200 a 320 palabras aproximadamente, en tercera persona.
- No incluyas encabezados, viñetas ni notas: solo el texto de la biografía con sus marcas de propuesta.`;

function list(label: string, items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  return clean.length ? `${label}: ${clean.join(', ')}.` : '';
}

/** Build the user message: a compact, ordered digest of the sheet. */
export function composeCharacterBiographyContext(
  sources: CharacterBiographySources,
  mode: CharacterBiographyMode = 'faithful'
): string {
  const lines: string[] = [];

  lines.push(`Personaje: ${sources.name}.`);
  const identity = [
    sources.species ? `especie: ${sources.species}` : '',
    sources.gender ? `género: ${sources.gender}` : '',
    // Spelled out rather than listed, because getting this wrong is the one error that
    // makes a generated biography unusable.
    sources.pronouns ? `pronombres (úsalos literalmente): ${sources.pronouns}` : '',
    `estado: ${CHARACTER_LIFE_STATUS_LABEL[sources.lifeStatus]}`,
    sources.narrativeRole ? `papel en el relato: ${CHARACTER_ROLE_LABEL[sources.narrativeRole]}` : '',
  ].filter(Boolean);
  if (identity.length) lines.push(`${identity.join('; ')}.`);

  const aliases = sources.aliases.filter((alias) => alias.name.trim() && alias.name !== sources.name);
  if (aliases.length) {
    lines.push(
      `También conocido como: ${aliases.map((alias) => (alias.kind ? `${alias.name} (${alias.kind})` : alias.name)).join(', ')}.`
    );
  }

  if (sources.birthDate) lines.push(`Nacimiento: ${sources.birthDate}.`);
  if (sources.deathDate) lines.push(`Muerte: ${sources.deathDate}.`);

  if (sources.appearance) lines.push(`Apariencia: ${sources.appearance.trim()}`);
  if (sources.personality) lines.push(`Personalidad: ${sources.personality.trim()}`);
  if (sources.backstory) lines.push(`Trasfondo: ${sources.backstory.trim()}`);

  const kin = [
    list('Progenitores', sources.parents),
    list('Parejas', sources.spouses),
    list('Descendencia', sources.children),
    list('Hermanos', sources.siblings),
  ].filter(Boolean);
  if (kin.length) lines.push(kin.join(' '));

  if (sources.relations.length) {
    lines.push('Vínculos:');
    for (const relation of sources.relations.slice(0, 20)) {
      lines.push(`- ${relation.role}: ${relation.target}`);
    }
  }

  if (sources.events.length) {
    lines.push('Hechos de su vida, en orden:');
    for (const event of sources.events.slice(0, 40)) {
      const parts = [eventTypeLabel(event.type, CHARACTER_EVENT_TYPE_LABEL)];
      if (event.worldYear != null) parts.push(`año ${event.worldYear}`);
      if (event.date) parts.push(event.date);
      if (event.place) parts.push(`en ${event.place}`);
      const notes = (event.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
      lines.push(`- ${parts.join(', ')}.${notes ? ` ${notes}` : ''}`);
    }
  }

  const notes = (sources.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 800);
  if (notes) lines.push(`Notas del autor: ${notes}`);

  lines.push(
    mode === 'propose'
      ? '\nRedacta la biografía del personaje a partir de lo anterior, y propón lo que falte marcándolo entre corchetes.'
      : '\nRedacta la biografía del personaje a partir de lo anterior.'
  );
  return lines.join('\n');
}

/** True when the sheet holds enough to write anything at all. */
export function hasCharacterBiographyMaterial(sources: CharacterBiographySources): boolean {
  return Boolean(
    sources.appearance?.trim() ||
      sources.personality?.trim() ||
      sources.backstory?.trim() ||
      sources.notes?.trim() ||
      sources.birthDate ||
      sources.deathDate ||
      sources.events.length ||
      sources.relations.length ||
      sources.parents.length ||
      sources.spouses.length ||
      sources.children.length ||
      sources.siblings.length
  );
}
