import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSettings } from '../db/settingsRepo';

const COPILOT_ADDIN_ID = 'E4352919-FFEC-4F77-8268-975BB4217FAD';
const CACHE_SCAN_MAX_BYTES = 2 * 1024 * 1024;

export interface CopilotInstallResult {
  ok: boolean;
  message: string;
  manifestPath: string | null;
  cacheEntriesRemoved?: number;
}

function wordManifestDirectory(): string | null {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Containers', 'com.microsoft.Word', 'Data', 'Documents', 'wef');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, 'Microsoft', 'Office', '16.0', 'Wef') : null;
  }
  return null;
}

function wordCacheDirectory(): string | null {
  if (process.platform === 'darwin') {
    return path.join(
      homedir(),
      'Library',
      'Containers',
      'com.microsoft.Word',
      'Data',
      'Library',
      'Application Support',
      'Microsoft',
      'Office',
      '16.0',
      'Wef'
    );
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, 'Microsoft', 'Office', '16.0', 'Wef') : null;
  }
  return null;
}

function manifestVersion(version: string): string {
  const parts = String(version)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part) && part >= 0)
    .slice(0, 4);
  if (parts.length === 0) return '0.1.0';
  while (parts.length < 3) parts.push(0);
  return parts.join('.');
}

export function renderManifest(template: string, port: number, appVersion: string): string {
  const origin = `https://localhost:${port}`;
  return template
    .replace(/<Version>[^<]+<\/Version>/, `<Version>${manifestVersion(appVersion)}</Version>`)
    .replace(/https:\/\/localhost:\d+/g, origin)
    .replace(/Nodus Copiloto/g, 'Nodus Copilot')
    .replace(/Copiloto Nodus/g, 'Nodus Copilot');
}

function isCopilotCacheText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(COPILOT_ADDIN_ID.toLowerCase()) ||
    lower.includes('nodus copilot') ||
    lower.includes('nodus copiloto') ||
    lower.includes('copiloto nodus')
  );
}

export async function purgeCachedCopilotAddin(cacheDir: string | null = wordCacheDirectory()): Promise<number> {
  if (!cacheDir) return 0;
  let removed = 0;
  async function visit(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > CACHE_SCAN_MAX_BYTES) continue;
        const text = await fs.readFile(fullPath, 'utf8');
        if (!isCopilotCacheText(text)) continue;
        await fs.unlink(fullPath);
        removed++;
      } catch {
        // Cache cleanup is best-effort. A locked file should not block install.
      }
    }
  }
  await visit(cacheDir);
  return removed;
}

export async function installCopilotAddin(appRoot: string, appVersion = '0.1.0'): Promise<CopilotInstallResult> {
  const targetDir = wordManifestDirectory();
  if (!targetDir) {
    return {
      ok: false,
      manifestPath: null,
      message: 'La instalación automática del complemento solo está preparada para Word de escritorio en macOS o Windows.',
    };
  }

  try {
    const cacheEntriesRemoved = await purgeCachedCopilotAddin();
    const sourcePath = path.join(appRoot, 'word-addin', 'manifest.xml');
    const template = await fs.readFile(sourcePath, 'utf8');
    const manifest = renderManifest(template, getSettings().copilotPort, appVersion);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, 'nodus-copilot.manifest.xml');
    await fs.writeFile(targetPath, manifest, 'utf8');
    const cacheText =
      cacheEntriesRemoved > 0 ? ` Se limpiaron ${cacheEntriesRemoved} entrada(s) antiguas de la caché local de Word.` : '';
    return {
      ok: true,
      manifestPath: targetPath,
      cacheEntriesRemoved,
      message: `Nodus Copilot instalado/actualizado para Word con pestaña propia “Nodus”.${cacheText} Reinicia Word si el complemento ya estaba abierto.`,
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: null,
      cacheEntriesRemoved: 0,
      message: `No se pudo instalar el complemento: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function installLibreOfficeCopilot(appRoot: string): Promise<CopilotInstallResult> {
  if (process.platform !== 'linux') {
    return {
      ok: false,
      manifestPath: null,
      message: 'La instalación automática del macro de LibreOffice solo está soportada en sistemas Linux.',
    };
  }

  const targetDir = path.join(homedir(), '.config', 'libreoffice', '4', 'user', 'Scripts', 'python');
  const targetPath = path.join(targetDir, 'nodus_copilot.py');
  const sourcePath = path.join(appRoot, 'scripts', 'nodus_copilot.py');

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return {
      ok: true,
      manifestPath: targetPath,
      message: `Macro de LibreOffice copiado con éxito en: ${targetPath}. Reinicia LibreOffice Writer si lo tenías abierto.`,
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: null,
      message: `No se pudo copiar el macro: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
