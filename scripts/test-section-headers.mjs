// Una sola identidad visual para las secciones de la bóveda académica.
//
// La Biblioteca, Inmersión y Deep Research ya compartían encabezado; el resto había ido
// inventando el suyo —unas con `h1`, otras con `h2`, unas con padding interior, cada una
// con su tamaño de icono— y saltando entre secciones se notaba como si cada pantalla
// fuera de un programa distinto.
//
// Lo que fija esta prueba no es el aspecto, que puede cambiar: es que el aspecto viva en
// UN sitio. Una sección nueva que se pinte su propio encabezado a mano vuelve a abrir la
// deriva, y eso es lo que aquí falla.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

/** Las secciones que comparten encabezado. La Biblioteca tiene el suyo, propio y probado
 *  aparte, porque además lleva el conmutador de ámbito en el centro. */
const SECTIONS = [
  'src/views/IdeasView.tsx',
  'src/views/AuthorsView.tsx',
  'src/views/ArgumentMapView.tsx',
  'src/views/DebateView.tsx',
  'src/views/ImmersionView.tsx',
  'src/views/DeepResearchView.tsx',
];

test('the section header lives in one component, and every section uses it', async () => {
  const header = await readSource('src/components/SectionHeader.tsx');
  assert.match(header, /export function SectionHeader\(/);
  assert.match(header, /export function SectionToolbar\(/);
  // Icono + título + subtítulo + acciones a la derecha: la forma que ya tenían las tres
  // pantallas mejor acabadas.
  assert.match(header, /<Icon name=\{icon\} className="text-indigo-300" \/> \{title\}/);
  assert.match(header, /\{subtitle && <p className="mt-0\.5 text-xs text-neutral-500">\{subtitle\}<\/p>\}/);
  assert.match(header, /<div className="flex-1" \/>\s*\{actions\}/);

  for (const file of SECTIONS) {
    const source = await readSource(file);
    assert.match(source, /import \{ SectionHeader[^}]*\} from '\.\.\/components\/SectionHeader'/, `${file} imports the shared header`);
    assert.match(source, /<SectionHeader\s/, `${file} renders it`);
    assert.ok(
      !/<h1 className="flex items-center gap-2 text-xl font-semibold">/.test(source),
      `${file} must not hand-roll the header it just adopted`
    );
  }
});

test('every academic section header carries an icon, a title and one line saying what it is for', async () => {
  for (const file of SECTIONS) {
    const source = await readSource(file);
    const block = source.slice(source.indexOf('<SectionHeader'), source.indexOf('/>', source.indexOf('<SectionHeader')) + 2);
    assert.match(block, /icon="[a-zA-Z]+"/, `${file} names its icon`);
    assert.match(block, /title=\{t\(/, `${file} translates its title`);
    assert.match(block, /subtitle=\{t\(/, `${file} says in one line what the section is for`);
  }
});

// Los iconos identifican la sección en la barra lateral plegada, donde no hay texto: dos
// secciones visibles a la vez con el mismo icono no se distinguen de ninguna manera.
test('no two sections that can share a sidebar share an icon', async () => {
  const navigation = await readSource('src/navigation.ts');
  const items = [...navigation.matchAll(/\{ id: '([a-zA-Z]+)', label: '[^']*', icon: '([a-zA-Z]+)'/g)]
    .map(([, id, icon]) => ({ id, icon }));
  assert.ok(items.length > 40, 'the nav list was parsed');

  // El grafo y el mapa de argumentos se intercambiaron el icono con Deep Research; lo que
  // no puede pasar es que el intercambio deje un duplicado.
  const byId = Object.fromEntries(items.map((item) => [item.id, item.icon]));
  assert.equal(byId.graph, 'network', 'Grafo takes the network icon');
  assert.equal(byId.argument, 'layers', 'Mapa de argumentos takes the layers icon');
  assert.equal(byId.deepResearch, 'telescope', 'Deep Research takes the telescope');
  assert.equal(byId.studyGraph, 'network', 'and the study variants follow');
  assert.equal(byId.studyDeepResearch, 'telescope');
  assert.equal(byId.research, 'compass', 'Estado de la cuestión takes the compass');

  // Una bóveda genealógica muestra la navegación completa: el grafo y las relaciones
  // sociales conviven en ella, así que no pueden llevar el mismo icono.
  assert.notEqual(byId.graph, byId.relations, 'Grafo and Relaciones sociales stay distinguishable');

  const view = await readSource('src/views/DeepResearchView.tsx');
  assert.match(view, /icon="telescope"/, 'the section header follows the sidebar icon');
});
