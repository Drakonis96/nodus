#!/usr/bin/env node
// Fixes the two kinds of drift found so far that a pure SQL repair (see
// scripts/repair-graph-integrity.mjs) can't touch, because the only real fix is to
// have the real app re-derive something with a real model call:
//
// 1. Theme links→themes: idea_theme_links rows whose theme_id no longer exists
//    (electron/db/themesRepo.ts's setWorkThemes ran a global "delete anything
//    unreferenced" sweep mid per-work scan — fixed going forward in PR #965, but that
//    does nothing for works already affected). reprocessConnections() re-derives theme
//    labels, scoped to a list of works, reusing a cached decision per idea where
//    nothing relevant changed — cheaper than a full ideas/deep rescan since it only
//    touches the theme layer.
//
// 2. Stale/failed Documentary Index profiles: documentProfile.ts's legitimate,
//    working end-of-analysis staleness guard (source or ideas changed while a long
//    analysis was running) requeues a job, which can cycle repeatedly — and eventually
//    pause — while a session does many ideas rescans across the same books a
//    Documentary Index pass is also running on. The fix is exactly what a person
//    already does by hand: re-trigger the scan once the ideas side has settled
//    (window.nodus.enqueueDocumentProfile — what "Scan complete work" / "Retry" calls).
//
// Both need the app's real settings AND real, safeStorage-encrypted API keys — not
// reachable from the lightweight Electron-as-Node scripts used elsewhere in this repo
// (their `electron` stub's safeStorage is a no-op, fine for a scratch profile with an
// injected key, not for decrypting a real one). So this script drives the REAL
// Electron app via Playwright (`_electron`), the same technique
// scripts/audit-document-understanding-live.mjs uses, calling the same IPC methods the
// UI's own actions call. The theme repair is a bounded, awaited call this script waits
// out; the document re-enqueue is fire-and-forget — a full analysis can run for hours,
// so this only queues it and moves on, same as any other queued job.
//
// Modes:
//   (default)      Dry run. Read-only: opens an online SQLite backup of the vault,
//                  reports which works are affected by each kind of drift, does not
//                  launch Electron at all.
//   --clone-test   Verifies the whole mechanism end to end WITHOUT touching the real
//                  vault: clones the profile (db + encrypted key files) to a scratch
//                  temp directory, launches Electron against the CLONE, runs the
//                  repair there, reports the result, deletes the clone. Prints a
//                  before/after audit count from the clone for the theme repair (the
//                  document re-enqueue can only be confirmed as queued, not resolved,
//                  in this mode — the analysis itself takes real time). Never opens
//                  the real file read-write.
//   --apply        Runs for real, against the live vault. Refuses if Nodus.app appears
//                  to already be running (Electron's single-instance lock would
//                  otherwise silently forward to that instance instead of running
//                  headlessly — quit the app first). Does not modify any settings.
//
// Usage:
//   node scripts/repair-analysis-drift.mjs                   # dry run, default vault
//   node scripts/repair-analysis-drift.mjs --clone-test       # safe end-to-end rehearsal
//   node scripts/repair-analysis-drift.mjs --apply            # the real thing
//   node scripts/repair-analysis-drift.mjs --db <path>        # one specific sqlite file
//   node scripts/repair-analysis-drift.mjs --user-data <dir>  # override the userData dir
//
// Exit code: 0 nothing to repair (or --apply/--clone-test resolved the theme drift —
// stale document profiles are only ever queued, not verified resolved), 1 repairable
// rows remain, 2 no vault found / precondition failed.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// better-sqlite3's native binary here is compiled against Electron's Node ABI, not the
// system node — re-exec through Electron-as-Node for the read-only parts (dry run,
// snapshotting, re-auditing), same as scripts/audit-graph-integrity.mjs and
// scripts/repair-graph-integrity.mjs. This does NOT conflict with the separate,
// REAL Electron app instance Playwright launches later in --clone-test/--apply mode:
// that child process explicitly has ELECTRON_RUN_AS_NODE deleted from its own env
// (see runReprocess below), the same pattern scripts/audit-document-understanding-live.mjs
// already uses successfully.
if (!process.argv.includes('--electron-repair-analysis-drift')) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/repair-analysis-drift.mjs'), '--electron-repair-analysis-drift', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const args = process.argv.slice(2).filter((a) => a !== '--electron-repair-analysis-drift');
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const cloneTest = args.includes('--clone-test');
const apply = args.includes('--apply');
if (cloneTest && apply) {
  console.error('--clone-test and --apply are mutually exclusive.');
  process.exit(2);
}

function defaultUserDataDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Nodus');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Nodus');
    default:
      return path.join(home, '.config', 'Nodus');
  }
}

function resolveVault() {
  const explicitDb = flag('--db');
  if (explicitDb) return { id: 'explicit', name: path.basename(explicitDb), path: path.resolve(explicitDb) };
  const userData = flag('--user-data') || defaultUserDataDir();
  const registryPath = path.join(userData, 'vaults.json');
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const active = registry.vaults?.find((v) => v.id === registry.activeVaultId) ?? registry.vaults?.[0];
    if (active) return { id: active.id, name: active.name, path: active.path, userData, registry, active };
  }
  const fallback = path.join(userData, 'nodus.sqlite');
  if (fs.existsSync(fallback)) return { id: 'default', name: 'My vault', path: fallback, userData };
  return null;
}

async function onlineBackup(sourcePath, targetPath) {
  const Database = require('better-sqlite3');
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('query_only = ON');
    await source.backup(targetPath);
  } finally {
    source.close();
  }
}

function affectedWorks(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT itl.nodus_id, w.title, COUNT(*) AS n
           FROM idea_theme_links itl
           LEFT JOIN themes t ON t.theme_id = itl.theme_id
           LEFT JOIN works w ON w.nodus_id = itl.nodus_id
          WHERE t.theme_id IS NULL
          GROUP BY itl.nodus_id
          ORDER BY n DESC`
      )
      .all();
    const ideaCount = db
      .prepare(
        `SELECT COUNT(DISTINCT global_id) AS n
           FROM idea_theme_links itl
           LEFT JOIN themes t ON t.theme_id = itl.theme_id
          WHERE t.theme_id IS NULL`
      )
      .get().n;
    return { works: rows, danglingLinks: rows.reduce((sum, r) => sum + r.n, 0), affectedIdeas: ideaCount };
  } finally {
    db.close();
  }
}

// A SEPARATE, unrelated failure mode that also needs a real app session to fix, so it
// shares this script's Electron-launch machinery rather than getting its own tool.
//
// documentProfile.ts re-resolves a work's source and re-checks its fingerprint
// (zotero_version, deep_hash, resolved_text_hash, ...) at the very end of a long
// Documentary Index analysis — a legitimate, working guard: if the underlying ideas
// were rescanned (deep_hash changed) or the source text changed WHILE the analysis was
// running, publishing the profile now would attach it to a state that's already gone
// stale. It throws DOCUMENT_SOURCE_CHANGED, and documentIndexQueue.ts requeues the job.
//
// This is not a bug to fix in code — the alternative (publish anyway) would be wrong.
// It fires often in a session doing many ideas rescans across the same books a long
// Documentary Index pass is also running on, and normally self-heals via the queue's
// own auto-requeue — but can cycle repeatedly (and eventually pause once retries are
// exhausted) if a work's ideas keep changing before its Documentary Index pass gets a
// clean run. The fix is exactly what a person already does by hand: re-trigger the
// scan (window.nodus.enqueueDocumentProfile — literally what the "Scan complete work"
// / "Retry" button calls) once the ideas side has actually settled.
//
// Unlike the theme repair above (a bounded, awaited call this script waits out), a
// full Documentary Index pass can run for hours — this script does not wait for it.
// It only enqueues (a near-instant DB write) and moves on; the actual analysis runs
// under whichever Nodus session opens next, exactly like any other queued job.
function staleDocumentProfiles(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT s.nodus_id, w.title, s.status, s.stale_reason, s.updated_at
           FROM document_profile_state s
           LEFT JOIN works w ON w.nodus_id = s.nodus_id
          WHERE s.status IN ('stale', 'failed')
          ORDER BY s.updated_at DESC`
      )
      .all();
  } finally {
    db.close();
  }
}

function printStaleDocs(rows) {
  if (rows.length === 0) return;
  console.log(`\n  ${rows.length} document profile(s) stale or failed (re-enqueue only, not awaited):`);
  for (const r of rows) console.log(`      ${r.title ?? r.nodus_id}: ${r.status}${r.stale_reason ? ` (${r.stale_reason})` : ''}`);
}

// How many of the SPECIFIC ids just enqueued still show stale/failed — not the whole
// vault's count, which would include ones this run never touched.
function stillStaleAmong(dbPath, nodusIds) {
  if (nodusIds.length === 0) return 0;
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = nodusIds.map(() => '?').join(',');
    return db
      .prepare(`SELECT COUNT(*) AS n FROM document_profile_state WHERE nodus_id IN (${placeholders}) AND status IN ('stale', 'failed')`)
      .get(...nodusIds).n;
  } finally {
    db.close();
  }
}

function danglingCount(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM idea_theme_links itl
           LEFT JOIN themes t ON t.theme_id = itl.theme_id
          WHERE t.theme_id IS NULL`
      )
      .get().n;
  } finally {
    db.close();
  }
}

function printAffected(found, label) {
  console.log(`\n=== ${label} ===`);
  if (found.works.length === 0) {
    console.log('  nothing to repair.');
    return;
  }
  console.log(`  ${found.danglingLinks} dangling link(s) across ${found.affectedIdeas} idea(s), ${found.works.length} work(s):`);
  for (const w of found.works) console.log(`      ${w.title ?? w.nodus_id}: ${w.n}`);
}

function isNodusRunning() {
  try {
    const out = execFileSync('pgrep', ['-f', 'Nodus.app/Contents/MacOS/Nodus'], { encoding: 'utf8' }).trim();
    return out.length > 0;
  } catch {
    return false; // pgrep exits non-zero when nothing matches
  }
}

async function runReprocess(profileUserData, nodusIds, staleDocIds) {
  const { _electron: electron } = require(path.join(repoRoot, 'node_modules/playwright-core/index.js'));
  const env = { ...process.env, NODUS_USERDATA: profileUserData, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    executablePath: require(path.join(repoRoot, 'node_modules/electron')),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 10 * 60_000,
  });
  try {
    const page = await electronApp.firstWindow({ timeout: 10 * 60_000 });
    // Forward the renderer's own console — the only visibility this script has into
    // what's happening behind the window without it. Learned the hard way: a first
    // --clone-test run sat for 23 minutes with zero outbound network activity and the
    // main process at ~7s of CPU time total — genuinely stuck, not just slow — with
    // nothing printed here to say so.
    page.on('console', (msg) => console.log(`  [renderer:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.log('  [renderer:pageerror]', err.message));
    page.setDefaultTimeout(30 * 60_000);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
    // A fresh-looking profile can surface more than one first-run modal in sequence
    // (onboarding tutorial, "what's new" release notes, announcements, ...) — each one
    // blocks the app the same way the tutorial screen did. Rather than chase every
    // localStorage/version-check flag that gates a specific dialog (a moving target as
    // the app changes), dismiss whatever's actually on screen generically: press
    // Escape and click any visible close ("X") button a few times, with short pauses
    // for a next modal to render, before ever touching window.nodus.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Escape').catch(() => {});
      const closeButton = page.locator('button[aria-label="Close" i], button[aria-label="Cerrar" i], [role="dialog"] button:has-text("×")').first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click().catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    let result = null;
    if (nodusIds.length > 0) {
      console.log(`  reprocessing ${nodusIds.length} work(s), themes only (relations: false)...`);
      // Bounded: fail loudly and quickly rather than sit silently — this exact call
      // hung once already.
      const REPROCESS_TIMEOUT_MS = 15 * 60_000;
      result = await Promise.race([
        page.evaluate(
          ({ ids }) => window.nodus.reprocessThemeConnections({ relations: false, nodusIds: ids }, null),
          { ids: nodusIds }
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`reprocessThemeConnections did not resolve within ${REPROCESS_TIMEOUT_MS / 60_000} minutes`)),
            REPROCESS_TIMEOUT_MS
          )
        ),
      ]);
      console.log('  result:', JSON.stringify(result));
    }
    if (staleDocIds.length > 0) {
      // Fire-and-forget: this only queues each job (a near-instant DB write via IPC),
      // it does not wait for the analysis itself, which can take hours.
      console.log(`  re-enqueuing ${staleDocIds.length} stale document profile(s)...`);
      await page.evaluate(
        ({ ids }) => Promise.all(ids.map((id) => window.nodus.enqueueDocumentProfile(id))),
        { ids: staleDocIds }
      );
      console.log('  queued — the analysis itself will run the next time a Nodus session is open.');
    }
    return result;
  } finally {
    await electronApp.close();
  }
}

async function cloneProfile(vault, snapshotPath) {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-theme-repair-'));
  const targetDb = path.join(profileRoot, 'nodus.sqlite');
  fs.copyFileSync(snapshotPath, targetDb);

  const registry = {
    formatVersion: 1,
    activeVaultId: vault.id,
    vaults: [{
      id: vault.id,
      name: `${vault.name} · theme-repair rehearsal`,
      path: targetDb,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      legacy: true,
      type: 'academic',
      origin: 'local',
    }],
  };
  fs.writeFileSync(path.join(profileRoot, 'vaults.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  // Copy whatever encrypted key files exist — provider-agnostic, unlike the
  // gemini/openrouter-only pattern in audit-document-understanding-live.mjs, since
  // this script doesn't know in advance which provider the user's own settings use.
  const sourceSecrets = path.join(vault.userData, 'secrets');
  const targetSecrets = path.join(profileRoot, 'secrets');
  if (fs.existsSync(sourceSecrets)) {
    fs.mkdirSync(targetSecrets, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(sourceSecrets)) {
      fs.copyFileSync(path.join(sourceSecrets, entry), path.join(targetSecrets, entry));
      try { fs.chmodSync(path.join(targetSecrets, entry), 0o600); } catch { /* best effort */ }
    }
  }

  // The onboarding/first-run tutorial is gated by markers OUTSIDE the sqlite
  // settings table (confirmed: the real profile's settings.app already has
  // onboardingComplete: true, yet a clone with only nodus.sqlite + secrets/ still
  // showed the "choose a language for the tutorial" screen) — small, non-sensitive
  // top-level files. Copy them so the launched instance behaves like an established
  // profile instead of a fresh install.
  for (const name of ['app-prefs.json', 'nodi-welcome.seed', 'tutorial-catalogue.json']) {
    const source = path.join(vault.userData, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(profileRoot, name));
  }
  return { profileRoot, targetDb };
}

async function main() {
  const vault = resolveVault();
  if (!vault) {
    console.error('No vault found. Pass --db <path> or --user-data <dir>.');
    process.exit(2);
  }
  if (!vault.userData) vault.userData = path.dirname(vault.path);

  // Read-only snapshot via SQLite's own backup API — never open the live file
  // read-write from this script, in any mode.
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-theme-repair-snapshot-'));
  const snapshotPath = path.join(scratchRoot, 'snapshot.sqlite');
  await onlineBackup(vault.path, snapshotPath);

  const found = affectedWorks(snapshotPath);
  printAffected(found, `${vault.name} (${vault.path})`);
  const staleDocs = staleDocumentProfiles(snapshotPath);
  printStaleDocs(staleDocs);

  if (found.works.length === 0 && staleDocs.length === 0) {
    console.log('\n  nothing to repair.');
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    process.exit(0);
  }

  if (!cloneTest && !apply) {
    console.log('\n  dry run only — re-run with --clone-test to rehearse safely, or --apply to repair the real vault.');
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    process.exit(1);
  }

  const limit = flag('--limit') ? Number(flag('--limit')) : null;
  const nodusIds = (limit ? found.works.slice(0, limit) : found.works).map((w) => w.nodus_id);
  const staleDocIds = (limit ? staleDocs.slice(0, limit) : staleDocs).map((d) => d.nodus_id);
  if (limit) console.log(`\n  --limit ${limit}: scoping to ${nodusIds.length} theme work(s) and ${staleDocIds.length} stale doc(s) for a quick rehearsal.`);

  if (cloneTest) {
    console.log('\n  cloning profile (db + encrypted keys) to a scratch directory — the real vault is never opened read-write...');
    const { profileRoot, targetDb } = await cloneProfile(vault, snapshotPath);
    try {
      await runReprocess(profileRoot, nodusIds, staleDocIds);
      const remaining = danglingCount(targetDb);
      console.log(`\n  clone re-audit: ${remaining} dangling link(s) remain (was ${found.danglingLinks}).`);
      if (staleDocIds.length > 0) {
        const stillStale = stillStaleAmong(targetDb, staleDocIds);
        console.log(
          `  clone re-check: ${stillStale} of ${staleDocIds.length} enqueued work(s) still show stale/failed\n` +
          `  (some may already show a different status right away — the queue write succeeding\n` +
          `  without error is what this mode actually verifies; the analysis itself takes real time\n` +
          `  and this script does not wait for it).`
        );
      }
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      fs.rmSync(profileRoot, { recursive: true, force: true });
      process.exit(remaining > 0 ? 1 : 0);
    } catch (error) {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      fs.rmSync(profileRoot, { recursive: true, force: true });
      throw error;
    }
  }

  // --apply: against the real vault.
  if (isNodusRunning()) {
    console.error(
      '\n  Nodus.app appears to be running. Quit it fully first — launching a second\n' +
      '  instance against the same profile would hit its single-instance lock and\n' +
      '  silently forward to the running one instead of running headlessly.'
    );
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    process.exit(2);
  }
  console.log('\n  applying against the real vault...');
  await runReprocess(vault.userData, nodusIds, staleDocIds);
  const remaining = danglingCount(vault.path);
  console.log(`\n  re-audit: ${remaining} dangling link(s) remain (was ${found.danglingLinks}).`);
  if (staleDocIds.length > 0) {
    console.log(`  ${staleDocIds.length} document profile(s) re-enqueued — open Nodus normally to let the analysis run.`);
  }
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  process.exit(remaining > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
