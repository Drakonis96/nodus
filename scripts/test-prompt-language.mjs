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

// The prompt files are authored in Spanish; the output-language control must APPEND a
// high-priority directive rather than find/replace over the base prompt (which would
// corrupt JSON examples and cases where "español" denotes the source text). This test
// pins that contract for every prompt language.
if (!process.argv.includes('--electron-prompt-language-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-prompt-language.mjs'), '--electron-prompt-language-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(fs.realpathSync(os.tmpdir()) + '/nodus-prompt-language-test-');
installRuntimeHooks(root);

// A base prompt that carries the two failure modes the old find/replace hack hit:
// an inline "escribe en español" instruction and an "en español" inside a JSON example.
const BASE = [
  'Eres un analista. Analiza la obra recibida.',
  'Escribe en español salvo indicación contraria.',
  '{ "label": "tema amplio en español, reutilizable" }',
  'Copia la "quote" literal en el idioma original de la fuente.',
].join('\n');

try {
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { withPromptLanguage } = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));

  // es → prompt untouched (it is already Spanish; no directive).
  updateSettings({ promptLanguage: 'es' });
  {
    const out = withPromptLanguage({ system: BASE });
    assert.equal(out.system, BASE, 'es must leave the system prompt byte-for-byte unchanged');
  }

  const cases = [
    { lang: 'en', name: 'INGLÉS' },
    { lang: 'fr', name: 'FRANCÉS' },
    { lang: 'tr', name: 'TURCO' },
    { lang: 'de', name: 'ALEMÁN' },
    { lang: 'pt', name: 'PORTUGUÉS DE PORTUGAL' },
    { lang: 'pt-BR', name: 'PORTUGUÉS DE BRASIL' },
  ];
  for (const { lang, name } of cases) {
    updateSettings({ promptLanguage: lang });
    const out = withPromptLanguage({ system: BASE }).system;

    // The base prompt is preserved verbatim (nothing was rewritten in place)…
    assert.ok(out.startsWith(BASE), `${lang}: base prompt must be preserved as a prefix`);
    assert.ok(
      out.includes('tema amplio en español, reutilizable'),
      `${lang}: JSON example text must NOT be find/replaced`
    );
    assert.ok(
      out.includes('Escribe en español salvo indicación contraria.'),
      `${lang}: inline Spanish instruction must NOT be find/replaced`
    );

    // …and a high-priority override directive is appended, naming the target language.
    assert.ok(out.includes('HIGHEST PRIORITY'), `${lang}: must append the priority directive`);
    assert.ok(out.includes(name), `${lang}: directive must name the target language (${name})`);
    // The directive must explicitly supersede the inline "escribe en español" instruction.
    assert.ok(
      /instrucción anterior de este prompt que pida escribir "en español"/i.test(out),
      `${lang}: directive must override prior "en español" instructions`
    );
  }

  // Unknown/undefined prompt language must not throw and must fall back to no directive.
  updateSettings({ promptLanguage: undefined });
  assert.equal(withPromptLanguage({ system: BASE }).system, BASE, 'undefined language falls back to es (no directive)');

  console.log('Prompt-language directive test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
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
    if (request === './database' || request === '../database') {
      return {
        getDb() {
          return testDb;
        },
      };
    }
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
