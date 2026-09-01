import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), 'utf8'));

test('Academic search/detail/citation chrome uses the Server translation adapter', () => {
  const search = read('src/serverWeb/academic/SearchServerView.tsx');
  const detail = read('src/serverWeb/academic/AcademicDetailExplorer.tsx');
  const citation = read('src/serverWeb/ServerCitationModal.tsx');
  assert.match(search, /import \{ t, tx \} from '\.\.\/i18nShim'/);
  for (const source of [
    'Búsqueda global', 'Busca en todo el espacio publicado.', 'Texto', 'Significado',
    'Guardadas:', 'Sin resultados.', 'Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.',
  ]) assert.match(search, new RegExp(`t\\(\\s*['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`), `${source} must use t()`);
  for (const source of [
    'Historial de navegación', 'Atrás', 'Adelante', 'Volver al registro de origen',
    'No se ha podido cargar este registro.', 'No hay obras publicadas para esta idea.',
    'No hay perfil documental publicado.', 'No hay relaciones autorales publicadas.',
  ]) assert.match(detail, new RegExp(`t\\(\\s*['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`), `${source} must use t()`);
  for (const source of ['No se ha podido cargar esta cita.', 'Cargando fuente…', 'Fuentes y contexto', 'Fuentes abiertas'])
    assert.match(citation, new RegExp(`t\\(\\s*['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`), `${source} must use t()`);
});

test('Server academic translations provide every supported non-Spanish locale', () => {
  const shim = read('src/serverWeb/i18nShim.ts');
  for (const locale of ['en:', 'fr:', 'de:', 'pt:', 'pt-BR:', 'it:', 'tr:']) {
    const localePattern = locale === 'pt-BR:' ? '["\\\']pt-BR["\\\']:' : locale.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    assert.match(shim, new RegExp(`SERVER_WEB_ACADEMIC_TRANSLATIONS[\\s\\S]*?\\n  ${localePattern}`), `${locale} catalogue must exist`);
  }
  assert.match(shim, /SERVER_WEB_ACADEMIC_TRANSLATIONS\[normalized\]/);
  for (const source of ['Resultado sin título', 'No se ha podido cargar este registro.', 'Historial de navegación', 'Cargando fuente…'])
    assert.match(shim, new RegExp(`['"]${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`), `${source} must be registered`);
});

test('Server Web UI keeps newly audited chrome behind the i18n adapter', () => {
  const reader = read('src/serverWeb/LibraryServerView.tsx');
  for (const source of [
    'Versiones y archivos', 'Documento', 'Añadir nota', 'Guardar anotación',
    'En este documento', 'Preguntar de nuevo al abrir', 'Cargando lector…',
  ]) {
    assert.match(reader, new RegExp(`t\\(\\s*["']${source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["']`), `${source} must use t()`);
  }
  assert.match(reader, /tx\(\s*["']Abrir \{title\} en otra pestaña["']/);
  assert.match(reader, /t\(\s*["']No se ha podido cargar este documento\.["']/);
  assert.match(reader, /toLocaleLowerCase\(getActiveLang\(\)\)/);

  const calendar = read('src/serverWeb/vaults/index.tsx');
  assert.doesNotMatch(calendar, /STUDY_CALENDAR_WEEKDAYS/);
  assert.match(calendar, /getActiveLang\(\)/, 'calendar formatting must use the active locale');
  assert.match(calendar, /t\(kind\)/, 'calendar event kinds must use t()');
  assert.match(calendar, /tx\(\s*["']\{n\} eventos publicados · solo lectura["']/);

  const academic = read('src/serverWeb/AcademicToolsServerView.tsx');
  assert.match(academic, /t\(\s*["']Capítulos publicados["']/);
  assert.match(academic, /t\(\s*["']Enlaces del proyecto["']/);

  const database = read('src/serverWeb/DatabaseAnalysisServerView.tsx');
  assert.match(database, /tx\(\s*["']\{n\} valores["']/);
  assert.match(database, /tx\(\s*["']\{n\} enlaces["']/);
  assert.match(database, /errorText\(cause\)/);
  assert.match(database, /t\(kindMeta\(item\)\.label\)/);

  const vaults = read('src/serverWeb/vaults/ServerVaultManager.tsx');
  assert.match(vaults, /setDuplicateValue\(`\$\{space\.name\} \$\{t\(\s*["']copia["']\)/);
  assert.match(vaults, /tx\(\s*["']Se eliminará definitivamente el vault nativo «\{name\}/);
  assert.match(vaults, /tx\(\s*["']Selecciona una copia SQLite compatible para «\{name\}/);
  assert.match(vaults, /aria-label=\{t\(\s*["']Cerrar["']\)/);

  const personal = read('src/serverWeb/PersonalViews.tsx');
  for (const title of ['Sin título', 'Nueva colección', 'Nueva entrada']) {
    assert.match(personal, new RegExp(`t\\(\\s*["']${title}["']`), `${title} default must use t()`);
  }

  const detail = read('src/serverWeb/academic/AcademicDetailExplorer.tsx');
  assert.match(detail, /tx\(\s*["']Sección \{n\}["']/);
  assert.match(detail, /errorText\(error\)/);
  assert.match(detail, /toLocaleLowerCase\(getActiveLang\(\)\)/);
  const native = read('src/serverWeb/vaults/NativeContentAuthoring.tsx');
  assert.match(native, /errorText\(cause\)/);
  assert.match(native, /toLocaleLowerCase\(getActiveLang\(\)\)/);
  const settings = read('src/serverWeb/settings/ServerSettingsView.tsx');
  assert.match(settings, /function errorMessage[\s\S]*?t\(error\.message\)/);
  const stateOfArt = read('src/serverWeb/StateOfArtServerView.tsx');
  assert.match(stateOfArt, /setError\(errorText\(cause\)\)/);
  const app = read('src/serverWeb/App.tsx');
  assert.match(app, /\{errorText\(error\)\}/);
  const advanced = read('src/serverWeb/advanced/AdvancedWorkspace.tsx');
  assert.match(advanced, /\{errorText\(error\)\}/);
  const archive = read('src/serverWeb/PrimarySourcesArchiveServerView.tsx');
  assert.match(archive, /errorText\(cause\)/);
  const databaseResearch = read('src/serverWeb/DatabaseDeepResearchServerView.tsx');
  assert.match(databaseResearch, /\{t\(job\.error\.message\)\}/);

  const shim = read('src/serverWeb/i18nShim.ts');
  for (const locale of ['en:', 'fr:', 'de:', 'pt:', 'pt-BR:', 'it:', 'tr:']) {
    const localePattern = locale === 'pt-BR:' ? '["\\\']pt-BR["\\\']:' : locale;
    const block = new RegExp(`${localePattern}[\\s\\S]*?Se eliminará definitivamente el vault nativo «\\{name\\}`);
    assert.match(shim, block, `${locale} must translate dynamic vault confirmation text`);
  }
});
