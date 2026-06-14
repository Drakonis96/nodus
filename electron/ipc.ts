import { ipcMain, shell, BrowserWindow } from 'electron';
import type { AppSettings, QueueKind, WorkFilter } from '@shared/types';
import { getSettings, updateSettings } from './db/settingsRepo';
import { setApiKey, clearApiKey } from './secrets/secretStore';
import * as zotero from './zotero/zoteroClient';
import * as works from './db/worksRepo';
import * as ideas from './db/ideasRepo';
import * as themes from './db/themesRepo';
import { aggregateGaps } from './db/gapsRepo';
import { getSyncLog } from './db/syncRepo';
import { fullSync, startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import { scanQueue } from './pipeline/scanQueue';
import { buildIdeaGraph, buildAuthorGraph, getContradictions, buildReadingPath } from './graph/graphService';
import { exportData, importData } from './export/exportImport';
import { extractFromPath } from './extraction/textExtractor';
import { runDeepScan } from './ai/deepScan';
import { getDb } from './db/database';

/** Register every IPC channel backing the window.nodus API. */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const h = ipcMain.handle.bind(ipcMain);

  // settings + secrets
  h('settings:get', async () => getSettings());
  h('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch);
    if (patch.syncMode) {
      if (next.syncMode === 'realtime') startRealtimeSync();
      else stopRealtimeSync();
    }
    return next;
  });
  h('settings:setApiKey', async (_e, key: string) => setApiKey(key));
  h('settings:clearApiKey', async () => clearApiKey());

  // zotero
  h('zotero:ping', async () => {
    const res = await zotero.ping();
    // Local API always uses users/0; persist that so all later calls address it correctly.
    if (res.ok) updateSettings({ zoteroUserId: zotero.LOCAL_USER_ID });
    return res;
  });
  h('zotero:collections', async () => {
    const { zoteroUserId } = getSettings();
    return zotero.topCollections(zoteroUserId);
  });
  h('zotero:childCollections', async (_e, parentKey: string) => {
    const { zoteroUserId } = getSettings();
    return zotero.childCollections(zoteroUserId, parentKey);
  });
  h('zotero:collectionItems', async (_e, collectionKey: string, opts?: { query?: string }) => {
    const { zoteroUserId } = getSettings();
    return zotero.collectionItems(zoteroUserId, collectionKey, opts);
  });

  // works / library
  h('works:list', async (_e, filter?: WorkFilter) => works.listWorks(filter));
  h('works:get', async (_e, nodusId: string) => works.getWork(nodusId));
  h('works:setManualDeep', async (_e, nodusId: string, value: boolean) => {
    works.setManualDeep(nodusId, value);
    const w = works.getWork(nodusId);
    if (value && w) {
      markDeepPending(nodusId);
      scanQueue.enqueue(nodusId, w.title, 'deep');
    }
  });
  h('works:setManualDeepBulk', async (_e, nodusIds: string[], value: boolean) => {
    for (const id of nodusIds) {
      works.setManualDeep(id, value);
      if (value) {
        const w = works.getWork(id);
        if (w) {
          markDeepPending(id);
          scanQueue.enqueue(id, w.title, 'deep');
        }
      }
    }
  });
  h('works:rescan', async (_e, nodusId: string, kind: QueueKind) => {
    const w = works.getWork(nodusId);
    if (!w) return;
    if (kind === 'deep') {
      ideas.purgeDeepData(nodusId);
      markDeepPending(nodusId);
    }
    scanQueue.enqueue(nodusId, w.title, kind);
  });
  h('works:openInZotero', async (_e, zoteroKey: string) => {
    const { zoteroUserId } = getSettings();
    await shell.openExternal(`zotero://select/library/items/${zoteroKey}`);
    return zoteroUserId;
  });
  h('works:uploadText', async (_e, nodusId: string, filePath: string) => {
    const w = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as any;
    if (!w) return;
    const s = getSettings();
    const doc = await extractFromPath(filePath, {
      ocr: { enabled: s.ocrEnabled, languages: s.ocrLanguages, maxPages: s.ocrMaxPages },
    });
    markDeepPending(nodusId);
    await runDeepScan(w, doc);
  });

  // sync
  h('sync:now', async () => fullSync('manual'));
  h('sync:log', async () => getSyncLog());

  // queue
  h('queue:get', async () => scanQueue.snapshot());
  h('queue:pause', async () => scanQueue.pause());
  h('queue:resume', async () => scanQueue.resume());
  h('queue:cancelItem', async (_e, id: string) => scanQueue.cancelItem(id));
  h('queue:clear', async () => scanQueue.clear());

  // graph
  h('graph:get', async (_e, lens: 'ideas' | 'authors') =>
    lens === 'authors' ? buildAuthorGraph() : buildIdeaGraph()
  );
  h('graph:ideaDetail', async (_e, globalId: string) => ideas.getIdeaDetail(globalId));
  h('graph:edgeDetail', async (_e, edgeId: string) => ideas.getEdgeDetail(edgeId));
  h('graph:themes', async () => themes.listThemes());

  // gaps + reading path
  h('gaps:aggregate', async () => aggregateGaps());
  h('gaps:contradictions', async () => getContradictions());
  h('reading:path', async () => buildReadingPath());

  // export / import
  h('data:export', async () => exportData());
  h('data:import', async () => importData());

  // Stream queue progress to the renderer.
  scanQueue.onProgress((p) => {
    getWindow()?.webContents.send('queue:progress', p);
  });
}

function markDeepPending(nodusId: string): void {
  getDb()
    .prepare("UPDATE works SET deep_status = 'pending' WHERE nodus_id = ? AND deep_status IN ('none','failed','skipped_no_text')")
    .run(nodusId);
}
