import { AiError, completeJson } from './aiClient';
import { PROMPT_LIGHT } from './prompts';
import { unionWorkThemes } from '../db/themesRepo';
import { setLightResult } from '../db/worksRepo';
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

/** Light scan: title + abstract only → coarse themes. Cheap, incremental, includes unread works. */
export async function runLightScan(work: Work, abstract: string | null, model?: ModelRef | null): Promise<void> {
  const hash = crypto
    .createHash('sha1')
    .update(`${work.title}\n${abstract ?? ''}`)
    .digest('hex');

  if (work.light_status === 'done' && work.light_hash === hash) return; // unchanged

  const input = {
    title: work.title,
    authors: JSON.parse(work.authors_json || '[]'),
    year: work.year,
    item_type: work.item_type,
    abstract: abstract ?? null,
  };

  try {
    const result = await completeJson<LightResult>(
      { system: PROMPT_LIGHT, user: JSON.stringify(input), temperature: 0.15, maxTokens: 1500 },
      isLightResult,
      model
    );
    const labels = result.themes.map((t) => t.label).filter(Boolean);
    // Union, not replace: keep any broad parent themes a previous scan already found.
    unionWorkThemes(work.nodus_id, labels);
    setLightResult(work.nodus_id, 'done', hash, result.notes ?? null);
  } catch (e) {
    if (e instanceof AiError && e.config) throw e;
    setLightResult(work.nodus_id, 'failed', hash, (e as Error).message);
    throw e;
  }
}
