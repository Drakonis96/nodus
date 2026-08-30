// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { BrowserWindow, app, dialog } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

import type { BrowserConnectorExportResult } from '@shared/types';

const ARCHIVE_NAME = 'nodus-research-connector-chrome.zip';

function packagedArchivePath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'browser', ARCHIVE_NAME),
    path.join(app.getAppPath(), 'dist-browser', ARCHIVE_NAME),
  ];
  const archive = [...new Set(candidates)].find((candidate) => existsSync(candidate));
  if (!archive) {
    throw new Error('No se encontró el conector integrado. En desarrollo, ejecuta "npm run browser:zip".');
  }
  return archive;
}

export async function exportBrowserConnectorZip(): Promise<BrowserConnectorExportResult> {
  try {
    const defaultPath = path.join(app.getPath('downloads'), ARCHIVE_NAME);
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options = { defaultPath, filters: [{ name: 'Chrome extension', extensions: ['zip'] }] };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false, path: null, canceled: true };
    await fs.copyFile(packagedArchivePath(), result.filePath);
    return { ok: true, path: result.filePath, canceled: false };
  } catch (error) {
    return {
      ok: false,
      path: null,
      canceled: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
