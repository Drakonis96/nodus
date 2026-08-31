/* global fetch */
(function () {
  'use strict';

  var LEGACY_STORAGE_KEY = 'nodus.word-chat.conversations.v1';
  var STORAGE_PREFIX = 'nodus.word-chat.conversations.v2.';
  var MAX_CONVERSATIONS = 50;
  var MAX_SELECTION_PREVIEW = 800;

  var COPY_ICON = '⧉';
  var EDIT_ICON = '✎';
  var REGENERATE_ICON = '↻';

  var STR = {
    es: {
      model: 'Modelo', context: 'Contexto', page: 'Página actual', document: 'Documento completo',
      selected: 'Texto seleccionado', selectedHint: 'Se incluirá con tu próxima pregunta',
      hint: 'Pregunta sobre la página actual, el documento completo o el texto seleccionado.',
      placeholder: 'Pregunta sobre este documento…', send: 'Enviar', stop: 'Detener',
      newConversation: 'Nueva conversación', conversations: 'Conversaciones', close: 'Cerrar',
      emptyHistory: 'Todavía no hay conversaciones guardadas.', you: 'Tú', nodus: 'Nodus',
      copy: 'Copiar', edit: 'Editar', regenerate: 'Regenerar', remove: 'Eliminar',
      copied: 'Copiado', copyError: 'No se pudo copiar la respuesta.',
      noModels: 'No hay modelos configurados en Nodus.', loadingModels: 'Cargando modelos…',
      modelSearch: 'Buscar modelos', noModelMatches: 'No hay modelos que coincidan.',
      modelError: 'No se pudieron cargar los modelos: ', responseEmpty: 'Nodus no devolvió una respuesta.',
      stopped: 'Respuesta detenida.', contextReading: 'Leyendo el contexto del documento…',
      contextReady: '{label} · {chars} caracteres enviados',
      contextTruncated: '{label} es demasiado extenso: se ha enviado una muestra de {sent} de {total} caracteres.',
      selectionTruncated: 'La selección es demasiado extensa: se han enviado {sent} de {total} caracteres.',
      pageFallback: 'No se pudo leer la página actual; se ha usado el documento completo.',
      pageUnsupported: 'Esta versión de Word no permite leer la página actual desde un complemento. Se usará el documento completo.',
      deleteTitle: 'Eliminar conversación', untitled: 'Conversación', messages: '{n} mensajes',
    },
    en: {
      model: 'Model', context: 'Context', page: 'Current page', document: 'Full document',
      selected: 'Selected text', selectedHint: 'Included with your next question',
      hint: 'Ask about the current page, the full document, or selected text.',
      placeholder: 'Ask about this document…', send: 'Send', stop: 'Stop',
      newConversation: 'New conversation', conversations: 'Conversations', close: 'Close',
      emptyHistory: 'There are no saved conversations yet.', you: 'You', nodus: 'Nodus',
      copy: 'Copy', edit: 'Edit', regenerate: 'Regenerate', remove: 'Delete',
      copied: 'Copied', copyError: 'The response could not be copied.',
      noModels: 'There are no models configured in Nodus.', loadingModels: 'Loading models…',
      modelSearch: 'Search models', noModelMatches: 'No matching models.',
      modelError: 'Could not load models: ', responseEmpty: 'Nodus returned no response.',
      stopped: 'Response stopped.', contextReading: 'Reading document context…',
      contextReady: '{label} · {chars} characters sent',
      contextTruncated: '{label} is too long: a sample of {sent} of {total} characters was sent.',
      selectionTruncated: 'The selection is too long: {sent} of {total} characters were sent.',
      pageFallback: 'The current page could not be read; the full document was used.',
      pageUnsupported: 'This Word version cannot read the current page from an add-in. The full document will be used.',
      deleteTitle: 'Delete conversation', untitled: 'Conversation', messages: '{n} messages',
    },
  };

  function createElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeId() {
    return 'word-chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function safeMessages(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (message) {
      return message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string';
    }).slice(-40).map(function (message) {
      return { role: message.role, content: message.content.slice(0, 20000) };
    });
  }

  function storageKeyFor(documentKey) {
    var safe = String(documentKey || 'session').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
    return STORAGE_PREFIX + (safe || 'session');
  }

  function loadStoredConversations(storageKey) {
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (conversation) {
        return {
          id: String(conversation.id || makeId()),
          title: String(conversation.title || ''),
          messages: safeMessages(conversation.messages),
          model: conversation.model && typeof conversation.model === 'object' ? conversation.model : null,
          scope: conversation.scope === 'document' ? 'document' : 'page',
          createdAt: Number(conversation.createdAt) || Date.now(),
          updatedAt: Number(conversation.updatedAt) || Date.now(),
        };
      }).filter(function (conversation) { return conversation.messages.length; }).slice(0, MAX_CONVERSATIONS);
    } catch (error) {
      return [];
    }
  }

  function saveStoredConversations(storageKey, conversations) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
    } catch (error) {
      // A private or quota-limited webview may reject localStorage. Chat still works.
    }
  }

  function appendInline(parent, source) {
    var text = String(source || '');
    var pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*[^*\n]+\*)/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      var token = match[0];
      if (token.slice(0, 2) === '**') {
        parent.appendChild(createElement('strong', '', token.slice(2, -2)));
      } else if (token.charAt(0) === '`') {
        parent.appendChild(createElement('code', '', token.slice(1, -1)));
      } else if (token.charAt(0) === '[') {
        var parts = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
        if (parts) {
          var link = createElement('a', '', parts[1]);
          link.href = parts[2];
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          parent.appendChild(link);
        } else parent.appendChild(document.createTextNode(token));
      } else {
        parent.appendChild(createElement('em', '', token.slice(1, -1)));
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // Small, DOM-only Markdown renderer. It deliberately never injects model HTML.
  function renderMarkdown(container, source) {
    container.textContent = '';
    container.classList.add('word-chat-markdown');
    var lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    var index = 0;
    while (index < lines.length) {
      var line = lines[index];
      if (!line.trim()) { index++; continue; }
      if (/^```/.test(line)) {
        var codeLines = [];
        index++;
        while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++]);
        if (index < lines.length) index++;
        var pre = createElement('pre');
        pre.appendChild(createElement('code', '', codeLines.join('\n')));
        container.appendChild(pre);
        continue;
      }
      var heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        var h = createElement('h' + heading[1].length);
        appendInline(h, heading[2]);
        container.appendChild(h);
        index++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        var quote = createElement('blockquote');
        var quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^>\s?/, ''));
        appendInline(quote, quoteLines.join(' '));
        container.appendChild(quote);
        continue;
      }
      var listMatch = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
      if (listMatch) {
        var ordered = /\d+\./.test(listMatch[2]);
        var list = createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          var itemMatch = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
          if (!itemMatch || /\d+\./.test(itemMatch[2]) !== ordered) break;
          var item = createElement('li');
          appendInline(item, itemMatch[3]);
          list.appendChild(item);
          index++;
        }
        container.appendChild(list);
        continue;
      }
      var paragraphLines = [line];
      index++;
      while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^```|^>\s?|^(\s*)([-*]|\d+\.)\s+/.test(lines[index])) {
        paragraphLines.push(lines[index++]);
      }
      var paragraph = createElement('p');
      appendInline(paragraph, paragraphLines.join(' '));
      container.appendChild(paragraph);
    }
  }

  function legacyCopyText(value) {
    var field = createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    var copied = false;
    try { copied = Boolean(document.execCommand && document.execCommand('copy')); } catch (error) { copied = false; }
    field.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard unavailable'));
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(function () { return legacyCopyText(value); });
    }
    return legacyCopyText(value);
  }

  function create(options) {
    var lang = options.lang === 'en' ? 'en' : 'es';
    var strings = STR[lang];
    var token = (window.NODUS && window.NODUS.token) || '';
    var storageKey = storageKeyFor(options.documentKey);
    // v1 had no document namespace and could expose one document's questions
    // while another document was open. It cannot be migrated safely.
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (error) { /* storage can be unavailable */ }
    var conversations = loadStoredConversations(storageKey);
    var conversation = null;
    var models = [];
    var defaultModel = null;
    var active = false;
    var busy = false;
    var abortController = null;
    var selectionRequest = 0;

    var els = {};

    function t(key, replacements) {
      var value = String(strings[key] === undefined ? STR.en[key] : strings[key]);
      Object.keys(replacements || {}).forEach(function (name) {
        value = value.replace('{' + name + '}', String(replacements[name]));
      });
      return value;
    }

    function currentScope() {
      return els.scopeDocument.checked ? 'document' : 'page';
    }

    function modelKey(model) {
      return model ? String(model.provider) + '::' + String(model.model) : '';
    }

    function selectedModel() {
      var key = els.model.value;
      return models.find(function (model) { return modelKey(model) === key; }) || null;
    }

    function newConversation() {
      conversation = {
        id: makeId(), title: '', messages: [], model: selectedModel() || defaultModel,
        scope: currentScope(), createdAt: Date.now(), updatedAt: Date.now(),
      };
      renderConversation();
      closeHistory();
      updateSendEnabled();
      if (active) els.input.focus();
    }

    function persistConversation() {
      if (!conversation) return;
      if (!conversation.messages.length) {
        conversations = conversations.filter(function (entry) { return entry.id !== conversation.id; });
        saveStoredConversations(storageKey, conversations);
        return;
      }
      var first = conversation.messages.find(function (message) { return message.role === 'user'; });
      conversation.title = conversation.title || (first ? first.content.trim().slice(0, 60) : t('untitled'));
      conversation.model = selectedModel() || conversation.model;
      conversation.scope = currentScope();
      conversation.updatedAt = Date.now();
      var index = conversations.findIndex(function (entry) { return entry.id === conversation.id; });
      if (index >= 0) conversations.splice(index, 1);
      conversations.unshift(conversation);
      conversations = conversations.slice(0, MAX_CONVERSATIONS);
      saveStoredConversations(storageKey, conversations);
    }

    function scrollMessages() {
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function typingIndicator(body) {
      body.textContent = '';
      var dots = createElement('span', 'word-chat-typing');
      dots.setAttribute('aria-label', '…');
      dots.appendChild(createElement('span'));
      dots.appendChild(createElement('span'));
      dots.appendChild(createElement('span'));
      body.appendChild(dots);
    }

    function actionButton(label, symbol, handler) {
      var button = createElement('button', 'word-chat-message-action', symbol);
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.onclick = handler;
      return button;
    }

    function addMessage(role, content, messageIndex, transient) {
      var wrap = createElement('article', 'word-chat-message word-chat-message--' + role);
      wrap.appendChild(createElement('div', 'word-chat-who', role === 'user' ? t('you') : t('nodus')));
      var body = createElement('div', 'word-chat-body');
      if (role === 'assistant' && !transient) renderMarkdown(body, content);
      else body.textContent = content || '';
      wrap.appendChild(body);
      if (!transient && messageIndex !== undefined) {
        var actions = createElement('div', 'word-chat-message-actions');
        var copyAction = actionButton(t('copy'), COPY_ICON, function () {
          copyText(content).then(function () {
            copyAction.textContent = '✓';
            copyAction.title = t('copied');
            copyAction.setAttribute('aria-label', t('copied'));
            window.setTimeout(function () {
              copyAction.textContent = COPY_ICON;
              copyAction.title = t('copy');
              copyAction.setAttribute('aria-label', t('copy'));
            }, 1200);
          }).catch(function () {
            if (options.setStatus) options.setStatus(t('copyError'), 'err');
          });
        });
        actions.appendChild(copyAction);
        if (role === 'user') {
          actions.appendChild(actionButton(t('edit'), EDIT_ICON, function () { editUserMessage(messageIndex); }));
        } else {
          actions.appendChild(actionButton(t('regenerate'), REGENERATE_ICON, function () { regenerateFrom(messageIndex); }));
        }
        wrap.appendChild(actions);
      }
      var hint = els.messages.querySelector('.word-chat-hint');
      if (hint) hint.remove();
      els.messages.appendChild(wrap);
      scrollMessages();
      return { wrap: wrap, body: body };
    }

    function renderConversation() {
      els.messages.textContent = '';
      if (!conversation || !conversation.messages.length) {
        els.messages.appendChild(createElement('div', 'word-chat-hint', t('hint')));
        return;
      }
      conversation.messages.forEach(function (message, index) {
        addMessage(message.role, message.content, index, false);
      });
    }

    function editUserMessage(index) {
      if (busy || !conversation || !conversation.messages[index] || conversation.messages[index].role !== 'user') return;
      els.input.value = conversation.messages[index].content;
      conversation.messages = conversation.messages.slice(0, index);
      if (index === 0) conversation.title = '';
      renderConversation();
      persistConversation();
      updateSendEnabled();
      els.input.focus();
    }

    function regenerateFrom(index) {
      if (busy || !conversation || !conversation.messages[index] || conversation.messages[index].role !== 'assistant') return;
      conversation.messages = conversation.messages.slice(0, index);
      renderConversation();
      persistConversation();
      generateAssistant();
    }

    function setBusy(value) {
      busy = value;
      els.send.hidden = value;
      els.stop.hidden = !value;
      els.input.disabled = value;
      els.model.disabled = value || !models.length;
      els.scopePage.disabled = value || !options.pageSupported;
      els.scopeDocument.disabled = value;
      els.newButton.disabled = value;
      els.historyButton.disabled = value;
      updateSendEnabled();
    }

    function updateSendEnabled() {
      els.send.disabled = busy || !els.input.value.trim() || !selectedModel();
    }

    function setNotice(message, kind) {
      els.notice.hidden = !message;
      els.notice.textContent = message || '';
      els.notice.classList.toggle('is-warning', kind === 'warning');
    }

    function updateSelection() {
      var request = ++selectionRequest;
      return Promise.resolve().then(function () { return options.getSelectionText(); }).then(function (value) {
        if (request !== selectionRequest) return;
        var text = String(value || '').trim();
        els.selection.hidden = !text;
        els.selectionText.textContent = text.slice(0, MAX_SELECTION_PREVIEW) + (text.length > MAX_SELECTION_PREVIEW ? '…' : '');
      }).catch(function () {
        if (request !== selectionRequest) return;
        els.selection.hidden = true;
        els.selectionText.textContent = '';
      });
    }

    function parseStreamResponse(response, onEvent) {
      if (!response.ok) {
        return response.text().then(function (raw) {
          var detail = raw;
          try { detail = JSON.parse(raw).error || raw; } catch (error) { /* plain error */ }
          throw new Error(detail || response.statusText || 'HTTP ' + response.status);
        });
      }
      if (!response.body || !response.body.getReader) {
        return response.text().then(function (raw) {
          raw.split('\n').forEach(function (line) {
            if (!line.trim()) return;
            var event = null;
            try { event = JSON.parse(line); } catch (error) { event = null; }
            if (event) onEvent(event);
          });
        });
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function consumeBuffer(finalChunk) {
        var newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          var line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            var event = null;
            try { event = JSON.parse(line); } catch (error) { event = null; }
            if (event) onEvent(event);
          }
        }
        if (finalChunk && buffer.trim()) {
          var finalEvent = null;
          try { finalEvent = JSON.parse(buffer); } catch (error) { finalEvent = null; }
          if (finalEvent) onEvent(finalEvent);
          buffer = '';
        }
      }
      function readNext() {
        return reader.read().then(function (result) {
          if (result.done) {
            buffer += decoder.decode();
            consumeBuffer(true);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          consumeBuffer(false);
          return readNext();
        });
      }
      return readNext();
    }

    function generateAssistant() {
      if (busy || !conversation || !conversation.messages.length || !selectedModel()) return Promise.resolve();
      setBusy(true);
      setNotice(t('contextReading'));
      abortController = new AbortController();
      var transient = addMessage('assistant', '', undefined, true);
      typingIndicator(transient.body);
      var answer = '';
      var contextInfo;
      return Promise.resolve().then(function () { return options.readContext(currentScope()); }).then(function (context) {
        contextInfo = context;
        var notices = [];
        var warning = false;
        if (context.pageFallback) {
          notices.push(t('pageFallback'));
          warning = true;
        }
        if (context.truncated) {
          notices.push(t('contextTruncated', {
            label: context.label, sent: String(context.text || '').length.toLocaleString(),
            total: Number(context.totalChars || 0).toLocaleString(),
          }));
          warning = true;
        }
        if (context.selectionTruncated) {
          notices.push(t('selectionTruncated', {
            sent: String(context.selectionText || '').length.toLocaleString(),
            total: Number(context.selectionTotalChars || 0).toLocaleString(),
          }));
          warning = true;
        }
        if (!notices.length) notices.push(t('contextReady', { label: context.label, chars: String(context.text || '').length.toLocaleString() }));
        setNotice(notices.join(' '), warning ? 'warning' : '');
        return fetch('/api/chat/stream', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel(),
            messages: conversation.messages.map(function (message) { return { role: message.role, content: message.content }; }),
            context: context,
          }),
          signal: abortController.signal,
        });
      }).then(function (response) {
        return parseStreamResponse(response, function (event) {
          if (event.type === 'delta') {
            answer += String(event.text || '');
            transient.body.textContent = answer;
            scrollMessages();
          } else if (event.type === 'error') {
            throw new Error(String(event.error || 'Nodus error'));
          }
        });
      }).then(function () {
        if (!answer.trim()) throw new Error(t('responseEmpty'));
        transient.wrap.remove();
        var index = conversation.messages.push({ role: 'assistant', content: answer }) - 1;
        addMessage('assistant', answer, index, false);
        persistConversation();
      }).catch(function (error) {
        var aborted = error && (error.name === 'AbortError' || String(error.message || error).toLowerCase().indexOf('abort') >= 0);
        var message = aborted ? (answer.trim() || t('stopped')) : '⚠ ' + String((error && error.message) || error);
        transient.wrap.remove();
        var index = conversation.messages.push({ role: 'assistant', content: message }) - 1;
        addMessage('assistant', message, index, false);
        persistConversation();
        if (!aborted && options.setStatus) options.setStatus(message, 'err');
      }).then(function () {
        abortController = null;
        setBusy(false);
        if (active) els.input.focus();
        return contextInfo;
      });
    }

    function sendMessage() {
      var text = els.input.value.trim();
      if (!text || busy || !selectedModel()) return;
      if (!conversation) newConversation();
      els.input.value = '';
      var index = conversation.messages.push({ role: 'user', content: text }) - 1;
      addMessage('user', text, index, false);
      updateSendEnabled();
      persistConversation();
      generateAssistant();
    }

    function stop() {
      if (abortController) abortController.abort();
    }

    function closeHistory() {
      els.history.hidden = true;
    }

    function renderHistory() {
      els.historyList.textContent = '';
      if (!conversations.length) {
        els.historyList.appendChild(createElement('div', 'word-chat-history-empty', t('emptyHistory')));
        return;
      }
      conversations.forEach(function (entry) {
        var item = createElement('div', 'word-chat-conversation');
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        var main = createElement('div', 'word-chat-conversation-main');
        main.appendChild(createElement('div', 'word-chat-conversation-title', entry.title || t('untitled')));
        main.appendChild(createElement('div', 'word-chat-conversation-meta',
          t('messages', { n: entry.messages.length }) + ' · ' + new Date(entry.updatedAt).toLocaleString(lang)));
        item.appendChild(main);
        var remove = createElement('button', 'word-chat-conversation-delete', '×');
        remove.type = 'button';
        remove.title = t('deleteTitle');
        remove.setAttribute('aria-label', t('deleteTitle'));
        remove.onclick = function (event) {
          event.stopPropagation();
          conversations = conversations.filter(function (candidate) { return candidate.id !== entry.id; });
          saveStoredConversations(storageKey, conversations);
          if (conversation && conversation.id === entry.id) newConversation();
          renderHistory();
        };
        item.appendChild(remove);
        function load() {
          if (busy) return;
          conversation = entry;
          els.scopeDocument.checked = conversation.scope === 'document' || !options.pageSupported;
          els.scopePage.checked = !els.scopeDocument.checked;
          var storedModel = modelKey(conversation.model);
          if (storedModel && models.some(function (model) { return modelKey(model) === storedModel; })) els.model.value = storedModel;
          renderConversation();
          closeHistory();
          updateSelection();
        }
        item.onclick = load;
        item.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); load(); } };
        els.historyList.appendChild(item);
      });
    }

    function openHistory() {
      renderHistory();
      els.history.hidden = false;
    }

    function fillModels(data) {
      models = Array.isArray(data.models) ? data.models : [];
      defaultModel = data.defaultModel || models[0] || null;
      els.model.textContent = '';
      if (!models.length) {
        var empty = createElement('option', '', t('noModels'));
        empty.value = '';
        els.model.appendChild(empty);
      } else {
        models.forEach(function (model) {
          var option = createElement('option', '', model.label || (model.provider + ' · ' + model.model));
          option.value = modelKey(model);
          els.model.appendChild(option);
        });
        var wanted = modelKey((conversation && conversation.model) || defaultModel);
        if (wanted && models.some(function (model) { return modelKey(model) === wanted; })) els.model.value = wanted;
      }
      if (window.NodusModelPicker) window.NodusModelPicker.refresh(els.model);
      setBusy(false);
    }

    function applyLabels() {
      var modelLabel = document.querySelector('.word-chat-model > span');
      var scopeLabel = document.querySelector('.word-chat-scope-label');
      var pageLabel = els.scopePage.parentNode.querySelector('span');
      var documentLabel = els.scopeDocument.parentNode.querySelector('span');
      var selectionTitle = els.selection.querySelector('strong');
      var selectionHint = els.selection.querySelector('span');
      if (modelLabel) modelLabel.textContent = t('model');
      if (scopeLabel) scopeLabel.textContent = t('context');
      if (pageLabel) pageLabel.textContent = t('page');
      if (documentLabel) documentLabel.textContent = t('document');
      if (selectionTitle) selectionTitle.textContent = t('selected');
      if (selectionHint) selectionHint.textContent = t('selectedHint');
      els.input.placeholder = t('placeholder');
      els.input.setAttribute('aria-label', t('placeholder'));
      els.send.title = t('send'); els.send.setAttribute('aria-label', t('send'));
      els.stop.title = t('stop'); els.stop.setAttribute('aria-label', t('stop'));
      els.newButton.title = t('newConversation'); els.newButton.setAttribute('aria-label', t('newConversation'));
      els.historyButton.title = t('conversations'); els.historyButton.setAttribute('aria-label', t('conversations'));
      els.history.querySelector('strong').textContent = t('conversations');
      els.historyClose.title = t('close'); els.historyClose.setAttribute('aria-label', t('close'));
    }

    function init() {
      els.root = document.getElementById('chatControls');
      els.model = document.getElementById('chatModel');
      els.scopePage = document.getElementById('chatScopePage');
      els.scopeDocument = document.getElementById('chatScopeDocument');
      els.selection = document.getElementById('chatSelection');
      els.selectionText = document.getElementById('chatSelectionText');
      els.notice = document.getElementById('chatContextNotice');
      els.messages = document.getElementById('chatMessages');
      els.input = document.getElementById('chatInput');
      els.send = document.getElementById('chatSend');
      els.stop = document.getElementById('chatStop');
      els.newButton = document.getElementById('chatNew');
      els.historyButton = document.getElementById('chatHistoryButton');
      els.history = document.getElementById('chatHistory');
      els.historyList = document.getElementById('chatHistoryList');
      els.historyClose = document.getElementById('chatHistoryClose');
      if (window.NodusModelPicker) {
        window.NodusModelPicker.enhance(els.model, {
          searchPlaceholder: t('modelSearch'),
          showOptionsLabel: t('modelSearch'),
          noResults: t('noModelMatches'),
        });
      }
      applyLabels();
      if (!options.pageSupported) {
        els.scopePage.disabled = true;
        els.scopeDocument.checked = true;
        els.scopePage.checked = false;
        els.scopePage.parentNode.title = t('pageUnsupported');
        setNotice(t('pageUnsupported'), 'warning');
      }
      els.model.textContent = '';
      var loading = createElement('option', '', t('loadingModels'));
      loading.value = '';
      els.model.appendChild(loading);
      els.model.disabled = true;
      els.send.onclick = sendMessage;
      els.stop.onclick = stop;
      els.newButton.onclick = newConversation;
      els.historyButton.onclick = openHistory;
      els.historyClose.onclick = closeHistory;
      els.input.oninput = updateSendEnabled;
      els.input.onkeydown = function (event) {
        if (event.key === 'Enter' && !event.altKey) {
          event.preventDefault();
          sendMessage();
        }
      };
      els.model.onchange = function () { if (conversation) { conversation.model = selectedModel(); persistConversation(); } updateSendEnabled(); };
      els.scopePage.onchange = els.scopeDocument.onchange = function () {
        if (conversation) { conversation.scope = currentScope(); persistConversation(); }
        setNotice('');
        updateSelection();
      };
      conversation = conversations[0] || null;
      if (!conversation) newConversation();
      else {
        els.scopeDocument.checked = conversation.scope === 'document' || !options.pageSupported;
        els.scopePage.checked = !els.scopeDocument.checked;
        renderConversation();
      }
      options.api('/api/chat/catalogue').then(fillModels).catch(function (error) {
        models = [];
        els.model.textContent = '';
        var failed = createElement('option', '', t('noModels'));
        failed.value = '';
        els.model.appendChild(failed);
        setBusy(false);
        if (options.setStatus) options.setStatus(t('modelError') + String((error && error.message) || error), 'err');
      });
      updateSelection();
    }

    function setActive(value) {
      active = Boolean(value);
      if (active) {
        updateSelection();
        updateSendEnabled();
        window.setTimeout(function () { if (!busy) els.input.focus(); }, 0);
      } else {
        closeHistory();
      }
    }

    return {
      init: init,
      setActive: setActive,
      selectionChanged: updateSelection,
      stop: stop,
    };
  }

  window.NodusWordChat = {
    create: create,
    renderMarkdown: renderMarkdown,
  };
})();
