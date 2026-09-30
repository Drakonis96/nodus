// Nodus Drift: the catalogue, its validators and the licence gate.
//
// What this protects: every entry is well formed and measured, every icon it names
// exists, every distributable entry cites a record that exists, and no recording can slip
// past the gate without a licence (verified or declared upstream), evidence and a
// documented review. The recordings are approved as `declared`: their licence is the one
// Moodist declares, and legal/drift/REVIEW.md#recordings is the maintainer's decision.
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

test('recordings are pinned to one upstream commit and carry exactly the licence Moodist declares', () => {
  assert.match(DRIFT_UPSTREAM.commit, /^[0-9a-f]{40}$/);
  assert.equal(catalog.MOODIST_DECLARED_LICENSE, 'LicenseRef-Moodist-declared-Pixabay-or-CC0');
  for (const sound of recordings) {
    const { provenance } = sound;
    assert.equal(provenance.upstreamCommit, DRIFT_UPSTREAM.commit, `${sound.id} is pinned`);
    assert.equal(provenance.upstreamRepository, DRIFT_UPSTREAM.repository);
    assert.equal(provenance.upstreamPath, `public/sounds/${sound.source.asset}`);
    // Moodist declares "Pixabay Content License and CC0" for its audio in general, never per file, and
    // nobody traced each file: the honest status is `declared`, never `verified`.
    assert.equal(provenance.licenseStatus, 'declared', `${sound.id}: declared upstream, not verified per file`);
    assert.equal(provenance.licenseId, 'LicenseRef-Moodist-declared-Pixabay-or-CC0', `${sound.id} names the declaration, not one of its two licences`);
    assert.equal(provenance.distributionReview, 'approved', `${sound.id} is approved`);
    assert.equal(provenance.reviewRef, 'legal/drift/REVIEW.md#recordings', `${sound.id} cites the maintainer's decision`);
    assert.deepEqual(provenance.evidenceRefs, ['legal/drift/PROVENANCE.md#upstream-declaration']);
  }
});

test('the decision behind the approvals is written down, and says what it rests on', () => {
  const review = readFileSync(path.join(repoRoot, 'legal/drift/REVIEW.md'), 'utf8');
  const section = review.slice(review.indexOf('## Recordings'));
  assert.ok(section.length > 500, 'the Recordings section exists');
  assert.match(section, /\*\*Approved\*\*/, 'an approval is recorded');
  assert.ok(section.includes(DRIFT_UPSTREAM.commit), 'it names the exact upstream commit');
  assert.match(section, /Pixabay Content License/);
  assert.match(section, /CC0/);
  assert.match(section, /\*\*not\*\* verified/, 'it says that the per-file assignment was not verified');
  assert.match(section, /maintainer/i, 'it is a person\'s decision');
  assert.match(section, /\d{4}-\d{2}-\d{2}/, 'it is dated');
  assert.match(section, /`declared`, not `verified`/, 'and it explains the status');
});

test('the licences are stated as Moodist declares them, with links to where it declares them', () => {
  const DECLARATION = 'Some sounds used in this project are sourced from third-party providers and **are subject to different licenses**:';
  const PIXABAY = 'https://pixabay.com/service/license-summary/';
  const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
  const README_AT_COMMIT = `https://github.com/remvze/moodist/blob/${DRIFT_UPSTREAM.commit}/README.md#license`;
  const LICENSE_AT_COMMIT = `https://github.com/remvze/moodist/blob/${DRIFT_UPSTREAM.commit}/LICENSE`;
  const notices = readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const section = notices.slice(notices.indexOf('## Nodus Drift'), notices.indexOf('## Zotero mark'));
  assert.ok(section.length > 800, 'the Nodus Drift notice exists');
  for (const [name, text] of [
    ['the third-party notice', section],
    ['legal/drift/README.md', readFileSync(path.join(repoRoot, 'legal/drift/README.md'), 'utf8')],
    ['legal/drift/PROVENANCE.md', readFileSync(path.join(repoRoot, 'legal/drift/PROVENANCE.md'), 'utf8')],
  ]) {
    assert.ok(text.includes(DECLARATION), `${name} quotes Moodist's declaration as it is written`);
    assert.ok(text.includes('**Pixabay Content License**') && text.includes(PIXABAY), `${name} names the Pixabay Content License and links it`);
    assert.ok(text.includes('**CC0**') && text.includes(CC0), `${name} names CC0 and links it`);
    assert.ok(text.includes(README_AT_COMMIT), `${name} links Moodist's README at the pinned commit`);
  }
  assert.ok(section.includes(LICENSE_AT_COMMIT), 'the notice links Moodist\'s own licence file');
  assert.match(section, /Their licenses are the ones the Moodist repository declares/);
  assert.match(section, /not\*\* covered by Nodus's\s+AGPL-3\.0-only license/, 'the AGPL does not cover the recordings');
  assert.match(section, /Moodist does not say which of\s+the two applies to each recording/);
  assert.ok(section.includes('legal/drift/MOODIST_LICENSE.txt') && section.includes('legal/drift/PROVENANCE.md') && section.includes('legal/drift/REVIEW.md'));
  assert.ok(existsSync(path.join(repoRoot, 'legal/drift/MOODIST_LICENSE.txt')));
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

test('generators are first party; every entry that is distributable cites a record', () => {
  for (const sound of generators) {
    assert.equal(drift.isDriftDistributable(sound), true, sound.id);
    assert.equal(sound.provenance.licenseStatus, 'verified');
    assert.equal(sound.provenance.licenseId, 'AGPL-3.0-only');
  }
  // the 8 generators and the 81 recordings all pass the one gate, and each says which record it rests on
  assert.equal(DRIFT_SOUNDS.filter(drift.isDriftDistributable).length, generators.length + recordings.length);
  for (const sound of DRIFT_SOUNDS) {
    assert.equal(drift.baseDriftAvailability(sound), 'available', sound.id);
    assert.match(sound.provenance.reviewRef, /^legal\/drift\/REVIEW\.md#(first-party-generators|recordings)$/, sound.id);
  }
  // an entry with the same audio and nobody's approval is what the gate exists to hold back
  for (const sound of recordings.slice(0, 5)) {
    const held = structuredClone(sound);
    held.provenance = { licenseStatus: 'unresolved', evidenceRefs: ['x'], distributionReview: 'pending' };
    assert.equal(drift.baseDriftAvailability(held), 'license-unresolved', sound.id);
  }
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

test('the licence gate needs a licence (verified or declared), evidence AND a documented review', () => {
  // The state every recording was in before it was approved: nothing established, nothing reviewed.
  const base = structuredClone(getDriftDefinition('light-rain'));
  base.provenance = {
    licenseStatus: 'unresolved',
    upstreamRepository: base.provenance.upstreamRepository,
    upstreamCommit: base.provenance.upstreamCommit,
    upstreamPath: base.provenance.upstreamPath,
    evidenceRefs: ['legal/drift/PROVENANCE.md#upstream-declaration'],
    distributionReview: 'pending',
  };
  assert.equal(drift.isDriftDistributable(base), false);
  assert.deepEqual(drift.validateDriftDefinition(base), [], 'pending is well formed, just not approved');

  for (const status of ['verified', 'declared']) {
    const named = structuredClone(base);
    named.provenance.licenseStatus = status;
    named.provenance.licenseId = status === 'declared' ? 'LicenseRef-Moodist-declared-Pixabay-or-CC0' : 'CC0-1.0';
    assert.equal(drift.isDriftDistributable(named), false, `a ${status} licence without a review is not enough`);
    assert.deepEqual(drift.validateDriftDefinition(named), [], `it is well formed, just not approved (${status})`);

    const approvedWithoutRecord = structuredClone(named);
    approvedWithoutRecord.provenance.distributionReview = 'approved';
    assert.equal(drift.isDriftDistributable(approvedWithoutRecord), false, `a ${status} approval must cite its record`);
    assert.ok(drift.validateDriftDefinition(approvedWithoutRecord).some((p) => /cite its record/.test(p)));

    const approved = structuredClone(approvedWithoutRecord);
    approved.provenance.reviewRef = 'legal/drift/REVIEW.md#example';
    assert.equal(drift.isDriftDistributable(approved), true, `${status} + a review + its record passes`);
    assert.deepEqual(drift.validateDriftDefinition(approved), []);

    const noName = structuredClone(approved);
    delete noName.provenance.licenseId;
    assert.equal(drift.isDriftDistributable(noName), false, `a ${status} entry has to name its licence`);
    assert.ok(drift.validateDriftDefinition(noName).some((p) => new RegExp(`a ${status} entry must name its licence`).test(p)));

    const noEvidence = structuredClone(approved);
    noEvidence.provenance.evidenceRefs = [];
    assert.equal(drift.isDriftDistributable(noEvidence), false, `a ${status} entry needs evidence`);
    assert.ok(drift.validateDriftDefinition(noEvidence).some((p) => new RegExp(`a ${status} entry needs evidence`).test(p)));
  }

  const unresolvedButNamed = structuredClone(base);
  unresolvedButNamed.provenance.licenseId = 'CC0-1.0';
  assert.ok(drift.validateDriftDefinition(unresolvedButNamed).some((p) => /must not name a licence/.test(p)));

  const approvedButUnresolved = structuredClone(base);
  approvedButUnresolved.provenance.distributionReview = 'approved';
  approvedButUnresolved.provenance.reviewRef = 'x';
  assert.equal(drift.isDriftDistributable(approvedButUnresolved), false, 'an approval cannot rescue an unresolved licence');
  assert.ok(drift.validateDriftDefinition(approvedButUnresolved).some((p) => /requires a verified or declared licence/.test(p)));

  const strange = structuredClone(base);
  strange.provenance.licenseStatus = 'presumed';
  assert.equal(drift.isDriftDistributable(strange), false, 'a status the gate does not know is not a licence');
  assert.ok(drift.validateDriftDefinition(strange).some((p) => /unknown licenseStatus/.test(p)));
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
