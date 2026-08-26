import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-versions-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

const outfile = path.join(tmp, 'versions.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/deepResearchVersions.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const versions = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

test('new requests default to lower-cost v1 and preserve explicit choices', () => {
  assert.equal(versions.normalizeDeepResearchRequestVersion(undefined), 'v1');
  assert.equal(versions.normalizeDeepResearchRequestVersion('unknown'), 'v1');
  assert.equal(versions.normalizeDeepResearchRequestVersion('v1'), 'v1');
  assert.equal(versions.normalizeDeepResearchRequestVersion('v2'), 'v2');
});

test('the public request parser defaults omission but rejects an explicit unknown version', () => {
  assert.equal(versions.parseDeepResearchRequestVersion(undefined), 'v1');
  assert.equal(versions.parseDeepResearchRequestVersion('v1'), 'v1');
  assert.equal(versions.parseDeepResearchRequestVersion('v2'), 'v2');
  assert.throws(() => versions.parseDeepResearchRequestVersion('v3'), /Unsupported Deep Research version/);
});

test('v1 and v2 route to distinct valid engines independently of approach', () => {
  assert.equal(versions.deepResearchEnginePath('v1', false), 'v1-general');
  assert.equal(versions.deepResearchEnginePath('v1', true), 'v1-specialized');
  assert.equal(versions.deepResearchEnginePath('v2', false), 'v2-general');
  assert.equal(versions.deepResearchEnginePath('v2', true), 'v2-specialized');
  assert.equal(versions.deepResearchEnginePath(undefined, false), 'v1-general');
});

test('old metadata defaults to v1 and preserves explicit choices', () => {
  assert.equal(versions.normalizeDeepResearchMetadataVersion(undefined), 'v1');
  assert.equal(versions.normalizeDeepResearchMetadataVersion('unknown'), 'v1');
  assert.equal(versions.normalizeDeepResearchMetadataVersion('v1'), 'v1');
  assert.equal(versions.normalizeDeepResearchMetadataVersion('v2'), 'v2');
});

test('the renderer exposes exactly the two compatible engines', () => {
  assert.deepEqual(versions.DEEP_RESEARCH_VERSIONS, ['v1', 'v2']);
  assert.deepEqual(versions.DEEP_RESEARCH_VERSION_OPTIONS.map((option) => option.id), ['v1', 'v2']);
  assert.match(versions.deepResearchVersionOption('v1').description, /menos tokens/);
  assert.match(versions.deepResearchVersionOption('v2').description, /Consume más tokens/);
  assert.match(versions.deepResearchVersionOption('v2').description, /hasta 8 documentos completos/);
  assert.match(versions.deepResearchVersionOption('v2').description, /regenera los desactualizados/);
});
