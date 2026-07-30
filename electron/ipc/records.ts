// records channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import type { PersonInput, PlaceInput, GazetteerPlace, PersonPlaceInput, EventInput, ParticipantRole, EventTypeValue, RecordEvidenceInput, RecordEvidenceTargetKind, RelationshipType, RelationshipProvenance, RelationshipSubtype, SocialContactInput, SocialRelationInput } from '@shared/types';
import { generatePersonPortraitFromDescription } from '../ai/decorativeImages';
import { resolveWorkText } from '../extraction/textExtractor';
import { createPerson, updatePerson, getPerson, listPersons, deletePerson, addPersonName, setPersonPortrait, getPersonPortrait, updatePortraitFocus, clearPersonPortrait, setPersonFrame, createPlace, listPlaces, updatePlace, findOrCreatePlace, findOrCreateGazetteerPlace, createEvent, updateEvent, getEvent, deleteEvent, listEvents, addParticipant, removeParticipant, addRecordEvidence, listEvidenceFor, deleteRecordEvidence, recordCounts } from '../db/entitiesRepo';
import { scanWorkRecords } from '../ai/recordsScan';
import { generatePersonBiography } from '../ai/personBiography';
import { addRelationship, updateRelationship, removeRelationship, listRelationshipsForPerson, allRelationships, kinOf } from '../db/relationshipsRepo';
import { importGedcom, exportGedcom } from '../genealogy/gedcomBridge';
import { findMatchCandidates, mergePersons, dismissMatch } from '../db/matchRepo';
import { listSocialContacts, getSocialContact, createSocialContact, updateSocialContact, deleteSocialContact, listSocialRelationsForPerson, listSocialRelationsTargetingPerson, listSocialRelationsTargetingContact, createSocialRelation, updateSocialRelation, deleteSocialRelation, socialGraph } from '../db/socialRepo';
import { searchGazetteer } from '../geo/gazetteer';
import { addPersonPlace, updatePersonPlace, deletePersonPlace, listPersonPlaces, mapPoints } from '../db/personPlacesRepo';
import { listOpenSuggestions, listSuggestionsForPerson, confirmSuggestion, dismissSuggestion, openSuggestionCount } from '../db/kinshipSuggestionsRepo';
import path from 'node:path';
import fs from 'node:fs';
import { dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import * as works from '../db/worksRepo';

export function registerRecordsIpc({ h, getWindow }: IpcContext): void {
  // ── Records ontology (persons / places / events / evidence) ────────────────
  h('entities:counts', async () => recordCounts());
  h('entities:listPersons', async (_e, search?: string) => listPersons({ search }));
  h('entities:getPerson', async (_e, id: string) => getPerson(id));
  h('entities:createPerson', async (_e, input: PersonInput) => createPerson(input));
  h('entities:updatePerson', async (_e, id: string, patch: Partial<PersonInput>) => updatePerson(id, patch));
  h('entities:deletePerson', async (_e, id: string) => {
    deletePerson(id);
  });
  h('entities:addPersonName', async (_e, id: string, name: string, kind?: string | null) =>
    addPersonName(id, name, kind ?? null)
  );
  // Portraits
  h('entities:setPersonPortraitFromFile', async (_e, personId: string) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Elegir retrato',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = picked.filePaths[0];
    const bytes = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : ext === '.tif' || ext === '.tiff' ? 'image/tiff' : 'image/jpeg';
    setPersonPortrait(personId, bytes, mime);
    return getPerson(personId);
  });
  h('entities:getPersonPortrait', async (_e, personId: string) => getPersonPortrait(personId));
  h('entities:updatePortraitFocus', async (
    _e,
    personId: string,
    focus: { focusX: number; focusY: number; scale: number }
  ) => {
    updatePortraitFocus(personId, focus);
  });
  h('entities:clearPersonPortrait', async (_e, personId: string) => {
    clearPersonPortrait(personId);
  });
  h('entities:generatePersonPortraitReference', async (_e, personId: string, description: string) => {
    await generatePersonPortraitFromDescription(personId, description);
    return getPerson(personId);
  });
  h('entities:listPlaces', async () => listPlaces());
  h('entities:createPlace', async (_e, input: PlaceInput) => createPlace(input));
  h('entities:findOrCreatePlace', async (_e, name: string, kind?: string | null) => findOrCreatePlace(name, kind ?? null));
  h('entities:updatePlace', async (_e, id: string, patch: Partial<PlaceInput>) => updatePlace(id, patch));
  // Offline gazetteer + per-person place records (map)
  h('geo:search', async (_e, query: string, limit?: number) => searchGazetteer(query, limit ?? 12));
  h('geo:resolve', async (_e, place: GazetteerPlace) =>
    findOrCreateGazetteerPlace({
      gazetteerId: place.gazetteerId,
      name: place.name,
      admin1: place.admin1,
      country: place.country,
      countryCode: place.countryCode,
      latitude: place.latitude,
      longitude: place.longitude,
    })
  );
  h('places:listForPerson', async (_e, personId: string) => listPersonPlaces(personId));
  h('places:add', async (_e, input: PersonPlaceInput) => addPersonPlace(input));
  h('places:update', async (_e, id: string, patch: Partial<PersonPlaceInput>) => updatePersonPlace(id, patch));
  h('places:delete', async (_e, id: string) => {
    deletePersonPlace(id);
  });
  h('places:mapPoints', async (_e, personIds?: string[]) => mapPoints(personIds));
  h('entities:listEvents', async (
    _e,
    opts?: { personId?: string; type?: EventTypeValue; from?: string; to?: string }
  ) => listEvents(opts ?? {}));
  h('entities:getEvent', async (_e, id: string) => getEvent(id));
  h('entities:createEvent', async (_e, input: EventInput) => createEvent(input));
  h('entities:updateEvent', async (_e, id: string, patch: Partial<EventInput>) => updateEvent(id, patch));
  h('entities:deleteEvent', async (_e, id: string) => {
    deleteEvent(id);
  });
  h('entities:addParticipant', async (_e, eventId: string, personId: string, role: ParticipantRole) =>
    addParticipant(eventId, personId, role)
  );
  h('entities:removeParticipant', async (_e, eventId: string, personId: string, role: ParticipantRole) =>
    removeParticipant(eventId, personId, role)
  );
  h('entities:addEvidence', async (_e, input: RecordEvidenceInput) => addRecordEvidence(input));
  h('entities:listEvidence', async (_e, targetKind: RecordEvidenceTargetKind, targetId: string) =>
    listEvidenceFor(targetKind, targetId)
  );
  h('entities:deleteEvidence', async (_e, id: string) => {
    deleteRecordEvidence(id);
  });
  // kinship (genealogy)
  h('entities:addRelationship', async (
    _e,
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    provenance?: RelationshipProvenance,
    subtype?: RelationshipSubtype
  ) => addRelationship(fromPerson, toPerson, type, provenance ?? 'user_asserted', subtype ?? null));
  h('entities:updateRelationship', async (
    _e,
    relId: string,
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    subtype?: RelationshipSubtype
  ) => updateRelationship(relId, fromPerson, toPerson, type, subtype ?? null));
  h('entities:setPersonFrame', async (_e, personId: string, frameStyle: string | null) => {
    setPersonFrame(personId, frameStyle);
  });
  h('entities:generateBiography', async (_e, personId: string) => generatePersonBiography(personId));
  h('entities:removeRelationship', async (_e, relId: string) => {
    removeRelationship(relId);
  });
  h('entities:listRelationships', async (_e, personId: string) => listRelationshipsForPerson(personId));
  h('entities:allRelationships', async () => allRelationships());
  h('entities:kinOf', async (_e, personId: string) => kinOf(personId));
  // Identity matching (record linkage)
  h('entities:findMatches', async () => findMatchCandidates());
  h('entities:mergePersons', async (_e, targetId: string, sourceId: string) => mergePersons(targetId, sourceId));
  h('entities:dismissMatch', async (_e, a: string, b: string) => {
    dismissMatch(a, b);
  });
  // Social-relations network (independent from kinship)
  h('social:listContacts', async (_e, search?: string) => listSocialContacts({ search }));
  h('social:getContact', async (_e, id: string) => getSocialContact(id));
  h('social:createContact', async (_e, input: SocialContactInput) => createSocialContact(input));
  h('social:updateContact', async (_e, id: string, patch: Partial<SocialContactInput>) => updateSocialContact(id, patch));
  h('social:deleteContact', async (_e, id: string) => {
    deleteSocialContact(id);
  });
  h('social:listRelationsForPerson', async (_e, personId: string) => listSocialRelationsForPerson(personId));
  h('social:listRelationsTargetingPerson', async (_e, personId: string) => listSocialRelationsTargetingPerson(personId));
  h('social:listRelationsTargetingContact', async (_e, contactId: string) => listSocialRelationsTargetingContact(contactId));
  h('social:createRelation', async (_e, input: SocialRelationInput) => createSocialRelation(input));
  h('social:updateRelation', async (_e, id: string, patch: Partial<SocialRelationInput>) => updateSocialRelation(id, patch));
  h('social:deleteRelation', async (_e, id: string) => {
    deleteSocialRelation(id);
  });
  h('social:graph', async () => socialGraph());
  // Evidence-driven kinship suggestions (AI proposes, the user disposes)
  h('kinship:listSuggestions', async () => listOpenSuggestions());
  h('kinship:suggestionsForPerson', async (_e, personId: string) => listSuggestionsForPerson(personId));
  h('kinship:suggestionCount', async () => openSuggestionCount());
  h('kinship:confirmSuggestion', async (_e, suggestionId: string) => confirmSuggestion(suggestionId));
  h('kinship:dismissSuggestion', async (_e, suggestionId: string) => dismissSuggestion(suggestionId));
  // Records lens on a Zotero library work (genealogy/primary-source vaults): resolve
  // the work's text like a deep scan, then extract persons/places/events from it, so
  // published/secondary sources feed the same tree as the evidence archive.
  h('works:scanRecords', async (_e, nodusId: string) => {
    const work = works.getWork(nodusId);
    if (!work) throw new Error('Obra no encontrada.');
    const settings = getSettings();
    const doc = await resolveWorkText(
      settings.zoteroUserId,
      work.zotero_key,
      settings.zoteroStoragePath,
      null,
      work.doi ?? null,
      {
        unpaywallEmail: settings.unpaywallEmail,
        preferZoteroFulltext: settings.preferZoteroFulltext,
        ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      },
      work.item_type
    );
    if (!doc.text || !doc.text.trim()) return { persons: 0, places: 0, events: 0, evidence: 0, linked: 0, suggestions: 0, noText: true };
    const model = settings.extractionModel ?? settings.synthesisModel ?? undefined;
    const result = await scanWorkRecords(nodusId, doc.text, model);
    return { ...result, noText: false };
  });
  // GEDCOM import / export
  h('genealogy:importGedcom', async () => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Importar GEDCOM',
      properties: ['openFile'],
      filters: [{ name: 'GEDCOM', extensions: ['ged', 'gedcom'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const text = fs.readFileSync(picked.filePaths[0], 'utf8');
    return importGedcom(text);
  });
  h('genealogy:exportGedcom', async () => {
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Exportar GEDCOM',
      defaultPath: 'nodus.ged',
      filters: [{ name: 'GEDCOM', extensions: ['ged'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, exportGedcom(), 'utf8');
    return { path: picked.filePath };
  });
}
