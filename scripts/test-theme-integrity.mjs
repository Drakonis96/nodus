// Theme cleanup runs once, at the end of the transaction that rewrote a work's theme
// links, not inside setWorkThemes. deepScan.ts calls setWorkThemes (via unionWorkThemes)
// before it writes the work's per-idea links, and lightScan.ts / reprocessConnections.ts
// prune after their own writes. These cases pin both halves: setWorkThemes leaves themes
// alone, and pruneOrphanThemes removes exactly the themes nothing references any more.
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

  // ── 1. setWorkThemes does not prune mid-transaction ───────────────────────────────
  // In deepScan.ts, purgeDeepData has already cleared the work's idea links when
  // unionWorkThemes -> setWorkThemes runs; the per-idea links are written afterwards in
  // the same transaction. A theme with no reference at that moment must survive, so
  // it keeps its theme_id instead of being deleted and minted again.
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
  // Another work's idea link protects the theme; an unrelated setWorkThemes and the
  // prune both have to leave it alone.
  const sharedTheme = repo.getOrCreateTheme('Peptide stability');
  db.prepare("INSERT INTO idea_theme_links VALUES ('w-other', 'idea-other', ?, 0.8, 'explicit')").run(sharedTheme);
  repo.setWorkThemes('w2', []); // w2 has nothing to do with this theme at all
  assert.ok(
    db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(sharedTheme),
    "an unrelated work's setWorkThemes call must never touch a theme it has nothing to do with"
  );
  repo.pruneOrphanThemes();
  assert.ok(db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(sharedTheme), 'the prune spares a theme an idea link uses');

  // ── 3. Cleanup still happens — just in the right place ───────────────────────────
  // A theme nothing references is removed by the explicit prune the writers call at
  // the end (deepScan.ts, lightScan.ts, reprocessConnections.ts); a pinned one is not.
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

  // ── 4. End-of-transaction prune after a work's themes change ─────────────────────
  // A light rescan replaces w3's broad themes. The theme only the old assignment used
  // goes; a theme an idea link still uses stays even though no work lists it.
  repo.setWorkThemes('w3', ['Old broad theme', 'Kept broad theme']);
  const oldBroad = repo.getOrCreateTheme('Old broad theme');
  const ideaOnly = repo.getOrCreateTheme('Idea-level theme');
  db.prepare("INSERT INTO idea_theme_links VALUES ('w3', 'idea-w3', ?, 0.8, 'explicit')").run(ideaOnly);
  repo.setWorkThemes('w3', ['Kept broad theme', 'New broad theme']);
  assert.ok(
    db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(oldBroad),
    'setWorkThemes itself still leaves the old theme in place'
  );
  repo.pruneOrphanThemes();
  assert.equal(db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(oldBroad), undefined, 'the theme nothing references is pruned');
  assert.ok(db.prepare('SELECT 1 FROM themes WHERE theme_id = ?').get(ideaOnly), 'a theme only an idea link uses survives');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM idea_theme_links itl LEFT JOIN themes t ON t.theme_id = itl.theme_id WHERE t.theme_id IS NULL').get().n,
    0,
    'no idea link is left pointing at a deleted theme'
  );

  db.close();
  console.log('theme integrity (prune once, at the end of the write) test passed');
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
