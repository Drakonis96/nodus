import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-kokoro-spanish-'));

function bundle(source, output, external = []) {
  const outfile = path.join(outDir, output);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, source),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      ...external.map((dependency) => `--external:${dependency}`),
      `--outfile=${outfile}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(outfile);
}

const spanishText = bundle(
  'src/lib/audio/kokoroSpanishText.ts',
  'kokoroSpanishText.cjs'
);
const { kokoroEngine } = bundle(
  'src/lib/audio/kokoro.ts',
  'kokoro.cjs',
  ['@diffusionstudio/piper-wasm', 'kokoro-js']
);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('Kokoro exposes every official Spanish v1.0 voice', () => {
  assert.deepEqual(spanishText.KOKORO_SPANISH_VOICE_IDS, [
    'ef_dora',
    'em_alex',
    'em_santa',
  ]);

  const voices = kokoroEngine.voices.filter((voice) => voice.language === 'es');
  assert.deepEqual(
    voices.map((voice) => voice.id),
    spanishText.KOKORO_SPANISH_VOICE_IDS
  );
  assert.deepEqual(
    voices.map((voice) => [voice.name, voice.gender]),
    [
      ['Dora', 'female'],
      ['Alex', 'male'],
      ['Santa', 'male'],
    ]
  );
});

test('only official e-prefixed embeddings take the Spanish route', () => {
  for (const voice of spanishText.KOKORO_SPANISH_VOICE_IDS) {
    assert.equal(spanishText.isKokoroSpanishVoice(voice), true);
  }
  assert.equal(spanishText.isKokoroSpanishVoice('af_heart'), false);
  assert.equal(spanishText.isKokoroSpanishVoice('em_unknown'), false);
});

test('text preparation follows Misaki quote and parenthesis handling', () => {
  assert.equal(
    spanishText.prepareKokoroSpanishText('«uno» (dos) y (tres)'),
    '“uno” «dos» y «tres»'
  );
});

test('eSpeak ties and affricates are mapped to Kokoro symbols', () => {
  const caretTies = 'a^ɪ a^ʊ d^z d^ʒ e^ɪ o^ʊ ə^ʊ s^s t^s t^ʃ ɔ^ɪ';
  const combiningTies = 'a͡ɪ a͡ʊ d͡z d͡ʒ e͡ɪ o͡ʊ ə͡ʊ s͡s t͡s t͡ʃ ɔ͡ɪ';
  const expected = 'I W ʣ ʤ A O Q S ʦ ʧ Y';
  assert.equal(spanishText.normalizeKokoroSpanishPhonemes(caretTies), expected);
  assert.equal(spanishText.normalizeKokoroSpanishPhonemes(combiningTies), expected);
});

test('representative Spanish eSpeak output is accepted by Kokoro', () => {
  const espeak = 'el t͡ʃˈiko eskˈut͡ʃa d͡ʒˈas i ˈun tˈesunˈami';
  assert.equal(
    spanishText.normalizeKokoroSpanishPhonemes(espeak),
    'el ʧˈiko eskˈuʧa ʤˈas i ˈun tˈesunˈami'
  );
  assert.equal(
    spanishText.normalizeKokoroSpanishPhonemes('x^k-«hola»'),
    'xk(hola)'
  );
});
