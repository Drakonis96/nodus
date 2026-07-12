// Build the offline place gazetteer used by the map's place picker. Downloads the
// GeoNames cities15000 dump (~26k populated places worldwide, ≥15k inhabitants)
// plus the admin1 (state/province) and country name tables, joins them, and writes
// a compact gzipped TSV to electron/assets/gazetteer/cities.tsv.gz. The main process
// loads and searches it at runtime — fully offline, no tile/geocoding server.
//
//   node scripts/build-gazetteer.mjs           # download + build
//   node scripts/build-gazetteer.mjs /tmp      # reuse files already in /tmp
//
// Re-run only to refresh the data; the produced .gz is committed to the repo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = process.argv[2] || path.join(os.tmpdir(), 'nodus-gazetteer');
fs.mkdirSync(cacheDir, { recursive: true });

const BASE = 'https://download.geonames.org/export/dump';

function ensure(file, url) {
  const dest = path.join(cacheDir, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  console.log(`[gazetteer] downloading ${url}`);
  execFileSync('curl', ['-sSL', '--max-time', '180', '-o', dest, url], { stdio: 'inherit' });
  return dest;
}

// cities15000.zip → cities15000.txt
const zip = ensure('cities15000.zip', `${BASE}/cities15000.zip`);
const citiesTxt = path.join(cacheDir, 'cities15000.txt');
if (!fs.existsSync(citiesTxt)) {
  execFileSync('unzip', ['-o', zip, '-d', cacheDir], { stdio: 'inherit' });
}
const admin1File = ensure('admin1CodesASCII.txt', `${BASE}/admin1CodesASCII.txt`);
const countryFile = ensure('countryInfo.txt', `${BASE}/countryInfo.txt`);

// admin1 code (e.g. "ES.51") → admin1 name (e.g. "Andalusia").
const admin1 = new Map();
for (const line of fs.readFileSync(admin1File, 'utf8').split('\n')) {
  if (!line) continue;
  const [code, name] = line.split('\t');
  if (code) admin1.set(code, name);
}

// ISO country code → country name (skip comment header lines).
const country = new Map();
for (const line of fs.readFileSync(countryFile, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const cols = line.split('\t');
  if (cols[0] && cols[4]) country.set(cols[0], cols[4]);
}

// GeoNames cities columns (tab-separated):
// 0 geonameid 1 name 2 asciiname 3 alt 4 lat 5 lon 6 fclass 7 fcode 8 cc
// 9 cc2 10 admin1 11 admin2 12 admin3 13 admin4 14 population …
const out = [];
for (const line of fs.readFileSync(citiesTxt, 'utf8').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  const id = c[0];
  const name = c[1];
  const lat = Number(c[4]);
  const lon = Number(c[5]);
  const cc = c[8];
  const admin1Name = admin1.get(`${cc}.${c[10]}`) ?? '';
  const countryName = country.get(cc) ?? cc;
  const pop = Number(c[14]) || 0;
  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  // id \t name \t admin1 \t cc \t country \t lat \t lon \t population
  out.push([id, name, admin1Name, cc, countryName, lat.toFixed(4), lon.toFixed(4), String(pop)].join('\t'));
}
// Most-populated first so the search can keep the first N strong matches cheaply.
out.sort((a, b) => Number(b.split('\t')[7]) - Number(a.split('\t')[7]));

const tsv = out.join('\n') + '\n';
const gz = zlib.gzipSync(Buffer.from(tsv, 'utf8'), { level: 9 });
const destDir = path.join(repoRoot, 'electron/assets/gazetteer');
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, 'cities.tsv.gz');
fs.writeFileSync(dest, gz);
console.log(`[gazetteer] wrote ${out.length} places → ${path.relative(repoRoot, dest)} (${(gz.length / 1024).toFixed(0)} KB gzipped)`);
