// A file-agnostic census of the IPC wiring, shared by every test that needs to
// know whether a channel is actually connected.
//
// Sixty test scripts assert on IPC by reading electron/ipc.ts or
// electron/preload.ts and matching a channel string against the file's text. That
// couples each of them to WHERE a handler lives, so splitting the monolith into
// per-domain modules breaks them even when the wiring is perfectly intact — the
// assertion was never about the file, only about the channel existing.
//
// This module answers the same question without naming a file: it scans the whole
// electron/ tree, so a handler can move between modules freely and the tests keep
// checking what they actually care about.
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// Everything under electron/preload is the renderer bridge (one file today, a
// directory of domain slices as the split proceeds); the rest is the main process.
const isBridge = (file) => path.relative(repoRoot, file).startsWith(path.join('electron', 'preload'));

// `\s*` before the quote lets a call carry its channel on the next line, which
// multi-argument handlers commonly do.
const HANDLE = /(?:^|[^A-Za-z0-9_$.])(?:(?:ctx|context)\.)?h\(\s*(['"])([^'"\n]+)\1/g;
const IPC_MAIN_HANDLE = /ipcMain\.handle(?:Once)?\(\s*(['"])([^'"\n]+)\1/g;
const IPC_MAIN_ON = /ipcMain\.(?:on|once)\(\s*(['"])([^'"\n]+)\1/g;
const RENDERER_INVOKE = /ipcRenderer\.invoke\(\s*(['"])([^'"\n]+)\1/g;
const RENDERER_SEND = /ipcRenderer\.(?:send|sendSync)\(\s*(['"])([^'"\n]+)\1/g;
const RENDERER_ON = /ipcRenderer\.(?:on|once)\(\s*(['"])([^'"\n]+)\1/g;

let cached = null;

/**
 * Scan the tree once and return every channel name, grouped by the role it plays,
 * along with the file each was found in.
 */
export function ipcCensus() {
  if (cached) return cached;
  const sources = tsFiles(path.join(repoRoot, 'electron')).map((file) => ({
    file: path.relative(repoRoot, file),
    bridge: isBridge(file),
    code: readFileSync(file, 'utf8'),
  }));

  const collect = (pattern, files) => {
    const found = [];
    for (const { file, code } of files) {
      for (const match of code.matchAll(pattern)) found.push({ channel: match.at(-1), file });
    }
    return found;
  };

  const main = sources.filter((entry) => !entry.bridge);
  const bridge = sources.filter((entry) => entry.bridge);

  // The NodusApi surface, wherever it is declared: the interface in
  // shared/types.ts plus the per-domain slices in shared/api/.
  const apiFiles = [path.join(repoRoot, 'shared/types.ts')];
  try {
    apiFiles.push(...tsFiles(path.join(repoRoot, 'shared/api')));
  } catch {
    // shared/api/ does not exist yet in older trees.
  }
  const apiMethods = new Set();
  for (const file of apiFiles) {
    for (const match of readFileSync(file, 'utf8').matchAll(/^ {2}([A-Za-z0-9_]+)[(<]/gm)) apiMethods.add(match[1]);
  }

  cached = {
    handled: [...collect(HANDLE, main), ...collect(IPC_MAIN_HANDLE, main)],
    listened: collect(IPC_MAIN_ON, main),
    invoked: collect(RENDERER_INVOKE, bridge),
    sent: collect(RENDERER_SEND, bridge),
    subscribed: collect(RENDERER_ON, bridge),
    apiMethods,
    sources,
    mainFiles: main,
    bridgeFiles: bridge,
    isBridge: (relPath) => isBridge(path.join(repoRoot, relPath)),
  };
  return cached;
}

const nameSet = (entries) => new Set(entries.map((entry) => entry.channel));

/**
 * Assert that each channel is both registered in the main process and reachable
 * from the renderer bridge — the two halves of a working binding, regardless of
 * which module either half lives in.
 */
export function assertChannelsWired(assert, channels) {
  const census = ipcCensus();
  const handled = nameSet(census.handled);
  const listened = nameSet(census.listened);
  const reachable = new Set([...nameSet(census.invoked), ...nameSet(census.sent), ...nameSet(census.subscribed)]);
  for (const channel of channels) {
    assert.ok(
      handled.has(channel) || listened.has(channel),
      `IPC channel '${channel}' is not registered anywhere in the main process`
    );
    assert.ok(reachable.has(channel), `IPC channel '${channel}' is not reachable from the preload bridge`);
  }
}

/** Assert that each name is declared on the NodusApi surface (types.ts or shared/api/). */
export function assertApiMethods(assert, methods) {
  const { apiMethods } = ipcCensus();
  for (const method of methods) {
    assert.ok(apiMethods.has(method), `NodusApi does not declare '${method}'`);
  }
}

/**
 * All main-process source, concatenated. For the assertions that are genuinely
 * about main-process behaviour rather than about a channel — "the OCR manager is
 * initialised with the window", "deleting uses the OS Trash" — and which used to
 * be written against electron/ipc.ts because that is where everything lived.
 * Matching the whole tree keeps the assertion true after a handler moves.
 */
export function mainSourceText() {
  return ipcCensus()
    .mainFiles.map((entry) => entry.code)
    .join('\n');
}

/** All bridge (preload) source, concatenated. Same reasoning as mainSourceText. */
export function bridgeSourceText() {
  return ipcCensus()
    .bridgeFiles.map((entry) => entry.code)
    .join('\n');
}
