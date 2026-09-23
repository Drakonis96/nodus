import { parentPort } from 'node:worker_threads';
import { DocumentaryStore } from '../db/documentaryStore';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import type { RetrievalSettings } from '@shared/researchCorpus';

parentPort?.once('message', (input: { filename: string; query: string; lexicalKeys: string[]; vectorKeys: string[]; vector: number[] | null; settings: RetrievalSettings; threshold: number }) => {
  const store = new DocumentaryStore(input.filename, true);
  try {
    const budget = new ResearchRetrievalBudget(input.settings);
    budget.nextRound();
    const lexical = store.lexicalSearch(input.query, input.lexicalKeys, input.settings.candidates);
    const semantic = input.vector ? store.semanticSearch(input.vector, input.vectorKeys, input.settings.candidates, input.threshold) : [];
    const fused = new Map<string, { score: number; passage: typeof lexical[number] }>();
    for (const lane of [lexical, semantic]) lane.forEach((passage, index) => {
      // The same text can have separate lexical/vector index keys. Deduplicate
      // evidence by document, text and locator rather than raw index identity.
      const key = JSON.stringify([passage.document_id, passage.text, passage.locator_json]);
      const prior = fused.get(key);
      fused.set(key, { score: (prior?.score ?? 0) + 1 / (60 + index + 1), passage: prior?.passage ?? passage });
    });
    budget.candidates = fused.size;
    const ranked = [...fused.values()].sort((a, b) => b.score - a.score);
    const chosen: typeof lexical = [];
    const works = new Set<string>();
    // First pass prioritizes independent works, then fills remaining slots.
    for (const diverse of [true, false]) for (const { passage } of ranked) {
      if (chosen.length >= input.settings.passagesPerRound) break;
      if (diverse && works.has(passage.document_id)) continue;
      if (budget.accept(passage.id, passage.text)) { chosen.push(passage); works.add(passage.document_id); }
    }
    let frontier = chosen.slice();
    while (input.settings.autoExpand && frontier.length && budget.rounds < input.settings.rounds && budget.nextRound()) {
      const next: typeof lexical = [];
      for (const passage of frontier) {
        for (const adjacent of store.adjacentPassages(passage.id, [...input.lexicalKeys, ...input.vectorKeys])) {
          if (next.length >= input.settings.passagesPerRound) break;
          if (budget.accept(adjacent.id, adjacent.text)) next.push(adjacent);
        }
      }
      chosen.push(...next);
      frontier = next;
    }
    parentPort!.postMessage({ passages: chosen, traversal: { rounds: budget.rounds, candidates: budget.candidates, evidenceTokens: budget.usedEvidenceTokens,
      partial: budget.partial || chosen.length < ranked.length, visited: [...budget.visited] } });
  } catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : 'documentary_retrieval_failed' }); }
  finally { store.close(); }
});
