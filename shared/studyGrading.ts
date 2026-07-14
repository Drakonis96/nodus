import type { ModelRef } from './types';

export type StudyGradingSeverity = 'supportive' | 'balanced' | 'strict';
export type StudyGradingAnnotationKind = 'strength' | 'error' | 'omission' | 'doubt';
export type StudyGradingAnnotationSeverity = 'info' | 'minor' | 'major';

export interface StudyRubricCriterion {
  id: string;
  label: string;
  description: string;
  weight: number;
}

export interface StudyRubric {
  id: string;
  shortId: string;
  name: string;
  description: string;
  criteria: StudyRubricCriterion[];
  builtIn: boolean;
  favorite: boolean;
  locked: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyRubricInput {
  name: string;
  description?: string;
  criteria: StudyRubricCriterion[];
  favorite?: boolean;
  locked?: boolean;
}

export interface StudyCriterionGrade {
  criterionId: string;
  score: number;
  rationale: string;
  evidence: string;
}

export interface StudyGradingAnnotationInput {
  from: number;
  to: number;
  kind: StudyGradingAnnotationKind;
  severity: StudyGradingAnnotationSeverity;
  message: string;
  suggestion?: string;
}

export interface StudyGradingAnnotation extends StudyGradingAnnotationInput {
  id: string;
  shortId: string;
  gradingRunId: string;
  createdAt: string;
}

export interface StudyGradingResult {
  criteria: StudyCriterionGrade[];
  estimatedScore: number;
  maxScore: number;
  generalFeedback: string;
  correctedAnswer: string;
  strengths: string[];
  errors: string[];
  omissions: string[];
  doubts: string[];
  uncertainty: string;
  annotations: StudyGradingAnnotationInput[];
}

export interface StudyGradingSource {
  title: string;
  excerpt: string;
  location?: Record<string, unknown>;
}

export interface StudyGradingRun {
  id: string;
  shortId: string;
  attemptAnswerId: string;
  rubricId: string | null;
  severity: StudyGradingSeverity;
  model: ModelRef;
  sources: StudyGradingSource[];
  result: StudyGradingResult;
  estimatedScore: number | null;
  manualScore: number | null;
  manualComment: string;
  annotations: StudyGradingAnnotation[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyGradingRequest {
  attemptAnswerId: string;
  rubricId: string;
  severity: StudyGradingSeverity;
  model?: ModelRef | null;
}

export interface StudyGradingStreamHandlers {
  onDelta(delta: string): void;
  onReasoning?(delta: string): void;
}

export function normalizeStudyRubricCriteria(criteria: StudyRubricCriterion[]): StudyRubricCriterion[] {
  const clean = criteria.map((criterion, index) => ({
    id: String(criterion.id || `C${index + 1}`).trim(), label: String(criterion.label ?? '').trim(),
    description: String(criterion.description ?? '').trim(), weight: Math.max(0, Number(criterion.weight) || 0),
  })).filter((criterion) => criterion.label && criterion.weight > 0);
  const total = clean.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!clean.length || total <= 0) throw new Error('La rúbrica necesita al menos un criterio con peso positivo.');
  return clean.map((criterion) => ({ ...criterion, weight: criterion.weight / total }));
}

export function calculateStudyGradingScore(criteria: StudyRubricCriterion[], grades: StudyCriterionGrade[], maxScore: number): number {
  const normalized = normalizeStudyRubricCriteria(criteria);
  const byId = new Map(grades.map((grade) => [grade.criterionId, Math.min(1, Math.max(0, Number(grade.score) || 0))]));
  const ratio = normalized.reduce((sum, criterion) => sum + criterion.weight * (byId.get(criterion.id) ?? 0), 0);
  return Math.round(Math.max(0, maxScore) * ratio * 100) / 100;
}
