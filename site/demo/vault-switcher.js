/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Shared vault picker for every browser demo. It mirrors the centred badge and
anchored vault panel used by the desktop app, but each row navigates to the
corresponding static demo instead of loading a local database.
*/
(function () {
  'use strict';

  // Exact paths and rendering attributes from src/components/ui.tsx. Keeping the
  // web demos on the app's own icon vocabulary makes the mode badge and panel
  // read identically in both surfaces.
  const appIconPaths = {
    network: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    presentation: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21l4-5 4 5"/><path d="M12 16v5"/><path d="M7 8h4"/><path d="M7 12h7"/>',
    graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    tree: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5V12"/><path d="M12 12H5v4.5"/><path d="M12 12h7v4.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  };
  const appIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${appIconPaths[name]}</svg>`;

  const vaults = [
    { page: 'index.html', href: './', name: 'Learning science', type: 'Academic', tone: 'academic', icon: 'network' },
    { page: 'teaching.html', name: 'Year 9 History', type: 'Teaching', tone: 'teaching', icon: 'presentation', phase: 'BETA' },
    { page: 'study.html', name: 'General Biology', type: 'Study', tone: 'study', icon: 'graduation', phase: 'BETA' },
    { page: 'databases.html', name: 'Field research', type: 'Databases', tone: 'databases', icon: 'table', phase: 'BETA' },
    { page: 'genealogy.html', name: 'Serrano family', type: 'Genealogy', tone: 'genealogy', icon: 'tree', phase: 'BETA' },
    { page: 'worldbuilding.html', name: 'The Ashen Tides', type: 'Worldbuilding', tone: 'worldbuilding', icon: 'globe', phase: 'ALPHA' },
  ];

  const filename = location.pathname.split('/').pop() || 'index.html';
  const active = vaults.find((vault) => vault.page === filename) || vaults[0];
  const shell = document.querySelector('.demo-frame .shell');
  if (!shell) return;

  const bar = document.createElement('header');
  bar.className = 'demo-appbar';
  bar.innerHTML = `
    <a class="demo-app-brand" href="../" aria-label="Nodus home">
      <img src="../assets/nodus-logo.svg" alt=""/><span>Nodus</span>
    </a>
    <button class="demo-vault-trigger ${active.tone}" type="button" data-demo-vault-trigger
      aria-expanded="false" aria-haspopup="menu" aria-controls="demo-vault-menu"
      title="Active vault">
      <span class="demo-vault-trigger-icon">${appIcon(active.icon)}</span>
      <span class="demo-vault-label">${active.type}</span>
      <span class="demo-vault-chevron" aria-hidden="true"></span>
    </button>
    <span class="demo-appbar-balance" aria-hidden="true"></span>
    <section class="demo-vault-popover" id="demo-vault-menu" role="menu" aria-label="Available demo vaults" hidden>
      <div class="demo-vault-popover-head">
        <div><b>Demo vaults</b><span>Choose a workspace to explore</span></div>
        <span class="demo-vault-count">${vaults.length} available</span>
      </div>
      <div class="demo-vault-list">
        ${vaults.map((vault) => {
          const current = vault.page === active.page;
          return `<a class="demo-vault-option ${vault.tone}${current ? ' active' : ''}" href="${vault.href || vault.page}" role="menuitem"${current ? ' aria-current="page"' : ''}>
            <span class="demo-vault-option-icon">${appIcon(vault.icon)}</span>
            <span class="demo-vault-copy"><b>${vault.name}</b><span>${vault.type}${vault.phase ? ` <em>${vault.phase}</em>` : ''}</span></span>
            ${current ? '<span class="demo-vault-active">Active</span><span class="demo-vault-check" aria-hidden="true">✓</span>' : '<span class="demo-vault-load">Open</span><span class="demo-vault-arrow" aria-hidden="true">›</span>'}
          </a>`;
        }).join('')}
      </div>
    </section>`;
  shell.prepend(bar);

  const trigger = bar.querySelector('[data-demo-vault-trigger]');
  const panel = bar.querySelector('.demo-vault-popover');
  const currentOption = bar.querySelector('.demo-vault-option.active');

  function setOpen(open) {
    trigger.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    bar.classList.toggle('vault-open', open);
    if (open) requestAnimationFrame(() => currentOption?.focus({ preventScroll: true }));
  }

  trigger.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !bar.contains(event.target)) setOpen(false);
  });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      trigger.focus();
    }
  });
})();
