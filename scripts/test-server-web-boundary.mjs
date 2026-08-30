import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
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
  const app = variants(read('src/serverWeb/App.tsx'));
  const settings = variants(read('src/serverWeb/settings/ServerSettingsView.tsx'));
  assert.match(app, /dataTestId="header-settings"/);
  assert.match(app, /dataTestId="header-account"/);
  assert.match(
    app,
    /key={`\$\{settingsTab\}:\$\{settingsFocus\}`}/,
    'settings must remount when the URL tab or focused section changes',
  );
  assert.match(app, /data-theme={theme}/, 'the shell must expose the resolved theme to its token scope');
  assert.match(app, /icon="settings"[\s\S]*?onClick=\{\(\) => navigate\('\/view\/settings\?tab=server'\)\}/);
  assert.match(app, /<ServerSettingsView/);
  assert.match(settings, /data-testid="settings-view"/);
  assert.match(settings, /data-testid=\{`settings-tab-\$\{entry\.id\}`\}/);
  assert.doesNotMatch(settings, /<iframe|\/admin\/settings/);
  assert.doesNotMatch(app, />Nodus Research<\/span>/);
  assert.match(app, />\s*Nodus Server\s*<\/span>/);
});

test('Server vault creation uses canonical vault type ids', () => {
  const settings = variants(read('src/serverWeb/settings/ServerSettingsView.tsx'));
  for (const type of ['estudio', 'docencia', 'databases']) {
    assert.match(settings, new RegExp(`option value="${type}"`), `${type} must be accepted by normalizeVaultType`);
  }
  assert.doesNotMatch(settings, /option value="(?:study|teaching|database)"/, 'legacy aliases would silently create academic vaults');
  assert.match(settings, /api\.createVault\(\s*\{ \.\.\.newSpace, storageKind: 'server_native', authority: 'server' \}/,
    'Settings must create an autonomous Server-native vault, not a Desktop publication target');
  assert.match(settings, /data-testid="server-native-vault-create"/);
  assert.match(settings, /Nativo del servidor/);
  assert.match(settings, /isAdmin && !native && \(\s*<div className="ss-policy-grid">/,
    'publication policy switches only apply to Desktop-published spaces');
  assert.doesNotMatch(settings, /api\.createAdminSpace\(newSpace/);
});
