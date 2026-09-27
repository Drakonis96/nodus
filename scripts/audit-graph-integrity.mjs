#!/usr/bin/env node
// Whole-library idea-graph consistency audit. Read-only (better-sqlite3 `readonly`),
// so it is safe to run anytime, including while a scan is in progress.
//
// assertDeepDataIntegrity() (electron/db/ideasRepo.ts) checks one work, inside the
// transaction that rewrites it, right after that work's purge. This script checks the
// whole vault as it sits on disk, so two of its rules differ on purpose:
//
// - An edge whose endpoint is DORMANT is expected, not a violation. When a work is
//   rescanned and no longer contains an idea, the idea goes to sleep, and the edges other
//   works hold into it stay in `edges`; the `visible_edges` view hides them until a scan
//   re-attaches the idea. Those works' own rescans delete their edges first, so they
//   never trip the write-time check. They are reported as information only. An edge
//   whose endpoint is MISSING is a real violation.
// - An ACTIVE idea with no occurrence (and no note owning it as a manual idea) is a
//   violation: an idea is active exactly while some work holds it.
//
// The theme checks cover references the write path never validates. Before 5.6.0 the
// orphan-theme sweep ignored idea_theme_links and deleted themes only idea links used,
// which left links pointing at nothing. The app repairs all of these once per vault
// (electron/db/graphIntegrityRepair.ts); a clean report afterwards is the confirmation.
// Theme links of manual ideas use the 'manual' pseudo-work, which is not a missing work.
//
// Keep the checks shared with assertDeepDataIntegrity in step if that function changes.
// They are duplicated as plain SQL on purpose: this runs outside the app, read-only,
// without Electron or vault-switching machinery.
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

// Each check's `count` is the WHERE clause of the matching assertDeepDataIntegrity check
// without its work filter. `detail` adds the work title and, where it helps, whether the
// target is missing or dormant. `info` checks are reported but never count as violations.
// Ideas a note owns as a manual idea (the same exclusion purgeDeepData's dormancy sweep
// makes). Guarded with json_valid so one malformed note cannot abort the audit.
const MANUAL_IDEA_REFS = `SELECT json_extract(doc, '$.ref') FROM (
    SELECT CASE WHEN json_valid(source_json) THEN source_json END AS doc FROM notes
  ) WHERE json_extract(doc, '$.note') = 'manual-idea' AND json_extract(doc, '$.ref') IS NOT NULL`;

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
      WHERE ev.global_id IS NOT NULL AND ev.global_id <> ''
        AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`,
    detail: `SELECT ev.nodus_id, w.title, ev.id AS evidence_id, ev.global_id,
        CASE WHEN i.global_id IS NULL THEN 'missing idea' ELSE 'idea is dormant' END AS reason
      FROM evidence ev
      LEFT JOIN ideas i ON i.global_id = ev.global_id
      LEFT JOIN works w ON w.nodus_id = ev.nodus_id
      WHERE ev.global_id IS NOT NULL AND ev.global_id <> ''
        AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)
      ORDER BY w.title LIMIT 200`,
  },
  {
    // Before 2026-09-02 a gap in a work with no ideas stored its evidence under the idea
    // id ''. The gap still shows the quote, and the work's next rescan replaces it.
    label: 'gap evidence w/o idea',
    info: true,
    count: `SELECT COUNT(*) AS n FROM evidence ev WHERE ev.global_id = ''`,
    detail: `SELECT ev.nodus_id, w.title, ev.id AS evidence_id
      FROM evidence ev LEFT JOIN works w ON w.nodus_id = ev.nodus_id
      WHERE ev.global_id = '' ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'edges→ideas',
    count: `SELECT COUNT(*) AS n FROM edges e
      LEFT JOIN ideas src ON src.global_id = e.from_id
      LEFT JOIN ideas dst ON dst.global_id = e.to_id
      WHERE src.global_id IS NULL OR dst.global_id IS NULL`,
    detail: `SELECT e.source_work AS nodus_id, w.title, e.id AS edge_id, e.from_id, e.to_id,
        CASE WHEN src.global_id IS NULL THEN 'from_id missing' ELSE 'to_id missing' END AS reason
      FROM edges e
      LEFT JOIN ideas src ON src.global_id = e.from_id
      LEFT JOIN ideas dst ON dst.global_id = e.to_id
      LEFT JOIN works w ON w.nodus_id = e.source_work
      WHERE src.global_id IS NULL OR dst.global_id IS NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'edges hidden (dormant end)',
    info: true,
    count: `SELECT COUNT(*) AS n FROM edges e
      JOIN ideas src ON src.global_id = e.from_id
      JOIN ideas dst ON dst.global_id = e.to_id
      WHERE src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL`,
    detail: `SELECT e.source_work AS nodus_id, w.title, e.id AS edge_id, e.from_id, e.to_id
      FROM edges e
      JOIN ideas src ON src.global_id = e.from_id
      JOIN ideas dst ON dst.global_id = e.to_id
      LEFT JOIN works w ON w.nodus_id = e.source_work
      WHERE src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'active ideas w/o works',
    count: `SELECT COUNT(*) AS n FROM ideas i
      WHERE i.orphaned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)
        AND i.global_id NOT IN (${MANUAL_IDEA_REFS})`,
    detail: `SELECT NULL AS nodus_id, '(no work holds it)' AS title, i.global_id, i.label
      FROM ideas i
      WHERE i.orphaned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)
        AND i.global_id NOT IN (${MANUAL_IDEA_REFS})
      ORDER BY i.label LIMIT 200`,
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
  // Theme references: assertDeepDataIntegrity never checks these.
  {
    label: 'theme links→themes',
    count: `SELECT COUNT(*) AS n FROM idea_theme_links itl
      LEFT JOIN themes t ON t.theme_id = itl.theme_id
      WHERE t.theme_id IS NULL`,
    detail: `SELECT itl.nodus_id, w.title, itl.global_id, itl.theme_id
      FROM idea_theme_links itl
      LEFT JOIN themes t ON t.theme_id = itl.theme_id
      LEFT JOIN works w ON w.nodus_id = itl.nodus_id
      WHERE t.theme_id IS NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'theme links→works',
    count: `SELECT COUNT(*) AS n FROM idea_theme_links itl
      LEFT JOIN works w ON w.nodus_id = itl.nodus_id
      WHERE w.nodus_id IS NULL AND itl.nodus_id <> 'manual'`,
    detail: `SELECT itl.nodus_id, itl.global_id, itl.theme_id
      FROM idea_theme_links itl
      LEFT JOIN works w ON w.nodus_id = itl.nodus_id
      WHERE w.nodus_id IS NULL AND itl.nodus_id <> 'manual' LIMIT 200`,
  },
  {
    label: 'work themes→themes',
    count: `SELECT COUNT(*) AS n FROM work_themes wt
      LEFT JOIN themes t ON t.theme_id = wt.theme_id
      WHERE t.theme_id IS NULL`,
    detail: `SELECT wt.nodus_id, w.title, wt.theme_id
      FROM work_themes wt
      LEFT JOIN themes t ON t.theme_id = wt.theme_id
      LEFT JOIN works w ON w.nodus_id = wt.nodus_id
      WHERE t.theme_id IS NULL
      ORDER BY w.title LIMIT 200`,
  },
  {
    label: 'work themes→works',
    count: `SELECT COUNT(*) AS n FROM work_themes wt
      LEFT JOIN works w ON w.nodus_id = wt.nodus_id
      WHERE w.nodus_id IS NULL`,
    detail: `SELECT wt.nodus_id, wt.theme_id
      FROM work_themes wt
      LEFT JOIN works w ON w.nodus_id = wt.nodus_id
      WHERE w.nodus_id IS NULL LIMIT 200`,
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
      return { label: check.label, info: Boolean(check.info), count: n, rows };
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
  for (const { label, info, count, rows } of audit.results) {
    if (count === 0) {
      console.log(`  ${label.padEnd(26)} ${info ? 'none' : 'clean'}`);
      continue;
    }
    if (info) {
      console.log(`  ${label.padEnd(26)} ${count} (expected, not a violation)`);
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
  (a) => a.error || (a.results && a.results.some((r) => !r.info && r.count > 0)) || (a.stuckJobs && a.stuckJobs.length > 0)
);
// exitCode, not process.exit(): exiting at once truncates a large --json report that is
// still being written to a pipe.
process.exitCode = anyViolations ? 1 : 0;
