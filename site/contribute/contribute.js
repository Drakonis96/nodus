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
  // The project's owner opens the contributor list, whatever the counts say,
  // and their own issues and proposals are not community ones: the card that
  // counts them asks GitHub to leave the owner out.
  const OWNER_LOGIN = 'Drakonis96';
  const OWNER = OWNER_LOGIN.toLowerCase();

  // A face is 20px wide and overlaps the one before it by 7px; the counter that
  // closes the row needs a little more room than a face. The row is measured
  // against these, so the numbers here and the sizes in contribute.css are one
  // value in two places.
  const AVATAR = 20;
  const STEP = 13;
  const COUNTER = 52;
  // The row's own width decides how many faces it holds; this only bounds a card
  // so wide that a hundred faces would stop reading as people.
  const FACES = 24;
  const PER_PAGE = 100;   // the search endpoint's own ceiling

  const CACHE_TTL = 24 * 60 * 60 * 1000;
  // The key says what the card counts. It changed meaning when the owner's own
  // issues stopped being community ones, and an old entry must not outlive that.
  const ISSUES_CACHE = 'nodus-issues-community';

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

  /* Every row on the page, so each can be measured again when the window
     changes size instead of holding whatever the first paint decided. */
  const rows = new Map();
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { for (const render of rows.values()) render(); }, 180);
  }, { passive: true });

  /* How many faces a row can hold. A card is as wide as the viewport decides, so
     a fixed count either wastes half the row on a large screen or overflows on a
     small one: faces are added while they fit, and the counter that closes the
     row is only reserved when something really is left over. */
  function fit(host, available, total) {
    const row = (count) => (count ? AVATAR + (count - 1) * STEP + (total > count ? COUNTER : 0) : 0);
    const width = host.clientWidth;
    if (!width) return Math.min(available, FACES);   // not laid out yet
    let count = Math.min(available, FACES);
    while (count > 1 && row(count) > width) count--;
    return count;
  }

  /** As many faces as the card can carry, then a counter for everyone else. */
  function draw(host, people, total) {
    const shown = people.slice(0, fit(host, people.length, total));
    const rest = Math.max(0, total - shown.length);
    host.innerHTML = shown.map((person) => `<img src="${person.avatar_url}&s=64" alt="${person.login}" width="${AVATAR}" height="${AVATAR}" loading="lazy"/>`).join('')
      + (rest ? `<span class="more">+${rest.toLocaleString('en')}</span>` : '');
  }

  function faces(host, people, total) {
    if (!host) return;
    const value = total || people.length;
    const render = () => draw(host, people, value);
    rows.set(host, render);
    render();
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
     What the community has raised, in one request: the search endpoint reports
     the total it matched AND the newest few, which is what the card needs for
     both its number and its faces. The issues endpoint cannot answer this any
     more — it paginates by cursor now, so it publishes no total and no last page
     to read — and the owner's own entries are filtered out by the query itself,
     so the count and the faces can never disagree about who counts. */

  function issues() {
    const count = document.getElementById('issue-count');
    const host = document.getElementById('issue-avatars');
    const show = (total, authors) => {
      if (!Number.isFinite(total) || total <= 0) return false;
      number(count, total);
      faces(host, authors, total);
      return true;
    };

    // The card is the community's, so the owner's own issues and pull requests
    // are excluded at the source: the qualifier removes them from the total and
    // from the faces in the same request, and no arithmetic here can drift.
    const query = encodeURIComponent(`repo:Drakonis96/nodus -author:${OWNER_LOGIN}`);
    // A whole page of entries, not just the faces the card shows: the newest of
    // them can all belong to one person, and a row of one repeated face says
    // nothing about who is behind the rest.
    return fetch(`https://api.github.com/search/issues?q=${query}&per_page=${PER_PAGE}&sort=created&order=desc`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`search ${response.status}`))))
      .then((result) => {
        const total = Number(result && result.total_count);
        const authors = [];
        for (const entry of (result && result.items) || []) {
          const author = entry && entry.user;
          if (!isPerson(author)) continue;
          if (authors.some((person) => person.login === author.login)) continue;
          authors.push({ login: author.login, avatar_url: author.avatar_url });
        }
        if (Number.isFinite(total)) writeCache(ISSUES_CACHE, { total, authors });
        return show(total, authors);
      })
      .catch(() => {
        // The search endpoint throttles anonymous callers hard, so a card the
        // visitor already has is redrawn whole — number and faces together, or
        // the row would come back empty while the total looked fine. An unknown
        // total is left unknown rather than shown as a number never reached.
        const cached = readCache(ISSUES_CACHE);
        if (!cached) return false;
        return show(cached.total, cached.authors || []);
      })
      .then((shown) => {
        if (!shown) unknown(count, host);
        return shown;
      });
  }

  contributors();
  issues();
})();
