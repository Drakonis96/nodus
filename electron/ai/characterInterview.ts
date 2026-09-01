// Ask a worldbuilding character a question and get their answer, in voice.
//
// This function is deliberately stateless: it receives bounded history and returns one
// in-character turn. The current interview UI calls it through characterChat.ts, which
// persists the conversation as non-canon authoring history. The direct legacy IPC route
// remains ephemeral. Neither path edits the character sheet or promotes chat to canon.

import { completeText } from './aiClient';
import { getCharacter, listCharacterAbilities, listCharacterEvents } from '../db/charactersRepo';
import { kinOf } from '../db/relationshipsRepo';
import { listSocialRelationsForPerson } from '../db/socialRepo';
import { appearancesOfCharacter, listScenes } from '../db/worldStoryRepo';
import { getSettings } from '../db/settingsRepo';
import { CHARACTER_NAME_KIND_LABEL } from '@shared/characterLabels';
import {
  composeInterviewPrompt,
  type CharacterInterviewSources,
  type InterviewTurn,
} from '@shared/characterInterview';
import { worldCharacterInterviewPrompt } from '@shared/worldOperationPrompts';
import { characterBiographyContextCopy } from '@shared/worldContextPromptPacks';

export async function interviewCharacter(
  personId: string,
  question: string,
  history: InterviewTurn[] = [],
  options: { canSendImages?: boolean } = {}
): Promise<string> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Escribe una pregunta.');
  const character = getCharacter(personId);
  if (!character) throw new Error('Personaje no encontrado.');

  const kin = kinOf(personId);
  const events = listCharacterEvents(personId);
  const relations = listSocialRelationsForPerson(personId);
  const abilities = listCharacterAbilities(personId);
  const scenesById = new Map(listScenes('narrative').map((scene) => [scene.sceneId, scene]));
  const scenes = appearancesOfCharacter(personId)
    .map((appearance) => {
      const scene = scenesById.get(appearance.sceneId);
      return scene
        ? {
            title: scene.title,
            role: appearance.role,
            summary: scene.summary,
            notes: scene.notes,
          }
        : null;
    })
    .filter((scene): scene is NonNullable<typeof scene> => scene !== null);

  const settings = getSettings();
  const language = settings.promptLanguage ?? 'es';
  const biographyCopy = characterBiographyContextCopy(language);
  const sources: CharacterInterviewSources = {
    name: character.displayName,
    aliases: character.names.map((entry) => ({
      name: entry.name,
      kind: entry.kind ? biographyCopy.aliasKinds[entry.kind] ?? CHARACTER_NAME_KIND_LABEL[entry.kind] ?? entry.kind : null,
      kindToken: entry.kind,
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
    relations: relations.map((relation) => ({
      role: relation.role,
      target: relation.targetName,
      notes: relation.notes,
    })),
    events: events.map((event) => ({
      type: event.type,
      date: event.date,
      place: event.placeName,
      worldYear: event.worldYear,
      notes: event.notes,
    })),
    notes: character.notes,
    voiceRegister: character.profile.voice.register,
    voiceTics: character.profile.voice.tics,
    voiceSample: character.profile.voice.sample,
    abilities: abilities.map((ability) => ({ name: ability.name, cost: ability.cost, limits: ability.limits })),
    arc: character.profile.arc,
    scenes,
    canSendImages: options.canSendImages === true,
  };

  const model = settings.chatModel ?? settings.synthesisModel ?? settings.extractionModel ?? null;
  const reply = await completeText(
    {
      system: worldCharacterInterviewPrompt(sources, language),
      user: composeInterviewPrompt(history, trimmed, language),
      plainContext: true,
      // High: this is performance, not extraction. A cold temperature makes every
      // character sound like the same polite narrator.
      temperature: 0.95,
      maxTokens: 500,
    },
    model
  );
  const answer = reply.trim();
  if (!answer) throw new Error('El modelo no devolvió respuesta.');
  return answer;
}
