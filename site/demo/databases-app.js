/* Nodus web demo — DATABASES mode. A static replica of the app's Databases vault:
   typed tables (title/text/select/multi-select/number/date/checkbox/attachment/
   relation/AI), a gallery layout, the record ficha, a Search across databases, and
   an Analysis section whose statistics, histograms, box-plot and correlations are
   COMPUTED here from the sample rows — the same "AI plans, the engine computes"
   split the desktop app uses. Same shell + conventions as app.js / genealogy-app.js. */
(function () {
  const DB = window.DB;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = () => $('#main');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- lookups ----------
  const dbById = (id) => DB.databases.find((d) => d.id === id);
  const colByKey = (db, key) => db.columns.find((c) => c.key === key);
  const optOf = (col, key) => (col.options || []).find((o) => o.key === key);
  const fmt = (n) => (n == null || n === '' ? '' : Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
  function hexRgba(hex, a) {
    const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const filled = (col, v) => col.type === 'multiSelect' ? Array.isArray(v) && v.length > 0 : col.type === 'checkbox' ? true : v != null && v !== '';

  // ---------- icons ----------
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    grid: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    bars: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    chatbub: I('<path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.7L3 21l1.8-5.3A8.5 8.5 0 1 1 21 11.5Z"/>'),
    notebook: I('<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 2v20M13 7h4M13 11h4"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'), minus: I('<path d="M5 12h14"/>'),
    x: I('<path d="m5 5 14 14M19 5 5 19"/>'), check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    external: I('<path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>'),
    trash: I('<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    wand: I('<path d="m14 6 4 4L7 21l-4-4L14 6Z"/><path d="M15 3h.01M20 8h.01"/>'),
    sparkle: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>'),
    upload: I('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 21h16"/>'),
    download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
    list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    gallery: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    filter: I('<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>'),
    sort: I('<path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l-3 3M17 20l3-3"/>'),
    calendar: I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    text: I('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    tag: I('<path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z"/><circle cx="7.5" cy="7.5" r="1.2"/>'),
    tags: I('<path d="M2 10V4a1 1 0 0 1 1-1h6l8 8-6 6-8-8Z"/><path d="m13 3 8 8-5 5"/><circle cx="6.5" cy="6.5" r="1"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>'),
    key: I('<circle cx="8" cy="14" r="4.5"/><path d="m11.5 10.5 8-8M18 4l2.5 2.5M15 7l2 2"/>'),
    palette: I('<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1.7-2.5 2.7Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
    shield: I('<path d="M12 2 4 5.5v6C4 16.5 7.5 20.6 12 22c4.5-1.4 8-5.5 8-10.5v-6L12 2Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14M5 15h14M9 4 7 20M17 4l-2 16"/></svg>',
  };
  const typeIcon = {
    title: '<span class="db-th">H</span>', text: ICONS.text, select: ICONS.tag, multiSelect: ICONS.tags,
    number: ICONS.hash, date: ICONS.calendar, time: ICONS.clock, checkbox: ICONS.check,
    attachment: ICONS.upload, relation: ICONS.link, ai: ICONS.sparkle,
  };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- cell rendering ----------
  function selChip(col, key) {
    const o = optOf(col, key); if (!o) return '';
    return `<span class="db-chip" style="background:${hexRgba(o.color, 0.16)};color:${o.color};border:1px solid ${hexRgba(o.color, 0.4)}">${esc(o.label)}</span>`;
  }
  function relChip(name) {
    return `<span class="db-chip db-rel">${esc(name)}</span>`;
  }
  function cellHTML(col, v) {
    switch (col.type) {
      case 'title': return `<b>${esc(v)}</b>`;
      case 'text': return `<span class="db-txt">${esc(v || '')}</span>`;
      case 'select': return v ? selChip(col, v) : '';
      case 'multiSelect': return (Array.isArray(v) ? v : []).map((k) => selChip(col, k)).join(' ');
      case 'number': return `<span class="db-num">${fmt(v)}</span>`;
      case 'date': return `<span class="db-date">${esc(v || '')}</span>`;
      case 'checkbox': return `<span class="db-check ${v ? 'on' : ''}">${v ? ICONS.check : ''}</span>`;
      case 'attachment': return `<span class="db-att-empty">${ICONS.upload}</span>`;
      case 'relation': return v ? relChip(v) : '';
      case 'ai': return `<span class="db-ai-empty">${ICONS.sparkle}</span>`;
      default: return esc(v);
    }
  }
  const COLW = { title: 190, text: 200, select: 150, multiSelect: 170, number: 96, date: 118, time: 96, checkbox: 78, attachment: 96, relation: 170, ai: 150 };
  const widthOf = (col) => COLW[col.type] || 150;

  // ---------- statistics (pure, deterministic) ----------
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, b = Math.floor(pos), r = pos - b;
    return sorted[b + 1] !== undefined ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
  }
  function describe(a) {
    const s = a.slice().sort((x, y) => x - y), n = a.length, m = mean(a);
    const variance = n > 1 ? a.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const outliers = a.filter((x) => x < lo || x > hi).length;
    const skew = n > 2 && sd > 0 ? (a.reduce((t, x) => t + ((x - m) / sd) ** 3, 0) * n / ((n - 1) * (n - 2))) : 0;
    const kurt = sd > 0 ? (a.reduce((t, x) => t + ((x - m) / sd) ** 4, 0) / n - 3) : 0;
    return { n, mean: m, median: quantile(s, 0.5), std: sd, variance, cv: m ? sd / m : 0, min: s[0], max: s[n - 1], q1, q3, iqr, whiskLo: Math.max(s[0], lo), whiskHi: Math.min(s[n - 1], hi), skew, kurt, outliers };
  }
  function histogram(a, bins) {
    bins = bins || 8;
    const min = Math.min(...a), max = Math.max(...a), span = (max - min) || 1, w = span / bins;
    const out = Array.from({ length: bins }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
    a.forEach((x) => { let k = Math.floor((x - min) / w); if (k >= bins) k = bins - 1; if (k < 0) k = 0; out[k].count++; });
    return out;
  }
  function pearson(x, y) {
    const n = x.length, mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  }
  const numsOf = (db, col) => db.rows.map((r) => r[col.key]).filter((v) => typeof v === 'number');

  // ---------- state ----------
  const state = { view: 'home', dbId: 'DEMO1', layout: 'table', openRow: null, analysisDbId: 'DEMO1', analyses: [], settingsTab: 'providers',
    toggles: { autoSummary: false, mcp: true, autoBackup: true, prerelease: false } };
  const sw = (key) => `<button class="switch${state.toggles[key] ? ' on' : ''}" onclick="GUI.sw('${key}',this)" role="switch" aria-checked="${!!state.toggles[key]}"></button>`;

  // ---------- record ficha ----------
  function recordModal(dbId, idx) {
    const db = dbById(dbId); const row = db.rows[idx]; if (!row) return;
    const fieldRow = (col) => {
      let val;
      if (col.type === 'attachment') val = `<div class="db-drop">${ICONS.plus}</div>`;
      else if (col.type === 'ai') val = `<div class="db-ai-row"><span class="muted small">Not generated yet</span><button class="db-wand" title="Generate with AI" onclick="GUI.toast('In the app: writes a short summary of this row with your configured model.')">${ICONS.wand}</button></div>`;
      else if (col.type === 'checkbox') val = `<span class="db-check ${row[col.key] ? 'on' : ''}">${row[col.key] ? ICONS.check : ''}</span>`;
      else if (col.type === 'title') val = `<div class="db-field-in">${esc(row[col.key])}</div>`;
      else if (col.type === 'select' || col.type === 'multiSelect' || col.type === 'relation') val = `<div class="db-field-chips">${cellHTML(col, row[col.key]) || '<span class="muted small">—</span>'}</div>`;
      else val = `<div class="db-field-in">${esc(cellText(col, row[col.key])) || '<span class="muted small">—</span>'}</div>`;
      return `<div class="db-frow"><div class="db-flabel">${typeIcon[col.type] || ''} <span>${esc(col.name)}</span></div>${val}</div>`;
    };
    openModal(`
      <div class="modal-head"><div class="muted small">${esc(db.name)}</div><button class="modal-x" onclick="GUI.close()">${ICONS.x}</button></div>
      <h2 class="db-ficha-title">${esc(row[db.columns[0].key])}</h2>
      <div class="db-fields">${db.columns.map(fieldRow).join('')}</div>
    `, true);
  }
  function cellText(col, v) {
    if (col.type === 'number') return fmt(v);
    return v == null ? '' : String(v);
  }

  // ---------- modal ----------
  function openModal(html, wide) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" id="modal-ov"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
    $('#modal-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-ov') closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; state.openRow = null; }

  // ---------- views ----------
  const viewHead = (icon, title, sub, right) => `<div class="view-head"><div><h1 class="view-title">${ICONS[icon]} ${title}</h1>${sub ? `<p class="view-sub">${sub}</p>` : ''}</div>${right || ''}</div>`;

  const VIEWS = {
    home() {
      const totalRows = DB.databases.reduce((n, d) => n + d.rows.length, 0);
      const dbCard = (d) => `<div class="card click db-hcard" onclick="window.go('db:${d.id}')">
          <div class="db-hcard-top"><span class="db-hicon">${ICONS[d.icon]}</span><b>${esc(d.name)}</b><span class="db-sid">${esc(d.shortId)}</span></div>
          <div class="muted small">${d.rows.length} entries</div>
        </div>`;
      const wideCard = (icon, title, body, target) => `<div class="card click db-wcard" onclick="window.go('${target}')">
          <div class="db-hcard-top"><span class="db-hicon">${ICONS[icon]}</span><b>${title}</b></div>
          <div class="muted small">${body}</div>
        </div>`;
      return `
        <div class="view-head"><div>
          <h1 class="view-title" style="font-size:22px">Home</h1>
          <p class="view-sub" style="margin-bottom:0">Your structured data: tables with typed columns, analysis and chat.</p>
        </div><div class="tag-row">
          <button class="btn" onclick="GUI.toast('In the app: import a CSV or XLSX and Nodus infers the column types.')">${ICONS.upload} Import CSV</button>
          <button class="btn primary" onclick="GUI.toast('In the app: create an empty database, then add typed columns.')">${ICONS.plus} New database</button>
        </div></div>
        <div class="nav-group-label" style="padding-left:0;margin-top:6px">Databases</div>
        <div class="grid cols-3">${DB.databases.map(dbCard).join('')}</div>
        <div class="nav-group-label" style="padding-left:0;margin-top:18px">Analyze</div>
        <div class="grid cols-2">
          ${wideCard('bars', 'Analysis', 'Statistics and AI reports over a database.', 'analysis')}
          ${wideCard('chatbub', 'Data chat', `Ask your data (${totalRows} entries in total).`, 'chat')}
        </div>`;
    },

    database(dbId) {
      const db = dbById(dbId); if (!db) return VIEWS.home();
      const filledPct = Math.round(db.rows.filter((r) => filled(db.columns[0], r[db.columns[0].key])).length / db.rows.length * 100);
      const toolbar = `<div class="tag-row" style="align-items:center">
          <span class="pill">${ICONS.filter} Filter</span>
          <span class="pill">${ICONS.sort} Sort</span>
          <span class="db-toggle">
            <button class="${state.layout === 'table' ? 'on' : ''}" onclick="GUI.setLayout('table')" title="Table">${ICONS.list}</button>
            <button class="${state.layout === 'gallery' ? 'on' : ''}" onclick="GUI.setLayout('gallery')" title="Gallery">${ICONS.gallery}</button>
          </span>
          <button class="btn ghost" title="Export" onclick="GUI.toast('In the app: export this database to CSV, XLSX or JSON.')">${ICONS.download}</button>
          <button class="btn primary" onclick="GUI.toast('In the app: adds a new row you can edit inline.')">${ICONS.plus} New row</button>
        </div>`;
      const head = `<div class="db-head">
          <div class="db-head-l">
            <span class="db-hicon">${ICONS[db.icon]}</span>
            <b class="db-head-title">${esc(db.name)}</b>
            <span class="db-sid mono">${esc(db.shortId)}</span>
            <span class="muted small">${db.rows.length} entries <span style="opacity:.7">(${filledPct}%)</span></span>
          </div>
          <div class="db-head-r">${toolbar}</div>
        </div>
        <div class="db-tabs"><span class="db-tab active">All</span><span class="db-tab-add">${ICONS.plus}</span></div>`;
      const body = state.layout === 'table' ? tableHTML(db) : galleryHTML(db);
      return `<div class="db-view">${head}${body}</div>`;
    },

    search() {
      return `${viewHead('search', 'Search', 'Search across all your databases: by name and inside the rows’ content.')}
        <input class="search-input" id="db-search" placeholder="Type to search…" autocomplete="off"/>
        <div id="db-search-results" style="margin-top:16px"><p class="muted small">Start typing to see results.</p></div>`;
    },

    analysis() {
      const db = dbById(state.analysisDbId);
      const numCols = db.columns.filter((c) => c.type === 'number');
      return `<div class="view-head"><div><h1 class="view-title">${ICONS.bars} Analysis</h1></div>
          <select class="select" onchange="GUI.setAnalysisDb(this.value)">${DB.databases.map((d) => `<option value="${d.id}" ${d.id === db.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        </div>
        <p class="muted small" style="margin:-14px 0 16px">${db.rows.length} rows · ${db.columns.length} columns</p>
        <div class="db-profile">${db.columns.map((c) => profileCard(db, c)).join('')}</div>
        <div class="db-dist">${distCards(db)}</div>
        <div class="card db-suggest">
          <div class="list-title" style="justify-content:space-between"><b class="db-cardt">${ICONS.wand} AI-suggested analyses</b>
            <button class="btn primary" onclick="GUI.toast('In the app: the AI reads the data profile and proposes analyses. Each one is then computed on your device from the real figures.')">${ICONS.wand} Suggest analyses</button></div>
          <p class="muted small" style="margin-top:8px">The AI reviews your data profile and proposes the most revealing analyses. Each one is computed on your device from real figures — never invented.</p>
        </div>
        <div class="card">
          <b class="db-cardt">Manual analysis</b>
          <div class="db-manual">
            <label>Type<select class="select" id="db-an-type">
              <option value="describe">Descriptive statistics</option>
              <option value="correlate">Correlation matrix</option>
            </select></label>
            <label>Numeric columns<select class="select" id="db-an-col">${numCols.map((c) => `<option value="${c.key}">${esc(c.name)}</option>`).join('')}</select></label>
            <button class="btn primary" onclick="GUI.addAnalysis()">${ICONS.plus} Add</button>
          </div>
          <div id="db-analyses">${state.analyses.map((a, i) => analysisCard(db, a, i)).join('')}</div>
        </div>`;
    },

    chat() {
      const db = dbById(state.dbId);
      return `<div class="db-chat-view">
        ${viewHead('chatbub', 'Data chat', '', `<div class="db-chat-pills">${DB.databases.map((d) => `<button class="db-cpill ${d.id === chat.dbId ? 'active' : ''}" onclick="GUI.chatDb('${d.id}')">${esc(d.name)}</button>`).join('')}</div>`)}
        <div class="db-chat-scroll" id="db-chat-msgs">${chat.messages.length ? chat.messages.map(renderMsg).join('') : chatEmpty()}</div>
        <div class="db-chat-input"><input id="db-chat-inp" placeholder="Ask your data…" autocomplete="off"/><button class="btn primary" onclick="GUI.chatSend()">${ICONS.chatbub} Send</button></div>
      </div>`;
    },

    notes() {
      const cur = DB.notes.find((n) => n.id === state.note) || DB.notes[0];
      const folders = [...new Set(DB.notes.map((n) => n.folder))];
      return `${viewHead('notebook', 'Notes', 'Working notes that link back to the databases and rows they mention.')}
        <div class="notes-grid">
          <div>${folders.map((f) => `<div class="nav-group-label" style="padding-left:6px">${esc(f)}</div>${DB.notes.filter((n) => n.folder === f).map((n) => `<div class="note-item ${n.id === cur.id ? 'active' : ''}" onclick="GUI.note('${n.id}')">${ICONS.notebook}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title)}</span></div>`).join('')}`).join('')}</div>
          <div class="card"><div class="list-title" style="margin-bottom:8px"><b style="font-size:15px">${esc(cur.title)}</b> <span class="muted small">· ${esc(cur.updated)}</span></div>
            <div class="note-body">${cur.body.split(/(\[[^\]]+\])/).map((seg) => /^\[/.test(seg) ? `<span class="note-link">${ICONS.link}${esc(seg.replace(/^\[|\]$/g, ''))}</span>` : esc(seg)).join('')}</div></div>
        </div>`;
    },

    settings() {
      return `${viewHead('settings', 'Settings', 'Providers, models, import, integrations, backups — everything local-first.')}
        <div class="settings-grid">
          <div class="set-tabs">${SET_TABS.map(([id, label, ic]) => `<button class="set-tab${state.settingsTab === id ? ' active' : ''}" onclick="GUI.setTab('${id}')">${ICONS[ic]} ${label}</button>`).join('')}</div>
          <div id="set-panel">${(SET_PANELS[state.settingsTab] || SET_PANELS.providers)()}</div>
        </div>`;
    },
  };

  // ---------- table & gallery ----------
  function tableHTML(db) {
    const total = db.columns.reduce((w, c) => w + widthOf(c), 0) + 44 + 40;
    const header = `<div class="db-trow db-thead" style="min-width:${total}px"><div class="db-gutter"></div>${db.columns.map((c) => `<div class="db-cell db-hcell" style="width:${widthOf(c)}px"><span class="db-tico">${typeIcon[c.type] || ''}</span><span class="db-hname">${esc(c.name)}</span></div>`).join('')}<div class="db-addcol">${ICONS.plus}</div></div>`;
    const rows = db.rows.map((row, i) => `<div class="db-trow db-brow" style="min-width:${total}px">
        <div class="db-gutter">
          <button class="db-rowbtn" title="Open record" onclick="GUI.openRow('${db.id}',${i})">${ICONS.external}</button>
          <button class="db-rowbtn del" title="Delete row" onclick="GUI.toast('In the app: deletes this row (with an undo).')">${ICONS.trash}</button>
        </div>
        ${db.columns.map((c) => `<div class="db-cell db-tcell db-t-${c.type}" style="width:${widthOf(c)}px">${cellHTML(c, row[c.key])}</div>`).join('')}
        <div class="db-addcol"></div>
      </div>`).join('');
    return `<div class="db-tablewrap">${header}<div class="db-tbody">${rows}</div></div>`;
  }
  function galleryHTML(db) {
    const titleKey = db.columns[0].key;
    const chipCols = db.columns.filter((c) => c.type === 'select' || c.type === 'multiSelect');
    return `<div class="db-gallery-bar"><span class="muted small">Image</span><span class="db-toggle sm"><button class="on">Fill</button><button>Fit</button></span><span class="muted small" style="margin-left:10px">Columns</span><span class="db-colnum">${ICONS.minus}<b>4</b>${ICONS.plus}</span></div>
      <div class="db-gallery">${db.rows.map((row, i) => `<div class="db-gcard" onclick="GUI.openRow('${db.id}',${i})">
        <div class="db-gthumb">${ICONS.grid}</div>
        <b class="db-gtitle">${esc(row[titleKey])}</b>
        <div class="tag-row">${chipCols.map((c) => cellHTML(c, row[c.key])).join(' ')}</div>
      </div>`).join('')}</div>`;
  }

  // ---------- analysis rendering ----------
  function profileCard(db, col) {
    const vals = db.rows.map((r) => r[col.key]);
    const fill = Math.round(vals.filter((v) => filled(col, v)).length / vals.length * 100);
    let sub = '';
    if (col.type === 'number') { const nn = numsOf(db, col); sub = nn.length ? `mean ${fmt(Math.round(mean(nn) * 100) / 100)}` : '—'; }
    else if (col.type === 'select' || col.type === 'multiSelect') { const s = new Set(); vals.forEach((v) => (Array.isArray(v) ? v : v ? [v] : []).forEach((x) => s.add(x))); sub = `${s.size} values`; }
    else if (col.type === 'date') { const ds = vals.filter(Boolean).sort(); sub = ds.length ? `${ds[0]} → ${ds[ds.length - 1]}` : '—'; }
    else if (col.type === 'checkbox') sub = `${vals.filter(Boolean).length} checked`;
    else { const s = new Set(vals.filter((v) => v != null && v !== '')); sub = `${s.size} distinct`; }
    return `<div class="db-pcard"><div class="db-pname">${typeIcon[col.type] || ''} <b>${esc(col.name)}</b></div><div class="db-pfill">${fill}% filled</div><div class="db-psub">${sub}</div></div>`;
  }

  function distCards(db) {
    const cards = [];
    db.columns.forEach((col) => {
      if (col.type === 'select' || col.type === 'multiSelect') {
        const counts = new Map();
        db.rows.forEach((r) => (Array.isArray(r[col.key]) ? r[col.key] : r[col.key] ? [r[col.key]] : []).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
        const items = (col.options || []).filter((o) => counts.has(o.key)).map((o) => ({ label: o.label, count: counts.get(o.key), color: o.color }))
          .sort((a, b) => b.count - a.count);
        cards.push(barsCard(col.name, items));
      } else if (col.type === 'number') {
        const nn = numsOf(db, col); if (nn.length < 2) return;
        const h = histogram(nn, 8);
        const items = h.map((b, i) => ({ label: `${fmt(Math.round(b.from * 100) / 100)}–${fmt(Math.round(b.to * 100) / 100)}`, count: b.count, color: HIST_COLORS[i % HIST_COLORS.length] }));
        cards.push(barsCard(col.name, items, true));
      } else if (col.type === 'checkbox') {
        const on = db.rows.filter((r) => r[col.key]).length;
        cards.push(barsCard(col.name, [{ label: 'Checked', count: on, color: '#34d399' }, { label: 'Unchecked', count: db.rows.length - on, color: '#6b7280' }]));
      }
    });
    return cards.join('');
  }
  const HIST_COLORS = ['#f43f5e', '#6366f1', '#34d399', '#fbbf24', '#22d3ee', '#f472b6', '#8b5cf6', '#f97316'];
  function barsCard(title, items, keepOrder) {
    const max = Math.max(1, ...items.map((i) => i.count));
    return `<div class="card db-barcard"><b class="db-cardt">${esc(title)}</b><div class="db-bars">${items.map((it) => `
      <div class="db-bar"><span class="db-bar-l">${esc(it.label)}</span><span class="db-bar-track"><span class="db-bar-fill" style="width:${it.count / max * 100}%;background:${it.color}"></span></span><span class="db-bar-n">${it.count}</span></div>`).join('')}</div></div>`;
  }

  function analysisCard(db, a, i) {
    if (a.type === 'describe') return describeCard(db, a.cols[0], i);
    if (a.type === 'correlate') return correlateCard(db, a.cols, i);
    return '';
  }
  function describeCard(db, key, i) {
    const col = colByKey(db, key); const nn = numsOf(db, col); if (nn.length < 2) return '';
    const d = describe(nn);
    const cells = [['n', d.n], ['Average', fmt(round(d.mean, 3))], ['Median', fmt(round(d.median, 3))], ['Std.', fmt(round(d.std, 3))], ['Variance', fmt(round(d.variance, 2))], ['CV', fmt(round(d.cv, 3))], ['Min', fmt(d.min)], ['Max', fmt(d.max)], ['Q1', fmt(round(d.q1, 3))], ['Q3', fmt(round(d.q3, 3))], ['Skewness', fmt(round(d.skew, 3))], ['Kurtosis', fmt(round(d.kurt, 3))], ['Outliers', d.outliers]];
    const h = histogram(nn, 8); const hmax = Math.max(1, ...h.map((b) => b.count));
    const hist = `<div class="db-bars db-hist">${h.map((b, k) => `<div class="db-bar"><span class="db-bar-l">${fmt(round(b.from, 2))}–${fmt(round(b.to, 2))}</span><span class="db-bar-track"><span class="db-bar-fill" style="width:${b.count / hmax * 100}%;background:${HIST_COLORS[k % HIST_COLORS.length]}"></span></span><span class="db-bar-n">${b.count}</span></div>`).join('')}</div>`;
    return `<div class="card db-ancard"><div class="list-title" style="justify-content:space-between"><b class="db-cardt">${ICONS.bars} Descriptive statistics <span class="muted small" style="font-weight:400">· ${esc(col.name)}</span></b><div class="tag-row"><button class="btn ghost small" onclick="GUI.toast('In the app: the AI explains this table in plain language — over the statistics, not the raw rows.')">${ICONS.wand} Explain with AI</button><button class="btn ghost small" onclick="GUI.dropAnalysis(${i})">${ICONS.x}</button></div></div>
      <div class="db-statscroll"><table class="tbl db-stattbl"><thead><tr><th>Column</th>${cells.map(([k]) => `<th>${k}</th>`).join('')}</tr></thead><tbody><tr><td><b>${esc(col.name)}</b></td>${cells.map(([, v]) => `<td>${v}</td>`).join('')}</tr></tbody></table></div>
      ${hist}
      ${boxplot(col.name, d)}</div>`;
  }
  function boxplot(label, d) {
    const W = 460, x0 = 150, x1 = 430, span = (d.max - d.min) || 1;
    const X = (v) => x0 + (v - d.min) / span * (x1 - x0);
    const y = 20, h = 18, cy = y + h / 2;
    return `<svg class="db-box" viewBox="0 0 ${W} 48" width="100%" preserveAspectRatio="xMidYMid meet">
      <text x="8" y="${cy + 4}" fill="#a3a3a3" font-size="12">${esc(label)}</text>
      <line x1="${X(d.whiskLo)}" y1="${cy}" x2="${X(d.whiskHi)}" y2="${cy}" stroke="#6b7280" stroke-width="1.5"/>
      <line x1="${X(d.whiskLo)}" y1="${y + 2}" x2="${X(d.whiskLo)}" y2="${y + h - 2}" stroke="#6b7280" stroke-width="1.5"/>
      <line x1="${X(d.whiskHi)}" y1="${y + 2}" x2="${X(d.whiskHi)}" y2="${y + h - 2}" stroke="#6b7280" stroke-width="1.5"/>
      <rect x="${X(d.q1)}" y="${y}" width="${Math.max(1, X(d.q3) - X(d.q1))}" height="${h}" rx="2" fill="rgba(179,3,51,0.28)" stroke="#B30333" stroke-width="1.5"/>
      <line x1="${X(d.median)}" y1="${y}" x2="${X(d.median)}" y2="${y + h}" stroke="#fff" stroke-width="1.6"/>
      <text x="${x0}" y="46" fill="#737373" font-size="11">${fmt(d.min)}</text>
      <text x="${x1}" y="46" fill="#737373" font-size="11" text-anchor="end">${fmt(d.max)}</text>
    </svg>`;
  }
  function correlateCard(db, keys, i) {
    const cols = keys.map((k) => colByKey(db, k));
    const series = cols.map((c) => numsOf(db, c));
    const r = (a, b) => pearson(series[a], series[b]);
    const cell = (a, b) => {
      const v = a === b ? 1 : r(a, b);
      const col = v >= 0 ? '179,3,51' : '99,102,241';
      return `<td class="db-cor-cell" style="background:rgba(${col},${(Math.abs(v) * 0.72).toFixed(2)})">${v.toFixed(2)}</td>`;
    };
    const grid = `<table class="tbl db-cortbl"><thead><tr><th></th>${cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${cols.map((c, a) => `<tr><th>${esc(c.name)}</th>${cols.map((_, b) => cell(a, b)).join('')}</tr>`).join('')}</tbody></table>`;
    const scatter = cols.length === 2 ? scatterSVG(series[0], series[1], cols[0].name, cols[1].name) : '';
    return `<div class="card db-ancard"><div class="list-title" style="justify-content:space-between"><b class="db-cardt">${ICONS.bars} Correlation matrix</b><button class="btn ghost small" onclick="GUI.dropAnalysis(${i})">${ICONS.x}</button></div>
      <div class="db-cor-wrap">${grid}${scatter}</div>
      <p class="muted small" style="margin-top:8px">Pearson r over ${series[0].length} rows. Positive in crimson, negative in indigo.</p></div>`;
  }
  function scatterSVG(x, y, xl, yl) {
    const W = 300, H = 220, pad = 34;
    const xmin = Math.min(...x), xmax = Math.max(...x), ymin = Math.min(...y), ymax = Math.max(...y);
    const X = (v) => pad + (v - xmin) / ((xmax - xmin) || 1) * (W - pad - 10);
    const Y = (v) => H - pad - (v - ymin) / ((ymax - ymin) || 1) * (H - pad - 10);
    const pts = x.map((v, i) => `<circle cx="${X(v).toFixed(1)}" cy="${Y(y[i]).toFixed(1)}" r="4" fill="#B30333" fill-opacity="0.85"/>`).join('');
    return `<svg class="db-scatter" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <line x1="${pad}" y1="${H - pad}" x2="${W - 8}" y2="${H - pad}" stroke="#3f3f46"/>
      <line x1="${pad}" y1="8" x2="${pad}" y2="${H - pad}" stroke="#3f3f46"/>
      ${pts}
      <text x="${W / 2}" y="${H - 6}" fill="#737373" font-size="11" text-anchor="middle">${esc(xl)}</text>
      <text x="10" y="${H / 2}" fill="#737373" font-size="11" text-anchor="middle" transform="rotate(-90 10 ${H / 2})">${esc(yl)}</text>
    </svg>`;
  }
  const round = (v, p) => Math.round(v * 10 ** p) / 10 ** p;

  // ---------- search ----------
  function runSearch(q) {
    const box = $('#db-search-results'); if (!box) return;
    const s = q.trim().toLowerCase();
    if (!s) { box.innerHTML = `<p class="muted small">Start typing to see results.</p>`; return; }
    const dbHits = [], rowHits = [];
    DB.databases.forEach((db) => {
      let inContent = 0;
      db.rows.forEach((row, i) => {
        const hay = db.columns.map((c) => matchText(c, row[c.key])).join(' ').toLowerCase();
        if (hay.includes(s)) {
          inContent++;
          const label = db.columns.find((c) => matchText(c, row[c.key]).toLowerCase().includes(s) && c.type !== 'title');
          rowHits.push(`<div class="list-row db-srow" onclick="GUI.openRow('${db.id}',${i})"><div class="list-main"><div class="list-title"><b>${esc(row[db.columns[0].key])}</b> <span class="muted small">${esc(db.name)}</span></div>${label ? `<div class="list-desc">${esc(label.name)}: ${esc(matchText(label, row[label.key]))}</div>` : ''}</div></div>`);
        }
      });
      if (db.name.toLowerCase().includes(s) || inContent) dbHits.push(`<div class="list-row db-srow" onclick="window.go('db:${db.id}')"><div class="list-main"><div class="list-title"><span class="db-hicon sm">${ICONS[db.icon]}</span><b>${esc(db.name)}</b> <span class="db-sid mono">${esc(db.shortId)}</span>${inContent ? `<span class="db-chip db-rel" style="margin-left:auto">${inContent} in content</span>` : ''}</div></div></div>`);
    });
    box.innerHTML = (dbHits.length ? `<div class="nav-group-label" style="padding-left:0">Databases</div>${dbHits.join('')}` : '')
      + (rowHits.length ? `<div class="nav-group-label" style="padding-left:0;margin-top:14px">Rows</div>${rowHits.join('')}` : '')
      + (!dbHits.length && !rowHits.length ? `<p class="muted small">No matches for “${esc(q)}”.</p>` : '');
  }
  function matchText(col, v) {
    if (v == null) return '';
    if (col.type === 'select') { const o = optOf(col, v); return o ? o.label : ''; }
    if (col.type === 'multiSelect') return (v || []).map((k) => { const o = optOf(col, k); return o ? o.label : ''; }).join(' ');
    if (col.type === 'checkbox') return v ? 'yes' : '';
    return String(v);
  }

  // ---------- data chat ----------
  const chat = { dbId: 'DEMO1', messages: [], i: 0 };
  const chatEmpty = () => `<div class="db-chat-empty">
      <span class="db-chat-icon">${ICONS.chatbub}</span>
      <p class="muted small">Ask your data. It can answer with figures and charts, always from your rows.</p>
      <div class="db-chat-sugs">${CHAT_SUGS.map((s) => `<button class="db-sug" onclick="GUI.chatPreset('${esc(s).replace(/'/g, "\\'")}')">${esc(s)}</button>`).join('')}</div>
    </div>`;
  const CHAT_SUGS = ['Summarize this database in 3 points.', 'Show me the distribution by category in a chart.', 'What outliers or data-quality issues do you spot?', 'Compare the groups and highlight the differences.'];
  const renderMsg = (m) => `<div class="msg ${m.who}">${esc(m.text)}</div>`;

  // ---------- settings ----------
  const SET_TABS = [
    ['providers', 'Providers', 'key'], ['models', 'AI models', 'wand'], ['import', 'Import', 'upload'],
    ['interface', 'Interface', 'palette'], ['integrations', 'Integrations', 'link'], ['data', 'Data', 'download'],
  ];
  const SET_PANELS = {
    providers: () => `<div class="card"><h3>${ICONS.key} AI providers</h3>
        <p class="muted small" style="margin:2px 0 10px">Bring your own key, or run fully offline with a local model. Keys are stored encrypted in your system keychain.</p>
        ${DB.settings.providers.map((p) => { const local = p.desc.includes('offline'); return `<div class="set-row"><div class="set-prov"><span class="prov-badge" style="background:${local ? 'rgba(52,211,153,0.15)' : 'rgba(179,3,51,0.16)'};color:${local ? 'var(--green)' : '#f9a8b8'}">${p.name[0]}</span><div class="lbl"><b>${p.name}</b><span>${p.desc}${p.key ? ` · <span class="keymask">${p.key}</span>` : ''}</span></div></div>${p.on ? `<span class="chip"><span class="dot" style="background:var(--green)"></span>configured</span>` : `<button class="btn ghost small" onclick="GUI.toast('In the app: paste your API key (or base URL for local providers); it is validated and stored in the keychain.')">Configure</button>`}</div>`; }).join('')}
      </div>`,
    models: () => `<div class="card"><h3>${ICONS.wand} Model per task</h3>
        <p class="muted small" style="margin:2px 0 8px">Data chat, the AI-summary column, suggested analyses and the report can each use a different model — cloud or local.</p>
        ${DB.settings.models.map(([task, model]) => `<div class="set-row"><div class="lbl"><b>${task}</b></div><select class="select" onchange="GUI.toast('Model preference saved (demo).')"><option>${model}</option><option>claude-sonnet-5</option><option>qwen3:8b · Ollama</option><option>gpt-5.2</option></select></div>`).join('')}
      </div>`,
    import: () => `<div class="card"><h3>${ICONS.upload} Import</h3>
        <div class="set-row"><div class="lbl"><b>CSV / XLSX</b><span>Column types are inferred, then you confirm them.</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: pick a file and map its columns to types.')">Choose file</button></div>
        <div class="set-row"><div class="lbl"><b>Auto AI summary</b><span>Fill the AI-summary column on import.</span></div>${sw('autoSummary')}</div>
        <div class="set-row"><div class="lbl"><b>Bulk attachments</b><span>Match files to rows by name.</span></div><span class="chip"><span class="dot" style="background:var(--green)"></span>supported</span></div>
      </div>`,
    interface: () => `<div class="card"><h3>${ICONS.palette} Interface</h3>
        <div class="set-row"><div class="lbl"><b>Language</b><span>UI in English or Spanish.</span></div><select class="select"><option>English</option><option>Español</option></select></div>
        <div class="set-row"><div class="lbl"><b>Theme</b></div><select class="select" onchange="GUI.toast('The desktop app switches instantly between dark and light.')"><option>Dark</option><option>Light</option></select></div>
        <div class="set-row"><div class="lbl"><b>Default row height</b></div><select class="select"><option>Compact</option><option>Comfortable</option></select></div>
      </div>`,
    integrations: () => `<div class="card"><h3>${ICONS.link} MCP server</h3>
        <p class="muted small" style="margin:2px 0 8px">Query your databases from Claude or any MCP client — locally.</p>
        <div class="set-row"><div class="lbl"><b>Enable MCP server</b><span>stdio · list / query / row tools</span></div>${sw('mcp')}</div>
        <div class="set-row"><div class="lbl"><b>Connection</b></div><span class="keymask">npx nodus-mcp --vault "Field notebook"</span></div>
      </div>`,
    data: () => `<div class="card"><h3 style="display:flex;align-items:center;gap:8px">${ICONS.shield} Backups</h3>
        <p class="muted small" style="margin:2px 0 8px">Automatic encrypted backups with grandfather-father-son rotation. Master password lives in your system keychain.</p>
        <div class="set-row"><div class="lbl"><b>Automatic backups</b><span>Daily · keep 7 daily / 4 weekly / 6 monthly</span></div>${sw('autoBackup')}</div>
        <div class="set-row"><div class="lbl"><b>Sync package</b><span>Export a merge-ready .nodussync to move between machines.</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: exports a package that merges losslessly into another vault.')">Export</button></div>
      </div>
      <div class="card danger-zone"><h3 style="color:var(--red)">Danger zone</h3>
        <div class="set-row"><div class="lbl"><b>Delete a database</b><span>Rows and columns are removed. Export first.</span></div><button class="btn ghost small danger" onclick="GUI.toast('Relax — nothing is deleted in the demo. In the app this asks twice and backs up first.')">${ICONS.trash} Delete</button></div>
      </div>`,
  };

  // ---------- router ----------
  window.go = function (view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    let render;
    if (view.startsWith('db:')) { state.dbId = view.slice(3); render = VIEWS.database(state.dbId); }
    else render = (VIEWS[view] || VIEWS.home)();
    const full = view.startsWith('db:') || view === 'chat';
    main().innerHTML = `<div class="fade-in db-viewroot ${full ? 'db-full' : 'db-scroll'}">${render}</div>`;
    main().scrollTop = 0;
    if (view === 'search') { runSearch(''); const b = $('#db-search'); if (b) { b.addEventListener('input', () => runSearch(b.value)); b.focus(); } }
    if (view === 'chat') { const m = $('#db-chat-msgs'); if (m) m.scrollTop = m.scrollHeight; const inp = $('#db-chat-inp'); if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') GUI.chatSend(); }); }
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
  };

  window.GUI = {
    toast, close: closeModal,
    openRow(dbId, i) { recordModal(dbId, i); },
    setLayout(l) { state.layout = l; window.go('db:' + state.dbId); },
    setAnalysisDb(id) { state.analysisDbId = id; state.analyses = []; seedAnalysis(); window.go('analysis'); },
    addAnalysis() {
      const db = dbById(state.analysisDbId);
      const type = $('#db-an-type').value, key = $('#db-an-col').value;
      if (type === 'correlate') {
        const nums = db.columns.filter((c) => c.type === 'number');
        if (nums.length < 2) { toast('Correlation needs at least two numeric columns.'); return; }
        state.analyses.unshift({ type: 'correlate', cols: nums.map((c) => c.key) });
      } else {
        state.analyses.unshift({ type: 'describe', cols: [key] });
      }
      window.go('analysis');
    },
    dropAnalysis(i) { state.analyses.splice(i, 1); window.go('analysis'); },
    chatDb(id) { chat.dbId = id; chat.messages = []; chat.i = 0; window.go('chat'); },
    chatPreset(text) { doSend(text); },
    chatSend() { const inp = $('#db-chat-inp'); const v = inp && inp.value.trim(); if (!v) return; inp.value = ''; doSend(v); },
    note(id) { state.note = id; window.go('notes'); },
    setTab(id) { state.settingsTab = id; window.go('settings'); },
    sw(key, el) { state.toggles[key] = !state.toggles[key]; el.classList.toggle('on', state.toggles[key]); el.setAttribute('aria-checked', String(state.toggles[key])); },
    chat() { window.go('chat'); },
  };
  function doSend(text) {
    chat.messages.push({ who: 'user', text });
    window.go('chat');
    setTimeout(() => {
      const bank = DB.chat[chat.dbId] || [];
      chat.messages.push({ who: 'ai', text: bank[chat.i++ % bank.length].text });
      window.go('chat');
    }, 600);
  }
  function seedAnalysis() {
    const db = dbById(state.analysisDbId);
    const firstNum = db.columns.find((c) => c.type === 'number');
    if (firstNum) state.analyses = [{ type: 'describe', cols: [firstNum.key] }];
  }

  // ---------- boot ----------
  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Explore' },
    { id: 'search', label: 'Search', icon: 'search' },
    ...DB.databases.map((d) => ({ id: 'db:' + d.id, label: d.name, icon: d.icon })),
    { group: 'Analyze' },
    { id: 'analysis', label: 'Analysis', icon: 'bars' },
    { id: 'chat', label: 'Data chat', icon: 'chatbub' },
    { group: 'Write' },
    { id: 'notes', label: 'Notes', icon: 'notebook' },
    { group: '' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const nav = $('#nav');
  nav.innerHTML = NAV.map((n) => n.group !== undefined
    ? `<div class="nav-group-label">${n.group}</div>`
    : `<button class="nav-item" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) window.go(b.dataset.view); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
  seedAnalysis();
  const initial = (location.hash || '#home').slice(1);
  window.go(initial && (VIEWS[initial] || initial.startsWith('db:')) ? initial : 'home');
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== state.view && (VIEWS[v] || v.startsWith('db:'))) window.go(v); });
})();
