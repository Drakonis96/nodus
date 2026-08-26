/* SPDX-License-Identifier: AGPL-3.0-only */
/* global Office, Word */
(function () {
  'use strict';

  var FIELD_FORMAT = 'nodus.office-reference';
  var SETTINGS_KEY = 'nodus.office-reference.preferences.v1';
  var LOCATORS = [
    'page', 'chapter', 'section', 'paragraph', 'volume', 'issue', 'book', 'part',
    'column', 'figure', 'table', 'line', 'note', 'appendix', 'article-locator',
    'elocation', 'equation', 'folio', 'opus', 'rule', 'scene', 'sub-verbo',
    'supplement', 'timestamp', 'title-locator', 'verse', 'version', 'act', 'canon'
  ];

  var COPY = {
    es: {
      references: 'Referencias', search: 'Buscar por título, autor, año, DOI, ISBN o clave de cita',
      style: 'Estilo', styleSearch: 'Buscar estilos de cita', language: 'Idioma', placement: 'Ubicación', inText: 'En el texto',
      footnote: 'Nota al pie', endnote: 'Nota final', auto: 'Actualizar citas automáticamente',
      refresh: 'Actualizar', unlink: 'Desvincular', current: 'Cita actual', choose: 'Añade una o varias fuentes',
      clear: 'Limpiar', insert: 'Insertar cita', update: 'Actualizar cita', bibliography: 'Bibliografía',
      bibliographyHint: 'Incluye las fuentes citadas en este documento', insertBibliography: 'Insertar / actualizar',
      add: 'Añadir', onlyBibliography: 'Solo bibliografía', remove: 'Quitar', edit: 'Editar detalles',
      up: 'Mover antes', down: 'Mover después', locator: 'Localizador', value: 'Valor', prefix: 'Prefijo',
      suffix: 'Sufijo / texto posterior', omitAuthor: 'Omitir autor', excludeBibliography: 'Excluir de la bibliografía',
      noResults: 'No hay referencias que coincidan.', searchPrompt: 'Haz una búsqueda para mostrar referencias de la biblioteca global.',
      searching: 'Buscando en la biblioteca global…', added: 'Referencia añadida', citationInserted: 'Cita viva insertada',
      citationUpdated: 'Cita actualizada', bibliographyInserted: 'Bibliografía viva insertada', refreshed: 'Citas y bibliografía actualizadas',
      unlinkConfirm: 'Las citas y bibliografías se convertirán en texto normal. Esta acción no se puede deshacer desde Nodus. ¿Continuar?',
      unlinked: 'Referencias desvinculadas', noCitations: 'Este documento aún no contiene citas de Nodus.',
      noBibliography: 'Añade una cita o una fuente para poder generar la bibliografía.',
      editorNotListening: 'LibreOffice no está escuchando. Ejecuta la macro start_nodus_copilot en Writer.',
      wordFieldsUnsupported: 'Esta versión de Word no admite campos de citas editables (requiere WordApi 1.5).',
      sourceMissing: 'La referencia ya no está en la biblioteca; se usará la copia incrustada en el documento.',
      automaticOff: 'Cita insertada. Pulsa Actualizar cuando quieras recalcular todo el documento.',
      bibliographyExtra: 'Añadida a la bibliografía', bibliographyRemoved: 'Quitada de la bibliografía adicional',
      showStyles: 'Mostrar estilos de cita', noStyles: 'Ningún estilo coincide con la búsqueda.',
      styleManager: 'Gestionar estilos en Nodus', styleManagerOpened: 'Gestor de estilos abierto en Nodus'
    },
    en: {
      references: 'References', search: 'Search title, author, year, DOI, ISBN, or citation key',
      style: 'Style', styleSearch: 'Search citation styles', language: 'Language', placement: 'Placement', inText: 'In text',
      footnote: 'Footnote', endnote: 'Endnote', auto: 'Update citations automatically',
      refresh: 'Refresh', unlink: 'Unlink', current: 'Current citation', choose: 'Add one or more sources',
      clear: 'Clear', insert: 'Insert citation', update: 'Update citation', bibliography: 'Bibliography',
      bibliographyHint: 'Uses the sources cited in this document', insertBibliography: 'Insert / update',
      add: 'Add', onlyBibliography: 'Bibliography only', remove: 'Remove', edit: 'Edit details',
      up: 'Move earlier', down: 'Move later', locator: 'Locator', value: 'Value', prefix: 'Prefix',
      suffix: 'Suffix / text after', omitAuthor: 'Omit author', excludeBibliography: 'Exclude from bibliography',
      noResults: 'No references match that search.', searchPrompt: 'Search to show references from the global library.',
      searching: 'Searching the global library…', added: 'Reference added', citationInserted: 'Live citation inserted',
      citationUpdated: 'Citation updated', bibliographyInserted: 'Live bibliography inserted', refreshed: 'Citations and bibliography refreshed',
      unlinkConfirm: 'Citations and bibliographies will become plain text. Nodus cannot undo this action. Continue?',
      unlinked: 'References unlinked', noCitations: 'This document does not contain Nodus citations yet.',
      noBibliography: 'Add a citation or a source before generating a bibliography.',
      editorNotListening: 'LibreOffice is not listening. Run the start_nodus_copilot macro in Writer.',
      wordFieldsUnsupported: 'This Word version cannot create editable citation fields (WordApi 1.5 is required).',
      sourceMissing: 'This reference is no longer in the library; the document snapshot will be used.',
      automaticOff: 'Citation inserted. Choose Refresh when you want to recalculate the whole document.',
      bibliographyExtra: 'Added to bibliography', bibliographyRemoved: 'Removed from bibliography extras',
      showStyles: 'Show citation styles', noStyles: 'No citation style matches the search.',
      styleManager: 'Manage styles in Nodus', styleManagerOpened: 'Style manager opened in Nodus'
    }
  };

  function create(options) {
    var lang = options.lang === 'en' ? 'en' : 'es';
    var C = COPY[lang];
    var refs = [];
    var selected = [];
    var styles = [];
    var extras = [];
    var editingCitationId = null;
    var externalState = null;
    var active = false;
    var fieldsSupported = true;
    var stylePickerOpen = false;
    var activeStyleIndex = 0;
    var styleRequestSeq = 0;
    var searchRequestSeq = 0;
    var styleRefreshTimer = null;
    var preferences = { formatVersion: 1, style: 'apa-7', locale: lang === 'es' ? 'es-ES' : 'en-US', placement: 'in-text', automaticUpdates: true };
    var el = {
      results: document.getElementById('results'), empty: document.getElementById('empty'),
      controls: document.getElementById('referenceControls'), analysis: document.getElementById('analysisControls'),
      search: document.getElementById('searchBox'), style: document.getElementById('referenceStyle'), styleSearch: document.getElementById('referenceStyleSearch'),
      stylePicker: document.getElementById('referenceStylePicker'), styleOptions: document.getElementById('referenceStyleOptions'),
      styleToggle: document.getElementById('referenceStyleToggle'), styleManager: document.getElementById('referenceStyleManager'),
      locale: document.getElementById('referenceLocale'), placement: document.getElementById('referencePlacement'),
      auto: document.getElementById('referenceAutoUpdate'), selected: document.getElementById('selectedReferences'),
      hint: document.getElementById('composerHint'), insert: document.getElementById('insertCitation'),
      clear: document.getElementById('clearCitation'), refresh: document.getElementById('refreshReferences'),
      unlink: document.getElementById('unlinkReferences'), bibliography: document.getElementById('insertBibliography'),
      bibliographyHint: document.getElementById('bibliographyHint')
    };

    function uid(prefix) {
      if (window.crypto && window.crypto.randomUUID) return prefix + window.crypto.randomUUID();
      return prefix + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function node(tag, className, text) {
      var value = document.createElement(tag);
      if (className) value.className = className;
      if (text !== undefined) value.textContent = text;
      return value;
    }

    function btn(label, className, title, handler) {
      var value = node('button', className || 'btn', label);
      value.type = 'button'; value.title = title || label; value.onclick = handler;
      return value;
    }

    function parseFieldData(raw) {
      try {
        var value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return value && value.format === FIELD_FORMAT && value.formatVersion === 1 ? value : null;
      } catch (_) { return null; }
    }

    function savePreferences() {
      preferences.style = el.style.value || preferences.style;
      preferences.locale = el.locale.value || preferences.locale;
      preferences.placement = el.placement.value || preferences.placement;
      preferences.automaticUpdates = !!el.auto.checked;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch (_) {}
      if (options.isWord && Office.context && Office.context.document && Office.context.document.settings) {
        Office.context.document.settings.set(SETTINGS_KEY, preferences);
        Office.context.document.settings.saveAsync(function (result) {
          if (result && result.status === Office.AsyncResultStatus.Failed) console.warn(result.error && result.error.message);
        });
      }
    }

    function loadPreferences() {
      var stored = null;
      if (options.isWord && Office.context && Office.context.document && Office.context.document.settings) {
        stored = Office.context.document.settings.get(SETTINGS_KEY);
      }
      if (!stored && externalState && externalState.preferences) stored = externalState.preferences;
      if (!stored) {
        try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) {}
      }
      if (stored && stored.formatVersion === 1) preferences = Object.assign({}, preferences, stored);
      el.style.value = preferences.style;
      el.locale.value = preferences.locale;
      el.placement.value = preferences.placement;
      el.auto.checked = preferences.automaticUpdates !== false;
    }

    function localize() {
      var refTab = document.querySelector('[data-mode="references"]');
      if (refTab) {
        var refTabLabel = refTab.querySelector('.seg-label');
        if (refTabLabel) refTabLabel.textContent = C.references;
        refTab.setAttribute('aria-label', C.references);
        refTab.title = C.references;
      }
      var labels = el.controls.querySelectorAll('[data-ref-label]');
      for (var i = 0; i < labels.length; i++) {
        var key = labels[i].getAttribute('data-ref-label');
        labels[i].textContent = key === 'style' ? C.style : key === 'locale' ? C.language : C.placement;
      }
      el.placement.options[0].text = C.inText; el.placement.options[1].text = C.footnote; el.placement.options[2].text = C.endnote;
      el.auto.nextElementSibling.textContent = C.auto;
      el.refresh.querySelector('span').textContent = C.refresh; el.unlink.querySelector('span').textContent = C.unlink;
      document.querySelector('.composer-head strong').textContent = C.current;
      el.hint.textContent = C.choose; el.clear.textContent = C.clear; el.insert.textContent = C.insert;
      document.querySelector('.bibliography-actions strong').textContent = C.bibliography;
      el.bibliographyHint.textContent = C.bibliographyHint; el.bibliography.textContent = C.insertBibliography;
      el.styleToggle.setAttribute('aria-label', C.showStyles);
      el.styleManager.textContent = C.styleManager;
    }

    function loadStyles() {
      var seq = ++styleRequestSeq;
      return options.api('/api/references/styles?fresh=' + Date.now(), { cache: 'no-store' }).then(function (data) {
        if (seq !== styleRequestSeq) return;
        styles = data.styles || [];
        if (!styles.some(function (style) { return style.id === preferences.style; })) preferences.style = styles[0] ? styles[0].id : 'apa-7';
        el.style.value = preferences.style;
        renderStyleOptions(stylePickerOpen ? el.styleSearch.value : '');
        if (!stylePickerOpen) syncStyleSearchDisplay();
      });
    }

    function normalizeStyleSearch(value) {
      return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    }

    function selectedStyle() {
      return styles.find(function (style) { return style.id === (el.style.value || preferences.style); });
    }

    function syncStyleSearchDisplay() {
      var current = selectedStyle();
      el.styleSearch.value = current ? current.title : (el.style.value || preferences.style || '');
    }

    function renderStyleOptions(query) {
      var selected = el.style.value || preferences.style;
      var tokens = normalizeStyleSearch(query).split(' ').filter(Boolean);
      var filtered = styles.filter(function (style) {
        var haystack = normalizeStyleSearch(style.title + ' ' + style.id);
        return tokens.every(function (token) { return haystack.indexOf(token) >= 0; });
      });
      el.style.innerHTML = '';
      styles.forEach(function (style) {
        var option = node('option', '', style.title);
        option.value = style.id; el.style.appendChild(option);
      });
      if (selected) el.style.value = selected;

      el.styleOptions.innerHTML = '';
      if (!filtered.length) el.styleOptions.appendChild(node('div', 'reference-style-empty', C.noStyles));
      filtered.forEach(function (style, index) {
        var option = node('button', 'reference-style-option');
        option.type = 'button';
        option.id = 'reference-style-option-' + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(style.id === selected));
        option.appendChild(node('span', 'reference-style-option-title', style.title));
        option.appendChild(node('span', 'reference-style-option-meta', style.availableOffline ? (lang === 'es' ? 'Instalado' : 'Installed') : (lang === 'es' ? 'Descarga pendiente' : 'Download pending')));
        option.onmousedown = function (event) { event.preventDefault(); selectStyle(style.id); };
        el.styleOptions.appendChild(option);
      });
      activeStyleIndex = Math.max(0, Math.min(activeStyleIndex, filtered.length - 1));
      updateActiveStyleOption();
    }

    function updateActiveStyleOption() {
      var optionsList = el.styleOptions.querySelectorAll('.reference-style-option');
      for (var i = 0; i < optionsList.length; i++) optionsList[i].classList.toggle('active', i === activeStyleIndex);
      var activeOption = optionsList[activeStyleIndex];
      if (activeOption) {
        el.styleSearch.setAttribute('aria-activedescendant', activeOption.id);
        activeOption.scrollIntoView({ block: 'nearest' });
      } else el.styleSearch.removeAttribute('aria-activedescendant');
    }

    function setStylePickerOpen(value) {
      stylePickerOpen = value;
      el.stylePicker.classList.toggle('open', value);
      el.styleOptions.hidden = !value;
      el.styleSearch.setAttribute('aria-expanded', String(value));
      el.styleToggle.setAttribute('aria-expanded', String(value));
      if (value) {
        el.styleSearch.value = '';
        activeStyleIndex = 0;
        renderStyleOptions('');
        loadStyles().catch(function () {});
      } else {
        el.styleSearch.removeAttribute('aria-activedescendant');
        syncStyleSearchDisplay();
      }
    }

    function selectStyle(styleId) {
      el.style.value = styleId;
      preferences.style = styleId;
      setStylePickerOpen(false);
      preferenceChanged(el.style);
    }

    function preferenceChanged(control) {
      savePreferences();
      if (control === el.style) {
        var style = styles.find(function (entry) { return entry.id === el.style.value; });
        if (style && style.citationFormat === 'note' && preferences.placement === 'in-text') {
          preferences.placement = 'footnote'; el.placement.value = 'footnote'; savePreferences();
        }
      }
      if (preferences.automaticUpdates && active) refresh();
    }

    function openStyleManager() {
      options.api('/api/nodus/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'citation-styles' })
      }).then(function () {
        options.setStatus(C.styleManagerOpened, 'ok');
      }).catch(function (error) { options.setStatus(error.message || String(error), 'err'); });
    }

    function empty(message) {
      el.results.innerHTML = ''; el.empty.style.display = 'block'; el.empty.textContent = message;
    }

    function referenceMeta(reference) {
      return [reference.author, reference.year, reference.publicationTitle].filter(Boolean).join(' · ');
    }

    function addReference(reference) {
      selected.push({
        id: reference.id, title: reference.title, snapshot: reference.snapshot,
        locator: '', label: 'page', prefix: '', suffix: '', suppressAuthor: false, excludeFromBibliography: false
      });
      renderComposer(); options.setStatus(C.added, 'ok');
    }

    function toggleExtra(reference) {
      var index = extras.findIndex(function (entry) { return entry.id === reference.id; });
      if (index >= 0) { extras.splice(index, 1); options.setStatus(C.bibliographyRemoved, 'ok'); }
      else { extras.push(reference); options.setStatus(C.bibliographyExtra, 'ok'); }
      renderReferenceResults(refs);
    }

    function renderReferenceResults(items) {
      refs = items.slice(); el.results.innerHTML = '';
      if (!items.length) { empty(C.noResults); return; }
      el.empty.style.display = 'none';
      items.forEach(function (reference) {
        var card = node('article', 'card reference-result');
        var row = node('div', 'row');
        row.appendChild(node('span', 'badge idea', reference.itemType.replace(/-/g, ' ')));
        row.appendChild(node('span', 'label', reference.title)); card.appendChild(row);
        var meta = referenceMeta(reference); if (meta) card.appendChild(node('div', 'subtitle', meta));
        if (reference.identifiers && reference.identifiers.length) card.appendChild(node('div', 'reference-identifiers', reference.identifiers.join(' · ')));
        var actions = node('div', 'actions');
        var isExtra = extras.some(function (entry) { return entry.id === reference.id; });
        actions.appendChild(btn(isExtra ? '✓ ' + C.onlyBibliography : C.onlyBibliography, 'btn small', C.onlyBibliography, function () { toggleExtra(reference); }));
        actions.appendChild(btn('+ ' + C.add, 'btn small primary', C.add, function () { addReference(reference); }));
        card.appendChild(actions); el.results.appendChild(card);
      });
    }

    function search(query) {
      var normalized = String(query || '').trim();
      var seq = ++searchRequestSeq;
      if (!normalized) {
        refs = [];
        empty(C.searchPrompt);
        return Promise.resolve();
      }
      empty(C.searching);
      return options.api('/api/references/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalized, limit: 50 })
      }).then(function (data) {
        if (seq === searchRequestSeq) renderReferenceResults(data.references || []);
      }).catch(function (error) {
        if (seq !== searchRequestSeq) return;
        empty(error.message); options.setStatus(error.message, 'err');
      });
    }

    function optionInput(label, value, onChange, wide) {
      var wrap = node('label', wide ? 'wide' : '', label);
      var input = node('input'); input.value = value || ''; input.oninput = function () { onChange(input.value); };
      wrap.appendChild(input); return wrap;
    }

    function renderComposer() {
      el.selected.innerHTML = '';
      selected.forEach(function (item, index) {
        var card = node('div', 'citation-source');
        var head = node('div', 'citation-source-head'); head.appendChild(node('span', 'citation-source-index', String(index + 1)));
        head.appendChild(node('span', 'citation-source-title', item.title || item.snapshot && item.snapshot.metadata.title || item.id));
        var buttons = node('div', 'citation-source-buttons');
        buttons.appendChild(btn('↑', '', C.up, function () { if (index) { selected.splice(index - 1, 0, selected.splice(index, 1)[0]); renderComposer(); } }));
        buttons.appendChild(btn('↓', '', C.down, function () { if (index < selected.length - 1) { selected.splice(index + 1, 0, selected.splice(index, 1)[0]); renderComposer(); } }));
        buttons.appendChild(btn('⋯', '', C.edit, function () { card.classList.toggle('open'); }));
        buttons.appendChild(btn('×', '', C.remove, function () { selected.splice(index, 1); renderComposer(); }));
        head.appendChild(buttons); card.appendChild(head);
        var detail = node('div', 'citation-source-options');
        var locatorLabel = node('label', '', C.locator); var locatorSelect = node('select');
        LOCATORS.forEach(function (locator) { var opt = node('option', '', locator.replace(/-/g, ' ')); opt.value = locator; locatorSelect.appendChild(opt); });
        locatorSelect.value = item.label || 'page'; locatorSelect.onchange = function () { item.label = locatorSelect.value; };
        locatorLabel.appendChild(locatorSelect); detail.appendChild(locatorLabel);
        detail.appendChild(optionInput(C.value, item.locator, function (value) { item.locator = value; }));
        detail.appendChild(optionInput(C.prefix, item.prefix, function (value) { item.prefix = value; }, true));
        detail.appendChild(optionInput(C.suffix, item.suffix, function (value) { item.suffix = value; }, true));
        var omit = node('label', 'check', ''); var omitInput = node('input'); omitInput.type = 'checkbox'; omitInput.checked = !!item.suppressAuthor;
        omitInput.onchange = function () { item.suppressAuthor = omitInput.checked; }; omit.appendChild(omitInput); omit.appendChild(node('span', '', C.omitAuthor)); detail.appendChild(omit);
        var exclude = node('label', 'check', ''); var excludeInput = node('input'); excludeInput.type = 'checkbox'; excludeInput.checked = !!item.excludeFromBibliography;
        excludeInput.onchange = function () { item.excludeFromBibliography = excludeInput.checked; }; exclude.appendChild(excludeInput); exclude.appendChild(node('span', '', C.excludeBibliography)); detail.appendChild(exclude);
        card.appendChild(detail); el.selected.appendChild(card);
      });
      el.insert.disabled = !selected.length || !fieldsSupported;
      el.insert.textContent = editingCitationId ? C.update : C.insert;
      el.placement.disabled = !!editingCitationId;
      el.placement.title = editingCitationId
        ? (lang === 'es' ? 'La ubicación de una cita existente no cambia al editarla.' : 'An existing citation keeps its current placement while it is edited.')
        : '';
      el.hint.textContent = selected.length ? selected.length + (lang === 'es' ? ' fuente(s)' : ' source(s)') : C.choose;
      el.bibliographyHint.textContent = extras.length
        ? C.bibliographyHint + ' · +' + extras.length
        : C.bibliographyHint;
    }

    async function collectWordFields(context) {
      var collections = [];
      var main = context.document.body.fields.getByTypes([Word.FieldType.addin]); main.load('items'); collections.push(main);
      var footnotes = context.document.body.footnotes; var endnotes = context.document.body.endnotes;
      footnotes.load('items'); endnotes.load('items'); await context.sync();
      footnotes.items.forEach(function (note) { var fields = note.body.fields.getByTypes([Word.FieldType.addin]); fields.load('items'); collections.push(fields); });
      endnotes.items.forEach(function (note) { var fields = note.body.fields.getByTypes([Word.FieldType.addin]); fields.load('items'); collections.push(fields); });
      await context.sync();
      var fields = [];
      collections.forEach(function (collection) { collection.items.forEach(function (field) { field.load('data,type'); fields.push(field); }); });
      await context.sync(); return fields;
    }

    function stateFromFields(fields) {
      var citations = []; var bibliographies = [];
      fields.forEach(function (field) {
        var data = parseFieldData(field.data);
        if (!data) return;
        if (data.kind === 'citation' && data.citation) citations.push(data.citation);
        if (data.kind === 'bibliography') bibliographies.push(data);
      });
      citations.sort(function (a, b) { return (a.noteIndex || 0) - (b.noteIndex || 0); });
      return { citations: citations, bibliographies: bibliographies, fields: fields };
    }

    function hydrateExtras(bibliographies) {
      var items = [];
      (bibliographies || []).forEach(function (field) {
        (field.uncitedItems || []).forEach(function (item) {
          if (items.some(function (entry) { return entry.id === item.id; })) return;
          items.push({ id: item.id, snapshot: item.snapshot,
            title: item.snapshot && item.snapshot.metadata && item.snapshot.metadata.title || item.id });
        });
      });
      extras = items;
      renderComposer();
    }

    function readDocumentState() {
      if (!options.isWord) return Promise.resolve(externalState || { citations: [], bibliographyFieldIds: [] });
      return Word.run(async function (context) { return stateFromFields(await collectWordFields(context)); });
    }

    function formatDocument(citations, bibliographyFields) {
      var uncitedItems = extras.map(function (entry) { return { id: entry.id, snapshot: entry.snapshot }; });
      (bibliographyFields || []).forEach(function (field) {
        (field.uncitedItems || []).forEach(function (item) {
          if (!uncitedItems.some(function (entry) { return entry.id === item.id; })) uncitedItems.push(item);
        });
        (field.uncitedItemIds || []).forEach(function (id) {
          if (!uncitedItems.some(function (entry) { return entry.id === id; })) uncitedItems.push({ id: id });
        });
      });
      return options.api('/api/references/format-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: preferences.style, locale: preferences.locale, citations: citations,
          uncitedItemIds: uncitedItems.map(function (entry) { return entry.id; }), uncitedItems: uncitedItems })
      });
    }

    function replaceFieldResult(field, formatted) {
      if (formatted.html && field.result && field.result.insertHtml) field.result.insertHtml(formatted.html, Word.InsertLocation.replace);
      else field.result.insertText(formatted.text || '', Word.InsertLocation.replace);
    }

    async function applyWordResult(result) {
      return Word.run(async function (context) {
        var state = stateFromFields(await collectWordFields(context));
        state.fields.forEach(function (field) {
          var data = parseFieldData(field.data); if (!data) return;
          if (data.kind === 'citation') {
            var citation = result.citations.find(function (entry) { return entry.citationId === data.citation.citationId; });
            if (citation) replaceFieldResult(field, citation);
          } else if (data.kind === 'bibliography' && result.bibliography) replaceFieldResult(field, result.bibliography);
        });
        await context.sync();
      });
    }

    function editorCommand(command) {
      return options.api('/api/editor/insert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command)
      }).then(function (result) { if (result && result.delivered === false) throw new Error(C.editorNotListening); return result; });
    }

    async function insertWordField(fieldData, formatted) {
      return Word.run(async function (context) {
        var selection = context.document.getSelection(); var field;
        if (fieldData.citation.placement === 'footnote' || fieldData.citation.placement === 'endnote') {
          var note = fieldData.citation.placement === 'footnote' ? selection.insertFootnote('') : selection.insertEndnote('');
          await context.sync();
          field = note.body.getRange(Word.RangeLocation.whole).insertField(Word.InsertLocation.start, Word.FieldType.addin);
        } else field = selection.insertField(Word.InsertLocation.end, Word.FieldType.addin);
        field.data = JSON.stringify(fieldData); replaceFieldResult(field, formatted); await context.sync();
      });
    }

    async function updateWordField(fieldId, fieldData, formatted) {
      return Word.run(async function (context) {
        var fields = await collectWordFields(context); var matched = false;
        fields.forEach(function (field) {
          var data = parseFieldData(field.data);
          if (data && data.fieldId === fieldId) { field.data = JSON.stringify(fieldData); replaceFieldResult(field, formatted); matched = true; }
        });
        if (!matched) throw new Error(lang === 'es' ? 'La cita seleccionada ya no existe.' : 'The selected citation no longer exists.');
        await context.sync();
      });
    }

    async function insertCitation() {
      if (!selected.length) return;
      savePreferences(); el.insert.disabled = true; options.setStatus(lang === 'es' ? 'Formateando…' : 'Formatting…', '');
      try {
        var state = await readDocumentState(); var citations = (state.citations || []).slice();
        var noteIndex = preferences.placement === 'in-text' ? 0 : Math.max(0, citations.reduce(function (max, citation) { return Math.max(max, citation.noteIndex || 0); }, 0)) + 1;
        var citationId = editingCitationId || uid('nodus-citation-');
        var cluster = { citationId: citationId, citationItems: selected.map(function (item) {
          return { id: item.id, locator: item.locator, label: item.label, prefix: item.prefix, suffix: item.suffix,
            suppressAuthor: !!item.suppressAuthor, excludeFromBibliography: !!item.excludeFromBibliography, snapshot: item.snapshot };
        }), noteIndex: noteIndex, placement: preferences.placement };
        var existing = citations.findIndex(function (entry) { return entry.citationId === citationId; });
        if (existing >= 0) { cluster.noteIndex = citations[existing].noteIndex; citations[existing] = cluster; } else citations.push(cluster);
        var result = await formatDocument(citations, state.bibliographies || []);
        var formatted = result.citations.find(function (entry) { return entry.citationId === citationId; });
        if (!formatted) throw new Error(lang === 'es' ? 'No se pudo formatear la cita.' : 'The citation could not be formatted.');
        var fieldData = { format: FIELD_FORMAT, formatVersion: 1, fieldId: citationId, kind: 'citation', citation: cluster, createdAt: new Date().toISOString() };
        if (options.isWord) {
          if (editingCitationId) await updateWordField(editingCitationId, fieldData, formatted);
          else await insertWordField(fieldData, formatted);
          if (preferences.automaticUpdates) await applyWordResult(result);
        } else await editorCommand({ command: 'insert-citation', text: formatted.text, html: formatted.html, field: fieldData,
          citationUpdates: preferences.automaticUpdates ? result.citations : [], bibliography: preferences.automaticUpdates ? result.bibliography : null, preferences: preferences });
        options.setStatus(editingCitationId ? C.citationUpdated : preferences.automaticUpdates ? C.citationInserted : C.automaticOff, 'ok');
        selected = []; editingCitationId = null; renderComposer();
      } catch (error) { options.setStatus(error.message || String(error), 'err'); }
      finally { el.insert.disabled = !selected.length || !fieldsSupported; }
    }

    async function insertBibliography() {
      savePreferences(); el.bibliography.disabled = true;
      try {
        var state = await readDocumentState();
        if (!(state.citations || []).length && !extras.length) throw new Error(C.noBibliography);
        var result = await formatDocument(state.citations || [], state.bibliographies || []);
        if (!result.bibliography) throw new Error(C.noBibliography);
        var existing = (state.bibliographies || [])[0];
        var fieldData = existing || { format: FIELD_FORMAT, formatVersion: 1, fieldId: uid('nodus-bibliography-'), kind: 'bibliography', createdAt: new Date().toISOString() };
        fieldData.uncitedItemIds = extras.map(function (entry) { return entry.id; });
        fieldData.uncitedItems = extras.map(function (entry) { return { id: entry.id, snapshot: entry.snapshot }; });
        if (options.isWord) {
          if (!existing) await Word.run(async function (context) {
            var field = context.document.getSelection().insertField(Word.InsertLocation.end, Word.FieldType.addin);
            field.data = JSON.stringify(fieldData); replaceFieldResult(field, result.bibliography); await context.sync();
          });
          else await updateWordField(existing.fieldId, fieldData, result.bibliography);
          await applyWordResult(result);
        } else await editorCommand({ command: 'insert-bibliography', text: result.bibliography.text, html: result.bibliography.html,
          field: fieldData, citationUpdates: result.citations, bibliography: result.bibliography, preferences: preferences });
        options.setStatus(C.bibliographyInserted, 'ok');
      } catch (error) { options.setStatus(error.message || String(error), 'err'); }
      finally { el.bibliography.disabled = false; }
    }

    async function refresh() {
      savePreferences(); el.refresh.disabled = true;
      try {
        var state = await readDocumentState();
        if (!(state.citations || []).length && !(state.bibliographies || []).length) throw new Error(C.noCitations);
        var result = await formatDocument(state.citations || [], state.bibliographies || []);
        if (options.isWord) await applyWordResult(result);
        else await editorCommand({ command: 'refresh-references', citationUpdates: result.citations, bibliography: result.bibliography, preferences: preferences });
        options.setStatus(C.refreshed, 'ok');
      } catch (error) { options.setStatus(error.message || String(error), 'err'); }
      finally { el.refresh.disabled = false; }
    }

    async function unlink() {
      if (!window.confirm(C.unlinkConfirm)) return;
      try {
        if (options.isWord) await Word.run(async function (context) {
          var fields = await collectWordFields(context);
          fields.forEach(function (field) { if (parseFieldData(field.data)) field.unlink(); });
          await context.sync();
        });
        else await editorCommand({ command: 'unlink-references' });
        options.setStatus(C.unlinked, 'ok'); selected = []; editingCitationId = null; renderComposer();
      } catch (error) { options.setStatus(error.message || String(error), 'err'); }
    }

    async function selectionChanged() {
      if (!active || !options.isWord || !fieldsSupported) return;
      try {
        var data = await Word.run(async function (context) {
          var fields = context.document.getSelection().fields.getByTypes([Word.FieldType.addin]); fields.load('items'); await context.sync();
          if (!fields.items.length) return null; fields.items[0].load('data'); await context.sync(); return parseFieldData(fields.items[0].data);
        });
        if (data && data.kind === 'citation' && data.citation) {
          editingCitationId = data.fieldId;
          selected = data.citation.citationItems.map(function (item) { return Object.assign({ title: item.snapshot && item.snapshot.metadata.title || item.id }, item); });
          el.placement.value = data.citation.placement; preferences.placement = data.citation.placement; renderComposer();
        } else if (editingCitationId) { editingCitationId = null; selected = []; renderComposer(); }
      } catch (_) {}
    }

    function setExternalState(state) {
      externalState = state || externalState;
      if (externalState && externalState.preferences && !options.isWord) { preferences = Object.assign({}, preferences, externalState.preferences); loadPreferences(); }
      if (externalState && !options.isWord) hydrateExtras(externalState.bibliographies || []);
      if (!active || !externalState || !externalState.selectedFieldId) return;
      var citation = (externalState.citations || []).find(function (entry) { return entry.citationId === externalState.selectedFieldId; });
      if (citation) { editingCitationId = citation.citationId; selected = citation.citationItems.map(function (item) { return Object.assign({ title: item.snapshot && item.snapshot.metadata.title || item.id }, item); }); renderComposer(); }
    }

    function setActive(value) {
      active = value; el.controls.hidden = !value; el.analysis.hidden = value;
      if (!value) {
        setStylePickerOpen(false);
        if (styleRefreshTimer) { clearInterval(styleRefreshTimer); styleRefreshTimer = null; }
        return;
      }
      el.search.placeholder = C.search; loadPreferences(); renderComposer(); search(el.search.value.trim());
      loadStyles().catch(function () {});
      if (!styleRefreshTimer) styleRefreshTimer = setInterval(function () {
        if (active && !document.hidden) loadStyles().catch(function () {});
      }, 4000);
      readDocumentState().then(function (state) { hydrateExtras(state.bibliographies || []); }).catch(function () {});
      selectionChanged();
    }

    function performAction(action) {
      if (action === 'bibliography') { insertBibliography(); return; }
      if (action === 'refresh') { refresh(); return; }
      if (action === 'unlink') { unlink(); return; }
      if (action === 'preferences') { el.styleSearch.focus(); setStylePickerOpen(true); return; }
      el.search.focus();
    }

    function init() {
      localize();
      if (options.isWord) {
        try { fieldsSupported = !!(Office.context.requirements && Office.context.requirements.isSetSupported('WordApi', '1.5')); }
        catch (_) { fieldsSupported = false; }
      }
      if (!fieldsSupported) options.setStatus(C.wordFieldsUnsupported, 'err');
      loadPreferences();
      loadStyles().then(function () { loadPreferences(); renderStyleOptions(''); syncStyleSearchDisplay(); })
        .catch(function (error) { options.setStatus(error.message, 'err'); });
      el.styleSearch.placeholder = C.styleSearch; el.styleSearch.setAttribute('aria-label', C.styleSearch);
      el.styleSearch.onfocus = function () { if (!stylePickerOpen) setStylePickerOpen(true); };
      el.styleSearch.onclick = function () { if (!stylePickerOpen) setStylePickerOpen(true); };
      el.styleSearch.oninput = function () { if (!stylePickerOpen) setStylePickerOpen(true); activeStyleIndex = 0; renderStyleOptions(el.styleSearch.value); };
      el.styleSearch.onkeydown = function (event) {
        var optionCount = el.styleOptions.querySelectorAll('.reference-style-option').length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!stylePickerOpen) setStylePickerOpen(true);
          activeStyleIndex = optionCount ? (activeStyleIndex + (event.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount : 0;
          updateActiveStyleOption();
        } else if (event.key === 'Enter' && stylePickerOpen) {
          var selectedOption = el.styleOptions.querySelectorAll('.reference-style-option')[activeStyleIndex];
          if (selectedOption) { event.preventDefault(); selectedOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
        } else if (event.key === 'Escape' && stylePickerOpen) {
          event.preventDefault(); setStylePickerOpen(false);
        }
      };
      el.styleToggle.onclick = function () {
        setStylePickerOpen(!stylePickerOpen);
        if (stylePickerOpen) el.styleSearch.focus();
      };
      el.styleManager.onclick = openStyleManager;
      document.addEventListener('mousedown', function (event) {
        if (stylePickerOpen && !el.stylePicker.contains(event.target)) setStylePickerOpen(false);
      });
      window.addEventListener('focus', function () { if (active) loadStyles().catch(function () {}); });
      document.addEventListener('visibilitychange', function () { if (active && !document.hidden) loadStyles().catch(function () {}); });
      el.insert.onclick = insertCitation; el.clear.onclick = function () { selected = []; editingCitationId = null; renderComposer(); };
      el.bibliography.onclick = insertBibliography; el.refresh.onclick = refresh; el.unlink.onclick = unlink;
      [el.locale, el.placement, el.auto].forEach(function (control) { control.onchange = function () { preferenceChanged(control); }; });
      renderComposer();
    }

    return { init: init, setActive: setActive, search: search, selectionChanged: selectionChanged,
      setExternalState: setExternalState, performAction: performAction };
  }

  window.NodusReferences = { create: create };
})();
