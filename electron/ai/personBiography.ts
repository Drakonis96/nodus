// Generate a person's biography from their evidence (kinship, events, linked
// documents, cited evidence) with the configured model. On-demand only; the result
// is saved on the person. The genealogy vault prompt pack (source-critical, no
// invention) is applied automatically by the completion path.

import { completeText } from './aiClient';
import { getPerson, listEvents, listEvidenceFor, setPersonBiography } from '../db/entitiesRepo';
import { kinOf } from '../db/relationshipsRepo';
import { listItemsForPerson } from '../db/archiveRepo';
import { getSettings } from '../db/settingsRepo';
import {
  BIOGRAPHY_SYSTEM,
  composeBiographyContext,
  hasBiographyEvidence,
  type BiographySources,
} from '@shared/biographyContext';

export interface BiographyResult {
  biography: string | null;
  noEvidence: boolean;
}

export async function generatePersonBiography(personId: string): Promise<BiographyResult> {
  const person = getPerson(personId);
  if (!person) throw new Error('Persona no encontrada.');

  const kin = kinOf(personId);
  const events = listEvents({ personId });
  const evidence = listEvidenceFor('person', personId);
  const documents = listItemsForPerson(personId);

  const sources: BiographySources = {
    name: person.displayName,
    sex: person.sex,
    birthDate: person.birthDate,
    deathDate: person.deathDate,
    parents: kin.parents.map((p) => p.displayName),
    spouses: kin.spouses.map((p) => p.displayName),
    children: kin.children.map((p) => p.displayName),
    siblings: kin.siblings.map((p) => p.displayName),
    events: events.map((e) => ({ type: e.type, date: e.date, place: e.placeName })),
    documents: documents.map((d) => ({ title: d.title, docType: d.docType, text: d.extractedText })),
    evidence: evidence.map((e) => ({ quote: e.quote, location: e.location })),
  };

  if (!hasBiographyEvidence(sources)) return { biography: null, noEvidence: true };

  const model = getSettings().synthesisModel ?? getSettings().extractionModel ?? null;
  const text = await completeText(
    { system: BIOGRAPHY_SYSTEM, user: composeBiographyContext(sources), temperature: 0.3, maxTokens: 900 },
    model
  );
  const biography = text.trim() || null;
  setPersonBiography(personId, biography);
  return { biography, noEvidence: false };
}
