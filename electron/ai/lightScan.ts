import { AiError, completeJson } from './aiClient';
import { modelRefSupportsExtraction } from '@shared/localAiModels';
import { lightScanPrompt } from './prompts';
import { normalizeThemeLabel, setWorkThemes } from '../db/themesRepo';
import { setLightResult } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import type { Work, ModelRef } from '@shared/types';
import crypto from 'node:crypto';
import { recordLinkedLibraryAnalysis } from '../library/libraryVaultProvenance';
import { analysisModelFingerprint, isLocalAnalysisCurrent, recordLocalAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import { getDb } from '../db/database';

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
  force?: boolean;
  /**
   * When provided, the scan must assign the work ONLY to themes from this curated set
   * (matched/returned by normalized label) and may not invent new ones. Used when the
   * user has locked the main themes.
   */
  lockedLabels?: string[] | null;
}

/** Light scan: title + abstract only → coarse themes. Cheap, incremental, includes unread works. */
export async function runLightScan(
  work: Work,
  abstract: string | null,
  model?: ModelRef | null,
  options: LightScanOptions = {}
): Promise<void> {
  const settings = getSettings();
  const scanModel = model ?? settings.extractionModel ?? settings.synthesisModel ?? null;
  // Vision-only local models can't extract (see runDeepScan). Fail once, actionably, not silently.
  if (!modelRefSupportsExtraction(scanModel)) {
    throw new AiError(
      `El modelo «${scanModel?.model}» es de visión y no puede extraer ideas. Elige Gemma 4 E2B u otro modelo mayor como modelo de extracción en Ajustes → Modelos de IA.`,
      false,
      true,
    );
  }
  const lockedLabels = options.lockedLabels ?? null;
  // Include the lock state in the hash so a previously-scanned work is re-evaluated
  // when the user switches to/from locked main themes.
  const hash = crypto
    .createHash('sha1')
    .update(`${work.title}\n${abstract ?? ''}\nlocked:${lockedLabels ? lockedLabels.slice().sort().join('|') : ''}`)
    .digest('hex');
  const modelFingerprint = analysisModelFingerprint('light', { ...settings, extractionModel: scanModel });

  if (!options.force && work.light_status === 'done' && work.light_hash === hash
    && isLocalAnalysisCurrent(work.nodus_id, 'light', hash, modelFingerprint)) return;

  const input: Record<string, unknown> = {
    title: work.title,
    authors: JSON.parse(work.authors_json || '[]'),
    year: work.year,
    item_type: work.item_type,
    abstract: abstract ?? null,
  };
  const system = lightScanPrompt(settings.promptLanguage ?? 'es', Boolean(lockedLabels));
  if (lockedLabels) {
    input.available_main_themes = lockedLabels;
  }

  try {
    const result = await completeJson<LightResult>(
      { system, user: JSON.stringify(input), temperature: 0.15, maxTokens: 1500, task: 'light-extraction' },
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
    getDb().transaction(() => {
      setWorkThemes(work.nodus_id, labels);
      setLightResult(work.nodus_id, 'done', hash, result.notes ?? null);
      recordLocalAnalysisProvenance({
        workId: work.nodus_id,
        components: ['light'],
        documentFingerprint: hash,
        modelFingerprints: { light: modelFingerprint },
      });
    })();
    try {
      recordLinkedLibraryAnalysis({ workId: work.nodus_id, components: ['light'], documentFingerprint: hash });
    } catch (error) {
      console.warn(`[lightScan] análisis guardado; procedencia externa diferida para ${work.nodus_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (e) {
    if (e instanceof AiError && e.config) throw e;
    // A forced refresh is replacement-by-commit: if generation fails, retain the
    // previous successful analysis instead of destroying its currentness/status.
    if (!(options.force && work.light_status === 'done')) {
      setLightResult(work.nodus_id, 'failed', hash, (e as Error).message);
    }
    throw e;
  }
}
