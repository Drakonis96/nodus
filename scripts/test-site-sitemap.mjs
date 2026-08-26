import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sitemapPages, STATIC_PAGES } from './build-sitemap.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sitemap = fs.readFileSync(path.join(repoRoot, 'site/sitemap.xml'), 'utf8');

const entries = new Map([...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?\s*<\/url>/g)]
  .map((match) => [match[1], match[2] || null]));

test('the sitemap matches every declared URL and its source-derived lastmod', () => {
  const expected = sitemapPages(repoRoot);
  assert.equal(entries.size, expected.length);
  for (const page of expected) {
    const url = `https://nodusresearch.com${page.url}`;
    assert.ok(entries.has(url), `sitemap includes ${url}`);
    assert.equal(entries.get(url), page.lastmod, `${url} uses its relevant source date`);
  }
  assert.ok(entries.has('https://nodusresearch.com/zotero-plugin/'));
  assert.ok(new Set([...entries.values()].filter(Boolean)).size > 1, 'the sitemap is not stamped with one global build date');
});

test('blog posts own explicit publication and modification dates', () => {
  const posts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'site/blog/posts.json'), 'utf8')).posts;
  for (const post of posts.filter((entry) => !entry.draft)) {
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(post.modified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(post.modified >= post.date);
    assert.equal(entries.get(`https://nodusresearch.com/blog/${post.slug}/`), post.modified);
  }
});

test('static URLs declare the content sources that determine freshness', () => {
  for (const page of STATIC_PAGES) {
    assert.ok(page.sources.length > 0, `${page.url} has source dependencies`);
    assert.ok(page.sources.every((source) => !source.endsWith('sitemap.xml')), `${page.url} never dates itself from the generated sitemap`);
  }
  for (const generated of ['/app/', '/cite/', '/blog/']) {
    const page = STATIC_PAGES.find((entry) => entry.url === generated);
    assert.ok(page.sources.length >= 2, `${generated} tracks the inputs that generate its content`);
  }
  const generator = fs.readFileSync(path.join(repoRoot, 'scripts/build-sitemap.mjs'), 'utf8');
  assert.doesNotMatch(generator, /new Date\(\)|Date\.now\(\)/, 'sitemap freshness never comes from build time');
});
