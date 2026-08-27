// Export and validate the exact "Nodus for Zotero" XPI shipped with Nodus.
// Zotero 9 deliberately disables foreign profile sideloads unless broad global
// preferences are weakened. We never change those preferences or hand-edit the
// add-on database: installation goes through Zotero's official Add-ons UI.
import AdmZip from 'adm-zip';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

function packagedXpiCandidates(): string[] {
  const candidates = [
    path.join(process.resourcesPath || '', 'zotero', PLUGIN_XPI_NAME),
    path.join(app.getAppPath(), 'dist-zotero', PLUGIN_XPI_NAME),
  ];
  return [...new Set(candidates.filter((candidate) => candidate && existsSync(candidate)))];
}

function validatePackagedXpi(xpiPath: string): void {
  const zip = new AdmZip(xpiPath);
  const entries = zip.getEntries();
  // Reading every entry makes AdmZip validate its CRC instead of accepting a
  // central directory whose required filenames merely look plausible.
  for (const entry of entries) if (!entry.isDirectory) entry.getData();
  const names = new Set(entries.map((entry) => entry.entryName));
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
  const updatesPath = path.join(path.dirname(xpiPath), 'updates.json');
  if (!existsSync(updatesPath)) throw new Error('Falta el manifiesto de integridad del XPI integrado.');
  const updates = JSON.parse(readFileSync(updatesPath, 'utf8')) as {
    addons?: Record<string, { updates?: Array<{ version?: string; update_hash?: string }> }>;
  };
  const release = updates.addons?.[PLUGIN_ID]?.updates?.find((entry) => entry.version === manifest.version);
  if (!release) throw new Error('La versión del XPI no coincide con su manifiesto de integridad.');
  const expectedHash = /^sha256:([0-9a-f]{64})$/i.exec(release.update_hash ?? '')?.[1]?.toLowerCase();
  const actualHash = createHash('sha256').update(readFileSync(xpiPath)).digest('hex');
  if (!expectedHash || actualHash !== expectedHash) throw new Error('El hash del XPI integrado no coincide.');
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

/**
 * Legacy API kept for older renderers. Direct profile sideloading cannot be
 * made both reliable and scoped on Zotero 9, so fail closed and direct the user
 * to the official Add-ons flow. New UI calls exportZoteroPluginXpi() directly.
 */
export async function installZoteroPlugin(): Promise<ZoteroInstallResult> {
  const running = await isZoteroRunning();
  return {
    ok: false,
    message: 'Guarda el archivo .xpi y, en Zotero, abre Herramientas → Complementos → ⚙ → Instalar complemento desde archivo.',
    running,
    reopened: false,
  };
}
