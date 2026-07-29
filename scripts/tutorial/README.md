# Video tutorials by Nodus

Engine to record narrated tutorials **from the actual application**, with voice off in English,
subtitles in multiple languages, starter card, closing card and background music. Do not use manual
capture or *computer use*: drive the app with Playwright and capture frames by CDP.

With this, four videos have been made: general introduction (7:00), academic vault (4:58), Nodi
(1:59) and MCP + Nodus Server (3:00).

---

## If you're the model that's going to make the video, start here.

1. Read this whole file and then[PITFALLS.md](PITFALLS.md)The second is the list of failures that
   have already cost whole shots; almost everyone reappears.
2. Ask the user ** what the video should count** and in what order, before writing a single line of
   script.
3. **Ask for API keys if you don't have them.** It takes two, and they're not in the repository:
   - **OpenRouter** — for voice-over (TTS) and, in the videos that analyze corpus, for
     *embeddeds*.`~/.config/nodus/openrouter.key`, or`~/.config/nodus/openrouter-app.key`,
     or`OPENROUTER_API_KEY`.
   - **Google Gemini** — for document analysis in scanning videos. Read
     from`~/.config/nodus/gemini-app.key`.

If any does not exist, **ask the user and wait**.Do not suppose there is a balance, and do not write
any keys in the repository or in a comment: it is public.
4. **Never touch the user's installed Nodus.**All recording runs on a`NODUS_USERDATA`The engine
   already does; don't change it.
5. Test with`--dry`It's free and hunts almost everything.

---

## Requirements

```bash
npm run build
```

- `ffmpeg`and`ffprobe`in the PATH (`brew install ffmpeg`).
- The compiled app: the recorder drives`dist-electron/main.js`Not the source code.
- A theme in the background`scripts/tutorial/music/`(see[music/README.md](music/README.md)).

---

## The Six Phases

Each is a command.`--deck=<nombre>`choose the video; the output always goes
to`.tutorial-out/<nombre>/`Out of version control.

| # | Phase | Command | What's he doing? |
|---|------|---------|----------|
| 1 | **Guion** | edits`decks/<deck>/shots.mjs` | One sentence per plane and what the app does while |
| 2 | **Voice** | `node scripts/tutorial/engine/narrate.mjs --deck=<deck>` | One clip per sentence, measured with ffprobe |
| 3 | **Recording** | `node scripts/tutorial/decks/<deck>/record.mjs` | Drive the app and capture frames |
| 4 | **Subtitles** | `node scripts/tutorial/engine/subtitles.mjs --deck=<deck>` | `.srt`and`.vtt`, normal and for YouTube |
| 5 | **Assembly** | `node scripts/tutorial/engine/assemble.mjs --deck=<deck>` | Camera, cuts and voice over frames |
| 6 | **Cards** | `node scripts/tutorial/engine/cards.mjs --deck=<deck>` | Home, closing, music and subtitle tracks |

And for the description of YouTube:

```bash
node scripts/tutorial/engine/describe.mjs --deck=<deck>
```

### The rule that governs everything: **narration commands the clock**

Each plane lasts exactly how long your phrase lasts. Hence follows:

- **The voice is synthesized BEFORE recording.**No`narration.json`the recorder does not know how
  long to endure each plane and refuses to start (except with`--dry`).
- **You can redo a sentence without re-recording.** The assembly step cuts each clip to the length of your
  cue: you change the line, you re-narrify and assemble.This saved a shot in which the voice said
  "Gemini 2.5" and the screen showed 3.1.
- **If an action takes longer than its sentence, the plane is cut to half action.** Adjust the
  action, not the phrase.

---

## Make a new video, step by step

```bash
cp -r scripts/tutorial/decks/_template scripts/tutorial/decks/miVideo
```

1. **Writes the script** in`decks/miVideo/shots.mjs`. A phrase by plane, spoken in English. Spell
   the acronyms as they sound:`'M C P'`, `'H T T P S'`, `'P D F'`.
2. **Write the assistants** in`decks/miVideo/record.mjs`. Each one must **verify** what he did (see
   PITFALLS).
3. **Teach free**:`node scripts/tutorial/decks/miVideo/record.mjs --dry`Objective: **zero
   notices**.`⚠`ends up being seen in the video one way or another.
4. **Synthesizes the voice**:`node scripts/tutorial/engine/narrate.mjs --deck=miVideo`.
5. **Really recorded** and again demanded zero notices.
6. **Subtitles, assembly and cards** (phases 4-6).
7. **Checks video frames YA MONTADO**, not script or log frames:

   ```bash
   ffmpeg -ss 90 -i .tutorial-out/miVideo/nodus-tutorial-miVideo-en-final.mp4 -frames:v 1 -y /tmp/check.png
   ```

This step has uncovered three flaws that no log showed: ideas extracted in Spanish under English
interface, a progress bar across all the analysis views, and a narrative that spoke of nodes while
the screen showed themes.

---

## Series conventions

They keep between videos to look like a collection and not four loose things.

**Camera.** Approach (`focus`) ** only** for manners and for Nodi. Everything else carries a hoop
(`highlight`). The continuous tide zoom.

**Start card.** Clear background, the N of Nodus centered and below the title, 5 seconds. The title
comes out of`TITLE`in the`shots.mjs`The mallet.

**Closing card.** 8 seconds, clear adaptation of the mark closure.

Both are generated in`engine/cards.mjs`from HTML, which is left in`.tutorial-out/<deck>/cards/`
(`title.html`, `end.html`): they are edited there and seen instantly in the browser.

**Music.**One single theme in loop, with casts and **side compression** for the voice to always go
ahead (`MUSIC_GAIN = 0.16`) You should never step on the narrative.

**Voice.** Always the same, for videos to sound like a series:

| | |
|---|---|
| Provider | **OpenRouter** (`/api/v1/audio/speech`) |
| Model | **`deepgram/aura-2`** |
| Voice | **`aura-2-thalia-en`** |
| Language | English |

You are registered in`.tutorial-out/<deck>/narration.json` (`provider`, `model`, `voice`) in each
video; and`describe.mjs`you can change it with`--voice=<id>`o`--model=<id>`, and there are
alternative routes (`--provider=hume`, `--provider=openai`, `--local`for a voice filler without
cost).

Two alternatives were tested and discarded, in case they were tempted again:

- **`openai/gpt-audio-mini`** — is a chat model, not a speech: **paraphrases the script**. As
  subtitles are generated from the script, the voice and text cease to match in all
  languages.`output_modalities=speech`.
- **Hume Octave** — the voice was cut in the middle of a sentence (minute 0:52 of the first video).

**Subtitles.** English is read from the script itself, so voice and subtitle cannot be
disinchronized.`decks/<deck>/captions.mjs`. Two games are generated: one normal and the other
in`subtitles/youtube/`**displaced +5 s** to compensate the start card, with names BCP-47 ready to
upload.

**Minature.** A frame of the start card:

```bash
ffmpeg -ss 2 -i .tutorial-out/<deck>/nodus-tutorial-<deck>-en-final.mp4 -frames:v 1 -q:v 2 -y miniatura.jpg
```

---

## Privacy — non-negotiable

The repository is **public** and the videos are posted on YouTube.

- ** API keys and tokens: always faded.** Engine brings class`.nodus-blur`; the mallet`mcp`teaches
  how to cover **only** the characters of the token leaving the JSON around it legible.
- **Zoter's collections outside the video: blurred from the first frame.** A timer that starts when
  the dialog opens leaves several hundred milliseconds legible, and those frames end up
  published.`MutationObserver`.
- **No photos or personal documents of the user in the repository.**
- Verify privacy **by looking at frames from the assembled video**, not by reading the code: a blur rule that
  doesn't fit the markup doesn't give any error.

---

## Cost

Recording is free. What you pay for is the voice and, in the videos you analyze, the model.

- `--dry` does not use any paid services. Use it until there are no warnings.
- The voice **caches for text**: changing a phrase costs a call, not the whole mallet.
- **Reuse already scanned corpus** (`masterProfile`) rather than re-analysing.
- Tutorial chat responses should be **scripted**, not generated: a tutorial must teach
  the same thing every time and should not consume API credits.

---

## Structure

```
scripts/tutorial/
  README.md              this file
  PITFALLS.md            mistakes that have already ruined takes
  engine/
    recorder.mjs         drives and captures the app (shared by the decks)
    cursor.mjs           synthetic cursor and highlight ring
    narrate.mjs          voice-over, one sentence per shot, with caching
    assemble.mjs         camera, cuts and voice
    cards.mjs            cards, music and subtitle tracks
    subtitles.mjs        standard and YouTube .srt/.vtt files
    describe.mjs         chapters and description script
  decks/
    _template/           starting point for a new video
    intro/ academic/ nodi/ mcp/    the four completed examples
  probes/                probes: inspect the app without recording or spending
  music/                 the background theme
```

`intro`and`academic`are **anterior** to engine extraction: their`record.mjs`carry their own
scaffolding. They function and are preserved as a reference, especially`academic`He's the only one
who cares about Zotero and really scans the mallets.`nodi`and`mcp`They already use the engine and
are the pattern to copy.

`.tutorial-out/`(photograms, audio, profiles, videos) is ignored by git: it is working material,
weighs gigabytes and does not belong to the repository.

---

## Probes

`probes/`is used to answer questions about the **unrecorded app**: what selectors exist, what a
button is called in English, if a view returns results. It takes seconds and spends nothing.

The rule that saves the most time: **when something doesn't work, flips the real DOM instead of
deducing the dial**. Three attempts followed to close a modal failed to assume what its closing
button looked like; the fourth, after looking at it, hit the first one.
