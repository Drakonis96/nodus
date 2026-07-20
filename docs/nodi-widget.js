/* Website controls for Nodi. The animated orb stays in nodi.js; this file owns the
   radial menu and the browser-safe versions of help, notifications, chat and notes. */
(function () {
  var ICONS = {
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.6-2 2-2 3"/><circle cx="12" cy="17" r=".65" fill="currentColor"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 3z"/><path d="M8 9h8M8 12.5h5"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-7-7 16-2.5-6.5L4 12z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  };

  var EN = {
    nodiLabel: 'Nodi, the Nodus companion', help: 'Who am I?', notifications: 'Notifications', chat: 'Chat', notes: 'Quick notes', top: 'Back to top', close: 'Close', clear: 'Clear',
    helpTitle: "Hi! I'm Nodi", helpIntro: 'I am the Nodus companion. On the website I can guide you, keep local notes and help you explore the project.',
    helpChat: '<b>Chat</b>: ask common questions about Nodus and this website.', helpNotes: '<b>Notes</b>: quick notes saved only in this browser.', helpNotifications: '<b>Notifications</b>: useful local updates from the website.', helpTop: '<b>Up arrow</b>: return smoothly to the top of the page.',
    noNotifications: 'There are no notifications.', notification1Title: 'Explore the live demos', notification1Body: 'Try each vault mode in your browser from the interactive demo.', notification2Title: 'Free and open source', notification2Body: 'Nodus has no account system or telemetry, and your workspace remains local.', notification3Title: 'Your web notes are local', notification3Body: 'Quick notes created here stay in this browser and are not sent anywhere.',
    chatTitle: 'Chat with Nodi', chatWelcome: "Hi! Here on the website I can answer common questions and point you to the right section. In the Nodus app, my chat also works with your selected AI model and contexts.", chatPlaceholder: 'Ask Nodi…', send: 'Send',
    qWhat: 'What is Nodus?', qPrivacy: 'Is it private?', qDemo: 'Where is the demo?',
    answerWhat: 'Nodus is a free, open-source, local-first desktop workspace for research, teaching and study. It connects your sources, ideas, notes and evidence inside specialized vaults.',
    answerPrivacy: 'Your Nodus database, extracted text, graph, notes and drafts stay on your computer. If you choose a cloud AI provider, only the text needed for that request is sent under that provider’s terms.',
    answerDemo: 'Use “Live demo” in the navigation or the main call to action. You can explore Academic, Study, Teaching, Genealogy and Databases vaults without installing anything.',
    answerDownload: 'Use the “Download” button in the navigation. Nodus is available for macOS, Windows and Linux.',
    answerZotero: 'Nodus can read your Zotero 7+ library locally. It does not write changes back to Zotero.',
    answerFree: 'Nodus is free and open source. There are no paid features or Nodus subscription; optional cloud AI usage is billed by the provider you choose.',
    answerModes: 'Nodus currently includes Academic, Study, Teaching, Genealogy and Databases vaults. Each mode changes the tools and context while sharing the same local engine.',
    answerAi: 'Nodus can use cloud providers or local models through Ollama and LM Studio. You choose the model; the app does not hide where a request is sent.',
    answerFallback: 'I can help with the demo, downloads, privacy, Zotero, AI setup and vault modes. For detailed answers, open the FAQ section on this page.',
    notesTitle: 'Quick notes', newNote: 'New note', emptyNotes: 'You do not have any notes yet. Create the first one with the + button.', untitled: 'Untitled note', titlePlaceholder: 'Title (optional)', notePlaceholder: 'Write your note…', back: 'Back', deleteNote: 'Delete note', saved: 'Saved locally', saving: 'Saving…'
  };

  var UI = {
    es: {
      nodiLabel: 'Nodi, el compañero de Nodus', help: '¿Quién soy?', notifications: 'Notificaciones', chat: 'Chat', notes: 'Notas rápidas', top: 'Subir al inicio', close: 'Cerrar', clear: 'Limpiar',
      helpTitle: '¡Hola! Soy Nodi', helpIntro: 'Soy el compañero de Nodus. En la web puedo orientarte, guardar notas locales y ayudarte a explorar el proyecto.',
      helpChat: '<b>Chat</b>: pregúntame dudas habituales sobre Nodus y esta web.', helpNotes: '<b>Notas</b>: apuntes rápidos guardados solo en este navegador.', helpNotifications: '<b>Notificaciones</b>: avisos locales útiles de la web.', helpTop: '<b>Flecha hacia arriba</b>: vuelve suavemente al inicio de la página.',
      noNotifications: 'No hay notificaciones.', notification1Title: 'Explora las demos interactivas', notification1Body: 'Prueba cada modo de bóveda en tu navegador desde la demo.', notification2Title: 'Gratis y de código abierto', notification2Body: 'Nodus no usa cuentas ni telemetría, y tu espacio de trabajo permanece local.', notification3Title: 'Tus notas web son locales', notification3Body: 'Las notas rápidas creadas aquí se quedan en este navegador y no se envían a ningún sitio.',
      chatTitle: 'Chat con Nodi', chatWelcome: '¡Hola! En la web puedo responder preguntas habituales y llevarte a la sección adecuada. En la app de Nodus, mi chat también trabaja con el modelo de IA y los contextos que elijas.', chatPlaceholder: 'Escribe a Nodi…', send: 'Enviar',
      qWhat: '¿Qué es Nodus?', qPrivacy: '¿Es privado?', qDemo: '¿Dónde está la demo?',
      answerWhat: 'Nodus es un espacio de trabajo de escritorio gratuito, de código abierto y local-first para investigar, enseñar y estudiar. Conecta tus fuentes, ideas, notas y evidencias dentro de bóvedas especializadas.',
      answerPrivacy: 'La base de datos de Nodus, el texto extraído, el grafo, las notas y los borradores permanecen en tu ordenador. Si eliges un proveedor de IA en la nube, solo se envía el texto necesario para esa petición bajo sus condiciones.',
      answerDemo: 'Usa «Demo» en la navegación o el botón principal. Puedes explorar las bóvedas Académica, Estudio, Docencia, Genealogía y Bases de datos sin instalar nada.',
      answerDownload: 'Usa el botón «Descargar» de la navegación. Nodus está disponible para macOS, Windows y Linux.',
      answerZotero: 'Nodus puede leer localmente tu biblioteca de Zotero 7+. No escribe cambios de vuelta en Zotero.',
      answerFree: 'Nodus es gratuito y de código abierto. No hay funciones de pago ni suscripción a Nodus; el uso opcional de IA en la nube lo factura el proveedor que elijas.',
      answerModes: 'Nodus incluye actualmente bóvedas Académica, Estudio, Docencia, Genealogía y Bases de datos. Cada modo adapta las herramientas y el contexto sobre el mismo motor local.',
      answerAi: 'Nodus puede usar proveedores en la nube o modelos locales mediante Ollama y LM Studio. Tú eliges el modelo; la app no oculta dónde se envía una petición.',
      answerFallback: 'Puedo ayudarte con la demo, las descargas, la privacidad, Zotero, la configuración de IA y los modos de bóveda. Para respuestas detalladas, abre la sección de preguntas frecuentes de esta página.',
      notesTitle: 'Notas rápidas', newNote: 'Nueva nota', emptyNotes: 'Aún no tienes notas. Crea la primera con el botón +.', untitled: 'Nota sin título', titlePlaceholder: 'Título (opcional)', notePlaceholder: 'Escribe tu nota…', back: 'Volver', deleteNote: 'Borrar nota', saved: 'Guardado localmente', saving: 'Guardando…'
    },
    fr: { help: 'Qui suis-je ?', notifications: 'Notifications', chat: 'Chat', notes: 'Notes rapides', top: 'Retour en haut', close: 'Fermer', clear: 'Effacer', helpTitle: 'Bonjour ! Je suis Nodi', chatTitle: 'Chat avec Nodi', chatPlaceholder: 'Écrivez à Nodi…', send: 'Envoyer', notesTitle: 'Notes rapides', newNote: 'Nouvelle note', emptyNotes: 'Vous n’avez encore aucune note.', untitled: 'Note sans titre', titlePlaceholder: 'Titre (facultatif)', notePlaceholder: 'Écrivez votre note…', back: 'Retour', deleteNote: 'Supprimer la note', saved: 'Enregistré localement', saving: 'Enregistrement…' },
    it: { help: 'Chi sono?', notifications: 'Notifiche', chat: 'Chat', notes: 'Note rapide', top: 'Torna in alto', close: 'Chiudi', clear: 'Cancella', helpTitle: 'Ciao! Sono Nodi', chatTitle: 'Chat con Nodi', chatPlaceholder: 'Scrivi a Nodi…', send: 'Invia', notesTitle: 'Note rapide', newNote: 'Nuova nota', emptyNotes: 'Non hai ancora note.', untitled: 'Nota senza titolo', titlePlaceholder: 'Titolo (facoltativo)', notePlaceholder: 'Scrivi la tua nota…', back: 'Indietro', deleteNote: 'Elimina nota', saved: 'Salvato localmente', saving: 'Salvataggio…' },
    de: { help: 'Wer bin ich?', notifications: 'Benachrichtigungen', chat: 'Chat', notes: 'Schnellnotizen', top: 'Nach oben', close: 'Schließen', clear: 'Leeren', helpTitle: 'Hallo! Ich bin Nodi', chatTitle: 'Chat mit Nodi', chatPlaceholder: 'Nodi fragen…', send: 'Senden', notesTitle: 'Schnellnotizen', newNote: 'Neue Notiz', emptyNotes: 'Du hast noch keine Notizen.', untitled: 'Unbenannte Notiz', titlePlaceholder: 'Titel (optional)', notePlaceholder: 'Notiz schreiben…', back: 'Zurück', deleteNote: 'Notiz löschen', saved: 'Lokal gespeichert', saving: 'Speichern…' },
    pt: { help: 'Quem sou eu?', notifications: 'Notificações', chat: 'Chat', notes: 'Notas rápidas', top: 'Voltar ao topo', close: 'Fechar', clear: 'Limpar', helpTitle: 'Olá! Sou o Nodi', chatTitle: 'Chat com o Nodi', chatPlaceholder: 'Escreva ao Nodi…', send: 'Enviar', notesTitle: 'Notas rápidas', newNote: 'Nova nota', emptyNotes: 'Ainda não tem notas.', untitled: 'Nota sem título', titlePlaceholder: 'Título (opcional)', notePlaceholder: 'Escreva a sua nota…', back: 'Voltar', deleteNote: 'Eliminar nota', saved: 'Guardado localmente', saving: 'A guardar…' },
    tr: { help: 'Ben kimim?', notifications: 'Bildirimler', chat: 'Sohbet', notes: 'Hızlı notlar', top: 'Başa dön', close: 'Kapat', clear: 'Temizle', helpTitle: 'Merhaba! Ben Nodi', chatTitle: 'Nodi ile sohbet', chatPlaceholder: 'Nodi’ye yaz…', send: 'Gönder', notesTitle: 'Hızlı notlar', newNote: 'Yeni not', emptyNotes: 'Henüz notunuz yok.', untitled: 'Başlıksız not', titlePlaceholder: 'Başlık (isteğe bağlı)', notePlaceholder: 'Notunuzu yazın…', back: 'Geri', deleteNote: 'Notu sil', saved: 'Yerel olarak kaydedildi', saving: 'Kaydediliyor…' },
    zh: { help: '我是谁？', notifications: '通知', chat: '聊天', notes: '快速笔记', top: '返回顶部', close: '关闭', clear: '清除', helpTitle: '你好！我是 Nodi', chatTitle: '与 Nodi 聊天', chatPlaceholder: '问问 Nodi…', send: '发送', notesTitle: '快速笔记', newNote: '新建笔记', emptyNotes: '还没有笔记。', untitled: '无标题笔记', titlePlaceholder: '标题（可选）', notePlaceholder: '写下笔记…', back: '返回', deleteNote: '删除笔记', saved: '已保存在本地', saving: '正在保存…' },
    ja: { help: '私は誰？', notifications: '通知', chat: 'チャット', notes: 'クイックノート', top: 'トップへ戻る', close: '閉じる', clear: '消去', helpTitle: 'こんにちは！Nodiです', chatTitle: 'Nodiとチャット', chatPlaceholder: 'Nodiに質問…', send: '送信', notesTitle: 'クイックノート', newNote: '新しいノート', emptyNotes: 'ノートはまだありません。', untitled: '無題のノート', titlePlaceholder: 'タイトル（任意）', notePlaceholder: 'ノートを書く…', back: '戻る', deleteNote: 'ノートを削除', saved: 'ローカルに保存済み', saving: '保存中…' },
    uk: { help: 'Хто я?', notifications: 'Сповіщення', chat: 'Чат', notes: 'Швидкі нотатки', top: 'На початок', close: 'Закрити', clear: 'Очистити', helpTitle: 'Вітаю! Я Nodi', chatTitle: 'Чат із Nodi', chatPlaceholder: 'Запитайте Nodi…', send: 'Надіслати', notesTitle: 'Швидкі нотатки', newNote: 'Нова нотатка', emptyNotes: 'Нотаток ще немає.', untitled: 'Нотатка без назви', titlePlaceholder: 'Назва (необов’язково)', notePlaceholder: 'Напишіть нотатку…', back: 'Назад', deleteNote: 'Видалити нотатку', saved: 'Збережено локально', saving: 'Збереження…' },
    ru: { help: 'Кто я?', notifications: 'Уведомления', chat: 'Чат', notes: 'Быстрые заметки', top: 'Наверх', close: 'Закрыть', clear: 'Очистить', helpTitle: 'Привет! Я Nodi', chatTitle: 'Чат с Nodi', chatPlaceholder: 'Спросите Nodi…', send: 'Отправить', notesTitle: 'Быстрые заметки', newNote: 'Новая заметка', emptyNotes: 'Заметок пока нет.', untitled: 'Заметка без названия', titlePlaceholder: 'Название (необязательно)', notePlaceholder: 'Напишите заметку…', back: 'Назад', deleteNote: 'Удалить заметку', saved: 'Сохранено локально', saving: 'Сохранение…' }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
    });
  }

  window.mountNodiWebsite = function mountNodiWebsite(options) {
    if (document.getElementById('nodi')) return;
    var language = typeof options.language === 'function' ? options.language : function () { return document.documentElement.lang || navigator.language || 'en'; };
    var root = document.createElement('div');
    root.id = 'nodi';
    var menuOpen = false;
    var activeSurface = 'none';
    var notificationRead = localGet('nodus.web.nodi.notifications.read') === '1';
    var notificationsCleared = localGet('nodus.web.nodi.notifications.cleared') === '1';
    var messages = [];
    var notes = loadNotes();
    var noteView = 'list';
    var activeNoteId = null;
    var saveTimer = 0;
    var waveTimer = 0;
    var radial = [
      { id: 'help', icon: 'help', dx: -143, dy: -5, mx: -109, my: -2 },
      { id: 'notifications', icon: 'bell', dx: -132, dy: -69, mx: -101, my: -47 },
      { id: 'chat', icon: 'chat', dx: -96, dy: -120, mx: -73, my: -86 },
      { id: 'notes', icon: 'notes', dx: -45, dy: -151, mx: -34, my: -110 },
      { id: 'top', icon: 'up', dx: 11, dy: -155, mx: 7, my: -116 }
    ];

    root.innerHTML = '<div id="nodi-surface"></div>'
      + radial.map(function (item, index) {
        return '<button type="button" class="nodi-node" data-nodi-action="' + item.id + '" style="--dx:' + item.dx + 'px;--dy:' + item.dy + 'px;--mx:' + item.mx + 'px;--my:' + item.my + 'px;transition-delay:' + (index * .03) + 's" tabindex="-1" aria-hidden="true">'
          + ICONS[item.icon] + '<span class="nodi-node-label"></span>'
          + (item.id === 'notifications' ? '<span class="nodi-node-badge" hidden></span>' : '') + '</button>';
      }).join('')
      + '<button type="button" class="nodi-btn" id="nodi-btn" aria-haspopup="menu" aria-expanded="false">' + options.orbSvg + '</button>';
    document.body.appendChild(root);

    var btn = root.querySelector('#nodi-btn');
    var surface = root.querySelector('#nodi-surface');
    var nodes = Array.prototype.slice.call(root.querySelectorAll('.nodi-node'));
    if (!messages.length) messages.push({ role: 'assistant', text: copy().chatWelcome });
    updateLanguage();
    updateNotificationBadge();

    function languageCode() {
      var raw = '';
      try { raw = language() || document.documentElement.lang || navigator.language || 'en'; } catch (error) { raw = document.documentElement.lang || 'en'; }
      raw = String(raw).replace('_', '-').toLowerCase();
      if (raw.indexOf('pt') === 0) return 'pt';
      if (raw.indexOf('zh') === 0) return 'zh';
      return raw.slice(0, 2);
    }

    function copy() { return Object.assign({}, EN, UI[languageCode()] || {}); }
    function localGet(key) { try { return localStorage.getItem(key); } catch (error) { return null; } }
    function localSet(key, value) { try { localStorage.setItem(key, value); } catch (error) {} }

    function loadNotes() {
      try {
        var parsed = JSON.parse(localStorage.getItem('nodus.web.nodi.notes') || '[]');
        return Array.isArray(parsed) ? parsed.filter(function (note) { return note && typeof note.id === 'string'; }) : [];
      } catch (error) { return []; }
    }

    function storeNotes() { localSet('nodus.web.nodi.notes', JSON.stringify(notes)); }

    function updateLanguage() {
      var t = copy();
      btn.setAttribute('aria-label', t.nodiLabel);
      nodes.forEach(function (node) {
        var label = t[node.getAttribute('data-nodi-action')];
        node.setAttribute('aria-label', label);
        node.setAttribute('title', label);
        node.querySelector('.nodi-node-label').textContent = label;
      });
      if (activeSurface !== 'none') renderSurface(activeSurface);
    }

    function setMenu(next) {
      menuOpen = next;
      btn.setAttribute('aria-expanded', String(next));
      nodes.forEach(function (node, index) {
        node.classList.toggle('open', next);
        node.tabIndex = next ? 0 : -1;
        node.setAttribute('aria-hidden', String(!next));
        node.style.transitionDelay = ((next ? index : nodes.length - 1 - index) * .03) + 's';
      });
      if (next) {
        btn.classList.add('waving');
        clearTimeout(waveTimer);
        waveTimer = setTimeout(function () { btn.classList.remove('waving'); }, 950);
      }
    }

    function closeSurface() {
      clearTimeout(saveTimer);
      if (activeSurface === 'notes' && noteView === 'editor') saveCurrentNote();
      activeSurface = 'none';
      surface.innerHTML = '';
    }

    function closeAll() { closeSurface(); setMenu(false); }

    function openSurface(kind) {
      if (activeSurface === kind) { closeSurface(); return; }
      closeSurface();
      activeSurface = kind;
      if (kind === 'notifications') {
        notificationRead = true;
        localSet('nodus.web.nodi.notifications.read', '1');
        updateNotificationBadge();
      }
      if (kind === 'notes') { notes = loadNotes(); noteView = 'list'; activeNoteId = null; }
      renderSurface(kind);
    }

    function panel(title, body, headActions, extraClass) {
      return '<section class="nodi-web-panel ' + (extraClass || '') + '" role="dialog" aria-label="' + escapeHtml(title) + '">'
        + '<header class="nodi-web-head"><span>' + escapeHtml(title) + '</span><span class="grow"></span>' + (headActions || '')
        + '<button type="button" data-nodi-close aria-label="' + escapeHtml(copy().close) + '" title="' + escapeHtml(copy().close) + '">' + ICONS.close + '</button></header>'
        + body + '</section>';
    }

    function renderSurface(kind) {
      if (activeSurface !== kind) return;
      if (kind === 'help') renderHelp();
      else if (kind === 'notifications') renderNotifications();
      else if (kind === 'chat') renderChat();
      else if (kind === 'notes') renderNotes();
      bindSharedPanelControls();
    }

    function bindSharedPanelControls() {
      var close = surface.querySelector('[data-nodi-close]');
      if (close) close.addEventListener('click', closeSurface);
    }

    function renderHelp() {
      var t = copy();
      var rows = [
        [ICONS.chat, t.helpChat], [ICONS.notes, t.helpNotes], [ICONS.bell, t.helpNotifications], [ICONS.up, t.helpTop]
      ].map(function (row) { return '<li><span>' + row[0] + '</span><span>' + row[1] + '</span></li>'; }).join('');
      var body = '<div class="nodi-help"><h3>' + escapeHtml(t.helpTitle) + '</h3><p>' + escapeHtml(t.helpIntro) + '</p><ul>' + rows + '</ul></div>';
      surface.innerHTML = panel(t.help, body, '', 'nodi-help-panel');
    }

    function webNotifications() {
      var t = copy();
      return [
        { title: t.notification1Title, body: t.notification1Body },
        { title: t.notification2Title, body: t.notification2Body },
        { title: t.notification3Title, body: t.notification3Body }
      ];
    }

    function renderNotifications() {
      var t = copy();
      var list = notificationsCleared ? [] : webNotifications();
      var body = list.length
        ? '<div class="nodi-web-body">' + list.map(function (item) { return '<article class="nodi-notification"><span class="nodi-notification-dot"></span><div><b>' + escapeHtml(item.title) + '</b><p>' + escapeHtml(item.body) + '</p></div></article>'; }).join('') + '</div>'
        : '<div class="nodi-web-empty">' + escapeHtml(t.noNotifications) + '</div>';
      var clear = list.length ? '<button type="button" data-clear-notifications>' + escapeHtml(t.clear) + '</button>' : '';
      surface.innerHTML = panel(t.notifications, body, clear, 'nodi-notifications-panel');
      var clearButton = surface.querySelector('[data-clear-notifications]');
      if (clearButton) clearButton.addEventListener('click', function () {
        notificationsCleared = true;
        localSet('nodus.web.nodi.notifications.cleared', '1');
        updateNotificationBadge();
        renderSurface('notifications');
      });
    }

    function updateNotificationBadge() {
      var badge = root.querySelector('.nodi-node-badge');
      var unread = notificationsCleared || notificationRead ? 0 : webNotifications().length;
      badge.hidden = unread === 0;
      badge.textContent = String(unread);
    }

    function renderChat() {
      var t = copy();
      var body = '<div class="nodi-chat-messages" aria-live="polite">' + messages.map(function (message) {
        return '<div class="nodi-chat-message ' + message.role + '">' + escapeHtml(message.text) + '</div>';
      }).join('') + '</div>'
        + '<div class="nodi-chat-suggestions"><button type="button" data-question="' + escapeHtml(t.qWhat) + '">' + escapeHtml(t.qWhat) + '</button><button type="button" data-question="' + escapeHtml(t.qPrivacy) + '">' + escapeHtml(t.qPrivacy) + '</button><button type="button" data-question="' + escapeHtml(t.qDemo) + '">' + escapeHtml(t.qDemo) + '</button></div>'
        + '<form class="nodi-chat-form"><textarea rows="1" aria-label="' + escapeHtml(t.chatPlaceholder) + '" placeholder="' + escapeHtml(t.chatPlaceholder) + '"></textarea><button type="submit" disabled aria-label="' + escapeHtml(t.send) + '" title="' + escapeHtml(t.send) + '">' + ICONS.send + '</button></form>';
      surface.innerHTML = panel(t.chatTitle, body, '', 'nodi-chat-panel');
      var form = surface.querySelector('.nodi-chat-form');
      var input = form.querySelector('textarea');
      var send = form.querySelector('button');
      input.addEventListener('input', function () { send.disabled = !input.value.trim(); });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.value.trim()) submitQuestion(input.value); }
      });
      form.addEventListener('submit', function (event) { event.preventDefault(); if (input.value.trim()) submitQuestion(input.value); });
      Array.prototype.forEach.call(surface.querySelectorAll('[data-question]'), function (question) {
        question.addEventListener('click', function () { submitQuestion(question.getAttribute('data-question')); });
      });
      requestAnimationFrame(function () {
        var list = surface.querySelector('.nodi-chat-messages');
        if (list) list.scrollTop = list.scrollHeight;
      });
    }

    function submitQuestion(question) {
      question = String(question || '').trim();
      if (!question) return;
      messages.push({ role: 'user', text: question });
      messages.push({ role: 'assistant', text: '…' });
      if (activeSurface === 'chat') renderSurface('chat');
      var orb = btn.querySelector('.nodi-orb');
      if (orb) orb.setAttribute('data-state', 'thinking');
      setTimeout(function () {
        messages[messages.length - 1] = { role: 'assistant', text: answerFor(question) };
        if (orb) orb.setAttribute('data-state', 'idle');
        if (activeSurface === 'chat') renderSurface('chat');
      }, 480);
    }

    function answerFor(question) {
      var t = copy();
      var q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/priv|local|telemetr|confiden|datos|data|云|プライバシ|конфиден/.test(q)) return t.answerPrivacy;
      if (/demo|prueba|try|essai|prova|演示|デモ|демо/.test(q)) return t.answerDemo;
      if (/download|descarg|baix|telecharg|herunter|indir|下载|ダウンロード|скач/.test(q)) return t.answerDownload;
      if (/zotero/.test(q)) return t.answerZotero;
      if (/grat|free|gratis|price|precio|cost|open source|kosten|ücretsiz|免费|無料|бесплат/.test(q)) return t.answerFree;
      if (/vault|boved|cofre|mode|modo|tresor|kasa|保险库|モード|сховищ|хранилищ/.test(q)) return t.answerModes;
      if (/(^|\s)(ai|ia|ki)(\s|$)|api|model|ollama|lm studio|intelig|人工智能|модел/.test(q)) return t.answerAi;
      if (/nodus|que es|what is|cos'e|was ist|nedir|是什么|とは|що таке|что такое/.test(q)) return t.answerWhat;
      return t.answerFallback;
    }

    function renderNotes() {
      if (noteView === 'editor') renderNoteEditor();
      else renderNoteList();
    }

    function renderNoteList() {
      var t = copy();
      var sorted = notes.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      var body = sorted.length ? '<div class="nodi-web-body"><div class="nodi-notes-list">' + sorted.map(function (note) {
        var summary = String(note.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return '<article class="nodi-note-row"><button type="button" class="nodi-note-open" data-note-id="' + escapeHtml(note.id) + '"><b>' + escapeHtml(note.title || firstLine(note.content) || t.untitled) + '</b><span>' + escapeHtml(summary || t.saved) + '</span></button><button type="button" class="nodi-web-icon-btn nodi-note-delete" data-delete-note="' + escapeHtml(note.id) + '" aria-label="' + escapeHtml(t.deleteNote) + '" title="' + escapeHtml(t.deleteNote) + '">' + ICONS.trash + '</button></article>';
      }).join('') + '</div></div>' : '<div class="nodi-web-empty">' + escapeHtml(t.emptyNotes) + '</div>';
      var add = '<button type="button" data-new-note aria-label="' + escapeHtml(t.newNote) + '" title="' + escapeHtml(t.newNote) + '">' + ICONS.plus + '</button>';
      surface.innerHTML = panel(t.notesTitle, body, add, 'nodi-notes-panel');
      surface.querySelector('[data-new-note]').addEventListener('click', function () { openNote(null); });
      Array.prototype.forEach.call(surface.querySelectorAll('[data-note-id]'), function (button) { button.addEventListener('click', function () { openNote(button.getAttribute('data-note-id')); }); });
      Array.prototype.forEach.call(surface.querySelectorAll('[data-delete-note]'), function (button) { button.addEventListener('click', function () { deleteNote(button.getAttribute('data-delete-note')); }); });
    }

    function openNote(id) { activeNoteId = id; noteView = 'editor'; renderSurface('notes'); }

    function renderNoteEditor() {
      var t = copy();
      var note = notes.find(function (item) { return item.id === activeNoteId; }) || { title: '', content: '' };
      var back = '<button type="button" data-back-notes aria-label="' + escapeHtml(t.back) + '" title="' + escapeHtml(t.back) + '">' + ICONS.back + '</button>';
      var body = '<div class="nodi-note-editor"><input type="text" maxlength="100" value="' + escapeHtml(note.title) + '" placeholder="' + escapeHtml(t.titlePlaceholder) + '" aria-label="' + escapeHtml(t.titlePlaceholder) + '"><textarea placeholder="' + escapeHtml(t.notePlaceholder) + '" aria-label="' + escapeHtml(t.notePlaceholder) + '">' + escapeHtml(note.content) + '</textarea><div class="nodi-note-foot"><span data-note-status>' + escapeHtml(activeNoteId ? t.saved : '') + '</span><span class="grow"></span>' + (activeNoteId ? '<button type="button" class="nodi-web-icon-btn" data-delete-current aria-label="' + escapeHtml(t.deleteNote) + '" title="' + escapeHtml(t.deleteNote) + '">' + ICONS.trash + '</button>' : '') + '</div></div>';
      surface.innerHTML = panel(activeNoteId ? (note.title || firstLine(note.content) || t.untitled) : t.newNote, body, back, 'nodi-notes-panel');
      var title = surface.querySelector('.nodi-note-editor input');
      var content = surface.querySelector('.nodi-note-editor textarea');
      var status = surface.querySelector('[data-note-status]');
      function queueSave() {
        status.textContent = t.saving;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { saveCurrentNote(); status.textContent = t.saved; }, 420);
      }
      title.addEventListener('input', queueSave);
      content.addEventListener('input', queueSave);
      surface.querySelector('[data-back-notes]').addEventListener('click', function () { saveCurrentNote(); noteView = 'list'; renderSurface('notes'); });
      var remove = surface.querySelector('[data-delete-current]');
      if (remove) remove.addEventListener('click', function () { deleteNote(activeNoteId); });
      requestAnimationFrame(function () { content.focus(); });
    }

    function saveCurrentNote() {
      var editor = surface.querySelector('.nodi-note-editor');
      if (!editor) return;
      var title = editor.querySelector('input').value.trim();
      var content = editor.querySelector('textarea').value;
      if (!title && !content.trim() && !activeNoteId) return;
      var now = Date.now();
      var existing = notes.find(function (note) { return note.id === activeNoteId; });
      if (existing) { existing.title = title; existing.content = content; existing.updatedAt = now; }
      else {
        activeNoteId = 'web-note-' + now + '-' + Math.random().toString(36).slice(2, 7);
        notes.push({ id: activeNoteId, title: title, content: content, updatedAt: now });
      }
      storeNotes();
    }

    function deleteNote(id) {
      notes = notes.filter(function (note) { return note.id !== id; });
      storeNotes();
      activeNoteId = null;
      noteView = 'list';
      renderSurface('notes');
    }

    function firstLine(value) { return String(value || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean)[0] || ''; }

    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menuOpen) closeAll();
      else setMenu(true);
    });

    nodes.forEach(function (node) {
      node.addEventListener('click', function (event) {
        event.stopPropagation();
        var action = node.getAttribute('data-nodi-action');
        if (action === 'top') {
          closeAll();
          window.scrollTo({ top: 0, left: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        } else openSurface(action);
      });
    });

    document.addEventListener('pointerdown', function (event) { if ((menuOpen || activeSurface !== 'none') && !root.contains(event.target)) closeAll(); }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (activeSurface !== 'none') closeSurface();
      else if (menuOpen) setMenu(false);
    });
    new MutationObserver(updateLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  };
})();
