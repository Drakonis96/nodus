import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getSettings } from '../db/settingsRepo';

/**
 * The user's vendor stock lists (Mcule, Enamine, …): catalogues they downloaded and imported
 * with scripts/import-stock.mjs into <userData>/chemistry-stock (NODUS_STOCK_DIR overrides it).
 * Chemistry Studio reads them to mark precursors and starting materials as purchasable. There
 * is no list until the user imports one; everything that uses it is skipped until then, and
 * when the user switches stock off (Settings, or NODUS_STOCK_DIR=off for a harness run).
 */
/** Whether stock is switched off for this run: the setting, or NODUS_STOCK_DIR set to "off" or
 *  empty (the route harness runs suites both ways). */
export function chemistryStockDisabled(): boolean {
  const env = process.env.NODUS_STOCK_DIR;
  if (env !== undefined && (env.trim() === '' || env.trim().toLowerCase() === 'off')) return true;
  try {
    return getSettings().chemistryUseStockLists === false;
  } catch {
    return false;
  }
}

/** The stock directory, or null without lists or when stock is switched off: everything that
 *  uses stock reads it through here, so off means nothing uses it. */
export function chemistryStockDirectory(): string | null {
  if (chemistryStockDisabled()) return null;
  const dir = process.env.NODUS_STOCK_DIR || path.join(app.getPath('userData'), 'chemistry-stock');
  try {
    return fs.readdirSync(dir).some((name) => name.endsWith('.u64')) ? dir : null;
  } catch {
    return null;
  }
}

export interface StockListInfo { vendor: string; source?: string; importedAt?: string; compounds?: number }

export function chemistryStockLists(): StockListInfo[] {
  const dir = chemistryStockDirectory();
  if (!dir) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      return [JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as StockListInfo];
    } catch {
      return [];
    }
  });
}
