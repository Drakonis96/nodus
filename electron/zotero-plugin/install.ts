// One-click install/update of the "Nodus for Zotero" plugin into the user's
// Zotero profile. Zotero ignores an .xpi merely dropped into extensions/ UNLESS
// a full extension rescan is forced, so we: (Zotero closed) copy the same
// prebuilt .xpi that ships on GitHub Releases, force a rescan via prefs, clear
// the startup caches, and relaunch.
// Verified against Zotero 9: a VALID .xpi (with update_url) is auto-registered
// by the startup scan — no need to hand-edit extensions.json.
import AdmZip from 'adm-zip';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, dialog, BrowserWindow } from 'electron';

const execFileAsync = promisify(execFile);
const PLUGIN_ID = 'nodus-zotero@nodus.app';
const PLUGIN_XPI_NAME = 'nodus-zotero.xpi';
const REQUIRED_XPI_ENTRIES = [
  'manifest.json',
  'content/local-embeddings.js',
  'content/runtime/local-embedding-worker.js',
  'content/runtime/ort-wasm-simd-threaded.jsep.mjs',
  'content/runtime/ort-wasm-simd-threaded.jsep.wasm',
  'icons/nodus.svg',
] as const;

export interface ZoteroInstallInfo {
  profileFound: boolean;
  running: boolean;
  profilePath: string | null;
}
export interface ZoteroInstallResult {
  ok: boolean;
  message: string;
  running: boolean;
  reopened: boolean;
}
export interface ZoteroExportResult {
  ok: boolean;
  path: string | null;
  canceled: boolean;
  message?: string;
}

function zoteroRootDir(): string | null {
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Zotero');
  if (process.platform === 'win32') return process.env.APPDATA ? path.join(process.env.APPDATA, 'Zotero', 'Zotero') : null;
  return path.join(homedir(), '.zotero', 'zotero');
}

async function findProfileDir(): Promise<string | null> {
  const root = zoteroRootDir();
  if (!root) return null;
  try {
    const ini = await fs.readFile(path.join(root, 'profiles.ini'), 'utf8');
    const blocks = ini.split(/\r?\n\s*\r?\n/);
    let firstPath: string | null = null;
    let defaultPath: string | null = null;
    for (const b of blocks) {
      if (!/^\[Profile/m.test(b)) continue;
      const pathM = b.match(/^\s*Path\s*=\s*(.+?)\s*$/m);
      if (!pathM) continue;
      const relM = b.match(/^\s*IsRelative\s*=\s*(\d)\s*$/m);
      const rel = !relM || relM[1] === '1';
      const resolved = rel ? path.join(root, pathM[1].trim()) : pathM[1].trim();
      if (!firstPath) firstPath = resolved;
      if (/^\s*Default\s*=\s*1\s*$/m.test(b)) defaultPath = resolved;
    }
    const chosen = defaultPath || firstPath;
    if (chosen && existsSync(chosen)) return chosen;
  } catch {
    /* no profiles.ini — fall back */
  }
  try {
    const profilesDir = path.join(root, 'Profiles');
    const entries = await fs.readdir(profilesDir);
    const def = entries.find((e) => /\.default/i.test(e)) || entries[0];
    if (def) return path.join(profilesDir, def);
  } catch {
    /* none */
  }
  return null;
}

export async function isZoteroRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq zotero.exe', '/NH']);
      return /zotero\.exe/i.test(stdout);
    }
    const pattern = process.platform === 'darwin' ? 'Zotero.app/Contents/MacOS/zotero' : 'zotero';
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern]);
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits non-zero when there is no match
  }
}

async function quitZotero(): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', ['-e', 'tell application "Zotero" to quit']).catch(() => {});
  } else if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/IM', 'zotero.exe']).catch(() => {});
  } else {
    await execFileAsync('pkill', ['-x', 'zotero']).catch(() => {});
  }
  for (let i = 0; i < 40; i += 1) {
    if (!(await isZoteroRunning())) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function launchZotero(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') { await execFileAsync('open', ['-a', 'Zotero']); return true; }
    if (process.platform === 'win32') { await execFileAsync('cmd', ['/c', 'start', '', 'zotero']); return true; }
    await execFileAsync('sh', ['-c', 'zotero >/dev/null 2>&1 &']);
    return true;
  } catch {
    return false;
  }
}

function packagedXpiCandidates(): string[] {
  const candidates = [
    path.join(process.resourcesPath || '', 'zotero', PLUGIN_XPI_NAME),
    path.join(app.getAppPath(), 'dist-zotero', PLUGIN_XPI_NAME),
  ];
  return [...new Set(candidates.filter((candidate) => candidate && existsSync(candidate)))];
}

function validatePackagedXpi(xpiPath: string): void {
  const zip = new AdmZip(xpiPath);
  const names = new Set(zip.getEntries().map((entry) => entry.entryName));
  for (const required of REQUIRED_XPI_ENTRIES) {
    if (!names.has(required)) throw new Error(`El XPI integrado no contiene ${required}.`);
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('El XPI integrado no contiene manifest.json.');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
    version?: string;
    applications?: { zotero?: { id?: string } };
  };
  if (manifest.applications?.zotero?.id !== PLUGIN_ID) {
    throw new Error('El XPI integrado tiene un identificador de plugin inesperado.');
  }
  if (!manifest.version) throw new Error('El XPI integrado no declara una versión.');
}

function packagedXpiPath(): string {
  const candidate = packagedXpiCandidates()[0];
  if (!candidate) {
    throw new Error(
      'No se encontró el XPI integrado de Nodus. En desarrollo, ejecuta "npm run zotero:xpi" antes de instalar.',
    );
  }
  validatePackagedXpi(candidate);
  return candidate;
}

async function copyPackagedXpi(destXpi: string): Promise<void> {
  await fs.copyFile(packagedXpiPath(), destXpi);
}

async function ensurePrefs(profile: string): Promise<void> {
  const prefsPath = path.join(profile, 'prefs.js');
  let prefs: string;
  try {
    prefs = await fs.readFile(prefsPath, 'utf8');
  } catch {
    return; // no prefs.js yet; the rescan defaults still apply on first run
  }
  // Drop cache-pinning lines so Zotero does a full extension rescan next start.
  prefs = prefs
    .split('\n')
    .filter((l) => !/extensions\.(lastAppBuildId|lastAppVersion|lastPlatformVersion)/.test(l))
    .join('\n');
  const add: string[] = [];
  if (!/extensions\.startupScanScopes/.test(prefs)) add.push('user_pref("extensions.startupScanScopes", 15);');
  if (!/extensions\.autoDisableScopes/.test(prefs)) add.push('user_pref("extensions.autoDisableScopes", 0);');
  if (add.length) prefs = prefs.replace(/\s*$/, '') + '\n' + add.join('\n') + '\n';
  await fs.writeFile(prefsPath, prefs, 'utf8');
}

export async function getZoteroInstallInfo(): Promise<ZoteroInstallInfo> {
  const profile = await findProfileDir();
  return { profileFound: !!profile, running: await isZoteroRunning(), profilePath: profile };
}

/** Save the packaged .xpi to a user-chosen location for manual install. */
export async function exportZoteroPluginXpi(): Promise<ZoteroExportResult> {
  try {
    const defaultPath = path.join(app.getPath('downloads'), PLUGIN_XPI_NAME);
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const opts = { defaultPath, filters: [{ name: 'Zotero plugin', extensions: ['xpi'] }] };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { ok: false, path: null, canceled: true };
    await copyPackagedXpi(result.filePath);
    return { ok: true, path: result.filePath, canceled: false };
  } catch (error) {
    return { ok: false, path: null, canceled: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Install or update the plugin. Closes Zotero if running and reopens it after. */
export async function installZoteroPlugin(): Promise<ZoteroInstallResult> {
  const profile = await findProfileDir();
  if (!profile) return { ok: false, message: 'No se encontró el perfil de Zotero en este equipo.', running: false, reopened: false };
  const running = await isZoteroRunning();
  try {
    if (running) await quitZotero();
    if (await isZoteroRunning()) {
      return { ok: false, message: 'No se pudo cerrar Zotero. Ciérralo manualmente e inténtalo de nuevo.', running, reopened: false };
    }
    const extDir = path.join(profile, 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    await copyPackagedXpi(path.join(extDir, `${PLUGIN_ID}.xpi`));
    await ensurePrefs(profile);
    await fs.rm(path.join(profile, 'addonStartup.json.lz4'), { force: true }).catch(() => {});
    await fs.rm(path.join(profile, 'startupCache'), { recursive: true, force: true }).catch(() => {});
    let reopened = false;
    if (running) reopened = await launchZotero();
    return {
      ok: true,
      message: running ? 'Plugin instalado en Zotero. Zotero se ha reabierto.' : 'Plugin instalado. Se cargará la próxima vez que abras Zotero.',
      running,
      reopened,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), running, reopened: false };
  }
}
