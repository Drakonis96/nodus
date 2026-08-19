// Regenerate site/blog/feed.xml from site/blog/posts.json.
// Run after adding or editing a post:  npm run blog:feed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogRoot = path.join(repoRoot, 'site/blog');
const SITE = 'https://nodusresearch.com';

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]
));

const index = JSON.parse(fs.readFileSync(path.join(blogRoot, 'posts.json'), 'utf8'));
const posts = (Array.isArray(index.posts) ? index.posts : [])
  .filter((post) => post && post.slug && post.title && post.date && !post.draft)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

const missing = posts.filter((post) => !fs.existsSync(path.join(blogRoot, 'posts', `${post.slug}.md`)));
if (missing.length) {
  console.error(`Missing Markdown for: ${missing.map((post) => post.slug).join(', ')}`);
  process.exit(1);
}

const pubDate = (value) => new Date(`${value}T12:00:00Z`).toUTCString();
const items = posts.map((post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${SITE}/blog/post.html?p=${encodeURIComponent(post.slug)}</link>
      <guid isPermaLink="true">${SITE}/blog/post.html?p=${encodeURIComponent(post.slug)}</guid>
      <pubDate>${pubDate(post.date)}</pubDate>
      <description>${escapeXml(post.summary || post.title)}</description>
${(post.tags || []).map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`).join('\n');

// the stylesheet is browsers-only: feed readers skip the instruction
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="feed.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nodus Blog</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Notes from the Nodus project: comparisons with the tools around it, workflows worth stealing, and what is being built next.</description>
    <language>en</language>
    <lastBuildDate>${posts.length ? pubDate(posts[0].date) : new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

fs.writeFileSync(path.join(blogRoot, 'feed.xml'), feed);
console.log(`site/blog/feed.xml written with ${posts.length} post${posts.length === 1 ? '' : 's'}.`);
