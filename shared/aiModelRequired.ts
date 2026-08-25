/** Stable marker used before Electron serializes an AI configuration error. */
export const AI_MODEL_REQUIRED_ERROR_CODE = 'model_required' as const;

/**
 * Some feature modules resolve their specialised model before reaching aiClient,
 * so not every missing-model failure is an AiError yet. Keep one narrow matcher
 * for those existing user-facing messages while new code uses the stable marker.
 */
export function isAiModelRequiredError(error: unknown): boolean {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === AI_MODEL_REQUIRED_ERROR_CODE
  ) return true;

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  return /(?:no hay|sin|falta|necesita|configura|selecciona|elige)[^.\n]{0,140}\bmodelo\b/i.test(message);
}
