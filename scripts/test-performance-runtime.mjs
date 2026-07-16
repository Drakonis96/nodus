import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [database, migrations, app] = await Promise.all([
  read('electron/db/database.ts'),
  read('electron/db/migrations.ts'),
  read('src/App.tsx'),
]);

for (const pragma of [
  'busy_timeout = 5000',
  'synchronous = NORMAL',
  'temp_store = MEMORY',
  'cache_size = -32768',
  'mmap_size = 268435456',
  'wal_autocheckpoint = 1000',
]) {
  assert.ok(database.includes(pragma), `SQLite must set ${pragma}`);
}
assert.match(database, /setTimeout[\s\S]*?pragma\('optimize'\)/, 'SQLite optimize must run after startup, not on the critical path');
assert.match(migrations, /version: 78,[\s\S]*idx_works_active_year_title/, 'performance indexes must keep their append-only migration');
for (const index of [
  'idx_works_active_year_title',
  'idx_works_active_analysis_status',
  'idx_ideas_current_embedding',
  'idx_idea_theme_links_work',
  'idx_edges_type_endpoints',
]) {
  assert.ok(migrations.includes(index), `${index} must be installed`);
}

assert.match(app, /const GraphView = lazy\(/, 'graph stack must be split from the startup bundle');
assert.match(app, /const StudyOrganizationView = lazy\(/, 'study workspace must be split from the startup bundle');
assert.match(app, /const DatabasesView = lazy\(/, 'database workspace must be split from the startup bundle');
assert.match(app, /<Suspense fallback=/, 'lazy views need a non-blocking loading boundary');
assert.equal(app.includes("import { GraphView } from './views/GraphView'"), false, 'GraphView must not be eagerly imported');

const nodiEffect = app.slice(app.indexOf('// Publish a bounded snapshot'), app.indexOf('useEffect(() => window.nodus.onNodiNavigate'));
assert.ok(nodiEffect.indexOf('if (!settings?.mascotEnabled) return') < nodiEffect.indexOf('new MutationObserver'), 'disabled Nodi must not attach a DOM observer');
assert.match(nodiEffect, /requestIdleCallback/, 'visible-context extraction must wait for idle time');
assert.match(nodiEffect, /if \(text === lastText\) return/, 'unchanged DOM text must not cross IPC repeatedly');

console.log('Runtime performance checks passed.');
