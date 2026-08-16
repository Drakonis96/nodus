// Regenerate site/sitemap.xml from the static pages of the site.
// Run after adding or editing a page:  npm run site:sitemap
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://nodusresearch.com';

const PAGES = [
  { file: 'index.html', url: '/' },
  { file: 'demo/index.html', url: '/demo/' },
  { file: 'demo/study.html', url: '/demo/study.html' },
  { file: 'demo/teaching.html', url: '/demo/teaching.html' },
  { file: 'demo/worldbuilding.html', url: '/demo/worldbuilding.html' },
  { file: 'demo/databases.html', url: '/demo/databases.html' },
  { file: 'demo/genealogy.html', url: '/demo/genealogy.html' },
  { file: 'blog/index.html', url: '/blog/' },
  { file: 'blog/post.html', url: '/blog/post.html' },
  { file: 'wiki/index.html', url: '/wiki/' },
  { file: 'faq/index.html', url: '/faq/' },
  { file: 'contribute/index.html', url: '/contribute/' },
];

const missing = PAGES.filter((page) => !fs.existsSync(path.join(repoRoot, 'site', page.file)));
if (missing.length) {
  console.error(`Missing pages: ${missing.map((page) => page.file).join(', ')}`);
  process.exit(1);
}

const lastmod = (file) => {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', path.join('site', file)], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
};

const entries = PAGES.map(({ file, url }) => {
  const modified = lastmod(file);
  const lastmodTag = modified ? `\n    <lastmod>${modified}</lastmod>` : '';
  return `  <url>
    <loc>${SITE}${url}</loc>${lastmodTag}
  </url>`;
}).join('\n');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;

fs.writeFileSync(path.join(repoRoot, 'site', 'sitemap.xml'), sitemap);
console.log(`site/sitemap.xml written with ${PAGES.length} URLs.`);
