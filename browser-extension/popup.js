// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { detectCaptureCandidates } from './lib/multi-capture.js';
import { filterCollectionRows, normalizeTags } from './lib/collections.js';
import { DEFAULT_NODUS_PORT, discoverNodus, extensionOrigin, normalizeConnectorPort, requestLocalJson } from './lib/connection.js';
import { applyMetadataEdits, formatCreators } from './lib/metadata-form.js';
import { ITEM_TYPES, byline, typeGlyph, typeLabel } from './lib/presentation.js';
import { collectPageSnapshot } from './lib/snapshot.js';
import { MAX_ATTACHMENT_BYTES, readResponseWithLimit } from './lib/upload.js';
const spanishUi = chrome.i18n.getUILanguage().toLowerCase().startsWith('es');
const $ = (id) => document.getElementById(id);
const state = {
  capture: null, captures: [], selectedCaptureIndexes: new Set(), tab: null,
  port: DEFAULT_NODUS_PORT, token: '', collections: [], tags: [], selectedCollection: null,
  selectedTags: [], tagsDirty: false, metadataDirty: new Set(), savedItemId: null,
};
const msg = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

function show(id) {
  for (const view of ['loading-view', 'unsupported-view', 'connect-view', 'capture-view', 'success-view']) $(view).classList.toggle('hidden', view !== id);
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] || 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = msg(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = msg(element.dataset.i18nPlaceholder);
  for (const element of document.querySelectorAll('[data-i18n-title]')) { element.title = msg(element.dataset.i18nTitle); element.setAttribute('aria-label', msg(element.dataset.i18nTitle)); }
}

function captureUiChoices() {
  return {
    itemType: $('item-type')?.value || '',
    snapshot: $('snapshot-checkbox')?.checked,
    attachmentIndexes: new Set([...document.querySelectorAll('[data-attachment-index]')]
      .filter((input) => input.checked).map((input) => Number(input.dataset.attachmentIndex))),
  };
}

function metadataEdits() {
  return {
    title: $('metadata-title').value,
    creators: $('metadata-creators').value,
    date: $('metadata-date').value,
    publicationTitle: $('metadata-publication').value,
    doi: $('metadata-doi').value,
  };
}

function renderMultiCapture() {
  const multiple = state.captures.length > 1;
  $('multi-capture-block').classList.toggle('hidden', !multiple);
  if (!multiple) return;
  $('multi-capture-title').textContent = msg('multipleDetected', [String(state.captures.length)]);
  $('multi-capture-list').replaceChildren(...state.captures.map((capture, index) => {
    const label = document.createElement('label'); label.className = 'multi-capture-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.selectedCaptureIndexes.has(index); input.dataset.captureIndex = String(index);
    input.onchange = () => { if (input.checked) state.selectedCaptureIndexes.add(index); else state.selectedCaptureIndexes.delete(index); updateSaveLabel(); };
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = capture.metadata.title;
    const detail = document.createElement('small'); detail.textContent = byline(capture.metadata) || typeLabel(capture.metadata.itemType, spanishUi);
    copy.append(title, detail); label.append(input, copy); return label;
  }));
}

function updateSaveLabel() {
  const count = state.captures.length > 1 ? state.selectedCaptureIndexes.size : 1;
  $('save-button').disabled = count === 0;
  $('save-button').textContent = state.captures.length > 1 ? msg('saveMultiple', [String(count)]) : msg('save');
}

function renderCapture(choices = null) {
  const metadata = state.capture.metadata;
  const selectedType = choices?.itemType || metadata.itemType;
  $('item-type').replaceChildren(...ITEM_TYPES.map(([value]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = typeLabel(value, spanishUi); option.selected = value === selectedType; return option;
  }));
  $('item-type').onchange = () => { $('type-icon').textContent = typeGlyph($('item-type').value); };
  $('document-title').textContent = metadata.title;
  $('document-byline').textContent = byline(metadata) || new URL(state.capture.pageUrl).hostname;
  $('type-icon').textContent = typeGlyph(selectedType);
  $('files-block').classList.toggle('hidden', !state.capture.attachments.length);
  $('files-list').replaceChildren(...state.capture.attachments.map((attachment, index) => {
    const label = document.createElement('label'); label.className = 'file-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = choices?.attachmentIndexes ? choices.attachmentIndexes.has(index) : true; input.dataset.attachmentIndex = String(index);
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = attachment.title || attachment.fileName || msg('file');
    const detail = document.createElement('small'); detail.textContent = [attachment.mimeType, safeHost(attachment.url)].filter(Boolean).join(' · ');
    copy.append(title, detail); label.append(input, copy); return label;
  }));
  $('snapshot-row').classList.toggle('hidden', !state.capture.snapshotAvailable);
  $('snapshot-checkbox').checked = choices?.snapshot ?? (state.capture.snapshotAvailable && !state.capture.attachments.length);
  const defaults = {
    title: metadata.title || '', creators: formatCreators(metadata.creators),
    date: metadata.date || (metadata.year ? String(metadata.year) : ''),
    publicationTitle: metadata.publicationTitle || '', doi: metadata.doi || '',
  };
  for (const [key, id] of Object.entries({ title: 'metadata-title', creators: 'metadata-creators', date: 'metadata-date', publicationTitle: 'metadata-publication', doi: 'metadata-doi' })) {
    if (!state.metadataDirty.has(key)) $(id).value = defaults[key];
  }
  renderMultiCapture();
  updateSaveLabel();
  show('capture-view');
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }

function foldSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

async function detectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error(msg('unsupportedPage'));
  state.tab = tab;
  let snapshot = null;
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSnapshot });
    snapshot = injected?.result || null;
  } catch { /* Chrome's built-in PDF viewer does not accept injected scripts. */ }
  if (!snapshot) snapshot = { title: tab.title || '', url: tab.url, lang: chrome.i18n.getUILanguage(), contentType: '', metas: [], links: [], jsonLd: [], coins: [], anchors: [], html: '' };
  state.captures = detectCaptureCandidates(snapshot);
  state.capture = state.captures[0];
  state.selectedCaptureIndexes = new Set(state.captures.map((_capture, index) => index));
  state.selectedTags = state.captures.length > 1 ? [] : normalizeTags(state.capture.metadata.tags || []);
  state.tagsDirty = false;
  state.metadataDirty.clear();
  renderTags();
  renderCapture();
}

function baseUrl(port = state.port) { return `http://127.0.0.1:${port}`; }

async function api(path, options = {}, token = state.token, port = state.port) {
  const origin = extensionOrigin(chrome.runtime.getURL);
  const headers = { ...(options.headers || {}), Origin: origin, 'X-Nodus-Extension-Origin': origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof ArrayBuffer) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await requestLocalJson(`${baseUrl(port)}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = new Error(response.data.error || `Nodus returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.data;
}

async function findNodus(preferredPort) {
  return discoverNodus(preferredPort, (port) => api('/api/browser/health', {}, '', port));
}

async function adoptConnection(connection) {
  state.port = connection.port;
  $('pair-port').value = String(connection.port);
  await chrome.storage.local.set({ port: connection.port });
}

async function pair() {
  const paired = await api('/api/browser/pair', { method: 'POST', body: JSON.stringify({
    extensionVersion: chrome.runtime.getManifest().version,
    extensionId: new URL(chrome.runtime.getURL('')).hostname,
    pageUrl: state.capture?.pageUrl || state.tab?.url || '',
  }) });
  state.token = paired.token;
  await chrome.storage.local.set({ port: state.port, token: state.token });
}

async function connect() {
  const inputPort = normalizeConnectorPort($('pair-port').value);
  state.port = inputPort; $('pair-button').disabled = true; $('connect-error').textContent = '';
  try {
    const connection = await findNodus(inputPort);
    if (!connection) throw new Error(msg('cannotReachNodus', [String(inputPort)]));
    await adoptConnection(connection);
    const { health } = connection;
    if (!health.enabled) throw new Error(msg('enableInNodus'));
    if (!health.libraryReady) throw new Error(msg('libraryNotReady'));
    await pair();
    await loadCatalog(); renderCapture();
  } catch (error) { $('connect-error').textContent = error.message || String(error); }
  finally { $('pair-button').disabled = false; }
}

async function loadCatalog() {
  const data = await api('/api/browser/catalog');
  state.collections = data.collections || []; state.tags = data.tags || [];
  const rememberedCollection = state.collections.find((collection) => collection.id === state.selectedCollection);
  if (!rememberedCollection) state.selectedCollection = null;
  $('collection-label').textContent = rememberedCollection?.name || msg('libraryRoot');
  renderCollectionRows('');
  if (state.capture) {
    $('enrichment-status').classList.remove('hidden');
    try {
      const preview = await api('/api/browser/preview', { method: 'POST', body: JSON.stringify({ ...state.capture, snapshotHtml: undefined }) });
      const choices = captureUiChoices();
      state.capture.metadata = preview.metadata ? { ...state.capture.metadata, ...preview.metadata, itemType: choices.itemType || preview.metadata.itemType } : state.capture.metadata;
      state.captures[0] = state.capture;
      if (!state.tagsDirty) { state.selectedTags = state.captures.length > 1 ? [] : normalizeTags(state.capture.metadata.tags || []); renderTags(); }
      renderCapture(choices);
    } catch { /* embedded metadata remains usable offline */ }
    finally { $('enrichment-status').classList.add('hidden'); }
  }
}

function renderCollectionRows(query) {
  const root = document.createElement('button'); root.type = 'button'; root.className = 'collection-row'; root.setAttribute('role', 'option'); root.setAttribute('aria-selected', String(state.selectedCollection === null)); root.textContent = msg('libraryRoot'); root.onclick = () => selectCollection(null);
  const rows = filterCollectionRows(state.collections, query).map((row) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'collection-row'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(state.selectedCollection === row.collection.id)); button.style.paddingLeft = `${10 + row.depth * 18}px`; button.title = row.pathLabel;
    const icon = document.createElement('span'); icon.className = 'folder-icon'; if (row.collection.color) icon.style.color = row.collection.color;
    const text = document.createElement('span'); text.textContent = row.collection.name;
    const count = document.createElement('small'); count.textContent = String(row.collection.directItemCount || '');
    button.append(icon, text, count); button.onclick = () => selectCollection(row.collection.id); return button;
  });
  $('collection-list').replaceChildren(root, ...rows);
}

function selectCollection(id) {
  state.selectedCollection = id;
  const selected = state.collections.find((collection) => collection.id === id);
  $('collection-label').textContent = selected?.name || msg('libraryRoot');
  $('collection-popover').classList.add('hidden'); $('collection-button').setAttribute('aria-expanded', 'false');
  renderCollectionRows($('collection-search').value);
}

function renderTags() {
  $('tag-chips').replaceChildren(...state.selectedTags.map((tag) => {
    const chip = document.createElement('span'); chip.className = 'tag-chip';
    const text = document.createElement('span'); text.textContent = tag;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `${msg('remove')} ${tag}`); remove.onclick = () => { state.tagsDirty = true; state.selectedTags = state.selectedTags.filter((entry) => entry !== tag); renderTags(); };
    chip.append(text, remove); return chip;
  }));
  renderTagSuggestions($('tag-input').value);
}

function addTag(raw) {
  state.tagsDirty = true; state.selectedTags = normalizeTags([...state.selectedTags, raw]); $('tag-input').value = ''; renderTags(); $('tag-input').focus();
}

function renderTagSuggestions(query) {
  const needle = foldSearch(query).trim();
  const choices = state.tags.filter((entry) => !state.selectedTags.some((tag) => foldSearch(tag) === foldSearch(entry.name)) && (!needle || foldSearch(entry.name).includes(needle))).slice(0, 8);
  $('tag-suggestions').classList.toggle('hidden', !choices.length);
  $('tag-suggestions').replaceChildren(...choices.map((entry) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tag-suggestion'; button.textContent = `${entry.name} · ${entry.itemCount}`; button.onclick = () => addTag(entry.name); return button;
  }));
}

async function requestAttachmentPermissions(attachments) {
  const activeOrigin = new URL(state.capture.pageUrl).origin;
  const origins = [...new Set(attachments.flatMap((attachment) => {
    try {
      const url = new URL(attachment.url);
      if (!/^https?:$/.test(url.protocol) || url.origin === activeOrigin) return [];
      return [`${url.origin}/*`];
    } catch { return []; }
  }))];
  if (!origins.length) return { temporaryOrigins: [], deniedOrigins: [] };
  const missing = [];
  for (const origin of origins) {
    try {
      if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
    } catch { missing.push(origin); }
  }
  if (!missing.length) return { temporaryOrigins: [], deniedOrigins: [] };
  try {
    const granted = await chrome.permissions.request({ origins: missing });
    return granted ? { temporaryOrigins: missing, deniedOrigins: [] } : { temporaryOrigins: [], deniedOrigins: missing };
  } catch {
    return { temporaryOrigins: [], deniedOrigins: missing };
  }
}

async function revokeAttachmentPermissions(origins) {
  if (!origins.length || !chrome.permissions.remove) return;
  try { await chrome.permissions.remove({ origins }); } catch { /* best effort; never hide the saved item */ }
}

async function browserUpload(itemId, attachment) {
  const response = await fetch(attachment.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${attachment.title}: ${response.status}`);
  const contentType = (response.headers.get('content-type') || attachment.mimeType || 'application/octet-stream').split(';')[0];
  if (attachment.mimeType === 'application/pdf' && contentType.includes('html')) throw new Error(`${attachment.title}: the site returned a sign-in page instead of the PDF.`);
  const bytes = await readResponseWithLimit(response, MAX_ATTACHMENT_BYTES, attachment.title || 'Attachment');
  return api(`/api/browser/items/${encodeURIComponent(itemId)}/attachments`, {
    method: 'POST', body: bytes, headers: {
      'Content-Type': 'application/octet-stream',
      'X-Nodus-File-Name': encodeURIComponent(attachment.fileName || 'document'),
      'X-Nodus-File-Title': encodeURIComponent(attachment.title || 'Captured document'),
      'X-Nodus-Mime-Type': encodeURIComponent(contentType),
      'X-Nodus-Attachment-Role': attachment.role || 'supplement',
      'X-Nodus-Source-Url': encodeURIComponent(attachment.url),
    },
  });
}

async function uploadPendingUploads(itemId, pendingUploads, initialAttachmentCount = 0, temporaryOrigins = []) {
  if (!pendingUploads.length) return { attachmentCount: initialAttachmentCount, warnings: [] };
  // The MV3 worker owns the transfer, so closing this popup does not cancel a
  // long download. Never retry in the popup after a worker error: it may have
  // already uploaded some files before its response channel closed.
  if (chrome.runtime.sendMessage) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'nodus:upload-pending', itemId, pendingUploads, port: state.port, token: state.token, attachmentCount: initialAttachmentCount, temporaryOrigins });
      if (result?.ok) return { ...result, attachmentCount: result.attachmentCount ?? initialAttachmentCount };
      if (result?.error) return { attachmentCount: initialAttachmentCount, warnings: [result.error] };
      return { attachmentCount: initialAttachmentCount, warnings: ['Background attachment transfer did not return a result.'] };
    } catch (error) {
      return { attachmentCount: initialAttachmentCount, warnings: [error.message || String(error)] };
    }
  }
  const warnings = [];
  let attachmentCount = initialAttachmentCount;
  for (const pending of pendingUploads) {
    try {
      const uploaded = await browserUpload(itemId, pending);
      attachmentCount = uploaded.attachmentCount ?? attachmentCount + 1;
    } catch (error) { warnings.push(error.message || String(error)); }
  }
  return { attachmentCount, warnings };
}

async function saveCapture(capture, primary, includeSnapshot) {
  const selectedAttachments = primary
    ? [...document.querySelectorAll('[data-attachment-index]:checked')]
      .map((input) => capture.attachments[Number(input.dataset.attachmentIndex)]).filter(Boolean)
    : capture.attachments;
  const metadata = primary
    ? { ...applyMetadataEdits(capture.metadata, metadataEdits()), itemType: $('item-type').value, tags: state.selectedTags }
    : { ...capture.metadata, tags: state.selectedTags };
  let temporaryOrigins = [];
  try {
    const result = await api('/api/browser/save', { method: 'POST', body: JSON.stringify({
      ...capture, metadata, collectionId: state.selectedCollection, tags: state.selectedTags,
      attachments: selectedAttachments,
      snapshotHtml: includeSnapshot ? capture.snapshotHtml : undefined,
    }) });
    const pendingUploads = result.pendingUploads || [];
    const permissions = await requestAttachmentPermissions(pendingUploads);
    temporaryOrigins = permissions.temporaryOrigins;
    const uploaded = await uploadPendingUploads(result.itemId, pendingUploads, result.attachmentCount || 0, temporaryOrigins);
    return {
      ...result,
      attachmentCount: uploaded.attachmentCount,
      warnings: [
        ...(result.warnings || []),
        ...(permissions.deniedOrigins.length ? [msg('permissionDenied', [permissions.deniedOrigins.join(', ')])] : []),
        ...(uploaded.warnings || []),
      ],
    };
  } finally {
    // The worker also performs this cleanup: this path covers the local fallback
    // and makes the normal open-popup flow release access immediately.
    await revokeAttachmentPermissions(temporaryOrigins);
  }
}

async function save() {
  $('capture-error').classList.add('hidden'); $('save-button').disabled = true; $('save-button').textContent = msg('saving');
  try {
    const indexes = state.captures.length > 1 ? [...state.selectedCaptureIndexes].sort((a, b) => a - b) : [0];
    if (!indexes.length) throw new Error(msg('selectAtLeastOne'));
    const results = [];
    for (const index of indexes) {
      const capture = state.captures[index];
      results.push(await saveCapture(capture, index === 0, indexes.length === 1 && index === 0 && $('snapshot-checkbox').checked));
    }
    state.savedItemId = results.length === 1 ? results[0].itemId : null;
    await chrome.storage.local.set({ lastCollectionId: state.selectedCollection });
    const attachmentCount = results.reduce((total, result) => total + (result.attachmentCount || 0), 0);
    const allExisting = results.every((result) => result.disposition === 'existing');
    const anyDeduplicated = results.some((result) => result.deduplicated);
    $('success-title').textContent = results.length === 1 && allExisting
      ? msg('alreadySaved')
      : results.length === 1 && anyDeduplicated ? msg('updatedExisting') : msg('saved');
    $('success-summary').textContent = results.length > 1
      ? msg('savedBatchSummary', [String(results.length), String(attachmentCount)])
      : allExisting ? msg('duplicateAvoided') : msg('savedSummary', [String(attachmentCount)]);
    $('open-button').classList.toggle('hidden', results.length > 1);
    const warnings = results.flatMap((result) => result.warnings || []);
    $('success-warnings').classList.toggle('hidden', !warnings.length);
    $('success-warnings').replaceChildren(...warnings.map((warning) => { const p = document.createElement('p'); p.textContent = warning; return p; }));
    show('success-view');
  } catch (error) {
    $('capture-error').textContent = error.message || String(error); $('capture-error').classList.remove('hidden');
  } finally { updateSaveLabel(); }
}

async function initConnection() {
  const stored = await chrome.storage.local.get({ port: DEFAULT_NODUS_PORT, token: '', lastCollectionId: null });
  state.port = normalizeConnectorPort(stored.port); state.token = stored.token || ''; state.selectedCollection = stored.lastCollectionId || null; $('pair-port').value = String(state.port);
  try {
    const connection = await findNodus(state.port);
    if (!connection) { show('connect-view'); return; }
    await adoptConnection(connection);
    const { health } = connection;
    if (!health.enabled) { show('connect-view'); return; }
    if (!health.libraryReady) { show('connect-view'); $('connect-error').textContent = msg('libraryNotReady'); return; }
    if (!state.token) await pair();
    try {
      await loadCatalog();
    } catch (error) {
      if (error.status !== 401) throw error;
      state.token = '';
      await chrome.storage.local.remove(['token']);
      await pair();
      await loadCatalog();
    }
  } catch { show('connect-view'); }
}

function wire() {
  $('settings-button').onclick = () => chrome.runtime.openOptionsPage();
  $('pair-button').onclick = () => void connect();
  $('metadata-toggle').onclick = () => {
    const hidden = $('metadata-panel').classList.toggle('hidden');
    $('metadata-toggle').setAttribute('aria-expanded', String(!hidden));
    if (!hidden) $('metadata-title').focus();
  };
  for (const [id, key] of Object.entries({
    'metadata-title': 'title', 'metadata-creators': 'creators', 'metadata-date': 'date',
    'metadata-publication': 'publicationTitle', 'metadata-doi': 'doi',
  })) {
    $(id).addEventListener('input', () => {
      state.metadataDirty.add(key);
      if (key === 'title') $('document-title').textContent = $('metadata-title').value || state.capture?.metadata.title || '';
    });
  }
  $('collection-button').onclick = () => { const open = $('collection-popover').classList.toggle('hidden'); $('collection-button').setAttribute('aria-expanded', String(!open)); if (!open) $('collection-search').focus(); };
  $('collection-search').oninput = (event) => renderCollectionRows(event.target.value);
  $('tag-input').oninput = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onfocus = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onkeydown = (event) => { if ((event.key === 'Enter' || event.key === ',') && event.currentTarget.value.trim()) { event.preventDefault(); addTag(event.currentTarget.value.replace(/,$/, '')); } else if (event.key === 'Backspace' && !event.currentTarget.value && state.selectedTags.length) { state.tagsDirty = true; state.selectedTags.pop(); renderTags(); } };
  $('save-button').onclick = () => void save();
  $('open-button').onclick = () => void api('/api/browser/open', { method: 'POST', body: JSON.stringify({ itemId: state.savedItemId }) }).then(() => window.close());
  $('done-button').onclick = () => window.close();
  document.addEventListener('click', (event) => { if (!$('collection-popover').contains(event.target) && !$('collection-button').contains(event.target)) { $('collection-popover').classList.add('hidden'); $('collection-button').setAttribute('aria-expanded', 'false'); } if (!$('tag-box').contains(event.target) && !$('tag-suggestions').contains(event.target)) $('tag-suggestions').classList.add('hidden'); });
}

localize(); wire();
try { await detectActiveTab(); await initConnection(); } catch (error) { $('unsupported-message').textContent = error.message || String(error); show('unsupported-view'); }
