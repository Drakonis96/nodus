import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('the public website is isolated from repository documentation', () => {
  for (const relative of [
    '.nojekyll',
    'index.html',
    'faq.js',
    'i18n-complete.js',
    'nodi.js',
    'nodi-widget.css',
    'nodi-widget.js',
    'tutorials.json',
    'assets/nodus-logo.svg',
    'data/github-release-downloads.json',
    'demo/index.html',
  ]) {
    assert.ok(fs.existsSync(path.join(siteRoot, relative)), `site/${relative} exists`);
  }

  for (const formerSiteEntry of [
    '.nojekyll',
    'index.html',
    'faq.js',
    'i18n-complete.js',
    'nodi.js',
    'nodi-widget.css',
    'nodi-widget.js',
    'tutorials.json',
    'assets',
    'data',
    'demo',
  ]) {
    assert.ok(
      !fs.existsSync(path.join(repoRoot, 'docs', formerSiteEntry)),
      `docs/${formerSiteEntry} is reserved for repository documentation`,
    );
  }
});

test('every static HTML link resolves inside the website tree', () => {
  const htmlFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.endsWith('.html')) htmlFiles.push(absolute);
    }
  };
  visit(siteRoot);

  for (const htmlFile of htmlFiles) {
    const source = fs.readFileSync(htmlFile, 'utf8');
    const references = [...source.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    for (const reference of references) {
      if (
        !reference
        || reference.startsWith('#')
        || reference.startsWith('//')
        || reference.includes('${')
        || /^[a-z][a-z\d+.-]*:/i.test(reference)
      ) continue;

      const pathname = reference.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      const resolved = path.resolve(path.dirname(htmlFile), pathname);
      assert.ok(
        resolved.startsWith(`${siteRoot}${path.sep}`),
        `${path.relative(repoRoot, htmlFile)} keeps ${reference} inside site/`,
      );
      const target = pathname.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
      assert.ok(
        fs.existsSync(target),
        `${path.relative(repoRoot, htmlFile)} references existing ${reference}`,
      );
    }
  }
});

test('the dedicated Pages worker owns the website and its scheduled cache refresh', () => {
  const pagesWorkflow = read('.github/workflows/pages.yml');
  const releaseWorkflow = read('.github/workflows/release.yml');

  assert.match(pagesWorkflow, /path:\s*site\b/);
  assert.match(pagesWorkflow, /actions\/deploy-pages@v5/);
  assert.match(pagesWorkflow, /node scripts\/github-release-downloads\.mjs/);
  assert.match(pagesWorkflow, /git add site\/data\/github-release-downloads\.json/);
  assert.doesNotMatch(pagesWorkflow, /repos\/\$\{GITHUB_REPOSITORY\}\/pages/);
  assert.doesNotMatch(releaseWorkflow, /pages\/builds|github-release-downloads|docs\/data\//);
});
