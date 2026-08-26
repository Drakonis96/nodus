import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function filesBelow(directory) {
  return fs.readdirSync(path.join(root, directory), { recursive: true })
    .map(String)
    .filter((name) => /\.(?:ts|tsx|css)$/.test(name))
    .map((name) => path.join(directory, name));
}

test('the Server web renderer has no Electron or privileged bridge dependency', () => {
  const files = filesBelow('src/serverWeb');
  assert.ok(files.some((file) => file.endsWith('.tsx')), 'the Server renderer has no React entry');
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /window\.nodus|from\s+['"]electron['"]|vite-plugin-electron|electron\/preload|\.\.\/App(?:['"]|\.)/, file);
  }
});

test('Desktop does not import the Server-only renderer', () => {
  assert.doesNotMatch(read('src/main.tsx'), /serverWeb/);
  assert.doesNotMatch(read('src/App.tsx'), /serverWeb/);
  assert.doesNotMatch(read('vite.config.ts'), /serverWeb|server-web/);
});

test('the Server web build is independent and copied by the production image', () => {
  const config = read('vite.server-web.config.ts');
  assert.match(config, /server\/web\.html/);
  assert.match(config, /server[\\/', ]+dist[\\/', ]+web|server\/dist\/web/);
  assert.doesNotMatch(config, /vite-plugin-electron/);
  assert.equal(JSON.parse(read('package.json')).scripts['build:server-web'], 'vite build --config vite.server-web.config.ts');
  const docker = read('server/Dockerfile');
  assert.match(docker, /build:server-web/);
  assert.match(docker, /dist\/web/);
  assert.match(docker, /shared\/serverProfilePreferences\.mjs\s+\/shared\/serverProfilePreferences\.mjs/);
});

test('the Server web asset handler stops routing after writing its response', () => {
  const server = read('server/server.mjs');
  const handler = server.slice(server.indexOf('function serveWebApp'), server.indexOf('async function route'));
  assert.match(handler, /catch\s*\{\s*json\([^;]+;\s*return true;/);
  assert.match(handler, /staticAsset\([\s\S]+?\);\s*return true;/);
});

test('Server settings use the native app navigation and visual surface', () => {
  const app = read('src/serverWeb/App.tsx');
  assert.match(app, /data-testid="header-settings"/);
  assert.match(app, /onClick=\{\(\) => openView\('settings'\)\}/);
  assert.match(app, /data-testid="settings-view"/);
  assert.match(app, /data-testid=\{`settings-tab-\$\{id\}`\}/);
  assert.doesNotMatch(app, />Nodus Research<\/span>/);
  assert.match(app, />Nodus<\/span>/);
});
