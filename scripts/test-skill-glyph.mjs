// How a skill gets its icon and its colour.
//
// The rule has one job with two halves that pull against each other: the same skill must
// look the same everywhere, and different skills must look different. What makes this
// worth a test rather than an eyeball is that both halves fail silently — a skill whose
// icon changes when you install it just looks like a different skill, and a list where
// everything is a sparkle still renders perfectly.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-skill-glyph-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'glyph.cjs');
await build({
  entryPoints: [path.join(root, 'src/components/skillGlyph.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { skillGlyph, byName } = createRequire(import.meta.url)(bundle);

/** Every name the Icon component actually draws. An icon chosen here that it does not know
 *  renders as nothing at all, which is the one failure a screenshot would not catch. */
const ICON_NAMES = new Set(
  [...fs.readFileSync(path.join(root, 'src/components/ui.tsx'), 'utf8').matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map(match => match[1]),
);

/** The catalogue as published, read from the marketplace rather than restated here — a
 *  copy of the list would go stale the first time a skill was added. Not every run has a
 *  checkout beside it, so that one case says so and skips rather than inventing a list;
 *  the cross-repository job always has one. */
const marketplace = [
  process.env.NODUS_MARKETPLACE_DIR,
  path.resolve(root, '../nodus-research-skill-marketplace'),
  // From a worktree, the real checkout is beside the repository the worktree belongs to.
  path.resolve(root, '../../../../nodus-research-skill-marketplace'),
].filter(Boolean).find(candidate => fs.existsSync(path.join(candidate, 'CONTRIBUTING.md')));
const published = marketplace
  ? fs.readdirSync(marketplace, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(marketplace, entry.name, 'skill.json')))
    .map(entry => JSON.parse(fs.readFileSync(path.join(marketplace, entry.name, 'skill.json'), 'utf8')))
  : [];

test('a skill looks the same wherever it is shown', () => {
  // The catalogue entry, and the copy sitting in the library after installing it: different
  // objects, different identifiers, one appearance.
  const inCatalogue = skillGlyph({ packageId: 'descriptive-statistics', name: 'Descriptive Statistics', description: 'Calculate count, mean, median, range.', category: 'Data and statistics' });
  const inLibrary = skillGlyph({ id: 'a4f1c0e2-9b2d-4e77-8a10-5c6d7e8f9a0b', packageId: 'descriptive-statistics', name: 'Descriptive Statistics', description: 'Calculate count, mean, median, range.' });
  assert.deepEqual(inLibrary, inCatalogue);

  // A skill that came with the build has no origin to point at, so the name has to reach
  // the same answer on its own.
  const seeded = skillGlyph({ id: 'builtin-whatever', name: 'Descriptive Statistics', description: 'Calculate count, mean, median, range.', builtin: 'general' });
  assert.deepEqual(seeded, inCatalogue);

  // And the colour never comes from anything that moves: not the row, not the profile.
  assert.equal(skillGlyph({ name: 'Writing Partner' }).hue, skillGlyph({ id: 'other-id', name: 'Writing Partner' }).hue);
});

test('every published skill has an icon the application can draw', (t) => {
  if (!published.length) { t.skip('no marketplace checkout beside this one; set NODUS_MARKETPLACE_DIR'); return; }
  assert.ok(published.length >= 15, `the marketplace checkout looks incomplete (${published.length} packages)`);
  const glyphs = published.map(manifest => ({ id: manifest.id, ...skillGlyph({ packageId: manifest.id, name: manifest.name, description: manifest.description, category: manifest.category }) }));

  for (const glyph of glyphs) assert.ok(ICON_NAMES.has(glyph.icon), `${glyph.id} asks for an icon that does not exist: ${glyph.icon}`);

  // Every published skill is told apart from every other one. This is the property the
  // whole module exists for, and it is checked against the real catalogue so that adding a
  // package that collides with an existing one fails here rather than looking odd later.
  const icons = new Set(glyphs.map(glyph => glyph.icon));
  assert.equal(icons.size, glyphs.length, `two published skills share an icon: ${glyphs.map(g => `${g.id}=${g.icon}`).join(', ')}`);
});

test('a skill nobody anticipated still gets something of its own', () => {
  // Read from its own words where they say anything.
  const cases = [
    [{ name: 'Ottoman Palaeography', description: 'Read and transcribe archival hands.' }, 'clock'],
    [{ name: 'Site Mapper', description: 'Plot excavation findspots on a map.' }, 'map'],
    [{ name: 'Reaction Explainer', description: 'Explain organic reaction mechanisms.' }, 'flask'],
    [{ name: 'Lecture Builder', description: 'Turn a reading list into a lesson plan.' }, 'graduation'],
    [{ name: 'Citation Doctor', description: 'Check every reference against the source.' }, 'quote'],
  ];
  for (const [input, expected] of cases) assert.equal(skillGlyph(input).icon, expected, input.name);

  // And where they say nothing, the identifier still has to produce an icon that exists,
  // the same one every time.
  const opaque = { name: 'Zzz', description: 'Mmm.' };
  assert.ok(ICON_NAMES.has(skillGlyph(opaque).icon));
  assert.equal(skillGlyph(opaque).icon, skillGlyph(opaque).icon);

  // Twenty skills with nothing to go on: they must not all land on the same shape.
  const derived = Array.from({ length: 20 }, (_, index) => skillGlyph({ name: `Skill ${index}`, description: '.' }));
  assert.ok(new Set(derived.map(glyph => glyph.icon)).size >= 6, 'names with nothing to read still spread across icons');
  assert.ok(new Set(derived.map(glyph => glyph.hue)).size >= 6, 'and across colours');
});

test('the three built-ins keep the icon that belongs to what they do', () => {
  assert.equal(skillGlyph({ id: 'builtin-svg', name: 'SVG Studio', builtin: 'svg' }).icon, 'palette');
  assert.equal(skillGlyph({ id: 'builtin-image', name: 'Image Atelier', builtin: 'image' }).icon, 'image');
  assert.equal(skillGlyph({ id: 'builtin-socratic-tutor', name: 'Socratic Tutor', builtin: 'socratic' }).icon, 'graduation');
  // `general` says a skill shipped with the build, not what it is about: answering it would
  // give every seeded skill in the library the same icon.
  assert.notEqual(skillGlyph({ name: 'Action Planner', description: 'Turn a goal into priorities.', builtin: 'general' }).icon,
    skillGlyph({ name: 'Writing Partner', description: 'Draft and refine clear writing.', builtin: 'general' }).icon);
});

test('alphabetical means alphabetical in the reader’s language', () => {
  const names = ['Ábaco', 'Zenith', 'action planner', 'Ángulo', 'Brainstorm'].map(name => ({ name }));
  assert.deepEqual([...names].sort(byName('es')).map(entry => entry.name),
    ['Ábaco', 'action planner', 'Ángulo', 'Brainstorm', 'Zenith']);
  // Case is not a sort key, and neither is an accent: a reader looking for Ángulo expects
  // it among the As.
  assert.deepEqual([{ name: 'b' }, { name: 'A' }].sort(byName('en')).map(entry => entry.name), ['A', 'b']);
  // Numbers read as numbers, so Skill 10 comes after Skill 9.
  assert.deepEqual([{ name: 'Skill 10' }, { name: 'Skill 9' }].sort(byName('en')).map(entry => entry.name), ['Skill 9', 'Skill 10']);
});
