import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('a sufficiently narrow vault sidebar becomes an accessible icon rail', async () => {
  const app = await readSource('src/App.tsx');
  const sidebarComponents = await Promise.all([
    'src/components/TeachingSidebar.tsx',
    'src/components/StudySidebar.tsx',
    'src/components/WorldbuildingSidebar.tsx',
    'src/components/PrimarySourcesSidebar.tsx',
    'src/components/ProsopographySidebar.tsx',
    'src/components/TestimonySidebar.tsx',
    'src/components/DatabasesSidebarExplore.tsx',
  ].map(readSource));

  assert.match(app, /const SIDEBAR_MIN_WIDTH = 64/);
  assert.match(app, /const SIDEBAR_COMPACT_THRESHOLD = 144/);
  assert.match(app, /const sidebarCompact = sidebarWidth <= SIDEBAR_COMPACT_THRESHOLD/);
  assert.match(app, /data-sidebar-compact=\{sidebarCompact \? 'true' : 'false'\}/);
  assert.match(app, /onKeyDown=\{resizeSidebarWithKeyboard\}/);
  assert.match(app, /onClick=\{\(event\) => event\.currentTarget\.focus\(\)\}/);
  assert.match(app, /event\.key === 'Home'[\s\S]*?SIDEBAR_MIN_WIDTH/);
  assert.match(app, /event\.currentTarget\.focus\(\);\s*event\.preventDefault\(\)/);
  assert.match(app, /aria-label=\{sidebarCompact \? t\(n\.label\) : undefined\}/);
  assert.match(
    app,
    /className=\{sidebarCompact && IS_MAC[\s\S]*?\? 'h-\[18px\] w-\[18px\]'[\s\S]*?: sidebarCompact \|\| \(IS_MAC && sidebarWidth < MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH\)[\s\S]*?\? 'h-6 w-6'[\s\S]*?: 'h-7 w-7'\}/,
    'the Nodus icon stays visible and centred when the sidebar becomes an icon rail',
  );
  assert.doesNotMatch(app, /sidebarCompact && IS_MAC \? 'hidden'/);
  assert.match(
    app,
    /data-testid="sidebar-header-brand"[\s\S]*?transform: sidebarCompact && IS_MAC \? 'translateY\(0\.5625rem\)' : undefined/,
    'the compact macOS logo clears the native traffic lights while staying centred',
  );
  assert.doesNotMatch(app, /sidebarCompact && IS_MAC \? 'pt-8'/);
  assert.match(app, /<span className=\{sidebarCompact \? 'sr-only' : undefined\}>\{t\(n\.label\)\}<\/span>/);
  assert.match(
    app,
    /<Tooltip key=\{n\.id\} label=\{t\(n\.label\)\} placement="right">\{button\}<\/Tooltip>/,
    'compact sidebar nav items show a shared tooltip instead of a native title',
  );
  assert.match(
    app,
    /<Tooltip label=\{t\('Nueva base de datos'\)\} placement=\{sidebarCompact \? 'right' : 'bottom'\}>/,
    'the databases new-database button keeps a tooltip when the sidebar collapses',
  );
  assert.doesNotMatch(
    app,
    /title=\{sidebarCompact \?/,
    'compact sidebar buttons no longer rely on native titles',
  );
  assert.match(app, /<TeachingSidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<StudySidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<WorldbuildingSidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<PrimarySourcesSidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<ProsopographySidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<TestimonySidebar\s+compact=\{sidebarCompact\}/s);
  assert.match(app, /<DatabasesSidebarExplore\s+compact=\{sidebarCompact\}/s);

  for (const source of sidebarComponents) {
    assert.match(source, /compact = false/);
    assert.match(source, /compact \? 'sr-only'/);
    assert.match(source, /aria-label=\{compact \?/);
    assert.match(source, /<Tooltip .*placement="right">\{button\}<\/Tooltip>/);
    assert.doesNotMatch(source, /title=\{compact \? t\(/, 'collapsed sidebar buttons no longer use native title labels');
    assert.doesNotMatch(source, /title=\{compact \? db\.name/);
  }
});
