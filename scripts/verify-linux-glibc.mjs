#!/usr/bin/env node
// The Linux build must start on the oldest still-supported Ubuntu LTS.
//
// Nodus ships to Linux with the host's C library: the AppImage, the .deb and the
// .rpm all load glibc and libstdc++ from the system they run on. Every ELF file
// in the package therefore sets a floor: it names the newest GLIBC_x.y and
// GLIBCXX_3.4.z symbol versions it needs, and a host with anything older refuses
// to load it.
//
// 5.7.1 was built on ubuntu-latest (24.04, glibc 2.39). better-sqlite3 has no
// prebuilt binary for Electron 43, so it was compiled there and picked up
// GLIBC_2.38. On Ubuntu 22.04 and Debian 12 the app died before its first window
// with "version `GLIBC_2.38' not found (required by better_sqlite3.node)". The
// AppImage catalogue caught it (AppImage/appimage.github.io#7224), not us.
//
// This check reads the unpacked build the installers are made from and refuses
// any ELF file that needs more than Ubuntu 22.04 provides. It runs on the build
// machine, so a runner or compiler that drifts newer fails the release instead
// of shipping.
import { execFileSync } from 'node:child_process';
import { lstatSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ubuntu 22.04 LTS: glibc 2.35, libstdc++6 from GCC 12 (GLIBCXX_3.4.30).
export const FLOOR = { GLIBC: '2.35', GLIBCXX: '3.4.30' };

// Third-party prebuilt files that need more than the floor. Nodus does not load
// them at startup; each belongs to an optional feature of a bundled CLI, which
// works on newer hosts and fails alone on older ones. They are matched by path
// suffix so a dependency bump that moves them surfaces here rather than passing.
export const ALLOWED = [
  {
    suffix: '/@webviewjs/webview-linux-x64-gnu/webview.linux-x64-gnu.node',
    reason: 'GitHub Copilot CLI webview addon, prebuilt upstream against glibc 2.39',
  },
  {
    suffix: '/codex-resources/zsh/bin/zsh',
    reason: 'Codex CLI bundled zsh, prebuilt upstream against glibc 2.38',
  },
];

/** Compares dotted versions numerically: 2.9 < 2.35 < 2.38. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * The newest GLIBC and GLIBCXX versions an ELF file requires, from `objdump -T`.
 * Only undefined symbols count: a library may also DEFINE versioned symbols of
 * its own, and those are what it provides, not what it needs.
 */
export function requiredVersions(objdumpOutput) {
  const newest = {};
  for (const line of objdumpOutput.split('\n')) {
    if (!line.includes('*UND*')) continue;
    const match = line.match(/\b(GLIBCXX|GLIBC)_(\d+(?:\.\d+)+)\b/);
    if (!match) continue;
    const [, library, version] = match;
    if (!newest[library] || compareVersions(version, newest[library]) > 0) newest[library] = version;
  }
  return newest;
}

/** Which requirements exceed the floor, as readable strings. */
export function excess(required, floor = FLOOR) {
  return Object.entries(required)
    .filter(([library, version]) => compareVersions(version, floor[library]) > 0)
    .map(([library, version]) => `${library}_${version} > ${library}_${floor[library]}`);
}

export function allowance(relativePath, allowed = ALLOWED) {
  const normalized = `/${relativePath.split(path.sep).join('/')}`;
  return allowed.find((entry) => normalized.endsWith(entry.suffix)) ?? null;
}

function isElf(file) {
  const descriptor = openSync(file, 'r');
  try {
    const magic = Buffer.alloc(4);
    return readSync(descriptor, magic, 0, 4, 0) === 4 && magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally {
    closeSync(descriptor);
  }
}

function* elfFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* elfFiles(full);
    else if (entry.isFile() && lstatSync(full).size >= 4 && isElf(full)) yield full;
  }
}

export function verifyLinuxGlibc(root, { objdump = (file) => execFileSync('objdump', ['-T', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  const failures = [];
  const tolerated = [];
  let scanned = 0;
  for (const file of elfFiles(root)) {
    scanned += 1;
    let output;
    try {
      output = objdump(file);
    } catch {
      continue; // Statically linked or not a dynamic object: it needs nothing from the host.
    }
    const over = excess(requiredVersions(output));
    if (over.length === 0) continue;
    const relative = path.relative(root, file);
    const allowed = allowance(relative);
    if (allowed) tolerated.push(`${relative}: ${over.join(', ')} (${allowed.reason})`);
    else failures.push(`${relative}: ${over.join(', ')}`);
  }
  return { scanned, failures, tolerated };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: verify-linux-glibc.mjs <linux-unpacked directory>');
    process.exit(2);
  }
  const { scanned, failures, tolerated } = verifyLinuxGlibc(root);
  if (scanned === 0) {
    console.error(`[linux glibc] no ELF files under ${root}; is this the unpacked build?`);
    process.exit(1);
  }
  for (const line of tolerated) console.log(`[linux glibc] allowed: ${line}`);
  if (failures.length > 0) {
    console.error(`[linux glibc] ${failures.length} file(s) need more than Ubuntu 22.04 provides (GLIBC_${FLOOR.GLIBC}, GLIBCXX_${FLOOR.GLIBCXX}):`);
    for (const line of failures) console.error(`  ${line}`);
    console.error('Build on the oldest supported Ubuntu LTS with its stock libstdc++; see the Linux job in .github/workflows/release-build.yml.');
    process.exit(1);
  }
  console.log(`[linux glibc] ${scanned} ELF files, all load on glibc ${FLOOR.GLIBC} / GLIBCXX ${FLOOR.GLIBCXX}`);
}
