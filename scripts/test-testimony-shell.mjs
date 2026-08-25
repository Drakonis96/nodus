// El armazón del vault de Testimonios (fase 1 del plan).
//
// El criterio de salida de la fase es una sola frase: «un vault de prueba abre
// únicamente las ocho secciones acordadas y no muestra superficies académicas o
// docentes». Eso no se comprueba mirando el sidebar una vez — se comprueba aquí, porque
// la lista se puede ampliar sin querer desde CUATRO sitios distintos (NAV_ITEMS,
// VAULT_TYPE_SCOPED_VIEWS, DEDICATED_VAULT_NAV_IDS y el propio TestimonySidebar) y
// cualquiera de ellos filtra una sección que el vault no ofrece.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-testimony-shell-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, file),
      '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
      '--loader:.tsx=tsx', '--jsx=automatic', `--outfile=${bundle}`,
    ],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return require(bundle);
}

const navigation = load('src/navigation.ts');
const vaultTypes = load('shared/vaultTypes.ts');
const { TESTIMONY_GROUPS } = load('src/components/TestimonySidebar.tsx');
const appSource = await readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8');
const participantsSource = await readFile(path.join(repoRoot, 'src/views/TestimonyParticipantsView.tsx'), 'utf8');

test.after(() => rm(outDir, { recursive: true, force: true }));

/** Las secciones acordadas, incluidos los cuatro instrumentos globales, en orden. */
const AGREED_SECTIONS = [
  'home',
  'search',
  'testimonyInterviews',
  'testimonyParticipants',
  'testimonyContrasts',
  'notes',
  'browser',
  'radar',
  'compass',
  'toolkit',
  'settings',
];

// Once desde que Nodus Compass existe: es transversal como Browser, Radar y Toolkit — consultar
// un archivo o un fondo en la web sirve igual aquí que en cualquier otra bóveda —
// y como el Toolkit no aporta ninguna superficie de OTRO vault al menú, que es lo
// que esta lista cerrada protege.
test('el menú tiene exactamente las once entradas acordadas', () => {
  const nav = navigation.dedicatedVaultNavIds('testimonios');
  assert.ok(nav, 'testimonios es un workspace dedicado, no el sidebar genérico');
  // Inicio y Ajustes van fijos fuera de los grupos y no forman parte de la lista.
  assert.deepEqual(
    ['home', ...nav, 'settings'],
    AGREED_SECTIONS,
  );
});

test('no aparece ninguna superficie académica, docente, de estudio ni de mundo', () => {
  const nav = new Set(navigation.dedicatedVaultNavIds('testimonios'));
  const forbidden = [
    'library', 'graph', 'ideas', 'authors', 'argument', 'immersion', 'gaps', 'debate',
    'hypothesis', 'reading', 'deepResearch', 'research', 'writing', 'projects',
    'persons', 'timeline', 'tree', 'relations', 'map', 'archive',
    'studyCourses', 'studyRecordings', 'studyLibrary', 'studyChat', 'studyQuestions',
    'teachingGroups', 'teachingGrades', 'teachingExams',
    'characters', 'places', 'encyclopedia', 'scenes', 'manuscript',
    'databases', 'dbSearch', 'dbAnalysis', 'dbChat',
  ];
  for (const id of forbidden) {
    assert.equal(nav.has(id), false, `${id} no pertenece al vault de Testimonios`);
  }
});

test('las tres secciones propias solo existen en este vault', () => {
  for (const view of ['testimonyInterviews', 'testimonyParticipants', 'testimonyContrasts']) {
    assert.deepEqual(vaultTypes.VAULT_TYPE_SCOPED_VIEWS[view], ['testimonios'], view);
    assert.equal(vaultTypes.isViewAllowedForVaultType(view, 'testimonios'), true, view);
    for (const other of ['academic', 'genealogy', 'estudio', 'docencia', 'databases', 'worldbuilding']) {
      assert.equal(vaultTypes.isViewAllowedForVaultType(view, other), false, `${view} en ${other}`);
    }
  }
});

test('las tres secciones propias son entradas reales del menú, con su icono', () => {
  for (const view of ['testimonyInterviews', 'testimonyParticipants', 'testimonyContrasts']) {
    const item = navigation.NAV_ITEMS.find((n) => n.id === view);
    assert.ok(item, `${view} falta en NAV_ITEMS`);
    assert.ok(item.label && item.icon && item.group, `${view} incompleto`);
  }
});

test('el sidebar y la lista de navegación no pueden separarse', () => {
  const sidebarViews = TESTIMONY_GROUPS.flatMap((group) => group.items.map((item) => item.view));
  const nav = navigation.dedicatedVaultNavIds('testimonios');
  // El grupo «Herramientas» lo pinta App.tsx aparte para todas las bóvedas dedicadas
  // (`navGroups.filter(group => group.id === 'tools')`), así que sus entradas son las
  // únicas de la lista que no están en el sidebar propio de Testimonios.
  const paintedByShell = new Set(['toolkit', 'compass', 'browser', 'radar']);
  assert.deepEqual([...sidebarViews].sort(), nav.filter((id) => !paintedByShell.has(id)).sort());
});

test('no hay un grupo «Escribir» que solo contenga Notas', () => {
  const groupIds = TESTIMONY_GROUPS.map((group) => group.id);
  assert.deepEqual(groupIds, ['explore', 'analyze', 'register']);
  const register = TESTIMONY_GROUPS.find((group) => group.id === 'register');
  assert.equal(register.label, 'Registrar');
  assert.deepEqual(register.items.map((item) => item.view), ['notes']);
});

test('el prompt pack existe, dice qué NO puede hacer la IA y no promete verificar hechos', () => {
  const pack = vaultTypes.vaultTypePromptPack('testimonios');
  assert.match(pack, /MODO TESTIMONIOS/);
  assert.match(pack, /código de tiempo/);
  assert.match(pack, /No infieras emociones/);
  assert.match(pack, /credibilidad/);
  assert.match(pack, /no apruebes transcripciones/);
  // La tesis metodológica: un testimonio no es una verificación de hechos.
  assert.match(pack, /no como una verificación automática\s*\n?\s*de hechos|no como una verificación automática de hechos/);
});

test('el acento es el cian del plan y el tipo ya se puede elegir', () => {
  assert.equal(vaultTypes.VAULT_TYPE_COLORS.testimonios, '#0891b2');
  // `available` pasó a true en la fase 9, cuando el vertical, la demo, el recorrido, las
  // traducciones y las pruebas estuvieron terminados — no antes.
  assert.equal(vaultTypes.getVaultTypeDef('testimonios').available, true);
});

test('el encabezado usa el logo cian cuando la bóveda activa es Testimonios', () => {
  assert.match(appSource, /import nodusLogoCyan from '\.\/assets\/nodus-logo-cyan\.svg'/);
  assert.match(appSource, /isTestimonios \? nodusLogoCyan : nodusLogo/);
});

test('editar un participante abre un modal sin reemplazar la tabla', () => {
  assert.doesNotMatch(participantsSource, /if \(openId\) \{\s*return <Participant/);
  assert.match(participantsSource, /\{openId && \(\s*<ParticipantModal/);
  assert.match(participantsSource, /data-testid="testimony-participant-modal"/);
  assert.match(participantsSource, /role="dialog"/);
  assert.match(participantsSource, /aria-modal="true"/);
  assert.match(participantsSource, /max-h-\[90vh\].*max-w-5xl.*overflow-hidden/);
});

test('las superficies ocultas por defecto no incluyen Buscar ni Notas', () => {
  const hidden = new Set(vaultTypes.defaultHiddenViewsForType('testimonios'));
  assert.equal(hidden.has('search'), false, 'Buscar es una de las ocho secciones');
  assert.equal(hidden.has('notes'), false, 'Notas es una de las ocho secciones');
  for (const id of ['library', 'graph', 'ideas', 'authors', 'writing', 'projects', 'deepResearch']) {
    assert.equal(hidden.has(id), true, id);
  }
});
