// Step 4 of the tutorial pipeline: subtitles in every language the tutorial
// supports, in the two forms they are actually needed in.
//
// Cue timings are not authored: they come from the measured length of each
// narration clip, so a subtitle can never drift from the voice, and a re-recorded
// line updates every language at once.
//
// Two sets are written, because they are consumed at different points:
//
//   subtitles/            timed against the tutorial alone, which is what
//                         assemble.mjs embeds in the tutorial-only cut.
//   subtitles/youtube/    timed against the finished film, i.e. shifted by the
//                         length of the title card, named with the BCP-47 tags
//                         YouTube expects, and written as .srt as well as .vtt.
//
// Getting that offset wrong is silent and total: every caption in every language
// would run five seconds early for the whole video.
//
//   node scripts/tutorial/subtitles.mjs
//   node scripts/tutorial/subtitles.mjs --offset=5

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Which deck to subtitle; each keeps its own script, languages and output tree. */
const deck = process.argv.find((a) => a.startsWith('--deck='))?.slice('--deck='.length) ?? 'intro';
const { SHOTS } = await import(`../decks/${deck}/shots.mjs`);
const { LANGUAGES, CAPTIONS: TABLES } = await import(`../decks/${deck}/captions.mjs`);

const BASE = path.join(repoRoot, '.tutorial-out', deck);
const NAME = `nodus-tutorial-${deck}`;

const OUT = path.join(BASE, 'subtitles');
const YT = path.join(OUT, 'youtube');
await mkdir(YT, { recursive: true });

/** Must match TITLE_SECONDS in cards.mjs — the film starts with a title card. */
const offsetArg = process.argv.find((a) => a.startsWith('--offset='))?.slice('--offset='.length);
const OFFSET = offsetArg ? Number.parseFloat(offsetArg) : 5;

const narration = JSON.parse(await readFile(path.join(BASE, 'narration.json'), 'utf8'));

function clock(seconds, msSeparator) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}${msSeparator}${String(ms % 1000).padStart(3, '0')}`;
}
const vttStamp = (s) => clock(s, '.');
const srtStamp = (s) => clock(s, ',');

/**
 * Break a long line in two at a sensible point. Languages that do not separate
 * words with spaces are left alone — splitting those on a space does nothing, and
 * splitting them by character count would cut mid-word.
 */
function wrap(text) {
  if (text.length <= 46 || !text.includes(' ')) return text;
  const words = text.split(' ');
  let best = null;
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].length + 1;
    const diff = Math.abs(acc - (text.length - acc));
    if (best === null || diff < best.diff) best = { at: i + 1, diff };
  }
  return `${words.slice(0, best.at).join(' ')}\n${words.slice(best.at).join(' ')}`;
}

/** The cues for one language, already wrapped, in narration order. */
function cuesFor(code) {
  const table = TABLES[code] ?? {};
  const out = [];
  let untranslated = 0;
  for (const shot of SHOTS) {
    const cue = narration.cues.find((c) => c.id === shot.id);
    if (!cue) continue;
    // English is the spoken language: its subtitles are the script itself, so it is
    // complete by definition rather than "missing a translation".
    let text = code === 'en' ? shot.say : table[shot.id];
    if (!text) {
      text = shot.say;
      untranslated++;
    }
    // End on the speech, not on the silent tail, so the text clears between beats.
    out.push({ id: shot.id, start: cue.start, end: cue.start + cue.speech, text: wrap(text) });
  }
  return { cues: out, untranslated };
}

const toVtt = (cues, label, shift) => [
  'WEBVTT',
  '',
  `NOTE Nodus introductory tutorial — ${label}`,
  '',
  ...cues.flatMap((c) => [
    c.id,
    `${vttStamp(c.start + shift)} --> ${vttStamp(c.end + shift)}`,
    c.text,
    '',
  ]),
].join('\n');

const toSrt = (cues, shift) => cues
  .map((c, i) => `${i + 1}\n${srtStamp(c.start + shift)} --> ${srtStamp(c.end + shift)}\n${c.text}\n`)
  .join('\n');

const incomplete = [];
for (const { code, label, youtube } of LANGUAGES) {
  const { cues, untranslated } = cuesFor(code);

  // Timed against the tutorial alone.
  await writeFile(path.join(OUT, `${NAME}.${code}.vtt`), toVtt(cues, label, 0), 'utf8');

  // Timed against the finished film, for upload.
  await writeFile(path.join(YT, `${NAME}.${youtube}.vtt`), toVtt(cues, label, OFFSET), 'utf8');
  await writeFile(path.join(YT, `${NAME}.${youtube}.srt`), toSrt(cues, OFFSET), 'utf8');

  if (untranslated) incomplete.push(`${code} (${untranslated})`);
  console.log(
    `[subtitles] ${code.padEnd(6)} ${label.padEnd(20)} ${String(cues.length).padStart(2)} cues · ` +
    `${untranslated ? `⚠ ${untranslated} fell back to English` : 'complete'} · youtube: ${youtube}`
  );
}

console.log(`\n[subtitles] ${deck}: ${LANGUAGES.length} language(s)`);
console.log(`[subtitles] for YouTube (offset +${OFFSET}s): ${path.relative(repoRoot, YT)}`);
if (incomplete.length) {
  console.log(`[subtitles] incomplete: ${incomplete.join(', ')}`);
  process.exitCode = 1;
}
