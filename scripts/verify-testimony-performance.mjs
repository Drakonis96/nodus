// El corpus de referencia del plan (19.8), contra una bóveda REAL.
//
//   250 entrevistas · 400 sesiones · 100 000 tramos · 20 000 anotaciones · 500 códigos
//
// Por qué existe: la primera implementación de Buscar es SQL sobre las tablas canónicas,
// sin índice FTS5, y esa decisión sólo es defendible si se mide. Un índice es una segunda
// copia del texto que puede desincronizarse; añadirlo «por si acaso» es asumir esa deuda
// sin saber si hacía falta. Este script es la prueba que decide.
//
// LO QUE NO SE MIDE AQUÍ: milisegundos de reloj como criterio de aprobado/suspenso en CI.
// La máquina de un runner comparte CPU con otros trabajos y una cifra así falla sola. Se
// imprime el P95 para leerlo, y lo que se ASIENTA es la forma del coste: que buscar no
// recorra la bóveda entera y que abrir la tabla no crezca con el número de tramos.

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

if (!process.argv.includes('--electron-testimony-perf')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-testimony-performance.mjs'), '--electron-testimony-perf'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-testimony-perf-'));
installRuntimeHooks(root);

const INTERVIEWS = Number(process.env.NODUS_PERF_INTERVIEWS ?? 250);
const SESSIONS_PER = 1.6;
const SEGMENTS_PER_MEDIA = Math.round(100_000 / (INTERVIEWS * SESSIONS_PER));
const ANNOTATIONS_PER = Math.round(20_000 / INTERVIEWS);
const CODES = 500;

const VOCABULARY = [
  'padre', 'madre', 'pueblo', 'valle', 'camión', 'frontera', 'hambre', 'invierno', 'carta',
  'campo', 'cárcel', 'silencio', 'regreso', 'tierra', 'agua', 'escuela', 'maestro', 'iglesia',
  'cosecha', 'noche', 'tren', 'maleta', 'nombre', 'miedo', 'trabajo', 'fábrica', 'barco',
];

/** Texto determinista y variado: sin aleatoriedad, para que dos ejecuciones se comparen. */
function sentence(seed) {
  const words = [];
  // 25 palabras por tramo × 100 000 tramos = los 2,5 millones de palabras del plan.
  for (let index = 0; index < 25; index += 1) {
    words.push(VOCABULARY[(seed * 7 + index * 13) % VOCABULARY.length]);
  }
  return `${words.join(' ')}.`;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function measure(label, runs, fn) {
  fn(0);
  const timings = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    fn(index);
    timings.push(performance.now() - started);
  }
  const p95 = percentile(timings, 0.95);
  console.log(`  ${label.padEnd(42)} p50 ${percentile(timings, 0.5).toFixed(1).padStart(7)} ms   p95 ${p95.toFixed(1).padStart(7)} ms`);
  return p95;
}

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  const repo = require(path.join(repoRoot, 'electron/db/testimonyRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/db/testimonySearchRepo.ts'));
  const contrasts = require(path.join(repoRoot, 'electron/db/testimonyContrastRepo.ts'));
  const analysis = require(path.join(repoRoot, 'electron/db/testimonyAnalysisRepo.ts'));

  console.log(`[perf] sembrando ${INTERVIEWS} entrevistas…`);
  const seedStarted = performance.now();

  // Se siembra con SQL directo y en UNA transacción: pasar por los repositorios costaría
  // minutos y lo que se quiere medir es la LECTURA, no la escritura.
  const now = new Date().toISOString();
  const codeIds = [];
  const seed = db.transaction(() => {
    const insertCode = db.prepare(
      'INSERT INTO testimony_codes (id, label, normalized_label, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (let index = 0; index < CODES; index += 1) {
      const id = `cod_${index}`;
      insertCode.run(id, `Código ${index}`, `codigo ${index}`, index % 20 === 0 ? 'theme' : 'code', now, now);
      codeIds.push(id);
    }

    const insertPerson = db.prepare(
      'INSERT INTO persons (person_id, display_name, sex, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertProfile = db.prepare(
      'INSERT INTO testimony_participant_profiles (person_id, public_name, identity_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertInterview = db.prepare(
      `INSERT INTO testimony_interviews (id, short_id, title, interview_kind, workflow_status, collection_label, conducted_at, language, created_at, updated_at)
       VALUES (?, ?, ?, 'life_history', ?, ?, ?, 'es', ?, ?)`
    );
    const insertParticipant = db.prepare(
      'INSERT INTO testimony_interview_participants (interview_id, person_id, role, is_primary, position, created_at) VALUES (?, ?, ?, 1, 0, ?)'
    );
    const insertAgreement = db.prepare(
      `INSERT INTO testimony_agreements (id, interview_id, version_no, is_current, status, access_level, attribution_mode, allowed_uses_json, narrator_review_required, narrator_review_status, created_at, updated_at)
       VALUES (?, ?, 1, 1, 'documented', ?, 'public_name', '["research"]', 0, 'not_started', ?, ?)`
    );
    const insertSession = db.prepare(
      `INSERT INTO testimony_sessions (id, short_id, interview_id, sequence_no, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'recorded', ?, ?)`
    );
    const insertMedia = db.prepare(
      `INSERT INTO testimony_media (id, short_id, session_id, media_kind, role, file_name, mime_type, content_hash, duration_seconds, size_bytes, immutable, created_at)
       VALUES (?, ?, ?, 'audio', 'master', ?, 'audio/wav', ?, ?, ?, 1, ?)`
    );
    const insertTranscript = db.prepare(
      `INSERT INTO testimony_transcripts (id, short_id, media_id, kind, language, status, version_no, created_at, updated_at)
       VALUES (?, ?, ?, 'reviewed', 'es', 'ready', 1, ?, ?)`
    );
    const insertSegment = db.prepare(
      `INSERT INTO testimony_transcript_segments (id, short_id, transcript_id, t_start, t_end, text, speaker_person_id, speaker_label, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAnnotation = db.prepare(
      `INSERT INTO testimony_annotations (id, short_id, interview_id, transcript_id, segment_id, kind, t_start, t_end, quote_snapshot, link_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'highlight', ?, ?, ?, 'valid', ?, ?)`
    );
    const insertAnnotationCode = db.prepare(
      'INSERT INTO testimony_annotation_codes (annotation_id, code_id, created_at) VALUES (?, ?, ?)'
    );

    let segmentCounter = 0;
    let annotationCounter = 0;
    for (let index = 0; index < INTERVIEWS; index += 1) {
      const personId = `per_${index}`;
      insertPerson.run(personId, `Narrador ${index}`, 'unknown', now, now);
      insertProfile.run(personId, `N. ${index}`, index % 3 === 0 ? 'pseudonym' : 'identified', now, now);

      const interviewId = `int_${index}`;
      const access = ['open', 'restricted', 'private', 'embargoed'][index % 4];
      insertInterview.run(
        interviewId,
        `INT-${String(index + 1).padStart(4, '0')}`,
        `Entrevista ${index} · ${VOCABULARY[index % VOCABULARY.length]}`,
        ['completed', 'reviewing', 'recorded'][index % 3],
        `Colección ${index % 8}`,
        `20${10 + (index % 15)}-03-0${(index % 9) + 1}`,
        now,
        now
      );
      insertParticipant.run(interviewId, personId, 'narrator', now);
      insertAgreement.run(`agr_${index}`, interviewId, access, now, now);

      // 150 entrevistas con dos sesiones y 100 con una = las 400 sesiones del plan.
      const sessionCount = index % 5 < 3 ? 2 : 1;
      for (let s = 0; s < sessionCount; s += 1) {
        const sessionId = `ses_${index}_${s}`;
        insertSession.run(sessionId, `SES-${index}-${s}`, interviewId, s + 1, now, now);
        const mediaId = `med_${index}_${s}`;
        insertMedia.run(mediaId, `MED-${index}-${s}`, sessionId, `entrevista-${index}-${s}.wav`, `hash${index}${s}`, 3600, 120_000_000, now);
        const transcriptId = `trn_${index}_${s}`;
        insertTranscript.run(transcriptId, `TRN-${index}-${s}`, mediaId, now, now);

        for (let seg = 0; seg < SEGMENTS_PER_MEDIA; seg += 1) {
          const segmentId = `seg_${segmentCounter}`;
          insertSegment.run(
            segmentId,
            `SEG-${segmentCounter}`,
            transcriptId,
            seg * 12,
            seg * 12 + 12,
            sentence(segmentCounter),
            seg % 3 === 0 ? personId : null,
            seg % 3 === 0 ? null : 'Hablante 2',
            seg,
            now,
            now
          );
          if (annotationCounter < 20_000 && seg < ANNOTATIONS_PER / sessionCount) {
            const annotationId = `ann_${annotationCounter}`;
            insertAnnotation.run(
              annotationId,
              `ANN-${annotationCounter}`,
              interviewId,
              transcriptId,
              segmentId,
              seg * 12,
              seg * 12 + 12,
              sentence(segmentCounter).slice(0, 90),
              now,
              now
            );
            insertAnnotationCode.run(annotationId, codeIds[annotationCounter % CODES], now);
            annotationCounter += 1;
          }
          segmentCounter += 1;
        }
      }
    }
    console.log(`[perf] ${segmentCounter} tramos · ${annotationCounter} anotaciones`);
  });
  seed();
  console.log(`[perf] sembrado en ${((performance.now() - seedStarted) / 1000).toFixed(1)} s\n`);

  const counts = {
    interviews: db.prepare('SELECT COUNT(*) AS n FROM testimony_interviews').get().n,
    segments: db.prepare('SELECT COUNT(*) AS n FROM testimony_transcript_segments').get().n,
    annotations: db.prepare('SELECT COUNT(*) AS n FROM testimony_annotations').get().n,
    codes: db.prepare('SELECT COUNT(*) AS n FROM testimony_codes').get().n,
  };
  assert.equal(counts.interviews, INTERVIEWS);
  assert.ok(counts.segments >= 90_000, `el corpus de referencia necesita ~100 000 tramos, hay ${counts.segments}`);
  assert.ok(counts.annotations >= 15_000, `y ~20 000 anotaciones, hay ${counts.annotations}`);
  console.log(`[perf] corpus: ${counts.interviews} entrevistas · ${counts.segments} tramos · ${counts.annotations} fragmentos · ${counts.codes} códigos\n`);

  const results = {};
  results.table = measure('abrir la tabla de entrevistas', 12, () => {
    const rows = repo.listInterviews({ sort: 'updated' });
    assert.equal(rows.length, INTERVIEWS);
  });
  results.filter = measure('filtrar por acceso + estado', 12, () => {
    repo.listInterviews({ filters: { accessLevel: ['restricted', 'embargoed'], workflowStatus: ['completed'] } });
  });
  results.searchText = measure('buscar una palabra en los pasajes', 20, (index) => {
    const hits = search.searchTestimonies(VOCABULARY[index % VOCABULARY.length], ['segment']);
    assert.ok(hits.length > 0);
  });
  results.searchAll = measure('buscar en todos los tipos', 20, (index) => {
    search.searchTestimonies(VOCABULARY[(index + 3) % VOCABULARY.length]);
  });
  results.dashboard = measure('tablero de Inicio completo', 10, () => {
    const board = search.testimonyDashboard();
    assert.equal(board.metrics.interviews, INTERVIEWS);
  });
  results.dossier = measure('abrir el dossier de una entrevista', 12, (index) => {
    const id = `int_${index % INTERVIEWS}`;
    repo.listSessions(id);
    analysis.listAnnotations(id);
  });
  results.contrast = measure('contrastar 3 entrevistas por 2 códigos', 10, () => {
    contrasts.runContrast({ interviewIds: ['int_1', 'int_2', 'int_3'], codeIds: [codeIds[1], codeIds[2]] });
  });
  results.longTranscript = measure('leer una transcripción larga entera', 10, (index) => {
    const rows = require(path.join(repoRoot, 'electron/db/testimonyMediaRepo.ts')).listSegments(`trn_${index % INTERVIEWS}_0`);
    assert.ok(rows.length > 0);
  });

  console.log('');
  console.log(`[perf] objetivo del plan para la búsqueda textual: P95 < 300 ms · medido ${results.searchText.toFixed(1)} ms`);
  if (results.searchText >= 300) {
    console.log('[perf] AVISO: por encima del objetivo. Toca evaluar un índice FTS5 RECONSTRUIBLE');
    console.log('[perf] (nunca canónico) antes de dar la fase por cerrada en el equipo de referencia.');
  }

  // ── La forma del coste, que sí es un invariante ──────────────────────────
  //
  // Estas dos son las que fallarían de verdad si alguien "optimizara" la tabla metiendo
  // los tramos en la consulta, o si la búsqueda dejara de tener un LIMIT.
  {
    const explain = (sql, params = []) =>
      db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join(' | ');

    const segmentPlan = explain(
      "SELECT seg.id FROM testimony_transcript_segments seg JOIN testimony_transcripts t ON t.id = seg.transcript_id WHERE seg.text LIKE ? LIMIT 120",
      ['%padre%']
    );
    assert.match(segmentPlan, /testimony_transcripts USING (INTEGER )?PRIMARY KEY|SEARCH t/i,
      'la búsqueda de pasajes entra en las transcripciones por clave, no recorriéndolas');

    // La tabla de entrevistas NO puede leer ni un tramo: sus contadores son subconsultas
    // agregadas, y meter los segmentos en el JOIN convertiría abrir la lista en leer el
    // corpus entero.
    const rows = repo.listInterviews({ limit: 5 });
    for (const row of rows) {
      assert.ok(!Object.prototype.hasOwnProperty.call(row, 'segments'), 'ni un tramo viaja con la tabla');
      assert.ok(!row.participants.some((person) => 'segments' in person));
    }
  }

  console.log('\n[perf] Testimony performance check passed!');
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
