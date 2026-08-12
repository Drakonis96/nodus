import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSettings } from '../db/settingsRepo';

export interface CopilotInstallResult {
  ok: boolean;
  message: string;
  manifestPath: string | null;
}

function installText(es: string, en: string): string {
  return getSettings().uiLanguage === 'es' ? es : en;
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

/**
 * Never delete individual files from Office's add-in cache to force a refresh.
 * Microsoft documents that doing so "can cause all add-ins to stop loading", and
 * it did exactly that here: a surgical purge of our own entries left Word unable
 * to register any sideloaded add-in at all. Bumping <Version> in the manifest is
 * the sanctioned way to make Office pick up a changed manifest; if a cache reset
 * is ever unavoidable it must clear the whole cache directory, with Word closed.
 * See https://learn.microsoft.com/office/dev/add-ins/testing/clear-cache
 */
export async function installCopilotAddin(appRoot: string, appVersion = '0.1.0'): Promise<CopilotInstallResult> {
  const targetDir = wordManifestDirectory();
  if (!targetDir) {
    return {
      ok: false,
      manifestPath: null,
      message: installText(
        'La instalación automática del complemento solo está preparada para Word de escritorio en macOS o Windows.',
        'Automatic add-in installation is only available for desktop Word on macOS or Windows.'
      ),
    };
  }

  try {
    const sourcePath = path.join(appRoot, 'word-addin', 'manifest.xml');
    const template = await fs.readFile(sourcePath, 'utf8');
    const manifest = renderManifest(template, getSettings().copilotPort, appVersion);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, 'nodus-copilot.manifest.xml');
    const stagingPath = `${targetPath}.tmp`;
    await fs.writeFile(stagingPath, manifest, 'utf8');
    try {
      await fs.rename(stagingPath, targetPath);
    } catch {
      // Windows cannot replace an existing destination with rename(). The
      // staged manifest is complete, so only the single previous manifest is
      // removed before the retry; Office's shared cache remains untouched.
      await fs.rm(targetPath, { force: true });
      await fs.rename(stagingPath, targetPath);
    }
    return {
      ok: true,
      manifestPath: targetPath,
      message: installText(
        'Nodus Copilot instalado/actualizado para Word. Cierra Word del todo (Cmd+Q) y vuelve a abrirlo. La pestaña “Nodus” quedará disponible en la cinta para todos los documentos; no es necesario volver a añadir el complemento.',
        'Nodus Copilot was installed/updated for Word. Quit Word completely (Cmd+Q) and reopen it. The “Nodus” tab will remain available on the ribbon for every document; you do not need to add the add-in again.'
      ),
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: null,
      message: installText(
        `No se pudo instalar el complemento: ${error instanceof Error ? error.message : String(error)}`,
        `The add-in could not be installed: ${error instanceof Error ? error.message : String(error)}`
      ),
    };
  }
}

/** LibreOffice per-user Python scripts directory, or null on unsupported platforms. */
function libreOfficeScriptsDirectory(): string | null {
  if (process.platform === 'linux') {
    return path.join(homedir(), '.config', 'libreoffice', '4', 'user', 'Scripts', 'python');
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'LibreOffice', '4', 'user', 'Scripts', 'python');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, 'LibreOffice', '4', 'user', 'Scripts', 'python') : null;
  }
  return null;
}

export async function installLibreOfficeCopilot(appRoot: string): Promise<CopilotInstallResult> {
  const targetDir = libreOfficeScriptsDirectory();
  if (!targetDir) {
    return {
      ok: false,
      manifestPath: null,
      message: installText(
        'La instalación automática del macro de LibreOffice no está soportada en esta plataforma.',
        'Automatic LibreOffice macro installation is not supported on this platform.'
      ),
    };
  }

  const targetPath = path.join(targetDir, 'nodus_copilot.py');
  const sourcePath = path.join(appRoot, 'scripts', 'nodus_copilot.py');

  try {
    // readFile + writeFile (not copyFile): the source lives inside app.asar in the
    // packaged app, where Electron's fs patching reliably covers reads.
    const macro = await fs.readFile(sourcePath, 'utf8');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, macro, 'utf8');
    return {
      ok: true,
      manifestPath: targetPath,
      message: installText(
        `Macro de LibreOffice instalado en: ${targetPath}. En LibreOffice Writer, ejecútalo desde Herramientas → Macros → Ejecutar macro → Mis macros → nodus_copilot → start_nodus_copilot.`,
        `LibreOffice macro installed at: ${targetPath}. In LibreOffice Writer, run it from Tools → Macros → Run Macro → My Macros → nodus_copilot → start_nodus_copilot.`
      ),
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: null,
      message: installText(
        `No se pudo copiar el macro: ${error instanceof Error ? error.message : String(error)}`,
        `The macro could not be copied: ${error instanceof Error ? error.message : String(error)}`
      ),
    };
  }
}
