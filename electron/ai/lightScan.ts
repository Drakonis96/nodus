import { AiError, completeJson } from './aiClient';
import { PROMPT_LIGHT } from './prompts';
import { normalizeThemeLabel, setWorkThemes } from '../db/themesRepo';
import { setLightResult } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import type { Work, ModelRef } from '@shared/types';
import crypto from 'node:crypto';

interface LightResult {
  themes: { label: string; confidence: number }[];
  key_concepts: string[];
  tentative_type: string;
  notes: string | null;
}

function isLightResult(v: unknown): v is LightResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.themes);
}

export interface LightScanOptions {
  /**
   * When provided, the scan must assign the work ONLY to themes from this curated set
   * (matched/returned by normalized label) and may not invent new ones. Used when the
   * user has locked the main themes.
   */
  lockedLabels?: string[] | null;
}

const LOCKED_CONSTRAINT = `

RESTRICCIÓN DE TEMAS BLOQUEADOS:
- El usuario ha fijado una lista cerrada de temas principales en "available_main_themes".
- Asigna la obra SOLO a los temas de esa lista que realmente le correspondan, copiando su etiqueta EXACTA.
- NO inventes temas nuevos ni variantes. Si ninguno encaja, devuelve "themes": [].`;

/** Light scan: title + abstract only → coarse themes. Cheap, incremental, includes unread works. */
export async function runLightScan(
  work: Work,
  abstract: string | null,
  model?: ModelRef | null,
  options: LightScanOptions = {}
): Promise<void> {
  const scanModel = model ?? getSettings().extractionModel ?? null;
  const lockedLabels = options.lockedLabels ?? null;
  // Include the lock state in the hash so a previously-scanned work is re-evaluated
  // when the user switches to/from locked main themes.
  const hash = crypto
    .createHash('sha1')
    .update(`${work.title}\n${abstract ?? ''}\nlocked:${lockedLabels ? lockedLabels.slice().sort().join('|') : ''}`)
    .digest('hex');

  if (work.light_status === 'done' && work.light_hash === hash) return; // unchanged

  const input: Record<string, unknown> = {
    title: work.title,
    authors: JSON.parse(work.authors_json || '[]'),
    year: work.year,
    item_type: work.item_type,
    abstract: abstract ?? null,
  };
  let system = PROMPT_LIGHT;
  if (lockedLabels) {
    input.available_main_themes = lockedLabels;
    system = `${PROMPT_LIGHT}${LOCKED_CONSTRAINT}`;
  }

  try {
    const result = await completeJson<LightResult>(
      { system, user: JSON.stringify(input), temperature: 0.15, maxTokens: 1500 },
      isLightResult,
      scanModel
    );
    let labels = result.themes
      .filter((t) => t.label && t.confidence >= 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map((t) => t.label);
    if (lockedLabels) {
      // Hard-enforce the lock client-side: keep only labels that map to a curated theme,
      // and rewrite them to the canonical curated spelling.
      const allowed = new Map(lockedLabels.map((label) => [normalizeThemeLabel(label), label]));
      labels = labels
        .map((label) => allowed.get(normalizeThemeLabel(label)))
        .filter((label): label is string => Boolean(label));
    }
    // Light scan owns the broad theme assignment. Replacing avoids stale one-off
    // labels accumulating after prompt/model changes or global reassignments.
    setWorkThemes(work.nodus_id, labels);
    setLightResult(work.nodus_id, 'done', hash, result.notes ?? null);
  } catch (e) {
    if (e instanceof AiError && e.config) throw e;
    setLightResult(work.nodus_id, 'failed', hash, (e as Error).message);
    throw e;
  }
}
