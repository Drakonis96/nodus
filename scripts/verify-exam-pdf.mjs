// PDF export check for the exam paper builder.
//
// Runs as a REAL Electron app (not ELECTRON_RUN_AS_NODE) because the PDF is produced by
// Chromium's printToPDF on an offscreen BrowserWindow — the one path the headless unit
// tests cannot cover. Builds a sample exam in memory, so it needs no vault or database.
//
//   node scripts/verify-exam-pdf.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-exam-pdf')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-exam-pdf.mjs'), '--electron-exam-pdf'],
    // No ELECTRON_RUN_AS_NODE: we need a real browser process for printToPDF.
    { cwd: repoRoot, env: { ...process.env }, stdio: 'inherit' }
  );
  process.exit(0);
}

// Resolve @shared/* and transpile TS on require, but keep the REAL electron module.
{
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}

const { app } = require('electron');
const { examPdfBytes } = require(path.join(repoRoot, 'electron/export/examExport.ts'));
const { rubricPdfBytes } = require(path.join(repoRoot, 'electron/export/rubricExport.ts'));
const rubricModel = require(path.join(repoRoot, 'shared/teachingRubrics.ts'));
const model = require(path.join(repoRoot, 'shared/teachingExams.ts'));
const { renderExamHtml } = require(path.join(repoRoot, 'shared/examHtml.ts'));
const { markdownToPdf } = require(path.join(repoRoot, 'electron/export/markdownRender.ts'));
const { renderPdfOps } = require(path.join(repoRoot, 'electron/toolkit/convert/renderPdf.ts'));

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const q = (over) => ({
  id: 'q', shortId: 's', examId: 'E', points: 1, options: [], pairs: [], items: [],
  imageDataUrl: null, imageCaption: '', answerLines: null, solution: 'Modelo',
  aiPrompt: '', generatedBy: 'manual', createdAt: '', updatedAt: '', ...over,
});

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (error) { failures += 1; console.error(`  ✗ ${name}: ${error.message}`); }
};

app.whenReady().then(async () => {
  try {
    for (const language of ['es', 'en']) {
      const exam = {
        id: 'E', shortId: 'EXM-PDF', title: 'Examen de prueba', subjectId: 'S', courseId: null,
        language, targetQuestionCount: 6, createdAt: '', updatedAt: '',
        logos: [{ dataUrl: PNG_1X1, name: 'logo.png' }],
        header: model.defaultExamHeader({
          institution: 'IES Nodus', teachers: 'A. Docente', examTitle: 'Prueba de evaluación',
          durationMinutes: 60, instructions: 'Lee cada pregunta con atención.',
        }),
      };
      const questions = [
        q({ id: 'q1', position: 0, type: 'long_essay', prompt: 'Desarrolla el tema propuesto.' }),
        q({ id: 'q2', position: 1, type: 'multiple_choice', prompt: 'Elige la opción correcta', options: [{ id: 'O1', text: 'Primera', correct: true }, { id: 'O2', text: 'Segunda', correct: false }, { id: 'O3', text: 'Tercera', correct: false }] }),
        q({ id: 'q3', position: 2, type: 'true_false', prompt: 'Una afirmación evaluable', options: [{ id: 'O1', text: 'Verdadero', correct: true }, { id: 'O2', text: 'Falso', correct: false }] }),
        q({ id: 'q4', position: 3, type: 'matching', prompt: 'Relaciona ambas columnas', pairs: [{ id: 'P1', left: 'Uno', right: 'Alpha' }, { id: 'P2', left: 'Dos', right: 'Beta' }] }),
        q({ id: 'q5', position: 4, type: 'image_comment', prompt: 'Comenta la imagen', imageDataUrl: PNG_1X1, imageCaption: 'Lámina 1' }),
        // A section statement with two sub-questions, followed by a standalone question:
        // proves the nesting prints AND that a top-level question can still come after.
        q({ id: 'sec', position: 5, type: 'section', points: 0, prompt: 'Lee el siguiente fragmento y responde a las cuestiones planteadas.', imageDataUrl: PNG_1X1, imageCaption: 'Fuente 1' }),
        q({ id: 'sub1', position: 6, parentId: 'sec', type: 'short_answer', points: 1, prompt: 'Indica el tema del fragmento.', solution: 'El tema es X.' }),
        q({ id: 'sub2', position: 7, parentId: 'sec', type: 'medium_essay', points: 2, prompt: 'Comenta su contexto histórico.', solution: 'Debe situarlo en X.' }),
        q({ id: 'q6', position: 8, type: 'definition', points: 1, prompt: 'Define el concepto clave.' }),
      ];

      // All three download variants must print, and the key-only one must be shorter
      // than the full paper (no questions, no answer lines).
      const variants = {};
      for (const content of ['exam', 'examWithKey', 'keyOnly']) {
        variants[content] = await examPdfBytes(exam, questions, { content });
        check(`[${language}] ${content} produces a real PDF`, () => {
          assert.equal(variants[content].subarray(0, 5).toString('latin1'), '%PDF-');
          assert.ok(variants[content].length > 3000, `too small: ${variants[content].length}`);
        });
      }
      const pages = (buffer) => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(`[${language}] keyOnly is a single short document`, () => {
        assert.ok(pages(variants.keyOnly) < pages(variants.examWithKey), `key ${pages(variants.keyOnly)} vs both ${pages(variants.examWithKey)}`);
      });
      check(`[${language}] examWithKey is longer than the bare paper`, () => {
        assert.ok(pages(variants.examWithKey) >= pages(variants.exam), 'the key must add pages, not drop them');
      });
      const bytes = variants.examWithKey;
      // The answer key forces a page break, so a full paper is never a single page.
      const pageCount = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(`[${language}] paginates (answer key on its own page)`, () => {
        assert.ok(pageCount >= 2, `expected 2+ pages, got ${pageCount}`);
      });
      // The nested exercise must number as 6 / 6.1 / 6.2 with the standalone one at 7,
      // in the paper and in the key, and its mark must be the sum of its parts.
      const html = renderExamHtml(exam, questions, { content: 'examWithKey' });
      check(`[${language}] the section prints as one numbered exercise`, () => {
        assert.match(html, /class="exercise"/);
        assert.match(html, />6\.1\)</);
        assert.match(html, />6\.2\)</);
        assert.match(html, />7\.</, 'a standalone question still follows the section');
        assert.ok(!/Pregunta 6</.test(html), 'the statement itself is never answered in the key');
        assert.match(html, model.examDocumentLabels(language).points === 'points' ? /3 points/ : /3 puntos/);
      });
      const out = path.join(os.tmpdir(), `nodus-exam-verify-${language}.pdf`);
      fs.writeFileSync(out, bytes);
      console.log(`    → ${out} (${Math.round(bytes.length / 1024)} KB, ${pageCount} pages)`);
    }
    // Rubrics print landscape and go through the same repeated-export path.
    for (const language of ['es', 'en']) {
      const base = rubricModel.defaultRubric(language, 10);
      const rubric = {
        id: 'R', shortId: 'RUB-PDF', title: 'Rúbrica de prueba', description: 'Evalúa la presentación oral',
        subjectId: 'S', courseId: null, createdAt: '', updatedAt: '', ...base, weighted: true,
      };
      rubric.criteria = rubric.criteria.map((criterion, index) => ({
        ...criterion, name: `Criterio ${index + 1}`, weight: index === 0 ? 34 : 33,
        cells: Object.fromEntries(rubric.levels.map((level, i) => [level.id, `Descriptor ${index + 1}.${i + 1} con detalle suficiente para ocupar la celda.`])),
      }));
      const bytes = await rubricPdfBytes(rubric, { includeScores: true, includeScoreColumn: true });
      check(`[${language}] rubric produces a real landscape PDF`, () => {
        assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
        assert.ok(bytes.length > 3000, `too small: ${bytes.length}`);
      });
      const out = path.join(os.tmpdir(), `nodus-rubric-verify-${language}.pdf`);
      fs.writeFileSync(out, bytes);
      console.log(`    → ${out} (${Math.round(bytes.length / 1024)} KB)`);
    }
    // THE regression this guards: destroying the print window synchronously used to
    // work the first time and fail the SECOND with ERR_FAILED (-2), then SIGTRAP. Every
    // styled-document exporter now shares the deferred teardown, so each of these must
    // survive being called twice in the same session — the normal case for the toolkit,
    // where a user converts several files in a row.
    // The toolkit converter reads its source off disk, so give it a real file.
    const markdownFixture = path.join(os.tmpdir(), 'nodus-verify-fixture.md');
    fs.writeFileSync(markdownFixture, '# Informe\n\nTexto con **negrita** y una lista:\n\n- uno\n- dos\n');
    for (const [label, run] of [
      ['markdown → PDF', () => markdownToPdf('# Título\n\nUn párrafo con una [cita](nodus://idea/1).', 'Doc')],
      ['toolkit text → PDF', async () => (await renderPdfOps['text-to-pdf'].run([markdownFixture]))[0].data],
    ]) {
      const first = await run();
      const second = await run();
      check(`${label} survives a second export in the same session`, () => {
        for (const [index, bytes] of [first, second].entries()) {
          assert.equal(Buffer.from(bytes).subarray(0, 5).toString('latin1'), '%PDF-', `export #${index + 1} is not a PDF`);
          assert.ok(bytes.length > 800, `export #${index + 1} too small: ${bytes.length}`);
        }
      });
    }
  } catch (error) {
    failures += 1;
    console.error('  ✗ export threw:', error);
  }
  console.log(`\n${failures === 0 ? 'PDF EXPORT OK' : `${failures} CHECK(S) FAILED`}\n`);
  app.exit(failures === 0 ? 0 : 1);
});
