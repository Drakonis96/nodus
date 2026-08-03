// The sleep defences behind basic mode, checked without touching this machine's power settings.
//
// `pmset -a disablesleep 1` and `powercfg ... LIDACTION 0` are machine-wide changes that outlive
// the process making them. A test suite must never actually run them — a failed assertion halfway
// through would leave the developer's laptop unable to sleep. So the commands are built by pure
// functions and asserted on as data, and the runner is injected everywhere it is needed.
//
// What that leaves worth proving: the right command per platform, that Linux is refused rather
// than given something that silently does nothing, and that turning it off is the exact inverse
// of turning it on. That last one is what keeps a machine from being left permanently awake.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-power-'));
const outfile = path.join(tmp, 'power.mjs');

await build({
  entryPoints: [path.join(repoRoot, 'electron/localServer/power.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Electron is not installed in a plain Node process, and nothing under test needs it: the
  // pure command builders are what this file measures.
  external: ['electron'],
  alias: { '@shared': path.join(repoRoot, 'shared') },
  logLevel: 'silent',
});

// A stub for the one Electron import the module makes at load time.
const stub = path.join(tmp, 'node_modules', 'electron');
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync(stub, { recursive: true });
writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'electron', type: 'module', main: 'index.js' }));
writeFileSync(path.join(stub, 'index.js'), `
export const app = { on: () => undefined };
export const powerMonitor = { isOnBatteryPower: () => globalThis.__onBattery === true };
export const powerSaveBlocker = { start: () => 1, stop: () => undefined, isStarted: () => true };
`);

const power = await import(pathToFileURL(outfile).href);

/**
 * This machine's real sleep flag, read only.
 *
 * The tests below all inject their runner, so none of them can reach the real `pmset`. This
 * reads the actual setting before and after so that stops being an argument and becomes a
 * measurement: if somebody later drops an injected runner and the default one fires, the
 * developer's own laptop is left unable to sleep, and the suite should say so loudly rather
 * than pass and leave them to discover it when their battery is flat.
 */
async function realSleepDisabled() {
  if (process.platform !== 'darwin') return null;
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  try {
    const { stdout } = await promisify(execFile)('pmset', ['-g'], { timeout: 5_000 });
    return /SleepDisabled\s+1/.test(stdout);
  } catch {
    return null;
  }
}

const sleepFlagBefore = await realSleepDisabled();

test('macOS routes through the system authentication dialog, never a password Nodus holds', () => {
  const on = power.lidCommand('darwin', true);
  assert.equal(on.cmd, 'osascript');
  const script = on.args.join(' ');
  assert.match(script, /pmset -a disablesleep 1/);
  assert.match(script, /with administrator privileges/);
  // The whole point: Nodus asks the operating system to prompt, it does not collect a password.
  assert.doesNotMatch(script, /sudo\s+-S|echo\s|password/i);
});

test('turning it off is the exact inverse, so nothing is left disabled', () => {
  const off = power.lidCommand('darwin', false);
  assert.match(off.args.join(' '), /pmset -a disablesleep 0/);

  const onWin = power.lidCommand('win32', true).args.join(' ');
  const offWin = power.lidCommand('win32', false).args.join(' ');
  // 0 = do nothing on lid close; 1 = sleep, which is Windows' own default.
  assert.match(onWin, /LIDACTION 0/);
  assert.match(offWin, /LIDACTION 1/);
  assert.doesNotMatch(onWin, /LIDACTION 1/);
  assert.doesNotMatch(offWin, /LIDACTION 0/);
});

test('Windows sets both power sources and elevates through UAC', () => {
  const command = power.lidCommand('win32', true);
  assert.equal(command.cmd, 'powershell');
  const script = command.args.join(' ');
  assert.match(script, /setacvalueindex/);
  assert.match(script, /setdcvalueindex/, 'the battery profile matters most: that is the unplugged case');
  assert.match(script, /setactive SCHEME_CURRENT/, 'powercfg changes do nothing until the scheme is reapplied');
  assert.match(script, /RunAs/);
});

test('Linux is refused rather than handed a command that quietly does nothing', () => {
  assert.equal(power.lidCommand('linux', true), null);
  assert.equal(power.lidSupported('linux'), false);
  assert.equal(power.lidSupported('darwin'), true);
  assert.equal(power.lidSupported('win32'), true);
  assert.match(power.LINUX_LID_INSTRUCTION, /logind\.conf/);
  assert.match(power.LINUX_LID_INSTRUCTION, /HandleLidSwitch=ignore/);
});

test('holding the lid open refuses on battery, and runs nothing when it refuses', async () => {
  globalThis.__onBattery = true;
  const ran = [];
  const runner = async (cmd, args) => { ran.push([cmd, args]); };
  await assert.rejects(
    () => power.holdLid('darwin', runner),
    /Connect the charger/,
    'a laptop that cannot sleep and is not charging is the failure mode this prevents',
  );
  assert.deepEqual(ran, [], 'refusing must not still run the command');
});

test('on mains power it runs exactly one command, the macOS one', async () => {
  globalThis.__onBattery = false;
  const ran = [];
  await power.holdLid('darwin', async (cmd, args) => { ran.push([cmd, args]); });
  assert.equal(ran.length, 1);
  assert.equal(ran[0][0], 'osascript');
  assert.match(ran[0][1].join(' '), /disablesleep 1/);
});

test('releasing is allowed on battery, so nobody is trapped by unplugging', async () => {
  globalThis.__onBattery = true;
  const ran = [];
  await power.releaseLid('darwin', async (cmd, args) => { ran.push([cmd, args]); });
  assert.equal(ran.length, 1, 'turning it off must never be blocked by the battery guard');
  assert.match(ran[0][1].join(' '), /disablesleep 0/);
});

test('releasing on Linux is a silent no-op rather than an error', async () => {
  globalThis.__onBattery = false;
  const ran = [];
  await power.releaseLid('linux', async (cmd, args) => { ran.push([cmd, args]); });
  assert.deepEqual(ran, []);
});

test('an orphaned system setting is read from pmset, not assumed', async () => {
  const disabled = await power.systemSleepDisabled('darwin', async () => ({ stdout: ' SleepDisabled  1\n sleep 0\n' }));
  assert.equal(disabled, true);
  const enabled = await power.systemSleepDisabled('darwin', async () => ({ stdout: ' SleepDisabled  0\n' }));
  assert.equal(enabled, false);
  // A pmset that cannot be run is "we do not know", which must not read as "disabled".
  const broken = await power.systemSleepDisabled('darwin', async () => { throw new Error('no pmset'); });
  assert.equal(broken, false);
  assert.equal(await power.systemSleepDisabled('win32', async () => ({ stdout: 'SleepDisabled 1' })), false);
});

test('running this suite left the real machine exactly as it found it', async () => {
  const after = await realSleepDisabled();
  assert.equal(
    after,
    sleepFlagBefore,
    'these tests must never change this computer\'s sleep setting — an injected runner was probably dropped',
  );
});

test.after(() => rm(tmp, { recursive: true, force: true }));
