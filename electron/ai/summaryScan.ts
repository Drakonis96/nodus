import crypto from 'node:crypto';
import type { ModelRef, Work } from '@shared/types';
import { AiError, completeText, embed } from './aiClient';
import { PROMPT_SUMMARY } from './prompts';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { setSummaryResult } from '../db/worksRepo';
import { getItem } from '../zotero/zoteroClient';
import { resolveWorkText } from '../extraction/textExtractor';
import { updateWorkSummaryEmbedding, upsertWorkSummary } from '../db/workSummariesRepo';

function parseAuthors(authorsJson: string): string[] {
  try {
    const parsed = JSON.parse(authorsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((author): author is string => typeof author === 'string') : [];
  } catch {
    return [];
  }
}

function clip(text: string | null | undefined, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function modelId(model: ModelRef | null): string {
  return model?.provider && model.model ? `${model.provider}/${model.model}` : 'default';
}

export function summaryContentHash(
  work: Pick<Work, 'deep_hash' | 'light_hash'>,
  model?: ModelRef | null
): string {
  const settings = getSettings();
  const scanModel = model ?? settings.summaryModel ?? settings.synthesisModel ?? null;
  return crypto
    .createHash('sha1')
    .update(`${work.deep_hash ?? ''}|${work.light_hash ?? ''}|${modelId(scanModel ?? settings.defaultModel)}|summary-v1`)
    .digest('hex');
}

/**
 * Builds a non-citable orientation summary from material already extracted into
 * Nodus. Full text is only used when neither ideas nor an abstract is available.
 */
export async function runSummaryScan(work: Work, model?: ModelRef | null): Promise<void> {
  const settings = getSettings();
  const scanModel = model ?? settings.summaryModel ?? settings.synthesisModel ?? null;
  const hash = summaryContentHash(work, model);

  if (work.summary_status === 'done' && work.summary_hash === hash) return;

  const db = getDb();
  const ideas = db
    .prepare(
      `SELECT i.label, i.statement, io.development, io.role, i.type, io.confidence
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
        WHERE io.nodus_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, i.label ASC
        LIMIT 48`
    )
    .all(work.nodus_id) as {
    label: string;
    statement: string;
    development: string;
    role: string;
    type: string;
    confidence: number;
  }[];
  const evidence = db
    .prepare(
      `SELECT i.label, e.quote, e.location, e.kind
         FROM evidence e
         LEFT JOIN ideas i ON i.global_id = e.global_id
        WHERE e.nodus_id = ?
        ORDER BY e.kind = 'explicit' DESC, length(e.quote) DESC
        LIMIT 40`
    )
    .all(work.nodus_id) as { label: string | null; quote: string; location: string | null; kind: string }[];
  const themes = db
    .prepare(
      `SELECT t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id = ?
        ORDER BY t.label
        LIMIT 16`
    )
    .all(work.nodus_id) as { label: string }[];
  const gaps = db
    .prepare(
      `SELECT kind, statement, confidence
         FROM gaps
        WHERE nodus_id = ?
        ORDER BY confidence DESC
        LIMIT 20`
    )
    .all(work.nodus_id) as { kind: string; statement: string; confidence: number }[];

  let abstract: string | null = null;
  try {
    abstract = (await getItem(settings.zoteroUserId, work.zotero_key))?.abstract ?? null;
  } catch {
    // Offline is fine: Nodus already has extracted material locally.
  }

  let fallbackText: string | null = null;
  if (ideas.length === 0 && !abstract?.trim()) {
    try {
      const doc = await resolveWorkText(settings.zoteroUserId, work.zotero_key, settings.zoteroStoragePath, null, work.doi, {
        unpaywallEmail: settings.unpaywallEmail,
        preferZoteroFulltext: settings.preferZoteroFulltext,
        ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      });
      fallbackText = clip(doc.text, 24_000) || null;
    } catch {
      fallbackText = null;
    }
    if (!fallbackText) {
      setSummaryResult(work.nodus_id, 'skipped_no_text', hash);
      return;
    }
  }

  const evidenceByIdea = new Map<string, { quote: string; location: string | null; kind: string }[]>();
  for (const item of evidence) {
    const key = item.label ?? '';
    const items = evidenceByIdea.get(key) ?? [];
    items.push({ quote: clip(item.quote, 700), location: item.location, kind: item.kind });
    evidenceByIdea.set(key, items);
  }
  const input = {
    title: work.title,
    authors: parseAuthors(work.authors_json),
    year: work.year,
    item_type: work.item_type,
    abstract: abstract ? clip(abstract, 8_000) : null,
    themes: themes.map((theme) => theme.label),
    ideas: ideas.map((idea) => ({
      label: idea.label,
      statement: clip(idea.statement, 1_100),
      development: clip(idea.development, 1_300),
      role: idea.role,
      type: idea.type,
      confidence: idea.confidence,
      evidence: (evidenceByIdea.get(idea.label) ?? []).slice(0, 3),
    })),
    gaps: gaps.map((gap) => ({ kind: gap.kind, statement: clip(gap.statement, 900), confidence: gap.confidence })),
    fallback_text: fallbackText,
  };

  try {
    const summary = (await completeText({ system: PROMPT_SUMMARY, user: JSON.stringify(input), temperature: 0.2, maxTokens: 800 }, scanModel)).trim();
    if (!summary) throw new Error('El modelo no devolvió un resumen utilizable.');

    upsertWorkSummary({
      nodusId: work.nodus_id,
      summary,
      sourceLevel: work.deep_status === 'done' ? 'deep' : 'light',
      model: scanModel ?? settings.defaultModel,
      contentHash: hash,
    });
    setSummaryResult(work.nodus_id, 'done', hash);

    const embedding = await embed(summary);
    if (embedding) updateWorkSummaryEmbedding(work.nodus_id, summary, embedding);
  } catch (error) {
    if (error instanceof AiError && error.config) throw error;
    setSummaryResult(work.nodus_id, 'failed', hash);
    throw error;
  }
}
