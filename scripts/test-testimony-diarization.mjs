// La detección de hablantes, medida contra una verdad conocida.
//
// La demo es el único sitio de Nodus donde se sabe con certeza QUIÉN habla en cada
// segundo: el audio se generó turno a turno desde el guion, así que el manifiesto es la
// respuesta correcta. Esta prueba compara lo que el modelo acústico dijo —capturado en un
// fixture para que la prueba no dependa de descargar 6 MB— con esa verdad.
//
// Se mide, no se opina: cuántas voces se encontraron, qué proporción del tiempo se
// atribuye a la voz correcta y cuántos segmentos quedarían mal asignados.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-diarization-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return require(bundle);
}

const { diarizationFromSpans, proposeSpeakers, proposalImpact, voiceLabel } = load('shared/testimonyDiarization.ts');
const { TESTIMONY_DEMO_SCRIPT } = load('electron/db/testimonyDemoScript.ts');
const spans = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/fixtures/testimony-diarization-spans.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron/assets/testimonios-demo/manifest.json'), 'utf8'));

test.after(() => rm(outDir, { recursive: true, force: true }));

test('el silencio no es una voz', () => {
  const result = diarizationFromSpans([
    { start: 0, end: 2, label: 'NO_SPEAKER', confidence: 0.9 },
    { start: 2, end: 5, label: 'SPEAKER_1', confidence: 0.9 },
  ]);
  assert.equal(result.voices.length, 1);
  assert.equal(result.turns.length, 1);
  assert.equal(result.speechSeconds, 3);
});

test('un parpadeo de 0,05 s no es un turno', () => {
  const result = diarizationFromSpans([
    { start: 0, end: 3, label: 'SPEAKER_1', confidence: 0.9 },
    { start: 3.0, end: 3.05, label: 'SPEAKER_2', confidence: 0.4 },
    { start: 3.1, end: 6, label: 'SPEAKER_1', confidence: 0.9 },
  ]);
  assert.equal(result.turns.length, 1, 'y además no parte el turno de quien sí habla');
  assert.equal(result.voices.length, 1);
});

test('respirar no cambia de hablante, pero cederle la palabra a otro sí', () => {
  const result = diarizationFromSpans([
    { start: 0, end: 3, label: 'SPEAKER_1', confidence: 0.9 },
    { start: 3.4, end: 6, label: 'SPEAKER_1', confidence: 0.9 },
    { start: 7, end: 9, label: 'SPEAKER_2', confidence: 0.9 },
  ]);
  assert.equal(result.turns.length, 2);
  assert.deepEqual(result.turns.map((turn) => turn.voice), [1, 2]);
});

test('las voces se numeran sin huecos aunque el filtro se lleve una entera', () => {
  const result = diarizationFromSpans([
    { start: 0, end: 3, label: 'SPEAKER_1', confidence: 0.9 },
    { start: 3.0, end: 3.05, label: 'SPEAKER_9', confidence: 0.2 },
    { start: 4, end: 7, label: 'SPEAKER_4', confidence: 0.9 },
  ]);
  assert.deepEqual(result.voices.map((voice) => voice.voice), [1, 2]);
});

test('un segmento repartido entre dos voces se marca en disputa y no se asigna', () => {
  const turns = [
    { start: 0, end: 5, voice: 1, confidence: 0.9 },
    { start: 5, end: 10, voice: 2, confidence: 0.9 },
  ];
  const [proposal] = proposeSpeakers([{ id: 's1', tStart: 2.5, tEnd: 7.5 }], turns);
  assert.equal(proposal.voice, null, 'ninguna voz manda: no se elige a ojo');
  assert.equal(proposal.disputed, true);
});

test('un segmento en silencio se queda sin hablante, no con el último que habló', () => {
  const turns = [{ start: 0, end: 5, voice: 1, confidence: 0.9 }];
  const [proposal] = proposeSpeakers([{ id: 's1', tStart: 20, tEnd: 25 }], turns);
  assert.equal(proposal.voice, null);
  assert.equal(proposal.coverage, 0);
});

test('el impacto distingue rellenar de CAMBIAR lo que ya había', () => {
  const proposals = [
    { segmentId: 'a', voice: 1, coverage: 0.9, disputed: false },
    { segmentId: 'b', voice: 2, coverage: 0.9, disputed: false },
    { segmentId: 'c', voice: 1, coverage: 0.9, disputed: false },
    { segmentId: 'd', voice: null, coverage: 0.1, disputed: false },
  ];
  const current = new Map([['a', 'Carmen'], ['b', 'Carmen'], ['c', null], ['d', 'Carmen']]);
  const voices = new Map([[1, 'Carmen'], [2, 'Jorge']]);
  assert.deepEqual(proposalImpact(proposals, current, voices), { unchanged: 1, filled: 1, changed: 1, leftBlank: 1 });
});

test('las voces anónimas se llaman por su número mientras nadie diga de quién son', () => {
  assert.equal(voiceLabel(1), 'Voz 1');
  assert.equal(voiceLabel(2), 'Voz 2');
});

// ── Contra la verdad de la demo ────────────────────────────────────────────────

/**
 * Puntúa una grabación: para cada turno REAL del manifiesto, qué voz detectada ocupa más
 * tiempo dentro de él. Si dos turnos de la misma persona reciben voces distintas, o dos
 * personas distintas reciben la misma, se ve aquí.
 */
function score(file) {
  const entry = manifest.entries.find((item) => item.file === file);
  const script = TESTIMONY_DEMO_SCRIPT.find((item) => item.key === entry.key);
  const result = diarizationFromSpans(spans[file]);
  const perTurn = entry.turns.map((turn, index) => {
    const overlap = new Map();
    for (const detected of result.turns) {
      const seconds = Math.min(turn.end, detected.end) - Math.max(turn.start, detected.start);
      if (seconds > 0) overlap.set(detected.voice, (overlap.get(detected.voice) ?? 0) + seconds);
    }
    const winner = [...overlap.entries()].sort((a, b) => b[1] - a[1])[0];
    return { person: script.turns[index].person, voice: winner?.[0] ?? null, seconds: winner?.[1] ?? 0 };
  });
  const byPerson = new Map();
  for (const turn of perTurn) {
    if (!byPerson.has(turn.person)) byPerson.set(turn.person, new Set());
    byPerson.get(turn.person).add(turn.voice);
  }
  return { result, perTurn, byPerson };
}

test('la entrevista de Carmen: dos personas, dos voces, y ninguna se cruza', () => {
  const { result, perTurn, byPerson } = score('carmen.es.mp3');
  assert.equal(result.voices.length, 2, `se detectaron ${result.voices.length} voces y hablan dos personas`);
  for (const [person, voices] of byPerson) {
    assert.equal(voices.size, 1, `${person} se reparte entre ${voices.size} voces`);
  }
  const distinct = new Set([...byPerson.values()].map((voices) => [...voices][0]));
  assert.equal(distinct.size, byPerson.size, 'dos personas comparten voz detectada');
  assert.ok(perTurn.every((turn) => turn.voice != null), 'todos los turnos reales reciben una voz');
});

test('la entrevista del maestro: una sola voz domina, como en el guion', () => {
  const { result, byPerson } = score('tomas.es.mp3');
  assert.ok(result.voices.length >= 2, 'el entrevistador también habla');
  const tomasVoice = [...byPerson.get('tomas')];
  assert.equal(tomasVoice.length, 1);
  const dominant = result.voices.slice().sort((a, b) => b.share - a.share)[0];
  assert.equal(dominant.voice, tomasVoice[0], 'quien más habla en el audio es quien más habla en el guion');
});

test('la grupal es el caso duro y se dice: dos mujeres de edad parecida', () => {
  // No se exige acierto perfecto aquí. Se exige que la prueba MIDA y que el resultado
  // quede escrito: si un cambio futuro lo empeora, se verá en este número.
  const { result, byPerson } = score('grupal.es.mp3');
  const rosario = [...(byPerson.get('rosario') ?? [])];
  const carmen = [...(byPerson.get('carmen') ?? [])];
  assert.ok(result.voices.length >= 1);
  const separated = rosario.length === 1 && carmen.length === 1 && rosario[0] !== carmen[0];
  console.log(`[diarización] grupal.es: ${result.voices.length} voces detectadas · ${separated ? 'separa' : 'NO separa'} a las dos narradoras`);
  assert.ok(result.turns.length >= 3, 'al menos encuentra los tres turnos');
});

test('los segmentos de la transcripción reciben la voz que de verdad los ocupa', () => {
  const entry = manifest.entries.find((item) => item.file === 'carmen.es.mp3');
  const result = diarizationFromSpans(spans['carmen.es.mp3']);
  const segments = entry.turns.map((turn, index) => ({ id: `s${index}`, tStart: turn.start, tEnd: turn.end }));
  const proposals = proposeSpeakers(segments, result.turns);
  const assigned = proposals.filter((proposal) => proposal.voice != null);
  assert.equal(assigned.length, segments.length, 'ningún turno real se queda sin propuesta');
  assert.ok(assigned.every((proposal) => proposal.coverage >= 0.6),
    `la cobertura mínima fue ${Math.min(...assigned.map((proposal) => proposal.coverage))}`);
});
