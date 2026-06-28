import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSettings } from '../db/settingsRepo';

export interface CopilotInstallResult {
  ok: boolean;
  message: string;
  manifestPath: string | null;
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

function renderManifest(template: string, port: number): string {
  const origin = `https://localhost:${port}`;
  return template
    .replace(/https:\/\/localhost:\d+/g, origin)
    .replace(/Nodus Copiloto/g, 'Nodus Copilot')
    .replace(/Copiloto Nodus/g, 'Nodus Copilot');
}

export async function installCopilotAddin(appRoot: string): Promise<CopilotInstallResult> {
  const targetDir = wordManifestDirectory();
  if (!targetDir) {
    return {
      ok: false,
      manifestPath: null,
      message: 'La instalación automática del complemento solo está preparada para Word de escritorio en macOS o Windows.',
    };
  }

  try {
    const sourcePath = path.join(appRoot, 'word-addin', 'manifest.xml');
    const template = await fs.readFile(sourcePath, 'utf8');
    const manifest = renderManifest(template, getSettings().copilotPort);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, 'nodus-copilot.manifest.xml');
    await fs.writeFile(targetPath, manifest, 'utf8');
    return {
      ok: true,
      manifestPath: targetPath,
      message: `Nodus Copilot instalado/actualizado para Word. Reinicia Word si el complemento ya estaba abierto.`,
    };
  } catch (error) {
    return {
      ok: false,
      manifestPath: null,
      message: `No se pudo instalar el complemento: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
