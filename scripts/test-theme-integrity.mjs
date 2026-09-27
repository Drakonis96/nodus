// setWorkThemes must not run a global "delete anything nothing currently references"
// sweep, since it runs mid-transaction, per-work, from deepScan.ts (via unionWorkThemes)
// and lightScan.ts — at a point where THIS work's own idea-level theme links
// (idea_theme_links) may already be cleared (purgeDeepData) but not yet rewritten. A
// theme used only by this work looks globally unreferenced at that exact moment, even
// though it is about to be re-added a few lines later in the same transaction.
//
// Drives the REAL themesRepo functions (getOrCreateTheme, setWorkThemes,
// pruneOrphanThemes) against a scratch DB. Runs under Electron-as-Node so
// better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-theme-integrity-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-theme-integrity.mjs'), '--electron-theme-integrity-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-theme-integrity-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'themes.sqlite'));

  db.exec(`
    CREATE TABLE themes (
      theme_id   TEXT PRIMARY KEY,
      label      TEXT UNIQUE,
      created_at TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE work_themes (
      nodus_id TEXT,
      theme_id TEXT,
      PRIMARY KEY (nodus_id, theme_id)
    );
    CREATE TABLE idea_theme_links (
      nodus_id   TEXT NOT NULL,
      global_id  TEXT NOT NULL,
      theme_id   TEXT NOT NULL,
      confidence REAL NOT NULL,
      basis      TEXT NOT NULL,
      PRIMARY KEY (nodus_id, global_id, theme_id)
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, source_json TEXT, trashed_at TEXT);
  `);

  const repoModule = await bundleThemesRepo();
  globalThis.__themeIntegrityTestDb = db;
  const repo = await import(pathToFileURL(repoModule).href);

  // ── 1. A per-idea theme, not part of the work-level label cap, mid-relink ───────
  // Simulates deepScan.ts's exact sequence for work W: purgeDeepData already cleared
  // W's idea_theme_links (so a granular, idea-only theme has zero current references),
  // then unionWorkThemes -> setWorkThemes runs with the work-level top-N labels
  // (capped, e.g. 4) — BEFORE the per-idea loop re-adds each idea's own, possibly much
  // more specific, theme a few lines later in the SAME transaction. A theme that isn't
  // among those top-N labels (most per-idea themes aren't) looks globally unreferenced
  // at that exact moment even though it's about to be restored.
  const themeId = repo.getOrCreateTheme('Enzyme kinetics');
  assert.ok(db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(themeId), 'theme created');
  // (work W's idea_theme_links for 'Enzyme kinetics' were already deleted by
  // purgeDeepData; nothing currently references it — matching that exact moment)
  repo.setWorkThemes('w1', ['Broad label A', 'Broad label B']); // the capped work-level set; does not include Enzyme kinetics
  assert.ok(
    db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(themeId),
    'setWorkThemes must not delete a theme just because it is not part of the work-level label cap and has zero references yet — the per-idea loop that restores it runs moments later, in the same transaction'
  );
  assert.equal(
    repo.getOrCreateTheme('Enzyme kinetics'),
    themeId,
    'the SAME theme_id survives — no unnecessary churn from a theme that was never actually gone'
  );

  // ── 2. A theme another, untouched work's idea_theme_links still needs ────────────
  // Passes even before the fix (the other work's row protects it structurally), kept
  // as a sanity check that removing the embedded sweep doesn't change this case.
  const sharedTheme = repo.getOrCreateTheme('Peptide stability');
  db.prepare("INSERT INTO idea_theme_links VALUES ('w-other', 'idea-other', ?, 0.8, 'explicit')").run(sharedTheme);
  repo.setWorkThemes('w2', []); // w2 has nothing to do with this theme at all
  assert.ok(
    db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(sharedTheme),
    "an unrelated work's setWorkThemes call must never touch a theme it has nothing to do with"
  );

  // ── 3. Cleanup still happens — just in the right place ───────────────────────────
  // Genuinely orphaned themes (nothing anywhere references them) are still removable —
  // reprocessConnections.ts's own explicit pruneOrphanThemes() call, run once after a
  // complete pass, is unaffected by removing setWorkThemes's embedded sweep.
  const trulyOrphan = repo.getOrCreateTheme('Unused label');
  repo.pruneOrphanThemes();
  assert.equal(
    db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(trulyOrphan),
    undefined,
    'an explicit, correctly-ordered prune still removes a genuinely unused theme'
  );
  // A pinned theme is never pruned, even with zero references — unchanged behavior.
  const pinned = repo.getOrCreateTheme('Pinned label');
  db.prepare('UPDATE themes SET pinned = 1 WHERE theme_id = ?').run(pinned);
  repo.pruneOrphanThemes();
  assert.ok(db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(pinned), 'a pinned theme survives pruning');

  db.close();
  console.log('theme integrity (setWorkThemes no longer prunes globally) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function bundleThemesRepo() {
  const dbStub = path.join(root, 'stub-database.js');
  await writeFile(dbStub, 'export function getDb() { return globalThis.__themeIntegrityTestDb; }\n');
  const settingsStub = path.join(root, 'stub-settings.js');
  await writeFile(settingsStub, "export function getSettings() { return { academicMode: 'auto' }; }\n");
  const out = path.join(root, 'themesRepo.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/db/themesRepo.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [
      {
        name: 'test-stubs',
        setup(pluginBuild) {
          // Matched by suffix, not an exact relative form: themesRepo.ts imports
          // database.ts as './database' (same dir), while academicMode.ts imports
          // settingsRepo.ts as '../db/settingsRepo' (from electron/ai/) — different
          // importers, different relative prefixes, same target modules.
          pluginBuild.onResolve({ filter: /\/database$/ }, () => ({ path: dbStub }));
          pluginBuild.onResolve({ filter: /\/settingsRepo$/ }, () => ({ path: settingsStub }));
        },
      },
    ],
  });
  return out;
}
