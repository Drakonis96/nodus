// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserWindow, safeStorage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CompassFilters, CompassImportJob, CompassImportProgress, CompassImportRequest, CompassProviderAdapter, CompassProviderId, CompassProviderStatus, CompassPublicationType, CompassResult, CompassResultSummary, CompassSearchProgress, CompassSearchRequest, CompassSearchResponse, CompassSearchSession } from '@shared/compass';
import type { LibraryCompassCandidate, LibraryCreator, LibraryItemMetadata, LibraryItemType } from '@shared/libraryTypes';
import { COMPASS_PROVIDERS, COMPASS_MAX_QUERY_LENGTH } from '@shared/compass';
import { CompassStore, compassDatabasePath } from './compassStore';
import { interpretCompassQuery } from './compassQueryInterpreter';
import { routeCompassProviders } from './compassRouter';
import { createCompassAdapters } from './providers/adapters';
import { CompassProviderHttpError } from './providers/provider';
import { runCompassWorker } from './compassWorkerHost';
import { getSettings } from '../db/settingsRepo';
import { embedMany } from '../ai/aiClient';
import { completeJson } from '../ai/aiClient';

interface RunningSearch { controller: AbortController; session: CompassSearchSession; }
interface QueuedSearch { searchId: string; request: CompassSearchRequest; providers: CompassProviderId[]; fingerprint: string; }
const MAX_ACTIVE_SEARCHES = 4;
const MAX_QUEUED_SEARCHES = 12;
const PUBLICATION_TYPES = new Set<CompassPublicationType>(['article', 'book', 'chapter', 'thesis', 'report', 'dataset', 'preprint', 'other']);
const clean = (v: unknown, max = 2_000) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function now(): number { return Date.now(); }
function fingerprint(query: string, filters: CompassFilters): string { return createHash('sha256').update(JSON.stringify({ query, filters })).digest('hex'); }
function normalizeFilters(value: unknown): CompassFilters {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (entry: unknown, max: number, size = 80) => Array.isArray(entry) ? [...new Set(entry.map((item) => clean(item, size)).filter(Boolean))].slice(0, max) : undefined;
  const year = (entry: unknown) => { const numeric = Number(entry); return Number.isInteger(numeric) && numeric >= 1000 && numeric <= new Date().getFullYear() + 10 ? numeric : undefined; };
  const languages = strings(source.languages, 8, 20)?.map((entry) => entry.toLowerCase());
  const types = strings(source.types, 8, 30)?.filter((entry): entry is CompassPublicationType => PUBLICATION_TYPES.has(entry as CompassPublicationType));
  const disciplines = strings(source.disciplines, 12, 120);
  const providers = strings(source.providers, COMPASS_PROVIDERS.length, 40)?.filter((entry): entry is CompassProviderId => COMPASS_PROVIDERS.includes(entry as CompassProviderId));
  const sort = ['relevance', 'date', 'citations'].includes(String(source.sort)) ? source.sort as CompassFilters['sort'] : undefined;
  return { fromYear: year(source.fromYear), toYear: year(source.toYear), languages, types, disciplines, providers, openAccessOnly: source.openAccessOnly === true, sort };
}
function defaultStore(): CompassStore { return new CompassStore(); }
function fixtureAdapters(): Map<CompassProviderId, CompassProviderAdapter> | null {
  const file = process.env.NODUS_COMPASS_FIXTURE_PATH;
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const out = new Map<CompassProviderId, CompassProviderAdapter>();
    for (const provider of COMPASS_PROVIDERS) out.set(provider, {
      id: provider,
      attribution: 'Nodus Compass fixture',
      search: async (context) => {
        const fixture = parsed[provider];
        const definition: { records?: unknown[]; error?: string; delayMs?: number } = Array.isArray(fixture)
          ? { records: fixture }
          : (fixture && typeof fixture === 'object' ? fixture as { records?: unknown[]; error?: string; delayMs?: number } : {});
        const delay = Math.max(0, Math.min(5_000, Number(definition.delayMs) || 0));
        if (delay) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          context.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        });
        context.signal.throwIfAborted();
        if (definition.error) throw new Error(clean(definition.error, 400));
        const records = Array.isArray(definition.records) ? definition.records as CompassResult[] : [];
        const start = context.cursor ? Number(context.cursor) : 0;
        const selected = records.slice(start, start + 25);
        const next = start + selected.length < records.length ? String(start + selected.length) : undefined;
        return { provider, records: selected, nextCursor: next, hasMore: !!next, attribution: 'Nodus Compass fixture' };
      },
    });
    return out;
  } catch { return null; }
}

export class CompassService {
  private readonly store: CompassStore;
  private readonly running = new Map<string, RunningSearch>();
  private readonly requestIds = new Map<string, string>();
  private readonly pendingInterpretations = new Map<string, AbortController>();
  private readonly searchQueue: QueuedSearch[] = [];
  private readonly activeFingerprints = new Set<string>();
  private readonly loadMoreTasks = new Map<string, Promise<CompassSearchResponse>>();
  private readonly importTasks = new Map<string, Promise<void>>();
  private activeSearches = 0;
  private readonly canceledImports = new Set<string>();
  private readonly retryingImports = new Set<string>();
  private readonly keys: Partial<Record<CompassProviderId, string>> = {};
  private readonly listeners = new Set<(progress: CompassSearchProgress) => void>();
  private readonly importListeners = new Set<(progress: CompassImportProgress) => void>();
  constructor(store = defaultStore()) { this.store = store; this.loadKeys(); }
  private keyFile(provider: CompassProviderId): string { return path.join(path.dirname(this.store.file), 'keys', `${provider}.bin`); }
  private loadKeys(): void { if (!safeStorage.isEncryptionAvailable()) return; for (const provider of COMPASS_PROVIDERS) { try { const file = this.keyFile(provider); if (fs.existsSync(file)) this.keys[provider] = safeStorage.decryptString(fs.readFileSync(file)); } catch { /* locked/missing key remains unavailable */ } } }
  dispose(): void { this.store.close(); }
  onProgress(listener: (progress: CompassSearchProgress) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onImportProgress(listener: (progress: CompassImportProgress) => void): () => void { this.importListeners.add(listener); return () => this.importListeners.delete(listener); }
  private emit(progress: CompassSearchProgress): void { for (const listener of this.listeners) listener(progress); for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('compass:searchProgress', progress); }
  private emitImport(progress: CompassImportProgress): void { for (const listener of this.importListeners) listener(progress); for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('compass:importProgress', progress); }
  private session(searchId: string): CompassSearchSession { const session = this.store.getSearch(searchId); if (!session) throw new Error('Compass search not found.'); return session; }
  private async rankResults(session: CompassSearchSession, records: CompassResult[], signal: AbortSignal, fixture: boolean): Promise<CompassResult[]> {
    let vectors: Array<number[] | null> = [];
    try {
      const settings = getSettings() as unknown as { embeddingProvider?: string; embeddingModel?: string };
      if (settings.embeddingProvider === 'nodus' && /bge[-_ ]?m3/i.test(settings.embeddingModel ?? '')) {
        // One query plus at most one native page (25 records) is the bounded
        // embedding request. A missing local model simply uses lexical ranking.
        vectors = await embedMany([session.query, ...records.map((record) => `${record.title}\n${record.abstract ?? ''}`).slice(0, 25)], signal);
      }
    } catch { vectors = []; }
    return runCompassWorker<CompassResult[]>('rank', [session.query, records, session.filters, vectors], compassDatabasePath(), fixture ? () => records : undefined);
  }
  private async interpretPlan(query: string, filters: CompassFilters, enabled: boolean, signal: AbortSignal): Promise<ReturnType<typeof interpretCompassQuery>> {
    const deterministic = interpretCompassQuery(query, filters);
    if (!enabled) return deterministic;
    try {
      const guard = (value: unknown): value is Partial<typeof deterministic> => !!value && typeof value === 'object' && !Array.isArray(value);
      const ai = await completeJson<Partial<typeof deterministic>>({ system: 'Interpret the research query into JSON. Never invent identifiers, dates, or constraints. Return only fields you can infer.', user: query, temperature: 0, signal }, guard);
      signal.throwIfAborted();
      if (!ai) return deterministic;
      const inferred = (value: unknown, limit: number) => Array.isArray(value) ? value.map((entry) => clean(entry, 120)).filter(Boolean).slice(0, limit) : [];
      return {
        ...deterministic,
        authors: [...new Set([...deterministic.authors, ...inferred(ai.authors, 8)])],
        venues: [...new Set([...deterministic.venues, ...inferred(ai.venues, 8)])],
        disciplines: [...new Set([...deterministic.disciplines, ...inferred(ai.disciplines, 12)])],
        languages: deterministic.languages.length ? deterministic.languages : inferred(ai.languages, 4).map((value) => value.toLowerCase()),
        types: deterministic.types.length ? deterministic.types : inferred(ai.types, 4).filter((value): value is any => ['article', 'book', 'chapter', 'thesis', 'report', 'dataset', 'preprint', 'other'].includes(value)),
      };
    } catch { return deterministic; }
  }
  private scheduleSearches(): void {
    while (this.activeSearches < MAX_ACTIVE_SEARCHES) {
      const index = this.searchQueue.findIndex((entry) => !this.activeFingerprints.has(entry.fingerprint));
      if (index < 0) return;
      const [entry] = this.searchQueue.splice(index, 1);
      if (!this.running.has(entry.searchId)) continue;
      this.activeSearches += 1; this.activeFingerprints.add(entry.fingerprint);
      void this.fetchProviders(entry.searchId, entry.request, entry.providers)
        .catch((error) => this.finishError(entry.searchId, error))
        .finally(() => { this.activeSearches -= 1; this.activeFingerprints.delete(entry.fingerprint); this.scheduleSearches(); });
    }
  }
  async start(request: CompassSearchRequest): Promise<CompassSearchResponse> {
    const query = clean(request.query, COMPASS_MAX_QUERY_LENGTH); if (!query) throw new Error('Compass requires a non-empty query.');
    const filters = normalizeFilters(request.filters); const requestId = clean(request.requestId, 160) || randomUUID(); const existingSearchId = this.requestIds.get(requestId); if (existingSearchId) { const existing = this.get(existingSearchId); if (existing) return existing; }
    if (this.running.size + this.pendingInterpretations.size >= MAX_ACTIVE_SEARCHES + MAX_QUEUED_SEARCHES) throw new Error('Compass search queue is full. Try again shortly.');
    for (const [pendingId, controller] of this.pendingInterpretations) { if (pendingId !== requestId) controller.abort(); }
    const interpretation = new AbortController(); this.pendingInterpretations.set(requestId, interpretation);
    let plan: ReturnType<typeof interpretCompassQuery>;
    try { plan = await this.interpretPlan(query, filters, request.interpretWithLlm === true, interpretation.signal); }
    finally { this.pendingInterpretations.delete(requestId); }
    interpretation.signal.throwIfAborted();
    const searchId = `compass-${randomUUID()}`; const generation = Number.isFinite(request.generation) ? Math.max(0, Number(request.generation)) : 1; const configured: Partial<Record<CompassProviderId, boolean>> = Object.fromEntries(COMPASS_PROVIDERS.map((p) => [p, true])); const providers = routeCompassProviders(plan, configured); const searchFingerprint = fingerprint(query, filters); const session: CompassSearchSession = { searchId, requestId, generation, query, fingerprint: searchFingerprint, plan, filters, state: 'searching', revision: 0, resultCount: 0, selectedCount: 0, providers: providers.map((provider) => ({ provider, state: 'queued', count: 0 })), createdAt: now(), updatedAt: now() }; this.store.saveSearch(session); const controller = new AbortController(); this.running.set(searchId, { controller, session }); this.requestIds.set(requestId, searchId); this.searchQueue.push({ searchId, request: { ...request, query, filters }, providers, fingerprint: searchFingerprint }); this.scheduleSearches(); return { session, results: [] };
  }
  private async fetchProviders(searchId: string, request: CompassSearchRequest, providers: CompassProviderId[]): Promise<void> {
    const fixture = fixtureAdapters(); const adapters = fixture ?? createCompassAdapters(Object.fromEntries(providers.map((p) => [p, { apiKey: this.keys[p], email: undefined }]))); const running = this.running.get(searchId); if (!running) return;
    const fetchOne = async (provider: CompassProviderId): Promise<{ provider: CompassProviderId; records: CompassResult[]; nextCursor?: string; attribution?: string; error?: string; state?: CompassProviderStatus['state']; retryAt?: number }> => { const session = this.session(searchId); const status = session.providers.find((x) => x.provider === provider); if (status) status.state = 'searching'; this.store.saveSearch(session); try { const cursor = status?.nextCursor; const cacheKey = createHash('sha256').update(`${provider}:${session.fingerprint}:${cursor ?? '*'}`).digest('hex'); const cached = this.store.getProviderCache(cacheKey); if (cached) { const cachedPage = cached.payload as { records: CompassResult[]; nextCursor?: string; attribution?: string }; const rankedCached = await this.rankResults(session, cachedPage.records ?? [], running!.controller.signal, !!fixture); return { provider, records: rankedCached, nextCursor: cachedPage.nextCursor, attribution: cachedPage.attribution }; } const a = adapters.get(provider); if (!a) throw new Error(`Compass provider ${provider} is not enabled.`); let email: string | undefined; try { const settings = getSettings() as unknown as Record<string, unknown>; email = typeof settings.unpaywallEmail === 'string' ? settings.unpaywallEmail : undefined; } catch { /* isolated test profile */ } const response = await a.search({ query: session.plan, filters: session.filters, signal: running!.controller.signal, apiKey: this.keys[provider], email }); const attribution = response.attribution ?? a.attribution; const enriched = response.records.map((record) => ({ ...record, provenance: record.provenance.map((entry) => ({ ...entry, attribution: entry.attribution ?? attribution, metadataLicense: entry.metadataLicense ?? a.attribution })) })); this.store.putProviderCache(cacheKey, provider, { records: enriched, nextCursor: response.nextCursor, attribution }, response.nextCursor, 24 * 60 * 60_000); const ranked = await this.rankResults(session, enriched, running!.controller.signal, !!fixture); return { provider, records: ranked, nextCursor: response.nextCursor, attribution }; } catch (error) { return { provider, records: [], error: clean(error instanceof Error ? error.message : error, 400), state: error instanceof CompassProviderHttpError && error.status === 429 ? 'rate-limited' : 'error', retryAt: error instanceof CompassProviderHttpError ? error.retryAt : undefined }; } };
    // Provider calls are network-bound. Three concurrent calls preserve UI
    // responsiveness while respecting upstream rate limits.
    for (let offset = 0; offset < providers.length; offset += 3) {
      if (running.controller.signal.aborted) return;
      const batch = await Promise.all(providers.slice(offset, offset + 3).map(fetchOne));
      if (running.controller.signal.aborted || this.running.get(searchId) !== running) return;
      for (const outcome of batch) { if (running.controller.signal.aborted || this.running.get(searchId) !== running) return; let session = this.session(searchId); const status = session.providers.find((x) => x.provider === outcome.provider); if (status) { status.state = outcome.error ? outcome.state ?? 'error' : 'complete'; status.error = outcome.error; status.retryAt = outcome.retryAt; status.count += outcome.records.length; status.nextCursor = outcome.nextCursor; status.attribution = outcome.attribution; } if (outcome.records.length) { session.revision += 1; const merged = this.mergeResults(searchId, outcome.records, session.revision); this.store.upsertResults(searchId, merged, session.revision); } session.state = 'partial'; session.updatedAt = now(); this.store.saveSearch(session); this.emit({ searchId, requestId: session.requestId, generation: session.generation, revision: session.revision, state: session.state, summaries: this.store.listResults(searchId, 0, 25), resultsOffset: 0, providers: session.providers, done: false, error: outcome.error }); }
    }
    if (running.controller.signal.aborted || this.running.get(searchId) !== running) return;
    const session = this.session(searchId); this.store.stabilizeResultOrder(searchId); session.state = this.store.listResults(searchId).length ? 'complete' : session.providers.every((provider) => provider.state === 'error' || provider.state === 'rate-limited') ? 'error' : 'empty'; session.updatedAt = now(); this.store.saveSearch(session); this.emit({ searchId, requestId: session.requestId, generation: session.generation, revision: session.revision, state: session.state, summaries: this.store.listResults(searchId, 0, 25), resultsOffset: 0, providers: session.providers, done: true }); this.running.delete(searchId); this.requestIds.delete(session.requestId);
  }
  private mergeResults(searchId: string, incoming: CompassResult[], _revision: number): CompassResult[] {
    const output: CompassResult[] = [];
    const normalizedTitle = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const sameLocalRecord = (left: CompassResult, right: CompassResult) => {
      if (left.canonicalKey === right.canonicalKey) return true;
      if (left.identifiers.some((identifier) => right.identifiers.some((other) => identifier.scheme.toLowerCase() === other.scheme.toLowerCase() && identifier.value.toLowerCase() === other.value.toLowerCase()))) return true;
      const sameAuthor = !left.authors[0]?.name || !right.authors[0]?.name || normalizedTitle(left.authors[0].name) === normalizedTitle(right.authors[0].name);
      return normalizedTitle(left.title) === normalizedTitle(right.title) && sameAuthor && (!left.issuedYear || !right.issuedYear || left.issuedYear === right.issuedYear);
    };
    const merge = (existing: CompassResult, candidate: CompassResult): CompassResult => {
      const identifiers = [...existing.identifiers, ...candidate.identifiers].filter((identifier, index, all) => all.findIndex((other) => other.scheme.toLowerCase() === identifier.scheme.toLowerCase() && other.value.toLowerCase() === identifier.value.toLowerCase()) === index);
      const provenance = [...existing.provenance, ...candidate.provenance].filter((entry, index, all) => all.findIndex((other) => other.provider === entry.provider && other.providerId === entry.providerId) === index);
      const reasons = [...existing.reasons, ...candidate.reasons].filter((entry, index, all) => all.findIndex((other) => other.code === entry.code && other.value === entry.value) === index);
      return { ...existing, ...candidate, canonicalKey: existing.canonicalKey, title: existing.title || candidate.title, identifiers, provenance, reasons };
    };
    for (const candidate of incoming) {
      const localIndex = output.findIndex((existing) => sameLocalRecord(existing, candidate));
      if (localIndex >= 0) { output[localIndex] = merge(output[localIndex], candidate); continue; }
      const persisted = this.store.getResult(searchId, candidate.canonicalKey) || this.store.findResultByIdentity(searchId, candidate.identifiers, candidate.title, candidate.issuedYear, candidate.authors[0]?.name);
      output.push(persisted ? merge(persisted, candidate) : candidate);
    }
    return output;
  }
  async loadMore(searchId: string, requestId: string, generation: number, offset = 0): Promise<CompassSearchResponse> {
    const pageOffset = Math.max(0, Math.floor(offset / 25) * 25);
    const key = `${searchId}:${requestId}:${generation}:${pageOffset}`;
    const existing = this.loadMoreTasks.get(key); if (existing) return existing;
    const task = this.loadMoreOnce(searchId, requestId, generation, pageOffset);
    this.loadMoreTasks.set(key, task);
    try { return await task; } finally { if (this.loadMoreTasks.get(key) === task) this.loadMoreTasks.delete(key); }
  }
  private async loadMoreOnce(searchId: string, requestId: string, generation: number, offset = 0): Promise<CompassSearchResponse> {
    const session = this.session(searchId);
    if (session.requestId !== requestId || session.generation !== generation) throw new Error('Compass search generation is stale.');
    const pageOffset = Math.max(0, Math.floor(offset / 25) * 25);
    const existing = this.store.listResults(searchId, pageOffset, 25);
    const existingTotal = this.store.resultCount(searchId);
    if (existing.length === 25 || (existing.length > 0 && !session.providers.some((provider) => provider.nextCursor))) {
      return { session, results: existing, resultsOffset: pageOffset, hasMore: existingTotal > pageOffset + existing.length || session.providers.some((provider) => !!provider.nextCursor) };
    }
    if (!this.running.has(searchId)) this.running.set(searchId, { controller: new AbortController(), session });
    const current = this.running.get(searchId)!; const fixture = fixtureAdapters(); const adapters = fixture ?? createCompassAdapters(Object.fromEntries(COMPASS_PROVIDERS.map((provider) => [provider, { apiKey: this.keys[provider] }])));
    for (const status of session.providers.filter((provider) => provider.nextCursor)) {
      if (current.controller.signal.aborted || this.running.get(searchId) !== current) break;
      try {
        const adapter = adapters.get(status.provider); if (!adapter) continue;
        let email: string | undefined; try { email = getSettings().unpaywallEmail || undefined; } catch { /* isolated test profile */ }
        status.state = 'searching'; this.store.saveSearch(session);
        const resultPage = await adapter.search({ query: session.plan, filters: session.filters, cursor: status.nextCursor, signal: current.controller.signal, apiKey: this.keys[status.provider], email });
        if (current.controller.signal.aborted || this.running.get(searchId) !== current) break;
        const attribution = resultPage.attribution ?? adapter.attribution;
        const enriched = resultPage.records.map((record) => ({ ...record, provenance: record.provenance.map((entry) => ({ ...entry, attribution: entry.attribution ?? attribution, metadataLicense: entry.metadataLicense ?? adapter.attribution })) }));
        const ranked = await this.rankResults(session, enriched, current.controller.signal, !!fixture);
        if (current.controller.signal.aborted || this.running.get(searchId) !== current) break;
        session.revision += 1; const merged = this.mergeResults(searchId, ranked, session.revision); this.store.upsertResults(searchId, merged, session.revision);
        status.nextCursor = resultPage.nextCursor; status.count += ranked.length; status.state = 'complete'; status.error = undefined; status.retryAt = undefined; status.attribution = attribution;
      } catch (error) {
        if (current.controller.signal.aborted) break;
        status.state = error instanceof CompassProviderHttpError && error.status === 429 ? 'rate-limited' : 'error'; status.retryAt = error instanceof CompassProviderHttpError ? error.retryAt : undefined; status.error = clean(error instanceof Error ? error.message : error, 400);
      }
      session.updatedAt = now(); this.store.saveSearch(session);
      this.emit({ searchId, requestId, generation, revision: session.revision, state: 'partial', summaries: this.store.listResults(searchId, pageOffset, 25), resultsOffset: pageOffset, providers: session.providers, done: false, error: status.error });
      if (this.store.resultCount(searchId) >= pageOffset + 25) break;
    }
    const finalSession = this.session(searchId); const page = this.store.listResults(searchId, pageOffset, 25);
    const hasMore = this.store.resultCount(searchId) > pageOffset + page.length || finalSession.providers.some((provider) => !!provider.nextCursor);
    finalSession.state = page.length || finalSession.resultCount ? 'complete' : finalSession.providers.every((provider) => provider.state === 'error' || provider.state === 'rate-limited') ? 'error' : 'empty';
    finalSession.updatedAt = now();
    this.store.saveSearch(finalSession);
    if (!hasMore) this.running.delete(searchId);
    return { session: finalSession, results: page, resultsOffset: pageOffset, hasMore };
  }
  cancel(searchId?: string, requestId?: string): void {
    if (requestId) this.pendingInterpretations.get(requestId)?.abort();
    if (!searchId) return;
    const running = this.running.get(searchId);
    if (running) { running.controller.abort(); const session = this.session(searchId); session.state = 'canceled'; session.updatedAt = now(); this.store.saveSearch(session); this.running.delete(searchId); this.requestIds.delete(session.requestId); }
  }
  get(searchId: string): CompassSearchResponse | null { const session = this.store.getSearch(searchId); if (!session) return null; const results = this.store.listResults(searchId); return { session, results, resultsOffset: 0, hasMore: session.resultCount > results.length || session.providers.some((provider) => !!provider.nextCursor) }; }
  listResults(searchId: string, offset = 0, limit = 25): CompassResultSummary[] { return this.store.listResults(searchId, offset, limit); }
  history(limit = 50): CompassSearchSession[] { return this.store.listHistory(limit); }
  deleteHistory(id: string): void { for (const [requestId, searchId] of this.requestIds) if (searchId === id) this.requestIds.delete(requestId); this.store.deleteSearch(id); }
  clearHistory(): void { this.requestIds.clear(); this.store.clearHistory(); }
  save(searchId: string, key: string): void { this.store.saveCandidate(searchId, key); }
  saved(limit = 100): CompassResultSummary[] { return this.store.listSavedCandidates(limit); }
  dismiss(searchId: string, key: string): void { this.store.dismissCandidate(searchId, key); }
  restore(searchId: string, key: string): void { this.store.restoreCandidate(searchId, key); }
  setSelection(searchId: string, keys: string[], revision: number): void { this.store.setSelection(searchId, keys, revision); }
  selection(searchId: string): string[] { return this.store.selectedKeys(searchId); }
  setKey(provider: CompassProviderId, key: string): void { if (!COMPASS_PROVIDERS.includes(provider)) throw new Error('Unknown Compass provider.'); const value = clean(key, 500); if (!value) return this.clearKey(provider); this.keys[provider] = value; if (safeStorage.isEncryptionAvailable()) { const file = this.keyFile(provider); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* best effort on non-POSIX filesystems */ } const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, safeStorage.encryptString(value), { mode: 0o600 }); fs.renameSync(temporary, file); } }
  clearKey(provider: CompassProviderId): void { if (!COMPASS_PROVIDERS.includes(provider)) throw new Error('Unknown Compass provider.'); delete this.keys[provider]; try { fs.rmSync(this.keyFile(provider), { force: true }); } catch { /* already absent */ } }
  providerStatus(): CompassProviderStatus[] { return COMPASS_PROVIDERS.map((provider) => ({ provider, state: 'idle', count: 0 })); }
  async import(request: CompassImportRequest): Promise<CompassImportJob> { const keys = [...new Set(request.canonicalKeys.map((x) => clean(x, 200)).filter(Boolean))].slice(0, 10_000); if (!keys.length) throw new Error('Select at least one Compass result.'); const missing = keys.filter((key) => !this.store.getResult(request.searchId, key)); if (missing.length) throw new Error(`Compass selection contains ${missing.length} unavailable result(s).`); const job: CompassImportJob = { jobId: `compass-import-${randomUUID()}`, searchId: request.searchId, selectionRevision: request.selectionRevision, selectedKeys: keys, collectionIds: (request.collectionIds ?? []).slice(0, 100), state: 'running', total: keys.length, completed: 0, failed: 0, createdAt: now(), updatedAt: now() }; this.canceledImports.delete(job.jobId); this.store.createImportJob(job); this.emitImport({ job, items: this.store.listImportItems(job.jobId) }); this.trackImportTask(job.jobId, this.runLibraryImport(job)); return job; }
  private trackImportTask(jobId: string, task: Promise<void>): void {
    this.importTasks.set(jobId, task);
    void task.finally(() => { if (this.importTasks.get(jobId) === task) this.importTasks.delete(jobId); });
  }
  private async runLibraryImport(job: CompassImportJob): Promise<void> {
    try {
      const { startGlobalLibraryCompassImport } = await import('../library/libraryService');
      if (this.canceledImports.has(job.jobId)) { this.canceledImports.delete(job.jobId); return; }
      const candidates: LibraryCompassCandidate[] = job.selectedKeys.map((key) => this.store.getResult(job.searchId, key)).filter((x): x is CompassResult => !!x).map((r) => ({ canonicalKey: r.canonicalKey, metadata: this.libraryMetadata(r), provider: r.provenance[0]?.provider, providerId: r.provenance[0]?.providerId, provenance: r.provenance.map((p) => ({ provider: p.provider, providerId: p.providerId, sourceUrl: p.sourceUrl, retrievedAt: p.retrievedAt, attribution: p.attribution, metadataLicense: p.metadataLicense })) }))
      const report = await startGlobalLibraryCompassImport(job.jobId, candidates, job.collectionIds, (progress) => { if (this.retryingImports.has(job.jobId)) return; const next = this.store.getImportJob(job.jobId); if (!next) return; next.completed = progress.completed; next.failed = progress.failed; next.updatedAt = now(); this.store.updateImportJob(next); this.emitImport({ job: next, items: this.store.listImportItems(job.jobId) }); });
      if (this.retryingImports.has(job.jobId)) return;
      const next = this.store.getImportJob(job.jobId); if (!next) return; const canceled = this.canceledImports.has(job.jobId) || report.status === 'canceled'; next.state = canceled ? 'canceled' : report.failed ? 'failed' : 'completed'; next.completed = report.items.filter((i) => i.state !== 'failed' && i.state !== 'canceled').length; next.failed = report.failed; next.updatedAt = now(); for (const item of report.items) this.store.updateImportItem({ jobId: job.jobId, canonicalKey: item.canonicalKey, state: canceled && item.state === 'canceled' ? 'canceled' : item.state, libraryItemId: item.itemId, error: item.error }); this.store.updateImportJob(next); this.emitImport({ job: next, items: this.store.listImportItems(job.jobId) }); this.canceledImports.delete(job.jobId);
    } catch (error) { if (this.retryingImports.has(job.jobId)) return; const next = this.store.getImportJob(job.jobId); if (!next) return; if (this.canceledImports.has(job.jobId) || next.state === 'canceled') { next.state = 'canceled'; next.updatedAt = now(); this.store.updateImportJob(next); this.emitImport({ job: next, items: this.store.listImportItems(job.jobId) }); this.canceledImports.delete(job.jobId); return; } const message = clean(error instanceof Error ? error.message : error, 400); for (const item of this.store.listImportItems(job.jobId)) this.store.updateImportItem({ ...item, state: 'failed', error: message }); next.state = 'failed'; next.failed = next.total; next.updatedAt = now(); this.store.updateImportJob(next); this.emitImport({ job: next, items: this.store.listImportItems(job.jobId) }); }
  }
  private libraryMetadata(r: CompassResult): LibraryItemMetadata { const creators: LibraryCreator[] = r.authors.map((a) => a.family || a.given ? { creatorType: 'author', firstName: a.given, lastName: a.family, name: a.name } : { creatorType: 'author', name: a.name }); const itemType: LibraryItemType = r.type === 'article' ? 'article-journal' : r.type === 'book' ? 'book' : r.type === 'chapter' ? 'book-chapter' : r.type === 'thesis' ? 'thesis' : r.type === 'report' ? 'report' : r.type === 'dataset' ? 'dataset' : r.type === 'preprint' ? 'preprint' : 'document'; const id = (scheme: string) => r.identifiers.find((x) => x.scheme.toLowerCase() === scheme)?.value; return { title: r.title, itemType, creators, abstract: r.abstract, date: r.issuedDate, year: r.issuedYear ?? null, language: r.language, publisher: r.publisher, publicationTitle: r.venue, url: r.landingUrl, doi: id('doi'), pmid: id('pmid'), pmcid: id('pmcid'), arxiv: id('arxiv'), isbn: r.identifiers.filter((x) => x.scheme === 'isbn').map((x) => x.value), issn: r.identifiers.filter((x) => x.scheme === 'issn').map((x) => x.value), rights: r.openAccess?.license, extra: { compassCanonicalKey: r.canonicalKey, compassProviders: r.provenance.map((p) => p.provider).join(',') } }; }
  importProgress(jobId: string): CompassImportProgress | null { const job = this.store.getImportJob(jobId); return job ? { job, items: this.store.listImportItems(jobId) } : null; }
  cancelImport(jobId: string): void { const job = this.store.getImportJob(jobId); if (!job || ['completed', 'failed', 'canceled'].includes(job.state)) return; this.canceledImports.add(jobId); void import('../library/libraryService').then(({ cancelGlobalLibraryCompassImport }) => cancelGlobalLibraryCompassImport(jobId)).catch(() => undefined); this.store.cancelPendingImportItems(jobId); job.state = 'canceled'; job.updatedAt = now(); this.store.updateImportJob(job); this.emitImport({ job, items: this.store.listImportItems(jobId) }); }
  retryImport(jobId: string): CompassImportJob {
    const job = this.store.getImportJob(jobId); if (!job) throw new Error('Compass import not found.');
    const previous = this.importTasks.get(jobId);
    this.retryingImports.add(jobId); job.state = 'queued'; job.completed = 0; job.failed = 0; job.updatedAt = now(); this.store.updateImportJob(job); this.emitImport({ job, items: this.store.listImportItems(jobId) });
    const task = (async () => {
      if (previous) await previous.catch(() => undefined);
      this.canceledImports.delete(jobId);
      this.retryingImports.delete(jobId);
      const next = this.store.getImportJob(jobId); if (!next || next.state !== 'queued') return;
      this.store.resetImportItems(jobId);
      next.state = 'running'; next.updatedAt = now(); this.store.updateImportJob(next); this.emitImport({ job: next, items: this.store.listImportItems(jobId) });
      await this.runLibraryImport(next);
    })();
    this.trackImportTask(jobId, task);
    return job;
  }
  private finishError(searchId: string, error: unknown): void { const session = this.store.getSearch(searchId); if (!session) return; session.state = 'error'; session.updatedAt = now(); this.store.saveSearch(session); this.emit({ searchId, requestId: session.requestId, generation: session.generation, revision: session.revision, state: 'error', summaries: [], resultsOffset: 0, providers: session.providers, done: true, error: clean(error instanceof Error ? error.message : error, 400) }); this.running.delete(searchId); this.requestIds.delete(session.requestId); }
}

let singleton: CompassService | null = null;
export function compassService(): CompassService { if (!singleton) singleton = new CompassService(); return singleton; }
