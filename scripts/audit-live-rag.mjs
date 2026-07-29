import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-live-rag')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-live-rag.mjs'), '--electron-live-rag'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const key = process.env.NODUS_AUDIT_OPENROUTER_KEY;
if (!key) throw new Error('NODUS_AUDIT_OPENROUTER_KEY is required.');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-live-rag-'));
installRuntimeHooks(userDataPath);

try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const ai = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));

  secrets.setApiKey('openrouter', key);
  settings.updateSettings({ embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' });

  const vectors = await ai.embedMany([
    'La dendrocronología fecha construcciones mediante los anillos de la madera.',
    'La fotosíntesis transforma energía lumínica en energía química.',
    'Los archivos notariales documentan contratos y transmisiones de propiedad.',
  ]);
  assert.equal(vectors.length, 3);
  assert.ok(vectors.every((vector) => Array.isArray(vector) && vector.length === 1024), 'BGE-M3 must return three 1024-dimensional vectors');
  assert.ok(vectors.every((vector) => vector.every(Number.isFinite)), 'all embedding coordinates must be finite');

  const course = org.createStudyCourse({ name: 'Métodos históricos' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Fuentes y datación' });
  const dendro = org.createStudyDocument({
    title: 'Datación de edificios',
    contentMarkdown: '# Cronología de la madera\n\nLa dendrocronología fecha construcciones mediante los anillos de crecimiento conservados en sus vigas.',
    placement: { courseId: course.id, subjectId: subject.id },
  });
  org.createStudyDocument({
    title: 'Metabolismo vegetal',
    contentMarkdown: '# Fotosíntesis\n\nLa clorofila transforma energía lumínica en energía química durante la fotosíntesis.',
    placement: { courseId: course.id, subjectId: subject.id },
  });
  org.createStudyDocument({
    title: 'Protocolos notariales',
    contentMarkdown: '# Documentación jurídica\n\nLos protocolos registran contratos, deudas y transmisiones de propiedad.',
    placement: { courseId: course.id, subjectId: subject.id },
  });

  const rebuilt = await search.rebuildStudySearchIndex();
  assert.equal(rebuilt.state, 'ready');
  assert.ok(rebuilt.indexedEntries >= 3);
  assert.equal(rebuilt.embeddedEntries, rebuilt.indexedEntries, 'every eligible RAG fragment must receive an embedding');
  assert.equal(rebuilt.modelProvider, 'openrouter');
  assert.equal(rebuilt.modelName, 'baai/bge-m3');

  const semantic = await search.searchStudyCorpus('¿Cómo fechar un edificio antiguo usando los árboles?', { subjectId: subject.id });
  assert.equal(semantic.semanticAvailable, true);
  assert.equal(semantic.results[0]?.sourceId, dendro.id, 'semantic retrieval must rank the relevant document first');
  assert.ok((semantic.results[0]?.score.semantic ?? 0) > 0.35);

  const crossLanguage = await search.retrieveStudyAssistantEntries(
    'How can tree rings be used to date an old building?',
    { subjectId: subject.id },
    [],
    1,
  );
  assert.equal(crossLanguage[0]?.sourceId, dendro.id, 'multilingual assistant retrieval must preserve semantic relevance');

  database.closeDb();
  console.log(JSON.stringify({
    provider: rebuilt.modelProvider,
    model: rebuilt.modelName,
    dimensions: vectors[0].length,
    indexed: rebuilt.indexedEntries,
    embedded: rebuilt.embeddedEntries,
    semanticTop1: true,
    multilingualTop1: true,
  }));
} finally {
  fs.rmSync(userDataPath, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-audit', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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
