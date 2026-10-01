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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the chat instruction distinguishes local Zotero evidence, actual MCP reads and failed attempts', () => {
  const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
  const declaration = assistant.match(/^const RESEARCH_LOG_INSTRUCTION = '(.*)';$/m);
  assert.ok(declaration, 'the chat supplies a research-log instruction');
  const instruction = declaration[1];
  assert.match(instruction, /Never say that you lack research tools/, 'the answer owns its available research tools');
  assert.match(instruction, /Local Zotero-derived records or indexed passages are library access, not a Zotero MCP call/, 'local evidence does not imply MCP access');
  assert.match(instruction, /Only claim MCP access when research_log records it/, 'MCP claims require a recorded attempt');
  assert.match(instruction, /disclose attempts that returned no readable pages/, 'failed or empty reads are disclosed');
  assert.match(instruction, /unless the limits or research_log report a failed connection/, 'a real connection failure can be reported');
  assert.doesNotMatch(instruction, /that request has already been carried out/, 'a request alone does not prove that the connector ran');
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
    assert.deepEqual(kept.omittedSourceCoverage, { count: 14048, reasonCounts: { embeddings_pending: 14048 } });
    assert.ok(Buffer.byteLength(JSON.stringify(kept)) < 2000);
    const small = { ...coverage, sourceCoverage: sourceCoverage.slice(0, STORED_COVERAGE_LIMIT) };
    assert.equal(compactResearchTraversal(small), small, 'a small scope is kept as it is');
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /researchTraversal: compactResearchTraversal\(run\.coverage\(\)\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function withCorpus(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-stored-coverage-'));
  try {
    await build({ entryPoints: ['shared/researchCorpus.ts'], outfile: path.join(root, 'corpus.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    await check(require(path.join(root, 'corpus.cjs')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function traversal(sourceCoverage, overrides = {}) {
  return { scopeId: 'scope', sourceCount: sourceCoverage.length, rounds: 3, evidenceTokens: 7000, decisionTokens: 400,
    partial: true, limitations: ['ocr_required'], matchedDocumentIds: [], readDocumentIds: [], sourceCoverage, queries: [], ...overrides };
}

test('stored coverage retains empty attempts and catalogue finds, and counts omitted limitations per source', () => withCorpus(({ compactResearchTraversal, researchScopeForPrompt }) => {
  const sources = Array.from({ length: 65 }, (_, i) => ({ documentId: `d${i}`, title: `Work ${i}`,
    reasons: i < 10 ? ['ocr_required', 'text_pending', 'text_pending'] : i < 20 ? ['embeddings_pending'] : [] }));
  const coverage = traversal(sources, { matchedDocumentIds: ['d30'], readDocumentIds: ['d31'], catalogDocumentIds: ['d32'],
    attemptedDocumentIds: ['d0', 'd33'], contextDocumentIds: ['d34'], queries: [{ query: 'empty targeted search', sources: ['d1'], candidates: 0, partial: false },
      { query: 'whole scope', sources: sources.map(source => source.documentId), candidates: 4, partial: true }] });
  const original = JSON.stringify(coverage);
  const focus = { documentIds: ['d32'], documents: [] };
  const prompt = researchScopeForPrompt(coverage, focus);
  const compact = compactResearchTraversal(coverage);
  assert.deepEqual(compact.sourceCoverage.map(source => source.documentId), ['d0', 'd1', 'd30', 'd31', 'd32', 'd33', 'd34']);
  assert.deepEqual(compact.omittedSourceCoverage, { count: 58, reasonCounts: { ocr_required: 8, text_pending: 8, embeddings_pending: 10 } });
  assert.equal(compact.sourceCoverage.length + compact.omittedSourceCoverage.count, coverage.sourceCount);
  assert.deepEqual(compact.queries[0], coverage.queries[0], 'the empty individual search keeps its source and result');
  assert.deepEqual(compact.queries[1], { query: 'whole scope', sources: [], scope: { id: 'scope', sourceCount: 65 }, candidates: 4, partial: true });
  for (const field of ['sourceCount', 'rounds', 'evidenceTokens', 'decisionTokens', 'partial', 'limitations', 'matchedDocumentIds', 'readDocumentIds', 'catalogDocumentIds', 'attemptedDocumentIds', 'contextDocumentIds'])
    assert.deepEqual(compact[field], coverage[field], `${field}: unchanged`);
  assert.equal(JSON.stringify(coverage), original, 'the input and nested arrays are not mutated');
  assert.deepEqual(researchScopeForPrompt(coverage, focus), prompt, 'the live coverage still produces the same model prompt');
  assert.deepEqual(compactResearchTraversal(JSON.parse(JSON.stringify(compact))), compact, 'stored coverage is idempotent after a JSON round trip');
}));

test('empty turns still store omitted coverage, and the 60-source boundary preserves small scopes', () => withCorpus(({ compactResearchTraversal }) => {
  for (const count of [0, 1, 60, 61]) {
    const coverage = traversal(Array.from({ length: count }, (_, i) => ({ documentId: `d${i}`, title: `Work ${i}`, reasons: ['ocr_required', 'ocr_required'] })));
    const compact = compactResearchTraversal(coverage);
    if (count <= 60) assert.equal(compact, coverage);
    else {
      assert.deepEqual(compact.sourceCoverage, []);
      assert.deepEqual(compact.omittedSourceCoverage, { count, reasonCounts: { ocr_required: count } });
      assert.equal(compact.partial, coverage.partial);
    }
  }
  const legacy = { scopeId: 'old', sourceCount: 2, rounds: 1, evidenceTokens: 0, partial: false, queries: [] };
  assert.equal(compactResearchTraversal(legacy), legacy, 'optional fields remain optional for older records');
}));

test('only a verified complete scope can replace a query source list', () => withCorpus(({ compactResearchTraversal }) => {
  const sources = Array.from({ length: 65 }, (_, i) => ({ documentId: `d${i}`, title: `Work ${i}`, reasons: [] }));
  const ids = sources.map(source => source.documentId);
  for (const queryIds of [[ids[0], ids[1]], [...ids.slice(0, -1), 'foreign'], [...ids.slice(0, -1), ids[0]]]) {
    const coverage = traversal(sources, { queries: [{ query: 'subset or different scope', sources: queryIds, candidates: 0, partial: false }] });
    const compact = compactResearchTraversal(coverage);
    assert.deepEqual(compact.queries[0].sources, queryIds);
    assert.equal(compact.queries[0].scope, undefined, 'equal length alone cannot establish scope identity');
    for (const id of queryIds.filter(id => ids.includes(id))) assert.ok(compact.sourceCoverage.some(source => source.documentId === id));
  }
  const reversed = traversal(sources, { queries: [{ query: 'scope in another order', sources: [...ids].reverse(), candidates: 2, partial: true }] });
  assert.deepEqual(compactResearchTraversal(reversed).queries[0].scope, { id: 'scope', sourceCount: 65 });
  const incomplete = { ...reversed, sourceCount: 66 };
  assert.equal(compactResearchTraversal(incomplete).queries[0].scope, undefined, 'incomplete source coverage cannot prove a whole-scope query');
}));

test('more than sixty involved sources are never dropped or summarized again', () => withCorpus(({ compactResearchTraversal }) => {
  const sources = Array.from({ length: 100 }, (_, i) => ({ documentId: `d${i}`, title: `Work ${i}`, reasons: ['embeddings_pending'] }));
  const coverage = traversal(sources, { matchedDocumentIds: sources.slice(0, 80).map(source => source.documentId) });
  const compact = compactResearchTraversal(coverage);
  assert.equal(compact.sourceCoverage.length, 80);
  assert.deepEqual(compact.omittedSourceCoverage, { count: 20, reasonCounts: { embeddings_pending: 20 } });
  assert.equal(compactResearchTraversal(compact), compact);
  const allInvolved = { ...coverage, matchedDocumentIds: sources.map(source => source.documentId) };
  assert.equal(compactResearchTraversal(allInvolved), allInvolved);
}));

test('library-wide query storage stays small with real-length IDs and many rounds', () => withCorpus(({ compactResearchTraversal }) => {
  const sources = Array.from({ length: 14051 }, (_, i) => ({ documentId: `nodus:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Work ${i}`, reasons: ['embeddings_pending'] }));
  const ids = sources.map(source => source.documentId);
  for (const rounds of [1, 3, 8, 16]) {
    const coverage = traversal(sources, { matchedDocumentIds: [ids[3]], readDocumentIds: [ids[40]],
      queries: Array.from({ length: rounds }, (_, i) => ({ query: `whole scope ${i}`, sources: ids, candidates: 24, partial: i === rounds - 1 })) });
    const compact = compactResearchTraversal(coverage);
    assert.equal(compact.queries.length, rounds);
    assert.ok(compact.queries.every(query => query.sources.length === 0 && query.scope.id === coverage.scopeId && query.scope.sourceCount === coverage.sourceCount));
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 5000, `rounds ${rounds}: the stored record must stay below 5 KB`);
    assert.equal(compact.omittedSourceCoverage.reasonCounts.embeddings_pending + compact.sourceCoverage.length, sources.length);
    assert.equal(coverage.queries[0].sources.length, 14051, 'the live query list remains complete');
  }
}));
