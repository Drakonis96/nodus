#!/usr/bin/env node
// Nodus Drift: preparation of the bundled recordings.
//
// It is run by a person (`npm run drift:prepare-assets`) and by the packaging hook
// (build/beforePack.cjs), so every installer carries the recordings. It is never run at
// start-up, by the app, or by the tests, and it never widens what may be distributed: a
// recording is only ever written to electron/assets/drift/audio/ when the catalogue says its
// licence is `verified` or `declared` AND its distribution review is `approved`
// (legal/drift/REVIEW.md). Everything else is listed, not prepared.
//
//   node scripts/prepare-drift-assets.mjs --list
//       Every recording, split into approved (would be prepared) and pending review.
//   node scripts/prepare-drift-assets.mjs [--source <dir>] [--target <dir>] [--only <id>]
//       Prepare the approved recordings. Bytes come from --source (a directory laid out like
//       Moodist's public/sounds, e.g. a checkout of the pinned commit) or, without it, from
//       the pinned upstream commit. Each file is checked against the catalogued size and
//       SHA-256 before it is written, and written atomically; a file that is already there and
//       matches is kept without being fetched again. Nothing pending is written, not even
//       when asked for by id.
//   node scripts/prepare-drift-assets.mjs --measure <dir>
//       Reproduce the technical fields of the catalogue from the files in <dir> (bytes and
//       SHA-256 always; duration and loop seam when ffprobe and ffmpeg are installed, which
//       is a review-time tool and not a dependency of the app).
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIO_DIR = path.join(repoRoot, 'electron', 'assets', 'drift', 'audio');
const require = createRequire(import.meta.url);

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The real catalogue and its validators, compiled from the TypeScript sources. */
export function loadDriftCatalog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-drift-catalog-'));
  try {
    const load = (file, name) => {
      const outfile = path.join(dir, `${name}.cjs`);
      buildSync({
        entryPoints: [path.join(repoRoot, file)],
        outfile, bundle: true, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent',
        alias: { '@shared': path.join(repoRoot, 'shared') },
      });
      return require(outfile);
    };
    return { ...load('shared/drift.ts', 'drift'), ...load('shared/driftCatalog.ts', 'catalog') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Icons the renderer can draw, read from the source so the catalogue is checked against the real set. */
export function readIconNames() {
  const source = fs.readFileSync(path.join(repoRoot, 'src/components/ui.tsx'), 'utf8');
  const block = source.slice(source.indexOf('const ICON_PATHS'), source.indexOf('export const ICON_NAMES'));
  return new Set([...block.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
}

/**
 * Where a catalogued asset would be written, proven to stay inside `root`. The catalogue
 * validator already refuses unsafe paths; this is the second lock, on the actual filesystem.
 */
export function resolveTarget(root, asset, drift) {
  if (!drift.isSafeDriftAssetPath(asset)) throw new Error(`refusing an unsafe asset path: ${JSON.stringify(asset)}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...asset.split('/'));
  const relative = path.relative(resolvedRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing a path outside the audio directory: ${asset}`);
  }
  return target;
}

/** Split the file-backed recordings into what may be prepared and what is still pending. */
export function planAssets(definitions, drift) {
  const recordings = definitions.filter((definition) => definition.source.kind === 'file');
  return {
    approved: recordings.filter((definition) => drift.isDriftDistributable(definition)),
    pending: recordings.filter((definition) => !drift.isDriftDistributable(definition)),
    generated: definitions.filter((definition) => definition.source.kind !== 'file'),
  };
}

/** The bytes of one recording: from a local directory laid out like `public/sounds`, or the pinned commit. */
async function obtainBytes(definition, { sourceDir, fetcher }) {
  const { provenance, source } = definition;
  if (sourceDir) {
    // The catalogue's asset is relative to public/sounds, exactly like the upstream layout.
    const candidate = path.resolve(sourceDir, ...source.asset.split('/'));
    const relative = path.relative(path.resolve(sourceDir), candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`the source path for ${definition.id} leaves --source`);
    return fs.readFileSync(candidate);
  }
  if (!provenance.upstreamRepository || !provenance.upstreamCommit || !provenance.upstreamPath) {
    throw new Error(`${definition.id} has no pinned upstream to fetch from; pass --source`);
  }
  const url = provenance.upstreamRepository.replace('https://github.com/', 'https://raw.githubusercontent.com/')
    + `/${provenance.upstreamCommit}/${provenance.upstreamPath}`;
  return fetchWithRetry(fetcher, url, definition.id);
}

/**
 * A hosted runner drops a connection now and then, and one lost download must not fail a whole
 * release. Network errors, timeouts, 429 and 5xx are retried with a growing pause; any other
 * status is final, because a pinned file that is missing will not appear on a second try. A
 * truncated body is caught by the size and SHA-256 checks that follow, not here.
 */
export async function fetchWithRetry(fetcher, url, label, { attempts = 4, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      const error = new Error(`${label}: HTTP ${response.status} for ${url}`);
      if (response.status !== 429 && response.status < 500) throw Object.assign(error, { permanent: true });
      lastError = error;
    } catch (error) {
      if (error.permanent) throw error;
      lastError = error;
    }
    if (attempt < attempts) await pause(500 * 2 ** (attempt - 1));
  }
  throw lastError;
}

/** A file on disk that has the catalogued size and SHA-256. */
function isIntact(file, source) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size !== source.bytes) return false;
    return sha256Hex(fs.readFileSync(file)) === source.sha256;
  } catch {
    return false;
  }
}

/**
 * Prepare the approved recordings into `targetDir`. Returns what was done; throws nothing
 * for a pending sound, it is reported as skipped. `only` narrows the run, and asking for a
 * pending id is refused, never honoured.
 */
export async function prepareAssets({ definitions, drift, targetDir = AUDIO_DIR, sourceDir = null, only = null, fetcher = fetch, log = () => {} }) {
  const plan = planAssets(definitions, drift);
  const result = { written: [], kept: [], skipped: [], failed: [] };
  let selected = plan.approved;
  if (only) {
    const target = definitions.find((definition) => definition.id === only);
    if (!target || target.source.kind !== 'file') throw new Error(`"${only}" is not a catalogued recording`);
    if (!drift.isDriftDistributable(target)) {
      throw new Error(`"${only}" has not been cleared for distribution (${target.provenance.licenseStatus}/${target.provenance.distributionReview}); it will not be prepared`);
    }
    selected = [target];
  }
  for (const definition of plan.pending) result.skipped.push({ id: definition.id, reason: 'pending review' });

  for (const definition of selected) {
    const { source } = definition;
    try {
      const destination = resolveTarget(targetDir, source.asset, drift);
      // Already there and exactly right: keep it. A packaging run then costs nothing after the first.
      if (isIntact(destination, source)) {
        result.kept.push({ id: definition.id, bytes: source.bytes });
        log(`kept ${definition.id}`);
        continue;
      }
      const bytes = await obtainBytes(definition, { sourceDir, fetcher });
      if (bytes.length !== source.bytes) throw new Error(`${bytes.length} bytes, the catalogue says ${source.bytes}`);
      if (bytes.length > drift.MAX_DRIFT_AUDIO_BYTES) throw new Error('larger than the 12 MiB limit');
      const digest = sha256Hex(bytes);
      if (digest !== source.sha256) throw new Error(`SHA-256 ${digest} does not match the catalogue`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, destination);
      result.written.push({ id: definition.id, bytes: bytes.length });
      log(`prepared ${definition.id} (${bytes.length} bytes)`);
    } catch (error) {
      result.failed.push({ id: definition.id, error: error.message });
      log(`FAILED ${definition.id}: ${error.message}`);
    }
  }
  return result;
}

/**
 * What is in an audio directory, judged against the catalogue: a file that is not declared,
 * one that is declared but not cleared, one whose size or SHA-256 differ, and one that
 * resolves outside the directory are all problems. A cleared recording that is simply absent
 * is reported, not failed: a build may deliberately ship without it.
 */
export function auditAudioDirectory({ root, definitions, drift }) {
  const problems = [];
  const present = [];
  const byAsset = new Map(definitions.filter((d) => d.source.kind === 'file').map((d) => [d.source.asset, d]));
  const IGNORED = new Set(['.gitkeep', 'README.md']);
  const files = [];
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
      else if (!IGNORED.has(entry.name)) files.push(relative);
      if (entry.isSymbolicLink()) problems.push(`${relative}: a symbolic link is not allowed in the audio directory`);
    }
  };
  walk(root, '');
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  for (const relative of files.sort()) {
    const definition = byAsset.get(relative);
    if (!definition) { problems.push(`${relative}: audio that the catalogue does not declare`); continue; }
    if (!drift.isDriftDistributable(definition)) {
      problems.push(`${relative}: present but "${definition.id}" is ${definition.provenance.licenseStatus}/${definition.provenance.distributionReview}, not cleared for distribution`);
      continue;
    }
    const full = path.join(root, ...relative.split('/'));
    const real = fs.realpathSync(full);
    const outside = path.relative(realRoot, real);
    if (outside.startsWith('..') || path.isAbsolute(outside)) { problems.push(`${relative}: resolves outside the audio directory`); continue; }
    const size = fs.statSync(full).size;
    if (size === 0) { problems.push(`${relative}: empty file`); continue; }
    if (size > drift.MAX_DRIFT_AUDIO_BYTES) { problems.push(`${relative}: ${size} bytes is above the 12 MiB limit`); continue; }
    if (size !== definition.source.bytes) { problems.push(`${relative}: ${size} bytes, the catalogue says ${definition.source.bytes}`); continue; }
    if (sha256Hex(fs.readFileSync(full)) !== definition.source.sha256) { problems.push(`${relative}: SHA-256 does not match the catalogue`); continue; }
    present.push({ id: definition.id, asset: relative, bytes: size });
  }
  const presentIds = new Set(present.map((entry) => entry.id));
  const plan = planAssets(definitions, drift);
  return {
    problems,
    present,
    bytes: present.reduce((sum, entry) => sum + entry.bytes, 0),
    missing: plan.approved.filter((d) => !presentIds.has(d.id)).map((d) => d.id),
    pending: plan.pending.map((d) => d.id),
    generators: plan.generated.map((d) => d.id),
  };
}

// ── measuring (review time) ─────────────────────────────────────────────────

const has = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;

const rms = (data, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/**
 * The rule the catalogue's `crossfadeMs` follows. 0 keeps a loop that is already seamless
 * (its wrap-around step is at most 4x the median sample step, and its last and first 100 ms
 * are within 6 dB of each other); otherwise a circular crossfade of min(1000 ms, 20% of the
 * duration).
 */
export function crossfadeRule({ seamJumpRatio, edgeMismatchDb }, durationSeconds) {
  const prepared = seamJumpRatio <= 4 && Math.abs(edgeMismatchDb) <= 6;
  return prepared ? 0 : Math.min(1000, Math.floor(durationSeconds * 1000 * 0.2));
}

/** bytes, SHA-256 and (with ffmpeg) duration and loop seam of one file. */
export function measureFile(file) {
  const bytes = fs.readFileSync(file);
  const measured = { bytes: bytes.length, sha256: sha256Hex(bytes) };
  if (!has('ffprobe') || !has('ffmpeg')) return { ...measured, note: 'ffprobe/ffmpeg not found: duration and seam not measured' };
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' }).stdout);
  const sampleRate = Number(probe.streams[0].sample_rate);
  const channels = Number(probe.streams[0].channels);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-'], { maxBuffer: 1 << 30 });
  const interleaved = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, Math.floor(decoded.stdout.byteLength / 4));
  const frames = interleaved.length / channels;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
    mono[i] = sum / channels;
  }
  const steps = [];
  for (let i = 1; i < frames; i += 4) steps.push(Math.abs(mono[i] - mono[i - 1]));
  steps.sort((a, b) => a - b);
  const median = steps[steps.length >> 1] || 1e-9;
  const window = Math.round(0.1 * sampleRate);
  const head = rms(mono, 0, window);
  const tail = rms(mono, frames - window, frames);
  const seamJumpRatio = +(Math.abs(mono[frames - 1] - mono[0]) / median).toFixed(2);
  const edgeMismatchDb = +(20 * Math.log10((tail + 1e-9) / (head + 1e-9))).toFixed(2);
  const durationSeconds = Math.round((frames / sampleRate) * 1000) / 1000;
  return { ...measured, sampleRate, channels, durationSeconds, seamJumpRatio, edgeMismatchDb, crossfadeMs: crossfadeRule({ seamJumpRatio, edgeMismatchDb }, durationSeconds) };
}

/** Measure every catalogued recording found in `dir` and compare it with the catalogue. */
export function measureDirectory({ dir, definitions }) {
  const rows = [];
  for (const definition of definitions.filter((d) => d.source.kind === 'file')) {
    const file = path.join(dir, ...definition.source.asset.split('/'));
    if (!fs.existsSync(file)) { rows.push({ id: definition.id, status: 'not found in the directory' }); continue; }
    const measured = measureFile(file);
    const same = measured.bytes === definition.source.bytes
      && measured.sha256 === definition.source.sha256
      && (measured.durationSeconds === undefined || Math.abs(measured.durationSeconds - definition.source.durationSeconds) < 0.002)
      && (measured.crossfadeMs === undefined || measured.crossfadeMs === definition.source.crossfadeMs);
    rows.push({ id: definition.id, status: same ? 'matches the catalogue' : 'DIFFERS from the catalogue', measured });
  }
  return rows;
}

// ── command line ────────────────────────────────────────────────────────────

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/** Returns the exit code; the entry point below exits once what was printed has left the pipe. */
async function main() {
  const catalog = loadDriftCatalog();
  const definitions = catalog.DRIFT_SOUNDS;
  const problems = catalog.validateDriftCatalog(definitions, readIconNames());
  if (problems.length > 0) {
    console.error(`the catalogue is not well formed:\n  ${problems.join('\n  ')}`);
    return 1;
  }

  if (arg('--measure')) {
    const rows = measureDirectory({ dir: path.resolve(arg('--measure')), definitions });
    console.log(JSON.stringify(rows, null, 2));
    return rows.some((row) => row.status.startsWith('DIFFERS')) ? 1 : 0;
  }

  const plan = planAssets(definitions, catalog);
  if (process.argv.includes('--list')) {
    const bytes = (list) => list.reduce((sum, d) => sum + d.source.bytes, 0);
    const line = (d) => `  ${d.id.padEnd(20)} ${String(d.source.bytes).padStart(9)}  ${d.source.sha256}  ${d.provenance.upstreamPath}`;
    console.log(`Upstream: ${catalog.DRIFT_UPSTREAM.repository} @ ${catalog.DRIFT_UPSTREAM.commit}`);
    console.log(`Generators (no files): ${plan.generated.length}`);
    console.log(`Approved recordings: ${plan.approved.length} (${bytes(plan.approved)} bytes) - prepared and bundled`);
    for (const d of plan.approved) console.log(line(d));
    console.log(`Pending review: ${plan.pending.length} (${bytes(plan.pending)} bytes) - not bundled, not prepared`);
    for (const d of plan.pending) console.log(line(d));
    return 0;
  }

  const result = await prepareAssets({
    definitions,
    drift: catalog,
    targetDir: arg('--target') ? path.resolve(arg('--target')) : AUDIO_DIR,
    sourceDir: arg('--source') ? path.resolve(arg('--source')) : null,
    only: arg('--only'),
    log: (line) => console.log(line),
  });
  console.log(`\nprepared ${result.written.length} recording(s), kept ${result.kept.length} already in place, skipped ${result.skipped.length} pending, failed ${result.failed.length}.`);
  if (plan.approved.length === 0) console.log('No recording has been cleared for distribution (legal/drift/REVIEW.md), so there is nothing to prepare.');
  return result.failed.length ? 1 : 0;
}

/**
 * process.exit() right after console.log can cut a piped listing short, because stdout to a
 * pipe is asynchronous. Wait for both streams to drain, then leave.
 */
export async function exitAfterFlush(code) {
  process.exitCode = code;
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolve) => stream.write('', resolve))));
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(exitAfterFlush, (error) => { console.error(error); return exitAfterFlush(1); });
}
