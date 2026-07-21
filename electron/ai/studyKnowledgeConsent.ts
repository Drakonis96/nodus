import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import type {
  StudyMaterialAiProcessingDecision,
  StudyMaterialAiProcessingPrompt,
  StudyMaterialImportResult,
  ModelRef,
} from '@shared/types';
import { isLocalStudyModel } from '@shared/studyAi';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { resolveStudyAiTaskModel } from './studyAiPolicy';

type PendingRequest = {
  senderId: number;
  settle: (decision: StudyMaterialAiProcessingDecision) => void;
};

const pendingRequests = new Map<string, PendingRequest>();

function requestWindow(parent?: BrowserWindow | null): BrowserWindow | null {
  if (parent && !parent.isDestroyed() && !parent.webContents.isDestroyed()) return parent;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && !focused.webContents.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && !win.webContents.isDestroyed()) ?? null;
}

async function requestDecision(
  prompt: Omit<StudyMaterialAiProcessingPrompt, 'requestId'>,
  parent?: BrowserWindow | null,
): Promise<StudyMaterialAiProcessingDecision> {
  const win = requestWindow(parent);
  if (!win) return { process: false, remember: false };
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const onClosed = () => settle({ process: false, remember: false });
    const settle = (decision: StudyMaterialAiProcessingDecision) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      win.removeListener('closed', onClosed);
      pendingRequests.delete(requestId);
      resolve(decision);
    };
    timeout = setTimeout(() => settle({ process: false, remember: false }), 10 * 60 * 1000);
    win.once('closed', onClosed);
    pendingRequests.set(requestId, { senderId: win.webContents.id, settle });
    try {
      win.webContents.send('study:knowledge:processing:request', { ...prompt, requestId });
    } catch {
      settle({ process: false, remember: false });
    }
  });
}

export function resolveStudyMaterialAiProcessingRequest(
  senderId: number,
  requestId: string,
  decision: StudyMaterialAiProcessingDecision,
): void {
  if (typeof requestId !== 'string' || !decision || typeof decision.process !== 'boolean' || typeof decision.remember !== 'boolean') return;
  const pending = pendingRequests.get(requestId);
  if (!pending || pending.senderId !== senderId) return;
  pending.settle(decision);
}

/**
 * Decide whether a newly imported batch should be analysed. A positive decision
 * also authorises the provider send described by the modal, so the lower-level AI
 * policy must not show a second native confirmation for the same work.
 */
export async function decideStudyMaterialAiProcessing(
  results: StudyMaterialImportResult[],
  subjectId?: string | null,
  parent?: BrowserWindow | null,
): Promise<{ process: boolean; externalConsentModelKey: string | null }> {
  if (!results.length || process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI === '1') {
    return { process: false, externalConsentModelKey: null };
  }
  const settings = getSettings();
  if (settings.studyKnowledgeAutoProcess === 'never' || !settings.studyAiEnabled) {
    return { process: false, externalConsentModelKey: null };
  }
  let model: ModelRef;
  try {
    model = resolveStudyAiTaskModel('questions', undefined, subjectId);
  } catch {
    return { process: false, externalConsentModelKey: null };
  }
  if (settings.studyKnowledgeAutoProcess === 'always') {
    return { process: true, externalConsentModelKey: '*' };
  }
  const unique = [...new Map(results.map((result) => [result.material.id, result.material])).values()];
  const decision = await requestDecision({
    titles: unique.map((material) => material.title),
    provider: model.provider,
    model: model.model,
    local: isLocalStudyModel(model),
    inputChars: unique.reduce((sum, material) => sum + Math.max(0, material.extractedChars), 0),
  }, parent);
  if (decision.remember) {
    updateSettings({ studyKnowledgeAutoProcess: decision.process ? 'always' : 'never' });
  }
  return { process: decision.process, externalConsentModelKey: decision.process ? (decision.remember ? '*' : `${model.provider}:${model.model}`) : null };
}
