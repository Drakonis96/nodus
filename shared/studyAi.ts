import type { ModelRef } from './types';

export const STUDY_AI_TASKS = ['chat', 'improve', 'questions', 'grading', 'flashcards'] as const;
export type StudyAiTask = typeof STUDY_AI_TASKS[number];
export interface StudyAiUsage { id: string; shortId: string; task: StudyAiTask; model: ModelRef; inputChars: number; outputChars: number; estimatedCostUsd: number | null; status: 'ok' | 'error' | 'cancelled'; fallbackUsed: boolean; error: string | null; startedAt: string; finishedAt: string }
export interface StudyAiUsageSummary { month: string; knownCostUsd: number; unknownCostCalls: number; calls: number; failedCalls: number; budgetUsd: number; percentUsed: number | null }

export function estimateStudyTokensFromChars(chars: number): number { return Math.max(0, Math.ceil(chars / 4)); }
export function studyAiBudgetState(knownCostUsd: number, budgetUsd: number): { percent: number | null; exceeded: boolean } { if (budgetUsd <= 0) return { percent: null, exceeded: false }; const percent = knownCostUsd / budgetUsd * 100; return { percent, exceeded: knownCostUsd >= budgetUsd }; }
export function isLocalStudyModel(model: ModelRef): boolean { return model.provider === 'ollama' || model.provider === 'lmstudio' || model.provider === 'nodus'; }
