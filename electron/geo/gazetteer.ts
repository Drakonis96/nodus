// Offline place gazetteer: lazily loads the committed GeoNames-derived asset
// (electron/assets/gazetteer/cities.tsv.gz, ~34k populated places worldwide) and
// searches it by name for the map's place picker. Fully offline — no geocoding or
// tile server. The asset ships via electron-builder `files`, so app.getAppPath()
// resolves it in both dev (repo root) and packaged (app.asar) builds.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { app } from 'electron';
import type { GazetteerPlace } from '@shared/types';

interface Entry {
  id: string;
  name: string;
  folded: string;
  admin1: string;
  cc: string;
  country: string;
  lat: number;
  lon: number;
  pop: number;
}

let entries: Entry[] | null = null;

/** Accent- and case-fold for diacritic-insensitive matching ("Uíge" ↔ "uige"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function assetPath(): string {
  return path.join(app.getAppPath(), 'electron/assets/gazetteer/cities.tsv.gz');
}

function load(): Entry[] {
  if (entries) return entries;
  const file = assetPath();
  try {
    const tsv = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    const rows: Entry[] = [];
    for (const line of tsv.split('\n')) {
      if (!line) continue;
      const c = line.split('\t');
      const lat = Number(c[5]);
      const lon = Number(c[6]);
      if (!c[0] || !c[1] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      rows.push({ id: c[0], name: c[1], folded: foldText(c[1]), admin1: c[2] ?? '', cc: c[3] ?? '', country: c[4] ?? '', lat, lon, pop: Number(c[7]) || 0 });
    }
    entries = rows;
  } catch {
    // Missing/corrupt asset: degrade to an empty gazetteer rather than crash. The
    // picker still supports manual coordinate entry.
    entries = [];
  }
  return entries;
}

function toPlace(e: Entry): GazetteerPlace {
  return {
    gazetteerId: `geonames:${e.id}`,
    name: e.name,
    admin1: e.admin1,
    country: e.country,
    countryCode: e.cc,
    latitude: e.lat,
    longitude: e.lon,
    population: e.pop,
  };
}

/**
 * Search the gazetteer by name. Prefix matches rank above interior matches, and
 * within each, more-populated places rank first (so "Paris" surfaces Paris, France
 * before a small US Paris). Returns at most `limit` candidates.
 */
export function searchGazetteer(query: string, limit = 12): GazetteerPlace[] {
  const q = foldText(query);
  if (q.length < 2) return [];
  const all = load();
  const prefix: Entry[] = [];
  const interior: Entry[] = [];
  for (const e of all) {
    const idx = e.folded.indexOf(q);
    if (idx === 0) prefix.push(e);
    else if (idx > 0) interior.push(e);
    // Cap the interior scan cheaply once we clearly have enough to rank.
    if (prefix.length + interior.length > 4000) break;
  }
  const byPop = (a: Entry, b: Entry) => b.pop - a.pop;
  prefix.sort(byPop);
  interior.sort(byPop);
  return [...prefix, ...interior].slice(0, limit).map(toPlace);
}

/** Resolve one gazetteer id back to a full place (for re-hydrating a stored link). */
export function getGazetteerPlace(gazetteerId: string): GazetteerPlace | null {
  const id = gazetteerId.replace(/^geonames:/, '');
  const found = load().find((e) => e.id === id);
  return found ? toPlace(found) : null;
}

/** Test/diagnostic hook: number of loaded gazetteer entries (0 if the asset is missing). */
export function gazetteerSize(): number {
  return load().length;
}
