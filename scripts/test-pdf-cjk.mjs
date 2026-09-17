import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The PDF exporters used to draw every label with pdf-lib's WinAnsi StandardFonts, which
// cannot encode a Han character at all: Chinese text was stripped to nothing (or threw).
// These tests pin the fix — a bundled Noto Sans SC subset that is re-subset per document
// with HarfBuzz — so a future "simplification" back to StandardFonts fails here.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_PATH = path.join(repoRoot, 'server', 'lib', 'assets', 'fonts', 'NodusCJK-Regular.ttf');
const SAMPLE = '研究报告：中文摘要与结论 2026 · 引号「测试」——省略…（全角）';

test('the bundled CJK font ships with its license', async () => {
  assert.ok(fs.existsSync(FONT_PATH), 'the CJK font must be committed for both exporters');
  const license = fs.readFileSync(path.join(path.dirname(FONT_PATH), 'OFL.txt'), 'utf8');
  assert.match(license, /SIL Open Font License/);
  const notices = fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /Noto Sans SC/, 'the font must be attributed in THIRD_PARTY_NOTICES.md');
});

test('the shipped font covers Han characters, CJK punctuation and kana', async () => {
  const { cjkFontBytes, hasCjk, subsetCjkFont } = await import('../server/lib/core/pdfText.mjs');
  assert.ok(cjkFontBytes().length > 1_000_000, 'expected the full BMP CJK subset, not a stub');
  for (const value of ['研究报告', '「测试」', '、。：', 'かな', 'カナ', '汉字']) {
    assert.ok(hasCjk(value), `${value} must be detected as CJK`);
  }
  assert.equal(hasCjk('Research report 2026'), false, 'Latin copy must keep the StandardFonts path');
  // Coverage is a property of the font, not of the WinAnsi-safe detector: Chinese text also
  // uses em dashes and ellipses that WinAnsi can encode, but the Latin font has no Han glyph.
  const fontkitModule = await import('@pdf-lib/fontkit');
  const fontkit = fontkitModule.default ?? fontkitModule;
  const font = fontkit.create(cjkFontBytes());
  for (const character of '研究报告「测试」——…、。：かなカナ％') {
    assert.ok(font.hasGlyphForCodePoint(character.codePointAt(0)), `the font is missing ${character}`);
  }
  const subset = await subsetCjkFont(SAMPLE);
  assert.ok(subset.length > 0 && subset.length < cjkFontBytes().length, 'the per-document subset must be smaller');
});

test('the server report exporter renders Chinese instead of stripping it', async () => {
  const { deepResearchPdfBytes } = await import('../server/lib/core/deepResearchPdf.mjs');
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const bytes = await deepResearchPdfBytes(
    {
      title: '有争议的记忆：档案中的潮汐历法',
      abstract: '本报告梳理了传播路径，并标出证据薄弱之处。',
      draftMarkdown: '# 主要发现\n\n档案显示，月相记号与潮汐表并非同一体系。\n\n- 潮汐表共出现 42 处。\n\n结论：证据不足以支持两者相互依赖。',
      nextSteps: ['补查港口税收记录'],
      limitations: ['部分档案尚未数字化'],
    },
    { language: 'zh-CN' }
  );
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(bytes.subarray(-32).toString('ascii'), /%%EOF/);
  // The Chinese run must embed the composite (Type0) CJK font; the StandardFonts path
  // would have dropped every Han character instead.
  const doc = await PDFDocument.load(bytes);
  const embedded = new Set();
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'));
    for (const key of fonts?.keys?.() ?? []) {
      const base = fonts.lookup(key)?.get?.(PDFName.of('BaseFont'));
      if (base) embedded.add(String(base));
    }
  }
  assert.ok([...embedded].some((name) => name.includes('NotoSansSC')), `no CJK font embedded: ${[...embedded]}`);
  assert.ok(bytes.length < 2_000_000, `the subset must keep the PDF small, got ${bytes.length}`);
});

test('the server report exporter still emits the StandardFonts path for Latin copy', async () => {
  const { deepResearchPdfBytes } = await import('../server/lib/core/deepResearchPdf.mjs');
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const bytes = await deepResearchPdfBytes({ title: 'Private trial', draftMarkdown: '# Finding\n\nSafe content.' });
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  const embedded = new Set();
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'));
    for (const key of fonts?.keys?.() ?? []) {
      const base = fonts.lookup(key)?.get?.(PDFName.of('BaseFont'));
      if (base) embedded.add(String(base));
    }
  }
  assert.ok(![...embedded].some((name) => name.includes('NotoSansSC')), 'a Latin report must not carry the CJK font');
});

test('the desktop helper resolves the same bundled font outside Electron', async () => {
  // The helper is TypeScript in the Electron tree, so bundle it the way the other
  // main-process tests do before requiring it.
  // Bundle inside node_modules so the bundle's own `require('subset-font')` resolves;
  // a temp-directory bundle would look for node_modules next to itself and fail.
  const cacheRoot = path.join(repoRoot, 'node_modules', '.cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(cacheRoot, 'nodus-pdf-cjk-'));
  const outfile = path.join(outDir, 'pdfText.cjs');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, 'electron/export/pdfText.ts'), '--bundle', '--platform=node', '--format=cjs', '--outfile=' + outfile, '--external:electron', '--external:subset-font'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  const { cjkFontBytes, hasCjk, cjkSafe, subsetCjkFont } = createRequire(import.meta.url)(outfile);
  assert.ok(cjkFontBytes().length > 1_000_000);
  assert.ok(hasCjk('中文'));
  assert.equal(hasCjk('plain'), false);
  // The CJK path keeps punctuation the WinAnsi path has to fold down.
  assert.equal(cjkSafe('  「引号」——省略…  '), '「引号」——省略…');
  const subset = await subsetCjkFont('研究报告');
  assert.ok(subset.length > 0 && subset.length < cjkFontBytes().length);
});
