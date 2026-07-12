/* Nodus web demo — GENEALOGY mode. A faithful, static replica of the app's
   genealogy vault on the Serrano-family sample corpus: the SVG family tree with
   framed portraits, the two-pane People view, the timeline, the evidence archive
   (folder tree + table), the real Leaflet map with migration paths, and the
   social-relations node graph. Same shell + conventions as app.js. */
(function () {
  const G = window.GEN;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = () => $('#main');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- lookups ----------
  const personById = (id) => G.persons.find((p) => p.id === id);
  const placeById = (id) => G.places.find((p) => p.id === id);
  const contactById = (id) => G.contacts.find((c) => c.id === id);
  const archiveById = (id) => G.archive.find((a) => a.id === id);
  const nameOf = (id) => (personById(id) || contactById(id) || { name: id }).name;
  const yearOf = (s) => { const m = String(s || '').match(/\d{4}/); return m ? +m[0] : null; };
  const datesOf = (p) => (p.birth && p.death) ? `${p.birth} – ${p.death}` : p.birth ? `n. ${p.birth}` : p.death ? `† ${p.death}` : '';
  const eventsForPerson = (id) => G.events.filter((e) => e.persons.includes(id));
  const sortedEvents = () => G.events.slice().sort((a, b) => (a.year - b.year) || 0);

  const EVC = window.GEN_EVENT_COLORS;
  const EVENT_LABEL = { birth: 'Birth', baptism: 'Baptism', marriage: 'Marriage', death: 'Death', burial: 'Burial', census: 'Census', migration: 'Migration', residence: 'Residence' };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- family-tree layout (ported from shared/treeLayout.ts) ----------
  function computeTreeLayout(input) {
    const opts = Object.assign({ nodeWidth: 128, nodeHeight: 158, hGap: 28, vGap: 52 }, input);
    if (!input.focusId) return { nodes: [], edges: [], width: 0, height: 0 };
    const sexOf = new Map(), birthOf = new Map();
    (input.persons || []).forEach((p) => { sexOf.set(p.id, p.sex || 'unknown'); birthOf.set(p.id, p.birthYear ?? null); });
    const parentsOf = new Map(), childrenOf = new Map();
    input.parentEdges.forEach(({ parent, child }) => {
      (childrenOf.get(parent) || childrenOf.set(parent, []).get(parent)).push(child);
      (parentsOf.get(child) || parentsOf.set(child, []).get(child)).push(parent);
    });
    const spousesOf = new Map();
    input.spouseEdges.forEach(({ a, b }) => {
      (spousesOf.get(a) || spousesOf.set(a, []).get(a)).push(b);
      (spousesOf.get(b) || spousesOf.set(b, []).get(b)).push(a);
    });
    const gen = new Map(); gen.set(input.focusId, 0);
    const q = [input.focusId];
    while (q.length) {
      const id = q.shift(); const g = gen.get(id);
      (parentsOf.get(id) || []).forEach((p) => { if (!gen.has(p)) { gen.set(p, g - 1); q.push(p); } });
      (childrenOf.get(id) || []).forEach((c) => { if (!gen.has(c)) { gen.set(c, g + 1); q.push(c); } });
      (spousesOf.get(id) || []).forEach((s) => { if (!gen.has(s)) { gen.set(s, g); q.push(s); } });
    }
    const present = new Set(gen.keys());
    const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const partners = new Map();
    const link = (a, b) => {
      if (a === b || !present.has(a) || !present.has(b) || gen.get(a) !== gen.get(b)) return;
      (partners.get(a) || partners.set(a, new Set()).get(a)).add(b);
      (partners.get(b) || partners.set(b, new Set()).get(b)).add(a);
    };
    input.spouseEdges.forEach(({ a, b }) => link(a, b));
    parentsOf.forEach((ps) => { for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) link(ps[i], ps[j]); });
    const byGen = new Map();
    gen.forEach((g, id) => (byGen.get(g) || byGen.set(g, []).get(g)).push(id));
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    const orderPair = (x, y) => {
      const sx = sexOf.get(x), sy = sexOf.get(y);
      if (sx === 'male' && sy === 'female') return [x, y];
      if (sx === 'female' && sy === 'male') return [y, x];
      const bx = birthOf.get(x), by = birthOf.get(y);
      if (bx != null && by != null && bx !== by) return bx < by ? [x, y] : [y, x];
      return x < y ? [x, y] : [y, x];
    };
    const orderComponent = (members) => {
      if (members.length <= 1) return members;
      if (members.length === 2) return orderPair(members[0], members[1]);
      const set = new Set(members);
      const start = members.find((m) => [...(partners.get(m) || [])].filter((p) => set.has(p)).length === 1) || members[0];
      const seq = [], seen = new Set(); let cur = start;
      while (cur) { seq.push(cur); seen.add(cur); cur = [...(partners.get(cur) || [])].find((p) => set.has(p) && !seen.has(p)); }
      members.forEach((m) => { if (!seen.has(m)) seq.push(m); });
      return seq;
    };
    const order = new Map();
    const orderGeneration = (g, neigh) => {
      const ids = byGen.get(g);
      const parent = new Map(); const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); return r; };
      ids.forEach((id) => parent.set(id, id));
      ids.forEach((id) => (partners.get(id) || []).forEach((p) => { if (gen.get(p) === g) parent.set(find(id), find(p)); }));
      const comps = new Map();
      ids.forEach((id) => (comps.get(find(id)) || comps.set(find(id), []).get(find(id))).push(id));
      const bary = (id) => {
        if (neigh === null) return Number.MAX_SAFE_INTEGER;
        const rel = g < 0 ? (childrenOf.get(id) || []) : (parentsOf.get(id) || []);
        const placed = rel.filter((n) => gen.get(n) === neigh && order.has(n)).map((n) => order.get(n));
        return placed.length ? placed.reduce((s, v) => s + v, 0) / placed.length : Number.MAX_SAFE_INTEGER;
      };
      const ordered = [...comps.values()].map((members) => {
        const seq = orderComponent(members);
        const bs = members.map(bary).filter((b) => b < Number.MAX_SAFE_INTEGER);
        return { seq, b: bs.length ? bs.reduce((s, v) => s + v, 0) / bs.length : Number.MAX_SAFE_INTEGER };
      }).sort((a, b) => a.b - b.b);
      let i = 0; ordered.forEach((comp) => comp.seq.forEach((id) => order.set(id, i++)));
    };
    orderGeneration(0, null);
    [...gens].sort((a, b) => Math.abs(a) - Math.abs(b)).forEach((g) => { if (g !== 0) orderGeneration(g, g < 0 ? g + 1 : g - 1); });
    const minGen = gens[0] ?? 0;
    const rowStep = opts.nodeHeight + opts.vGap, colStep = opts.nodeWidth + opts.hGap;
    const nodes = [], nodesById = new Map(); let maxCols = 0;
    gens.forEach((g) => {
      const ids = byGen.get(g).slice().sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
      maxCols = Math.max(maxCols, ids.length);
      ids.forEach((id, col) => { const n = { personId: id, generation: g, x: col * colStep, y: (g - minGen) * rowStep, coupleSide: 'none' }; nodes.push(n); nodesById.set(id, n); });
    });
    nodes.forEach((node) => {
      const ps = [...(partners.get(node.personId) || [])].map((p) => nodesById.get(p)).filter(Boolean);
      if (!ps.length) return;
      const near = ps.reduce((a, b) => Math.abs(b.x - node.x) < Math.abs(a.x - node.x) ? b : a);
      node.coupleSide = node.x < near.x ? 'left' : 'right';
    });
    const edges = [];
    input.parentEdges.forEach(({ parent, child }) => { if (present.has(parent) && present.has(child)) edges.push({ from: parent, to: child, kind: 'parent' }); });
    input.spouseEdges.forEach(({ a, b }) => { if (present.has(a) && present.has(b)) edges.push({ from: a, to: b, kind: 'spouse' }); });
    return { nodes, edges, width: Math.max(0, maxCols * colStep - opts.hGap), height: Math.max(0, gens.length * rowStep - opts.vGap) };
  }

  // A default silhouette (man faces right, woman left; mirror to face inward).
  function portraitImg(p, mirror) {
    const src = p.sex === 'female' ? 'assets/woman-portrait.webp' : 'assets/man-portrait.webp';
    return `<div style="width:100%;height:100%;overflow:hidden;background:#2b2b30"><img src="${src}" alt="" draggable="false" style="width:100%;height:100%;object-fit:cover;object-position:50% 20%;${mirror ? 'transform:scaleX(-1)' : ''}"/></div>`;
  }

  // ---------- icons ----------
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
    plus: I('<path d="M12 5v14M5 12h14"/>'), minus: I('<path d="M5 12h14"/>'),
    x: I('<path d="m5 5 14 14M19 5 5 19"/>'), check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    edit: I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>'),
    external: I('<path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>'),
    wand: I('<path d="m14 6 4 4L7 21l-4-4L14 6Z"/><path d="M15 3h.01M20 8h.01"/>'),
    bulb: I('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.4 1 2.3h6c0-.9.3-1.8 1-2.3A7 7 0 0 0 12 2Z"/>'),
    upload: I('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M4 21h16"/>'), download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
    folder: I('<path d="M4 4h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>'),
    layers: I('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
    target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
    grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>'),
    alert: I('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
    file: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5"/>'),
    key: I('<circle cx="8" cy="14" r="4.5"/><path d="m11.5 10.5 8-8M18 4l2.5 2.5M15 7l2 2"/>'),
    palette: I('<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1.7-2.5 2.7Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
    shield: I('<path d="M12 2 4 5.5v6C4 16.5 7.5 20.6 12 22c4.5-1.4 8-5.5 8-10.5v-6L12 2Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    trash: I('<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    word: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5"/><path d="m8 12 1.5 6L11 13l1.5 5L14 12"/>'),
    sync: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
  };

  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Explore' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Library', icon: 'book' },
    { id: 'people', label: 'People', icon: 'people' },
    { id: 'timeline', label: 'Timeline', icon: 'clock' },
    { id: 'tree', label: 'Family tree', icon: 'tree' },
    { id: 'relations', label: 'Social relations', icon: 'network' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'archive', label: 'Archive', icon: 'archive' },
    { group: 'Analyze' },
    { id: 'deepResearch', label: 'Deep Research', icon: 'report' },
    { group: 'Write' },
    { id: 'notes', label: 'Notes', icon: 'notebook' },
    { group: '' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const state = { view: 'home', focus: 'p9', zoom: 1, person: null, note: 'n1', archiveFolder: 'all', settingsTab: 'providers',
    toggles: { autoAnalyze: false, readTag: true, animations: true, ocr: true, mcp: true, word: true, autoBackup: true, prerelease: false } };
  const sw = (key) => `<button class="switch${state.toggles[key] ? ' on' : ''}" onclick="GUI.sw('${key}',this)" role="switch" aria-checked="${!!state.toggles[key]}"></button>`;
  const SET_TABS = [
    ['providers', 'Providers', 'key'], ['models', 'AI models', 'wand'], ['library', 'Library', 'book'],
    ['extraction', 'Text & OCR', 'search'], ['interface', 'Interface', 'palette'], ['integrations', 'Integrations', 'link'],
    ['system', 'System', 'settings'], ['data', 'Data', 'download'],
  ];
  const SET_PANELS = {
    providers: () => `
      <div class="card"><h3>${ICONS.key} AI providers</h3>
        <p class="muted small" style="margin:2px 0 10px">Bring your own key, or run fully offline with a local model. Keys are stored encrypted in your system keychain.</p>
        ${G.settings.providers.map((p) => { const local = p.desc.includes('offline'); return `<div class="set-row">
          <div class="set-prov"><span class="prov-badge" style="background:${local ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.16)'};color:${local ? 'var(--green)' : '#a5b4fc'}">${p.name[0]}</span>
            <div class="lbl"><b>${p.name}</b><span>${p.desc}${p.key ? ` · <span class="keymask">${p.key}</span>` : ''}</span></div></div>
          ${p.on ? `<span class="chip"><span class="dot" style="background:var(--green)"></span>configured</span>` : `<button class="btn ghost small" onclick="GUI.toast('In the app: paste your API key (or base URL for local providers); it is validated and stored in the keychain.')">Configure</button>`}
        </div>`; }).join('')}
      </div>`,
    models: () => `
      <div class="card"><h3>${ICONS.wand} Model per task</h3>
        <p class="muted small" style="margin:2px 0 8px">Each pipeline step can use a different model, mixing cloud and local freely. Prompts auto-size to each model's real context window.</p>
        ${G.settings.models.map(([task, model]) => `<div class="set-row"><div class="lbl"><b>${task}</b></div><select class="select" onchange="GUI.toast('Model preference saved (demo).')"><option>${model}</option><option>claude-sonnet-5</option><option>qwen3:8b · Ollama</option><option>gpt-5.2</option><option>gemini-3-flash</option></select></div>`).join('')}
      </div>`,
    library: () => `
      <div class="card"><h3>${ICONS.book} Zotero sync</h3>
        <div class="set-row"><div class="lbl"><b>Monitored collections</b><span>Family history · Local historiography</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: a tree of your Zotero collections with per-collection monitoring.')">Choose</button></div>
        <div class="set-row"><div class="lbl"><b>Auto-analyze new works</b><span>Off by default: sync only brings metadata until you opt in.</span></div>${sw('autoAnalyze')}</div>
        <div class="set-row"><div class="lbl"><b>Read tag</b><span>Mark works as read via a Zotero tag ("leído").</span></div>${sw('readTag')}</div>
      </div>`,
    extraction: () => `
      <div class="card"><h3>${ICONS.search} Text & OCR</h3>
        <div class="set-row"><div class="lbl"><b>Read attached files directly</b><span>PDF, EPUB and DOCX are parsed locally — no Zotero full-text index needed.</span></div><span class="chip"><span class="dot" style="background:var(--green)"></span>always on</span></div>
        <div class="set-row"><div class="lbl"><b>OCR for scanned records</b><span>Tesseract, local. Languages: English, Spanish.</span></div>${sw('ocr')}</div>
        <div class="set-row"><div class="lbl"><b>Degraded-scan recovery</b><span>Auto-retry documents that only yielded an abstract.</span></div><span class="chip"><span class="dot" style="background:var(--green)"></span>automatic</span></div>
      </div>`,
    interface: () => `
      <div class="card"><h3>${ICONS.palette} Interface</h3>
        <div class="set-row"><div class="lbl"><b>Language</b><span>UI in English or Spanish.</span></div><select class="select"><option>English</option><option>Español</option></select></div>
        <div class="set-row"><div class="lbl"><b>Theme</b></div><select class="select" onchange="GUI.toast('The desktop app switches instantly between dark and light.')"><option>Dark</option><option>Light</option></select></div>
        <div class="set-row"><div class="lbl"><b>Tree frame</b><span>Wooden portrait frame for the whole tree.</span></div><select class="select"><option>Classic oak</option><option>Dark walnut</option><option>Gilded</option><option>Rustic</option></select></div>
        <div class="set-row"><div class="lbl"><b>Animations</b></div>${sw('animations')}</div>
      </div>`,
    integrations: () => `
      <div class="card"><h3>${ICONS.link} MCP server</h3>
        <p class="muted small" style="margin:2px 0 8px">Query your vault from Claude or any MCP client — locally.</p>
        <div class="set-row"><div class="lbl"><b>Enable MCP server</b><span>stdio · read tools + writing tools</span></div>${sw('mcp')}</div>
        <div class="set-row"><div class="lbl"><b>Connection</b></div><span class="keymask">npx nodus-mcp --vault "Serrano family"</span></div>
      </div>
      <div class="card"><h3>Word writing copilot <span class="chip" style="margin-left:6px">beta</span></h3>
        <p class="muted small" style="margin:2px 0 8px">A task pane inside Microsoft Word that matches each paragraph you type against the vault, live.</p>
        <div class="set-row"><div class="lbl"><b>Local HTTPS bridge</b><span>Port 4320 · own CA, auto-renewing certificate</span></div>${sw('word')}</div>
        <div class="set-row"><div class="lbl"><b>Install add-in</b></div><button class="btn ghost small" onclick="GUI.toast('In the app: one click drops the manifest into Word and opens the pane.')">${ICONS.word} Install in Word</button></div>
      </div>`,
    system: () => `
      <div class="card"><h3>${ICONS.settings} System</h3>
        <div class="set-row"><div class="lbl"><b>Version</b><span>Nodus 2.0.3 — up to date</span></div><button class="btn ghost small" onclick="GUI.toast('Checking… you are on the latest release (demo).')">${ICONS.sync} Check for updates</button></div>
        <div class="set-row"><div class="lbl"><b>Pre-release channel</b></div>${sw('prerelease')}</div>
        <div class="set-row"><div class="lbl"><b>Guided tour</b><span>Replay the onboarding walkthrough.</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: replays the interactive tour across every section.')">Replay tour</button></div>
      </div>`,
    data: () => `
      <div class="card"><h3 style="display:flex;align-items:center;gap:8px">${ICONS.shield} Backups</h3>
        <p class="muted small" style="margin:2px 0 8px">Automatic encrypted backups with grandfather-father-son rotation. Master password lives in your system keychain.</p>
        <div class="set-row"><div class="lbl"><b>Automatic backups</b><span>Daily · keep 7 daily / 4 weekly / 6 monthly</span></div>${sw('autoBackup')}</div>
        <div class="set-row"><div class="lbl"><b>Last backup</b><span>Today 09:12 · 3.1 MB · encrypted</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: creates an encrypted backup right now.')">Back up now</button></div>
        <div class="set-row"><div class="lbl"><b>Sync package</b><span>Export a merge-ready .nodussync to move between machines.</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: exports a package that merges losslessly into another vault.')">Export</button></div>
        <div class="set-row"><div class="lbl"><b>Audit ledger</b><span>Tamper-evident log of every change to the vault.</span></div><button class="btn ghost small" onclick="GUI.toast('In the app: opens the full audit trail.')">View ledger</button></div>
      </div>
      <div class="card danger-zone"><h3 style="color:var(--red)">Danger zone</h3>
        <div class="set-row"><div class="lbl"><b>Reset the vault</b><span>People, events and relations are rebuilt on the next analysis.</span></div><button class="btn ghost small danger" onclick="GUI.toast('Relax — nothing is deleted in the demo. In the app this asks twice and makes a backup first.')">${ICONS.trash} Reset</button></div>
      </div>`,
  };

  // ---------- modal ----------
  function openModal(html, wide) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" id="modal-ov"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
    $('#modal-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-ov') closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  const modalHead = (title, sub) => `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<p class="muted small" style="margin:3px 0 0">${sub}</p>` : ''}</div><button class="modal-x" onclick="GUI.close()">${ICONS.x}</button></div>`;

  // ---------- family tree ----------
  const NODE_W = 128, NODE_H = 158, FRAME_W = 100, FRAME_H = 116, PAD = 40;
  function frameDefs() {
    return `<defs><linearGradient id="frame-oak" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#c8934a"/><stop offset="35%" stop-color="#b67c39"/><stop offset="55%" stop-color="#a0692e"/><stop offset="78%" stop-color="#b67c39"/><stop offset="100%" stop-color="#845528"/></linearGradient></defs>`;
  }
  function treeFrame(x, y, w, h, sex, portrait) {
    const female = sex === 'female';
    const border = female ? 11 : 12, rx = female ? 12 : 4, innerRx = Math.max(0, rx - 3);
    const ix = x + border, iy = y + border, iw = w - 2 * border, ih = h - 2 * border;
    return `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#frame-oak)" stroke="#000" stroke-opacity="0.35"/>
      <rect x="${ix - 2}" y="${iy - 2}" width="${iw + 4}" height="${ih + 4}" rx="${innerRx + 1}" fill="#000" fill-opacity="0.28"/>
      <foreignObject x="${ix}" y="${iy}" width="${iw}" height="${ih}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;border-radius:${innerRx}px;overflow:hidden">${portrait}</div></foreignObject>
      <rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="${rx}" fill="none" stroke="#fff" stroke-opacity="0.18"/>
      <rect x="${ix - 1}" y="${iy - 1}" width="${iw + 2}" height="${ih + 2}" rx="${innerRx}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.5"/>
    </g>`;
  }
  function treeSVG() {
    const layout = computeTreeLayout({
      focusId: state.focus,
      persons: G.persons.map((p) => ({ id: p.id, sex: p.sex, birthYear: yearOf(p.birth) })),
      parentEdges: G.relationships.filter((r) => r.type === 'parent').map((r) => ({ parent: r.from, child: r.to })),
      spouseEdges: G.relationships.filter((r) => r.type === 'spouse').map((r) => ({ a: r.from, b: r.to })),
    });
    const pos = new Map(layout.nodes.map((n) => [n.personId, n]));
    const cx = (id) => (pos.get(id).x + PAD + NODE_W / 2), cy = (id) => (pos.get(id).y + PAD + NODE_H / 2);
    const fTop = (id) => ({ x: pos.get(id).x + PAD + NODE_W / 2, y: pos.get(id).y + PAD });
    const fBot = (id) => ({ x: pos.get(id).x + PAD + NODE_W / 2, y: pos.get(id).y + PAD + FRAME_H });
    const svgW = layout.width + PAD * 2, svgH = layout.height + PAD * 2, z = state.zoom;
    const edges = layout.edges.map((e) => {
      if (e.kind === 'spouse') return `<line x1="${cx(e.from)}" y1="${cy(e.from)}" x2="${cx(e.to)}" y2="${cy(e.to)}" stroke="#8a5a2b" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round"/>`;
      const a = fBot(e.from), b = fTop(e.to), midY = (a.y + b.y) / 2;
      return `<path d="M ${a.x} ${a.y} V ${midY} H ${b.x} V ${b.y}" fill="none" stroke="#4b5563" stroke-width="1.5"/>`;
    }).join('');
    const nodes = layout.nodes.map((n) => {
      const p = personById(n.personId); if (!p) return '';
      const x = n.x + PAD, y = n.y + PAD, frameX = x + (NODE_W - FRAME_W) / 2;
      const isFocus = n.personId === state.focus;
      // Face INWARD in a couple: man's silhouette natively faces right, woman's left,
      // so mirror the one on the "wrong" side (man on the right, woman on the left).
      const mirror = (p.sex === 'male' && n.coupleSide === 'right') || (p.sex === 'female' && n.coupleSide === 'left');
      const nm = p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name;
      return `<g class="gp-tnode" onclick="GUI.person('${n.personId}')" ondblclick="GUI.focusTree('${n.personId}')">
        ${isFocus ? `<rect x="${frameX - 4}" y="${y - 4}" width="${FRAME_W + 8}" height="${FRAME_H + 8}" rx="16" fill="none" stroke="#818cf8" stroke-width="2.5"/>` : ''}
        ${treeFrame(frameX, y, FRAME_W, FRAME_H, p.sex, portraitImg(p, mirror))}
        <text x="${x + NODE_W / 2}" y="${y + FRAME_H + 18}" text-anchor="middle" fill="#e4e4e7" font-size="13" font-weight="600">${esc(nm)}</text>
        <text x="${x + NODE_W / 2}" y="${y + FRAME_H + 34}" text-anchor="middle" fill="#a1a1aa" font-size="11">${esc(datesOf(p))}</text>
      </g>`;
    }).join('');
    return `<svg width="${svgW * z}" height="${svgH * z}" viewBox="0 0 ${svgW} ${svgH}" style="min-width:100%">${frameDefs()}${edges}${nodes}</svg>`;
  }

  // ---------- person dossier ----------
  function personModal(id) {
    const p = personById(id); if (!p) return;
    const evs = eventsForPerson(id).slice().sort((a, b) => a.year - b.year);
    const rels = G.social.filter((r) => r.from === id);
    const par = G.relationships.filter((r) => r.type === 'parent' && r.to === id).map((r) => r.from);
    const kids = G.relationships.filter((r) => r.type === 'parent' && r.from === id).map((r) => r.to);
    const sp = G.relationships.filter((r) => r.type === 'spouse' && (r.from === id || r.to === id)).map((r) => r.from === id ? r.to : r.from);
    const vs = G.variants[id] || [];
    openModal(`
      ${modalHead(esc(p.name), `${p.sex === 'female' ? 'Female' : 'Male'} · ${esc(datesOf(p))}`)}
      <div style="display:flex;gap:16px;align-items:flex-start;margin:6px 0 8px">
        <div class="gp-ficha-portrait">${treeFichaSVG(p)}</div>
        <div style="min-width:0;flex:1">
          <div class="tag-row" style="margin-bottom:6px"><span class="chip">${esc(p.occupation || '—')}</span></div>
          <div class="muted small">${par.length ? `Child of ${par.map((x) => esc(nameOf(x))).join(' & ')}` : ''}${sp.length ? `<br>Spouse: ${sp.map((x) => esc(nameOf(x))).join(', ')}` : ''}${kids.length ? `<br>Children: ${kids.map((x) => esc(nameOf(x))).join(', ')}` : ''}</div>
          ${vs.length ? `<div class="muted small" style="margin-top:6px">Also recorded as: ${vs.map(esc).join(' · ')}</div>` : ''}
        </div>
      </div>
      <div class="nav-group-label" style="padding-left:0">Life events (${evs.length})</div>
      ${evs.map((e) => `<div class="gp-event" ${e.source ? `onclick="GUI.archive('${e.source}')"` : ''}>
        <span class="gp-event-dot" style="background:${EVC[e.type]}"></span>
        <div style="flex:1;min-width:0"><div class="list-title"><b>${EVENT_LABEL[e.type] || e.type}</b> <span class="muted small">· ${esc(e.date)} · ${esc((placeById(e.placeId) || {}).name || '')}</span></div></div>
        ${e.source ? `<span class="gp-src">${ICONS.archive}</span>` : ''}
      </div>`).join('') || '<p class="muted small">No events recorded.</p>'}
      ${rels.length ? `<div class="nav-group-label" style="padding-left:0">Social relations (${rels.length})</div>
        ${rels.map((r) => `<div class="arg-item plain" style="display:flex;gap:8px;align-items:center"><span class="chip"><span class="dot" style="background:var(--cyan)"></span>${esc(r.role)}</span> ${esc(nameOf(r.to))}</div>`).join('')}` : ''}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn primary" onclick="GUI.toast('In the app: writes an evidence-based biography from the linked records.')">${ICONS.wand} Generate biography</button>
        <button class="btn" onclick="GUI.close();GUI.focusTree('${id}')">${ICONS.tree} Center the tree here</button>
      </div>`, true);
  }
  function treeFichaSVG(p) {
    return `<svg class="gp-fr" viewBox="0 0 100 116" width="88" height="102">${frameDefs()}${treeFrame(0, 0, 100, 116, p.sex, portraitImg(p, false))}</svg>`;
  }

  // ---------- archive record ----------
  function archiveModal(id) {
    const a = archiveById(id); if (!a) return;
    openModal(`
      ${modalHead(esc(a.title), `<span class="chip">${esc(a.docType)}</span> ${esc(a.date)} · ${esc(a.place)}`)}
      ${a.source ? `<div class="nav-group-label" style="padding-left:0">${ICONS.link} Source</div><p class="gp-source">${esc(a.source)}</p>` : ''}
      ${a.description ? `<div class="nav-group-label" style="padding-left:0">Visual description</div><p class="muted small">${esc(a.description)}</p>` : ''}
      <div class="nav-group-label" style="padding-left:0">Detected text</div>
      <div class="quote-block" style="font-style:normal;white-space:pre-wrap">${esc(a.text)}</div>
      <div class="nav-group-label" style="padding-left:0">Metadata</div>
      ${Object.entries(a.metadata).map(([k, v]) => `<div class="gp-meta"><span class="gp-meta-k">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
      <div class="nav-group-label" style="padding-left:0">People (${a.persons.length})</div>
      <div class="tag-row">${a.persons.map((pid) => `<span class="chip link" onclick="GUI.person('${pid}')">${esc(nameOf(pid))}</span>`).join('')}</div>
    `, true);
  }

  // ---------- views ----------
  const viewHead = (icon, title, sub, right) => `<div class="view-head"><div><h1 class="view-title">${ICONS[icon]} ${title}</h1>${sub ? `<p class="view-sub">${sub}</p>` : ''}</div>${right || ''}</div>`;

  const VIEWS = {
    home() {
      const links = G.relationships.length, places = 4, evc = G.events.length, docs = G.archive.length, sug = G.suggestions.length;
      const card = (icon, title, big, unit, body, btn, extra) => `<div class="card"><div class="list-title" style="justify-content:space-between"><b class="gp-cardt">${ICONS[icon]} ${title}</b><button class="btn ghost small" onclick="${btn[1]}">${btn[0]}</button></div><div class="stat" style="margin-top:8px">${big} <span class="muted" style="font-size:13px;font-weight:400">${unit}</span></div>${extra || ''}<p class="muted small" style="margin-top:8px">${body}</p></div>`;
      return `
        <h1 class="view-title" style="font-size:22px">Home</h1>
        <p class="view-sub">Your family history: people, tree, timeline and evidence archive.</p>
        <div class="card gp-next" style="margin-bottom:16px">
          <div class="list-title" style="justify-content:space-between;align-items:flex-start">
            <div><div class="nav-group-label" style="padding:0">Recommended next step</div><b style="font-size:16px">Review ${sug} suggested relationship(s)</b></div>
            <div class="tag-row"><button class="btn" onclick="GUI.chat()">Assistant</button><button class="btn" onclick="window.go('tree')">${ICONS.tree} View tree</button><button class="btn primary" onclick="GUI.suggestions()">${ICONS.tree} Review relationships</button></div>
          </div>
          <p class="muted small" style="margin-top:8px">The AI has proposed kinship links from the evidence in your sources. Confirm or dismiss them: nothing enters the tree without your approval.</p>
        </div>
        <div class="grid cols-3">
          ${card('people', 'People', G.persons.length, 'people', 'Each person gathers their kinship, events, documents and the evidence behind them.', ['Open', "window.go('people')"], `<div class="gp-mini"><span><b>${links}</b> links</span><span><b>${places}</b> places</span></div>`)}
          ${card('tree', 'Family tree', links, 'kinship links', 'Import or export GEDCOM to move between Gramps or Ancestry.', ['View tree', "window.go('tree')"], `<div class="tag-row" style="margin-top:6px"><span class="chip">${G.persons.length} people</span><span class="chip gp-amber">${sug} suggested relationships</span></div>`)}
          ${card('bulb', 'Suggested relationships', sug, 'to review', 'The AI proposes links from the evidence; you confirm or dismiss. Nothing is added on its own.', ['Review', 'GUI.suggestions()'])}
          ${card('clock', 'Timeline', evc, 'events', 'Every dated event in the family, in order and on the map.', ['Open', "window.go('timeline')"], `<div class="gp-mini"><span><b>${places}</b> places</span><span><b>${G.persons.length}</b> people</span></div>`)}
          ${card('archive', 'Archive', docs, 'documents', 'Your primary sources (records, censuses, letters, photos) linked to people.', ['Open', "window.go('archive')"], `<div class="progress" style="margin-top:8px"><div style="width:0%"></div></div><div class="tag-row" style="margin-top:6px"><span class="chip">1 folder</span></div>`)}
          ${card('alert', 'AI configuration', 'pending', 'extraction model', 'The AI extracts people and events from your documents, suggests relationships, writes biographies and generates portraits. Configure the models in Settings.', ['Settings', "window.go('settings')"])}
        </div>`;
    },

    people() {
      const sorted = G.persons.slice().sort((a, b) => a.name.localeCompare(b.name));
      const cur = state.person ? personById(state.person) : null;
      return `<div class="gp-people">
        <div class="gp-people-list">
          <div class="view-head" style="padding:0 0 10px"><h1 class="view-title" style="font-size:20px">${ICONS.people} People <span class="muted" style="font-size:13px;font-weight:400">${G.persons.length}</span></h1></div>
          <input class="search-input" style="padding:9px 12px" placeholder="Search by name or variant…" oninput="GUI.peopleFilter(this.value)"/>
          <button class="btn primary" style="width:100%;justify-content:center;margin-top:8px" onclick="GUI.toast('In the app: add a new person to the tree.')">${ICONS.plus} Add person</button>
          <div class="nav-group-label" style="padding-left:0;margin-top:8px">GEDCOM</div>
          <div class="tag-row"><button class="btn ghost" style="flex:1;border:1px solid var(--border-soft)" onclick="GUI.toast('In the app: import a GEDCOM from Gramps or Ancestry.')">${ICONS.upload} Import</button><button class="btn ghost" style="flex:1;border:1px solid var(--border-soft)" onclick="GUI.toast('In the app: export your tree as GEDCOM.')">${ICONS.download} Export</button></div>
          <button class="btn ghost" style="width:100%;border:1px solid var(--border-soft);margin-top:8px" onclick="GUI.toast('In the app: review identity matches (name variants).')">${ICONS.people} Review matches</button>
          <button class="btn ghost" style="width:100%;border:1px solid var(--border-soft);margin-top:8px;justify-content:space-between" onclick="GUI.suggestions()">${ICONS.tree} Suggested relationships <span class="chip gp-amber">${G.suggestions.length}</span></button>
          <div class="gp-plist" id="gp-plist">
            ${sorted.map((p) => `<div class="gp-prow ${state.person === p.id ? 'active' : ''}" data-name="${esc(p.name.toLowerCase())}" onclick="GUI.selectPerson('${p.id}')"><b>${esc(p.name)}</b><span class="muted small">${esc(datesOf(p))}</span></div>`).join('')}
          </div>
        </div>
        <div class="gp-people-detail">${cur ? personDetail(cur) : `<div class="gp-empty">Select a person to see their record, their events and the evidence behind them.</div>`}</div>
      </div>`;
    },

    tree() {
      return `<div class="gp-tree-head">
          <h1 class="view-title" style="font-size:18px;margin:0">${ICONS.tree} Family tree</h1>
          <select class="select" style="max-width:16rem" onchange="GUI.focusTree(this.value)">
            ${G.persons.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}" ${p.id === state.focus ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
            <button class="btn ghost" style="padding:6px 9px" onclick="GUI.zoom(-1)">${ICONS.minus}</button>
            <span class="muted small" style="width:44px;text-align:center">${Math.round(state.zoom * 100)}%</span>
            <button class="btn ghost" style="padding:6px 9px" onclick="GUI.zoom(1)">${ICONS.plus}</button>
          </div>
        </div>
        <div class="gp-tree-canvas">${treeSVG()}</div>
        <p class="muted small" style="padding:8px 16px 0">Click a person to open their ficha; double-click to center the tree on them.</p>`;
    },

    timeline() {
      const evs = sortedEvents();
      return `${viewHead('clock', 'Timeline', '', `<span class="muted small">${evs.length} events</span>`)}
        <div class="tag-row" style="margin-bottom:14px"><span class="select gp-fakeselect">All people ▾</span><span class="select gp-fakeselect">All types ▾</span></div>
        <div class="gp-timeline">
          ${evs.map((e) => `<div class="gp-tl-item" ${e.source ? `onclick="GUI.archive('${e.source}')"` : ''}>
            <span class="gp-tl-dot"></span>
            <div class="gp-tl-year">${esc(e.date)}</div>
            <div style="flex:1;min-width:0">
              <div class="list-title"><b>${EVENT_LABEL[e.type] || e.type}</b> <span class="muted small">· ${esc((placeById(e.placeId) || {}).name || '')}</span></div>
              <div class="list-desc" style="margin:3px 0 0">${esc(e.persons.map(nameOf).join(', '))}</div>
            </div>
          </div>`).join('')}
        </div>`;
    },

    archive() {
      return `<div class="gp-archive">
        <div class="gp-arch-folders">
          <div class="view-head" style="padding:0 0 8px"><h1 class="view-title" style="font-size:16px">${ICONS.archive} Archive</h1></div>
          <div class="gp-folder ${state.archiveFolder === 'all' ? 'active' : ''}" onclick="GUI.setFolder('all')">${ICONS.layers} All</div>
          <div class="gp-folder ${state.archiveFolder === 'serrano' ? 'active' : ''}" onclick="GUI.setFolder('serrano')">${ICONS.folder} ${esc(G.archiveFolder)}</div>
          <div class="gp-folder" onclick="GUI.toast('No folder')">${ICONS.folder} No folder</div>
        </div>
        <div class="gp-arch-main">
          <div class="toolbar" style="margin-bottom:8px"><input class="search-input" placeholder="Search titles, text and metadata…"/><span class="select gp-fakeselect">Document type ▾</span><button class="btn primary" onclick="GUI.toast('In the app: add a scan, PDF, CSV or photo to the archive.')">${ICONS.upload} Add file</button></div>
          <p class="muted small" style="margin:0 0 8px">The Archive holds primary sources (documents, records, photographs). Academic bibliography (books, articles, theses) is managed in the Library by importing from Zotero.</p>
          <div class="tag-row" style="margin-bottom:10px">${['Document type', 'Format', 'Tags', 'People', 'Year'].map((f) => `<span class="pill">${f} ▾</span>`).join('')}</div>
          <p class="muted small">${G.archive.length} documents</p>
          <table class="tbl gp-arch-tbl"><thead><tr><th>Name</th><th>Type</th><th>People</th><th>Detected text</th></tr></thead><tbody>
            ${G.archive.map((a) => `<tr class="rowlink" onclick="GUI.archive('${a.id}')">
              <td><div style="display:flex;gap:8px;align-items:center"><span class="gp-doc-i">${a.kind === 'csv' || a.kind === 'xlsx' ? ICONS.grid : a.kind === 'image' ? ICONS.file : a.kind === 'text' ? ICONS.notebook : ICONS.book}</span><b>${esc(a.title)}</b></div></td>
              <td><span class="chip gp-amber">${esc(a.docType)}</span></td>
              <td><div class="tag-row">${a.persons.slice(0, 3).map((pid) => `<span class="chip">${esc(nameOf(pid))}</span>`).join('')}${a.persons.length > 3 ? `<span class="chip">+${a.persons.length - 3}</span>` : ''}</div></td>
              <td><span class="muted small" style="display:block;max-width:20rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.text.replace(/\n/g, ' '))}</span></td>
            </tr>`).join('')}
          </tbody></table>
        </div>
      </div>`;
    },

    map() {
      return `${viewHead('map', 'Map', '', `<span class="muted small">${G.personPlaces.length} locations</span>`)}
        <div class="tag-row" style="margin-bottom:12px"><span class="select gp-fakeselect">${ICONS.people} All people ▾</span><span class="select gp-fakeselect">${ICONS.play}</span><span class="muted small" style="align-self:center">Play the migrations over time</span></div>
        <div id="gp-map" class="gp-leaflet"></div>`;
    },

    relations() {
      const persons = new Set(G.social.flatMap((r) => [r.from, r.to].filter((x) => personById(x))));
      return `${viewHead('network', 'Social relations', '', `<span class="muted small">${persons.size} people · ${G.contacts.length} contacts · ${G.social.length} relations</span>`)}
        <div class="tag-row" style="margin-bottom:8px"><input class="search-input" style="max-width:16rem" placeholder="Search the network…"/><button class="btn ghost" style="border:1px solid var(--border-soft)" onclick="GUI.relayout()">${ICONS.refresh} Re-arrange</button>
          <span class="muted small" style="align-self:center;margin-left:auto"><span class="gp-leg" style="background:#818cf8"></span>family member <span class="gp-leg" style="background:#fbbf24;margin-left:10px"></span>contact</span></div>
        <div class="gp-relwrap"><canvas id="gp-relcanvas"></canvas></div>`;
    },

    deepResearch() {
      const r = G.deepResearch;
      return `<div class="report">
        <button class="back-btn" onclick="window.go('home')">${ICONS.x} Close reader</button>
        <div class="report-title"><h2>${esc(r.title)}</h2><p class="muted small">${esc(r.meta)}</p></div>
        <div class="report-body">${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.paras.map((p) => `<p>${esc(p.text)}</p>${p.cites && p.cites.length ? `<div class="cite-row">${p.cites.map((c) => `<span class="cite" onclick="GUI.archive('${c[1]}')">${esc(c[0])}</span>`).join('')}</div>` : ''}`).join('')}`).join('')}</div>
        <div class="page-nav"><span class="muted small">${ICONS.report} Generated over the archive</span><button class="btn ghost" onclick="GUI.toast('In the app: export to Word / PDF or generate an audio edition.')">${ICONS.external} Export</button></div>
      </div>`;
    },

    notes() {
      const cur = G.notes.find((n) => n.id === state.note) || G.notes[0];
      const folders = [...new Set(G.notes.map((n) => n.folder))];
      return `${viewHead('notebook', 'Notes', 'Your own working notes, with links back to the people and records they mention.')}
        <div class="notes-grid">
          <div>${folders.map((f) => `<div class="nav-group-label" style="padding-left:6px">${esc(f)}</div>${G.notes.filter((n) => n.folder === f).map((n) => `<div class="note-item ${n.id === cur.id ? 'active' : ''}" onclick="GUI.note('${n.id}')">${ICONS.notebook}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title)}</span></div>`).join('')}`).join('')}</div>
          <div class="card"><div class="list-title" style="margin-bottom:8px"><b style="font-size:15px">${esc(cur.title)}</b> <span class="muted small">· ${esc(cur.updated)}</span></div>
            <div class="note-body">${cur.body.split(/(\[[^\]]+\])/).map((seg) => /^\[/.test(seg) ? `<span class="note-link">${ICONS.link}${esc(seg.replace(/^\[|\]$/g, ''))}</span>` : esc(seg)).join('')}</div></div>
        </div>`;
    },

    search() {
      return `${viewHead('search', 'Search', 'One box over the whole vault — people, events and the full text of every transcribed source.')}
        <input class="search-input" id="gp-search" placeholder="Try “Vidal”, “baptism”, “Sevilla”, “gripe”…" autocomplete="off"/>
        <div id="gp-search-results" style="margin-top:16px"></div>`;
    },

    library() {
      return `${viewHead('book', 'Library', 'Secondary literature — synced from Zotero, the same as an academic vault. Primary sources live in the Archive.')}
        <p class="muted small">This genealogy vault has no secondary bibliography yet. In the app, connect Zotero to bring in the historiography that frames the reconstruction.</p>`;
    },

    settings() {
      return `${viewHead('settings', 'Settings', 'Providers, models, Zotero, integrations, backups — everything local-first.')}
        <div class="settings-grid">
          <div class="set-tabs">${SET_TABS.map(([id, label, ic]) => `<button class="set-tab${state.settingsTab === id ? ' active' : ''}" onclick="GUI.setTab('${id}')">${ICONS[ic]} ${label}</button>`).join('')}</div>
          <div id="set-panel">${(SET_PANELS[state.settingsTab] || SET_PANELS.providers)()}</div>
        </div>`;
    },
  };

  function personDetail(p) {
    const evs = eventsForPerson(p.id).slice().sort((a, b) => a.year - b.year);
    return `<div style="padding:6px 24px 24px">
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div class="gp-ficha-portrait">${treeFichaSVG(p)}</div>
        <div><h2 style="font-size:20px;margin:0">${esc(p.name)}</h2><p class="muted small" style="margin:2px 0 6px">${p.sex === 'female' ? 'Female' : 'Male'} · ${esc(datesOf(p))}</p><span class="chip">${esc(p.occupation || '—')}</span></div>
        <button class="btn ghost" style="margin-left:auto;border:1px solid var(--border-soft)" onclick="GUI.person('${p.id}')">${ICONS.external} Full record</button>
      </div>
      <div class="nav-group-label" style="padding-left:0;margin-top:14px">Life events (${evs.length})</div>
      ${evs.map((e) => `<div class="gp-event" ${e.source ? `onclick="GUI.archive('${e.source}')"` : ''}><span class="gp-event-dot" style="background:${EVC[e.type]}"></span><div style="flex:1;min-width:0"><div class="list-title"><b>${EVENT_LABEL[e.type] || e.type}</b> <span class="muted small">· ${esc(e.date)} · ${esc((placeById(e.placeId) || {}).name || '')}</span></div></div>${e.source ? `<span class="gp-src">${ICONS.archive}</span>` : ''}</div>`).join('') || '<p class="muted small">No events recorded.</p>'}
    </div>`;
  }

  function suggestionsModal() {
    openModal(`${modalHead('Suggested relationships', 'Proposed from the evidence — nothing enters the tree without your approval')}
      ${G.suggestions.map((k) => `<div class="gp-kin">
        <div class="list-title"><b>${esc(k.question)}</b> <span class="gp-strength ${k.strength}">${k.strength} signal</span></div>
        <div style="margin-top:8px">${k.evidence.map((e) => `<div class="gp-fact">${ICONS.bulb}<span>${esc(e)}</span></div>`).join('')}</div>
        <div class="tag-row" style="margin-top:10px"><button class="btn primary small" onclick="GUI.toast('In the app: adds the link to the tree, citing this evidence.')">${ICONS.check} Confirm</button><button class="btn ghost small" onclick="GUI.toast('In the app: dismisses the suggestion.')">Dismiss</button></div>
      </div>`).join('')}`, true);
  }

  // ---------- Leaflet map ----------
  function initMap() {
    const el = $('#gp-map'); if (!el || !window.L) { if (el) el.innerHTML = '<div class="gp-empty">Map tiles load in the browser.</div>'; return; }
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([37.45, -5.55], 10);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' }).addTo(map);
    // migration paths (Carmona → Sevilla, Carmona → Écija)
    const P = (id) => { const pl = placeById(id); return [pl.lat, pl.lng]; };
    L.polyline([P('carmona'), P('sevilla')], { color: '#818cf8', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(map);
    L.polyline([P('carmona'), P('ecija')], { color: '#f472b6', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(map);
    // markers: distinct persons per place
    const counts = {};
    G.personPlaces.forEach((pp) => { const id = pp.placeId === 'parr' ? 'carmona' : pp.placeId; (counts[id] = counts[id] || new Set()).add(pp.personId); });
    [['carmona'], ['sevilla'], ['ecija']].forEach(([id]) => {
      const pl = placeById(id); const n = (counts[id] || new Set()).size;
      const icon = L.divIcon({ className: 'gp-pin-wrap', html: `<div class="gp-pin2"></div><div class="gp-pin-lab"><b>${esc(pl.name)}</b> ${n} people</div>`, iconSize: [0, 0] });
      L.marker([pl.lat, pl.lng], { icon }).addTo(map).on('click', () => GUI.placeToast(id));
    });
    setTimeout(() => map.invalidateSize(), 200);
  }

  // ---------- relations node graph (canvas force sim) ----------
  let relAnim = 0;
  function initRelations() {
    cancelAnimationFrame(relAnim);
    const cv = $('#gp-relcanvas'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const wrap = cv.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    const W = () => cv.width / dpr, H = () => cv.height / dpr;
    const ids = [...new Set(G.social.flatMap((r) => [r.from, r.to]))];
    const nodes = ids.map((id) => ({ id, person: !!personById(id), name: nameOf(id), x: W() / 2 + (Math.random() - 0.5) * 220, y: H() / 2 + (Math.random() - 0.5) * 220, vx: 0, vy: 0 }));
    const nById = new Map(nodes.map((n) => [n.id, n]));
    const links = G.social.map((r) => ({ a: nById.get(r.from), b: nById.get(r.to), role: r.role }));
    let ticks = 0;
    function step() {
      ticks++;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d = Math.hypot(dx, dy) || 1;
        const f = 5200 / (d * d); a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      links.forEach((l) => { let dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1; const f = (d - 150) * 0.02; l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f; l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f; });
      nodes.forEach((n) => { n.vx += (W() / 2 - n.x) * 0.004; n.vy += (H() / 2 - n.y) * 0.004; n.vx *= 0.86; n.vy *= 0.86; n.x += n.vx; n.y += n.vy; n.x = Math.max(70, Math.min(W() - 70, n.x)); n.y = Math.max(40, Math.min(H() - 40, n.y)); });
    }
    function draw() {
      ctx.clearRect(0, 0, W(), H());
      links.forEach((l) => {
        ctx.strokeStyle = '#6b6b73'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
        const mx = (l.a.x + l.b.x) / 2, my = (l.a.y + l.b.y) / 2, ang = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
        ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang);
        ctx.fillStyle = '#c4c4cc'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(l.role, 0, -4); ctx.restore();
      });
      nodes.forEach((n) => {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.person ? 7 : 5, 0, 6.29); ctx.fillStyle = n.person ? '#818cf8' : '#fbbf24'; ctx.fill();
        const tx = n.x + (n.person ? 7 : 5) + 5, ty = n.y; ctx.font = '600 12px Inter, sans-serif';
        const tw = ctx.measureText(n.name).width;
        ctx.fillStyle = 'rgba(24,24,27,0.94)'; roundRect(ctx, tx, ty - 10, tw + 12, 20, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; roundRect(ctx, tx, ty - 10, tw + 12, 20, 5); ctx.stroke();
        ctx.fillStyle = '#f4f4f5'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(n.name, tx + 6, ty); ctx.textBaseline = 'alphabetic';
      });
    }
    function loop() { if (ticks < 320) step(); draw(); relAnim = requestAnimationFrame(loop); }
    loop();
    cv.onclick = (e) => { const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const hit = nodes.find((n) => Math.hypot(n.x - mx, n.y - my) < 12); if (hit && personById(hit.id)) GUI.person(hit.id); };
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // ---------- search ----------
  function runSearch(q) {
    const box = $('#gp-search-results'); if (!box) return;
    const s = q.trim().toLowerCase();
    if (!s) { box.innerHTML = `<p class="muted small">Type to search people, events and every transcribed record.</p>`; return; }
    const ppl = G.persons.filter((p) => (p.name + ' ' + (p.occupation || '')).toLowerCase().includes(s));
    const recs = G.archive.filter((a) => (a.title + ' ' + a.text + ' ' + Object.values(a.metadata).join(' ')).toLowerCase().includes(s));
    const sec = (label, items) => items.length ? `<div class="nav-group-label" style="padding-left:0">${label} (${items.length})</div>${items.join('')}` : '';
    box.innerHTML = [
      sec('People', ppl.map((p) => `<div class="list-row" onclick="GUI.person('${p.id}')"><span class="gp-doc-i">${ICONS.people}</span><div class="list-main"><div class="list-title"><b>${esc(p.name)}</b> <span class="muted small">${esc(datesOf(p))}</span></div></div></div>`)),
      sec('Records', recs.map((a) => `<div class="list-row" onclick="GUI.archive('${a.id}')"><span class="gp-doc-i">${ICONS.archive}</span><div class="list-main"><div class="list-title"><b>${esc(a.title)}</b> <span class="chip gp-amber">${esc(a.docType)}</span></div><div class="list-desc">${esc(a.text.slice(0, 120))}…</div></div></div>`)),
    ].join('') || `<p class="muted small">No matches for “${esc(q)}”.</p>`;
  }

  // ---------- assistant ----------
  const chat = { open: false, messages: [], i: 0 };
  const CANNED = [
    { text: 'Following the genealogical proof standard, I never add a link without a document. The Casimiro↔Dolores marriage is a strong suggestion from the 1890 marriage record and Encarnación’s diary — but it stays a proposal until you confirm it.' },
    { text: 'Vicente Serrano died in Sevilla in 1918, aged 22 — the civil register names the 1918 influenza epidemic. His sister Amparo’s 1925 letter still mourns him.' },
    { text: 'The family is rooted in Carmona; Rafael is the one who moves to Sevilla around 1912 and starts the city line. The Reyes branch runs east to Écija through Dolores.' },
  ];
  function renderChat() {
    const root = $('#chat-root');
    if (!chat.open) { root.innerHTML = ''; return; }
    root.innerHTML = `<div class="modal-overlay" id="chat-ov"><div class="modal chat-modal">
      <div class="chat-head"><div style="flex:1"><h3>${ICONS.wand} Assistant · Genealogist</h3><p>Grounded on this vault. Proposes kinship from evidence — never invents a source.</p></div><button class="modal-x" onclick="GUI.chatClose()">${ICONS.x}</button></div>
      <div class="chat-msgs" id="gp-chat-msgs">${chat.messages.length ? chat.messages.map((m) => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('') : `<div class="msg hint">Ask about a person, a record, or a suggestion. Try “Is Casimiro a Serrano in-law?”</div>`}</div>
      <div class="chat-input"><input id="gp-chat-inp" placeholder="Ask the genealogist…" autocomplete="off"/><button class="btn primary" onclick="GUI.chatSend()">Send</button></div>
    </div></div>`;
    $('#chat-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'chat-ov') GUI.chatClose(); });
    const inp = $('#gp-chat-inp'); if (inp) { inp.focus(); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') GUI.chatSend(); }); }
    const m = $('#gp-chat-msgs'); if (m) m.scrollTop = m.scrollHeight;
  }

  // ---------- router ----------
  window.go = function (view) {
    cancelAnimationFrame(relAnim);
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const el = main();
    const full = view === 'people' || view === 'archive' || view === 'tree';
    el.innerHTML = `<div class="fade-in gp-viewroot ${full ? 'gp-full' : 'gp-scroll'}">${(VIEWS[view] || VIEWS.home)()}</div>`;
    el.scrollTop = 0;
    if (view === 'map') initMap();
    if (view === 'relations') initRelations();
    if (view === 'search') { runSearch(''); const b = $('#gp-search'); if (b) { b.addEventListener('input', () => runSearch(b.value)); b.focus(); } }
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
  };

  window.GUI = {
    toast, close: closeModal,
    person: personModal, archive: archiveModal, suggestions: suggestionsModal,
    focusTree(id) { state.focus = id; state.zoom = 1; if (state.view !== 'tree') window.go('tree'); else window.go('tree'); },
    zoom(dir) { state.zoom = Math.max(0.4, Math.min(2, state.zoom + dir * 0.15)); window.go('tree'); },
    selectPerson(id) { state.person = id; window.go('people'); },
    peopleFilter(q) { const s = q.trim().toLowerCase(); document.querySelectorAll('#gp-plist .gp-prow').forEach((r) => { r.style.display = !s || r.dataset.name.includes(s) ? '' : 'none'; }); },
    setFolder(f) { state.archiveFolder = f; window.go('archive'); },
    note(id) { state.note = id; window.go('notes'); },
    setTab(id) { state.settingsTab = id; window.go('settings'); },
    sw(key, el) { state.toggles[key] = !state.toggles[key]; el.classList.toggle('on', state.toggles[key]); el.setAttribute('aria-checked', String(state.toggles[key])); },
    relayout() { initRelations(); },
    placeToast(id) { const pl = placeById(id); toast(`${pl.name} — ${pl.region}`); },
    chat() { chat.open = true; renderChat(); },
    chatClose() { chat.open = false; renderChat(); },
    chatSend() { const inp = $('#gp-chat-inp'); const v = inp && inp.value.trim(); if (!v) return; chat.messages.push({ who: 'user', text: v }); inp.value = ''; renderChat(); setTimeout(() => { chat.messages.push({ who: 'ai', text: CANNED[chat.i++ % CANNED.length].text }); renderChat(); }, 650); },
  };

  // ---------- boot ----------
  const nav = $('#nav');
  nav.innerHTML = NAV.map((n) => n.group !== undefined ? `<div class="nav-group-label">${n.group}</div>` : `<button class="nav-item" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) window.go(b.dataset.view); });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if ($('#modal-root').innerHTML) closeModal(); else if (chat.open) GUI.chatClose(); });
  const initial = (location.hash || '#home').slice(1);
  window.go(VIEWS[initial] ? initial : 'home');
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) window.go(v); });
})();
