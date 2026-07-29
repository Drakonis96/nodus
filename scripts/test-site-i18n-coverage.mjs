import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landing = fs.readFileSync(path.join(repoRoot, 'site/index.html'), 'utf8');
const completionSource = fs.readFileSync(path.join(repoRoot, 'site/i18n-complete.js'), 'utf8');
const faqSource = fs.readFileSync(path.join(repoRoot, 'site/faq.js'), 'utf8');

function loadLandingTranslations() {
  const source = landing.slice(
    landing.indexOf('const LANGS ='),
    landing.indexOf('const _orig =')
  );
  const window = {};
  new Function('window', completionSource)(window);
  return new Function('window', `${source}\nreturn { LANGS, VIG, I18N };`)(window);
}

function loadFaqTranslations() {
  const window = {};
  new Function('window', completionSource)(window);
  const instrumented = faqSource.replace(
    'window.renderFaq = renderFaq;',
    'window.__FAQ = FAQ; window.__FAQ_UI = UI; window.renderFaq = renderFaq;'
  );
  new Function('window', 'document', instrumented)(window, {});
  return { faq: window.__FAQ, ui: window.__FAQ_UI };
}

test('every advertised landing language covers every visible translation key', () => {
  const { LANGS, VIG, I18N } = loadLandingTranslations();
  const keys = new Set(
    [...landing.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1])
  );
  for (const base of VIG) {
    keys.add(`${base}.t`);
    keys.add(`${base}.b`);
  }
  keys.add('v.open');
  keys.add('vaults.teaching.available');

  for (const { c: language } of LANGS) {
    if (language === 'en') continue; // English is the authored HTML.
    const missing = [...keys].filter((key) => I18N[language]?.[key] == null);
    assert.deepEqual(missing, [], `${language} is missing: ${missing.join(', ')}`);
  }
});

test('the tutorial gallery exposes every supplied video through the filtered modal player', () => {
  const cards = [...landing.matchAll(/class="tutorial-card"[^>]*data-category="([^"]+)"[^>]*data-video-id="([^"]+)"/g)]
    .map((match) => ({ category: match[1], videoId: match[2] }));
  assert.equal(cards.length, 8);
  assert.equal(new Set(cards.map((card) => card.videoId)).size, 8);
  assert.deepEqual(
    Object.fromEntries(['vaults', 'features', 'integrations'].map((category) => [
      category,
      cards.filter((card) => card.category === category).length,
    ])),
    { vaults: 4, features: 2, integrations: 2 }
  );
  assert.match(landing, /youtube-nocookie\.com\/embed\//);
  assert.match(landing, /id="tutorial-frame"[\s\S]*?allowfullscreen/);
  assert.match(landing, /frame\.src = ''/);
});

test('header controls keep their contents contained across responsive breakpoints', () => {
  assert.match(landing, /\.nav \.links > \* \{ flex: 0 0 auto; min-width: 0; \}/);
  assert.match(landing, /\.nav \.links > a \{[^}]*white-space: nowrap;/);
  assert.match(landing, /\.release-downloads \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/);
  assert.match(landing, /\.lang-trigger \{[\s\S]*?white-space: nowrap;[\s\S]*?overflow: hidden;/);
  assert.match(landing, /@media \(max-width: 1180px\) \{[\s\S]*?a\.nav-secondary \{ display: none; \}/);
  assert.match(landing, /@media \(max-width: 980px\) \{[\s\S]*?a\.hideS[\s\S]*?display: none;/);
});

test('every advertised language has a complete localized FAQ', () => {
  const { LANGS } = loadLandingTranslations();
  const { faq, ui } = loadFaqTranslations();
  const canonical = faq.en;

  for (const { c: language } of LANGS) {
    assert.ok(ui[language], `${language} is missing localized FAQ controls`);
    assert.equal(
      faq[language]?.length,
      canonical.length,
      `${language} does not translate all ${canonical.length} FAQ entries`
    );
    faq[language].forEach((item, index) => {
      assert.equal(item.id, canonical[index].id, `${language} FAQ ${index} has the wrong id`);
      assert.equal(item.cat, canonical[index].cat, `${language} FAQ ${index} has the wrong category`);
      assert.ok(item.q?.trim(), `${language} FAQ ${index} has no question`);
      assert.ok(item.a?.trim(), `${language} FAQ ${index} has no answer`);
    });
  }
});
