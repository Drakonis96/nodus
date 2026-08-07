import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSettings, CodexReasoningEffort, ModelRef } from '../shared/types';
import { ModelWithReasoning, primeCodexReasoningCatalog } from '../src/components/ModelPicker';

/**
 * Two roles pointed at one Codex model, rendered through the real component. This is the
 * shape the bug report described: Inmersión and Deep Research side by side, each with its
 * own level. A render is the only check that can tell "each row reads its own value" from
 * "each row reads the same map entry" — a regular expression over the source cannot.
 */

const MODEL = 'gpt-5.6-luna';

primeCodexReasoningCatalog({
  [MODEL]: {
    supported: [
      { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
      { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth' },
      { reasoningEffort: 'high', description: 'Greater reasoning depth' },
    ],
    fallback: 'medium',
  },
});

function codex(reasoningEffort?: CodexReasoningEffort): ModelRef {
  return reasoningEffort ? { provider: 'codex', model: MODEL, reasoningEffort } : { provider: 'codex', model: MODEL };
}

/**
 * Render both rows and return the markup of each, keyed by role. `perModel` is the
 * Providers tab's map, which supplies the «(predeterminado)» label when a role has made
 * no choice of its own.
 */
export function renderRoles(
  roles: Record<string, CodexReasoningEffort | undefined>,
  perModel: Record<string, CodexReasoningEffort> = {}
): Record<string, string> {
  const settings = {
    favorites: [{ provider: 'codex', model: MODEL }],
    codexReasoningEfforts: perModel,
  } as unknown as AppSettings;

  return Object.fromEntries(Object.entries(roles).map(([role, effort]) => [
    role,
    renderToStaticMarkup(
      <ModelWithReasoning
        allowEmpty={false}
        settings={settings}
        value={codex(effort)}
        onChange={() => undefined}
        emptyLabel="Seleccionar modelo"
      />
    ),
  ]));
}
