#!/usr/bin/env node
// Imports a vendor catalogue you downloaded (Mcule, Enamine, …) as a stock list for Chemistry
// Studio: precursors and starting materials on it are then marked purchasable in route checks.
//
//   node scripts/import-stock.mjs <catalogue file> <vendor name>   # .smi/.txt, .csv/.tsv, .sdf(.gz)
//   node scripts/import-stock.mjs --list
//   node scripts/import-stock.mjs --remove <vendor name>
//
// Lists are kept in <userData>/chemistry-stock (NODUS_STOCK_DIR overrides it) as the sorted
// hashes of each compound's standard InChIKey. Uses the Chemistry Studio worker and Python
// runtime Nodus already installed (RDKit); re-import the same vendor to refresh it.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userData = path.join(os.homedir(), 'Library', 'Application Support', 'Nodus');
const stockDir = process.env.NODUS_STOCK_DIR || path.join(userData, 'chemistry-stock');
const args = process.argv.slice(2);

function listStock() {
  const metas = fs.existsSync(stockDir) ? fs.readdirSync(stockDir).filter((name) => name.endsWith('.json')) : [];
  if (!metas.length) return console.log(`no stock lists in ${stockDir}`);
  for (const name of metas.sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(stockDir, name), 'utf8'));
    console.log(`${meta.vendor.padEnd(12)} ${String(meta.compounds).padStart(10)} compounds  from ${meta.source}  imported ${meta.importedAt}`);
  }
}

function newest(dir) {
  const versions = fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => path.join(dir, name)) : [];
  return versions.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function worker() {
  if (process.env.CHEMISTRY_WORKER) return process.env.CHEMISTRY_WORKER;
  const version = newest(path.join(userData, 'plugins', 'installed', 'chemistry-studio', 'versions'));
  const file = version && path.join(version, 'python', 'reactions_worker.py');
  if (!file || !fs.existsSync(file)) throw new Error('Chemistry Studio is not installed (no reactions_worker.py); set CHEMISTRY_WORKER.');
  return file;
}

function python() {
  if (process.env.CHEMISTRY_PYTHON) return process.env.CHEMISTRY_PYTHON;
  const shared = path.join(userData, 'plugins', 'runtimes', 'shared');
  const candidates = fs.existsSync(shared) ? fs.readdirSync(shared).map((name) => path.join(shared, name, 'venv', 'bin', 'python3')) : [];
  for (const candidate of candidates.filter((file) => fs.existsSync(file))) {
    if (spawnSync(candidate, ['-c', 'import rdkit, numpy'], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('No Chemistry Studio Python runtime with RDKit found (run a route check in Nodus once); set CHEMISTRY_PYTHON.');
}

if (args[0] === '--list') {
  listStock();
} else if (args[0] === '--remove' && args[1]) {
  const vendor = args[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  for (const ext of ['.u64', '.json']) fs.rmSync(path.join(stockDir, vendor + ext), { force: true });
  console.log(`removed ${vendor}`);
  listStock();
} else if (args.length === 2 && fs.existsSync(args[0])) {
  fs.mkdirSync(stockDir, { recursive: true });
  const out = execFileSync(python(), [worker(), '--import-stock', path.resolve(args[0]), args[1], stockDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const meta = JSON.parse(out.trim().split('\n').at(-1));
  console.log(`imported ${meta.compounds.toLocaleString()} compounds as "${meta.vendor}" (${meta.records.toLocaleString()} records, ${meta.unreadable} unreadable) in ${meta.seconds} s → ${stockDir}`);
} else {
  console.error('usage: import-stock.mjs <catalogue file> <vendor> | --list | --remove <vendor>');
  process.exit(2);
}
