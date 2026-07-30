// teaching channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import * as teachingExams from '../db/teachingExamsRepo';
import * as teachingRubrics from '../db/teachingRubricsRepo';
import * as teachingGroups from '../db/teachingGroupsRepo';
import * as teachingGrades from '../db/teachingGradesRepo';
import { importAssessmentPlan } from '../ai/assessmentImport';
import { actaPdfBytes, actaDocxBytes, boletinPdfBytes, gradebookCsv, gradebookXlsx } from '../export/gradebookExport';
import type { ActaExportInput, BoletinExportInput, GradebookExportFormat } from '../export/gradebookExport';
import type { TeachingGroupInput } from '@shared/teachingGroups';
import * as teachingLogos from '../db/teachingLogosRepo';
import { fillRubricCell, generateRubric } from '../ai/teachingRubrics';
import { rubricDocxBytes, rubricPdfBytes } from '../export/rubricExport';
import type { RubricCellFillRequest, RubricExportFormat, RubricExportOptions, RubricGenerationRequest, TeachingRubricInput } from '@shared/teachingRubrics';
import { generateExamQuestion } from '../ai/teachingExamQuestions';
import { examDocxBytes, examPdfBytes } from '../export/examExport';
import { effectiveExamLanguage, MAX_EXAM_IMAGE_BYTES, ExamExportFormat, ExamExportOptions, ExamQuestionGenerationRequest, ExamQuestionInput, TeachingExamInput } from '@shared/teachingExams';
import path from 'node:path';
import fs from 'node:fs';
import { dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';

export function registerTeachingIpc({ h, getWindow }: IpcContext): void {
  // ---- Gradebook (teaching vault) ----
  h('teaching:plans:list', async (_e, options?: { subjectId?: string | null; academicYearId?: string | null }) => teachingGrades.listAssessmentPlans(options ?? {}));
  h('teaching:plans:get', async (_e, id: string) => teachingGrades.getAssessmentPlan(id));
  h('teaching:plans:create', async (_e, input: Parameters<typeof teachingGrades.createAssessmentPlan>[0]) => teachingGrades.createAssessmentPlan(input));
  h('teaching:plans:update', async (_e, id: string, patch: Parameters<typeof teachingGrades.updateAssessmentPlan>[1]) => teachingGrades.updateAssessmentPlan(id, patch));
  h('teaching:plans:publish', async (_e, id: string) => teachingGrades.publishAssessmentPlan(id));
  h('teaching:plans:revise', async (_e, id: string) => teachingGrades.reviseAssessmentPlan(id));
  h('teaching:plans:delete', async (_e, id: string) => {
    teachingGrades.deleteAssessmentPlan(id);
    return null;
  });
  h('teaching:items:create', async (_e, planId: string, input: Parameters<typeof teachingGrades.createAssessmentItem>[1]) => teachingGrades.createAssessmentItem(planId, input));
  h('teaching:items:update', async (_e, id: string, patch: Parameters<typeof teachingGrades.updateAssessmentItem>[1]) => teachingGrades.updateAssessmentItem(id, patch));
  h('teaching:items:delete', async (_e, id: string) => {
    teachingGrades.deleteAssessmentItem(id);
    return null;
  });
  h('teaching:items:reorder', async (_e, planId: string, orderedIds: string[]) => teachingGrades.reorderAssessmentItems(planId, orderedIds));
  h('teaching:entries:list', async (_e, planId: string, convocatoria?: string) => teachingGrades.listGradeEntries(planId, convocatoria ?? 'ordinaria'));
  h('teaching:entries:set', async (_e, input: Parameters<typeof teachingGrades.setGradeEntry>[0]) => teachingGrades.setGradeEntry(input));
  h('teaching:entries:clear', async (_e, studentId: string, itemId: string, convocatoria?: string) => {
    teachingGrades.clearGradeEntry(studentId, itemId, convocatoria ?? 'ordinaria');
    return null;
  });
  h('teaching:export:acta', async (_e, format: GradebookExportFormat, input: ActaExportInput, grid?: { columns: unknown[]; rows: unknown[] }) => {
    const base = (input.header.subject || 'acta').replace(/[\\/:*?"<>|]+/g, '-') || 'acta';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar acta',
      defaultPath: `${base}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    if (format === 'pdf') fs.writeFileSync(picked.filePath, await actaPdfBytes(input));
    else if (format === 'docx') fs.writeFileSync(picked.filePath, await actaDocxBytes(input));
    else if (format === 'xlsx') fs.writeFileSync(picked.filePath, gradebookXlsx((grid?.columns ?? []) as never, (grid?.rows ?? []) as never));
    else fs.writeFileSync(picked.filePath, gradebookCsv((grid?.columns ?? []) as never, (grid?.rows ?? []) as never), 'utf8');
    return { path: picked.filePath };
  });
  h('teaching:export:boletin', async (_e, input: BoletinExportInput) => {
    const base = (input.student.name || input.student.code || 'boletin').replace(/[\\/:*?"<>|]+/g, '-');
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar boletín',
      defaultPath: `${base}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, await boletinPdfBytes(input));
    return { path: picked.filePath };
  });
  h('teaching:items:fromExam', async (_e, planId: string, examId: string, weight?: number) => teachingGrades.addExamBlock(planId, examId, weight ?? 0));
  h('teaching:items:fromRubric', async (_e, planId: string, rubricId: string, weight?: number) => teachingGrades.addRubricItem(planId, rubricId, weight ?? 0));
  h('teaching:entries:rubric:set', async (_e, input: Parameters<typeof teachingGrades.setRubricEvaluation>[0]) => teachingGrades.setRubricEvaluation(input));
  h('teaching:entries:rubric:get', async (_e, studentId: string, itemId: string, convocatoria?: string) => teachingGrades.getRubricEvaluation(studentId, itemId, convocatoria ?? 'ordinaria'));
  h('teaching:plans:import', async (_e, request: { planId: string; text: string }) => importAssessmentPlan(request));
  h('teaching:plans:apply', async (_e, planId: string, proposal: Parameters<typeof teachingGrades.applyProposedPlan>[1]) => teachingGrades.applyProposedPlan(planId, proposal));
  h('teaching:entries:cohort', async (_e, planId: string, groupId: string, convocatoria?: string) => teachingGrades.cohortStats(planId, groupId, convocatoria ?? 'ordinaria'));
  h('teaching:entries:ratchet', async (_e, planId: string, groupId: string, convocatoria?: string) => teachingGrades.ratchetBaseline(planId, groupId, convocatoria ?? 'ordinaria'));

  // ---- Student groups (teaching vault) ----
  h('teaching:groups:list', async (_e, options?: { subjectId?: string | null; academicYearId?: string | null }) => teachingGroups.listTeachingGroups(options ?? {}));
  h('teaching:groups:get', async (_e, id: string) => teachingGroups.getTeachingGroup(id));
  h('teaching:groups:create', async (_e, input: TeachingGroupInput) => teachingGroups.createTeachingGroup(input));
  h('teaching:groups:update', async (_e, id: string, patch: Parameters<typeof teachingGroups.updateTeachingGroup>[1]) => teachingGroups.updateTeachingGroup(id, patch));
  h('teaching:groups:delete', async (_e, id: string) => {
    teachingGroups.deleteTeachingGroup(id);
    return null;
  });
  h('teaching:groups:student:add', async (_e, groupId: string, count?: number) => teachingGroups.addTeachingStudent(groupId, count ?? 1));
  h('teaching:groups:student:update', async (_e, id: string, patch: Parameters<typeof teachingGroups.updateTeachingStudent>[1]) => teachingGroups.updateTeachingStudent(id, patch));
  h('teaching:groups:student:delete', async (_e, id: string) => {
    teachingGroups.deleteTeachingStudent(id);
    return null;
  });
  h('teaching:groups:import', async (_e, targetGroupId: string, sourceGroupId: string) => teachingGroups.importStudentsFromGroup(targetGroupId, sourceGroupId));

  // ---- Rubric builder (teaching vault) ----
  h('teaching:rubrics:list', async (_e, options?: { subjectId?: string | null; search?: string }) => teachingRubrics.listTeachingRubrics(options ?? {}));
  h('teaching:rubrics:get', async (_e, id: string) => teachingRubrics.getTeachingRubric(id));
  h('teaching:rubrics:create', async (_e, input?: TeachingRubricInput) => teachingRubrics.createTeachingRubric(input ?? {}));
  h('teaching:rubrics:update', async (_e, id: string, patch: Partial<TeachingRubricInput>) => teachingRubrics.updateTeachingRubric(id, patch));
  h('teaching:rubrics:delete', async (_e, id: string) => {
    teachingRubrics.deleteTeachingRubric(id);
    return null;
  });
  h('teaching:rubrics:duplicate', async (_e, id: string) => teachingRubrics.duplicateTeachingRubric(id));
  h('teaching:rubrics:cell', async (_e, id: string, criterionId: string, levelId: string, text: string) => teachingRubrics.setTeachingRubricCell(id, criterionId, levelId, text));
  h('teaching:rubrics:cell:fill', async (_e, request: RubricCellFillRequest) => fillRubricCell(request));
  h('teaching:rubrics:generate', async (_e, request: RubricGenerationRequest) => generateRubric(request));
  h('teaching:rubrics:pickFile', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: 'Elegir el documento con las instrucciones de la tarea',
      properties: ['openFile'],
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'doc', 'txt', 'md', 'rtf', 'odt'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    return { filePath: picked.filePaths[0], name: path.basename(picked.filePaths[0]) };
  });
  h('teaching:rubrics:export', async (_e, id: string, format: RubricExportFormat, options?: RubricExportOptions) => {
    const rubric = teachingRubrics.getTeachingRubric(id);
    const baseName = (rubric.title || 'rubrica').replace(/[\\/:*?"<>|]+/g, '-') || 'rubrica';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar rúbrica',
      defaultPath: `${baseName}.${format}`,
      filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Word', extensions: ['docx'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const bytes = format === 'pdf' ? await rubricPdfBytes(rubric, options ?? {}) : await rubricDocxBytes(rubric, options ?? {});
    fs.writeFileSync(picked.filePath, bytes);
    return { path: picked.filePath };
  });

  // ---- Exam paper builder (teaching vault) ----
  h('teaching:exams:list', async (_e, options?: { subjectId?: string | null }) => teachingExams.listTeachingExams(options ?? {}));
  h('teaching:exams:get', async (_e, id: string) => teachingExams.getTeachingExam(id));
  h('teaching:exams:create', async (_e, input: TeachingExamInput) => teachingExams.createTeachingExam(input));
  h('teaching:exams:update', async (_e, id: string, patch: Partial<TeachingExamInput>) => teachingExams.updateTeachingExam(id, patch));
  h('teaching:exams:delete', async (_e, id: string) => {
    teachingExams.deleteTeachingExam(id);
    return null;
  });
  h('teaching:exams:duplicate', async (_e, id: string) => teachingExams.duplicateTeachingExam(id));
  h('teaching:exams:question:add', async (_e, examId: string, input: ExamQuestionInput) => teachingExams.addTeachingExamQuestion(examId, input));
  h('teaching:exams:question:update', async (_e, id: string, patch: Partial<ExamQuestionInput>) => teachingExams.updateTeachingExamQuestion(id, patch));
  h('teaching:exams:question:delete', async (_e, id: string) => {
    teachingExams.deleteTeachingExamQuestion(id);
    return null;
  });
  h('teaching:exams:question:reorder', async (_e, examId: string, orderedIds: string[]) => teachingExams.reorderTeachingExamQuestions(examId, orderedIds));
  h('teaching:exams:question:generate', async (_e, request: ExamQuestionGenerationRequest) => generateExamQuestion(request));
  h('teaching:exams:pickImage', async (_e, kind: 'logo' | 'figure') => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: kind === 'logo' ? 'Elegir logotipo' : 'Elegir imagen de la pregunta',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    const filePath = picked.filePaths[0];
    // Both logos and figures are downscaled on import: the raw file used to be embedded
    // as base64 in the row, the preview and every export, which was slow and could be
    // refused outright. Resizing makes any picture the teacher owns work.
    if (kind === 'logo') return teachingLogos.importLogoFromFile(filePath);
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_EXAM_IMAGE_BYTES * 4) throw new Error('Esa imagen es demasiado grande.');
    return teachingLogos.importImageFromFile(filePath);
  });
  h('teaching:logos:list', async () => teachingLogos.listTeachingLogos());
  h('teaching:logos:add', async (_e, name: string, dataUrl: string) => teachingLogos.addTeachingLogo(name, dataUrl));
  h('teaching:logos:import', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: 'Añadir logotipo a la biblioteca',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    const imported = await teachingLogos.importLogoFromFile(picked.filePaths[0]);
    return teachingLogos.addTeachingLogo(imported.name, imported.dataUrl);
  });
  h('teaching:logos:delete', async (_e, id: string) => {
    teachingLogos.deleteTeachingLogo(id);
    return null;
  });
  h('teaching:exams:export', async (_e, id: string, format: ExamExportFormat, options?: ExamExportOptions) => {
    const exam = teachingExams.getTeachingExam(id);
    const baseName = (exam.header.examTitle?.trim() || exam.title).replace(/[\\/:*?"<>|]+/g, '-') || 'examen';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar examen',
      defaultPath: `${baseName}.${format}`,
      filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Word', extensions: ['docx'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    // The document follows the interface language until the teacher picks one for
    // this exam; from then on their choice wins.
    const printed = { ...exam, language: effectiveExamLanguage(exam, getSettings().uiLanguage) };
    const bytes = format === 'pdf'
      ? await examPdfBytes(printed, printed.questions, options ?? {})
      : await examDocxBytes(printed, printed.questions, options ?? {});
    fs.writeFileSync(picked.filePath, bytes);
    return { path: picked.filePath };
  });
}
