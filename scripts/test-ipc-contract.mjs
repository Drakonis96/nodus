// Contract test for the IPC boundary: the renderer bridge and the main process
// must agree, channel by channel, on the ~1,200 names that make up window.nodus.
//
// Why this exists. The API surface itself is already pinned by the compiler: the
// preload builds `const api: NodusApi = {...}`, so dropping a method fails
// `npm run typecheck`. What nothing checked is the *other* half of each binding —
// that the channel string a preload method invokes is actually registered in the
// main process. TypeScript cannot see inside those string literals, so a channel
// that loses its handler compiles, builds, boots, and only fails when a user
// clicks the feature.
//
// That gap is what makes splitting electron/ipc.ts into per-domain modules risky:
// moving a contiguous block of ~50 `h(...)` calls is mechanical, but silently
// dropping one line from it is invisible. This test closes it, in both
// directions, plus the duplicate-registration case (Electron throws at startup
// when the same channel is handled twice, so a bad split is a boot crash).
//
// Deliberately static. The registry under test IS a set of string literals, and
// executing registerIpc() would mean booting the whole main process — 305 imports
// including better-sqlite3, the AI providers and the MCP server. Reading the
// names is the cheapest sound way to compare the two sides.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ipcCensus } from './ipc-channel-census.mjs';

/**
 * Baseline at the time the per-domain IPC split started (v3.0.0): 1,204 handled
 * channels and 2 `ipcMain.on` channels (`nodi:setMouseIgnore:async` and
 * `presenter:control`). This is a FLOOR, not an exact count — features add
 * channels all the time and that must not need a test edit. Its only job is to
 * catch a whole block vanishing from both sides at once, which set equality
 * alone cannot see. Lower it only when channels are deliberately removed.
 *
 * The first run of this test found three unreachable registrations and they were
 * deleted rather than allow-listed: `nodi:setMouseIgnore` (superseded by the
 * `:async` send), plus `nodi:setMouseIgnoreSync` and
 * `nodi:getOverlayPlacementSync`, kept "for older preload bundles" — a case that
 * cannot arise, because the preload is bundled into the same build as the main
 * process and a contextIsolated renderer has no other route to ipcMain.
 */
const MIN_HANDLED_CHANNELS = 1200;
const MIN_EVENT_LISTENER_CHANNELS = 2;

// A channel assembled at runtime would be invisible to this test, so the test
// refuses to run rather than passing on partial data.
const DYNAMIC_HANDLE = /(?:^|[^A-Za-z0-9_$.])(?:(?:ctx|context)\.)?h\(\s*[`$(]/g;
const DYNAMIC_INVOKE = /ipcRenderer\.(?:invoke|send|sendSync|on|once)\(\s*[`$(]/g;

const { handled, listened, invoked, sent, subscribed, sources, mainFiles } = ipcCensus();

const names = (entries) => new Set(entries.map((entry) => entry.channel));
const where = (entries, channel) =>
  entries.filter((entry) => entry.channel === channel).map((entry) => entry.file).join(', ');
const missing = (from, against) => [...names(from)].filter((channel) => !names(against).has(channel)).sort();

test('channel names are literals on both sides', () => {
  for (const { file, code, bridge } of sources) {
    const pattern = bridge ? DYNAMIC_INVOKE : DYNAMIC_HANDLE;
    const dynamic = [...code.matchAll(pattern)];
    assert.equal(
      dynamic.length,
      0,
      `${file} builds an IPC channel name dynamically. Channel names must stay literal strings so the two sides can be compared statically.`
    );
  }
});

test('the bridge and the main process register the same handled channels', () => {
  const orphanCalls = missing(invoked, handled);
  assert.deepEqual(
    orphanCalls,
    [],
    `preload invokes channels with no handler in the main process (a silent failure the moment a user triggers them):\n` +
      orphanCalls.map((channel) => `  ${channel} — called from ${where(invoked, channel)}`).join('\n')
  );

  const orphanHandlers = missing(handled, invoked);
  assert.deepEqual(
    orphanHandlers,
    [],
    `the main process handles channels the bridge never invokes (dead code, or a preload binding that got lost):\n` +
      orphanHandlers.map((channel) => `  ${channel} — registered in ${where(handled, channel)}`).join('\n')
  );
});

test('send/on channels line up too', () => {
  const orphanSends = missing(sent, listened);
  assert.deepEqual(
    orphanSends,
    [],
    `preload sends channels no ipcMain.on listens for:\n` +
      orphanSends.map((channel) => `  ${channel} — sent from ${where(sent, channel)}`).join('\n')
  );

  // The reverse direction is intentionally not symmetric: an ipcMain.on channel
  // can legitimately be driven by a sendSync from a preload helper *and* by a
  // renderer-side send, so only require that the bridge knows the name at all.
  const bridgeKnown = new Set([...names(sent), ...names(subscribed), ...names(invoked)]);
  const unusedListeners = [...names(listened)].filter((channel) => !bridgeKnown.has(channel)).sort();
  assert.deepEqual(
    unusedListeners,
    [],
    `ipcMain listens on channels the bridge never mentions:\n` +
      unusedListeners.map((channel) => `  ${channel} — registered in ${where(listened, channel)}`).join('\n')
  );
});

test('no channel is registered twice', () => {
  // ipcMain.handle throws "Attempted to register a second handler" at startup, so
  // a duplicate introduced by copying a block between domain modules is a boot
  // crash rather than a degraded feature. Catch it here instead.
  const seen = new Map();
  const duplicates = [];
  for (const entry of handled) {
    const previous = seen.get(entry.channel);
    if (previous) duplicates.push(`  ${entry.channel} — ${previous} and ${entry.file}`);
    else seen.set(entry.channel, entry.file);
  }
  assert.deepEqual(duplicates, [], `handled twice (Electron throws on the second registration):\n${duplicates.join('\n')}`);

  const seenListeners = new Map();
  const duplicateListeners = [];
  for (const entry of listened) {
    const previous = seenListeners.get(entry.channel);
    if (previous) duplicateListeners.push(`  ${entry.channel} — ${previous} and ${entry.file}`);
    else seenListeners.set(entry.channel, entry.file);
  }
  assert.deepEqual(
    duplicateListeners,
    [],
    `listened twice (both listeners run, so side effects happen twice):\n${duplicateListeners.join('\n')}`
  );
});

test('every event the bridge subscribes to is emitted somewhere in the main process', () => {
  // Push channels have no handler to pair with — they are webContents.send from
  // wherever the work happens — so the check is that the name exists main-side at
  // all. A renderer listening on a channel no main file even mentions is dead.
  const orphanEvents = [...names(subscribed)]
    .filter((channel) => !mainFiles.some((entry) => entry.code.includes(`'${channel}'`)))
    .sort();
  assert.deepEqual(
    orphanEvents,
    [],
    `the bridge subscribes to events no main-process file emits:\n` +
      orphanEvents.map((channel) => `  ${channel} — listened in ${where(subscribed, channel)}`).join('\n')
  );
});

test('the channel census has not collapsed', () => {
  assert.ok(
    names(handled).size >= MIN_HANDLED_CHANNELS,
    `only ${names(handled).size} handled channels found (floor ${MIN_HANDLED_CHANNELS}). A whole block of handlers looks like it went missing, or the extraction patterns stopped matching how handlers are written.`
  );
  assert.ok(
    names(listened).size >= MIN_EVENT_LISTENER_CHANNELS,
    `only ${names(listened).size} ipcMain.on channels found (floor ${MIN_EVENT_LISTENER_CHANNELS}).`
  );
});
