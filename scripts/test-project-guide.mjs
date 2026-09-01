import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-project-guide-test-'));

try {
  const outfile = path.join(tmp, 'projectGuide.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/projectGuide.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { buildProjectGuide } = await import(pathToFileURL(outfile).href);
  const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

  const initial = detail();
  let guide = buildProjectGuide(initial);
  assert.equal(guide.title, 'Flujo guiado de tesis');
  assert.equal(guide.completion, 0);
  assert.equal(guide.nextStep.id, 'brief');
  assert.equal(guide.steps.find((step) => step.id === 'coverage').status, 'blocked');

  guide = buildProjectGuide(detail({ brief: 'La tesis analiza el patrimonio como infraestructura política.' }));
  assert.equal(guide.completion, 17);
  assert.equal(guide.nextStep.id, 'coverage');
  assert.equal(guide.steps.find((step) => step.id === 'brief').status, 'done');

  guide = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: { coverage: 'in_progress' },
  }));
  assert.equal(guide.nextStep.id, 'materials');

  guide = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: { coverage: 'in_progress' },
    links: [link({ kind: 'work', refId: 'work-1', label: 'Obra base' })],
  }));
  assert.equal(guide.nextStep.id, 'outline');
  assert.equal(guide.steps.find((step) => step.id === 'materials').status, 'done');

  guide = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: {
      coverage: 'in_progress',
      literature: 'in_progress',
      debates: 'in_progress',
      gaps: 'in_progress',
    },
  }));
  assert.equal(guide.nextStep.id, 'manuscript');
  assert.equal(guide.steps.find((step) => step.id === 'outline').status, 'done');

  guide = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: {
      coverage: 'in_progress',
      literature: 'in_progress',
      debates: 'in_progress',
      gaps: 'in_progress',
    },
    chapters: [chapter()],
  }));
  assert.equal(guide.nextStep.id, 'review');

  guide = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: {
      coverage: 'in_progress',
      literature: 'in_progress',
      debates: 'in_progress',
      gaps: 'in_progress',
    },
    chapters: [chapter()],
    stats: { suggestions: 2, appliedSuggestions: 1 },
  }));
  assert.equal(guide.nextStep, null);
  assert.equal(guide.completion, 100);
  assert.equal(guide.steps.every((step) => step.status === 'done'), true);

  guide = buildProjectGuide(detail({ kind: 'article', brief: 'Artículo' }));
  assert.equal(guide.title, 'Flujo guiado de artículo');

  // The deterministic guide carries its own complete copy pack. This protects
  // the shared/runtime consumer from silently falling back to Spanish for any
  // title, summary, description, action, evidence, counter, or completion text.
  const spanishGuide = buildProjectGuide(initial, 'es');
  for (const language of languages) {
    const localized = buildProjectGuide(initial, language);
    assert.equal(localized.steps.length, 6, `${language}: step count changed`);
    assert.equal(localized.totalCount, 6, `${language}: total count changed`);
    assert.ok(localized.title.trim() && localized.subtitle.trim(), `${language}: missing guide headings`);
    for (const step of localized.steps) {
      const spanishStep = spanishGuide.steps.find((candidate) => candidate.id === step.id);
      assert.ok(spanishStep, `${language}: missing ${step.id}`);
      for (const field of ['title', 'summary', 'description', 'evidence', 'actionLabel']) {
        assert.ok(step[field].trim(), `${language}.${step.id}: missing ${field}`);
      }
      // Product terms such as “brief” can legitimately be shared with Spanish
      // (for example, Portuguese “Editar brief”); prose and evidence must not.
      if (language !== 'es') {
        for (const field of ['description', 'evidence']) {
          assert.notEqual(step[field], spanishStep[field], `${language}.${step.id}: Spanish ${field} leak`);
        }
      }
    }
    if (language !== 'es') {
      assert.notEqual(localized.title, spanishGuide.title, `${language}: Spanish title leak`);
      assert.notEqual(localized.subtitle, spanishGuide.subtitle, `${language}: Spanish subtitle leak`);
    }
  }

  const translatedEvidence = buildProjectGuide(detail({
    brief: 'Brief',
    sectionStatuses: { coverage: 'in_progress', literature: 'in_progress', debates: 'in_progress', gaps: 'in_progress' },
    links: [link({ kind: 'work', refId: 'work-1' })],
    chapters: [chapter({ wordCount: 12 })],
    stats: { suggestions: 2, appliedSuggestions: 1 },
  }), 'fr');
  assert.match(translatedEvidence.steps.find((step) => step.id === 'materials').evidence, /matériau/);
  assert.match(translatedEvidence.steps.find((step) => step.id === 'manuscript').evidence, /chapitre/);
  assert.match(translatedEvidence.steps.find((step) => step.id === 'review').evidence, /suggestion/);
  const completeDetail = detail({
    brief: 'Brief',
    sectionStatuses: { coverage: 'in_progress', literature: 'in_progress', debates: 'in_progress', gaps: 'in_progress' },
    links: [link({ kind: 'work', refId: 'work-1' })],
    chapters: [chapter({ wordCount: 12 })],
    stats: { suggestions: 2, appliedSuggestions: 1 },
    projectStatus: 'done',
  });
  for (const language of languages) {
    const complete = buildProjectGuide(completeDetail, language);
    assert.equal(complete.completion, 100, `${language}: completion changed`);
    assert.equal(complete.nextStep, null, `${language}: complete guide has a next step`);
    assert.ok(complete.subtitle.trim(), `${language}: missing complete fallback`);
    assert.ok(complete.steps.find((step) => step.id === 'materials').evidence.includes('1'), `${language}: material counter changed`);
    assert.ok(complete.steps.find((step) => step.id === 'manuscript').evidence.includes('12'), `${language}: word counter changed`);
    assert.ok(complete.steps.find((step) => step.id === 'review').evidence.includes('2') && complete.steps.find((step) => step.id === 'review').evidence.includes('1'), `${language}: review counters changed`);
  }
  assert.deepEqual(buildProjectGuide(initial, 'unsupported'), buildProjectGuide(initial, 'es'), 'invalid language must fall back safely');

  const projectsView = await readFile(path.join(repoRoot, 'src/views/ProjectsView.tsx'), 'utf8');
  assert.match(projectsView, /buildProjectGuide\(detail, guideLanguage\)/, 'ProjectsView must pass active UI language');

  console.log('project guide flow test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

function detail(overrides = {}) {
  const now = '2026-07-03T00:00:00.000Z';
  const sections = ['brief', 'coverage', 'literature', 'debates', 'gaps', 'drafts', 'manuscript'].map((role, index) => ({
    id: `section-${role}`,
    projectId: 'project-1',
    folderId: null,
    title: role,
    role,
    status: overrides.sectionStatuses?.[role] ?? 'empty',
    targetWords: null,
    orderIdx: index,
    createdAt: now,
    updatedAt: now,
  }));
  const chapters = overrides.chapters ?? [];
  const links = overrides.links ?? [];
  const stats = {
    sections: sections.length,
    links: links.length,
    chapters: chapters.length,
    suggestions: overrides.stats?.suggestions ?? 0,
    appliedSuggestions: overrides.stats?.appliedSuggestions ?? 0,
  };
  return {
    project: {
      id: 'project-1',
      title: 'Proyecto',
      kind: overrides.kind ?? 'thesis',
      status: overrides.projectStatus ?? 'active',
      brief: overrides.brief ?? '',
      researchQuestionId: overrides.researchQuestionId ?? null,
      rootFolderId: null,
      model: null,
      targetWords: null,
      createdAt: now,
      updatedAt: now,
    },
    sections,
    links,
    chapters,
    stats,
  };
}

function link(overrides = {}) {
  return {
    id: overrides.id ?? 'link-1',
    projectId: 'project-1',
    sectionId: overrides.sectionId ?? null,
    kind: overrides.kind ?? 'idea',
    refId: overrides.refId ?? 'idea-1',
    label: overrides.label ?? 'Idea',
    role: overrides.role ?? 'evidence',
    createdAt: '2026-07-03T00:00:00.000Z',
  };
}

function chapter(overrides = {}) {
  return {
    id: overrides.id ?? 'chapter-1',
    projectId: 'project-1',
    sectionId: overrides.sectionId ?? 'section-manuscript',
    noteId: null,
    title: overrides.title ?? 'Capítulo 1',
    sourceFormat: 'markdown',
    originalFileName: null,
    originalTextHash: 'hash',
    originalText: 'Texto base',
    currentMarkdown: '# Capítulo 1\n\nTexto base.',
    wordCount: overrides.wordCount ?? 4,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
}
