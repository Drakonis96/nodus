// Ask a worldbuilding character a question and get their answer, in voice.
//
// Ephemeral by design: the exchange lives in the renderer for as long as the modal is
// open and is never written to the vault. An interview is a thinking tool — the author
// keeps what it produced by editing the sheet, which is where canon belongs. Persisting
// transcripts would create a second, unversioned account of the character that nothing
// else reads.

import { completeText } from './aiClient';
import { getCharacter, listCharacterAbilities, listCharacterEvents } from '../db/charactersRepo';
import { kinOf } from '../db/relationshipsRepo';
import { listSocialRelationsForPerson } from '../db/socialRepo';
import { getSettings } from '../db/settingsRepo';
import { CHARACTER_NAME_KIND_LABEL } from '@shared/characterLabels';
import {
  characterInterviewSystem,
  composeInterviewPrompt,
  type CharacterInterviewSources,
  type InterviewTurn,
} from '@shared/characterInterview';

export async function interviewCharacter(
  personId: string,
  question: string,
  history: InterviewTurn[] = []
): Promise<string> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Escribe una pregunta.');
  const character = getCharacter(personId);
  if (!character) throw new Error('Personaje no encontrado.');

  const kin = kinOf(personId);
  const events = listCharacterEvents(personId);
  const relations = listSocialRelationsForPerson(personId);
  const abilities = listCharacterAbilities(personId);

  const sources: CharacterInterviewSources = {
    name: character.displayName,
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
    voiceRegister: character.profile.voice.register,
    voiceTics: character.profile.voice.tics,
    voiceSample: character.profile.voice.sample,
    abilities: abilities.map((ability) => ({ name: ability.name, cost: ability.cost, limits: ability.limits })),
    arc: character.profile.arc,
  };

  const settings = getSettings();
  const model = settings.chatModel ?? settings.synthesisModel ?? settings.extractionModel ?? null;
  const reply = await completeText(
    {
      system: characterInterviewSystem(sources),
      user: composeInterviewPrompt(history, trimmed),
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
