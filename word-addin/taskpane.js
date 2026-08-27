/* global Office, Word */
(function () {
  'use strict';

  var TOKEN = (window.NODUS && window.NODUS.token) || '';
  var LANG = (window.NODUS && window.NODUS.lang) === 'en' ? 'en' : 'es';
  var DEBOUNCE_MS = 700;
  var PROMPT_POLL_MS = 700;
  var MIN_CHARS = 12;
  var CHAT_DOCUMENT_KEY_SETTING = 'nodusWordChatDocumentKeyV1';

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
  var searchMode = 'ideas'; // 'ideas' | 'passages' | 'references' | 'synonyms' | 'prompts' | 'chat'
  var insertTarget = 'body'; // 'body' | 'footnote'
  var footnoteSupported = true;
  var referenceController = null;
  var promptStyles = [];
  var promptModels = [];
  var promptSourceText = '';
  var promptOutputText = '';
  var promptOutputSourceText = '';
  var promptRequestSeq = 0;
  var promptGenerating = false;
  var promptSelectionPainted = false;
  var promptPollTimer = null;
  var promptPollBusy = false;
  var synonymLiveContext = null;
  var synonymRequestContext = null;
  var synonymRounds = [];
  var synonymModelLabel = '';
  var synonymRequestSeq = 0;
  var synonymGenerating = false;
  var synonymRangeSupported = true;
  var chatController = null;
  var chatPageSupported = true;
  var CHAT_CONTEXT_CHAR_LIMIT = 260000;
  var CHAT_SELECTION_CHAR_LIMIT = 40000;

  // The pane follows the Nodus UI language (injected by the copilot server).
  var STR = {
    es: {
      connecting: 'Conectando…',
      searchPlaceholder: 'Buscar ideas, autores u obras',
      searchTitle: 'Buscar',
      analyze: 'Analizar párrafo',
      emptyInitial: 'Coloca el cursor en un párrafo para ver ideas relacionadas.',
      untitled: 'Sin título',
      oneWork: '1 obra',
      manyWorks: ' obras',
      searchCopied: 'búsqueda copiada',
      openedInNodus: 'Abierto en Nodus',
      connections: 'Conexiones',
      noConnections: 'Sin conexiones directas.',
      open: 'Abrir',
      loadingIdea: 'Cargando idea…',
      sources: 'Fuentes',
      noWorks: 'Sin obras asociadas.',
      ideaLoadError: 'Error al cargar la idea: ',
      inserting: 'Insertando…',
      ideaInserted: 'Idea insertada',
      details: 'Detalles',
      openInNodus: 'Abrir en Nodus',
      insertWithAi: 'Insertar con IA',
      noRelated: 'Sin ideas relacionadas para este párrafo.',
      noSearchResults: 'Sin ideas para esa búsqueda.',
      cursorInParagraph: 'Coloca el cursor en un párrafo con texto.',
      findingRelated: 'Buscando ideas relacionadas…',
      needEmbeddings: 'Configura embeddings en Nodus para buscar relaciones.',
      queryError: 'Error al consultar Nodus: ',
      searching: 'Buscando ideas…',
      searchError: 'Error al buscar: ',
      connectedWorks: 'Conectado · {n} obras',
      connectedNoEmbeddings: 'Conectado (sin embeddings)',
      notResponding: 'Nodus no responde · abre Nodus con el copiloto activado',
      editorNotListening: 'LibreOffice no está escuchando. Ejecuta la macro start_nodus_copilot en Writer.',
      wordOnly: 'Este complemento solo funciona en Word.',
      nodusError: 'Error de Nodus',
      modeIdeas: 'Ideas',
      modePassages: 'Pasajes',
      modeReferences: 'Referencias',
      modeSynonyms: 'Sinónimos',
      modePrompts: 'AI Edition',
      modeChat: 'Chat',
      selectionLabel: 'Selección',
      composeRewrite: 'Reescribir',
      composeExpand: 'Ampliar',
      composeCounter: 'Rebatir',
      insertInLabel: 'Insertar en',
      targetBody: 'Texto',
      targetFootnote: 'Nota al pie',
      footnoteUnsupported: 'Tu versión de Word no admite notas al pie desde el complemento.',
      working: 'Trabajando…',
      needSelection: 'Selecciona el texto que quieres reescribir.',
      composeEmpty: 'La IA no devolvió texto.',
      rewriteDone: 'Reescrito',
      expandDone: 'Ampliado',
      counterDone: 'Contraargumento insertado',
      citationsUsed: 'Citas usadas',
      insertQuote: 'Insertar cita',
      quoteInserted: 'Cita insertada',
      searchingPassages: 'Buscando pasajes…',
      noPassages: 'Sin pasajes para esa búsqueda.',
      passagesNotIndexed: 'No hay texto completo indexado. Indexa la biblioteca en Nodus.',
      passageUnreadable: 'Este pasaje no contiene texto Unicode legible. Reconstruye su texto limpio en Nodus.',
      promptTitle: 'Transformar selección',
      promptHint: 'Usa un prompt guardado en el workspace y revisa el resultado antes de reemplazar nada.',
      promptStyle: 'Prompt guardado',
      promptModel: 'Modelo',
      promptSelection: 'Texto seleccionado en Word',
      promptSelectionEmpty: 'Selecciona texto en Word para transformarlo.',
      promptRefresh: 'Actualizar texto seleccionado',
      promptGenerate: 'Generar propuesta',
      promptGenerating: 'Generando…',
      promptProposal: 'Propuesta',
      promptCopy: 'Copiar',
      promptPaste: 'Pegar y reemplazar selección',
      promptCopied: 'Propuesta copiada',
      promptPasted: 'Selección reemplazada',
      promptSelectionChanged: 'La selección de Word ha cambiado. Vuelve a seleccionar el texto original antes de pegar.',
      promptOutputStale: 'Esta propuesta se generó con otra selección. Vuelve a seleccionar ese texto para poder pegarla.',
      promptLoading: 'Cargando prompts del workspace…',
      promptLoadError: 'No se pudieron cargar los prompts: ',
      promptNoStyles: 'No hay prompts activos en este workspace.',
      promptNoModels: 'No hay modelos configurados en Nodus.',
      promptGeneratedWith: 'Generado con ',
      promptWarnings: 'Revisa: ',
      synonymTitle: 'Sinónimos y reformulaciones',
      synonymHint: 'Selecciona una o varias palabras. Nodus usa la frase completa para conservar el sentido y la gramática.',
      synonymContextLabel: 'Contexto de la frase',
      synonymSelectionEmpty: 'Selecciona una o varias palabras en Word.',
      synonymRefresh: 'Actualizar selección',
      synonymGenerate: 'Generar 5 alternativas',
      synonymRegenerate: 'Regenerar alternativas',
      synonymGenerating: 'Buscando alternativas…',
      synonymLatest: 'Alternativas',
      synonymPrevious: 'Alternativas anteriores',
      synonymApply: 'Aplicar',
      synonymApplied: 'Alternativa aplicada',
      synonymOriginal: 'Sustituye «{text}»',
      synonymStale: 'La selección de Word ha cambiado. Vuelve a seleccionar el texto original para aplicar o regenerar estas alternativas.',
      synonymSelectionChanged: 'La selección de Word ha cambiado. Vuelve a seleccionar el texto original.',
      synonymRangeUnsupported: 'Esta alternativa necesita ampliar la selección. Actualiza Word para habilitar rangos contextuales.',
      synonymGeneratedWith: 'Generado con ',
      quoteOpen: '«',
      quoteClose: '»',
      relation: { supports: 'apoya', contradicts: 'contradice', refines: 'matiza', extends: 'amplía', related: 'relacionada' },
      kind: { idea: 'idea', note: 'nota', passage: 'pasaje', work: 'obra' },
    },
    en: {
      connecting: 'Connecting…',
      searchPlaceholder: 'Search ideas, authors or works',
      searchTitle: 'Search',
      analyze: 'Analyze paragraph',
      emptyInitial: 'Place the cursor in a paragraph to see related ideas.',
      untitled: 'Untitled',
      oneWork: '1 work',
      manyWorks: ' works',
      searchCopied: 'search copied',
      openedInNodus: 'Opened in Nodus',
      connections: 'Connections',
      noConnections: 'No direct connections.',
      open: 'Open',
      loadingIdea: 'Loading idea…',
      sources: 'Sources',
      noWorks: 'No linked works.',
      ideaLoadError: 'Could not load the idea: ',
      inserting: 'Inserting…',
      ideaInserted: 'Idea inserted',
      details: 'Details',
      openInNodus: 'Open in Nodus',
      insertWithAi: 'Insert with AI',
      noRelated: 'No related ideas for this paragraph.',
      noSearchResults: 'No ideas match that search.',
      cursorInParagraph: 'Place the cursor in a paragraph with text.',
      findingRelated: 'Finding related ideas…',
      needEmbeddings: 'Configure embeddings in Nodus to find relations.',
      queryError: 'Error querying Nodus: ',
      searching: 'Searching ideas…',
      searchError: 'Search error: ',
      connectedWorks: 'Connected · {n} works',
      connectedNoEmbeddings: 'Connected (no embeddings)',
      notResponding: 'Nodus is not responding · open Nodus with the copilot enabled',
      editorNotListening: 'LibreOffice is not listening. Run the start_nodus_copilot macro in Writer.',
      wordOnly: 'This add-in only works in Word.',
      nodusError: 'Nodus error',
      modeIdeas: 'Ideas',
      modePassages: 'Passages',
      modeReferences: 'References',
      modeSynonyms: 'Synonyms',
      modePrompts: 'AI Edition',
      modeChat: 'Chat',
      selectionLabel: 'Selection',
      composeRewrite: 'Rewrite',
      composeExpand: 'Expand',
      composeCounter: 'Counter',
      insertInLabel: 'Insert into',
      targetBody: 'Body',
      targetFootnote: 'Footnote',
      footnoteUnsupported: 'Your Word version does not support add-in footnotes.',
      working: 'Working…',
      needSelection: 'Select the text you want to rewrite.',
      composeEmpty: 'The AI returned no text.',
      rewriteDone: 'Rewritten',
      expandDone: 'Expanded',
      counterDone: 'Counterargument inserted',
      citationsUsed: 'Citations used',
      insertQuote: 'Insert quote',
      quoteInserted: 'Quote inserted',
      searchingPassages: 'Searching passages…',
      noPassages: 'No passages match that search.',
      passagesNotIndexed: 'No full text indexed. Index your library in Nodus.',
      passageUnreadable: 'This passage has no readable Unicode text. Rebuild its clean text in Nodus.',
      promptTitle: 'Transform selection',
      promptHint: 'Use a saved workspace prompt, then review the result before replacing anything.',
      promptStyle: 'Saved prompt',
      promptModel: 'Model',
      promptSelection: 'Selected text in Word',
      promptSelectionEmpty: 'Select text in Word to transform it.',
      promptRefresh: 'Refresh selected text',
      promptGenerate: 'Generate proposal',
      promptGenerating: 'Generating…',
      promptProposal: 'Proposal',
      promptCopy: 'Copy',
      promptPaste: 'Paste and replace selection',
      promptCopied: 'Proposal copied',
      promptPasted: 'Selection replaced',
      promptSelectionChanged: 'The Word selection changed. Select the original text again before pasting.',
      promptOutputStale: 'This proposal came from a different selection. Select that text again to paste it.',
      promptLoading: 'Loading workspace prompts…',
      promptLoadError: 'Could not load prompts: ',
      promptNoStyles: 'There are no active prompts in this workspace.',
      promptNoModels: 'There are no models configured in Nodus.',
      promptGeneratedWith: 'Generated with ',
      promptWarnings: 'Review: ',
      synonymTitle: 'Synonyms and rephrasings',
      synonymHint: 'Select one or more words. Nodus uses the complete sentence to preserve meaning and grammar.',
      synonymContextLabel: 'Sentence context',
      synonymSelectionEmpty: 'Select one or more words in Word.',
      synonymRefresh: 'Refresh selection',
      synonymGenerate: 'Generate 5 alternatives',
      synonymRegenerate: 'Regenerate alternatives',
      synonymGenerating: 'Finding alternatives…',
      synonymLatest: 'Alternatives',
      synonymPrevious: 'Previous alternatives',
      synonymApply: 'Apply',
      synonymApplied: 'Alternative applied',
      synonymOriginal: 'Replaces “{text}”',
      synonymStale: 'The Word selection changed. Select the original text again to apply or regenerate these alternatives.',
      synonymSelectionChanged: 'The Word selection changed. Select the original text again.',
      synonymRangeUnsupported: 'This alternative needs a wider selection. Update Word to enable contextual ranges.',
      synonymGeneratedWith: 'Generated with ',
      quoteOpen: '“',
      quoteClose: '”',
      relation: { supports: 'supports', contradicts: 'contradicts', refines: 'refines', extends: 'extends', related: 'related' },
      kind: { idea: 'idea', note: 'note', passage: 'passage', work: 'work' },
    },
  };

  function T(key) {
    var table = STR[LANG] || STR.en;
    return table[key] !== undefined ? table[key] : STR.en[key];
  }

  var RELATION_LABEL = T('relation');
  var KIND_LABEL = T('kind');

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.text().then(function (raw) {
        var data = raw ? JSON.parse(raw) : {};
        if (!res.ok) throw new Error(data.error || res.statusText || T('nodusError'));
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
    var dark = isDarkColor(bg);
    // Office can report a dark body together with a white control background.
    // Let the semantic body palettes in CSS keep every surface coherent instead
    // of copying that contradictory control colour into cards and active tabs.
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.classList.toggle('light', !dark);
    document.body.classList.toggle('dark', dark);
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

  function sampleChatText(value) {
    var text = String(value || '').replace(/\r\n/g, '\n');
    if (text.length <= CHAT_CONTEXT_CHAR_LIMIT) {
      return { text: text, truncated: false, totalChars: text.length };
    }
    var marker = LANG === 'es'
      ? '\n\n[… contenido intermedio omitido por longitud …]\n\n'
      : '\n\n[… middle content omitted because of length …]\n\n';
    var available = CHAT_CONTEXT_CHAR_LIMIT - marker.length;
    var head = Math.floor(available * 0.65);
    return {
      text: text.slice(0, head) + marker + text.slice(text.length - (available - head)),
      truncated: true,
      totalChars: text.length,
    };
  }

  function packagedChatContext(scope, label, text, selectionText) {
    var sampled = sampleChatText(text);
    var rawSelection = String(selectionText || '').trim();
    return {
      scope: scope,
      label: label,
      text: sampled.text,
      selectionText: rawSelection.slice(0, CHAT_SELECTION_CHAR_LIMIT),
      selectionTruncated: rawSelection.length > CHAT_SELECTION_CHAR_LIMIT,
      selectionTotalChars: rawSelection.length,
      truncated: sampled.truncated,
      totalChars: sampled.totalChars,
    };
  }

  function randomChatDocumentKey() {
    try {
      var bytes = new Uint32Array(4);
      window.crypto.getRandomValues(bytes);
      return 'doc-' + Array.prototype.map.call(bytes, function (value) { return value.toString(36); }).join('-');
    } catch (error) {
      return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
  }

  function resolveChatDocumentKey() {
    if (!isWord) {
      var sessionKey = '';
      try {
        sessionKey = sessionStorage.getItem(CHAT_DOCUMENT_KEY_SETTING) || '';
        if (!sessionKey) {
          sessionKey = randomChatDocumentKey();
          sessionStorage.setItem(CHAT_DOCUMENT_KEY_SETTING, sessionKey);
        }
      } catch (error) {
        sessionKey = randomChatDocumentKey();
      }
      return 'editor-' + sessionKey;
    }
    try {
      var settings = Office.context && Office.context.document && Office.context.document.settings;
      var stored = settings && settings.get(CHAT_DOCUMENT_KEY_SETTING);
      if (typeof stored === 'string' && stored) return stored;
      var created = randomChatDocumentKey();
      if (settings) {
        settings.set(CHAT_DOCUMENT_KEY_SETTING, created);
        settings.saveAsync(function () {});
      }
      return created;
    } catch (error) {
      var identity = Office.context && Office.context.document
        ? String(Office.context.document.url || Office.context.document.name || '')
        : '';
      return identity ? 'word-' + hash(identity) : randomChatDocumentKey();
    }
  }

  function readWordDocumentChatContext() {
    return Word.run(function (context) {
      var body = context.document.body;
      var selection = context.document.getSelection();
      body.load('text');
      selection.load('text');
      return context.sync().then(function () {
        return packagedChatContext(
          'document',
          LANG === 'es' ? 'Documento completo' : 'Full document',
          body.text || '',
          selection.text || ''
        );
      });
    });
  }

  function readWordPageChatContext() {
    return Word.run(function (context) {
      var selection = context.document.getSelection();
      var pages = selection.pages;
      selection.load('text');
      pages.load('items');
      return context.sync().then(function () {
        if (!pages.items.length) throw new Error(LANG === 'es' ? 'No se pudo identificar la página actual.' : 'The current page could not be identified.');
        // A selection can cross a page boundary. "Current page" means the page
        // where that selection begins, which is also the sole page for a caret.
        var page = pages.items[0];
        var pageRange = page.getRange();
        page.load('index');
        pageRange.load('text');
        return context.sync().then(function () {
          return packagedChatContext(
            'page',
            (LANG === 'es' ? 'Página ' : 'Page ') + page.index,
            pageRange.text || '',
            selection.text || ''
          );
        });
      });
    });
  }

  function readChatContext(scope) {
    if (!isWord) {
      return Promise.resolve(packagedChatContext(
        scope === 'document' ? 'document' : 'page',
        LANG === 'es' ? 'Contexto del editor' : 'Editor context',
        currentParagraphText,
        currentSelectionText
      ));
    }
    if (scope === 'page' && chatPageSupported) {
      return readWordPageChatContext().catch(function (pageError) {
        return readWordDocumentChatContext().then(function (context) {
          context.pageFallback = true;
          context.pageFallbackReason = String((pageError && pageError.message) || pageError || '');
          return context;
        });
      });
    }
    return readWordDocumentChatContext();
  }

  function synonymSentenceContext(source, from, to) {
    var safeFrom = Math.max(0, Math.min(source.length, Math.trunc(from)));
    var safeTo = Math.max(safeFrom, Math.min(source.length, Math.trunc(to)));
    var sentenceFrom = 0;
    var index;
    for (index = safeFrom - 1; index >= 0; index--) {
      var before = source.charAt(index);
      if (before === '\n' || (/[.!?…。！？]/u.test(before) && /\s/u.test(source.charAt(index + 1)))) {
        sentenceFrom = index + 1;
        break;
      }
    }
    while (sentenceFrom < safeFrom && /\s/u.test(source.charAt(sentenceFrom))) sentenceFrom++;

    var sentenceTo = source.length;
    for (index = safeTo; index < source.length; index++) {
      var after = source.charAt(index);
      if (after === '\n') { sentenceTo = index; break; }
      if (/[.!?…。！？]/u.test(after)) { sentenceTo = index + 1; break; }
    }
    while (sentenceTo > safeTo && /\s/u.test(source.charAt(sentenceTo - 1))) sentenceTo--;
    return {
      sentence: source.slice(sentenceFrom, sentenceTo),
      sentenceFrom: sentenceFrom,
      sentenceTo: sentenceTo,
      selectionFrom: safeFrom - sentenceFrom,
      selectionTo: safeTo - sentenceFrom,
    };
  }

  function locateUniqueSelection(paragraphText, selectedText) {
    var first = paragraphText.indexOf(selectedText);
    if (first < 0 || paragraphText.indexOf(selectedText, first + 1) >= 0) return -1;
    return first;
  }

  function buildSynonymContext(paragraphText, selectedText, paragraphSelectionFrom) {
    if (!selectedText || !selectedText.trim()) return null;
    var paragraphSelectionTo = paragraphSelectionFrom + selectedText.length;
    if (paragraphSelectionFrom < 0 || paragraphText.slice(paragraphSelectionFrom, paragraphSelectionTo) !== selectedText) return null;
    var sentence = synonymSentenceContext(paragraphText, paragraphSelectionFrom, paragraphSelectionTo);
    return {
      paragraphText: paragraphText,
      paragraphSelectionFrom: paragraphSelectionFrom,
      selectedText: selectedText,
      sentence: sentence.sentence,
      sentenceFrom: sentence.sentenceFrom,
      selectionFrom: sentence.selectionFrom,
      selectionTo: sentence.selectionTo,
    };
  }

  function readSynonymSelectionContext() {
    if (!isWord) {
      var externalSelection = String(currentSelectionText || '');
      var externalParagraph = String(currentParagraphText || '');
      return Promise.resolve(buildSynonymContext(
        externalParagraph,
        externalSelection,
        locateUniqueSelection(externalParagraph, externalSelection)
      ));
    }
    return Word.run(async function (context) {
      var selection = context.document.getSelection();
      var paragraph = selection.paragraphs.getFirst();
      var paragraphRange = paragraph.getRange();
      var prefix = null;
      selection.load('text');
      paragraph.load('text');
      if (synonymRangeSupported) {
        prefix = paragraphRange.getRange(Word.RangeLocation.start)
          .expandTo(selection.getRange(Word.RangeLocation.start));
        prefix.load('text');
      }
      await context.sync();
      var selectedText = String(selection.text || '');
      var paragraphText = String(paragraph.text || '');
      var from = prefix ? String(prefix.text || '').length : locateUniqueSelection(paragraphText, selectedText);
      var result = buildSynonymContext(paragraphText, selectedText, from);
      // Some Word builds count an adjacent control character in the expanded
      // prefix. A unique literal occurrence is a safe compatibility fallback.
      if (!result) result = buildSynonymContext(paragraphText, selectedText, locateUniqueSelection(paragraphText, selectedText));
      return result;
    }).catch(function () {
      return null;
    });
  }

  function insertAtCursor(text, opts) {
    opts = opts || {};
    var asFootnote = !!opts.asFootnote && footnoteSupported;
    var replace = !!opts.replace;
    if (!isWord) {
      return api('/api/editor/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, asFootnote: !!opts.asFootnote, replace: replace })
      }).then(function (result) {
        // The server accepts the text but only a long-polling macro can place
        // it in the document; surface the miss instead of a silent no-op.
        if (result && result.delivered === false) throw new Error(T('editorNotListening'));
        return result;
      });
    }
    return Word.run(function (context) {
      var range = context.document.getSelection();
      if (asFootnote) {
        // A footnote is anchored at the end of the selection; its own text needs
        // no leading space and never replaces the selected body text.
        range.insertFootnote(text);
        return context.sync();
      }
      if (replace) {
        range.insertText(text, Word.InsertLocation.replace);
        return context.sync();
      }
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
    return item.label || item.targetLabel || item.globalId || item.targetId || T('untitled');
  }

  function subtitleFor(item) {
    if (item.workCount != null) {
      var parts = [];
      parts.push(item.workCount === 1 ? T('oneWork') : item.workCount + T('manyWorks'));
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
          copied.textContent = T('searchCopied');
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
      setStatus(T('openedInNodus'), 'ok');
    }).catch(function (e) {
      setStatus(e.message, 'err');
    });
  }

  function renderConnections(container, detail) {
    var wrap = textEl('div', 'detail-section', '');
    wrap.appendChild(textEl('div', 'section-title', T('connections')));
    if (!detail.connections || !detail.connections.length) {
      wrap.appendChild(textEl('p', 'muted', T('noConnections')));
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
      row.appendChild(button(T('open'), 'btn tiny', function () { openInNodus(connection.otherId); }));
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
    detail.appendChild(textEl('div', 'spin', T('loadingIdea')));
    card.appendChild(detail);

    function draw(payload) {
      detail.innerHTML = '';
      var idea = payload.idea;
      detail.appendChild(textEl('p', 'statement', idea.idea.statement));

      var sourceWrap = textEl('div', 'detail-section', '');
      sourceWrap.appendChild(textEl('div', 'section-title', T('sources')));
      if (!idea.occurrences.length) {
        sourceWrap.appendChild(textEl('p', 'muted', T('noWorks')));
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
      detail.textContent = T('ideaLoadError') + e.message;
    });
  }

  function insertIdea(ideaId, btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = T('inserting');
    Promise.all([getCurrentParagraph(), getSelectionText()])
      .then(function (values) {
        return api('/api/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideaId: ideaId, paragraphText: values[0], selectionText: values[1] }),
        });
      })
      .then(function (result) {
        return insertAtCursor(result.text, { asFootnote: insertTarget === 'footnote' }).then(function () {
          setStatus(T('ideaInserted'), 'ok');
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
        actions.appendChild(button(T('details'), 'btn small', function () { renderDetail(card, ideaId); }));
        actions.appendChild(button(T('openInNodus'), 'btn small', function () { openInNodus(ideaId); }));
        actions.appendChild(button(T('insertWithAi'), 'btn small primary', function () { insertIdea(ideaId, this); }));
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
    renderItems(sorted, T('noRelated'));
  }

  function renderSearch(ideas) {
    renderItems(ideas, T('noSearchResults'));
  }

  function analyze(force) {
    if (searchMode === 'references' || searchMode === 'prompts' || searchMode === 'synonyms' || searchMode === 'chat') return;
    if (els.searchBox.value.trim()) return;
    getCurrentParagraph().then(function (text) {
      els.paragraph.textContent = text ? text.slice(0, 360) : '';
      if (text.length < MIN_CHARS) {
        renderEmpty(T('cursorInParagraph'));
        lastHash = '';
        return;
      }
      var h = hash(text);
      if (!force && h === lastHash) return;
      lastHash = h;

      var seq = ++requestSeq;
      els.empty.style.display = 'block';
      els.empty.textContent = T('findingRelated');
      els.results.innerHTML = '';

      api('/api/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
      })
        .then(function (data) {
          if (seq !== requestSeq) return;
          if (!data.available) {
            renderEmpty(T('needEmbeddings'));
            return;
          }
          renderRelations(data.relations || []);
        })
        .catch(function (e) {
          if (seq !== requestSeq) return;
          renderEmpty(T('queryError') + e.message);
        });
    });
  }

  function runSearch() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    var query = els.searchBox.value.trim();
    if (searchMode === 'prompts' || searchMode === 'synonyms' || searchMode === 'chat') return;
    if (searchMode === 'references') {
      if (referenceController) referenceController.search(query);
      return;
    }
    if (query.length < 2) {
      analyze(true);
      return;
    }
    if (searchMode === 'passages') {
      searchPassages(query);
      return;
    }
    var seq = ++requestSeq;
    els.paragraph.textContent = '';
    els.empty.style.display = 'block';
    els.empty.textContent = T('searching');
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
        renderEmpty(T('searchError') + e.message);
      });
  }

  function searchPassages(query) {
    var seq = ++requestSeq;
    els.paragraph.textContent = '';
    els.empty.style.display = 'block';
    els.empty.textContent = T('searchingPassages');
    els.results.innerHTML = '';

    api('/api/passages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, limit: 30 }),
    })
      .then(function (data) {
        if (seq !== requestSeq) return;
        if (!data.available) {
          renderEmpty(T('needEmbeddings'));
          return;
        }
        if (!data.indexed) {
          renderEmpty(T('passagesNotIndexed'));
          return;
        }
        renderPassages(data.passages || []);
      })
      .catch(function (e) {
        if (seq !== requestSeq) return;
        renderEmpty(T('searchError') + e.message);
      });
  }

  function renderPassages(passages) {
    els.results.innerHTML = '';
    if (!passages.length) {
      renderEmpty(T('noPassages'));
      return;
    }
    els.empty.style.display = 'none';

    passages.forEach(function (passage) {
      var card = textEl('article', 'card', '');

      var row = textEl('div', 'row', '');
      row.appendChild(textEl('span', 'badge passage', KIND_LABEL.passage || 'passage'));
      row.appendChild(textEl('span', 'label', passage.workTitle || T('untitled')));
      if (passage.similarity) row.appendChild(textEl('span', 'pct', Math.round(passage.similarity * 100) + '%'));
      card.appendChild(row);

      var meta = [passage.authorYear, passage.pageLabel].filter(Boolean).join(' · ');
      if (meta) card.appendChild(textEl('div', 'subtitle', meta));
      var readableSnippet = readablePassageText(passage.snippet || passage.text);
      if (readableSnippet) card.appendChild(textEl('p', 'rationale', readableSnippet));
      else card.appendChild(textEl('p', 'rationale muted', T('passageUnreadable')));

      var actions = textEl('div', 'actions', '');
      var insertQuote = button(T('insertQuote'), 'btn small primary', function () { insertPassageQuote(passage, this); });
      insertQuote.disabled = !readablePassageText(passage.text || passage.snippet);
      actions.appendChild(insertQuote);
      appendZoteroAction(actions, passage);
      if (actions.childNodes.length) card.appendChild(actions);

      els.results.appendChild(card);
    });
  }

  function insertPassageQuote(passage, btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = T('inserting');
    var body = readablePassageText(passage.text || passage.snippet);
    if (!body) {
      setStatus(T('passageUnreadable'), 'err');
      btn.disabled = true;
      return;
    }
    var quote = T('quoteOpen') + body + T('quoteClose');
    if (passage.authorYear) quote += ' (' + passage.authorYear + ')';
    insertAtCursor(quote, { asFootnote: insertTarget === 'footnote' })
      .then(function () { setStatus(T('quoteInserted'), 'ok'); })
      .catch(function (e) { setStatus(e.message, 'err'); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  function readablePassageText(value) {
    var text = String(value || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    // Broken PDF character maps commonly arrive as one replacement/box glyph
    // per source character. Once that has happened the original letters cannot
    // be reconstructed safely, so do not present or insert corrupted quotations.
    var suspicious = (text.match(/[\uFFFD\u25A1\u2610\u2612]/g) || []).length;
    var meaningful = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    if (suspicious > 2 && suspicious > meaningful * 0.12) return '';
    return text.normalize ? text.normalize('NFC') : text;
  }

  var COMPOSE_DONE = { rewrite: 'rewriteDone', expand: 'expandDone', counter: 'counterDone' };

  function runCompose(mode, btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = T('working');
    Promise.all([getCurrentParagraph(), getSelectionText()])
      .then(function (values) {
        var paragraphText = values[0];
        var selectionText = values[1];
        if (mode === 'rewrite' && !selectionText) {
          setStatus(T('needSelection'), 'err');
          return null;
        }
        return api('/api/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode, selectionText: selectionText, paragraphText: paragraphText }),
        });
      })
      .then(function (result) {
        if (!result) return;
        if (!result.available) {
          setStatus(T('needEmbeddings'), 'err');
          return;
        }
        if (!result.text) {
          setStatus(T('composeEmpty'), 'err');
          return;
        }
        // Rewrite replaces the selected body text; expand/counter append and may
        // be routed to a footnote per the user's target choice.
        var replace = mode === 'rewrite';
        var asFootnote = mode !== 'rewrite' && insertTarget === 'footnote';
        return insertAtCursor(result.text, { asFootnote: asFootnote, replace: replace }).then(function () {
          setStatus(T(COMPOSE_DONE[mode] || 'ideaInserted'), 'ok');
          renderComposeCitations(result.citations);
        });
      })
      .catch(function (e) { setStatus((e && e.message) || String(e), 'err'); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  function renderComposeCitations(citations) {
    if (!citations || !citations.length) return;
    els.empty.style.display = 'none';
    els.results.innerHTML = '';
    els.results.appendChild(textEl('div', 'section-title', T('citationsUsed')));
    citations.forEach(function (citation) {
      var card = textEl('article', 'card', '');
      var row = textEl('div', 'row', '');
      row.appendChild(textEl('span', 'badge idea', KIND_LABEL.work || 'work'));
      row.appendChild(textEl('span', 'label', citation.label || T('untitled')));
      card.appendChild(row);
      if (citation.authorYear) card.appendChild(textEl('div', 'subtitle', citation.authorYear));
      var actions = textEl('div', 'actions', '');
      appendZoteroAction(actions, citation);
      if (actions.childNodes.length) card.appendChild(actions);
      els.results.appendChild(card);
    });
  }

  function normalizedSelection(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function promptModelValue(model) {
    return model ? String(model.provider || '') + '\n' + String(model.model || '') : '';
  }

  function selectedPromptModel() {
    var value = els.promptModel.value;
    for (var i = 0; i < promptModels.length; i++) {
      if (promptModelValue(promptModels[i]) === value) {
        return { provider: promptModels[i].provider, model: promptModels[i].model };
      }
    }
    return null;
  }

  function clearPromptOutput() {
    promptOutputText = '';
    promptOutputSourceText = '';
    els.promptOutput.value = '';
    els.promptOutputMeta.textContent = '';
    els.promptWarnings.textContent = '';
    els.promptWarnings.hidden = true;
    els.promptOutputWrap.hidden = true;
    updatePromptOutputState();
  }

  // A generated proposal only disappears on the next generation: moving the
  // Word selection re-reads the source text but never throws away tokens that
  // were already paid for. While the selection differs from the one that
  // produced the proposal, the proposal stays readable but cannot be pasted
  // over the wrong text.
  function updatePromptOutputState() {
    var stale = !!promptOutputText && promptSourceText !== promptOutputSourceText;
    els.promptOutputStale.textContent = stale ? T('promptOutputStale') : '';
    els.promptOutputStale.hidden = !stale;
    els.pastePromptOutput.disabled = !promptOutputText || stale;
  }

  function updatePromptGenerateState() {
    els.applyPrompt.disabled = promptGenerating || !promptSourceText || !els.promptStyle.value || !selectedPromptModel();
  }

  function setPromptGenerating(generating) {
    var settled = promptGenerating && !generating;
    promptGenerating = generating;
    els.applyPrompt.classList.toggle('is-generating', generating);
    if (els.promptTab) els.promptTab.classList.toggle('is-busy', generating);
    if (settled) paintPromptSelection(promptSourceText);
    if (generating) {
      els.applyPrompt.setAttribute('aria-busy', 'true');
      els.applyPrompt.setAttribute('aria-label', T('promptGenerating'));
    } else {
      els.applyPrompt.removeAttribute('aria-busy');
      els.applyPrompt.setAttribute('aria-label', T('promptGenerate'));
    }
    els.promptGenerateLabel.hidden = generating;
    els.promptTypingIndicator.hidden = !generating;
    updatePromptGenerateState();
  }

  function renderPromptDescription() {
    var selectedId = els.promptStyle.value;
    var style = promptStyles.find(function (entry) { return entry.id === selectedId; });
    els.promptDescription.textContent = style ? (style.description || '') : '';
    if (style && style.color) els.promptStyle.style.borderLeftColor = style.color;
    updatePromptGenerateState();
  }

  function paintPromptSelection(text) {
    promptSelectionPainted = true;
    els.promptSelection.textContent = text || T('promptSelectionEmpty');
    els.promptSelection.classList.toggle('placeholder', !text);
  }

  function refreshPromptSelection() {
    return getSelectionText().then(function (value) {
      var text = normalizedSelection(value);
      var changed = text !== promptSourceText;
      promptSourceText = text;
      // While a proposal is generating the box keeps showing the text that was
      // actually sent: moving the cursor in Word must never look like it
      // redirected the generation. Only pressing Generate again does that. The
      // live selection returns the moment the generation settles.
      // Repainting an unchanged box would also drop any in-pane text selection.
      if (!promptGenerating && (changed || !promptSelectionPainted)) paintPromptSelection(text);
      updatePromptGenerateState();
      updatePromptOutputState();
      return text;
    });
  }

  // Word's DocumentSelectionChanged does not fire for every way of selecting
  // text (dragging inside a paragraph is the usual miss), which used to leave
  // the box stale until an unrelated control forced a refresh. While the
  // prompts tab is open the pane also polls the selection itself.
  function startPromptSelectionPolling() {
    if (promptPollTimer) return;
    promptPollTimer = setInterval(function () {
      // Deliberately no document.hidden guard: an embedded webview can report
      // itself hidden while its pane is perfectly visible, and a poll that
      // stops without saying so is the very bug this exists to fix.
      if (promptPollBusy) return;
      promptPollBusy = true;
      var done = function () { promptPollBusy = false; };
      var refresh = searchMode === 'chat' && chatController
        ? chatController.selectionChanged
        : searchMode === 'synonyms'
          ? refreshSynonymSelection
          : refreshPromptSelection;
      refresh().then(done, done);
    }, PROMPT_POLL_MS);
  }

  function stopPromptSelectionPolling() {
    if (!promptPollTimer) return;
    clearInterval(promptPollTimer);
    promptPollTimer = null;
    promptPollBusy = false;
  }

  function fillPromptCatalogue(data) {
    var previousStyle = els.promptStyle.value;
    var previousModel = els.promptModel.value;
    promptStyles = Array.isArray(data.styles) ? data.styles : [];
    promptModels = Array.isArray(data.models) ? data.models : [];

    els.promptStyle.innerHTML = '';
    if (!promptStyles.length) {
      var noStyle = document.createElement('option');
      noStyle.value = '';
      noStyle.textContent = T('promptNoStyles');
      els.promptStyle.appendChild(noStyle);
      els.promptStyle.disabled = true;
    } else {
      els.promptStyle.disabled = false;
      promptStyles.forEach(function (style) {
        var option = document.createElement('option');
        option.value = style.id;
        option.textContent = style.name;
        els.promptStyle.appendChild(option);
      });
      var wantedStyle = promptStyles.some(function (style) { return style.id === previousStyle; })
        ? previousStyle
        : data.defaultStyleId;
      if (wantedStyle) els.promptStyle.value = wantedStyle;
    }

    els.promptModel.innerHTML = '';
    if (!promptModels.length) {
      var noModel = document.createElement('option');
      noModel.value = '';
      noModel.textContent = T('promptNoModels');
      els.promptModel.appendChild(noModel);
      els.promptModel.disabled = true;
    } else {
      els.promptModel.disabled = false;
      promptModels.forEach(function (model) {
        var option = document.createElement('option');
        option.value = promptModelValue(model);
        option.textContent = model.label || (model.provider + ' · ' + model.model);
        els.promptModel.appendChild(option);
      });
      var wantedModel = promptModels.some(function (model) { return promptModelValue(model) === previousModel; })
        ? previousModel
        : promptModelValue(data.defaultModel);
      if (wantedModel) els.promptModel.value = wantedModel;
    }
    renderPromptDescription();
  }

  function loadPromptCatalogue() {
    var seq = ++promptRequestSeq;
    setStatus(T('promptLoading'), '');
    return api('/api/prompts')
      .then(function (data) {
        if (seq !== promptRequestSeq) return;
        fillPromptCatalogue(data || {});
        checkHealth();
      })
      .catch(function (error) {
        if (seq !== promptRequestSeq) return;
        setStatus(T('promptLoadError') + error.message, 'err');
        promptStyles = [];
        promptModels = [];
        fillPromptCatalogue({ styles: [], models: [] });
      });
  }

  function runSavedPrompt() {
    var model = selectedPromptModel();
    var requestedSource = '';
    setPromptGenerating(true);
    clearPromptOutput();
    refreshPromptSelection()
      .then(function (selection) {
        requestedSource = selection;
        if (!selection) {
          setStatus(T('promptSelectionEmpty'), 'err');
          return null;
        }
        if (!els.promptStyle.value || !model) {
          setStatus(!model ? T('promptNoModels') : T('promptNoStyles'), 'err');
          return null;
        }
        return api('/api/prompts/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            styleId: els.promptStyle.value,
            selectionText: selection,
            model: model,
          }),
        });
      })
      .then(function (result) {
        if (!result) return;
        promptOutputText = String(result.text || '');
        if (!promptOutputText) throw new Error(T('composeEmpty'));
        promptOutputSourceText = requestedSource;
        els.promptOutput.value = promptOutputText;
        var used = result.model || model;
        var usedLabel = used && (used.label || (used.provider + ' · ' + used.model));
        els.promptOutputMeta.textContent = usedLabel ? T('promptGeneratedWith') + usedLabel : '';
        var warnings = Array.isArray(result.warnings) ? result.warnings : [];
        els.promptWarnings.textContent = warnings.length ? T('promptWarnings') + warnings.join(' · ') : '';
        els.promptWarnings.hidden = !warnings.length;
        els.promptOutputWrap.hidden = false;
        updatePromptOutputState();
        setStatus(T('promptProposal'), 'ok');
      })
      .catch(function (error) { setStatus((error && error.message) || String(error), 'err'); })
      .finally(function () {
        setPromptGenerating(false);
      });
  }

  function fallbackCopyPromptOutput() {
    els.promptOutput.focus();
    els.promptOutput.select();
    return document.execCommand && document.execCommand('copy');
  }

  function copyPromptOutput() {
    if (!promptOutputText) return;
    var copied = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(promptOutputText).catch(function () { return fallbackCopyPromptOutput(); })
      : Promise.resolve(fallbackCopyPromptOutput());
    Promise.resolve(copied)
      .then(function () { setStatus(T('promptCopied'), 'ok'); })
      .catch(function (error) { setStatus((error && error.message) || String(error), 'err'); });
  }

  function pastePromptOutput() {
    if (!promptOutputText) return;
    getSelectionText()
      .then(function (current) {
        if (normalizedSelection(current) !== promptOutputSourceText) throw new Error(T('promptSelectionChanged'));
        return insertAtCursor(promptOutputText, { replace: true });
      })
      .then(function () {
        setStatus(T('promptPasted'), 'ok');
        promptSourceText = promptOutputText;
        els.promptSelection.textContent = promptOutputText;
        clearPromptOutput();
      })
      .catch(function (error) { setStatus((error && error.message) || String(error), 'err'); });
  }

  function sameSynonymContext(left, right) {
    return !!left && !!right
      && left.paragraphText === right.paragraphText
      && left.paragraphSelectionFrom === right.paragraphSelectionFrom
      && left.selectedText === right.selectedText
      && left.sentence === right.sentence
      && left.selectionFrom === right.selectionFrom
      && left.selectionTo === right.selectionTo;
  }

  function paintSynonymContext(value) {
    els.synonymContext.innerHTML = '';
    if (!value) {
      els.synonymContext.textContent = T('synonymSelectionEmpty');
      els.synonymContext.classList.add('placeholder');
      return;
    }
    els.synonymContext.classList.remove('placeholder');
    els.synonymContext.appendChild(document.createTextNode(value.sentence.slice(0, value.selectionFrom)));
    var selected = document.createElement('mark');
    selected.textContent = value.selectedText;
    els.synonymContext.appendChild(selected);
    els.synonymContext.appendChild(document.createTextNode(value.sentence.slice(value.selectionTo)));
  }

  function synonymStateIsStale() {
    return !!synonymRequestContext && !sameSynonymContext(synonymLiveContext, synonymRequestContext);
  }

  function updateSynonymState() {
    var stale = synonymStateIsStale();
    els.synonymStale.textContent = stale ? T('synonymStale') : '';
    els.synonymStale.hidden = !stale;
    els.generateSynonyms.disabled = synonymGenerating || !synonymLiveContext;
    els.synonymGenerateLabel.textContent = synonymRounds.length && !stale
      ? T('synonymRegenerate')
      : T('synonymGenerate');
    var options = els.synonymRounds.querySelectorAll('.synonym-option');
    for (var i = 0; i < options.length; i++) options[i].disabled = synonymGenerating || stale;
  }

  function setSynonymGenerating(generating) {
    synonymGenerating = generating;
    els.generateSynonyms.classList.toggle('is-generating', generating);
    if (els.synonymTab) els.synonymTab.classList.toggle('is-busy', generating);
    if (generating) {
      els.generateSynonyms.setAttribute('aria-busy', 'true');
      els.generateSynonyms.setAttribute('aria-label', T('synonymGenerating'));
    } else {
      els.generateSynonyms.removeAttribute('aria-busy');
      els.generateSynonyms.setAttribute('aria-label', synonymRounds.length ? T('synonymRegenerate') : T('synonymGenerate'));
    }
    els.synonymGenerateLabel.hidden = generating;
    els.synonymTypingIndicator.hidden = !generating;
    updateSynonymState();
  }

  function refreshSynonymSelection() {
    return readSynonymSelectionContext().then(function (value) {
      synonymLiveContext = value;
      paintSynonymContext(value);
      updateSynonymState();
      return value;
    });
  }

  function appendSynonymOptions(container, alternatives) {
    alternatives.forEach(function (alternative) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'synonym-option';
      option.setAttribute('aria-label', T('synonymApply') + ': ' + alternative.replacement);
      var copy = textEl('span', 'synonym-option-copy', '');
      copy.appendChild(textEl('strong', '', alternative.replacement));
      if (alternative.target !== synonymRequestContext.selectedText) {
        copy.appendChild(textEl('small', '', T('synonymOriginal').replace('{text}', alternative.target)));
      }
      option.appendChild(copy);
      option.appendChild(textEl('span', 'synonym-option-arrow', '→'));
      option.onclick = function () { applySynonymAlternative(alternative); };
      container.appendChild(option);
    });
  }

  function renderSynonymRounds() {
    els.synonymRounds.innerHTML = '';
    if (!synonymRounds.length || !synonymRequestContext) {
      els.synonymRounds.hidden = true;
      updateSynonymState();
      return;
    }
    els.synonymRounds.hidden = false;
    var title = textEl('div', 'synonym-round-title', '');
    title.appendChild(textEl('strong', '', T('synonymLatest')));
    title.appendChild(textEl('span', '', synonymModelLabel ? T('synonymGeneratedWith') + synonymModelLabel : ''));
    els.synonymRounds.appendChild(title);
    var latest = textEl('div', 'synonym-list', '');
    appendSynonymOptions(latest, synonymRounds[synonymRounds.length - 1]);
    els.synonymRounds.appendChild(latest);

    if (synonymRounds.length > 1) {
      var history = document.createElement('details');
      history.className = 'synonym-history';
      var summary = document.createElement('summary');
      summary.textContent = T('synonymPrevious') + ' (' + ((synonymRounds.length - 1) * 5) + ')';
      history.appendChild(summary);
      var previous = textEl('div', 'synonym-list', '');
      synonymRounds.slice(0, -1).reverse().forEach(function (round) { appendSynonymOptions(previous, round); });
      history.appendChild(previous);
      els.synonymRounds.appendChild(history);
    }
    updateSynonymState();
  }

  function generateSynonymRound() {
    var requested = null;
    var seq = ++synonymRequestSeq;
    setSynonymGenerating(true);
    refreshSynonymSelection()
      .then(function (context) {
        requested = context;
        if (!context) throw new Error(T('synonymSelectionEmpty'));
        var continuing = sameSynonymContext(context, synonymRequestContext);
        var previous = continuing
          ? synonymRounds.reduce(function (all, round) {
            return all.concat(round.map(function (alternative) { return alternative.replacement; }));
          }, [])
          : [];
        if (!continuing) {
          synonymRounds = [];
          synonymRequestContext = null;
          synonymModelLabel = '';
          renderSynonymRounds();
        }
        return api('/api/synonyms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sentence: context.sentence,
            selectedText: context.selectedText,
            selectionFrom: context.selectionFrom,
            selectionTo: context.selectionTo,
            previousAlternatives: previous,
          }),
        });
      })
      .then(function (result) {
        if (!result || seq !== synonymRequestSeq) return;
        var alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
        if (alternatives.length !== 5) throw new Error(T('composeEmpty'));
        synonymRequestContext = requested;
        synonymRounds.push(alternatives);
        synonymModelLabel = [result.modelProvider, result.modelName].filter(Boolean).join(' · ');
        renderSynonymRounds();
        setStatus(T('synonymLatest'), 'ok');
      })
      .catch(function (error) {
        if (seq === synonymRequestSeq) setStatus((error && error.message) || String(error), 'err');
      })
      .finally(function () {
        if (seq === synonymRequestSeq) setSynonymGenerating(false);
      });
  }

  function replaceSynonymInWord(alternative, sourceContext) {
    if (!isWord) {
      if (alternative.target !== sourceContext.selectedText) return Promise.reject(new Error(T('synonymRangeUnsupported')));
      return insertAtCursor(alternative.replacement, { replace: true });
    }
    return Word.run(async function (context) {
      var selection = context.document.getSelection();
      selection.load('text');
      await context.sync();
      if (String(selection.text || '') !== sourceContext.selectedText) throw new Error(T('synonymSelectionChanged'));
      if (alternative.target === sourceContext.selectedText) {
        selection.insertText(alternative.replacement, Word.InsertLocation.replace);
        await context.sync();
        return;
      }
      if (!synonymRangeSupported) throw new Error(T('synonymRangeUnsupported'));
      var paragraphRange = selection.paragraphs.getFirst().getRange();
      var matches = paragraphRange.search(alternative.target, { matchCase: true, matchWildcards: false });
      matches.load('items');
      await context.sync();
      matches.items.forEach(function (match) { match.load('text'); });
      await context.sync();
      var candidates = [];
      for (var i = 0; i < matches.items.length; i++) {
        if (matches.items[i].text === alternative.target) {
          candidates.push({ range: matches.items[i], relation: matches.items[i].compareLocationWith(selection) });
        }
      }
      await context.sync();
      var matched = candidates.find(function (candidate) {
        var relation = String(candidate.relation.value || '').toLowerCase();
        return relation === 'contains' || relation === 'equal';
      });
      if (!matched) throw new Error(T('synonymSelectionChanged'));
      matched.range.insertText(alternative.replacement, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  function applySynonymAlternative(alternative) {
    if (!synonymRequestContext || synonymGenerating) return;
    var sourceContext = synonymRequestContext;
    readSynonymSelectionContext()
      .then(function (current) {
        if (!sameSynonymContext(current, sourceContext)) throw new Error(T('synonymSelectionChanged'));
        return replaceSynonymInWord(alternative, sourceContext);
      })
      .then(function () {
        synonymRounds = [];
        synonymRequestContext = null;
        synonymModelLabel = '';
        renderSynonymRounds();
        setStatus(T('synonymApplied'), 'ok');
        return refreshSynonymSelection();
      })
      .catch(function (error) { setStatus((error && error.message) || String(error), 'err'); });
  }

  function setSearchMode(mode) {
    if (mode === searchMode) return;
    searchMode = mode;
    var promptMode = mode === 'prompts';
    var synonymMode = mode === 'synonyms';
    var chatMode = mode === 'chat';
    var referenceMode = mode === 'references';
    var buttons = els.searchModeEl ? els.searchModeEl.querySelectorAll('.seg') : [];
    for (var i = 0; i < buttons.length; i++) {
      var selected = buttons[i].getAttribute('data-mode') === mode;
      buttons[i].classList.toggle('active', selected);
      buttons[i].setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    if (referenceController) referenceController.setActive(referenceMode);
    if (chatController) chatController.setActive(chatMode);
    els.searchControls.hidden = promptMode || synonymMode || chatMode;
    els.analysisControls.hidden = referenceMode || promptMode || synonymMode || chatMode;
    els.promptControls.hidden = !promptMode;
    els.synonymControls.hidden = !synonymMode;
    els.chatControls.hidden = !chatMode;
    els.paragraph.hidden = referenceMode || promptMode || synonymMode || chatMode;
    els.results.hidden = promptMode || synonymMode || chatMode;
    els.empty.hidden = promptMode || synonymMode || chatMode;
    if (promptMode) {
      refreshPromptSelection();
      loadPromptCatalogue();
      startPromptSelectionPolling();
      return;
    }
    if (synonymMode) {
      refreshSynonymSelection().then(function (context) {
        if (context && !synonymRequestContext && !synonymGenerating) generateSynonymRound();
      });
      startPromptSelectionPolling();
      return;
    }
    if (chatMode) {
      if (chatController) chatController.selectionChanged();
      startPromptSelectionPolling();
      return;
    }
    stopPromptSelectionPolling();
    if (referenceMode) {
      runSearch();
      return;
    }
    els.searchBox.placeholder = T('searchPlaceholder');
    if (els.searchBox.value.trim().length >= 2) runSearch();
    else analyze(true);
  }

  function onSelectionChanged() {
    if (searchMode === 'prompts' || searchMode === 'synonyms' || searchMode === 'chat') {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (searchMode === 'chat' && chatController) chatController.selectionChanged();
        else if (searchMode === 'synonyms') refreshSynonymSelection();
        else refreshPromptSelection();
      }, 180);
      return;
    }
    if (searchMode === 'references') {
      if (referenceController) referenceController.selectionChanged();
      return;
    }
    if (!autoAnalyze || els.searchBox.value.trim()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { analyze(false); }, DEBOUNCE_MS);
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, DEBOUNCE_MS);
  }

  function checkHealth() {
    api('/api/health')
      .then(function (data) {
        if (data.embeddingsConfigured) setStatus(T('connectedWorks').replace('{n}', data.corpusSize), 'ok');
        else setStatus(T('connectedNoEmbeddings'), 'ok');
      })
      .catch(function () { setStatus(T('notResponding'), 'err'); });
  }

  function startStandalonePolling() {
    function poll() {
      api('/api/editor/state')
        .then(function (state) {
          var changed = (state.paragraphText !== currentParagraphText || state.selectionText !== currentSelectionText);
          currentParagraphText = state.paragraphText || '';
          currentSelectionText = state.selectionText || '';
          if (referenceController) referenceController.setExternalState(state.references || null);
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
    els.searchControls = document.getElementById('searchControls');
    els.searchModeEl = document.getElementById('searchMode');
    els.analysisControls = document.getElementById('analysisControls');
    els.selectionActions = document.getElementById('selectionActions');
    els.insertTargetEl = document.getElementById('insertTarget');
    els.footnoteOption = document.getElementById('footnoteOption');
    els.footnoteRadio = document.getElementById('footnoteRadio');
    els.promptControls = document.getElementById('promptControls');
    els.promptStyle = document.getElementById('promptStyle');
    els.promptModel = document.getElementById('promptModel');
    els.promptDescription = document.getElementById('promptDescription');
    els.promptSelection = document.getElementById('promptSelection');
    els.refreshPromptSelection = document.getElementById('refreshPromptSelection');
    els.applyPrompt = document.getElementById('applyPrompt');
    els.promptGenerateLabel = document.getElementById('promptGenerateLabel');
    els.promptTypingIndicator = document.getElementById('promptTypingIndicator');
    els.promptOutputWrap = document.getElementById('promptOutputWrap');
    els.promptOutput = document.getElementById('promptOutput');
    els.promptOutputMeta = document.getElementById('promptOutputMeta');
    els.promptWarnings = document.getElementById('promptWarnings');
    els.promptOutputStale = document.getElementById('promptOutputStale');
    els.promptTab = document.querySelector('.seg[data-mode="prompts"]');
    els.copyPromptOutput = document.getElementById('copyPromptOutput');
    els.pastePromptOutput = document.getElementById('pastePromptOutput');
    els.synonymControls = document.getElementById('synonymControls');
    els.synonymContext = document.getElementById('synonymContext');
    els.refreshSynonymSelection = document.getElementById('refreshSynonymSelection');
    els.generateSynonyms = document.getElementById('generateSynonyms');
    els.synonymGenerateLabel = document.getElementById('synonymGenerateLabel');
    els.synonymTypingIndicator = document.getElementById('synonymTypingIndicator');
    els.synonymStale = document.getElementById('synonymStale');
    els.synonymRounds = document.getElementById('synonymRounds');
    els.synonymTab = document.querySelector('.seg[data-mode="synonyms"]');
    els.chatControls = document.getElementById('chatControls');

    document.documentElement.lang = LANG;
    els.status.textContent = T('connecting');
    els.searchBox.placeholder = T('searchPlaceholder');
    els.searchBtn.title = T('searchTitle');
    els.analyzeBtn.textContent = T('analyze');
    els.empty.textContent = T('emptyInitial');

    // Localize the compact tabs without replacing their inline SVG icons.
    var modeButtons = els.searchModeEl.querySelectorAll('.seg');
    for (var mi = 0; mi < modeButtons.length; mi++) {
      var mode = modeButtons[mi].getAttribute('data-mode');
      var modeLabel = mode === 'passages'
        ? T('modePassages')
        : mode === 'references'
          ? T('modeReferences')
          : mode === 'synonyms'
            ? T('modeSynonyms')
            : mode === 'prompts'
              ? T('modePrompts')
              : mode === 'chat'
                ? T('modeChat')
                : T('modeIdeas');
      var labelNode = modeButtons[mi].querySelector('.seg-label');
      if (labelNode) labelNode.textContent = modeLabel;
      modeButtons[mi].setAttribute('aria-label', modeLabel);
      modeButtons[mi].title = modeLabel;
    }
    var saLabel = els.selectionActions.querySelector('.sa-label');
    if (saLabel) saLabel.textContent = T('selectionLabel');
    var composeButtons = els.selectionActions.querySelectorAll('[data-compose]');
    for (var ci = 0; ci < composeButtons.length; ci++) {
      var cmode = composeButtons[ci].getAttribute('data-compose');
      composeButtons[ci].textContent = cmode === 'rewrite' ? T('composeRewrite') : cmode === 'expand' ? T('composeExpand') : T('composeCounter');
    }
    var itLabel = els.insertTargetEl.querySelector('.it-label');
    if (itLabel) itLabel.textContent = T('insertInLabel');
    var bodySpan = els.insertTargetEl.querySelector('[data-it="body"]');
    var footnoteSpan = els.insertTargetEl.querySelector('[data-it="footnote"]');
    if (bodySpan) bodySpan.textContent = T('targetBody');
    if (footnoteSpan) footnoteSpan.textContent = T('targetFootnote');

    var promptHeading = els.promptControls.querySelector('.prompt-heading div');
    if (promptHeading) {
      var promptHeadingTitle = promptHeading.querySelector('strong');
      var promptHeadingHint = promptHeading.querySelector('small');
      if (promptHeadingTitle) promptHeadingTitle.textContent = T('promptTitle');
      if (promptHeadingHint) promptHeadingHint.textContent = T('promptHint');
    }
    var promptStyleLabel = els.promptControls.querySelector('[data-prompt-label="style"]');
    var promptModelLabel = els.promptControls.querySelector('[data-prompt-label="model"]');
    var promptBlockLabel = els.promptControls.querySelector('.prompt-block-label');
    var promptProposalLabel = els.promptControls.querySelector('.prompt-output-head strong');
    if (promptStyleLabel) promptStyleLabel.textContent = T('promptStyle');
    if (promptModelLabel) promptModelLabel.textContent = T('promptModel');
    if (promptBlockLabel) promptBlockLabel.textContent = T('promptSelection');
    if (promptProposalLabel) promptProposalLabel.textContent = T('promptProposal');
    els.promptSelection.textContent = T('promptSelectionEmpty');
    els.refreshPromptSelection.title = T('promptRefresh');
    els.refreshPromptSelection.setAttribute('aria-label', T('promptRefresh'));
    els.promptGenerateLabel.textContent = T('promptGenerate');
    els.applyPrompt.setAttribute('aria-label', T('promptGenerate'));
    els.promptOutput.setAttribute('aria-label', T('promptProposal'));
    els.copyPromptOutput.textContent = T('promptCopy');
    els.pastePromptOutput.textContent = T('promptPaste');
    updatePromptOutputState();

    var synonymHeading = els.synonymControls.querySelector('.synonym-heading div');
    if (synonymHeading) {
      var synonymHeadingTitle = synonymHeading.querySelector('strong');
      var synonymHeadingHint = synonymHeading.querySelector('small');
      if (synonymHeadingTitle) synonymHeadingTitle.textContent = T('synonymTitle');
      if (synonymHeadingHint) synonymHeadingHint.textContent = T('synonymHint');
    }
    var synonymBlockLabel = els.synonymControls.querySelector('.synonym-block-label');
    if (synonymBlockLabel) synonymBlockLabel.textContent = T('synonymContextLabel');
    els.synonymContext.textContent = T('synonymSelectionEmpty');
    els.refreshSynonymSelection.title = T('synonymRefresh');
    els.refreshSynonymSelection.setAttribute('aria-label', T('synonymRefresh'));
    els.synonymGenerateLabel.textContent = T('synonymGenerate');
    els.generateSynonyms.setAttribute('aria-label', T('synonymGenerate'));
    updateSynonymState();

    // Footnotes need WordApi 1.5. Standalone (LibreOffice) relies on the macro,
    // which falls back to inline if its Writer build cannot place a footnote.
    if (isWord) {
      try {
        footnoteSupported = !!(Office.context.requirements && Office.context.requirements.isSetSupported('WordApi', '1.5'));
        synonymRangeSupported = !!(Office.context.requirements && Office.context.requirements.isSetSupported('WordApi', '1.3'));
        chatPageSupported = !!(Office.context.requirements && Office.context.requirements.isSetSupported('WordApiDesktop', '1.2'));
      } catch (e) {
        footnoteSupported = false;
        synonymRangeSupported = false;
        chatPageSupported = false;
      }
    }
    if (!footnoteSupported) {
      if (els.footnoteRadio) els.footnoteRadio.disabled = true;
      if (els.footnoteOption) {
        els.footnoteOption.classList.add('disabled');
        els.footnoteOption.title = T('footnoteUnsupported');
      }
    }

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
    els.searchBtn.onclick = runSearch;
    els.searchBox.oninput = onSearchInput;
    els.searchBox.onkeydown = function (event) {
      if (event.key === 'Enter') runSearch();
      if (event.key === 'Escape') {
        els.searchBox.value = '';
        if (searchMode === 'references') runSearch();
        else analyze(true);
      }
    };
    els.autoToggle.onchange = function () { autoAnalyze = els.autoToggle.checked; };
    els.promptStyle.onchange = function () { clearPromptOutput(); renderPromptDescription(); };
    els.promptModel.onchange = function () { clearPromptOutput(); updatePromptGenerateState(); };
    els.refreshPromptSelection.onclick = refreshPromptSelection;
    els.applyPrompt.onclick = runSavedPrompt;
    els.copyPromptOutput.onclick = copyPromptOutput;
    els.pastePromptOutput.onclick = pastePromptOutput;
    els.refreshSynonymSelection.onclick = refreshSynonymSelection;
    els.generateSynonyms.onclick = generateSynonymRound;

    for (var mb = 0; mb < modeButtons.length; mb++) {
      (function (btn) {
        btn.onclick = function () { setSearchMode(btn.getAttribute('data-mode')); };
      })(modeButtons[mb]);
    }
    for (var cbi = 0; cbi < composeButtons.length; cbi++) {
      (function (btn) {
        btn.onclick = function () { runCompose(btn.getAttribute('data-compose'), btn); };
      })(composeButtons[cbi]);
    }
    var targetRadios = els.insertTargetEl.querySelectorAll('input[name="insTarget"]');
    for (var ri = 0; ri < targetRadios.length; ri++) {
      targetRadios[ri].onchange = function () {
        if (this.checked) insertTarget = this.value;
      };
    }

    // The status chip doubles as a retry button when Nodus is unreachable.
    els.status.style.cursor = 'pointer';
    els.status.onclick = function () {
      setStatus(T('connecting'), '');
      checkHealth();
      analyze(true);
    };
    referenceController = window.NodusReferences && window.NodusReferences.create({
      api: api,
      isWord: isWord,
      lang: LANG,
      setStatus: setStatus,
    });
    if (referenceController) referenceController.init();
    chatController = window.NodusWordChat && window.NodusWordChat.create({
      api: api,
      isWord: isWord,
      lang: LANG,
      pageSupported: !isWord || chatPageSupported,
      documentKey: resolveChatDocumentKey(),
      readContext: readChatContext,
      getSelectionText: getSelectionText,
      setStatus: setStatus,
    });
    if (chatController) chatController.init();

    checkHealth();
    var requestedMode = window.location.hash.indexOf('references') >= 0 ? 'references' : 'ideas';
    if (requestedMode === 'references') {
      setSearchMode('references');
      var referenceAction = window.location.hash.replace(/^#references-?/, '') || 'citation';
      referenceController.performAction(referenceAction);
    }
    else analyze(true);
  }

  var initialized = false;
  function initOnce(insideWord) {
    if (initialized) return;
    initialized = true;
    isWord = insideWord;
    initApp();
  }

  if (typeof Office !== 'undefined' && Office.onReady) {
    // Office.onReady fires in every environment once office.js is up: with
    // host Word inside Word, with a null host in a plain browser. Deciding by
    // host (not by a short timeout racing Word's startup) is what keeps a slow
    // Word start from being misdetected as standalone mode.
    Office.onReady(function (info) {
      initOnce(Boolean(info && info.host === Office.HostType.Word));
    });
    // Safety net for a half-broken office.js that never signals readiness.
    setTimeout(function () { initOnce(false); }, 8000);
  } else {
    // office.js unavailable (e.g. browser without CDN access): standalone now.
    initOnce(false);
  }
})();
