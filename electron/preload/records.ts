// records half of the renderer bridge, paired with electron/ipc/records.ts.
// Typed as RecordsApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { RecordsApi } from '@shared/api/records';

export const recordsApi: RecordsApi = {
  // Records ontology (primary sources / genealogy)
  recordCounts: () => ipcRenderer.invoke('entities:counts'),
  listPersons: (search) => ipcRenderer.invoke('entities:listPersons', search),
  getPerson: (id) => ipcRenderer.invoke('entities:getPerson', id),
  createPerson: (input) => ipcRenderer.invoke('entities:createPerson', input),
  updatePerson: (id, patch) => ipcRenderer.invoke('entities:updatePerson', id, patch),
  deletePerson: (id) => ipcRenderer.invoke('entities:deletePerson', id).then(() => undefined),
  addPersonName: (id, name, kind) => ipcRenderer.invoke('entities:addPersonName', id, name, kind),
  setPersonPortraitFromFile: (personId) => ipcRenderer.invoke('entities:setPersonPortraitFromFile', personId),
  getPersonPortrait: (personId) => ipcRenderer.invoke('entities:getPersonPortrait', personId),
  updatePortraitFocus: (personId, focus) => ipcRenderer.invoke('entities:updatePortraitFocus', personId, focus).then(() => undefined),
  clearPersonPortrait: (personId) => ipcRenderer.invoke('entities:clearPersonPortrait', personId).then(() => undefined),
  generatePersonPortraitReference: (personId, description) =>
    ipcRenderer.invoke('entities:generatePersonPortraitReference', personId, description),
  listPlaces: () => ipcRenderer.invoke('entities:listPlaces'),
  createPlace: (input) => ipcRenderer.invoke('entities:createPlace', input),
  findOrCreatePlace: (name, kind) => ipcRenderer.invoke('entities:findOrCreatePlace', name, kind),
  updatePlace: (id, patch) => ipcRenderer.invoke('entities:updatePlace', id, patch),
  // Offline gazetteer + per-person place records (map)
  searchGazetteer: (query, limit) => ipcRenderer.invoke('geo:search', query, limit),
  resolveGazetteerPlace: (place) => ipcRenderer.invoke('geo:resolve', place),
  listPersonPlaces: (personId) => ipcRenderer.invoke('places:listForPerson', personId),
  addPersonPlace: (input) => ipcRenderer.invoke('places:add', input),
  updatePersonPlace: (id, patch) => ipcRenderer.invoke('places:update', id, patch),
  deletePersonPlace: (id) => ipcRenderer.invoke('places:delete', id).then(() => undefined),
  mapPoints: (personIds) => ipcRenderer.invoke('places:mapPoints', personIds),
  listEvents: (opts) => ipcRenderer.invoke('entities:listEvents', opts),
  getEvent: (id) => ipcRenderer.invoke('entities:getEvent', id),
  createEvent: (input) => ipcRenderer.invoke('entities:createEvent', input),
  updateEvent: (id, patch) => ipcRenderer.invoke('entities:updateEvent', id, patch),
  deleteEvent: (id) => ipcRenderer.invoke('entities:deleteEvent', id).then(() => undefined),
  addParticipant: (eventId, personId, role) => ipcRenderer.invoke('entities:addParticipant', eventId, personId, role),
  removeParticipant: (eventId, personId, role) =>
    ipcRenderer.invoke('entities:removeParticipant', eventId, personId, role),
  addRecordEvidence: (input) => ipcRenderer.invoke('entities:addEvidence', input),
  listRecordEvidence: (targetKind, targetId) => ipcRenderer.invoke('entities:listEvidence', targetKind, targetId),
  deleteRecordEvidence: (id) => ipcRenderer.invoke('entities:deleteEvidence', id).then(() => undefined),
  addRelationship: (fromPerson, toPerson, type, provenance, subtype) =>
    ipcRenderer.invoke('entities:addRelationship', fromPerson, toPerson, type, provenance, subtype),
  updateRelationship: (relId, fromPerson, toPerson, type, subtype) =>
    ipcRenderer.invoke('entities:updateRelationship', relId, fromPerson, toPerson, type, subtype),
  setPersonFrame: (personId, frameStyle) =>
    ipcRenderer.invoke('entities:setPersonFrame', personId, frameStyle).then(() => undefined),
  generatePersonBiography: (personId) => ipcRenderer.invoke('entities:generateBiography', personId),
  removeRelationship: (relId) => ipcRenderer.invoke('entities:removeRelationship', relId).then(() => undefined),
  listRelationships: (personId) => ipcRenderer.invoke('entities:listRelationships', personId),
  allRelationships: () => ipcRenderer.invoke('entities:allRelationships'),
  kinOf: (personId) => ipcRenderer.invoke('entities:kinOf', personId),
  importGedcom: () => ipcRenderer.invoke('genealogy:importGedcom'),
  exportGedcom: () => ipcRenderer.invoke('genealogy:exportGedcom'),
  findMatches: () => ipcRenderer.invoke('entities:findMatches'),
  mergePersons: (targetId, sourceId) => ipcRenderer.invoke('entities:mergePersons', targetId, sourceId),
  dismissMatch: (a, b) => ipcRenderer.invoke('entities:dismissMatch', a, b).then(() => undefined),
  // Social-relations network (independent from kinship)
  listSocialContacts: (search) => ipcRenderer.invoke('social:listContacts', search),
  getSocialContact: (id) => ipcRenderer.invoke('social:getContact', id),
  createSocialContact: (input) => ipcRenderer.invoke('social:createContact', input),
  updateSocialContact: (id, patch) => ipcRenderer.invoke('social:updateContact', id, patch),
  deleteSocialContact: (id) => ipcRenderer.invoke('social:deleteContact', id).then(() => undefined),
  listSocialRelationsForPerson: (personId) => ipcRenderer.invoke('social:listRelationsForPerson', personId),
  listSocialRelationsTargetingPerson: (personId) => ipcRenderer.invoke('social:listRelationsTargetingPerson', personId),
  listSocialRelationsTargetingContact: (contactId) => ipcRenderer.invoke('social:listRelationsTargetingContact', contactId),
  createSocialRelation: (input) => ipcRenderer.invoke('social:createRelation', input),
  updateSocialRelation: (id, patch) => ipcRenderer.invoke('social:updateRelation', id, patch),
  deleteSocialRelation: (id) => ipcRenderer.invoke('social:deleteRelation', id).then(() => undefined),
  socialGraph: () => ipcRenderer.invoke('social:graph'),
  // Evidence-driven kinship suggestions
  listKinSuggestions: () => ipcRenderer.invoke('kinship:listSuggestions'),
  kinSuggestionsForPerson: (personId) => ipcRenderer.invoke('kinship:suggestionsForPerson', personId),
  kinSuggestionCount: () => ipcRenderer.invoke('kinship:suggestionCount'),
  confirmKinSuggestion: (suggestionId) => ipcRenderer.invoke('kinship:confirmSuggestion', suggestionId),
  dismissKinSuggestion: (suggestionId) => ipcRenderer.invoke('kinship:dismissSuggestion', suggestionId),
  scanWorkRecords: (nodusId) => ipcRenderer.invoke('works:scanRecords', nodusId),
};
