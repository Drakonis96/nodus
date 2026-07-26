import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The video tutorials are the one place Nodus embeds a remote frame, and the one place
// the tutorial's twelve languages are served from a table that is NOT the i18n one.
// Both facts are load-bearing, so they are pinned here.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

// shared/tutorialVideos.ts only imports types, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-videos-'));
const bundle = path.join(outDir, 'tutorialVideos.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/tutorialVideos.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const catalogue = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── the catalogue ───────────────────────────────────────────────────────────────

test('the three published tutorials keep their ids, order and vault mapping', () => {
  assert.deepEqual(
    catalogue.TUTORIAL_VIDEOS.map((video) => [video.id, video.youtubeId, video.order]),
    [
      ['essentials', 'QqSY1_DeDRM', 1],
      ['academic', 'Z-5CpJBVV_I', 2],
      ['nodi', '5OTe5CtefME', 3],
    ]
  );
  // Only the academic tour can currently be replaced by a video; the other vault tours
  // must keep their two-option opening step until their own video exists.
  assert.equal(catalogue.tutorialVideoForVault('academic').id, 'academic');
  for (const type of ['estudio', 'genealogy', 'databases', 'docencia', 'primary_sources']) {
    assert.equal(catalogue.tutorialVideoForVault(type), undefined, `${type} has no video yet`);
  }
  assert.equal(catalogue.tutorialVideoForVault(undefined), undefined);
});

test('embeds go to the no-cookie host, in the tutorial language', () => {
  const video = catalogue.tutorialVideo('essentials');
  const url = new URL(catalogue.youtubeEmbedUrl(video, 'ja'));
  assert.equal(url.origin, 'https://www.youtube-nocookie.com');
  assert.equal(url.pathname, '/embed/QqSY1_DeDRM');
  assert.equal(url.searchParams.get('hl'), 'ja');
  assert.equal(url.searchParams.get('rel'), '0', 'the end screen stays on this channel');
  assert.equal(catalogue.youtubeWatchUrl(video), 'https://www.youtube.com/watch?v=QqSY1_DeDRM');
  assert.equal(catalogue.TUTORIAL_VIDEO_EMBED_ORIGIN, 'https://www.youtube-nocookie.com');
});

test('every language the cinematic guide offers has full video copy', async () => {
  const tutorial = await read('src/views/BasicsTutorial.tsx');
  // The languages are declared once, in the guide's own picker. Read them from there so
  // adding a thirteenth language fails here instead of silently serving it English.
  const codes = [...tutorial.matchAll(/\{ code: '([\w-]+)', label:/g)].map((match) => match[1]);
  assert.equal(codes.length, 12, `the guide offers twelve languages, found ${codes.length}`);

  const spanish = catalogue.tutorialVideoCopy('es');
  for (const code of codes) {
    const copy = catalogue.tutorialVideoCopy(code);
    for (const key of ['tutorialWord', 'chooseTitle', 'chooseLede', 'gridTitle', 'gridLede', 'more', 'watched', 'markUnwatched', 'openExternal', 'hosting', 'close', 'play', 'tourVideo']) {
      assert.ok(typeof copy[key] === 'string' && copy[key].trim().length > 0, `${code}.${key} is missing`);
    }
    for (const option of ['videoOption', 'textOption']) {
      assert.ok(copy[option].title.trim().length > 0, `${code}.${option}.title is missing`);
      assert.ok(copy[option].body.trim().length > 0, `${code}.${option}.body is missing`);
    }
    assert.ok(copy.videoOption.badge.trim().length > 0, `${code} does not mark the recommended option`);
    for (const id of ['essentials', 'academic', 'nodi']) {
      assert.ok(copy.videos[id].title.trim().length > 0, `${code}.videos.${id}.title is missing`);
      assert.ok(copy.videos[id].body.trim().length > 0, `${code}.videos.${id}.body is missing`);
    }
    if (code === 'es') continue;
    // A table that merely falls back to Spanish would satisfy every check above.
    assert.notEqual(copy.more, spanish.more, `${code} falls back to the Spanish "more on the way"`);
    assert.notEqual(copy.videos.essentials.title, spanish.videos.essentials.title, `${code} falls back to Spanish video titles`);
  }
});

test('"more tutorials on the way" is promised in every language', () => {
  for (const code of ['es', 'en', 'fr', 'tr', 'de', 'it', 'pt', 'pt-BR', 'zh', 'ja', 'ru', 'uk']) {
    assert.ok(catalogue.tutorialVideoCopy(code).more.length > 0, `${code} says nothing about more tutorials`);
  }
  assert.match(catalogue.tutorialVideoCopy('en').more, /more/i);
  assert.match(catalogue.tutorialVideoCopy('es').more, /próximamente/i);
  // An unknown code must not crash the grid; English is the documented fallback.
  assert.equal(catalogue.tutorialVideoCopy('xx').more, catalogue.tutorialVideoCopy('en').more);
});

// ── the surfaces ────────────────────────────────────────────────────────────────

test('the CSP admits the tutorial embed and nothing wider', async () => {
  const html = await read('index.html');
  assert.match(html, /frame-src https:\/\/www\.youtube-nocookie\.com;/, 'frame-src names the no-cookie host');
  // frame-src overrides child-src for frames, so youtube.com proper must stay out: the
  // watch page is opened in the system browser, never framed.
  assert.doesNotMatch(html, /frame-src[^;]*https:\/\/www\.youtube\.com/);
});

test('the grid never reaches Google until a video is opened', async () => {
  const grid = await read('src/components/TutorialVideos.tsx');
  // Posters are local: a gradient, or a WebP dropped into src/assets/tutorials/. A
  // remote thumbnail would make the mere sight of the grid a request to Google.
  assert.doesNotMatch(grid, /ytimg|img\.youtube|<img/);
  assert.match(grid, /video\.poster/);
  assert.match(grid, /import\.meta\.glob<string>\('\.\.\/assets\/tutorials\/\*/);
  // The one request the grid does make is the catalogue, and it goes through the main
  // process — the renderer's CSP knows nothing about that host.
  assert.match(grid, /window\.nodus\.getTutorialCatalogue\(\)/);
  const html = await read('index.html');
  assert.doesNotMatch(html, /connect-src[^;]*drakonis96/);
  // The iframe only exists inside the player, which is mounted on click.
  assert.match(grid, /\{playing && <TutorialVideoPlayer/);
  assert.match(grid, /allowFullScreen/, 'the player can go fullscreen');
  assert.match(grid, /allow="autoplay; encrypted-media; fullscreen; picture-in-picture"/);
  assert.match(grid, /void markWatched\(video\.id\)/, 'opening a video marks it watched');
  assert.match(grid, /unmarkWatched/, 'and the user can undo that');
  assert.match(grid, /openExternal\(youtubeWatchUrl\(video\)\)/, 'the browser stays available as a fallback');
});

test('the watched flags are app-wide, like the tutorial version they sit next to', async () => {
  const [types, defaults, prefs] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/settingsRepo.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  assert.match(types, /tutorialVideosWatched: string\[\]/);
  assert.match(defaults, /tutorialVideosWatched: \[\]/);
  assert.match(prefs, /'tutorialVideosWatched'/, 'a video watched in one vault stays watched in the others');
});

test('the cinematic guide offers video or text, and both complete it', async () => {
  const tutorial = await read('src/views/BasicsTutorial.tsx');
  // The choice is the third gate: it must come AFTER the two mandatory ones, so the
  // cards and the grid are already in the chosen language.
  const languageGate = tutorial.indexOf("if (!tutorialLanguage) return");
  const styleGate = tutorial.indexOf('if (!styleChosen) return');
  const modeGate = tutorial.indexOf('if (!learnMode) return');
  assert.ok(languageGate > 0 && styleGate > languageGate && modeGate > styleGate, 'language → Nodi → learning mode');
  assert.match(tutorial, /data-testid="basics-tutorial-mode"/);
  assert.match(tutorial, /data-testid="tutorial-mode-video"/);
  assert.match(tutorial, /data-testid="tutorial-mode-text"/);
  assert.match(tutorial, /tutorial-mode-option recommended/, 'the video path is the recommended one');
  assert.match(tutorial, /data-testid="basics-tutorial-videos"/);
  assert.match(tutorial, /<TutorialVideoGrid language=\{activeLanguage\} variant="cinema" \/>/);
  // Skippable from the video screen, and completable from it too.
  assert.match(tutorial, /data-testid="tutorial-mode-switch-text"/);
  const videoScreen = tutorial.slice(tutorial.indexOf('basics-tutorial-videos'));
  assert.match(videoScreen.slice(0, 1400), /data-testid="basics-tutorial-complete"/);
  assert.match(videoScreen.slice(0, 1400), /\{skipDialog\}/);
  // The deck's arrow keys must not run while the grid or the gates are on screen.
  assert.match(tutorial, /if \(!tutorialLanguage \|\| !styleChosen \|\| learnMode !== 'text'\) return;/);
});

test('Settings leads its tutorials section with the grid', async () => {
  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /<TutorialVideoGrid language=\{settings\.uiLanguage\} variant="panel" \/>/);
  const gridAt = settings.indexOf('<TutorialVideoGrid');
  const replayAt = settings.indexOf('basics-tutorial-replay');
  assert.ok(gridAt > 0 && gridAt < replayAt, 'the videos come before the replay buttons');
  const css = await read('src/components/tutorialVideos.css');
  assert.match(css, /\.light \.tutorial-videos-panel \.tutorial-video-card/, 'the Settings grid is remapped for light mode');
  assert.match(css, /\.light \.tutorial-video-player/);
});

test('the videos are announced once to installs that predate them', async () => {
  const [guide, app] = await Promise.all([
    read('src/components/TutorialVideosGuide.tsx'),
    read('src/App.tsx'),
  ]);
  // The announcement shows the videos rather than describing them: the same grid and
  // the same in-app player, in the update tours' cinematic chrome.
  assert.match(guide, /className="toolkit-guide-cinema tutorial-videos-guide"/);
  assert.match(guide, /data-testid="tutorial-videos-update-tour"/);
  assert.match(guide, /<TutorialVideoGrid language=\{uiLanguage\} variant="panel" showHeading=\{false\} \/>/);
  // Shown once, and only to someone who finished the guide back when it was text-only.
  assert.match(guide, /if \(previousTutorialVersion <= 0\) return false;/);
  assert.match(guide, /localStorage\.getItem\(SEEN_KEY\) !== '1'/);
  // Marked seen on dismissal, never merely on mount.
  assert.match(guide, /const finish = \(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*markTutorialVideosAnnouncementSeen\(\);/);

  // Completing the cinematic guide answers the same question, so it settles the
  // announcement too — a fresh install must never be told about a choice it just made.
  assert.match(app, /markTutorialVideosAnnouncementSeen\(\);\s*\n\s*await window\.nodus\.updateSettings\(\{ basicsTutorialVersion: BASICS_TUTORIAL_VERSION \}\)/);
  // It queues behind the other one-time tours and ahead of the update check, so two
  // modals never fight for the foreground.
  const order = ['<WhatsNewModal', '<PlatformHighlightsUpdateTour', '<ToolkitBetaUpdateTour', '<TutorialVideosUpdateTour', '<StartupUpdateModal'].map((tag) => app.indexOf(tag));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the videos announcement sits between the toolkit tour and the update check');
  assert.match(app, /toolkitBetaTourSettled && tutorialVideosSettled && !manualWhatsNewOpen && <StartupUpdateModal/);
});

test('the announcement speaks every interface language', async () => {
  const [guide, types] = await Promise.all([
    read('src/components/TutorialVideosGuide.tsx'),
    read('shared/types.ts'),
  ]);
  // Read the languages from the type itself, so an eighth UI language fails here.
  const declared = types.match(/export type AppLanguage = ([^;]+);/)[1]
    .split('|').map((code) => code.trim().replace(/'/g, ''));
  assert.equal(declared.length, 7);
  const table = guide.slice(guide.indexOf('const COPY: Record<AppLanguage, AnnouncementCopy>'), guide.indexOf('export function markTutorialVideosAnnouncementSeen'));
  for (const code of declared) {
    assert.match(table, new RegExp(`\\n  '?${code}'?: \\{`), `${code} has no announcement copy`);
  }
  // Seven distinct summaries: a table that quietly reused one language would pass every
  // per-key check above.
  const summaries = [...table.matchAll(/\n    summary: '(.+)',/g)].map((match) => match[1]);
  assert.equal(summaries.length, 7);
  assert.equal(new Set(summaries).size, 7, 'one of the languages falls back to another');
});

test('a vault tour with a video offers three ways in', async () => {
  const [engine, tour] = await Promise.all([read('src/views/tourEngine.tsx'), read('src/views/Tour.tsx')]);
  assert.match(engine, /vaultType\?: VaultType/);
  assert.match(engine, /data-testid="tour-watch-video"/);
  assert.match(engine, /tutorialVideoCopy\(getActiveLang\(\)\)\.tourVideo/);
  // "Sí, enséñame" stays, demoted to secondary, and "Ahora no" is untouched: three
  // options, with the video recommended.
  assert.match(engine, /Sí, enséñame/);
  assert.match(engine, /Ahora no/);
  assert.match(engine, /video \? 'btn btn-ghost border border-neutral-700' : 'btn btn-primary'/);
  // Three buttons do not fit side by side in a 360px card: they overflowed it and each
  // label broke into three lines. The opening step stacks them full-width instead, in
  // every vault — the layout the rest of the videos will land on.
  assert.match(engine, /isFirst \? 'flex flex-col gap-3' : 'flex items-center justify-between'/);
  assert.match(engine, /isFirst \? 'flex flex-col gap-2' : 'flex gap-2'/);
  assert.equal((engine.match(/className="btn btn-(primary|ghost) w-full"/g) ?? []).length, 2);
  assert.match(engine, /className=\{`w-full \$\{video \?/);
  // Escape must reach the player, not dismiss the tour behind it.
  assert.match(engine, /if \(watchingVideo\) return;/);
  assert.match(tour, /vaultType="academic"/);
  // Every vault tour declares its type, so each gains the option the day its own video
  // is published — without a release and without touching the engine.
  for (const [file, type] of [
    ['src/views/StudyTour.tsx', 'estudio'],
    ['src/views/GenealogyTour.tsx', 'genealogy'],
    ['src/views/DatabasesTour.tsx', 'databases'],
    ['src/views/TeachingTour.tsx', 'docencia'],
  ]) assert.match(await read(file), new RegExp(`vaultType="${type}"`), `${file} declares its vault type`);
  assert.match(engine, /tutorialVideoForVault\(vaultType, catalogue\)/);
});

// ── the catalogue: untrusted input from the network ─────────────────────────────

test('the published catalogue can add tutorials and update copy', () => {
  const { videos, rejected } = catalogue.parseTutorialCatalogue({
    videos: [
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 1, icon: 'network' },
      {
        id: 'teaching', youtubeId: 'abcdefghijk', order: 4, icon: 'graduation', vaultType: 'docencia',
        copy: { es: { title: 'La bóveda de docencia', body: 'Cursos, horarios y clases.' }, en: { title: 'The teaching vault', body: 'Courses, timetables and classes.' } },
      },
    ],
  });
  assert.equal(rejected, 0);
  assert.equal(videos.length, 2);
  const merged = catalogue.mergeTutorialCatalogue(videos);
  assert.deepEqual(merged.map((video) => video.id), ['essentials', 'academic', 'nodi', 'teaching']);
  // A new vault video reaches that vault's tour with no code change.
  assert.equal(catalogue.tutorialVideoForVault('docencia', merged).youtubeId, 'abcdefghijk');
  // Its own copy is used, in the reader's language, falling back to English.
  assert.equal(catalogue.videoCopyFor(merged[3], 'es').title, 'La bóveda de docencia');
  assert.equal(catalogue.videoCopyFor(merged[3], 'ja').title, 'The teaching vault');
  // Built-in videos keep the compiled translations.
  assert.equal(catalogue.videoCopyFor(merged[0], 'ja').title, catalogue.tutorialVideoCopy('ja').videos.essentials.title);
});

test('the catalogue cannot smuggle in anything the app would render blindly', () => {
  const { videos, rejected } = catalogue.parseTutorialCatalogue({
    videos: [
      { id: 'evil', youtubeId: 'https://evil.example/x', order: 1, copy: { en: { title: 'x', body: 'y' } } },
      { id: 'Evil Slug', youtubeId: 'QqSY1_DeDRM', order: 2, copy: { en: { title: 'x', body: 'y' } } },
      { id: 'nocopy', youtubeId: 'QqSY1_DeDRM', order: 3 },
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 4 },
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 5 },
    ],
  });
  // Rejected: a non-YouTube id, a non-slug id, a new entry with no copy, and a duplicate.
  assert.equal(rejected, 4);
  assert.deepEqual(videos.map((video) => video.id), ['essentials']);

  // A poster is never taken from the file: a remote CSS value could fetch an image and
  // break the promise that an unopened grid makes no requests.
  const injected = catalogue.parseTutorialCatalogue({
    videos: [{
      id: 'poster', youtubeId: 'QqSY1_DeDRM', order: 1, icon: '"><script>', poster: 'url(https://evil.example/pixel.png)',
      copy: { en: { title: 'x', body: 'y' } },
    }],
  });
  assert.equal(injected.videos.length, 1);
  assert.doesNotMatch(injected.videos[0].poster, /url\(|evil/);
  assert.equal(injected.videos[0].icon, 'play', 'an icon outside the allowlist falls back');

  // Junk of every shape yields an empty list rather than an exception.
  for (const raw of [null, undefined, 42, 'nope', {}, { videos: 'nope' }, [], [null, 7, 'x']]) {
    assert.deepEqual(catalogue.parseTutorialCatalogue(raw).videos, []);
  }
});

test('a broken catalogue can never hide a tutorial the app already ships', () => {
  // Half-written file, wrong ids, empty list: the built-in three survive all of it.
  for (const remote of [[], catalogue.parseTutorialCatalogue({ videos: [{ id: 'x' }] }).videos]) {
    assert.deepEqual(
      catalogue.mergeTutorialCatalogue(remote).map((video) => video.id),
      ['essentials', 'academic', 'nodi']
    );
  }
});

test('the published file matches what this build ships', async () => {
  const published = JSON.parse(await read('docs/tutorials.json'));
  const { videos, rejected } = catalogue.parseTutorialCatalogue(published);
  assert.equal(rejected, 0, 'every entry in docs/tutorials.json passes the app\'s own validation');
  assert.deepEqual(
    videos.map((video) => [video.id, video.youtubeId, video.order]),
    catalogue.TUTORIAL_VIDEOS.map((video) => [video.id, video.youtubeId, video.order]),
    'docs/tutorials.json and the built-in list agree'
  );
  assert.equal(catalogue.TUTORIAL_CATALOGUE_URL, 'https://drakonis96.github.io/nodus/tutorials.json');
});

test('the catalogue is fetched in the main process, cached, and never fatal', async () => {
  const [main, ipc, preload] = await Promise.all([
    read('electron/tutorialCatalogue.ts'),
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
  ]);
  assert.match(ipc, /h\('tutorials:catalogue', async \(\) => getTutorialCatalogue\(\)\)/);
  assert.match(preload, /getTutorialCatalogue: \(\) => ipcRenderer\.invoke\('tutorials:catalogue'\)/);
  assert.match(main, /net\.fetch\(url, \{ signal: controller\.signal \}\)/, 'uses Electron\'s net stack, so the app proxy applies');
  assert.match(main, /\$\{catalogueUrl\(\)\}\?t=/, 'and busts the GitHub Pages cache');
  // The URL is overridable so a verification run can serve a catalogue of its own, but
  // it must default to the published one — an unset env var cannot change production.
  assert.match(main, /process\.env\.NODUS_TUTORIAL_CATALOGUE_URL \|\| TUTORIAL_CATALOGUE_URL/);
  assert.match(main, /FETCH_TIMEOUT_MS = 4_000/);
  assert.match(main, /controller\.abort\(\)/);
  assert.match(main, /readCache\(\)/);
  assert.match(main, /return \[\.\.\.TUTORIAL_VIDEOS\]/, 'the built-in list is the last resort');
  // A failed check must not be remembered as done for the rest of the run.
  assert.match(main, /inFlight\.catch\(\(\) => \{ inFlight = null; \}\)/);
});

test('a packaged renderer still gets the real player, not YouTube error 153', async () => {
  const main = await read('electron/main.ts');
  // file:// sends no http referer, and YouTube answers framed embeds without one with
  // its "video player configuration error" card. Naming the Nodus site fixes it, and
  // the rewrite must stay scoped to the single host Nodus frames.
  assert.match(main, /onBeforeSendHeaders\(\s*\{ urls: \[`\$\{TUTORIAL_VIDEO_EMBED_ORIGIN\}\/\*`\] \}/);
  assert.match(main, /Referer: 'https:\/\/drakonis96\.github\.io\/nodus\/'/);
  assert.match(main, /import \{ TUTORIAL_VIDEO_EMBED_ORIGIN \} from '@shared\/tutorialVideos'/);
});
