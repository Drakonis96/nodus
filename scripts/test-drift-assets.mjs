// Nodus Drift: the scripts that decide what may be bundled.
//
// The property under test is one sentence: no recording reaches the bundle unless the
// catalogue says it is cleared, and everything that does is byte-for-byte what was
// catalogued. Each case below is a way of breaking that sentence.
//
// The real catalogue now approves all 81 recordings (legal/drift/REVIEW.md#recordings), so the
// "not cleared" cases run on copies of them that are set back to unresolved. Nothing here
// touches the network: fetching is always through a fake, and a real fetch fails the test.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDriftFixtures } from './drift-fixtures.mjs';
import {
  auditAudioDirectory, crossfadeRule, fetchWithRetry, loadDriftCatalog, measureFile, planAssets, prepareAssets, readIconNames, resolveTarget, sha256Hex,
} from './prepare-drift-assets.mjs';
import { auditAsar, locateAsar } from './verify-drift-assets.mjs';
import { repoRoot } from './drift-test-utils.mjs';

// A download the test did not ask for must not happen: it would be slow, flaky and 99 MiB.
globalThis.fetch = () => { throw new Error('the network is forbidden in the Drift asset tests: pass a fetcher'); };

const catalog = loadDriftCatalog();
const real = catalog.DRIFT_SOUNDS;
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-drift-assets-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const fixtures = buildDriftFixtures(path.join(scratch, 'fixtures'));
const sourceDir = path.join(fixtures.directory, 'audio');
const clean = (name) => { const dir = path.join(scratch, name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); return dir; };

/** A copy of a real recording, carrying the digest of `payload` (so a stand-in file can pass its checks). */
function approvedClone(id, payload) {
  const clone = structuredClone(real.find((sound) => sound.id === id));
  clone.source.bytes = payload.length;
  clone.source.sha256 = sha256Hex(payload);
  return clone;
}

/** A copy of a real recording that nobody has approved: what every recording used to be. */
function pendingOf(id) {
  const clone = structuredClone(real.find((sound) => sound.id === id));
  clone.provenance = {
    licenseStatus: 'unresolved',
    upstreamRepository: clone.provenance.upstreamRepository,
    upstreamCommit: clone.provenance.upstreamCommit,
    upstreamPath: clone.provenance.upstreamPath,
    evidenceRefs: [...clone.provenance.evidenceRefs],
    distributionReview: 'pending',
  };
  return clone;
}

/** The whole real catalogue with every recording set back to pending. */
const allPending = () => real.map((definition) => (definition.source.kind === 'file' ? pendingOf(definition.id) : definition));
const payloadResponse = (payload) => ({ ok: true, status: 200, arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) });

// ── the plan ───────────────────────────────────────────────────────────────

test('today: all 81 recordings are approved (as declared upstream) and 8 sounds are generators', () => {
  const plan = planAssets(real, catalog);
  assert.equal(plan.approved.length, 81);
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.generated.length, 8);
  assert.equal(plan.approved.reduce((sum, d) => sum + d.source.bytes, 0), 103863687);
  assert.deepEqual(catalog.validateDriftCatalog(real, readIconNames()), []);
});

test('an entry nobody approved is planned as pending, whatever else is true of it', () => {
  const plan = planAssets(allPending(), catalog);
  assert.equal(plan.approved.length, 0);
  assert.equal(plan.pending.length, 81);
  assert.equal(plan.generated.length, 8);
  const half = allPending().map((definition, index) => (index < 40 && definition.source.kind === 'file' ? real[index] : definition));
  assert.equal(planAssets(half, catalog).approved.length, 40, 'approval is per entry');
});

test('preparing with nothing cleared writes nothing, even to a directory that does not exist yet', async () => {
  const target = path.join(scratch, 'never-created');
  const result = await prepareAssets({ definitions: allPending(), drift: catalog, targetDir: target, fetcher: () => { throw new Error('nothing may be fetched'); } });
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.failed, []);
  assert.equal(result.skipped.length, 81);
  assert.equal(fs.existsSync(target), false);
});

test('asking for a pending recording by id is refused, never honoured', async () => {
  const target = clean('pending-by-id');
  await assert.rejects(
    prepareAssets({ definitions: allPending(), drift: catalog, targetDir: target, only: 'light-rain', fetcher: () => { throw new Error('no fetch'); } }),
    /has not been cleared for distribution/,
  );
  await assert.rejects(prepareAssets({ definitions: real, drift: catalog, targetDir: target, only: 'white-noise' }), /not a catalogued recording/);
  await assert.rejects(prepareAssets({ definitions: real, drift: catalog, targetDir: target, only: 'no-such' }), /not a catalogued recording/);
  assert.deepEqual(fs.readdirSync(target), []);
});

// ── preparing what is cleared ──────────────────────────────────────────────

test('a cleared recording is copied atomically and verified byte for byte', async () => {
  const target = clean('prepared');
  const good = fixtures.sounds.filter((s) => fixtures.good.includes(s.id)).slice(0, 2);
  const result = await prepareAssets({ definitions: good, drift: catalog, targetDir: target, sourceDir });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.written.map((w) => w.id), good.map((s) => s.id));
  for (const sound of good) {
    const bytes = fs.readFileSync(path.join(target, ...sound.source.asset.split('/')));
    assert.equal(bytes.length, sound.source.bytes);
    assert.equal(sha256Hex(bytes), sound.source.sha256);
  }
  const leftovers = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(dir, e.name)); else if (e.name.endsWith('.tmp')) leftovers.push(e.name); } };
  walk(target);
  assert.deepEqual(leftovers, [], 'no temporary file is left behind');
});

test('a wrong hash, a wrong size or an unreadable source is rejected and writes nothing', async () => {
  const target = clean('rejected');
  const source = clean('tampered-source');
  mkdirSync(path.join(source, 'fixtures'), { recursive: true });
  const base = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const original = fs.readFileSync(path.join(sourceDir, 'fixtures', 'fixture-a.wav'));

  const flipped = Buffer.from(original); flipped[100] ^= 0xff;
  writeFileSync(path.join(source, 'fixtures', 'hash.wav'), flipped);
  writeFileSync(path.join(source, 'fixtures', 'size.wav'), original.subarray(0, original.length - 10));
  const define = (id, file) => ({ ...structuredClone(base), id, source: { ...base.source, asset: `fixtures/${file}` } });
  const definitions = [define('bad-hash', 'hash.wav'), define('bad-size', 'size.wav'), define('no-file', 'absent.wav')];

  const result = await prepareAssets({ definitions, drift: catalog, targetDir: target, sourceDir: source });
  assert.deepEqual(result.written, []);
  assert.equal(result.failed.length, 3);
  assert.match(result.failed.find((f) => f.id === 'bad-hash').error, /SHA-256/);
  assert.match(result.failed.find((f) => f.id === 'bad-size').error, /bytes, the catalogue says/);
  assert.equal(result.failed.some((f) => f.id === 'no-file'), true);
  assert.equal(fs.existsSync(path.join(target, 'fixtures')), false, 'not even an empty directory for a rejected file');
});

test('a catalogue path outside the audio directory is refused by both locks', async () => {
  for (const asset of ['../x.wav', '../../x.wav', '/etc/passwd', 'a/../../x.wav', 'https://example.com/x.wav', 'a\\..\\x.wav', 'x.exe']) {
    assert.throws(() => resolveTarget(path.join(scratch, 'root'), asset, catalog), /refusing/, asset);
  }
  assert.ok(resolveTarget(path.join(scratch, 'root'), 'rain/light-rain.mp3', catalog).startsWith(path.join(scratch, 'root')));
  const base = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const escape = { ...structuredClone(base), id: 'escape', source: { ...base.source, asset: '../escape.wav' } };
  const target = clean('escape-target');
  const result = await prepareAssets({ definitions: [escape], drift: catalog, targetDir: target, sourceDir });
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /unsafe asset path/);
  assert.equal(fs.existsSync(path.join(target, '..', 'escape.wav')), false);
});

test('without a local source the bytes are fetched from the PINNED commit, never from main', async () => {
  const payload = Buffer.from('a stand-in for a recording'.repeat(40));
  const clone = approvedClone('light-rain', payload);
  const requested = [];
  const fetcher = async (url) => { requested.push(url); return payloadResponse(payload); };
  const target = clean('fetched');
  const result = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: target, fetcher });
  assert.deepEqual(result.failed, []);
  assert.equal(requested.length, 1);
  assert.equal(requested[0], `https://raw.githubusercontent.com/remvze/moodist/${catalog.DRIFT_UPSTREAM.commit}/public/sounds/rain/light-rain.mp3`);
  assert.ok(!/\/(main|master|HEAD)\//.test(requested[0]));
  assert.deepEqual(fs.readFileSync(path.join(target, 'rain', 'light-rain.mp3')), payload);

  const notFound = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: clean('http-error'), fetcher: async () => ({ ok: false, status: 404 }) });
  assert.match(notFound.failed[0].error, /HTTP 404/);
  const changed = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: clean('changed-upstream'), fetcher: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('something else entirely').buffer }) });
  assert.match(changed.failed[0].error, /bytes|SHA-256/);
});

test('a lost download is retried; a missing file is not', async () => {
  const payload = Buffer.from('a stand-in for a recording'.repeat(40));
  const noPause = () => Promise.resolve();
  const pauses = [];
  const recordPause = (ms) => { pauses.push(ms); return Promise.resolve(); };

  const flaky = (failures) => { let calls = 0; return { calls: () => calls, fetcher: async () => { calls += 1; if (calls <= failures.length) return failures[calls - 1](); return payloadResponse(payload); } }; };
  const dropped = () => { throw new Error('socket hang up'); };
  const status = (code) => () => ({ ok: false, status: code });

  const twice = flaky([dropped, dropped]);
  assert.deepEqual(await fetchWithRetry(twice.fetcher, 'https://example.test/a', 'a', { pause: recordPause }), payload);
  assert.equal(twice.calls(), 3, 'two lost connections, then the file');
  assert.deepEqual(pauses, [500, 1000], 'the pause grows');

  for (const code of [500, 503, 429]) {
    const once = flaky([status(code)]);
    assert.deepEqual(await fetchWithRetry(once.fetcher, 'https://example.test/a', 'a', { pause: noPause }), payload, `HTTP ${code} is retried`);
    assert.equal(once.calls(), 2);
  }

  for (const code of [404, 403, 401]) {
    const gone = flaky([status(code), status(code), status(code)]);
    await assert.rejects(fetchWithRetry(gone.fetcher, 'https://example.test/a', 'a', { pause: noPause }), new RegExp(`HTTP ${code}`));
    assert.equal(gone.calls(), 1, `HTTP ${code} is final: a pinned file that is missing will not appear on a second try`);
  }

  const never = flaky([dropped, dropped, dropped, dropped, dropped]);
  await assert.rejects(fetchWithRetry(never.fetcher, 'https://example.test/a', 'a', { attempts: 3, pause: noPause }), /socket hang up/);
  assert.equal(never.calls(), 3, 'it gives up after the attempts it was given');
});

test('a recording already in place and intact is kept without being fetched; a damaged one is fetched again', async () => {
  const payload = Buffer.from('a stand-in for a recording'.repeat(40));
  const clone = approvedClone('light-rain', payload);
  const target = clean('kept');
  let fetched = 0;
  const fetcher = async () => { fetched += 1; return payloadResponse(payload); };

  const first = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: target, fetcher });
  assert.deepEqual(first.written.map((w) => w.id), ['light-rain']);
  assert.equal(fetched, 1);

  const second = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: target, fetcher });
  assert.deepEqual(second.kept.map((k) => k.id), ['light-rain']);
  assert.deepEqual(second.written, []);
  assert.equal(fetched, 1, 'a packaging run after the first costs no download');

  fs.writeFileSync(path.join(target, 'rain', 'light-rain.mp3'), 'damaged on disk');
  const third = await prepareAssets({ definitions: [clone], drift: catalog, targetDir: target, fetcher });
  assert.deepEqual(third.written.map((w) => w.id), ['light-rain']);
  assert.equal(fetched, 2, 'what does not match its digest is replaced, never trusted');
  assert.deepEqual(fs.readFileSync(path.join(target, 'rain', 'light-rain.mp3')), payload);
});

// ── auditing a directory (and what the verifier says) ──────────────────────

test('an empty, absent or placeholder-only directory is clean and reports zero recordings', () => {
  const dir = clean('audit-empty');
  writeFileSync(path.join(dir, '.gitkeep'), '');
  writeFileSync(path.join(dir, 'README.md'), 'placeholder');
  for (const root of [dir, path.join(scratch, 'does-not-exist')]) {
    const audit = auditAudioDirectory({ root, definitions: real, drift: catalog });
    assert.deepEqual(audit.problems, []);
    assert.equal(audit.present.length, 0);
    assert.equal(audit.bytes, 0);
    assert.equal(audit.pending.length, 0, 'every recording is approved now');
    assert.equal(audit.missing.length, 81, 'and each one is reported as absent, not failed');
    assert.equal(audit.generators.length, 8);
  }
});

test('the audit rejects audio that is pending, undeclared, altered, resized, linked or oversized', () => {
  const dir = clean('audit-bad');
  const put = (relative, bytes) => { const file = path.join(dir, ...relative.split('/')); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); return file; };

  put('rain/light-rain.mp3', Buffer.alloc(real.find((s) => s.id === 'light-rain').source.bytes)); // a recording nobody approved
  put('mystery/track.mp3', 'undeclared');
  put('noise/white-noise.wav', 'a Moodist WAV that must not be reused');
  const a = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const b = fixtures.sounds.find((s) => s.id === 'fixture-b');
  const c = fixtures.sounds.find((s) => s.id === 'fixture-c');
  const d = fixtures.sounds.find((s) => s.id === 'fixture-d');
  const original = (sound) => fs.readFileSync(path.join(sourceDir, ...sound.source.asset.split('/')));
  const flipped = Buffer.from(original(a)); flipped[9] ^= 1;
  put(a.source.asset, flipped); // altered
  put(b.source.asset, original(b).subarray(0, 50)); // resized
  const outside = path.join(scratch, 'audit-outside.wav');
  writeFileSync(outside, original(c));
  mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  symlinkSync(outside, path.join(dir, c.source.asset)); // linked
  const huge = put(d.source.asset, ''); truncateSync(huge, 12 * 1024 * 1024 + 1); // oversized

  const definitions = [...real.filter((definition) => definition.id !== 'light-rain'), pendingOf('light-rain'), a, b, c, d];
  const audit = auditAudioDirectory({ root: dir, definitions, drift: catalog });
  const says = (needle) => audit.problems.some((problem) => problem.includes(needle));
  assert.ok(says('rain/light-rain.mp3') && says('not cleared for distribution'), 'a pending recording');
  assert.ok(says('mystery/track.mp3') && says('does not declare'), 'undeclared audio');
  assert.ok(says('noise/white-noise.wav') && says('does not declare'), 'a generator WAV is not a recording');
  assert.ok(says('fixtures/fixture-a.wav') && says('SHA-256'), 'altered bytes');
  assert.ok(says('fixtures/fixture-b.wav') && says('the catalogue says'), 'wrong size');
  assert.ok(says('fixtures/fixture-c.wav') && (says('symbolic link') || says('outside')), 'a symbolic link');
  assert.ok(says('fixtures/fixture-d.wav') && says('12 MiB'), 'above 12 MiB');
  assert.equal(audit.present.length, 0, 'not one of them counts as a packaged recording');
});

test('the audit accepts exactly what is declared, cleared and intact, and counts it', () => {
  const dir = clean('audit-good');
  const good = fixtures.sounds.filter((s) => ['fixture-a', 'fixture-b'].includes(s.id));
  for (const sound of good) {
    const file = path.join(dir, ...sound.source.asset.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, ...sound.source.asset.split('/')), file);
  }
  const extra = fixtures.sounds.find((s) => s.id === 'fixture-c'); // cleared but not shipped
  const generators = real.filter((definition) => definition.source.kind !== 'file');
  const audit = auditAudioDirectory({ root: dir, definitions: [...generators, ...good, extra], drift: catalog });
  assert.deepEqual(audit.problems, []);
  assert.deepEqual(audit.present.map((p) => p.id).sort(), ['fixture-a', 'fixture-b']);
  assert.equal(audit.bytes, good.reduce((sum, s) => sum + s.source.bytes, 0), 'the byte total is measured, not asserted');
  assert.deepEqual(audit.missing, ['fixture-c'], 'a cleared recording that is absent is reported, not failed');
});

test('the repository\'s own audio directory passes: nothing undeclared, nothing uncleared, nothing altered', () => {
  // A fresh checkout has no audio (it is fetched at packaging time); a prepared one has all 81.
  // Either is clean, and every approved recording is either there or reported as absent.
  const output = execFileSync('node', [path.join(repoRoot, 'scripts/verify-drift-assets.mjs')], { encoding: 'utf8' });
  const packaged = Number(/recordings packaged: (\d+) \(/.exec(output)?.[1]);
  const absent = Number(/cleared but absent:\s+(\d+)/.exec(output)?.[1]);
  assert.equal(packaged + absent, 81, output);
  assert.match(output, /pending review:\s+0/);
  assert.match(output, /\[drift-assets\] ok/);
});

test('the list command names every approved recording precisely, however it is piped', () => {
  // Run it several times: exiting right after printing to a pipe used to cut the listing short under load.
  for (let run = 0; run < 4; run++) {
    const output = execFileSync('node', [path.join(repoRoot, 'scripts/prepare-drift-assets.mjs'), '--list'], { encoding: 'utf8' });
    assert.match(output, new RegExp(`@ ${catalog.DRIFT_UPSTREAM.commit}`));
    assert.match(output, /Approved recordings: 81 \(103863687 bytes\)/);
    assert.match(output, /Pending review: 0 \(0 bytes\)/);
    const rows = output.split('\n').filter((line) => /public\/sounds\//.test(line));
    assert.equal(rows.length, 81, `run ${run}`);
    assert.ok(rows.every((row) => /[0-9a-f]{64}/.test(row)));
  }
});

// ── a packaged archive ─────────────────────────────────────────────────────

test('a packaged app.asar is audited like a directory', async (t) => {
  let asar;
  try { asar = await import('@electron/asar'); } catch { t.skip('@electron/asar is not installed'); return; }
  const build = async (name, populate) => {
    const src = clean(`asar-${name}-src`);
    const dir = path.join(src, 'electron', 'assets', 'drift', 'audio');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.gitkeep'), '');
    populate(dir);
    const out = path.join(scratch, `${name}.asar`);
    await asar.createPackage(src, out);
    return out;
  };

  const emptyAsar = await build('empty', () => {});
  const audit = await auditAsar({ asarPath: emptyAsar, definitions: real, drift: catalog });
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.present.length, 0);

  const dirty = await build('dirty', (dir) => {
    mkdirSync(path.join(dir, 'rain'), { recursive: true });
    writeFileSync(path.join(dir, 'rain', 'light-rain.mp3'), Buffer.alloc(real.find((s) => s.id === 'light-rain').source.bytes));
    writeFileSync(path.join(dir, 'stray.mp3'), 'x');
  });
  const bad = await auditAsar({ asarPath: dirty, definitions: [...real.filter((definition) => definition.id !== 'light-rain'), pendingOf('light-rain')], drift: catalog });
  assert.ok(bad.problems.some((p) => p.includes('rain/light-rain.mp3') && p.includes('not cleared')));
  assert.ok(bad.problems.some((p) => p.includes('stray.mp3') && p.includes('does not declare')));
  const altered = await auditAsar({ asarPath: dirty, definitions: real, drift: catalog });
  assert.ok(altered.problems.some((p) => p.includes('rain/light-rain.mp3') && p.includes('SHA-256')), 'an approved recording with the wrong bytes is still refused');

  const good = await build('good', (dir) => {
    const a = fixtures.sounds.find((s) => s.id === 'fixture-a');
    mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, 'fixtures', 'fixture-a.wav'), path.join(dir, 'fixtures', 'fixture-a.wav'));
    void a;
  });
  const ok = await auditAsar({ asarPath: good, definitions: [...real, fixtures.sounds.find((s) => s.id === 'fixture-a')], drift: catalog });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.present.map((p) => p.id), ['fixture-a']);
});

test('the archive is found from the archive itself, a macOS app, or a resources directory', () => {
  const root = clean('locate');
  const app = path.join(root, 'Nodus.app', 'Contents', 'Resources');
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, 'app.asar'), 'x');
  assert.equal(locateAsar(path.join(root, 'Nodus.app')), path.join(app, 'app.asar'));
  assert.equal(locateAsar(path.join(app, 'app.asar')), path.join(app, 'app.asar'));
  const win = path.join(root, 'win', 'resources');
  mkdirSync(win, { recursive: true });
  writeFileSync(path.join(win, 'app.asar'), 'x');
  assert.equal(locateAsar(path.join(root, 'win')), path.join(win, 'app.asar'));
  assert.throws(() => locateAsar(path.join(root, 'nowhere')), /no app\.asar/);
});

test('Windows ASAR paths keep native separators for stat and extraction', async () => {
  const asar = await import('@electron/asar');
  const src = clean('windows-native-asar-src');
  const audio = path.join(src, 'electron', 'assets', 'drift', 'audio');
  mkdirSync(path.join(audio, 'rain'), { recursive: true });
  writeFileSync(path.join(audio, 'README.md'), 'Bundled audio');
  const payload = Buffer.from('verified recording');
  writeFileSync(path.join(audio, 'rain', 'light-rain.mp3'), payload);
  const asarPath = path.join(scratch, 'windows-native.asar');
  await asar.createPackage(src, asarPath);
  const calls = [];
  // Simulate Windows's ASAR lookup on any test host, while reading a real archive.
  const lookup = (operation, archive, entry) => {
    assert.ok(!entry.includes('/'), `${operation} must receive Windows separators: ${entry}`);
    calls.push([operation, entry]);
    return asar[operation](archive, entry.replace(/\\/g, path.sep));
  };
  const windowsAsar = {
    listPackage: archive => asar.listPackage(archive).map(entry => entry.replace(/[/\\]/g, '\\')),
    statFile: (archive, entry) => lookup('statFile', archive, entry),
    extractFile: (archive, entry) => lookup('extractFile', archive, entry),
  };
  const definitions = [approvedClone('light-rain', payload)];
  const result = await auditAsar({ asarPath, definitions, drift: catalog, asarApi: windowsAsar });
  assert.deepEqual(result.problems, []);
  assert.equal(result.present.length, 1);
  assert.equal(result.bytes, payload.length);
  assert.ok(result.listing.includes('electron/assets/drift/audio/rain/light-rain.mp3'));
  assert.ok(calls.some(([operation, entry]) => operation === 'statFile' && entry.endsWith('README.md')));
  assert.ok(calls.some(([operation, entry]) => operation === 'extractFile' && entry.endsWith('light-rain.mp3')));
  // Keep the integrity check effective after fixing path handling.
  const corrupt = { ...windowsAsar, extractFile: (archive, entry) => entry.endsWith('.mp3') ? Buffer.alloc(payload.length) : windowsAsar.extractFile(archive, entry) };
  const rejected = await auditAsar({ asarPath, definitions, drift: catalog, asarApi: corrupt });
  assert.ok(rejected.problems.some(problem => /SHA-256|hash|digest/i.test(problem)));
});

test('--require-all turns a build without its recordings into a failure, and a complete one into a pass', async (t) => {
  let asar;
  try { asar = await import('@electron/asar'); } catch { t.skip('@electron/asar is not installed'); return; }
  const verify = path.join(repoRoot, 'scripts/verify-drift-assets.mjs');
  const resources = clean('require-all-resources');
  // The legal record that must travel beside the app, copied from the repository.
  const legal = path.join(resources, 'legal', 'drift');
  mkdirSync(legal, { recursive: true });
  for (const file of ['README.md', 'PROVENANCE.md', 'REVIEW.md', 'MOODIST_LICENSE.txt']) fs.copyFileSync(path.join(repoRoot, 'legal', 'drift', file), path.join(legal, file));
  const src = clean('require-all-src');
  const audioDir = path.join(src, 'electron', 'assets', 'drift', 'audio');
  mkdirSync(audioDir, { recursive: true });
  writeFileSync(path.join(audioDir, '.gitkeep'), '');
  await asar.createPackage(src, path.join(resources, 'app.asar'));

  const plain = spawnSync('node', [verify, '--asar', resources], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.match(plain.stdout, /recordings packaged: 0 \(0 bytes\)/);
  assert.match(plain.stdout, /cleared but absent:\s+81/);

  const strict = spawnSync('node', [verify, '--asar', resources, '--require-all'], { encoding: 'utf8' });
  assert.equal(strict.status, 1, 'an installer without its 81 recordings must not be produced');
  assert.match(strict.stderr, /81 approved recording\(s\) are not in this build/);
  assert.match(strict.stderr, /prepare-drift-assets/, 'and it says what to run');

  // the legal record is required too: the notice shown to users points at it
  fs.rmSync(path.join(legal, 'MOODIST_LICENSE.txt'));
  const noLicense = spawnSync('node', [verify, '--asar', resources], { encoding: 'utf8' });
  assert.equal(noLicense.status, 1);
  assert.match(noLicense.stderr, /MOODIST_LICENSE\.txt: not shipped beside the app/);
});

// ── measuring ──────────────────────────────────────────────────────────────

test('the crossfade rule: prepared loops are left alone, the rest get min(1 s, 20%)', () => {
  assert.equal(crossfadeRule({ seamJumpRatio: 0.5, edgeMismatchDb: 1 }, 60), 0);
  assert.equal(crossfadeRule({ seamJumpRatio: 4, edgeMismatchDb: -6 }, 60), 0, 'the thresholds are inclusive');
  assert.equal(crossfadeRule({ seamJumpRatio: 4.01, edgeMismatchDb: 0 }, 60), 1000);
  assert.equal(crossfadeRule({ seamJumpRatio: 0, edgeMismatchDb: 6.01 }, 60), 1000);
  assert.equal(crossfadeRule({ seamJumpRatio: 0, edgeMismatchDb: -49 }, 3), 600, '20% of a 3 second recording');
  assert.equal(crossfadeRule({ seamJumpRatio: 9, edgeMismatchDb: 0 }, 6.39), 1000);
});

test('measuring a file reproduces its catalogued bytes, digest and duration', (t) => {
  const file = path.join(sourceDir, 'fixtures', 'fixture-a.wav');
  const measured = measureFile(file);
  const catalogued = fixtures.sounds.find((s) => s.id === 'fixture-a').source;
  assert.equal(measured.bytes, catalogued.bytes);
  assert.equal(measured.sha256, catalogued.sha256);
  if (measured.durationSeconds === undefined) { t.skip('ffprobe/ffmpeg not installed: only bytes and digest were measured'); return; }
  assert.ok(Math.abs(measured.durationSeconds - catalogued.durationSeconds) < 0.002);
  assert.equal(measured.channels, 2);
  assert.equal(measured.sampleRate, 24000);
  assert.ok(Number.isFinite(measured.seamJumpRatio) && Number.isFinite(measured.edgeMismatchDb));
  const cli = spawnSync('node', [path.join(repoRoot, 'scripts/prepare-drift-assets.mjs'), '--measure', sourceDir], { encoding: 'utf8' });
  assert.ok(cli.stdout.includes('not found in the directory'), 'the real catalogue\'s recordings are simply not in a fixture directory');
});

test('the catalogue of the sounds is the source of the numbers a review would reproduce', () => {
  // The measured values pinned in the catalogue are the ones the script's --measure prints for
  // the pinned upstream files; they are checked in full against the real files by whoever runs
  // `--measure <checkout>/public/sounds`. Here: every recording carries all four fields.
  for (const sound of real.filter((s) => s.source.kind === 'file')) {
    for (const field of ['bytes', 'sha256', 'durationSeconds', 'crossfadeMs']) assert.notEqual(sound.source[field], undefined, `${sound.id}.${field}`);
  }
});
