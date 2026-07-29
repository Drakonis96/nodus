// La promesa que sostiene el vault de Testimonios, contra una bóveda REAL:
//
//   UNA ENTREVISTA RESTRINGIDA NO PUEDE SALIR NI POR IA NI POR EXPORTACIÓN PÚBLICA.
//
// Es la única prueba que importa de la fase 8. Todo lo demás del vertical puede fallar y
// arreglarse; esto, si falla, ya ha ocurrido: el material salió y no vuelve.
//
// Se ejercita el camino COMPLETO — repositorio, puerta de acceso, contexto de IA y los
// tres paquetes de exportación — porque la puerta puede ser perfecta y aun así ser
// inútil si un exportador la rodea.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-testimony-privacy')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-testimony-privacy.mjs'), '--electron-testimony-privacy'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-testimony-privacy-'));
installRuntimeHooks(root);

const REAL_NAME = 'Carmen Ruiz Salas';
const PUBLIC_NAME = 'Carmen R.';
const SECRET_LINE = 'A mi hermano lo detuvieron en el cuartel de la carretera.';

try {
  require(path.join(repoRoot, 'electron/db/database.ts')).getDb();
  const repo = require(path.join(repoRoot, 'electron/db/testimonyRepo.ts'));
  const participants = require(path.join(repoRoot, 'electron/db/testimonyParticipantRepo.ts'));
  const media = require(path.join(repoRoot, 'electron/db/testimonyMediaRepo.ts'));
  const analysis = require(path.join(repoRoot, 'electron/db/testimonyAnalysisRepo.ts'));
  const exporter = require(path.join(repoRoot, 'electron/export/testimonyExport.ts'));
  const aiContext = require(path.join(repoRoot, 'electron/ai/testimonyChatContext.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));

  // ── Un corpus mínimo con los cuatro casos que importan ────────────────────
  const carmen = participants.createParticipant({
    workingName: REAL_NAME,
    publicName: PUBLIC_NAME,
    identityMode: 'pseudonym',
  });

  const make = (title, agreement) => {
    const interview = repo.createInterview({ title, narratorIds: [carmen.personId] });
    repo.saveAgreement({ interviewId: interview.id, ...agreement });
    const session = repo.createSession({ interviewId: interview.id });
    const imported = media.importMedia({
      sessionId: session.id,
      fileName: `${title}.wav`,
      mimeType: 'audio/wav',
      bytes: Buffer.from(`audio de ${title}`),
      durationSeconds: 600,
    });
    const transcript = media.createTranscript({
      mediaId: imported.media.id,
      kind: 'approved',
      status: 'ready',
      language: 'es',
      contentMarkdown: SECRET_LINE,
      segments: [{ tStart: 0, tEnd: 8, text: SECRET_LINE, speakerPersonId: carmen.personId }],
    });
    return { interview, media: imported.media, transcript };
  };

  const open = make('Abierta', {
    status: 'documented', accessLevel: 'open',
    allowedUses: ['research', 'publication', 'ai_processing'],
  });
  const restricted = make('Restringida', {
    status: 'documented', accessLevel: 'restricted',
    allowedUses: ['research', 'publication', 'ai_processing'],
  });
  const embargoed = make('Embargada', {
    status: 'documented', accessLevel: 'embargoed', embargoUntil: '2099-01-01T00:00:00Z',
    allowedUses: ['research', 'publication', 'ai_processing'],
  });
  const withdrawn = make('Retirada', { status: 'documented', accessLevel: 'open', allowedUses: ['research', 'publication', 'ai_processing'] });
  repo.saveAgreement({ interviewId: withdrawn.interview.id, status: 'withdrawn' });
  const pending = repo.createInterview({ title: 'Sin acuerdo', narratorIds: [carmen.personId] });

  // ── 1. La puerta de acceso, entrevista a entrevista ───────────────────────
  const { evaluateAccess } = require(path.join(repoRoot, 'shared/testimonyAccess.ts'));
  // La política sale de los AJUSTES DE LA BÓVEDA, igual que en producción: pasarla a mano
  // en el test habría escondido justo lo que la sección 6 comprueba.
  const decide = (interviewId, channel, policy) =>
    evaluateAccess(repo.accessContextFor(interviewId), channel, {
      policy: policy ?? { allowExternalProviders: settings.getSettings().testimonyAllowExternalProviders },
    });

  // La abierta pasa por todos los canales locales.
  assert.equal(decide(open.interview.id, 'localAi').allowed, true);
  assert.equal(decide(open.interview.id, 'accessExport').allowed, true);

  // La restringida se ve y se analiza en local, pero NO sale en un paquete de consulta.
  assert.equal(decide(restricted.interview.id, 'localSearch').allowed, true);
  assert.equal(decide(restricted.interview.id, 'localAi').allowed, true);
  assert.equal(decide(restricted.interview.id, 'accessExport').reason, 'access_restricted');

  // La embargada no sale por NINGÚN canal de salida, ni siquiera con uso documentado.
  for (const channel of ['localAi', 'externalAi', 'accessExport', 'embeddingIndex']) {
    assert.equal(decide(embargoed.interview.id, channel).allowed, false, channel);
  }
  // Pero sí puede prepararse su copia de revisión: el embargo protege del público, no de
  // la propia narradora.
  assert.equal(decide(embargoed.interview.id, 'reviewExport').allowed, true);

  // La retirada cierra TODO menos mirarla en local.
  assert.equal(decide(withdrawn.interview.id, 'localSearch').allowed, true);
  for (const channel of ['localAi', 'externalAi', 'accessExport', 'preservationExport', 'reviewExport', 'embeddingIndex']) {
    assert.equal(decide(withdrawn.interview.id, channel).reason, 'agreement_withdrawn', channel);
  }

  // Sin acuerdo documentado no sale nada salvo al archivo.
  assert.equal(decide(pending.id, 'localAi').reason, 'agreement_pending');
  assert.equal(decide(pending.id, 'accessExport').reason, 'agreement_pending');
  assert.equal(decide(pending.id, 'preservationExport').allowed, true);

  // El proveedor externo está cerrado por el ajuste del vault aunque el acuerdo lo abra…
  assert.equal(decide(open.interview.id, 'externalAi').reason, 'vault_external_disabled');
  // …y aun abriéndolo, exige que el acuerdo documente el envío fuera del equipo.
  const openPolicy = { allowExternalProviders: true };
  assert.equal(decide(open.interview.id, 'externalAi', openPolicy).reason, 'external_not_documented');

  // ── 2. La IA solo ve lo que el acuerdo autoriza ───────────────────────────
  {
    const context = aiContext.buildTestimonyChatContext('cuartel carretera hermano detuvieron', { vaultName: 'Memoria' });
    const serialized = JSON.stringify(context);
    const titles = context.interviews.map((entry) => entry.title).sort();
    assert.deepEqual(titles, ['Abierta', 'Restringida'], 'solo llegan al prompt las que el acuerdo permite');
    // Ni el título de las bloqueadas aparece.
    for (const forbidden of ['Embargada', 'Retirada', 'Sin acuerdo']) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} no puede aparecer NI SIQUIERA por su título`);
    }
    // El nombre real NUNCA, y el seudónimo SIEMPRE.
    assert.ok(!serialized.includes(REAL_NAME), 'el nombre real bajo seudónimo no llega a un prompt');
    assert.ok(serialized.includes(PUBLIC_NAME));
    // Toda cita viene montada con hablante, entrevista y minuto.
    const abierta = context.interviews.find((entry) => entry.title === 'Abierta');
    assert.match(abierta.passages[0].cite, /Carmen R\., Abierta, 00:00:00/);
    // Y el modelo sabe que hay material fuera de su alcance: si no, respondería como si el
    // corpus fuera lo que ve.
    assert.ok(context.withheld.length > 0);
    assert.ok(context.withheld.some((entry) => entry.reason === 'agreement_withdrawn'));
  }

  // Con proveedor externo y el ajuste cerrado, el contexto se queda VACÍO.
  {
    const context = aiContext.buildTestimonyChatContext('cuartel', { vaultName: 'Memoria', channel: 'externalAi' });
    assert.deepEqual(context.interviews, [], 'nada sale del equipo mientras el vault tenga cerrados los proveedores externos');
    assert.ok(context.withheld.some((entry) => entry.reason === 'vault_external_disabled'));
  }

  // ── 3. La exportación no rodea la puerta ──────────────────────────────────
  const allIds = [open.interview.id, restricted.interview.id, embargoed.interview.id, withdrawn.interview.id, pending.id];

  const readZip = (buffer) => {
    const zip = new AdmZip(buffer);
    const entries = new Map(zip.getEntries().map((entry) => [entry.entryName, entry.getData()]));
    return { entries, text: [...entries.entries()].map(([name, data]) => `${name}\n${data.toString('utf8')}`).join('\n') };
  };

  // Paquete de CONSULTA: solo la abierta.
  {
    const { zip, result } = exporter.buildTestimonyPackage({ kind: 'access', interviewIds: allIds });
    const { entries, text } = readZip(zip);
    assert.equal(result.interviews, 1);
    assert.deepEqual(result.excluded.map((entry) => entry.title).sort(), ['Embargada', 'Restringida', 'Retirada', 'Sin acuerdo']);
    // Y cada exclusión dice POR QUÉ: un exportador que descarte en silencio produce
    // paquetes que parecen completos y no lo son.
    for (const entry of result.excluded) assert.ok(entry.reason.length > 10, entry.title);

    assert.ok(!text.includes(REAL_NAME), 'el nombre real no viaja en un paquete de consulta');
    assert.ok(text.includes(PUBLIC_NAME));
    for (const forbidden of ['Restringida', 'Embargada', 'Retirada']) {
      assert.ok(![...entries.keys()].some((name) => name.includes(forbidden)), forbidden);
    }
    // Sin originales: el paquete de consulta lleva copias de acceso, y aquí no hay ninguna.
    assert.ok(![...entries.keys()].some((name) => name.includes('media/master')), 'un maestro no sale en un paquete de consulta');
    // Con sus sumas de comprobación, que es lo que permite verificarlo en veinte años.
    assert.ok(entries.has('checksums.sha256'));
    assert.ok(entries.has('manifest.json'));
    assert.match(entries.get('README.md').toString('utf8'), /no garantiza el anonimato/);
  }

  // Paquete de PRESERVACIÓN: todo menos lo retirado.
  {
    const { zip, result } = exporter.buildTestimonyPackage({ kind: 'preservation', interviewIds: allIds });
    const { entries, text } = readZip(zip);
    assert.equal(result.interviews, 4, 'al archivo va todo menos lo retirado');
    assert.deepEqual(result.excluded.map((entry) => entry.title), ['Retirada']);
    assert.ok([...entries.keys()].some((name) => name.includes('media/master')), 'el archivo sí lleva los originales');
    assert.ok(!text.includes(REAL_NAME), 'ni siquiera el paquete de preservación lleva el nombre real bajo seudónimo');

    // Las sumas de comprobación cubren TODOS los archivos y coinciden de verdad.
    const checksums = entries.get('checksums.sha256').toString('utf8').trim().split('\n');
    assert.equal(checksums.length, entries.size - 1, 'toda entrada menos el propio checksums lleva su huella');
    const crypto = require('node:crypto');
    for (const line of checksums) {
      const [digest, name] = line.split('  ');
      const data = entries.get(name);
      assert.ok(data, name);
      assert.equal(crypto.createHash('sha256').update(data).digest('hex'), digest, name);
    }
  }

  // Paquete de REVISIÓN: la copia para la narradora, sin análisis.
  {
    analysis.createAnnotation({
      interviewId: open.interview.id,
      transcriptId: open.transcript.id,
      tStart: 0,
      tEnd: 8,
      quoteSnapshot: SECRET_LINE,
      memo: 'ESTA ES UNA NOTA ANALITICA PRIVADA',
    });
    const { zip } = exporter.buildTestimonyPackage({ kind: 'review', interviewIds: [open.interview.id] });
    const { text } = readZip(zip);
    assert.ok(text.includes(SECRET_LINE), 'la narradora sí ve su propia transcripción');
    assert.ok(!text.includes('ESTA ES UNA NOTA ANALITICA PRIVADA'), 'y ninguna interpretación del investigador');
    assert.match(text, /Esta copia es para tu revisión/);
  }

  // ── 4. El literal no sale a terceros ni a la propia narradora ─────────────
  {
    const literalOnly = repo.createInterview({ title: 'Solo literal' });
    repo.saveAgreement({
      interviewId: literalOnly.id, status: 'documented', accessLevel: 'open',
      allowedUses: ['research', 'publication'],
    });
    const session = repo.createSession({ interviewId: literalOnly.id });
    const imported = media.importMedia({ sessionId: session.id, fileName: 'literal.wav', mimeType: 'audio/wav', bytes: Buffer.from('bytes'), durationSeconds: 60 });
    media.createTranscript({
      mediaId: imported.media.id, kind: 'machine_literal', status: 'ready',
      contentMarkdown: 'lo q el modelo creyo oir',
      segments: [{ tStart: 0, tEnd: 5, text: 'lo q el modelo creyo oir' }],
    });
    const { zip } = exporter.buildTestimonyPackage({ kind: 'access', interviewIds: [literalOnly.id] });
    const { text } = readZip(zip);
    assert.ok(!text.includes('lo q el modelo creyo oir'),
      'el literal es la hipótesis del modelo, no palabras del narrador: no sale a un tercero');
  }

  // ── 5. El inventario de copia sabe cuántas horas y cuántos bytes ─────────
  {
    const inventory = exporter.testimonyBackupInventory();
    assert.equal(inventory.interviews, 6);
    assert.equal(inventory.participants, 1);
    assert.ok(inventory.mediaFiles >= 5);
    assert.ok(inventory.mediaBytes > 0, 'los bytes son lo que distingue restaurar de restaurar completo');
    assert.ok(inventory.agreements >= 6);
  }

  // ── 6. El ajuste del vault puede cerrar, nunca abrir ─────────────────────
  {
    settings.updateSettings({ testimonyAllowExternalProviders: true });
    // Ahora el ajuste está abierto, pero la restringida sigue sin uso externo documentado.
    assert.equal(decide(restricted.interview.id, 'externalAi').reason, 'external_not_documented');
    // Y una con el uso documentado sí puede, PIDIENDO CONFIRMACIÓN cada vez.
    repo.saveAgreement({
      interviewId: open.interview.id,
      allowedUses: ['research', 'publication', 'ai_processing', 'external_processing'],
    });
    const decision = decide(open.interview.id, 'externalAi');
    assert.equal(decision.allowed, true);
    assert.equal(decision.requiresConfirmation, true);
    assert.equal(decision.requiresPseudonymization, true, 'y el material sale con el seudónimo');
  }

  console.log('Testimony privacy test passed!');
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
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
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
