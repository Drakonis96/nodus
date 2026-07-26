// Everything needed to write a YouTube description, computed from the finished cut.
//
// It does not invent prose. It gives you the chapter marks (measured from the real
// narration, including the five seconds the title card adds) and the spoken script,
// so the description is written from what the video actually says rather than from
// what someone remembers filming.
//
//   node scripts/tutorial/engine/describe.mjs --deck=mcp
//   node scripts/tutorial/engine/describe.mjs --deck=mcp --json
//
// Mark chapters in the shot list with `chapter: 'Label'`. With none marked, every
// shot is listed so you can pick.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const deck = process.argv.find((a) => a.startsWith('--deck='))?.slice('--deck='.length) ?? 'intro';
const asJson = process.argv.includes('--json');

const OUT = path.join(repoRoot, '.tutorial-out', deck);
const narrationFile = path.join(OUT, 'narration.json');
if (!existsSync(narrationFile)) {
  throw new Error(`No narration for "${deck}". Run narrate.mjs --deck=${deck} first.`);
}

const { SHOTS, TITLE } = await import(`../decks/${deck}/shots.mjs`);
const narration = JSON.parse(await readFile(narrationFile, 'utf8'));
const cueById = new Map(narration.cues.map((c) => [c.id, c]));

/** cards.mjs puts a five second title card in front of everything. */
const TITLE_CARD_SECONDS = 5;
const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const marked = SHOTS.filter((s) => s.chapter);
const chapters = (marked.length ? marked : SHOTS).map((shot) => {
  const cue = cueById.get(shot.id);
  return cue ? { id: shot.id, label: shot.chapter ?? shot.id, at: cue.start + TITLE_CARD_SECONDS } : null;
}).filter(Boolean);

const script = SHOTS.map((s) => s.say).join(' ');
const runtime = narration.cues.at(-1)
  ? narration.cues.at(-1).start + narration.cues.at(-1).duration + TITLE_CARD_SECONDS + 8
  : 0;

if (asJson) {
  console.log(JSON.stringify({
    deck, title: TITLE, runtime, chapters, script,
    voice: { provider: narration.provider, model: narration.model, voice: narration.voice },
  }, null, 2));
} else {
  console.log(`Deck:     ${deck}`);
  console.log(`Title:    ${TITLE}`);
  console.log(`Runtime:  ${stamp(runtime)} (title card + tutorial + end card)`);
  // The voice is part of the record: which provider, which model, which voice.
  console.log(`Voice:    ${narration.provider} · ${narration.model ?? '—'} · ${narration.voice ?? '—'}`);
  console.log(`\nChapters${marked.length ? '' : ' (none marked — every shot listed; add `chapter:` to the ones you want)'}:`);
  // YouTube requires the first chapter to start at 0:00.
  console.log('0:00 Introduction');
  for (const c of chapters) if (c.at > 1) console.log(`${stamp(c.at)} ${c.label}`);
  console.log('\nSpoken script, for writing the description from what is actually said:\n');
  console.log(script);
  console.log(`\nSubtitles to upload: .tutorial-out/${deck}/subtitles/youtube/`);
}
