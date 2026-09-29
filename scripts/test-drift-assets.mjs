// Nodus Drift: the scripts that decide what may be bundled.
//
// The property under test is one sentence: no recording reaches the bundle unless the
// catalogue says it is cleared, and everything that does is byte-for-byte what was
// catalogued. Each case below is a way of breaking that sentence.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDriftFixtures } from './drift-fixtures.mjs';
import {
  auditAudioDirectory, crossfadeRule, loadDriftCatalog, measureFile, planAssets, prepareAssets, readIconNames, resolveTarget, sha256Hex,
} from './prepare-drift-assets.mjs';
import { auditAsar, locateAsar } from './verify-drift-assets.mjs';
import { repoRoot } from './drift-test-utils.mjs';

const catalog = loadDriftCatalog();
const real = catalog.DRIFT_SOUNDS;
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-drift-assets-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const fixtures = buildDriftFixtures(path.join(scratch, 'fixtures'));
const sourceDir = path.join(fixtures.directory, 'audio');
const clean = (name) => { const dir = path.join(scratch, name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); return dir; };

/** A copy of a real recording, cleared for the sake of the test, carrying the digest of `payload`. */
function approvedClone(id, payload) {
  const clone = structuredClone(real.find((sound) => sound.id === id));
  clone.source.bytes = payload.length;
  clone.source.sha256 = sha256Hex(payload);
  clone.provenance = { ...clone.provenance, licenseStatus: 'verified', licenseId: 'CC0-1.0', distributionReview: 'approved', reviewRef: 'legal/drift/REVIEW.md#test' };
  delete clone.provenance.evidenceRefs;
  clone.provenance.evidenceRefs = ['legal/drift/REVIEW.md#test'];
  return clone;
}

// ── the plan ───────────────────────────────────────────────────────────────

test('today: no recording is cleared, all 81 are pending, 8 are generators', () => {
  const plan = planAssets(real, catalog);
  assert.equal(plan.approved.length, 0);
  assert.equal(plan.pending.length, 81);
  assert.equal(plan.generated.length, 8);
  assert.equal(plan.pending.reduce((sum, d) => sum + d.source.bytes, 0), 103863687);
  assert.deepEqual(catalog.validateDriftCatalog(real, readIconNames()), []);
});

test('preparing with nothing cleared writes nothing, even to a directory that does not exist yet', async () => {
  const target = path.join(scratch, 'never-created');
  const result = await prepareAssets({ definitions: real, drift: catalog, targetDir: target, fetcher: () => { throw new Error('nothing may be fetched'); } });
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.failed, []);
  assert.equal(result.skipped.length, 81);
  assert.equal(fs.existsSync(target), false);
});

test('asking for a pending recording by id is refused, never honoured', async () => {
  const target = clean('pending-by-id');
  await assert.rejects(
    prepareAssets({ definitions: real, drift: catalog, targetDir: target, only: 'light-rain', fetcher: () => { throw new Error('no fetch'); } }),
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
  const fetcher = async (url) => { requested.push(url); return { ok: true, status: 200, arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) }; };
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
    assert.equal(audit.pending.length, 81);
    assert.equal(audit.generators.length, 8);
  }
});

test('the audit rejects audio that is pending, undeclared, altered, resized, linked or oversized', () => {
  const dir = clean('audit-bad');
  const put = (relative, bytes) => { const file = path.join(dir, ...relative.split('/')); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); return file; };

  put('rain/light-rain.mp3', Buffer.alloc(real.find((s) => s.id === 'light-rain').source.bytes)); // pending recording
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

  const definitions = [...real, a, b, c, d];
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
  const audit = auditAudioDirectory({ root: dir, definitions: [...real, ...good, extra], drift: catalog });
  assert.deepEqual(audit.problems, []);
  assert.deepEqual(audit.present.map((p) => p.id).sort(), ['fixture-a', 'fixture-b']);
  assert.equal(audit.bytes, good.reduce((sum, s) => sum + s.source.bytes, 0), 'the byte total is measured, not asserted');
  assert.deepEqual(audit.missing, ['fixture-c'], 'a cleared recording that is absent is reported, not failed');
});

test('the repository\'s own audio directory passes: nothing undeclared, nothing uncleared', () => {
  const output = execFileSync('node', [path.join(repoRoot, 'scripts/verify-drift-assets.mjs')], { encoding: 'utf8' });
  assert.match(output, /recordings packaged: 0 \(0 bytes\)/);
  assert.match(output, /pending review:\s+81/);
  assert.match(output, /\[drift-assets\] ok/);
});

test('the list command names every pending recording precisely', () => {
  const output = execFileSync('node', [path.join(repoRoot, 'scripts/prepare-drift-assets.mjs'), '--list'], { encoding: 'utf8' });
  assert.match(output, new RegExp(`@ ${catalog.DRIFT_UPSTREAM.commit}`));
  assert.match(output, /Approved recordings: 0/);
  assert.match(output, /Pending review: 81 \(103863687 bytes\)/);
  const rows = output.split('\n').filter((line) => /public\/sounds\//.test(line));
  assert.equal(rows.length, 81);
  assert.ok(rows.every((row) => /[0-9a-f]{64}/.test(row)));
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
  const bad = await auditAsar({ asarPath: dirty, definitions: real, drift: catalog });
  assert.ok(bad.problems.some((p) => p.includes('rain/light-rain.mp3') && p.includes('not cleared')));
  assert.ok(bad.problems.some((p) => p.includes('stray.mp3') && p.includes('does not declare')));

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
