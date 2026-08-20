import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');

test('the site has every destination the navigation promises', () => {
  for (const entry of ['index.html', 'research-atlas/index.html', 'wiki/index.html', 'blog/index.html', 'contribute/index.html', 'faq/index.html']) {
    assert.ok(fs.existsSync(path.join(siteRoot, entry)), `site/${entry} exists`);
  }
  const home = read('index.html');
  for (const href of ['research-atlas/', 'wiki/', 'blog/', 'contribute/', 'faq/']) {
    assert.ok(home.includes(`href="${href}"`), `the home page links to ${href}`);
  }
});

test('the home page presents the four main vaults, the rest, and the toolkit', () => {
  const home = read('index.html');
  // one scene per main vault, each retuning the background to its own accent
  for (const [name, accent] of [
    ['Academic', '#818cf8'],
    ['Teaching', '#fb923c'],
    ['Study', '#2dd4bf'],
    ['Databases', '#ff5f7e'],
  ]) {
    assert.ok(home.includes(`data-accent="${accent}"`), `the ${name} scene tunes the organism to ${accent}`);
  }
  assert.equal((home.match(/<section class="scene"/g) ?? []).length, 4, 'four vault scenes, no more');

  for (const name of ['Genealogy', 'Worldbuilding', 'Primary Sources', 'Testimony', 'Prosopography']) {
    assert.ok(home.includes(`<h3>${name}</h3>`), `the remaining vaults include ${name}`);
  }
  // the six tools the desktop app actually ships (src/navigation.ts TOOLKIT_TOOLS)
  for (const tool of ['PDF Presenter', 'Nodus Apps', 'Nodus Convert', 'Nodus Protect', 'Nodus Translate', 'OCR Workspace']) {
    assert.ok(home.includes(`<h3>${tool}</h3>`), `the toolkit section includes ${tool}`);
  }
  // every vault mode ships today, so no page may still call one of them unreleased
  assert.doesNotMatch(home, /Building|On the roadmap|Coming soon|are being built/, 'no vault is described as unreleased');
  assert.doesNotMatch(home, /at no extra cost/, 'the toolkit no longer needs the price disclaimer');
  // the vault demos advertised on the home page must exist
  for (const demo of ['index', 'teaching', 'study', 'databases', 'genealogy', 'worldbuilding']) {
    const href = demo === 'index' ? 'demo/' : `demo/${demo}.html`;
    assert.ok(home.includes(href), `the home page links the ${demo} demo`);
    assert.ok(fs.existsSync(path.join(siteRoot, 'demo', `${demo}.html`)), `site/demo/${demo}.html exists`);
  }
});

test('every live demo can switch directly to every other demo vault', () => {
  const demoPages = ['index.html', 'teaching.html', 'study.html', 'databases.html', 'genealogy.html', 'worldbuilding.html'];
  const switcher = read('demo/vault-switcher.js');

  for (const page of demoPages) {
    assert.match(read(`demo/${page}`), /src="vault-switcher\.js\?v=/, `${page} loads the shared vault switcher`);
    assert.ok(switcher.includes(`page: '${page}'`), `${page} is offered by the vault panel`);
  }
  assert.match(switcher, /aria-expanded="false" aria-haspopup="menu"/, 'the centred badge exposes its menu state');
  assert.match(switcher, /role="menuitem"/, 'each demo vault is keyboard reachable');
  assert.match(switcher, /event\.key === 'Escape'/, 'Escape closes the vault panel');
  for (const icon of ['network', 'presentation', 'graduation', 'table', 'tree', 'globe']) {
    assert.match(switcher, new RegExp(`icon: '${icon}'`), `the switcher uses the app's ${icon} icon`);
  }
  assert.doesNotMatch(switcher, /symbol:/, 'no substitute text symbols remain in the switcher');
});

test('the academic web demo mirrors the current desktop navigation', () => {
  const app = read('demo/app.js');
  for (const group of ['Explore', 'Analyze', 'Write', 'Tools']) {
    assert.ok(app.includes(`{ group: '${group}' }`), `the academic demo includes the ${group} group`);
  }
  for (const [id, label] of [
    ['research', 'State of the art'],
    ['workspace', 'Workspace'],
    ['browser', 'Nodus Browser'],
    ['toolkit', 'Nodus Toolkit'],
  ]) {
    assert.match(app, new RegExp(`id: '${id}', label: '${label}'`), `${label} is a current sidebar destination`);
  }
  for (const obsolete of [
    "{ id: 'study', label: 'Study'",
    "{ id: 'gaps', label: 'Gaps'",
    "{ id: 'debate', label: 'Debates'",
    "{ id: 'coverage', label: 'Coverage'",
    "{ id: 'notes', label: 'Notes'",
  ]) {
    assert.ok(!app.includes(obsolete), `${obsolete} is no longer a standalone sidebar entry`);
  }
  assert.match(app, /aria-label="State of the art views"/, 'coverage, debates and gaps live in one tabbed workspace');
});

test('no page of the site loads a third-party tracker', () => {
  // the site carries no analytics container, and a page added later must not
  // quietly bring one back, so the whole tree is checked rather than page by page
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(siteRoot);
  assert.ok(pages.length >= 12, 'the walk found the pages of the site');

  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const name = path.relative(siteRoot, page);
    assert.doesNotMatch(html, /googletagmanager\.com/, `${name} loads no Tag Manager container`);
    assert.doesNotMatch(html, /google-analytics\.com|gtag\(/, `${name} loads no Google Analytics`);
    assert.doesNotMatch(html, /dataLayer/, `${name} declares no analytics dataLayer`);
    assert.doesNotMatch(html, /Google Tag Manager/, `${name} keeps no leftover GTM markers`);
  }
});

test('the tutorial gallery lives in the wiki and is generated from the file the desktop app also reads', () => {
  const script = read('wiki/wiki.js');
  assert.match(script, /fetch\('\.\.\/tutorials\.json'\)/);
  assert.match(script, /id: 'videos'/, 'the wiki exposes a Video tutorials page');
  assert.doesNotMatch(read('assets/js/home.js'), /tutorials\.json/, 'the home page no longer carries the gallery');
  const tutorials = JSON.parse(read('tutorials.json'));
  const titled = [...script.matchAll(/^\s{2}([a-z]+): \[/gm)].map((match) => match[1]);
  for (const video of tutorials.videos) {
    assert.ok(titled.includes(video.id), `the wiki gives the ${video.id} tutorial an English title`);
    assert.match(video.youtubeId, /^[\w-]{11}$/, `${video.id} has a valid YouTube id`);
  }
  assert.match(script, /youtube-nocookie\.com\/embed\//, 'the modal player uses the no-cookie host');
  assert.match(script, /\$\('iframe', modal\)\.src = ''/, 'closing the modal stops playback');
});

test('the FAQ moved to its own page with every question intact', () => {
  const data = read('faq/faq-data.js');
  const window = {};
  new Function('window', data)(window);
  assert.ok(window.FAQ_ENTRIES.length >= 20, 'every published question survived the move');
  const ids = window.FAQ_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'question ids are unique, so each one is linkable');

  const categories = new Set(window.FAQ_CATEGORIES.map((category) => category.id));
  assert.ok(categories.has('all'), 'the category row starts with All');
  for (const entry of window.FAQ_ENTRIES) {
    assert.ok(entry.q && entry.a, `${entry.id} has a question and an answer`);
    assert.ok(categories.has(entry.cat), `${entry.id} uses a declared category`);
  }
});

test('the blog engine ships with an index, static pages, a renderer and a template, and no stray posts', () => {
  for (const entry of ['blog/index.html', 'blog/post.html', 'blog/blog.js', 'blog/markdown.js', 'blog/posts.json', 'blog/feed.xml']) {
    assert.ok(fs.existsSync(path.join(siteRoot, entry)), `site/${entry} exists`);
  }
  assert.ok(fs.existsSync(path.join(siteRoot, 'blog/posts/_template.md')), 'the post template documents how to add one');

  const index = JSON.parse(read('blog/posts.json'));
  assert.ok(Array.isArray(index.posts), 'posts.json exposes a posts array');
  assert.ok(index.$comment.includes('posts/<slug>.md'), 'posts.json documents its own format');

  // every listed post must have its Markdown, and every Markdown file must be listed
  const files = fs.readdirSync(path.join(siteRoot, 'blog/posts'))
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => name.replace(/\.md$/, ''));
  for (const post of index.posts) {
    assert.ok(files.includes(post.slug), `posts/${post.slug}.md exists`);
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO date`);
    assert.ok(post.title && post.summary, `${post.slug} has a title and a summary`);
    if (!post.draft) {
      assert.ok(fs.existsSync(path.join(siteRoot, 'blog', post.slug, 'index.html')), `blog/${post.slug}/index.html is generated`);
    }
  }
  for (const slug of files) {
    assert.ok(index.posts.some((post) => post.slug === slug), `posts/${slug}.md is listed in posts.json`);
  }

  // the feed is generated, so it must agree with the index it was generated from
  const feed = read('blog/feed.xml');
  const published = index.posts.filter((post) => !post.draft);
  assert.equal((feed.match(/<item>/g) ?? []).length, published.length, 'feed.xml is in step with posts.json — run npm run blog:feed');
});

test('the blog renders Markdown without letting a post inject markup', () => {
  const window = {};
  new Function('window', read('blog/markdown.js'))(window);
  const { render } = window.NodusMarkdown;

  const basics = render('## Heading\n\nText with `code`, **bold** and a [link](https://example.com).\n\n- one\n- two\n');
  assert.match(basics.html, /<h2 id="heading">Heading<\/h2>/);
  assert.match(basics.html, /<code>code<\/code>/);
  assert.match(basics.html, /<strong>bold<\/strong>/);
  assert.match(basics.html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">link<\/a>/);
  assert.match(basics.html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.deepEqual(basics.headings, [{ level: 2, text: 'Heading', id: 'heading' }]);

  // a digit surrounded by spaces must never be mistaken for a code-span placeholder
  assert.match(render('It takes 5 minutes.').html, /It takes 5 minutes\./);
  // raw HTML in a post is escaped, never executed
  assert.match(render('<script>alert(1)</script>').html, /&lt;script&gt;/);
  assert.doesNotMatch(render('<img src=x onerror=alert(1)>').html, /<img src=x/);
});

test('the source files carry no stray NUL bytes', () => {
  // markdown.js delimits its code-span placeholders with NUL escapes; writing the
  // byte itself would make git treat the file as binary.
  for (const relative of ['blog/markdown.js', 'blog/blog.js', 'assets/js/organism.js', 'assets/js/site.js', 'assets/js/home.js', 'assets/js/research-atlas.js']) {
    assert.ok(!fs.readFileSync(path.join(siteRoot, relative)).includes(0), `site/${relative} is plain text`);
  }
});

test('the organism degrades for visitors who cannot or do not want to run it', () => {
  const organism = read('assets/js/organism.js');
  assert.match(organism, /prefers-reduced-motion: reduce/, 'reduced motion is honoured');
  assert.match(organism, /organism-fallback/, 'a static background replaces the canvas');
  assert.match(organism, /document\.hidden.*organism\.stop|if \(document\.hidden\) organism\.stop\(\)/s, 'a hidden tab stops the loop');
  assert.match(read('assets/css/nodus.css'), /\.organism-fallback \{/, 'the fallback is styled');

  const site = read('assets/js/site.js');
  assert.match(site, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'reveals and the cursor respect reduced motion');

  // every page that paints the organism has to provide its canvas
  for (const page of ['index.html', 'research-atlas/index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html', 'wiki/index.html', 'app/index.html', 'research/index.html', 'zotero/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    assert.ok(read(page).includes('<canvas id="organism" aria-hidden="true"></canvas>'), `${page} carries the organism canvas`);
  }
});

test('the home page opens with the mark forming, and can never strand a visitor', () => {
  const home = read('index.html');
  const css = read('assets/css/home.css');
  const script = read('assets/js/home.js');

  // armed before the first paint, so the page never flashes and then hides
  assert.match(home, /classList\.add\('intro-armed'\)/, 'the opening is armed inline in <head>');
  assert.match(home, /min-width: 701px/, 'the opening is never armed in a mobile viewport');
  assert.match(home, /prefers-reduced-motion: reduce/, 'reduced motion never arms the opening');
  // the same inline script owns a watchdog, so a missing home.js cannot leave a blank page
  assert.match(home, /setTimeout\(function \(\) \{[\s\S]*?intro-done[\s\S]*?\}, 6000\)/, 'the inline watchdog reveals the page on its own');
  assert.match(css, /body \{[\s\S]*?radial-gradient[\s\S]*?background-attachment: fixed;/, 'a finished-looking background exists before WebGL starts');
  assert.match(css, /#organism \{ transition-duration: 0\.3s; \}/, 'the live field replaces the static paint quickly');
  assert.match(script, /organism-assembled/, 'the release starts only after the field has finished assembling the mark');
  assert.match(script, /const onAssembled = \(\) => \{\s*if \(finished\) return;\s*release\(\);\s*\};/, 'the completed mark returns to the node flow immediately');
  assert.doesNotMatch(script, /engine\.pulse\(innerWidth/, 'the completed mark flows away instead of exploding outward');
  assert.match(read('assets/js/organism.js'), /dataset\.formation === 'on' && openingIsArmed/, 'mobile and unarmed visits never assemble a hidden N');
  assert.match(css, /\.hero \{[\s\S]*?-webkit-user-select: none;[\s\S]*?user-select: none;/, 'visible hero copy cannot be accidentally selected');

  // three separately masked lines, one per beat of the motto
  assert.equal((home.match(/<span class="line"><i>/g) ?? []).length, 3, 'the motto is three animated lines');
  assert.match(css, /\.hero-title \.line \{ display: block; overflow: hidden;/, 'each line is masked');
  for (const nth of [1, 2, 3]) {
    assert.match(css, new RegExp(`\\.hero-title \\.line:nth-child\\(${nth}\\) > i \\{ animation-delay:`), `line ${nth} has its own delay`);
  }

  // the rest of the page waits behind the mark
  assert.match(css, /\.intro-armed[\s\S]*?main > section,[\s\S]*?\{ opacity: 0; \}/, 'the page below the hero is held back');
  assert.match(css, /html\.intro-armed \{ overflow: hidden; \}/, 'scroll is locked while it plays');
  assert.match(css, /scrollbar-gutter: stable/, 'locking scroll must not shift the layout');
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\) and \(pointer: coarse\) \{\s*\.hero \.n-mark \{ animation: none; \}/, 'the N mark stays still on mobile devices');

  // and it is always escapable
  assert.match(script, /skip\.className = 'intro-skip'/, 'a skip control is offered');
  assert.match(script, /if \(scrollY > 40 \|\| location\.hash\) \{ finish\(\); return; \}/, 'a deep link skips the sequence');
  assert.match(script, /addEventListener\('keydown', onKey\)/, 'any key ends it');
});

// The long-form product and topic pages, and the URL each one is published at.
const TOPIC_PAGES = [
  ['app/index.html', 'https://nodusresearch.com/app/'],
  ['research/index.html', 'https://nodusresearch.com/research/'],
  ['zotero/index.html', 'https://nodusresearch.com/zotero/'],
  ['ai-research/index.html', 'https://nodusresearch.com/ai-research/'],
  ['open-source/index.html', 'https://nodusresearch.com/open-source/'],
];

test('the topic pages are indexable, canonical and described only once each', () => {
  const titles = new Set();
  const descriptions = new Set();

  for (const [page, url] of TOPIC_PAGES) {
    const html = read(page);
    assert.ok(html.includes(`<link rel="canonical" href="${url}"/>`), `${page} declares its canonical URL`);
    assert.ok(html.includes(`<meta property="og:url" content="${url}"/>`), `${page} declares its Open Graph URL`);
    assert.match(html, /<meta name="twitter:card"/, `${page} carries Twitter card metadata`);
    // a stray noindex here would quietly undo the whole point of the page
    assert.doesNotMatch(html, /content="[^"]*noindex/, `${page} is not marked noindex`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page} has exactly one h1`);
    assert.ok((html.match(/<h2[ >]/g) ?? []).length >= 3, `${page} builds a real heading hierarchy`);

    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(!titles.has(title), `${page} has a title of its own`);
    assert.ok(!descriptions.has(description), `${page} has a description of its own`);
    titles.add(title);
    descriptions.add(description);

    // structured data has to parse, or search engines silently drop it
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(block[1]), `${page} ships valid JSON-LD`);
    }
    assert.match(html, /"@type": "BreadcrumbList"/, `${page} declares its place in the hierarchy`);
  }
});

test('the topic pages are linked from the home page and to each other', () => {
  const home = read('index.html');
  for (const href of ['app/', 'research/', 'zotero/', 'ai-research/', 'open-source/']) {
    assert.ok(home.includes(`href="${href}"`), `the home page links to /${href}`);
  }
  // descriptive anchors, not "click here" — the anchor text is the link's whole signal
  assert.match(home, /Nodus for academic research/, 'the home page names the research page');

  const links = {
    'app/index.html': ['../research/', '../zotero/', '../ai-research/', '../open-source/', '../faq/', '../wiki/'],
    'research/index.html': ['../zotero/', '../ai-research/', '../open-source/'],
    'zotero/index.html': ['../research/', '../open-source/'],
    'ai-research/index.html': ['../research/', '../zotero/', '../open-source/'],
    'open-source/index.html': ['../research/', '../zotero/', '../ai-research/'],
  };
  for (const [page, required] of Object.entries(links)) {
    const html = read(page);
    for (const href of required) {
      assert.ok(html.includes(`href="${href}"`), `${page} links to ${href}`);
    }
    assert.ok(html.includes('href="../"'), `${page} links back to the canonical home page`);
  }
});

test('internal navigation only advertises canonical directory URLs', () => {
  const publishedSources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:html|js)$/.test(entry.name)) publishedSources.push(fs.readFileSync(absolute, 'utf8'));
    }
  };
  visit(siteRoot);
  publishedSources.push(fs.readFileSync(path.join(repoRoot, 'scripts', 'build-blog-pages.mjs'), 'utf8'));

  for (const source of publishedSources) {
    assert.doesNotMatch(source, /href\s*=\s*["'][^"']*index\.html/i, 'no rendered or generated link points to an index filename');
  }

  const header = read('site-header.js');
  assert.match(header, /href: \(base\) => base \|\| '\.\/'/, 'the shared Home link resolves to the canonical directory');
  assert.match(header, /pathname\.endsWith\('\/index\.html'\)[\s\S]*?location\.replace/, 'GitHub Pages index aliases are replaced client-side');

  const demoSwitcher = read('demo/vault-switcher.js');
  assert.match(demoSwitcher, /\{ page: 'index\.html', href: '\.\/'/, 'the academic demo advertises its directory URL');
  assert.match(demoSwitcher, /href="\$\{vault\.href \|\| vault\.page\}"/, 'the demo switcher uses a canonical override when one exists');
});

test('the sitemap lists every static page of the site', () => {
  const sitemap = read('sitemap.xml');
  for (const url of [
    'https://nodusresearch.com/',
    'https://nodusresearch.com/research-atlas/',
    'https://nodusresearch.com/app/',
    'https://nodusresearch.com/research/',
    'https://nodusresearch.com/zotero/',
    'https://nodusresearch.com/ai-research/',
    'https://nodusresearch.com/open-source/',
    'https://nodusresearch.com/wiki/',
    'https://nodusresearch.com/faq/',
    'https://nodusresearch.com/contribute/',
  ]) {
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `the sitemap lists ${url}`);
  }
  // robots must keep the whole site crawlable and point at that sitemap
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/\s*$/m, 'nothing blocks the crawlers');
  assert.match(robots, /Sitemap: https:\/\/nodusresearch\.com\/sitemap\.xml/);
});

test('the app page documents the current desktop builds and available vaults', () => {
  const app = read('app/index.html');
  for (const asset of [
    'Nodus-mac-arm64.dmg',
    'Nodus-win-x64.exe',
    'Nodus-linux-x86_64.AppImage',
    'Nodus-linux-amd64.deb',
  ]) {
    assert.match(app, new RegExp(`https://github\\.com/Drakonis96/nodus/releases/latest/download/${asset.replaceAll('.', '\\.')}`), `${asset} uses the stable release URL`);
  }
  for (const vault of ['Academic', 'Teaching', 'Study', 'Databases', 'Genealogy', 'Worldbuilding', 'Primary Sources', 'Testimony', 'Prosopography']) {
    assert.match(app, new RegExp(`\\b${vault}\\b`), `${vault} is represented on the app page`);
  }
  assert.match(app, /"@type": "SoftwareApplication"/, 'the app page identifies the downloadable software');
  assert.match(app, /"operatingSystem": "macOS, Windows, Linux"/, 'structured data names every supported platform');
});

test('every page is reachable by keyboard and readable by a screen reader', () => {
  for (const page of ['index.html', 'research-atlas/index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html', 'app/index.html', 'research/index.html', 'zotero/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    const html = read(page);
    assert.match(html, /class="skip-link" href="#/, `${page} offers a skip link`);
    assert.match(html, /<html lang="en">/, `${page} declares its language`);
    assert.match(html, /<meta name="description"/, `${page} has a description`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page} has exactly one h1`);
  }
});
