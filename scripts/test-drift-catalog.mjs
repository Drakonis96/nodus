// Nodus Drift: the catalogue, its validators and the licence gate.
//
// What this protects: every entry is well formed and measured, every icon it names
// exists, generators are the only entries that are distributable today, and no
// recording can slip past the gate without evidence and a documented review.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTs, repoRoot } from './drift-test-utils.mjs';

const drift = loadTs('shared/drift.ts');
const catalog = loadTs('shared/driftCatalog.ts');
const { DRIFT_SOUNDS, DRIFT_UPSTREAM, getDriftDefinition } = catalog;

/** Every glyph the renderer can draw: the keys of ICON_PATHS. */
function iconNames() {
  const source = readFileSync(path.join(repoRoot, 'src/components/ui.tsx'), 'utf8');
  const block = source.slice(source.indexOf('const ICON_PATHS'), source.indexOf('export const ICON_NAMES'));
  return new Set([...block.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
}

const recordings = DRIFT_SOUNDS.filter((sound) => sound.source.kind === 'file');
const generators = DRIFT_SOUNDS.filter((sound) => sound.source.kind !== 'file');

test('the catalogue is well formed, with unique ids and assets', () => {
  assert.deepEqual(drift.validateDriftCatalog(DRIFT_SOUNDS, iconNames()), []);
  assert.equal(new Set(DRIFT_SOUNDS.map((sound) => sound.id)).size, DRIFT_SOUNDS.length);
});

test('it is the ACTIVE Moodist catalogue, not every file in its sounds folder', () => {
  // 81 recordings + 3 noise + 5 binaural presets. Moodist's own alarm and silence helpers are
  // not sounds, and its WAV noise/binaural files are replaced by local generators.
  assert.equal(recordings.length, 81);
  assert.equal(generators.length, 8);
  assert.equal(DRIFT_SOUNDS.length, 89);
  const assets = recordings.map((sound) => sound.source.asset);
  assert.ok(assets.every((asset) => asset.endsWith('.mp3')), 'only recordings are files');
  assert.ok(!assets.some((asset) => /alarm|silence|noise|binaural/i.test(asset)), 'no helper or generator WAV is reused');
});

test('every category has entries and every category icon exists', () => {
  const icons = iconNames();
  for (const category of drift.DRIFT_CATEGORIES) {
    assert.ok(DRIFT_SOUNDS.some((sound) => sound.categoryId === category.id), `${category.id} has sounds`);
    assert.ok(icons.has(category.icon), `${category.id} icon ${category.icon} exists`);
  }
  assert.deepEqual(
    drift.DRIFT_CATEGORIES.map((category) => category.id),
    ['rain', 'nature', 'animals', 'places', 'things', 'transport', 'urban', 'noise', 'binaural'],
  );
});

test('every sound has an icon that exists in Nodus, and the tool itself has one', () => {
  const icons = iconNames();
  assert.ok(icons.has('drift'), 'the tool icon is registered');
  for (const sound of DRIFT_SOUNDS) assert.ok(icons.has(sound.icon), `${sound.id} uses missing icon ${sound.icon}`);
});

test('recordings are pinned to one upstream commit and never claim a licence', () => {
  assert.match(DRIFT_UPSTREAM.commit, /^[0-9a-f]{40}$/);
  for (const sound of recordings) {
    const { provenance } = sound;
    assert.equal(provenance.upstreamCommit, DRIFT_UPSTREAM.commit, `${sound.id} is pinned`);
    assert.equal(provenance.upstreamRepository, DRIFT_UPSTREAM.repository);
    assert.equal(provenance.upstreamPath, `public/sounds/${sound.source.asset}`);
    // Moodist declares "Pixabay Content License or CC0" for its audio in general, never per
    // file, so no entry may name a licence and none may be approved until a review says so.
    assert.equal(provenance.licenseStatus, 'unresolved', `${sound.id} must stay unresolved`);
    assert.equal(provenance.licenseId, undefined, `${sound.id} must not name a licence`);
    assert.equal(provenance.distributionReview, 'pending', `${sound.id} must stay pending`);
    assert.equal(provenance.reviewRef, undefined);
    assert.ok(provenance.evidenceRefs.length > 0, 'the absence of evidence is itself recorded');
  }
});

/** A Markdown heading as GitHub anchors it: lower case, punctuation dropped, spaces to hyphens. */
const anchorOf = (heading) => heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

test('every piece of evidence the catalogue cites exists: the file, and a heading for its anchor', () => {
  const cited = new Set();
  for (const sound of DRIFT_SOUNDS) {
    for (const ref of [...sound.provenance.evidenceRefs, sound.provenance.reviewRef]) if (ref) cited.add(ref);
  }
  // both kinds of record are cited today: the review of the generators and the upstream declaration
  assert.ok([...cited].some((ref) => ref.startsWith('legal/drift/REVIEW.md#')));
  assert.ok([...cited].some((ref) => ref.startsWith('legal/drift/PROVENANCE.md#')));
  for (const ref of cited) {
    const [file, anchor] = ref.split('#');
    const full = path.join(repoRoot, file);
    assert.ok(existsSync(full), `${ref}: ${file} does not exist`);
    if (!anchor) continue;
    const headings = [...readFileSync(full, 'utf8').matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((match) => anchorOf(match[1]));
    assert.ok(headings.includes(anchor), `${ref}: no heading in ${file} is anchored "${anchor}" (has ${headings.join(', ')})`);
  }
});

test('the anchor rule itself: it can tell a heading from a near miss', () => {
  assert.equal(anchorOf('First-party generators'), 'first-party-generators');
  assert.equal(anchorOf('Upstream declaration'), 'upstream-declaration');
  assert.notEqual(anchorOf('Upstream declarations'), 'upstream-declaration');
});

test('the technical fields are measured facts, not placeholders', () => {
  for (const sound of recordings) {
    const source = sound.source;
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(source.bytes) && source.bytes > 1000 && source.bytes <= drift.MAX_DRIFT_AUDIO_BYTES, sound.id);
    assert.ok(source.durationSeconds > 5, `${sound.id} duration`);
    assert.equal(source.loop, true);
    assert.ok([0, 1000].includes(source.crossfadeMs), `${sound.id} crossfade is 0 (prepared loop) or the 1 s default`);
  }
  // Two different files cannot share a digest: that would mean a copy-pasted value.
  assert.equal(new Set(recordings.map((sound) => sound.source.sha256)).size, recordings.length);
});

test('the crossfade rule leaves prepared loops alone and smooths the rest', () => {
  const smoothed = recordings.filter((sound) => sound.source.crossfadeMs > 0).map((sound) => sound.id).sort();
  assert.deepEqual(smoothed, [
    'chickens', 'dog-barking', 'inside-a-train', 'keyboard', 'owl', 'rain-on-tent', 'singing-bowl',
    'submarine', 'supermarket', 'train', 'tuning-radio', 'vinyl-effect', 'walk-in-snow', 'whale',
  ]);
  for (const sound of recordings) {
    assert.ok(sound.source.crossfadeMs * 2 / 1000 < sound.source.durationSeconds, `${sound.id} keeps most of its length`);
  }
});

test('generators are first party and are the only distributable entries today', () => {
  for (const sound of generators) {
    assert.equal(drift.isDriftDistributable(sound), true, sound.id);
    assert.equal(sound.provenance.licenseId, 'AGPL-3.0-only');
  }
  assert.equal(DRIFT_SOUNDS.filter(drift.isDriftDistributable).length, generators.length);
  for (const sound of recordings) assert.equal(drift.baseDriftAvailability(sound), 'license-unresolved', sound.id);
  for (const sound of generators) assert.equal(drift.baseDriftAvailability(sound), 'available', sound.id);
});

test('the noise colours and the five binaural presets are the specified ones', () => {
  assert.deepEqual(
    generators.filter((sound) => sound.source.kind === 'noise').map((sound) => [sound.id, sound.source.color]),
    [['white-noise', 'white'], ['pink-noise', 'pink'], ['brown-noise', 'brown']],
  );
  const binaural = generators.filter((sound) => sound.source.kind === 'binaural');
  assert.deepEqual(binaural.map((sound) => sound.source.beatHz), [2, 5, 10, 20, 40]);
  assert.deepEqual(binaural.map((sound) => sound.id), ['binaural-delta', 'binaural-theta', 'binaural-alpha', 'binaural-beta', 'binaural-gamma']);
  for (const sound of binaural) assert.equal(sound.source.carrierHz, 100);
  assert.deepEqual(drift.binauralFrequencies(100, 10), { left: 95, right: 105 });
  assert.deepEqual(drift.binauralFrequencies(100, 2), { left: 99, right: 101 });
});

test('lookups', () => {
  assert.equal(getDriftDefinition('brown-noise')?.source.color, 'brown');
  assert.equal(getDriftDefinition('nope'), undefined);
  assert.equal(getDriftDefinition('../../etc/passwd'), undefined);
});

test('the validator rejects what the gate must reject', () => {
  const base = getDriftDefinition('light-rain');
  const clone = (patch) => structuredClone({ ...base, ...patch });
  const problems = (definition) => drift.validateDriftDefinition(definition, iconNames());

  assert.deepEqual(problems(clone({})), []);
  assert.ok(problems(clone({ id: 'Bad Id' })).some((p) => /kebab-case/.test(p)));
  assert.ok(problems(clone({ icon: 'no-such-icon' })).some((p) => /does not exist/.test(p)));
  assert.ok(problems(clone({ categoryId: 'weather' })).some((p) => /unknown category/.test(p)));
  for (const asset of ['../x.mp3', '/abs/x.mp3', 'https://evil.example/x.mp3', 'a\\b.mp3', 'a/./b.mp3', 'x.exe', '', 'rain//x.mp3', 'file:x.mp3']) {
    const definition = clone({});
    definition.source.asset = asset;
    assert.ok(problems(definition).some((p) => /safe relative audio path/.test(p)), `asset ${JSON.stringify(asset)} is rejected`);
  }
  const badHash = clone({});
  badHash.source.sha256 = 'ABC';
  assert.ok(problems(badHash).some((p) => /sha256/.test(p)));
  const huge = clone({});
  huge.source.bytes = drift.MAX_DRIFT_AUDIO_BYTES + 1;
  assert.ok(problems(huge).some((p) => /bytes/.test(p)));
  const longFade = clone({});
  longFade.source.crossfadeMs = Math.ceil(longFade.source.durationSeconds * 500);
  assert.ok(problems(longFade).some((p) => /crossfade/.test(p)));
});

test('the licence gate needs a licence, evidence AND a documented review', () => {
  const base = structuredClone(getDriftDefinition('light-rain'));
  assert.equal(drift.isDriftDistributable(base), false);

  const verifiedOnly = structuredClone(base);
  verifiedOnly.provenance.licenseStatus = 'verified';
  verifiedOnly.provenance.licenseId = 'CC0-1.0';
  assert.equal(drift.isDriftDistributable(verifiedOnly), false, 'a licence without a review is not enough');
  assert.ok(drift.validateDriftDefinition(verifiedOnly).length === 0, 'it is well formed, just not approved');

  const approvedWithoutRecord = structuredClone(verifiedOnly);
  approvedWithoutRecord.provenance.distributionReview = 'approved';
  assert.equal(drift.isDriftDistributable(approvedWithoutRecord), false, 'an approval must cite its record');
  assert.ok(drift.validateDriftDefinition(approvedWithoutRecord).some((p) => /cite its record/.test(p)));

  const approved = structuredClone(approvedWithoutRecord);
  approved.provenance.reviewRef = 'legal/drift/REVIEW.md#example';
  assert.equal(drift.isDriftDistributable(approved), true);

  const unresolvedButNamed = structuredClone(base);
  unresolvedButNamed.provenance.licenseId = 'CC0-1.0';
  assert.ok(drift.validateDriftDefinition(unresolvedButNamed).some((p) => /must not name a licence/.test(p)));

  const approvedButUnresolved = structuredClone(base);
  approvedButUnresolved.provenance.distributionReview = 'approved';
  approvedButUnresolved.provenance.reviewRef = 'x';
  assert.ok(drift.validateDriftDefinition(approvedButUnresolved).some((p) => /requires a verified licence/.test(p)));
});

test('the selection policy: six voices, one binaural, idempotent adds', () => {
  const kindOf = (id) => getDriftDefinition(id)?.source.kind;
  const plan = (current, id) => drift.planDriftSelection(current, id, kindOf);

  assert.deepEqual(plan([], 'brown-noise'), { ok: true, next: ['brown-noise'], replaced: null });
  assert.deepEqual(plan(['brown-noise'], 'brown-noise'), { ok: true, next: ['brown-noise'], replaced: null });
  assert.deepEqual(plan([], 'no-such-sound'), { ok: false, reason: 'unknown' });

  const six = ['light-rain', 'river', 'wind', 'birds', 'cafe', 'clock'];
  assert.deepEqual(plan(six, 'crickets'), { ok: false, reason: 'limit' }, 'the seventh voice is refused');
  assert.deepEqual(plan(six, 'clock'), { ok: true, next: six, replaced: null });

  // A binaural preset replaces the previous one IN PLACE, even at the limit.
  const mix = ['light-rain', 'binaural-alpha', 'river', 'wind', 'birds', 'cafe'];
  assert.deepEqual(plan(mix, 'binaural-gamma'), {
    ok: true,
    next: ['light-rain', 'binaural-gamma', 'river', 'wind', 'birds', 'cafe'],
    replaced: 'binaural-alpha',
  });
  assert.deepEqual(plan(mix, 'white-noise'), { ok: false, reason: 'limit' });
});

test('volumes and search text', () => {
  for (const good of [0, 0.25, 1, 0.999]) assert.equal(drift.isValidVolume(good), true);
  for (const bad of [NaN, Infinity, -Infinity, -0.01, 1.01, '0.5', null, undefined, {}]) assert.equal(drift.isValidVolume(bad), false);
  assert.equal(drift.normalizeVolume(NaN, 0.25), 0.25);
  assert.equal(drift.normalizeVolume(Infinity, 0.25), 0.25);
  assert.equal(drift.normalizeVolume(7, 0.25), 1);
  assert.equal(drift.normalizeVolume(-3, 0.25), 0);
  assert.equal(drift.normalizeDriftSearch('  Cafetería  '), 'cafeteria');
  assert.equal(drift.normalizeDriftSearch('ÁRBOLES'), 'arboles');
});

test('the specified constants', () => {
  assert.equal(drift.DEFAULT_MASTER_VOLUME, 0.35);
  assert.equal(drift.DEFAULT_SOUND_VOLUME, 0.25);
  assert.equal(drift.MAX_SELECTED_SOUNDS, 6);
  assert.equal(drift.FADE_MS, 150);
  assert.equal(drift.MAX_DECODED_BYTES, 192 * 1024 * 1024);
  assert.equal(drift.MAX_DRIFT_AUDIO_BYTES, 12 * 1024 * 1024);
});
