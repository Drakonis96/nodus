// Genera el audio de la demo de Testimonios A PARTIR de su propio guion.
//
// Una entrevista por idioma, con una voz sintética fija por PERSONA: Carmen suena igual en
// su entrevista y en la grupal, que es lo que convierte la demo en un banco de pruebas
// para la detección de hablantes.
//
// Los tiempos de cada turno se MIDEN sobre el audio devuelto (un snippet por turno), no se
// estiman: la transcripción de la demo apunta al minuto real en que se dice cada frase.
//
//   HUME_API_KEY=… node scripts/gen-testimony-demo-audio.mjs
//
// Regenerar es OBLIGATORIO al tocar el guion: `scripts/test-testimony-demo-audio.mjs`
// compara la huella del texto y falla si la voz dice una cosa y la transcripción otra.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(repoRoot, 'electron/assets/testimonios-demo');
const KEY = (process.env.HUME_API_KEY || '').trim();
if (!KEY) throw new Error('Falta HUME_API_KEY.');

/** Una voz por persona y por idioma. Dos mujeres de edad parecida en la grupal: a propósito. */
const CAST = {
  es: {
    jorge: 'Santiago',
    carmen: 'La Voz del Mar',
    rosario: 'La Anfitriona Radiante',
    tomas: 'El Narrador Urbano',
  },
  en: {
    jorge: 'Terrence Bentley',
    carmen: 'Geraldine Wallace',
    rosario: 'Caring Mother',
    tomas: 'Campfire Narrator',
  },
};

/** Silencio entre turnos: una conversación real tiene aire, y la diarización lo necesita. */
const GAP_SECONDS = 0.45;

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = path.join(os.tmpdir(), 'testimony-demo-script.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'electron/db/testimonyDemoScript.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`],
  { stdio: 'ignore' },
);
const { TESTIMONY_DEMO_SCRIPT: script } = require(bundle);

function parseWav(buffer) {
  if (buffer.subarray(0, 4).toString() !== 'RIFF') throw new Error('Hume no devolvió WAV.');
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString();
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        byteRate: buffer.readUInt32LE(offset + 16),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data' && fmt) return { ...fmt, data: buffer.subarray(offset + 8, offset + 8 + size) };
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV sin bloque data.');
}

function buildWav({ sampleRate, channels, bitsPerSample }, payload) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + payload.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(payload.length, 40);
  return Buffer.concat([header, payload]);
}

async function synthesize(utterances) {
  const res = await fetch('https://api.hume.ai/v0/tts', {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterances, format: { type: 'wav' }, num_generations: 1 }),
  });
  if (!res.ok) throw new Error(`Hume HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const snippets = (data.generations?.[0]?.snippets ?? []).flat();
  if (snippets.length !== utterances.length) {
    throw new Error(`Hume devolvió ${snippets.length} fragmentos para ${utterances.length} turnos.`);
  }
  return snippets
    .slice()
    .sort((a, b) => (a.utterance_index ?? 0) - (b.utterance_index ?? 0))
    .map((snippet) => Buffer.from(snippet.audio, 'base64'));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const entries = [];

for (const interview of script) {
  if (!interview.hasAudio) continue;
  for (const language of ['es', 'en']) {
    const cast = CAST[language];
    const utterances = interview.turns.map((turn) => ({
      text: turn[language],
      voice: { name: cast[turn.person], provider: 'HUME_AI' },
    }));
    const parts = (await synthesize(utterances)).map(parseWav);
    const shape = parts[0];
    for (const part of parts) {
      if (part.sampleRate !== shape.sampleRate || part.channels !== shape.channels || part.bitsPerSample !== shape.bitsPerSample) {
        throw new Error('Hume mezcló formatos entre turnos.');
      }
    }
    const bytesPerSecond = shape.sampleRate * shape.channels * (shape.bitsPerSample / 8);
    const gap = Buffer.alloc(Math.round(bytesPerSecond * GAP_SECONDS));
    const chunks = [];
    const turns = [];
    let cursor = 0;
    parts.forEach((part, index) => {
      const seconds = part.data.length / bytesPerSecond;
      turns.push({ start: Number(cursor.toFixed(2)), end: Number((cursor + seconds).toFixed(2)) });
      chunks.push(part.data);
      cursor += seconds;
      if (index < parts.length - 1) { chunks.push(gap); cursor += GAP_SECONDS; }
    });
    const wav = buildWav(shape, Buffer.concat(chunks));
    const tmp = path.join(os.tmpdir(), `demo-${interview.key}-${language}.wav`);
    fs.writeFileSync(tmp, wav);
    const file = `${interview.key}.${language}.mp3`;
    const target = path.join(OUT_DIR, file);
    execFileSync('ffmpeg', ['-y', '-i', tmp, '-ac', '1', '-ar', '24000', '-b:a', '64k', target], { stdio: 'ignore' });
    fs.unlinkSync(tmp);
    const mp3 = fs.readFileSync(target);
    entries.push({
      key: interview.key,
      language,
      file,
      mimeType: 'audio/mpeg',
      durationSeconds: Number(cursor.toFixed(2)),
      sizeBytes: mp3.byteLength,
      sha256: crypto.createHash('sha256').update(mp3).digest('hex'),
      // La huella de LO QUE SE DICE: sin ella, corregir una frase del guion deja el audio
      // diciendo otra cosa y nada lo delata.
      textSha256: crypto.createHash('sha256')
        .update(interview.turns.map((turn) => `${turn.person}: ${turn[language]}`).join('\n'))
        .digest('hex'),
      voices: Object.fromEntries([...new Set(interview.turns.map((turn) => turn.person))].map((person) => [person, cast[person]])),
      turns,
    });
    console.log(`[demo-audio] ${file}  ${cursor.toFixed(1)}s  ${(mp3.byteLength / 1024).toFixed(0)} KB  ${turns.length} turnos`);
  }
}

fs.writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  `${JSON.stringify({ generator: 'Hume Octave (voces sintéticas; ninguna voz real)', entries }, null, 2)}\n`,
);
console.log(`[demo-audio] manifiesto con ${entries.length} archivos`);
