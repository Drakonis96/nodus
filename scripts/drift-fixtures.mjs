#!/usr/bin/env node
// Nodus Drift: recordings that exist only for tests.
//
// They are synthesised here at test time from a few sine waves and a fixed random
// sequence, so there is no binary in the repository and nothing in them belongs to anyone
// else. They are NOT Moodist sounds and are never presented as such: their provenance names
// this script, they carry a plain "Fixture" name, and the app only loads them when
// NODUS_E2E_DRIFT_FIXTURES points at the directory this script produced.
//
//   node scripts/drift-fixtures.mjs <directory>     writes catalog.json and audio/fixtures/*.wav
//
// Besides the good recordings it writes the three failures the interface must survive:
// a declared file that is missing, one whose bytes were altered after they were catalogued,
// and one that has the right size and hash but is not audio at all.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RATE = 24000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A PCM16 stereo WAV from two functions of time (seconds) returning samples in [-1, 1]. */
export function wav({ seconds, left, right }) {
  const frames = Math.round(seconds * RATE);
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left(t))) * 32000), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right(t))) * 32000), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A deterministic pseudo-random sequence, so a fixture is the same bytes on every machine. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

const TWO_PI = Math.PI * 2;

const RECIPES = [
  { key: 'a', seconds: 3, crossfadeMs: 0, make: () => ({ left: (t) => 0.3 * Math.sin(TWO_PI * 220 * t) * (0.7 + 0.3 * Math.sin(TWO_PI * 0.5 * t)), right: (t) => 0.3 * Math.sin(TWO_PI * 330 * t) }) },
  { key: 'b', seconds: 3, crossfadeMs: 300, make: () => { const r = lcg(7); return { left: () => (r() * 2 - 1) * 0.25, right: () => (r() * 2 - 1) * 0.25 }; } },
  { key: 'c', seconds: 2.5, crossfadeMs: 0, make: () => ({ left: (t) => 0.3 * Math.sin(TWO_PI * 110 * t), right: (t) => 0.3 * Math.sin(TWO_PI * 165 * t) }) },
  { key: 'd', seconds: 2.5, crossfadeMs: 250, make: () => ({ left: (t) => 0.25 * Math.sin(TWO_PI * 440 * t) * Math.sin(TWO_PI * 2 * t), right: (t) => 0.25 * Math.sin(TWO_PI * 550 * t) }) },
  { key: 'e', seconds: 2, crossfadeMs: 0, make: () => ({ left: (t) => 0.3 * Math.sin(TWO_PI * 262 * t), right: (t) => 0.3 * Math.sin(TWO_PI * 262 * t) }) },
  { key: 'f', seconds: 2, crossfadeMs: 200, make: () => { const r = lcg(11); return { left: (t) => (r() * 2 - 1) * 0.2 * Math.abs(Math.sin(TWO_PI * t)), right: (t) => (r() * 2 - 1) * 0.2 } ; } },
  { key: 'g', seconds: 2, crossfadeMs: 0, make: () => ({ left: (t) => 0.3 * Math.sin(TWO_PI * 196 * t), right: (t) => 0.3 * Math.sin(TWO_PI * 247 * t) }) },
];

const PROVENANCE = {
  licenseStatus: 'verified',
  licenseId: 'LicenseRef-Nodus-test-fixture',
  evidenceRefs: ['scripts/drift-fixtures.mjs'],
  distributionReview: 'approved',
  reviewRef: 'scripts/drift-fixtures.mjs',
};

function definition(id, name, asset, bytes, seconds, crossfadeMs, digest) {
  return {
    id,
    nameKey: name,
    descriptionKey: 'Test recording (fixture)',
    categoryId: 'things',
    icon: 'bell',
    source: { kind: 'file', asset, sha256: digest, bytes, durationSeconds: seconds, loop: true, crossfadeMs },
    provenance: { ...PROVENANCE, evidenceRefs: [...PROVENANCE.evidenceRefs] },
  };
}

/**
 * Write the fixture catalogue and audio into `directory` and return what it contains.
 * `good` are ordinary recordings (seven of them, enough to fill a mix and press past its
 * limit); `missing`, `corrupt` and `garbage` are the failures.
 */
export function buildDriftFixtures(directory) {
  const audioDir = path.join(directory, 'audio', 'fixtures');
  fs.mkdirSync(audioDir, { recursive: true });
  const sounds = [];
  const good = [];

  for (const recipe of RECIPES) {
    const id = `fixture-${recipe.key}`;
    const bytes = wav({ seconds: recipe.seconds, ...recipe.make() });
    fs.writeFileSync(path.join(audioDir, `${id}.wav`), bytes);
    sounds.push(definition(id, `Fixture ${recipe.key.toUpperCase()}`, `fixtures/${id}.wav`, bytes.length, recipe.seconds, recipe.crossfadeMs, sha256(bytes)));
    good.push(id);
  }

  // Declared, never written.
  const ghost = wav({ seconds: 1, left: () => 0, right: () => 0 });
  sounds.push(definition('fixture-missing', 'Fixture missing file', 'fixtures/fixture-missing.wav', ghost.length, 1, 0, sha256(ghost)));

  // Written, then altered: the same size, a different byte, so the SHA-256 no longer matches.
  const original = wav({ seconds: 1, left: (t) => 0.2 * Math.sin(TWO_PI * 300 * t), right: (t) => 0.2 * Math.sin(TWO_PI * 300 * t) });
  const altered = Buffer.from(original);
  altered[altered.length - 1] ^= 0xff;
  fs.writeFileSync(path.join(audioDir, 'fixture-corrupt.wav'), altered);
  sounds.push(definition('fixture-corrupt', 'Fixture altered file', 'fixtures/fixture-corrupt.wav', original.length, 1, 0, sha256(original)));

  // Right size, right hash, but not audio: it passes every check the main process makes and
  // fails in the decoder, which is the last line of defence.
  const notAudio = Buffer.from('this is not audio '.repeat(600));
  fs.writeFileSync(path.join(audioDir, 'fixture-garbage.wav'), notAudio);
  sounds.push(definition('fixture-garbage', 'Fixture not audio', 'fixtures/fixture-garbage.wav', notAudio.length, 1, 0, sha256(notAudio)));

  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1, sounds }, null, 2));
  return { directory, sounds, good, missing: 'fixture-missing', corrupt: 'fixture-corrupt', garbage: 'fixture-garbage' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) { console.error('usage: node scripts/drift-fixtures.mjs <directory>'); process.exit(1); }
  const built = buildDriftFixtures(path.resolve(target));
  console.log(`fixtures written to ${built.directory}: ${built.sounds.map((s) => s.id).join(', ')}`);
}
