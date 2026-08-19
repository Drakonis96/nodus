/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The blog index: reads posts.json, lists the published posts, and filters them by
tag and by free text. With no published posts it shows what is coming instead.
*/
(function () {
  'use strict';

  // The feed address is only useful pasted into a reader, so offer it as a copy
  // rather than as one more link into raw XML. Shown only where copying works.
  const copyButton = document.getElementById('feed-copy');
  if (copyButton && navigator.clipboard && window.isSecureContext) {
    const label = document.getElementById('feed-copy-label');
    const idle = label.textContent;
    let restore;
    copyButton.hidden = false;
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(copyButton.dataset.url).then(() => {
        label.textContent = 'Copied — paste it into your feed reader';
        copyButton.classList.add('copied');
        clearTimeout(restore);
        restore = setTimeout(() => {
          label.textContent = idle;
          copyButton.classList.remove('copied');
        }, 3200);
      }).catch(() => {
        // clipboard refused: show the address so it can be selected by hand
        label.textContent = copyButton.dataset.url;
      });
    });
  }

  const list = document.getElementById('blog-list');
  const filters = document.getElementById('blog-filters');
  const tagsHost = document.getElementById('blog-tags');
  const search = document.getElementById('blog-search');
  const clear = document.getElementById('blog-clear');
  const meta = document.getElementById('blog-meta');
  const empty = document.getElementById('blog-empty');
  const soon = document.getElementById('blog-soon');
  if (!list) return;

  const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]
  ));

  const formatDate = (value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  let posts = [];
  let tag = 'all';
  let query = '';

  function render() {
    const needle = query.trim().toLowerCase();
    const matches = posts.filter((post) => {
      if (tag !== 'all' && !(post.tags || []).includes(tag)) return false;
      if (!needle) return true;
      return `${post.title} ${post.summary} ${(post.tags || []).join(' ')}`.toLowerCase().includes(needle);
    });

    list.innerHTML = matches.map((post, index) => `<a class="post-card lit reveal${post.cover ? ' has-cover' : ''}" href="post.html?p=${encodeURIComponent(post.slug)}" style="--delay:${Math.min(index, 6) * 60}ms">
      ${post.cover ? `<span class="post-card-cover"><img src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.coverAlt || '')}" loading="lazy" decoding="async"/></span>` : ''}
      <span class="post-card-body">
      <div class="post-card-meta">
        <time datetime="${escapeHtml(post.date)}">${formatDate(post.date)}</time>
        ${post.reading ? `<span>${post.reading} min read</span>` : ''}
      </div>
      <h2>${escapeHtml(post.title)}</h2>
      <p>${escapeHtml(post.summary || '')}</p>
      <div class="post-card-tags">${(post.tags || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
      <span class="post-card-go">Read the post
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
      </span>
    </a>`).join('');

    list.querySelectorAll('.reveal').forEach((card) => card.classList.add('seen'));
    // a cover that cannot be loaded leaves the card as if it never had one
    list.querySelectorAll('.post-card-cover img').forEach((image) => {
      image.addEventListener('error', () => {
        const card = image.closest('.post-card');
        if (card) card.classList.remove('has-cover');
        image.closest('.post-card-cover')?.remove();
      }, { once: true });
    });
    empty.hidden = matches.length > 0;
    meta.textContent = matches.length === posts.length
      ? `${posts.length} post${posts.length === 1 ? '' : 's'}`
      : `Showing ${matches.length} of ${posts.length} posts`;
    clear.hidden = !query;
    tagsHost.querySelectorAll('.filter-tab').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tag === tag));
    });
  }

  function wire(tags) {
    tagsHost.innerHTML = [{ id: 'all', label: 'All' }, ...tags.map((item) => ({ id: item, label: item }))]
      .map((item) => `<button class="filter-tab" type="button" data-tag="${escapeHtml(item.id)}"
        aria-pressed="${item.id === 'all'}">${escapeHtml(item.label)}</button>`).join('');

    tagsHost.addEventListener('click', (event) => {
      const button = event.target.closest('.filter-tab');
      if (!button) return;
      tag = button.dataset.tag;
      render();
    });

    let debounce = 0;
    search.addEventListener('input', () => {
      query = search.value;
      clearTimeout(debounce);
      debounce = setTimeout(render, 120);
    });
    clear.addEventListener('click', () => {
      query = '';
      search.value = '';
      search.focus();
      render();
    });
  }

  fetch('posts.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no index'))))
    .then((data) => {
      posts = (Array.isArray(data.posts) ? data.posts : [])
        .filter((post) => post && post.slug && post.title && post.date && !post.draft)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      if (!posts.length) {
        soon.hidden = false;
        meta.hidden = true;
        return;
      }

      const tags = [...new Set(posts.flatMap((post) => post.tags || []))].sort();
      filters.hidden = tags.length < 2 && posts.length < 4;
      if (!filters.hidden) wire(tags);
      render();
    })
    .catch(() => {
      soon.hidden = false;
      meta.hidden = true;
    });
})();
