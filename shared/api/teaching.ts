// The teaching slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { ExamExportFormat, ExamExportOptions, ExamImagePick, TeachingLogo, ExamQuestion, ExamQuestionGenerationRequest, ExamQuestionGenerationResult, ExamQuestionInput, TeachingExam, TeachingExamDetail, TeachingExamInput } from '../teachingExams';
import type { RubricCellFillRequest, RubricCellFillResult, RubricExportFormat, RubricExportOptions, RubricGenerationRequest, RubricGenerationResult, TeachingRubric, TeachingRubricInput } from '../teachingRubrics';
import type { AssessmentItem, AssessmentPlan, GradeEntry, PlanRulesPatch } from '../assessment/model';
import type { ProposedPlan } from '../assessmentImport';
import type { TeachingGroup, TeachingGroupInput, TeachingStudent } from '../teachingGroups';

export interface TeachingApi {
  // Gradebook (teaching vault). The plan is the programación / guía docente.
  listAssessmentPlans(options?: { subjectId?: string | null; academicYearId?: string | null }): Promise<AssessmentPlan[]>;
  getAssessmentPlan(id: string): Promise<{ plan: AssessmentPlan; items: AssessmentItem[] }>;
  createAssessmentPlan(input: { name: string; subjectId: string; academicYearId?: string | null; profile?: string }): Promise<AssessmentPlan>;
  updateAssessmentPlan(id: string, patch: { name?: string; academicYearId?: string | null; profile?: string; rules?: PlanRulesPatch }): Promise<AssessmentPlan>;
  publishAssessmentPlan(id: string): Promise<AssessmentPlan>;
  reviseAssessmentPlan(id: string): Promise<AssessmentPlan>;
  deleteAssessmentPlan(id: string): Promise<void>;
  createAssessmentItem(planId: string, input: Partial<AssessmentItem>): Promise<AssessmentItem>;
  updateAssessmentItem(id: string, patch: Partial<AssessmentItem>): Promise<AssessmentItem>;
  deleteAssessmentItem(id: string): Promise<void>;
  reorderAssessmentItems(planId: string, orderedIds: string[]): Promise<AssessmentItem[]>;
  listGradeEntries(planId: string, convocatoria?: string): Promise<GradeEntry[]>;
  setGradeEntry(input: { studentId: string; itemId: string; convocatoria?: string; rawValue?: number | null; status?: GradeEntry['status']; isOverride?: boolean; note?: string }): Promise<GradeEntry>;
  clearGradeEntry(studentId: string, itemId: string, convocatoria?: string): Promise<void>;
  gradebookCohortStats(planId: string, groupId: string, convocatoria?: string): Promise<{ maxByItem: Record<string, number> }>;
  /** studentId → itemId → fraction already earned in an earlier convocatoria (ratchet rule). */
  gradebookRatchetBaseline(planId: string, groupId: string, convocatoria?: string): Promise<Record<string, Record<string, number>>>;
  importAssessmentPlan(request: { planId: string; text: string }): Promise<ProposedPlan>;
  applyProposedPlan(planId: string, proposal: ProposedPlan): Promise<AssessmentItem[]>;
  exportGradebookActa(format: 'pdf' | 'docx' | 'csv' | 'xlsx', input: unknown, grid?: { columns: unknown[]; rows: unknown[] }): Promise<{ path: string } | null>;
  exportGradebookBoletin(input: unknown): Promise<{ path: string } | null>;
  addExamBlock(planId: string, examId: string, weight?: number): Promise<AssessmentItem[]>;
  addRubricItem(planId: string, rubricId: string, weight?: number): Promise<AssessmentItem[]>;
  setRubricEvaluation(input: { studentId: string; itemId: string; convocatoria?: string; levels: Record<string, string> }): Promise<GradeEntry>;
  getRubricEvaluation(studentId: string, itemId: string, convocatoria?: string): Promise<Record<string, string>>;
  // Student groups (teaching vault). `academicYearId: null` scopes to the groups that
  // predate academic years; omitting it returns every year.
  listTeachingGroups(options?: { subjectId?: string | null; academicYearId?: string | null }): Promise<TeachingGroup[]>;
  getTeachingGroup(id: string): Promise<TeachingGroup>;
  createTeachingGroup(input: TeachingGroupInput): Promise<TeachingGroup>;
  updateTeachingGroup(
    id: string,
    patch: Partial<Pick<TeachingGroup, 'name' | 'academicYearId' | 'expectedSize' | 'position'>>,
  ): Promise<TeachingGroup>;
  deleteTeachingGroup(id: string): Promise<void>;
  addTeachingStudent(groupId: string, count?: number): Promise<TeachingGroup>;
  updateTeachingStudent(
    id: string,
    patch: Partial<Pick<TeachingStudent, 'givenNames' | 'surnames' | 'comments' | 'position'>>,
  ): Promise<TeachingStudent>;
  deleteTeachingStudent(id: string): Promise<void>;
  importStudentsFromGroup(targetGroupId: string, sourceGroupId: string): Promise<TeachingGroup>;
  // Rubric builder (teaching vault).
  listTeachingRubrics(options?: { subjectId?: string | null; search?: string }): Promise<TeachingRubric[]>;
  getTeachingRubric(id: string): Promise<TeachingRubric>;
  createTeachingRubric(input?: TeachingRubricInput): Promise<TeachingRubric>;
  updateTeachingRubric(id: string, patch: Partial<TeachingRubricInput>): Promise<TeachingRubric>;
  deleteTeachingRubric(id: string): Promise<void>;
  duplicateTeachingRubric(id: string): Promise<TeachingRubric>;
  setTeachingRubricCell(id: string, criterionId: string, levelId: string, text: string): Promise<TeachingRubric>;
  fillRubricCell(request: RubricCellFillRequest): Promise<RubricCellFillResult>;
  generateRubric(request: RubricGenerationRequest): Promise<RubricGenerationResult>;
  pickRubricSourceFile(): Promise<{ filePath: string; name: string } | null>;
  exportTeachingRubric(id: string, format: RubricExportFormat, options?: RubricExportOptions): Promise<{ path: string } | null>;
  // Exam paper builder (teaching vault).
  listTeachingExams(options?: { subjectId?: string | null }): Promise<TeachingExam[]>;
  getTeachingExam(id: string): Promise<TeachingExamDetail>;
  createTeachingExam(input: TeachingExamInput): Promise<TeachingExamDetail>;
  updateTeachingExam(id: string, patch: Partial<TeachingExamInput>): Promise<TeachingExamDetail>;
  deleteTeachingExam(id: string): Promise<void>;
  duplicateTeachingExam(id: string): Promise<TeachingExamDetail>;
  addTeachingExamQuestion(examId: string, input: ExamQuestionInput): Promise<ExamQuestion>;
  updateTeachingExamQuestion(id: string, patch: Partial<ExamQuestionInput>): Promise<ExamQuestion>;
  deleteTeachingExamQuestion(id: string): Promise<void>;
  reorderTeachingExamQuestions(examId: string, orderedIds: string[]): Promise<ExamQuestion[]>;
  generateExamQuestion(request: ExamQuestionGenerationRequest): Promise<ExamQuestionGenerationResult>;
  pickExamImage(kind: 'logo' | 'figure'): Promise<ExamImagePick | null>;
  listTeachingLogos(): Promise<TeachingLogo[]>;
  addTeachingLogo(name: string, dataUrl: string): Promise<TeachingLogo>;
  importTeachingLogo(): Promise<TeachingLogo | null>;
  deleteTeachingLogo(id: string): Promise<void>;
  exportTeachingExam(id: string, format: ExamExportFormat, options?: ExamExportOptions): Promise<{ path: string } | null>;
}
