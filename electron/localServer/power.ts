// Keeping this computer awake while it is serving.
//
// Two defences, deliberately separate, because they cost very different things.
//
// "Keep awake" is powerSaveBlocker: it stops *idle* sleep, needs no password, changes no system
// setting and is released the moment Nodus lets go of it. It is what almost everybody needs.
//
// "Keep serving with the lid closed" is the honest hard case. macOS sleeps on lid close no matter
// what an application asks for; the only lever is `pmset disablesleep`, which is a machine-wide
// setting and needs an administrator. So Nodus does not pretend: it asks the operating system to
// show its own authentication dialog, the user types their own password there, and Nodus never
// sees it. Because that setting outlives the process that set it, it is reverted on quit and
// checked again at startup — a crash must not leave somebody's laptop unable to sleep forever.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, powerMonitor, powerSaveBlocker } from 'electron';
import type { LocalServerPowerStatus } from '@shared/types';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 120_000;

export type CommandRunner = (cmd: string, args: string[]) => Promise<unknown>;

const defaultRunner: CommandRunner = (cmd, args) =>
  execFileAsync(cmd, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true });

let blockerId: number | null = null;
let lidHeld = false;
let lastError: string | null = null;

// ── Idle sleep ─────────────────────────────────────────────────────────────

export function isAwakeHeld(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
}

export function holdAwake(): void {
  if (isAwakeHeld()) return;
  // 'prevent-app-suspension' keeps the system awake while letting the screen go dark, which is
  // what a machine acting as a server wants: display sleep costs nothing and saves the panel.
  blockerId = powerSaveBlocker.start('prevent-app-suspension');
}

export function releaseAwake(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = null;
}

// ── Lid-close sleep ────────────────────────────────────────────────────────

/**
 * The command that disables (or restores) system sleep, per platform.
 *
 * Pure so the tests can assert exactly what would run without running it — flipping a real
 * machine's power settings is not something a test suite should do.
 *
 * macOS routes through osascript so the system presents its own authentication dialog. Windows
 * edits the lid-close action of the active power plan for both AC and battery, elevated through
 * UAC. Linux returns null: the switch lives in /etc/systemd/logind.conf, which is a root-owned
 * configuration file the user should edit knowingly rather than have an app rewrite.
 */
export function lidCommand(
  platform: NodeJS.Platform,
  enable: boolean,
): { cmd: string; args: string[] } | null {
  if (platform === 'darwin') {
    const script = `do shell script "pmset -a disablesleep ${enable ? 1 : 0}" with administrator privileges`;
    return { cmd: 'osascript', args: ['-e', script] };
  }
  if (platform === 'win32') {
    // 0 = do nothing on lid close, 1 = sleep. SUB_BUTTONS/LIDACTION is the lid switch action.
    const action = enable ? '0' : '1';
    const commands = [
      `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION ${action}`,
      `powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION ${action}`,
      'powercfg /setactive SCHEME_CURRENT',
    ].join('; ');
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${commands}'`,
      ],
    };
  }
  return null;
}

/** The instruction shown on platforms Nodus will not configure itself. */
export const LINUX_LID_INSTRUCTION =
  'Set HandleLidSwitch=ignore in /etc/systemd/logind.conf and run: sudo systemctl restart systemd-logind';

export function lidSupported(platform: NodeJS.Platform = process.platform): boolean {
  return lidCommand(platform, true) !== null;
}

/**
 * Whether the system currently has sleep disabled, regardless of who did it.
 *
 * Used to notice a setting orphaned by a crash. Only macOS reports this cheaply and
 * unambiguously; elsewhere Nodus trusts its own record.
 */
export async function systemSleepDisabled(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = defaultRunner,
): Promise<boolean> {
  if (platform !== 'darwin') return false;
  try {
    const result = (await runner('pmset', ['-g'])) as { stdout?: string };
    return /SleepDisabled\s+1/.test(String(result?.stdout ?? ''));
  } catch {
    return false;
  }
}

export async function holdLid(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const command = lidCommand(platform, true);
  if (!command) throw new Error(LINUX_LID_INSTRUCTION);
  // A laptop that cannot sleep and is not charging is a laptop that dies mid-publication, or
  // cooks itself in a bag. The user can plug in and turn it on again.
  if (powerMonitor.isOnBatteryPower()) {
    throw new Error('Connect the charger before asking this computer to keep serving with the lid closed.');
  }
  await runner(command.cmd, command.args);
  lidHeld = true;
  lastError = null;
}

export async function releaseLid(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const command = lidCommand(platform, false);
  if (!command) return;
  await runner(command.cmd, command.args);
  lidHeld = false;
}

/** Best-effort revert during quit. Never throws: quitting must not be blocked by a dialog. */
export function releaseLidSync(): void {
  if (!lidHeld) return;
  const command = lidCommand(process.platform, false);
  lidHeld = false;
  if (!command) return;
  try {
    // Detached and unawaited: before-quit cannot wait, and the authentication dialog this may
    // raise would outlive us anyway.
    execFile(command.cmd, command.args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
  } catch {
    // Nothing more to try while the process is going away.
  }
}

export async function powerStatus(): Promise<LocalServerPowerStatus> {
  const supported = lidSupported();
  const systemDisabled = await systemSleepDisabled();
  return {
    awake: isAwakeHeld(),
    lidOpenServing: lidHeld,
    lidSupported: supported,
    onBattery: powerMonitor.isOnBatteryPower(),
    orphaned: supported && systemDisabled && !lidHeld,
    error: lastError,
  };
}

export function recordPowerError(message: string | null): void {
  lastError = message;
}

/** Release everything this module holds. Called from before-quit. */
export function releaseAllPower(): void {
  releaseAwake();
  releaseLidSync();
}

app.on('before-quit', releaseAllPower);
