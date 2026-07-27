// What the map tells a writer: scenes, impossible journeys, encounters and the export.
//
// The arithmetic is in test-world-presence.mjs. What is pinned here is the refusal to
// invent: every one of these reports is only worth reading if it stays quiet when it
// cannot know — a warning about a journey of NaN leagues, or a scale bar on an
// uncalibrated map the author is about to send their editor, destroys the credibility of
// all the others.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('the impossible-journey check refuses rather than guesses, on both halves', async () => {
  const reports = await read('src/components/world/mapReports.tsx');
  // A place with no pin on THIS map cannot be measured…
  assert.match(reports, /if \(!from \|\| !to\) return null;/);
  // …and a pace whose unit cannot be reconciled with the map's is skipped, not coerced.
  assert.match(reports, /if \(days == null\) continue;/);
  // No scale at all: the panel says how to fix it instead of showing an empty section.
  assert.match(reports, /Calibra la escala del mapa y podré avisarte/);
  assert.match(reports, /if \(!unit\) return \[\];/);
});

test('the fastest available mode is the one that must fail', async () => {
  const reports = await read('src/components/world/mapReports.tsx');
  // Reporting against the SLOWEST pace would flag every sea voyage in the book. Only what
  // the fastest thing available still cannot manage is worth a writer's attention.
  assert.match(reports, /if \(!best \|\| days < best\.days\) best = \{ days, modeName: mode\.name \}/);
});

test('scenes stack into one badge per place, not a pile of dots', async () => {
  const reports = await read('src/components/world/mapReports.tsx');
  assert.match(reports, /const counted = new Map<string, \{ marker: MapMarker; scenes: WorldScene\[\] \}>\(\)/);
  assert.match(reports, /data-testid="map-show-scenes"/);
  // A scene whose place is not pinned on this map is skipped rather than dropped at 0,0.
  assert.match(reports, /const marker = byPlace\.get\(scene\.placeId\);\s*\n\s*if \(!marker\) continue;/);
});

test('the reports fall back to the whole cast when nobody is selected', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // "Choose two characters" is a useful prompt for the encounter finder, but an author who
  // has selected nobody still wants to know their manuscript contains an impossible ride.
  assert.match(view, /reportTracks=\{followed\.length > 0 \? followed : tracks\}/);
});

test('the exported PNG has no scale bar when the map has no scale', async () => {
  const reports = await read('src/components/world/mapReports.tsx');
  // The author is about to send this to someone. A confidently wrong bar on it is worse
  // than no bar at all.
  assert.match(reports, /if \(across == null \|\| !unit\) return;/);
  // Labels get a halo, so a name is readable over both a dark sea and pale parchment
  // without knowing which is underneath.
  assert.match(reports, /context\.strokeText\(label,/);
  assert.match(reports, /context\.fillText\(label,/);
  assert.match(reports, /data-testid="map-export-png"/);
  // Exported at the image's own resolution, not at the size of the window.
  assert.match(reports, /canvas\.width = image\.naturalWidth \|\| map\.widthPx/);
});

test('the export draws every geometry, not only the pins', async () => {
  const reports = await read('src/components/world/mapReports.tsx');
  const fn = reports.slice(reports.indexOf('export async function exportMapPng'), reports.indexOf('function drawScaleBar'));
  assert.match(fn, /marker\.points && marker\.points\.length > 1/, 'polygons and paths');
  assert.match(fn, /marker\.geometryKind === 'polygon'\) context\.closePath\(\)/);
  assert.match(fn, /marker\.geometryKind === 'circle' && marker\.radius != null/);
});
