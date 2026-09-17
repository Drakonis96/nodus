import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const compiled = await build({ entryPoints: ['shared/releaseNotes.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { RELEASE_NOTES } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const current = RELEASE_NOTES[0];
// Explicit display order, independent of the modal's grouping implementation. The modal
// orders scope clusters by size (largest first) and then by first appearance, so the two
// `languages` and `connector` notes keep the order the release array declares.
const indices = [0, 1];
const expected = indices.map(index => current.highlights[index]);
const output = 'artifacts/release-5.5.0';
// The modal caps its own height and scrolls its body, and the shell pins html/body/#root
// to the viewport with `overflow: hidden`, so a full-page screenshot would otherwise stop
// at the fold. Releasing all three lets the document grow to the whole release.
const LIFT_SCROLL_CAP = 'html,body,#root{height:auto!important;overflow:visible!important}'
  + '.whats-new-backdrop{position:static!important;display:block!important;padding:24px!important}'
  + '.whats-new-cinema{max-height:none!important;margin:0 auto!important}'
  + '.whats-new-scroll{overflow:visible!important}';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) for (const lang of ['es','en','fr','de','pt','pt-BR','it','tr','zh-CN']) {
    await page.goto(`http://127.0.0.1:5198/visual-tests/release-notes-harness.html?theme=${theme}&lang=${lang}`);
    const release = page.getByTestId('whats-new-selected-release');
    await release.waitFor();
    assert.equal(await release.locator('.whats-new-release-version').textContent(), 'v5.5.0');
    assert.deepEqual(await release.locator('li > span:last-child').allTextContents(), expected.map(highlight => highlight[lang]), `${theme}/${lang}: rendered order and every translation`);
    assert.deepEqual(await release.locator('li [data-testid^="whats-new-scope-"]').evaluateAll(items => items.map(item => item.getAttribute('data-testid').replace('whats-new-scope-', ''))), expected.map(highlight => highlight.scope));
    if (lang === 'es') await page.screenshot({ path: `${output}/modal-${theme}.png`, animations: 'disabled' });
    await page.getByTestId('whats-new-version-trigger').click();
    assert.equal(await page.getByTestId('whats-new-version-5.4.5').count(), 1, `${theme}/${lang}: the release just superseded stays in the picker`);
    assert.equal(await page.getByTestId('whats-new-version-5.3.2').count(), 0);
  }
  for (const theme of ['light', 'dark']) {
    await page.goto(`http://127.0.0.1:5198/visual-tests/release-notes-harness.html?theme=${theme}&lang=es`);
    await page.getByTestId('whats-new-selected-release').waitFor();
    await page.addStyleTag({ content: LIFT_SCROLL_CAP });
    await page.screenshot({ path: `${output}/modal-${theme}-full.png`, animations: 'disabled', fullPage: true });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/modal-order-es.md`, `# Novedades de Nodus 5.5.0\n\n${expected.map((highlight,index)=>`${index+1}. ${highlight.es}`).join('\n\n')}\n`);
  console.log('PASS: 2 release notes in exact displayed order, all nine languages in light/dark, v5.5.0 active and unpublished v5.3.2 absent.');
} finally { await browser.close(); }
