import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiRoot = path.join(root, 'site', 'wiki');
const content = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'content.json'), 'utf8'));

function assertDesktopCapture(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${file} is a PNG capture`);
  assert.ok(buffer.readUInt32BE(16) >= 1400, `${file} has desktop-app width`);
  assert.ok(buffer.readUInt32BE(20) >= 850, `${file} has desktop-app height`);
}

test('the Nodus Wiki retains complete manuals for its five documented vaults', () => {
  assert.deepEqual(content.vaults.map((vault) => vault.id), ['academic', 'genealogy', 'databases', 'study', 'teaching']);
  assert.ok(content.common.length >= 7, 'the core guide remains complete');
  assert.ok(content.vaults.reduce((total, vault) => total + vault.chapters.length, 0) >= 70, 'the vault manuals retain full section coverage');

  for (const chapter of content.common) {
    const asset = path.join(wikiRoot, 'assets', chapter.image);
    assert.ok(fs.existsSync(asset), `core screenshot exists: ${chapter.image}`);
    assertDesktopCapture(asset);
  }
  for (const vault of content.vaults) {
    assert.ok(fs.existsSync(path.resolve(wikiRoot, vault.pdf)), `${vault.name} PDF is published with the site`);
    const overview = path.join(wikiRoot, 'assets', vault.id, 'home.png');
    assert.ok(fs.existsSync(overview), `${vault.name} overview capture exists`);
    assertDesktopCapture(overview);
    for (const chapter of vault.chapters) {
      const asset = path.join(wikiRoot, 'assets', chapter.image);
      assert.ok(fs.existsSync(asset), `${vault.name} screenshot exists: ${chapter.image}`);
      assertDesktopCapture(asset);
      assert.equal(chapter.steps.length, 3, `${chapter.title} stays an actionable three-step tutorial`);
      assert.ok(chapter.tips.length >= 1, `${chapter.title} retains a good-practice note`);
    }
  }
});

test('the Wiki home presents every vault that currently ships in Nodus', () => {
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  const html = fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8');
  const overviewSources = `${script}\n${fs.readFileSync(path.join(wikiRoot, 'content.json'), 'utf8')}`;
  const expected = ['Academic Research', 'Primary Sources', 'Testimony', 'Databases', 'Teaching', 'Study', 'Genealogy', 'Prosopography', 'Worldbuilding'];
  for (const name of expected) assert.match(overviewSources, new RegExp(name), `${name} appears in the Wiki overview`);
  assert.match(script, /const allVaults = \[\.\.\.content\.vaults, \.\.\.vaultsAwaitingGuides\]/);
  assert.match(script, /\$\{allVaults\.length\} vaults, one local-first engine/);
  assert.match(script, /Available in Nodus · Wiki guide coming later/, 'undocumented vaults are described honestly');
  assert.doesNotMatch(script, /\$\{figure\('academic\/home\.png', 'Nodus Academic Research home'\)\}/, 'the large Academic screenshot is removed from Wiki home');
  assert.match(html, /Explore all nine Nodus vaults/, 'search metadata states the real total');
});

test('each documented vault card opens its guide while PDF remains a separate action', () => {
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  const css = fs.readFileSync(path.join(wikiRoot, 'wiki.css'), 'utf8');
  assert.match(script, /class="vault-guide-link" href="#\$\{vault\.id\}"/, 'documented cards expose a semantic guide link');
  assert.match(css, /\.vault-guide-link::after\s*\{[^}]*position: absolute;[^}]*inset: 0;/s, 'the guide link covers the complete card');
  assert.match(css, /\.vault-card-actions \.vault-pdf-download\s*\{[^}]*z-index: 2;/s, 'the PDF action stays above the card link');
  assert.match(css, /\.vault-card\.guide-pending:hover\s*\{[^}]*transform: none;/s, 'cards without guides do not pretend to be clickable');
});

test('the wiki shell exposes global search, navigation and downloadable manuals', () => {
  const html = fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'site', 'site-header.js'), 'utf8');
  // the search box sits at the top of the sidebar rail, pinned while the nav scrolls
  assert.match(html, /wiki-sidebar[\s\S]*?id="search"[^>]+type="search"/);
  assert.doesNotMatch(header, /id="search"/, 'the header no longer carries the wiki search');
  assert.match(html, /data-nodus-site-header data-base="\.\.\/"[^>]*data-context="wiki"/);
  assert.match(html, /\.\.\/assets\/css\/nodus\.css/, 'the wiki shares the site design system');
  assert.match(html, /\.\.\/site-header\.js/);
  assert.match(html, /id="wiki-nav"/);
  assert.match(header, /id="nav-toggle"[^>]+aria-controls="wiki-sidebar"[^>]+aria-expanded="false"/);
  // a book, not a second hamburger beside the site menu's own
  assert.doesNotMatch(header, /class="wiki-menu-toggle"[^>]*>\s*<span>/, 'the docs toggle is not a hamburger');
  assert.match(header, /class="wiki-menu-toggle"[\s\S]{0,220}?<svg/, 'the docs toggle carries an icon');
  assert.match(html, /id="nav-backdrop"[^>]+hidden/);
  assert.match(script, /Download PDF manual/);
  assert.match(script, /<span>PDF manual<\/span>/);
  assert.match(script, /href="\$\{vault\.pdf\}" download/);
  assert.match(script, /Download all PDF manuals \(\.zip\)/);
  assert.match(script, /function downloadIconMarkup/);
  assert.match(script, /class="vault-pdf-download"/);
  assert.match(script, /metaKey \|\| event\.ctrlKey/);
  assert.match(script, /content\.vaults\.flatMap/);
  assert.match(script, /function setNavigationOpen/);
  assert.match(script, /event\.key === 'Escape'.*nav-open/);
});

test('the Wiki uses the same living background as the rest of the site', () => {
  const html = fs.readFileSync(path.join(wikiRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(wikiRoot, 'wiki.css'), 'utf8');
  assert.match(html, /<body class="wiki-page">/, 'the Wiki does not dim the shared organism');
  assert.doesNotMatch(css, /#organism\.awake\s*\{[^}]*opacity:/, 'the Wiki does not override the shared field opacity');
  assert.match(css, /main#article\s*\{[^}]*background: transparent;/s, 'the document column lets the shared field show through');
});

test('wide desktop vault rows navigate without duplicating the right-hand chapter index', () => {
  const script = fs.readFileSync(path.join(wikiRoot, 'wiki.js'), 'utf8');
  const css = fs.readFileSync(path.join(wikiRoot, 'wiki.css'), 'utf8');
  assert.match(script, /matchMedia\('\(min-width: 1181px\)'\)/, 'the behavior starts exactly where the right rail appears');
  assert.match(script, /if \(usesRightHandToc\.matches\) \{\s*event\.preventDefault\(\)/, 'desktop summary clicks do not toggle details');
  assert.match(script, /location\.hash = vault\.dataset\.vault/, 'desktop summary clicks open the selected manual');
  assert.match(script, /if \(usesRightHandToc\.matches \|\| !isActive\) vault\.open = false;\s*else vault\.open = true;/, 'narrow layouts retain the left accordion');
  assert.match(css, /@media \(min-width: 1181px\)[\s\S]*?\.nav-vault\[open\] > \.nav-link \{ display: none; \}/, 'desktop never paints nested chapter links in the left rail');
});

test('the manual bundle contains one current PDF for every vault', async () => {
  const bundle = path.resolve(wikiRoot, content.manualBundle);
  assert.ok(fs.existsSync(bundle), 'the all-manuals ZIP is published with the site');
  const { execFileSync } = await import('node:child_process');
  const entries = execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(entries, content.vaults.map((vault) => path.basename(vault.pdf)).sort());
});

test('the published guides contain no editorial request notes or web-demo links', () => {
  const files = ['index.html', 'wiki.js', 'content.json'].map((name) => fs.readFileSync(path.join(wikiRoot, name), 'utf8'));
  files.push(fs.readFileSync(path.join(root, 'scripts', 'build-wiki-manuals.py'), 'utf8'));
  const combined = files.join('\n');
  assert.doesNotMatch(combined, /English interface|sample vault|English screenshots|English edition|complete English|Try this vault|Open the live demo|demo mode/i);
  assert.doesNotMatch(content.vaults.map((vault) => JSON.stringify(vault)).join('\n'), /"demo"\s*:/i);
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
