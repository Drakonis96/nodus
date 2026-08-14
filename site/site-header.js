/* Shared markup for the landing page and all live demos. */
(function () {
  const LANGUAGES = [
    { c: 'de', n: 'Deutsch', f: '🇩🇪' }, { c: 'en', n: 'English', f: '🇬🇧' },
    { c: 'es', n: 'Español', f: '🇪🇸' }, { c: 'fr', n: 'Français', f: '🇫🇷' },
    { c: 'it', n: 'Italiano', f: '🇮🇹' }, { c: 'ja', n: '日本語', f: '🇯🇵' },
    { c: 'pt-PT', n: 'Português (Portugal)', f: '🇵🇹' }, { c: 'pt-BR', n: 'Português (Brasil)', f: '🇧🇷' },
    { c: 'ru', n: 'Русский', f: '🇷🇺' }, { c: 'tr', n: 'Türkçe', f: '🇹🇷' },
    { c: 'uk', n: 'Українська', f: '🇺🇦' }, { c: 'zh', n: '中文', f: '🇨🇳' },
  ];
  const DEMO_NAV_TRANSLATIONS = {
    de: ['Tresore', "So funktioniert's", 'Ansichten', 'Wiki', 'Mitmachen', 'Live-Demo testen'],
    en: ['Vaults', 'How it works', 'Views', 'Wiki', 'Contribute', 'Try the live demo'],
    es: ['Vaults', 'Cómo funciona', 'Vistas', 'Wiki', 'Contribuir', 'Probar la demo'],
    fr: ['Coffres', 'Comment ça marche', 'Vues', 'Wiki', 'Contribuer', 'Essayer la démo'],
    it: ['Vault', 'Come funziona', 'Viste', 'Wiki', 'Contribuisci', 'Prova la demo'],
    ja: ['Vault', '仕組み', '画面', 'Wiki', '参加する', 'ライブデモを試す'],
    'pt-PT': ['Cofres', 'Como funciona', 'Vistas', 'Wiki', 'Contribuir', 'Testar a demo'],
    'pt-BR': ['Cofres', 'Como funciona', 'Vistas', 'Wiki', 'Contribuir', 'Testar a demo'],
    ru: ['Хранилища', 'Как это работает', 'Обзоры', 'Wiki', 'Участвовать', 'Открыть демо'],
    tr: ['Kasalar', 'Nasıl çalışır', 'Görünümler', 'Wiki', 'Katkıda bulun', 'Demoyu dene'],
    uk: ['Сховища', 'Як це працює', 'Огляди', 'Wiki', 'Долучитися', 'Спробувати демо'],
    zh: ['保险库', '工作原理', '视图', 'Wiki', '参与贡献', '试用演示'],
  };
  const DEMO_FAQ_TRANSLATIONS = {
    en: 'FAQ', es: 'Preguntas', fr: 'FAQ', it: 'FAQ', de: 'FAQ',
    'pt-PT': 'FAQ', 'pt-BR': 'FAQ', tr: 'Sorular', zh: '常见问题',
    ja: 'よくある質問', uk: 'Поширені запитання', ru: 'Частые вопросы',
  };
  const DEMO_DOWNLOAD_TRANSLATIONS = {
    de: ['{n} Downloads', 'Paket-Downloads aus GitHub Releases · täglich aktualisiert'],
    en: ['{n} downloads', 'Package downloads from GitHub Releases · updated daily'],
    es: ['{n} descargas', 'Descargas de paquetes desde GitHub Releases · actualizado diariamente'],
    fr: ['{n} téléchargements', 'Téléchargements de paquets depuis GitHub Releases · mis à jour quotidiennement'],
    it: ['{n} download', 'Download dei pacchetti da GitHub Releases · aggiornato ogni giorno'],
    'pt-PT': ['{n} downloads', 'Downloads de pacotes do GitHub Releases · atualizado diariamente'],
    'pt-BR': ['{n} downloads', 'Downloads de pacotes do GitHub Releases · atualizado diariamente'],
    tr: ['{n} indirme', 'GitHub Releases paket indirmeleri · günlük güncellenir'],
    zh: ['{n} 次下载', 'GitHub Releases 软件包下载量 · 每日更新'],
  };

  function browserLanguage(value) {
    const normalized = (value || 'en').replace('_', '-').toLowerCase();
    if (normalized.startsWith('pt-br')) return 'pt-BR';
    if (normalized.startsWith('pt')) return 'pt-PT';
    const base = normalized.slice(0, 2);
    return LANGUAGES.some((language) => language.c === base) ? base : 'en';
  }

  function headerMarkup(base, context) {
    const isLinkedPage = context !== 'landing';
    const isWiki = context === 'wiki';
    const home = isLinkedPage ? `${base}index.html` : '';
    const section = (anchor) => isLinkedPage ? `${home}${anchor}` : anchor;
    const wiki = `${base}wiki/`;
    return `<nav class="nav${isWiki ? ' wiki-nav' : ''}" id="site-header">
      ${isWiki ? '<button id="nav-toggle" class="wiki-menu-toggle" type="button" aria-label="Open documentation menu" aria-controls="wiki-sidebar" aria-expanded="false"><span></span><span></span><span></span></button>' : ''}
      <a class="logo" href="${isLinkedPage ? home : '#'}"><img src="${base}assets/nodus-logo.svg" alt=""/> Nodus</a>
      ${isWiki ? `<div class="wiki-search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
        <input id="search" type="search" placeholder="Search guides, features and workflows..." autocomplete="off" aria-label="Search the Nodus Wiki"/>
        <kbd>⌘ K</kbd>
        <div id="search-results" class="search-results" hidden></div>
      </div>` : ''}
      <div class="links">
        <a href="${section('#vaults')}" class="hideS" data-i18n="nav.vaults">Vaults</a>
        <a href="${section('#story')}" class="hideS nav-secondary" data-i18n="nav.how">How it works</a>
        <a href="${section('#views')}" class="hideS nav-secondary" data-i18n="nav.views">Views</a>
        <a href="${wiki}" class="hideS" data-i18n="nav.tutorials">Wiki</a>
        <a href="${section('#contrib')}" class="hideS nav-secondary" data-i18n="nav.contrib">Contribute</a>
        <a href="${section('#faq')}" class="hideS" id="faq-nav-link">FAQ</a>
        <div class="lang-picker" id="lang-picker">
          <button class="lang-trigger" id="lang-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="lang-menu" aria-label="Choose language">
            <span class="lang-flag" id="lang-current-flag" aria-hidden="true">🇬🇧</span>
            <span class="lang-name" id="lang-current-name">English</span>
            <svg class="lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="lang-menu" id="lang-menu" role="listbox" aria-labelledby="lang-trigger" hidden></div>
        </div>
        <a class="gh-badge" href="https://github.com/Drakonis96/nodus" target="_blank" rel="noopener" title="Star Nodus on GitHub">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
          <span class="lbl">Star</span>
          <span class="stars"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.8 4.2.62c.61.09.86.84.41 1.28l-3.04 2.96.72 4.18a.75.75 0 0 1-1.09.79L8 12.35l-3.76 1.97a.75.75 0 0 1-1.08-.79l.72-4.18L.83 6.37a.75.75 0 0 1 .41-1.28l4.2-.61L7.32.67A.75.75 0 0 1 8 .25Z"/></svg><span id="star-count" aria-label="Stars on GitHub">·</span></span>
        </a>
        <a class="release-downloads" id="release-downloads" data-state="loading" href="https://github.com/Drakonis96/nodus/releases" target="_blank" rel="noopener" aria-describedby="release-downloads-tooltip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="download-value" id="release-download-count">—</span>
          <span class="download-word" id="release-download-word">downloads</span>
          <span class="download-tooltip" id="release-downloads-tooltip" role="tooltip">Package downloads from GitHub Releases · updated daily</span>
        </a>
        <a class="btn primary" href="${base}demo/index.html" data-i18n="nav.demo">Try the live demo</a>
      </div>
    </nav>`;
  }

  function initDemoHeader(host, base) {
    const nav = host.querySelector('#site-header');
    const trigger = host.querySelector('#lang-trigger');
    const menu = host.querySelector('#lang-menu');
    const picker = host.querySelector('#lang-picker');
    const optionsMarkup = LANGUAGES.map((language) => `<button class="lang-option" type="button" role="option" aria-selected="false" data-lang="${language.c}">
      <span class="lang-flag" aria-hidden="true">${language.f}</span><span>${language.n}</span>
      <svg class="lang-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
    </button>`).join('');
    menu.innerHTML = optionsMarkup;
    const options = [...menu.querySelectorAll('.lang-option')];
    let downloadTotal = null;

    function updateDownloads(language) {
      const [template, tooltipText] = DEMO_DOWNLOAD_TRANSLATIONS[language.c] || DEMO_DOWNLOAD_TRANSLATIONS.en;
      const formatted = Number.isFinite(downloadTotal)
        ? new Intl.NumberFormat(language.c, { notation: 'compact', maximumFractionDigits: 1 }).format(downloadTotal)
        : '—';
      const fullLabel = template.replace('{n}', formatted);
      host.querySelector('#release-download-count').textContent = formatted;
      host.querySelector('#release-download-word').textContent = fullLabel.replace(formatted, '').trim() || 'downloads';
      host.querySelector('#release-downloads-tooltip').textContent = tooltipText;
      host.querySelector('#release-downloads').setAttribute('aria-label', fullLabel);
    }

    function applyLanguage(code) {
      const language = LANGUAGES.find((item) => item.c === code) || LANGUAGES.find((item) => item.c === 'en');
      const labels = DEMO_NAV_TRANSLATIONS[language.c] || DEMO_NAV_TRANSLATIONS.en;
      host.querySelectorAll('[data-i18n]').forEach((element, index) => { if (labels[index]) element.textContent = labels[index]; });
      host.querySelector('#faq-nav-link').textContent = DEMO_FAQ_TRANSLATIONS[language.c] || 'FAQ';
      host.querySelector('#lang-current-flag').textContent = language.f;
      host.querySelector('#lang-current-name').textContent = language.n;
      options.forEach((option) => option.setAttribute('aria-selected', String(option.dataset.lang === language.c)));
      document.documentElement.lang = language.c;
      updateDownloads(language);
      try { localStorage.setItem('nodus.lang', language.c); } catch (error) {}
    }
    function closeMenu(returnFocus) {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }
    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => (menu.querySelector('[aria-selected="true"]') || options[0]).focus());
    }
    trigger.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu(false));
    options.forEach((option) => option.addEventListener('click', () => { applyLanguage(option.dataset.lang); closeMenu(true); }));
    document.addEventListener('pointerdown', (event) => { if (!picker.contains(event.target)) closeMenu(false); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(false); });
    let language = 'en';
    try { language = localStorage.getItem('nodus.lang') || browserLanguage((navigator.languages && navigator.languages[0]) || navigator.language); } catch (error) {}
    applyLanguage(language === 'pt' ? 'pt-PT' : language);

    const paintStars = (value) => {
      if (!Number.isFinite(value)) return;
      const target = host.querySelector('#star-count');
      target.textContent = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
      target.setAttribute('aria-label', `${value} stars on GitHub`);
    };
    fetch('https://api.github.com/repos/Drakonis96/nodus', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { const value = result && Number(result.stargazers_count); if (Number.isFinite(value)) paintStars(value); })
      .catch(() => {});
    fetch(`${base}data/github-release-downloads.json`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const total = result && Number(result.total);
        if (!Number.isFinite(total)) throw new Error('invalid release download stats');
        downloadTotal = total;
        const language = LANGUAGES.find((item) => item.c === document.documentElement.lang) || LANGUAGES.find((item) => item.c === 'en');
        updateDownloads(language);
        host.querySelector('#release-downloads').setAttribute('data-state', 'ready');
      })
      .catch(() => host.querySelector('#release-downloads').setAttribute('data-state', 'error'));
    const syncBorder = () => nav.classList.toggle('scrolled', window.scrollY > 24);
    addEventListener('scroll', syncBorder, { passive: true });
    syncBorder();
  }

  document.querySelectorAll('[data-nodus-site-header]').forEach((host) => {
    const base = host.dataset.base || '';
    const context = host.dataset.context || 'landing';
    host.innerHTML = headerMarkup(base, context);
    if (context !== 'landing') initDemoHeader(host, base);
  });
})();
