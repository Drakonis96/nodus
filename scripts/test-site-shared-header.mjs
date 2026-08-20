import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const headerScript = read('site/site-header.js');
const headerStyles = read('site/site-header.css');
const systemStyles = read('site/assets/css/nodus.css');

// Pages that carry the site design system and get the header from nodus.css.
const systemPages = [
  ['site/index.html', 'home', ''],
  ['site/research-atlas/index.html', 'atlas', '../'],
  ['site/research/index.html', 'research', '../'],
  ['site/zotero/index.html', 'zotero', '../'],
  ['site/ai-research/index.html', 'ai-research', '../'],
  ['site/open-source/index.html', 'open-source', '../'],
  ['site/faq/index.html', 'faq', '../'],
  ['site/blog/index.html', 'blog', '../'],
  ['site/blog/post.html', 'blog', '../'],
  ['site/contribute/index.html', 'contribute', '../'],
  // the wiki carries the design system as well; it only adds a docs layout on top
  ['site/wiki/index.html', 'wiki', '../'],
];

// Pages that are not part of the marketing site and load site-header.css instead.
const standalonePages = [
  ['site/demo/index.html', 'demo', '../'],
  ['site/demo/teaching.html', 'demo', '../'],
  ['site/demo/study.html', 'demo', '../'],
  ['site/demo/genealogy.html', 'demo', '../'],
  ['site/demo/databases.html', 'demo', '../'],
  ['site/demo/worldbuilding.html', 'demo', '../'],
];

test('every page mounts the one shared header and marks its own destination', () => {
  for (const [relative, page, base] of [...systemPages, ...standalonePages]) {
    const html = read(relative);
    assert.match(
      html,
      new RegExp(`data-nodus-site-header data-base="${base.replace(/\//g, '\\/').replace(/\./g, '\\.')}"[^>]*data-page="${page}"`),
      `${relative} mounts the shared header as the ${page} page`,
    );
    assert.match(html, new RegExp(`src="${base.replace(/\//g, '\\/').replace(/\./g, '\\.')}site-header\\.js\\?v=[^"]+"`), `${relative} loads the shared header component`);
    assert.doesNotMatch(html, /class="site-nav"|id="site-stars"/, `${relative} has no legacy duplicate header`);
    assert.doesNotMatch(html, /api\.github\.com\/repos\/Drakonis96\/nodus/, `${relative} delegates header data loading to the component`);
  }
});

test('the design-system pages take the header from nodus.css, and only the others load site-header.css', () => {
  for (const [relative] of systemPages) {
    const html = read(relative);
    assert.match(html, /assets\/css\/nodus\.css\?v=[^"]+/, `${relative} loads the design system`);
    assert.doesNotMatch(html, /site-header\.css/, `${relative} must not load the standalone header styles as well`);
  }
  for (const [relative] of standalonePages) {
    const html = read(relative);
    assert.match(html, /site-header\.css\?v=[^"]+/, `${relative} loads the standalone header styles`);
    assert.doesNotMatch(html, /assets\/css\/nodus\.css/, `${relative} keeps its own stylesheet`);
  }
});

test('the shared component owns every control visible in the header', () => {
  for (const token of [
    "{ id: 'home', label: 'Home'",
    "{ id: 'atlas', label: 'Atlas'",
    "{ id: 'wiki', label: 'Wiki'",
    "{ id: 'blog', label: 'Blog'",
    "{ id: 'contribute', label: 'Contribute'",
    "{ id: 'faq', label: 'FAQ'",
    'class="gh-badge"',
    'id="release-downloads"',
    'id="site-nav-toggle"',
    'Try the live demo',
  ]) assert.ok(headerScript.includes(token), `shared header includes ${token}`);
  assert.equal((headerScript.match(/return `<nav class="nav/g) ?? []).length, 1);
  assert.match(headerScript, /class="nav\$\{isWiki \? ' wiki-nav' : ''\}" id="site-header"/);
});

test('the redesign is English only, so the header carries no language switcher', () => {
  for (const token of ['lang-trigger', 'lang-menu', 'data-i18n', 'LANGUAGES']) {
    assert.ok(!headerScript.includes(token), `shared header no longer ships ${token}`);
  }
  for (const [relative] of systemPages) {
    assert.doesNotMatch(read(relative), /data-i18n/, `${relative} carries no translation hooks`);
  }
});

test('both header stylesheets keep the same fixed dimensions and breakpoint', () => {
  // nodus.css drives the marketing pages, site-header.css the wiki and demos:
  // they must not drift apart or the chrome jumps when a visitor moves between them.
  assert.match(systemStyles, /--nav-h:\s*62px;/);
  assert.match(headerStyles, /\.nav \{[\s\S]*?height: 62px;/);
  for (const styles of [systemStyles, headerStyles]) {
    assert.match(styles, /@media \(max-width: 1320px\) \{[\s\S]*?\.nav-toggle \{ display: block/);
    assert.match(styles, /\.nav \.links > a\.link\[aria-current="page"\]/);
  }
  // the demo shell has to reserve the row the fixed header occupies
  assert.match(read('site/demo/demo.css'), /body\.demo-page > \[data-nodus-site-header\] \{ display: block; height: 62px; \}/);
  // the wiki offsets its own shell by the shared header variable rather than a copy
  assert.match(read('site/wiki/wiki.css'), /padding-top: var\(--nav-h\)/);
});
