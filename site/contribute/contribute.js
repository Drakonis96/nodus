/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The two live figures on the Support Nodus page: how many people have contributed
and how many issues and proposals the project has collected. Both are read from
the GitHub API, both fall back to what the visitor already has, and neither can
leave a card empty or wrong: an unknown number is shown as unknown, never as 0.
*/
(function () {
  'use strict';

  const REPO = 'https://api.github.com/repos/Drakonis96/nodus';
  const REPO_URL = 'https://github.com/Drakonis96/nodus';
  // GitHub counts a few automation accounts as contributors; they are not people
  const BOTS = /(\[bot\]$|^dependabot|^github-actions|^renovate|^snyk|^imgbot|^allcontributors)/i;
  // Assistants and the platform account show up among GitHub contributors. This
  // page names the people who build Nodus, so none of them ever reaches it.
  const NOT_PEOPLE = /^(claude|chatgpt|openai|copilot|github|github-copilot|codex|gemini)$/i;
  // The project's owner opens the list, whatever the contribution counts say.
  const OWNER = 'drakonis96';

  const FACES = 5;
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  /* ------------------------------------------------------------ cache */

  function readCache(key) {
    try {
      const entry = JSON.parse(localStorage.getItem(key));
      if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.value;
    } catch { /* no cache, or unreadable */ }
    return null;
  }

  function writeCache(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch { /* storage full or blocked */ }
  }

  const isPerson = (account) => Boolean(account && account.login)
    && !BOTS.test(account.login)
    && !NOT_PEOPLE.test(account.login);

  /** Owner first, then whoever has contributed most — the order the wall has always used. */
  function order(people) {
    return people.slice().sort((a, b) => {
      const owner = Number(b.login.toLowerCase() === OWNER) - Number(a.login.toLowerCase() === OWNER);
      if (owner) return owner;
      return (b.contributions || 0) - (a.contributions || 0) || a.login.localeCompare(b.login);
    });
  }

  /* ------------------------------------------------------------ faces */

  /** The first few faces plus a counter for the rest. Each one links to its account. */
  function faces(host, people, total) {
    if (!host) return;
    const shown = people.slice(0, FACES);
    const rest = Math.max(0, (total || people.length) - shown.length);
    host.innerHTML = shown.map((person) => `<img src="${person.avatar_url}&s=64" alt="${person.login}" width="28" height="28" loading="lazy"/>`).join('')
      + (rest ? `<span class="more">+${rest.toLocaleString('en')}</span>` : '');
  }

  function number(host, value) {
    if (host) host.textContent = Number(value).toLocaleString('en');
  }

  function unknown(host, link) {
    if (host) host.innerHTML = '<span class="figure-loading">—</span>';
    if (link) link.remove();
  }

  /* ------------------------------------------------------------ contributors */

  function contributors() {
    const count = document.getElementById('contributor-count');
    const host = document.getElementById('contributor-avatars');
    const show = (list) => {
      const people = order((Array.isArray(list) ? list : []).filter(isPerson));
      if (!people.length) return false;
      number(count, people.length);
      faces(host, people, people.length);
      return true;
    };

    return fetch(`${REPO}/contributors?per_page=100`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`contributors ${response.status}`))))
      .then((list) => {
        // GitHub rate-limits anonymous callers hard, so a good answer is kept
        // for the day: a failed refresh must never blank the card.
        writeCache('nodus-contributors', list);
        return show(list);
      })
      .catch(() => {
        if (show(readCache('nodus-contributors'))) return true;
        // last resort: the snapshot published with the site
        return fetch('../data/contributors.json')
          .then((response) => (response.ok ? response.json() : []))
          .then(show)
          .catch(() => false);
      })
      .then((shown) => {
        if (!shown) unknown(count, host);
        return shown;
      });
  }

  /* ------------------------------------------------------------ issues and proposals
     Every issue and pull request the project has collected, in one request: the
     search endpoint reports the total it matched AND the newest few, which is
     what the card needs for both its number and its faces. The issues endpoint
     cannot answer this any more — it paginates by cursor now, so it publishes no
     total and no last page to read. */

  function issues() {
    const count = document.getElementById('issue-count');
    const host = document.getElementById('issue-avatars');
    const show = (entries, total) => {
      if (!Number.isFinite(total) || total <= 0) return false;
      number(count, total);
      const authors = [];
      for (const entry of entries) {
        const author = entry && entry.user;
        if (!isPerson(author)) continue;
        if (authors.some((person) => person.login === author.login)) continue;
        authors.push(author);
      }
      faces(host, authors, total);
      return true;
    };

    const query = encodeURIComponent('repo:Drakonis96/nodus');
    // More than the five faces are fetched on purpose: the newest entries can
    // all belong to the same person, and a row of one repeated face says nothing.
    return fetch(`https://api.github.com/search/issues?q=${query}&per_page=${FACES * 6}&sort=created&order=desc`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`search ${response.status}`))))
      .then((result) => {
        const total = Number(result && result.total_count);
        const entries = (result && result.items) || [];
        if (Number.isFinite(total)) writeCache('nodus-issues', { total, logins: entries.map((entry) => entry?.user?.login).filter(Boolean) });
        return show(entries, total);
      })
      .catch(() => {
        // The search endpoint throttles anonymous callers hard, so a card the
        // visitor already has stays filled; an unknown total is left unknown
        // rather than shown as a number the project never reached.
        const cached = readCache('nodus-issues');
        if (!cached) return false;
        number(count, cached.total);
        return true;
      })
      .then((shown) => {
        if (!shown) unknown(count, host);
        return shown;
      });
  }

  contributors();
  issues();
})();
