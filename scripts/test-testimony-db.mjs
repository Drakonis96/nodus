// El esquema y los repositorios de Testimonios (v119/v120) contra una bóveda REAL migrada.
//
// El criterio de salida de la fase 2 es que se pueda crear, editar, cerrar, reabrir,
// archivar y restaurar una entrevista con participantes y acuerdo SIN el renderer. Eso es
// lo que se ejercita aquí, más las tres propiedades que sólo una base de datos de verdad
// puede desmentir:
//
//   1. La migración conserva sus DOS caminos de reparación (CREATE-only, sin cascadas).
//   2. Existe exactamente UN acuerdo vigente por entrevista, impuesto por la base.
//   3. Borrar una entrevista no deja huérfanos, porque no hay claves foráneas que lo
//      hagan por nosotros.

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

if (!process.argv.includes('--electron-testimony-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-testimony-db.mjs'), '--electron-testimony-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-testimony-test-'));
installRuntimeHooks(root);

const NEW_TABLES = [
  'testimony_interviews',
  'testimony_participant_profiles',
  'testimony_interview_participants',
  'testimony_sessions',
  'testimony_media',
  'testimony_transcripts',
  'testimony_transcript_segments',
  'testimony_codes',
  'testimony_annotations',
  'testimony_annotation_codes',
  'testimony_agreements',
  'testimony_contrasts',
  'testimony_contrast_items',
  'testimony_note_links',
];

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION, migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = getDb();

  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 120, 'Testimonios llegó en la v119 y su índice semántico en la v120');

  // ── 0. La migración conserva sus dos caminos de reparación ────────────────
  {
    const migration = migrations.find((m) => m.version === 119);
    assert.ok(migration, 'existe la migración 119');
    assert.ok(!migration.up.includes('`'), 'un backtick cerraría la plantilla en silencio');
    const bare = migration.up.replace(/--[^\n]*/g, ' ');
    // La palabra de borrado de SQL en el cuerpo — que es lo que lleva una cascada —
    // descalifica la migración de backfillMissingCreateOnly Y del reintento por
    // "table already exists".
    assert.doesNotMatch(bare, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i, 'la 119 es CREATE-only');
    assert.doesNotMatch(bare, /REFERENCES/i, 'la propiedad la imponen los repos, no el esquema');
  }

  // ── 1. Las tablas y sus claves ────────────────────────────────────────────
  for (const table of NEW_TABLES) {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(table).c,
      1,
      `${table} existe`
    );
  }
  const keyOf = (table) =>
    db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk').all(table).map((row) => row.name);
  assert.deepEqual(keyOf('testimony_interviews'), ['id']);
  assert.deepEqual(keyOf('testimony_participant_profiles'), ['person_id']);
  assert.deepEqual(keyOf('testimony_interview_participants'), ['interview_id', 'person_id', 'role'],
    'una persona puede tener DOS papeles en la misma entrevista');
  assert.deepEqual(keyOf('testimony_note_links'), ['note_id', 'target_kind', 'target_id']);

  // ── 2. Clasificación de sincronización ────────────────────────────────────
  {
    const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
    const coverage = describeSyncCoverage();
    assert.deepEqual(coverage.unclassified, [], 'ninguna tabla queda sin clasificar');
    assert.deepEqual(coverage.unmergeable, [], 'toda tabla sincronizada tiene identidad de fila');
    // Decisión 18: Testimonios NO se sincroniza hasta demostrar cobertura completa.
    for (const table of NEW_TABLES.filter((name) => name !== 'testimony_note_links')) {
      assert.ok(coverage.excluded.includes(table), `${table} está excluido de la sincronización a propósito`);
    }
    // Los enlaces de notas SÍ viajan: la tabla tolera un destino ausente, y una nota que
    // llega sin sus enlaces sí perdería trabajo.
    assert.ok(coverage.included.notes.includes('testimony_note_links'), 'testimony_note_links viaja con las notas');
  }

  const repo = require(path.join(repoRoot, 'electron/db/testimonyRepo.ts'));
  const participants = require(path.join(repoRoot, 'electron/db/testimonyParticipantRepo.ts'));
  const media = require(path.join(repoRoot, 'electron/db/testimonyMediaRepo.ts'));
  const analysis = require(path.join(repoRoot, 'electron/db/testimonyAnalysisRepo.ts'));
  const contrasts = require(path.join(repoRoot, 'electron/db/testimonyContrastRepo.ts'));
  const links = require(path.join(repoRoot, 'electron/db/noteLinksRepo.ts'));

  // ── 3. Participantes: la capa sobre `persons`, sin vocabulario genealógico ─
  const carmen = participants.createParticipant({
    workingName: 'Carmen Ruiz Salas',
    publicName: 'Carmen R.',
    identityMode: 'pseudonym',
    biographicalNote: 'Nacida en el valle en 1931.',
  });
  const jorge = participants.createParticipant({ workingName: 'Jorge P.', identityMode: 'identified' });
  assert.equal(carmen.workingName, 'Carmen Ruiz Salas');
  assert.equal(carmen.identityMode, 'pseudonym');
  // La fila vive en `persons`: es la ontología compartida, no una tabla nueva de gente.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM persons WHERE person_id = ?').get(carmen.personId).c, 1);

  // ── 4. Crear una entrevista: nace con acuerdo pendiente y privado ──────────
  const interview = repo.createInterview({
    title: 'Entrevista a Carmen R. — 1992',
    interviewKind: 'life_history',
    narratorIds: [carmen.personId],
    interviewerIds: [jorge.personId],
    scheduledAt: '2026-09-10T10:00:00.000Z',
    language: 'es',
    collectionLabel: 'Memoria del valle',
  });
  assert.equal(interview.shortId, 'INT-0001');
  assert.equal(interview.workflowStatus, 'preparation');

  const agreement = repo.currentAgreement(interview.id);
  assert.ok(agreement, 'toda entrevista nace con una fila de acuerdo');
  assert.equal(agreement.status, 'pending');
  assert.equal(agreement.accessLevel, 'private', 'el hueco entre crear y documentar es restrictivo');
  assert.deepEqual(agreement.allowedUses, []);

  // El nombre que sale ya está resuelto contra el acuerdo: seudónimo, no nombre real.
  const people = repo.listParticipants(interview.id);
  const narrator = people.find((p) => p.role === 'narrator');
  assert.equal(narrator.workingName, 'Carmen Ruiz Salas');
  assert.equal(narrator.displayName, 'Carmen R.');
  assert.equal(narrator.isPrimary, true);

  // ── 5. El acuerdo se VERSIONA, y solo hay uno vigente ─────────────────────
  repo.saveAgreement({
    interviewId: interview.id,
    status: 'documented',
    accessLevel: 'restricted',
    allowedUses: ['research', 'teaching'],
    narratorReviewRequired: true,
  });
  // Cambiar solo el nivel no puede vaciar los usos que el narrador autorizó.
  const second = repo.saveAgreement({ interviewId: interview.id, accessLevel: 'embargoed', embargoUntil: '2030-01-01T00:00:00Z' });
  assert.equal(second.versionNo, 3);
  assert.equal(second.status, 'documented', 'el estado se hereda');
  assert.deepEqual(second.allowedUses, ['research', 'teaching'], 'los usos se heredan');
  assert.equal(second.accessLevel, 'embargoed');

  const history = repo.agreementHistory(interview.id);
  assert.equal(history.length, 3, 'el acuerdo no se sobrescribe: se versiona');
  assert.equal(history.filter((row) => row.isCurrent).length, 1);
  // Y el índice único parcial lo impone la BASE, no la disciplina del repositorio.
  assert.throws(
    () => db.prepare(
      "INSERT INTO testimony_agreements (id, interview_id, version_no, is_current, status, access_level, attribution_mode, allowed_uses_json, narrator_review_required, narrator_review_status, created_at, updated_at) VALUES ('x', ?, 99, 1, 'documented', 'open', 'real_name', '[]', 0, 'not_started', '', '')"
    ).run(interview.id),
    /UNIQUE|constraint/i,
    'la base rechaza un segundo acuerdo vigente'
  );

  // ── 6. Sesiones, archivos y el original inmutable ─────────────────────────
  const session = repo.createSession({ interviewId: interview.id, title: 'Primera sesión', locationText: 'Casa de Carmen' });
  assert.equal(session.sequenceNo, 1);
  assert.equal(session.shortId, 'SES-0001');
  const second1 = repo.createSession({ interviewId: interview.id, title: 'Segunda sesión' });
  assert.equal(second1.sequenceNo, 2);
  assert.throws(
    () => db.prepare("INSERT INTO testimony_sessions (id, short_id, interview_id, sequence_no, status, created_at, updated_at) VALUES ('dup', 'SES-9999', ?, 1, 'planned', '', '')").run(interview.id),
    /UNIQUE|constraint/i,
    'dos sesiones no pueden compartir número dentro de una entrevista'
  );

  const audio = Buffer.from('RIFF....WAVEfmt fake audio bytes for the test');
  const imported = media.importMedia({ sessionId: session.id, fileName: 'carmen-01.wav', mimeType: 'audio/wav', bytes: audio, durationSeconds: 3600 });
  assert.equal(imported.duplicateOf, null);
  assert.equal(imported.media.immutable, true, 'un maestro se marca inmutable en la fila');
  assert.equal(imported.media.contentHash.length, 64, 'SHA-256');
  // Importarlo dos veces en la misma sesión no duplica cientos de megabytes.
  const again = media.importMedia({ sessionId: session.id, fileName: 'carmen-01.wav', mimeType: 'audio/wav', bytes: audio });
  assert.equal(again.duplicateOf, imported.media.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_media').get().c, 1);
  // Un archivo vacío no es un archivo.
  assert.throws(() => media.importMedia({ sessionId: session.id, fileName: 'x.wav', mimeType: 'audio/wav', bytes: Buffer.alloc(0) }), /vacío/);

  // La huella verifica los BYTES REALES, que es lo que convierte «tengo el original» en
  // «tengo el original íntegro».
  assert.equal(media.verifyMediaHash(imported.media.id).ok, true);
  db.prepare('UPDATE testimony_media SET content_blob = ? WHERE id = ?').run(Buffer.from('otra cosa'), imported.media.id);
  assert.equal(media.verifyMediaHash(imported.media.id).ok, false, 'la corrupción silenciosa se detecta');
  db.prepare('UPDATE testimony_media SET content_blob = ? WHERE id = ?').run(audio, imported.media.id);

  // Y el blob NUNCA viaja con una lista.
  const sessions = repo.listSessions(interview.id);
  assert.equal(sessions.length, 2);
  const listedMedia = sessions[0].media[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(listedMedia, 'contentBlob'), 'ni un byte de audio viaja con la lista de sesiones');
  assert.equal(listedMedia.sizeBytes, audio.length);

  // ── 7. Transcripciones: el literal no se toca, se deriva ──────────────────
  const literal = media.createTranscript({
    mediaId: imported.media.id,
    kind: 'machine_literal',
    language: 'es',
    modelProvider: 'local',
    modelName: 'whisper-small',
    segments: [
      { tStart: 0, tEnd: 12, text: 'Mi padre se marchó en el cuarenta y siete.', speakerLabel: 'Hablante 1' },
      { tStart: 12, tEnd: 25, text: 'Nunca volvimos a saber de él.', speakerLabel: 'Hablante 1' },
      { tStart: 25, tEnd: 31, text: '¿Y su madre?', speakerLabel: 'Hablante 2' },
    ],
  });
  assert.equal(literal.versionNo, 1);
  assert.equal(literal.segmentCount, 3);

  const segments = media.listSegments(literal.id);
  assert.throws(
    () => media.updateSegment(segments[0].id, { text: 'reescrito' }),
    /no se puede editar/i,
    'el literal es inmutable: editarlo destruiría la única copia de lo que dijo el modelo'
  );
  // Aprobar sin revisar saltaría el proceso entero.
  assert.throws(() => media.deriveTranscript(literal.id, 'approved'), /derivar/i);

  const corrected = media.deriveTranscript(literal.id, 'corrected');
  assert.equal(corrected.kind, 'corrected');
  assert.equal(corrected.sourceTranscriptId, literal.id);
  const correctedSegments = media.listSegments(corrected.id);
  assert.equal(correctedSegments.length, 3, 'los segmentos se copian, no se referencian');
  assert.equal(correctedSegments[0].sourceSegmentId, segments[0].id, 'y recuerdan de dónde salieron');
  media.updateSegment(correctedSegments[0].id, { text: 'Mi padre se marchó en el 47.' });
  assert.equal(media.listSegments(literal.id)[0].text, 'Mi padre se marchó en el cuarenta y siete.',
    'corregir la copia NO toca el literal');

  // Atribuir hablantes en lote: es la operación real, y es MANUAL.
  const labels = media.speakerLabels(corrected.id);
  assert.equal(labels.length, 2);
  assert.equal(media.assignSpeaker(corrected.id, 'Hablante 1', carmen.personId), 2);
  assert.equal(media.assignSpeaker(corrected.id, 'Hablante 2', jorge.personId), 1);
  assert.equal(media.listSegments(corrected.id)[0].speakerPersonId, carmen.personId);

  // ── 8. Códigos: catálogo del vault, sin gemelos ───────────────────────────
  const exilio = analysis.createCode({ label: 'Exilio' });
  const gemelo = analysis.createCode({ label: '  exilio ' });
  assert.equal(gemelo.id, exilio.id, 'un gemelo devuelve el código existente en vez de fallar');
  const hambre = analysis.createCode({ label: 'Hambruna de 1946', description: 'Escasez de posguerra' });
  assert.throws(() => analysis.updateCode(hambre.id, { label: 'Exilio' }), /Ya existe/);

  // ── 9. Fragmentos: la cita sale con el nombre que el acuerdo permite ──────
  const annotation = analysis.createAnnotation({
    interviewId: interview.id,
    transcriptId: corrected.id,
    segmentId: correctedSegments[0].id,
    tStart: 0,
    tEnd: 12,
    quoteSnapshot: 'Mi padre se marchó en el 47.',
    memo: 'Primera mención de la partida.',
    codeIds: [exilio.id],
  });
  assert.equal(annotation.shortId, 'ANN-0001');
  assert.equal(annotation.codes.length, 1);

  const fragment = analysis.getFragment(annotation.id);
  assert.equal(fragment.speakerName, 'Carmen R.', 'NUNCA el nombre real bajo seudónimo');
  assert.equal(fragment.accessLevel, 'embargoed');
  assert.equal(fragment.agreementStatus, 'documented');

  // Fusionar dos códigos no pierde ninguna anotación, ni siquiera cuando el fragmento
  // llevaba los dos — que es el caso MÁS probable de una fusión.
  analysis.updateAnnotation(annotation.id, { codeIds: [exilio.id, hambre.id] });
  analysis.mergeCodes(hambre.id, exilio.id);
  const merged = analysis.getAnnotation(annotation.id);
  assert.equal(merged.codes.length, 1);
  assert.equal(merged.codes[0].id, exilio.id);
  assert.equal(analysis.getCode(hambre.id), null);

  // ── 10. Una nota desde un fragmento, con su enlace al minuto exacto ───────
  const note = links.createNoteFromFragment(annotation.id);
  const noteRow = db.prepare('SELECT title, content FROM notes WHERE id = ?').get(note.noteId);
  assert.match(noteRow.content, /Carmen R\./);
  assert.doesNotMatch(noteRow.content, /Carmen Ruiz Salas/, 'una nota tampoco filtra el nombre real');
  assert.match(noteRow.content, /nodus:\/\/testimonios\/interview\//);
  assert.equal(links.listNoteLinks(note.noteId).length, 4, 'fragmento, entrevista, participante y código');

  // ── 11. Contrastes: sin IA, y la ausencia no se convierte en conclusión ───
  const other = repo.createInterview({ title: 'Entrevista a Jorge P.', narratorIds: [jorge.personId] });
  const contrast = contrasts.createContrast({ title: 'La partida', filters: { interviewIds: [interview.id, other.id], codeIds: [exilio.id] } });
  const result = contrasts.runContrast(contrast.filters);
  assert.equal(result.fragments.length, 1);
  assert.deepEqual(result.silentInterviewIds, [other.id], 'la entrevista que no dijo nada se marca como ausencia');
  assert.deepEqual(result.sharedCodeIds, [], 'un código en una sola entrevista no es «compartido»');
  contrasts.pinFragment(contrast.id, annotation.id, true);
  assert.equal(contrasts.getContrast(contrast.id).pinned.length, 1);

  // ── 12. El flujo se PROPONE, no se impone ─────────────────────────────────
  assert.equal(repo.applyProposedStatus(interview.id, 'master_added'), 'recorded');
  repo.updateInterview(interview.id, { workflowStatus: 'completed' });
  assert.equal(repo.applyProposedStatus(interview.id, 'master_added'), null,
    'importar audio en una entrevista terminada no la devuelve a «Grabada»');

  // Archivar y desarchivar, cerrar y reabrir: el criterio de salida de la fase.
  assert.equal(repo.archiveInterview(interview.id, true).workflowStatus, 'archived');
  assert.equal(repo.archiveInterview(interview.id, false).workflowStatus, 'completed');
  assert.equal(repo.trashInterview(interview.id, true).deletedAt != null, true);
  assert.equal(repo.listInterviews().find((row) => row.id === interview.id), undefined, 'la papelera la saca de la lista');
  assert.equal(repo.trashInterview(interview.id, false).deletedAt, null);

  // ── 13. La tabla: nombres resueltos, estado agregado y filtros ────────────
  {
    const rows = repo.listInterviews({ sort: 'updated' });
    assert.equal(rows.length, 2);
    const row = rows.find((entry) => entry.id === interview.id);
    assert.deepEqual(row.narratorNames, ['Carmen R.']);
    assert.equal(row.sessionCount, 2);
    assert.equal(row.mediaCount, 1);
    assert.equal(row.durationSeconds, 3600);
    assert.equal(row.transcriptionState, 'reviewed', 'hay una versión derivada del literal');
    assert.equal(row.annotationCount, 1);
    assert.equal(row.agreement.accessLevel, 'embargoed');

    assert.equal(repo.listInterviews({ filters: { accessLevel: ['embargoed'] } }).length, 1);
    assert.equal(repo.listInterviews({ filters: { codeId: exilio.id } }).length, 1);
    assert.equal(repo.listInterviews({ filters: { personId: jorge.personId } }).length, 2);
    assert.equal(repo.listInterviews({ filters: { collectionLabel: 'Memoria del valle' } }).length, 1);
    assert.deepEqual(repo.interviewFacets().collections, ['Memoria del valle']);
  }

  // ── 14. Borrar de verdad: se enseña el impacto y no queda ni un huérfano ──
  {
    const impact = repo.deletionImpact(interview.id);
    assert.equal(impact.sessions, 2);
    assert.equal(impact.media, 1);
    assert.equal(impact.masterMedia, 1);
    assert.equal(impact.transcripts, 2);
    assert.equal(impact.segments, 6);
    assert.equal(impact.annotations, 1);
    assert.equal(impact.agreements, 3);
    assert.equal(impact.contrastItems, 1, 'y avisa de que un contraste pierde un fragmento fijado');
    assert.ok(impact.bytes > 0);

    repo.purgeInterview(interview.id);
    for (const [table, column] of [
      ['testimony_sessions', 'interview_id'],
      ['testimony_agreements', 'interview_id'],
      ['testimony_annotations', 'interview_id'],
      ['testimony_interview_participants', 'interview_id'],
    ]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`).get(interview.id).c, 0, table);
    }
    // Sin claves foráneas, estas tres son las que se quedarían atrás si el repo se
    // olvidara de ellas — y nadie lo notaría hasta abrir un contraste roto.
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_media').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_transcripts').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_transcript_segments').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_contrast_items').get().c, 0);
    // Pero la NOTA sobrevive con su texto: es autoría del investigador, no material.
    assert.ok(db.prepare('SELECT COUNT(*) AS c FROM notes WHERE id = ?').get(note.noteId).c === 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM testimony_note_links WHERE note_id = ?').get(note.noteId).c, 2,
      'solo quedan los enlaces al participante y al código, que siguen existiendo');
    // Y el código, que es del vault y no de la entrevista, tampoco se va con ella.
    assert.ok(analysis.getCode(exilio.id));
  }

  // ── 15. Un participante que participa no se borra por accidente ───────────
  assert.throws(() => participants.deleteParticipant(jorge.personId), /participa en entrevistas/);
  repo.purgeInterview(other.id);
  participants.deleteParticipant(jorge.personId);
  assert.equal(participants.getParticipantProfile(jorge.personId), null);

  console.log('Testimony database test passed!');
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
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
