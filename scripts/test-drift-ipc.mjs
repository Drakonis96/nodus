// Nodus Drift: the main-process side of loading a recording.
//
// The service is driven against REAL files in a temporary directory (a symbolic link that
// escapes it, a truncated file, an altered byte), and the two IPC handlers are driven through
// fake events so the trust rule (main frame of the main window, nothing else) is exercised
// for real. Electron itself is replaced by a stand-in: none of this needs a running app.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTs, loadTsStubbed, repoRoot } from './drift-test-utils.mjs';
import { buildDriftFixtures } from './drift-fixtures.mjs';
import { assertApiMethods, assertChannelsWired, ipcCensus } from './ipc-channel-census.mjs';

const ELECTRON_STUB = `module.exports = {
  app: { getAppPath: () => globalThis.__DRIFT_APP_PATH__ },
  session: { fromPartition: () => ({ partition: 'browser' }) },
};`;
const ipc = await loadTsStubbed('electron/ipc/drift.ts', {
  stubs: { '^electron$': ELECTRON_STUB, 'browser/session$': "module.exports = { NODUS_BROWSER_PARTITION: 'persist:nodus-browser' };" },
});
const drift = loadTs('shared/drift.ts');
const { DRIFT_SOUNDS } = loadTs('shared/driftCatalog.ts');
const { localizeIpcPayload, localizeRuntimeError } = loadTs('shared/uiLanguage.ts');

const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-drift-ipc-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const fixtures = buildDriftFixtures(path.join(scratch, 'fixtures'));
const audioRoot = path.join(fixtures.directory, 'audio');
const entriesOf = (definitions, root = audioRoot) => definitions.map((definition) => ({ definition, root }));
const service = (definitions = fixtures.sounds, options = {}) => ipc.createDriftAudioService({ entries: entriesOf(definitions), ...options });
const codeOf = (error) => /drift-audio:([a-z-]+):/.exec(error?.message ?? '')?.[1];
const rejectsWith = async (promise, code, label) => {
  await assert.rejects(promise, (error) => {
    assert.equal(codeOf(error), code, `${label}: expected drift-audio:${code}, got ${error?.message}`);
    return true;
  }, label);
};

/** Count reads without changing them: the tests below assert on what was NEVER read. */
function spyOnReads() {
  const original = fs.promises.readFile;
  const reads = [];
  fs.promises.readFile = function (file, ...rest) { reads.push(String(file)); return original.call(this, file, ...rest); };
  return { reads, restore: () => { fs.promises.readFile = original; } };
}

// ── the bytes ──────────────────────────────────────────────────────────────

test('a catalogued, cleared recording comes back as exactly its bytes, as a plain Uint8Array', async () => {
  const bytes = await service().readAudio('fixture-a');
  const onDisk = fs.readFileSync(path.join(audioRoot, 'fixtures', 'fixture-a.wav'));
  assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype, 'a plain Uint8Array, not a Node Buffer');
  assert.deepEqual(Buffer.from(bytes), onDisk);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.buffer.byteLength, bytes.length, 'an exactly sized ArrayBuffer: nothing else shares it');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fixtures.sounds.find((s) => s.id === 'fixture-a').source.sha256);
});

test('the IPC wrapper\'s payload localisation keeps the bytes: same object, same content', () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
  for (const language of ['es', 'en', 'fr', 'de', 'ja', 'ko', 'zh-TW', 'nonsense']) {
    const out = localizeIpcPayload(bytes, language);
    assert.equal(out, bytes, `${language}: not rebuilt, not converted to an object`);
    assert.ok(out instanceof Uint8Array);
    assert.deepEqual([...out], [1, 2, 3, 250, 0, 7]);
  }
  const wrapped = localizeIpcPayload({ payload: bytes, note: 'x' }, 'fr');
  assert.equal(wrapped.payload, bytes);
  // and Electron's serialiser (structured clone) keeps a typed array a typed array, exactly sized
  const cloned = structuredClone(bytes);
  assert.ok(cloned instanceof Uint8Array);
  assert.equal(cloned.buffer.byteLength, bytes.length);
});

test('error messages carry their reason as a prefix and survive localisation in every language', () => {
  for (const code of ['unavailable', 'missing', 'corrupt', 'too-large']) {
    const error = new ipc.DriftAudioError(code, 'the file is not there');
    assert.match(error.message, new RegExp(`^drift-audio:${code}: `));
    for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
      assert.equal(localizeRuntimeError(error.message, language), error.message, `${language} ${code}`);
    }
  }
});

// ── who can ask, and for what ──────────────────────────────────────────────

test('only a catalogued sound id is accepted: never a path, a URL or anything else', async () => {
  const s = service();
  const hostile = [undefined, null, 42, true, {}, [], ['fixture-a'], () => 'fixture-a', Symbol.iterator.toString(),
    'no-such-sound', '', ' ', 'FIXTURE-A', 'fixture-a ', 'fixture a', 'fixture-a/../fixture-b',
    '../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', 'file:///etc/passwd', 'https://example.com/a.mp3',
    'data:audio/wav;base64,AAAA', 'fixtures/fixture-a.wav', 'x'.repeat(5000), 'fixture-a\0'];
  for (const input of hostile) await rejectsWith(s.readAudio(input), 'unavailable', `input ${String(input).slice(0, 40)}`);
});

test('a generated sound has no file to read', async () => {
  const s = ipc.createDriftAudioService({ entries: entriesOf(DRIFT_SOUNDS, path.join(scratch, 'empty')) });
  for (const id of ['white-noise', 'pink-noise', 'brown-noise', 'binaural-alpha']) await rejectsWith(s.readAudio(id), 'unavailable', id);
});

/** A real recording's entry set back to what every recording once was: nothing established, nothing reviewed. */
function pendingOf(id) {
  const clone = structuredClone(DRIFT_SOUNDS.find((sound) => sound.id === id));
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

test('a recording that is not cleared for distribution is refused even if its file is sitting there', async () => {
  const root = path.join(scratch, 'pending-root');
  mkdirSync(path.join(root, 'rain'), { recursive: true });
  const rain = pendingOf('light-rain');
  // A file with exactly the catalogued name, size and even bytes of the right length
  writeFileSync(path.join(root, 'rain', 'light-rain.mp3'), Buffer.alloc(rain.source.bytes, 1));
  const spy = spyOnReads();
  try {
    const s = ipc.createDriftAudioService({ entries: entriesOf([...DRIFT_SOUNDS.filter((sound) => sound.id !== 'light-rain'), rain], root) });
    await rejectsWith(s.readAudio('light-rain'), 'unavailable', 'unresolved recording');
    assert.deepEqual(spy.reads, [], 'and its bytes were never read');
  } finally { spy.restore(); }
});

test('an approved recording, declared upstream, is read like any other: exactly its bytes', async () => {
  const root = path.join(scratch, 'declared-root');
  mkdirSync(path.join(root, 'rain'), { recursive: true });
  // The real entry (declared licence, approved review) with the size and digest of a small stand-in file.
  const payload = Buffer.from('a stand-in for a recording'.repeat(50));
  const rain = structuredClone(DRIFT_SOUNDS.find((sound) => sound.id === 'light-rain'));
  assert.equal(rain.provenance.licenseStatus, 'declared');
  rain.source.bytes = payload.length;
  rain.source.sha256 = crypto.createHash('sha256').update(payload).digest('hex');
  writeFileSync(path.join(root, 'rain', 'light-rain.mp3'), payload);
  const s = ipc.createDriftAudioService({ entries: entriesOf([rain], root) });
  const bytes = await s.readAudio('light-rain');
  assert.deepEqual(Buffer.from(bytes), payload);
  assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype);
  const answer = await s.catalog();
  assert.equal(answer.sounds[0].availability, 'available');
  // and the same file with one byte changed is refused, whatever the entry says about its licence
  writeFileSync(path.join(root, 'rain', 'light-rain.mp3'), Buffer.concat([payload.subarray(0, payload.length - 1), Buffer.from([0])]));
  await rejectsWith(s.readAudio('light-rain'), 'corrupt', 'an approved recording still has to match its digest');
});

// ── the file ───────────────────────────────────────────────────────────────

test('a missing file, or a missing audio directory, is "missing"', async () => {
  await rejectsWith(service().readAudio('fixture-missing'), 'missing', 'declared but absent');
  const s = ipc.createDriftAudioService({ entries: entriesOf(fixtures.sounds, path.join(scratch, 'no-such-directory')) });
  await rejectsWith(s.readAudio('fixture-a'), 'missing', 'no directory');
});

test('an altered file is caught by its SHA-256', async () => {
  await rejectsWith(service().readAudio('fixture-corrupt'), 'corrupt', 'altered byte');
});

test('empty, wrong-sized and oversized files are refused BEFORE they are read', async () => {
  const root = path.join(scratch, 'sizes');
  mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  const base = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const define = (id, file, bytes) => ({ ...structuredClone(base), id, source: { ...base.source, asset: `fixtures/${file}`, bytes } });

  writeFileSync(path.join(root, 'fixtures', 'empty.wav'), '');
  writeFileSync(path.join(root, 'fixtures', 'short.wav'), Buffer.alloc(100));
  const huge = path.join(root, 'fixtures', 'huge.wav');
  writeFileSync(huge, '');
  truncateSync(huge, 12 * 1024 * 1024 + 1); // sparse: no real disk is spent
  const definitions = [define('sized-empty', 'empty.wav', 10), define('sized-short', 'short.wav', 5000), define('sized-huge', 'huge.wav', 12 * 1024 * 1024 + 1)];

  const spy = spyOnReads();
  try {
    const s = ipc.createDriftAudioService({ entries: entriesOf(definitions, root) });
    await rejectsWith(s.readAudio('sized-empty'), 'corrupt', 'empty');
    await rejectsWith(s.readAudio('sized-short'), 'corrupt', 'wrong size');
    await rejectsWith(s.readAudio('sized-huge'), 'too-large', 'above 12 MiB');
    assert.deepEqual(spy.reads, [], 'not one of them was read');
  } finally { spy.restore(); }
  assert.equal(drift.MAX_DRIFT_AUDIO_BYTES, 12 * 1024 * 1024);
});

test('the limit is a parameter of the service, and 12 MiB is its default', async () => {
  await rejectsWith(service(fixtures.sounds, { maxBytes: 1000 }).readAudio('fixture-a'), 'too-large', 'tiny limit');
  assert.ok((await service().readAudio('fixture-a')).length > 1000);
});

// ── confinement ────────────────────────────────────────────────────────────

test('a catalogue path that tries to leave the audio directory is refused', async () => {
  const base = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const outside = path.join(scratch, 'outside.wav');
  writeFileSync(outside, fs.readFileSync(path.join(audioRoot, 'fixtures', 'fixture-a.wav')));
  for (const asset of ['../outside.wav', '../../outside.wav', '/etc/passwd', 'fixtures/../../outside.wav', 'https://x/y.wav', 'fixtures\\..\\..\\outside.wav', 'a/./b.wav']) {
    const definition = { ...structuredClone(base), id: 'escape', source: { ...base.source, asset } };
    await rejectsWith(service([definition]).readAudio('escape'), 'unavailable', `asset ${asset}`);
  }
});

test('a symbolic link cannot smuggle a file in from outside the audio directory', async () => {
  const root = path.join(scratch, 'links');
  mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  const secret = path.join(scratch, 'secret.wav');
  const original = fs.readFileSync(path.join(audioRoot, 'fixtures', 'fixture-a.wav'));
  writeFileSync(secret, original);
  symlinkSync(secret, path.join(root, 'fixtures', 'link.wav'));
  const outsideDir = path.join(scratch, 'outside-dir');
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(path.join(outsideDir, 'x.wav'), original);
  symlinkSync(outsideDir, path.join(root, 'linked'));

  const base = fixtures.sounds.find((s) => s.id === 'fixture-a');
  const definitions = [
    { ...structuredClone(base), id: 'via-file-link', source: { ...base.source, asset: 'fixtures/link.wav' } },
    { ...structuredClone(base), id: 'via-dir-link', source: { ...base.source, asset: 'linked/x.wav' } },
  ];
  const spy = spyOnReads();
  try {
    const s = ipc.createDriftAudioService({ entries: entriesOf(definitions, root) });
    // right name, right size, right hash: only the confinement can stop these
    await rejectsWith(s.readAudio('via-file-link'), 'unavailable', 'file link');
    await rejectsWith(s.readAudio('via-dir-link'), 'unavailable', 'directory link');
    assert.deepEqual(spy.reads, []);
  } finally { spy.restore(); }
  // a link that stays inside is fine: the rule is about where it ends up
  symlinkSync(path.join(audioRoot, 'fixtures', 'fixture-a.wav'), path.join(audioRoot, 'fixtures', 'inside-link.wav'));
  const inside = { ...structuredClone(base), id: 'inside-link', source: { ...base.source, asset: 'fixtures/inside-link.wav' } };
  assert.equal((await service([inside]).readAudio('inside-link')).length, base.source.bytes);
});

// ── hashing ────────────────────────────────────────────────────────────────

test('the SHA-256 is computed on the first load only, and again if the file changes', async () => {
  const root = path.join(scratch, 'hash-once');
  mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  const base = fixtures.sounds.find((s) => s.id === 'fixture-c');
  const file = path.join(root, 'fixtures', 'fixture-c.wav');
  const original = fs.readFileSync(path.join(audioRoot, 'fixtures', 'fixture-c.wav'));
  writeFileSync(file, original);

  const hash = crypto.createHash;
  let hashes = 0;
  crypto.createHash = function (...args) { hashes += 1; return hash.apply(this, args); };
  try {
    const s = ipc.createDriftAudioService({ entries: entriesOf([base], root) });
    await s.readAudio('fixture-c');
    await s.readAudio('fixture-c');
    await s.readAudio('fixture-c');
    assert.equal(hashes, 1, 'verified once, not on every read');
    // same size, different byte, new modification time: the change is noticed
    const altered = Buffer.from(original);
    altered[500] ^= 0x01;
    writeFileSync(file, altered);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await rejectsWith(s.readAudio('fixture-c'), 'corrupt', 'altered after the first load');
    assert.equal(hashes, 2);
  } finally { crypto.createHash = hash; }
});

// ── the catalogue ──────────────────────────────────────────────────────────

test('the catalogue reports availability, reads no audio and never exposes a path', async () => {
  const spy = spyOnReads();
  let response;
  try { response = await service([...DRIFT_SOUNDS, ...fixtures.sounds]).catalog(); } finally { spy.restore(); }
  assert.deepEqual(spy.reads, [], 'a catalogue request reads no audio');
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.sounds.length, DRIFT_SOUNDS.length + fixtures.sounds.length);
  const by = (id) => response.sounds.find((sound) => sound.id === id);
  assert.equal(by('light-rain').availability, 'missing', 'approved, but this root holds no audio: reported as absent, not as pending');
  assert.equal(by('white-noise').availability, 'available');
  assert.equal(by('binaural-gamma').availability, 'available');
  assert.equal(by('fixture-a').availability, 'available');
  assert.equal(by('fixture-missing').availability, 'missing');
  assert.equal(response.sounds.filter((s) => s.availability === 'license-unresolved').length, 0, 'nothing is waiting for a licence any more');
  assert.equal(response.sounds.filter((s) => s.availability === 'missing').length, 82, 'the 81 recordings this root lacks, and the fixture that is declared but absent');
  const held = await service([...DRIFT_SOUNDS.filter((sound) => sound.id !== 'light-rain'), pendingOf('light-rain')]).catalog();
  assert.equal(held.sounds.find((sound) => sound.id === 'light-rain').availability, 'license-unresolved', 'an entry nobody approved is still held back');
  const text = JSON.stringify(response);
  assert.ok(!text.includes(scratch) && !text.includes(repoRoot) && !text.includes(tmpdir()), 'no absolute path in the payload');
  assert.doesNotMatch(text, /"message"|"error"/, 'no field the payload localiser would rewrite');
  // a copy: changing the answer does not change the catalogue
  by('white-noise').availability = 'missing';
  by('white-noise').provenance.licenseStatus = 'unresolved';
  assert.equal(DRIFT_SOUNDS.find((s) => s.id === 'white-noise').provenance.licenseStatus, 'verified');
});

// ── registration and trust ─────────────────────────────────────────────────

function fakeWindow() {
  const mainFrame = { name: 'main-frame' };
  const webContents = { mainFrame, id: 1 };
  return { isDestroyed: () => false, webContents };
}

async function register({ window, appPath, fixturesDir } = {}) {
  const handlers = new Map();
  globalThis.__DRIFT_APP_PATH__ = appPath ?? path.join(scratch, 'app');
  if (fixturesDir) process.env.NODUS_E2E_DRIFT_FIXTURES = fixturesDir; else delete process.env.NODUS_E2E_DRIFT_FIXTURES;
  ipc.registerDriftIpc({ h: (channel, listener) => handlers.set(channel, listener), getWindow: () => window ?? null, chatAborters: new Map() });
  return handlers;
}
const trustedEvent = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });

test('exactly two channels are registered', async () => {
  const handlers = await register({ window: fakeWindow() });
  assert.deepEqual([...handlers.keys()].sort(), ['drift:catalog', 'drift:read-audio']);
});

test('only the main frame of the main window may call either channel', async () => {
  const window = fakeWindow();
  const handlers = await register({ window, fixturesDir: fixtures.directory });
  const catalog = handlers.get('drift:catalog');
  const read = handlers.get('drift:read-audio');

  const answer = await catalog(trustedEvent(window));
  assert.equal(answer.schemaVersion, 1);
  assert.equal((await read(trustedEvent(window), 'fixture-a')).length, fixtures.sounds[0].source.bytes);

  const refused = [
    ['an iframe inside the trusted renderer', { sender: window.webContents, senderFrame: { name: 'iframe' } }],
    ['a frame-less sender', { sender: window.webContents, senderFrame: null }],
    ['another window (Browser, a tab, an auxiliary window)', { sender: { mainFrame: { name: 'main-frame' } }, senderFrame: { name: 'main-frame' } }],
    ['a different webContents with the right frame object', { sender: { mainFrame: window.webContents.mainFrame }, senderFrame: window.webContents.mainFrame }],
  ];
  for (const [label, event] of refused) {
    await assert.rejects(catalog(event), /main Nodus frame/, `catalog: ${label}`);
    await assert.rejects(read(event, 'fixture-a'), /main Nodus frame/, `read-audio: ${label}`);
  }
  // no window at all, or a window that is going away
  const orphan = await register({ window: null });
  await assert.rejects(orphan.get('drift:read-audio')(trustedEvent(window), 'fixture-a'), /window is not available/);
  const closing = { ...fakeWindow(), isDestroyed: () => true };
  const closed = await register({ window: closing });
  await assert.rejects(closed.get('drift:catalog')(trustedEvent(closing)), /window is not available/);
});

test('a trusted caller still cannot name a path or an unknown sound', async () => {
  const window = fakeWindow();
  const handlers = await register({ window });
  const read = handlers.get('drift:read-audio');
  for (const input of ['../x', 'https://a.example/b.wav', 'no-such-sound', 'white-noise', 5, null]) {
    await assert.rejects(read(trustedEvent(window), input), /drift-audio:unavailable/, String(input));
  }
  // a real, approved recording is a valid id; this app path simply has no audio in it
  await assert.rejects(read(trustedEvent(window), 'light-rain'), /drift-audio:missing/);
});

test('the bundled directory is app.getAppPath()/electron/assets/drift/audio', async () => {
  const appPath = path.join(scratch, 'packaged-app');
  const window = fakeWindow();
  const handlers = await register({ window, appPath });
  // an app path with no audio in it: the 8 generators work, and each of the 81 approved recordings is reported as absent
  const { sounds } = await handlers.get('drift:catalog')(trustedEvent(window));
  assert.equal(sounds.filter((s) => s.availability === 'available').length, 8);
  assert.equal(sounds.filter((s) => s.availability === 'missing').length, 81);
  assert.equal(sounds.filter((s) => s.availability === 'license-unresolved').length, 0);
  // an approved recording placed where the app looks for it would be found there and nowhere else
  const source = readSource('electron/ipc/drift.ts');
  assert.match(source, /path\.join\(app\.getAppPath\(\), 'electron', 'assets', 'drift', 'audio'\)/);
});

function readSource(file) { return fs.readFileSync(path.join(repoRoot, file), 'utf8'); }

// ── e2e fixtures ───────────────────────────────────────────────────────────

test('e2e fixtures are loaded only when they are complete, distinct and cleared', async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.deepEqual(await ipc.loadE2eDriftFixtures(undefined), []);
    assert.deepEqual(await ipc.loadE2eDriftFixtures(path.join(scratch, 'not-there')), []);
    const good = await ipc.loadE2eDriftFixtures(fixtures.directory);
    assert.equal(good.length, fixtures.sounds.length);
    assert.ok(good.every((entry) => entry.root === audioRoot));

    // an id that shadows a real sound is refused wholesale
    const shadow = path.join(scratch, 'shadow');
    mkdirSync(shadow, { recursive: true });
    writeFileSync(path.join(shadow, 'catalog.json'), JSON.stringify({ sounds: [{ ...structuredClone(fixtures.sounds[0]), id: 'white-noise' }] }));
    assert.deepEqual(await ipc.loadE2eDriftFixtures(shadow), []);

    // a fixture that is not cleared is refused wholesale: the switch cannot smuggle a pending recording in
    const pending = path.join(scratch, 'pending');
    mkdirSync(pending, { recursive: true });
    const unresolved = structuredClone(fixtures.sounds[0]);
    unresolved.provenance = { licenseStatus: 'unresolved', evidenceRefs: ['x'], distributionReview: 'pending' };
    writeFileSync(path.join(pending, 'catalog.json'), JSON.stringify({ sounds: [unresolved] }));
    assert.deepEqual(await ipc.loadE2eDriftFixtures(pending), []);

    const broken = path.join(scratch, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, 'catalog.json'), '{ not json');
    assert.deepEqual(await ipc.loadE2eDriftFixtures(broken), []);
  } finally { console.warn = warn; }
  assert.ok(warnings.length >= 3, 'each refusal is logged');
});

test('through the registered handlers the fixtures are played from their own directory', async () => {
  const window = fakeWindow();
  const handlers = await register({ window, fixturesDir: fixtures.directory });
  const { sounds } = await handlers.get('drift:catalog')(trustedEvent(window));
  assert.equal(sounds.find((s) => s.id === 'fixture-b').availability, 'available');
  assert.equal(sounds.find((s) => s.id === 'fixture-missing').availability, 'missing');
  await assert.rejects(handlers.get('drift:read-audio')(trustedEvent(window), 'fixture-corrupt'), /drift-audio:corrupt/);
  delete process.env.NODUS_E2E_DRIFT_FIXTURES;
});

// ── wiring and reach ───────────────────────────────────────────────────────

test('both channels are registered in the main process AND reachable from the preload, and typed on NodusApi', () => {
  assertChannelsWired(assert, ['drift:catalog', 'drift:read-audio']);
  assertApiMethods(assert, ['getDriftCatalog', 'readDriftAudio']);
  const { invoked } = ipcCensus();
  assert.deepEqual(invoked.filter((entry) => entry.channel.startsWith('drift:')).map((entry) => entry.file).sort(), [
    'electron/preload/drift.ts', 'electron/preload/drift.ts',
  ]);
});

test('the contract is exactly two methods and neither takes a path', () => {
  const api = readSource('shared/api/drift.ts');
  const methods = [...api.matchAll(/^ {2}(\w+)\(([^)]*)\)/gm)].map((match) => [match[1], match[2]]);
  assert.deepEqual(methods, [['getDriftCatalog', ''], ['readDriftAudio', 'soundId: string']]);
  const preload = readSource('electron/preload/drift.ts');
  assert.equal([...preload.matchAll(/ipcRenderer\.invoke\(/g)].length, 2);
  assert.doesNotMatch(preload, /\b(path|url|readFile|fs)\b/i, 'the bridge adds no file access');
});

test('no reduced window bridge, public server or web surface can reach them', () => {
  const windows = loadTs('shared/api/windows.ts');
  for (const list of Object.values(windows).filter(Array.isArray)) {
    assert.ok(!list.includes('getDriftCatalog') && !list.includes('readDriftAudio'), 'not in the Nodi or Presenter bridge');
  }
  const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out); else if (/\.(ts|tsx|js|mjs|cjs|json|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const dir of ['server', 'src/serverWeb', 'browser-extension', 'cloudflare', 'word-addin', 'zotero-plugin', 'site']) {
    for (const file of walk(path.join(repoRoot, dir))) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /drift:read-audio|drift:catalog|readDriftAudio|getDriftCatalog/, `${path.relative(repoRoot, file)} must not expose Drift IPC`);
    }
  }
  // the page preloads of Nodus Browser are separate bundles that never import the main bridge
  for (const file of ['electron/preload/browserPage.ts', 'electron/preload/browserPageMedia.ts', 'electron/preload/browserPageMediaSession.ts', 'electron/preload/browserPageSnapshot.ts']) {
    assert.doesNotMatch(readSource(file), /drift:|driftApi|DriftApi|readDriftAudio|getDriftCatalog/, file);
  }
});

test('the handlers register through the shared wrapper, never ipcMain directly', () => {
  const source = readSource('electron/ipc/drift.ts');
  assert.match(source, /export function registerDriftIpc\(\{ h, getWindow \}: IpcContext\)/);
  assert.doesNotMatch(source, /ipcMain\./);
  assert.match(readSource('electron/ipc.ts'), /registerDriftIpc\(context\);/);
  assert.match(readSource('electron/preload/api.ts'), /\.\.\.driftApi,/);
});

test('reading a file is asynchronous: no synchronous filesystem call in the service', () => {
  const source = readSource('electron/ipc/drift.ts');
  const service = source.slice(source.indexOf('export async function resolveConfinedAsset'), source.indexOf('// ── e2e fixtures'));
  assert.doesNotMatch(service, /readFileSync|statSync|realpathSync|readdirSync|existsSync/);
});

void drift;
