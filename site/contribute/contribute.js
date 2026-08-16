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
    let pile = null;    // settled height per column
    let tint = null;    // the colour that has settled in each column, r,g,b interleaved
    let scratch = null; // colour buffer for the smoothing pass
    let columnCount = 0;
    let pileGain = 2;   // height each landed grain adds
    let frame = 0;

    // Two kinds of grain, and the dune keeps whatever fell on it: the mound is
    // tinted column by column by what actually landed there, rather than
    // repainting everything in one flat violet.
    const GOLD = [252, 211, 77];
    const PALE = [214, 208, 252];
    const BASE = [124, 92, 214]; // the mound before anything has landed on it

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

      // fine columns: the surface has to read as a curve, never as a bar chart
      columnCount = Math.max(40, Math.min(240, Math.round(width / 5)));
      pile = new Float32Array(columnCount);
      tint = new Float32Array(columnCount * 3);
      scratch = new Float32Array(columnCount * 3);
      for (let i = 0; i < columnCount; i++) {
        tint[i * 3] = BASE[0]; tint[i * 3 + 1] = BASE[1]; tint[i * 3 + 2] = BASE[2];
      }
      grains = [];
      // rain across the whole box, so the pile builds edge to edge of its frame
      const spread = columnCount * 0.9;
      pileGain = Math.max(0.6, (height * 0.36 * spread) / total);
    }

    function spawn() {
      // grains fall anywhere across the frame, not in one central stream
      const gold = Math.random() < 0.3;
      grains.push({
        x: 8 + Math.random() * (width - 16),
        y: -8,
        v: 70 + Math.random() * 60,
        r: 1.1 + Math.random() * 1.5,
        colour: gold ? GOLD : PALE,
        // a slow sideways drift, so the fall reads as sand in air, not as rain
        sway: 6 + Math.random() * 14,
        phase: Math.random() * Math.PI * 2,
        seed: Math.random(),
      });
    }

    // where a grain lands it also leaves its colour, strongest right at the
    // point of impact and fading as more grains cover it over
    function stain(index, colour) {
      const at = index * 3;
      tint[at] += (colour[0] - tint[at]) * 0.62;
      tint[at + 1] += (colour[1] - tint[at + 1]) * 0.62;
      tint[at + 2] += (colour[2] - tint[at + 2]) * 0.62;
    }

    // the colours bleed a little into their neighbours every frame, which is
    // what turns single impacts into soft bands instead of hard stripes
    function blendTint() {
      scratch.set(tint);
      for (let i = 0; i < columnCount; i++) {
        const left = Math.max(0, i - 1) * 3;
        const right = Math.min(columnCount - 1, i + 1) * 3;
        const at = i * 3;
        for (let c = 0; c < 3; c++) {
          // gentle: too much bleed and every colour averages into one grey
          tint[at + c] = scratch[at + c] * 0.84 + (scratch[left + c] + scratch[right + c]) * 0.08;
        }
      }
    }

    const rgba = (index, alpha) => `rgba(${Math.round(tint[index * 3])}, ${Math.round(tint[index * 3 + 1])}, ${Math.round(tint[index * 3 + 2])}, ${alpha})`;

    // one horizontal gradient carrying every column's colour: the dune is then
    // painted in a single fill, so no seam can show between columns
    function surfaceGradient(alpha) {
      const gradient = context.createLinearGradient(0, 0, width, 0);
      const stops = Math.min(columnCount, 48);
      for (let s = 0; s <= stops; s++) {
        const at = s / stops;
        gradient.addColorStop(at, rgba(Math.min(columnCount - 1, Math.round(at * (columnCount - 1))), alpha));
      }
      return gradient;
    }

    function duneShape() {
      context.beginPath();
      context.moveTo(0, height);
      context.lineTo(0, height - pile[0]);
      // a smooth curve through the column tops, not a polyline
      for (let i = 0; i < columnCount - 1; i++) {
        const x = (i / (columnCount - 1)) * width;
        const nextX = ((i + 1) / (columnCount - 1)) * width;
        context.quadraticCurveTo(x, height - pile[i], (x + nextX) / 2, height - (pile[i] + pile[i + 1]) / 2);
      }
      context.lineTo(width, height - pile[columnCount - 1]);
      context.lineTo(width, height);
      context.closePath();
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
      blendTint();

      // the dune: one body, painted with the colours that landed on it
      duneShape();
      context.save();
      context.clip();
      context.fillStyle = surfaceGradient(0.62);
      context.fillRect(0, 0, width, height);
      // depth, so the mound has a lit crest and a shadowed base. It starts low:
      // darken too early and the colours the grains left are lost again.
      const depth = context.createLinearGradient(0, height - 70, 0, height);
      depth.addColorStop(0, 'rgba(6, 5, 11, 0)');
      depth.addColorStop(1, 'rgba(6, 5, 11, 0.6)');
      context.fillStyle = depth;
      context.fillRect(0, 0, width, height);
      context.restore();

      // the lit crest: this is where the colour of the newest grains shows
      context.save();
      context.beginPath();
      context.moveTo(0, height - pile[0]);
      for (let i = 0; i < columnCount - 1; i++) {
        const x = (i / (columnCount - 1)) * width;
        const nextX = ((i + 1) / (columnCount - 1)) * width;
        context.quadraticCurveTo(x, height - pile[i], (x + nextX) / 2, height - (pile[i] + pile[i + 1]) / 2);
      }
      context.lineTo(width, height - pile[columnCount - 1]);
      context.strokeStyle = surfaceGradient(0.95);
      context.lineWidth = 1.6;
      context.lineJoin = 'round';
      context.shadowBlur = 14;
      context.shadowColor = 'rgba(226, 222, 254, 0.3)';
      context.stroke();
      context.restore();

      // falling grains
      const column = (x) => Math.min(columnCount - 1, Math.max(0, Math.round((x / width) * (columnCount - 1))));
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let i = grains.length - 1; i >= 0; i--) {
        const grain = grains[i];
        grain.v += 150 * dt;
        grain.y += grain.v * dt;
        // the drift keeps the fall soft; it is what makes it read as sand
        const drift = Math.sin(now / 900 + grain.phase) * grain.sway * dt;
        grain.x = Math.min(width - 4, Math.max(4, grain.x + drift));

        const index = column(grain.x);
        if (grain.y >= height - pile[index]) {
          pile[index] += pileGain;
          stain(index, grain.colour);
          grains.splice(i, 1);
          settled++;
          continue;
        }

        const [r, g, b] = grain.colour;
        const glow = context.createRadialGradient(grain.x, grain.y, 0, grain.x, grain.y, grain.r * 4);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.95)`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(grain.x, grain.y, grain.r * 4, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      // the pile relaxes every frame, so the surface stays level like real sand
      for (let i = 0; i < columnCount - 1; i++) {
        const slope = pile[i] - pile[i + 1];
        if (slope > 2) { const move = slope * 0.22; pile[i] -= move; pile[i + 1] += move; }
        else if (slope < -2) { const move = -slope * 0.22; pile[i] += move; pile[i + 1] -= move; }
      }

      // the loop stops once the last grain lands: an idle canvas must not keep
      // a phone awake redrawing a picture that no longer changes
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
