import path from 'node:path';
import { BrowserWindow } from 'electron';
import { nodiText } from '@shared/nodiNotifications';
import { openDbPath } from '../db/database';
import { saveWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { addNotification } from '../notifications';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import { generateDeepResearchReport } from './deepResearch';
import {
  configureDeepResearchQueue,
  type DeepResearchJobRecord,
  type DeepResearchQueueVault,
} from './deepResearchQueue';

// ─────────────────────────────────────────────────────────────────────────────
// Binds the pure queue in ./deepResearchQueue to the real generator, database and
// app window. Kept apart from the queue itself so the lane's logic stays testable
// without Electron, and separate from both callers (IPC and MCP) so neither owns
// the wiring — whichever runs first sets it up.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The vault a job is bound to is the corpus that is really open, not whatever the
 * registry lists as active: a second Nodus instance can switch the registry while
 * this process still holds the previous database, and a job bound to the registry
 * would then be cancelled for a change that never happened here.
 */
function servingVault(): DeepResearchQueueVault {
  const registryActive = getActiveVault();
  const open = openDbPath();
  if (!open) return { id: registryActive.id, name: registryActive.name };
  const match = listVaults().find((vault) => path.resolve(vault.path) === path.resolve(open));
  return match ? { id: match.id, name: match.name } : { id: registryActive.id, name: registryActive.name };
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * A report asked for over MCP finishes with nobody watching: the client that queued
 * it may have disconnected (MCP sessions expire), and the window may be on another
 * view entirely. The notification centre is what stops it being invisible work that
 * quietly spent tokens.
 */
function announce(job: DeepResearchJobRecord): void {
  if (job.origin !== 'mcp') return;
  if (job.status === 'completed') {
    addNotification({
      title: nodiText('deepResearchMcpDoneTitle'),
      body: nodiText('deepResearchMcpDoneBody', { title: job.title }),
      kind: 'success',
      dedupeKey: `deep-research-mcp:${job.id}`,
    });
  } else if (job.status === 'failed') {
    addNotification({
      title: nodiText('deepResearchMcpFailedTitle'),
      body: nodiText('deepResearchMcpFailedBody', { title: job.title }),
      kind: 'warning',
      dedupeKey: `deep-research-mcp:${job.id}`,
    });
  }
}

let configured = false;

/** Idempotently wires the queue. Called by every entry point before it enqueues. */
export function ensureDeepResearchLane(): void {
  if (configured) return;
  configured = true;
  configureDeepResearchQueue({
    generate: (request, onProgress) => generateDeepResearchReport(request, onProgress),
    saveDraft: ({ report, request, title }) =>
      saveWritingWorkshopDraft({ draft: report.draft, model: request.model ?? null, title: title ?? undefined }).id,
    activeVault: servingVault,
    onChange: (all) => broadcast('research:deep:queue', all),
    onSettled: announce,
  });
}

/** Test-only teardown so a suite can rewire the lane. Never called in production. */
export function __resetDeepResearchLaneForTest(): void {
  configured = false;
}
