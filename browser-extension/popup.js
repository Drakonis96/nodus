// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { detectCapture } from './lib/detector.js';
import { filterCollectionRows, normalizeTags } from './lib/collections.js';
import { DEFAULT_NODUS_PORT, discoverNodus, extensionOrigin, normalizeConnectorPort, requestLocalJson } from './lib/connection.js';
import { ITEM_TYPES, byline, typeGlyph, typeLabel } from './lib/presentation.js';
const spanishUi = chrome.i18n.getUILanguage().toLowerCase().startsWith('es');
const $ = (id) => document.getElementById(id);
const state = { capture: null, tab: null, port: DEFAULT_NODUS_PORT, token: '', collections: [], tags: [], selectedCollection: null, selectedTags: [], savedItemId: null };
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

function renderCapture() {
  const metadata = state.capture.metadata;
  $('item-type').replaceChildren(...ITEM_TYPES.map(([value]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = typeLabel(value, spanishUi); option.selected = value === metadata.itemType; return option;
  }));
  $('document-title').textContent = metadata.title;
  $('document-byline').textContent = byline(metadata) || new URL(state.capture.pageUrl).hostname;
  $('type-icon').textContent = typeGlyph(metadata.itemType);
  $('files-block').classList.toggle('hidden', !state.capture.attachments.length);
  $('files-list').replaceChildren(...state.capture.attachments.map((attachment, index) => {
    const label = document.createElement('label'); label.className = 'file-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.attachmentIndex = String(index);
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = attachment.title || attachment.fileName || msg('file');
    const detail = document.createElement('small'); detail.textContent = [attachment.mimeType, safeHost(attachment.url)].filter(Boolean).join(' · ');
    copy.append(title, detail); label.append(input, copy); return label;
  }));
  $('snapshot-row').classList.toggle('hidden', !state.capture.snapshotAvailable);
  $('snapshot-checkbox').checked = state.capture.snapshotAvailable && !state.capture.attachments.length;
  show('capture-view');
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }

function foldSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

async function collectPageSnapshot() {
  const metas = [...document.querySelectorAll('meta')].slice(0, 800).map((el) => ({ name: el.getAttribute('name') || '', property: el.getAttribute('property') || '', httpEquiv: el.getAttribute('http-equiv') || '', content: el.getAttribute('content') || '' }));
  const links = [...document.querySelectorAll('link[href]')].slice(0, 400).map((el) => ({ rel: el.getAttribute('rel') || '', type: el.getAttribute('type') || '', href: el.href || '', title: el.getAttribute('title') || '' }));
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 80).map((el) => (el.textContent || '').slice(0, 1000000));
  const coins = [...document.querySelectorAll('.Z3988[title], span[title^="ctx_ver="]')].slice(0, 100).map((el) => el.getAttribute('title') || '');
  const filePattern = /\.(?:pdf|epub|docx?|odt|rtf|txt|md|xml|jats|csv|tsv|xlsx?|ods|pptx?|odp|png|jpe?g|webp|gif|tiff?|svg|mp3|m4a|wav|ogg|flac|mp4|webm)(?:$|[?#])/i;
  const fullTextPattern = /(?:\bpdf\b|full\s*text|texto\s+completo|texte\s+int[ée]gral|volltext|testo\s+completo|texto\s+integral|tam\s+metin|descargar\s+(?:art[ií]culo|pdf)|download\s+(?:article|paper|pdf))/i;
  const anchors = [...document.querySelectorAll('a[href]')].filter((el) => {
    const label = `${el.textContent || ''} ${el.getAttribute('title') || ''}`;
    return filePattern.test(el.href || '') || el.getAttribute('type') === 'application/pdf' || fullTextPattern.test(label);
  }).slice(0, 80).map((el) => ({
    href: el.href || '', text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    title: (el.getAttribute('title') || '').slice(0, 500), type: el.getAttribute('type') || '',
  }));
  let rawHtml = '';
  if (document.contentType === 'text/html' || document.contentType === 'application/xhtml+xml') {
    const clone = document.documentElement.cloneNode(true);
    for (const element of clone.querySelectorAll('script,noscript,iframe,object,embed,form')) element.remove();
    for (const element of clone.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
      }
    }
    rawHtml = '<!doctype html>\n' + clone.outerHTML;
  }
  return { title: document.title || '', url: location.href, lang: document.documentElement.lang || navigator.language || '', contentType: document.contentType || '', metas, links, jsonLd, coins, anchors, html: rawHtml.length <= 6 * 1024 * 1024 ? rawHtml : '' };
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
  state.capture = detectCapture(snapshot);
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
  const paired = await api('/api/browser/pair', { method: 'POST', body: JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version, pageUrl: state.capture?.pageUrl || state.tab?.url || '' }) }, '');
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
      state.capture.metadata = preview.metadata || state.capture.metadata; renderCapture();
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
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `${msg('remove')} ${tag}`); remove.onclick = () => { state.selectedTags = state.selectedTags.filter((entry) => entry !== tag); renderTags(); };
    chip.append(text, remove); return chip;
  }));
  renderTagSuggestions($('tag-input').value);
}

function addTag(raw) {
  state.selectedTags = normalizeTags([...state.selectedTags, raw]); $('tag-input').value = ''; renderTags(); $('tag-input').focus();
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
    try { const origin = new URL(attachment.url).origin; return origin !== activeOrigin ? [`${origin}/*`] : []; } catch { return []; }
  }))];
  if (!origins.length) return;
  try { await chrome.permissions.request({ origins }); } catch { /* Nodus will still try the public URL */ }
}

async function browserUpload(itemId, attachment) {
  const response = await fetch(attachment.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${attachment.title}: ${response.status}`);
  const contentType = (response.headers.get('content-type') || attachment.mimeType || 'application/octet-stream').split(';')[0];
  if (attachment.mimeType === 'application/pdf' && contentType.includes('html')) throw new Error(`${attachment.title}: the site returned a sign-in page instead of the PDF.`);
  const bytes = await response.arrayBuffer();
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

async function save() {
  $('capture-error').classList.add('hidden'); $('save-button').disabled = true; $('save-button').textContent = msg('saving');
  state.capture.metadata.itemType = $('item-type').value;
  const attachments = [...document.querySelectorAll('[data-attachment-index]:checked')].map((input) => state.capture.attachments[Number(input.dataset.attachmentIndex)]).filter(Boolean);
  try {
    await requestAttachmentPermissions(attachments);
    let result = await api('/api/browser/save', { method: 'POST', body: JSON.stringify({ ...state.capture, collectionId: state.selectedCollection, tags: state.selectedTags, attachments, snapshotHtml: $('snapshot-checkbox').checked ? state.capture.snapshotHtml : undefined }) });
    const uploadWarnings = [];
    for (const pending of result.pendingUploads || []) {
      try { result = { ...result, ...(await browserUpload(result.itemId, pending)) }; } catch (error) { uploadWarnings.push(error.message || String(error)); }
    }
    state.savedItemId = result.itemId;
    await chrome.storage.local.set({ lastCollectionId: state.selectedCollection });
    $('success-summary').textContent = msg('savedSummary', [String(result.attachmentCount || 0)]);
    const warnings = [...(result.warnings || []), ...uploadWarnings];
    $('success-warnings').classList.toggle('hidden', !warnings.length);
    $('success-warnings').replaceChildren(...warnings.map((warning) => { const p = document.createElement('p'); p.textContent = warning; return p; }));
    show('success-view');
  } catch (error) {
    $('capture-error').textContent = error.message || String(error); $('capture-error').classList.remove('hidden');
  } finally {
    $('save-button').disabled = false; $('save-button').textContent = msg('save');
  }
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
  $('collection-button').onclick = () => { const open = $('collection-popover').classList.toggle('hidden'); $('collection-button').setAttribute('aria-expanded', String(!open)); if (!open) $('collection-search').focus(); };
  $('collection-search').oninput = (event) => renderCollectionRows(event.target.value);
  $('tag-input').oninput = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onfocus = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onkeydown = (event) => { if ((event.key === 'Enter' || event.key === ',') && event.currentTarget.value.trim()) { event.preventDefault(); addTag(event.currentTarget.value.replace(/,$/, '')); } else if (event.key === 'Backspace' && !event.currentTarget.value && state.selectedTags.length) { state.selectedTags.pop(); renderTags(); } };
  $('save-button').onclick = () => void save();
  $('open-button').onclick = () => void api('/api/browser/open', { method: 'POST', body: JSON.stringify({ itemId: state.savedItemId }) }).then(() => window.close());
  $('done-button').onclick = () => window.close();
  document.addEventListener('click', (event) => { if (!$('collection-popover').contains(event.target) && !$('collection-button').contains(event.target)) { $('collection-popover').classList.add('hidden'); $('collection-button').setAttribute('aria-expanded', 'false'); } if (!$('tag-box').contains(event.target) && !$('tag-suggestions').contains(event.target)) $('tag-suggestions').classList.add('hidden'); });
}

localize(); wire();
try { await detectActiveTab(); await initConnection(); } catch (error) { $('unsupported-message').textContent = error.message || String(error); show('unsupported-view'); }
