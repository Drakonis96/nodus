// One release, one number, in every place that states it.
//
// The desktop and Nodus Server ship together and carry the same version, so that "which version
// are you on?" has a single answer and an incompatibility can be named before it is diagnosed.
// That is only true while three files agree, and nothing but this test makes them: a JSON file,
// a second JSON file and a JavaScript constant, with no build step reading one from another.
//
// The mobile client used to be a fourth place, read out of `ios/project.yml`. It now lives in
// its own repository, which puts its version beyond anything this suite can see: the check that
// a phone build matches the release it targets belongs there, against the number the server
// reports at /healthz. Do not reintroduce a path into another repository to get it back.
//
// When this fails, it is not the test that is wrong. Bump the version everywhere or bump it
// nowhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(repoRoot, relative), 'utf8');

test('the desktop and the server state the same version', async () => {
  const [rootPackage, serverPackage] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('server/package.json').then(JSON.parse),
  ]);
  const { NODUS_VERSION } = await import('../server/lib/version.mjs');

  const expected = rootPackage.version;
  assert.match(expected, /^\d+\.\d+\.\d+$/, 'the root package version is the one everything else follows');

  assert.equal(serverPackage.version, expected, 'server/package.json disagrees with package.json');
  assert.equal(NODUS_VERSION, expected, 'server/lib/version.mjs disagrees with package.json');
});

test('the server states its version everywhere a client can read it', async () => {
  const [server, api] = await Promise.all([read('server/server.mjs'), read('server/lib/routes/api.mjs')]);

  // No literal may sit beside the constant: a hardcoded number is exactly how the MCP handshake
  // and /healthz came to disagree with the release for three minor versions.
  assert.doesNotMatch(server, /version: '\d+\.\d+\.\d+'/, 'server.mjs hardcodes a version somewhere');
  assert.match(server, /import \{ NODUS_LICENSE, NODUS_SOURCE_URL, NODUS_VERSION \} from '\.\/lib\/version\.mjs'/);

  // The four places a version is visible: the health probe, the MCP handshake, the capabilities
  // document the app reads, and the page footer a person reads.
  assert.match(server, /\/healthz'.*version: NODUS_VERSION, license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL/);
  assert.match(server, /serverInfo: \{ name: 'nodus-server', version: NODUS_VERSION/);
  assert.match(server, /site-footer">Nodus Server \$\{escapeHtml\(NODUS_VERSION\)\}.*data-testid="source-code"/);
  assert.match(api, /version: NODUS_VERSION/);
});
