import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogRoot = path.join(repoRoot, 'site', 'blog');
const read = (relative) => fs.readFileSync(path.join(blogRoot, relative), 'utf8');
const index = () => JSON.parse(read('posts.json'));

/* The index and the static-page generator each sort the posts themselves, so
   the order in posts.json is free. Both must put the newest first. */
const sortAsBlogDoes = (posts) => posts
  .filter((post) => post && post.slug && post.title && post.date && !post.draft)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

test('the blog lists the newest post first, whatever order the file is in', () => {
  const scrambled = [
    { slug: 'old', title: 'Old', date: '2024-01-05' },
    { slug: 'newest', title: 'Newest', date: '2027-12-31' },
    { slug: 'middle', title: 'Middle', date: '2025-06-30' },
  ];
  assert.deepEqual(
    sortAsBlogDoes(scrambled).map((post) => post.date),
    ['2027-12-31', '2025-06-30', '2024-01-05'],
    'newest to oldest, regardless of the order in posts.json',
  );
});

test('a draft never reaches the index, however recent it is', () => {
  const posts = [
    { slug: 'published', title: 'Published', date: '2026-01-01' },
    { slug: 'draft', title: 'Draft', date: '2099-01-01', draft: true },
  ];
  assert.deepEqual(sortAsBlogDoes(posts).map((post) => post.slug), ['published']);
});

test('both the index and the static-page generator sort by date descending', () => {
  // b before a is what makes it descending; a before b would silently reverse the
  // blog. Whitespace is left loose so reformatting cannot fail this by accident.
  const descending = /\.sort\(\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*String\(\s*b\.date\s*\)\s*\.localeCompare\(\s*String\(\s*a\.date\s*\)\s*\)\s*\)/;
  assert.match(read('blog.js'), descending, 'blog.js sorts newest first');
  const generator = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-blog-pages.mjs'), 'utf8');
  assert.match(generator, descending, 'the static-page generator sorts newest first');
});

test('every listed post has the fields the blog renders, and a file to render', () => {
  for (const post of index().posts) {
    assert.ok(/^[a-z0-9-]+$/.test(post.slug), `${post.slug} is a kebab-case slug`);
    assert.ok(post.title, `${post.slug} has a title`);
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO date`);
    assert.match(post.modified, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO modified date`);
    assert.ok(post.modified >= post.date, `${post.slug} is not modified before publication`);
    assert.ok(post.summary, `${post.slug} has a summary for the card and the feed`);
    assert.ok(
      fs.existsSync(path.join(blogRoot, 'posts', `${post.slug}.md`)),
      `${post.slug} has a Markdown file`,
    );
    // the title is printed by the page, so a level-1 heading would duplicate it
    assert.doesNotMatch(
      read(path.join('posts', `${post.slug}.md`)),
      /^# /m,
      `${post.slug}.md starts at ## and leaves the h1 to the page`,
    );
    if (post.cover) {
      assert.ok(
        fs.existsSync(path.join(blogRoot, post.cover)),
        `${post.slug} cover exists at ${post.cover}`,
      );
      assert.ok(post.coverAlt, `${post.slug} cover has alt text`);
    }
  }
});

test('the RSS feed carries the published posts and nothing else', () => {
  const feed = read('feed.xml');
  const published = sortAsBlogDoes(index().posts);
  assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(feed, /<rss version="2\.0"[^>]*>/, 'the document declares RSS 2.0');
  assert.match(feed, /<atom:link href="https:\/\/nodusresearch\.com\/blog\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.equal(
    (feed.match(/<item>/g) ?? []).length,
    published.length,
    'one feed item per published post',
  );
  for (const post of published) {
    const url = `https://nodusresearch.com/blog/${post.slug}/`;
    assert.ok(
      feed.includes(url),
      `the feed links to the clean URL for ${post.slug}`,
    );
    assert.ok(feed.includes(`<guid isPermaLink="true">${url}</guid>`), `${post.slug} has a stable permalink guid`);
    assert.ok(feed.includes(`<pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate>`), `${post.slug} has a valid publication date`);
  }
});

test('every published post is complete, crawlable HTML at its clean URL', () => {
  for (const post of sortAsBlogDoes(index().posts)) {
    const html = read(path.join(post.slug, 'index.html'));
    const canonical = `https://nodusresearch.com/blog/${post.slug}/`;
    assert.match(html, /<div class="prose" id="article" tabindex="-1">\s*<(?:p|h2)[ >]/s, `${post.slug} contains rendered article copy`);
    assert.ok(html.includes(`<title>${post.title} · Nodus Blog</title>`), `${post.slug} has its own title`);
    assert.ok(html.includes(`content="${post.summary.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`), `${post.slug} has its description in source`);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"/>`), `${post.slug} has a clean canonical`);
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}"/>`), `${post.slug} shares its clean URL`);
    const structuredData = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const article = structuredData['@graph'].find((entry) => entry['@type'] === 'BlogPosting');
    assert.equal(article.datePublished, post.date, `${post.slug} exposes its publication date`);
    assert.equal(article.dateModified, post.modified, `${post.slug} exposes its modified date`);
    assert.ok(structuredData['@graph'].some((entry) => entry['@type'] === 'BreadcrumbList'), `${post.slug} exposes breadcrumbs`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"\/>/, `${post.slug} has a large social card`);
    assert.match(html, /<meta name="author" content="Jorge Pérez Burgueño"\/>/, `${post.slug} names its author`);
    assert.doesNotMatch(html, /markdown\.js|post\.js|fetch\(/, `${post.slug} does not need JavaScript to load its article`);
  }
});

test('the old parameter URL is a noindex compatibility redirect', () => {
  const legacy = read('post.html');
  assert.match(legacy, /<meta name="robots" content="noindex, follow"\/>/);
  assert.match(legacy, /location\.replace\('\.\/' \+ encodeURIComponent\(slug\) \+ '\/'\)/);
  assert.doesNotMatch(read('blog.js'), /post\.html\?p=/);
});

test('RSS opens an accessible subscription dialog and remains readable directly', () => {
  const feed = read('feed.xml');
  assert.match(
    feed,
    /<\?xml-stylesheet type="text\/xsl" href="feed\.xsl"\?>/,
    'feed.xml points at the stylesheet, so a browser renders a page instead of raw XML',
  );
  const stylesheet = read('feed.xsl');
  assert.match(stylesheet, /<xsl:template match="\/rss\/channel">/, 'the stylesheet transforms the channel');
  assert.match(stylesheet, /<xsl:template match="item">/, 'the stylesheet renders each post');

  // Normal clicks stay on the blog and explain what to do; the href remains a
  // useful no-JavaScript fallback and direct feed readers still get the XML.
  const html = read('index.html');
  assert.match(html, /class="arrow-link rss-modal-trigger" href="feed\.xml" aria-haspopup="dialog"/);
  assert.match(html, /class="rss-dialog" role="dialog" aria-modal="true"/);
  assert.match(html, /id="rss-feed-url"[^>]*value="https:\/\/nodusresearch\.com\/blog\/feed\.xml"/);
  const script = read('blog.js');
  assert.match(script, /event\.preventDefault\(\)/, 'the enhanced click does not navigate away');
  assert.match(script, /navigator\.clipboard/, 'modern browsers use the Clipboard API');
  assert.match(script, /document\.execCommand\('copy'\)/, 'older or restricted browsers get a copy fallback');
  assert.match(script, /event\.key === 'Escape'/, 'the dialog closes from the keyboard');
  assert.match(script, /rssPreviousFocus\?\.focus\(\)/, 'focus returns to the link that opened it');
});

test('regenerating the feed keeps what the published feed says', () => {
  // build-blog-feed.mjs overwrites feed.xml wholesale: if it drifts from the
  // shipped feed, one `npm run blog:feed` silently undoes the domain move and
  // changes every guid, which shows old posts again in everyone's reader
  const generator = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-blog-feed.mjs'), 'utf8');
  assert.match(generator, /loadSiteMetadata\(repoRoot\)\.siteUrl/, 'the generator uses the canonical site metadata');
  assert.match(generator, /xml-stylesheet type="text\/xsl" href="feed\.xsl"/, 'the generator keeps the stylesheet');
  assert.match(generator, /<guid isPermaLink="true">/, 'the generator keeps the guids already published');
});

test('the site addresses the blog by its own domain', () => {
  // the sitemap is validated against the verified Search Console property
  for (const file of ['index.html', 'post.html', 'feed.xml', 'feed.xsl']) {
    assert.doesNotMatch(read(file), /drakonis96\.github\.io/, `${file} uses nodusresearch.com`);
  }
  const sitemap = fs.readFileSync(path.join(repoRoot, 'site', 'sitemap.xml'), 'utf8');
  for (const post of sortAsBlogDoes(index().posts)) {
    assert.ok(sitemap.includes(`https://nodusresearch.com/blog/${post.slug}/`), `the sitemap lists ${post.slug}`);
  }
  assert.doesNotMatch(sitemap, /blog\/post\.html|[?&]p=/, 'the sitemap exposes no legacy blog URLs');
});
