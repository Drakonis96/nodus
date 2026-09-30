import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// Answers quoted `budget_exhausted`, `partial: true` and `readDocumentIds` to the reader,
// because the run's coverage record reached the model as it is stored.
test('the research scope a model reads names its limits in words, never as internal codes or fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-prompt-'));
  try {
    await build({ entryPoints: ['shared/researchCorpus.ts'], outfile: path.join(root, 'corpus.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { researchScopeForPrompt, describeResearchLimitation } = require(path.join(root, 'corpus.cjs'));
    const coverage = { scopeId: 'f'.repeat(64), sourceCount: 3, rounds: 3, evidenceTokens: 7999, decisionTokens: 4410, partial: true,
      matchedDocumentIds: ['doc-a'], readDocumentIds: ['doc-b'], limitations: ['budget_exhausted', 'no_matches', 'budget_exhausted', 'something_new'],
      sourceCoverage: [{ documentId: 'doc-a', title: 'Norias y turnos', reasons: [] }, { documentId: 'doc-b', title: 'El pleito', reasons: ['text_pending', 'embeddings_pending'] },
        { documentId: 'doc-c', title: 'Las acequias', reasons: [] }],
      queries: [{ query: 'tanda', sources: ['doc-a'], candidates: 2, partial: false }] };
    const scope = researchScopeForPrompt(coverage);
    const text = JSON.stringify(scope);
    for (const internal of ['budget_exhausted', 'no_matches', 'text_pending', 'embeddings_pending', 'something_new', 'readDocumentIds', 'matchedDocumentIds',
      'sourceCoverage', 'decisionTokens', 'scopeId', 'doc-a', 'doc-b', 'f'.repeat(64), '"partial"']) assert.ok(!text.includes(internal), `${internal} stays out of the prompt`);
    // "Not read in the original" is not a limitation: indexed passages are the source's own
    // text. Answers read original_read: false as "only summaries were seen".
    assert.deepEqual(scope.sources.map(source => [source.title, source.passages_found, source.original_read]),
      [['Norias y turnos', true, undefined], ['El pleito', false, true], ['Las acequias', false, undefined]]);
    assert.deepEqual(scope.sources[1].notes, [describeResearchLimitation('text_pending'), describeResearchLimitation('embeddings_pending')]);
    assert.equal(scope.limits.length, 3, 'each limit is described once');
    assert.match(describeResearchLimitation('no_matches'), /does not show/);
    assert.match(describeResearchLimitation('something_new'), /limit/);
    assert.equal(scope.search_may_be_incomplete, true);
    assert.equal(researchScopeForPrompt({ ...coverage, partial: false, limitations: [] }).limits, undefined);
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /Passages are verbatim text of their source, not summaries/, 'the chat instruction says what a passage is');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// A library of 1,223 sources reached the model as 1,223 entries with repeated notes and no
// authors: 310,000 characters in which the answer said indexed works had no index and that
// the list gave no authors. Research Chat names the sources of the turn and counts the rest.
test('the research scope names the turn\'s sources with their authors and counts the rest of the library', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-focus-'));
  try {
    await build({ entryPoints: ['shared/researchCorpus.ts'], outfile: path.join(root, 'corpus.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { researchScopeForPrompt, describeResearchLimitation } = require(path.join(root, 'corpus.cjs'));
    const sourceCoverage = Array.from({ length: 1223 }, (_, index) => ({ documentId: `doc-${index}`, title: `Obra ${index}`,
      reasons: index < 906 ? ['text_pending', 'embeddings_pending'] : index < 986 ? ['ocr_required', 'text_pending'] : [] }));
    const documents = sourceCoverage.map((source, index) => ({ id: source.documentId, authors: [`Autor ${index}, A.`], year: 1990 + (index % 30) }));
    const catalogue = Array.from({ length: 60 }, (_, index) => `doc-${1000 + index}`);
    const coverage = { scopeId: 'f'.repeat(64), sourceCount: 1223, rounds: 9, evidenceTokens: 20000, decisionTokens: 30000, partial: true,
      matchedDocumentIds: ['doc-1100', 'doc-1101', 'doc-5'], readDocumentIds: ['doc-1102'], limitations: ['text_pending', 'ocr_required'], sourceCoverage, queries: [] };
    const scope = researchScopeForPrompt(coverage, { documentIds: catalogue, documents });
    assert.equal(scope.sources.length, 40, 'at most forty sources are listed');
    assert.deepEqual(scope.sources.slice(0, 4).map(source => source.title), ['Obra 1102', 'Obra 5', 'Obra 1100', 'Obra 1101'], 'read first, then passages found, then catalogue finds');
    assert.deepEqual([scope.sources[0].authors, scope.sources[0].year, scope.sources[0].original_read], [['Autor 1102, A.'], 1990 + (1102 % 30), true]);
    assert.equal(scope.sources[0].notes, undefined, 'a source that was read carries no excuse');
    assert.deepEqual(scope.sources[4].notes, ['Found in the library catalogue; this turn did not read it within its limits.'], 'an indexed catalogue find says why it was not read, so no missing index is invented');
    assert.equal(scope.other_sources.count, 1223 - 40);
    // doc-5 is listed, so 905 + 80 unlisted sources have no text index yet.
    assert.deepEqual(scope.other_sources.notes, [`985 of them: ${describeResearchLimitation('text_pending')}`,
      `905 of them: ${describeResearchLimitation('embeddings_pending')}`, `80 of them: ${describeResearchLimitation('ocr_required')}`],
    'the unlisted sources are counted by limitation, in words');
    const text = JSON.stringify(scope);
    assert.ok(text.length < 20_000, `the scope stays small (${text.length} characters)`);
    for (const internal of ['text_pending', 'ocr_required', 'doc-1102', 'f'.repeat(64)]) assert.ok(!text.includes(internal), `${internal} stays out of the prompt`);
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /Never say that you lack tools, that Zotero or its MCP is unavailable or must be enabled/, 'the answer owns the research instead of disowning Zotero');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the coverage kept with a chat turn lists only consulted sources in a large scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-prompt-'));
  try {
    await build({ entryPoints: ['shared/researchCorpus.ts'], outfile: path.join(root, 'corpus.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { compactResearchTraversal, STORED_COVERAGE_LIMIT } = require(path.join(root, 'corpus.cjs'));
    const sourceCoverage = Array.from({ length: 14051 }, (_, i) => ({ documentId: `d${i}`, title: `Work ${i}`, reasons: ['embeddings_pending'] }));
    const coverage = { scopeId: 's', sourceCount: 14051, rounds: 2, evidenceTokens: 7000, partial: false, matchedDocumentIds: ['d3', 'd9'], readDocumentIds: ['d40'], sourceCoverage, queries: [] };
    const kept = compactResearchTraversal(coverage);
    assert.deepEqual(kept.sourceCoverage.map(s => s.documentId), ['d3', 'd9', 'd40']);
    assert.equal(kept.sourceCount, 14051, 'the scope size is still reported');
    assert.ok(Buffer.byteLength(JSON.stringify(kept)) < 2000);
    const small = { ...coverage, sourceCoverage: sourceCoverage.slice(0, STORED_COVERAGE_LIMIT) };
    assert.equal(compactResearchTraversal(small), small, 'a small scope is kept as it is');
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /researchTraversal: compactResearchTraversal\(run\.coverage\(\)\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
