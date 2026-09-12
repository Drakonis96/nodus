import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Uses the real creation dialogs/readers and the same theme initializer as App.
// Start visual-tests/vite.config.ts on port 5197; generate fixtures with
// scripts/verify-document-skills.mjs first.
const base = 'http://127.0.0.1:5197/visual-tests/document-skills-harness.html';
const out = path.resolve('artifacts/document-skills');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

async function theme(mode) {
  await page.evaluate(mode => window.testApplyTheme(mode), mode);
  await page.waitForTimeout(150);
  const resolved = mode === 'system' ? 'dark' : mode;
  assert.equal(await page.locator('html').evaluate(el => el.classList.contains('light')), resolved === 'light');
  assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), resolved === 'dark');
}

async function contrast(locator, label) {
  assert.ok(await locator.count(), `${label}: elements exist`);
  const results = await locator.evaluateAll(elements => {
    const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
    const over = (front, back) => {
      const a = front[3] ?? 1;
      return front.slice(0, 3).map((channel, i) => channel * a + back[i] * (1 - a));
    };
    const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return elements.filter(el => el.getBoundingClientRect().height && !el.disabled).map(el => {
      const parents = []; for (let node = el; node; node = node.parentElement) parents.unshift(node);
      const background = parents.reduce((bg, node) => over(rgba(getComputedStyle(node).backgroundColor), bg), [255, 255, 255]);
      const foreground = over(rgba(getComputedStyle(el).color), background);
      const a = luminance(foreground), b = luminance(background);
      return { text: el.textContent?.trim().slice(0, 60) || el.tagName, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  assert.ok(results.length, `${label}: visible elements exist`);
  for (const result of results) assert.ok(result.ratio >= 4.5, `${label}: ${result.text} contrast ${result.ratio.toFixed(2)} < 4.5`);
}

async function shot(name) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, name + '.png') });
}

try {
  for (const section of ['deep', 'immersion']) {
    await page.goto(base + '?section=' + section + '&theme=light');
    await page.waitForFunction(() => window.testApplyTheme);
    for (const mode of ['light', 'dark']) {
      await theme(mode);
      await contrast(page.locator('h1').first(), `${section} gallery ${mode}`);
      await shot(`${section}-gallery-${mode}`);
    }
    await page.getByRole('button', { name: section === 'deep' ? 'Nuevo informe' : 'Nueva inmersión', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator(section === 'deep' ? 'textarea' : 'input').first().fill('La forma y su representación');
    const svg = dialog.locator('.document-skill-row').filter({ has: page.getByText('SVG Studio', { exact: true }) });
    await svg.locator('select').selectOption('number');
    await svg.locator('input').fill('4');
    const paid = dialog.locator('.document-skill-row').filter({ has: page.getByText('Image Atelier', { exact: true }) });
    await paid.getByRole('switch').click();
    for (const mode of ['light', 'dark']) {
      await theme(mode);
      await paid.locator('input').fill('');
      await page.waitForFunction(() => document.querySelector('[role=dialog] footer button:last-child').disabled);
      await contrast(dialog.locator('.document-skill-error'), `${section} error ${mode}`);
      assert.equal(await dialog.locator('footer button').last().isDisabled(), true);
      await paid.locator('input').fill('2');
      await contrast(dialog.locator('h2, .document-skills h3, .document-skill-title b, .document-skills p, .document-skills-search input, .document-skill-limit input, .document-skill-limit select'), `${section} modal ${mode}`);
      await contrast(dialog.locator(section === 'deep' ? 'textarea' : 'input').first(), `${section} topic ${mode}`);
      await page.getByTestId('document-skills').scrollIntoViewIfNeeded();
      await shot(`${section}-modal-${mode}`);
      // Exercise a narrow window with the same content and active theme.
      await page.setViewportSize({ width: 760, height: 850 });
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await page.getByTestId('document-skills').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.setViewportSize({ width: 1440, height: 1080 });
    }
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: section === 'deep' ? 'Leer' : 'Empezar', exact: true }).first().click();
    if (section === 'immersion') await page.getByRole('button', { name: 'Comenzar inmersión', exact: true }).click();
    await page.waitForSelector('.document-figure');
    for (const mode of ['light', 'dark']) {
      await theme(mode);
      await contrast(page.locator('.document-figure > figcaption'), `${section} captions ${mode}`);
      await contrast(page.getByTestId(section === 'deep' ? 'deep-research-reader-document' : 'immersion-reader-document').locator('h1, h2, .md > p'), `${section} reader ${mode}`);
      await shot(`${section}-report-${mode}`);
    }
    if (section === 'immersion') {
      await page.getByRole('button', { name: /Una forma, varias perspectivas/ }).last().click();
      await page.locator('.document-figure-preview').click();
      await page.getByRole('button', { name: /Abrir el modelo 3D/ }).click();
      await page.waitForSelector('.capability-view-model[data-state="ready"]');
      await page.locator('.capability-view-model').scrollIntoViewIfNeeded();
      for (const mode of ['light', 'dark']) {
        await theme(mode);
        await contrast(page.locator('.document-figure-detail, .document-figure-actions'), `interactive ${mode}`);
        const rgb = await page.locator('.document-figure-detail').evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(rgb, mode === 'dark' ? 'rgb(20, 23, 34)' : 'rgb(255, 255, 255)');
        await shot(`immersion-interactive-3d-${mode}`);
      }
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await theme('system');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => window.testApplyTheme('system'));
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('light') && !el.classList.contains('dark')), true);
  }
  assert.deepEqual(errors, []);
  console.log('Both document dialogs, galleries, readers and interactive figures pass light/dark theme, contrast and switching checks.');
} catch (error) {
  await shot('theme-debug');
  throw error;
} finally {
  await browser.close();
}
