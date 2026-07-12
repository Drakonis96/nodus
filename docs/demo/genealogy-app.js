/* Nodus web demo — GENEALOGY mode. A static, faithful replica of the app's
   genealogy vault: persons, family tree, timeline, evidence archive, map, social
   relations and a family-history Deep Research report. Same shell and conventions
   as app.js, on the sample family in genealogy-data.js. */
(function () {
  const G = window.GEN;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = () => $('#main');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- lookups ----------
  const personById = (id) => G.persons.find((p) => p.id === id);
  const contactById = (id) => G.contacts.find((c) => c.id === id);
  const archiveById = (id) => G.archive.find((a) => a.id === id);
  const eventById = (id) => G.events.find((e) => e.id === id);
  const placeById = (id) => G.places.find((p) => p.id === id);
  const nameOf = (id) => (personById(id) || contactById(id) || { name: id }).name;
  const parentsOf = (id) => G.filiation.filter((f) => f.child === id).map((f) => f.parent);
  const childrenOf = (id) => G.filiation.filter((f) => f.parent === id).map((f) => f.child);
  const unionOf = (id) => G.unions.find((u) => u.a === id || u.b === id);
  const eventsForPerson = (id) => G.events.filter((e) => e.persons.includes(id));
  const relationsForPerson = (id) => G.relations.filter((r) => r.from === id);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function lifespan(p) {
    const b = p.birth && p.birth.date ? p.birth.date : '?';
    const d = p.death && p.death.date && p.death.date !== '—' ? p.death.date : (p.death && p.death.date === '—' ? '' : '');
    return d ? `${b} – ${d}` : `b. ${b}`;
  }
  function initials(name) {
    const parts = String(name).replace(/[¿?]/g, '').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  }
  function portrait(p, size) {
    const s = size || 56;
    const warm = p.sex === 'F' ? ['#5b4038', '#8a5c4a'] : ['#463a2c', '#7a6249'];
    const rid = 'g' + p.id + s;
    const faded = p.conf === 'hypothesis';
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" class="gp-portrait${faded ? ' faded' : ''}" aria-hidden="true">
      <defs><linearGradient id="${rid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${warm[1]}"/><stop offset="1" stop-color="${warm[0]}"/></linearGradient></defs>
      <rect x="1" y="1" width="${s - 2}" height="${s - 2}" rx="${s * 0.16}" fill="url(#${rid})" stroke="rgba(0,0,0,0.35)"/>
      <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-size="${s * 0.4}" font-weight="600" fill="#f5e9d8" font-family="Inter,sans-serif">${esc(initials(p.name))}</text>
    </svg>`;
  }
  const EVC = window.GEN_EVENT_COLORS;
  const EVENT_LABEL = { birth: 'Birth', baptism: 'Baptism', marriage: 'Marriage', death: 'Death', census: 'Census', military: 'Military levy', migration: 'Emigration' };
  function eventChip(type) {
    return `<span class="chip"><span class="dot" style="background:${EVC[type] || '#999'}"></span>${EVENT_LABEL[type] || type}</span>`;
  }

  // ---------- icons (subset, stroke style like the app) ----------
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    people: I('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.9M20.5 20a5.5 5.5 0 0 0-4-5.3"/>'),
    tree: I('<circle cx="12" cy="5" r="2.4"/><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M12 7.4V12M6 16.6V14a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2.6"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    archive: I('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>'),
    map: I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
    network: I('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5 6 17M12 7.5 18 17M7.5 19h9"/>'),
    report: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5M9 13h6M9 17h4"/>'),
    notebook: I('<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 2v20M13 7h4M13 11h4"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    x: I('<path d="m5 5 14 14M19 5 5 19"/>'),
    check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    edit: I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>'),
    trash: I('<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    external: I('<path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>'),
    wand: I('<path d="m14 6 4 4L7 21l-4-4L14 6Z"/><path d="M15 3h.01M20 8h.01M18 2l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5.5-2Z"/>'),
    bulb: I('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.4 1 2.3h6c0-.9.3-1.8 1-2.3A7 7 0 0 0 12 2Z"/>'),
    sync: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
    pin: I('<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    alert: I('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
    heart: I('<path d="M12 20s-7-4.5-9.2-9C1.3 7.7 3 4.5 6.2 4.5c1.9 0 3.1 1 3.8 2 .7-1 1.9-2 3.8-2 3.2 0 4.9 3.2 3.4 6.5C19 15.5 12 20 12 20Z"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>'),
  };

  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Records' },
    { id: 'people', label: 'People', icon: 'people' },
    { id: 'tree', label: 'Family tree', icon: 'tree' },
    { id: 'timeline', label: 'Timeline', icon: 'clock' },
    { id: 'archive', label: 'Archive', icon: 'archive' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'relations', label: 'Relations', icon: 'network' },
    { group: 'Research' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Library', icon: 'book' },
    { id: 'deepResearch', label: 'Deep Research', icon: 'report' },
    { id: 'notes', label: 'Notes', icon: 'notebook' },
    { group: '' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const state = { view: 'home', report: 'dr1', note: 'nn1', settingsTab: 'providers', toggles: { autoAnalyze: true, ocr: true, mcp: true, autoBackup: true } };

  // ---------- modal ----------
  function openModal(html, wide) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" id="modal-ov"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
    $('#modal-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-ov') closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  const modalHead = (title, sub) => `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<p class="muted small" style="margin:3px 0 0">${sub}</p>` : ''}</div><button class="modal-x" onclick="GUI.close()">${ICONS.x}</button></div>`;

  // ---------- person dossier ----------
  function personModal(id) {
    const p = personById(id);
    if (!p) return;
    const evs = eventsForPerson(id).slice().sort((a, b) => a.date.localeCompare(b.date));
    const rels = relationsForPerson(id);
    const kids = childrenOf(id).map(personById).filter(Boolean);
    const pars = parentsOf(id).map(personById).filter(Boolean);
    const u = unionOf(id);
    const spouseId = u ? (u.a === id ? u.b : u.a) : null;
    const conf = G.conflicts.filter((c) => c.person === id);
    openModal(`
      ${modalHead(esc(p.name), `${p.sex === 'F' ? 'Female' : 'Male'} · ${esc(lifespan(p))}${p.conf === 'hypothesis' ? ' · <span style="color:var(--amber)">identity unconfirmed</span>' : ''}`)}
      <div style="display:flex;gap:16px;align-items:flex-start;margin:6px 0 4px">
        ${portrait(p, 76)}
        <div style="min-width:0;flex:1">
          <div class="tag-row" style="margin-bottom:8px">
            <span class="chip">${esc(p.occupation || '—')}</span>
            ${pars.length ? `<span class="chip">child of ${pars.map((x) => esc(x.name.split(' ')[0])).join(' & ')}</span>` : ''}
            ${spouseId ? `<span class="chip">${ICONS.heart} ${esc(nameOf(spouseId).split(' ').slice(0, 2).join(' '))}</span>` : ''}
          </div>
          <p class="muted small" style="margin:0">${esc(p.bio)}</p>
        </div>
      </div>
      ${conf.length ? conf.map((c) => `<div class="gp-conflict">${ICONS.alert}<span>${esc(c.text)}</span></div>`).join('') : ''}
      <div class="nav-group-label" style="padding-left:0">Life events (${evs.length})</div>
      ${evs.map((e) => `
        <div class="gp-event" onclick="GUI.archive('${e.source}')">
          <span class="gp-event-dot" style="background:${EVC[e.type]}"></span>
          <div style="flex:1;min-width:0">
            <div class="list-title"><b>${EVENT_LABEL[e.type] || e.type}</b> <span class="muted small">· ${esc(e.date)} · ${esc(e.place)}</span></div>
            <div class="list-desc" style="margin:2px 0 0">${esc(e.summary)}</div>
          </div>
          <span class="gp-src">${ICONS.archive}</span>
        </div>`).join('') || '<p class="muted small">No events recorded.</p>'}
      ${rels.length ? `<div class="nav-group-label" style="padding-left:0">Social relations (${rels.length})</div>
        ${rels.map((r) => `<div class="arg-item plain" style="display:flex;gap:8px;align-items:center"><span class="chip"><span class="dot" style="background:var(--cyan)"></span>${esc(r.role)}</span> ${esc(nameOf(r.to))}<span class="muted small" style="margin-left:auto">${esc(r.notes)}</span></div>`).join('')}` : ''}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn primary" onclick="GUI.toast('In the app: writes an evidence-based biography from the linked records.')">${ICONS.wand} Generate biography</button>
        <button class="btn" onclick="GUI.close();window.go('tree')">${ICONS.tree} Show in tree</button>
        <button class="btn ghost" onclick="GUI.toast('In the app: opens the person’s ficha to edit facts, portrait and kinship.')">${ICONS.edit} Edit ficha</button>
      </div>`, true);
  }

  // ---------- archive record ----------
  function archiveModal(id) {
    const a = archiveById(id);
    if (!a) return;
    openModal(`
      ${modalHead(esc(a.title), `<span class="chip"><span class="dot" style="background:${EVC[({ 'Baptism record': 'baptism', 'Marriage record': 'marriage', 'Death record': 'death', 'Civil death register': 'death', 'Census (padrón)': 'census', 'Military levy': 'military', 'Passenger manifest': 'migration' })[a.kind]] || '#a78bfa'}"></span>${esc(a.kind)}</span> ${esc(a.date)} · ${esc(a.place)}`)}
      <p class="muted small gp-repo" style="margin:2px 0 12px">${ICONS.archive} ${esc(a.repository)}</p>
      <div class="nav-group-label" style="padding-left:0">Transcription</div>
      <div class="quote-block" style="font-style:normal">${esc(a.transcript)}</div>
      <div class="nav-group-label" style="padding-left:0">Extracted facts</div>
      ${a.facts.map((f) => `<div class="gp-fact">${/⚠/.test(f) ? ICONS.alert : ICONS.check}<span${/⚠/.test(f) ? ' style="color:var(--amber)"' : ''}>${esc(f.replace('⚠ ', ''))}</span></div>`).join('')}
      <div class="nav-group-label" style="padding-left:0">People named (${a.persons.length})</div>
      <div class="tag-row">${a.persons.map((pid) => `<span class="chip link" onclick="GUI.person('${pid}')">${esc(nameOf(pid))}</span>`).join('')}</div>
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.toast('In the app: re-runs analysis of the scanned document and updates facts losslessly.')">${ICONS.sync} Re-analyze</button>
        <button class="btn ghost" onclick="GUI.toast('In the app: opens the source image / PDF page.')">${ICONS.external} Open source</button>
      </div>`, true);
  }

  function placeModal(id) {
    const pl = placeById(id);
    const evs = G.events.filter((e) => e.place === pl.name);
    openModal(`
      ${modalHead(esc(pl.name), `${esc(pl.region)} · ${pl.count} event${pl.count === 1 ? '' : 's'}`)}
      <p class="muted small">${esc(pl.note)}</p>
      <div class="nav-group-label" style="padding-left:0">Events here (${evs.length})</div>
      ${evs.map((e) => `<div class="arg-item plain" style="display:flex;gap:8px;align-items:center;cursor:pointer" onclick="GUI.archive('${e.source}')">${eventChip(e.type)} <span class="muted small">${esc(e.date)}</span> ${esc(e.summary)}</div>`).join('')}`);
  }

  // ---------- VIEWS ----------
  const viewHead = (icon, title, sub) => `<div class="view-head"><div><h1 class="view-title">${ICONS[icon]} ${title}</h1><p class="view-sub">${sub}</p></div></div>`;

  const VIEWS = {
    home() {
      const conf = G.conflicts.length, kin = G.kinSuggestions.length;
      return `
        ${viewHead('home', 'Herrera–Sotomayor', 'A genealogy vault — reconstructing a family from primary sources. This corpus spans Ronda and Málaga, 1841–1931, with an emigration thread to Buenos Aires.')}
        <div class="grid cols-3" style="margin-bottom:16px">
          ${[['People', G.persons.length, 'people'], ['Life events', G.events.length, 'clock'], ['Archive sources', G.archive.length, 'archive'], ['Places', G.places.length, 'map'], ['Generations', 3, 'tree'], ['Open questions', kin + conf, 'bulb']]
          .map(([l, n, ic]) => `<div class="card click" onclick="window.go('${ic === 'people' ? 'people' : ic === 'clock' ? 'timeline' : ic === 'archive' ? 'archive' : ic === 'map' ? 'map' : ic === 'tree' ? 'tree' : 'home'}')"><div class="stat">${n}</div><div class="muted small gp-statlabel">${ICONS[ic]} ${l}</div></div>`).join('')}
        </div>
        <div class="grid cols-2">
          <div class="card">
            <h3>${ICONS.wand} Recommended next step</h3>
            <p class="muted small">The 1874 Vega baptism would confirm the earliest Herrera–Vega tie (a godparent relation, not the 1897 marriage). It is the highest-value missing record.</p>
            <div class="tag-row" style="margin-top:10px"><button class="btn primary" onclick="GUI.toast('In the app: the assistant drafts a research plan and where to look.')">${ICONS.search} Plan the search</button></div>
          </div>
          <div class="card">
            <h3>${ICONS.alert} Conflicts &amp; open questions</h3>
            ${G.conflicts.map((c) => `<div class="gp-conflict" style="margin:6px 0"><span>${ICONS.alert}</span><span>${esc(c.text)}</span></div>`).join('')}
            ${G.kinSuggestions.map((k) => `<div class="gp-kin"><div class="list-title"><b>${esc(k.question)}</b> <span class="gp-strength ${k.strength}">${k.strength} signal</span></div><div class="tag-row" style="margin-top:8px"><button class="btn ghost small" onclick="GUI.kin('${k.id}')">${ICONS.bulb} Review evidence</button></div></div>`).join('')}
          </div>
        </div>`;
    },

    people() {
      const gens = [0, 1, 2];
      return `
        ${viewHead('people', 'People', 'Every individual the records name, confirmed or hypothetical. Click a ficha to see their life events, sources and relations.')}
        ${gens.map((g) => {
          const ps = G.persons.filter((p) => p.gen === g);
          if (!ps.length) return '';
          return `<div class="nav-group-label" style="padding-left:0">${g === 0 ? 'Generation I' : g === 1 ? 'Generation II' : 'Generation III'}</div>
          <div class="grid cols-3">
            ${ps.map((p) => `<div class="card click gp-person" onclick="GUI.person('${p.id}')">
              ${portrait(p, 48)}
              <div style="min-width:0">
                <b class="gp-name">${esc(p.name)}${p.conf === 'hypothesis' ? ' <span class="gp-q">?</span>' : ''}</b>
                <div class="muted small">${esc(lifespan(p))}</div>
                <div class="muted small" style="color:var(--text-3)">${esc(p.occupation || '—')}</div>
              </div>
            </div>`).join('')}
          </div>`;
        }).join('')}`;
    },

    tree() {
      return `
        ${viewHead('tree', 'Family tree', 'Three generations, drawn from the confirmed filiation and marriage records. Couples are joined horizontally; a dashed node is an unconfirmed identity.')}
        <div class="gp-tree-wrap">${treeSVG()}</div>
        <div class="tag-row" style="margin-top:12px">
          <span class="chip"><span class="dot" style="background:#7a6249"></span>male</span>
          <span class="chip"><span class="dot" style="background:#8a5c4a"></span>female</span>
          <span class="chip"><span class="dot" style="background:var(--amber)"></span>unconfirmed</span>
          <span class="muted small" style="align-self:center">Click any person to open their ficha.</span>
        </div>`;
    },

    timeline() {
      const evs = G.events.slice().sort((a, b) => a.date.localeCompare(b.date));
      return `
        ${viewHead('clock', 'Timeline', 'Every dated event across the family, in order. Each item links to the primary source it was extracted from.')}
        <div class="gp-timeline">
          ${evs.map((e) => `<div class="gp-tl-item" onclick="GUI.archive('${e.source}')">
            <span class="gp-tl-dot" style="background:${EVC[e.type]}"></span>
            <div class="gp-tl-year">${esc((e.date.match(/\d{4}/) || [e.date])[0])}</div>
            <div style="flex:1;min-width:0">
              <div class="list-title">${eventChip(e.type)} <b>${esc(e.persons.map(nameOf).map((n) => n.split(' ').slice(0, 2).join(' ')).join(', '))}</b></div>
              <div class="list-desc" style="margin:3px 0 0">${esc(e.summary)} <span class="muted">· ${esc(e.place)}</span></div>
            </div>
          </div>`).join('')}
        </div>`;
    },

    archive() {
      return `
        ${viewHead('archive', 'Archive', 'The evidence: primary sources transcribed and indexed. Nodus reads these directly and extracts people, dates and facts — nothing is invented.')}
        ${G.archive.map((a) => `<div class="list-row" onclick="GUI.archive('${a.id}')">
          <span class="gp-doc">${ICONS.archive}</span>
          <div class="list-main">
            <div class="list-title"><b>${esc(a.title)}</b> <span class="chip">${esc(a.kind)}</span></div>
            <div class="list-desc">${esc(a.transcript.slice(0, 130))}…</div>
            <div class="list-meta"><span>${ICONS.clock} ${esc(a.date)}</span><span>${ICONS.pin} ${esc(a.place)}</span><span><b>${a.facts.length}</b> facts</span><span><b>${a.persons.length}</b> people</span></div>
          </div>
        </div>`).join('')}`;
    },

    map() {
      return `
        ${viewHead('map', 'Map', 'Where the family lived and moved. Places are drawn from the records; click a pin to see the events anchored there.')}
        <div class="gp-map">
          <div class="gp-map-frame">
            ${G.places.map((pl) => `<button class="gp-pin ${pl.kind}" style="left:${pl.x}%;top:${pl.y}%" onclick="GUI.place('${pl.id}')" title="${esc(pl.name)}">
              ${ICONS.pin}<span class="gp-pin-label">${esc(pl.name)}<b>${pl.count}</b></span></button>`).join('')}
            <svg class="gp-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="30,62 44,74 33,92" /></svg>
          </div>
          <div class="gp-map-side">
            ${G.places.map((pl) => `<div class="card click" style="margin-bottom:10px" onclick="GUI.place('${pl.id}')"><div class="list-title"><b>${esc(pl.name)}</b> <span class="chip">${esc(pl.kind)}</span></div><div class="muted small">${esc(pl.region)} · ${pl.count} event${pl.count === 1 ? '' : 's'}</div></div>`).join('')}
          </div>
        </div>`;
    },

    relations() {
      const withRels = G.persons.filter((p) => relationsForPerson(p.id).length);
      return `
        ${viewHead('network', 'Relations', 'A second network, independent of kinship: godparents, employers, officiants and in-laws — the social fabric a prosopographical historian works with.')}
        ${withRels.map((p) => `<div class="card" style="margin-bottom:12px">
          <div class="list-title" style="margin-bottom:6px"><b class="chip link" onclick="GUI.person('${p.id}')">${esc(p.name)}</b></div>
          ${relationsForPerson(p.id).map((r) => `<div class="gp-rel">
            <span class="chip"><span class="dot" style="background:var(--cyan)"></span>${esc(r.role)}</span>
            <b>${esc(nameOf(r.to))}</b>
            <span class="muted small">${esc(r.notes)}</span>
            <div style="margin-left:auto;display:flex;gap:2px;flex-shrink:0">
              <button class="gp-icon-btn" title="Edit" onclick="GUI.toast('In the app: edit the role and notes of this relation.')">${ICONS.edit}</button>
              <button class="gp-icon-btn danger" title="Delete" onclick="GUI.toast('In the app: removes this relation (with confirmation).')">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
        </div>`).join('')}`;
    },

    search() {
      return `
        ${viewHead('search', 'Search', 'One box over the whole vault — people, events and the full text of every transcribed source.')}
        <input class="search-input" id="gp-search" placeholder="Try “Vega”, “baptism”, “Buenos Aires”, “widower”…" autocomplete="off"/>
        <div id="gp-search-results" style="margin-top:16px"></div>`;
    },

    library() {
      return `
        ${viewHead('book', 'Library', 'Secondary literature that frames the reconstruction — synced from Zotero, the same as an academic vault. Primary sources live in the Archive.')}
        ${G.library.map((w) => `<div class="list-row" style="cursor:default">
          <span class="gp-doc">${ICONS.book}</span>
          <div class="list-main">
            <div class="list-title"><b>${esc(w.title)}</b> <span class="chip">${esc(w.type)}</span></div>
            <div class="list-desc">${esc(w.author)} (${w.year}) — ${esc(w.note)}</div>
          </div>
        </div>`).join('')}`;
    },

    deepResearch() {
      const r = G.deepResearch.find((x) => x.id === state.report) || G.deepResearch[0];
      return `
        <div class="report">
          <button class="back-btn" onclick="window.go('home')">${ICONS.x} Close reader</button>
          <img class="cover" src="${r.cover}" alt=""/>
          <div class="report-title"><h2>${esc(r.title)}</h2><p class="muted small">${esc(r.meta)}</p></div>
          <div class="report-body">
            ${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.paras.map((p) => `<p>${citeText(p)}</p>${p.cites && p.cites.length ? `<div class="cite-row">${p.cites.map((c) => `<span class="cite" onclick="GUI.archive('${c[1]}')">${esc(c[0])}</span>`).join('')}</div>` : ''}`).join('')}`).join('')}
          </div>
          <div class="page-nav"><span class="muted small">${ICONS.report} Generated over the embedding-indexed archive + library</span><button class="btn ghost" onclick="GUI.toast('In the app: export to Word / PDF, or generate an audio edition.')">${ICONS.external} Export</button></div>
        </div>`;
    },

    notes() {
      const flat = G.notes.flatMap((f) => f.notes.map((n) => ({ ...n, folder: f.folder })));
      const cur = flat.find((n) => n.id === state.note) || flat[0];
      return `
        ${viewHead('notebook', 'Notes', 'Your own working notes, with links back to the people and records they mention.')}
        <div class="notes-grid">
          <div>
            ${G.notes.map((f) => `<div class="nav-group-label" style="padding-left:6px">${esc(f.folder)}</div>${f.notes.map((n) => `<div class="note-item ${n.id === cur.id ? 'active' : ''}" onclick="GUI.note('${n.id}')">${ICONS.notebook}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title)}</span></div>`).join('')}`).join('')}
          </div>
          <div class="card">
            <div class="list-title" style="margin-bottom:8px"><b style="font-size:15px">${esc(cur.title)}</b> <span class="muted small">· ${esc(cur.updated)}</span></div>
            <div class="note-body">${cur.body.split(/(\[[^\]]+\])/).map((seg) => /^\[/.test(seg) ? `<span class="note-link">${ICONS.link}${esc(seg.replace(/^\[|\]$/g, ''))}</span>` : esc(seg)).join('')}</div>
          </div>
        </div>`;
    },

    settings() {
      const s = G.settings;
      const tabs = [['providers', 'AI Providers'], ['models', 'Models'], ['vault', 'Vault']];
      const panel = state.settingsTab === 'models'
        ? `<div class="card"><h3>${ICONS.settings} Task models</h3><table class="tbl"><tbody>${s.models.map((m) => `<tr><td>${esc(m[0])}</td><td><span class="chip">${esc(m[1])}</span></td></tr>`).join('')}</tbody></table></div>`
        : state.settingsTab === 'vault'
          ? `<div class="card"><h3>${ICONS.archive} Vault</h3><div class="set-row"><div class="lbl"><b>Type</b><span>Tailors the sidebar and the assistant persona</span></div><span class="chip"><span class="dot" style="background:var(--amber)"></span>Genealogy</span></div><div class="set-row"><div class="lbl"><b>Assistant persona</b><span>Acts as a genealogist; proposes kinship from evidence, following the proof standard</span></div>${toggle('mcp')}</div><div class="set-row"><div class="lbl"><b>Encrypted auto-backup</b><span>Covers every vault, generational rotation</span></div>${toggle('autoBackup')}</div></div>`
          : `<div class="card"><h3>${ICONS.settings} Providers</h3>${s.providers.map((p) => `<div class="set-row"><div class="set-prov"><span class="prov-badge" style="background:${p.on ? 'rgba(202,138,4,0.18)' : 'var(--bg-soft)'};color:${p.on ? '#fde68a' : 'var(--text-3)'}">${esc(p.name[0])}</span><div class="lbl"><b>${esc(p.name)}</b><span>${esc(p.desc)}${p.key ? ' · <span class="keymask">' + esc(p.key) + '</span>' : ''}</span></div></div><span class="chip"><span class="dot" style="background:${p.on ? 'var(--green)' : 'var(--text-3)'}"></span>${p.on ? 'active' : 'off'}</span></div>`).join('')}</div>`;
      return `
        ${viewHead('settings', 'Settings', 'Everything runs locally; AI is your own key or fully offline. This is a static preview.')}
        <div class="settings-grid">
          <div class="set-tabs">${tabs.map((t) => `<button class="set-tab ${state.settingsTab === t[0] ? 'active' : ''}" onclick="GUI.setTab('${t[0]}')">${ICONS.settings}<span>${t[1]}</span></button>`).join('')}</div>
          <div>${panel}</div>
        </div>`;
    },
  };

  function toggle(key) {
    const on = state.toggles[key];
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" onclick="GUI.sw('${key}',this)"></button>`;
  }
  function citeText(p) {
    return esc(p.text);
  }

  // kin suggestion modal
  function kinModal(id) {
    const k = G.kinSuggestions.find((x) => x.id === id);
    openModal(`
      ${modalHead(esc(k.question), `<span class="gp-strength ${k.strength}">${k.strength} signal</span> · proposed from evidence`)}
      <p class="muted small">Nothing is added to the tree without your confirmation. This is exactly how the assistant proposes kinship — with its evidence shown.</p>
      <div class="nav-group-label" style="padding-left:0">Evidence</div>
      ${k.evidence.map((e) => `<div class="gp-fact">${ICONS.bulb}<span>${esc(e)}</span></div>`).join('')}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn primary" onclick="GUI.close();GUI.toast('In the app: adds the filiation to the tree, citing this evidence.')">${ICONS.check} Confirm kinship</button>
        <button class="btn ghost" onclick="GUI.close();GUI.toast('In the app: dismisses the suggestion; it won’t be proposed again.')">Not the same</button>
      </div>`, true);
  }

  // ---------- family tree SVG ----------
  function treeSVG() {
    const N = 156, H = 54;
    const nodes = {
      p1: { cx: 300, cy: 40 }, p2: { cx: 520, cy: 40 },
      p3: { cx: 150, cy: 210 }, p6: { cx: 330, cy: 210 }, p4: { cx: 545, cy: 210 }, c1: { cx: 725, cy: 210 }, p5: { cx: 885, cy: 210 },
      p7: { cx: 195, cy: 375 }, p8: { cx: 370, cy: 375 },
    };
    const node = (id) => {
      const n = nodes[id];
      const p = personById(id) || contactById(id);
      const isContact = !personById(id);
      const hyp = p && p.conf === 'hypothesis';
      const infant = id === 'p5';
      const w = infant ? 130 : N, h = infant ? 46 : H;
      const x = n.cx - w / 2, y = n.cy - h / 2;
      const fill = isContact ? '#161616' : (personById(id).sex === 'F' ? 'rgba(138,92,74,0.16)' : 'rgba(122,98,73,0.16)');
      const stroke = hyp ? 'var(--amber)' : isContact ? 'var(--border-soft)' : (personById(id).sex === 'F' ? '#8a5c4a' : '#7a6249');
      const dates = personById(id) ? lifespan(personById(id)) : 'in-law';
      const nm = (p.name || id).replace(/[¿?]/g, '');
      return `<g class="gp-tnode ${isContact ? 'contact' : ''}" ${personById(id) ? `onclick="GUI.person('${id}')"` : ''} transform="translate(${x},${y})">
        <rect width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.4" ${hyp ? 'stroke-dasharray="5 4"' : ''}/>
        <text x="10" y="21" font-size="12.5" font-weight="600" fill="#f0e6d6">${esc(nm.length > 22 ? nm.slice(0, 21) + '…' : nm)}</text>
        <text x="10" y="38" font-size="11" fill="#b6a58c">${esc(dates)}${hyp ? ' · ?' : ''}</text>
      </g>`;
    };
    const line = (x1, y1, x2, y2, dashed) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="var(--border-soft)" stroke-width="1.6" fill="none" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
    const poly = (pts, dashed) => `<polyline points="${pts}" stroke="var(--border-soft)" stroke-width="1.6" fill="none" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
    // couple bars
    const coupleP1 = line(nodes.p1.cx + 78, 40, nodes.p2.cx - 78, 40);        // Bartolomé — Dolores
    const coupleP3 = line(nodes.p3.cx + 78, 210, nodes.p6.cx - 78, 210);      // Francisco — Carmen
    const coupleP4 = line(nodes.p4.cx + 78, 210, nodes.c1.cx - 78, 210, false); // María — Manuel
    // gen0 → gen1 children (Francisco, María, Antonio) via a sibling bus
    const g0mid = (nodes.p1.cx + nodes.p2.cx) / 2; // 410
    const busY1 = 128;
    const g0bus = poly(`${g0mid},40 ${g0mid},${busY1} ${nodes.p3.cx},${busY1} ${nodes.p3.cx},183`) +
      poly(`${nodes.p4.cx},${busY1} ${nodes.p4.cx},183`) +
      poly(`${nodes.p5.cx},${busY1} ${nodes.p5.cx},187`) +
      line(nodes.p3.cx, busY1, nodes.p5.cx, busY1);
    // gen1 (Francisco+Carmen) → gen2 children (José, Ramón?)
    const g1mid = (nodes.p3.cx + nodes.p6.cx) / 2; // 240
    const busY2 = 300;
    const g1bus = poly(`${g1mid},210 ${g1mid},${busY2} ${nodes.p7.cx},${busY2} ${nodes.p7.cx},348`) +
      line(nodes.p7.cx, busY2, nodes.p8.cx, busY2) +
      poly(`${nodes.p8.cx},${busY2} ${nodes.p8.cx},348`, true); // Ramón: dashed (unconfirmed)
    return `<svg class="gp-tree" viewBox="0 0 980 420" role="img" aria-label="Family tree">
      ${coupleP1}${coupleP3}${coupleP4}${g0bus}${g1bus}
      ${Object.keys(nodes).map(node).join('')}
    </svg>`;
  }

  // ---------- search ----------
  function runSearch(q) {
    const box = $('#gp-search-results');
    if (!box) return;
    const s = q.trim().toLowerCase();
    if (!s) { box.innerHTML = `<p class="muted small">Type to search people, events and every transcribed record.</p>`; return; }
    const people = G.persons.filter((p) => (p.name + ' ' + (p.occupation || '') + ' ' + p.bio).toLowerCase().includes(s));
    const recs = G.archive.filter((a) => (a.title + ' ' + a.transcript + ' ' + a.facts.join(' ')).toLowerCase().includes(s));
    const evs = G.events.filter((e) => (e.summary + ' ' + e.place + ' ' + (EVENT_LABEL[e.type] || '')).toLowerCase().includes(s));
    const sec = (label, items) => items.length ? `<div class="nav-group-label" style="padding-left:0">${label} (${items.length})</div>${items.join('')}` : '';
    box.innerHTML = [
      sec('People', people.map((p) => `<div class="list-row" onclick="GUI.person('${p.id}')"><span class="gp-doc">${ICONS.people}</span><div class="list-main"><div class="list-title"><b>${esc(p.name)}</b> <span class="muted small">${esc(lifespan(p))}</span></div><div class="list-desc">${esc(p.bio.slice(0, 120))}…</div></div></div>`)),
      sec('Records', recs.map((a) => `<div class="list-row" onclick="GUI.archive('${a.id}')"><span class="gp-doc">${ICONS.archive}</span><div class="list-main"><div class="list-title"><b>${esc(a.title)}</b> <span class="chip">${esc(a.kind)}</span></div><div class="list-desc">${esc(a.transcript.slice(0, 120))}…</div></div></div>`)),
      sec('Events', evs.map((e) => `<div class="list-row" onclick="GUI.archive('${e.source}')"><span class="gp-doc">${ICONS.clock}</span><div class="list-main"><div class="list-title">${eventChip(e.type)} <b>${esc(e.date)}</b></div><div class="list-desc">${esc(e.summary)}</div></div></div>`)),
    ].join('') || `<p class="muted small">No matches for “${esc(q)}”.</p>`;
  }

  // ---------- assistant (genealogist persona) ----------
  const chat = { open: false, messages: [], replyIdx: 0 };
  const CANNED = [
    { text: 'Following the genealogical proof standard, I never assert a link without a document. The 1897 marriage confirms Francisco ↔ Carmen, but their earliest tie is a godparent relation in 1874 — recorded, not inferred.' },
    { text: 'The 1908 civil register calls Bartolomé a “widower”, yet Dolores dies in 1919. Every other source agrees, so I flag this as a likely clerk’s error rather than resolving it silently. Want me to draft a note?' },
    { text: 'Ramón Ortega is a low-confidence lead: a 1901 foundling baptism with a “Herrera” godmother. I would not add him to the tree — I have logged it as an open identity question until a second source appears.' },
  ];
  function renderChat() {
    const root = $('#chat-root');
    if (!chat.open) { root.innerHTML = ''; return; }
    root.innerHTML = `<div class="modal-overlay" id="chat-ov"><div class="modal chat-modal">
      <div class="chat-head"><div style="flex:1"><h3>${ICONS.wand} Assistant · Genealogist</h3><p>Grounded on this vault. Proposes kinship from evidence — never invents a source.</p></div><button class="modal-x" onclick="GUI.chatClose()">${ICONS.x}</button></div>
      <div class="chat-msgs" id="gp-chat-msgs">
        ${chat.messages.length ? chat.messages.map((m) => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('') : `<div class="msg hint">Ask about a person, a record, or a contradiction. Try “Is Ramón a Herrera?”</div>`}
      </div>
      <div class="chat-input"><input id="gp-chat-inp" placeholder="Ask the genealogist…" autocomplete="off"/><button class="btn primary" onclick="GUI.chatSend()">Send</button></div>
    </div></div>`;
    $('#chat-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'chat-ov') GUI.chatClose(); });
    const inp = $('#gp-chat-inp'); if (inp) { inp.focus(); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') GUI.chatSend(); }); }
    const m = $('#gp-chat-msgs'); if (m) m.scrollTop = m.scrollHeight;
  }

  // ---------- router ----------
  window.go = function (view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const el = main();
    el.innerHTML = `<div class="fade-in">${(VIEWS[view] || VIEWS.home)()}</div>`;
    el.scrollTop = 0;
    if (view === 'search') {
      runSearch('');
      const box = $('#gp-search'); if (box) { box.addEventListener('input', () => runSearch(box.value)); box.focus(); }
    }
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// */ }
  };

  window.GUI = {
    toast, close: closeModal,
    person: personModal, archive: archiveModal, place: placeModal, kin: kinModal,
    note(id) { state.note = id; window.go('notes'); },
    setTab(id) { state.settingsTab = id; window.go('settings'); },
    sw(key, el) { state.toggles[key] = !state.toggles[key]; el.classList.toggle('on', state.toggles[key]); el.setAttribute('aria-checked', String(state.toggles[key])); },
    chat() { chat.open = true; renderChat(); },
    chatClose() { chat.open = false; renderChat(); },
    chatSend() {
      const inp = $('#gp-chat-inp'); const v = inp && inp.value.trim(); if (!v) return;
      chat.messages.push({ who: 'user', text: v }); inp.value = '';
      renderChat();
      setTimeout(() => { chat.messages.push({ who: 'ai', text: CANNED[chat.replyIdx++ % CANNED.length].text }); renderChat(); }, 700);
    },
  };

  // ---------- boot ----------
  const nav = $('#nav');
  nav.innerHTML = NAV.map((n) =>
    n.group !== undefined
      ? `<div class="nav-group-label">${n.group}</div>`
      : `<button class="nav-item" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`
  ).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) window.go(b.dataset.view); });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if ($('#modal-root').innerHTML) closeModal(); else if (chat.open) GUI.chatClose(); });

  const initial = (location.hash || '#home').slice(1);
  window.go(VIEWS[initial] ? initial : 'home');
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) window.go(v); });
})();
