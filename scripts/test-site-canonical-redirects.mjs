import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import canonicalWorker, { canonicalRequestUrl } from '../cloudflare/site-canonical-redirects/worker.mjs';
import { preparePagesArtifact } from './build-pages-artifact.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the Pages artifact preserves the custom domain', () => {
  const cname = fs.readFileSync(path.join(repoRoot, 'site/CNAME'), 'utf8');
  assert.equal(cname.trim(), 'nodusresearch.com');

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-pages-artifact-'));
  const artifact = path.join(temporaryRoot, 'artifact');
  try {
    preparePagesArtifact(repoRoot, artifact);
    assert.equal(fs.readFileSync(path.join(artifact, 'CNAME'), 'utf8').trim(), 'nodusresearch.com');
    assert.ok(fs.existsSync(path.join(artifact, '.nojekyll')));
    assert.ok(fs.existsSync(path.join(artifact, 'index.html')));
    assert.ok(fs.existsSync(path.join(artifact, 'zotero-plugin/index.html')));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /run: npm run site:artifact/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v5\s+with:\s+path: pages-artifact/);
  assert.doesNotMatch(workflow, /upload-pages-artifact@[\s\S]{0,100}path: (?!pages-artifact)/);
});

test('index documents redirect permanently to their directory URLs', async () => {
  for (const [source, target] of [
    ['https://nodusresearch.com/index.html', 'https://nodusresearch.com/'],
    ['https://nodusresearch.com/about/index.html', 'https://nodusresearch.com/about/'],
    ['https://nodusresearch.com/app/index.html', 'https://nodusresearch.com/app/'],
    ['https://nodusresearch.com/research/index.html', 'https://nodusresearch.com/research/'],
    [
      'https://nodusresearch.com/cualquier/index.html?source=legacy',
      'https://nodusresearch.com/cualquier/?source=legacy',
    ],
  ]) {
    const canonical = canonicalRequestUrl(source);
    assert.equal(canonical?.toString(), target);

    const response = await canonicalWorker.fetch(new Request(source));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), target);
  }
});

test('the edge layer also consolidates protocol and www variants', () => {
  for (const [source, target] of [
    ['http://nodusresearch.com/', 'https://nodusresearch.com/'],
    ['https://www.nodusresearch.com/research/?topic=evidence', 'https://nodusresearch.com/research/?topic=evidence'],
    ['http://www.nodusresearch.com/app/index.html?ref=old&campaign=site', 'https://nodusresearch.com/app/?ref=old&campaign=site'],
  ]) {
    assert.equal(canonicalRequestUrl(source)?.toString(), target);
  }
});

test('canonical requests and unrelated hosts are left alone', () => {
  assert.equal(canonicalRequestUrl('https://nodusresearch.com/app/?ref=kept'), null);
  assert.equal(canonicalRequestUrl('http://example.com/index.html'), null);
});

test('the deployed worker routes cover both canonical hostnames', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'cloudflare/site-canonical-redirects/wrangler.jsonc'), 'utf8'));
  assert.deepEqual(config.routes.map((route) => route.pattern).sort(), [
    'nodusresearch.com/*',
    'www.nodusresearch.com/*',
  ]);
  assert.ok(config.routes.every((route) => route.zone_name === 'nodusresearch.com'));
});
