// Find what the world talks about but has never defined.
//
// Half of this feature has no model in it at all: an unresolved `[[…]]` is a fact the
// author already stated, and capitalised terms that recur across entries are found by
// arithmetic. The model's only job is to throw out the ones that are prose rather than
// lore, and to say what each is. That split is why the analysis still works with no
// provider configured, and why it cannot invent a term the world does not contain.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { allWorldBodies, listWorldEntries, saveEntryProposals } from '../db/worldEncyclopediaRepo';
import {
  MISSING_ENTRIES_SYSTEM,
  collectEntryCandidates,
  composeMissingEntriesContext,
  type EntryCandidate,
} from '@shared/worldMissingEntries';
import { isArticleCategory } from '@shared/worldEncyclopedia';
import type { WorldEntryProposal } from '@shared/types';
import { withWorldPromptLanguage } from '@shared/worldPromptLanguage';

/** Beyond this the prompt stops being a shortlist and starts being the whole vocabulary. */
const MAX_CANDIDATES = 40;

interface ModelCandidate {
  term?: unknown;
  category?: unknown;
  why?: unknown;
  suggestedSummary?: unknown;
  confidence?: unknown;
}

export async function analyzeMissingEntries(): Promise<WorldEntryProposal[]> {
  const candidates = collectEntryCandidates(allWorldBodies(), listWorldEntries()).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return saveEntryProposals([]);

  const judged = await judge(candidates);
  return saveEntryProposals(judged);
}

/**
 * Ask the model to classify the shortlist — and DEGRADE to the deterministic list on any
 * failure rather than throwing. An analysis that returns the unresolved links with no
 * descriptions is still useful; one that errors because a model emitted a stray sentence
 * before its JSON is not.
 */
async function judge(candidates: EntryCandidate[]) {
  const plain = candidates.map((candidate) => ({
    term: candidate.term,
    termKey: candidate.termKey,
    source: candidate.source,
    evidence: candidate.occurrences,
  }));

  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  let parsed: ModelCandidate[] = [];
  try {
    const text = await completeText(
      {
        system: withWorldPromptLanguage(MISSING_ENTRIES_SYSTEM, settings.uiLanguage),
        user: composeMissingEntriesContext(candidates),
        temperature: 0.2,
        maxTokens: 1200,
      },
      model
    );
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const payload = JSON.parse(json) as { candidates?: unknown };
    if (Array.isArray(payload.candidates)) parsed = payload.candidates as ModelCandidate[];
  } catch {
    return plain;
  }

  const described = new Map<string, ModelCandidate>();
  for (const entry of parsed) {
    if (typeof entry?.term === 'string') described.set(entry.term.trim().toLowerCase(), entry);
  }

  return plain
    .map((candidate) => {
      const match = described.get(candidate.term.toLowerCase());
      // A term the model dropped is dropped too — UNLESS the author linked it themselves.
      // They already said it exists; no model gets to overrule that.
      if (!match && candidate.source === 'frequency') return null;
      return {
        ...candidate,
        category: isArticleCategory(match?.category) ? match?.category : null,
        rationale: typeof match?.why === 'string' ? match.why : null,
        suggestedSummary: typeof match?.suggestedSummary === 'string' ? match.suggestedSummary : null,
        confidence: typeof match?.confidence === 'number' ? match.confidence : null,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}
