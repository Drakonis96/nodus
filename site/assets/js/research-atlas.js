// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

(async function () {
  'use strict';

  const grid = document.getElementById('atlas-grid');
  const input = document.getElementById('atlas-search');
  const engine = document.getElementById('atlas-engine');
  const submit = document.getElementById('atlas-submit');
  const clear = document.getElementById('atlas-clear');
  const reset = document.getElementById('atlas-reset');
  const status = document.getElementById('atlas-status');
  if (!grid || !input || !engine || !submit || !clear || !reset || !status) return;

  let catalogue;
  try {
    const response = await fetch('../data/research-atlas.json');
    if (!response.ok) throw new Error(`Catalogue request failed with ${response.status}`);
    catalogue = await response.json();
  }
  catch (error) {
    grid.innerHTML = '<div class="atlas-empty">The research catalogue could not be loaded.</div>';
    return;
  }

  const resources = Array.isArray(catalogue.resources) ? catalogue.resources : [];

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  const fold = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

  const geoLabel = (item) => {
    const g = item.geography || {};
    return [g.continent, g.country, g.region].filter(Boolean).join(' · ');
  };

  resources.forEach((item) => {
    item.__search = fold([
      item.name, item.description, item.access_model, geoLabel(item),
      ...(item.knowledge_domains || []), ...(item.type_of_use || [])
    ].join(' '));
  });

  const FACETS = {
    continent: { label: 'Continent', values: item => item.geography && item.geography.continent ? [item.geography.continent] : [] },
    country: { label: 'Country', values: item => item.geography && item.geography.country ? [item.geography.country] : [] },
    region: { label: 'Region', values: item => item.geography && item.geography.region ? [item.geography.region] : [] },
    area: { label: 'Knowledge area', values: item => item.knowledge_domains || [] },
    type: { label: 'Resource type', values: item => item.type_of_use || [] }
  };

  const selected = { continent:'', country:'', region:'', area:'', type:'' };
  const facetNodes = {};

  for (const key of Object.keys(FACETS)) {
    const root = document.querySelector(`[data-facet="${key}"]`);
    facetNodes[key] = {
      root,
      button: root.querySelector('.atlas-facet-button'),
      value: root.querySelector('.atlas-facet-value'),
      panel: root.querySelector('.atlas-facet-panel'),
      search: root.querySelector('.atlas-facet-search'),
      options: root.querySelector('.atlas-facet-options')
    };
  }

  const cards = [];
  for (const item of resources) {
    const card = document.createElement('article');
    card.className = 'card lit atlas-card';
    const domains = (item.knowledge_domains || []).join(' · ');
    const uses = (item.type_of_use || []).join(' · ');
    card.innerHTML = `
      <div class="atlas-card-top">
        <h2><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.name)}</a></h2>
        <span class="atlas-access">${esc(item.access_model || '')}</span>
      </div>
      <div class="atlas-geo">${esc(geoLabel(item))}</div>
      <p class="atlas-description">${esc(item.description)}</p>
      <dl class="atlas-meta">
        <div class="atlas-meta-row"><dt>Knowledge</dt><dd>${esc(domains)}</dd></div>
        <div class="atlas-meta-row"><dt>Use</dt><dd>${esc(uses)}</dd></div>
      </dl>
      <a class="atlas-open" href="${esc(item.url)}" target="_blank" rel="noopener">
        Open resource
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17 17 7M8 7h9v9"/>
        </svg>
      </a>`;
    grid.appendChild(card);
    cards.push({ item, el: card });
  }

  const queryMatch = item => {
    const q = fold(input.value.trim());
    return !q || item.__search.includes(q);
  };

  const facetMatch = (item,key,value) => !value || FACETS[key].values(item).includes(value);

  function matches(item, exceptKey='') {
    if (!queryMatch(item)) return false;
    for (const key of Object.keys(FACETS)) {
      if (key === exceptKey) continue;
      if (!facetMatch(item,key,selected[key])) return false;
    }
    return true;
  }

  function countsFor(key) {
    const counts = new Map();
    for (const item of resources) {
      if (!matches(item,key)) continue;
      for (const value of FACETS[key].values(item)) {
        counts.set(value,(counts.get(value) || 0) + 1);
      }
    }
    return counts;
  }

  function possibleValues(key) {
    return [...countsFor(key).entries()]
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([value,count]) => ({value,count}));
  }

  function repairSelections() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 6) {
      changed = false;
      for (const key of Object.keys(FACETS)) {
        if (!selected[key]) continue;
        const allowed = new Set(possibleValues(key).map(x => x.value));
        if (!allowed.has(selected[key])) {
          selected[key] = '';
          changed = true;
        }
      }
    }
  }

  function renderFacet(key) {
    const node = facetNodes[key];
    node.value.textContent = selected[key] || FACETS[key].label;
    node.button.classList.toggle('is-active', Boolean(selected[key]));

    const q = fold(node.search.value.trim());
    const options = possibleValues(key).filter(x => !q || fold(x.value).includes(q));
    node.options.textContent = '';

    const all = document.createElement('button');
    all.className = `atlas-facet-option${selected[key] ? '' : ' is-selected'}`;
    all.type = 'button';
    all.dataset.value = '';
    all.innerHTML = `<span>All</span><span class="atlas-facet-count">${resources.filter(item => matches(item,key)).length}</span>`;
    node.options.appendChild(all);

    for (const entry of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `atlas-facet-option${selected[key] === entry.value ? ' is-selected' : ''}`;
      button.dataset.value = entry.value;
      button.innerHTML = `<span>${esc(entry.value)}</span><span class="atlas-facet-count">${entry.count}</span>`;
      node.options.appendChild(button);
    }

    if (!options.length && q) {
      const empty = document.createElement('div');
      empty.className = 'atlas-facet-empty';
      empty.textContent = 'No matching options.';
      node.options.appendChild(empty);
    }
  }

  function renderAllFacets() {
    for (const key of Object.keys(FACETS)) renderFacet(key);
  }

  function closeFacet(key) {
    const node = facetNodes[key];
    node.panel.hidden = true;
    node.button.setAttribute('aria-expanded','false');
  }

  function closeAll(except='') {
    for (const key of Object.keys(FACETS)) if (key !== except) closeFacet(key);
  }

  function update() {
    repairSelections();

    let visible = 0;
    for (const {item,el} of cards) {
      const show = matches(item);
      el.hidden = !show;
      if (show) visible++;
    }

    const filtered = Boolean(input.value.trim() || Object.values(selected).some(Boolean));
    status.textContent = filtered ? `${visible} of ${resources.length} resources` : `${resources.length} resources`;
    clear.hidden = !input.value;

    const empty = grid.querySelector('.atlas-empty');
    if (!visible && !empty) {
      const node = document.createElement('div');
      node.className = 'atlas-empty';
      node.textContent = 'No resources match the current search and filters.';
      grid.appendChild(node);
    } else if (visible && empty) {
      empty.remove();
    }

    renderAllFacets();
  }

  for (const [key,node] of Object.entries(facetNodes)) {
    node.button.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = node.panel.hidden;
      closeAll(key);
      node.panel.hidden = !opening;
      node.button.setAttribute('aria-expanded', String(opening));
      if (opening) {
        node.search.value = '';
        renderFacet(key);
        requestAnimationFrame(() => node.search.focus());
      }
    });
    node.panel.addEventListener('click', event => event.stopPropagation());
    node.search.addEventListener('input', () => renderFacet(key));
    node.options.addEventListener('click', (event) => {
      const option = event.target.closest('.atlas-facet-option');
      if (!option) return;
      selected[key] = option.dataset.value || '';
      closeFacet(key);
      update();
    });
  }

  const ENGINES = {
    google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    brave: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    startpage: q => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
    scholar: q => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`
  };

  function runSearch() {
    const q = input.value.trim();
    if (!q) return;
    if (engine.value === 'directory') {
      update();
      return;
    }
    const makeUrl = ENGINES[engine.value];
    if (makeUrl) window.open(makeUrl(q),'_blank','noopener');
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });

  engine.addEventListener('change', () => {
    const name = engine.options[engine.selectedIndex].textContent;
    input.placeholder = engine.value === 'directory'
      ? 'Search the research directory…'
      : `Search with ${name}…`;
    submit.title = engine.value === 'directory'
      ? 'Filter directory'
      : `Search with ${name}`;
  });

  submit.addEventListener('click', runSearch);

  clear.addEventListener('click', () => {
    input.value = '';
    input.focus();
    update();
  });

  reset.addEventListener('click', () => {
    for (const key of Object.keys(selected)) selected[key] = '';
    update();
  });

  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });

  update();
})();
