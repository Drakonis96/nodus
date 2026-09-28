#!/usr/bin/env node
// Whole-library idea-graph consistency audit, read-only (better-sqlite3 `readonly`), so it
// is safe to run anytime, including while a scan is in progress.
//
// It runs the app's own audit, electron/db/graphIntegrity.ts, the same code behind
// Settings › Data › Graph health, bundled on the fly with esbuild. Nothing is duplicated
// here, so the script and the app cannot disagree. Findings come in three categories:
//   repairable  fixed by the app's SQL repair (once per vault at startup, or on demand)
//   rescan      fixed only by analysing the listed works again
//   info        expected or legacy state (for example edges hidden by a dormant endpoint)
//
// Usage:
//   node scripts/audit-graph-integrity.mjs                   # every vault in vaults.json
//   node scripts/audit-graph-integrity.mjs --db <path>       # one specific sqlite file
//   node scripts/audit-graph-integrity.mjs --user-data <dir> # override the userData dir
//   node scripts/audit-graph-integrity.mjs --json            # machine-readable output
//
// Exit code: 0 if no vault has a repairable or rescan finding, 1 otherwise, 2 if no vault
// could be located at all.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// better-sqlite3 in this repo is compiled against Electron's Node ABI, not the system
// node — re-exec through Electron-as-Node so the native binary matches. The child's exit
// code is the report's verdict, so it is passed through as is.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--electron-audit-graph-integrity')) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-graph-integrity.mjs'), '--electron-audit-graph-integrity', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const { default: Database } = await import('better-sqlite3');
const { build } = await import('esbuild');

const args = process.argv.slice(2).filter((a) => a !== '--electron-audit-graph-integrity');
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const asJson = args.includes('--json');

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
  // No registry (a very old profile, or a fresh userData dir): the single-vault layout.
  const fallback = path.join(userData, 'nodus.sqlite');
  return fs.existsSync(fallback) ? [{ id: 'default', name: 'My vault', path: fallback }] : [];
}

/** Bundle the app's audit module into a temporary ESM file and load it. */
async function loadAudit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-graph-audit-'));
  try {
    const out = path.join(dir, 'graphIntegrity.mjs');
    await build({
      entryPoints: [path.join(repoRoot, 'electron/db/graphIntegrity.ts')],
      outfile: out,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'error',
      alias: { '@shared': path.join(repoRoot, 'shared') },
    });
    return await import(pathToFileURL(out).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const { auditGraphIntegrity } = await loadAudit();

function auditVault(vault) {
  if (!fs.existsSync(vault.path)) return { vault, error: `database file not found: ${vault.path}` };
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  try {
    return { vault, report: auditGraphIntegrity(db) };
  } finally {
    db.close();
  }
}

function printReport({ vault, error, report }) {
  console.log(`\n=== ${vault.name} (${vault.path}) ===`);
  if (error) {
    console.log(`  ! ${error}`);
    return;
  }
  for (const category of ['repairable', 'rescan', 'info']) {
    const findings = report.checks.filter((check) => check.category === category && check.count > 0);
    console.log(`  ${category.padEnd(10)} ${report.totals[category]}`);
    for (const check of findings) {
      console.log(`      ${check.id.padEnd(28)} ${check.count}`);
      for (const work of check.works.slice(0, 10)) console.log(`          ${work.title ?? work.nodus_id}: ${work.count}`);
    }
  }
  if (report.pendingThemeWorks.length > 0) {
    console.log(`  works waiting for their idea themes to be reassigned: ${report.pendingThemeWorks.length}`);
  }
}

const vaults = discoverVaults();
if (vaults.length === 0) {
  console.error('No vaults found. Pass --db <path> or --user-data <dir>.');
  process.exit(2);
}

const audits = vaults.map(auditVault);
if (asJson) console.log(JSON.stringify(audits, null, 2));
else for (const audit of audits) printReport(audit);

const failing = audits.some((a) => a.error || a.report.totals.repairable > 0 || a.report.totals.rescan > 0);
// exitCode, not process.exit(): exiting at once truncates a large --json report that is
// still being written to a pipe.
process.exitCode = failing ? 1 : 0;
