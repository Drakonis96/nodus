/**
 * Archetype templates: a starting point for a character, not a straitjacket.
 *
 * A template sets the narrative role and the tag colour, and says which of the arc and
 * voice fields matter most for that archetype — nothing more. It deliberately writes NO
 * prose into the sheet:
 *
 *   - pre-filled plausible prose gets shipped exactly as it came, and the world ends up
 *     populated by the template's characters instead of the author's;
 *   - prompts written as content ("¿qué delata que no está hecho para esto?") have to be
 *     DELETED before the answer can be typed, which is worse than an empty box;
 *   - and either way the text would be authored Spanish sitting in the database, where
 *     the i18n layer cannot reach it — the same trap the genealogy demo data had to work
 *     around.
 *
 * The prompting is done by the arc/voice field hints, which are UI and therefore already
 * translated. `focus` is what tells the sheet to open those sections expanded.
 *
 * Pure data, no dependencies.
 */

import type { CharacterNarrativeRole } from './types';

export type CharacterArcFieldId = 'want' | 'need' | 'flaw' | 'lie' | 'wound';
export type CharacterVoiceFieldId = 'register' | 'tics' | 'sample';

export interface CharacterTemplate {
  id: string;
  label: string;
  description: string;
  narrativeRole: CharacterNarrativeRole | null;
  accent: string | null;
  /** The arc fields this archetype lives or dies by; the sheet opens them expanded. */
  focusArc: CharacterArcFieldId[];
  focusVoice: CharacterVoiceFieldId[];
}

export const CHARACTER_TEMPLATES: CharacterTemplate[] = [
  {
    id: 'blank',
    label: 'En blanco',
    description: 'Solo el nombre. Rellena la ficha a tu manera.',
    narrativeRole: null,
    accent: null,
    focusArc: [],
    focusVoice: [],
  },
  {
    id: 'reluctant_hero',
    label: 'Héroe a su pesar',
    description: 'Alguien a quien la trama saca de su vida sin pedirle permiso. Empieza por qué quería en realidad y qué le impide moverse.',
    narrativeRole: 'protagonist',
    accent: 'amber',
    focusArc: ['want', 'need', 'flaw'],
    focusVoice: ['tics'],
  },
  {
    id: 'tyrant',
    label: 'Tirano con razones',
    description: 'Un antagonista que cree estar salvando algo. Lo importante es la mentira que se cree y de dónde salió.',
    narrativeRole: 'antagonist',
    accent: 'crimson',
    focusArc: ['want', 'lie', 'wound'],
    focusVoice: ['register'],
  },
  {
    id: 'mentor',
    label: 'Mentor con secreto',
    description: 'Quien enseña y calla lo que más importa. Define qué protege ocultándolo.',
    narrativeRole: 'secondary',
    accent: 'slate',
    focusArc: ['flaw', 'wound'],
    focusVoice: ['register', 'tics'],
  },
  {
    id: 'trickster',
    label: 'Embaucador',
    description: 'Quien sobrevive hablando y cambia de bando a tiempo. Su voz es media ficha.',
    narrativeRole: 'secondary',
    accent: 'emerald',
    focusArc: ['want', 'lie'],
    focusVoice: ['register', 'tics', 'sample'],
  },
  {
    id: 'witness',
    label: 'Testigo',
    description: 'Un personaje menor que ve lo que nadie más ve. Con poco basta: qué vio y por qué calla.',
    narrativeRole: 'tertiary',
    accent: 'sky',
    focusArc: ['flaw'],
    focusVoice: ['register'],
  },
];

const BY_ID = new Map(CHARACTER_TEMPLATES.map((template) => [template.id, template]));

export function characterTemplate(id: string): CharacterTemplate | null {
  return BY_ID.get(id) ?? null;
}
