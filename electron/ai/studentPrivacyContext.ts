/**
 * Request-scoped student privacy (teaching vault).
 *
 * A feature that is about to send roster text to a model opens a scope:
 *
 *     withStudentPseudonyms({ groupId, students }, () =>
 *       runStudyAiTask(spec, (model) => completeText({ system, user }, model)));
 *
 * and every AI call made inside it gets its student names swapped for codes on the
 * way out and swapped back on the way in. The transport (aiClient.ts) reads the scope
 * with `currentPrivacyScope()`; nothing in between has to know this exists.
 *
 * WHY AsyncLocalStorage AND NOT A FIELD ON `CallOpts`
 * ---------------------------------------------------
 * An explicit parameter is normally the right default, and this file is the one place
 * in the repo that argues otherwise, so the reasoning is worth writing down.
 *
 * `CallOpts` is not reliably propagated. `repairJson` (aiClient.ts) builds a BRAND-NEW
 * options literal — `{ system, user, temperature, maxTokens }` — and calls the
 * transport with it; anything else on the original object is dropped. `completeJson`
 * rebuilds its options per retry attempt, and `runStudyAiTask` re-invokes the whole
 * operation for retries and for the fallback model.
 *
 * So the choice is between two failure modes, not between two aesthetics:
 *
 *   · a dropped field  → real names of minors are sent to a third party, silently
 *                        and irreversibly. Nobody finds out.
 *   · a missed ALS scope → text is anonymised where it did not strictly need to be.
 *                        Visible, harmless, recoverable.
 *
 * Pick the mechanism whose failure is safe. `CallOpts.skipStudentPseudonyms` exists
 * as a typed escape hatch so that a future caller opts out loudly rather than by
 * quietly restructuring a scope.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  buildPseudonymScope,
  type PseudonymScope,
  type PseudonymStudent,
  type PseudonymWarning,
} from '@shared/studentPseudonyms';
import { getSettings } from '../db/settingsRepo';

export interface ActivePrivacyScope {
  scope: PseudonymScope;
  groupId: string;
  /** Mutable sink; the feature drains it after the call to show a discreet notice. */
  warnings: PseudonymWarning[];
}

const storage = new AsyncLocalStorage<ActivePrivacyScope>();

/**
 * Opens a pseudonymisation scope for the duration of `fn`.
 *
 * Open it OUTSIDE `runStudyAiTask`, never inside: the policy layer retries and can
 * switch to a fallback model, and a map rebuilt mid-flight would make two attempts
 * disagree about who `STU_7K3Q` is.
 *
 * When the setting is off, no scope is entered at all — a strict no-op, not a
 * disabled code path that still runs.
 */
export async function withStudentPseudonyms<T>(
  input: { groupId: string; students: PseudonymStudent[] },
  fn: (privacy: ActivePrivacyScope | null) => Promise<T>,
): Promise<T> {
  if (!getSettings().studentPseudonymsEnabled || input.students.length === 0) {
    return fn(null);
  }
  const active: ActivePrivacyScope = {
    scope: buildPseudonymScope(input.students),
    groupId: input.groupId,
    warnings: [],
  };
  return storage.run(active, () => fn(active));
}

export function currentPrivacyScope(): ActivePrivacyScope | null {
  return storage.getStore() ?? null;
}

/**
 * Line appended to the external-send consent dialog. It is the only honest place to
 * state what the layer does NOT cover, because it is the moment the user authorises
 * the send.
 */
export function privacyConsentDetail(privacy: ActivePrivacyScope | null): string | undefined {
  if (!privacy) return undefined;
  const n = privacy.scope.students.length;
  return (
    `Los nombres del alumnado se sustituyen por identificadores (${n} ${n === 1 ? 'alumno' : 'alumnos'}). ` +
    'No cubre transcripción de audio, análisis de imágenes ni embeddings.'
  );
}
