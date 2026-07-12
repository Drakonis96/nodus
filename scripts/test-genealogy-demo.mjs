import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-genealogy-demo-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-genealogy-demo.mjs'), '--electron-genealogy-demo-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-geneademo-test-'));
installRuntimeHooks(root);

// A 1×1 PNG so the portrait pipeline (nativeImage → JPEG) has real bytes to process.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

try {
  const demo = require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts'));
  const portraits = require(path.join(repoRoot, 'electron/ai/genealogyDemoPortraits.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rels = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const sug = require(path.join(repoRoot, 'electron/db/kinshipSuggestionsRepo.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const orch = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const { getSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { getActiveVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { clearDemoData } = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const priorType = getActiveVault().type;

  // ── Seed ──────────────────────────────────────────────────────────────────
  assert.equal(demo.seedGenealogyDemoData(), true, 'seeded on an empty vault');
  assert.equal(demo.seedGenealogyDemoData(), false, 'idempotent: no re-seed when data exists');

  // Vault flipped to genealogy; prior type remembered for restore.
  assert.equal(getActiveVault().type, 'genealogy', 'active vault is now genealogy');
  assert.equal(getSettings().demoMode, true, 'demo flag set');
  assert.equal(getSettings().demoPriorVaultType, priorType, 'prior vault type remembered');

  const counts = entities.recordCounts();
  assert.equal(counts.persons, 14, 'all demo persons seeded');
  assert.ok(counts.events >= 10, 'events seeded');
  assert.ok(counts.places >= 4, 'places seeded');
  assert.equal(archive.archiveCounts().items, 9, 'archive documents seeded');
  assert.equal(rels.allRelationships().length, 18, 'kinship relationships seeded');

  // Kinship suggestions: 3 open proposals awaiting review, with evidence + strength.
  const open = sug.listOpenSuggestions();
  assert.equal(open.length, 3, 'three open kinship suggestions surface');
  const spouseSug = open.find((s) => s.type === 'spouse');
  assert.ok(spouseSug, 'a spouse suggestion surfaces');
  assert.equal(spouseSug.strength, 'alta', 'two corroborating sources → alta');
  assert.equal(spouseSug.evidence.length, 2, 'record + explicit-claim evidence both retained');
  assert.ok(spouseSug.evidence.some((e) => e.quote && e.quote.length > 0), 'evidence carries verbatim quotes');

  // No suggestion duplicates a relationship already asserted.
  const juan = entities.listPersons({ search: 'Tomás Serrano' })[0];
  assert.ok(juan, 'Tomás persisted');
  assert.equal(
    sug.listSuggestionsForPerson(juan.personId).length,
    0,
    'confirmed family (Tomás) has no pending suggestions'
  );

  // ── Document ↔ person discovery (lexical, AI-free) ─────────────────────────
  // The 1925 letter names Amparo but is only linked to Rafael → Amparo is proposed.
  const letter = archive.listItems({ search: 'Carta de Amparo' })[0];
  assert.ok(letter, 'letter document present');
  const suggestedPersons = orch.suggestPersonsForItem(letter.itemId);
  assert.ok(
    suggestedPersons.some((p) => p.displayName.includes('Amparo')),
    'a named-but-unlinked person is proposed for the document'
  );

  // Name variants power identity search (Encarna → Encarnación).
  assert.ok(entities.listPersons({ search: 'Encarna' }).length >= 1, 'name variant is searchable');

  // ── Portraits (injected generator — no network) ────────────────────────────
  let calls = 0;
  const result = await portraits.generateDemoPortraits({
    generator: async (prompt) => {
      calls++;
      assert.match(prompt, /daguerreotype/i, 'prompt asks for a daguerreotype');
      assert.match(prompt, /centered/i, 'prompt asks for a centered face');
      return PNG_1PX;
    },
  });
  assert.equal(result.generated, 14, 'a portrait generated for every demo person');
  assert.equal(calls, 14);
  const withPortrait = entities.getPerson(entities.listPersons()[0].personId);
  assert.ok(withPortrait.portrait, 'portrait focus stored');
  assert.equal(withPortrait.portrait.focusY, 0.42, 'face centered slightly above middle');

  const promptSample = portraits.buildDaguerreotypePrompt({ name: 'X', sex: 'female', birthYear: 1868, portrait: 'a woman' });
  assert.match(promptSample, /black-and-white/i, 'monochrome portrait');
  assert.match(promptSample, /No text/i, 'no-text guardrail present');

  // ── Global search adapts: persons, events and archive documents are findable ──
  const { globalSearch } = require(path.join(repoRoot, 'electron/db/searchRepo.ts'));
  const byName = globalSearch('Serrano', 8);
  assert.ok(byName.some((r) => r.kind === 'person'), 'search finds persons by name');
  assert.ok(byName.some((r) => r.kind === 'person' && r.title.includes('Serrano')), 'person result carries the name');
  const byPlace = globalSearch('Carmona', 8);
  assert.ok(byPlace.some((r) => r.kind === 'event'), 'search finds events by place');
  assert.ok(byPlace.some((r) => r.kind === 'archive'), 'search finds archive documents by text');
  // A name variant is searchable too (Encarna → Encarnación).
  assert.ok(globalSearch('Encarna', 8).some((r) => r.kind === 'person'), 'search matches a person name variant');

  // ── Clear restores everything ──────────────────────────────────────────────
  clearDemoData();
  assert.equal(entities.recordCounts().persons, 0, 'persons cleared');
  assert.equal(archive.archiveCounts().items, 0, 'archive cleared');
  assert.equal(sug.listOpenSuggestions().length, 0, 'suggestions cleared');
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS n FROM person_portraits').get().n,
    0,
    'portraits cleared'
  );
  assert.equal(getActiveVault().type, priorType, 'vault type restored on exit');
  assert.equal(getSettings().demoMode, false, 'demo flag cleared');
  assert.equal(getSettings().demoPriorVaultType, null, 'prior type reset');

  console.log('Genealogy demo test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    // Minimal nativeImage: the portrait pipeline only resizes + re-encodes; a passthrough
    // is enough to exercise the flow without the real (GUI-only) image backend.
    nativeImage: {
      createFromBuffer: (bytes) => ({
        isEmpty: () => !bytes || bytes.length === 0,
        getSize: () => ({ width: 512, height: 512 }),
        resize: () => ({ toJPEG: () => bytes }),
      }),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
