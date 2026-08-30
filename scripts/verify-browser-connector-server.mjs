// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const flag = '--electron-browser-connector-suite';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), flag)) process.exit(0);

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-browser-connector-'));
const userData = path.join(scratch, 'profile');
const backups = path.join(scratch, 'backups');
const port = 4500 + (process.pid % 1000);
const origin = 'chrome-extension://ilcclajjhofhieoljdjmikmfopfbamej';
const developmentOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let modalPromptCalls = 0;
const electron = installRuntimeHooks(userData, {
  dialog: {},
  shell: { openExternal: async () => undefined },
});
electron.BrowserWindow.getFocusedWindow = () => null;
const require = createRequire(import.meta.url);

const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
const server = require(path.join(repoRoot, 'electron/zotero-plugin/server.ts'));
const closedListeners = new Set();
const pairingWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  restore: () => undefined,
  show: () => undefined,
  focus: () => undefined,
  once: (event, listener) => { if (event === 'closed') closedListeners.add(listener); },
  removeListener: (event, listener) => { if (event === 'closed') closedListeners.delete(listener); },
  webContents: {
    id: 91,
    isDestroyed: () => false,
    send: (channel, prompt) => {
      assert.equal(channel, 'browserConnector:pairing:request');
      modalPromptCalls += 1;
      setImmediate(() => server.resolveBrowserConnectorPairingRequest(91, prompt.requestId, true));
    },
  },
};
server.setZoteroPluginWindowProvider(() => pairingWindow);

try {
  settingsRepo.updateSettings({
    autoBackupFolder: backups,
    zoteroPluginEnabled: false,
    browserConnectorEnabled: true,
    browserConnectorToken: 'browser-test-token',
    zoteroPluginPort: port,
  });
  const history = library.createGlobalLibraryCollection('History', null);
  const women = library.createGlobalLibraryCollection('Women', history.id);
  await server.startZoteroPluginServer();
  const base = `http://127.0.0.1:${port}`;

  const extensionHeaders = { Origin: origin };
  const authHeaders = { Origin: origin, Authorization: 'Bearer browser-test-token', 'Content-Type': 'application/json' };
  const markerHeaders = { 'X-Nodus-Extension-Origin': origin };

  const healthResponse = await fetch(`${base}/api/browser/health`, { headers: extensionHeaders });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.enabled, true);
  assert.equal(health.libraryReady, true);
  assert.equal(healthResponse.headers.get('access-control-allow-origin'), origin);

  const markerHealthResponse = await fetch(`${base}/api/browser/health`, { headers: markerHeaders });
  assert.equal(markerHealthResponse.status, 200, 'an extension marker works when Chromium omits Origin');
  assert.equal(markerHealthResponse.headers.get('access-control-allow-origin'), origin);

  const maliciousHealth = await fetch(`${base}/api/browser/health`, { headers: { Origin: 'https://malicious.example' } });
  assert.equal(maliciousHealth.status, 403);
  assert.equal(maliciousHealth.headers.get('access-control-allow-origin'), null, 'web origins never receive reflected CORS');
  assert.equal((await fetch(`${base}/api/browser/health`, {
    headers: { Origin: 'https://malicious.example', 'X-Nodus-Extension-Origin': origin },
  })).status, 403, 'a web origin cannot override its identity with the extension marker');
  assert.equal((await fetch(`${base}/api/browser/health`)).status, 403, 'missing both origin signals remains forbidden');
  assert.equal((await fetch(`${base}/api/browser/catalog`, { headers: extensionHeaders })).status, 401);

  const markerPair = await (await fetch(`${base}/api/browser/pair`, {
    method: 'POST', headers: { ...markerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionVersion: '4.1.3', pageUrl: 'https://journal.example/marker' }),
  })).json();
  assert.equal(markerPair.token, 'browser-test-token');
  const markerCatalog = await (await fetch(`${base}/api/browser/catalog`, {
    headers: { ...markerHeaders, Authorization: 'Bearer browser-test-token' },
  })).json();
  assert.deepEqual(markerCatalog.collections.map((entry) => entry.name), ['History', 'Women']);

  const pair = await (await fetch(`${base}/api/browser/pair`, {
    method: 'POST', headers: { ...extensionHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionVersion: '4.1.3', extensionId: 'ilcclajjhofhieoljdjmikmfopfbamej', pageUrl: 'https://journal.example/article' }),
  })).json();
  assert.equal(pair.token, 'browser-test-token');
  assert.equal(pair.official, true);
  assert.equal(modalPromptCalls, 2, 'every unauthenticated token delivery requires renderer-modal confirmation');

  const wrongExtensionPair = await fetch(`${base}/api/browser/pair`, {
    method: 'POST', headers: { Origin: developmentOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  });
  assert.equal(wrongExtensionPair.status, 403, 'a second extension cannot take over the pairing');
  assert.equal(modalPromptCalls, 2, 'a rejected second origin must not open a misleading prompt');
  const wrongOriginCapability = await fetch(`${base}/api/browser/catalog`, {
    headers: { Origin: developmentOrigin, Authorization: 'Bearer browser-test-token' },
  });
  assert.equal(wrongOriginCapability.status, 403, 'the bearer token is bound to the approved origin');
  assert.equal(wrongOriginCapability.headers.get('access-control-allow-origin'), developmentOrigin, 'extension callers need CORS to receive the pairing rejection');

  const catalog = await (await fetch(`${base}/api/browser/catalog`, { headers: authHeaders })).json();
  assert.deepEqual(catalog.collections.map((entry) => entry.name), ['History', 'Women']);

  const invalidCapture = await fetch(`${base}/api/browser/preview`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ pageUrl: 'file:///etc/passwd', metadataSource: 'generic', metadata: { title: 'Blocked' } }),
  });
  assert.equal(invalidCapture.status, 400, 'extension captures are sanitized at the server boundary');

  const capture = {
    pageUrl: 'https://journal.example/article', metadataSource: 'highwire', collectionId: women.id,
    tags: ['migration', 'women'], attachments: [],
    metadata: {
      title: 'Women and migration after war', itemType: 'journal-article', creators: [{ creatorType: 'author', firstName: 'Alicia', lastName: 'Miranda', fieldMode: 0 }],
      abstract: 'A synthetic record for an isolated connector test.', date: '2017', year: 2017,
      publicationTitle: 'Historical Test Review', url: 'https://journal.example/article', isbn: [], issn: [], tags: [],
    },
  };
  const savedResponse = await fetch(`${base}/api/browser/save`, { method: 'POST', headers: authHeaders, body: JSON.stringify(capture) });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.ok, true);
  const stored = library.getGlobalLibraryItem(saved.itemId);
  assert.equal(stored.metadata.title, capture.metadata.title);
  assert.deepEqual(stored.collectionIds, [women.id]);
  assert.deepEqual(stored.metadata.tags.sort(), ['migration', 'women']);

  const unsafeSnapshotResponse = await fetch(`${base}/api/browser/save`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      ...capture,
      metadata: { ...capture.metadata, title: 'Passive snapshot boundary check' },
      snapshotHtml: '<main><a href="java&#x73;cript:alert(1)">unsafe</a><img/src="https://tracker.example/pixel"></main>',
    }),
  });
  assert.equal(unsafeSnapshotResponse.status, 200);
  const unsafeSnapshot = library.getGlobalLibraryItem((await unsafeSnapshotResponse.json()).itemId);
  assert.equal(unsafeSnapshot.attachments.length, 0, 'active links and remote media are discarded before snapshot storage');

  const upload = await fetch(`${base}/api/browser/items/${encodeURIComponent(saved.itemId)}/attachments`, {
    method: 'POST',
    headers: {
      Origin: origin, Authorization: 'Bearer browser-test-token', 'Content-Type': 'application/octet-stream',
      'X-Nodus-File-Name': encodeURIComponent('article.txt'), 'X-Nodus-File-Title': encodeURIComponent('Full text'),
      'X-Nodus-Mime-Type': encodeURIComponent('text/plain'), 'X-Nodus-Attachment-Role': 'original',
      'X-Nodus-Source-Url': encodeURIComponent('https://journal.example/article.txt'),
    },
    body: 'Synthetic full text. No real vault was opened.',
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).attachmentCount, 1);
  const attached = library.getGlobalLibraryItem(saved.itemId);
  assert.equal(attached.attachments.length, 1);
  const libraryRoot = library.getGlobalLibraryStatus().root;
  assert.ok(libraryRoot);
  const storageFolder = encodeURIComponent(attached.storageId).replace(/\./g, '%2E');
  assert.ok(existsSync(path.join(libraryRoot, storageFolder, attached.attachments[0].relativePath)));

  const malformedItemPath = await fetch(`${base}/api/browser/items/%ZZ/attachments`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer browser-test-token', 'Content-Type': 'application/octet-stream' },
    body: 'ignored',
  });
  assert.equal(malformedItemPath.status, 400, 'malformed binary route ids are rejected cleanly');

  const fakePdfUpload = await fetch(`${base}/api/browser/items/${encodeURIComponent(saved.itemId)}/attachments`, {
    method: 'POST',
    headers: {
      Origin: origin, Authorization: 'Bearer browser-test-token', 'Content-Type': 'application/octet-stream',
      'X-Nodus-File-Name': encodeURIComponent('fake.pdf'), 'X-Nodus-File-Title': encodeURIComponent('Fake PDF'),
      'X-Nodus-Mime-Type': encodeURIComponent('application/pdf'), 'X-Nodus-Attachment-Role': 'original',
    },
    body: '<html>This must never become the clean reader.</html>',
  });
  assert.equal(fakePdfUpload.status, 500, 'HTML labelled as PDF is rejected before attachment');
  assert.equal(library.getGlobalLibraryItem(saved.itemId).attachments.length, 1);

  const refreshedCatalog = await (await fetch(`${base}/api/browser/catalog`, { headers: authHeaders })).json();
  assert.ok(refreshedCatalog.tags.some((entry) => entry.name === 'migration'));
  assert.ok(refreshedCatalog.tags.some((entry) => entry.name === 'women'));

  console.log('Browser connector pairing, origin isolation, hierarchy, tags, capture, and attachment upload passed.');
} finally {
  await server.stopZoteroPluginServer().catch(() => undefined);
  library.closeGlobalLibrary();
  await rm(scratch, { recursive: true, force: true });
}
