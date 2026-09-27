#!/usr/bin/env node
// Whole-library idea-graph consistency audit — Phase 1 of the stray-analysis plan.
//
// assertDeepDataIntegrity() (electron/db/ideasRepo.ts) runs these same 9 checks, but
// SCOPED to one work, and only at the moment that work is (re)scanned. Nothing ever
// re-validates a work that already finished — so a LATER, unrelated purge can silently
// break an earlier, already-audited work's data (the class of bug fixed in PR #962),
// and any drift that predates 2026-09-02 (when assertDeepDataIntegrity was added) was
// never checked at all. This script runs the identical checks with no work-scoping,
// against a vault's real database, read-only, so it can be run anytime without risk —
// including while a scan is in progress.
//
// This is detection only. It never writes anything. A narrower, separate repair pass
// (reviving an idea that's dormant but still referenced by a live edge — provably safe,
// matching the invariant PR #962 now enforces going forward) is a deliberately separate
// follow-up, not part of this script.
//
// Mirrors assertDeepDataIntegrity's check list exactly (electron/db/ideasRepo.ts). If
// that function's checks ever change, update the CHECKS array below to match — this
// duplication is intentional: the two run in very different contexts (inside a write
// transaction vs. read-only over a whole vault) and don't share a runtime, so keeping
// them as plain, dependency-free SQL here is simpler and safer than threading Electron
// or vault-switching machinery through a diagnostic script.
//
// Usage:
//   node scripts/audit-graph-integrity.mjs                   # every vault in vaults.json
//   node scripts/audit-graph-integrity.mjs --db <path>       # one specific sqlite file
//   node scripts/audit-graph-integrity.mjs --user-data <dir> # override the userData dir
//   node scripts/audit-graph-integrity.mjs --json            # machine-readable output
//
// Exit code: 0 if every vault is clean, 1 if any violation (or stuck job) was found,
// 2 if no vault could be located at all.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// better-sqlite3 in this repo is compiled against Electron's Node ABI, not the system
// node — re-exec through Electron-as-Node so the native binary matches, same as every
// other script here that touches a real database (test-idea-identity.mjs, etc.).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--electron-audit-graph-integrity')) {
  // The child's own exit code IS the report's verdict (0 clean / 1 violations found /
  // 2 no vault) — status.status here, not a thrown error, is the normal outcome for a
  // report tool (unlike the test scripts this pattern is borrowed from, where a
  // non-zero exit is itself the failure being reported).
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-graph-integrity.mjs'), '--electron-audit-graph-integrity', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const { default: Database } = await import('better-sqlite3');

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
  // No registry (a very old profile, or a fresh userData dir): fall back to the
  // single-vault layout the app used before multi-vault support.
  const fallback = path.join(userData, 'nodus.sqlite');
  return fs.existsSync(fallback) ? [{ id: 'default', name: 'My vault', path: fallback }] : [];
}

// Each check's `count` is the exact WHERE-clause shape assertDeepDataIntegrity uses,
// minus the nodus_id / source_work parameter. `detail` adds a `works` join so
// violations can be reported by title, and a `reason` column distinguishing "the
// target doesn't exist at all" (unrecoverable — the reference itself is stale) from
// "the target exists but is dormant" (the class PR #961/#962 address; potentially
// repairable by reviving it, which this script does not do).
const CHECKS = [
  {
    label: 'occurrences→ideas',
    count: `SELECT COUNT(*) AS n FROM idea_occurrences io
      LEFT JOIN ideas i ON i.global_id = io.global_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL`,
    detail: `SELECT io.nodus_id, w.title, io.global_id,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM idea_occurrences io
      LEFT JOIN ideas i ON i.global_id = io.global_id
      LEFT JOIN works w ON w.nodus_id = io.nodus_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'evidence→ideas',
    count: `SELECT COUNT(*) AS n FROM evidence ev
      LEFT JOIN ideas i ON i.global_id = ev.global_id
      WHERE ev.global_id IS NOT NULL AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`,
    detail: `SELECT ev.nodus_id, w.title, ev.id AS evidence_id, ev.global_id,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM evidence ev
      LEFT JOIN ideas i ON i.global_id = ev.global_id
      LEFT JOIN works w ON w.nodus_id = ev.nodus_id
      WHERE ev.global_id IS NOT NULL AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'edges→active ideas',
    count: `SELECT COUNT(*) AS n FROM edges e
      LEFT JOIN ideas src ON src.global_id = e.from_id
      LEFT JOIN ideas dst ON dst.global_id = e.to_id
      WHERE src.global_id IS NULL OR dst.global_id IS NULL
        OR src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL`,
    detail: `SELECT e.source_work AS nodus_id, w.title, e.id AS edge_id, e.from_id, e.to_id,
        CASE
          WHEN src.global_id IS NULL THEN 'from_id missing'
          WHEN dst.global_id IS NULL THEN 'to_id missing'
          WHEN src.orphaned_at IS NOT NULL THEN 'from_id dormant'
          ELSE 'to_id dormant'
        END AS reason
      FROM edges e
      LEFT JOIN ideas src ON src.global_id = e.from_id
      LEFT JOIN ideas dst ON dst.global_id = e.to_id
      LEFT JOIN works w ON w.nodus_id = e.source_work
      WHERE src.global_id IS NULL OR dst.global_id IS NULL
        OR src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'theme links→ideas',
    count: `SELECT COUNT(*) AS n FROM idea_theme_links itl
      LEFT JOIN ideas i ON i.global_id = itl.global_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL`,
    detail: `SELECT itl.nodus_id, w.title, itl.global_id,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM idea_theme_links itl
      LEFT JOIN ideas i ON i.global_id = itl.global_id
      LEFT JOIN works w ON w.nodus_id = itl.nodus_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'gaps→ideas',
    count: `SELECT COUNT(*) AS n FROM gaps g
      LEFT JOIN ideas i ON i.global_id = g.related_idea
      WHERE g.related_idea IS NOT NULL AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`,
    detail: `SELECT g.nodus_id, w.title, g.id AS gap_id, g.related_idea,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM gaps g
      LEFT JOIN ideas i ON i.global_id = g.related_idea
      LEFT JOIN works w ON w.nodus_id = g.nodus_id
      WHERE g.related_idea IS NOT NULL AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'gaps→evidence',
    count: `SELECT COUNT(*) AS n FROM gaps g
      LEFT JOIN evidence ev ON ev.id = g.evidence_id
      WHERE g.evidence_id IS NOT NULL AND ev.id IS NULL`,
    detail: `SELECT g.nodus_id, w.title, g.id AS gap_id, g.evidence_id
      FROM gaps g
      LEFT JOIN evidence ev ON ev.id = g.evidence_id
      LEFT JOIN works w ON w.nodus_id = g.nodus_id
      WHERE g.evidence_id IS NOT NULL AND ev.id IS NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'external refs→ideas',
    count: `SELECT COUNT(*) AS n FROM external_refs er
      LEFT JOIN ideas i ON i.global_id = er.from_idea
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL`,
    detail: `SELECT er.nodus_id, w.title, er.id AS ref_id, er.from_idea,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM external_refs er
      LEFT JOIN ideas i ON i.global_id = er.from_idea
      LEFT JOIN works w ON w.nodus_id = er.nodus_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'external refs→evidence',
    count: `SELECT COUNT(*) AS n FROM external_refs er
      LEFT JOIN evidence ev ON ev.id = er.evidence_id
      WHERE er.evidence_id IS NOT NULL AND ev.id IS NULL`,
    detail: `SELECT er.nodus_id, w.title, er.id AS ref_id, er.evidence_id
      FROM external_refs er
      LEFT JOIN evidence ev ON ev.id = er.evidence_id
      LEFT JOIN works w ON w.nodus_id = er.nodus_id
      WHERE er.evidence_id IS NOT NULL AND ev.id IS NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'edge traces→edges',
    count: `SELECT COUNT(*) AS n FROM edge_traces et
      LEFT JOIN edges e ON e.id = et.edge_id WHERE e.id IS NULL`,
    detail: `SELECT et.edge_id
      FROM edge_traces et
      LEFT JOIN edges e ON e.id = et.edge_id
      WHERE e.id IS NULL LIMIT 200`,
  },
];

// A different, simpler signal from a different failure mode: a job an app crash left
// behind mid-scan rather than one a running process is genuinely still advancing.
// Not part of assertDeepDataIntegrity — that only ever checks the graph, never job
// bookkeeping — but it is the other way an analysis can go stray, so it belongs in the
// same sweep.
const STUCK_JOB_MINUTES = 30;
const STUCK_JOBS_SQL = `
  SELECT j.job_id, j.status, j.phase, w.title, j.updated_at
  FROM document_index_jobs j
  LEFT JOIN works w ON w.nodus_id = j.nodus_id
  WHERE j.status = 'running'
    AND j.updated_at < datetime('now', '-${STUCK_JOB_MINUTES} minutes')
  ORDER BY j.updated_at
`;

function auditVault(vault) {
  if (!fs.existsSync(vault.path)) {
    return { vault, error: `database file not found: ${vault.path}` };
  }
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  try {
    const results = CHECKS.map((check) => {
      const n = db.prepare(check.count).get().n;
      const rows = n > 0 ? db.prepare(check.detail).all() : [];
      return { label: check.label, count: n, rows };
    });
    const stuckJobs = db.prepare(STUCK_JOBS_SQL).all();
    return { vault, results, stuckJobs };
  } finally {
    db.close();
  }
}

function groupByWork(rows) {
  const byWork = new Map();
  for (const row of rows) {
    const key = row.title ?? row.nodus_id ?? '(no work)';
    if (!byWork.has(key)) byWork.set(key, []);
    byWork.get(key).push(row);
  }
  return byWork;
}

function printReport(audit) {
  const { vault } = audit;
  console.log(`\n=== ${vault.name} (${vault.path}) ===`);
  if (audit.error) {
    console.log(`  ! ${audit.error}`);
    return;
  }
  let anyViolations = false;
  for (const { label, count, rows } of audit.results) {
    if (count === 0) {
      console.log(`  ${label.padEnd(26)} clean`);
      continue;
    }
    anyViolations = true;
    console.log(`  ${label.padEnd(26)} ${count} violation${count === 1 ? '' : 's'}`);
    for (const [work, workRows] of groupByWork(rows)) {
      const shownNote = workRows.length >= 200 ? '+ (truncated at 200)' : '';
      console.log(`      ${work}: ${workRows.length}${shownNote}`);
    }
  }
  if (audit.stuckJobs.length > 0) {
    anyViolations = true;
    console.log(`  stuck jobs (running > ${STUCK_JOB_MINUTES}min, possible crash):`);
    for (const job of audit.stuckJobs) {
      console.log(`      ${job.title ?? job.job_id} — last update ${job.updated_at}`);
    }
  }
  if (!anyViolations) console.log('  all clear.');
}

const vaults = discoverVaults();
if (vaults.length === 0) {
  console.error('No vaults found. Pass --db <path> or --user-data <dir>.');
  process.exit(2);
}

const audits = vaults.map(auditVault);

if (asJson) {
  console.log(JSON.stringify(audits, null, 2));
} else {
  for (const audit of audits) printReport(audit);
}

const anyViolations = audits.some(
  (a) => a.error || (a.results && a.results.some((r) => r.count > 0)) || (a.stuckJobs && a.stuckJobs.length > 0)
);
process.exit(anyViolations ? 1 : 0);
