import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-domain-'));

function bundle(entry, name) {
  const target = path.join(outDir, `${name}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, entry),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--outfile=${target}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(target);
}

const archive = bundle('shared/archiveTypes.ts', 'archiveTypes');
const domain = bundle('shared/primarySourcesTypes.ts', 'primarySourcesTypes');
const fixtures = bundle('shared/primarySourcesFixtures.ts', 'primarySourcesFixtures');

test.after(() => rm(outDir, { recursive: true, force: true }));

test('reference corpus keeps hierarchy, files, text and interpretation separate', () => {
  assert.deepEqual(archive.validateArchiveHierarchy(fixtures.PRIMARY_SOURCES_REFERENCE_UNITS), []);
  for (const file of fixtures.PRIMARY_SOURCES_REFERENCE_FILES) {
    assert.deepEqual(archive.validateArchiveFile(file), []);
  }
  assert.deepEqual(
    archive.validateArchiveLocator(fixtures.PRIMARY_SOURCES_REFERENCE_EXCERPT.locator),
    []
  );
  assert.equal(fixtures.PRIMARY_SOURCES_REFERENCE_NOTE_LINK.relationKind, 'interprets');
  assert.equal(fixtures.PRIMARY_SOURCES_REFERENCE_PROPOSAL.status, 'pending');
  assert.equal(fixtures.PRIMARY_SOURCES_REFERENCE_PERSON_MENTION.identityStatus, 'unresolved_mention');
});

test('hierarchy rejects self-parenting, cycles and ambiguous local levels', () => {
  const base = fixtures.PRIMARY_SOURCES_REFERENCE_UNITS[0];
  const issues = archive.validateArchiveHierarchy([
    { ...base, unitId: 'a', parentUnitId: 'b', position: 0 },
    { ...base, unitId: 'b', parentUnitId: 'a', position: 0 },
    { ...base, unitId: 'local', parentUnitId: null, level: 'local', localLevelLabel: '', position: 1 },
  ]);
  assert.ok(issues.some((issue) => issue.code === 'cycle'));
  assert.ok(issues.some((issue) => issue.code === 'missing_local_level_label'));
});

test('master identity cannot be patched and derivatives require provenance', () => {
  assert.equal(archive.isImmutableMasterPatch({ contentHash: 'different' }), true);
  assert.equal(archive.isImmutableMasterPatch({ verifiedAt: '2026-07-29T00:00:00Z' }), false);
  const derivative = fixtures.PRIMARY_SOURCES_REFERENCE_FILES[1];
  assert.ok(derivative.parentFileId);
  assert.ok(derivative.transformation);
  assert.deepEqual(
    archive.validateArchiveFile({ ...derivative, parentFileId: null, transformation: null }),
    [{ code: 'derivative_missing_parent' }, { code: 'missing_transformation' }]
  );
});

test('policy matrix blocks embargoes and external sensitive processing in the backend primitive', () => {
  assert.deepEqual(
    domain.decidePrimarySourcePolicy({
      accessStatus: 'embargoed',
      sensitivity: 'normal',
      action: 'export_file',
      now: '2026-07-29T00:00:00Z',
      embargoUntil: '2030-01-01T00:00:00Z',
    }),
    { decision: 'block', reason: 'embargo_active' }
  );
  assert.deepEqual(
    domain.decidePrimarySourcePolicy({
      accessStatus: 'open',
      sensitivity: 'highly_sensitive',
      action: 'external_ai',
    }),
    { decision: 'block', reason: 'sensitive_external_processing' }
  );
  assert.equal(
    domain.decidePrimarySourcePolicy({
      accessStatus: 'restricted',
      sensitivity: 'sensitive',
      action: 'export_metadata',
    }).decision,
    'redact'
  );
});

test('citation readiness requires provenance, locator and a preserved master', () => {
  assert.deepEqual(
    domain.assessPrimarySourceCitation({
      repositoryName: fixtures.PRIMARY_SOURCES_REFERENCE_REPOSITORY.name,
      referenceCode: fixtures.PRIMARY_SOURCES_REFERENCE_UNITS[2].referenceCode,
      unitTitle: fixtures.PRIMARY_SOURCES_REFERENCE_UNITS[2].title,
      excerpt: fixtures.PRIMARY_SOURCES_REFERENCE_EXCERPT,
      hasPreservedMaster: true,
    }),
    { status: 'ready', missing: [] }
  );
  assert.deepEqual(
    domain.assessPrimarySourceCitation({
      repositoryName: 'Archive',
      referenceCode: 'A/1',
      unitTitle: 'Unit',
      excerpt: null,
      hasPreservedMaster: true,
    }),
    { status: 'general_locator', missing: ['locator'] }
  );
});

test('migration fixtures enumerate every no-loss case promised by the domain contract', () => {
  assert.deepEqual(fixtures.PRIMARY_SOURCES_MIGRATION_CASES, [
    'empty_vault',
    'archive_images',
    'archive_pdf_with_text',
    'genealogy_archive_links',
    'large_blob',
    'missing_file',
    'null_hash',
    'unknown_metadata_json',
    'non_latin_text',
    'previous_schema',
  ]);
  for (const criterion of ['row_counts', 'identifiers', 'blob_bytes', 'content_hashes', 'legacy_text', 'rollback', 'reopen']) {
    assert.ok(fixtures.PRIMARY_SOURCES_NO_LOSS_CRITERIA.includes(criterion));
  }
});
