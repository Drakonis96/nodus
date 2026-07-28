import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-sidebar-filtering-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, file),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      '--loader:.tsx=tsx',
      '--jsx=automatic',
      `--outfile=${bundle}`,
    ],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return require(bundle);
}

const navigation = load('src/navigation.ts');
const { teachingItemId, TEACHING_GROUPS } = load('src/components/TeachingSidebar.tsx');

test.after(() => rm(outDir, { recursive: true, force: true }));

test('dedicated vaults expose only their own fixed navigation', () => {
  const study = navigation.dedicatedVaultNavIds('estudio');
  const teaching = navigation.dedicatedVaultNavIds('docencia');
  const databases = navigation.dedicatedVaultNavIds('databases');
  const worldbuilding = navigation.dedicatedVaultNavIds('worldbuilding');

  assert.ok(study.includes('studyChat'));
  assert.ok(!study.includes('teachingGroups'));
  assert.ok(!study.includes('characters'));

  assert.ok(teaching.includes('teachingGroups'));
  assert.ok(!teaching.includes('studyChat'));
  assert.ok(!teaching.includes('persons'));

  assert.deepEqual(databases.filter((id) => id.startsWith('db')), ['dbSearch', 'dbAnalysis', 'dbChat']);
  assert.ok(!databases.includes('studyCourses'));

  assert.ok(worldbuilding.includes('characters'));
  assert.ok(!worldbuilding.includes('studyCourses'));
  assert.ok(!worldbuilding.includes('teachingGroups'));

  for (const ids of [study, teaching, databases, worldbuilding]) {
    assert.ok(ids.includes('toolkit'), 'the universal Toolkit stays reachable');
  }
  assert.equal(navigation.dedicatedVaultNavIds('academic'), null);
  assert.equal(navigation.dedicatedVaultNavIds('genealogy'), null);
});

test('Docencia exposes every Crear item to the settings editor with stable ids', () => {
  const create = TEACHING_GROUPS.find((group) => group.label === 'Crear');
  assert.ok(create, 'Crear is present');
  assert.deepEqual(
    create.items.map((item) => item.label),
    [
      'Guía docente / Programación',
      'Unidades didácticas',
      'Situaciones de aprendizaje',
      'Adaptaciones',
      'Notas',
      'Proyectos de innovación',
    ],
  );
  const ids = TEACHING_GROUPS.flatMap((group) => group.items.map(teachingItemId));
  assert.equal(new Set(ids).size, ids.length, 'every configurable teaching item has a unique id');
});

test('saved order is applied only to the bounded group supplied by a sidebar', () => {
  const items = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ];
  assert.deepEqual(
    navigation.orderSidebarItems(items, ['foreign', 'c', 'a']).map((item) => item.id),
    ['c', 'a', 'b'],
  );
});
