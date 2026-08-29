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
