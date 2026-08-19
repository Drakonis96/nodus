import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { databaseFixtureBatches, databaseFixtureFingerprint, materializeDatabaseFixture, NOTION_PARITY_SCALES } from './notion-parity/fixtures.mjs';
import { assertAuthorizedQaProfile, notionParityQaRoots, prepareQaProfile } from './notion-parity/qa-paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('notion-parity fixture generators cover every target scale without materialising the stream', () => {
  assert.deepEqual(NOTION_PARITY_SCALES, [1_000, 10_000, 250_000, 500_000]);
  for (const scale of NOTION_PARITY_SCALES) {
    let rows = 0;
    let largestBatch = 0;
    for (const batch of databaseFixtureBatches(scale, 2_000)) {
      rows += batch.rows.length;
      largestBatch = Math.max(largestBatch, batch.rows.length);
    }
    assert.equal(rows, scale);
    assert.ok(largestBatch <= 2_000);
  }
  assert.equal(databaseFixtureFingerprint(1_000), databaseFixtureFingerprint(1_000), 'the fixture is reproducible');
  assert.throws(() => materializeDatabaseFixture(250_000), /por lotes/);
});

test('notion-parity path guard rejects normal and symlink-escaped profiles', async () => {
  const roots = notionParityQaRoots(repoRoot);
  await assert.rejects(
    assertAuthorizedQaProfile(path.join(os.homedir(), 'Library', 'Application Support', 'Nodus'), repoRoot),
    /Perfil QA rechazado/,
  );

  const outside = await mkdtemp(path.join(os.tmpdir(), 'nodus-qa-outside-'));
  const escapeParent = path.join(roots.ephemeral, 'symlink-escape-test');
  try {
    await mkdir(roots.ephemeral, { recursive: true });
    await rm(escapeParent, { recursive: true, force: true });
    await symlink(outside, escapeParent, 'dir');
    await assert.rejects(assertAuthorizedQaProfile(path.join(escapeParent, 'profile'), repoRoot), /Perfil QA rechazado/);
  } finally {
    await rm(escapeParent, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('notion-parity ephemeral profiles are created and removed only under the allowlist', async () => {
  const profile = await prepareQaProfile({ repoRoot });
  assert.equal(await assertAuthorizedQaProfile(profile.profilePath, repoRoot), profile.profilePath);
  await profile.cleanup();
  await assert.rejects(import('node:fs/promises').then(({ access }) => access(profile.profilePath)));
});

