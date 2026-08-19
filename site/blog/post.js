/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Renders one post. The slug comes from ?p=, its metadata from posts.json and its
body from posts/<slug>.md. A slug that is not listed as a published post is
never fetched, so the query string cannot be used to pull an arbitrary file.
*/
(function () {
  'use strict';

  const article = document.getElementById('article');
  const titleNode = document.getElementById('post-title');
  const metaNode = document.getElementById('post-meta');
  const tagsNode = document.getElementById('post-tags');
  const foot = document.getElementById('post-foot');
  const nextLink = document.getElementById('post-next');
  const cover = document.getElementById('post-cover');
  const coverImage = document.getElementById('post-cover-img');
  if (!article) return;

  const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]
  ));

  const formatDate = (value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  function fail(message) {
    titleNode.textContent = 'Post not found';
    document.title = 'Post not found · Nodus Blog';
    metaNode.textContent = '';
    article.innerHTML = `<p>${escapeHtml(message)}</p>
      <p><a href="./">Back to all posts →</a></p>`;
  }

  const slug = new URLSearchParams(location.search).get('p') || '';

  fetch('posts.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no index'))))
    .then((data) => {
      const published = (Array.isArray(data.posts) ? data.posts : [])
        .filter((post) => post && post.slug && post.title && post.date && !post.draft)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const post = published.find((item) => item.slug === slug);
      if (!post) {
        fail(published.length
          ? 'That post does not exist, or it has not been published yet.'
          : 'There are no published posts yet.');
        return null;
      }

      titleNode.textContent = post.title;
      document.title = `${post.title} · Nodus Blog`;
      const description = document.querySelector('meta[name="description"]');
      if (description && post.summary) description.setAttribute('content', post.summary);

      if (post.cover && cover && coverImage) {
        // a cover that cannot be loaded leaves the post as if it never had one
        coverImage.addEventListener('error', () => { cover.hidden = true; }, { once: true });
        coverImage.src = post.cover;
        coverImage.alt = post.coverAlt || '';
        cover.hidden = false;
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) ogImage.setAttribute('content', new URL(post.cover, location.href).href);
      }

      tagsNode.innerHTML = (post.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');

      // fetch the body only after the slug is confirmed against the index
      return fetch(`posts/${encodeURIComponent(post.slug)}.md`)
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error('no body'))))
        .then((source) => {
          const rendered = window.NodusMarkdown.render(source);
          article.innerHTML = rendered.html;

          const words = source.split(/\s+/).filter(Boolean).length;
          const minutes = post.reading || Math.max(1, Math.round(words / 220));
          metaNode.textContent = `${formatDate(post.date)} · ${minutes} min read`;

          const index = published.indexOf(post);
          const next = published[index + 1];
          if (next) {
            nextLink.href = `post.html?p=${encodeURIComponent(next.slug)}`;
            nextLink.textContent = `${next.title} →`;
          } else {
            nextLink.hidden = true;
          }
          foot.hidden = false;
          return rendered;
        });
    })
    .catch(() => fail('The post could not be loaded. It may have been moved or renamed.'));
})();
