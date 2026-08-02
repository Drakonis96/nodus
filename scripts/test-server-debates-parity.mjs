// Nodus Server computes debates from a published snapshot; the desktop computes them from
// SQL. Two implementations of the same projection will drift unless something mechanically
// forbids it, and a drifted debate is not a cosmetic bug — a reader on the phone would be
// shown a dispute the owner has already dismissed, or a leaning side that is not the one
// their own screen shows.
//
// So this runs BOTH real implementations over ONE fixture and asserts they agree:
//   • electron/graph/graphService.ts getDebates(), against a real SQLite database;
//   • electron/serverSync/serverSnapshot.ts buildServerSnapshot(), over that same database;
//   • server/lib/core/debates.mjs listDebates(), over that snapshot.
//
// The fixture is deliberately adversarial. Each row of it exists because a plausible
// re-implementation gets it wrong:
//   • an edge_feedback rejection stored in the REVERSE direction (the view suppresses a
//     vetoed pair both ways, and a naive filter only matches the stored order);
//   • a three-edge cluster, so clusterId/clusterSize come from union-find and not from a
//     per-edge guess;
//   • one idea sitting on both sides of two different debates, which is what the desktop's
//     DebateSideCache exists for;
//   • works with a null year, which must sink to the end of the timeline rather than sort
//     as zero;
//   • an internal debate (the same work cited on both sides);
//   • tied support counts, which must read status 'open' and leaningSide null;
//   • two evidence quotes on one work, so lean mode has something to actually cap;
//   • an occurrence pointing at a work that does not exist, which both sides must drop.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-server-debates-parity.mjs'), '--electron-debates-parity-test')) {
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-debates-parity-'));
installRuntimeHooks(root);

const { listDebates, getDebate } = await import('../server/lib/core/debates.mjs');

function seed(db) {
  const now = '2026-01-01T00:00:00.000Z';
  const work = db.prepare(
    `INSERT INTO works (nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
       read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status, summary_status, archived, notes)
     VALUES (?, ?, 1, ?, ?, ?, 'book', NULL, 1, 1, 'both', 'pdf', 'done', 'done', 'done', 0, NULL)`
  );
  work.run('w-early', 'K1', 'Obra temprana', JSON.stringify(['Alba, Rosa']), 1998);
  work.run('w-late', 'K2', 'Obra tardía', JSON.stringify(['Bravo, Iván', 'Alba, Rosa']), 2021);
  work.run('w-undated', 'K3', 'Obra sin año', JSON.stringify(['Cano, Sol']), null);
  work.run('w-shared', 'K4', 'Obra citada por ambos lados', JSON.stringify(['Duarte, Nil']), 2010);

  const idea = db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)');
  // Deliberately past the 180-character tension clip, so the ellipsis path is exercised.
  idea.run('i-a', 'claim', 'Tesis A', 'El archivo determina la memoria colectiva de forma directa y sin mediación institucional alguna, según la lectura clásica que domina la historiografía europea desde los años setenta y que apenas ha sido revisada por la crítica posterior.', now);
  idea.run('i-b', 'claim', 'Tesis B', 'La memoria colectiva precede al archivo.', now);
  idea.run('i-c', 'claim', 'Tesis C', 'Archivo y memoria se coproducen.', now);
  idea.run('i-d', 'claim', 'Tesis D', '', now);
  idea.run('i-e', 'claim', 'Tesis E', 'Una postura aislada.', now);
  idea.run('i-vetoed', 'claim', 'Tesis vetada', 'No debería aparecer.', now);

  const occurrence = db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)');
  occurrence.run('i-a', 'w-early', 'principal', 'Desarrollo de A en la obra temprana.', 0.9);
  occurrence.run('i-a', 'w-shared', 'secondary', 'Desarrollo de A en la obra compartida.', 0.7);
  occurrence.run('i-b', 'w-late', 'principal', 'Desarrollo de B.', 0.8);
  occurrence.run('i-b', 'w-undated', 'secondary', 'Desarrollo de B sin año.', 0.6);
  occurrence.run('i-b', 'w-shared', 'secondary', 'Desarrollo de B en la obra compartida.', 0.5);
  occurrence.run('i-c', 'w-late', 'principal', 'Desarrollo de C.', 0.75);
  occurrence.run('i-d', 'w-early', 'principal', 'Desarrollo de D.', 0.55);
  // An occurrence whose work was deleted: both implementations must drop it silently.
  occurrence.run('i-e', 'w-missing', 'principal', 'Nunca visible.', 0.5);
  occurrence.run('i-vetoed', 'w-early', 'principal', 'Nunca visible.', 0.5);

  const evidence = db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)');
  // Two quotes on the same work, so lean mode has a second one to drop.
  evidence.run('ev-1', 'i-a', 'w-early', 'Primera cita de A.', 'p. 12', 'quote');
  evidence.run('ev-2', 'i-a', 'w-early', 'Segunda cita de A, descartada en modo lean.', 'p. 44', 'quote');
  evidence.run('ev-3', 'i-a', 'w-shared', 'Cita de A en la obra compartida.', 'p. 3', 'quote');
  evidence.run('ev-4', 'i-b', 'w-late', 'Cita de B.', 'p. 90', 'quote');

  const theme = db.prepare('INSERT INTO themes (theme_id, label, created_at) VALUES (?, ?, ?)');
  theme.run('t-mem', 'Memoria', now);
  theme.run('t-arch', 'Archivo', now);
  theme.run('t-solo', 'Solo A', now);
  const link = db.prepare('INSERT INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)');
  link.run('w-early', 'i-a', 't-mem', 0.9, 'llm');
  link.run('w-early', 'i-a', 't-solo', 0.9, 'llm');
  link.run('w-late', 'i-b', 't-mem', 0.8, 'llm');
  link.run('w-late', 'i-b', 't-arch', 0.8, 'llm');
  link.run('w-late', 'i-c', 't-arch', 0.7, 'llm');

  const edge = db.prepare('INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // A three-edge cluster over i-a / i-b / i-c.
  edge.run('e-ab', 'i-a', 'i-b', 'contradicts', 'llm', 0.81, 'w-early');
  edge.run('e-bc', 'i-b', 'i-c', 'refutes', 'llm', 0.64, 'w-late');
  edge.run('e-ac', 'i-a', 'i-c', 'contradicts', 'llm', 0.42, null);
  // A standalone debate with tied support: status 'open', leaningSide null.
  edge.run('e-de', 'i-d', 'i-e', 'contradicts', 'llm', 0.30, null);
  // Vetoed, and the veto is stored in the OPPOSITE direction to the edge.
  edge.run('e-veto', 'i-a', 'i-vetoed', 'contradicts', 'llm', 0.99, null);
  // Support edges break the tie between i-a and i-b, and one of them is itself vetoed so
  // the support count has to be taken from the view rather than from the edges table.
  edge.run('e-sup-a1', 'i-c', 'i-a', 'supports', 'llm', 0.5, null);
  edge.run('e-sup-a2', 'i-d', 'i-a', 'supports', 'llm', 0.5, null);
  edge.run('e-sup-b1', 'i-c', 'i-b', 'supports', 'llm', 0.5, null);
  edge.run('e-sup-vetoed', 'i-e', 'i-a', 'supports', 'llm', 0.5, null);

  const feedback = db.prepare('INSERT INTO edge_feedback (from_id, to_id, type, verdict, note, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  feedback.run('i-vetoed', 'i-a', 'contradicts', 'rejected', 'Reversed on purpose.', now);
  feedback.run('i-a', 'i-e', 'supports', 'rejected', '', now);
}

test('server debates match the desktop projection exactly', { timeout: 120_000 }, async () => {
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const Database = require('better-sqlite3');
  const dbFile = path.join(root, 'parity.sqlite');
  const db = new Database(dbFile);
  runMigrations(db);
  db.transaction(seed)(db);
  db.close();

  // The graph service reads through getDb(), which resolves the ACTIVE vault, so point the
  // registry at this fixture rather than trying to hand the module a connection.
  const registryPath = path.join(root, 'vaults.json');
  const fsSync = require('node:fs');
  fsSync.writeFileSync(registryPath, JSON.stringify({
    formatVersion: 1,
    activeVaultId: 'parity',
    vaults: [{ id: 'parity', name: 'Parity', path: dbFile, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', legacy: false, type: 'academic' }],
  }, null, 2));

  const { getDebates, getDebate: desktopGetDebate } = require(path.join(repoRoot, 'electron/graph/graphService.ts'));
  const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const desktop = getDebates();
  assert.ok(desktop.length >= 4, `the fixture must produce several debates, got ${desktop.length}`);

  const snapshot = JSON.parse(buildServerSnapshot(
    { id: 'parity', name: 'Parity', type: 'academic' },
    { nodusServerIncludeUserContent: false, nodusServerIncludePassages: false },
    getDb(),
  ).buffer.toString('utf8'));

  assert.ok(Array.isArray(snapshot.tables.edge_feedback), 'edge_feedback must travel or the veto cannot be reproduced');

  const server = listDebates(snapshot);

  // `trace` reads edge_traces, which is in NOT_SYNCED_TABLES and never travels. It is the
  // one documented difference, so strip it from the desktop side before comparing.
  const withoutTrace = desktop.map((debate) => ({ ...debate, trace: null }));
  assert.deepEqual(server, withoutTrace);

  // Now the specific properties the fixture was built to pin, so a future change that
  // breaks BOTH implementations in the same way still fails here.
  const ids = server.map((debate) => debate.id);
  assert.ok(!ids.includes('e-veto'), 'a pair vetoed in the reverse direction stays hidden');
  assert.deepEqual(ids.slice(0, 3).sort(), ['e-ab', 'e-ac', 'e-bc'], 'the three-edge cluster leads');
  for (const debate of server.slice(0, 3)) assert.equal(debate.clusterSize, 3);
  assert.equal(new Set(server.slice(0, 3).map((debate) => debate.clusterId)).size, 1, 'one cluster root for the three of them');

  const tied = server.find((debate) => debate.id === 'e-de');
  assert.equal(tied.status, 'open');
  assert.equal(tied.leaningSide, null);
  assert.equal(tied.clusterSize, 1);

  const ab = server.find((debate) => debate.id === 'e-ab');
  assert.equal(ab.status, 'leaning');
  assert.equal(ab.leaningSide, 'A', 'i-a keeps two supports; the third was vetoed and must not count for i-a');
  assert.deepEqual(ab.sharedThemes, ['Memoria'], 'only the theme both sides carry');
  assert.equal(ab.internal, true, 'w-shared is cited on both sides');
  assert.equal(ab.trace, null);

  // Lean mode keeps one quote per work, and drops development prose entirely.
  const earlySide = ab.sideA.works.find((work) => work.nodus_id === 'w-early');
  assert.equal(earlySide.evidence.length, 1);
  assert.equal(earlySide.evidence[0].id, 'ev-1');
  assert.equal(earlySide.development, '');

  // Undated works sink below dated ones instead of sorting as year zero.
  const years = ab.timeline.map((entry) => entry.year);
  assert.equal(years.at(-1), null);
  assert.deepEqual(years.filter((year) => year != null), [...years.filter((year) => year != null)].sort((a, b) => a - b));

  // An occurrence pointing at a deleted work is dropped, not rendered with an empty title.
  const isolated = server.find((debate) => debate.id === 'e-de');
  assert.deepEqual(isolated.sideB.works, []);

  // The tension sentence is user-visible prose; pin its exact shape and the 180-char clip.
  assert.match(ab.tension, /^La contradicción detectada es que «/);
  assert.match(server.find((debate) => debate.id === 'e-bc').tension, /^La refutación detectada es que «/);
  const clipped = ab.tension.slice(ab.tension.indexOf('«') + 1, ab.tension.indexOf('»'));
  // slice(0, 179).trim() + '…', so a clip landing on a space is one shorter than the cap.
  assert.ok(clipped.length <= 180 && clipped.length >= 179, `clipped to ${clipped.length}`);
  assert.ok(clipped.endsWith('…'), 'a clipped statement ends in an ellipsis');

  // A statement-less idea falls back to its label, as debateTensionText does.
  assert.ok(tied.tension.includes('Tesis D'), 'an idea with no statement is named by its label');

  // The single-debate lookup keeps full evidence and development, and mirrors getDebate's
  // clusterId/clusterSize convention.
  const detailServer = getDebate(snapshot, 'e-ab');
  const detailDesktop = desktopGetDebate('e-ab');
  assert.deepEqual(detailServer, { ...detailDesktop, trace: null });
  assert.equal(detailServer.clusterSize, 1);
  assert.equal(detailServer.clusterId, 'i-a');
  assert.equal(detailServer.sideA.works.find((work) => work.nodus_id === 'w-early').evidence.length, 2);
  assert.notEqual(detailServer.sideA.works.find((work) => work.nodus_id === 'w-early').development, '');

  assert.equal(getDebate(snapshot, 'e-veto'), null, 'a vetoed edge has no detail either');
  assert.equal(getDebate(snapshot, 'e-sup-a1'), null, 'a supports edge is not a debate');
});

test.after(async () => {
  await rm(root, { recursive: true, force: true });
});
