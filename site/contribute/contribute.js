/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The contributor wall, read live from the GitHub API, and the grain field beside
the headline — one drifting grain per landed contribution.
*/
(function () {
  'use strict';

  const REPO = 'https://api.github.com/repos/Drakonis96/nodus';
  // GitHub counts a few automation accounts as contributors; they are not people
  const BOTS = /(\[bot\]$|^dependabot|^github-actions|^renovate|^snyk|^imgbot|^allcontributors)/i;
  // AI assistants show up among GitHub contributors; the wall lists people
  const HIDDEN = /^claude$/i;

  /* ------------------------------------------------------------ the wall */

  const CACHE_KEY = 'nodus-contributors';
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  function renderPeople(list) {
    const host = document.getElementById('people');
    const humans = (Array.isArray(list) ? list : [])
      .filter((person) => person && person.login && !BOTS.test(person.login) && !HIDDEN.test(person.login))
      .sort((a, b) => (b.contributions || 0) - (a.contributions || 0));
    if (!humans.length) return 0;
    host.innerHTML = humans.map((person) => `<a class="person" href="${person.html_url}" target="_blank" rel="noopener">
      <img src="${person.avatar_url}&s=64" alt="" width="26" height="26" loading="lazy"/>
      <span>${person.login}</span><em>${person.contributions}</em>
    </a>`).join('');
    return humans.reduce((total, person) => total + (person.contributions || 0), 0);
  }

  function cachedPeople() {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cache && Array.isArray(cache.list) && Date.now() - cache.ts < CACHE_TTL) return cache.list;
    } catch { /* no cache, or unreadable */ }
    return null;
  }

  function people() {
    const host = document.getElementById('people');
    if (!host) return Promise.resolve(0);

    return fetch(`${REPO}/contributors?per_page=100`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`contributors ${response.status}`))))
      .then((list) => {
        // keep a copy locally: GitHub rate-limits anonymous callers hard, and a
        // failed refresh should never blank the wall for a returning visitor
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list })); } catch { /* storage full or blocked */ }
        return renderPeople(list);
      })
      .catch(() => {
        const cache = cachedPeople();
        if (cache) return renderPeople(cache);
        // last resort: the snapshot published with the site, so the wall never
        // goes empty for a first-time visitor while GitHub throttles the API
        return fetch('../data/contributors.json')
          .then((response) => (response.ok ? response.json() : []))
          .then((list) => renderPeople(list));
      })
      .then((total) => {
        if (total) return total;
        host.innerHTML = `<a class="arrow-link" href="https://github.com/Drakonis96/nodus/graphs/contributors" target="_blank" rel="noopener">
          See the contributors on GitHub
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`;
        return 0;
      });
  }

  /* ------------------------------------------------------------ the grains */

  function sand(grainCount) {
    const canvas = document.getElementById('sand');
    if (!canvas) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.display = 'none';
      return;
    }

    const context = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let grains = [];
    let pile = null;   // settled height per column
    let pileGain = 2;  // height each landed grain adds
    let frame = 0;

    const COLUMNS = 90;
    // one grain per contribution, capped so the pile still reads as a pile
    const total = Math.max(60, Math.min(520, grainCount || 180));

    function fit() {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      pile = new Float32Array(COLUMNS);
      grains = [];
      // rain across the whole box, so the pile builds edge to edge of its frame
      const spread = COLUMNS * 0.9;
      pileGain = Math.max(2, (height * 0.42 * spread) / total);
    }

    function spawn() {
      // grains fall anywhere across the frame, not in one central stream
      grains.push({
        x: 8 + Math.random() * (width - 16),
        y: -8,
        v: 90 + Math.random() * 70,
        r: 1.1 + Math.random() * 1.5,
        hue: Math.random(),
      });
    }

    let settled = 0;
    let previous = 0;
    let spawnClock = 0;

    function loop(now) {
      frame = requestAnimationFrame(loop);
      const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0.016;
      previous = now;

      if (settled < total) {
        spawnClock += dt;
        // pour faster at first, then trickle
        const interval = 0.02 + (settled / total) * 0.10;
        while (spawnClock > interval && grains.length < 140) {
          spawnClock -= interval;
          spawn();
        }
      }

      context.clearRect(0, 0, width, height);

      // the settled pile
      context.beginPath();
      context.moveTo(0, height);
      for (let i = 0; i < COLUMNS; i++) {
        context.lineTo((i / (COLUMNS - 1)) * width, height - pile[i]);
      }
      context.lineTo(width, height);
      context.closePath();
      const gradient = context.createLinearGradient(0, height - 130, 0, height);
      gradient.addColorStop(0, 'rgba(167, 139, 250, 0.55)');
      gradient.addColorStop(1, 'rgba(109, 40, 217, 0.16)');
      context.fillStyle = gradient;
      context.fill();

      // falling grains
      for (let i = grains.length - 1; i >= 0; i--) {
        const grain = grains[i];
        grain.v += 210 * dt;
        grain.y += grain.v * dt;
        const column = Math.min(COLUMNS - 1, Math.max(0, Math.round((grain.x / width) * (COLUMNS - 1))));
        const floor = height - pile[column];

        if (grain.y >= floor) {
          pile[column] += pileGain;
          grains.splice(i, 1);
          settled++;
          continue;
        }

        context.beginPath();
        context.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
        context.fillStyle = grain.hue < 0.3 ? 'rgba(252, 211, 77, 0.95)' : 'rgba(226, 222, 254, 0.9)';
        context.fill();
      }

      // the pile relaxes every frame, so the surface stays level like real sand
      for (let i = 0; i < COLUMNS - 1; i++) {
        const slope = pile[i] - pile[i + 1];
        if (slope > 3) { const move = slope * 0.24; pile[i] -= move; pile[i + 1] += move; }
        else if (slope < -3) { const move = -slope * 0.24; pile[i] += move; pile[i + 1] -= move; }
      }

      if (settled >= total && grains.length === 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fit();
        settled = 0;
        previous = 0;
        if (!frame) frame = requestAnimationFrame(loop);
      }, 200);
    }, { passive: true });

    fit();
    frame = requestAnimationFrame(loop);
  }

  people().then((contributions) => sand(contributions));
})();
