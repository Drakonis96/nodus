// Which Electron API each browsing-data category has to go through.
//
// This is a static scan because the mapping's failure mode is silence: a
// category the user ticked that maps to no API call is simply not cleared, and
// the panel reports success either way. Nothing throws.
//
// It also pins the two facts that make the storage UI honest: only the HTTP
// cache and the profile directory have byte figures, and `quotas` must not be
// passed to clearStorageData because Electron 42 removed it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(path.join(repoRoot, 'electron/browser/storage.ts'), 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('all three clearing APIs are used, because none covers everything', () => {
  // clearData has no cachestorage; clearStorageData has no HTTP cache. Using
  // only one of them leaves a category permanently unclearable.
  assert.match(code, /clearCache\(\)/, 'the HTTP cache needs clearCache');
  assert.match(code, /clearData\(/, 'most types go through clearData');
  assert.match(code, /clearStorageData\(/, 'cachestorage only exists here');
});

test('every category the UI can tick reaches an API call', () => {
  for (const [category, expected] of [
    ['cache', /clearCache/],
    ['cookies', /'cookies'/],
    ['localStorage', /'localStorage'/],
    ['indexedDB', /'indexedDB'/],
    ['serviceWorkers', /'serviceWorkers'/],
    ['fileSystems', /'fileSystems'/],
    ['cacheStorage', /'cachestorage'/],
  ]) {
    assert.match(code, new RegExp(`has\\('${category}'\\)`), `${category} must be handled`);
    assert.match(code, expected, `${category} must map to a real API argument`);
  }
});

test('quotas is never passed to clearStorageData', () => {
  // Electron 42 removed it. Passing it is a runtime error on the version this
  // project now ships, and the option is easy to copy from older examples.
  assert.doesNotMatch(code, /quotas/, 'quotas was removed from clearStorageData in Electron 42');
});

test('clearing cookies also clears stored HTTP credentials', () => {
  // Both are "am I still signed in". Leaving auth cached after a cookie wipe
  // means some sites silently stay authenticated.
  assert.match(code, /clearAuthCache\(\)/);
});

test('per-site clearing includes the third parties the site brought with it', () => {
  assert.match(code, /originMatchingMode/, 'per-origin clearing must set a matching mode');
  assert.match(code, /third-parties-included/, "a user clearing a site means that site's embedded data too");
});

test('only the two measurable things are measured, and nothing is invented', () => {
  // Chromium exposes no per-category byte API. Anything else would have to come
  // from walking its internal directory layout, which changes between versions.
  assert.match(code, /getCacheSize\(\)/, 'the HTTP cache size is real');
  assert.match(code, /getStoragePath\(\)/, 'the profile path is real');
  for (const invented of ['localStorageBytes', 'indexedDBBytes', 'serviceWorkerBytes', 'cacheStorageBytes']) {
    assert.doesNotMatch(code, new RegExp(invented), `${invented} cannot be measured and must not be reported`);
  }
});

test('the profile walk cannot block the main event loop', () => {
  assert.doesNotMatch(code, /readdirSync|statSync|readFileSync/, 'the walk must never be synchronous');
  assert.match(code, /opendir/, 'entries must be streamed rather than materialised');
  assert.match(code, /budget/, 'the walk must be bounded');
});

test('measurement is cached, so opening the panel twice does not re-walk the disk', () => {
  assert.match(code, /CACHE_TTL_MS/);
  assert.match(code, /cached = null/, 'clearing must invalidate the cached measurement');
});
