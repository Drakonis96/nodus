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

// shared/vaultTypes.ts is dependency-free, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaulttypes-'));
const bundle = path.join(outDir, 'vaultTypes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/vaultTypes.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const vt = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('academic is the default and every declared type round-trips', () => {
  assert.equal(vt.DEFAULT_VAULT_TYPE, 'academic');
  for (const def of vt.VAULT_TYPES) {
    assert.ok(vt.isVaultType(def.id), `${def.id} recognised`);
    assert.equal(vt.normalizeVaultType(def.id), def.id);
    assert.equal(vt.getVaultTypeDef(def.id).id, def.id);
  }
});

test('unknown / missing values normalise to academic', () => {
  for (const bad of [undefined, null, '', 'nope', 42, {}]) {
    assert.equal(vt.isVaultType(bad), false);
    assert.equal(vt.normalizeVaultType(bad), 'academic');
    assert.equal(vt.getVaultTypeDef(bad).id, 'academic');
  }
});

test('shipped and preview vaults are selectable; announced future vaults remain gated', () => {
  const ids = vt.availableVaultTypes().map((d) => d.id);
  assert.deepEqual(ids, ['academic', 'genealogy', 'estudio', 'databases', 'worldbuilding', 'docencia']);
  assert.equal(vt.getVaultTypeDef('genealogy').available, true);
  assert.equal(vt.getVaultTypeDef('estudio').available, true);
  assert.equal(vt.getVaultTypeDef('databases').available, true);
  for (const preview of ['worldbuilding', 'docencia']) {
    assert.equal(vt.getVaultTypeDef(preview).available, true, `${preview} preview is selectable`);
    assert.equal(vt.isPreviewVaultType(preview), true);
    assert.equal(vt.isViewAllowedForVaultType('home', preview), true);
    assert.equal(vt.isViewAllowedForVaultType('settings', preview), false);
  }
  for (const gated of ['primary_sources', 'testimonios']) {
    assert.equal(vt.getVaultTypeDef(gated).available, false, `${gated} not selectable this release`);
  }
  // Order shown in the picker: shipped types first, then the coming-soon ones.
  assert.deepEqual(vt.VAULT_TYPES.map((d) => d.id), ['academic', 'genealogy', 'estudio', 'primary_sources', 'databases', 'testimonios', 'worldbuilding', 'docencia']);
});

test('the vault picker derives selectable modes from the canonical registry', async () => {
  const picker = await readFile(path.join(repoRoot, 'src/components/VaultSwitcher.tsx'), 'utf8');
  assert.match(picker, /VAULT_TYPES\.filter\(\(type\) => type\.available\)/);
  assert.match(picker, /const CREATE_VAULT_TYPES: VaultType\[\] = \[\s*'academic', 'primary_sources', 'testimonios',\s*'databases', 'docencia', 'estudio',\s*'genealogy', 'worldbuilding',\s*\]/s);
  assert.doesNotMatch(picker, /COMING_SOON_VAULT_TYPES[^\n]*estudio/);
  assert.match(picker, /type === 'estudio'\) return 'pre-alpha'/);
  assert.match(picker, /type === 'genealogy'\) return 'alpha'/);
  assert.match(picker, /type === 'databases'\) return 'beta'/);
  assert.match(picker, /data-testid="vault-phase-notice"/);
  assert.match(picker, /data-testid="vault-preview-notice"/);
  assert.match(picker, />PREVIEW<\/span>/);
  assert.match(picker, /Icon name="bug"/);
  assert.match(picker, /data-testid="vault-phase-tooltip"/);
  assert.match(picker, /tooltipOpen && createPortal/);
  assert.match(picker, /className="pointer-events-none fixed z-\[90\]/);
  assert.match(picker, /window\.innerWidth - width - 8/);
  assert.match(picker, /window\.innerHeight - 8/);
  assert.match(picker, /className=\{`card-modal max-h-\[90vh\]/, 'vault creation and management dialogs use an opaque surface');
  assert.doesNotMatch(picker, /className=\{`card max-h-\[90vh\]/, 'translucent cards must not be used as modal panels');
});

test('teaching and worldbuilding previews expose their complete inert bilingual sidebars', async () => {
  const [sidebar, app, english] = await Promise.all([
    readFile(path.join(repoRoot, 'src/components/PreviewVaultSidebar.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/i18n.en.ts'), 'utf8'),
  ]);
  for (const label of ['Cursos y asignaturas', 'Grupos', 'Horarios', 'Calendario', 'Materiales', 'Grabaciones', 'Banco de preguntas', 'Rúbricas', 'Exámenes', 'Calificaciones', 'Guía docente / Programación', 'Unidades didácticas', 'Situaciones de aprendizaje', 'Adaptaciones', 'Proyectos de innovación', 'Enciclopedia', 'Personajes', 'Lugares', 'Facciones', 'Culturas', 'Cronología', 'Chat del mundo', 'Grafo del mundo', 'Reglas del mundo', 'Conflictos', 'Arcos narrativos', 'Consistencia', 'Preguntas abiertas', 'Escenas', 'Tramas', 'Manuscritos']) {
    assert.match(sidebar, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} appears in preview sidebar`);
  }
  assert.match(sidebar, /disabled aria-disabled="true"/);
  assert.match(app, /<PreviewVaultSidebar type=\{activeVault\.type\}/);
  assert.match(app, /preview-vault-home-/);
  assert.match(english, /'World chat'/);
  assert.match(english, /'Teaching guide \/ Course planning'/);
});

test('the header vault action uses a stable localized label', async () => {
  const app = await readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8');
  assert.match(app, /icon="archive"\s+label=\{t\('Bóvedas'\)\}/s);
  assert.doesNotMatch(app, /label=\{activeVault\?\.name \?\? t\('Bóveda'\)\}/);
});

test('databases mode: table/analysis/chat views scoped to it + data-analyst prompt pack', () => {
  for (const v of ['databases', 'dbAnalysis', 'dbChat']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'databases'), true, `${v} allowed for databases`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'academic'), false, `${v} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), false, `${v} hidden for genealogy`);
  }
  const hidden = vt.defaultHiddenViewsForType('databases');
  for (const h of ['search', 'library', 'graph', 'ideas', 'authors', 'writing', 'projects', 'deepResearch']) {
    assert.ok(hidden.includes(h), `${h} hidden in databases mode`);
  }
  assert.ok(!hidden.includes('notes'), 'notes stays visible in databases mode');
  assert.match(vt.vaultTypePromptPack('databases'), /MODO BASES DE DATOS/);
});

test('the tree view is scoped to genealogy only', () => {
  assert.equal(vt.isViewAllowedForVaultType('tree', 'genealogy'), true);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'primary_sources'), false);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'academic'), false);
  // Genealogy also gets the shared records views + map.
  for (const v of ['persons', 'timeline', 'archive', 'map']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), true);
  }
  // Map is shared with primary_sources; tree is not.
  assert.equal(vt.isViewAllowedForVaultType('map', 'primary_sources'), true);
  assert.equal(vt.isViewAllowedForVaultType('map', 'academic'), false);
});

test('genealogy hides argumentative + idea-graph authoring views, keeps records + Deep Research', () => {
  const hidden = vt.defaultHiddenViewsForType('genealogy');
  // Argumentative/idea-graph surfaces AND the idea-graph authoring tools (Writing,
  // Projects) are hidden; they'd run empty in genealogy.
  for (const h of ['argument', 'debate', 'immersion', 'hypothesis', 'reading', 'research', 'gaps', 'ideas', 'authors', 'graph', 'writing', 'projects']) {
    assert.ok(hidden.includes(h), `${h} hidden in genealogy`);
  }
  // Deep Research STAYS (it has a genealogy pipeline over the archive/library), and so
  // do the records/genealogy views + generic notes.
  for (const kept of ['deepResearch', 'persons', 'tree', 'timeline', 'archive', 'map', 'notes', 'library']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in genealogy`);
  }
  assert.match(vt.vaultTypePromptPack('genealogy'), /MODO GENEALOGÍA/);
});

test('vaultTypeImagePrompt steers image aesthetics by type', () => {
  assert.match(vt.vaultTypeImagePrompt('genealogy'), /family archive|heritage/i);
  assert.match(vt.vaultTypeImagePrompt('primary_sources'), /archival|documentary/i);
  assert.equal(vt.vaultTypeImagePrompt('academic'), '');
  assert.equal(vt.vaultTypeImagePrompt('estudio'), '');
});

test('primary_sources hides argument surfaces but keeps ideas/authors', () => {
  const hidden = vt.defaultHiddenViewsForType('primary_sources');
  assert.ok(hidden.includes('argument') && hidden.includes('debate'));
  for (const kept of ['ideas', 'authors', 'library', 'graph', 'notes']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in primary_sources`);
  }
  assert.match(vt.vaultTypePromptPack('primary_sources'), /FUENTES PRIMARIAS/);
});

test('academic shows the full sidebar; estudio uses its dedicated learning workspace', () => {
  assert.deepEqual(vt.defaultHiddenViewsForType('academic'), []);
  const estudioHidden = vt.defaultHiddenViewsForType('estudio');
  for (const hidden of ['search', 'library', 'graph', 'debate', 'deepResearch', 'writing', 'notes']) {
    assert.ok(estudioHidden.includes(hidden), `${hidden} replaced by a study-specific surface`);
  }
  for (const kept of ['studyCourses', 'studySchedule', 'studySearch', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyQuestions']) {
    assert.ok(!estudioHidden.includes(kept), `${kept} stays visible in estudio`);
  }
});

test('all dedicated study views are scoped to estudio', () => {
  const studyViews = [
    'studyCourses',
    'studySchedule',
    'studySearch',
    'studyLibrary',
    'studyRecordings',
    'studyChat',
    'studyQuestions',
    'studyReview',
  ];
  for (const view of studyViews) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), true, `${view} allowed in estudio`);
    for (const other of ['academic', 'genealogy', 'primary_sources', 'databases']) {
      assert.equal(vt.isViewAllowedForVaultType(view, other), false, `${view} hidden in ${other}`);
    }
  }
});

test('defaultHiddenViewsForType returns a fresh copy (no shared mutation)', () => {
  const a = vt.defaultHiddenViewsForType('estudio');
  a.push('mutated');
  assert.ok(!vt.defaultHiddenViewsForType('estudio').includes('mutated'));
});

test('prompt pack: academic empty, estudio carries a persona directive', () => {
  assert.equal(vt.vaultTypePromptPack('academic'), '');
  assert.match(vt.vaultTypePromptPack('estudio'), /MODO ESTUDIO/);
});

test('records views are scoped to primary_sources + genealogy only', () => {
  for (const view of ['persons', 'timeline', 'archive']) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'primary_sources'), true, `${view} allowed for primary_sources`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'genealogy'), true, `${view} allowed for genealogy`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'academic'), false, `${view} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), false, `${view} hidden for estudio`);
  }
  // Universal views are allowed everywhere.
  assert.equal(vt.isViewAllowedForVaultType('library', 'academic'), true);
  assert.equal(vt.isViewAllowedForVaultType('graph', 'genealogy'), true);
});

test('viewsDisallowedForType lists the scoped views not applicable to a type', () => {
  const all = ['home', 'library', 'persons', 'timeline', 'archive', 'settings'];
  assert.deepEqual(vt.viewsDisallowedForType(all, 'academic'), ['persons', 'timeline', 'archive']);
  assert.deepEqual(vt.viewsDisallowedForType(all, 'primary_sources'), []);
});

test('effectiveSidebarHidden: preset when untouched, user choice once customised', () => {
  // Untouched → the type preset drives visibility.
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'estudio'), vt.defaultHiddenViewsForType('estudio'));
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'academic'), []);
  // Customised → the user's explicit set wins, regardless of type.
  assert.deepEqual(vt.effectiveSidebarHidden(['graph'], true, 'estudio'), ['graph']);
  assert.deepEqual(vt.effectiveSidebarHidden([], true, 'estudio'), []);
});
