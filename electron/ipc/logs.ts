// The processing-log channels, paired with shared/api/logs.ts and electron/preload/logs.ts.
//
// This layer only binds the Electron-free store to the window, the settings and the save
// dialog: filtering, ordering, grouping, pruning and the validation of everything the
// renderer sends all live in the shared model, which is what
// `scripts/test-pipeline-logs.mjs` asserts against a temp file.
import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { IpcContext } from './context';
import type { PipelineLogFilter } from '@shared/pipelineLogs';
import {
  normalizePipelineLogMaxEntries,
  sanitizePipelineLogFilter,
  sanitizePipelineLogQuery,
} from '@shared/pipelineLogs';
import { pipelineLogLimits, pipelineLogRepository } from '../logging/pipelineLogHost';

export function registerLogsIpc({ h, getWindow }: IpcContext): void {
  const repository = pipelineLogRepository();

  h('logs:query', async (_e, query?: unknown) => {
    const limits = pipelineLogLimits();
    const result = repository.query(sanitizePipelineLogQuery(query), limits);
    return {
      ...result,
      stats: repository.stats(limits),
      retention: limits.retention,
      maxEntries: normalizePipelineLogMaxEntries(limits.maxEntries),
    };
  });

  h('logs:delete', async (_e, filter?: PipelineLogFilter) => {
    const limits = pipelineLogLimits();
    const removed = repository.delete(sanitizePipelineLogFilter(filter), limits);
    return { removed, total: repository.stats(limits).entries };
  });

  h('logs:clear', async () => {
    const limits = pipelineLogLimits();
    const removed = repository.stats(limits).entries;
    repository.clear();
    return { removed, total: 0 };
  });

  h('logs:export', async (e, text: string, defaultName?: string) => {
    const body = typeof text === 'string' ? text : '';
    const win = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    const suggested = typeof defaultName === 'string' && defaultName.trim()
      ? path.basename(defaultName.trim())
      : `nodus-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Nodus',
      defaultPath: suggested,
      filters: [{ name: 'TXT', extensions: ['txt'] }],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, body, 'utf8');
    return { canceled: false, path: picked.filePath };
  });
}
