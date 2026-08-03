// The server's compiled copy of `shared/` must be the one `shared/` currently produces.
//
// `server/lib/core/generated/` exists so the Nodus Server can print the same Deep Research
// document the desktop prints without taking on a dependency or a build step — it stays a
// `node:22-alpine` image that copies three paths and runs `node server.mjs`. The cost of that
// is a committed build artefact, and a committed build artefact is a thing that silently stops
// matching its source.
//
// So this is the lockfile check: rebuild from `shared/` and compare. If it fails, the fix is
// `npm run build:server-shared`, not an edit to the generated file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERATED, generatedIsCurrent } from './build-server-shared.mjs';

test('the server’s generated modules match the shared source they came from', async () => {
  const { current, stale } = await generatedIsCurrent();
  assert.ok(
    current,
    `${stale.join(', ')} is out of date. Run \`npm run build:server-shared\` and commit the result.`
  );
});

test('the generated bundle carries no dependency the server does not have', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  for (const { out } of GENERATED) {
    const code = await readFile(path.join(repoRoot, 'server/lib/core/generated', out), 'utf8');
    // The server installs nothing. An import of anything other than a Node builtin would be
    // a module that cannot resolve inside the image — and it would only fail in production.
    const imports = [...code.matchAll(/^import .*? from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
    const external = imports.filter((id) => !id.startsWith('node:'));
    assert.deepEqual(external, [], `${out} imports ${external.join(', ')}, which the server image has no way to resolve`);
    assert.ok(!/require\(/.test(code), `${out} uses require(), which an ESM server cannot run`);
  }
});

test('the document it renders is a whole HTML page with the report’s own page box', async () => {
  const { deepResearchReportInput, renderProfessionalReportHtml } = await import(
    '../server/lib/core/generated/deepResearchReport.mjs'
  );
  const draft = {
    title: 'Un informe',
    abstract: 'El resumen.',
    draftMarkdown: '## Una sección\n\nLa prosa del informe.',
    generatedAt: '2026-02-02T00:00:00.000Z',
    brief: { kind: 'deep_research', objective: 'El objetivo', language: 'es' },
    outline: [{ title: 'Una sección' }],
    nextSteps: ['Seguir leyendo'],
    matrix: [],
    bibliography: [],
    stats: { selectedWorks: 3 },
  };
  const html = renderProfessionalReportHtml(deepResearchReportInput(draft));

  assert.match(html, /^<!doctype html>/i, 'a self-contained document, not a fragment');
  assert.match(html, /@page\s*\{\s*size:\s*A4/, 'the page box the desktop prints with');
  assert.ok(html.includes('Un informe'), 'the title reaches the cover');
  assert.ok(html.includes('El resumen.'), 'the executive summary is rendered');
  assert.ok(html.includes('La prosa del informe.'), 'the report body is rendered');
  assert.ok(html.includes('Seguir leyendo'), 'the recommendations are rendered');
  // Nothing to fetch: a phone prints this with no network behind it.
  assert.ok(!/<link[^>]+href=/i.test(html), 'no external stylesheet');
  assert.ok(!/<script/i.test(html), 'nothing to execute');
});
