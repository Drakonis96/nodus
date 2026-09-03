import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';

// macOS ships one artifact per architecture, and each one is packed on its own
// runner, so electron-builder writes two separate <channel>-mac.yml manifests
// that each list only the files that runner produced. Uploading both to the
// release would leave whichever finished last, and neither outcome is loud:
//
//   * only the Intel manifest survives -> every Apple silicon install passes
//     MacUpdater.filterFilesForArch with no arm64 candidate, falls through to
//     the non-arm64 branch and quietly updates itself to the Intel build,
//     which then runs under Rosetta forever.
//   * only the arm64 manifest survives -> Intel installs filter the arm64
//     files out, are left with an empty list and fail with
//     ERR_UPDATER_NO_FILES_PROVIDED on every check.
//
// So the manifests are merged into one instead. Two rules keep the currently
// published behaviour byte-for-byte intact for the installs that already exist:
// the arm64 entries stay first in `files`, and the deprecated top-level
// `path`/`sha512` pair keeps pointing at the arm64 ZIP. That pair is the only
// thing a client reads if it ignores `files` entirely, so an Apple silicon
// machine that somehow skips the architecture filter still lands on its own
// build rather than on the Intel one.
const PRIMARY_ARCHITECTURE = 'arm64';

function isPrimary(file) {
  return file.url.includes(PRIMARY_ARCHITECTURE);
}

export function mergeMacUpdateManifests(manifests) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new Error('No macOS update manifests to merge');
  }

  const versions = [...new Set(manifests.map((manifest) => manifest.version))];
  if (versions.length !== 1 || !versions[0]) {
    throw new Error(`Refusing to merge macOS manifests of different versions: ${versions.join(', ')}`);
  }

  const byUrl = new Map();
  const releaseDateByUrl = new Map();
  for (const manifest of manifests) {
    for (const file of manifest.files ?? []) {
      if (!file?.url) throw new Error('A macOS update manifest lists a file without a url');
      if (byUrl.has(file.url)) continue;
      byUrl.set(file.url, file);
      releaseDateByUrl.set(file.url, manifest.releaseDate);
    }
  }

  const files = [...byUrl.values()];
  if (files.length === 0) throw new Error('The merged macOS manifest would list no files');
  // A stable, architecture-major order: arm64 first, original order within each.
  const ordered = [...files.filter(isPrimary), ...files.filter((file) => !isPrimary(file))];

  // electron-updater downloads the ZIP, never the DMG, so the compatibility
  // pointer must be a ZIP or an old client would try to update from a disk
  // image. `ordered` already puts arm64 first, which is what makes this first
  // match the arm64 ZIP whenever one exists — the ordering above is load
  // bearing, not cosmetic.
  const primary = ordered.find((file) => file.url.endsWith('.zip'));
  if (!primary) throw new Error('The merged macOS manifest contains no ZIP to update from');

  return {
    version: versions[0],
    files: ordered,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: releaseDateByUrl.get(primary.url),
  };
}

export function mergeMacUpdateManifestFiles(inputs) {
  return mergeMacUpdateManifests(inputs.map((input) => {
    const parsed = load(readFileSync(input, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error(`Not a macOS update manifest: ${input}`);
    return parsed;
  }));
}

// Matches builder-util's own serializeToYaml so the merged file is stylistically
// identical to the one electron-builder writes.
export function serializeMacUpdateManifest(manifest) {
  return dump(manifest, { lineWidth: 8000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || inputs.length === 0) {
    throw new Error('Usage: merge-mac-update-manifest.mjs <output.yml> <input.yml> [input.yml ...]');
  }
  const merged = mergeMacUpdateManifestFiles(inputs);
  writeFileSync(output, serializeMacUpdateManifest(merged));
  console.log(`[mac-manifest] Merged ${inputs.length} manifests into ${output}`);
  for (const file of merged.files) console.log(`[mac-manifest]   ${file.url}`);
  console.log(`[mac-manifest] Compatibility pointer: ${merged.path}`);
}
