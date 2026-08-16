import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');

test('the site has exactly the five destinations the navigation promises', () => {
  for (const entry of ['index.html', 'wiki/index.html', 'blog/index.html', 'contribute/index.html', 'faq/index.html']) {
    assert.ok(fs.existsSync(path.join(siteRoot, entry)), `site/${entry} exists`);
  }
  const home = read('index.html');
  for (const href of ['wiki/', 'blog/', 'contribute/', 'faq/']) {
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
    assert.ok(home.includes(`demo/${demo}.html`), `the home page links the ${demo} demo`);
    assert.ok(fs.existsSync(path.join(siteRoot, 'demo', `${demo}.html`)), `site/demo/${demo}.html exists`);
  }
});

test('every page of the site carries the Google Tag Manager container', () => {
  // a page added later without the snippet goes uncounted and nobody notices,
  // so the container is checked across the whole site rather than page by page
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
    assert.match(html, /googletagmanager\.com\/gtm\.js/, `${name} loads the GTM container`);
    assert.match(html, /googletagmanager\.com\/ns\.html\?id=GTM-MP3BX78N/, `${name} carries the noscript fallback`);
    // the container must be reachable before anything else can delay it
    const headStart = html.indexOf('<!-- Google Tag Manager -->');
    assert.ok(headStart > -1 && headStart < html.indexOf('<title'), `${name} puts GTM high in the head`);
    assert.ok(
      html.indexOf('<!-- Google Tag Manager (noscript) -->') > html.indexOf('<body'),
      `${name} puts the noscript iframe right after <body>`,
    );
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

test('the blog engine ships with an index, a renderer and a template, and no stray posts', () => {
  for (const entry of ['blog/index.html', 'blog/post.html', 'blog/blog.js', 'blog/post.js', 'blog/markdown.js', 'blog/posts.json', 'blog/feed.xml']) {
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
  for (const relative of ['blog/markdown.js', 'blog/blog.js', 'blog/post.js', 'assets/js/organism.js', 'assets/js/site.js', 'assets/js/home.js']) {
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
  for (const page of ['index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html', 'wiki/index.html']) {
    assert.ok(read(page).includes('<canvas id="organism" aria-hidden="true"></canvas>'), `${page} carries the organism canvas`);
  }
});

test('the home page opens with the mark forming, and can never strand a visitor', () => {
  const home = read('index.html');
  const css = read('assets/css/home.css');
  const script = read('assets/js/home.js');

  // armed before the first paint, so the page never flashes and then hides
  assert.match(home, /classList\.add\('intro-armed'\)/, 'the opening is armed inline in <head>');
  assert.match(home, /prefers-reduced-motion: reduce/, 'reduced motion never arms the opening');
  // the same inline script owns a watchdog, so a missing home.js cannot leave a blank page
  assert.match(home, /setTimeout\(function \(\) \{[\s\S]*?intro-done[\s\S]*?\}, 9000\)/, 'the inline watchdog reveals the page on its own');

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

  // and it is always escapable
  assert.match(script, /skip\.className = 'intro-skip'/, 'a skip control is offered');
  assert.match(script, /if \(scrollY > 40 \|\| location\.hash\) \{ finish\(\); return; \}/, 'a deep link skips the sequence');
  assert.match(script, /addEventListener\('keydown', onKey\)/, 'any key ends it');
});

test('every page is reachable by keyboard and readable by a screen reader', () => {
  for (const page of ['index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html']) {
    const html = read(page);
    assert.match(html, /class="skip-link" href="#/, `${page} offers a skip link`);
    assert.match(html, /<html lang="en">/, `${page} declares its language`);
    assert.match(html, /<meta name="description"/, `${page} has a description`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page} has exactly one h1`);
  }
});
