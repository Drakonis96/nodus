import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('every vault sidebar inherits its scrollbar colour from the canonical vault accent', async () => {
  const [app, css, vaultColors] = await Promise.all([
    readSource('src/App.tsx'),
    readSource('src/index.css'),
    readSource('shared/vaultColors.ts'),
  ]);

  assert.match(vaultColors, /export const VAULT_TYPE_COLORS = \{/);
  assert.match(app, /'--vault-accent': dockColorForVaultType\(activeVault\?\.type\)/);
  assert.match(app, /data-testid="sidebar-scroll-region"[^>]*vault-sidebar-scroll[^>]*overflow-y-auto/);
  assert.match(css, /\.vault-sidebar-scroll\s*\{[^}]*scrollbar-color: var\(--vault-accent, #6366f1\) transparent/s);
  assert.match(css, /\.vault-sidebar-scroll::\-webkit-scrollbar-thumb[\s\S]*background: var\(--vault-accent, #6366f1\)/);
  assert.match(css, /\.light \.vault-sidebar-scroll::\-webkit-scrollbar-thumb/, 'light mode must not restore the global neutral thumb');
});
