import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('production and Portainer compose pull the experimental image built from main', () => {
  for (const relative of ['server/docker-compose.yml', 'server/portainer-stack.yml']) {
    const source = read(relative);
    assert.match(source, /image:\s+ghcr\.io\/drakonis96\/nodus-server:main/);
    assert.match(source, /pull_policy:\s+always/);
    assert.doesNotMatch(source, /^\s*build:/m);
  }
});

test('the main workflow tests then publishes amd64 and arm64 images', () => {
  const workflow = read('.github/workflows/nodus-server-image.yml');
  assert.doesNotMatch(read('.gitignore'), /^\.github\/$/m);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /node --test scripts\/test-nodus-server\.mjs scripts\/test-nodus-server-deployment\.mjs/);
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
  assert.match(read('server/README.md'), /Experimental e inestable/);
});

test('desktop settings include a beginner-friendly server deployment guide', () => {
  const settings = read('src/views/Settings.tsx');
  const translations = read('src/i18n.server.ts');
  assert.match(settings, /data-testid="nodus-server-guide-modal"/);
  assert.match(settings, /NODUS_SETUP_TOKEN/);
  assert.match(settings, /Caddy o Nginx/);
  assert.match(settings, /Cloudflare Tunnel/);
  assert.match(settings, /Nunca expongas 7443 directamente a Internet/);
  assert.match(settings, /ChatGPT o Claude/);
  assert.match(translations, /Step-by-step installation guide/);
  assert.match(read('server/README.md'), /Mi cuenta/);
});
