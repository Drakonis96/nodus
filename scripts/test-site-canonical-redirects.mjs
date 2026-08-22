import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalRequestUrl } from '../cloudflare/site-canonical-redirects/worker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the Pages artifact preserves the custom domain', () => {
  const cname = fs.readFileSync(path.join(repoRoot, 'site/CNAME'), 'utf8');
  assert.equal(cname.trim(), 'nodusresearch.com');
});

test('index documents redirect permanently to their directory URLs', async () => {
  for (const [source, target] of [
    ['https://nodusresearch.com/index.html', 'https://nodusresearch.com/'],
    ['https://nodusresearch.com/app/index.html', 'https://nodusresearch.com/app/'],
    ['https://nodusresearch.com/research/index.html', 'https://nodusresearch.com/research/'],
    [
      'https://nodusresearch.com/cualquier/index.html?source=legacy',
      'https://nodusresearch.com/cualquier/?source=legacy',
    ],
  ]) {
    const canonical = canonicalRequestUrl(source);
    assert.equal(canonical?.toString(), target);

    const response = Response.redirect(canonical, 308);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), target);
  }
});

test('the edge layer also consolidates protocol and www variants', () => {
  assert.equal(
    canonicalRequestUrl('http://www.nodusresearch.com/app/index.html?ref=old')?.toString(),
    'https://nodusresearch.com/app/?ref=old',
  );
  assert.equal(canonicalRequestUrl('https://nodusresearch.com/app/'), null);
});
