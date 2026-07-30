// Prosopography channels: methodology and questionnaire, sources and capture,
// observations, identity, membership, analysis, networks, proposals and export.
//
// First domain extracted from the monolithic registerIpc, and the template for
// the rest: the handlers are moved verbatim, the repo imports come with them, and
// nothing but `h` is needed from the shared context. The renderer's method names
// are unchanged (see shared/api/prosopography.ts) and so are the channel names —
// scripts/test-ipc-contract.mjs is what proves the second half of that claim.
import type { IpcContext } from './context';
import { getProsopPopulationWorkspace } from '../db/prosopPopulationRepo';
import {
  createProsopMethodologyDraft,
  publishProsopMethodology,
  replaceProsopCriteria,
  updateProsopStudy,
} from '../db/prosopStudyRepo';
import {
  createProsopQuestionnaireDraft,
  deleteProsopVariableRevision,
  publishProsopQuestionnaire,
  saveProsopVariableRevision,
  saveProsopVocabulary,
  saveProsopVocabularyTerm,
} from '../db/prosopQuestionnaireRepo';
import { deleteProsopSource, saveProsopSource, saveProsopSourceSegment } from '../db/prosopSourcesRepo';
import {
  getProsopSourcesWorkspace,
  importProsopDelimited,
  reviewProsopCaptureRow,
  saveProsopCaptureTemplate,
} from '../db/prosopCaptureRepo';
import {
  getProsopObservationsWorkspace,
  retireProsopResolution,
  reviewProsopFactoid,
  saveProsopFactoid,
  saveProsopMissingValue,
  saveProsopResolution,
} from '../db/prosopFactoidsRepo';
import {
  createProsopPerson,
  decideProsopIdentityHypothesis,
  getProsopIdentityWorkspace,
  mergeProsopPersons,
  reverseProsopPersonMerge,
  saveProsopAuthorityId,
  saveProsopIdentityHypothesis,
  saveProsopNameAttestation,
  saveProsopOrganization,
  searchProsopIdentityCandidates,
} from '../db/prosopIdentityRepo';
import {
  getProsopMembershipWorkspace,
  refreshProsopDynamicCohort,
  saveProsopCohort,
  saveProsopMembership,
} from '../db/prosopMembershipRepo';
import { getProsopAnalysisWorkspace, runProsopAnalysis } from '../db/prosopAnalysisRepo';
import {
  deriveProsopCooccurrenceLayer,
  getProsopNetworksWorkspace,
  saveProsopNetworkEdge,
  saveProsopNetworkLayer,
} from '../db/prosopNetworksRepo';
import {
  createProsopProposal,
  decideProsopProposal,
  listProsopProposals,
  saveProsopNoteLink,
  searchProsopography,
} from '../db/prosopSearchRepo';
import { auditProsopIntegrity, exportProsopIpif, exportProsopLongRows } from '../db/prosopInterchangeRepo';
import { seedProsopDemo } from '../db/prosopDemoRepo';

export function registerProsopographyIpc({ h }: IpcContext): void {
  // ── Prosopography: methodology and questionnaire ──────────────────────────
  h('prosop:population:workspace', async () => getProsopPopulationWorkspace());
  h('prosop:study:update', async (_e, patch) => updateProsopStudy(patch));
  h('prosop:methodology:createDraft', async (_e, actor) => createProsopMethodologyDraft(actor));
  h('prosop:methodology:replaceCriteria', async (_e, versionId, criteria) => replaceProsopCriteria(versionId, criteria));
  h('prosop:methodology:publish', async (_e, versionId, changeSummary, actor) => publishProsopMethodology(versionId, changeSummary, actor));
  h('prosop:questionnaire:createDraft', async (_e, input) => createProsopQuestionnaireDraft(input));
  h('prosop:questionnaire:saveVariable', async (_e, questionnaireVersionId, input) => saveProsopVariableRevision(questionnaireVersionId, input));
  h('prosop:questionnaire:deleteVariable', async (_e, questionnaireVersionId, variableId) => deleteProsopVariableRevision(questionnaireVersionId, variableId));
  h('prosop:questionnaire:publish', async (_e, questionnaireVersionId, changeSummary, actor) => publishProsopQuestionnaire(questionnaireVersionId, changeSummary, actor));
  h('prosop:vocabulary:save', async (_e, input) => saveProsopVocabulary(input));
  h('prosop:vocabulary:saveTerm', async (_e, input) => saveProsopVocabularyTerm(input));
  h('prosop:sources:workspace', async () => getProsopSourcesWorkspace());
  h('prosop:sources:save', async (_e, input) => saveProsopSource(input));
  h('prosop:sources:delete', async (_e, sourceId) => deleteProsopSource(sourceId));
  h('prosop:sources:saveSegment', async (_e, input) => saveProsopSourceSegment(input));
  h('prosop:capture:saveTemplate', async (_e, input) => saveProsopCaptureTemplate(input));
  h('prosop:capture:importDelimited', async (_e, input) => importProsopDelimited(input));
  h('prosop:capture:reviewRow', async (_e, captureRowId, status) => reviewProsopCaptureRow(captureRowId, status));
  h('prosop:observations:workspace', async () => getProsopObservationsWorkspace());
  h('prosop:factoids:save', async (_e, input) => saveProsopFactoid(input));
  h('prosop:factoids:review', async (_e, factoidId, status, reviewedBy) => reviewProsopFactoid(factoidId, status, reviewedBy));
  h('prosop:missing:save', async (_e, input) => saveProsopMissingValue(input));
  h('prosop:resolutions:save', async (_e, input) => saveProsopResolution(input));
  h('prosop:resolutions:retire', async (_e, resolutionId) => retireProsopResolution(resolutionId));
  h('prosop:identity:workspace', async () => getProsopIdentityWorkspace());
  h('prosop:identity:createPerson', async (_e, input) => createProsopPerson(input));
  h('prosop:identity:saveAttestation', async (_e, input) => saveProsopNameAttestation(input));
  h('prosop:identity:candidates', async (_e, literalName, limit) => searchProsopIdentityCandidates(literalName, limit));
  h('prosop:identity:saveHypothesis', async (_e, input) => saveProsopIdentityHypothesis(input));
  h('prosop:identity:decideHypothesis', async (_e, hypothesisId, status, reviewedBy) => decideProsopIdentityHypothesis(hypothesisId, status, reviewedBy));
  h('prosop:identity:merge', async (_e, survivorId, absorbedId, rationale, actor) => mergeProsopPersons(survivorId, absorbedId, rationale, actor));
  h('prosop:identity:reverseMerge', async (_e, mergeId, actor) => reverseProsopPersonMerge(mergeId, actor));
  h('prosop:identity:saveAuthority', async (_e, input) => saveProsopAuthorityId(input));
  h('prosop:identity:saveOrganization', async (_e, input) => saveProsopOrganization(input));
  h('prosop:membership:workspace', async () => getProsopMembershipWorkspace());
  h('prosop:membership:save', async (_e, input) => saveProsopMembership(input));
  h('prosop:cohorts:save', async (_e, input) => saveProsopCohort(input));
  h('prosop:cohorts:refresh', async (_e, cohortId) => refreshProsopDynamicCohort(cohortId));
  h('prosop:analysis:workspace', async () => getProsopAnalysisWorkspace());
  h('prosop:analysis:run', async (_e, input) => runProsopAnalysis(input));
  h('prosop:networks:workspace', async () => getProsopNetworksWorkspace());
  h('prosop:networks:saveLayer', async (_e, input) => saveProsopNetworkLayer(input));
  h('prosop:networks:saveEdge', async (_e, input) => saveProsopNetworkEdge(input));
  h('prosop:networks:deriveCooccurrence', async (_e, layerId) => deriveProsopCooccurrenceLayer(layerId));
  h('prosop:search', async (_e, query, kind) => searchProsopography(query, kind));
  h('prosop:proposals:list', async () => listProsopProposals());
  h('prosop:proposals:create', async (_e, input) => createProsopProposal(input));
  h('prosop:proposals:decide', async (_e, proposalId, status, reviewedBy, decisionNote) => decideProsopProposal(proposalId, status, reviewedBy, decisionNote));
  h('prosop:notes:link', async (_e, input) => saveProsopNoteLink(input));
  h('prosop:export:long', async () => exportProsopLongRows());
  h('prosop:export:ipif', async () => exportProsopIpif());
  h('prosop:integrity:audit', async () => auditProsopIntegrity());
  h('prosop:demo:seed', async () => seedProsopDemo());
}
