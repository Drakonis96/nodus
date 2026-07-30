// The records slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  EventInput,
  EventTypeValue,
  GazetteerPlace,
  GedcomImportResult,
  HistoricalEvent,
  Kin,
  KinSuggestion,
  MapPlacePoint,
  MatchCandidatePair,
  ParticipantRole,
  Person,
  PersonInput,
  PersonPlace,
  PersonPlaceInput,
  Place,
  PlaceInput,
  PortraitFocus,
  RecordCounts,
  RecordEvidence,
  RecordEvidenceInput,
  RecordEvidenceTargetKind,
  RecordsScanSummary,
  Relationship,
  RelationshipProvenance,
  RelationshipSubtype,
  RelationshipType,
  SocialContact,
  SocialContactInput,
  SocialGraphData,
  SocialRelation,
  SocialRelationInput,
} from '../types';

export interface RecordsApi {
  // Prosopography lives in shared/api/prosopography.ts (extended above).
  // records ontology (primary sources / genealogy)
  recordCounts(): Promise<RecordCounts>;
  listPersons(search?: string): Promise<Person[]>;
  getPerson(id: string): Promise<Person | null>;
  createPerson(input: PersonInput): Promise<Person>;
  updatePerson(id: string, patch: Partial<PersonInput>): Promise<Person | null>;
  deletePerson(id: string): Promise<void>;
  addPersonName(id: string, name: string, kind?: string | null): Promise<void>;
  setPersonPortraitFromFile(personId: string): Promise<Person | null>;
  getPersonPortrait(personId: string): Promise<{ blob: Uint8Array; mime: string } | null>;
  updatePortraitFocus(personId: string, focus: PortraitFocus): Promise<void>;
  clearPersonPortrait(personId: string): Promise<void>;
  /** Exceptional: an illustrative (non-photorealistic) reference portrait from a text description. */
  generatePersonPortraitReference(personId: string, description: string): Promise<Person | null>;
  listPlaces(): Promise<Place[]>;
  createPlace(input: PlaceInput): Promise<Place>;
  findOrCreatePlace(name: string, kind?: string | null): Promise<Place>;
  updatePlace(id: string, patch: Partial<PlaceInput>): Promise<Place | null>;
  // offline gazetteer + per-person place records (map)
  searchGazetteer(query: string, limit?: number): Promise<GazetteerPlace[]>;
  resolveGazetteerPlace(place: GazetteerPlace): Promise<Place>;
  listPersonPlaces(personId: string): Promise<PersonPlace[]>;
  addPersonPlace(input: PersonPlaceInput): Promise<PersonPlace>;
  updatePersonPlace(id: string, patch: Partial<PersonPlaceInput>): Promise<PersonPlace | null>;
  deletePersonPlace(id: string): Promise<void>;
  mapPoints(personIds?: string[]): Promise<MapPlacePoint[]>;
  listEvents(opts?: {
    personId?: string;
    type?: EventTypeValue;
    from?: string;
    to?: string;
  }): Promise<HistoricalEvent[]>;
  getEvent(id: string): Promise<HistoricalEvent | null>;
  createEvent(input: EventInput): Promise<HistoricalEvent>;
  updateEvent(id: string, patch: Partial<EventInput>): Promise<HistoricalEvent | null>;
  deleteEvent(id: string): Promise<void>;
  addParticipant(eventId: string, personId: string, role: ParticipantRole): Promise<void>;
  removeParticipant(eventId: string, personId: string, role: ParticipantRole): Promise<void>;
  addRecordEvidence(input: RecordEvidenceInput): Promise<RecordEvidence>;
  listRecordEvidence(targetKind: RecordEvidenceTargetKind, targetId: string): Promise<RecordEvidence[]>;
  deleteRecordEvidence(id: string): Promise<void>;
  // kinship (genealogy)
  addRelationship(
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    provenance?: RelationshipProvenance,
    subtype?: RelationshipSubtype
  ): Promise<Relationship | null>;
  updateRelationship(
    relId: string,
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    subtype?: RelationshipSubtype
  ): Promise<Relationship | null>;
  setPersonFrame(personId: string, frameStyle: string | null): Promise<void>;
  generatePersonBiography(personId: string): Promise<{ biography: string | null; noEvidence: boolean }>;
  removeRelationship(relId: string): Promise<void>;
  listRelationships(personId: string): Promise<Relationship[]>;
  allRelationships(): Promise<Relationship[]>;
  kinOf(personId: string): Promise<Kin>;
  importGedcom(): Promise<GedcomImportResult | null>;
  exportGedcom(): Promise<{ path: string } | null>;
  findMatches(): Promise<MatchCandidatePair[]>;
  mergePersons(targetId: string, sourceId: string): Promise<Person | null>;
  dismissMatch(a: string, b: string): Promise<void>;
  // social-relations network (independent from kinship)
  listSocialContacts(search?: string): Promise<SocialContact[]>;
  getSocialContact(contactId: string): Promise<SocialContact | null>;
  createSocialContact(input: SocialContactInput): Promise<SocialContact>;
  updateSocialContact(contactId: string, patch: Partial<SocialContactInput>): Promise<SocialContact | null>;
  deleteSocialContact(contactId: string): Promise<void>;
  listSocialRelationsForPerson(personId: string): Promise<SocialRelation[]>;
  listSocialRelationsTargetingPerson(personId: string): Promise<SocialRelation[]>;
  listSocialRelationsTargetingContact(contactId: string): Promise<SocialRelation[]>;
  createSocialRelation(input: SocialRelationInput): Promise<SocialRelation>;
  updateSocialRelation(relationId: string, patch: Partial<SocialRelationInput>): Promise<SocialRelation | null>;
  deleteSocialRelation(relationId: string): Promise<void>;
  socialGraph(): Promise<SocialGraphData>;
  // evidence-driven kinship suggestions (AI proposes, the user disposes)
  listKinSuggestions(): Promise<KinSuggestion[]>;
  kinSuggestionsForPerson(personId: string): Promise<KinSuggestion[]>;
  kinSuggestionCount(): Promise<number>;
  confirmKinSuggestion(suggestionId: string): Promise<boolean>;
  dismissKinSuggestion(suggestionId: string): Promise<boolean>;
  scanWorkRecords(nodusId: string): Promise<RecordsScanSummary>;
}
