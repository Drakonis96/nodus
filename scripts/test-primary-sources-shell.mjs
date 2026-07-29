import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('primary sources owns exactly the agreed ten-section shell', async () => {
  const [sidebar, navigation, app] = await Promise.all([
    read('src/components/PrimarySourcesSidebar.tsx'),
    read('src/navigation.ts'),
    read('src/App.tsx'),
  ]);
  const itemBlock = sidebar.slice(
    sidebar.indexOf('export const PRIMARY_SOURCES_SIDEBAR_ITEMS'),
    sidebar.indexOf('const GROUPS')
  );
  const views = [...itemBlock.matchAll(/\bid: '([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(views, ['search', 'archive', 'persons', 'timeline', 'map', 'relations', 'notes']);
  assert.match(navigation, /primary_sources:\s*\[\s*'search', 'archive', 'persons', 'timeline', 'map', 'relations', 'notes', 'toolkit'/);
  assert.match(app, /if \(isPrimarySources\)[\s\S]{0,500}<PrimarySourcesSidebar/);
  assert.match(
    app,
    /if \(isPrimarySources\)[\s\S]{0,900}navGroups\.filter\(\(group\) => group\.id === 'tools'\)[\s\S]{0,100}\.map\(\(group\) => renderGroup\(group\)\)/,
    'primary sources reuses the universal Toolkit group and all nested tools',
  );
  assert.doesNotMatch(sidebar, /id: 'toolkit'|group: 'tools'/);
  assert.doesNotMatch(app, /PrimarySourcesToolkitView/);
  assert.match(app, /\{navButton\(homeItem\)\}/);
  assert.match(app, /\{navButton\(settingsItem\)\}/);
  assert.match(sidebar, /data-testid="primary-sources-sidebar"/);
  assert.match(sidebar, /aria-current=\{activeView === item\.id \? 'page'/);
});

test('primary sources never renders legacy genealogy/academic views for its core routes', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /view === 'home' && isPrimarySources[\s\S]{0,180}<PrimarySourcesHomeView/);
  assert.match(app, /view === 'home' && !isPrimarySources && !isGenealogy/);
  assert.match(
    app,
    /view === 'persons'[^\n]+isPrimarySources \? <PrimarySourcesPersonsView \/>/,
    'persons has its functional primary-source-specific route'
  );
  for (const [section, component] of [
    ['timeline', 'PrimarySourcesTimelineView'],
    ['relations', 'PrimarySourcesRelationsView'],
    ['map', 'PrimarySourcesMapView'],
  ]) {
    assert.match(
      app,
      new RegExp(`view === '${section}'[^\\n]+isPrimarySources \\? <${component} \\/>`),
      `${section} has a functional primary-source-specific route`
    );
  }
  assert.match(
    app,
    /view === 'archive'[\s\S]{0,120}isPrimarySources[\s\S]{0,120}\? <PrimarySourcesArchiveView/,
    'archive has its functional primary-source-specific route'
  );
  assert.match(app, /view === 'search' && isPrimarySources[\s\S]*?<PrimarySourcesSearchView/);
  assert.match(app, /view === 'search' && !isPrimarySources/);
});

test('creation and onboarding recognise primary sources without requiring Zotero', async () => {
  const [picker, onboarding, vaultTypes] = await Promise.all([
    read('src/components/vaultTypeUi.tsx'),
    read('src/views/Onboarding.tsx'),
    read('shared/vaultTypes.ts'),
  ]);
  assert.match(picker, /case 'primary_sources': return 'archive'/);
  assert.match(onboarding, /usesZoteroOnboarding = vaultType === 'academic'/);
  assert.match(onboarding, /const simple = !usesZoteroOnboarding/);
  assert.match(onboarding, /vaultType === 'primary_sources'[\s\S]{0,500}Investiga documentos originales/);
  assert.match(vaultTypes, /id: 'primary_sources'[\s\S]{0,900}defaultHiddenViews: \['library', 'writing', 'deepResearch'\]/);
});

test('primary sources empty states teach the next evidence-based action', async () => {
  const [home, sections] = await Promise.all([
    read('src/views/PrimarySourcesHomeView.tsx'),
    read('src/views/PrimarySourcesSectionView.tsx'),
  ]);
  for (const text of [
    'Añadir fuentes',
    'Unidades documentales',
    'Másteres preservados',
    'Fuentes listas para citar',
    'Requieren atención',
    'Estado de preservación',
    'Contenido de la fuente',
    'Observación estructurada',
    'Interpretación del investigador',
  ]) {
    assert.match(home, new RegExp(text), `${text} appears on Inicio`);
  }
  for (const text of [
    'La ubicación archivística y las colecciones de trabajo',
    'Las personas aparecerán al aceptar menciones documentales',
    'Las fechas inciertas mantienen su forma original',
    'El nombre original se conserva',
    'Las relaciones se añaden desde evidencias, no por intuición',
  ]) {
    assert.match(sections, new RegExp(text), `${text} appears in an empty state`);
  }
});

test('primary-source strings are supplied for every interface language', async () => {
  const translations = await read('src/i18n.primarySources.ts');
  for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
    assert.match(translations, new RegExp(`\\b${language}: map\\(`), `${language} translation table`);
  }
  for (const file of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const table = await read(`src/i18n.${file}.ts`);
    assert.match(table, /PRIMARY_SOURCES_TRANSLATIONS/);
  }
});
