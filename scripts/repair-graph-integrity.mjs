#!/usr/bin/env node
// Phase 2 of the stray-analysis plan: a narrow, provably-safe repair for exactly the
// class of drift the Phase 1 audit (scripts/audit-graph-integrity.mjs) finds under
// "edges→active ideas" for the reason "dormant" (not "missing"): an idea that is
// marked orphaned but is still the endpoint of a LIVE edge — an idea some OTHER
// work's edge depends on, which purgeDeepData's dormancy sweep wrongly re-flagged
// before PR #962 closed that gap.
//
// The repair is the exact mirror of the exclusion PR #962 added to purgeDeepData:
//   UPDATE ideas SET orphaned_at = NULL
//   WHERE orphaned_at IS NOT NULL
//     AND (global_id IN (SELECT from_id FROM edges) OR global_id IN (SELECT to_id FROM edges))
// It only ever revives an idea that already exists and that a live edge already
// depends on — it never creates, deletes, or touches anything else (no edge, no
// occurrence, no evidence, no other idea). It is idempotent: running it twice, or
// running it when nothing needs it, is a no-op.
//
// It deliberately does NOT repair the other "missing" case from the Phase 1 audit — a
// from_id/to_id an edge references that has no row in `ideas` at all, so there is
// nothing to revive — and it never touches any of the other 8 integrity categories
// (occurrences→ideas, evidence→ideas, etc.). Run scripts/audit-graph-integrity.mjs
// first for the full picture across every category; this tool only ever acts on the
// one narrow, safe case.
//
// SAFE BY DEFAULT: dry run unless --apply is passed. Even with --apply, the write is
// a single transaction and only ever sets orphaned_at = NULL on rows matching the
// query above.
//
// Do not run --apply while a scan is in progress in the real app (SQLite's own
// locking prevents corruption either way — worst case is a "database is locked"
// error — but a scan mid-purge is exactly the moment this tool's target set is
// changing under it, so results could be stale by the time they're printed).
//
// Usage:
//   node scripts/repair-graph-integrity.mjs                   # dry run, every vault
//   node scripts/repair-graph-integrity.mjs --apply            # actually repair
//   node scripts/repair-graph-integrity.mjs --db <path>        # one specific sqlite file
//   node scripts/repair-graph-integrity.mjs --user-data <dir>  # override the userData dir
//   node scripts/repair-graph-integrity.mjs --json             # machine-readable output
//
// Exit code: 0 nothing to repair (or --apply resolved everything), 1 repairable rows
// remain (dry run found some, or --apply left something unresolved), 2 no vault found.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// better-sqlite3 in this repo is compiled against Electron's Node ABI, not the system
// node — re-exec through Electron-as-Node so the native binary matches, same as
// scripts/audit-graph-integrity.mjs and every other script here that touches a real
// database.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--electron-repair-graph-integrity')) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/repair-graph-integrity.mjs'), '--electron-repair-graph-integrity', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const { default: Database } = await import('better-sqlite3');

const args = process.argv.slice(2).filter((a) => a !== '--electron-repair-graph-integrity');
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const asJson = args.includes('--json');
const apply = args.includes('--apply');

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

function discoverVaults() {
  const explicitDb = flag('--db');
  if (explicitDb) {
    return [{ id: 'explicit', name: path.basename(explicitDb), path: path.resolve(explicitDb) }];
  }
  const userData = flag('--user-data') || defaultUserDataDir();
  const registryPath = path.join(userData, 'vaults.json');
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (Array.isArray(registry.vaults) && registry.vaults.length > 0) {
      return registry.vaults.map((v) => ({ id: v.id, name: v.name, path: v.path }));
    }
  }
  const fallback = path.join(userData, 'nodus.sqlite');
  return fs.existsSync(fallback) ? [{ id: 'default', name: 'My vault', path: fallback }] : [];
}

// The exact set this tool acts on: an idea that IS orphaned but is still an edge's
// from_id or to_id. Distinct from "missing" — a global_id an edge references that has
// no row in `ideas` at all — which this UPDATE cannot touch (there is no row to set
// orphaned_at on) and which this tool does not attempt to fix.
const REPAIRABLE_SQL = `
  SELECT global_id, label FROM ideas
  WHERE orphaned_at IS NOT NULL
    AND (global_id IN (SELECT from_id FROM edges) OR global_id IN (SELECT to_id FROM edges))
`;

// Which works have an edge into one of the repairable ideas above, for reporting.
const AFFECTED_WORKS_SQL = `
  SELECT DISTINCT e.source_work AS nodus_id, w.title
  FROM edges e
  JOIN ideas s ON s.global_id = e.from_id
  JOIN ideas d ON d.global_id = e.to_id
  LEFT JOIN works w ON w.nodus_id = e.source_work
  WHERE s.orphaned_at IS NOT NULL OR d.orphaned_at IS NOT NULL
  ORDER BY w.title
`;

const REPAIR_SQL = `
  UPDATE ideas SET orphaned_at = NULL
  WHERE orphaned_at IS NOT NULL
    AND (global_id IN (SELECT from_id FROM edges) OR global_id IN (SELECT to_id FROM edges))
`;

function inspectVault(vault) {
  if (!fs.existsSync(vault.path)) {
    return { vault, error: `database file not found: ${vault.path}` };
  }
  // Read-only unless --apply: the default run can never write, no matter what else
  // is passed.
  const db = new Database(vault.path, { readonly: !apply, fileMustExist: true });
  try {
    const before = db.prepare(REPAIRABLE_SQL).all();
    const affectedWorks = db.prepare(AFFECTED_WORKS_SQL).all();
    let after = before;
    let applied = false;
    if (apply && before.length > 0) {
      const tx = db.transaction(() => {
        db.prepare(REPAIR_SQL).run();
      });
      tx();
      applied = true;
      after = db.prepare(REPAIRABLE_SQL).all();
    }
    return { vault, before, after, affectedWorks, applied };
  } finally {
    db.close();
  }
}

function printReport(result) {
  const { vault } = result;
  console.log(`\n=== ${vault.name} (${vault.path}) ===`);
  if (result.error) {
    console.log(`  ! ${result.error}`);
    return;
  }
  if (result.before.length === 0) {
    console.log('  nothing to repair.');
    return;
  }
  console.log(`  ${result.before.length} idea(s) currently dormant but still edge-referenced:`);
  for (const work of result.affectedWorks) {
    console.log(`      affects: ${work.title ?? work.nodus_id}`);
  }
  if (result.applied) {
    const revived = result.before.length - result.after.length;
    console.log(`  applied: revived ${revived} of ${result.before.length}`);
    if (result.after.length > 0) {
      console.log(`  ! ${result.after.length} still unresolved after repair — investigate before trusting this vault's graph`);
    }
  } else {
    console.log('  dry run only — re-run with --apply to revive these.');
  }
}

const vaults = discoverVaults();
if (vaults.length === 0) {
  console.error('No vaults found. Pass --db <path> or --user-data <dir>.');
  process.exit(2);
}

const results = vaults.map(inspectVault);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) printReport(result);
}

const anyRemaining = results.some((r) => r.error || (r.after && r.after.length > 0));
process.exit(anyRemaining ? 1 : 0);
