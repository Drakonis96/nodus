import assert from 'node:assert/strict';
import test from 'node:test';
import { audit, loadManifest } from './ai-parity-audit.mjs';

test('AI parity audit has no substituted Server Web surfaces', () => {
  const result = audit({ manifest: loadManifest(), strict: false });
  assert.equal(result.errors.length, 0, result.errors.map((item) => item.message).join('\n'));
  assert.equal(result.pending.filter((item) => item.kind === 'placeholder').length, 0);
});

test('AI parity strict mode passes the implemented required surfaces', () => {
  const result = audit({ manifest: loadManifest(), strict: true });
  assert.equal(result.ok, true, result.errors.map((item) => item.message).join('\n'));
});

test('Cloudflare gate keeps technical API/admin/OAuth but excludes Advanced Server Web', () => {
  const result = audit({ manifest: loadManifest(), strict: false });
  assert.equal(result.errors.filter((item) => item.kind.startsWith('cloudflare')).length, 0);
  assert.ok(loadManifest().cloudflareGate.requiredTechnicalPatterns.api.includes('/api/v1'));
});
