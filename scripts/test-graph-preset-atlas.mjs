import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-preset-atlas-'));
const bundle = path.join(output, 'model.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'src/views/graph/model.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
});
const { buildPresetAtlas } = await import(pathToFileURL(bundle).href);
test.after(() => rm(output, { recursive: true, force: true }));

const defaultFilters = {
  search: '',
  nodeTypes: ['theme', 'claim', 'finding', 'construct', 'method', 'framework'],
  edgeTypes: ['contains', 'supports', 'extends'],
  theme: '',
  workIds: [],
  authors: [],
  yearMin: null,
  yearMax: null,
  readState: 'all',
  minConfidence: 0,
  basis: 'all',
};

function ideaFixture() {
  const nodes = [];
  const edges = [];
  for (let theme = 0; theme < 3; theme++) {
    const themeId = `theme:${theme}`;
    const themeLabel = `Tema ${theme}`;
    nodes.push({
      id: themeId, label: themeLabel.toUpperCase(), type: 'theme', workCount: 40,
      workIds: [], read: theme !== 2, themes: [themeLabel], years: [2020], authors: [], maxConfidence: 1,
    });
    for (let index = 0; index < 40; index++) {
      const id = `idea:${theme}:${index}`;
      nodes.push({
        id, label: `Idea ${theme}.${index}`, type: index % 2 ? 'claim' : 'finding', workCount: 1,
        workIds: [`work:${theme}:${index}`], read: index % 2 === 0, themes: [themeLabel], years: [2000 + index],
        authors: [`Autor ${index % 8}`], maxConfidence: 0.8,
      });
      edges.push({ id: `contains:${id}`, source: themeId, target: id, type: 'contains', basis: 'explicit', confidence: 1 });
      if (index > 0) {
        edges.push({
          id: `semantic:${theme}:${index}`, source: `idea:${theme}:${index - 1}`, target: id,
          type: index % 3 ? 'supports' : 'extends', basis: 'inferred', confidence: 0.75,
        });
      }
    }
  }
  return { nodes, edges };
}

function authorFixture() {
  const nodes = Array.from({ length: 300 }, (_, index) => ({
    id: `author:${index}`, label: `Autor ${String(index).padStart(3, '0')}`, type: 'author',
    workCount: 1 + (index % 12), workIds: [`work:${index}`], read: index % 3 === 0,
    themes: [], years: [1980 + (index % 40)], authors: [`Autor ${index}`], maxConfidence: 1,
  }));
  const edges = [];
  for (let index = 1; index < nodes.length; index++) {
    edges.push({
      id: `author-edge:${index}`, source: `author:${index - 1}`, target: `author:${index}`,
      type: 'coauthor', basis: 'inferred', confidence: 0.8,
    });
    if (index % 12 !== 0) {
      edges.push({
        id: `author-cluster:${index}`, source: `author:${index - (index % 12)}`, target: `author:${index}`,
        type: 'related', basis: 'inferred', confidence: 0.65,
      });
    }
  }
  return { nodes, edges };
}

function contradictionFixture() {
  const nodes = [];
  const edges = [];
  const themeCount = 6;
  const ideasPerTheme = 50;
  for (let theme = 0; theme < themeCount; theme++) {
    const themeId = `theme:${theme}`;
    const themeLabel = `Tema ${theme}`;
    nodes.push({
      id: themeId, label: themeLabel.toUpperCase(), type: 'theme', workCount: ideasPerTheme,
      workIds: [], read: true, themes: [themeLabel], years: [2020], authors: [], maxConfidence: 1,
    });
    for (let index = 0; index < ideasPerTheme; index++) {
      const id = `idea:${theme}:${index}`;
      nodes.push({
        id, label: `Idea ${theme}.${index}`, type: index % 2 ? 'claim' : 'finding', workCount: 1,
        workIds: [`work:${theme}:${index}`], read: index % 2 === 0, themes: [themeLabel], years: [2000 + index],
        authors: [`Autor ${index % 8}`], maxConfidence: 0.8,
      });
      edges.push({ id: `contains:${id}`, source: themeId, target: id, type: 'contains', basis: 'explicit', confidence: 1 });
    }
  }
  for (let index = 0; index < 150; index++) {
    const sourceTheme = index % 3;
    const sourceIndex = Math.floor(index / 3);
    const targetTheme = sourceTheme + 3;
    const targetIndex = (sourceIndex * 7 + sourceTheme * 5) % ideasPerTheme;
    edges.push({
      id: `debate:${index}`,
      source: `idea:${sourceTheme}:${sourceIndex}`,
      target: `idea:${targetTheme}:${targetIndex}`,
      type: index % 2 ? 'contradicts' : 'refutes',
      basis: index % 4 ? 'inferred' : 'explicit',
      confidence: 0.55 + (index % 10) / 25,
    });
  }
  return { nodes, edges };
}

function assertIntegrity(model) {
  const ids = new Set(model.nodes.map((node) => node.id));
  assert.equal(ids.size, model.nodes.length, 'atlas node ids are unique');
  for (const edge of model.edges) {
    assert.ok(ids.has(edge.source), `edge source ${edge.source} exists`);
    assert.ok(ids.has(edge.target), `edge target ${edge.target} exists`);
  }
}

test('gaps becomes a bounded thematic atlas of sparse ideas', () => {
  const model = buildPresetAtlas(ideaFixture(), defaultFilters, 'ideas', 'gaps');
  assert.ok(model);
  assert.ok(model.nodes.length <= 112 + 3, 'gap scene stays within its idea cap plus theme hubs');
  assert.equal(model.nodes.filter((node) => node.type === 'theme').length, 3);
  assert.ok(model.nodes.filter((node) => node.type !== 'theme').every((node) => node.group));
  assertIntegrity(model);
});

test('reading and unread atlases preserve their reading-state boundary', () => {
  const data = ideaFixture();
  const reading = buildPresetAtlas(data, { ...defaultFilters, readState: 'read' }, 'ideas', 'reading');
  const unread = buildPresetAtlas(data, { ...defaultFilters, readState: 'unread' }, 'ideas', 'unread');
  assert.ok(reading && unread);
  assert.ok(reading.nodes.filter((node) => node.type !== 'theme').every((node) => node.read));
  assert.ok(unread.nodes.filter((node) => node.type !== 'theme').every((node) => !node.read));
  assertIntegrity(reading);
  assertIntegrity(unread);
});

test('contradictions becomes a bounded thematic atlas without orphaning either side', () => {
  const data = contradictionFixture();
  const filters = {
    ...defaultFilters,
    edgeTypes: ['contradicts', 'refutes', 'contains'],
    minConfidence: 0.1,
  };
  const model = buildPresetAtlas(data, filters, 'ideas', 'contradictions');
  assert.ok(model, 'contradictions uses the semantic-atlas path');
  const ideaNodes = model.nodes.filter((node) => node.type !== 'theme');
  const debateEdges = model.edges.filter((edge) => edge.type === 'contradicts' || edge.type === 'refutes');
  assert.ok(ideaNodes.length <= 120, 'contradiction scene stays within its idea cap');
  assert.ok(model.nodes.some((node) => node.type === 'theme'), 'theme hubs preserve the atlas hierarchy');
  assert.ok(debateEdges.length > 0, 'the scene keeps contradiction and refutation edges');
  const debatedIds = new Set(debateEdges.flatMap((edge) => [edge.source, edge.target]));
  assert.deepEqual(
    new Set(ideaNodes.map((node) => node.id)),
    debatedIds,
    'every displayed idea retains its opposing side'
  );
  assertIntegrity(model);
  assert.deepEqual(
    buildPresetAtlas(data, filters, 'ideas', 'contradictions'),
    model,
    'atlas selection is deterministic'
  );
});

test('authors becomes a bounded, coloured community atlas', () => {
  const model = buildPresetAtlas(authorFixture(), defaultFilters, 'authors', 'authors');
  assert.ok(model);
  assert.equal(model.nodes.filter((node) => node.type === 'author').length, 144, 'author scene applies its cap');
  assert.ok(model.nodes.filter((node) => node.type === 'author').every((node) => node.group?.startsWith('author-network:')));
  assert.ok(model.nodes.every((node) => /^#[\da-f]{6}$/i.test(node.color ?? '')));
  assert.ok(new Set(model.nodes.map((node) => node.group)).size <= 10, 'author communities remain legible');
  assert.ok(model.nodes.some((node) => node.type === 'theme' && /^C\d+$/.test(node.label)), 'author communities have visual hubs');
  assertIntegrity(model);
});
