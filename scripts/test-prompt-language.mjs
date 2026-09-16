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
    { lang: 'en', name: 'ENGLISH', heading: 'OUTPUT LANGUAGE — HIGHEST PRIORITY' },
    { lang: 'fr', name: 'FRANÇAIS', heading: 'LANGUE DE SORTIE — PRIORITÉ ABSOLUE' },
    { lang: 'tr', name: 'TÜRKÇE', heading: 'ÇIKTI DİLİ — EN YÜKSEK ÖNCELİK' },
    { lang: 'de', name: 'DEUTSCH', heading: 'AUSGABESPRACHE — HÖCHSTE PRIORITÄT' },
    { lang: 'pt', name: 'PORTUGUÊS EUROPEU', heading: 'IDIOMA DE SAÍDA — PRIORIDADE MÁXIMA' },
    { lang: 'pt-BR', name: 'PORTUGUÊS DO BRASIL', heading: 'IDIOMA DE SAÍDA — PRIORIDADE MÁXIMA' },
    { lang: 'it', name: 'ITALIANO', heading: 'LINGUA DI OUTPUT — PRIORITÀ MASSIMA' },
    { lang: 'zh-Hans', name: '简体中文', heading: '输出语言 — 最高优先级' },
    { lang: 'zh-Hant', name: '繁體中文', heading: '輸出語言 — 最高優先級' },
    { lang: 'vi', name: 'TIẾNG VIỆT', heading: 'NGÔN NGỮ ĐẦU RA — ƯU TIÊN CAO NHẤT' },
    { lang: 'ja', name: '日本語', heading: '出力言語 — 最優先' },
    { lang: 'ru', name: 'РУССКИЙ', heading: 'ЯЗЫК ВЫВОДА — НАИВЫСШИЙ ПРИОРИТЕТ' },
    { lang: 'uk', name: 'УКРАЇНСЬКА', heading: 'МОВА ВИВЕДЕННЯ — НАЙВИЩИЙ ПРІОРИТЕТ' },
    { lang: 'ko', name: '한국어', heading: '출력 언어 — 최우선 순위' },
  ];
  for (const { lang, name, heading } of cases) {
    updateSettings({ promptLanguage: lang });
    const out = withPromptLanguage({ system: BASE }).system;
    const skillPrompt = withPromptLanguage({ system: BASE, englishImagePrompts: true }).system;
    assert.match(skillPrompt, /prompt field is an internal production instruction and MUST be written in English/);
    assert.ok(skillPrompt.indexOf('IMAGE TOOL PROTOCOL EXCEPTION') > skillPrompt.indexOf('═══'));

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
    assert.ok(out.includes(heading), `${lang}: must append the localized priority directive`);
    assert.ok(out.includes(name), `${lang}: directive must name the target language (${name})`);
    // The directive must explicitly supersede the inline Spanish instruction.
    assert.match(out, /free-text|texte libre|freien Text|texto livre|testo libero|serbest metin|自由文本|自由文字|văn bản tự do|自由記述|свободного текста|вільного тексту|자유 텍스트/i, `${lang}: directive must override prior language instructions`);
  }

  // Unknown/undefined prompt language must not throw and must fall back to no directive.
  updateSettings({ promptLanguage: undefined });
  assert.equal(withPromptLanguage({ system: BASE }).system, BASE, 'undefined language falls back to es (no directive)');

  // The document-profile pack is the pipeline that came back in English for Spanish prompts:
  // for 'es' no directive is appended, and unlike the rest of the app's Spanish prompts this
  // pack never said which language to write in — 2 of 9 profiles of a live run followed the
  // source document instead of the setting. Every prompt of its Spanish half states it now,
  // and every language names its own where the composed prompt is built.
  const { documentProfilePromptPack } = require(path.join(repoRoot, 'shared/academicPromptPacks.ts'));
  const spanishPack = documentProfilePromptPack('es');
  for (const field of ['section', 'reduce', 'sectionAudit', 'profile', 'audit', 'repair']) {
    assert.match(spanishPack[field], /español/, `es pack: ${field} must state the output language`);
  }
  for (const field of ['section', 'reduce', 'sectionAudit', 'profile', 'repair']) {
    assert.match(
      spanishPack[field],
      /no traduzcas|sin traducir|tal cual/,
      `es pack: ${field} must keep quotes in the source language`
    );
  }
  for (const [lang, name] of [['es', 'español'], ['en', 'ENGLISH'], ['ko', '한국어'], ['de', 'DEUTSCH']]) {
    updateSettings({ promptLanguage: lang });
    const composed = withPromptLanguage({ system: documentProfilePromptPack(lang).profile }).system;
    assert.ok(composed.includes(name), `${lang}: the composed profile prompt must name ${name}`);
  }

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
