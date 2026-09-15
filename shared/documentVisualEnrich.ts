import type { DocumentVisualTarget } from './documentSkills';
import type { AppSettings, ModelRef } from './types';

/** What one enrichment run may decide. The model is optional on purpose: a caller
 *  that has no opinion lets the app resolve it, which is what the IPC handler does. */
export interface DocumentVisualEnrichOptions {
  retry?: boolean;
  model?: ModelRef | null;
}

/** The vault setting whose task owns the resources of one kind of document. */
export type DocumentVisualModelKey = 'deepResearchModel' | 'immersionModel';

export function documentVisualModelKey(kind: DocumentVisualTarget['kind']): DocumentVisualModelKey {
  return kind === 'immersion' ? 'immersionModel' : 'deepResearchModel';
}

export interface DocumentVisualModelChoice {
  /** Asked for in this run: the dialog's picker, or the model that just wrote the report. */
  requested?: ModelRef | null;
  /** The task's model in the vault's settings right now. */
  configured?: ModelRef | null;
  /** The app-wide general text model, which every unset task inherits. */
  general?: ModelRef | null;
  /** The model recorded on the report when it was written. */
  stored?: ModelRef | null;
}

export type DocumentVisualSettings = Pick<AppSettings, DocumentVisualModelKey | 'synthesisModel'>;

/** A model the renderer may send across the IPC boundary, or null when the value is
 *  not one. An unusable picker value degrades to "no explicit choice" — and therefore
 *  to the configured model — instead of that broken object reaching a figure call. */
export function asDocumentVisualModel(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ModelRef>;
  if (typeof candidate.provider !== 'string' || !candidate.provider || typeof candidate.model !== 'string' || !candidate.model) return null;
  // Only the fields a ModelRef is made of cross back: the reasoning level is part of
  // the selection, anything else on the object is the renderer's business.
  return {
    provider: candidate.provider,
    model: candidate.model,
    ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}),
    ...(candidate.pending ? { pending: true } : {}),
  };
}

/** Resolve the choice against the settings blob, for callers that hold settings
 *  but not a stored report: the UI's picker cannot see what the report remembers. */
export function documentVisualModelFromSettings(settings: DocumentVisualSettings, kind: DocumentVisualTarget['kind'], requested?: ModelRef | null): ModelRef | null {
  return resolveDocumentVisualModel({
    requested,
    configured: settings[documentVisualModelKey(kind)],
    general: settings.synthesisModel,
  });
}

/**
 * Which engine generates a document's visual resources.
 *
 * The model stored on a report is provenance — who wrote the prose — and not a
 * decision about who writes the figures, so it comes last. Placing it above the
 * settings is what let a report written with a subscription provider keep asking that
 * provider for its resources after the reader had moved every task to another one,
 * with no way to say otherwise: the failure named a quota the report's old engine had
 * spent, not the model the reader had chosen since.
 */
export function resolveDocumentVisualModel(choice: DocumentVisualModelChoice): ModelRef | null {
  return choice.requested ?? choice.configured ?? choice.general ?? choice.stored ?? null;
}
