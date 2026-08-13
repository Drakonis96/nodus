const content = await fetch('./content.json?v=20260814b').then((response) => {
  if (!response.ok) throw new Error(`Documentation could not be loaded (${response.status}).`);
  return response.json();
});

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const imagePath = (image) => `./assets/${image}`;
const vaultIconPaths = {
  network: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  tree: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5V12"/><path d="M12 12H5v4.5"/><path d="M12 12h7v4.5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
  presentation: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21l4-5 4 5"/><path d="M12 16v5"/><path d="M7 8h4"/><path d="M7 12h7"/>',
};

function iconMarkup(icon = 'nodus') {
  const paths = vaultIconPaths[icon];
  if (!paths) return '<img class="nodus-mark" src="../assets/nodus-logo.svg" alt=""/>';
  return `<svg class="vault-icon-svg" data-icon="${icon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const allPages = [
  { type: 'home', id: 'home', title: 'Nodus Wiki', summary: 'Complete guides for every stable Nodus vault.', accent: '#8b5cf6', icon: 'nodus' },
  ...content.common.map((chapter) => ({ ...chapter, type: 'common', accent: '#8b5cf6', icon: 'nodus' })),
  ...content.vaults.flatMap((vault) => [
    { ...vault, type: 'vault', title: vault.name, summary: vault.tagline, accent: vault.accent },
    ...vault.chapters.map((chapter) => ({ ...chapter, type: 'chapter', vault, accent: vault.accent, icon: vault.icon })),
  ]),
];

function buildNavigation() {
  const commonGroups = Object.groupBy ? Object.groupBy(content.common, (item) => item.group) : content.common.reduce((groups, item) => ((groups[item.group] ||= []).push(item), groups), {});
  const common = Object.entries(commonGroups).map(([group, chapters]) => `<div class="nav-group"><b>${escapeHtml(group)}</b>${chapters.map((chapter) => navLink(chapter.id, chapter.title, '#8b5cf6')).join('')}</div>`).join('');
  const vaults = content.vaults.map((vault) => `<details class="nav-vault" data-vault="${vault.id}"><summary style="--vault-accent:${vault.accent}"><span class="vault-mark">${iconMarkup(vault.icon)}</span>${escapeHtml(vault.name)}</summary>${navLink(vault.id, 'Overview', vault.accent)}${vault.chapters.map((chapter) => navLink(chapter.id, chapter.title, vault.accent)).join('')}</details>`).join('');
  $('#wiki-nav').innerHTML = `${navLink('home', 'Wiki home', '#8b5cf6')}<div class="nav-group"><b>Core guide</b></div>${common}<div class="nav-group"><b>Vault manuals</b></div>${vaults}`;
}

function navLink(id, title, accent) {
  return `<a class="nav-link" href="#${id}" data-page="${id}" style="--nav-accent:${accent}"><span class="nav-dot"></span>${escapeHtml(title)}</a>`;
}

function figure(image, caption) {
  if (!image) return '';
  return `<figure class="doc-figure"><img src="${imagePath(image)}" alt="${escapeHtml(caption)}" loading="lazy"/><figcaption>${escapeHtml(caption)} - English interface, sample vault.</figcaption></figure>`;
}

function sectionMarkup(chapter, accent, showFigure = true) {
  return `<section class="doc-section" id="${chapter.id}">
    <p class="section-kicker">${escapeHtml(chapter.group)}</p>
    <h2>${escapeHtml(chapter.title)}</h2>
    <p class="section-summary">${escapeHtml(chapter.summary)}</p>
    <p class="section-details">${escapeHtml(chapter.details)}</p>
    <div class="section-grid"><div class="howto"><h3>Step by step</h3><ol>${chapter.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div>
    <aside class="tipbox"><h3>Good practice</h3><ul>${chapter.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></aside></div>
    ${showFigure ? figure(chapter.image, chapter.title) : ''}
  </section>`;
}

function homeMarkup() {
  return `<div style="--accent:#8b5cf6"><p class="eyebrow">Official documentation</p><h1>Learn Nodus from first launch to finished work.</h1>
    <p class="lead">A complete English guide to the five stable vaults, with real interface captures, evidence-aware workflows, privacy notes and downloadable professional manuals.</p>
    <div class="meta-row"><span class="pill">Nodus ${escapeHtml(content.version)}</span><span class="pill">Updated ${escapeHtml(content.updated)}</span><span class="pill">${content.vaults.reduce((n,v)=>n+v.chapters.length,0)} feature tutorials</span><span class="pill">Searchable offline documentation</span></div>
    <div class="hero-actions"><a class="action primary" href="#welcome">Start with the essentials</a><a class="action" href="../demo/">Open the live demo</a></div>
    ${figure('academic/home.png', 'Nodus Academic Research home')}
    <section class="doc-section"><p class="section-kicker">Choose a workspace</p><h2>Five vaults, one local-first engine</h2><p class="section-details">Start with the vault that matches the work, not with a generic empty canvas. Each guide explains the full navigation and the safest path from source material to a finished output.</p>
    <div class="vault-grid">${content.vaults.map((vault) => `<article class="vault-card" style="--card-accent:${vault.accent}"><span class="vault-mark" style="--vault-accent:${vault.accent}">${iconMarkup(vault.icon)}</span><h2>${escapeHtml(vault.name)}</h2><p>${escapeHtml(vault.tagline)}</p><div class="vault-card-actions"><a href="#${vault.id}">Open the ${escapeHtml(vault.short)} guide →</a><a href="${vault.pdf}" download>Download PDF ↓</a></div></article>`).join('')}</div></section>
    <aside class="callout"><b>Documentation principle</b><p>Every generated summary, relationship or citation remains something to inspect. Nodus helps organise reasoning; it does not turn automated output into evidence.</p></aside>
  </div>`;
}

function vaultMarkup(vault) {
  return `<div style="--accent:${vault.accent}"><p class="eyebrow">${escapeHtml(vault.name)} vault</p><h1>${escapeHtml(vault.tagline)}</h1><p class="lead">${escapeHtml(vault.description)}</p>
    <div class="meta-row"><span class="pill">For ${escapeHtml(vault.audience)}</span><span class="pill">${vault.chapters.length} complete tutorials</span><span class="pill">English screenshots</span></div>
    <div class="hero-actions"><a class="action primary" href="#${vault.chapters[0].id}">Begin the guide</a><a class="action" href="${vault.demo}">Try this vault</a><a class="action" href="${vault.pdf}" download>Download PDF manual</a></div>
    ${figure(`${vault.id}/home.png`, `${vault.name} vault overview`)}
    <section class="doc-section"><p class="section-kicker">Contents</p><h2>Complete ${escapeHtml(vault.short)} workflow</h2><div class="chapter-list">${vault.chapters.map((chapter,index) => `<a class="chapter-card" href="#${chapter.id}"><small>${String(index+1).padStart(2,'0')} · ${escapeHtml(chapter.group)}</small><b>${escapeHtml(chapter.title)}</b><span>${escapeHtml(chapter.summary)}</span></a>`).join('')}</div></section>
    ${vault.chapters.map((chapter, index) => sectionMarkup(chapter, vault.accent, index === 0 || index % 2 === 1)).join('')}
  </div>`;
}

function commonMarkup(chapter) {
  return `<div style="--accent:#8b5cf6"><p class="eyebrow">Core guide</p><h1>${escapeHtml(chapter.title)}</h1><p class="lead">${escapeHtml(chapter.summary)}</p>${sectionMarkup(chapter, '#8b5cf6')}</div>`;
}

function render(id) {
  const page = allPages.find((entry) => entry.id === id) || allPages[0];
  if (page.type === 'home') $('#article').innerHTML = homeMarkup();
  else if (page.type === 'vault') $('#article').innerHTML = vaultMarkup(page);
  else if (page.type === 'common') $('#article').innerHTML = commonMarkup(page);
  else $('#article').innerHTML = vaultMarkup(page.vault);
  document.documentElement.style.setProperty('--accent', page.accent || '#8b5cf6');
  document.title = page.type === 'home' ? 'Nodus Wiki - Complete vault guides' : `${page.title} - Nodus Wiki`;
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === page.id));
  const parent = page.vault || (page.type === 'vault' ? page : null);
  if (parent) $(`.nav-vault[data-vault="${parent.id}"]`)?.setAttribute('open','');
  const sections = [...$('#article').querySelectorAll('.doc-section[id]')];
  $('#page-toc').innerHTML = sections.map((section) => `<a href="#${section.id}">${escapeHtml($('h2', section)?.textContent || '')}</a>`).join('');
  requestAnimationFrame(() => {
    if (page.type === 'chapter') $(`#${CSS.escape(page.id)}`)?.scrollIntoView();
    else window.scrollTo({ top: 0 });
  });
}

function search(query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return allPages.map((page) => {
    const haystack = [page.title,page.summary,page.details,page.tagline,page.description,page.group,...(page.steps||[]),...(page.tips||[])].filter(Boolean).join(' ').toLowerCase();
    const score = terms.reduce((sum, term) => sum + (page.title.toLowerCase().includes(term) ? 8 : 0) + (haystack.split(term).length - 1), 0);
    return { page, score };
  }).filter((item) => item.score > 0).sort((a,b) => b.score-a.score).slice(0,12);
}

function showResults(value) {
  const box = $('#search-results');
  if (!value.trim()) { box.hidden = true; box.innerHTML = ''; return; }
  const results = search(value);
  box.innerHTML = results.length ? results.map(({page}) => `<a class="search-result" href="#${page.id}" style="--result-accent:${page.accent}"><span class="result-icon">${iconMarkup(page.icon || page.vault?.icon)}</span><span><b>${escapeHtml(page.title)}</b><span>${escapeHtml(page.vault?.name || (page.type === 'vault' ? page.name : page.group || 'Core guide'))} · ${escapeHtml(page.summary || page.tagline || '')}</span></span></a>`).join('') : '<div class="search-empty">No guide matches that search.</div>';
  box.hidden = false;
}

buildNavigation();
$('#version').textContent = `Nodus ${content.version}`;
render(location.hash.slice(1) || 'home');
function setNavigationOpen(open, restoreFocus = false) {
  document.body.classList.toggle('nav-open', open);
  $('#nav-toggle').setAttribute('aria-expanded', String(open));
  $('#nav-backdrop').hidden = !open;
  if (open) requestAnimationFrame(() => $('#nav-close').focus());
  else if (restoreFocus) $('#nav-toggle').focus();
}

addEventListener('hashchange', () => { render(location.hash.slice(1) || 'home'); $('#search-results').hidden = true; $('#search').value = ''; setNavigationOpen(false); });
$('#search').addEventListener('input', (event) => showResults(event.target.value));
$('#search').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.target.value = ''; showResults(''); event.target.blur(); } });
addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); }
  else if (event.key === 'Escape' && document.body.classList.contains('nav-open')) setNavigationOpen(false, true);
});
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.search-wrap')) $('#search-results').hidden = true; });
$('#nav-toggle').addEventListener('click', () => setNavigationOpen(true));
$('#nav-close').addEventListener('click', () => setNavigationOpen(false, true));
$('#nav-backdrop').addEventListener('click', () => setNavigationOpen(false, true));
