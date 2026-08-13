import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiRoot = path.join(root, 'site', 'wiki');
const content = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'content.json'), 'utf8'));

test('the Nodus Wiki covers all five stable vaults and every documented asset exists', () => {
  assert.deepEqual(content.vaults.map((vault) => vault.id), ['academic', 'genealogy', 'databases', 'study', 'teaching']);
  assert.ok(content.common.length >= 7, 'the core guide remains complete');
  assert.ok(content.vaults.reduce((total, vault) => total + vault.chapters.length, 0) >= 70, 'the vault manuals retain full section coverage');

  for (const chapter of content.common) {
    assert.ok(fs.existsSync(path.join(wikiRoot, 'assets', chapter.image)), `core screenshot exists: ${chapter.image}`);
  }
  for (const vault of content.vaults) {
    assert.ok(fs.existsSync(path.resolve(wikiRoot, vault.pdf)), `${vault.name} PDF is published with the site`);
    assert.ok(fs.existsSync(path.join(wikiRoot, 'assets', vault.id, 'home.png')), `${vault.name} overview capture exists`);
    for (const chapter of vault.chapters) {
      assert.ok(fs.existsSync(path.join(wikiRoot, 'assets', chapter.image)), `${vault.name} screenshot exists: ${chapter.image}`);
      assert.equal(chapter.steps.length, 3, `${chapter.title} stays an actionable three-step tutorial`);
      assert.ok(chapter.tips.length >= 1, `${chapter.title} retains a good-practice note`);
    }
  }
});

test('the wiki shell exposes global search, navigation and downloadable manuals', () => {
  const html = fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  assert.match(html, /id="search"[^>]+type="search"/);
  assert.match(html, /id="wiki-nav"/);
  assert.match(html, /id="nav-toggle"[^>]+aria-controls="wiki-sidebar"[^>]+aria-expanded="false"/);
  assert.match(html, /id="nav-backdrop"[^>]+hidden/);
  assert.match(script, /Download PDF manual/);
  assert.match(script, /Download PDF ↓/);
  assert.match(script, /href="\$\{vault\.pdf\}" download/);
  assert.match(script, /metaKey \|\| event\.ctrlKey/);
  assert.match(script, /content\.vaults\.flatMap/);
  assert.match(script, /function setNavigationOpen/);
  assert.match(script, /event\.key === 'Escape'.*nav-open/);
});

test('every vault uses its canonical Nodus pictogram instead of a letter badge', () => {
  assert.deepEqual(
    Object.fromEntries(content.vaults.map((vault) => [vault.id, vault.icon])),
    { academic: 'network', genealogy: 'tree', databases: 'table', study: 'graduation', teaching: 'presentation' },
  );
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  const css = fs.readFileSync(path.join(wikiRoot, 'wiki.css'), 'utf8');
  assert.match(script, /function iconMarkup/);
  assert.match(script, /iconMarkup\(vault\.icon\)/);
  assert.match(script, /iconMarkup\(page\.icon \|\| page\.vault\?\.icon\)/);
  assert.match(css, /\.result-icon \{[^}]*place-items: center/);
  assert.match(css, /\.vault-icon-svg \{[^}]*display: block/);
  assert.doesNotMatch(css, /\.search-result span \{/);
});
