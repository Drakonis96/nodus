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

  const { RELEASE_NOTES, releaseNotesForMajor } = await import(pathToFileURL(bundlePath).href);
  const currentRelease = RELEASE_NOTES[0];
  assert.equal(currentRelease?.version, '2.6.0');
  assert.equal(currentRelease?.date, '2026-07-23');
  assert.equal(currentRelease?.highlights.length, 3);
  assert.ok(currentRelease?.highlights.every((highlight) => highlight.it.length > 0));
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
