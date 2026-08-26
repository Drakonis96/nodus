import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

if (
  !workerData?.dictionaryTest &&
  !process.argv.includes("--electron-dictionary-test")
) {
  execFileSync(
    path.join(repoRoot, "node_modules/.bin/electron"),
    [fileURLToPath(import.meta.url), "--electron-dictionary-test"],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    },
  );
  process.exit(0);
}

if (isMainThread) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-test-"));
  const databasePath = path.join(root, "dictionary.sqlite");
  try {
    await new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { dictionaryTest: true, nodusDatabasePath: databasePath },
      });
      worker.on("message", (message) =>
        message?.ok
          ? resolve()
          : reject(
              new Error(message?.error ?? "Dictionary worker test failed"),
            ),
      );
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code) reject(new Error(`Dictionary worker exited ${code}`));
      });
    });
    console.log("test-dictionary: OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  process.exit(0);
}

const require = createRequire(import.meta.url);
installTsHook();

try {
  const repo = require(path.join(repoRoot, "electron/db/dictionaryRepo.ts"));
  const database = require(path.join(repoRoot, "electron/db/database.ts"));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, "electron/db/migrations.ts"));
  const ai = require(path.join(repoRoot, "electron/ai/dictionary.ts"));
  const db = database.getDb();

  assert.equal(
    db.pragma("user_version", { simple: true }),
    SCHEMA_VERSION,
    "migration reaches Dictionary schema",
  );
  for (const table of [
    "dictionary_entries",
    "dictionary_evidence",
    "dictionary_versions",
    "dictionary_relations",
    "dictionary_retrieval_state",
    "dictionary_corpus_changes",
  ]) {
    assert.ok(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table),
      `${table} exists`,
    );
  }
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='dictionary_change_ideas_insert'",
      )
      .get(),
    "incremental change trigger exists",
  );

  seedCorpus(db);
  const ideaColumns = db
    .prepare("SELECT name FROM pragma_table_info('ideas')")
    .all()
    .map((row) => row.name);
  assert.ok(
    ideaColumns.includes("created_at") && !ideaColumns.includes("updated_at"),
    "retrieval test fixture matches the persisted ideas schema",
  );
  assert.equal(
    db
      .prepare(
        "SELECT type,label,statement,created_at FROM ideas WHERE global_id=?",
      )
      .get("idea-1").label,
    "Memoria social",
    "the retrieval source query works against the migrated database",
  );
  const entry = repo.createDictionaryEntry({
    name: "Memoria colectiva",
    aliases: ["memoria social"],
    focusPrompt: "Comparar enfoques",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "standard",
    tags: ["memoria"],
  });
  assert.ok(
    entry.id && repo.getDictionaryEntry(entry.id),
    "entry creation persists",
  );
  assert.equal(
    repo.detectDictionaryDuplicates("Memoria colectiva", [])[0].match,
    "exact",
  );
  assert.equal(
    repo.detectDictionaryDuplicates("Otro término", ["memoria social"])[0]
      .match,
    "alias",
  );

  // The creation path is intentionally automatic: retrieval selects evidence and
  // generation immediately persists the first applied version.  Keep this
  // provider-independent by injecting a deterministic generator into the same
  // production orchestration function used by the IPC handler.
  const automatic = repo.createDictionaryEntry({
    name: "Memoria automática",
    aliases: ["memoria social"],
    focusPrompt: "Definición breve",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "concise",
  });
  await ai.retrieveDictionaryEvidence(automatic.id, "initial");
  assert.ok(
    repo.includedEvidence(automatic.id).length >= 2,
    "automatic retrieval selects relevant ideas/passages before generation",
  );
  const structuredEvidence = repo.includedEvidence(automatic.id).slice(0, 2);
  const renderedStructured = ai.__renderStructuredDictionaryForTesting(
    {
      paragraphs: [
        {
          claims: [
            {
              text: "La memoria se configura mediante prácticas colectivas.",
              evidence: [
                {
                  kind: structuredEvidence[0].kind,
                  id: structuredEvidence[0].id,
                },
              ],
            },
            {
              text: "Su transmisión está documentada en procesos sociales.",
              evidence: [
                {
                  kind: structuredEvidence[1].kind,
                  id: structuredEvidence[1].id,
                },
              ],
            },
          ],
        },
      ],
    },
    structuredEvidence,
  );
  assert.equal(renderedStructured.invalidEvidenceRefs, 0);
  assert.doesNotMatch(
    renderedStructured.markdown,
    /Evidencia verificable|^\s*[-*>#]/m,
    "structured claims render as continuous prose rather than an evidence list",
  );
  assert.equal(
    [...renderedStructured.markdown.matchAll(/nodus:\/\/(?:idea|passage)\//g)]
      .length,
    2,
    "Nodus deterministically attaches one validated citation to each atomic claim",
  );
  const renderedWithUnknownId = ai.__renderStructuredDictionaryForTesting(
    {
      paragraphs: [
        {
          claims: [
            {
              text: "Esta afirmación no puede publicarse.",
              evidence: [{ kind: "idea", id: "missing-evidence-id" }],
            },
          ],
        },
      ],
    },
    structuredEvidence,
  );
  assert.equal(renderedWithUnknownId.markdown, "");
  assert.equal(renderedWithUnknownId.invalidEvidenceRefs, 1);
  assert.equal(
    repo.getDictionaryEntryDetail(automatic.id).coverage.included,
    repo.includedEvidence(automatic.id).filter((item) => !item.unavailable).length,
    "a draft reports its live included evidence before any version exists",
  );
  const generated = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "creation", model: null },
    async () => ({
      descriptionMarkdown:
        "La memoria se construye socialmente mediante prácticas colectivas documentadas [Autora (2020)](nodus://idea/idea-1).",
      authorSummaries: [],
    }),
    async (claims) => claims.map(() => "supports"),
  );
  assert.equal(
    generated.trigger,
    "creation",
    "automatic creation records the creation trigger",
  );
  const automaticAfterGeneration = repo.getDictionaryEntry(automatic.id);
  assert.equal(
    automaticAfterGeneration.status,
    "active",
    "first generated version activates the entry",
  );
  assert.equal(
    automaticAfterGeneration.currentVersionId,
    generated.id,
    "generated version is persisted as current",
  );

  const stalePassageEntry = repo.createDictionaryEntry({
    name: "Pasaje mutable",
    aliases: [],
    focusPrompt: "No reutilizar texto antiguo",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "concise",
  });
  repo.upsertDictionaryEvidence(stalePassageEntry.id, [
    evidence(
      "passage",
      "work-1#0",
      "included",
      "Obra Uno · p. 12",
      "La memoria colectiva cambia entre generaciones.",
    ),
  ]);
  assert.equal(
    repo.includedEvidence(stalePassageEntry.id)[0].unavailable,
    false,
    "a persisted passage is usable while its exact text revision is current",
  );
  db.prepare("UPDATE passages SET text=? WHERE passage_id='work-1#0'").run(
    "Texto nuevo asignado al mismo identificador de pasaje.",
  );
  assert.equal(
    repo.includedEvidence(stalePassageEntry.id)[0].unavailable,
    true,
    "a reindexed passage id cannot revive the Dictionary copy of the old text",
  );
  await assert.rejects(
    () => ai.__generateDictionaryEntryForTesting(
      { entryId: stalePassageEntry.id, mode: "creation", model: null },
      async () => ({ descriptionMarkdown: "No debe ejecutarse.", authorSummaries: [] }),
    ),
    /evidencia relevante suficiente/,
    "Dictionary excludes a stale persisted passage before synthesis",
  );
  db.prepare("UPDATE passages SET text=? WHERE passage_id='work-1#0'").run(
    "La memoria colectiva cambia entre generaciones.",
  );

  // Citation labels contain author initials and years (for example, "Uno, A.
  // (2020)"). Sentence validation must mask the whole link before splitting;
  // the period in the initial is not an uncited sentence boundary.
  const citedWithBibliographicLabel = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "creation", model: null },
    async () => ({
      descriptionMarkdown:
        "La memoria se construye socialmente [Autora, A. (2020)](nodus://idea/idea-1).",
      authorSummaries: [],
    }),
    async (claims) => claims.map(() => "supports"),
  );
  assert.match(
    citedWithBibliographicLabel.contentMarkdown,
    /nodus:\/\/idea\/idea-1/,
    "bibliographic citation survives validation",
  );

  // Verification can legitimately remove every sentence from an overbroad first
  // draft. Never persist the resulting blank version: feed the failure back to the
  // writer once and save only a substantive, cited correction.
  let repairAttempts = 0;
  const repairedAfterVerification = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "regeneration", model: null },
    async (_entryId, _evidence, _model, _prior, correction) => {
      repairAttempts += 1;
      if (repairAttempts === 1) {
        assert.equal(correction, "");
        return {
          descriptionMarkdown:
            "La memoria demuestra por sí sola todos los cambios históricos posibles [Autora (2020)](nodus://idea/idea-1).",
          authorSummaries: [],
        };
      }
      assert.match(
        correction,
        /no superaron la verificación/,
        "the retry receives the concrete grounding failure",
      );
      return {
        descriptionMarkdown:
          "La evidencia presenta la memoria como una construcción social situada [Autora (2020)](nodus://idea/idea-1).",
        authorSummaries: [],
      };
    },
    async (claims) =>
      claims.map((claim) =>
        claim.sentence.includes("todos los cambios")
          ? "unsupported"
          : "supports",
      ),
  );
  assert.equal(repairAttempts, 2, "a stripped synthesis gets one bounded retry");
  assert.match(
    repairedAfterVerification.contentMarkdown,
    /construcción social situada/,
    "only the grounded correction is persisted",
  );
  assert.equal(
    repairedAfterVerification.state,
    "applied",
    "Regenerate makes the successfully grounded definition current immediately",
  );
  assert.equal(
    repo.getDictionaryEntry(automatic.id).currentVersionId,
    repairedAfterVerification.id,
    "the overview reads the regenerated version without a second accept action",
  );

  // Some providers repeatedly append a generic conclusion without a citation.
  // After the bounded rewrites, retain the verified cited material and remove
  // only that unsupported sentence instead of failing the whole background job.
  let salvageAttempts = 0;
  const salvagedUncitedTail = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "regeneration", model: null },
    async () => {
      salvageAttempts += 1;
      return {
        descriptionMarkdown:
          "La memoria se construye mediante prácticas sociales documentadas [Autora (2020)](nodus://idea/idea-1). Esta conclusión universal carece de respaldo en la evidencia seleccionada.",
        authorSummaries: [],
      };
    },
    async (claims) => claims.map(() => "supports"),
  );
  assert.equal(
    salvageAttempts,
    3,
    "an uncited tail receives two automatic rewrites before local salvage",
  );
  assert.match(
    salvagedUncitedTail.contentMarkdown,
    /prácticas sociales documentadas/,
    "verified cited prose survives local salvage",
  );
  assert.doesNotMatch(
    salvagedUncitedTail.contentMarkdown,
    /conclusión universal/,
    "only the persistently uncited sentence is removed",
  );

  const currentBeforeDegraded = repo.getDictionaryEntry(automatic.id).currentVersionId;
  let extractiveFallbackAttempts = 0;
  const extractiveFallback = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "regeneration", model: null },
    async () => {
      extractiveFallbackAttempts += 1;
      return {
        descriptionMarkdown:
          "La memoria explica absolutamente cualquier transformación social posible [Autora (2020)](nodus://idea/idea-1).",
        authorSummaries: [],
      };
    },
    async (claims) => claims.map(() => "unsupported"),
  );
  assert.equal(
    extractiveFallbackAttempts,
    3,
    "semantic rejection receives two automatic provider rewrites first",
  );
  assert.match(
    extractiveFallback.contentMarkdown,
    /## Evidencia verificable/,
    "total semantic rejection falls back to cited evidence excerpts",
  );
  assert.match(
    extractiveFallback.contentMarkdown,
    /nodus:\/\/(?:idea|passage)\//,
    "the extractive fallback remains traceable to selected evidence",
  );
  assert.doesNotMatch(
    extractiveFallback.contentMarkdown,
    /absolutamente cualquier transformación/,
    "unsupported provider prose is never persisted in the fallback",
  );
  assert.equal(extractiveFallback.outcome, "degraded");
  assert.equal(extractiveFallback.state, "degraded");
  assert.equal(extractiveFallback.degradationReason, "semantic_rejection");
  assert.equal(extractiveFallback.generationAttempts, 3);
  assert.equal(
    repo.getDictionaryEntry(automatic.id).currentVersionId,
    currentBeforeDegraded,
    "a degraded regeneration never replaces the current synthesis",
  );

  const missingCitationFallback = await ai.__generateDictionaryEntryForTesting(
    { entryId: automatic.id, mode: "regeneration", model: null },
    async () => ({
      descriptionMarkdown:
        "La memoria conserva información entre generaciones y contextos sociales.",
      authorSummaries: [],
    }),
  );
  assert.match(
    missingCitationFallback.contentMarkdown,
    /## Evidencia verificable/,
    "a provider that omits every citation gets the safe extractive fallback",
  );
  assert.doesNotMatch(
    missingCitationFallback.contentMarkdown,
    /conserva información entre generaciones/,
    "uncited provider prose is not persisted",
  );
  assert.equal(missingCitationFallback.outcome, "degraded");
  assert.equal(missingCitationFallback.degradationReason, "missing_citations");
  assert.equal(
    repo.getDictionaryEntryDetail(automatic.id).latestDegradedVersion.id,
    missingCitationFallback.id,
    "the latest degraded attempt remains inspectable without becoming current",
  );

  let malformedOutputCalls = 0;
  const malformedOutputFallback =
    await ai.__generateDictionaryEntryForTesting(
      { entryId: automatic.id, mode: "regeneration", model: null },
      async () => {
        malformedOutputCalls += 1;
        const error = new Error("Fallo de parseo JSON tras agotar la reparación");
        error.code = "output_truncated";
        throw error;
      },
    );
  assert.equal(
    malformedOutputCalls,
    3,
    "a truncated structured output receives two top-level automatic retries",
  );
  assert.match(
    malformedOutputFallback.contentMarkdown,
    /## Evidencia verificable/,
    "malformed or truncated structured output recovers to cited evidence",
  );
  assert.equal(malformedOutputFallback.state, "degraded");
  assert.equal(malformedOutputFallback.outcome, "degraded");
  assert.equal(
    malformedOutputFallback.degradationReason,
    "output_truncated",
  );
  assert.equal(
    repo.getDictionaryEntry(automatic.id).currentVersionId,
    currentBeforeDegraded,
    "structured-output degradation preserves the prior current version",
  );

  // A provider failure must reject the IPC operation without creating an empty
  // version or changing the draft entry. This is the failure mode reported by the
  // user, so assert both the error and the persistence invariant explicitly.
  const failed = repo.createDictionaryEntry({
    name: "Memoria con fallo",
    aliases: [],
    focusPrompt: "",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "standard",
  });
  repo.upsertDictionaryEvidence(failed.id, [
    evidence(
      "idea",
      "idea-1",
      "included",
      "Idea sobre memoria",
      "La memoria se construye socialmente.",
    ),
    evidence(
      "passage",
      "work-1#0",
      "included",
      "Obra Uno · p. 12",
      "La memoria colectiva cambia entre generaciones.",
    ),
  ]);
  await assert.rejects(
    () =>
      ai.__generateDictionaryEntryForTesting(
        { entryId: failed.id, mode: "creation", model: null },
        async () => {
          throw new Error("Proveedor no disponible");
        },
      ),
    /Proveedor no disponible/,
    "provider failures propagate to the caller",
  );
  const failedAfter = repo.getDictionaryEntry(failed.id);
  assert.equal(
    failedAfter.status,
    "draft",
    "provider failure leaves the entry in draft state",
  );
  assert.equal(
    failedAfter.currentVersionId,
    null,
    "provider failure creates no current version",
  );
  assert.equal(
    repo.listDictionaryVersions(failed.id).length,
    0,
    "provider failure creates no version row",
  );

  // A generated citation outside the selected evidence is stripped, retried twice
  // and retained only as a degraded audit row; the draft remains untouched.
  let invalidCitationAttempts = 0;
  const invalidCitationFallback =
    await ai.__generateDictionaryEntryForTesting(
      { entryId: failed.id, mode: "creation", model: null },
      async () => {
        invalidCitationAttempts += 1;
        return {
          descriptionMarkdown:
            "Esta afirmación inventada no procede de la evidencia disponible [fuente](nodus://idea/no-existe).",
          authorSummaries: [],
        };
      },
    );
  assert.equal(invalidCitationAttempts, 3);
  assert.equal(invalidCitationFallback.outcome, "degraded");
  assert.equal(
    invalidCitationFallback.degradationReason,
    "invalid_evidence_refs",
  );
  assert.equal(
    repo.getDictionaryEntry(failed.id).currentVersionId,
    null,
    "invalid citation leaves draft untouched",
  );

  repo.upsertDictionaryEvidence(entry.id, [
    evidence(
      "idea",
      "idea-1",
      "included",
      "Idea sobre memoria",
      "La memoria se construye socialmente.",
    ),
    evidence(
      "passage",
      "work-1#0",
      "included",
      "Obra Uno · p. 12",
      "La memoria colectiva cambia entre generaciones.",
    ),
    evidence(
      "idea",
      "idea-2",
      "unused",
      "Idea secundaria",
      "Una interpretación alternativa.",
    ),
  ]);
  repo.setDictionaryEvidenceDecision(
    entry.id,
    [{ kind: "idea", id: "idea-2" }],
    "excluded",
  );
  const evidencePage = repo.listDictionaryEvidence({
    entryId: entry.id,
    decisions: ["excluded"],
    offset: 0,
    limit: 20,
  });
  assert.equal(
    evidencePage.total,
    1,
    "evidence exclusion persists and filters",
  );
  assert.equal(evidencePage.items[0].id, "idea-2");

  const validMarkdown =
    "La memoria se presenta como construcción social [Autora (2020)](nodus://idea/idea-1) (memoria).";
  const edited = repo.updateDictionaryEntry(
    entry.id,
    { contentMarkdown: validMarkdown, notes: "Nota manual", status: "active" },
    entry.updatedAt,
  );
  assert.equal(
    edited.contentMarkdown,
    validMarkdown,
    "manual description persists",
  );
  assert.equal(
    repo.listDictionaryVersions(entry.id)[0].trigger,
    "manual_edit",
    "manual edit creates a version",
  );
  assert.throws(
    () =>
      repo.updateDictionaryEntry(
        entry.id,
        { contentMarkdown: "Falsa [fuente](nodus://idea/no-existe)" },
        edited.updatedAt,
      ),
    /cita inexistente/,
    "nonexistent citations are rejected",
  );

  const currentBeforeProposal = repo.getDictionaryEntry(entry.id);
  const newlyIncluded = evidence(
    "idea",
    "idea-1",
    "included",
    "Idea sobre memoria",
    "La memoria se construye socialmente.",
  );
  newlyIncluded.isNew = true;
  repo.upsertDictionaryEvidence(entry.id, [newlyIncluded]);
  assert.equal(
    repo.getDictionaryEntry(entry.id).newEvidenceCount,
    1,
    "new included evidence is surfaced before accepting an update",
  );
  const proposed = repo.saveDictionaryVersion({
    entryId: entry.id,
    contentMarkdown: `${validMarkdown}\n\nVersión propuesta [Pasaje](nodus://passage/work-1%230).`,
    evidence: [
      { kind: "idea", id: "idea-1" },
      { kind: "passage", id: "work-1#0" },
    ],
    citations: [
      { kind: "idea", id: "idea-1", label: "Autora (2020)", tags: ["memoria"] },
    ],
    authorSummaries: [],
    model: null,
    trigger: "update",
    state: "proposed",
    insufficientEvidence: false,
  });
  assert.equal(
    repo.getDictionaryEntry(entry.id).contentMarkdown,
    currentBeforeProposal.contentMarkdown,
    "update proposal never overwrites current text",
  );
  const accepted = repo.acceptDictionaryVersion(
    entry.id,
    proposed.id,
    currentBeforeProposal.currentVersionId,
  );
  assert.equal(
    accepted.entry.currentVersionId,
    proposed.id,
    "proposed update can be accepted",
  );
  assert.equal(
    accepted.entry.newEvidenceCount,
    0,
    "accepting an update clears evidence incorporated into the current version",
  );

  const regeneration = repo.saveDictionaryVersion({
    entryId: entry.id,
    contentMarkdown: validMarkdown,
    evidence: [{ kind: "idea", id: "idea-1" }],
    citations: [
      { kind: "idea", id: "idea-1", label: "Autora (2020)", tags: ["memoria"] },
    ],
    authorSummaries: [],
    model: null,
    trigger: "regeneration",
    state: "proposed",
    insufficientEvidence: false,
  });
  assert.equal(regeneration.trigger, "regeneration");
  const restored = repo.restoreDictionaryVersion(
    entry.id,
    accepted.currentVersion.id,
    accepted.entry.currentVersionId,
  );
  assert.ok(
    repo
      .listDictionaryVersions(entry.id)
      .some((version) => version.trigger === "restore"),
    "restoration creates a new immutable version",
  );
  assert.equal(
    restored.entry.contentMarkdown,
    accepted.currentVersion.contentMarkdown,
  );

  const list = repo.listDictionaryEntries({
    query: "Autora",
    tags: ["memoria"],
    authorIds: ["author-1"],
    workIds: ["work-1"],
    statuses: ["active"],
    sort: { key: "evidence", dir: "desc" },
    offset: 0,
    limit: 20,
  });
  assert.equal(
    list.total,
    1,
    "search, tag/author/work/status filters and sorting compose",
  );

  // Sorting must use the same canonical author/work counts shown by the
  // overview.  In particular, evidence rows may reference several works in
  // works_json even when their primary work_id points to only one of them.
  db.prepare(
    "INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived,read_tag) VALUES('work-2','ZOT-2','Obra Dos','[\"Otra Autora\"]',2021,0,0)",
  ).run();
  db.prepare(
    "INSERT INTO authors(author_id,name,affiliation) VALUES('author-2','Otra Autora',NULL)",
  ).run();
  const multiSource = repo.createDictionaryEntry({
    name: "Concepto multisource",
    aliases: [],
    focusPrompt: "",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "concise",
  });
  const multiSourceEvidence = evidence(
    "idea",
    "idea-1",
    "included",
    "Idea compartida",
    "La memoria se construye socialmente.",
  );
  multiSourceEvidence.authors = [
    { id: "author-1", name: "Autora Uno", attributionBasis: "author" },
    { id: "author-2", name: "Otra Autora", attributionBasis: "author" },
  ];
  multiSourceEvidence.works = [
    ...multiSourceEvidence.works,
    {
      id: "work-2",
      title: "Obra Dos",
      zoteroKey: "ZOT-2",
      authors: ["Otra Autora"],
      year: 2021,
    },
  ];
  repo.upsertDictionaryEvidence(multiSource.id, [multiSourceEvidence]);
  repo.saveDictionaryVersion({
    entryId: multiSource.id,
    contentMarkdown: "Definición con dos fuentes.",
    evidence: [{ kind: "idea", id: "idea-1" }],
    citations: [],
    authorSummaries: [],
    model: null,
    trigger: "creation",
    state: "applied",
    insufficientEvidence: false,
  });
  const authorSorted = repo.listDictionaryEntries({
    sort: { key: "authors", dir: "desc" },
    offset: 0,
    limit: 20,
  });
  assert.equal(
    authorSorted.items[0].id,
    multiSource.id,
    "sorting by authors uses the persisted distinct author count",
  );
  assert.equal(authorSorted.items[0].authorCount, 2);
  const workSorted = repo.listDictionaryEntries({
    sort: { key: "works", dir: "desc" },
    offset: 0,
    limit: 20,
  });
  assert.equal(
    workSorted.items[0].id,
    multiSource.id,
    "sorting by works includes all works attached to an evidence item",
  );
  assert.equal(workSorted.items[0].workCount, 2);
  const multiDetail = repo.getDictionaryEntryDetail(multiSource.id);
  assert.equal(
    multiDetail.authors.find((author) => author.id === "author-1").workCount,
    2,
    "author detail counts every work attached to the evidence",
  );
  assert.equal(multiDetail.works.length, 2);
  assert.ok(
    repo.listDictionaryFacets().works.some((work) => work.id === "work-2"),
    "work facets include secondary works attached through works_json",
  );
  assert.equal(
    repo.getDictionaryEntryDetail(entry.id).authors[0].id,
    "author-1",
    "author navigation target uses canonical author id",
  );
  assert.equal(
    repo.getDictionaryEntryDetail(entry.id).works[0].zoteroKey,
    "ZOT-1",
    "work view preserves Zotero navigation key",
  );

  repo.markDictionaryEvidenceScanned(
    entry.id,
    repo.currentDictionaryChangeSequence(),
  );
  db.prepare(
    "INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES('idea-new','claim','Nueva evidencia','Nueva memoria','2026-01-02')",
  ).run();
  assert.ok(
    repo.entriesNeedingDictionaryScan().includes(entry.id),
    "corpus trigger marks entries for a new-evidence scan",
  );

  const sparse = repo.createDictionaryEntry({
    name: "Concepto escaso",
    aliases: [],
    focusPrompt: "",
    scope: { kind: "vault" },
    outputLanguage: "es",
    detailLevel: "concise",
  });
  const insufficient = repo.saveDictionaryVersion({
    entryId: sparse.id,
    contentMarkdown: "Evidencia insuficiente.",
    evidence: [],
    citations: [],
    authorSummaries: [],
    model: null,
    trigger: "creation",
    state: "applied",
    insufficientEvidence: true,
  });
  assert.equal(
    insufficient.insufficientEvidence,
    true,
    "insufficient evidence is explicit without calling AI",
  );

  database.closeDb();
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.stack ?? String(error) });
}

function evidence(kind, id, decision, label, text) {
  return {
    kind,
    refId: id,
    decision,
    score: 0.9,
    reason: "test",
    label,
    text,
    workId: "work-1",
    workTitle: "Obra Uno",
    zoteroKey: "ZOT-1",
    works: [
      {
        id: "work-1",
        title: "Obra Uno",
        zoteroKey: "ZOT-1",
        authors: ["Autora Uno"],
        year: 2020,
      },
    ],
    pageLabel: kind === "passage" ? "p. 12" : null,
    authors: [
      { id: "author-1", name: "Autora Uno", attributionBasis: "author" },
    ],
    tags: kind === "idea" ? ["memoria"] : [],
    sourceRevision: kind === "passage"
      ? createHash("sha256").update(text).digest("hex")
      : `rev-${id}`,
  };
}

function seedCorpus(db) {
  db.prepare(
    "INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived,read_tag) VALUES('work-1','ZOT-1','Obra Uno','[\"Autora Uno\"]',2020,0,0)",
  ).run();
  db.prepare(
    "INSERT INTO authors(author_id,name,affiliation) VALUES('author-1','Uno, Autora',NULL)",
  ).run();
  db.prepare(
    "INSERT INTO work_authors(nodus_id,author_id,role) VALUES('work-1','author-1','author')",
  ).run();
  db.prepare(
    "INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES('idea-1','construct','Memoria social','La memoria se construye socialmente','2026-01-01')",
  ).run();
  db.prepare(
    "INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES('idea-2','claim','Alternativa','Otra lectura','2026-01-01')",
  ).run();
  db.prepare(
    "INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES('idea-1','work-1','central','Desarrollo situado',.9)",
  ).run();
  db.prepare(
    "INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES('idea-2','work-1','secondary','Desarrollo alternativo',.7)",
  ).run();
  db.prepare(
    "INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at) VALUES('work-1#0','work-1',0,'La memoria colectiva cambia entre generaciones.','p. 12',47,'hash','2026-01-01')",
  ).run();
}

function installTsHook() {
  const ts = require("typescript");
  const Module = require("node:module");
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(
    request,
    parent,
    isMain,
    options,
  ) {
    if (request.startsWith("@shared/"))
      return path.join(
        repoRoot,
        `${request.replace("@shared/", "shared/")}.ts`,
      );
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  // The AI provider layer imports Electron's `app` only to register a shutdown
  // hook. The database test runs in ELECTRON_RUN_AS_NODE/worker mode, where the
  // real Electron module has no application lifecycle object.
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { once() {} } };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions[".ts"] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
