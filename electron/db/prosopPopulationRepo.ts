import type { ProsopPopulationWorkspace } from '@shared/prosopography';
import { ensureProsopStudy, getProsopCriteria, listProsopMethodologies } from './prosopStudyRepo';
import {
  listProsopQuestionnaires,
  listProsopVariableRevisions,
  listProsopVocabularies,
} from './prosopQuestionnaireRepo';

/** One bounded read for the Population workspace; no N+1 calls cross IPC. */
export function getProsopPopulationWorkspace(): ProsopPopulationWorkspace {
  const study = ensureProsopStudy();
  return {
    study,
    methodologies: listProsopMethodologies(study.studyId).map((item) => ({
      ...item,
      criteria: getProsopCriteria(item.versionId),
    })),
    questionnaires: listProsopQuestionnaires(study.studyId).map((item) => ({
      ...item,
      revisions: listProsopVariableRevisions(item.questionnaireVersionId),
    })),
    vocabularies: listProsopVocabularies(study.studyId),
  };
}
