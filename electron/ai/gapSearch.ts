// Actionable gaps: turn a research gap into concrete ways to find the literature
// that would fill it. The model returns search keywords and ready-to-run query
// strings (for Google Scholar / Semantic Scholar / web). No network calls here —
// the renderer opens the chosen query externally.
import type { GapSearchSuggestions, PromptLanguage } from '@shared/types';
import { completeJson } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { gapPromptPack } from '@shared/academicPromptPacks';

interface RawSuggestions {
  keywords: unknown;
  queries: unknown;
}

function isRaw(v: unknown): v is RawSuggestions {
  return typeof v === 'object' && v !== null && 'keywords' in v && 'queries' in v;
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
    if (out.length >= max) break;
  }
  return out;
}

export async function suggestGapSearch(
  statement: string,
  workTitles: string[],
  requestedLanguage?: PromptLanguage
): Promise<GapSearchSuggestions> {
  const language = requestedLanguage ?? getSettings().promptLanguage ?? 'es';
  const copy = gapPromptPack(language);
  const gap = statement.trim();
  if (!gap) return { keywords: [], queries: [] };

  const context =
    workTitles.length > 0
      ? `\n\n${copy.works}:\n${workTitles.slice(0, 8).map((w) => `- ${w}`).join('\n')}`
      : '';

  const system = copy.system;
  const user = `${copy.gap}:\n${gap}${context}\n\n${copy.returnJson}`;

  const raw = await completeJson<RawSuggestions>({ system, user, temperature: 0.2 }, isRaw);
  return {
    keywords: asStringList(raw.keywords, 8),
    queries: asStringList(raw.queries, 5),
  };
}
