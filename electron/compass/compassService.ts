// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type {
  CompassFilters,
  CompassImportJob,
  CompassImportProgress,
  CompassImportRequest,
  CompassLane,
  CompassProviderAdapter,
  CompassProviderId,
  CompassProviderStatus,
  CompassPublicationType,
  CompassQueryPlan,
  CompassQueryStrategy,
  CompassRangeSelectionRequest,
  CompassResult,
  CompassResultSummary,
  CompassSearchProgress,
  CompassSearchRequest,
  CompassSearchResponse,
  CompassSearchSession,
  CompassViewRequest,
} from "@shared/compass";
import type {
  LibraryCompassCandidate,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemType,
} from "@shared/libraryTypes";
import { COMPASS_MAX_QUERY_LENGTH, COMPASS_PROVIDERS } from "@shared/compass";
import { CompassStore, compassDatabasePath } from "./compassStore";
import { interpretCompassQuery } from "./compassQueryInterpreter";
import { routeCompassRequests, type CompassRoute } from "./compassRouter";
import {
  CompassRequestScheduler,
  CompassScheduleError,
} from "./compassRequestScheduler";
import { createCompassAdapters } from "./providers/adapters";
import {
  listProviderDescriptors,
  providerDescriptor,
} from "./providers/catalog";
import {
  CompassProviderError,
  normalizeIdentifier,
} from "./providers/provider";
import { runCompassWorker } from "./compassWorkerHost";
import { getSettings } from "../db/settingsRepo";
import { embedMany, completeJson } from "../ai/aiClient";
import {
  fetchPublicResource,
  responseToTemporaryFile,
} from "../network/publicDownload";
import { deduplicateFileByHardLink } from "./attachmentDedup";

interface RunningSearch {
  controller: AbortController;
  generation: number;
  queryRevision: number;
}
interface ProviderOutcome {
  provider: CompassProviderId;
  lane: CompassLane;
  strategy: CompassQueryStrategy;
  records: CompassResult[];
  nextCursor?: string;
  attribution?: string;
  error?: string;
  state?: CompassProviderStatus["state"];
  retryAt?: number;
}
const PUBLICATION_TYPES = new Set<CompassPublicationType>([
  "article",
  "book",
  "chapter",
  "thesis",
  "report",
  "dataset",
  "preprint",
  "photograph",
  "newspaper",
  "map",
  "manuscript",
  "audio",
  "video",
  "archive-item",
  "other",
]);
const clean = (value: unknown, max = 2_000) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const now = () => Date.now();
const fingerprint = (
  query: string,
  filters: CompassFilters,
  lane: CompassLane,
) =>
  createHash("sha256")
    .update(JSON.stringify({ query, filters, lane }))
    .digest("hex");

function normalizeFilters(value: unknown, lane?: CompassLane): CompassFilters {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const strings = (entry: unknown, max: number, size = 80) =>
    Array.isArray(entry)
      ? [
          ...new Set(entry.map((item) => clean(item, size)).filter(Boolean)),
        ].slice(0, max)
      : undefined;
  const year = (entry: unknown) => {
    const numeric = Number(entry);
    return Number.isInteger(numeric) &&
      numeric >= 1000 &&
      numeric <= new Date().getFullYear() + 10
      ? numeric
      : undefined;
  };
  const types = strings(source.types, 16, 30)?.filter(
    (entry): entry is CompassPublicationType =>
      PUBLICATION_TYPES.has(entry as CompassPublicationType),
  );
  const providers = strings(
    source.providers,
    COMPASS_PROVIDERS.length,
    40,
  )?.filter((entry): entry is CompassProviderId =>
    (COMPASS_PROVIDERS as readonly string[]).includes(entry),
  );
  const normalizedLane =
    lane ?? (source.lane === "primary" ? "primary" : "scholarly");
  return {
    lane: normalizedLane,
    fromYear: year(source.fromYear),
    toYear: year(source.toYear),
    languages: strings(source.languages, 8, 20)?.map((entry) =>
      entry.toLocaleLowerCase(),
    ),
    types,
    disciplines: strings(source.disciplines, 12, 120),
    providers,
    openAccessOnly: source.openAccessOnly === true,
    digitallyAvailableOnly: source.digitallyAvailableOnly === true,
    sort: ["relevance", "date", "citations"].includes(String(source.sort))
      ? (source.sort as CompassFilters["sort"])
      : "relevance",
  };
}
function defaultStore(): CompassStore {
  return new CompassStore();
}
function fixtureAdapters(): Map<
  CompassProviderId,
  CompassProviderAdapter
> | null {
  const file = process.env.NODUS_COMPASS_FIXTURE_PATH;
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    const output = new Map<CompassProviderId, CompassProviderAdapter>();
    for (const provider of COMPASS_PROVIDERS)
      output.set(provider, {
        id: provider,
        descriptor: providerDescriptor(provider),
        search: async (context) => {
          const fixture = parsed[provider];
          const definition = (
            Array.isArray(fixture)
              ? { records: fixture }
              : fixture && typeof fixture === "object"
                ? fixture
                : {}
          ) as { records?: CompassResult[]; error?: string; delayMs?: number };
          if (definition.delayMs)
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                resolve,
                Math.min(5_000, Number(definition.delayMs)),
              );
              context.signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            });
          context.signal.throwIfAborted();
          if (definition.error) throw new Error(clean(definition.error, 400));
          const start = Number(context.cursor ?? 0);
          const records = (definition.records ?? [])
            .slice(start, start + 25)
            .map((record) => ({
              ...record,
              lane: record.lane ?? context.lane,
              downloadLinks: record.downloadLinks ?? [],
            }));
          const next =
            start + records.length < (definition.records?.length ?? 0)
              ? String(start + records.length)
              : undefined;
          return {
            provider,
            records,
            nextCursor: next,
            hasMore: Boolean(next),
            attribution: "Nodus Compass fixture",
          };
        },
      });
    return output;
  } catch {
    return null;
  }
}

export class CompassService {
  private readonly store: CompassStore;
  private readonly scheduler: CompassRequestScheduler;
  private readonly running = new Map<string, RunningSearch>();
  private readonly requestIds = new Map<string, string>();
  private readonly pendingInterpretations = new Map<string, AbortController>();
  private readonly loadMoreTasks = new Map<
    string,
    Promise<CompassSearchResponse>
  >();
  private readonly commitChains = new Map<string, Promise<void>>();
  private readonly importTasks = new Map<string, Promise<void>>();
  private readonly importControllers = new Map<string, AbortController>();
  private readonly searchOwners = new Map<string, number>();
  private readonly importOwners = new Map<string, number>();
  private readonly listeners = new Set<
    (progress: CompassSearchProgress) => void
  >();
  private readonly importListeners = new Set<
    (progress: CompassImportProgress) => void
  >();
  private embeddingLock: Promise<void> = Promise.resolve();
  private attachmentCommitLock: Promise<void> = Promise.resolve();
  private readonly embeddedBySearch = new Map<string, number>();
  constructor(store = defaultStore()) {
    this.store = store;
    this.scheduler = new CompassRequestScheduler(store);
  }
  private async withAttachmentCommitLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.attachmentCommitLock;
    let release!: () => void;
    this.attachmentCommitLock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
  dispose(): void {
    for (const running of this.running.values()) running.controller.abort();
    for (const controller of this.importControllers.values())
      controller.abort();
    this.store.close();
  }
  onProgress(listener: (progress: CompassSearchProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onImportProgress(
    listener: (progress: CompassImportProgress) => void,
  ): () => void {
    this.importListeners.add(listener);
    return () => this.importListeners.delete(listener);
  }
  private emit(progress: CompassSearchProgress): void {
    for (const listener of this.listeners) listener(progress);
    const owner = this.searchOwners.get(progress.searchId);
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.webContents.id === owner,
    );
    if (window && !window.isDestroyed())
      window.webContents.send('compass:searchProgress', progress);
  }
  private emitImport(progress: CompassImportProgress): void {
    for (const listener of this.importListeners) listener(progress);
    const owner = this.importOwners.get(progress.job.jobId);
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.webContents.id === owner,
    );
    if (window && !window.isDestroyed())
      window.webContents.send('compass:importProgress', progress);
  }
  claimSearch(searchId: string, webContentsId: number): void {
    const key = clean(searchId, 200);
    const owner = this.searchOwners.get(key);
    if (owner != null && owner !== webContentsId)
      throw new Error("Compass search belongs to another window.");
    this.searchOwners.set(key, webContentsId);
  }
  claimImport(jobId: string, webContentsId: number): void {
    const key = clean(jobId, 200);
    const owner = this.importOwners.get(key);
    if (owner != null && owner !== webContentsId)
      throw new Error("Compass import belongs to another window.");
    this.importOwners.set(key, webContentsId);
  }
  private session(searchId: string): CompassSearchSession {
    const session = this.store.getSearch(searchId);
    if (!session) throw new Error("Compass search not found.");
    return session;
  }
  private current(
    searchId: string,
    generation: number,
    queryRevision: number,
  ): boolean {
    const running = this.running.get(searchId);
    return Boolean(
      running &&
      !running.controller.signal.aborted &&
      running.generation === generation &&
      running.queryRevision === queryRevision,
    );
  }
  private progress(
    session: CompassSearchSession,
    done: boolean,
    error?: string,
    offset = 0,
  ): CompassSearchProgress {
    return {
      searchId: session.searchId,
      requestId: session.requestId,
      generation: session.generation,
      queryRevision: session.queryRevision,
      viewRevision: session.viewRevision,
      revision: session.revision,
      state: session.state,
      summaries: this.store.listResults(session.searchId, offset, 25),
      resultsOffset: offset,
      providers: session.providers,
      done,
      error,
    };
  }

  private async rankResults(
    session: CompassSearchSession,
    records: CompassResult[],
    signal: AbortSignal,
    fixture: boolean,
  ): Promise<CompassResult[]> {
    const rankedInput = records.map((record, index) => ({
      ...record,
      nativeRank: record.nativeRank ?? index + 1,
      providerRanks: {
        ...record.providerRanks,
        [record.provenance[0]?.provider ?? "openalex"]:
          record.nativeRank ?? index + 1,
      },
    }));
    let vectors: Array<number[] | null> = [];
    const already = this.embeddedBySearch.get(session.searchId) ?? 0;
    if (!fixture && already < 200 && rankedInput.length) {
      let release!: () => void;
      const previous = this.embeddingLock;
      this.embeddingLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const settings = getSettings() as unknown as {
          embeddingProvider?: string;
          embeddingModel?: string;
        };
        if (
          /bge[-_ ]?m3/i.test(settings.embeddingModel ?? "") &&
          // Compass may only use an already-installed local BGE-M3. Remote
          // embedding providers would read credentials and disclose records.
          settings.embeddingProvider === "nodus"
        ) {
          const batch = rankedInput.slice(0, Math.min(32, 200 - already));
          vectors = await embedMany(
            [
              session.plan.expressions.semantic,
              ...batch.map(
                (record) => `${record.title}\n${record.abstract ?? ""}`,
              ),
            ],
            signal,
          );
          this.embeddedBySearch.set(session.searchId, already + batch.length);
        }
      } catch {
        vectors = [];
      } finally {
        release();
      }
    }
    return runCompassWorker<CompassResult[]>(
      "rank",
      [session.plan, rankedInput, session.filters, vectors],
      compassDatabasePath(),
      fixture ? () => rankedInput : undefined,
    );
  }
  private async interpretPlan(
    query: string,
    filters: CompassFilters,
    enabled: boolean,
    signal: AbortSignal,
  ) {
    const deterministic = interpretCompassQuery(query, filters);
    if (!enabled) return deterministic;
    try {
      const guard = (value: unknown): value is Partial<typeof deterministic> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value));
      const ai = await completeJson<Partial<typeof deterministic>>(
        {
          system:
            "Interpret the research query into JSON. Never invent identifiers, dates, or constraints.",
          user: query,
          temperature: 0,
          signal,
        },
        guard,
      );
      signal.throwIfAborted();
      if (!ai) return deterministic;
      const inferred = (value: unknown, limit: number) =>
        Array.isArray(value)
          ? value
              .map((entry) => clean(entry, 120))
              .filter(Boolean)
              .slice(0, limit)
          : [];
      return {
        ...deterministic,
        authors: [
          ...new Set([...deterministic.authors, ...inferred(ai.authors, 8)]),
        ],
        venues: [
          ...new Set([...deterministic.venues, ...inferred(ai.venues, 8)]),
        ],
        disciplines: [
          ...new Set([
            ...deterministic.disciplines,
            ...inferred(ai.disciplines, 12),
          ]),
        ],
      };
    } catch {
      return deterministic;
    }
  }

  async start(
    request: CompassSearchRequest,
    ownerWebContentsId?: number,
  ): Promise<CompassSearchResponse> {
    const displayQuery = clean(request.query, COMPASS_MAX_QUERY_LENGTH);
    const similarSource = request.similarTo
      ? this.store.getResult(
          clean(request.similarTo.searchId, 160),
          clean(request.similarTo.canonicalKey, 200),
        )
      : null;
    if (request.similarTo && !similarSource)
      throw new Error("The Compass source for similarity is unavailable.");
    const query = similarSource
      ? clean(
          [
            similarSource.title,
            similarSource.abstract,
            similarSource.topics.join(" "),
            similarSource.disciplines.join(" "),
          ]
            .filter(Boolean)
            .join(" "),
          COMPASS_MAX_QUERY_LENGTH,
        )
      : displayQuery;
    if (!query) throw new Error("Compass requires a non-empty query.");
    const lane: CompassLane = similarSource
      ? "scholarly"
      : request.lane === "primary" || request.filters?.lane === "primary"
        ? "primary"
        : "scholarly";
    let filters = normalizeFilters(request.filters, lane);
    const requestId = clean(request.requestId, 160) || randomUUID();
    const duplicate = this.requestIds.get(requestId);
    if (duplicate) {
      if (ownerWebContentsId != null)
        this.claimSearch(duplicate, ownerWebContentsId);
      return (
        this.get(duplicate) ??
        Promise.reject(new Error("Compass request is unavailable."))
      );
    }
    for (const [id, controller] of this.pendingInterpretations)
      if (id !== requestId) controller.abort();
    const interpretation = new AbortController();
    this.pendingInterpretations.set(requestId, interpretation);
    let plan: CompassQueryPlan;
    try {
      plan = await this.interpretPlan(
        query,
        filters,
        request.interpretWithLlm === true,
        interpretation.signal,
      );
    } finally {
      this.pendingInterpretations.delete(requestId);
    }
    interpretation.signal.throwIfAborted();
    if (similarSource)
      plan = {
        ...plan,
        mode: "similar",
        lane: "scholarly",
        providers: ["openalex", "semanticscholar"],
      };
    if (plan.openAccessOnly && !filters.openAccessOnly)
      filters = { ...filters, openAccessOnly: true };
    const routes = routeCompassRequests(plan);
    const searchId = `compass-${randomUUID()}`;
    const generation = Math.max(1, Number(request.generation) || 1);
    const queryRevision = Math.max(
      1,
      Number(request.queryRevision) || generation,
    );
    const searchFingerprint = fingerprint(query, filters, lane);
    const session: CompassSearchSession = {
      searchId,
      requestId,
      generation,
      queryRevision,
      viewRevision: 0,
      query: displayQuery,
      fingerprint: searchFingerprint,
      plan,
      filters,
      lane,
      state: "queued",
      revision: 0,
      resultCount: 0,
      selectedCount: 0,
      providers: routes.map((route) => ({
        provider: route.provider,
        state: "queued",
        count: 0,
        hasMore: false,
        strategy: route.strategy,
        lane: route.lane,
      })),
      createdAt: now(),
      updatedAt: now(),
    };
    this.store.saveSearch(session);
    if (ownerWebContentsId != null)
      this.claimSearch(searchId, ownerWebContentsId);
    for (const route of routes)
      this.store.upsertRoute({ searchId, ...route, page: 0, state: "queued" });
    const controller = new AbortController();
    this.running.set(searchId, { controller, generation, queryRevision });
    this.requestIds.set(requestId, searchId);
    session.state = "searching";
    this.store.saveSearch(session);
    void this.fetchInitial(
      session,
      routes,
      controller,
      fixtureAdapters(),
    ).catch((error) => this.finishError(searchId, error));
    return { session, results: [], hasMore: routes.length > 0 };
  }
  private async fetchInitial(
    initial: CompassSearchSession,
    routes: CompassRoute[],
    controller: AbortController,
    fixtures: Map<CompassProviderId, CompassProviderAdapter> | null,
  ): Promise<void> {
    const tasks = routes.map(async (route) => {
      const outcome = await this.fetchRoute(
        initial.searchId,
        route,
        undefined,
        "visible",
        controller.signal,
        fixtures,
      );
      await this.commitOutcome(
        initial.searchId,
        initial.generation,
        initial.queryRevision,
        outcome,
        0,
      );
    });
    await Promise.all(tasks);
    if (
      !this.current(initial.searchId, initial.generation, initial.queryRevision)
    )
      return;
    const session = this.session(initial.searchId);
    this.store.stabilizeResultOrder(initial.searchId);
    const hasResults = this.store.resultCount(initial.searchId) > 0;
    const laneProviders = session.providers.filter(
      (provider) => provider.lane === session.lane,
    );
    const failures = laneProviders.filter(
      (provider) => !["complete", "canceled"].includes(provider.state),
    );
    session.state = hasResults
      ? failures.length
        ? "partial-error"
        : "complete"
      : laneProviders.every((provider) => provider.state === "offline")
        ? "offline"
        : laneProviders.every(
              (provider) => provider.state === "budget-exhausted",
            )
          ? "budget-exhausted"
          : failures.length === laneProviders.length
            ? "error"
            : "empty";
    session.updatedAt = now();
    this.store.saveSearch(session);
    this.emit(this.progress(this.session(initial.searchId), true));
    this.running.delete(initial.searchId);
    this.requestIds.delete(initial.requestId);
  }
  private async fetchRoute(
    searchId: string,
    route: CompassRoute,
    cursor: string | undefined,
    priority: "visible" | "load-more" | "prefetch",
    signal: AbortSignal,
    fixtures: Map<CompassProviderId, CompassProviderAdapter> | null,
  ): Promise<ProviderOutcome> {
    const session = this.session(searchId);
    const adapters = fixtures ?? createCompassAdapters();
    const selected = adapters.get(route.provider);
    if (!selected)
      return {
        ...route,
        records: [],
        state: "error",
        error: `Compass provider ${route.provider} is unavailable.`,
      };
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify([
          route.provider,
          route.strategy,
          route.lane,
          session.fingerprint,
          cursor ?? "*",
        ]),
      )
      .digest("hex");
    const cached = this.store.getProviderCache(cacheKey);
    try {
      let providerPage;
      if (cached)
        providerPage = cached.payload as {
          records: CompassResult[];
          nextCursor?: string;
          attribution?: string;
        };
      else
        providerPage = await this.scheduler.schedule({
          provider: route.provider,
          searchId,
          strategy: route.strategy,
          fingerprint: session.fingerprint,
          cursor,
          filters: session.filters,
          priority,
          signal,
          run: (requestSignal) =>
            selected.search({
              query: session.plan,
              filters: session.filters,
              strategy: route.strategy,
              lane: route.lane,
              cursor,
              signal: requestSignal,
            }),
        });
      const attribution =
        providerPage.attribution ?? selected.descriptor.attribution;
      const records = (providerPage.records ?? []).map((record) => ({
        ...record,
        lane: record.lane ?? route.lane,
        downloadLinks: record.downloadLinks ?? [],
        provenance: record.provenance.map((entry) => ({
          ...entry,
          attribution: entry.attribution ?? attribution,
          metadataLicense:
            entry.metadataLicense ?? selected.descriptor.metadataLicense,
        })),
      }));
      if (!cached) {
        const stableCatalog = new Set<CompassProviderId>([
          "openlibrary",
          "doab",
          "oapen",
          "bnf",
          "internetarchive",
          "loc",
          "gallica",
        ]).has(route.provider);
        this.store.putProviderCache(
          cacheKey,
          route.provider,
          { records, nextCursor: providerPage.nextCursor, attribution },
          providerPage.nextCursor,
          session.plan.identifiers.length
            ? 30 * 24 * 60 * 60_000
            : stableCatalog
              ? 7 * 24 * 60 * 60_000
              : 24 * 60 * 60_000,
        );
      }
      const ranked = await this.rankResults(
        session,
        records,
        signal,
        Boolean(fixtures),
      );
      return {
        ...route,
        records: ranked,
        nextCursor: providerPage.nextCursor,
        attribution,
      };
    } catch (error) {
      const state: CompassProviderStatus["state"] =
        error instanceof CompassScheduleError
          ? error.state
          : error instanceof CompassProviderError && error.code === "rate-limit"
            ? "rate-limited"
            : (error instanceof CompassProviderError &&
                  error.code === "offline") ||
                /fetch failed|network|offline|ENOTFOUND|ECONN/i.test(
                  String(error),
                )
              ? "offline"
              : "error";
      return {
        ...route,
        records: [],
        error: clean(error instanceof Error ? error.message : error, 400),
        state,
        retryAt: Number((error as { retryAt?: number })?.retryAt) || undefined,
      };
    }
  }
  private async commitOutcome(
    searchId: string,
    generation: number,
    queryRevision: number,
    outcome: ProviderOutcome,
    offset: number,
  ): Promise<void> {
    const previous = this.commitChains.get(searchId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() =>
        this.commitOutcomeNow(
          searchId,
          generation,
          queryRevision,
          outcome,
          offset,
        ),
      );
    this.commitChains.set(searchId, current);
    try {
      await current;
    } finally {
      if (this.commitChains.get(searchId) === current)
        this.commitChains.delete(searchId);
    }
  }
  private async commitOutcomeNow(
    searchId: string,
    generation: number,
    queryRevision: number,
    outcome: ProviderOutcome,
    offset: number,
  ): Promise<void> {
    if (!this.current(searchId, generation, queryRevision)) return;
    const session = this.session(searchId);
    const status = session.providers.find(
      (entry) =>
        entry.provider === outcome.provider && entry.lane === outcome.lane,
    );
    if (status) {
      status.state = outcome.error ? (outcome.state ?? "error") : "complete";
      status.error = outcome.error;
      status.retryAt = outcome.retryAt;
      status.count += outcome.records.length;
      status.hasMore = Boolean(outcome.nextCursor);
      status.attribution = outcome.attribution;
    }
    const currentRoute = this.store.getRoute(
      searchId,
      outcome.provider,
      outcome.lane,
    );
    this.store.upsertRoute({
      searchId,
      provider: outcome.provider,
      strategy: outcome.strategy,
      lane: outcome.lane,
      cursor: outcome.nextCursor,
      page: (currentRoute?.page ?? 0) + 1,
      state: outcome.error ? (outcome.state ?? "error") : "complete",
    });
    if (outcome.records.length) {
      session.revision += 1;
      this.store.upsertResults(
        searchId,
        this.mergeResults(searchId, outcome.records),
        session.revision,
      );
    }
    session.state = "partial";
    session.updatedAt = now();
    this.store.saveSearch(session);
    const fresh = this.session(searchId);
    if (this.current(searchId, generation, queryRevision))
      this.emit(this.progress(fresh, false, outcome.error, offset));
  }
  private mergeResults(
    searchId: string,
    incoming: CompassResult[],
  ): CompassResult[] {
    const output: CompassResult[] = [];
    const normalize = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const same = (left: CompassResult, right: CompassResult) => {
      if (left.canonicalKey === right.canonicalKey) return true;
      const workSchemes = new Set(["doi", "isbn", "pmid", "pmcid", "arxiv"]);
      if (
        left.identifiers.some((id) =>
          workSchemes.has(id.scheme.toLocaleLowerCase()) && right.identifiers.some(
            (other) =>
              id.scheme.toLocaleLowerCase() ===
                other.scheme.toLocaleLowerCase() &&
              normalizeIdentifier(id.scheme, id.value) ===
                normalizeIdentifier(other.scheme, other.value),
          ),
        )
      )
        return true;
      const enough =
        left.title &&
        right.title &&
        (left.authors[0]?.name || right.authors[0]?.name) &&
        (left.issuedYear || right.issuedYear);
      return Boolean(
        enough &&
        normalize(left.title) === normalize(right.title) &&
        (!left.authors[0]?.name ||
          !right.authors[0]?.name ||
          normalize(left.authors[0].name) ===
            normalize(right.authors[0].name)) &&
        (!left.issuedYear ||
          !right.issuedYear ||
          Math.abs(left.issuedYear - right.issuedYear) <= 1) &&
        left.type === right.type,
      );
    };
    const merge = (
      existing: CompassResult,
      candidate: CompassResult,
    ): CompassResult => ({
      ...existing,
      ...candidate,
      canonicalKey: existing.canonicalKey,
      title: existing.title || candidate.title,
      abstract: candidate.abstract ?? existing.abstract,
      authors: candidate.authors.length ? candidate.authors : existing.authors,
      issuedDate: candidate.issuedDate ?? existing.issuedDate,
      issuedYear: candidate.issuedYear ?? existing.issuedYear,
      language: candidate.language ?? existing.language,
      venue: candidate.venue ?? existing.venue,
      landingUrl: candidate.landingUrl ?? existing.landingUrl,
      doiUrl: candidate.doiUrl ?? existing.doiUrl,
      rights: candidate.rights ?? existing.rights,
      openAccess: candidate.openAccess ?? existing.openAccess,
      digitallyAvailable:
        existing.digitallyAvailable || candidate.digitallyAvailable,
      identifiers: [...existing.identifiers, ...candidate.identifiers].filter(
        (id, index, all) =>
          all.findIndex(
            (other) =>
              other.scheme.toLocaleLowerCase() ===
                id.scheme.toLocaleLowerCase() &&
              normalizeIdentifier(id.scheme, id.value) ===
                normalizeIdentifier(other.scheme, other.value),
          ) === index,
      ),
      provenance: [...existing.provenance, ...candidate.provenance].filter(
        (entry, index, all) =>
          all.findIndex(
            (other) =>
              other.provider === entry.provider &&
              other.providerId === entry.providerId,
          ) === index,
      ),
      downloadLinks: [
        ...(existing.downloadLinks ?? []),
        ...(candidate.downloadLinks ?? []),
      ].filter(
        (entry, index, all) =>
          all.findIndex((other) => other.url === entry.url) === index,
      ),
      providerRanks: { ...existing.providerRanks, ...candidate.providerRanks },
      reasons: [...existing.reasons, ...candidate.reasons].filter(
        (entry, index, all) =>
          all.findIndex(
            (other) => other.code === entry.code && other.value === entry.value,
          ) === index,
      ),
    });
    for (const candidate of incoming) {
      const local = output.findIndex((entry) => same(entry, candidate));
      if (local >= 0) {
        output[local] = merge(output[local], candidate);
        continue;
      }
      const persisted =
        this.store.getResult(searchId, candidate.canonicalKey) ??
        this.store.findResultByIdentity(
          searchId,
          candidate.identifiers,
          candidate.title,
          candidate.issuedYear,
          candidate.authors[0]?.name,
        );
      output.push(persisted ? merge(persisted, candidate) : candidate);
    }
    return output;
  }

  async loadMore(
    searchId: string,
    requestId: string,
    generation: number,
    offset = 0,
  ): Promise<CompassSearchResponse> {
    const pageOffset = Math.max(0, Math.floor(offset / 25) * 25);
    const key = `${searchId}:${requestId}:${generation}:${pageOffset}`;
    const existing = this.loadMoreTasks.get(key);
    if (existing) return existing;
    const task = this.loadMoreOnce(searchId, requestId, generation, pageOffset);
    this.loadMoreTasks.set(key, task);
    try {
      return await task;
    } finally {
      this.loadMoreTasks.delete(key);
    }
  }
  private async loadMoreOnce(
    searchId: string,
    requestId: string,
    generation: number,
    offset: number,
  ): Promise<CompassSearchResponse> {
    let session = this.session(searchId);
    if (session.requestId !== requestId || session.generation !== generation)
      throw new Error("Compass search generation is stale.");
    const existing = this.store.listResults(searchId, offset, 25);
    if (existing.length === 25)
      return {
        session,
        results: existing,
        resultsOffset: offset,
        hasMore:
          session.resultCount > offset + 25 ||
          session.providers.some((provider) => provider.lane === session.lane && provider.hasMore),
      };
    let running = this.running.get(searchId);
    if (!running || running.controller.signal.aborted) {
      running = {
        controller: new AbortController(),
        generation: session.generation,
        queryRevision: session.queryRevision,
      };
      this.running.set(searchId, running);
    }
    const fixtures = fixtureAdapters();
    for (const route of this.store
      .listRoutes(searchId)
      .filter((entry) => entry.lane === session.lane && Boolean(entry.cursor))) {
      if (!this.current(searchId, session.generation, session.queryRevision))
        break;
      const outcome = await this.fetchRoute(
        searchId,
        route,
        route.cursor,
        "load-more",
        running.controller.signal,
        fixtures,
      );
      await this.commitOutcome(
        searchId,
        session.generation,
        session.queryRevision,
        outcome,
        offset,
      );
      if (this.store.listResults(searchId, offset, 25).length === 25) break;
    }
    session = this.session(searchId);
    const results = this.store.listResults(searchId, offset, 25);
    const hasMore =
      session.resultCount > offset + results.length ||
      session.providers.some((provider) => provider.lane === session.lane && provider.hasMore);
    session.state =
      results.length || session.resultCount
        ? session.providers.some((provider) => provider.lane === session.lane &&
            [
              "error",
              "offline",
              "rate-limited",
              "budget-exhausted",
              "temporarily-disabled",
            ].includes(provider.state),
          )
          ? "partial-error"
          : "complete"
        : "empty";
    session.updatedAt = now();
    this.store.saveSearch(session);
    if (!hasMore) this.running.delete(searchId);
    return {
      session: this.session(searchId),
      results,
      resultsOffset: offset,
      hasMore,
    };
  }
  cancel(searchId?: string, requestId?: string): void {
    if (requestId) this.pendingInterpretations.get(requestId)?.abort();
    if (!searchId) return;
    const running = this.running.get(searchId);
    if (running) running.controller.abort();
    const session = this.store.getSearch(searchId);
    if (session) {
      session.state = "canceled";
      session.updatedAt = now();
      for (const status of session.providers)
        if (status.state === "queued" || status.state === "searching")
          status.state = "canceled";
      this.store.saveSearch(session);
      this.emit(this.progress(session, true));
    }
    this.running.delete(searchId);
  }
  get(searchId: string): CompassSearchResponse | null {
    const session = this.store.getSearch(searchId);
    if (!session) return null;
    const results = this.store.listResults(searchId, 0, 25);
    return {
      session,
      results,
      resultsOffset: 0,
      hasMore:
        session.resultCount > results.length ||
        session.providers.some((provider) => provider.lane === session.lane && provider.hasMore),
    };
  }
  detail(searchId: string, key: string): CompassResult | null {
    const result = this.store.getResult(clean(searchId, 200), clean(key, 200));
    return result
      ? {
          ...result,
          hasDownloadableFile: result.downloadLinks.some((link) => link.open),
        }
      : null;
  }
  listResults(
    searchId: string,
    offset = 0,
    limit = 25,
  ): CompassResultSummary[] {
    return this.store.listResults(
      clean(searchId, 200),
      Math.max(0, offset),
      Math.min(25, limit),
    );
  }
  updateView(request: CompassViewRequest): CompassSearchResponse {
    const session = this.session(clean(request.searchId, 200));
    if (
      session.requestId !== clean(request.requestId, 160) ||
      session.generation !== Number(request.generation) ||
      Number(request.viewRevision) <= session.viewRevision
    )
      throw new Error("Compass view revision is stale.");
    const lane = request.lane === "primary" ? "primary" : "scholarly";
    this.store.updateView(
      session.searchId,
      lane,
      normalizeFilters(request.filters, lane),
      Number(request.viewRevision),
    );
    let fresh = this.session(session.searchId);
    const existingRoutes = this.store.listRoutes(session.searchId);
    const laneRoutes = existingRoutes.filter((route) => route.lane === lane);
    if (!laneRoutes.length) {
      const routes = routeCompassRequests({
        ...session.plan,
        mode: "search",
        lane,
        providers: [],
      }).filter((route) => route.lane === lane);
      for (const route of routes) {
        this.store.upsertRoute({
          searchId: session.searchId,
          ...route,
          page: 0,
          state: "queued",
        });
        if (!fresh.providers.some((status) => status.provider === route.provider && status.lane === route.lane))
          fresh.providers.push({
            provider: route.provider,
            state: "queued",
            count: 0,
            hasMore: false,
            strategy: route.strategy,
            lane: route.lane,
          });
      }
      if (routes.length) {
        this.running.get(session.searchId)?.controller.abort();
        const controller = new AbortController();
        this.running.set(session.searchId, {
          controller,
          generation: session.generation,
          queryRevision: session.queryRevision,
        });
        fresh.state = "searching";
        fresh.updatedAt = now();
        this.store.saveSearch(fresh);
        void this.fetchInitial(fresh, routes, controller, fixtureAdapters()).catch(
          (error) => this.finishError(session.searchId, error),
        );
        fresh = this.session(session.searchId);
      }
    }
    const offset = Math.max(
      0,
      Math.floor(Number(request.offset ?? 0) / 25) * 25,
    );
    const results = this.store.listResults(session.searchId, offset, 25);
    return {
      session: fresh,
      results,
      resultsOffset: offset,
      hasMore:
        fresh.resultCount > offset + results.length ||
        fresh.providers.some((provider) => provider.lane === fresh.lane && provider.hasMore),
    };
  }
  async retryProvider(
    searchId: string,
    provider: CompassProviderId,
  ): Promise<CompassSearchResponse> {
    const session = this.session(clean(searchId, 200));
    const route = this.store
      .listRoutes(session.searchId)
      .find((entry) => entry.provider === provider && entry.lane === session.lane);
    if (!route) throw new Error("Compass provider is not part of this search.");
    const usage = this.store.getProviderUsage(provider);
    if (usage) {
      usage.consecutiveFailures = 0;
      usage.circuitUntil = undefined;
      usage.retryAt = undefined;
      this.store.saveProviderUsage(usage);
    }
    let running = this.running.get(session.searchId);
    if (!running) {
      running = {
        controller: new AbortController(),
        generation: session.generation,
        queryRevision: session.queryRevision,
      };
      this.running.set(session.searchId, running);
    }
    const outcome = await this.fetchRoute(
      session.searchId,
      route,
      route.cursor,
      "visible",
      running.controller.signal,
      fixtureAdapters(),
    );
    await this.commitOutcome(
      session.searchId,
      session.generation,
      session.queryRevision,
      outcome,
      0,
    );
    return this.get(session.searchId)!;
  }
  async retrySearch(searchId: string): Promise<CompassSearchResponse> {
    const session = this.session(clean(searchId, 200));
    const retryable = session.providers.filter(
      (status) =>
        status.lane === session.lane &&
        ["error", "offline", "rate-limited", "budget-exhausted", "temporarily-disabled", "canceled"].includes(status.state),
    );
    await Promise.all(
      retryable.map((status) => this.retryProvider(session.searchId, status.provider)),
    );
    return this.get(session.searchId)!;
  }
  history(limit = 50): CompassSearchSession[] {
    return this.store.listHistory(limit);
  }
  deleteHistory(id: string): void {
    this.cancel(id);
    this.store.deleteSearch(clean(id, 200));
  }
  clearHistory(): void {
    for (const id of this.running.keys()) this.cancel(id);
    this.store.clearHistory();
  }
  save(searchId: string, key: string): void {
    this.store.saveCandidate(clean(searchId, 200), clean(key, 200));
  }
  saved(limit = 100): CompassResultSummary[] {
    return this.store.listSavedCandidates(limit);
  }
  dismiss(searchId: string, key: string): void {
    this.store.dismissCandidate(clean(searchId, 200), clean(key, 200));
  }
  restore(searchId: string, key: string): void {
    this.store.restoreCandidate(clean(searchId, 200), clean(key, 200));
  }
  setSelection(searchId: string, keys: string[], revision: number): void {
    this.store.setSelection(
      clean(searchId, 200),
      keys.map((key) => clean(key, 200)).filter(Boolean),
      Math.max(0, revision),
    );
  }
  selectRange(request: CompassRangeSelectionRequest): string[] {
    return this.store.selectRange(
      clean(request.searchId, 200),
      Math.max(0, request.from),
      Math.max(request.from, request.to),
      request.selected,
      Math.max(0, request.revision),
    );
  }
  selection(searchId: string): string[] {
    return this.store.selectedKeys(clean(searchId, 200));
  }
  providerStatus(): CompassProviderStatus[] {
    return listProviderDescriptors().map((descriptor) => {
      const usage = this.store.getProviderUsage(descriptor.id);
      const stamp = now();
      const state: CompassProviderStatus["state"] =
        usage?.circuitUntil && usage.circuitUntil > stamp
          ? "temporarily-disabled"
          : descriptor.id === "openalex" &&
              usage?.dailyUsed != null &&
              usage.dailyUsed >= 60
            ? "budget-exhausted"
            : "idle";
      return {
        provider: descriptor.id,
        state,
        count: 0,
        hasMore: false,
        retryAt: usage?.retryAt ?? usage?.circuitUntil,
        attribution: descriptor.attribution,
        lane: descriptor.capabilities.lanes[0],
      };
    });
  }

  async import(
    request: CompassImportRequest,
    ownerWebContentsId?: number,
  ): Promise<CompassImportJob> {
    const keys =
      request.selection === "stored"
        ? this.store.selectedKeys(request.searchId)
        : (request.selection?.canonicalKeys ?? []);
    const normalized = [
      ...new Set(keys.map((key) => clean(key, 200)).filter(Boolean)),
    ].slice(0, 10_000);
    if (!normalized.length)
      throw new Error("Select at least one Compass result.");
    if (normalized.some((key) => !this.store.getResult(request.searchId, key)))
      throw new Error("Compass selection contains unavailable results.");
    const job: CompassImportJob = {
      jobId: `compass-import-${randomUUID()}`,
      searchId: clean(request.searchId, 200),
      selectionRevision: Math.max(0, request.selectionRevision),
      selectedKeys: normalized,
      collectionIds: (request.collectionIds ?? [])
        .map((id) => clean(id, 200))
        .filter(Boolean)
        .slice(0, 100),
      state: "running",
      total: normalized.length,
      completed: 0,
      failed: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.store.createImportJob(job);
    if (ownerWebContentsId != null)
      this.claimImport(job.jobId, ownerWebContentsId);
    const controller = new AbortController();
    this.importControllers.set(job.jobId, controller);
    this.emitImport({ job, items: this.store.listImportItems(job.jobId) });
    this.trackImportTask(job.jobId, this.runLibraryImport(job, controller));
    return job;
  }
  private trackImportTask(jobId: string, task: Promise<void>): void {
    this.importTasks.set(jobId, task);
    void task.finally(() => {
      if (this.importTasks.get(jobId) === task) this.importTasks.delete(jobId);
      this.importControllers.delete(jobId);
    });
  }
  private libraryCandidate(result: CompassResult): LibraryCompassCandidate {
    return {
      canonicalKey: result.canonicalKey,
      metadata: this.libraryMetadata(result),
      provider: result.provenance[0]?.provider,
      providerId: result.provenance[0]?.providerId,
      provenance: result.provenance,
      sourceIdentities: result.provenance.map((source) => ({
        source: "compass",
        libraryType: "import",
        libraryId: source.provider,
        itemKey: source.providerId,
      })),
    };
  }
  private async runLibraryImport(
    job: CompassImportJob,
    controller: AbortController,
  ): Promise<void> {
    try {
      const library = await import("../library/libraryService");
      const results = job.selectedKeys
        .map((key) => this.store.getResult(job.searchId, key))
        .filter((entry): entry is CompassResult => Boolean(entry));
      const report = await library.startGlobalLibraryCompassImport(
        job.jobId,
        results.map((entry) => this.libraryCandidate(entry)),
        job.collectionIds,
        (progress) => {
          const current = this.store.getImportJob(job.jobId);
          if (!current) return;
          current.completed = progress.completed;
          current.failed = progress.failed;
          current.updatedAt = now();
          this.store.updateImportJob(current);
          this.emitImport({
            job: current,
            items: this.store.listImportItems(job.jobId),
          });
        },
      );
      const itemIds = new Map<string, string>();
      for (const item of report.items) {
        this.store.updateImportItem({
          jobId: job.jobId,
          canonicalKey: item.canonicalKey,
          state: item.state,
          libraryItemId: item.itemId,
          error: item.error,
        });
        if (item.itemId) itemIds.set(item.canonicalKey, item.itemId);
      }
      if (!controller.signal.aborted)
        await this.runDownloads(
          job,
          results,
          itemIds,
          controller.signal,
          library,
        );
      const current = this.store.getImportJob(job.jobId);
      if (!current) return;
      const items = this.store.listImportItems(job.jobId);
      current.state = controller.signal.aborted
        ? "canceled"
        : items.some((item) => item.state === "failed")
          ? "failed"
          : "completed";
      current.completed = items.filter(
        (item) =>
          !["queued", "checking", "downloading", "failed", "canceled"].includes(
            item.state,
          ),
      ).length;
      current.failed = items.filter((item) => item.state === "failed").length;
      current.updatedAt = now();
      this.store.updateImportJob(current);
      this.emitImport({ job: current, items });
    } catch (error) {
      const current = this.store.getImportJob(job.jobId);
      if (!current) return;
      const message = clean(
        error instanceof Error ? error.message : error,
        400,
      );
      for (const item of this.store
        .listImportItems(job.jobId)
        .filter((item) =>
          ["queued", "checking", "downloading"].includes(item.state),
        ))
        this.store.updateImportItem({
          ...item,
          state: controller.signal.aborted ? "canceled" : "failed",
          error: controller.signal.aborted ? "Canceled" : message,
        });
      current.state = controller.signal.aborted ? "canceled" : "failed";
      current.failed = controller.signal.aborted
        ? current.failed
        : current.total;
      current.updatedAt = now();
      this.store.updateImportJob(current);
      this.emitImport({
        job: current,
        items: this.store.listImportItems(job.jobId),
      });
    }
  }
  private async runDownloads(
    job: CompassImportJob,
    results: CompassResult[],
    itemIds: Map<string, string>,
    signal: AbortSignal,
    library: typeof import("../library/libraryService"),
  ): Promise<void> {
    const batchLimit = 512 * 1024 * 1024;
    const fileLimit = 64 * 1024 * 1024;
    let batchBytes = 0;
    let batchGate = Promise.resolve();
    const withBatchLock = async <T>(action: () => T): Promise<T> => {
      const previous = batchGate;
      let release!: () => void;
      batchGate = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return action(); } finally { release(); }
    };
    const libraryRoot = library.getGlobalLibrarySyncSnapshot()?.root;
    const ensureFreeSpace = (target: string) => {
      const free = fs.statfsSync(target);
      if (Number(free.bavail) * Number(free.bsize) < 80 * 1024 * 1024)
        throw new Error("Insufficient free space for an open file download.");
    };
    const attachmentByHash = (sha256: string): { file: string } | undefined => {
      for (const item of library.getGlobalLibrarySyncSnapshot()?.items ?? []) {
        const attachment = item.attachments.find((entry) => entry.sha256 === sha256);
        if (!attachment) continue;
        try {
          const file = library.globalLibraryAttachmentPath(item.id, attachment.id);
          if (fs.existsSync(file)) return { file };
        } catch { /* stale catalogue entry; keep looking */ }
      }
      return undefined;
    };
    const commitAttachment = async (itemId: string, sha256: string, downloadedFile?: string) =>
      this.withAttachmentCommitLock(async () => {
        const current = library
          .getGlobalLibraryItem(itemId)
          ?.attachments.find((attachment) => attachment.sha256 === sha256);
        if (current) return current;
        const reusable = attachmentByHash(sha256);
        const source = reusable?.file ?? downloadedFile;
        if (!source || !fs.existsSync(source)) return undefined;
        const updated = await library.addGlobalLibraryAttachments(itemId, [source]);
        const attachment = updated.attachments.find((entry) => entry.sha256 === sha256);
        if (attachment && reusable) {
          const destination = library.globalLibraryAttachmentPath(itemId, attachment.id);
          deduplicateFileByHardLink(reusable.file, destination);
        }
        return attachment;
      });
    const queue = results.filter((result) => itemIds.has(result.canonicalKey));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !signal.aborted) {
        const result = queue[cursor++];
        const itemId = itemIds.get(result.canonicalKey)!;
        const link = this.preferredDownload(result);
        if (!link) {
          this.store.updateImportItem({
            jobId: job.jobId,
            canonicalKey: result.canonicalKey,
            state: "no-file",
            libraryItemId: itemId,
          });
          continue;
        }
        this.store.setImportDownloadSource(job.jobId, result.canonicalKey, {
          ...link,
          license: link.license ?? result.openAccess?.license,
          rights: link.rights ?? result.rights,
        });
        const priorDownload = this.store.findAttachedDownloadByUrl(link.url);
        const currentAttachment = priorDownload
          ? library
              .getGlobalLibraryItem(itemId)
              ?.attachments.find(
                (attachment) => attachment.sha256 === priorDownload.sha256,
              )
          : undefined;
        if (priorDownload && currentAttachment) {
          this.store.updateImportItem({
            jobId: job.jobId,
            canonicalKey: result.canonicalKey,
            state: "attached",
            libraryItemId: itemId,
            attachmentId: currentAttachment.id,
            bytes: priorDownload.bytes,
            sha256: priorDownload.sha256,
          });
          continue;
        }
        if (priorDownload) {
          const attachment = await commitAttachment(itemId, priorDownload.sha256);
          if (attachment) {
            this.store.updateImportItem({
              jobId: job.jobId,
              canonicalKey: result.canonicalKey,
              state: "attached",
              libraryItemId: itemId,
              attachmentId: attachment?.id,
              bytes: priorDownload.bytes,
              sha256: priorDownload.sha256,
            });
            continue;
          }
        }
        this.store.updateImportItem({
          jobId: job.jobId,
          canonicalKey: result.canonicalKey,
          state: "downloading",
          libraryItemId: itemId,
        });
        this.emitImport({
          job: this.store.getImportJob(job.jobId)!,
          items: this.store.listImportItems(job.jobId),
        });
        let temporary: string | undefined;
        let reservedBytes = 0;
        let reservationFinalized = false;
        try {
          ensureFreeSpace(os.tmpdir());
          if (libraryRoot) ensureFreeSpace(libraryRoot);
          const fetched = await fetchPublicResource(link.url, {
            maxBytes: fileLimit,
            timeoutMs: 30_000,
            signal,
            accept:
              result.lane === "scholarly"
                ? "application/pdf,application/epub+zip;q=0.9"
                : "image/*,application/pdf,audio/*,video/*;q=0.9",
          });
          const declared = Number(
            fetched.response.headers.get("content-length") ?? 0,
          );
          reservedBytes = declared > 0 ? declared : fileLimit;
          const reserved = await withBatchLock(() => {
            if (batchBytes + reservedBytes > batchLimit) return false;
            batchBytes += reservedBytes;
            return true;
          });
          if (!reserved) {
            reservedBytes = 0;
            await fetched.response.body?.cancel();
            this.store.updateImportItem({
              jobId: job.jobId,
              canonicalKey: result.canonicalKey,
              state: "skipped-limit",
              libraryItemId: itemId,
            });
            continue;
          }
          const saved = await responseToTemporaryFile(
            fetched.response,
            {
              title: result.title,
              mimeType: link.mediaType,
              url: fetched.finalUrl,
            },
            { prefix: "nodus-compass-", maxBytes: fileLimit },
          );
          temporary = saved.dir;
          const bytes = fs.statSync(saved.file).size;
          const adjusted = await withBatchLock(() => {
            const withoutReservation = batchBytes - reservedBytes;
            if (withoutReservation + bytes > batchLimit) {
              batchBytes = withoutReservation;
              return false;
            }
            batchBytes = withoutReservation + bytes;
            reservationFinalized = true;
            return true;
          });
          if (!adjusted) {
            reservedBytes = 0;
            this.store.updateImportItem({
              jobId: job.jobId,
              canonicalKey: result.canonicalKey,
              state: "skipped-limit",
              libraryItemId: itemId,
              bytes,
            });
            continue;
          }
          this.validateDownloadedFile(
            saved.file,
            result.lane,
            fetched.response.headers.get("content-type") ?? link.mediaType,
          );
          const sha256 = createHash("sha256")
            .update(fs.readFileSync(saved.file))
            .digest("hex");
          const attachment = await commitAttachment(itemId, sha256, saved.file);
          if (!attachment) throw new Error("The downloaded attachment could not be committed.");
          this.store.updateImportItem({
            jobId: job.jobId,
            canonicalKey: result.canonicalKey,
            state: "attached",
            libraryItemId: itemId,
            attachmentId: attachment?.id,
            bytes,
            sha256,
          });
        } catch (error) {
          this.store.updateImportItem({
            jobId: job.jobId,
            canonicalKey: result.canonicalKey,
            state: signal.aborted ? "canceled" : "failed",
            libraryItemId: itemId,
            error: clean(error instanceof Error ? error.message : error, 400),
          });
        } finally {
          if (reservedBytes && !reservationFinalized)
            await withBatchLock(() => { batchBytes = Math.max(0, batchBytes - reservedBytes); });
          if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (signal.aborted)
      for (const result of queue.slice(cursor))
        this.store.updateImportItem({
          jobId: job.jobId,
          canonicalKey: result.canonicalKey,
          state: "canceled",
          libraryItemId: itemIds.get(result.canonicalKey),
          error: "Canceled",
        });
  }
  private preferredDownload(result: CompassResult) {
    const links = (result.downloadLinks ?? []).filter(
      (link) => link.open && link.url.startsWith("https://"),
    );
    if (result.lane === "scholarly")
      return (
        links.find((link) =>
          /pdf/i.test(`${link.mediaType} ${link.format} ${link.url}`),
        ) ??
        links.find((link) =>
          /epub/i.test(`${link.mediaType} ${link.format} ${link.url}`),
        )
      );
    return links.find((link) =>
      /image|pdf|audio|video/i.test(
        `${link.mediaType} ${link.format} ${link.url}`,
      ),
    );
  }
  private validateDownloadedFile(
    file: string,
    lane: CompassLane,
    declared?: string | null,
  ): void {
    const mime = clean(declared, 120).split(";")[0].toLocaleLowerCase();
    const header = fs.readFileSync(file).subarray(0, 32);
    const pdf = header.includes(Buffer.from("%PDF-"));
    const zip = header[0] === 0x50 && header[1] === 0x4b;
    const image =
      header
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ) ||
      (header[0] === 0xff && header[1] === 0xd8) ||
      header.toString("ascii", 0, 6).match(/GIF8[79]a/);
    const audioVideo =
      header.toString("ascii", 0, 3) === "ID3" ||
      (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) ||
      (header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WAVE") ||
      header.toString("ascii", 0, 4) === "fLaC" ||
      header.toString("ascii", 0, 4) === "OggS" ||
      header.toString("ascii", 4, 8) === "ftyp" ||
      header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (lane === "scholarly" && !(pdf || (zip && /epub|zip/.test(mime))))
      throw new Error("The open file did not match a PDF or EPUB signature.");
    if (
      lane === "primary" &&
      !(
        pdf ||
        image ||
        (audioVideo && (/^audio\//.test(mime) || /^video\//.test(mime)))
      )
    )
      throw new Error(
        "The primary-source file type or header is not supported.",
      );
  }
  private libraryMetadata(result: CompassResult): LibraryItemMetadata {
    const creators: LibraryCreator[] = result.authors.map((author) =>
      author.family || author.given
        ? {
            creatorType: "author",
            firstName: author.given,
            lastName: author.family,
            name: author.name,
          }
        : { creatorType: "author", name: author.name },
    );
    const itemTypes: Partial<Record<CompassPublicationType, LibraryItemType>> =
      {
        article: "article-journal",
        book: "book",
        chapter: "book-chapter",
        thesis: "thesis",
        report: "report",
        dataset: "dataset",
        preprint: "preprint",
        photograph: "artwork",
        newspaper: "newspaper-article",
        map: "map",
        manuscript: "manuscript",
        audio: "audio-recording",
        video: "video-recording",
        "archive-item": "document",
      };
    const id = (scheme: string) =>
      result.identifiers.find(
        (entry) => entry.scheme.toLocaleLowerCase() === scheme,
      )?.value;
    return {
      title: result.title,
      itemType: itemTypes[result.type] ?? "document",
      creators,
      abstract: result.abstract,
      date: result.issuedDate,
      year: result.issuedYear ?? null,
      language: result.language,
      publisher: result.publisher,
      publicationTitle: result.venue,
      url: result.landingUrl,
      doi: id("doi"),
      pmid: id("pmid"),
      pmcid: id("pmcid"),
      arxiv: id("arxiv"),
      isbn: result.identifiers
        .filter((entry) => entry.scheme === "isbn")
        .map((entry) => entry.value),
      issn: result.identifiers
        .filter((entry) => entry.scheme === "issn")
        .map((entry) => entry.value),
      rights: result.rights ?? result.openAccess?.license,
      extra: {
        compassCanonicalKey: result.canonicalKey,
        compassProviders: result.provenance
          .map((entry) => entry.provider)
          .join(","),
        compassLane: result.lane,
      },
    };
  }
  importProgress(jobId: string): CompassImportProgress | null {
    const job = this.store.getImportJob(clean(jobId, 200));
    return job ? { job, items: this.store.listImportItems(job.jobId) } : null;
  }
  cancelImport(jobId: string): void {
    const job = this.store.getImportJob(clean(jobId, 200));
    if (!job || ["completed", "failed", "canceled"].includes(job.state)) return;
    this.importControllers.get(job.jobId)?.abort();
    void import("../library/libraryService")
      .then((library) => library.cancelGlobalLibraryCompassImport(job.jobId))
      .catch(() => undefined);
    this.store.cancelPendingImportItems(job.jobId);
    job.state = "canceled";
    job.updatedAt = now();
    this.store.updateImportJob(job);
    this.emitImport({ job, items: this.store.listImportItems(job.jobId) });
  }
  retryImport(jobId: string): CompassImportJob {
    const job = this.store.getImportJob(clean(jobId, 200));
    if (!job) throw new Error("Compass import not found.");
    const previous = this.importTasks.get(job.jobId);
    job.state = "queued";
    job.completed = 0;
    job.failed = 0;
    job.updatedAt = now();
    this.store.updateImportJob(job);
    const task = (async () => {
      if (previous) await previous.catch(() => undefined);
      this.store.resetImportItems(job.jobId);
      const next = this.store.getImportJob(job.jobId);
      if (!next) return;
      next.state = "running";
      next.updatedAt = now();
      this.store.updateImportJob(next);
      const controller = new AbortController();
      this.importControllers.set(job.jobId, controller);
      await this.runLibraryImport(next, controller);
    })();
    this.trackImportTask(job.jobId, task);
    return job;
  }
  private finishError(searchId: string, error: unknown): void {
    const session = this.store.getSearch(searchId);
    if (!session) return;
    session.state = "error";
    session.updatedAt = now();
    this.store.saveSearch(session);
    this.emit(
      this.progress(
        session,
        true,
        clean(error instanceof Error ? error.message : error, 400),
      ),
    );
    this.running.delete(searchId);
  }
}

let singleton: CompassService | null = null;
export function compassService(): CompassService {
  if (!singleton) singleton = new CompassService();
  return singleton;
}
