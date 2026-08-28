import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const view = fs.readFileSync(
  new URL("src/views/DatabaseDeepResearchView.tsx", root),
  "utf8",
);
const contract = fs.readFileSync(
  new URL("shared/databaseDeepResearch.ts", root),
  "utf8",
);

test("database Deep Research renderer uses the canonical typed surface", () => {
  for (const method of [
    "previewDatabaseDeepResearch",
    "enqueueDatabaseDeepResearch",
    "listDatabaseDeepResearchJobs",
    "getDatabaseDeepResearchReport",
    "cancelDatabaseDeepResearchJob",
    "clearFinishedDatabaseDeepResearchJobs",
    "listDatabaseDeepResearchReports",
    "deleteDatabaseDeepResearchReport",
    "exportDatabaseDeepResearchReport",
    "onDatabaseDeepResearchProgress",
  ])
    assert.match(view, new RegExp(`window\\.nodus\\.${method}`), method);
  assert.doesNotMatch(
    view,
    /as unknown as|interface DatabaseDeepResearchBridge|createDatabaseResearchRun|fallbackPreview|enqueueDeepResearchJob/,
  );
});

test("composer keeps the simple flow visible and moves roles plus preview into advanced options", () => {
  for (const depth of ["focused", "deep", "exhaustive"])
    assert.match(view, new RegExp(`['"]${depth}['"]`));
  for (const role of [
    "outcome",
    "treatment",
    "confounders",
    "time",
    "duration",
    "event",
    "entity",
    "text",
    "location",
  ])
    assert.match(view, new RegExp(`id:\\s*["']${role}["']`));
  assert.match(view, /DATABASE_RESEARCH_BUDGETS\[depth\]/);
  assert.match(view, /budget:\s*\{\s*\.\.\.preset/);
  assert.match(view, /planSections: previewSections/);
  assert.match(view, /database-deep-research-composer/);
  assert.match(view, /database-deep-research-advanced/);
  assert.match(view, /Preparar automáticamente/);
  assert.match(view, /Usar automático/);
  assert.match(view, /reportType: autoReportType \? "auto" : reportType/);
  assert.doesNotMatch(view, /maxCostUsd|setMaxCostUsd/);
});

test("library and reader expose the same durable reading workflow as academic Deep Research", () => {
  for (const marker of [
    "database-deep-research-library",
    "database-deep-research-toolbar",
    "ReaderSelectionActions",
    "ReaderHighlighterControl",
    "FindInPage",
    "SaveToNotesModal",
    "useReadingPlace",
    "setDatabaseDeepResearchReportRead",
    "listDatabaseDeepResearchReportAnnotations",
  ]) assert.match(view, new RegExp(marker));
});

test("renderer preserves stale/partial status, shows all eight phases and evidence metrics", () => {
  for (const phase of [
    "snapshot",
    "semantic_profile",
    "planning",
    "calculations",
    "sensitivity",
    "adversarial_review",
    "verification",
    "assembly",
  ])
    assert.match(view, new RegExp(`\\b${phase}\\b`));
  assert.match(view, /status: progress\.status/);
  assert.match(view, /\["failed", "cancelled", "stale", "partial"\]\.includes\(job\.status\)/);
  assert.match(view, /report\.qualityStatus === ["']partial["']/);
  for (const metric of [
    "method",
    "n",
    "denominator",
    "interval",
    "pValue",
    "qValue",
    "columnIds",
    "filters",
    "rowIds",
    "hash",
  ])
    assert.match(view, new RegExp(metric));
  assert.match(view, /structured\.evidenceLedger/);
  assert.match(view, /structured\.charts/);
  assert.match(view, /database-deep-research-charts/);
});

test("reader offers all exports and confirms raw snapshot inclusion", () => {
  for (const format of ["markdown", "pdf", "zip"])
    assert.match(view, new RegExp(`['"]${format}['"]`));
  assert.match(view, /includeSnapshot/);
  assert.match(view, /window\.confirm/);
  assert.match(view, /getDatabaseDeepResearchReport/);
});

test("shared job input retains the editable preview outline and internal budget cap", () => {
  assert.match(contract, /planSections\?: Array/);
  assert.match(contract, /maxCostUsd\?: number/);
});
