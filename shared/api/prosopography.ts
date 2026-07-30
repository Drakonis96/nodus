// The prosopography slice of the window.nodus contract.
//
// shared/types.ts held a 1,984-line `NodusApi` interface with ~1,240 methods, so
// every feature in any domain edited the same declaration. The domain *types* had
// already been split out long ago (shared/prosopography.ts and its siblings);
// this splits the API surface the same way.
//
// The public shape does not change: NodusApi still extends this, window.nodus is
// still flat, and callers still write window.nodus.searchProsopography(...). What
// changes is which file a prosopography method is declared in.
import type {
  ProsopCriterionInput,
  ProsopMethodologyVersion,
  ProsopPopulationCriterion,
  ProsopPopulationWorkspace,
  ProsopQuestionnaireDraftInput,
  ProsopQuestionnaireVersion,
  ProsopStudy,
  ProsopStudyInput,
  ProsopVariableRevision,
  ProsopVariableRevisionInput,
  ProsopVocabulary,
  ProsopVocabularyTerm,
  ProsopSource,
  ProsopSourceInput,
  ProsopSourceSegment,
  ProsopSourceSegmentInput,
  ProsopSourcesWorkspace,
  ProsopCaptureTemplate,
  ProsopCaptureBatch,
  ProsopCaptureRow,
  ProsopFactoidDossier,
  ProsopFactoidInput,
  ProsopMissingValue,
  ProsopMissingValueInput,
  ProsopObservationsWorkspace,
  ProsopResolution,
  ProsopResolutionInput,
  ProsopAuthorityId,
  ProsopIdentityHypothesis,
  ProsopIdentityHypothesisInput,
  ProsopIdentityWorkspace,
  ProsopNameAttestation,
  ProsopNameAttestationInput,
  ProsopOrganization,
  ProsopPersonProfile,
  ProsopCohort,
  ProsopCohortInput,
  ProsopMembershipInput,
  ProsopMembershipWorkspace,
  ProsopPopulationMembership,
  ProsopAnalysisDefinitionRecord,
  ProsopAnalysisRunRecord,
  ProsopAnalysisWorkspace,
  ProsopProjectionDefinition,
  ProsopNetworkEdge,
  ProsopNetworkEdgeInput,
  ProsopNetworkLayer,
  ProsopNetworkLayerInput,
  ProsopNetworksWorkspace,
  ProsopNoteLink,
  ProsopProposal,
  ProsopSearchHit,
  ProsopInvariantIssue,
} from '../prosopography';
import type { ProsopIpifDocument } from '../prosopographyInterchange';
// PersonInput is the records-ontology input shape, still declared in
// shared/types.ts. The cycle is types-only and therefore erased at build time.
import type { PersonInput } from '../types';

export interface ProsopographyApi {
  // Prosopography — methodology, population and questionnaire.
  getProsopPopulationWorkspace(): Promise<ProsopPopulationWorkspace>;
  updateProsopStudy(patch: ProsopStudyInput): Promise<ProsopStudy>;
  createProsopMethodologyDraft(actor?: string): Promise<ProsopMethodologyVersion>;
  replaceProsopCriteria(versionId: string, criteria: ProsopCriterionInput[]): Promise<ProsopPopulationCriterion[]>;
  publishProsopMethodology(versionId: string, changeSummary: string, actor?: string): Promise<ProsopMethodologyVersion>;
  createProsopQuestionnaireDraft(input: ProsopQuestionnaireDraftInput): Promise<ProsopQuestionnaireVersion>;
  saveProsopVariableRevision(questionnaireVersionId: string, input: ProsopVariableRevisionInput): Promise<ProsopVariableRevision>;
  deleteProsopVariableRevision(questionnaireVersionId: string, variableId: string): Promise<void>;
  publishProsopQuestionnaire(questionnaireVersionId: string, changeSummary: string, actor?: string): Promise<ProsopQuestionnaireVersion>;
  saveProsopVocabulary(input: Partial<ProsopVocabulary> & { name: string }): Promise<ProsopVocabulary>;
  saveProsopVocabularyTerm(input: Partial<ProsopVocabularyTerm> & { vocabularyId: string; code: string; preferredLabel: string }): Promise<ProsopVocabularyTerm>;
  getProsopSourcesWorkspace(): Promise<ProsopSourcesWorkspace>;
  saveProsopSource(input: ProsopSourceInput): Promise<ProsopSource>;
  deleteProsopSource(sourceId: string): Promise<void>;
  saveProsopSourceSegment(input: ProsopSourceSegmentInput): Promise<ProsopSourceSegment>;
  saveProsopCaptureTemplate(input: Partial<ProsopCaptureTemplate> & { name: string; sourceKind: string }): Promise<ProsopCaptureTemplate>;
  importProsopDelimited(input: { sourceId?: string | null; templateId?: string | null; fileName: string; text: string; locatorColumn?: string | null; createdBy?: string }): Promise<ProsopCaptureBatch & { rows: ProsopCaptureRow[] }>;
  reviewProsopCaptureRow(captureRowId: string, status: 'accepted' | 'rejected'): Promise<ProsopCaptureRow>;
  getProsopObservationsWorkspace(): Promise<ProsopObservationsWorkspace>;
  saveProsopFactoid(input: ProsopFactoidInput): Promise<ProsopFactoidDossier>;
  reviewProsopFactoid(factoidId: string, status: 'reviewed' | 'rejected', reviewedBy?: string): Promise<ProsopFactoidDossier>;
  saveProsopMissingValue(input: ProsopMissingValueInput): Promise<ProsopMissingValue>;
  saveProsopResolution(input: ProsopResolutionInput): Promise<ProsopResolution>;
  retireProsopResolution(resolutionId: string): Promise<void>;
  getProsopIdentityWorkspace(): Promise<ProsopIdentityWorkspace>;
  createProsopPerson(input: PersonInput & { preferredNameBasis?: string; privacyStatus?: ProsopPersonProfile['privacyStatus'] }): Promise<ProsopPersonProfile>;
  saveProsopNameAttestation(input: ProsopNameAttestationInput): Promise<ProsopNameAttestation>;
  searchProsopIdentityCandidates(literalName: string, limit?: number): Promise<Array<ProsopPersonProfile & { score: number; reasons: string[] }>>;
  saveProsopIdentityHypothesis(input: ProsopIdentityHypothesisInput): Promise<ProsopIdentityHypothesis>;
  decideProsopIdentityHypothesis(hypothesisId: string, status: 'accepted' | 'rejected', reviewedBy?: string): Promise<ProsopIdentityHypothesis>;
  mergeProsopPersons(survivorId: string, absorbedId: string, rationale: string, actor?: string): Promise<string>;
  reverseProsopPersonMerge(mergeId: string, actor?: string): Promise<void>;
  saveProsopAuthorityId(input: Omit<ProsopAuthorityId,'authorityId'|'createdAt'|'status'> & { authorityId?: string }): Promise<ProsopAuthorityId>;
  saveProsopOrganization(input: Partial<ProsopOrganization> & { preferredName: string }): Promise<ProsopOrganization>;
  getProsopMembershipWorkspace(): Promise<ProsopMembershipWorkspace>;
  saveProsopMembership(input: ProsopMembershipInput): Promise<ProsopPopulationMembership>;
  saveProsopCohort(input: ProsopCohortInput): Promise<ProsopCohort>;
  refreshProsopDynamicCohort(cohortId: string): Promise<ProsopCohort>;
  getProsopAnalysisWorkspace(): Promise<ProsopAnalysisWorkspace>;
  runProsopAnalysis(input: { analysisId?: string; title: string; analysisKind: ProsopAnalysisDefinitionRecord['analysisKind']; personIds?: string[]; variableIds: string[]; cohortIds?: string[]; createdBy?: string; policies?: ProsopProjectionDefinition['variablePolicies'] }): Promise<ProsopAnalysisRunRecord>;
  getProsopNetworksWorkspace(): Promise<ProsopNetworksWorkspace>;
  saveProsopNetworkLayer(input: ProsopNetworkLayerInput): Promise<ProsopNetworkLayer>;
  saveProsopNetworkEdge(input: ProsopNetworkEdgeInput): Promise<ProsopNetworkEdge>;
  deriveProsopCooccurrenceLayer(layerId: string): Promise<ProsopNetworkLayer>;
  searchProsopography(query: string, kind?: ProsopSearchHit['kind']): Promise<ProsopSearchHit[]>;
  listProsopProposals(): Promise<ProsopProposal[]>;
  createProsopProposal(input: { proposalKind: string; sourceId?: string | null; sourceSegmentId?: string | null; captureRowId?: string | null; targetKind: string; targetId?: string | null; payload: import('../prosopography').JsonValue; confidence?: number | null; rationale: string; producerKind: 'ai' | 'rule' | 'import' | 'human'; producerId: string; questionnaireVersionId?: string | null }): Promise<ProsopProposal>;
  decideProsopProposal(proposalId: string, status: 'accepted' | 'rejected', reviewedBy?: string, decisionNote?: string): Promise<ProsopProposal>;
  saveProsopNoteLink(input: { linkId?: string; nodusId: string; targetKind: string; targetId: string; targetVaultId?: string | null; relationKind?: string }): Promise<ProsopNoteLink>;
  exportProsopLongRows(): Promise<Array<Record<string, unknown>>>;
  exportProsopIpif(): Promise<ProsopIpifDocument>;
  auditProsopIntegrity(): Promise<{ ok: boolean; issues: ProsopInvariantIssue[]; checksum: string; syncCoverage: { included: Record<string,string[]>; excluded:string[]; unclassified:string[]; unmergeable:string[] } }>;
  seedProsopDemo(): Promise<{ seeded: boolean; message: string }>;
}
