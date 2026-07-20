// F1 — PPTX speaker-notes parser, exercised against a real .pptx built in-memory.
// The Electron-free module (electron/toolkit/presenter/pptxNotes.ts) is esbuild-
// bundled (adm-zip external) and driven directly; assertions are on the extracted
// note text — line breaks preserved, entities decoded, numeric-only placeholders
// (the slide-number field) excluded, and slides without a notes part omitted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

// Bundle inside node_modules so the external `adm-zip` require resolves from the repo.
const outDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-presenter-notes-'));
const bundle = path.join(outDir, 'pptxNotes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/presenter/pptxNotes.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    '--external:adm-zip',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { extractPptxNotes } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

/** A notesSlide with a slide-number field (numeric) + a body placeholder note. */
function notesSlide(bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes ${NS}><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="10"/></p:nvPr></p:nvSpPr>
    <p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:txBody>${bodyXml}</p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;
}

/** A notesSlide that has ONLY the numeric slide-number field (no real note). */
function numericOnlyNotesSlide() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes ${NS}><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="10"/></p:nvPr></p:nvSpPr>
    <p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;
}

function slideRels(targetRelative) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="${targetRelative}"/>
</Relationships>`;
}

function buildPptx() {
  const zip = new AdmZip();
  // Three slides.
  for (const n of [1, 2, 3]) {
    zip.addFile(`ppt/slides/slide${n}.xml`, Buffer.from(`<p:sld ${NS}></p:sld>`));
  }
  // Slide 1 → a rich note with a line break, two paragraphs and an entity.
  zip.addFile('ppt/slides/_rels/slide1.xml.rels', Buffer.from(slideRels('../notesSlides/notesSlide1.xml')));
  zip.addFile(
    'ppt/notesSlides/notesSlide1.xml',
    Buffer.from(
      notesSlide(
        '<a:p><a:r><a:t>Primera línea</a:t></a:r><a:br/><a:r><a:t>segunda línea</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>Otro párrafo &amp; más</a:t></a:r></a:p>',
      ),
    ),
  );
  // Slide 2 → notes part exists but only the numeric slide-number field.
  zip.addFile('ppt/slides/_rels/slide2.xml.rels', Buffer.from(slideRels('../notesSlides/notesSlide2.xml')));
  zip.addFile('ppt/notesSlides/notesSlide2.xml', Buffer.from(numericOnlyNotesSlide()));
  // Slide 3 → no rels at all (no notes).
  return zip.toBuffer();
}

test('extractPptxNotes reads notes, preserves breaks/paragraphs and decodes entities', () => {
  const { notes, totalSlides } = extractPptxNotes(buildPptx());
  assert.equal(totalSlides, 3);
  assert.equal(notes['1'], 'Primera línea\nsegunda línea\nOtro párrafo & más');
});

test('extractPptxNotes omits slides whose notes are only the slide-number field', () => {
  const { notes } = extractPptxNotes(buildPptx());
  assert.equal(notes['2'], undefined);
});

test('extractPptxNotes omits slides with no notes part', () => {
  const { notes } = extractPptxNotes(buildPptx());
  assert.equal(notes['3'], undefined);
  assert.deepEqual(Object.keys(notes), ['1']);
});

test('extractPptxNotes resolves an absolute (/ppt/...) notes target too', () => {
  const zip = new AdmZip();
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(`<p:sld ${NS}></p:sld>`));
  zip.addFile(
    'ppt/slides/_rels/slide1.xml.rels',
    Buffer.from(slideRels('/ppt/notesSlides/notesSlide1.xml')),
  );
  zip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from(notesSlide('<a:p><a:r><a:t>Nota absoluta</a:t></a:r></a:p>')));
  const { notes, totalSlides } = extractPptxNotes(zip.toBuffer());
  assert.equal(totalSlides, 1);
  assert.equal(notes['1'], 'Nota absoluta');
});
