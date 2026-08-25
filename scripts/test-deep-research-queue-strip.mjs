// Render the Deep Research queue strip. Actually render it.
//
// This is the only thing on screen while a report is being written — minutes with
// nothing else to look at — and the bar it now draws is the answer to "is this one
// nearly done, or has it barely started?". A regular expression over the source
// cannot tell a working component from one that throws on its first prop, so the
// component is bundled and rendered through react-dom/server: no browser, no DOM,
// no Electron. If the JSX is wrong, this fails.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-strip-'));

const outfile = path.join(tmp, 'strip.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/deep-research-queue-entry.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});
const { renderStrip } = await import(pathToFileURL(outfile).href);

function item(overrides = {}) {
  return {
    id: 'drq-1',
    title: 'El turismo como mirada colonial',
    status: 'queued',
    progress: null,
    error: null,
    origin: 'app',
    enqueuedAt: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

/** The bar's width, as the browser would compute it from the inline style. */
function barWidth(html) {
  const bar = html.match(/data-testid="deep-research-progress"[\s\S]*?width:\s*([\d.]+)%/);
  return bar ? Number(bar[1]) : null;
}

test('the report being generated carries a progress bar', () => {
  const html = renderStrip([
    item({
      id: 'drq-running',
      status: 'running',
      progress: { phase: 'section', message: 'Redactando: La mirada del viajero', sectionIndex: 3, sectionTotal: 6, pagesSoFar: 7 },
    }),
  ]);
  assert.match(html, /role="progressbar"/, 'the bar is announced as one');
  assert.match(html, /aria-valuenow="\d+"/, 'and reports where it is');
  assert.match(html, /Redactando: La mirada del viajero/, 'the phase is still spelled out');
  assert.match(html, /~7 pág\./, 'along with how much has been written');
  const width = barWidth(html);
  assert.ok(width > 20 && width < 80, `a report halfway through reads as halfway (got ${width}%)`);
});

test('the bar grows as the report advances', () => {
  const widths = [1, 3, 6].map(
    (sectionIndex) =>
      barWidth(renderStrip([item({ status: 'running', progress: { phase: 'section', message: 'Redactando', sectionIndex, sectionTotal: 6 } })]))
  );
  assert.ok(widths[0] < widths[1] && widths[1] < widths[2], `the bar advances with the report (${widths.join(' → ')})`);
});

test('a report that has just started still shows something', () => {
  const html = renderStrip([item({ status: 'running', progress: { phase: 'snapshot', message: 'Reuniendo el corpus…' } })]);
  assert.ok(barWidth(html) >= 3, 'a bar at literal zero would read as broken, not as early');
});

test('a report with no progress yet is not left blank', () => {
  const html = renderStrip([item({ status: 'running', progress: null })]);
  assert.match(html, /Generando/, 'it says it is being generated');
  assert.ok(barWidth(html) !== null, 'and the bar is there, waiting for its first phase');
});

test('reports still waiting say how many are ahead of them', () => {
  const html = renderStrip([
    item({ id: 'a', status: 'running', progress: { phase: 'planning', message: 'Planificando…' } }),
    item({ id: 'b', title: 'Segundo informe' }),
    item({ id: 'c', title: 'Tercer informe' }),
  ]);
  assert.match(html, /1 por delante/, 'the second is behind one');
  assert.match(html, /2 por delante/, 'the third behind two');
  // Only the running one has a bar: a queue of five bars at 3% would say nothing.
  assert.equal(html.match(/data-testid="deep-research-progress"/g).length, 1);
});

test('every active report has a trash action, including the one running', () => {
  const html = renderStrip([
    item({ id: 'running', status: 'running', progress: { phase: 'planning', message: 'Planificando…' } }),
    item({ id: 'waiting', title: 'Segundo informe' }),
  ]);
  assert.equal(html.match(/data-testid="remove-deep-research-/g)?.length, 2);
  assert.equal(html.match(/aria-label="Quitar de la cola"/g)?.length, 2);
});

test('the trash action asks for confirmation before cancelling the durable job', async () => {
  const source = await readFile(path.join(repoRoot, 'src/views/DeepResearchView.tsx'), 'utf8');
  const removal = source.slice(source.indexOf('const removeQueued = async'), source.indexOf('const clearFinished'));
  assert.match(removal, /await confirm\(/);
  assert.match(removal, /danger: true/);
  assert.ok(
    removal.indexOf('if (!approved) return') < removal.indexOf('cancelDeepResearchJob(item.id)'),
    'declining the modal must prevent cancellation'
  );
});

test('a report asked for over MCP is marked as such, and a failure states it failed', () => {
  const html = renderStrip(
    [item({ id: 'mcp-1', origin: 'mcp', status: 'running', progress: { phase: 'assembling', message: 'Ensamblando…' } })],
    [item({ id: 'bad', title: 'Informe fallido', status: 'failed', error: 'El proveedor no respondió.' })]
  );
  assert.match(html, />MCP</);
  assert.match(html, /Informe fallido/);
  assert.match(html, /El proveedor no respondió\./, 'the reason is readable, not just the word "failed"');
});

test.after(() => rm(tmp, { recursive: true, force: true }));
