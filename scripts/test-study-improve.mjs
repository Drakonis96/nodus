// Study vault phase 4: protected-span helpers, reusable style CRUD/versioning,
// scoped defaults, provenance and the v54 -> v57 preservation path.

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

if (!process.argv.includes('--electron-study-improve-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-improve.mjs'), '--electron-study-improve-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-improve-test-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const shared = require(path.join(repoRoot, 'shared/studyImprove.ts'));
  const improve = require(path.join(repoRoot, 'electron/ai/studyImprove.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const styles = require(path.join(repoRoot, 'electron/db/studyStylesRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.equal(SCHEMA_VERSION, 57, 'phase 4 reaches the planned style schema v57');
  assert.equal(getDb().pragma('user_version', { simple: true }), 57);
  for (const table of ['study_materials', 'study_recordings', 'study_styles', 'study_style_versions', 'study_style_associations', 'study_improvement_log']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  assert.equal(shared.STUDY_IMPROVE_PRESETS.length, 13, 'all thirteen planned presets exist');
  assert.deepEqual(new Set(shared.STUDY_IMPROVE_PRESETS.map((style) => style.id)).size, 13);
  const original = 'Según “García mantiene 37 casos”, el valor fue 37% en 2024 (García, 2023, p. 8).\n\n`x = 37` y $y^2$; [fuente](https://example.org/37).';
  const protectedValue = shared.protectStudyText(original, ['García']);
  assert.ok(protectedValue.spans.length >= 7, 'quotes, citations, numbers, code, math, links and terms are protected');
  assert.equal(shared.restoreProtectedSpans(protectedValue.text, protectedValue.spans), original, 'protected text round-trips losslessly');
  assert.equal(shared.missingProtectedSpans(protectedValue.text.replace(protectedValue.spans[0].placeholder, ''), protectedValue.spans).length, 1);
  assert.match(shared.renderStudyStylePrompt('Para {{subject}}: {{selectedText}}', { subject: 'Historia', selectedText: 'Texto' }), /Historia: Texto/);
  assert.ok(shared.validateStudyStylePrompt('Inventa nuevas citas y datos para ampliar el texto seleccionado.').length > 0, 'unsafe custom prompt is warned');
  assert.ok(shared.studyImprovementWarnings('Hubo 37 casos.', 'Hubo 41 casos.', [], 'preserve').length >= 2, 'changed and new numbers are warned');

  const document = org.createStudyDocument({ title: 'Apunte para mejorar', contentMarkdown: original });
  const custom = styles.createStudyStyle({
    name: 'Mi estilo', icon: '🧪', color: '#123456', prompt: 'Aclara {{selectedText}} sin añadir información nueva.',
    description: 'Estilo de prueba', favorite: true, level: 'minimal', length: 'similar',
  });
  assert.equal(custom.builtIn, false);
  assert.equal(styles.listStudyStyleVersions(custom.id).length, 1, 'creation snapshots prompt version');
  const updated = styles.updateStudyStyle(custom.id, { prompt: 'Corrige y aclara el texto seleccionado sin añadir datos.', locked: true });
  assert.equal(updated.locked, true);
  assert.equal(styles.listStudyStyleVersions(custom.id).length, 2, 'updates are versioned');
  assert.throws(() => styles.updateStudyStyle(custom.id, { prompt: 'Cambio bloqueado de configuración.' }), /Desbloquea/);
  assert.equal(styles.updateStudyStyle(custom.id, { favorite: false }).favorite, false, 'locked style still allows library metadata');
  const versions = styles.listStudyStyleVersions(custom.id);
  const oldest = versions.at(-1);
  styles.updateStudyStyle(custom.id, { locked: false });
  const restored = styles.restoreStudyStyleVersion(custom.id, oldest.id);
  assert.equal(restored.prompt, oldest.config.prompt, 'prompt history can be restored');

  const duplicate = styles.duplicateStudyStyle('builtin:academic');
  assert.equal(duplicate.builtIn, false, 'built-in templates duplicate into editable custom styles');
  assert.match(duplicate.name, /copia/);
  assert.ok(styles.archiveStudyStyle(duplicate.id, true).archivedAt);
  assert.equal(styles.archiveStudyStyle(duplicate.id, false).archivedAt, null);

  styles.setStudyStyleAssociation(custom.id, 'global', '', true);
  assert.equal(styles.resolveStudyStyleDefault(), custom.id);
  styles.setStudyStyleAssociation(duplicate.id, 'document_kind', 'apunte', true);
  assert.equal(styles.resolveStudyStyleDefault(null, 'apunte'), duplicate.id, 'document-kind default outranks global');

  const log = styles.recordStudyImprovement({
    documentId: document.id, styleId: custom.id, scope: 'selection', mode: 'preserve', level: 'minimal', length: 'similar',
    modelProvider: 'openai', modelName: 'test-model', originalHash: 'a'.repeat(64), resultHash: 'b'.repeat(64),
    originalChars: 12, resultChars: 13, warnings: ['Revisar'], action: 'generated',
  });
  styles.updateStudyImprovementAction(log.id, 'replace');
  assert.equal(styles.listStudyImprovementLog(document.id).find((entry) => entry.id === log.id)?.action, 'replace', 'provenance action follows user decision');

  // Exercise the complete improvement pipeline with a realistic academic
  // fragment. The controlled provider streams an actual rewrite while the
  // production prompt, protected-span restoration, warnings and provenance
  // code all run unchanged.
  const academicSample = '# Práctica de recuperación\n\nsegun “la recuperación fortalece la memoria”, el grupo recordó 50% más en 2024 (Roediger & Karpicke, 2006, p. 251). La magnitud fue $d = 1.50$.\n\n- este resultado demuestra una mejora.\n- `score = 50` permanece sin cambios.';
  let streamed = '';
  const improved = await improve.improveStudyText({
    documentId: document.id,
    text: academicSample,
    styleId: 'builtin:academic',
    scope: 'selection',
    level: 'moderate',
    length: 'similar',
    mode: 'preserve',
    protectedTerms: ['Roediger', 'Karpicke'],
    variables: { subject: 'Psicología cognitiva', language: 'es', documentType: 'apunte' },
    model: { provider: 'ollama', model: 'controlled-local-verifier' },
  }, (delta) => { streamed += delta; });
  assert.equal(streamed, improved.text, 'the streamed text and final result agree');
  assert.match(improved.text, /Según/u, 'the provider rewrite is applied');
  for (const protectedFragment of ['“la recuperación fortalece la memoria”', '50%', '2024', '(Roediger & Karpicke, 2006, p. 251)', '$d = 1.50$', '`score = 50`']) {
    assert.ok(improved.text.includes(protectedFragment), `protected fragment survives: ${protectedFragment}`);
  }
  assert.equal(improved.modelProvider, 'ollama');
  assert.equal(improved.modelName, 'controlled-local-verifier');
  assert.ok(improved.protectedSpanCount >= 6);
  assert.equal(styles.listStudyImprovementLog(document.id).some((entry) => entry.id === improved.logId), true, 'full rewrite records provenance');

  const exported = styles.exportStudyStyles([custom.id]);
  assert.equal(exported.format, 'nodus-study-styles');
  assert.equal(styles.importStudyStyles(exported).length, 1, 'style files round-trip');

  // Upgrade a genuine v54 file and prove documents survive the reserved v55/v56
  // schema plus the phase's v57 tables.
  const legacy = new Database(path.join(root, 'legacy-v54.sqlite'));
  for (const migration of migrations.filter((item) => item.version <= 54).sort((a, b) => a.version - b.version)) {
    legacy.exec(migration.up); legacy.pragma(`user_version = ${migration.version}`);
  }
  const timestamp = new Date().toISOString();
  legacy.prepare(`INSERT INTO study_docs
    (id, short_id, title, kind, content_markdown, position, created_at, updated_at) VALUES (?, ?, ?, 'apunte', ?, 0, ?, ?)`)
    .run('legacy-style-doc', 'DOC-STYLE-LEGACY', 'Legado v54', '# No perder', timestamp, timestamp);
  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), 57);
  assert.deepEqual(legacy.prepare('SELECT title, content_markdown FROM study_docs WHERE id = ?').get('legacy-style-doc'), { title: 'Legado v54', content_markdown: '# No perder' });
  legacy.close();

  closeDb();
  console.log('Study improvement phase 4 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './aiClient' && parent?.filename?.endsWith('/electron/ai/studyImprove.ts')) {
      return {
        resolveModelRef: () => ({ provider: 'ollama', model: 'controlled-local-verifier' }),
        completeTextStream: async (options, onDelta) => {
          const selection = options.user.match(/<<<NODUS_SELECTION\n([\s\S]*?)\nNODUS_SELECTION>>>/)?.[1] ?? '';
          const result = selection
            .replace(/^segun\b/imu, 'Según')
            .replace(/\beste resultado demuestra\b/iu, 'Este resultado muestra');
          const midpoint = Math.ceil(result.length / 2);
          onDelta(result.slice(0, midpoint), 'content');
          onDelta(result.slice(midpoint), 'content');
          return result;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
