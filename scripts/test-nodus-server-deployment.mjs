import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withServer } from './lib/nodusServerHarness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('production and Portainer compose pull the experimental image built from main', () => {
  for (const relative of ['server/docker-compose.yml', 'server/portainer-stack.yml']) {
    const source = read(relative);
    assert.match(source, /image:\s+ghcr\.io\/drakonis96\/nodus-server:main/);
    assert.match(source, /pull_policy:\s+always/);
    assert.doesNotMatch(source, /^\s*build:/m);
    assert.match(source, /NODUS_ADMIN_EMAIL/);
    assert.match(source, /NODUS_ADMIN_PASSWORD/);
  }
});

test('the main workflow tests then publishes amd64 and arm64 images', () => {
  const workflow = read('.github/workflows/nodus-server-image.yml');
  assert.doesNotMatch(read('.gitignore'), /^\.github\/$/m);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /- 'package\.json'/, 'server publishing reruns when its test dependencies change');
  assert.match(workflow, /- 'package-lock\.json'/, 'server publishing reruns when the dependency lock changes');
  assert.match(workflow, /Install test dependencies[\s\S]*?run:\s*npm ci[\s\S]*?Test server and deployment contract/, 'dependencies are installed before server tests');
  // Every server suite has to run before an image is published, not just the two that
  // predate the client API: an image that fails a role check or an asset rejection is
  // exactly what this job exists to stop.
  for (const suite of [
    'test-nodus-server.mjs', 'test-nodus-server-deployment.mjs', 'test-nodus-server-roles.mjs',
    'test-nodus-server-api.mjs', 'test-nodus-server-assets.mjs', 'test-nodus-server-mutations.mjs',
    'test-server-vectors.mjs',
  ]) {
    assert.match(workflow, new RegExp(`scripts/${suite.replace('.', '\\.')}`), `${suite} does not run before publishing`);
  }
  assert.match(workflow, /Run image health smoke test/);
  assert.match(workflow, /platforms:\s*linux\/amd64,linux\/arm64/);
  assert.match(workflow, /type=raw,value=main/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /Verify Portainer can pull main anonymously/);
  assert.match(workflow, /docker logout ghcr\.io/);
});

test('the image is non-root, health-checked and visibly experimental', () => {
  const dockerfile = read('server/Dockerfile');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /app\.nodus\.stability="experimental"/);
  assert.match(read('server/README.md'), /Experimental and unstable/);
});

test('desktop settings include a beginner-friendly server deployment guide', () => {
  const settings = read('src/views/Settings.tsx');
  const translations = read('src/i18n.server.ts');
  assert.match(settings, /data-testid="nodus-server-guide-modal"/);
  assert.match(settings, /NODUS_SETUP_TOKEN/);
  assert.match(settings, /NODUS_ADMIN_EMAIL/);
  assert.match(settings, /NODUS_ADMIN_PASSWORD/);
  assert.match(settings, /Caddy o Nginx/);
  assert.match(settings, /Cloudflare Tunnel/);
  assert.match(settings, /Nunca expongas 7443 directamente a Internet/);
  assert.match(settings, /ChatGPT o Claude/);
  assert.match(translations, /Step-by-step installation guide/);
  assert.match(read('server/README.md'), /My account/);
});

test('every remote user receives the exact AGPL license and Corresponding Source offer', async () => {
  const sourceCodeUrl = 'https://code.example.test/nodus/modified-revision-42';
  await withServer({ label: 'source-offer', env: { NODUS_SOURCE_URL: sourceCodeUrl } }, async ({ origin, dashboard }) => {
    for (const endpoint of ['/healthz', '/about']) {
      const response = await fetch(`${origin}${endpoint}`);
      assert.equal(response.status, 200);
      const info = await response.json();
      assert.equal(info.version, '4.2.2');
      assert.equal(info.license, 'AGPL-3.0-only');
      assert.equal(info.sourceCodeUrl, sourceCodeUrl);
    }
    const html = await dashboard();
    assert.match(html, /data-testid="source-code"/);
    assert.ok(html.includes(sourceCodeUrl));
    assert.match(html, /AGPL-3\.0-only/);
  });
});
