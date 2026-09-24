// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

(async function () {
  'use strict';

  const grid = document.getElementById('atlas-grid');
  const input = document.getElementById('atlas-search');
  const engine = document.getElementById('atlas-engine');
  const engineValue = document.getElementById('atlas-engine-value');
  const engineMenu = document.getElementById('atlas-engine-menu');
  const submit = document.getElementById('atlas-submit');
  const clear = document.getElementById('atlas-clear');
  const reset = document.getElementById('atlas-reset');
  const status = document.getElementById('atlas-status');
  if (!grid || !input || !engine || !engineValue || !engineMenu || !submit || !clear || !reset || !status) return;

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

  // Every facet holds a LIST of chosen values. Within one facet the values are
  // alternatives — choosing Spain and Portugal asks for either — while separate
  // facets still narrow each other, so the whole thing reads as
  // "these continents, these areas, this kind of resource".
  const selected = { continent: [], country: [], region: [], area: [], type: [] };
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
    // The rows are toggle buttons, so the group is named for the facet they
    // belong to: "Knowledge area, Social Sciences, toggle button, pressed".
    facetNodes[key].options.setAttribute('role','group');
    facetNodes[key].options.setAttribute('aria-label', FACETS[key].label);
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

  const facetMatch = (item,key,values) => !values.length ||
    FACETS[key].values(item).some(value => values.includes(value));

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
        if (!selected[key].length) continue;
        const allowed = new Set(possibleValues(key).map(x => x.value));
        // The chosen values that survive; a value the other facets have put out
        // of reach is dropped rather than left narrowing the results to nothing.
        const kept = selected[key].filter(value => allowed.has(value));
        if (kept.length !== selected[key].length) {
          selected[key] = kept;
          changed = true;
        }
      }
    }
  }

  /** What the pill reads: its own name, the one value, or how many are chosen. */
  function facetSummary(key) {
    const chosen = selected[key];
    if (!chosen.length) return FACETS[key].label;
    if (chosen.length === 1) return chosen[0];
    return `${chosen.length} selected`;
  }

  function optionRow(key, value, label, count, isChosen) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `atlas-facet-option${value ? '' : ' is-clear'}${isChosen ? ' is-selected' : ''}`;
    button.dataset.value = value;
    // A toggle button, not a radio: several rows of one facet stand chosen at
    // once, which is the whole point of the change.
    button.setAttribute('aria-pressed', String(Boolean(isChosen)));
    button.innerHTML =
      `<span class="atlas-facet-check" aria-hidden="true"></span>` +
      `<span class="atlas-facet-option-label">${esc(label)}</span>` +
      `<span class="atlas-facet-count">${count}</span>`;
    return button;
  }

  function renderFacet(key) {
    const node = facetNodes[key];
    const chosen = selected[key];
    const summary = facetSummary(key);
    node.value.textContent = summary;
    // A pill carrying several values can outgrow its own cap and ellipsize, so
    // the whole summary is kept reachable on hover.
    node.button.title = chosen.length ? summary : '';
    node.button.classList.toggle('is-active', Boolean(chosen.length));

    const q = fold(node.search.value.trim());
    const options = possibleValues(key).filter(x => !q || fold(x.value).includes(q));
    // The panel now stays open across picks, so the list is rebuilt under a
    // reader who is part-way down it. Restoring the offset keeps the rows from
    // jumping back to the top on every checkbox.
    const scrollTop = node.options.scrollTop;
    node.options.textContent = '';

    node.options.appendChild(optionRow(
      key, '', 'All', resources.filter(item => matches(item,key)).length, !chosen.length));
    for (const entry of options) {
      node.options.appendChild(optionRow(key, entry.value, entry.value, entry.count, chosen.includes(entry.value)));
    }

    if (!options.length && q) {
      const empty = document.createElement('div');
      empty.className = 'atlas-facet-empty';
      empty.textContent = 'No matching options.';
      node.options.appendChild(empty);
    }
    node.options.scrollTop = scrollTop;
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
    // The engine list is drawn here too, so the click that closes one panel
    // closes the other.
    closeEngine();
  }

  function update() {
    repairSelections();

    let visible = 0;
    for (const {item,el} of cards) {
      const show = matches(item);
      el.hidden = !show;
      if (show) visible++;
    }

    const filtered = Boolean(input.value.trim() || Object.values(selected).some(chosen => chosen.length));
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
      const value = option.dataset.value || '';
      // "All" is the way back to no filter; any other row toggles itself. The
      // panel deliberately stays open — picking a second value is the reason it
      // accepts more than one — and the click is not bubbled, or the document
      // handler behind it would close the panel on the very first pick.
      selected[key] = value
        ? (selected[key].includes(value)
            ? selected[key].filter(chosen => chosen !== value)
            : [...selected[key], value])
        : [];
      update();
    });
  }

  /**
   * The search engine, drawn here rather than by the platform.
   *
   * This was a <select>, and the operating system painted its popup from its
   * own appearance setting, so a dark page opened a light menu. Nothing in CSS
   * reaches that popup: `color-scheme: dark` on the control (and on the
   * document) is inherited by the closed control and by every <option>'s
   * computed style, and the menu still opened light — verified, not assumed.
   * Owning the list is the only way the list is dark.
   */
  const ENGINES = [
    ['directory', 'Directory', null],
    ['google', 'Google', q => `https://www.google.com/search?q=${encodeURIComponent(q)}`],
    ['bing', 'Bing', q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`],
    ['duckduckgo', 'DuckDuckGo', q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`],
    ['brave', 'Brave Search', q => `https://search.brave.com/search?q=${encodeURIComponent(q)}`],
    ['startpage', 'Startpage', q => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`],
    ['scholar', 'Google Scholar', q => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`]
  ];
  let chosenEngine = ENGINES[0];

  function renderEngineMenu() {
    engineMenu.textContent = '';
    for (const [value, label] of ENGINES) {
      const chosen = value === chosenEngine[0];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `atlas-engine-option${chosen ? ' is-selected' : ''}`;
      row.dataset.value = value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(chosen));
      row.innerHTML = `<span class="atlas-engine-tick" aria-hidden="true"></span><span>${esc(label)}</span>`;
      engineMenu.appendChild(row);
    }
  }

  function closeEngine() {
    engineMenu.hidden = true;
    engine.setAttribute('aria-expanded', 'false');
  }

  /** Choosing an engine also decides what the field promises to do with it. */
  function chooseEngine(value) {
    chosenEngine = ENGINES.find(([candidate]) => candidate === value) ?? ENGINES[0];
    const directory = chosenEngine[0] === 'directory';
    engineValue.textContent = chosenEngine[1];
    input.placeholder = directory ? 'Search the research directory…' : `Search with ${chosenEngine[1]}…`;
    submit.title = directory ? 'Filter directory' : `Search with ${chosenEngine[1]}`;
    // Re-drawn now, not on the next open, so the tick matches the choice even
    // while the list is shut.
    renderEngineMenu();
  }

  function runSearch() {
    const q = input.value.trim();
    if (!q) return;
    const makeUrl = chosenEngine[2];
    if (!makeUrl) {
      update();
      return;
    }
    window.open(makeUrl(q),'_blank','noopener');
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });

  engine.addEventListener('click', (event) => {
    // Without this the document handler behind it would close the list in the
    // same click that opened it.
    event.stopPropagation();
    const opening = engineMenu.hidden;
    closeAll();
    if (opening) renderEngineMenu();
    engineMenu.hidden = !opening;
    engine.setAttribute('aria-expanded', String(opening));
  });
  engineMenu.addEventListener('click', (event) => {
    const row = event.target.closest('.atlas-engine-option');
    if (!row) return;
    chooseEngine(row.dataset.value);
    closeEngine();
  });

  submit.addEventListener('click', runSearch);

  clear.addEventListener('click', () => {
    input.value = '';
    input.focus();
    update();
  });

  reset.addEventListener('click', () => {
    for (const key of Object.keys(selected)) selected[key] = [];
    update();
  });

  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });

  chooseEngine('directory');
  update();
})();
