import type { ResearchEvidence, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { RETRIEVAL_PRESETS, validateRetrievalSettings } from '@shared/researchCorpus';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import type { DeepResearchRequest, WritingWorkshopBrief, WritingWorkshopIdeaCandidate, WritingWorkshopPassageCandidate, WritingWorkshopSnapshot } from '@shared/types';
import type { DeepResearchDeps, SectionRetrievalInput } from './deepResearchCore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getDb } from '../db/database';
import { getResearchNotebook, recordResearchScope } from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { resolveResearchNotebook } from './researchNotebookService';
import { assertResearchDocument, researchFingerprint } from './researchCorpusScope';
import { resolveResearchSourceScope } from './researchSourceScope';
import { retrieveSharedDocumentaryEvidence } from './documentaryPreparation';
import { retrieveHierarchical, selectPassageEvidence } from './hierarchicalRetrieval';
import { embed } from './aiClient';
import { documentaryCitationId } from '../citations/documentaryCitations';

/** Compatibility requests are explicit snapshots of the active vault. A notebook
 * may additionally authorize unlinked Global Library works. Neither path uses a
 * missing filter to mean "all" inside a repository. */
export function resolveAcademicRunScope(notebookId?: string | null): ResolvedResearchScope {
  if (notebookId) return resolveResearchNotebook(notebookId);
  const vault = getActiveVault();
  const documents = researchCorpusInventory().documents.filter(document => document.workId).sort((a, b) => a.id.localeCompare(b.id));
  const permissionFingerprint = researchFingerprint(documents.map(document => [document.id, document.permissionRevision]));
  const scope: ResolvedResearchScope = { id: researchFingerprint([vault.id, documents, permissionFingerprint]), vaultId: vault.id,
    notebookId: null, notebookRevision: null, documents, permissionFingerprint, resolvedAt: new Date().toISOString(), changes: { added: [], removed: [] } };
  recordResearchScope(scope);
  return scope;
}

/** One run owns the scope, evidence ledger and traversal across all sections. */
export class ResearchCorpusRun {
  readonly budget: ResearchRetrievalBudget;
  readonly evidence = new Map<string, WritingWorkshopPassageCandidate>();
  readonly ideas = new Map<string, WritingWorkshopIdeaCandidate>();
  readonly traversal: Array<{ query: string; sources: string[]; candidates: number; partial: boolean }> = [];
  private readonly workIds: string[];
  private readonly ideaIds: string[];
  constructor(readonly scope: ResolvedResearchScope, settings: RetrievalSettings, readonly signal?: AbortSignal) {
    this.budget = new ResearchRetrievalBudget(settings);
    this.workIds = scope.documents.flatMap(document => document.workId ? [document.workId] : []);
    this.ideaIds = [...resolveResearchSourceScope({ enabled: true, authorIds: [], workIds: this.workIds }, true)!.ideaIds];
  }
  validate(): void {
    this.signal?.throwIfAborted();
    if (getActiveVault().id !== this.scope.vaultId) throw new Error('research_scope_changed');
    if (this.scope.notebookId && getResearchNotebook(this.scope.notebookId)?.revision !== this.scope.notebookRevision) throw new Error('research_scope_changed');
    const current = researchCorpusInventory().documents;
    for (const document of this.scope.documents) assertResearchDocument(this.scope, document.id, current.find(item => item.id === document.id));
  }
  async retrieve(query: string): Promise<void> {
    this.validate();
    if (!this.budget.nextRound()) return;
    const settings = this.budget.settings;
    const vector = await embed(query).catch(() => null);
    this.validate();
    const hierarchy = await retrieveHierarchical(query, { embedding: vector, nodusIds: this.workIds, ideaIds: this.ideaIds,
      documentLimit: settings.candidates, ideaLimit: settings.passagesPerRound, passageLimit: settings.candidates,
      minIdeaSimilarity: -1, minPassageSimilarity: -1, minDocumentSimilarity: -1 });
    const remaining = this.budget.evidenceTokenLimit - this.budget.usedEvidenceTokens;
    const shared = remaining >= 256 ? await retrieveSharedDocumentaryEvidence(this.scope, query,
      { ...settings, rounds: 1, autoExpand: false, evidenceTokens: remaining }, vector, this.signal) : { evidence: [], traversal: { candidates: 0, partial: true } };
    this.validate();
    // Interleave independent native/shared lanes, retaining source diversity.
    const candidates = shared.evidence.map(item => this.passage(item));
    const legacy = selectPassageEvidence(hierarchy.passages, settings.passagesPerRound, { preferLexical: true, preferSourceDiversity: true }).map(hit => ({
      id: hit.passage_id, label: hit.title, summary: hit.text, nodus_id: hit.nodus_id, pageLabel: hit.page_label,
      authors: this.scope.documents.find(document => document.workId === hit.nodus_id)?.authors ?? [], year: hit.year, zotero_key: hit.zotero_key, citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`, score: hit.similarity, reason: 'source',
    }));
    for (let index = 0; index < Math.max(candidates.length, legacy.length); index++) for (const candidate of [candidates[index], legacy[index]]) {
      if (candidate && this.budget.accept(`passage:${candidate.id}`, candidate.summary)) this.evidence.set(candidate.id, candidate);
    }
    const lexical = getDb().prepare(`SELECT global_id,type,label,statement FROM ideas WHERE global_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(this.ideaIds)) as Array<{ global_id: string; type: WritingWorkshopIdeaCandidate['type']; label: string; statement: string }>;
    const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const ordered = [...hierarchy.ideas, ...lexical.map(idea => ({ ...idea, similarity: words.reduce((score, word) => score + Number(`${idea.label} ${idea.statement}`.toLocaleLowerCase().includes(word)), 0) })).filter(idea => idea.similarity > 0).sort((a, b) => b.similarity - a.similarity)];
    for (const row of ordered.slice(0, settings.passagesPerRound)) {
      if (this.ideas.has(row.global_id) || !this.budget.accept(`idea:${row.global_id}`, row.statement)) continue;
      const ids = getDb().prepare('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id=?').all(row.global_id) as { nodus_id: string }[];
      const documents = this.scope.documents.filter(document => ids.some(id => id.nodus_id === document.workId));
      this.ideas.set(row.global_id, { id: row.global_id, label: row.label, summary: row.statement, statement: row.statement,
        type: row.type, themes: [], score: row.similarity, reason: 'scoped-idea', workCount: documents.length, evidenceCount: 0,
        works: documents.map(document => ({ nodus_id: document.workId!, title: document.title, authors: document.authors, year: document.year,
          zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' })) });
    }
    this.budget.candidates += hierarchy.passages.length + shared.traversal.candidates;
    this.budget.partial ||= shared.traversal.partial;
    this.traversal.push({ query, sources: this.scope.documents.map(document => document.id), candidates: hierarchy.passages.length + shared.traversal.candidates, partial: this.budget.partial });
  }
  private passage(item: ResearchEvidence): WritingWorkshopPassageCandidate {
    const document = this.scope.documents.find(document => document.id === item.documentId)!;
    const id = documentaryCitationId(this.scope.id, item.id);
    return { id, label: document.title, summary: item.text, nodus_id: document.workId ?? document.id,
      authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '',
      pageLabel: item.locator.pageLabel, citation: `nodus://passage/${encodeURIComponent(id)}`, score: 1, reason: item.provenance };
  }
  async snapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot> {
    await this.retrieve(brief.objective);
    const rankedDocuments = [...this.scope.documents].sort((a, b) => Number([...this.evidence.values()].some(item => item.nodus_id === (b.workId ?? b.id))) - Number([...this.evidence.values()].some(item => item.nodus_id === (a.workId ?? a.id))));
    if (rankedDocuments.length > this.budget.settings.candidates) this.budget.partial = true;
    const works = rankedDocuments.slice(0, this.budget.settings.candidates).map(document => ({ id: document.workId ?? document.id, title: document.title, label: document.title,
      summary: '', score: 0, reason: 'authorized-source', authors: document.authors, year: document.year, themes: [],
      zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '', deepStatus: 'pending' as const, ideaCount: 0, gapCount: 0 }));
    const ideas = [...this.ideas.values()];
    const passages = [...this.evidence.values()];
    const { gaps, contradictions, themes } = this.graph();
    return { generatedAt: new Date().toISOString(), brief, works, ideas, passages, themes, gaps, contradictions, tutorRoutes: [],
      stats: { works: works.length, ideas: ideas.length, passages: passages.length, themes: themes.length, gaps: gaps.length, contradictions: contradictions.length, tutorRoutes: 0 },
      recommendedSelection: { workIds: works.map(work => work.id), ideaIds: ideas.map(idea => idea.id), passageIds: passages.map(passage => passage.id), themeIds: themes.map(theme => theme.id), gapIds: gaps.map(gap => gap.id), contradictionIds: contradictions.map(edge => edge.id), tutorRouteIds: [] } };
  }
  private graph(): Pick<WritingWorkshopSnapshot, 'gaps' | 'contradictions' | 'themes'> {
    const db = getDb();
    const works = JSON.stringify(this.workIds);
    const ideas = JSON.stringify(this.ideaIds);
    const limit = this.budget.settings.passagesPerRound;
    const gaps = (db.prepare(`SELECT id,kind,statement,related_idea,confidence,nodus_id FROM gaps
      WHERE nodus_id IN (SELECT value FROM json_each(?)) AND (related_idea IS NULL OR related_idea IN (SELECT value FROM json_each(?)))
      ORDER BY confidence DESC,id LIMIT ?`).all(works, ideas, limit) as Array<{ id: string; kind: WritingWorkshopSnapshot['gaps'][number]['kind']; statement: string; related_idea: string | null; confidence: number; nodus_id: string }>)
      .filter(row => this.budget.accept(`gap:${row.id}`, row.statement)).map(row => {
        const document = this.scope.documents.find(document => document.workId === row.nodus_id)!;
        return { id: row.id, kind: row.kind, label: row.statement.slice(0, 100), summary: row.statement, score: row.confidence,
          reason: 'scoped-gap', relatedIdea: row.related_idea, confidence: row.confidence,
          work: { nodus_id: row.nodus_id, title: document.title, authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' } };
      });
    const contradictions = (db.prepare(`SELECT e.id,e.type,e.basis,e.confidence,e.source_work,a.label from_label,b.label to_label,
      a.statement from_statement,b.statement to_statement FROM visible_edges e JOIN ideas a ON a.global_id=e.from_id JOIN ideas b ON b.global_id=e.to_id
      WHERE e.type IN ('contradicts','refutes') AND e.source_work IN (SELECT value FROM json_each(?))
      AND e.from_id IN (SELECT value FROM json_each(?)) AND e.to_id IN (SELECT value FROM json_each(?))
      ORDER BY e.confidence DESC,e.id LIMIT ?`).all(works, ideas, ideas, limit) as Array<{ id: string; type: string; basis: WritingWorkshopSnapshot['contradictions'][number]['basis']; confidence: number; from_label: string; to_label: string; from_statement: string; to_statement: string; source_work: string }>)
      .map(row => ({ id: row.id, label: `${row.from_label} / ${row.to_label}`, summary: `${row.from_statement} / ${row.to_statement}`,
        score: row.confidence, reason: 'scoped-contradiction', fromLabel: row.from_label, toLabel: row.to_label, type: row.type, basis: row.basis, confidence: row.confidence,
        sources: this.scope.documents.filter(document => document.workId === row.source_work).map(document => `${document.authors.join('; ')} (${document.year ?? ''})`) }))
      .filter(row => this.budget.accept(`contradiction:${row.id}`, row.summary));
    const themes = (db.prepare(`SELECT t.theme_id id,t.label,COUNT(DISTINCT wt.nodus_id) workCount FROM themes t
      JOIN work_themes wt ON wt.theme_id=t.theme_id WHERE wt.nodus_id IN (SELECT value FROM json_each(?))
      GROUP BY t.theme_id ORDER BY workCount DESC,t.theme_id LIMIT ?`).all(works, limit) as Array<{ id: string; label: string; workCount: number }>)
      .filter(row => this.budget.accept(`theme:${row.id}`, row.label)).map(row => ({ ...row, summary: row.label, score: row.workCount, reason: 'scoped-theme', pinned: false, ideaCount: 0 }));
    return { gaps, contradictions, themes };
  }
  async section(input: SectionRetrievalInput) {
    await this.retrieve([input.objective, input.sectionTitle, input.purpose, ...input.keyClaims, ...(input.coverageQuestions ?? [])].join('\n'));
    return { ideas: [...this.ideas.values()].filter(idea => !input.excludeIdeaIds.includes(idea.id)).slice(0, input.limits.ideas),
      passages: [...this.evidence.values()].filter(passage => !input.excludePassageIds.includes(passage.id)).slice(0, input.limits.passages), evidencePacks: [] };
  }
}

export function bindAcademicCorpusRun(deps: DeepResearchDeps, request: DeepResearchRequest, signal?: AbortSignal): DeepResearchDeps {
  const scope = resolveAcademicRunScope(request.notebookId);
  const settings = validateRetrievalSettings(request.retrieval ?? (request.notebookId ? getResearchNotebook(request.notebookId)?.settings : undefined) ?? RETRIEVAL_PRESETS.deep);
  const run = new ResearchCorpusRun(scope, settings, signal);
  const bounded: DeepResearchDeps = { ...deps, buildSnapshot: brief => run.snapshot(brief), retrieveForSection: input => run.section(input),
    // Basic searchable documents are independent from optional enriched analyses.
    preparePlanEvidence: undefined,
    finalize: input => deps.finalize({ ...input, supportConcerns: [...(input.supportConcerns ?? []), ...(run.budget.partial ? ['Documentary coverage is partial: the shared retrieval budget was reached.'] : [])] }) };
  return new Proxy(bounded, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return async (...args: unknown[]) => { run.validate(); const result = await value(...args); run.validate(); return result; };
  } });
}
