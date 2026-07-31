/* Interactive Worldbuilding demo. Data is generated from the desktop app's seeded vault. */
(function () {
  'use strict';

  var W = window.WORLD;
  var navRoot = document.getElementById('nav');
  var mainRoot = document.getElementById('main');
  var modalRoot = document.getElementById('modal-root');
  var state = {
    view: 'home',
    mapId: W.maps[1] ? W.maps[1].mapId : W.maps[0].mapId,
    noteId: W.notes.notes[0] && W.notes.notes[0].id,
    sceneId: W.scenes[1] ? W.scenes[1].sceneId : W.scenes[0].sceneId,
    entryFacet: 'all',
    familyFocus: 'demo-world-char-aurel',
    familyZoom: 1,
    settingsTab: 'providers',
    toggles: {
      continuity: true,
      spoilers: true,
      imageGeneration: true,
      animations: true,
      mcp: true,
      word: true,
      autoBackup: true,
      prerelease: false,
    },
  };

  var ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/>',
    book: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    network: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 11 10-5M7 13l10 5"/>',
    languages: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1"/><path d="m14 20 4-9 4 9M15.5 17h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tree: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M5 17v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>',
    shield: '<path d="M12 3 4 6v5c0 5.1 3.4 8.7 8 10 4.6-1.3 8-4.9 8-10V6Z"/><path d="m9 12 2 2 4-4"/>',
    chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-4A7 7 0 0 1 3 14V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    scale: '<path d="m12 3-7 4h14ZM12 3v18M5 7l-3 7h6ZM19 7l-3 7h6ZM7 21h10"/>',
    route: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 19c7 0 3-12 10-12"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
    notebook: '<path d="M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M8 3v18M11 8h5M11 12h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 7 3.5 3.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    alert: '<path d="M12 3 2.5 20h19Z"/><path d="M12 9v4M12 17h.01"/>',
    sparkles: '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><circle cx="7.5" cy="9" r=".8"/><circle cx="10" cy="6.5" r=".8"/><circle cx="15" cy="6.5" r=".8"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
    wand: '<path d="m15 4 5 5L8 21l-5-5Z"/><path d="M14 2v3M21 9h3M19 3l2-2"/>',
    link: '<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    trash: '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    sync: '<path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6"/>',
    word: '<path d="M6 2h8l5 5v15H6Z"/><path d="M14 2v5h5M8 12l1.5 6L11 13l1.5 5 1.5-6"/>',
    minus: '<path d="M5 12h14"/>',
    up: '<path d="m12 19 0-14M6 11l6-6 6 6"/>',
  };

  var NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Explore' },
    { id: 'encyclopedia', label: 'Encyclopedia', icon: 'book' },
    { id: 'characters', label: 'Characters', icon: 'users' },
    { id: 'places', label: 'Places', icon: 'map' },
    { id: 'factions', label: 'Factions', icon: 'network' },
    { id: 'cultures', label: 'Cultures', icon: 'languages' },
    { id: 'timeline', label: 'Timeline', icon: 'clock' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'relations', label: 'Relations', icon: 'network' },
    { id: 'tree', label: 'Families', icon: 'tree' },
    { id: 'dynasties', label: 'Dynasties', icon: 'shield' },
    { group: 'Analyze' },
    { id: 'worldChat', label: 'World chat', icon: 'chat' },
    { id: 'rules', label: 'World rules', icon: 'lock' },
    { id: 'conflicts', label: 'Conflicts', icon: 'scale' },
    { id: 'arcs', label: 'Narrative arcs', icon: 'route' },
    { id: 'continuity', label: 'Continuity', icon: 'check' },
    { id: 'questions', label: 'Open questions', icon: 'help' },
    { group: 'Create' },
    { id: 'notes', label: 'Notes', icon: 'notebook' },
    { id: 'scenes', label: 'Scenes', icon: 'image' },
    { id: 'manuscript', label: 'Manuscript', icon: 'edit' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  var ART_BY_ID = {
    'demo-world-group-council': 'lore-council.webp',
    'demo-world-group-firstlight': 'lore-lighthouse.webp',
    'demo-world-group-guard': 'lore-gate.webp',
    'demo-world-group-sails': 'lore-sails.webp',
    'demo-world-group-tideborn': 'place-nacre.webp',
    'demo-world-group-tidecant': 'lore-letter.webp',
    'demo-world-group-vellum': 'lore-archive.webp',
    'demo-world-group-venn': 'dynasty-venn.webp',
    'demo-world-group-sarn': 'dynasty-sarn.webp',
    'demo-world-group-mir': 'dynasty-mir.webp',
    'demo-world-group-veyari': 'lore-tide-culture.webp',
    'demo-world-scene-prologue': 'lore-lighthouse.webp',
    'demo-world-scene-arrival': 'lore-letter.webp',
    'demo-world-scene-archive': 'lore-archive.webp',
    'demo-world-scene-gate': 'lore-gate.webp',
    'demo-world-scene-island': 'lore-tide-culture.webp',
    'demo-world-scene-observatory': 'lore-third-moon.webp',
    'demo-world-scene-coup': 'lore-coup.webp',
    'demo-world-scene-heart': 'lore-shared-map.webp',
    'demo-world-scene-epilogue': 'lore-epilogue.webp',
    'demo-world-article-flux': 'lore-heart.webp',
    'demo-world-article-firstlight': 'lore-lighthouse.webp',
    'demo-world-article-tidecant': 'lore-tide-culture.webp',
    'demo-world-article-whale': 'lore-black-tide.webp',
    'demo-world-article-veyari': 'lore-tide-culture.webp',
    'demo-world-article-compass': 'lore-compass.webp',
    'demo-world-article-looms': 'lore-weavers.webp',
    'demo-world-article-debt': 'lore-heart.webp',
    'demo-world-article-sinking': 'lore-black-tide.webp',
    'demo-world-article-keepers': 'lore-lighthouse.webp',
    'demo-world-article-orchid': 'lore-orchid.webp',
    'demo-world-article-fox': 'lore-tide-culture.webp',
    'demo-world-article-feast': 'lore-sails.webp',
    'demo-world-article-thirdmoon': 'lore-third-moon.webp',
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.book) + '</svg>';
  }
  function asset(fileName) { return 'assets/worldbuilding/' + fileName; }
  function tail(id, marker) { return id.slice(id.indexOf(marker) + marker.length); }
  function imageFor(kind, id, gallery) {
    if (kind === 'character') return asset('character-' + tail(id, 'char-') + (gallery ? '-gallery' : '') + '.webp');
    if (kind === 'place') return asset('place-' + tail(id, 'place-') + '.webp');
    if (kind === 'map') return asset('map-' + tail(id, 'map-') + '.webp');
    return asset(ART_BY_ID[id] || 'lore-shared-map.webp');
  }
  function byId(items, key, id) { return items.find(function (item) { return item[key] === id; }); }
  function titleHead(title, iconName, sub, action) {
    return '<div class="view-head"><div><h1 class="view-title">' + icon(iconName, 21) + esc(title) + '</h1>' +
      (sub ? '<p class="view-sub">' + esc(sub) + '</p>' : '') + '</div>' + (action || '') + '</div>';
  }
  function badge(text, tone) { return '<span class="wb-badge ' + (tone || '') + '">' + esc(text) + '</span>'; }
  function statusTone(status) {
    return /open|alive|active|canon|written/i.test(status || '') ? 'green'
      : /dead|retired|contradiction|missing/i.test(status || '') ? 'red'
        : /tentative|draft|warning|parked/i.test(status || '') ? 'amber' : 'violet';
  }
  function markdown(text) {
    var lines = String(text || '').split('\n');
    var html = [];
    var list = false;
    lines.forEach(function (raw) {
      var line = esc(raw);
      if (/^# /.test(line)) { if (list) { html.push('</ul>'); list = false; } html.push('<h1>' + line.slice(2) + '</h1>'); }
      else if (/^## /.test(line)) { if (list) { html.push('</ul>'); list = false; } html.push('<h2>' + line.slice(3) + '</h2>'); }
      else if (/^- /.test(line)) { if (!list) { html.push('<ul>'); list = true; } html.push('<li>' + line.slice(2) + '</li>'); }
      else if (/^\d+\. /.test(line)) { if (list) { html.push('</ul>'); list = false; } html.push('<p>' + line + '</p>'); }
      else if (line.trim()) { if (list) { html.push('</ul>'); list = false; } html.push('<p>' + line.replace(/\[\[(.*?)\]\]/g, '<span class="note-link">$1</span>') + '</p>'); }
    });
    if (list) html.push('</ul>');
    return html.join('');
  }
  function manuscriptMarkup(text) {
    return String(text || '').split(/\n{2,}/).filter(Boolean).map(function (paragraph) {
      var prose = esc(paragraph)
        .replace(/\[([^\]]+)\]\(nodus:\/\/[^)]+\)/g, '<span class="note-link">$1</span>')
        .replace(/\n/g, '<br/>');
      return '<p>' + prose + '</p>';
    }).join('');
  }

  function renderNav() {
    navRoot.innerHTML = NAV.map(function (item) {
      if (item.group) return '<div class="nav-group-label">' + esc(item.group) + '</div>';
      return '<button class="nav-item ' + (item.id === 'settings' ? 'wb-nav-settings ' : '') + (state.view === item.id ? 'active' : '') + '" data-view="' + item.id + '">' +
        icon(item.icon) + '<span>' + esc(item.label) + '</span></button>';
    }).join('');
    navRoot.querySelectorAll('[data-view]').forEach(function (button) {
      button.addEventListener('click', function () { WB.go(button.dataset.view); });
    });
  }

  function characterCard(character, compact) {
    var epithet = (character.names || []).find(function (n) { return n.kind === 'epithet'; });
    return '<article class="wb-art-card portrait ' + (compact ? 'compact' : '') + '" data-character="' + esc(character.personId) + '">' +
      '<img src="' + imageFor('character', character.personId) + '" alt="' + esc(character.displayName) + '" loading="lazy"/>' +
      '<div class="wb-art-meta"><b>' + esc(character.displayName) + '</b>' +
      '<span>' + esc(character.profile.lifeStatus === 'unborn' ? 'Not yet born' : character.profile.lifeStatus) + '</span>' +
      badge(epithet ? epithet.name : (character.profile.narrativeRole || 'character'), 'violet') + '</div></article>';
  }

  function renderHome() {
    var protagonist = W.characters.filter(function (c) { return c.profile.narrativeRole === 'protagonist'; }).length;
    var alive = W.characters.filter(function (c) { return c.profile.lifeStatus === 'alive'; }).length;
    return '<section class="wb-hero"><div class="wb-eyebrow">' + icon('globe') + ' Worldbuilding vault</div>' +
      '<h1>Your world</h1><p>Build a fictional world piece by piece: characters, places, factions, cultures, scenes and maps. The encyclopedia gathers them all into one index and links every rule, secret and story thread back to the world you are writing.</p></section>' +
      '<section class="wb-stat-grid">' +
      stat('characters', 'users', W.characters.length, 'Characters') +
      stat('characters', 'route', protagonist, 'Protagonists') +
      stat('characters', 'sparkles', alive, 'Alive') +
      stat('encyclopedia', 'book', W.entries.length, 'In the encyclopedia') +
      '</section><section class="wb-section-card"><div class="wb-section-head"><h2>Recent characters</h2><button class="wb-link" onclick="WB.go(\'characters\')">See all</button></div>' +
      '<div class="wb-character-strip">' + W.characters.slice(0, 6).map(function (c) { return characterCard(c, true); }).join('') + '</div></section>';
  }
  function stat(view, iconName, value, label) {
    return '<button class="wb-stat" onclick="WB.go(\'' + view + '\')"><span class="wb-stat-icon">' + icon(iconName) + '</span><span><b>' + esc(value) + '</b><span>' + esc(label) + '</span></span></button>';
  }

  function renderCharacters() {
    return titleHead('Characters', 'users', '', '<button class="btn primary" onclick="WB.toast(\'The desktop app opens a complete character dossier here.\')">' + icon('plus', 13) + ' New character</button>') +
      '<div class="wb-toolbar"><input id="character-search" class="search-input" placeholder="Search by name, nickname or epithet…"/>' +
      '<select id="character-role" class="wb-filter"><option value="">Narrative role</option><option value="protagonist">Protagonist</option><option value="antagonist">Antagonist</option><option value="secondary">Secondary</option><option value="tertiary">Tertiary</option><option value="cameo">Distinction</option></select>' +
      '<span class="wb-count" id="character-count">' + W.characters.length + '</span></div><div class="wb-card-grid" id="character-grid">' +
      W.characters.map(function (c) { return characterCard(c); }).join('') + '</div>';
  }

  function recordCard(kind, item, summary, meta) {
    var id = item[kind + 'Id'];
    return '<article class="wb-record" data-' + kind + '="' + esc(id) + '"><img src="' + imageFor(kind, id) + '" alt="" loading="lazy"/>' +
      '<div class="wb-record-copy"><div>' + badge(meta, 'violet') + '</div><h3>' + esc(item.name || item.title) + '</h3><p>' + esc(summary || '') + '</p></div></article>';
  }
  function renderPlaces() {
    return titleHead('Places', 'map', 'A nested atlas, from a world and continent down to districts and buildings.', '<button class="btn primary" onclick="WB.toast(\'Create and nest places in the desktop app.\')">' + icon('plus', 13) + ' New place</button>') +
      '<div class="wb-toolbar"><input id="place-search" class="search-input" placeholder="Search the atlas…"/><span class="wb-count">' + W.places.length + ' places</span></div>' +
      '<div class="wb-collection-row" id="place-grid">' + W.places.map(function (p) { return recordCard('place', p, p.profile.appearance, p.kind); }).join('') + '</div>';
  }
  function groupView(kinds, title, subtitle, iconName) {
    var items = W.groups.filter(function (g) { return kinds.indexOf(g.kind) >= 0; });
    return titleHead(title, iconName, subtitle, '<button class="btn primary" onclick="WB.toast(\'Create and connect groups in the desktop app.\')">' + icon('plus', 13) + ' New</button>') +
      '<div class="wb-toolbar"><input id="group-search" class="search-input" placeholder="Search ' + esc(title.toLowerCase()) + '…"/><span class="wb-count">' + items.length + '</span></div>' +
      '<div class="wb-collection-row" id="group-grid">' + items.map(function (g) { return recordCard('group', g, g.summary, g.kind); }).join('') + '</div>';
  }

  function renderEncyclopedia() {
    var counts = {};
    W.entries.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    var facets = ['all', 'article', 'character', 'place', 'group', 'rule', 'scene'];
    return titleHead('Encyclopedia', 'book', 'Everything in The Ashen Tides, projected into one linked index.', '<button class="btn primary" onclick="WB.toast(\'The desktop editor supports [[double-bracket]] links and backlinks.\')">' + icon('plus', 13) + ' New article</button>') +
      '<div class="wb-toolbar"><input id="entry-search" class="search-input" placeholder="Search titles, aliases and summaries…"/></div>' +
      '<div class="wb-index"><aside class="wb-index-aside"><div class="card"><h3>Entry type</h3>' +
      facets.map(function (f) { return '<button class="wb-facet ' + (state.entryFacet === f ? 'active' : '') + '" data-entry-facet="' + f + '"><span>' + esc(f === 'all' ? 'All entries' : f[0].toUpperCase() + f.slice(1) + 's') + '</span><b>' + (f === 'all' ? W.entries.length : (counts[f] || 0)) + '</b></button>'; }).join('') +
      '</div></aside><section class="wb-index-list" id="entry-list">' + entryRows(W.entries) + '</section></div>';
  }
  function entryRows(entries) {
    return entries.map(function (e) {
      return '<article class="wb-entry" data-entry="' + esc(e.kind + ':' + e.id) + '"><b>' + esc(e.title) + '</b><span>' + badge(e.kind, 'violet') + '</span><p>' + esc(e.summary || e.category || 'Linked world entry') + '</p></article>';
    }).join('');
  }

  function renderTimeline() {
    var rows = [];
    W.worldEvents.forEach(function (e) { rows.push({ day: e.worldDay || 0, date: e.date, title: e.label, place: e.placeName, type: e.type, people: e.participants.map(function (p) { return p.displayName; }).join(', ') }); });
    W.scenes.filter(function (s) { return s.worldDay != null; }).forEach(function (s) { rows.push({ day: s.worldDay, date: s.worldYear + ' A.L.', title: s.title, place: s.placeName, type: 'scene', people: (W.sceneDetails[s.sceneId].cast || []).map(function (p) { return p.displayName; }).join(', ') }); });
    rows.sort(function (a, b) { return a.day - b.day; });
    return titleHead('Timeline', 'clock', 'Events and scenes share the same in-world calendar: the Calendar of Tides.') +
      '<div class="pills"><button class="pill active">Everything</button><button class="pill">Events</button><button class="pill">Scenes</button><button class="pill">742 A.L.</button></div>' +
      '<div class="wb-timeline">' + rows.map(function (r) {
        return '<article class="wb-time-row"><div class="wb-time-date">' + esc(r.date) + '</div><div></div><div class="wb-time-card"><div>' + badge(r.type, statusTone(r.type)) + '</div><b>' + esc(r.title) + '</b><span>' + esc([r.place, r.people].filter(Boolean).join(' · ')) + '</span></div></article>';
      }).join('') + '</div>';
  }

  function renderMap() {
    var map = byId(W.maps, 'mapId', state.mapId) || W.maps[0];
    var details = W.mapDetails[map.mapId] || { markers: [], layers: [] };
    var visibleMarkers = details.markers.filter(function (m) { return m.geometryKind !== 'path' && m.x != null && m.y != null; });
    return titleHead('Map', 'map', 'Layered local maps with calibrated distance, editable markers and nested detail maps.', '<button class="btn primary" onclick="WB.toast(\'Import, generate or extend a map in the desktop app.\')">' + icon('plus', 13) + ' New map</button>') +
      '<div class="wb-map-layout"><aside class="wb-map-list">' + W.maps.map(function (m) {
        return '<button class="wb-map-item ' + (m.mapId === map.mapId ? 'active' : '') + '" data-map-id="' + esc(m.mapId) + '"><b>' + esc(m.name) + '</b><span>' + esc(m.kind + ' · ' + (m.placeName || 'unbound')) + '</span></button>';
      }).join('') + '</aside><section class="wb-map-canvas"><img src="' + imageFor('map', map.mapId) + '" alt="' + esc(map.name) + ' map"/>' +
      visibleMarkers.map(function (m) {
        var label = m.label || m.placeName || m.icon;
        return '<span class="wb-map-pin" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%;background:' + esc(m.color || '#8b5cf6') + '"></span><span class="wb-map-label" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%">' + esc(label) + '</span>';
      }).join('') + '</section><aside class="wb-map-side"><h3>' + esc(map.name) + '</h3><p class="muted small">' + esc(map.notes || '') + '</p><h3>Visible layers</h3>' +
      details.layers.map(function (l) { return '<div class="wb-layer"><i style="background:' + esc(l.color) + '"></i><span>' + esc(l.name) + '</span></div>'; }).join('') +
      '<h3 style="margin-top:14px">Scale</h3><div class="wb-layer">' + esc(map.scaleDistance || '—') + ' ' + esc(map.scaleUnit || '') + ' · ' + esc(map.projection) + '</div></aside></div>';
  }

  function graphView() {
    var nodes = W.socialGraph.nodes;
    var positions = [
      [18, 23], [42, 18], [68, 22], [84, 42], [72, 68], [45, 76], [19, 70], [35, 48], [60, 48],
    ];
    var pos = {};
    nodes.forEach(function (n, i) { pos[n.id] = positions[i % positions.length]; });
    var lines = W.socialGraph.edges.map(function (e) {
      var a = pos[e.fromId]; var b = pos[e.toId];
      return a && b ? '<line x1="' + a[0] + '%" y1="' + a[1] + '%" x2="' + b[0] + '%" y2="' + b[1] + '%" stroke="#6d5a7e" stroke-width="1.3"/><text x="' + ((a[0] + b[0]) / 2) + '%" y="' + ((a[1] + b[1]) / 2) + '%" fill="#777" font-size="9">' + esc(e.role) + '</text>' : '';
    }).join('');
    var htmlNodes = nodes.map(function (n, i) {
      var p = positions[i % positions.length]; var character = byId(W.characters, 'personId', n.id);
      var image = character ? imageFor('character', n.id) : asset('lore-letter.webp');
      return '<button class="wb-node ' + (n.kind === 'contact' ? 'contact' : '') + '" style="left:' + p[0] + '%;top:' + p[1] + '%" ' + (character ? 'data-character="' + esc(n.id) + '"' : 'onclick="WB.toast(\'' + esc(n.displayName) + ' is a social contact in the demo world.\')"') + '><img src="' + image + '" alt=""/><span>' + esc(n.displayName) + '</span></button>';
    }).join('');
    return '<div class="wb-graph"><svg>' + lines + '</svg>' + htmlNodes + '<div class="wb-graph-legend"><span>● Character</span><span style="color:#f59e0b">● Contact</span><span>— role-labelled relation</span></div></div>';
  }
  function renderRelations() {
    return titleHead('Relations', 'network', 'A social network independent from kinship: friends, rivals, mentors, creditors and contacts.') +
      '<div class="pills"><button class="pill active">All relations</button><button class="pill">Positive</button><button class="pill">Mixed</button><button class="pill">Negative</button></div>' + graphView();
  }

  function familyLayout(focusId) {
    var parents = W.relationships.filter(function (rel) { return rel.type === 'parent'; });
    var spouses = W.relationships.filter(function (rel) { return rel.type === 'spouse'; });
    var parentsOf = {}; var childrenOf = {}; var spousesOf = {};
    parents.forEach(function (rel) {
      (childrenOf[rel.fromPerson] || (childrenOf[rel.fromPerson] = [])).push(rel.toPerson);
      (parentsOf[rel.toPerson] || (parentsOf[rel.toPerson] = [])).push(rel.fromPerson);
    });
    spouses.forEach(function (rel) {
      (spousesOf[rel.fromPerson] || (spousesOf[rel.fromPerson] = [])).push(rel.toPerson);
      (spousesOf[rel.toPerson] || (spousesOf[rel.toPerson] = [])).push(rel.fromPerson);
    });

    var generation = {}; generation[focusId] = 0;
    var queue = [focusId];
    while (queue.length) {
      var id = queue.shift(); var gen = generation[id];
      (parentsOf[id] || []).forEach(function (parentId) {
        if (generation[parentId] == null) { generation[parentId] = gen - 1; queue.push(parentId); }
      });
      (childrenOf[id] || []).forEach(function (childId) {
        if (generation[childId] == null) { generation[childId] = gen + 1; queue.push(childId); }
      });
      (spousesOf[id] || []).forEach(function (spouseId) {
        if (generation[spouseId] == null) { generation[spouseId] = gen; queue.push(spouseId); }
      });
    }

    var rows = {};
    Object.keys(generation).forEach(function (id) {
      (rows[generation[id]] || (rows[generation[id]] = [])).push(id);
    });
    var rowKeys = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    rowKeys.forEach(function (key) {
      var ids = rows[key]; var seen = {}; var ordered = [];
      ids.forEach(function (id) {
        if (seen[id]) return;
        var spouseId = (spousesOf[id] || []).find(function (candidate) {
          return ids.indexOf(candidate) >= 0 && !seen[candidate];
        });
        if (!spouseId) { ordered.push(id); seen[id] = true; return; }
        var person = byId(W.characters, 'personId', id);
        var spouse = byId(W.characters, 'personId', spouseId);
        var pair = person && spouse && person.profile.pronouns === 'she' && spouse.profile.pronouns === 'he'
          ? [spouseId, id] : [id, spouseId];
        pair.forEach(function (memberId) { ordered.push(memberId); seen[memberId] = true; });
      });
      rows[key] = ordered;
    });

    var nodeWidth = 150; var nodeHeight = 205; var hGap = 46; var vGap = 76;
    var maxCount = Math.max.apply(null, rowKeys.map(function (key) { return rows[key].length; }));
    var innerWidth = Math.max(720, maxCount * nodeWidth + Math.max(0, maxCount - 1) * hGap);
    var nodes = []; var firstGen = rowKeys[0];
    rowKeys.forEach(function (key) {
      var ids = rows[key];
      var rowWidth = ids.length * nodeWidth + Math.max(0, ids.length - 1) * hGap;
      var startX = (innerWidth - rowWidth) / 2;
      ids.forEach(function (id, index) {
        nodes.push({ id: id, generation: key, x: startX + index * (nodeWidth + hGap), y: (key - firstGen) * (nodeHeight + vGap) });
      });
    });
    return {
      nodes: nodes,
      parents: parents.filter(function (rel) { return generation[rel.fromPerson] != null && generation[rel.toPerson] != null; }),
      spouses: spouses.filter(function (rel) { return generation[rel.fromPerson] != null && generation[rel.toPerson] != null; }),
      width: innerWidth,
      height: rowKeys.length * nodeHeight + Math.max(0, rowKeys.length - 1) * vGap,
    };
  }

  function familyRelation(focusId, personId) {
    if (personId === focusId) return 'Focus person';
    var direct = W.relationships.find(function (rel) {
      return rel.type === 'parent' && rel.fromPerson === focusId && rel.toPerson === personId;
    });
    if (direct) return direct.subtype === 'adoptive' ? 'Adopted child' : 'Child';
    direct = W.relationships.find(function (rel) {
      return rel.type === 'parent' && rel.fromPerson === personId && rel.toPerson === focusId;
    });
    if (direct) return direct.subtype === 'adoptive' ? 'Adoptive parent' : 'Parent';
    if (W.relationships.some(function (rel) {
      return rel.type === 'spouse' && (
        (rel.fromPerson === focusId && rel.toPerson === personId)
        || (rel.fromPerson === personId && rel.toPerson === focusId)
      );
    })) return 'Partner';
    var focusParents = W.relationships.filter(function (rel) { return rel.type === 'parent' && rel.toPerson === focusId; }).map(function (rel) { return rel.fromPerson; });
    var personParents = W.relationships.filter(function (rel) { return rel.type === 'parent' && rel.toPerson === personId; }).map(function (rel) { return rel.fromPerson; });
    if (focusParents.some(function (id) { return personParents.indexOf(id) >= 0; })) return 'Sibling';
    var childIds = W.relationships.filter(function (rel) { return rel.type === 'parent' && rel.fromPerson === focusId; }).map(function (rel) { return rel.toPerson; });
    if (W.relationships.some(function (rel) {
      return rel.type === 'spouse' && childIds.some(function (childId) {
        return (rel.fromPerson === childId && rel.toPerson === personId) || (rel.toPerson === childId && rel.fromPerson === personId);
      });
    })) return 'Child-in-law';
    if (W.relationships.some(function (rel) { return rel.type === 'parent' && childIds.indexOf(rel.fromPerson) >= 0 && rel.toPerson === personId; })) return 'Grandchild';
    return 'Family';
  }

  function familyTreeSvg() {
    var layout = familyLayout(state.familyFocus);
    var positions = {};
    layout.nodes.forEach(function (node) { positions[node.id] = node; });
    var pad = 54; var frameW = 112; var frameH = 132; var nodeW = 150; var scale = state.familyZoom;
    var edges = layout.parents.map(function (rel) {
      var from = positions[rel.fromPerson]; var to = positions[rel.toPerson];
      var x1 = from.x + pad + nodeW / 2; var y1 = from.y + pad + frameH;
      var x2 = to.x + pad + nodeW / 2; var y2 = to.y + pad;
      var mid = (y1 + y2) / 2;
      return '<path class="wb-family-edge ' + (rel.subtype === 'adoptive' ? 'adoptive' : '') + '" d="M' + x1 + ' ' + y1 + ' V' + mid + ' H' + x2 + ' V' + y2 + '"/>';
    }).join('');
    edges += layout.spouses.map(function (rel) {
      var from = positions[rel.fromPerson]; var to = positions[rel.toPerson];
      return '<line class="wb-family-edge spouse" x1="' + (from.x + pad + nodeW / 2) + '" y1="' + (from.y + pad + frameH / 2) + '" x2="' + (to.x + pad + nodeW / 2) + '" y2="' + (to.y + pad + frameH / 2) + '"/>';
    }).join('');

    var nodes = layout.nodes.map(function (node) {
      var character = byId(W.characters, 'personId', node.id); if (!character) return '';
      var x = node.x + pad; var y = node.y + pad; var frameX = x + (nodeW - frameW) / 2;
      var isFocus = node.id === state.familyFocus;
      var date = character.birthDate || 'Date unknown';
      if (character.deathDate) date += ' – ' + character.deathDate;
      if (date.length > 30) date = date.slice(0, 29) + '…';
      var relation = familyRelation(state.familyFocus, node.id);
      return '<g class="wb-family-node" data-family-name="' + esc(character.displayName.toLowerCase()) + '" onclick="WB.familyNodeClick(\'' + esc(node.id) + '\', event)">' +
        (isFocus ? '<rect class="wb-family-focus" x="' + (frameX - 6) + '" y="' + (y - 6) + '" width="' + (frameW + 12) + '" height="' + (frameH + 12) + '" rx="16"/>' : '') +
        '<rect class="wb-family-frame" x="' + frameX + '" y="' + y + '" width="' + frameW + '" height="' + frameH + '" rx="9"/>' +
        '<image href="' + imageFor('character', node.id) + '" x="' + (frameX + 12) + '" y="' + (y + 12) + '" width="' + (frameW - 24) + '" height="' + (frameH - 24) + '" preserveAspectRatio="xMidYMin slice"/>' +
        '<rect class="wb-family-frame-inner" x="' + (frameX + 10) + '" y="' + (y + 10) + '" width="' + (frameW - 20) + '" height="' + (frameH - 20) + '" rx="4"/>' +
        '<text class="wb-family-name" x="' + (x + nodeW / 2) + '" y="' + (y + frameH + 23) + '" text-anchor="middle">' + esc(character.displayName) + '</text>' +
        '<text class="wb-family-role" x="' + (x + nodeW / 2) + '" y="' + (y + frameH + 43) + '" text-anchor="middle">' + esc(relation) + '</text>' +
        '<text class="wb-family-date" x="' + (x + nodeW / 2) + '" y="' + (y + frameH + 62) + '" text-anchor="middle">' + esc(date) + '</text></g>';
    }).join('');
    var width = layout.width + pad * 2; var height = layout.height + pad * 2;
    return '<svg class="wb-family-svg" width="' + (width * scale) + '" height="' + (height * scale) + '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<defs><linearGradient id="wb-family-frame-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d49a4f"/><stop offset="44%" stop-color="#9c642d"/><stop offset="68%" stop-color="#c4863e"/><stop offset="100%" stop-color="#70411f"/></linearGradient><linearGradient id="wb-family-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#e11d48"/></linearGradient></defs>' +
      edges + nodes + '</svg>';
  }

  function renderTree() {
    var relatedIds = {};
    W.relationships.forEach(function (rel) { relatedIds[rel.fromPerson] = true; relatedIds[rel.toPerson] = true; });
    var people = W.characters.filter(function (character) { return relatedIds[character.personId]; }).slice().sort(function (a, b) { return a.displayName.localeCompare(b.displayName); });
    return '<div class="wb-family-view"><div class="wb-family-toolbar"><h1 class="view-title">' + icon('tree', 20) + ' Family tree</h1>' +
      '<select class="select" aria-label="Focus person" onchange="WB.familyFocus(this.value)">' + people.map(function (character) {
        return '<option value="' + esc(character.personId) + '" ' + (character.personId === state.familyFocus ? 'selected' : '') + '>' + esc(character.displayName) + '</option>';
      }).join('') + '</select>' +
      '<label class="wb-family-search">' + icon('search', 15) + '<input id="family-search" placeholder="Search the tree…" aria-label="Search the tree"/></label>' +
      '<button class="btn wb-family-direction">' + icon('up', 14) + ' Ancestors above</button>' +
      '<div class="wb-family-zoom"><button class="btn ghost" aria-label="Zoom out" onclick="WB.familyZoom(-1)">' + icon('minus', 14) + '</button><span>' + Math.round(state.familyZoom * 100) + '%</span><button class="btn ghost" aria-label="Zoom in" onclick="WB.familyZoom(1)">' + icon('plus', 14) + '</button></div></div>' +
      '<div class="wb-family-legend"><span><i class="parent"></i>Parents and children</span><span><i class="spouse"></i>Spouses/partners</span><span><i class="adoptive"></i>Adoptive kinship</span><b>' + Object.keys(relatedIds).length + ' people · ' + W.relationships.length + ' links</b></div>' +
      '<div class="wb-family-canvas">' + familyTreeSvg() + '</div><p class="muted small wb-family-hint">Click a portrait to open the character sheet; double-click to center the tree on that person.</p></div>';
  }

  function renderConflicts() {
    var conflicts = W.threads.filter(function (t) { return t.kind === 'conflict'; });
    var columns = ['open', 'resolved', 'archived'];
    return titleHead('Conflicts', 'scale', 'Track who wants what, who opposes them and which scenes raise, turn or resolve the pressure.', '<button class="btn primary" onclick="WB.toast(\'Create a conflict in the desktop app.\')">' + icon('plus', 13) + ' New conflict</button>') +
      '<div class="wb-board">' + columns.map(function (status) {
        var items = conflicts.filter(function (t) { return t.status === status; });
        return '<section class="wb-board-col"><div class="wb-board-title"><span>' + esc(status.toUpperCase()) + '</span><b>' + items.length + '</b></div>' +
          items.map(function (t) {
            var beats = W.beats.filter(function (b) { return b.threadId === t.threadId; });
            return '<article class="wb-thread" data-thread="' + esc(t.threadId) + '"><h3>' + esc(t.title) + '</h3><p>' + esc(t.pitch) + '</p><div class="wb-party-row">' +
              t.parties.map(function (p) { return '<span class="wb-party">' + esc(p.side + ' · ' + p.partyName) + '</span>'; }).join('') +
              '</div><div class="wb-beat-row">' + beats.map(function (b) { return '<span class="wb-beat">' + esc(b.mark + ' · ' + b.sceneTitle) + '</span>'; }).join('') + '</div></article>';
          }).join('') + '</section>';
      }).join('') + '</div>';
  }

  function renderArcs() {
    var arcs = W.threads.filter(function (t) { return t.kind === 'arc'; });
    return titleHead('Narrative arcs', 'route', 'Character change mapped against the same nine-scene manuscript strip.') +
      '<div class="wb-arcs"><div class="wb-arc-head"><div>Arc</div>' + W.scenes.map(function (s) { return '<div>' + esc((s.narrativeOrder + 1) + ' · ' + s.title.replace(/^.*?·\s*/, '')) + '</div>'; }).join('') + '</div>' +
      arcs.map(function (arc) {
        var beats = W.beats.filter(function (b) { return b.threadId === arc.threadId; });
        return '<div class="wb-arc-row"><div class="wb-arc-name"><b>' + esc(arc.title) + '</b><span>' + esc(arc.pitch) + '</span></div>' +
          W.scenes.map(function (scene) {
            var beat = beats.find(function (b) { return b.sceneId === scene.sceneId; });
            return '<div class="wb-arc-cell">' + (beat ? '<div class="wb-arc-beat"><b>' + esc(beat.mark) + '</b><br/>' + esc(beat.text || beat.sceneTitle) + '</div>' : '') + '</div>';
          }).join('') + '</div>';
      }).join('') + '</div>';
  }

  var FINDING_TRANSLATIONS = {
    '{person} deja {group} antes de entrar': '{person} leaves {group} before joining it',
    'Participa en un hecho el año {year}, después de morir el año {death}.': 'Appears in an event in {year}, after dying in {death}.',
    '{person} actúa en «{source}» después de morir': '{person} acts in “{source}” after dying',
    '{person} está a la vez en {a} y en {b}': '{person} is in {a} and {b} at the same time',
    '{person} sabe «{secret}» antes que quien lo guardaba': '{person} knows “{secret}” before its keeper',
    '{person} va de {from} a {to} en menos tiempo del que se tarda': '{person} travels from {from} to {to} faster than the journey allows',
    'Tiene fecha de muerte pero su estado sigue siendo «vivo».': 'Has a death date but is still marked alive.',
    '{person} pone a prueba «{rule}», que no le alcanzaba': '{person} tests “{rule}” before it applied to them',
    '«{rule}» se rompe y no se paga': '“{rule}” is broken without paying its cost',
    '{person} es antagonista y no se opone a nada': '{person} is an antagonist but opposes nothing',
    '{count} escenas no tienen día del mundo': '{count} scenes have no world date',
    '{person} sale en el texto de «{scene}» y no en su reparto': '{person} appears in “{scene}” prose but not in its cast',
    '«{rule}» no aparece en ninguna parte': '“{rule}” appears nowhere in the story',
  };
  function findingHeadline(f) {
    var text = FINDING_TRANSLATIONS[f.headline.key] || f.headline.key;
    Object.keys(f.headline.vars || {}).forEach(function (key) { text = text.replace('{' + key + '}', f.headline.vars[key]); });
    return text;
  }
  function renderContinuity() {
    var contradictions = W.continuity.filter(function (f) { return f.severity === 'contradiction'; }).length;
    return titleHead('Continuity', 'check', 'The same deterministic checks shown on character, scene and rule sheets, collected in one place.', '<button class="btn" onclick="WB.toast(\'The desktop app reruns every check against the current world.\')">' + icon('check', 13) + ' Check again</button>') +
      '<div class="wb-stat-grid">' + stat('continuity', 'alert', contradictions, 'Contradictions') + stat('continuity', 'help', W.continuity.length - contradictions, 'Warnings & notes') + stat('characters', 'users', W.continuitySummary.facts, 'Facts checked') + stat('scenes', 'image', W.continuitySummary.checks, 'Checks active') + '</div>' +
      '<div class="pills"><button class="pill active">All findings</button><button class="pill">Contradictions</button><button class="pill">Travel</button><button class="pill">Rules</button><button class="pill">Cast</button></div>' +
      W.continuity.map(function (f) {
        return '<article class="wb-finding"><span class="wb-severity ' + esc(f.severity) + '">' + icon(f.severity === 'contradiction' ? 'alert' : 'help', 14) + '</span><div><h3>' + esc(findingHeadline(f)) + '</h3><p>' + esc(f.family + ' · ' + f.checkId) + '</p></div>' + badge(f.severity, statusTone(f.severity)) + '</article>';
      }).join('');
  }

  function renderQuestions() {
    return titleHead('Open questions', 'help', 'Decisions, holes and competing answers stay anchored to the exact scene, character or article they affect.', '<button class="btn primary" onclick="WB.toast(\'Add an authored question in the desktop app.\')">' + icon('plus', 13) + ' New question</button>') +
      '<div class="pills"><button class="pill active">Needs a decision</button><button class="pill">Blocking</button><button class="pill">Parked</button><button class="pill">Answered</button></div>' +
      W.questionFeed.map(function (q) {
        return '<article class="wb-question" data-question="' + esc(q.questionId) + '"><div class="wb-question-meta">' + badge(q.status, statusTone(q.status)) + (q.blocking ? badge('blocking', 'red') : '') + '<span class="muted small">' + esc(q.anchor.kind + ' · ' + q.anchor.title) + '</span></div><h3>' + esc(q.question) + '</h3>' +
          (q.evidence ? '<p class="muted small">' + esc(q.evidence) + '</p>' : '') +
          (q.options || []).map(function (o) { return '<div class="wb-option"><b>' + esc(o.text) + '</b><span>' + esc(o.implications || '') + '</span></div>'; }).join('') + '</article>';
      }).join('');
  }

  function renderRules() {
    var groups = ['physical', 'costly', 'social'];
    return titleHead('World rules', 'lock', 'Canon, tentative and retired laws with explicit costs, limits, scope and story use.', '<button class="btn primary" onclick="WB.toast(\'Add a rule without letting AI overwrite canon.\')">' + icon('plus', 13) + ' New rule</button>') +
      '<div class="wb-board">' + groups.map(function (hardness) {
        var items = W.rules.filter(function (r) { return r.hardness === hardness; });
        return '<section class="wb-board-col"><div class="wb-board-title"><span>' + esc(hardness.toUpperCase()) + '</span><b>' + items.length + '</b></div>' +
          items.map(function (r) { return '<article class="wb-thread" data-rule="' + esc(r.ruleId) + '"><div>' + badge(r.status, statusTone(r.status)) + '</div><h3>' + esc(r.title) + '</h3><p>' + esc(r.statement) + '</p>' + (r.cost ? '<div class="wb-option"><b>Cost</b><span>' + esc(r.cost) + '</span></div>' : '') + '</article>'; }).join('') + '</section>';
      }).join('') + '</div>';
  }

  function renderChat() {
    var scope = ['Characters', 'Places', 'Scenes', 'World rules', 'Conflicts', 'Encyclopedia'];
    return titleHead('World chat', 'chat', 'Ask across the connected world. Answers in the desktop app are anchored to the selected canon, never invented silently.') +
      '<div class="wb-chat"><aside class="wb-chat-side"><button class="btn primary" style="width:100%;justify-content:center">' + icon('plus', 12) + ' New conversation</button><h3>Conversations</h3><div class="wb-chat-conv">Explore The Ashen Tides</div></aside>' +
      '<section class="wb-chat-main"><div class="wb-chat-scroll"><div class="wb-chat-welcome"><div class="big-icon">' + icon('sparkles', 26) + '</div><h2>Ask your world</h2><p>Trace a rule through the manuscript, compare what two characters know or find where a continuity problem enters the story.</p><div class="wb-chat-prompts">' +
      ['What does Ilyra know about Asteriel?', 'Which scenes test the cost of Flux?', 'Where can the Black Tide escalate?', 'Compare Maelor and Tarek’s stakes.'].map(function (p) { return '<button onclick="WB.toast(\'Connect an AI model in the desktop app to ask: ' + esc(p) + '\')">' + esc(p) + '</button>'; }).join('') +
      '</div></div></div><div class="wb-chat-input"><input disabled value="Configure an AI model to ask the world…"/><button class="btn primary" disabled>Send</button></div></section>' +
      '<aside class="wb-chat-side right"><h3>World context</h3>' + scope.map(function (s) { return '<label class="wb-scope"><input type="checkbox" checked/> ' + esc(s) + '</label>'; }).join('') + '</aside></div>';
  }

  function renderNotes() {
    var note = byId(W.notes.notes, 'id', state.noteId) || W.notes.notes[0];
    var roots = W.notes.folders.filter(function (f) { return f.parentId == null; });
    var list = roots.map(function (root) {
      var children = W.notes.folders.filter(function (f) { return f.parentId === root.id; });
      var html = '<div class="wb-note-folder">' + esc(root.name) + '</div>';
      html += W.notes.notes.filter(function (n) { return n.folderId === root.id; }).map(noteButton).join('');
      children.forEach(function (child) {
        html += '<div class="wb-note-folder" style="padding-left:8px">' + esc(child.name) + '</div>';
        html += W.notes.notes.filter(function (n) { return n.folderId === child.id; }).map(noteButton).join('');
      });
      return html;
    }).join('');
    return titleHead('Notes', 'notebook', 'Development notes live beside the world and can link back into its encyclopedia.') +
      '<div class="wb-notes"><aside class="wb-note-list"><button class="btn primary" style="width:100%;justify-content:center" onclick="WB.toast(\'Create a note in the desktop app.\')">' + icon('plus', 12) + ' New note</button>' + list + '</aside>' +
      '<article class="wb-note-editor"><div class="muted small">Autosaved · Markdown</div>' + markdown(note.content) + '</article></div>';
  }
  function noteButton(n) {
    return '<button class="wb-note-button ' + (n.id === state.noteId ? 'active' : '') + '" data-note-id="' + esc(n.id) + '">' + icon('notebook', 12) + ' ' + esc(n.title) + '</button>';
  }

  function renderScenes() {
    return titleHead('Scenes', 'image', 'The narrative sequence: cast, place, day, rules, questions, images and manuscript prose stay attached.', '<button class="btn primary" onclick="WB.toast(\'Add a scene in the desktop app.\')">' + icon('plus', 13) + ' New scene</button>') +
      '<div class="pills"><button class="pill active">Narrative order</button><button class="pill">Chronological</button><button class="pill">Written</button><button class="pill">Draft</button></div><div class="wb-scenes">' +
      W.scenes.map(function (s) {
        return '<article class="wb-scene-card" data-scene="' + esc(s.sceneId) + '"><img src="' + imageFor('scene', s.sceneId) + '" alt="" loading="lazy"/><div class="wb-scene-copy"><span class="wb-scene-num">Scene ' + (s.narrativeOrder + 1) + ' · ' + esc(s.status) + '</span><h3>' + esc(s.title) + '</h3><p>' + esc(s.summary) + '</p><div>' + badge(s.placeName || 'Undated', 'violet') + ' ' + badge(s.worldYear ? s.worldYear + ' A.L.' : 'Open date', statusTone(s.status)) + '</div></div></article>';
      }).join('') + '</div>';
  }

  function spineButtons() {
    return W.manuscriptSpine.books.map(function (book) {
      return '<div class="wb-book">' + esc(book.title) + '</div>' + book.chapters.map(function (chapter) {
        return '<div class="wb-chapter">' + esc(chapter.title) + '</div>' + chapter.scenes.map(function (s) {
          return '<button class="wb-ms-scene ' + (s.sceneId === state.sceneId ? 'active' : '') + '" data-ms-scene="' + esc(s.sceneId) + '">' + esc(s.title) + '<span class="muted"> · ' + s.wordCount + '</span></button>';
        }).join('');
      }).join('');
    }).join('');
  }
  function renderManuscript() {
    var scene = byId(W.scenes, 'sceneId', state.sceneId) || W.scenes[0];
    var text = W.sceneDetails[scene.sceneId].text;
    return titleHead('Manuscript', 'edit', 'Two books, six chapter breaks and nine scenes—written against the same world model.', '<button class="btn" onclick="WB.toast(\'The desktop app exports DOCX, Markdown and a clean manuscript package.\')">Export</button>') +
      '<div class="wb-manuscript"><aside class="wb-spine">' + spineButtons() + '</aside><article class="wb-paper"><h1>' + esc(scene.title) + '</h1><div class="ms-meta">' + esc(scene.placeName || 'No place') + ' · ' + esc(scene.status) + ' · ' + esc((text && text.wordCount) || 0) + ' words</div>' + manuscriptMarkup(text && text.text) + '</article>' +
      '<aside class="wb-ms-stats"><div class="wb-ms-stat"><b>' + W.manuscriptProgress.words + '</b><span>Total words</span></div><div class="wb-ms-stat"><b>' + W.manuscriptSpine.books.length + '</b><span>Books</span></div><div class="wb-ms-stat"><b>' + W.scenes.length + '</b><span>Scenes</span></div><div class="wb-ms-stat"><b>' + W.continuity.length + '</b><span>Continuity notes</span></div></aside></div>';
  }

  var SETTINGS_TABS = [
    ['providers', 'Providers', 'key'],
    ['models', 'AI models', 'wand'],
    ['worldbuilding', 'Worldbuilding', 'globe'],
    ['interface', 'Interface', 'palette'],
    ['integrations', 'Integrations', 'link'],
    ['system', 'System', 'settings'],
    ['data', 'Data', 'download'],
  ];
  var SETTINGS_PROVIDERS = [
    ['Anthropic', 'Claude models · cloud', 'sk-ant-············7Kq2', true],
    ['OpenAI', 'GPT and image models · cloud', '', false],
    ['Google', 'Gemini models · cloud', '', false],
    ['OpenRouter', 'Multi-provider gateway · cloud', '', false],
    ['Ollama', 'Local models · fully offline', 'http://127.0.0.1:11434', true],
    ['LM Studio', 'Local models · fully offline', 'http://127.0.0.1:1234', false],
  ];
  var SETTINGS_MODELS = [
    ['World chat & lore answers', 'claude-sonnet-5'],
    ['Continuity explanations', 'claude-sonnet-5'],
    ['Character & place drafting', 'qwen3:8b · Ollama'],
    ['Image generation', 'gpt-image-1.5'],
    ['Embeddings', 'nomic-embed-text · Ollama'],
  ];
  function settingToggle(key) {
    return '<button class="switch ' + (state.toggles[key] ? 'on' : '') + '" role="switch" aria-checked="' + String(Boolean(state.toggles[key])) + '" onclick="WB.toggleSetting(\'' + esc(key) + '\')"></button>';
  }
  function settingRow(title, desc, control) {
    return '<div class="set-row"><div class="lbl"><b>' + esc(title) + '</b>' + (desc ? '<span>' + esc(desc) + '</span>' : '') + '</div>' + control + '</div>';
  }
  function settingsPanel() {
    if (state.settingsTab === 'providers') {
      return '<div class="card"><h3>' + icon('key', 16) + ' AI providers</h3><p class="muted small" style="margin:2px 0 10px">Bring your own key, or run fully offline with a local model. Keys are stored encrypted in your system keychain.</p>' +
        SETTINGS_PROVIDERS.map(function (provider) {
          var local = provider[1].indexOf('offline') >= 0;
          return '<div class="set-row"><div class="set-prov"><span class="prov-badge" style="background:' + (local ? 'rgba(52,211,153,.15)' : 'rgba(124,58,237,.18)') + ';color:' + (local ? '#6ee7b7' : '#c4b5fd') + '">' + esc(provider[0][0]) + '</span><div class="lbl"><b>' + esc(provider[0]) + '</b><span>' + esc(provider[1]) + (provider[2] ? ' · <span class="keymask">' + esc(provider[2]) + '</span>' : '') + '</span></div></div>' +
            (provider[3] ? '<span class="chip"><span class="dot" style="background:var(--green)"></span>configured</span>' : '<button class="btn ghost small" onclick="WB.toast(\'In the desktop app, paste and validate the provider key here.\')">Configure</button>') + '</div>';
        }).join('') + '</div>';
    }
    if (state.settingsTab === 'models') {
      return '<div class="card"><h3>' + icon('wand', 16) + ' Model per task</h3><p class="muted small" style="margin:2px 0 8px">Each Worldbuilding task can use a different cloud or local model.</p>' +
        SETTINGS_MODELS.map(function (model) {
          return settingRow(model[0], '', '<select class="select" onchange="WB.toast(\'Model preference saved in the desktop app.\')"><option>' + esc(model[1]) + '</option><option>claude-sonnet-5</option><option>qwen3:8b · Ollama</option><option>gpt-5.2</option></select>');
        }).join('') + '</div>';
    }
    if (state.settingsTab === 'worldbuilding') {
      return '<div class="card"><h3>' + icon('globe', 16) + ' Worldbuilding</h3>' +
        settingRow('Demo corpus', 'The Ashen Tides · 10 characters · 71 encyclopedia entries', '<span class="chip"><span class="dot" style="background:var(--green)"></span>active</span>') +
        settingRow('Continuity checks', 'Run deterministic checks across sheets, scenes and world rules.', settingToggle('continuity')) +
        settingRow('Spoiler warnings', 'Protect secret names, future reveals and private notes.', settingToggle('spoilers')) +
        settingRow('Image generation', 'Allow portraits, maps and lore art to be generated from visual seeds.', settingToggle('imageGeneration')) +
        settingRow('Sidebar sections', '20 Worldbuilding views; Home remains first and Settings remains last.', '<button class="btn ghost small" onclick="WB.toast(\'In the desktop app, drag to reorder or hide Worldbuilding sections.\')">Customize</button>') +
        settingRow('World Bible defaults', 'Canon only · exclude private notes · mark spoilers', '<button class="btn ghost small" onclick="WB.toast(\'World Bible export preferences open in the desktop app.\')">Review</button>') + '</div>';
    }
    if (state.settingsTab === 'interface') {
      return '<div class="card"><h3>' + icon('palette', 16) + ' Interface</h3>' +
        settingRow('Language', 'Interface and generated demo copy.', '<select class="select"><option>English</option><option>Español</option></select>') +
        settingRow('Theme', 'Worldbuilding keeps its violet accent in either theme.', '<select class="select"><option>Dark</option><option>Light</option><option>System</option></select>') +
        settingRow('Family tree frame', 'Portrait frame used in the Families view.', '<select class="select"><option>Classic oak</option><option>Dark walnut</option><option>Gilded</option></select>') +
        settingRow('Animations', 'Transitions, graph motion and map effects.', settingToggle('animations')) + '</div>';
    }
    if (state.settingsTab === 'integrations') {
      return '<div class="card"><h3>' + icon('link', 16) + ' MCP server</h3><p class="muted small" style="margin:2px 0 8px">Query this vault from Codex, Claude or another MCP client—locally.</p>' +
        settingRow('Enable MCP server', 'Read and writing tools · local stdio transport', settingToggle('mcp')) +
        settingRow('Connection', '', '<span class="keymask">npx nodus-mcp --vault "The Ashen Tides"</span>') + '</div>' +
        '<div class="card"><h3>' + icon('word', 16) + ' Writing copilot <span class="chip">beta</span></h3>' +
        settingRow('Local HTTPS bridge', 'Port 4320 · auto-renewing local certificate', settingToggle('word')) +
        settingRow('Install add-in', 'Match manuscript paragraphs against your world while you write.', '<button class="btn ghost small" onclick="WB.toast(\'The desktop app installs the Word add-in.\')">' + icon('download', 13) + ' Install</button>') + '</div>';
    }
    if (state.settingsTab === 'system') {
      return '<div class="card"><h3>' + icon('settings', 16) + ' System</h3>' +
        settingRow('Version', 'Nodus 3.0.1 · up to date', '<button class="btn ghost small" onclick="WB.toast(\'You are on the latest demo version.\')">' + icon('sync', 13) + ' Check for updates</button>') +
        settingRow('Pre-release channel', 'Receive preview builds before the stable release.', settingToggle('prerelease')) +
        settingRow('Guided tour', 'Replay the Worldbuilding onboarding walkthrough.', '<button class="btn ghost small" onclick="WB.toast(\'The tour starts in the desktop app.\')">Replay tour</button>') + '</div>';
    }
    return '<div class="card"><h3>' + icon('shield', 16) + ' Backups</h3><p class="muted small" style="margin:2px 0 8px">Automatic encrypted backups with daily, weekly and monthly rotation.</p>' +
      settingRow('Automatic backups', 'Daily · keep 7 daily / 4 weekly / 6 monthly', settingToggle('autoBackup')) +
      settingRow('Last backup', 'Today 09:12 · 4.8 MB · encrypted', '<button class="btn ghost small" onclick="WB.toast(\'A new encrypted backup is created in the desktop app.\')">Back up now</button>') +
      settingRow('Sync package', 'Export a merge-ready .nodussync between computers.', '<button class="btn ghost small" onclick="WB.toast(\'Sync package export runs in the desktop app.\')">Export</button>') +
      settingRow('Audit ledger', 'Tamper-evident history of every world change.', '<button class="btn ghost small" onclick="WB.toast(\'The audit ledger opens in the desktop app.\')">View ledger</button>') + '</div>' +
      '<div class="card danger-zone"><h3 style="color:var(--red)">Danger zone</h3>' +
      settingRow('Reset the vault', 'Characters, places and story structures are rebuilt only after confirmation.', '<button class="btn ghost small danger" onclick="WB.toast(\'Nothing is deleted in this web demo.\')">' + icon('trash', 13) + ' Reset</button>') + '</div>';
  }
  function renderSettings() {
    return titleHead('Settings', 'settings', 'Providers, models, Worldbuilding, integrations and backups—the same standard settings used by the other vault demos.') +
      '<div class="settings-grid"><div class="set-tabs">' + SETTINGS_TABS.map(function (tab) {
        return '<button class="set-tab ' + (state.settingsTab === tab[0] ? 'active' : '') + '" onclick="WB.settingsTab(\'' + esc(tab[0]) + '\')">' + icon(tab[2], 14) + esc(tab[1]) + '</button>';
      }).join('') + '</div><div id="set-panel">' + settingsPanel() + '</div></div>';
  }

  function renderDynasties() {
    return groupView(['house'], 'Dynasties', 'Heraldry, seats, claims, membership and dates—kept distinct from biological family.', 'shield');
  }

  var RENDERERS = {
    home: renderHome,
    encyclopedia: renderEncyclopedia,
    characters: renderCharacters,
    places: renderPlaces,
    factions: function () { return groupView(['faction', 'order'], 'Factions', 'Governments, guilds and orders with leaders, members and seats.', 'network'); },
    cultures: function () { return groupView(['culture', 'species', 'language', 'religion'], 'Cultures', 'Peoples, species, languages and religions that shape the world.', 'languages'); },
    timeline: renderTimeline,
    map: renderMap,
    relations: renderRelations,
    tree: renderTree,
    dynasties: renderDynasties,
    worldChat: renderChat,
    rules: renderRules,
    conflicts: renderConflicts,
    arcs: renderArcs,
    continuity: renderContinuity,
    questions: renderQuestions,
    notes: renderNotes,
    scenes: renderScenes,
    manuscript: renderManuscript,
    settings: renderSettings,
  };

  function bindCommon() {
    mainRoot.querySelectorAll('[data-character]').forEach(function (el) { el.addEventListener('click', function () { openCharacter(el.dataset.character); }); });
    mainRoot.querySelectorAll('[data-place]').forEach(function (el) { el.addEventListener('click', function () { openPlace(el.dataset.place); }); });
    mainRoot.querySelectorAll('[data-group]').forEach(function (el) { el.addEventListener('click', function () { openGroup(el.dataset.group); }); });
    mainRoot.querySelectorAll('[data-scene]').forEach(function (el) { el.addEventListener('click', function () { openScene(el.dataset.scene); }); });
    mainRoot.querySelectorAll('[data-rule]').forEach(function (el) { el.addEventListener('click', function () { openRule(el.dataset.rule); }); });
    mainRoot.querySelectorAll('[data-question]').forEach(function (el) { el.addEventListener('click', function () { openQuestion(el.dataset.question); }); });
    mainRoot.querySelectorAll('[data-entry]').forEach(function (el) { el.addEventListener('click', function () { openEntry(el.dataset.entry); }); });
    mainRoot.querySelectorAll('[data-map-id]').forEach(function (el) { el.addEventListener('click', function () { state.mapId = el.dataset.mapId; render(); }); });
    mainRoot.querySelectorAll('[data-note-id]').forEach(function (el) { el.addEventListener('click', function () { state.noteId = el.dataset.noteId; render(); }); });
    mainRoot.querySelectorAll('[data-ms-scene]').forEach(function (el) { el.addEventListener('click', function () { state.sceneId = el.dataset.msScene; render(); }); });
    mainRoot.querySelectorAll('[data-entry-facet]').forEach(function (el) {
      el.addEventListener('click', function () { state.entryFacet = el.dataset.entryFacet; render(); });
    });

    var characterSearch = document.getElementById('character-search');
    var characterRole = document.getElementById('character-role');
    if (characterSearch) {
      var filterCharacters = function () {
        var query = characterSearch.value.toLowerCase();
        var role = characterRole.value;
        var filtered = W.characters.filter(function (c) {
          var names = [c.displayName].concat((c.names || []).map(function (n) { return n.name; })).join(' ').toLowerCase();
          return names.indexOf(query) >= 0 && (!role || c.profile.narrativeRole === role);
        });
        document.getElementById('character-grid').innerHTML = filtered.map(function (c) { return characterCard(c); }).join('');
        document.getElementById('character-count').textContent = filtered.length;
        bindCharacterCards();
      };
      characterSearch.addEventListener('input', filterCharacters);
      characterRole.addEventListener('change', filterCharacters);
    }
    var placeSearch = document.getElementById('place-search');
    if (placeSearch) placeSearch.addEventListener('input', function () {
      var q = placeSearch.value.toLowerCase();
      document.querySelectorAll('[data-place]').forEach(function (card) {
        var place = byId(W.places, 'placeId', card.dataset.place);
        card.hidden = (place.name + ' ' + place.kind + ' ' + place.profile.appearance).toLowerCase().indexOf(q) < 0;
      });
    });
    var groupSearch = document.getElementById('group-search');
    if (groupSearch) groupSearch.addEventListener('input', function () {
      var q = groupSearch.value.toLowerCase();
      document.querySelectorAll('[data-group]').forEach(function (card) {
        var group = byId(W.groups, 'groupId', card.dataset.group);
        card.hidden = (group.name + ' ' + group.kind + ' ' + group.summary).toLowerCase().indexOf(q) < 0;
      });
    });
    var entrySearch = document.getElementById('entry-search');
    if (entrySearch) entrySearch.addEventListener('input', function () {
      var q = entrySearch.value.toLowerCase();
      var list = W.entries.filter(function (e) {
        var facet = state.entryFacet === 'all' || e.kind === state.entryFacet;
        return facet && (e.title + ' ' + e.aliases.join(' ') + ' ' + (e.summary || '')).toLowerCase().indexOf(q) >= 0;
      });
      document.getElementById('entry-list').innerHTML = entryRows(list);
      document.querySelectorAll('[data-entry]').forEach(function (el) { el.addEventListener('click', function () { openEntry(el.dataset.entry); }); });
    });
    var familySearch = document.getElementById('family-search');
    if (familySearch) familySearch.addEventListener('input', function () {
      var query = familySearch.value.trim().toLowerCase();
      mainRoot.querySelectorAll('[data-family-name]').forEach(function (node) {
        node.classList.toggle('search-miss', Boolean(query) && node.dataset.familyName.indexOf(query) < 0);
        node.classList.toggle('search-hit', Boolean(query) && node.dataset.familyName.indexOf(query) >= 0);
      });
    });
  }
  function bindCharacterCards() {
    mainRoot.querySelectorAll('[data-character]').forEach(function (el) { el.addEventListener('click', function () { openCharacter(el.dataset.character); }); });
  }

  function render() {
    renderNav();
    mainRoot.innerHTML = (RENDERERS[state.view] || renderHome)();
    mainRoot.scrollTop = 0;
    bindCommon();
    document.querySelectorAll('[data-wb-icon]').forEach(function (el) { el.innerHTML = icon(el.dataset.wbIcon, 14); });
  }

  function openCharacter(id) {
    var c = byId(W.characters, 'personId', id);
    if (!c) return;
    var detail = W.characterDetails[id] || {};
    var epithet = (c.names || []).find(function (n) { return n.kind === 'epithet'; });
    var tiles = [
      ['Species', c.profile.species], ['Status', c.profile.lifeStatus], ['Role', c.profile.narrativeRole],
      ['Pronouns', c.profile.pronouns], ['Born', c.birthDate], ['Died', c.deathDate],
    ];
    modal('<div class="wb-modal-grid"><div class="wb-modal-art"><img src="' + imageFor('character', id) + '" alt="' + esc(c.displayName) + '"/><div class="wb-modal-gallery"><img src="' + imageFor('character', id) + '" alt="portrait"/><img src="' + imageFor('character', id, true) + '" alt="gallery scene"/></div></div>' +
      '<div class="wb-modal-copy"><div>' + badge(c.profile.narrativeRole || 'character', 'violet') + ' ' + badge(c.profile.lifeStatus, statusTone(c.profile.lifeStatus)) + '</div><h2>' + esc(c.displayName) + '</h2><p class="lead">' + esc(epithet ? epithet.name : c.biography) + '</p>' +
      '<div class="wb-detail-grid">' + tiles.map(function (t) { return '<div class="wb-detail-tile"><b>' + esc(t[0]) + '</b><span>' + esc(t[1] || '—') + '</span></div>'; }).join('') + '</div>' +
      detailSection('Biography', c.biography) + detailSection('Appearance', c.profile.appearance) + detailSection('Personality', c.profile.personality) + detailSection('Backstory', c.profile.backstory) +
      '<div class="wb-detail-section"><h3>Arc</h3><div class="wb-detail-grid">' + Object.keys(c.profile.arc).map(function (k) { return '<div class="wb-detail-tile"><b>' + esc(k) + '</b><span>' + esc(c.profile.arc[k]) + '</span></div>'; }).join('') + '</div></div>' +
      '<div class="wb-detail-section"><h3>Abilities & affiliations</h3>' + (detail.abilities || []).map(function (a) { return '<div class="wb-option"><b>' + esc(a.name) + '</b><span>' + esc(a.description + ' Cost: ' + a.cost) + '</span></div>'; }).join('') +
      '<div class="tag-row" style="margin-top:8px">' + (detail.affiliations || []).map(function (a) { return badge(a.groupName + (a.rank ? ' · ' + a.rank : ''), 'violet'); }).join('') + '</div></div></div></div>');
  }
  function openPlace(id) {
    var p = byId(W.places, 'placeId', id); if (!p) return;
    var detail = W.placeDetails[id] || {};
    modal('<div class="wb-modal-grid"><div class="wb-modal-art"><img src="' + imageFor('place', id) + '" alt="' + esc(p.name) + '"/></div><div class="wb-modal-copy"><div>' + badge(p.kind, 'violet') + '</div><h2>' + esc(p.name) + '</h2><p class="lead">' + esc(p.profile.appearance) + '</p>' +
      detailSection('Atmosphere', p.profile.atmosphere) + detailSection('History', p.profile.history) +
      '<div class="wb-detail-section"><h3>Inhabitants & maps</h3><div class="tag-row">' + (detail.inhabitants || []).map(function (x) { return badge(x.displayName, 'green'); }).join('') + (detail.mapAppearances || []).map(function (x) { return badge(x.mapName || x.name || 'Mapped', 'violet'); }).join('') + '</div></div></div></div>');
  }
  function openGroup(id) {
    var g = byId(W.groups, 'groupId', id); if (!g) return;
    var detail = W.groupDetails[id] || {};
    var seat = byId(W.places, 'placeId', g.seatPlaceId);
    modal('<div class="wb-modal-grid"><div class="wb-modal-art"><img src="' + imageFor('group', id) + '" alt="' + esc(g.name) + '"/></div><div class="wb-modal-copy"><div>' + badge(g.kind, 'violet') + ' ' + badge(g.status, statusTone(g.status)) + '</div><h2>' + esc(g.name) + '</h2><p class="lead">' + esc(g.summary) + '</p>' + detailSection('About', g.description) +
      '<div class="wb-detail-grid"><div class="wb-detail-tile"><b>Seat</b><span>' + esc(seat ? seat.name : '—') + '</span></div><div class="wb-detail-tile"><b>Founded</b><span>' + esc(g.foundedYear || 'Unknown') + '</span></div></div>' +
      '<div class="wb-detail-section"><h3>Members</h3><div class="tag-row">' + (detail.affiliations || []).map(function (a) { return badge(a.personName + (a.rank ? ' · ' + a.rank : ''), 'green'); }).join('') + '</div></div></div></div>');
  }
  function openScene(id) {
    var s = byId(W.scenes, 'sceneId', id); if (!s) return;
    var d = W.sceneDetails[id] || {};
    modal('<div class="wb-modal-grid"><div class="wb-modal-art"><img src="' + imageFor('scene', id) + '" alt="' + esc(s.title) + '"/></div><div class="wb-modal-copy"><div>' + badge('Scene ' + (s.narrativeOrder + 1), 'violet') + ' ' + badge(s.status, statusTone(s.status)) + '</div><h2>' + esc(s.title) + '</h2><p class="lead">' + esc(s.summary) + '</p>' +
      '<div class="wb-detail-grid"><div class="wb-detail-tile"><b>Place</b><span>' + esc(s.placeName || '—') + '</span></div><div class="wb-detail-tile"><b>World date</b><span>' + esc(s.worldYear ? s.worldYear + ' A.L.' : 'Open') + '</span></div></div>' +
      '<div class="wb-detail-section"><h3>Cast</h3><div class="tag-row">' + (d.cast || []).map(function (x) { return badge(x.displayName + (x.role ? ' · ' + x.role : ''), 'green'); }).join('') + '</div></div>' +
      detailSection('Scene design', s.notes) + detailSection('Manuscript', d.text && d.text.text, true) + '</div></div>');
  }
  function openRule(id) {
    var r = byId(W.rules, 'ruleId', id); if (!r) return;
    modal('<div class="wb-modal-copy"><div>' + badge(r.hardness, 'violet') + ' ' + badge(r.status, statusTone(r.status)) + '</div><h2>' + esc(r.title) + '</h2>' + detailSection('Statement', r.statement) + detailSection('Cost', r.cost || 'No explicit cost recorded.') + detailSection('Limits & exceptions', r.limits) +
      '<div class="wb-detail-grid"><div class="wb-detail-tile"><b>Scope</b><span>' + esc(r.scopeKind) + '</span></div><div class="wb-detail-tile"><b>Story beats</b><span>' + W.beats.filter(function (b) { return b.threadId === id; }).length + '</span></div></div></div>');
  }
  function openQuestion(id) {
    var q = W.questionDetails[id] || byId(W.questions, 'questionId', id); if (!q) return;
    modal('<div class="wb-modal-copy"><div>' + badge(q.status, statusTone(q.status)) + (q.blocking ? ' ' + badge('blocking', 'red') : '') + '</div><h2>' + esc(q.question) + '</h2><p class="lead">Anchored to ' + esc(q.anchorKind + ' · ' + q.anchorTitle) + '</p>' +
      '<div class="wb-detail-section"><h3>Options</h3>' + (q.options || []).map(function (o) { return '<div class="wb-option"><b>' + esc(o.text) + '</b><span>' + esc(o.implications || '') + '</span></div>'; }).join('') + '</div></div>');
  }
  function openEntry(ref) {
    var split = ref.indexOf(':'); var kind = ref.slice(0, split); var id = ref.slice(split + 1);
    var e = W.entries.find(function (x) { return x.kind === kind && x.id === id; }); if (!e) return;
    var data = W.entryDetails[ref]; var detail = data && data.detail;
    var image = kind === 'character' ? imageFor('character', id) : kind === 'place' ? imageFor('place', id) : kind === 'group' ? imageFor('group', id) : imageFor('article', id);
    var body = detail && (detail.body || detail.description || detail.biography || detail.statement || detail.summary);
    modal('<div class="wb-modal-grid"><div class="wb-modal-art"><img src="' + image + '" alt=""/></div><div class="wb-modal-copy"><div>' + badge(kind, 'violet') + (e.spoiler ? ' ' + badge('spoiler', 'red') : '') + '</div><h2>' + esc(e.title) + '</h2><p class="lead">' + esc(e.summary || '') + '</p>' + detailSection('Entry', body || e.summary || 'Projected from the canonical sheet.') +
      '<div class="wb-detail-section"><h3>Aliases & backlinks</h3><div class="tag-row">' + (e.aliases || []).map(function (a) { return badge(a, 'violet'); }).join('') + (data && data.backlinks || []).slice(0, 8).map(function (b) { return badge(b.sourceTitle || b.text || 'backlink', 'green'); }).join('') + '</div></div></div></div>');
  }
  function detailSection(title, text, prose) {
    if (!text) return '';
    return '<div class="wb-detail-section"><h3>' + esc(title) + '</h3>' + (prose ? manuscriptMarkup(text) : '<p>' + esc(text) + '</p>') + '</div>';
  }
  function modal(body) {
    modalRoot.innerHTML = '<div class="modal-overlay" role="dialog" aria-modal="true"><div class="modal wide wb-modal"><div class="modal-head"><span></span><button class="modal-x" aria-label="Close">' + icon('close', 16) + '</button></div>' + body + '</div></div>';
    modalRoot.querySelector('.modal-x').addEventListener('click', closeModal);
    modalRoot.querySelector('.modal-overlay').addEventListener('click', function (event) { if (event.target.classList.contains('modal-overlay')) closeModal(); });
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  var toastTimer;
  var familyClickTimer;
  function toast(message) {
    var node = document.getElementById('toast');
    node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2800);
  }
  function familyFocus(id) {
    if (!byId(W.characters, 'personId', id)) return;
    state.familyFocus = id;
    state.familyZoom = 1;
    closeModal();
    render();
  }
  function familyZoom(direction) {
    state.familyZoom = Math.max(.55, Math.min(1.7, state.familyZoom + direction * .15));
    render();
  }
  function familyNodeClick(id, event) {
    clearTimeout(familyClickTimer);
    if (event && event.detail > 1) { familyFocus(id); return; }
    familyClickTimer = setTimeout(function () { openCharacter(id); }, 220);
  }
  function settingsTab(id) {
    if (!SETTINGS_TABS.some(function (tab) { return tab[0] === id; })) return;
    state.settingsTab = id;
    render();
  }
  function toggleSetting(key) {
    if (!(key in state.toggles)) return;
    state.toggles[key] = !state.toggles[key];
    render();
  }
  function go(view) {
    if (!RENDERERS[view]) view = 'home';
    if (location.hash.slice(1) === view) { state.view = view; render(); }
    else location.hash = view;
  }
  function route() {
    state.view = RENDERERS[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
    render();
  }

  window.WB = {
    go: go,
    toast: toast,
    closeModal: closeModal,
    familyFocus: familyFocus,
    familyZoom: familyZoom,
    familyNodeClick: familyNodeClick,
    settingsTab: settingsTab,
    toggleSetting: toggleSetting,
  };
  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeModal(); });
  route();
}());
