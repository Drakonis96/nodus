import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "compass-search-cases.json",
);
// Keep the transient bundle below the repository so Node's normal package
// resolution can find the native better-sqlite3 dependency. It is removed by
// test.after and is never a repository artifact.
const temp = await mkdtemp(
  path.join(root, "scripts/fixtures/visual-tests/.tmp-compass-"),
);
const built = new Map();

async function load(entry, name, options = {}) {
  if (built.has(name)) return built.get(name);
  const outfile = path.join(temp, `${name}.mjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    logLevel: "silent",
    ...options,
  });
  const module = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);
  built.set(name, module);
  return module;
}

test.after(async () => {
  await rm(temp, { recursive: true, force: true });
});

test("the fixture catalogue contains the twenty required multilingual and failure searches", async () => {
  const cases = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(cases.length, 20);
  assert.ok(
    new Set(cases.map((item) => item.filters?.languages?.[0]).filter(Boolean))
      .size >= 4,
  );
  assert.ok(cases.some((item) => item.filters?.openAccessOnly));
  assert.ok(cases.some((item) => item.filters?.types?.includes("book")));
  assert.ok(
    cases.some((item) => item.filters?.providers?.includes("europepmc")),
  );
  assert.ok(cases.some((item) => item.failure?.status === 503));
});

test("natural-language interpretation extracts phrases, exclusions, years, languages, types, OA and identifiers", async () => {
  const { interpretCompassQuery } = await load(
    "electron/compass/compassQueryInterpreter.ts",
    "query",
  );
  const plan = interpretCompassQuery(
    '"open science" climate -predatory since 2020 language:fr type:thesis 10.1234/example',
  );
  assert.deepEqual(plan.exactPhrases, ["open science"]);
  assert.deepEqual(plan.excludedTerms, ["predatory"]);
  assert.equal(plan.fromYear, 2020);
  assert.deepEqual(plan.languages, ["fr"]);
  assert.deepEqual(plan.types, ["thesis"]);
  assert.equal(plan.openAccessOnly, false);
  assert.deepEqual(plan.identifiers, [
    { scheme: "doi", value: "10.1234/example" },
  ]);
  const oa = interpretCompassQuery("historia acceso abierto", {
    languages: ["es"],
    openAccessOnly: true,
  });
  assert.equal(oa.openAccessOnly, true);
  assert.deepEqual(oa.languages, ["es"]);
  const thematicYears = interpretCompassQuery("franquismo 1939–1975");
  assert.equal(thematicYears.fromYear, undefined);
  assert.equal(thematicYears.toYear, undefined);
  const publicationYears = interpretCompassQuery(
    "franquismo publicado entre 1939 y 1975",
  );
  assert.equal(publicationYears.fromYear, 1939);
  assert.equal(publicationYears.toYear, 1975);
  assert.deepEqual(
    interpretCompassQuery("fotografia de la Guerra Civil espanyola").languages,
    ["ca"],
  );
  assert.deepEqual(
    interpretCompassQuery("turismo e propaganda nas ditaduras ibéricas").languages,
    ["pt"],
  );
});

test("provider routing respects explicit selection and routes repository/type searches", async () => {
  const { routeCompassProviders } = await load(
    "electron/compass/compassRouter.ts",
    "router",
  );
  const { interpretCompassQuery } = await load(
    "electron/compass/compassQueryInterpreter.ts",
    "query-again",
  );
  const explicit = routeCompassProviders(
    interpretCompassQuery("topic", { providers: ["hal", "crossref", "hal"] }),
  );
  assert.deepEqual(explicit, ["hal", "crossref"]);
  const routed = routeCompassProviders(
    interpretCompassQuery("humanities repository type:thesis"),
  );
  assert.ok(routed.includes("hal") && routed.includes("openaire"));
  assert.ok(routed.includes("core") && routed.includes("openalex"));
  const books = routeCompassProviders(
    interpretCompassQuery("libros de historia idioma:español type:book"),
  );
  assert.ok(
    books.includes("doab") &&
      books.includes("oapen") &&
      books.includes("openlibrary") &&
      books.includes("bnf"),
  );
  const similar = interpretCompassQuery("source title and abstract");
  similar.mode = "similar";
  assert.deepEqual(routeCompassProviders(similar), [
    "openalex",
    "semanticscholar",
  ]);
});

test("provider helpers normalize compact metadata, cap pages and create stable identifiers", async () => {
  const { author, canonicalKey, page, result } = await load(
    "electron/compass/providers/provider.ts",
    "provider",
  );
  const record = result({
    provider: "crossref",
    providerId: "x-1",
    title: "  A   useful title ",
    authors: [author({ given: "Ada", family: "Lovelace" })].filter(Boolean),
    year: 2022,
    doi: "10.1000/test",
  });
  assert.equal(record.title, "A useful title");
  assert.deepEqual(record.authors[0], {
    name: "Ada Lovelace",
    given: "Ada",
    family: "Lovelace",
    orcid: undefined,
  });
  assert.equal(record.identifiers[0].scheme, "doi");
  assert.equal(record.doiUrl, "https://doi.org/10.1000/test");
  const many = Array.from({ length: 40 }, (_, i) =>
    result({
      provider: "openalex",
      providerId: String(i),
      title: `Title ${i}`,
    }),
  );
  const first = page(many, "openalex", "cursor-2");
  assert.equal(first.records.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "cursor-2");
  // DOI identity is case-insensitive at the persistence boundary. This also
  // protects callers that build canonical keys before the store's identity index.
  assert.equal(
    canonicalKey([{ scheme: "doi", value: "10.1000/ABC" }], "Title"),
    canonicalKey([{ scheme: "doi", value: "10.1000/abc" }], "Title"),
  );
  assert.notEqual(
    canonicalKey([{ scheme: "issn", value: "1234-5678" }], "First article", "Ada", 2020),
    canonicalKey([{ scheme: "issn", value: "1234-5678" }], "Second article", "Ada", 2020),
  );
  assert.equal(
    result({ provider: "crossref", providerId: "bad-url", title: "Safe", url: "javascript:alert(1)" }).landingUrl,
    undefined,
  );
});

test("public download validation rejects complete loopback and reserved ranges", async () => {
  const { isPrivateAddress } = await load(
    "electron/network/publicDownload.ts",
    "public-download",
    { external: ["undici"] },
  );
  for (const address of [
    "127.0.0.2", "0.0.0.1", "::ffff:127.1.2.3", "::ffff:7f00:2",
    "::ffff:a00:1", "::ffff:c0a8:101", "[::1]", "169.254.1.1", "224.0.0.1",
  ])
    assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress("1.1.1.1"), false);
});

test("equal attachment files are coalesced to one inode", async () => {
  const { deduplicateFileByHardLink } = await load(
    "electron/compass/attachmentDedup.ts",
    "attachment-dedup",
  );
  const folder = await mkdtemp(path.join(temp, "attachment-dedup-"));
  const source = path.join(folder, "source.pdf");
  const destination = path.join(folder, "destination.pdf");
  await writeFile(source, "%PDF-1.7\nshared bytes", "utf8");
  await writeFile(destination, "%PDF-1.7\nshared bytes", "utf8");
  assert.equal(deduplicateFileByHardLink(source, destination), true);
  const [sourceStat, destinationStat] = await Promise.all([stat(source), stat(destination)]);
  assert.equal(sourceStat.dev, destinationStat.dev);
  assert.equal(sourceStat.ino, destinationStat.ino);
});

test("adapter pagination and transient provider failures are cancellable and retryable", async () => {
  const { createCompassAdapters } = await load(
    "electron/compass/providers/adapters.ts",
    "adapters",
  );
  const { requestJson } = await load(
    "electron/compass/providers/provider.ts",
    "provider-retry",
  );
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1)
        return new Response("{}", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W1",
              title: "Fixture paper",
              publication_year: 2024,
            },
          ],
          meta: { next_cursor: "next" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const adapters = createCompassAdapters();
    assert.deepEqual(
      new Set(adapters.keys()),
      new Set([
        "openalex",
        "core",
        "doaj",
        "openaire",
        "openlibrary",
        "doab",
        "oapen",
        "bnf",
        "hal",
        "datacite",
        "zenodo",
        "europepmc",
        "arxiv",
        "dblp",
        "semanticscholar",
        "internetarchive",
        "loc",
        "gallica",
        "crossref",
        "opencitations",
      ]),
    );
    const pageResult = await adapters
      .get("openalex")
      .search({
        query: {
          text: "fixture",
          exactPhrases: [],
          excludedTerms: [],
          authors: [],
          venues: [],
          identifiers: [],
          languages: [],
          types: [],
          disciplines: [],
          concepts: [],
          expressions: {
            strict: "fixture",
            balanced: "fixture",
            semantic: "fixture",
            conceptPairs: [],
          },
          openAccessOnly: false,
          providers: [],
          lane: "scholarly",
        },
        filters: {},
        strategy: "balanced",
        lane: "scholarly",
        signal: new AbortController().signal,
      });
    assert.equal(pageResult.records.length, 1);
    assert.equal(pageResult.nextCursor, "next");
    assert.equal(calls, 2);

    const controller = new AbortController();
    globalThis.fetch = (_url, init = {}) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    const pending = requestJson(
      "https://example.invalid/slow",
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, /Abort|aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request scheduler enforces global, per-search and per-provider concurrency", async () => {
  const { CompassRequestScheduler } = await load(
    "electron/compass/compassRequestScheduler.ts",
    "scheduler",
  );
  const usage = new Map();
  const scheduler = new CompassRequestScheduler({
    getProviderUsage: (provider) => usage.get(provider) ?? null,
    saveProviderUsage: (entry) => usage.set(entry.provider, { ...entry }),
  });
  let active = 0;
  let maxActive = 0;
  const bySearch = new Map();
  const byProvider = new Map();
  const maxBySearch = new Map();
  const maxByProvider = new Map();
  const providers = [
    "crossref",
    "bnf",
    "opencitations",
    "oapen",
    "crossref",
    "bnf",
    "hal",
    "openaire",
  ];
  const tasks = providers.map((provider, index) => {
    const searchId = `search-${index % 2}`;
    return scheduler.schedule({
      provider,
      searchId,
      strategy: "balanced",
      fingerprint: `fixture-${index}`,
      filters: {},
      signal: new AbortController().signal,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        bySearch.set(searchId, (bySearch.get(searchId) ?? 0) + 1);
        byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
        maxBySearch.set(
          searchId,
          Math.max(maxBySearch.get(searchId) ?? 0, bySearch.get(searchId)),
        );
        maxByProvider.set(
          provider,
          Math.max(maxByProvider.get(provider) ?? 0, byProvider.get(provider)),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        bySearch.set(searchId, bySearch.get(searchId) - 1);
        byProvider.set(provider, byProvider.get(provider) - 1);
        return { provider, records: [], hasMore: false };
      },
    });
  });
  await Promise.all(tasks);
  assert.ok(
    maxActive <= 4,
    `global concurrency is capped at four (${maxActive})`,
  );
  assert.ok(
    [...maxBySearch.values()].every((value) => value <= 3),
    `per-search concurrency is capped at three (${JSON.stringify([...maxBySearch])})`,
  );
  assert.ok(
    [...maxByProvider.values()].every((value) => value <= 1),
    `per-provider concurrency is capped at one (${JSON.stringify([...maxByProvider])})`,
  );

  let sharedRuns = 0;
  const firstController = new AbortController();
  const secondController = new AbortController();
  const sharedInput = {
    provider: "crossref",
    searchId: "coalesced",
    strategy: "balanced",
    fingerprint: "same-request",
    filters: {},
  };
  const first = scheduler.schedule({
    ...sharedInput,
    signal: firstController.signal,
    run: async (signal) => {
      sharedRuns += 1;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
      return { provider: "crossref", records: [], hasMore: false };
    },
  });
  const second = scheduler.schedule({
    ...sharedInput,
    signal: secondController.signal,
    run: async () => {
      throw new Error("coalescing should run only the first physical request");
    },
  });
  firstController.abort();
  await assert.rejects(first, /Abort|aborted/i);
  assert.equal((await second).provider, "crossref");
  assert.equal(sharedRuns, 1);
});

test("CompassStore persists pagination, selections, saved/dismissed records and bounded cache state", async (t) => {
  process.env.NODUS_TEST_USERDATA = temp;
  const electronStub = path.join(root, "scripts/stub-electron.mjs");
  const mod = await load("electron/compass/compassStore.ts", "store", {
    alias: { electron: electronStub },
    external: ["better-sqlite3"],
  });
  const { CompassStore } = mod;
  const file = path.join(temp, "store.sqlite");
  let store;
  try {
    store = new CompassStore(file);
  } catch (error) {
    // better-sqlite3 is intentionally compiled for Electron in this project;
    // plain Node runners can have a different ABI. The same test runs in the
    // Electron validation job, where it must not be skipped.
    if (error?.code === "ERR_DLOPEN_FAILED") {
      t.skip("better-sqlite3 native addon requires the Electron ABI");
      return;
    }
    throw error;
  }
  try {
    const session = {
      searchId: "search-1",
      requestId: "req-1",
      generation: 1,
      queryRevision: 1,
      viewRevision: 0,
      query: "fixture",
      fingerprint: "fp-1",
      plan: {
        text: "fixture",
        exactPhrases: [],
        excludedTerms: [],
        authors: [],
        venues: [],
        identifiers: [],
        languages: [],
        types: [],
        disciplines: [],
        concepts: [],
        expressions: {
          strict: "fixture",
          balanced: "fixture",
          semantic: "fixture",
          conceptPairs: [],
        },
        openAccessOnly: false,
        providers: [],
        lane: "scholarly",
      },
      filters: { lane: "scholarly" },
      lane: "scholarly",
      state: "partial",
      revision: 1,
      resultCount: 0,
      selectedCount: 0,
      providers: [
        {
          provider: "openalex",
          state: "complete",
          count: 2,
          hasMore: false,
          strategy: "balanced",
          lane: "scholarly",
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    const { result } = await load(
      "electron/compass/providers/provider.ts",
      "provider-store",
    );
    const one = result({
      provider: "openalex",
      providerId: "W1",
      title: "First Fixture",
      doi: "10.1000/ABC",
      year: 2024,
    });
    const two = result({
      provider: "crossref",
      providerId: "C2",
      title: "Second Fixture",
      isbn: undefined,
      year: 2023,
    });
    store.saveSearch(session);
    store.upsertResult(session.searchId, one, 1);
    store.upsertResult(session.searchId, two, 2);
    assert.equal(store.listResults(session.searchId, 0, 1).length, 1);
    assert.equal(store.listResults(session.searchId, 1, 1).length, 1);
    assert.equal(
      store.findResultByIdentity(session.searchId, [
        { scheme: "DOI", value: "10.1000/abc" },
      ])?.title,
      "First Fixture",
    );
    store.setSelection(
      session.searchId,
      [one.canonicalKey, two.canonicalKey],
      2,
    );
    assert.deepEqual(
      new Set(store.selectedKeys(session.searchId)),
      new Set([one.canonicalKey, two.canonicalKey]),
    );
    store.saveCandidate(session.searchId, one.canonicalKey);
    store.dismissCandidate(session.searchId, two.canonicalKey);
    store.putProviderCache(
      "fixture-cache",
      "openalex",
      { results: [one] },
      "cursor",
      60_000,
    );
    assert.equal(store.getProviderCache("fixture-cache")?.nextCursor, "cursor");
  } finally {
    store.close();
  }
});
