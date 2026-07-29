// Generate a worldbuilding character's biography from their SHEET (description,
// aliases, life events in world order, kinship and relations) with the configured
// model. On-demand only; the result is saved on the person row and the UI labels it as
// generated. The worldbuilding prompt pack (author is canon, pronouns verbatim,
// invented calendar left alone) is applied automatically by the completion path.
//
// Distinct from personBiography.ts rather than parameterised: that one composes
// EVIDENCE and forbids invention because a real person's life must be corroborated,
// and it refuses to write at all without a quote, a record or a date — which would
// reject a character whose sheet is a full page of description.

import { completeText } from './aiClient';
import { setPersonBiography } from '../db/entitiesRepo';
import { getCharacter, listCharacterEvents, setProposedBiography } from '../db/charactersRepo';
import { kinOf } from '../db/relationshipsRepo';
import { listSocialRelationsForPerson } from '../db/socialRepo';
import { getSettings } from '../db/settingsRepo';
import {
  composeCharacterBiographyContext,
  hasCharacterBiographyMaterial,
  type CharacterBiographySources,
} from '@shared/characterBiographyContext';
import type { CharacterBiographyMode } from '@shared/types';
import { CHARACTER_NAME_KIND_LABEL } from '@shared/characterLabels';
import { worldOperationSystemPrompt } from '@shared/worldOperationPrompts';

export interface CharacterBiographyResult {
  biography: string | null;
  /** True when the sheet is too empty to write from — not an error. */
  noMaterial: boolean;
  /**
   * In 'propose' mode the text is stored apart from the accepted biography and this is
   * true, so the UI can label it as a proposal rather than as canon.
   */
  proposal: boolean;
}

/**
 * `faithful` retells only what the sheet says. `propose` is allowed to fill gaps — and
 * everything about that path keeps the result quarantined: a different system prompt that
 * demands the invented parts be marked, a warmer temperature, and storage in
 * `character_profiles.biography_proposed` instead of `persons.biography`. Accepting it is
 * a separate, explicit action, because a proposal that silently became canon would be
 * indistinguishable from something the author wrote.
 */
export async function generateCharacterBiography(
  personId: string,
  mode: CharacterBiographyMode = 'faithful'
): Promise<CharacterBiographyResult> {
  const character = getCharacter(personId);
  if (!character) throw new Error('Personaje no encontrado.');

  const kin = kinOf(personId);
  const events = listCharacterEvents(personId);
  const relations = listSocialRelationsForPerson(personId);

  const sources: CharacterBiographySources = {
    name: character.displayName,
    // The alias kind is sent as its human label, not its token: "epithet" means
    // nothing to the model, "Epíteto o título" does.
    aliases: character.names.map((entry) => ({
      name: entry.name,
      kind: entry.kind ? CHARACTER_NAME_KIND_LABEL[entry.kind] ?? entry.kind : null,
    })),
    species: character.profile.species,
    gender: character.profile.gender,
    pronouns: character.profile.pronouns,
    lifeStatus: character.profile.lifeStatus,
    narrativeRole: character.profile.narrativeRole,
    birthDate: character.birthDate,
    deathDate: character.deathDate,
    appearance: character.profile.appearance,
    personality: character.profile.personality,
    backstory: character.profile.backstory,
    parents: kin.parents.map((person) => person.displayName),
    spouses: kin.spouses.map((person) => person.displayName),
    children: kin.children.map((person) => person.displayName),
    siblings: kin.siblings.map((person) => person.displayName),
    relations: relations.map((relation) => ({ role: relation.role, target: relation.targetName })),
    events: events.map((event) => ({
      type: event.type,
      date: event.date,
      place: event.placeName,
      worldYear: event.worldYear,
      notes: event.notes,
    })),
    notes: character.notes,
  };

  if (!hasCharacterBiographyMaterial(sources)) return { biography: null, noMaterial: true, proposal: false };

  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  const text = await completeText(
    {
      system: worldOperationSystemPrompt(
        mode === 'propose' ? 'biographyPropose' : 'biography',
        settings.promptLanguage ?? 'es',
      ),
      user: composeCharacterBiographyContext(sources, mode),
      plainContext: true,
      // Warmer than the genealogy biography's 0.3: this is narrative prose about an
      // invented person, not a cautious reading of records. Warmer still when proposing.
      temperature: mode === 'propose' ? 0.9 : 0.7,
      maxTokens: 1100,
    },
    model
  );
  const biography = text.trim() || null;
  if (mode === 'propose') {
    setProposedBiography(personId, biography);
    return { biography, noMaterial: false, proposal: true };
  }
  setPersonBiography(personId, biography);
  return { biography, noMaterial: false, proposal: false };
}
