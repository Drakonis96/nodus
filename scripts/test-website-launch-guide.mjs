// "Nodus has a new website" — the one-time notice that points outwards.
//
// Two things about it are deliberate and easy to undo by accident: it is a notice and
// not a tour (a title, one line and the address), and it is gated on its sentinel alone.
// Pinning it to a release would retire it the moment the next version ships, which is
// right for a one-off teaser and wrong for a website that exists from now on.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

test('the notice shows once, to installs past the essential guide, on any version', async () => {
  const guide = await read('src/components/WebsiteLaunchGuide.tsx');
  assert.match(guide, /nodus\.websiteLaunchSeen/);
  assert.match(guide, /previousTutorialVersion <= 0\) return false;/);
  assert.ok(!guide.includes('__APP_VERSION__'), 'a website does not expire with a release');
  // Seen only when actually dismissed: a launch that never reached the foreground, or
  // one closed by opening the site, must not consume the single showing.
  assert.match(guide, /const finish = \(\) => \{ markSeen\(\); onSettled\(\); \};/);
  assert.match(guide, /localStorage\.setItem\(SEEN_KEY, '1'\)/);
  // onSettled must fire even when it declines to show, or the update check behind it stalls.
  assert.match(guide, /useEffect\(\(\) => \{ if \(!eligible\) onSettled\(\); \}, \[eligible, onSettled\]\);/);
});

test('it carries the address in all eight languages and nothing else', async () => {
  const guide = await read('src/components/WebsiteLaunchGuide.tsx');
  assert.match(guide, /NODUS_WEBSITE_URL = 'https:\/\/nodusresearch\.com\/'/);
  assert.match(guide, /window\.nodus\.openExternal\(NODUS_WEBSITE_URL\)/);
  for (const language of LANGUAGES) {
    const key = language.includes('-') ? `'${language}'` : language;
    assert.match(guide, new RegExp(`\\n  ${key}: \\{`), `missing translation: ${language}`);
  }
  const copy = guide.slice(guide.indexOf('const COPY'), guide.indexOf('function shouldPresent'));
  assert.equal([...copy.matchAll(/^  (?:'pt-BR'|[a-z]{2}): \{/gm)].length, LANGUAGES.length);
  assert.equal([...copy.matchAll(/^\s+title: /gm)].length, LANGUAGES.length);
  assert.equal([...copy.matchAll(/^\s+summary: /gm)].length, LANGUAGES.length);
  assert.equal([...copy.matchAll(/^\s+visit: /gm)].length, LANGUAGES.length);
  // A title, a line and a link. No stage, no chapters, no feature list.
  assert.ok(!guide.includes('toolkit-guide-stage'), 'the notice has no stage to fill');
  assert.match(guide, /data-testid="website-launch-guide"/);
  assert.match(guide, /data-testid="website-launch-visit"/);
  assert.match(guide, /data-testid="website-launch-complete"/);
});

test('it sits behind the video tutorials announcement and in front of the update check', async () => {
  const [app, styles] = await Promise.all([read('src/App.tsx'), read('src/index.css')]);
  assert.match(app, /<WebsiteLaunchGuide/);
  assert.ok(app.indexOf('<TutorialVideosUpdateTour') < app.indexOf('<WebsiteLaunchGuide'));
  assert.ok(app.indexOf('<WebsiteLaunchGuide') < app.indexOf('<StartupUpdateModal'));
  // Reopening release notes by hand must not drag the notice back onto the screen.
  assert.match(app, /!websiteLaunchSettled && !manualWhatsNewOpen/);
  assert.match(styles, /\.website-launch-guide \{/);
});
