/* global Office, Word */
(function () {
  'use strict';

  var TOKEN = (window.NODUS && window.NODUS.token) || '';
  var DEBOUNCE_MS = 700;
  var MIN_CHARS = 12;

  var els = {};
  var lastHash = '';
  var requestSeq = 0;
  var debounceTimer = null;
  var searchTimer = null;
  var autoAnalyze = true;
  var detailCache = {};
  var isWord = false;
  var currentParagraphText = '';
  var currentSelectionText = '';

  var RELATION_LABEL = {
    supports: 'apoya',
    contradicts: 'contradice',
    refines: 'matiza',
    extends: 'amplía',
    related: 'relacionada',
  };

  var KIND_LABEL = {
    idea: 'idea',
    note: 'nota',
    passage: 'pasaje',
    work: 'obra',
  };

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.text().then(function (raw) {
        var data = raw ? JSON.parse(raw) : {};
        if (!res.ok) throw new Error(data.error || res.statusText || 'Error de Nodus');
        return data;
      });
    });
  }

  function textEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
  }

  function button(label, className, onClick) {
    var btn = document.createElement('button');
    btn.className = className || 'btn';
    btn.type = 'button';
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
  }

  function setStatus(text, cls) {
    els.status.textContent = text;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return String(h) + ':' + str.length;
  }

  function isDarkColor(hex) {
    var value = String(hex || '').replace('#', '');
    if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
    if (value.length !== 6) return true;
    var r = parseInt(value.slice(0, 2), 16);
    var g = parseInt(value.slice(2, 4), 16);
    var b = parseInt(value.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 140;
  }

  function applyOfficeTheme() {
    var theme = Office.context && Office.context.officeTheme;
    if (!theme) return;
    var bg = theme.bodyBackgroundColor || theme.controlBackgroundColor;
    var fg = theme.bodyForegroundColor || theme.controlForegroundColor;
    var panel = theme.controlBackgroundColor || bg;
    var controlFg = theme.controlForegroundColor || fg;
    if (bg) document.documentElement.style.setProperty('--bg', bg);
    if (fg) document.documentElement.style.setProperty('--text', fg);
    if (panel) document.documentElement.style.setProperty('--panel', panel);
    if (controlFg) document.documentElement.style.setProperty('--control-text', controlFg);
    document.body.classList.toggle('light', !isDarkColor(bg));
    document.body.classList.toggle('dark', isDarkColor(bg));
  }

  function getCurrentParagraph() {
    if (!isWord) return Promise.resolve(currentParagraphText);
    return Word.run(function (context) {
      var range = context.document.getSelection();
      var para = range.paragraphs.getFirst();
      para.load('text');
      return context.sync().then(function () {
        return (para.text || '').trim();
      });
    }).catch(function () {
      return '';
    });
  }

  function getSelectionText() {
    if (!isWord) return Promise.resolve(currentSelectionText);
    return Word.run(function (context) {
      var range = context.document.getSelection();
      range.load('text');
      return context.sync().then(function () {
        return (range.text || '').trim();
      });
    }).catch(function () {
      return '';
    });
  }

  function insertAtCursor(text) {
    if (!isWord) {
      return api('/api/editor/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
    }
    return Word.run(function (context) {
      var range = context.document.getSelection();
      var prefix = text.charAt(0) === ' ' ? '' : ' ';
      range.insertText(prefix + text, Word.InsertLocation.end);
      return context.sync();
    });
  }

  function renderEmpty(message) {
    els.results.innerHTML = '';
    els.empty.style.display = 'block';
    els.empty.textContent = message;
  }

  function ideaIdFor(item) {
    if (item.globalId) return item.globalId;
    if (item.targetKind === 'idea') return item.targetId;
    return null;
  }

  function primaryLabel(item) {
    return item.label || item.targetLabel || item.globalId || item.targetId || 'Sin título';
  }

  function subtitleFor(item) {
    if (item.workCount != null) {
      var parts = [];
      parts.push(item.workCount === 1 ? '1 obra' : item.workCount + ' obras');
      if (item.authorYear) parts.push(item.authorYear);
      else if (item.sourceLabel) parts.push(item.sourceLabel);
      return parts.join(' · ');
    }
    return [KIND_LABEL[item.targetKind] || item.targetKind, item.targetSubtitle].filter(Boolean).join(' · ');
  }

  function badgeFor(item) {
    if (item.relation) return RELATION_LABEL[item.relation] || item.relation;
    return KIND_LABEL.idea;
  }

  function scoreFor(item) {
    var raw = item.rankScore || item.confidence || item.similarity;
    if (!raw) return '';
    return Math.round(raw * 100) + '%';
  }

  function appendZoteroAction(actions, item) {
    if (!item.zoteroKey) return;
    var copied = textEl('span', 'copied', '');
    actions.appendChild(button('Zotero', 'btn small', function () {
      api('/api/zotero/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoteroKey: item.zoteroKey }),
      }).catch(function () {});
      if (item.searchString && navigator.clipboard) {
        navigator.clipboard.writeText(item.searchString).then(function () {
          copied.textContent = 'búsqueda copiada';
          setTimeout(function () { copied.textContent = ''; }, 2200);
        });
      }
    }));
    actions.appendChild(copied);
  }

  function openInNodus(ideaId) {
    api('/api/nodus/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaId: ideaId }),
    }).then(function () {
      setStatus('Abierto en Nodus', 'ok');
    }).catch(function (e) {
      setStatus(e.message, 'err');
    });
  }

  function renderConnections(container, detail) {
    var wrap = textEl('div', 'detail-section', '');
    wrap.appendChild(textEl('div', 'section-title', 'Conexiones'));
    if (!detail.connections || !detail.connections.length) {
      wrap.appendChild(textEl('p', 'muted', 'Sin conexiones directas.'));
      container.appendChild(wrap);
      return;
    }
    detail.connections.forEach(function (connection) {
      var row = textEl('div', 'connection', '');
      var head = textEl('div', 'connection-head', '');
      head.appendChild(textEl('span', 'badge ' + connection.type, RELATION_LABEL[connection.type] || connection.type));
      head.appendChild(textEl('span', 'connection-title', connection.otherLabel));
      row.appendChild(head);
      if (connection.otherStatement) row.appendChild(textEl('p', 'connection-text', connection.otherStatement));
      row.appendChild(button('Abrir', 'btn tiny', function () { openInNodus(connection.otherId); }));
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }

  function renderDetail(card, ideaId) {
    var existing = card.querySelector('.detail');
    if (existing) {
      existing.remove();
      return;
    }

    var detail = textEl('div', 'detail', '');
    detail.appendChild(textEl('div', 'spin', 'Cargando idea…'));
    card.appendChild(detail);

    function draw(payload) {
      detail.innerHTML = '';
      var idea = payload.idea;
      detail.appendChild(textEl('p', 'statement', idea.idea.statement));

      var sourceWrap = textEl('div', 'detail-section', '');
      sourceWrap.appendChild(textEl('div', 'section-title', 'Fuentes'));
      if (!idea.occurrences.length) {
        sourceWrap.appendChild(textEl('p', 'muted', 'Sin obras asociadas.'));
      } else {
        idea.occurrences.slice(0, 6).forEach(function (occurrence) {
          var source = textEl('div', 'source', '');
          source.appendChild(textEl('div', 'source-title', occurrence.workTitle));
          source.appendChild(textEl('div', 'source-meta', [occurrence.authorYear, occurrence.role].filter(Boolean).join(' · ')));
          if (occurrence.development) source.appendChild(textEl('p', 'source-text', occurrence.development));
          sourceWrap.appendChild(source);
        });
      }
      detail.appendChild(sourceWrap);
      renderConnections(detail, idea);
    }

    if (detailCache[ideaId]) {
      draw(detailCache[ideaId]);
      return;
    }

    api('/api/idea', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaId: ideaId }),
    }).then(function (payload) {
      detailCache[ideaId] = payload;
      draw(payload);
    }).catch(function (e) {
      detail.textContent = 'Error al cargar la idea: ' + e.message;
    });
  }

  function insertIdea(ideaId, btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Insertando…';
    Promise.all([getCurrentParagraph(), getSelectionText()])
      .then(function (values) {
        return api('/api/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideaId: ideaId, paragraphText: values[0], selectionText: values[1] }),
        });
      })
      .then(function (result) {
        return insertAtCursor(result.text).then(function () {
          setStatus('Idea insertada', 'ok');
        });
      })
      .catch(function (e) {
        setStatus(e.message, 'err');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  function renderItems(items, emptyMessage) {
    els.results.innerHTML = '';
    if (!items.length) {
      renderEmpty(emptyMessage);
      return;
    }
    els.empty.style.display = 'none';

    items.forEach(function (item) {
      var card = textEl('article', 'card', '');
      var ideaId = ideaIdFor(item);

      var row = textEl('div', 'row', '');
      row.appendChild(textEl('span', 'badge ' + (item.relation || 'idea'), badgeFor(item)));
      row.appendChild(textEl('span', 'label', primaryLabel(item)));
      var score = scoreFor(item);
      if (score) row.appendChild(textEl('span', 'pct', score));
      card.appendChild(row);

      var subtitle = subtitleFor(item);
      if (subtitle) card.appendChild(textEl('div', 'subtitle', subtitle));

      var body = item.statement || item.targetStatement || item.rationale || '';
      if (body) card.appendChild(textEl('p', 'rationale', body));

      var actions = textEl('div', 'actions', '');
      if (ideaId) {
        actions.appendChild(button('Detalles', 'btn small', function () { renderDetail(card, ideaId); }));
        actions.appendChild(button('Abrir en Nodus', 'btn small', function () { openInNodus(ideaId); }));
        actions.appendChild(button('Insertar con IA', 'btn small primary', function () { insertIdea(ideaId, this); }));
      }
      appendZoteroAction(actions, item);
      if (actions.childNodes.length) card.appendChild(actions);

      els.results.appendChild(card);
    });
  }

  function renderRelations(relations) {
    var sorted = relations.slice().sort(function (a, b) {
      return (b.rankScore || b.confidence || b.similarity || 0) - (a.rankScore || a.confidence || a.similarity || 0);
    });
    renderItems(sorted, 'Sin ideas relacionadas para este párrafo.');
  }

  function renderSearch(ideas) {
    renderItems(ideas, 'Sin ideas para esa búsqueda.');
  }

  function analyze(force) {
    if (els.searchBox.value.trim()) return;
    getCurrentParagraph().then(function (text) {
      els.paragraph.textContent = text ? text.slice(0, 360) : '';
      if (text.length < MIN_CHARS) {
        renderEmpty('Coloca el cursor en un párrafo con texto.');
        lastHash = '';
        return;
      }
      var h = hash(text);
      if (!force && h === lastHash) return;
      lastHash = h;

      var seq = ++requestSeq;
      els.empty.style.display = 'block';
      els.empty.textContent = 'Buscando ideas relacionadas…';
      els.results.innerHTML = '';

      api('/api/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
      })
        .then(function (data) {
          if (seq !== requestSeq) return;
          if (!data.available) {
            renderEmpty('Configura embeddings en Nodus para buscar relaciones.');
            return;
          }
          renderRelations(data.relations || []);
        })
        .catch(function (e) {
          if (seq !== requestSeq) return;
          renderEmpty('Error al consultar Nodus: ' + e.message);
        });
    });
  }

  function searchIdeas() {
    var query = els.searchBox.value.trim();
    if (query.length < 2) {
      analyze(true);
      return;
    }
    var seq = ++requestSeq;
    els.paragraph.textContent = '';
    els.empty.style.display = 'block';
    els.empty.textContent = 'Buscando ideas…';
    els.results.innerHTML = '';

    api('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, limit: 40 }),
    })
      .then(function (data) {
        if (seq !== requestSeq) return;
        renderSearch(data.ideas || []);
      })
      .catch(function (e) {
        if (seq !== requestSeq) return;
        renderEmpty('Error al buscar: ' + e.message);
      });
  }

  function onSelectionChanged() {
    if (!autoAnalyze || els.searchBox.value.trim()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { analyze(false); }, DEBOUNCE_MS);
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(searchIdeas, DEBOUNCE_MS);
  }

  function checkHealth() {
    api('/api/health')
      .then(function (data) {
        if (data.embeddingsConfigured) setStatus('Conectado · ' + data.corpusSize + ' obras', 'ok');
        else setStatus('Conectado (sin embeddings)', 'ok');
      })
      .catch(function () { setStatus('Nodus no responde', 'err'); });
  }

  function startStandalonePolling() {
    function poll() {
      api('/api/editor/state')
        .then(function (state) {
          var changed = (state.paragraphText !== currentParagraphText || state.selectionText !== currentSelectionText);
          currentParagraphText = state.paragraphText || '';
          currentSelectionText = state.selectionText || '';
          if (changed) {
            onSelectionChanged();
          }
        })
        .catch(function (e) {
          console.warn('Error polling editor state', e);
        })
        .finally(function () {
          setTimeout(poll, 1500);
        });
    }
    poll();
  }

  function initApp() {
    els.status = document.getElementById('status');
    els.paragraph = document.getElementById('paragraph');
    els.results = document.getElementById('results');
    els.empty = document.getElementById('empty');
    els.analyzeBtn = document.getElementById('analyzeBtn');
    els.autoToggle = document.getElementById('autoToggle');
    els.searchBox = document.getElementById('searchBox');
    els.searchBtn = document.getElementById('searchBtn');

    if (!isWord) {
      var captionEl = document.querySelector('.head .caption');
      if (captionEl) captionEl.textContent = 'LibreOffice / Editor';
    }

    if (isWord) {
      applyOfficeTheme();
      try {
        if (Office.context.officeTheme && Office.context.officeTheme.addHandlerAsync && Office.EventType.OfficeThemeChanged) {
          Office.context.officeTheme.addHandlerAsync(Office.EventType.OfficeThemeChanged, applyOfficeTheme);
        }
      } catch (e) {
        // Older Word webviews do not expose live theme events.
      }
      Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged);
    } else {
      startStandalonePolling();
    }

    els.analyzeBtn.onclick = function () {
      els.searchBox.value = '';
      analyze(true);
    };
    els.searchBtn.onclick = searchIdeas;
    els.searchBox.oninput = onSearchInput;
    els.searchBox.onkeydown = function (event) {
      if (event.key === 'Enter') searchIdeas();
      if (event.key === 'Escape') {
        els.searchBox.value = '';
        analyze(true);
      }
    };
    els.autoToggle.onchange = function () { autoAnalyze = els.autoToggle.checked; };

    checkHealth();
    analyze(true);
  }

  var initialized = false;
  Office.onReady(function (info) {
    if (initialized) return;
    if (info && info.host === Office.HostType.Word) {
      isWord = true;
    }
    initialized = true;
    initApp();
  });

  setTimeout(function () {
    if (!initialized) {
      initialized = true;
      initApp();
    }
  }, 1000);
})();
