// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { extensionOrigin, requestLocalJson } from './lib/connection.js';
import { MAX_ATTACHMENT_BYTES, readResponseWithLimit } from './lib/upload.js';

const JOB_KEY = 'nodusPendingUploadJob';
const activeJobs = new Map();

function baseUrl(port) { return `http://127.0.0.1:${port}`; }

async function uploadAttachment(job, attachment) {
  let sourceUrl;
  try { sourceUrl = new URL(String(attachment.url)); } catch { throw new Error(`${attachment.title || 'Attachment'}: invalid URL.`); }
  if (!/^https?:$/.test(sourceUrl.protocol)) throw new Error(`${attachment.title || 'Attachment'}: unsupported URL.`);
  const response = await fetch(attachment.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${attachment.title}: ${response.status}`);
  const contentType = (response.headers.get('content-type') || attachment.mimeType || 'application/octet-stream').split(';')[0];
  if (attachment.mimeType === 'application/pdf' && contentType.includes('html')) {
    throw new Error(`${attachment.title}: the site returned a sign-in page instead of the PDF.`);
  }
  const bytes = await readResponseWithLimit(response, MAX_ATTACHMENT_BYTES, attachment.title || 'Attachment');
  const origin = extensionOrigin(chrome.runtime.getURL);
  const result = await requestLocalJson(`${baseUrl(job.port)}/api/browser/items/${encodeURIComponent(job.itemId)}/attachments`, {
    method: 'POST', body: bytes,
    headers: {
      Authorization: `Bearer ${job.token}`,
      Origin: origin,
      'X-Nodus-Extension-Origin': origin,
      'Content-Type': 'application/octet-stream',
      'X-Nodus-File-Name': encodeURIComponent(attachment.fileName || 'document'),
      'X-Nodus-File-Title': encodeURIComponent(attachment.title || 'Captured document'),
      'X-Nodus-Mime-Type': encodeURIComponent(contentType),
      'X-Nodus-Attachment-Role': attachment.role || 'supplement',
      'X-Nodus-Source-Url': encodeURIComponent(attachment.url),
    },
  });
  if (!result.ok) throw new Error(result.data.error || `Nodus returned ${result.status}.`);
  return result.data;
}

async function processJob(input) {
  const boundedUploads = input.pendingUploads.filter((entry) => entry && typeof entry.url === 'string').slice(0, 8);
  const boundedInput = { ...input, pendingUploads: boundedUploads };
  const persisted = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY];
  const job = persisted?.itemId === input.itemId ? { ...boundedInput, ...persisted, pendingUploads: boundedUploads } : { ...boundedInput, completed: [], warnings: [] };
  const completed = new Set(job.completed || []);
  const warnings = [...(job.warnings || [])];
  let attachmentCount = Number(job.attachmentCount || input.attachmentCount || 0);
  try {
    for (let index = 0; index < job.pendingUploads.length; index += 1) {
      if (completed.has(index)) continue;
      await chrome.storage.local.set({ [JOB_KEY]: { ...job, completed: [...completed], warnings, currentIndex: index } });
      try {
        const result = await uploadAttachment(job, job.pendingUploads[index]);
        attachmentCount = result.attachmentCount ?? attachmentCount + 1;
        completed.add(index);
        await chrome.storage.local.set({ [JOB_KEY]: { ...job, completed: [...completed], warnings, attachmentCount, currentIndex: index + 1 } });
      } catch (error) {
        warnings.push(error.message || String(error));
        completed.add(index);
        await chrome.storage.local.set({ [JOB_KEY]: { ...job, completed: [...completed], warnings, attachmentCount, currentIndex: index + 1 } });
      }
    }
  } finally {
    const temporaryOrigins = Array.isArray(job.temporaryOrigins) ? job.temporaryOrigins : [];
    if (temporaryOrigins.length && chrome.permissions?.remove) {
      try { await chrome.permissions.remove({ origins: temporaryOrigins }); } catch { /* best effort */ }
    }
    await chrome.storage.local.remove(JOB_KEY);
  }
  return { ok: true, itemId: job.itemId, attachmentCount, warnings };
}

function startJob(input) {
  const key = String(input.itemId);
  if (!activeJobs.has(key)) {
    const promise = processJob(input).finally(() => activeJobs.delete(key));
    activeJobs.set(key, promise);
  }
  return activeJobs.get(key);
}

async function resumePersistedJob() {
  const stored = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY];
  if (stored?.itemId && Array.isArray(stored.pendingUploads)) await startJob(stored);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'nodus:upload-pending' || !message.itemId || !Array.isArray(message.pendingUploads)) return false;
  startJob(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

// Give an interrupted queue another chance after Chrome restarts the browser.
chrome.runtime.onStartup.addListener(() => { void resumePersistedJob(); });
