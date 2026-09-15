// What the app does with a proposal it will not use.
//
// Enabling a skill is permission, never obligation, so a document may end with no
// figures because that is what its prose needed. It may also end with none because every
// proposal was refused — a source that is not in the block it cites, a heading, a skill
// that is not enabled, a block that already has a figure, a proposal the global selection
// left out. Both outcomes used to reach the reader as the same sentence, and neither left
// a trace. These assertions keep the two apart: the planner is handed the links it may
// cite, every refusal names its motive, and the motive is recorded where the reader and
// whoever reads the log can both find it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the planner is handed the links each block may cite', () => {
  const source = read('electron/ai/documentVisuals.ts');
  assert.match(source, /blocks: blocks\.map\(block => \(\{ \.\.\.block, sources: blockSources\(block\) \}\)\)/,
    'the payload must carry the exact links per block');
  assert.match(source, /Each block lists in sources the exact nodus:\/\/ links it may cite/,
    'and the prompt must say they are a list to choose from, not a guess');
  const shared = read('shared/documentSkills.ts');
  assert.match(shared, /export function blockSources\(block: DocumentBlock\): string\[\]/,
    'one definition of that list, shared with the filter');
  assert.equal(/matchAll\(\/\\\]\\\(\(nodus/.test(source), false, 'the filter may not keep a second copy of the pattern');
});

test('every refusal is named, and none is an anonymous continue', () => {
  const source = read('electron/ai/documentVisuals.ts');
  for (const reason of ['unknown-block', 'heading-block', 'skill-not-enabled', 'ceiling-reached', 'source-not-in-block', 'block-already-has-figure']) {
    assert.ok(source.includes(`refuse(item, '${reason}')`), `the ${reason} refusal must be named`);
  }
  assert.match(source, /reason: 'not-selected'/, 'and so must the proposal the global selection left out');
  // The old shape: one anonymous guard chain that returned nothing about why.
  assert.equal(/if \(!block \|\| \/\^\\s\*#\{1,6\}/.test(source), false, 'the filters may not collapse back into one silent condition');
});

test('refusals reach the log with their motive and their count', () => {
  const source = read('electron/ai/documentVisuals.ts');
  assert.match(source, /code: 'figure_skipped'/);
  assert.match(source, /message: pipelineLogText\('figuresDiscarded', \{ count, reason: \{ id: DOCUMENT_VISUAL_DISCARD_REASONS\[reason\] \} \}\)/,
    'the line must interpolate the catalogue id, so the log renders in its reader’s language');
  assert.match(source, /const record = figures > 0 \? logPipelineInfo : logPipelineWarning/,
    'a run that kept no figure is a warning; one that kept some is quiet');
  const codes = read('electron/logging/pipelineLogCore.ts');
  assert.match(codes, /figure_skipped: \{ category: 'extraction', level: 'warning' \}/, 'the code must exist and be filterable');
  const catalogue = read('shared/pipelineLogMessages.ts');
  assert.match(catalogue, /figuresDiscarded: 'Recursos visuales descartados: \{count\} — \{reason\}',/);
});

test('the refusals travel with the manifest and survive its validation', () => {
  const store = read('electron/capabilities/documentStore.ts');
  assert.match(store, /value\.discarded !== undefined && \(!Array\.isArray\(value\.discarded\) \|\| value\.discarded\.some\(item => !item \|\| typeof item\.blockId !== 'string' \|\| typeof item\.skillId !== 'string' \|\| !\(item\.reason in DOCUMENT_VISUAL_DISCARD_REASONS\)\)\)/,
    'a manifest whose refusals are corrupt is treated as absent, not shown blank');
  const source = read('electron/ai/documentVisuals.ts');
  assert.match(source, /discarded: request\.retry \? structuredClone\(previous\?\.discarded \?\? \[\]\) : \[\]/,
    'a retry keeps the refusals that still explain the document');
});

test('the reader is told the difference, in the language they read', () => {
  const view = read('src/components/DocumentVisualScope.tsx');
  assert.match(view, /tx\('No se añadió ninguna figura: se descartaron \{n\} propuestas\.', \{ n: discards\.length \}\)/,
    'a document with refused proposals must not say none were needed');
  assert.match(view, /documentVisualDiscardTally\(discarded\)\.map/, 'the panel counts them by motive');
  assert.match(view, /t\(documentVisualDiscardText\(reason\)\)/, 'and names each motive through the shared catalogue');
  assert.match(view, /documentVisualDiscardText|DiscardReasons discarded=\{discards\}/);
  // The former single sentence, now only for the document that really needed none.
  assert.match(view, /discards\.length\s*\?[\s\S]{0,400}No se añadieron figuras: no eran necesarias\./);
});

test('every refusal motive is translated in every language', () => {
  const ids = [...read('shared/documentSkills.ts').matchAll(/'([a-z-]+)': 'reason[A-Z]\w+'/g)].map(match => match[1]);
  assert.equal(ids.length, 7, 'seven motives are mapped to the log catalogue');
  // The panel shows these sentences, so a motive without a translation would surface as
  // Spanish in an English interface. Every reason* entry is checked, not only the new ones.
  const table = read('src/i18n.pipelineLogs.ts');
  let checked = 0;
  for (const [, spanish] of read('shared/pipelineLogMessages.ts').matchAll(/^\s{2}reason\w+: '([^']+)',$/gm)) {
    checked++;
    const row = table.split('\n').find(line => line.includes(`['${spanish}'`));
    assert.ok(row, `"${spanish}" has no row in the log catalogue's translations`);
    assert.equal(row.match(/'(((?:\\.|[^'])*)')/g).length, 9, `"${spanish}" must carry its Spanish source and eight translations`);
  }
  assert.ok(checked >= 17, `every reason in the catalogue was checked, not a pattern that matches nothing (${checked})`);
});
