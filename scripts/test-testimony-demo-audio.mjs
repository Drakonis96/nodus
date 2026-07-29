// El audio de la demo de Testimonios y su guion, que tienen que decir lo mismo.
//
// Esta prueba existe porque el desajuste es INVISIBLE mirando la aplicación: si alguien
// corrige una frase del guion y no regenera el audio, la demo sigue funcionando, sigue
// sonando y sigue enseñando una transcripción — solo que la voz dice otra cosa. Y si los
// tiempos del manifiesto no son los que se siembran, el «volver al minuto» de una cita
// lleva al sitio equivocado, que es exactamente lo que este vault promete que no pasa.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-demo-audio-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-testimony-demo-audio.mjs'), '--electron-demo-audio-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-demo-audio-'));
installRuntimeHooks(root);

const ASSET_DIR = path.join(repoRoot, 'electron/assets/testimonios-demo');

try {
  const { TESTIMONY_DEMO_SCRIPT } = require(path.join(repoRoot, 'electron/db/testimonyDemoScript.ts'));
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSET_DIR, 'manifest.json'), 'utf8'));

  // ── 1. Un archivo por entrevista con audio y por idioma, y ninguno de sobra ──
  const expected = TESTIMONY_DEMO_SCRIPT
    .filter((interview) => interview.hasAudio)
    .flatMap((interview) => ['es', 'en'].map((language) => `${interview.key}.${language}`));
  const actual = manifest.entries.map((entry) => `${entry.key}.${entry.language}`);
  assert.deepEqual(actual.slice().sort(), expected.slice().sort(),
    'el manifiesto cubre exactamente las entrevistas con audio, en los dos idiomas');

  for (const entry of manifest.entries) {
    const script = TESTIMONY_DEMO_SCRIPT.find((interview) => interview.key === entry.key);

    // ── 2. Un turno de audio por turno de guion ───────────────────────────────
    assert.equal(entry.turns.length, script.turns.length,
      `${entry.file}: el audio tiene ${entry.turns.length} turnos y el guion ${script.turns.length}`);

    // ── 3. El audio dice LO QUE DICE EL GUION ────────────────────────────────
    const spoken = crypto.createHash('sha256')
      .update(script.turns.map((turn) => `${turn.person}: ${turn[entry.language]}`).join('\n'))
      .digest('hex');
    assert.equal(spoken, entry.textSha256,
      `${entry.file}: el guion cambió y el audio no se regeneró — la voz dice una cosa y la transcripción otra`);

    // ── 4. El archivo existe, es el que dice el manifiesto y suena de verdad ──
    const bytes = fs.readFileSync(path.join(ASSET_DIR, entry.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256,
      `${entry.file}: la huella no coincide — el audio se regeneró sin actualizar el manifiesto`);
    assert.equal(bytes.byteLength, entry.sizeBytes, `${entry.file}: tamaño`);
    const isMp3 = bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    assert.ok(isMp3, `${entry.file}: no es un MP3`);
    assert.ok(entry.durationSeconds > 5, `${entry.file}: dura ${entry.durationSeconds}s, no puede ser habla`);

    // ── 5. Los tiempos van hacia delante y no se solapan ─────────────────────
    let previousEnd = -1;
    for (const [index, turn] of entry.turns.entries()) {
      assert.ok(turn.start >= previousEnd, `${entry.file}: el turno ${index} empieza antes de acabar el anterior`);
      assert.ok(turn.end > turn.start, `${entry.file}: el turno ${index} no dura nada`);
      previousEnd = turn.end;
    }
    assert.ok(previousEnd <= entry.durationSeconds + 0.1,
      `${entry.file}: el último turno acaba después del final del audio`);

    // ── 6. Una voz por PERSONA, y la misma en todas sus entrevistas ──────────
    for (const turn of script.turns) {
      assert.ok(entry.voices[turn.person], `${entry.file}: falta la voz de ${turn.person}`);
    }
  }

  // Carmen habla en su entrevista y en la grupal: si sonara distinta, la demo dejaría de
  // servir para probar que se reconoce a la misma persona entre entrevistas.
  for (const language of ['es', 'en']) {
    const carmenOwn = manifest.entries.find((entry) => entry.key === 'carmen' && entry.language === language);
    const group = manifest.entries.find((entry) => entry.key === 'grupal' && entry.language === language);
    assert.equal(group.voices.carmen, carmenOwn.voices.carmen,
      `Carmen suena distinta en la grupal (${language})`);
    assert.notEqual(group.voices.rosario, group.voices.carmen,
      `las dos mujeres de la grupal comparten voz (${language})`);
  }

  // ── 7. Lo sembrado apunta al minuto REAL ─────────────────────────────────
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { seedTestimonyDemoData } = require(path.join(repoRoot, 'electron/db/testimonyDemoData.ts'));
  vaults.setVaultType(vaults.getActiveVault().id, 'testimonios');
  assert.equal(seedTestimonyDemoData(), true);
  const db = getDb();

  const spanish = manifest.entries.filter((entry) => entry.language === 'es');
  for (const entry of spanish) {
    const rows = db.prepare(`
      SELECT s.t_start AS start, s.t_end AS end, s.position AS position
        FROM testimony_transcript_segments s
        JOIN testimony_transcripts t ON t.id = s.transcript_id
       WHERE t.media_id = ? AND t.kind = 'reviewed'
       ORDER BY s.position
    `).all(`demo-tst-m-${entry.key}`);
    assert.equal(rows.length, entry.turns.length, `${entry.key}: segmentos sembrados`);
    for (const [index, row] of rows.entries()) {
      assert.ok(Math.abs(row.start - entry.turns[index].start) < 0.01,
        `${entry.key}: el segmento ${index} se siembra en ${row.start}s y el audio lo dice en ${entry.turns[index].start}s`);
      assert.ok(Math.abs(row.end - entry.turns[index].end) < 0.01, `${entry.key}: fin del segmento ${index}`);
    }
  }

  // Y el maestro sembrado es el archivo empaquetado, no un tono.
  const media = db.prepare("SELECT mime_type AS mime, size_bytes AS size, technical_json AS technical FROM testimony_media WHERE id = 'demo-tst-m-carmen'").get();
  assert.equal(media.mime, 'audio/mpeg');
  assert.equal(media.size, spanish.find((entry) => entry.key === 'carmen').sizeBytes);
  const technical = JSON.parse(media.technical);
  assert.equal(technical.sintetico, true, 'la demo dice que la voz es sintética');
  assert.ok(technical.voces?.carmen, 'y dice qué voz presta cada persona');

  console.log('Testimony demo audio tests passed!');
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
      },
    });
    module._compile(output.outputText, filename);
  };
}
