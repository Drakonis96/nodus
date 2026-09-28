// Rescans and fusion links must keep the idea graph consistent, end to end.
//
// Drives the REAL runDeepScan / runLightScan against a fake local model and checks the
// invariants every scan has to leave behind:
//
// - An idea is active exactly while a work holds an occurrence of it. A fusion link
//   ("variant_of"/"refines"/"contradicts") never wakes a dormant idea: fusion plans are
//   decided before the rescan purges its work, so a target can be asleep by the time the
//   plan is applied, and such a link is dropped instead of failing the whole write.
// - A link whose target another idea of the same pass merges into ("same_as") is kept,
//   whatever the order of the two ideas.
// - Edges other works hold into an idea that goes to sleep stay in `edges`, hidden by
//   `visible_edges`, and never keep it awake.
// - No theme link points at a deleted theme, and no unpinned theme is left unreferenced.
//
// Comparing against an older tree: NODUS_GRAPH_PROBE=<file> records every step's outcome
// and a normalized state dump (labels only, no ids or timestamps) to <file> instead of
// asserting, so the same scenario can be replayed on a checkout of another commit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-deep-rescan-dormant-link-test')) {
  execFileSync(require('electron'),
    [fileURLToPath(import.meta.url), '--electron-deep-rescan-dormant-link-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const probeFile = process.env.NODUS_GRAPH_PROBE || null;
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-dormant-link-'));
installRuntimeHooks(root);

const STATEMENT = 'La catálisis enzimática reduce la energía de activación de la reacción química.';

/** What the fake model extracts on the next deep pass, and how it fuses each idea. */
let extraction = { ideas: [], themes: [] };
/** new idea label → { resolution, target label, edge type } */
let fusionRules = new Map();
/** What the fake model answers on the next light pass. */
let lightThemes = [];
const missedTargets = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const user = parsed.input ?? parsed.messages?.find((m) => m.role === 'user')?.content ?? '';
    let payload = null;
    try { payload = JSON.parse(user); } catch { /* embeddings and other shapes */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (payload?.new_idea) {
      res.end(JSON.stringify({ output_text: JSON.stringify(fusionReply(payload)), finish_reason: 'stop' }));
      return;
    }
    if (payload && 'abstract' in payload && 'title' in payload) {
      res.end(JSON.stringify({
        output_text: JSON.stringify({
          themes: lightThemes.map((label) => ({ label, confidence: 0.9 })),
          key_concepts: [], tentative_type: 'article', notes: null,
        }),
        finish_reason: 'stop',
      }));
      return;
    }
    res.end(JSON.stringify({ output_text: JSON.stringify(extractionReply()), finish_reason: 'stop' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

function extractionReply() {
  return {
    document: { type: 'article', summary: 'sintético' },
    ideas: extraction.ideas.map((idea) => ({
      label: idea.label,
      statement: idea.statement ?? STATEMENT,
      role: 'principal',
      confidence: 0.8,
      theme_labels: extraction.themes,
    })),
    internal_relations: [], external_references: [], gaps: [], authors_detail: [],
    theme_nodes: extraction.themes.map((label) => ({ label, statement: label, role: 'primary', confidence: 0.9 })),
  };
}

function fusionReply(payload) {
  const rule = fusionRules.get(payload.new_idea.label);
  const target = rule ? payload.candidates.find((candidate) => candidate.label === rule.target) : null;
  if (rule && !target) missedTargets.push(`${payload.new_idea.label} → ${rule.target}`);
  if (!rule || !target) {
    return { resolution: 'new', matched_id: null, merged_label: payload.new_idea.label, edge_to_existing: null, rationale: 'sin relación', confidence: 0.5 };
  }
  if (rule.resolution === 'same_as') {
    return { resolution: 'same_as', matched_id: target.global_id, merged_label: target.label, edge_to_existing: null, rationale: 'la misma idea', confidence: 0.9 };
  }
  return {
    resolution: 'variant_of', matched_id: target.global_id, merged_label: payload.new_idea.label,
    edge_to_existing: { type: rule.edge, basis: 'inferred', confidence: 0.8 },
    rationale: 'relacionada', confidence: 0.8,
  };
}

const probe = { steps: [] };
let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const deepScan = require(path.join(repoRoot, 'electron/ai/deepScan.ts'));
  const lightScan = require(path.join(repoRoot, 'electron/ai/lightScan.ts'));
  closeDb = close;
  const db = getDb();

  const model = { provider: 'lmstudio', model: 'fake-local-model' };
  settingsRepo.updateSettings({
    localProviders: { lmstudio: { baseUrl } },
    extractionModel: model, fusionModel: model, synthesisModel: model,
    modelSettingsMode: 'advanced', deepContextMode: 'standard', deepStandardChunkWords: 1800,
  });
  for (const id of ['W1', 'W2', 'W3', 'W4', 'W5']) {
    worksRepo.upsertWork({
      nodus_id: id, zotero_key: `KEY${id}`, zotero_version: 1,
      title: `Obra sintética ${id}`, authors: ['Autora Sintética'],
      year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
    });
  }

  let pass = 0;
  const deep = async (nodusId, ideas, themes, rules = []) => {
    extraction = { ideas, themes };
    fusionRules = new Map(rules.map((rule) => [rule.from, rule]));
    pass += 1;
    // A different text per pass gives each rescan its own hash, so no checkpoint of an
    // earlier pass is reused.
    const text = `Pasada ${pass}. ${'La transferencia de conocimiento entre disciplinas produce efectos. '.repeat(60)}`;
    await deepScan.runDeepScan(worksRepo.getWork(nodusId), { text, sourceType: 'full_text', notes: null }, model);
  };
  const light = async (nodusId, themes) => {
    lightThemes = themes;
    await lightScan.runLightScan(worksRepo.getWork(nodusId), `Resumen ${themes.join(' ')}`, model, { force: true });
  };

  const idOf = (label) => db.prepare('SELECT global_id FROM ideas WHERE label = ?').get(label)?.global_id ?? null;
  const isDormant = (label) => Boolean(db.prepare('SELECT orphaned_at FROM ideas WHERE label = ?').get(label)?.orphaned_at);
  const edgeCount = (fromLabel, toLabel, table = 'edges') => db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} e WHERE e.from_id = ? AND e.to_id = ?`
  ).get(idOf(fromLabel), idOf(toLabel)).n;
  const invariants = () => ({
    activeWithoutWork: db.prepare(
      `SELECT COUNT(*) AS n FROM ideas i
        WHERE i.orphaned_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)`
    ).get().n,
    danglingThemeLinks: db.prepare(
      'SELECT COUNT(*) AS n FROM idea_theme_links l WHERE NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = l.theme_id)'
    ).get().n,
    orphanThemes: db.prepare(
      `SELECT COUNT(*) AS n FROM themes t WHERE t.pinned = 0
          AND NOT EXISTS (SELECT 1 FROM work_themes wt WHERE wt.theme_id = t.theme_id)
          AND NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.theme_id = t.theme_id)`
    ).get().n,
    edgesMissingEnd: db.prepare(
      `SELECT COUNT(*) AS n FROM edges e
        WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.from_id)
           OR NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.to_id)`
    ).get().n,
  });
  const dump = () => {
    const rows = (sql) => db.prepare(sql).all().map((row) => Object.values(row).join(' | ')).sort();
    return {
      ideas: rows("SELECT label, CASE WHEN orphaned_at IS NULL THEN 'active' ELSE 'dormant' END FROM ideas"),
      occurrences: rows('SELECT i.label, o.nodus_id FROM idea_occurrences o JOIN ideas i ON i.global_id = o.global_id'),
      edges: rows('SELECT f.label, t.label, e.type, e.source_work FROM edges e JOIN ideas f ON f.global_id = e.from_id JOIN ideas t ON t.global_id = e.to_id'),
      visibleEdges: rows('SELECT f.label, t.label, e.type FROM visible_edges e JOIN ideas f ON f.global_id = e.from_id JOIN ideas t ON t.global_id = e.to_id'),
      themes: rows('SELECT label, pinned FROM themes'),
      workThemes: rows('SELECT wt.nodus_id, t.label FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id'),
      ideaThemes: rows('SELECT l.nodus_id, i.label, t.label FROM idea_theme_links l JOIN ideas i ON i.global_id = l.global_id JOIN themes t ON t.theme_id = l.theme_id'),
      works: rows('SELECT nodus_id, deep_status, light_status FROM works'),
      invariants: invariants(),
    };
  };
  /** Run a step; in probe mode record its outcome instead of stopping at the first failure. */
  const step = async (name, run, check) => {
    if (probeFile) {
      let error = null;
      try { await run(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      let checkError = null;
      if (!error) { try { check(); } catch (e) { checkError = e instanceof Error ? e.message : String(e); } }
      probe.steps.push({ name, error, checkError, state: dump() });
      return;
    }
    await run();
    check();
    assert.deepEqual(invariants(), { activeWithoutWork: 0, danglingThemeLinks: 0, orphanThemes: 0, edgesMissingEnd: 0 }, `${name}: graph invariants`);
    assert.deepEqual(missedTargets, [], `${name}: every fusion rule found its target among the candidates`);
    console.log(`✅ ${name}`);
  };

  // ── Parity chain: behaviour that already worked before these fixes ────────────
  await step('first deep scan', () => deep('W1', [{ label: 'Catálisis enzimática' }], ['Bioquímica', 'Enzimas']), () => {
    assert.equal(worksRepo.getWork('W1').deep_status, 'done');
  });
  await step('rescan: a link, then a merge into the same target', () => deep(
    'W1',
    [{ label: 'Inhibición competitiva' }, { label: 'Catálisis enzimática' }],
    ['Cinética', 'Termodinámica'],
    [
      { from: 'Inhibición competitiva', resolution: 'variant_of', target: 'Catálisis enzimática', edge: 'refines' },
      { from: 'Catálisis enzimática', resolution: 'same_as', target: 'Catálisis enzimática' },
    ],
  ), () => {
    assert.equal(worksRepo.getWork('W1').deep_status, 'done');
    assert.equal(isDormant('Catálisis enzimática'), false, 'the merge keeps the target awake with its global_id');
    assert.equal(edgeCount('Inhibición competitiva', 'Catálisis enzimática'), 1, 'the link applied before the merge in pass order is kept');
    assert.equal(edgeCount('Inhibición competitiva', 'Catálisis enzimática', 'visible_edges'), 1, 'and it is visible');
  });
  await step('rescan pushes two themes out of the four-theme cap', () => deep(
    'W1',
    [{ label: 'Inhibición competitiva' }, { label: 'Catálisis enzimática' }],
    ['Catálisis', 'Proteínas'],
    [
      { from: 'Inhibición competitiva', resolution: 'same_as', target: 'Inhibición competitiva' },
      { from: 'Catálisis enzimática', resolution: 'same_as', target: 'Catálisis enzimática' },
    ],
  ), () => {
    const labels = db.prepare('SELECT label FROM themes ORDER BY label').all().map((row) => row.label);
    assert.ok(!labels.includes('enzimas') && !labels.includes('termodinámica'), 'themes no work or idea uses any more are pruned');
  });
  await step('another work links into W3', async () => {
    await deep('W3', [{ label: 'Plegamiento de proteínas', statement: 'El plegamiento de proteínas depende del entorno químico celular.' }], ['Proteómica']);
    await deep('W2', [{ label: 'Chaperonas moleculares', statement: 'Las chaperonas guían el plegamiento de proteínas en el entorno químico celular.' }], ['Chaperonas'], [
      { from: 'Chaperonas moleculares', resolution: 'variant_of', target: 'Plegamiento de proteínas', edge: 'refines' },
    ]);
  }, () => {
    assert.equal(edgeCount('Chaperonas moleculares', 'Plegamiento de proteínas', 'visible_edges'), 1, 'a link into an active idea is written and visible');
  });
  await step('light rescan replaces the broad themes', async () => {
    await light('W4', ['Tema ligero uno', 'Tema ligero dos']);
    await light('W4', ['Tema ligero tres']);
  }, () => {
    const labels = db.prepare('SELECT label FROM themes ORDER BY label').all().map((row) => row.label);
    assert.ok(!labels.includes('tema ligero uno') && labels.includes('tema ligero tres'), 'the light rescan leaves no orphan theme behind');
  });

  // ── Cross-work: the work holding an idea drops it ───────────────────────────
  await step('the owning work drops the linked idea', () => deep(
    'W3', [{ label: 'Espectrometría de masas', statement: 'La espectrometría de masas identifica péptidos por su masa.' }], ['Espectrometría'],
  ), () => {
    assert.equal(isDormant('Plegamiento de proteínas'), true, "another work's edge does not keep an idea no work holds awake");
    assert.equal(edgeCount('Chaperonas moleculares', 'Plegamiento de proteínas'), 1, "that work's edge stays in edges");
    assert.equal(edgeCount('Chaperonas moleculares', 'Plegamiento de proteínas', 'visible_edges'), 0, 'and visible_edges hides it');
  });
  await step('the linking work is rescanned and links to the dormant idea again', () => deep(
    'W2', [{ label: 'Chaperonas moleculares', statement: 'Las chaperonas guían el plegamiento de proteínas en el entorno químico celular.' }], ['Chaperonas'], [
      { from: 'Chaperonas moleculares', resolution: 'variant_of', target: 'Plegamiento de proteínas', edge: 'refines' },
    ],
  ), () => {
    assert.equal(worksRepo.getWork('W2').deep_status, 'done', 'the rescan completes instead of failing the integrity check');
    assert.equal(isDormant('Plegamiento de proteínas'), true, 'the link did not wake the idea');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edges WHERE to_id = ?').get(idOf('Plegamiento de proteínas')).n, 0, 'the link to it was dropped');
  });

  // ── Same work: the rescan links to its own previous idea ──────────────────────
  await step('first scan of W5', () => deep('W5', [{ label: 'Energía de activación' }], ['Bioenergética']), () => {
    assert.equal(worksRepo.getWork('W5').deep_status, 'done');
  });
  await step('rescan of W5 links to the idea its purge puts to sleep', () => deep(
    'W5', [{ label: 'Barrera energética' }], ['Bioenergética'], [
      { from: 'Barrera energética', resolution: 'variant_of', target: 'Energía de activación', edge: 'variant_of' },
    ],
  ), () => {
    assert.equal(worksRepo.getWork('W5').deep_status, 'done', 'the rescan completes');
    assert.equal(isDormant('Energía de activación'), true, 'the previous idea stays asleep instead of coming back as a ghost');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edges WHERE to_id = ?').get(idOf('Energía de activación')).n, 0, 'no edge into it');
  });

  if (probeFile) fs.writeFileSync(probeFile, `${JSON.stringify(probe, null, 2)}\n`);
  else console.log('\n✅ rescans keep dormancy, links and themes consistent');
} finally {
  try { closeDb(); } catch { /* ignore */ }
  server.close();
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText, filename);
  };
}
