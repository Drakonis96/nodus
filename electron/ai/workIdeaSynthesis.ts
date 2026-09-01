import { createHash } from 'node:crypto';
import type { IdeaByWork, IdeaType, ModelRef, WorkIdeaSynthesis } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getIdeasByWork } from '../db/ideasRepo';
import { completeJson } from './aiClient';
import { synthesisPromptPack, type SynthesisPromptPack } from '@shared/synthesisPromptPacks';

const STATEMENT_CLIP = 240;
const MAX_IDEAS_IN_PROMPT = 80;
const MAX_REMEMBER = 6;

interface WorkSynthesisResponse {
  thesis: string;
  remember: string[];
  positioning: string;
}

function isWorkSynthesisResponse(value: unknown): value is WorkSynthesisResponse {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.thesis === 'string' &&
    typeof obj.positioning === 'string' &&
    Array.isArray(obj.remember) &&
    obj.remember.every((item) => typeof item === 'string')
  );
}

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function parseAuthorsJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function loadWork(nodusId: string): { title: string; authors: string[]; year: number | null } | null {
  const row = getDb()
    .prepare('SELECT title, authors_json AS authorsJson, year FROM works WHERE nodus_id = ? AND archived = 0')
    .get(nodusId) as { title: string; authorsJson: string | null; year: number | null } | undefined;
  if (!row) return null;
  return { title: row.title, authors: parseAuthorsJson(row.authorsJson), year: row.year };
}

function workIdeaFingerprint(nodusId: string): string {
  const rows = getDb()
    .prepare(
      `SELECT io.global_id AS id, io.role AS role, io.confidence AS confidence
         FROM idea_occurrences io
        WHERE io.nodus_id = ?
        ORDER BY io.global_id`
    )
    .all(nodusId) as { id: string; role: string; confidence: number }[];
  const source = rows.map((row) => `${row.id}:${row.role}:${row.confidence.toFixed(4)}`).join('|');
  return createHash('sha1').update(source).digest('hex').slice(0, 16);
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ModelRef;
  } catch {
    return null;
  }
}

export function getCachedWorkIdeaSynthesis(nodusId: string): WorkIdeaSynthesis | null {
  const row = getDb()
    .prepare(
      `SELECT thesis, remember_json, positioning, model_json, fingerprint, generated_at
         FROM work_idea_synthesis WHERE nodus_id = ?`
    )
    .get(nodusId) as
    | { thesis: string; remember_json: string; positioning: string; model_json: string | null; fingerprint: string; generated_at: string }
    | undefined;
  if (!row) return null;
  let remember: string[] = [];
  try {
    const parsed = JSON.parse(row.remember_json);
    remember = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    remember = [];
  }
  return {
    thesis: row.thesis,
    remember,
    positioning: row.positioning,
    model: parseModel(row.model_json),
    generatedAt: row.generated_at,
    stale: row.fingerprint !== workIdeaFingerprint(nodusId),
  };
}

function themesForIdeas(globalIds: string[]): string[] {
  if (globalIds.length === 0) return [];
  const placeholders = globalIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT t.label AS label, COUNT(*) AS n
         FROM idea_theme_links itl
         JOIN themes t ON t.theme_id = itl.theme_id
        WHERE itl.global_id IN (${placeholders})
        GROUP BY t.theme_id
        ORDER BY n DESC, t.label
        LIMIT 10`
    )
    .all(...globalIds) as { label: string; n: number }[];
  return rows.map((row) => row.label);
}

function connectionLine(globalIds: string[], prompt: SynthesisPromptPack): string {
  if (globalIds.length === 0) return 'sin conexiones internas registradas';
  const placeholders = globalIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT e.type AS type, f.label AS fromLabel, t.label AS toLabel
         FROM visible_edges e
         JOIN ideas f ON f.global_id = e.from_id
         JOIN ideas t ON t.global_id = e.to_id
        WHERE e.from_id IN (${placeholders}) AND e.to_id IN (${placeholders})
        ORDER BY e.confidence DESC
        LIMIT 16`
    )
    .all(...globalIds, ...globalIds) as { type: string; fromLabel: string; toLabel: string }[];
  if (rows.length === 0) return prompt.noConnections;
  return rows.map((row) => `- ${row.fromLabel} ${row.type} ${row.toLabel}`).join('\n');
}

function ideaBlock(ideas: IdeaByWork[], prompt: SynthesisPromptPack): string {
  const byType = new Map<IdeaType, IdeaByWork[]>();
  for (const idea of ideas.slice(0, MAX_IDEAS_IN_PROMPT)) {
    const list = byType.get(idea.type) ?? [];
    list.push(idea);
    byType.set(idea.type, list);
  }
  return [...byType.entries()]
    .map(([type, list]) => {
      const items = list
        .map((idea) => {
          const role = idea.role === 'principal' ? prompt.primary : prompt.secondary;
          return `  - [${role}] ${idea.label}: ${clip(idea.statement, STATEMENT_CLIP)}`;
        })
        .join('\n');
      return `${prompt.ideaTypes[type] ?? type} (${list.length}):\n${items}`;
    })
    .join('\n\n');
}

export async function synthesizeWorkIdeas(nodusId: string, model?: ModelRef | null): Promise<WorkIdeaSynthesis> {
  const work = loadWork(nodusId);
  if (!work) throw new Error('Obra no encontrada');

  const page = getIdeasByWork(nodusId, MAX_IDEAS_IN_PROMPT, 0);
  if (page.total === 0) throw new Error('Esta obra no tiene ideas extraídas todavía');

  const globalIds = page.ideas.map((idea) => idea.global_id);
  const themes = themesForIdeas(globalIds);
  const prompt = synthesisPromptPack(getSettings().promptLanguage ?? 'es');
  const system = prompt.workSystem(MAX_REMEMBER);

  const user =
    `${prompt.work}: ${work.title}\n` +
    `${prompt.authors}: ${work.authors.length ? work.authors.join('; ') : prompt.noAuthorship}${work.year ? ` (${work.year})` : ''}\n` +
    `${prompt.themes}: ${themes.length ? themes.join(', ') : prompt.noThemes}\n\n` +
    `${prompt.workIdeas}:\n${ideaBlock(page.ideas, prompt)}\n\n` +
    `${prompt.connections}:\n${connectionLine(globalIds, prompt)}\n\n` +
    prompt.workReturn;

  const chosen = model ?? getSettings().synthesisModel ?? null;
  const result = await completeJson<WorkSynthesisResponse>({ system, user, temperature: 0.2 }, isWorkSynthesisResponse, chosen);
  const remember = result.remember.map((item) => item.trim()).filter(Boolean).slice(0, MAX_REMEMBER);
  const generatedAt = new Date().toISOString();
  const fingerprint = workIdeaFingerprint(nodusId);

  getDb()
    .prepare(
      `INSERT INTO work_idea_synthesis (nodus_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(nodus_id) DO UPDATE SET
         thesis = excluded.thesis,
         remember_json = excluded.remember_json,
         positioning = excluded.positioning,
         model_json = excluded.model_json,
         fingerprint = excluded.fingerprint,
         generated_at = excluded.generated_at`
    )
    .run(
      nodusId,
      result.thesis.trim(),
      JSON.stringify(remember),
      result.positioning.trim(),
      chosen ? JSON.stringify(chosen) : null,
      fingerprint,
      generatedAt
    );

  return {
    thesis: result.thesis.trim(),
    remember,
    positioning: result.positioning.trim(),
    model: chosen,
    generatedAt,
    stale: false,
  };
}
