// Markdown + LaTeX rendering for questions and flashcards: delimiter normalization,
// the safe printable-exam renderer and the exam HTML output. Pure modules, so the
// test bundles them with esbuild instead of booting Electron.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-markdown-'));

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`, '--log-level=error'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const { normalizeLatexDelimiters } = loadModule('shared/latexDelimiters.ts');
const { renderTeachingMarkdown } = loadModule('shared/teachingMarkdown.ts');
const { renderExamHtml } = loadModule('shared/examHtml.ts');
const { defaultExamHeader, defaultExamQuestion } = loadModule('shared/teachingExams.ts');
const { remarkHardBreaks } = loadModule('src/markdownHardBreaks.ts');

test.after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

test('normalizes \\(…\\) and \\[…\\] to remark-math delimiters', () => {
  assert.equal(normalizeLatexDelimiters('Fórmula: \\(C_nH_{2n}O_2\\) fin'), 'Fórmula: $C_nH_{2n}O_2$ fin');
  assert.equal(
    normalizeLatexDelimiters('Antes\n\\[\\frac{a}{b} = c\\]\nDespués'),
    'Antes\n$$\\frac{a}{b} = c$$\nDespués'
  );
  // Already-normalized content is untouched.
  assert.equal(normalizeLatexDelimiters('$x^2$ y $$y^2$$'), '$x^2$ y $$y^2$$');
  // Escaped delimiters are literal text, not math.
  assert.equal(normalizeLatexDelimiters('literal \\\\(x\\\\)'), 'literal \\\\(x\\\\)');
});

test('never rewrites delimiters inside code', () => {
  const fenced = 'Ejemplo:\n```tex\n\\(x+y\\)\n```\nfuera \\(z\\)';
  assert.equal(normalizeLatexDelimiters(fenced), 'Ejemplo:\n```tex\n\\(x+y\\)\n```\nfuera $z$');
  assert.equal(normalizeLatexDelimiters('código `\\(a\\)` y \\(b\\)'), 'código `\\(a\\)` y $b$');
});

test('remarkHardBreaks keeps the line breaks existing plain-text answers relied on', () => {
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Primera línea\nSegunda línea' }] }] };
  remarkHardBreaks()(tree);
  assert.deepEqual(tree.children[0].children, [
    { type: 'text', value: 'Primera línea' },
    { type: 'break' },
    { type: 'text', value: 'Segunda línea' },
  ]);
  // Inline math keeps its literal value.
  const math = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'inlineMath', value: 'x\n=1' }] }] };
  remarkHardBreaks()(math);
  assert.deepEqual(math.children[0].children, [{ type: 'inlineMath', value: 'x\n=1' }]);
});

test('renderTeachingMarkdown typesets inline and display chemistry', () => {
  const inline = renderTeachingMarkdown('La fórmula es $C_nH_{2n}O_2 \\quad (n \\geq 2)$ según el texto.');
  assert.match(inline, /class="katex"/);
  assert.match(inline, /<math/);
  assert.match(inline, /application\/x-tex">C_nH_\{2n\}O_2/);
  assert.doesNotMatch(inline, /\$C_nH/);

  const display = renderTeachingMarkdown('Antes\n\n$$\\frac{H_2 + O_2}{2}$$\n\nDespués');
  assert.match(display, /display="block"/);
  assert.match(display, /<p>Antes<\/p>/);
  assert.match(display, /<p>Después<\/p>/);

  // The LaTeX-style delimiters take the same path.
  const latexStyle = renderTeachingMarkdown('Sea \\(x \\geq 2\\).');
  assert.match(latexStyle, /class="katex"/);
  assert.doesNotMatch(latexStyle, /\\\(/);
});

test('renderTeachingMarkdown covers bold, italic, lists, tables and code', () => {
  const html = renderTeachingMarkdown([
    '# Enunciado',
    '',
    'Texto con **negrita**, *cursiva* y `código`.',
    '',
    '- uno',
    '- dos',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1 < 2;',
    '```',
    '',
    '> Cita',
  ].join('\n'));
  assert.match(html, /<h1>Enunciado<\/h1>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<em>cursiva<\/em>/);
  assert.match(html, /<code>código<\/code>/);
  assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre><code>const x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>Cita<\/p><\/blockquote>/);
});

test('renderTeachingMarkdown escapes markup and refuses unsafe links', () => {
  const html = renderTeachingMarkdown('Explain <b>this</b> & that [click](javascript:alert(1))');
  assert.match(html, /Explain &lt;b&gt;this&lt;\/b&gt; &amp; that/);
  assert.doesNotMatch(html, /<b>this<\/b>/);
  assert.doesNotMatch(html, /href="javascript:/, 'unsafe schemes never reach an attribute');
  assert.match(html, /\[click\]\(javascript:alert\(1\)\)/, 'the unsafe link stays literal text');
  const safe = renderTeachingMarkdown('[fuente](https://example.com/a?x=1&y=2)');
  assert.match(safe, /<a href="https:\/\/example.com\/a\?x=1&amp;y=2" target="_blank" rel="noreferrer">fuente<\/a>/);
});

test('renderTeachingMarkdown inline mode returns a fragment without block wrappers', () => {
  const html = renderTeachingMarkdown('**correcta** con $x^2$', { inline: true });
  assert.doesNotMatch(html, /<p>/);
  assert.match(html, /<strong>correcta<\/strong>/);
  assert.match(html, /class="katex"/);
});

test('renderExamHtml typesets question, option and answer-key math', () => {
  const exam = {
    id: 'E', shortId: 'EXM-1', title: 'Química', subjectId: 'S', courseId: null, language: 'es',
    targetQuestionCount: 2, createdAt: '', updatedAt: '', logos: [],
    header: { ...defaultExamHeader({}), examTitle: 'Química', showPoints: true },
  };
  const base = { ...defaultExamQuestion('short_essay'), examId: 'E', shortId: 's' };
  const questions = [
    { ...base, id: 'q1', position: 0, type: 'short_essay', solution: 'Es un **alcano** $C_nH_{2n+2}$.', prompt: 'Explica la fórmula $C_nH_{2n}O_2 \\quad (n \\geq 2)$.' },
    { ...base, id: 'q2', position: 1, type: 'multiple_choice', prompt: '¿Cuál es correcta?', options: [{ id: 'O1', text: '**Etanol**: $C_2H_6O$', correct: true }, { id: 'O2', text: 'Metano', correct: false }] },
  ];
  const html = renderExamHtml(exam, questions, { content: 'examWithKey' });
  assert.match(html, /class="katex"/, 'the prompt math is typeset');
  assert.match(html, /<math/, 'MathML reaches the printed document');
  assert.match(html, /<strong>alcano<\/strong>/, 'the answer key keeps inline formatting');
  assert.match(html, /<strong>Etanol<\/strong>/, 'options keep inline formatting');
  assert.match(html, /application\/x-tex">C_nH_\{2n\}O_2/);
  // XSS posture is unchanged: markup in a prompt is escaped text.
  const xss = renderExamHtml(exam, [{ ...base, id: 'q3', position: 0, type: 'short_essay', prompt: '<img src=x onerror=alert(1)>' }]);
  assert.doesNotMatch(xss, /<img src=x/);
  assert.match(xss, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('every question and flashcard surface stays wired to the Markdown pipeline', async () => {
  const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
  const [bank, review, generator, immersion, exam, questions, scene, readers, vaults, examHtml, nativeAuthoring] = await Promise.all([
    read('src/views/StudyBankView.tsx'),
    read('src/views/StudyReviewView.tsx'),
    read('src/components/StudyTestGenerator.tsx'),
    read('src/views/ImmersionView.tsx'),
    read('src/views/ExamBuilderView.tsx'),
    read('src/views/QuestionsView.tsx'),
    read('src/components/world/SceneQuestionBand.tsx'),
    read('src/serverWeb/readers.tsx'),
    read('src/serverWeb/vaults/index.tsx'),
    read('shared/examHtml.ts'),
    read('src/serverWeb/vaults/NativeContentAuthoring.tsx'),
  ]);
  // Desktop display surfaces.
  for (const [name, source] of Object.entries({ bank, review, generator, immersion, questions, scene })) {
    assert.ok(source.includes('StudyMarkdown'), `${name} renders question content as Markdown`);
  }
  // Authoring: preview toggles for questions and flashcards.
  assert.ok(bank.includes('MarkdownField'), 'the question editor previews Markdown and LaTeX');
  assert.ok(questions.includes('MarkdownField'), 'open-question editing previews Markdown and LaTeX');
  assert.ok(exam.includes('MarkdownField'), 'the exam builder previews Markdown and LaTeX');
  assert.ok(nativeAuthoring.includes('MarkdownReader'), 'server-native authoring previews Markdown and LaTeX');
  // Server Web rendering.
  assert.ok(readers.includes('remarkMath') && readers.includes('rehypeKatex'), 'the server reader typesets LaTeX');
  assert.ok(readers.includes('katex/dist/katex.min.css'), 'the server reader ships KaTeX styles');
  assert.ok(vaults.includes('MarkdownReader'), 'published questions and flashcards render through the reader');
  // Prints and PDFs come from the same content pipeline.
  assert.ok(examHtml.includes('renderTeachingMarkdown'), 'the printable exam typesets Markdown and LaTeX');
  // The AI generator asks for LaTeX formulas in every prompt language.
  const ai = await read('electron/ai/studyQuestions.ts');
  assert.equal((ai.match(/LaTeX/g) ?? []).length, 15, 'all prompt languages request LaTeX formulas');
});
