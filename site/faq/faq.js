/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Renders, filters and searches the FAQ. Content comes from faq-data.js.
The URL carries the state (?q=…&cat=… plus #entry-id) so an answer is linkable.
*/
(function () {
  'use strict';

  const entries = window.FAQ_ENTRIES || [];
  const categories = window.FAQ_CATEGORIES || [{ id: 'all', label: 'All' }];
  const list = document.getElementById('faq-list');
  const empty = document.getElementById('faq-empty');
  const meta = document.getElementById('faq-meta');
  const search = document.getElementById('faq-search');
  const clear = document.getElementById('faq-clear');
  const tabs = document.getElementById('faq-cats');
  if (!list) return;

  const labels = Object.fromEntries(categories.map((category) => [category.id, category.label]));
  // strip the authored HTML once, for searching
  const plain = new Map(entries.map((entry) => {
    const holder = document.createElement('div');
    holder.innerHTML = entry.a;
    return [entry.id, `${entry.q} ${holder.textContent}`.toLowerCase()];
  }));

  let category = 'all';
  let query = '';

  const escapeHtml = (value) => value.replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]
  ));

  function highlight(text, needle) {
    if (!needle) return escapeHtml(text);
    const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escapeHtml(text).replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>');
  }

  tabs.innerHTML = categories.map((item) => `<button class="filter-tab" type="button"
    data-cat="${item.id}" aria-pressed="${item.id === 'all'}">${item.label}</button>`).join('');

  function render() {
    const needle = query.trim().toLowerCase();
    const matches = entries.filter((entry) => {
      if (category !== 'all' && entry.cat !== category) return false;
      if (!needle) return true;
      return (plain.get(entry.id) || '').includes(needle);
    });

    list.innerHTML = matches.map((entry) => `<details class="faq-item" id="${entry.id}">
      <summary>
        <span class="q">${highlight(entry.q, needle)}</span>
        <span class="cat">${labels[entry.cat] || entry.cat}</span>
        <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="faq-answer"><div>${entry.a}</div></div>
    </details>`).join('');

    empty.hidden = matches.length > 0;
    meta.textContent = matches.length === entries.length
      ? `${entries.length} questions`
      : `Showing ${matches.length} of ${entries.length} questions`;
    clear.hidden = !query;

    tabs.querySelectorAll('.filter-tab').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.cat === category));
    });
  }

  function syncUrl() {
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    if (category !== 'all') url.searchParams.set('cat', category); else url.searchParams.delete('cat');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-tab');
    if (!button) return;
    category = button.dataset.cat;
    render();
    syncUrl();
  });

  let debounce = 0;
  search.addEventListener('input', () => {
    query = search.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => { render(); syncUrl(); }, 120);
  });

  clear.addEventListener('click', () => {
    query = '';
    search.value = '';
    search.focus();
    render();
    syncUrl();
  });

  // '/' focuses the search box, the way documentation sites do
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== search && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  // restore state from the URL, then open a linked answer
  const params = new URLSearchParams(location.search);
  query = params.get('q') || '';
  category = params.get('cat') || 'all';
  search.value = query;
  render();

  const target = location.hash.slice(1);
  if (target) {
    const item = document.getElementById(target);
    if (item) {
      item.open = true;
      requestAnimationFrame(() => item.scrollIntoView({ block: 'center' }));
    }
  }
})();
