import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-notes-'));
const bundlePath = path.join(tempDir, 'releaseNotes.mjs');

try {
  execFileSync(
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    [
      path.join(root, 'shared/releaseNotes.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundlePath}`,
    ],
    { cwd: root, stdio: 'pipe' },
  );

  const { RELEASE_NOTES, releaseNotesForMajor, compareVersions } = await import(pathToFileURL(bundlePath).href);
  const currentRelease = RELEASE_NOTES[0];
  assert.equal(currentRelease?.version, '3.2.0');
  assert.equal(currentRelease?.date, '2026-08-04');
  // Opened for whoever runs a Nodus Server: a semantic search no longer stops the server
  // answering anybody else, and its memory ceiling is stated in memory rather than in a count
  // of published vaults. A floor rather than an exact count, because more will land here
  // before 3.2.0 ships.
  assert.ok(currentRelease?.highlights.length >= 2, 'the release must describe what changed');
  for (const highlight of currentRelease.highlights) {
    // Written for the person using Nodus: no module names, no internal vocabulary.
    for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR']) {
      assert.ok(highlight[language]?.length > 80, `a ${language} highlight is too short to explain anything`);
    }
  }

  // 3.0.4 keeps its own three highlights underneath: Deep Research queued over MCP, the
  // retry that ignored the engine, and the argument map that drew every hub as a star.
  const mcpQueueRelease = RELEASE_NOTES.find((note) => note.version === '3.0.4');
  assert.equal(mcpQueueRelease?.date, '2026-08-01');
  assert.equal(mcpQueueRelease?.highlights.length, 3);
  assert.equal(mcpQueueRelease?.highlights[0]?.scope, 'mcp');

  // 3.0.3 keeps its own three highlights underneath.
  const bulkExportRelease = RELEASE_NOTES.find((note) => note.version === '3.0.3');
  assert.equal(bulkExportRelease?.date, '2026-07-31');
  assert.equal(bulkExportRelease?.highlights.length, 3);

  // 3.0.2 shipped after the macOS update fix merged, so that highlight stays there.
  const deepResearchRelease = RELEASE_NOTES.find((note) => note.version === '3.0.2');
  assert.equal(deepResearchRelease?.date, '2026-07-31');
  assert.equal(deepResearchRelease?.highlights.length, 6);

  // 3.0.1 stays reachable from the version picker underneath it.
  const performanceRelease = RELEASE_NOTES.find((note) => note.version === '3.0.1');
  assert.equal(performanceRelease?.date, '2026-07-30');
  assert.equal(performanceRelease?.highlights.length, 3);

  // The vault introductions live in 3.0.0 and must keep their shape as newer
  // releases land on top of them — hence looked up by version, not as `[0]`.
  const vaultsRelease = RELEASE_NOTES.find((note) => note.version === '3.0.0');
  assert.equal(vaultsRelease?.date, '2026-07-30');
  // One highlight per new vault, not one per refinement inside it — see the note
  // above RELEASE_3_0_0_HIGHLIGHTS.
  assert.equal(vaultsRelease?.highlights.length, 16);
  const newVaults = ['prosopography', 'primary_sources', 'testimonios', 'worldbuilding'];
  for (const scope of newVaults) {
    assert.equal(
      vaultsRelease.highlights.filter((h) => h.scope === scope).length,
      1,
      `${scope} must introduce itself once, not once per refinement`,
    );
  }
  // And they lead, in the order shared/vaultTypes.ts declares them.
  assert.deepEqual(vaultsRelease.highlights.slice(0, 4).map((h) => h.scope), newVaults);
  // 2.8.0 was authored and never published; its highlights live inside 3.0.0 now, so
  // no entry may claim that version or the picker would offer a release nobody ran.
  assert.ok(!RELEASE_NOTES.some((note) => note.version === '2.8.0'));
  // it/tr fall back to en when their index-matched array is short, which would pass a
  // mere length check while silently shipping English to two locales.
  assert.ok(currentRelease?.highlights.every((h) => h.it !== h.en && h.tr !== h.en));

  // From 3.1.0 on, a highlight is short plain sentences: no semicolons, no em dashes.
  // Both were how these notes grew into paragraph-long subordinate clauses, and the
  // modal is read once, in a hurry. Older releases keep the prose they shipped with.
  const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  for (const note of RELEASE_NOTES) {
    if (compareVersions(note.version, '3.1.0') < 0) continue;
    for (const [index, highlight] of note.highlights.entries()) {
      for (const language of LANGUAGES) {
        const text = highlight[language] ?? '';
        assert.ok(
          !text.includes(';'),
          `v${note.version} highlight ${index + 1} (${language}) uses a semicolon: split it into two sentences`,
        );
        assert.ok(
          !text.includes('—'),
          `v${note.version} highlight ${index + 1} (${language}) uses an em dash: split it into two sentences`,
        );
      }
    }
  }
  const whatsNew = fs.readFileSync(path.join(root, 'src/components/WhatsNewModal.tsx'), 'utf8');
  assert.match(whatsNew, /function ZoteroReleaseIcon/);
  assert.match(whatsNew, /M16 18H48L16 46H48/);
  assert.match(whatsNew, /scope === 'plugin'/);
  const currentMajorNotes = releaseNotesForMajor('2.3.8');

  assert.equal(currentMajorNotes[0]?.version, '2.3.8');
  assert.equal(currentMajorNotes.at(-1)?.version, '2.0.0');
  assert.ok(currentMajorNotes.every((note) => note.version.startsWith('2.')));
  assert.ok(!currentMajorNotes.some((note) => note.version === '1.8.0'));
  assert.ok(!releaseNotesForMajor('2.3.7').some((note) => note.version === '2.3.8'));

  const validScopes = new Set([
    'general',
    'academic',
    'estudio',
    'primary_sources',
    'genealogy',
    'prosopography',
    'databases',
    'testimonios',
    'worldbuilding',
    'docencia',
    'mcp',
    'nodi',
    'toolkit',
    'plugin',
    'languages',
  ]);
  for (const note of RELEASE_NOTES) {
    for (const highlight of note.highlights) {
      assert.ok(validScopes.has(highlight.scope), `Missing or invalid scope in v${note.version}`);
      assert.ok(highlight.es.length > 0 && highlight.en.length > 0, `Missing translation in v${note.version}`);
    }
  }

  console.log('Release notes major-history and scope tests passed!');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
