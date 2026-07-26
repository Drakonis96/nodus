// Step 1 of the tutorial pipeline: turn the shot list into audio, and measure it.
//
// The measurement is the point. Every later stage — how long the camera holds a
// shot, when each subtitle appears — is derived from the real duration of the
// synthesized speech, so picture and voice cannot drift apart.
//
//   node scripts/tutorial/narrate.mjs                 # OpenRouter speech (default)
//   node scripts/tutorial/narrate.mjs --openai        # OpenAI directly
//   node scripts/tutorial/narrate.mjs --hume          # Hume Octave
//   node scripts/tutorial/narrate.mjs --local         # offline placeholder voice
//   node scripts/tutorial/narrate.mjs --voice=aura-2-apollo-en
//   node scripts/tutorial/narrate.mjs --model=<id>    # pin a speech model
//
// The Hume key is read from HUME_API_KEY or ~/.config/nodus/hume.key. It is never
// logged. The app's own stored key cannot be used here: it is sealed with
// safeStorage and a development Electron build cannot decrypt it.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/**
 * Which deck to narrate. Every deck reuses this whole stage — same
 * voice, same measurement, same output shape — so the only thing that varies is
 * which shot list is read and where the clips land.
 */
const deck = process.argv.find((a) => a.startsWith('--deck='))?.slice('--deck='.length) ?? 'intro';
const OUT = path.join(repoRoot, '.tutorial-out', deck);
const AUDIO = path.join(OUT, 'audio');

const useLocal = process.argv.includes('--local');
const useHume = process.argv.includes('--hume');
const useOpenAI = process.argv.includes('--openai');
const voiceArg = process.argv.find((a) => a.startsWith('--voice='))?.slice('--voice='.length);
const modelArg = process.argv.find((a) => a.startsWith('--model='))?.slice('--model='.length);

/**
 * How the narrator should sound. This matters more than it looks: the video is
 * synthesized as 28 independent requests, and without an explicit delivery brief
 * each sentence drifts in energy and pace, which lands as an erratic narrator.
 * Pinning the tone once keeps all 28 the same performance.
 */
const DELIVERY =
  'Calm, warm documentary narrator introducing a piece of software. Even, unhurried pace. ' +
  'Clear consonants. No salesmanship, no rising excitement — explain, do not pitch. ' +
  'Finish each sentence fully and do not trail off.';

async function humeKey() {
  if (process.env.HUME_API_KEY) return process.env.HUME_API_KEY.trim();
  const file = path.join(os.homedir(), '.config', 'nodus', 'hume.key');
  if (existsSync(file)) return (await readFile(file, 'utf8')).trim();
  throw new Error(
    'No Hume key found. Put it in ~/.config/nodus/hume.key (chmod 600) or set HUME_API_KEY, or run with --local for a placeholder voice.'
  );
}

/** Pick a narrator once, so every clip in the video is the same voice. */
async function pickVoice(key) {
  const res = await fetch(`https://api.hume.ai/v0/tts/voices?provider=HUME_AI&page_number=0&page_size=100`, {
    headers: { 'X-Hume-Api-Key': key },
  });
  if (!res.ok) throw new Error(`Hume: could not list voices (HTTP ${res.status}).`);
  const voices = (await res.json()).voices_page ?? [];
  if (!voices.length) throw new Error('Hume returned no voices for this key.');
  const wanted = voiceArg && voices.find((v) => v.name.toLowerCase() === voiceArg.toLowerCase());
  const chosen = wanted ?? voices[0];
  console.log(`[narrate] voice: ${chosen.name}`);
  return { id: chosen.id, provider: 'HUME_AI' };
}

async function synthHume(key, voice, text, dest) {
  const res = await fetch('https://api.hume.ai/v0/tts/file', {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      utterances: [{ text, voice: { id: voice.id, provider: voice.provider } }],
      format: { type: 'wav' },
      num_generations: 1,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Hume: synthesis failed (HTTP ${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * OpenAI Octave-style TTS — the default narrator.
 *
 * Chosen over the cheaper per-character services because at this length (about
 * 3,300 characters, five cents) price is not a real difference, while the
 * `instructions` field is: it is the only one of the mainstream APIs that lets a
 * batch of separately-synthesized sentences be held to one consistent delivery.
 */
async function synthOpenAI(key, text, dest) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: voiceArg || 'alloy',
      input: text,
      instructions: DELIVERY,
      response_format: 'wav',
    }),
  });
  if (res.status === 401) throw new Error('The OpenAI key was rejected.');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS failed (HTTP ${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function openAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const file = path.join(os.homedir(), '.config', 'nodus', 'openai.key');
  if (existsSync(file)) return (await readFile(file, 'utf8')).trim();
  throw new Error(
    'No OpenAI key found. Put it in ~/.config/nodus/openai.key (chmod 600) or set OPENAI_API_KEY, ' +
    'or run with --local for a placeholder voice.'
  );
}

/**
 * The narration key, with the app-demo key as a fallback.
 *
 * These are kept separate on purpose — filming model catalogues should not spend
 * the text-to-speech budget — but narration keys get rotated and revoked, and a
 * dead key should not block a re-render. Whichever is used is logged, so the spend
 * is never a surprise.
 */
async function openRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const dir = path.join(os.homedir(), '.config', 'nodus');
  for (const [name, note] of [['openrouter.key', 'narration key'], ['openrouter-app.key', 'app-demo key (narration key unavailable)']]) {
    const file = path.join(dir, name);
    if (existsSync(file)) {
      const key = (await readFile(file, 'utf8')).trim();
      if (key) {
        console.log(`[narrate] using ${note}`);
        return key;
      }
    }
  }
  throw new Error(
    'No OpenRouter key found. Put it in ~/.config/nodus/openrouter.key (chmod 600) or set ' +
    'OPENROUTER_API_KEY, or run with --local for a placeholder voice.'
  );
}

/** The default narrator: a real TTS engine, reached through OpenRouter. */
const OPENROUTER_TTS = 'deepgram/aura-2';
const OPENROUTER_VOICE = 'aura-2-thalia-en';

/**
 * Resolve a speech model from OpenRouter's catalogue rather than hardcoding one
 * blindly — published ids carry dated snapshots and rot — but insist on a model
 * whose declared output modality is `speech`.
 *
 * That distinction is not pedantry. Conversational audio models such as
 * `openai/gpt-audio-mini` also emit audio, but they are chat models: asked to read
 * a line verbatim they answer it instead, paraphrasing freely. Since the subtitles
 * in all twelve languages are generated from this same script, a narrator that
 * rewrites its input silently desynchronises the text from the voice everywhere.
 * Only speech-output models are eligible.
 */
async function pickOpenRouterModel(key) {
  if (modelArg) return modelArg;
  const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=speech', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenRouter: could not list speech models (HTTP ${res.status}).`);
  const ids = ((await res.json()).data ?? []).map((m) => m.id);
  if (!ids.length) throw new Error('OpenRouter returned no speech-capable models.');
  const preferred = ids.includes(OPENROUTER_TTS) ? OPENROUTER_TTS : ids[0];
  console.log(`[narrate] ${ids.length} speech model(s) available; using ${preferred}`);
  return preferred;
}

/**
 * OpenRouter's speech endpoint. It answers with raw audio bytes, not JSON, and
 * documents mp3/pcm rather than wav — so take mp3 and let ffmpeg normalise it to
 * the 48k stereo WAV the rest of the pipeline concatenates and measures.
 */
async function synthOpenRouter(key, model, text, dest) {
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: text,
      voice: voiceArg || OPENROUTER_VOICE,
      response_format: 'mp3',
    }),
  });
  if (res.status === 401) throw new Error('The OpenRouter key was rejected.');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter TTS failed (HTTP ${res.status}). ${detail.slice(0, 300)}`.trim());
  }
  const mp3 = `${dest}.mp3`;
  await writeFile(mp3, Buffer.from(await res.arrayBuffer()));
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '48000', '-ac', '2', dest]);
  await rm(mp3, { force: true });
}

/** Offline stand-in so the whole pipeline can be exercised without a key. */
async function synthLocal(text, dest) {
  if (process.platform !== 'darwin') throw new Error('--local currently relies on the macOS `say` command.');
  const aiff = `${dest}.aiff`;
  await run('say', ['-v', voiceArg || 'Samantha', '-r', '175', '-o', aiff, text]);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '2', dest]);
  await rm(aiff, { force: true });
}

async function durationOf(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return Number.parseFloat(stdout.trim());
}

const { SHOTS } = await import(`../decks/${deck}/shots.mjs`);
console.log(`[narrate] deck: ${deck} (${SHOTS.length} shots)`);

await mkdir(AUDIO, { recursive: true });

const provider = useLocal ? 'local' : useHume ? 'hume' : useOpenAI ? 'openai' : 'openrouter';
const key = provider === 'local'
  ? null
  : provider === 'hume' ? await humeKey()
  : provider === 'openai' ? await openAIKey()
  : await openRouterKey();
const voice = provider === 'hume' ? await pickVoice(key) : null;
const model = provider === 'openrouter' ? await pickOpenRouterModel(key) : null;
console.log(`[narrate] provider: ${provider}${provider === 'local' || provider === 'hume' ? '' : ` · voice ${voiceArg || OPENROUTER_VOICE}`}`);

// A short beat after each sentence: speech that starts the instant the previous
// one stops sounds rushed, and the camera needs a moment to arrive.
const TAIL = 0.55;

const cues = [];
let cursor = 0;
for (const shot of SHOTS) {
  const file = path.join(AUDIO, `${shot.id}.wav`);
  // Re-synthesise only what changed. Every run used to re-voice all of it, so a
  // single reworded line cost a whole deck of TTS calls.
  const stampFile = `${file}.txt`;
  const cached = existsSync(file) && existsSync(stampFile)
    && (await readFile(stampFile, 'utf8')) === `${provider}:${voice}:${shot.say}`;
  if (cached) console.log(`[narrate] ${shot.id.padEnd(20)} reused`);
  else if (provider === 'local') await synthLocal(shot.say, file);
  else if (provider === 'hume') await synthHume(key, voice, shot.say, file);
  else if (provider === 'openai') await synthOpenAI(key, shot.say, file);
  else await synthOpenRouter(key, model, shot.say, file);
  if (!cached) await writeFile(stampFile, `${provider}:${voice}:${shot.say}`, 'utf8');
  const speech = await durationOf(file);
  const duration = speech + TAIL;
  cues.push({ id: shot.id, text: shot.say, file, start: cursor, speech, duration });
  cursor += duration;
  if (!cached) console.log(`[narrate] ${shot.id.padEnd(20)} ${speech.toFixed(2)}s`);
}

// One continuous track, with the silent tails baked in, so the video only ever
// has to mux a single audio file.
const listFile = path.join(AUDIO, 'concat.txt');
const padded = [];
for (const cue of cues) {
  const out = path.join(AUDIO, `${cue.id}.padded.wav`);
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', cue.file,
    '-af', `apad=pad_dur=${TAIL.toFixed(3)}`, '-ar', '48000', '-ac', '2', out,
  ]);
  padded.push(out);
}
await writeFile(listFile, padded.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
const track = path.join(OUT, 'narration.wav');
await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', track]);

const total = await durationOf(track);
await writeFile(
  path.join(OUT, 'narration.json'),
  JSON.stringify({ provider, model, voice: voice ?? voiceArg ?? OPENROUTER_VOICE, total, tail: TAIL, cues }, null, 2),
  'utf8'
);

console.log(`\n[narrate] ${cues.length} cues · ${total.toFixed(1)}s total (${(total / 60).toFixed(1)} min)`);
console.log(`[narrate] track: ${path.relative(repoRoot, track)}`);
