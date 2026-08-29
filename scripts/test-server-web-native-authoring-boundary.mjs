import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const root = path.resolve(import.meta.dirname, '..');

// NativeVaultStore opens a real database through better-sqlite3, which CI builds against
// Electron's ABI. Under the system Node the import throws, the store falls back to the
// sqlite3 CLI, and that binary has no FTS5 on the runner, so creating a vault fails.
// Re-exec under Electron-as-Node like every other suite that opens a database.
if (!requireElectronRuntime(path.join(root, 'scripts/test-server-web-native-authoring-boundary.mjs'), '--electron-native-authoring-test')) {
  process.exit(0);
}
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const authoring = read('src/serverWeb/vaults/NativeContentAuthoring.tsx');
const snapshot = read('electron/serverSync/serverSnapshot.ts');
const surfaces = read('src/serverWeb/vaults/index.tsx');

test('native prosopography exposes only authenticated authoring rows', async () => {
  const { NativeVaultStore } = await import('../server/lib/nativeVaultStore.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-native-prosop-'));
  try {
    const store = new NativeVaultStore(directory);
    const vault = await store.create({ id: 'prosop-native', name: 'Prosopografía privada', vaultType: 'prosopography' });
    const contract = await store.contentContract(vault.id, 'prosopography');
    for (const table of ['persons', 'prosop_person_profiles', 'prosop_sources', 'prosop_source_segments', 'prosop_network_layers', 'prosop_network_edges', 'prosop_organizations']) {
      assert.ok(contract.tables[table], `${table} must be available to an authenticated native vault`);
    }
    for (const table of ['prosop_factoids', 'prosop_statements', 'prosop_variable_revisions', 'prosop_population_memberships', 'prosop_identity_hypotheses']) {
      assert.equal(contract.tables[table], undefined, `${table} needs a domain-specific invariant boundary`);
    }
    const person = await store.mutateContent(vault.id, 'persons', 'prosopography', 'create', {
      expectedRevision: 0, idempotencyKey: 'prosop-person-create',
      row: { person_id: 'person-1', display_name: 'Persona privada', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    }, 'owner');
    assert.equal(person.revision, 1);
    const source = await store.mutateContent(vault.id, 'prosop_sources', 'prosopography', 'create', {
      expectedRevision: 1, idempotencyKey: 'prosop-source-create',
      row: { source_id: 'source-1', title: 'Fuente privada', source_kind: 'archive', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    }, 'owner');
    assert.equal(source.revision, 2);
    assert.equal((await store.contentContract(vault.id, 'genealogy')).tables.prosop_sources, undefined);
    assert.equal((await store.contentContract(vault.id, 'worldbuilding')).tables.prosop_sources, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native UI mappings cover prosopography and the shared genealogy/worldbuilding ontology', () => {
  for (const [surface, table] of [
    ['prosopography-persons', 'persons'], ['prosopography-sources', 'prosop_sources'], ['prosopography-networks', 'prosop_network_edges'],
    ['persons', 'persons'], ['places', 'places'], ['events', 'events'], ['relationships', 'relationships'],
    ['world-groups', 'world_groups'], ['world-scenes', 'world_scenes'], ['world-maps', 'world_maps'], ['world-articles', 'world_articles'],
    ['world-threads', 'world_threads'], ['world-rules', 'world_rules'], ['world-questions', 'world_questions'],
  ]) {
    assert.match(authoring, new RegExp(`(?:['"])?${surface}(?:['"])?\\s*:\\s*['"]${table}['"]`), `${surface} must have a native table mapping`);
  }
  assert.match(authoring, /Bóveda nativa del servidor/);
  assert.match(authoring, /newRecordText\(labels\.singular\)/);
  assert.match(authoring, /statement: 'Enunciado'/);
  assert.match(authoring, /bg-white[^"']*dark:bg-neutral-950/, 'native dialogs must follow light and dark themes');
});

test('desktop_published prosopography remains aggregate-only and fail-closed', () => {
  assert.match(snapshot, /vault\.type === 'prosopography'\) Object\.assign\(tables, buildProsopographyPublicProjection/);
  for (const table of ['prosop_person_profiles', 'prosop_sources', 'prosop_source_segments', 'prosop_network_edges', 'prosop_statements']) {
    assert.doesNotMatch(snapshot, new RegExp(`tables\\.${table}\\s*=`), `${table} must not be copied as a published table`);
  }
  for (const collection of ['prosopography-public-population', 'prosopography-public-sources', 'prosopography-public-analysis', 'prosopography-public-networks']) {
    assert.match(surfaces, new RegExp(collection));
  }
  assert.match(surfaces, /no se publican personas ni identidades/);
  assert.match(surfaces, /no se publican nodos, aristas ni resolución de identidad/);
});
