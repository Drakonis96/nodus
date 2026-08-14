import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const landing = read('site/index.html');
const headerScript = read('site/site-header.js');
const headerStyles = read('site/site-header.css');
const demoPages = [
  'site/demo/index.html',
  'site/demo/teaching.html',
  'site/demo/study.html',
  'site/demo/genealogy.html',
  'site/demo/databases.html',
  'site/demo/worldbuilding.html',
];

test('the landing page and every demo render one shared public-site header', () => {
  assert.match(landing, /data-nodus-site-header data-base="" data-context="landing"/);
  assert.match(landing, /href="site-header\.css\?v=[^"]+"/);
  assert.match(landing, /src="site-header\.js\?v=[^"]+"/);
  assert.match(landing, /getElementById\('site-header'\)/);

  for (const relative of demoPages) {
    const page = read(relative);
    assert.match(page, /data-nodus-site-header data-base="\.\.\/" data-context="demo"/, `${relative} mounts the shared header`);
    assert.match(page, /href="\.\.\/site-header\.css\?v=[^"]+"/, `${relative} loads the shared header styles last`);
    assert.match(page, /src="\.\.\/site-header\.js\?v=[^"]+"/, `${relative} loads the shared header component`);
    assert.doesNotMatch(page, /class="site-nav"|id="site-stars"/, `${relative} has no legacy duplicate header`);
    assert.doesNotMatch(page, /<header class="topbar">/, `${relative} has no redundant in-demo header`);
    assert.doesNotMatch(page, /api\.github\.com\/repos\/Drakonis96\/nodus/, `${relative} delegates header data loading to the component`);
  }
});

test('the shared component owns every control visible in the main header', () => {
  for (const token of [
    'data-i18n="nav.vaults"',
    'data-i18n="nav.how"',
    'data-i18n="nav.views"',
    'data-i18n="nav.tutorials"',
    'data-i18n="nav.contrib"',
    'id="faq-nav-link"',
    'id="lang-trigger"',
    'class="gh-badge"',
    'id="release-downloads"',
    'data-i18n="nav.demo"',
  ]) assert.ok(headerScript.includes(token), `shared header includes ${token}`);
  assert.equal((headerScript.match(/return `<nav class="nav/g) ?? []).length, 1);
  assert.match(headerScript, /class="nav\$\{isWiki \? ' wiki-nav' : ''\}" id="site-header"/);
});

test('desktop and mobile use the same fixed header dimensions on every page', () => {
  assert.match(headerStyles, /\.nav \{[\s\S]*?min-height: 60px;[\s\S]*?padding: 12px 28px;/);
  assert.match(headerStyles, /body\.demo-page \{ padding-top: 65px; grid-template-rows: 1fr; \}/);
  assert.match(headerStyles, /@media \(max-width: 620px\) \{[\s\S]*?\.nav \{ gap: 12px; padding: 12px 16px; \}/);
  assert.match(headerStyles, /@media \(max-width: 420px\) \{[\s\S]*?\.nav \{ height: 58px; min-height: 58px;[\s\S]*?body\.demo-page \{ padding-top: 58px; \}/);
  assert.match(headerStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.nav \.links a\.btn\.primary \{ display: none; \}/);
});
