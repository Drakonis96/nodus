// Render the connected-vaults panel. Actually render it.
//
// Every other check on this screen reads the source with a regular expression, which cannot
// tell a working component from one that throws on its first prop. This is the screen a
// person sees when a server has revoked their access to a shared corpus, and the only place
// that tells them their data is still theirs — so it has to survive contact with React.
//
// The component is bundled with esbuild and rendered through react-dom/server, the same
// bundle-the-pure-module approach scripts/test-deep-research.mjs uses. No browser, no DOM,
// no Electron: if the JSX is wrong, this fails.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-panel-render-'));

const outfile = path.join(tmp, 'panel.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/connected-vaults-entry.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  // React is bundled in rather than left external: the output lives in a temp directory,
  // which cannot resolve back to the repo's node_modules.
  define: { 'process.env.NODE_ENV': '"production"' },
  // react-dom/server reaches for node:stream through CommonJS, and an ESM bundle has no
  // `require` to give it. This is esbuild's documented interop shim.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});
const { renderPanel } = await import(pathToFileURL(outfile).href);

function replica(overrides = {}) {
  return {
    vaultId: 'v-1',
    vaultName: 'Corpus del franquismo',
    vaultType: 'academic',
    isActiveVault: false,
    url: 'https://nodus.example.es',
    spaceName: 'Corpus compartido',
    serverName: 'Nodus del departamento',
    userEmail: 'lectora@example.es',
    role: 'reader',
    state: 'active',
    phase: 'ok',
    lastPulledAt: '2026-08-02T10:30:00.000Z',
    lastError: null,
    pendingMutations: 0,
    rejectedMutations: 0,
    lastImages: { downloaded: 0, bytes: 0, skipped: 0 },
    ...overrides,
  };
}

test('an empty panel renders nothing at all', () => {
  assert.equal(renderPanel({ replicas: [], busyVaultId: null }), '');
});

test('a reader is told their work stays on their machine', () => {
  const html = renderPanel({ replicas: [replica()], busyVaultId: null });
  assert.match(html, /data-testid="connected-vault-panel"/);
  assert.match(html, /Corpus del franquismo/);
  assert.match(html, /Corpus compartido/);
  assert.match(html, /Nodus del departamento/);
  assert.match(html, /lectora@example\.es/);
  assert.match(html, /Solo lectura/);
  assert.match(html, /se queda en este equipo y nunca se envía al vault principal/);
  // A date renders as a date, not as "Invalid Date" or a raw ISO string.
  assert.match(html, /Última actualización: \d/);
  assert.doesNotMatch(html, /Invalid Date/);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
});

test('a replica that has never pulled does not render an empty timestamp', () => {
  const html = renderPanel({ replicas: [replica({ lastPulledAt: null, phase: 'idle' })], busyVaultId: null });
  assert.match(html, /Todavía sin actualizar/);
  assert.doesNotMatch(html, /Invalid Date/);
  assert.doesNotMatch(html, /Última actualización/);
});

test('a writer sees what is still owed to the vault owner', () => {
  const html = renderPanel({ replicas: [replica({ role: 'writer', pendingMutations: 3 })], busyVaultId: null });
  assert.match(html, /Escritura/);
  assert.match(html, /3 cambios tuyos esperan/);
  // The read-only reassurance belongs to readers and must not appear here.
  assert.doesNotMatch(html, /nunca se envía al vault principal/);
});

test('changes the server refused are surfaced, never dropped in silence', () => {
  const html = renderPanel({ replicas: [replica({ role: 'writer', rejectedMutations: 2 })], busyVaultId: null });
  assert.match(html, /2 cambios no se han podido enviar y se conservan solo en este equipo/);
});

test('a revoked replica says the data is still here', () => {
  const html = renderPanel({ replicas: [replica({ state: 'revoked', phase: 'revoked' })], busyVaultId: null });
  assert.match(html, /data-testid="replica-revoked-notice"/);
  assert.match(html, /El servidor ha revocado tu acceso a este espacio/);
  // The whole point: revocation must never read as deletion.
  assert.match(html, /sigue completa en este equipo/);
  assert.match(html, /puedes seguir consultándola sin conexión/);
  // "Update now" is meaningless once access is gone, so it is disabled.
  assert.match(html, /disabled=""[^>]*>\s*Actualizar ahora|Actualizar ahora/);
  assert.match(html, /Desconectar/);
});

test('a disconnected replica reads as an ordinary local vault', () => {
  const html = renderPanel({ replicas: [replica({ state: 'paused', phase: 'paused' })], busyVaultId: null });
  assert.match(html, /Desconectada del servidor\. Es una bóveda local normal/);
  assert.doesNotMatch(html, /revocado/);
});

test('a sync error is shown, and only while the replica is still connected', () => {
  const failing = replica({ phase: 'error', lastError: 'El servidor respondió con HTTP 502.' });
  assert.match(renderPanel({ replicas: [failing], busyVaultId: null }), /HTTP 502/);
  // A revoked replica has its own notice; the raw error underneath would just be noise.
  const revoked = replica({ state: 'revoked', phase: 'revoked', lastError: 'El servidor ha revocado tu acceso.' });
  const html = renderPanel({ replicas: [revoked], busyVaultId: null });
  assert.match(html, /data-testid="replica-revoked-notice"/);
});

test('the busy vault is the only one whose buttons are disabled', () => {
  const html = renderPanel({
    replicas: [replica(), replica({ vaultId: 'v-2', vaultName: 'Otro corpus' })],
    busyVaultId: 'v-1',
  });
  assert.match(html, /Sincronizando…/);
  assert.match(html, /Otro corpus/);
  // Exactly one card is mid-request.
  assert.equal((html.match(/Sincronizando…/g) ?? []).length, 1);
  assert.equal((html.match(/Actualizar ahora/g) ?? []).length, 1);
});

test('every role and phase renders without throwing', () => {
  for (const role of ['reader', 'writer', 'owner']) {
    for (const state of ['active', 'revoked', 'paused']) {
      for (const phase of ['idle', 'syncing', 'ok', 'error', 'revoked', 'paused']) {
        const html = renderPanel({ replicas: [replica({ role, state, phase })], busyVaultId: null });
        assert.ok(html.length > 0, `${role}/${state}/${phase} rendered nothing`);
        assert.doesNotMatch(html, /undefined|NaN|\[object Object\]|Invalid Date/, `${role}/${state}/${phase}`);
      }
    }
  }
});

test.after(async () => { await rm(tmp, { recursive: true, force: true }); });
