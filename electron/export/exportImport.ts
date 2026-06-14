import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import { dbPath, closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
import { getSettings } from '../db/settingsRepo';

interface Manifest {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
}

/**
 * Export a self-contained `*.nodus` archive (zip): full database + manifest +
 * non-secret settings. The AI key is NEVER exported.
 */
export async function exportData(): Promise<{ path: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar biblioteca Nodus',
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  // Checkpoint WAL so the .sqlite file is complete on disk.
  getDb().pragma('wal_checkpoint(TRUNCATE)');

  const settings = getSettings();
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: app.getVersion(),
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  const { providerKeys, ...nonSecret } = settings; // strip derived key-presence flags

  const zip = new AdmZip();
  zip.addLocalFile(dbPath(), '', 'database.sqlite');
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('settings.json', Buffer.from(JSON.stringify(nonSecret, null, 2)));
  zip.writeZip(filePath);

  return { path: filePath };
}

/** Import a `*.nodus` archive, validating schema compatibility. */
export async function importData(): Promise<{ ok: boolean; message: string }> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Importar biblioteca Nodus',
    properties: ['openFile'],
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false, message: 'Cancelado' };

  const zip = new AdmZip(filePaths[0]);
  const manifestEntry = zip.getEntry('manifest.json');
  const dbEntry = zip.getEntry('database.sqlite');
  if (!manifestEntry || !dbEntry) {
    return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o base de datos.' };
  }

  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as Manifest;
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `El archivo usa un esquema más reciente (v${manifest.schemaVersion}) que esta versión de Nodus (v${SCHEMA_VERSION}). Actualiza la app.`,
    };
  }

  // Write the imported DB to a temp file, then swap it in (migrations run on open).
  const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}.sqlite`);
  fs.writeFileSync(tmp, dbEntry.getData());
  closeDb();
  replaceDbFile(tmp);
  fs.unlinkSync(tmp);

  // Restore non-secret settings.
  const settingsEntry = zip.getEntry('settings.json');
  if (settingsEntry) {
    const imported = JSON.parse(zip.readAsText(settingsEntry));
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(imported));
  }

  return {
    ok: true,
    message: 'Importación completa. Reintroduce la clave de IA y verifica la ruta de storage de Zotero en Ajustes.',
  };
}
