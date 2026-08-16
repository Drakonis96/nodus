import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The gate on the announcements channel.
 *
 * site/data/announcements.json is published by merging it: the Pages workflow deploys
 * on any push to main touching site/**. So this file is the only review step between
 * writing a notice and every install seeing it, and it enforces the two things that
 * cannot be fixed after the fact — a notice must be readable in all eight interface
 * languages, and an id must never be reused, because the id is what a read mark hangs
 * off and reusing one marks a NEW notice as already read for everyone.
 *
 * The runtime parser is deliberately more forgiving (es + en are enough, and it drops
 * bad entries instead of failing). That is resilience for a file that arrives over the
 * network; it is not licence to publish an untranslated notice.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-announcements-'));

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const announcements = loadModule('shared/announcements.ts');
const {
  ANNOUNCEMENT_LANGUAGES,
  announcementCopyFor,
  compareVersions,
  isAnnouncementVisible,
  parseAnnouncements,
  sortAnnouncements,
} = announcements;

const PUBLISHED_FILE = 'site/data/announcements.json';
const published = JSON.parse(fs.readFileSync(path.join(repoRoot, PUBLISHED_FILE), 'utf8'));

test.after(() => rm(outDir, { recursive: true, force: true }));

test('the published file has the shape the app expects', () => {
  assert.equal(typeof published, 'object');
  assert.ok(Array.isArray(published.notices), `${PUBLISHED_FILE} must hold a "notices" array`);
  assert.ok(published.notices.length <= 50, 'at most 50 notices may be published at once');
});

test('the new website is published through the remote feed', () => {
  const notice = published.notices.find((entry) => entry.id === '2026-08-nodusresearch-website');
  assert.ok(notice, 'the website announcement must be in the remotely deployed feed');
  assert.equal(notice.url, 'https://nodusresearch.com/');
  assert.equal(notice.copy.es.title, 'Nodus estrena nueva web');
  assert.ok(!fs.existsSync(path.join(repoRoot, 'src/components/WebsiteLaunchGuide.tsx')), 'the announcement must not depend on a new app release');
});

test('every published notice is written in all eight languages', () => {
  for (const notice of published.notices) {
    const missing = ANNOUNCEMENT_LANGUAGES.filter((language) => {
      const copy = notice.copy?.[language];
      return !copy || typeof copy.title !== 'string' || !copy.title.trim() || typeof copy.body !== 'string' || !copy.body.trim();
    });
    assert.deepEqual(missing, [], `notice "${notice.id}" is missing: ${missing.join(', ')}`);
  }
});

test('every published notice survives the runtime parser unchanged', () => {
  // The parser is what users actually get. A notice that it silently drops — a bad id,
  // an over-long body, a non-https link — would pass a shape check and reach nobody.
  const { announcements: parsed, rejected } = parseAnnouncements(published);
  assert.equal(rejected, 0, 'the parser rejected a published notice');
  assert.equal(parsed.length, published.notices.length);
});

test('ids are unique, stable slugs and dates are real', () => {
  const seen = new Set();
  for (const notice of published.notices) {
    assert.match(notice.id, /^[a-z0-9][a-z0-9-]{0,63}$/, `"${notice.id}" is not a slug`);
    assert.ok(!seen.has(notice.id), `"${notice.id}" appears twice`);
    seen.add(notice.id);
    assert.match(notice.date, /^\d{4}-\d{2}-\d{2}$/, `"${notice.id}" has no ISO date`);
    if (notice.expiresAt) {
      assert.match(notice.expiresAt, /^\d{4}-\d{2}-\d{2}$/, `"${notice.id}" has a malformed expiresAt`);
      assert.ok(notice.expiresAt >= notice.date, `"${notice.id}" expires before it is published`);
    }
    if (notice.url) assert.ok(notice.url.startsWith('https://'), `"${notice.id}" links to a non-https URL`);
    if (notice.severity) assert.ok(['info', 'warning'].includes(notice.severity), `"${notice.id}" has an unknown severity`);
  }
});

// ── the parser, against input nobody controls ─────────────────────────────────

const validCopy = Object.fromEntries(ANNOUNCEMENT_LANGUAGES.map((language) => [language, { title: `T ${language}`, body: `B ${language}` }]));
const validNotice = { id: 'sample-notice', date: '2026-08-01', severity: 'info', copy: validCopy };

test('the parser accepts a well-formed notice and both container shapes', () => {
  assert.equal(parseAnnouncements({ notices: [validNotice] }).announcements.length, 1);
  assert.equal(parseAnnouncements([validNotice]).announcements.length, 1);
  assert.deepEqual(parseAnnouncements(null), { announcements: [], rejected: 0 });
  assert.deepEqual(parseAnnouncements('not json'), { announcements: [], rejected: 0 });
});

test('the parser refuses every link that is not https', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com', 'example.com', 'data:text/html,x']) {
    const [parsed] = parseAnnouncements([{ ...validNotice, url }]).announcements;
    assert.equal(parsed.url, undefined, `${url} must not survive`);
  }
  const [ok] = parseAnnouncements([{ ...validNotice, url: 'https://example.com/survey' }]).announcements;
  assert.equal(ok.url, 'https://example.com/survey');
});

test('the parser drops notices it cannot trust', () => {
  const bad = [
    { ...validNotice, id: 'Not A Slug' },
    { ...validNotice, id: '' },
    { ...validNotice, date: '2026-02-31' },
    { ...validNotice, date: 'yesterday' },
    { ...validNotice, copy: { es: validCopy.es } },
    { ...validNotice, copy: { ...validCopy, es: { title: 'x'.repeat(121), body: 'ok' } } },
    { ...validNotice, copy: { ...validCopy, en: { title: 'ok', body: 'x'.repeat(601) } } },
    null,
    'a string',
  ];
  for (const notice of bad) {
    assert.equal(parseAnnouncements([notice]).announcements.length, 0, `${JSON.stringify(notice)?.slice(0, 60)} must be dropped`);
  }
});

test('a duplicate id is kept once, and the file is capped', () => {
  const { announcements: parsed, rejected } = parseAnnouncements([validNotice, { ...validNotice, date: '2026-08-02' }]);
  assert.equal(parsed.length, 1);
  assert.equal(rejected, 1);
  const many = Array.from({ length: 60 }, (_, i) => ({ ...validNotice, id: `notice-${i}` }));
  assert.equal(parseAnnouncements(many).announcements.length, 50);
});

test('expiry and version targeting decide what a build shows', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  const base = { ...validNotice };
  assert.equal(isAnnouncementVisible({ ...base, expiresAt: '2026-08-06' }, { now, version: '3.2.3' }), true, 'expiry day included');
  assert.equal(isAnnouncementVisible({ ...base, expiresAt: '2026-08-05' }, { now, version: '3.2.3' }), false);
  assert.equal(isAnnouncementVisible({ ...base, minVersion: '3.2.3' }, { now, version: '3.2.3' }), true, 'minVersion inclusive');
  assert.equal(isAnnouncementVisible({ ...base, minVersion: '3.3.0' }, { now, version: '3.2.3' }), false);
  assert.equal(isAnnouncementVisible({ ...base, maxVersion: '3.2.3' }, { now, version: '3.2.3' }), true, 'maxVersion inclusive');
  assert.equal(isAnnouncementVisible({ ...base, maxVersion: '3.2.2' }, { now, version: '3.2.3' }), false);
  // An app version nobody can parse must not hide every targeted notice.
  assert.equal(isAnnouncementVisible({ ...base, minVersion: '3.3.0' }, { now, version: 'dev' }), true);
});

test('versions compare by segment, not as strings', () => {
  assert.ok(compareVersions('3.10.0', '3.9.0') > 0, '10 is above 9');
  assert.equal(compareVersions('3.2', '3.2.0'), 0, 'missing segments are zero');
  assert.ok(compareVersions('3.2.3', '3.2.4') < 0);
});

test('warnings sort above infos published the same day, newest first', () => {
  const sorted = sortAnnouncements([
    { ...validNotice, id: 'old', date: '2026-07-01' },
    { ...validNotice, id: 'info-today', date: '2026-08-01', severity: 'info' },
    { ...validNotice, id: 'warn-today', date: '2026-08-01', severity: 'warning' },
  ]);
  assert.deepEqual(sorted.map((notice) => notice.id), ['warn-today', 'info-today', 'old']);
});

test('copy falls back English-then-Spanish, never to nothing', () => {
  const partial = { ...validNotice, copy: { es: { title: 'ES', body: 'ES' }, en: { title: 'EN', body: 'EN' } } };
  assert.equal(announcementCopyFor(partial, 'de').title, 'EN');
  assert.equal(announcementCopyFor(partial, 'en').title, 'EN');
  assert.equal(announcementCopyFor(partial, 'es').title, 'ES');
  assert.equal(announcementCopyFor({ ...validNotice, copy: { es: { title: 'ES', body: 'ES' } } }, 'fr').title, 'ES');
});

test('the app fetches announcements conditionally, on the update timer, and can be turned off', () => {
  const fetcher = fs.readFileSync(path.join(repoRoot, 'electron/announcements.ts'), 'utf8');
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  // A conditional request is the whole cost argument: the usual answer carries no body.
  assert.match(fetcher, /'If-None-Match'/);
  assert.match(fetcher, /response\.status === 304/);
  // The URL is requested verbatim. Appending a cache-buster the way the tutorial
  // catalogue does would make every check a unique URL, and so a full transfer.
  assert.match(fetcher, /net\.fetch\(announcementsUrl\(\), \{/);
  assert.doesNotMatch(fetcher, /\?t=\$\{/);
  assert.match(fetcher, /announcementsEnabled !== false/);
  assert.match(fetcher, /NODUS_ANNOUNCEMENTS_URL/);
  assert.match(announcements.ANNOUNCEMENTS_URL, /^https:\/\/nodusresearch\.com\/data\/announcements\.json$/);
  assert.match(fetcher, /status: 'updated'/);
  assert.match(fetcher, /status: 'not-modified'/);
  assert.match(fetcher, /status: 'disabled'/);
  assert.match(fetcher, /status: 'error'/);
  // No timer of its own: it rides the four-hour update check.
  assert.doesNotMatch(fetcher, /setInterval/);
  assert.match(main, /refreshAnnouncements\('scheduled'\)/);
  assert.match(main, /refreshAnnouncements\('startup'\)/);
  assert.match(main, /UPDATE_CHECK_INTERVAL_MS = 4 \* 60 \* 60 \* 1000/);
});

test('the header and Nodi can manually refresh the same notification centre', () => {
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipc.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload/api.ts'), 'utf8');
  const windows = fs.readFileSync(path.join(repoRoot, 'shared/api/windows.ts'), 'utf8');
  const header = fs.readFileSync(path.join(repoRoot, 'src/components/NotificationsPanel.tsx'), 'utf8');
  const nodi = fs.readFileSync(path.join(repoRoot, 'src/components/nodi/NodiCompanion.tsx'), 'utf8');

  assert.match(ipc, /h\('nodi:notifications:refresh'/);
  assert.match(ipc, /await refreshAnnouncements\('manual'\)/);
  assert.match(ipc, /'nodi:notifications:changed'/);
  assert.match(ipc, /'announcements:changed'/);
  assert.match(preload, /refreshNotifications:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('nodi:notifications:refresh'\)/);
  assert.match(windows, /'refreshNotifications'/, 'the isolated Nodi window must receive the refresh bridge method');
  assert.match(header, /data-testid="header-notifications-refresh"/);
  assert.match(header, /data-testid="header-notifications-refresh-status"/);
  assert.match(header, /<Icon name="refresh"/);
  assert.match(nodi, /data-testid="nodi-notifications-refresh"/);
  assert.match(nodi, /data-testid="nodi-notifications-refresh-status"/);
  assert.match(nodi, /<Icon name="refresh"/);
});

test('announcement text is rendered as text, never as markup', () => {
  for (const file of ['src/components/NotificationsPanel.tsx', 'src/components/nodi/NodiCompanion.tsx']) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/, `${file} must not render remote copy as HTML`);
  }
  const panel = fs.readFileSync(path.join(repoRoot, 'src/components/NotificationsPanel.tsx'), 'utf8');
  assert.doesNotMatch(panel, /<Markdown[^>]*\{copy\./, 'announcement bodies must not go through the Markdown renderer');
});
