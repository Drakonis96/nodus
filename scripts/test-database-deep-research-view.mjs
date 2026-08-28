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

test("composer carries canonical depths, budget preset, roles and editable plan sections", () => {
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
  assert.match(view, /database-deep-research-analysis-requirements/);
  assert.match(view, /preview\.requiredAnalyses/);
  assert.match(view, /preview\.optionalAnalyses/);
  assert.match(view, /allowEmpty=\{false\}/);
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
  assert.match(view, /job\.status === ["']stale["']/);
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

test("shared job input carries the editable preview outline and budget cap", () => {
  assert.match(contract, /planSections\?: Array/);
  assert.match(contract, /maxCostUsd\?: number/);
});
