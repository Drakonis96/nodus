import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogRoot = path.join(repoRoot, 'site', 'blog');
const read = (relative) => fs.readFileSync(path.join(blogRoot, relative), 'utf8');
const index = () => JSON.parse(read('posts.json'));

/* The index and the post page each sort the posts themselves, so the order in
   posts.json is free. Both must agree, and both must put the newest first.

   blog.js and post.js are DOM-bound IIFEs, so the ordering cannot be imported
   and called here. The first two tests state the contract; the third is the one
   that ties the shipped code to it. */
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

test('both the index and the post page sort by date descending', () => {
  // b before a is what makes it descending; a before b would silently reverse the
  // blog. Whitespace is left loose so reformatting cannot fail this by accident.
  const descending = /\.sort\(\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*String\(\s*b\.date\s*\)\s*\.localeCompare\(\s*String\(\s*a\.date\s*\)\s*\)\s*\)/;
  assert.match(read('blog.js'), descending, 'blog.js sorts newest first');
  assert.match(read('post.js'), descending, 'post.js sorts newest first');
});

test('every listed post has the fields the blog renders, and a file to render', () => {
  for (const post of index().posts) {
    assert.ok(/^[a-z0-9-]+$/.test(post.slug), `${post.slug} is a kebab-case slug`);
    assert.ok(post.title, `${post.slug} has a title`);
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO date`);
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
  assert.equal(
    (feed.match(/<item>/g) ?? []).length,
    published.length,
    'one feed item per published post',
  );
  for (const post of published) {
    assert.ok(feed.includes(`?p=${post.slug}`), `the feed links to ${post.slug}`);
  }
});

test('the feed is readable in a browser, not just in a reader', () => {
  const feed = read('feed.xml');
  assert.match(
    feed,
    /<\?xml-stylesheet type="text\/xsl" href="feed\.xsl"\?>/,
    'feed.xml points at the stylesheet, so a browser renders a page instead of raw XML',
  );
  const stylesheet = read('feed.xsl');
  assert.match(stylesheet, /<xsl:template match="\/rss\/channel">/, 'the stylesheet transforms the channel');
  assert.match(stylesheet, /<xsl:template match="item">/, 'the stylesheet renders each post');

  // the address only helps when it can be taken to a reader in one click
  const html = read('index.html');
  assert.match(html, /id="feed-copy"[^>]*data-url="https:\/\/nodusresearch\.com\/blog\/feed\.xml"/);
  assert.match(read('blog.js'), /navigator\.clipboard/, 'the copy button is wired');
});

test('regenerating the feed keeps what the published feed says', () => {
  // build-blog-feed.mjs overwrites feed.xml wholesale: if it drifts from the
  // shipped feed, one `npm run blog:feed` silently undoes the domain move and
  // changes every guid, which shows old posts again in everyone's reader
  const generator = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-blog-feed.mjs'), 'utf8');
  assert.match(generator, /const SITE = 'https:\/\/nodusresearch\.com'/, 'the generator uses the live domain');
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
    assert.ok(sitemap.includes(`?p=${post.slug}`), `the sitemap lists ${post.slug}`);
  }
});
