import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dump } from 'js-yaml';
import { mergeMacUpdateManifests, serializeMacUpdateManifest } from './merge-mac-update-manifest.mjs';

// These assertions drive the REAL electron-updater code that is already
// installed on every user's machine, not a model of it. The whole point of
// shipping a second macOS architecture is that the installs which exist today
// keep updating exactly as they do now, and the only way to know that is to ask
// the shipped updater which file it would pick.
const require = createRequire(import.meta.url);
const { MacUpdater } = require('electron-updater/out/MacUpdater.js');
const { findFile, resolveFiles } = require('electron-updater/out/providers/Provider.js');

const BASE_URL = new URL('https://github.com/Drakonis96/nodus/releases/download/v5.1.6/');

// The arm64 half is the manifest published for 5.1.6, verbatim.
const ARM64_MANIFEST = {
  version: '5.1.6',
  files: [
    {
      url: 'Nodus-mac-arm64.zip',
      sha512: 'AxIq6kP3nEN0ZxfJfh4loltL+KFIleTrGPXg5Uq4k+MjwRO1zxSuTprBcU2nuW7brOW7tTbZntCKsv9F3uMpFA==',
      size: 743910860,
    },
    {
      url: 'Nodus-mac-arm64.dmg',
      sha512: 'XryaJdGuaQI3kTo6905gHrS504IB5cEckY7rvPQluUYlZbzNoXcSFIERra2bnaM224ywKSVd95qu98fGd0AI2g==',
      size: 744688713,
    },
  ],
  path: 'Nodus-mac-arm64.zip',
  sha512: 'AxIq6kP3nEN0ZxfJfh4loltL+KFIleTrGPXg5Uq4k+MjwRO1zxSuTprBcU2nuW7brOW7tTbZntCKsv9F3uMpFA==',
  releaseDate: '2026-09-03T17:43:14.185Z',
};

const X64_MANIFEST = {
  version: '5.1.6',
  files: [
    { url: 'Nodus-mac-x64.zip', sha512: 'aW50ZWx6aXA=', size: 760000000 },
    { url: 'Nodus-mac-x64.dmg', sha512: 'aW50ZWxkbWc=', size: 761000000 },
  ],
  path: 'Nodus-mac-x64.zip',
  sha512: 'aW50ZWx6aXA=',
  releaseDate: '2026-09-03T18:10:00.000Z',
};

function chosenZip(manifest, { isArm64Mac }) {
  const files = MacUpdater.filterFilesForArch(resolveFiles(manifest, BASE_URL), isArm64Mac);
  return findFile(files, 'zip', ['pkg', 'dmg']).url.pathname.split('/').pop();
}

test('the merged manifest keeps the published arm64 entries first and unchanged', () => {
  const merged = mergeMacUpdateManifests([X64_MANIFEST, ARM64_MANIFEST]);
  assert.deepEqual(merged.files.map((file) => file.url), [
    'Nodus-mac-arm64.zip',
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-x64.zip',
    'Nodus-mac-x64.dmg',
  ]);
  assert.deepEqual(merged.files.slice(0, 2), ARM64_MANIFEST.files);
});

test('the deprecated compatibility pointer still names the arm64 ZIP', () => {
  // A client that ignores `files` reads `path`/`sha512`. Pointing that pair at
  // the Intel build would silently move every Apple silicon install to Rosetta.
  const merged = mergeMacUpdateManifests([X64_MANIFEST, ARM64_MANIFEST]);
  assert.equal(merged.path, ARM64_MANIFEST.path);
  assert.equal(merged.sha512, ARM64_MANIFEST.sha512);
  assert.equal(merged.releaseDate, ARM64_MANIFEST.releaseDate);
});

test('merging is independent of which runner finishes first', () => {
  const a = mergeMacUpdateManifests([ARM64_MANIFEST, X64_MANIFEST]);
  const b = mergeMacUpdateManifests([X64_MANIFEST, ARM64_MANIFEST]);
  assert.deepEqual(a, b);
});

test('an already merged manifest survives being merged again', () => {
  // The backfill path merges the manifest already published on the release.
  const once = mergeMacUpdateManifests([ARM64_MANIFEST, X64_MANIFEST]);
  assert.deepEqual(mergeMacUpdateManifests([once, X64_MANIFEST]), once);
});

test('the shipped updater routes each Mac to its own build', () => {
  const merged = mergeMacUpdateManifests([ARM64_MANIFEST, X64_MANIFEST]);
  assert.equal(chosenZip(merged, { isArm64Mac: true }), 'Nodus-mac-arm64.zip');
  assert.equal(chosenZip(merged, { isArm64Mac: false }), 'Nodus-mac-x64.zip');
});

test('an unmerged manifest is exactly what breaks one of the two architectures', () => {
  // Guards the reason the merge job exists: uploading the per-runner manifests
  // straight to the release lets the last one win, and both outcomes are silent.
  assert.equal(chosenZip(ARM64_MANIFEST, { isArm64Mac: true }), 'Nodus-mac-arm64.zip');
  assert.throws(
    () => chosenZip(ARM64_MANIFEST, { isArm64Mac: false }),
    /ERR_UPDATER_NO_FILES_PROVIDED|No files provided/,
  );
  assert.equal(chosenZip(X64_MANIFEST, { isArm64Mac: true }), 'Nodus-mac-x64.zip');
});

test('an Intel-only merge still points at a ZIP, never at the disk image', () => {
  // The fallback that matters if the arm64 half is ever missing: electron-updater
  // downloads the ZIP, so a DMG pointer would fail on every client.
  const merged = mergeMacUpdateManifests([X64_MANIFEST]);
  assert.equal(merged.path, 'Nodus-mac-x64.zip');
});

test('manifests of different versions are never merged', () => {
  assert.throws(
    () => mergeMacUpdateManifests([ARM64_MANIFEST, { ...X64_MANIFEST, version: '5.1.7' }]),
    /different versions/,
  );
});

test('a merged manifest without a ZIP is rejected', () => {
  const dmgOnly = { version: '5.1.6', files: [ARM64_MANIFEST.files[1]], releaseDate: 'x' };
  assert.throws(() => mergeMacUpdateManifests([dmgOnly]), /no ZIP/);
});

test('the merged manifest is serialized the way electron-builder writes it', () => {
  const merged = mergeMacUpdateManifests([ARM64_MANIFEST, X64_MANIFEST]);
  assert.equal(serializeMacUpdateManifest(merged), dump(merged, { lineWidth: 8000 }));
  assert.match(serializeMacUpdateManifest(merged), /^version: 5\.1\.6\nfiles:\n/);
});
