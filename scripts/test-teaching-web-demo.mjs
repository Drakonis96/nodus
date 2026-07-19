import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('the Teaching web demo is reachable from every live vault demo', () => {
  const teachingHtml = read('docs/demo/teaching.html');
  assert.match(teachingHtml, /class="vault-opt active" href="teaching\.html"/);
  assert.match(teachingHtml, /src="teaching-data\.js/);
  assert.match(teachingHtml, /src="teaching-app\.js/);
  assert.match(teachingHtml, /student-name pseudonymisation/);

  for (const page of ['index.html', 'study.html', 'genealogy.html', 'databases.html']) {
    const html = read(`docs/demo/${page}`);
    assert.match(html, /href="teaching\.html"[^>]*>[\s\S]*?<b>Teaching<\/b>/, `${page} links to Teaching`);
    assert.doesNotMatch(html, /Shell in the app · preview/, `${page} no longer labels Teaching as a preview`);
  }
});

test('the browser fixture preserves the important facts from the real app fixture', () => {
  const realFixture = read('electron/db/teachingDemoData.ts');
  const webFixture = read('docs/demo/teaching-data.js');
  const webApp = read('docs/demo/teaching-app.js');

  for (const marker of ['Lucía', 'Historical source commentary', 'Written test · unit 3']) {
    assert.ok(realFixture.includes(marker), `real fixture contains ${marker}`);
    assert.ok(webFixture.includes(marker), `web fixture contains ${marker}`);
  }
  assert.match(webFixture, /STU_BSQV/);
  for (const weight of ['weight: 30', 'weight: 25', 'weight: 15']) assert.ok(webFixture.includes(weight));
  for (const status of ['not_submitted', 'not_assessed', 'exempt']) assert.ok(webFixture.includes(status));
  for (const surface of ['groups', 'rubrics', 'exams', 'grades', 'planned']) {
    assert.match(webApp, new RegExp(`${surface}:`), `web demo implements the ${surface} route`);
  }
  assert.match(webApp, /feedback previews, not finished tools/);
  assert.doesNotThrow(() => new Function(webFixture));
  assert.doesNotThrow(() => new Function(webApp));
});

test('landing copy describes the current Teaching scope and names Nodus directly', () => {
  const landing = read('docs/index.html');
  assert.match(landing, /href="demo\/teaching\.html"[^>]*data-i18n="vaults\.teaching\.cta"/);
  assert.match(landing, /Tú traes los datos, Nodus hace los números/);
  assert.doesNotMatch(landing, /Tú traes los datos, él hace los números/);
  assert.doesNotMatch(landing, /You bring the data, it runs the numbers/);
  assert.doesNotMatch(landing, /Teaching guide · linked/);
  assert.doesNotMatch(landing, /Open the four live demos/);
  assert.match(landing, /From the assessment plan to every final grade/);
});

test('the FAQ documents Teaching availability in every maintained FAQ translation', () => {
  let source = read('docs/faq.js');
  source = source.replace('window.renderFaq = renderFaq;', 'window.__FAQ = FAQ; window.__COMPACT = COMPACT; window.renderFaq = renderFaq;');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'docs/faq.js' });

  const faq = context.window.__FAQ;
  for (const lang of ['en', 'es', 'fr', 'it', 'de', 'pt', 'tr', 'zh']) {
    assert.equal(faq[lang].length, 20, `${lang} keeps the canonical 20-question FAQ`);
    assert.equal(faq[lang].at(-1).id, 'teaching-mode', `${lang} includes the Teaching question`);
    assert.equal(faq[lang].at(-1).cat, 'features');
  }
  assert.match(faq.en.at(-1).a, /feedback previews in design/);
  assert.match(faq.es.at(-1).a, /vistas previas de feedback en diseño/);
});
