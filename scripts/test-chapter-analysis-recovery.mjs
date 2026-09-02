import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
let mode = 'split';
let calls = [];
let publications = [];

class TestAiError extends Error {
  constructor(message, retriable = false, config = false, code = null) {
    super(message);
    this.retriable = retriable;
    this.config = config;
    this.code = code;
  }
}

function recoverable(message = 'output truncated') {
  return new TestAiError(message, true, false, 'output_truncated');
}

async function completeJson(opts) {
  const payload = JSON.parse(opts.user);
  calls.push({ opts, payload });
  if (payload.fragmentos) {
    if (mode === 'split' && payload.fragmentos.length > 2) throw recoverable();
    return {
      ideas: payload.fragmentos.map((fragment, index) => ({
        type: 'claim',
        label: `${fragment.heading}-${index}`,
        statement: fragment.text,
      })),
    };
  }

  const pairs = payload.ideas_manuscrito.flatMap((idea) => (
    idea.candidatos.map((candidate) => ({ idea, candidate }))
  ));
  if (mode === 'analyze-fail') throw recoverable('persistent truncation');
  if (mode === 'split' && pairs.length > 1) throw recoverable();
  if (mode === 'omit') return { relations: [] };
  return {
    relations: pairs.map(({ idea, candidate }) => ({
      chapterIdeaId: idea.chapterIdeaId,
      targetKind: candidate.targetKind,
      targetId: candidate.targetId,
      relation: 'supports',
      confidence: 0.8,
      rationale: 'validated',
    })),
  };
}

const oldIdea = {
  id: 'old-idea', chapterId: 'chapter-1', projectId: 'project-1', type: 'claim',
  label: 'Old', statement: 'Previous valid analysis', orderIdx: 0, createdAt: 'before',
};

const stubs = {
  './aiClient': {
    AiError: TestAiError,
    completeJson,
    embedMany: async (texts) => texts.map(() => [1, 0]),
  },
  '../db/projectsRepo': {
    getChapter: () => ({ id: 'chapter-1', projectId: 'project-1', currentMarkdown: 'Changed chapter text' }),
    listChapterChunks: () => [{ headingPath: 'H', text: 'A substantive claim.' }],
  },
  '../db/projectChapterIdeasRepo': {
    chapterIdeasSourceHash: () => 'old-hash',
    listChapterIdeas: () => [oldIdea],
    listChapterIdeaRelations: () => [],
    replaceChapterAnalysis: (...args) => { publications.push(args); return []; },
  },
  '../db/ideasRepo': {
    findSimilarIdeas: () => [{ global_id: 'g-1', similarity: 0.9, label: 'Library idea', statement: 'Evidence' }],
    getIdeaSummary: () => null,
  },
  '../db/notesRepo': {
    findSimilarNotes: () => [], getNote: () => null, noteEmbeddingText: () => '',
    notesNeedingEmbedding: () => [], updateNoteEmbedding: () => undefined,
  },
  '../db/passagesRepo': { findSimilarPassages: () => [], getPassageDetail: () => null },
  '../db/workSummariesRepo': { findSimilarWorks: () => [] },
  '../db/worksRepo': { getWork: () => null },
  '../db/settingsRepo': { getSettings: () => ({ promptLanguage: 'es', uiLanguage: 'es' }) },
  '@shared/academicPromptPacks': {
    chapterPromptPack: () => ({ extract: 'extract', type: 'type every pair', embeddingType: 'type', embeddingLabel: 'label', embeddingStatement: 'statement' }),
  },
};

require.extensions['.ts'] = function loadTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent?.filename?.endsWith('chapterIdeas.ts') && Object.hasOwn(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};
const chapter = require(path.join(repoRoot, 'electron/ai/chapterIdeas.ts'));
Module._load = originalLoad;

test('chapter extraction and relation typing recover without partial publication', async () => {
  mode = 'split';
  calls = [];
  const chunks = Array.from({ length: 6 }, (_, index) => ({ headingPath: `H${index}`, text: `Statement ${index}` }));
  const ideas = await chapter.extractChapterIdeas(chunks, null, 'es');
  assert.equal(ideas.length, 6);
  assert.equal(calls[0].opts.task, 'chapter-idea-extraction');
  assert.equal(calls[0].opts.maxTokens, 4500);
  assert.ok(calls.some((call) => call.payload.fragmentos?.length === 1), 'an oversized extraction batch is bisected');

  calls = [];
  const candidates = Array.from({ length: 4 }, (_, index) => ({ kind: 'idea', id: `g-${index}`, similarity: 0.8, text: `Candidate ${index}` }));
  const typed = await chapter.typeRelations(
    [{ id: 'ci-1', label: 'Idea', statement: 'Statement' }],
    new Map([['ci-1', candidates]]),
    null,
    'es',
    'strict',
  );
  assert.equal(typed.size, 4);
  assert.equal(calls[0].opts.task, 'chapter-relation-typing');
  assert.equal(calls[0].opts.maxTokens, 896);
  assert.ok(calls.some((call) => call.payload.ideas_manuscrito?.[0]?.candidatos.length === 1), 'relation pairs are bisected independently');

  mode = 'omit';
  await assert.rejects(
    chapter.typeRelations([{ id: 'ci-1', label: 'Idea', statement: 'Statement' }], new Map([['ci-1', [candidates[0]]]]), null, 'es', 'strict'),
    /de 1 pares requeridos/,
  );
  const fallback = await chapter.typeRelations([{ id: 'ci-1', label: 'Idea', statement: 'Statement' }], new Map([['ci-1', [candidates[0]]]]), null, 'es', 'fallback');
  assert.equal(fallback.size, 0, 'interactive analysis retains its explicit semantic fallback');

  mode = 'analyze-fail';
  calls = [];
  publications = [];
  const progress = [];
  const unsubscribe = chapter.onChapterRelationsProgress((event) => progress.push(event));
  await assert.rejects(chapter.analyzeChapterRelations({ chapterId: 'chapter-1', force: true }), /persistent truncation/);
  unsubscribe();
  assert.equal(publications.length, 0, 'persistent failure never reaches the atomic publication boundary');
  assert.equal(progress.at(-1)?.phase, 'error');
  assert.match(progress.at(-1)?.message ?? '', /persistent truncation/);
});
