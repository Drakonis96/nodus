#!/usr/bin/env node
// Nodus Drift: integrity and authorisation of the bundled recordings.
//
//   node scripts/verify-drift-assets.mjs
//       The catalogue is well formed; electron/assets/drift/audio/ holds nothing that the
//       catalogue does not declare, nothing that has not been cleared for distribution, and
//       every file it holds matches its catalogued size and SHA-256.
//   node scripts/verify-drift-assets.mjs --asar <path to app.asar | Nodus.app | resources dir>
//       The same audit of what a PACKAGED build really carries: the audio inside app.asar,
//       and the legal record (legal/drift) beside it.
//
// It exits 1 on any problem and prints the real number and size of packaged recordings, so
// "how many recordings does this build contain" is a measurement and not a claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDIO_DIR, auditAudioDirectory, loadDriftCatalog, readIconNames, repoRoot } from './prepare-drift-assets.mjs';

const AUDIO_IN_ARCHIVE = 'electron/assets/drift/audio';

/** Find app.asar from a path to the archive, a macOS .app, or a resources directory. */
export function locateAsar(input) {
  const candidates = [
    input,
    path.join(input, 'Contents', 'Resources', 'app.asar'),
    path.join(input, 'resources', 'app.asar'),
    path.join(input, 'app.asar'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!found) throw new Error(`no app.asar found from ${input}`);
  return found;
}

/**
 * Audit the audio inside an asar exactly like a directory: extract only what lives under the
 * drift audio path into a scratch directory, then judge that directory. Nothing is trusted
 * from the archive's own listing beyond the paths.
 */
export async function auditAsar({ asarPath, definitions, drift }) {
  const asar = await import('@electron/asar');
  const listing = asar.listPackage(asarPath, { isPack: false }).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''));
  // The listing has directories too; only files are extracted (a directory has `files`).
  const audio = listing.filter((entry) => entry.startsWith(`${AUDIO_IN_ARCHIVE}/`) && !entry.endsWith('/') && !asar.statFile(asarPath, entry).files);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-drift-asar-'));
  try {
    for (const entry of audio) {
      const relative = entry.slice(AUDIO_IN_ARCHIVE.length + 1);
      const target = path.join(scratch, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, asar.extractFile(asarPath, entry));
    }
    // Undeclared audio, uncleared recordings, wrong sizes and wrong hashes are all judged by
    // the same audit a source directory gets.
    return { ...auditAudioDirectory({ root: scratch, definitions, drift }), listing };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function report(label, audit) {
  console.log(`[drift-assets] ${label}`);
  console.log(`  recordings packaged: ${audit.present.length} (${audit.bytes} bytes)`);
  console.log(`  cleared but absent:  ${audit.missing.length}`);
  console.log(`  pending review:      ${audit.pending.length} (not bundled)`);
  console.log(`  generators:          ${audit.generators.length} (no files)`);
}

async function main() {
  const catalog = loadDriftCatalog();
  const definitions = catalog.DRIFT_SOUNDS;
  const problems = catalog.validateDriftCatalog(definitions, readIconNames());
  if (problems.length > 0) {
    console.error(`[drift-assets] the catalogue is not well formed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  const asarIndex = process.argv.indexOf('--asar');
  let audit;
  if (asarIndex >= 0) {
    const asarPath = locateAsar(path.resolve(process.argv[asarIndex + 1]));
    audit = await auditAsar({ asarPath, definitions, drift: catalog });
    report(`packaged archive ${asarPath}`, audit);
    // The legal record must travel with the app: it is what says why a recording is (not) there.
    const resources = path.dirname(asarPath);
    for (const file of ['legal/drift/README.md', 'legal/drift/PROVENANCE.md', 'legal/drift/REVIEW.md']) {
      if (!fs.existsSync(path.join(resources, file))) audit.problems.push(`${file}: not shipped beside the app`);
    }
  } else {
    audit = auditAudioDirectory({ root: AUDIO_DIR, definitions, drift: catalog });
    report(`source tree ${path.relative(repoRoot, AUDIO_DIR)}`, audit);
  }

  if (audit.problems.length > 0) {
    console.error(`[drift-assets] ${audit.problems.length} problem(s):\n  ${audit.problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('[drift-assets] ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
