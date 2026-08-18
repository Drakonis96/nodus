// The Nodus Browser address bar: what gets navigated, what gets searched, and
// what gets refused.
//
// The refusal half is the reason this file exists. The address bar is the one
// place a user can hand the browser a scheme by hand, and three of the schemes
// it must refuse — nodus-image, nodus-archive, nodus-library — are registered on
// Nodus's DEFAULT session and serve vault bytes. A browser tab reaching one of
// those would be reading the user's library through a web page.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-omnibox-'));
const bundle = path.join(dir, 'omnibox.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browserOmnibox.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { parseOmniboxInput, looksLikeHost, searchUrlFor, BROWSER_SEARCH_TEMPLATES } = require(bundle);

test('a blank address bar resolves to nothing rather than to a search', () => {
  for (const blank of ['', '   ', '\t\n']) {
    assert.equal(parseOmniboxInput(blank).kind, 'empty');
  }
});

test('an explicit http(s) URL is navigated, normalised', () => {
  assert.deepEqual(
    parseOmniboxInput('https://www.jstor.org/stable/1234'),
    { kind: 'navigate', url: 'https://www.jstor.org/stable/1234' },
  );
  // Normalisation is the URL parser's, so a missing path becomes "/".
  assert.equal(parseOmniboxInput('http://example.org').url, 'http://example.org/');
});

test('a bare host is navigated over https, keeping path and query', () => {
  assert.equal(parseOmniboxInput('jstor.org').url, 'https://jstor.org/');
  assert.equal(
    parseOmniboxInput('www.jstor.org/stable/1234?seq=2').url,
    'https://www.jstor.org/stable/1234?seq=2',
  );
});

test('loopback goes over http, because https on a dev server fails outright', () => {
  assert.equal(parseOmniboxInput('localhost:5173').url, 'http://localhost:5173/');
  assert.equal(parseOmniboxInput('127.0.0.1:8080').url, 'http://127.0.0.1:8080/');
  assert.equal(parseOmniboxInput('app.localhost:3000').url, 'http://app.localhost:3000/');
});

test('a non-loopback host with a port keeps the port and goes over https', () => {
  // Same trap as localhost:5173 — "example.org" must not read as a scheme.
  assert.equal(parseOmniboxInput('archive.example.org:8443').url, 'https://archive.example.org:8443/');
  assert.equal(parseOmniboxInput('example.org:8080/a?b=c').url, 'https://example.org:8080/a?b=c');
});

test('anything with whitespace is a query, never a host', () => {
  const resolved = parseOmniboxInput('braudel mediterranean world');
  assert.equal(resolved.kind, 'search');
  assert.equal(resolved.query, 'braudel mediterranean world');
  assert.match(resolved.url, /^https:\/\/www\.google\.com\/search\?q=/);
});

test('a bare decimal number is a query, not a hostname', () => {
  // "3.14" parses as a dotted label but has no letters-only TLD. Treating it as
  // a host would navigate somewhere the user never asked for.
  assert.equal(parseOmniboxInput('3.14').kind, 'search');
  assert.equal(parseOmniboxInput('1.5').kind, 'search');
  assert.equal(looksLikeHost('3.14'), false);
});

test('every blocked scheme is refused, and names itself in the refusal', () => {
  const refused = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.org/abc',
    'view-source:https://example.org',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'nodus-image://vault/secret.png',
    'nodus-archive://vault/box/1',
    'nodus-library://item/42',
  ];
  for (const input of refused) {
    const resolved = parseOmniboxInput(input);
    assert.equal(resolved.kind, 'blocked', `${input} must be refused`);
    assert.equal(typeof resolved.scheme, 'string');
  }
});

test('the three Nodus vault schemes are refused case-insensitively', () => {
  for (const input of ['NODUS-LIBRARY://item/42', 'Nodus-Image://x', 'FILE:///etc/passwd']) {
    assert.equal(parseOmniboxInput(input).kind, 'blocked', `${input} must be refused`);
  }
});

test('mailto and tel go to the operating system, not to a tab', () => {
  assert.deepEqual(
    parseOmniboxInput('mailto:archivo@uclm.es'),
    { kind: 'external', url: 'mailto:archivo@uclm.es' },
  );
  assert.equal(parseOmniboxInput('tel:+34123456789').kind, 'external');
});

test('about:blank is allowed and every other about: target is not', () => {
  assert.deepEqual(parseOmniboxInput('about:blank'), { kind: 'navigate', url: 'about:blank' });
  assert.equal(parseOmniboxInput('about:config').kind, 'blocked');
  assert.equal(parseOmniboxInput('about:gpu').kind, 'blocked');
});

test('an unknown scheme is refused rather than followed', () => {
  assert.equal(parseOmniboxInput('ftp://ftp.example.org/pub').kind, 'blocked');
  assert.equal(parseOmniboxInput('slack://channel?id=1').kind, 'blocked');
});

test('each search engine has a working template and encodes the query', () => {
  const query = 'braudel & "la méditerranée"';
  for (const engine of ['google', 'scholar', 'bing', 'duckduckgo']) {
    const url = searchUrlFor(query, engine);
    assert.ok(!url.includes('%s'), `${engine} left the placeholder in`);
    assert.ok(url.startsWith('https://'), `${engine} must be https`);
    assert.ok(url.includes(encodeURIComponent(query)), `${engine} must encode the query`);
    // An unencoded ampersand would truncate the query at the first parameter.
    assert.ok(!/\?q=[^&]*&(?!amp;)[a-z]+=/.test(url.replace(encodeURIComponent(query), 'Q')));
  }
  assert.equal(Object.keys(BROWSER_SEARCH_TEMPLATES).length, 4);
});

test('a custom template is used when it has a placeholder and ignored when it does not', () => {
  assert.equal(
    searchUrlFor('braudel', 'custom', 'https://archive.example.org/find?term=%s'),
    'https://archive.example.org/find?term=braudel',
  );
  // A template the user broke must not navigate them to a placeholder-free URL.
  assert.match(searchUrlFor('braudel', 'custom', 'https://archive.example.org/find'), /google\.com/);
  assert.match(searchUrlFor('braudel', 'custom', null), /google\.com/);
});

test('the chosen engine is used for queries that fall through', () => {
  const resolved = parseOmniboxInput('braudel mediterranean', { engine: 'scholar' });
  assert.match(resolved.url, /^https:\/\/scholar\.google\.com\/scholar\?q=/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
