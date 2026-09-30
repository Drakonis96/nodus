import type { AppSettings, ModelRef } from './types';
import { GRANULAR_MODEL_KEYS } from './modelSettings';

/**
 * Favourites and task selections can name a model its provider no longer serves (a retired or
 * legacy id such as DeepSeek's `deepseek-v4-flash`). These helpers find them against the
 * providers' live catalogues and rewrite them, so the user can clean up without editing every
 * task selector by hand.
 */

/** Every single-model setting that selects a text/vision model for a task. */
// The legacy global model is not a task selection (see scripts/test-model-independence.mjs).
export const TASK_MODEL_KEYS = ['synthesisModel', 'documentProfileModel', 'documentAuditModel', ...GRANULAR_MODEL_KEYS] as const;
export type TaskModelKey = (typeof TASK_MODEL_KEYS)[number];

const same = (a: ModelRef | null | undefined, b: ModelRef | null | undefined) =>
  Boolean(a && b && a.provider === b.provider && a.model === b.model);

/** A provider's live catalogue: the ids it lists, or null when it could not be read (no key,
 *  offline, an error). A null catalogue never marks anything stale. */
export type ModelCatalogues = Map<string, Set<string> | null>;

/** Favourites whose provider catalogue was read and does not list them. */
export function staleFavorites(favorites: readonly ModelRef[], catalogues: ModelCatalogues): ModelRef[] {
  return favorites.filter((model) => {
    const listed = catalogues.get(model.provider);
    return listed != null && !listed.has(model.model);
  });
}

/** The task settings that currently select this model. */
export function tasksUsingModel(settings: Partial<Pick<AppSettings, TaskModelKey>>, model: ModelRef): TaskModelKey[] {
  return TASK_MODEL_KEYS.filter((key) => same(settings[key] as ModelRef | null | undefined, model));
}

/** The settings patch that moves every task and the favourites from one model to another. The
 *  replacement is not added to favourites twice. With `to` null, only the favourite is removed. */
export function replaceModelPatch(
  settings: Partial<Pick<AppSettings, TaskModelKey | 'favorites'>>,
  from: ModelRef,
  to: ModelRef | null,
): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  if (to) {
    for (const key of tasksUsingModel(settings, from)) (patch as Record<string, unknown>)[key] = { provider: to.provider, model: to.model };
  }
  const favorites = (settings.favorites ?? []).filter((model) => !same(model, from));
  if (to && !favorites.some((model) => same(model, to))) {
    const at = (settings.favorites ?? []).findIndex((model) => same(model, from));
    favorites.splice(at < 0 ? favorites.length : at, 0, { provider: to.provider, model: to.model });
  }
  patch.favorites = favorites;
  return patch;
}
