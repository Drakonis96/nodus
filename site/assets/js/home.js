/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Home page behaviour: the opening sequence, the PDF Presenter stage you can
actually draw on, and the ring of Toolkit cards below it. The video gallery lives
in the wiki (site/wiki/wiki.js).
*/
(function () {
  'use strict';

  /* ------------------------------------------------------------ the opening */
  /* The page arrives empty. The field gathers into the Nodus N, then flows
     straight back into the organism as the mark lands and the motto rises.

     The CSS owns the choreography (see the opening block in home.css); this only
     moves the page between the three states, drives the organism's handoff, and
     makes sure the sequence can always be skipped or recovered from. */

  const ASSEMBLY_TIMEOUT = 3600;  // recovery path if the renderer never settles
  const TAIL = 2750;              // the CSS timeline that runs after the release

  function opening() {
    const root = document.documentElement;
    if (!root.classList.contains('intro-armed')) return; // reduced motion, or JS-off markup

    let finished = false;
    let released = false;
    let timers = [];
    const canvas = document.getElementById('organism');

    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      timers = [];
      root.classList.remove('intro-armed', 'intro-run');
      root.classList.add('intro-done');
      if (canvas) canvas.removeEventListener('organism-assembled', onAssembled);
      const engine = window.NodusOrganism;
      if (engine) engine.assemble(false);
      skip.remove();
      removeSkipListeners();
    };

    const release = () => {
      if (finished || released) return;
      // The organism can stand down while we wait (WebGL loss or frame-budget
      // governor). In that case it already revealed the page; never re-arm it.
      if (!root.classList.contains('intro-armed')) { finish(); return; }
      released = true;
      root.classList.remove('intro-armed');
      root.classList.add('intro-run');
      const engine = window.NodusOrganism;
      if (engine) {
        // Formation itself is the reveal: return immediately and smoothly to
        // the field's normal anchors instead of pausing or exploding outward.
        engine.assemble(false);
      }
      timers.push(setTimeout(finish, TAIL));
    };

    const onAssembled = () => {
      if (finished) return;
      release();
    };

    // anyone who has seen it can leave early
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = 'Skip intro';
    skip.addEventListener('click', finish);
    document.body.append(skip);

    // any key at all ends it, including the Tab of someone reaching for the page
    const onKey = () => finish();
    const onWheel = () => finish();
    const removeSkipListeners = () => {
      removeEventListener('keydown', onKey);
      removeEventListener('wheel', onWheel);
      removeEventListener('touchmove', onWheel);
    };
    addEventListener('keydown', onKey);
    addEventListener('wheel', onWheel, { passive: true });
    addEventListener('touchmove', onWheel, { passive: true });

    // Someone arriving on a deep link, or returning mid-page, must not be dragged
    // back to a title sequence.
    if (scrollY > 40 || location.hash) { finish(); return; }

    if (!canvas || !window.NodusOrganism) {
      finish();
      return;
    }
    if (canvas.dataset.organismAssembled === 'true') onAssembled();
    else canvas.addEventListener('organism-assembled', onAssembled, { once: true });

    // The visual signal normally wins. This timeout exists only so a context
    // that keeps drawing but never converges cannot hold the page indefinitely.
    timers.push(setTimeout(release, ASSEMBLY_TIMEOUT));
    // last-resort guard: the page can never stay stuck in its opening state
    timers.push(setTimeout(finish, ASSEMBLY_TIMEOUT + TAIL + 700));
  }

  /* ------------------------------------------------------------ presenter stage */

  function stage() {
    const host = document.getElementById('stage');
    if (!host) return;

    const slide = document.getElementById('stage-slide');
    const canvas = document.getElementById('stage-canvas');
    const context = canvas.getContext('2d');
    const buttons = [...host.querySelectorAll('.stage-tools button')];
    let tool = 'none';
    let drawing = false;
    let strokes = [];

    function fit() {
      const box = slide.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      repaint(box.width, box.height);
    }

    function repaint(width, height) {
      context.clearRect(0, 0, width || canvas.width, height || canvas.height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 2.6;
      context.strokeStyle = '#f472b6';
      context.shadowColor = 'rgba(244, 114, 182, 0.7)';
      context.shadowBlur = 8;
      for (const stroke of strokes) {
        if (stroke.length < 2) continue;
        context.beginPath();
        context.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i++) context.lineTo(stroke[i].x, stroke[i].y);
        context.stroke();
      }
    }

    function pick(next) {
      tool = next;
      host.dataset.tool = next;
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === next)));
      if (next !== 'draw') { drawing = false; }
      if (next === 'none') { strokes = []; repaint(); }
    }

    buttons.forEach((button) => button.addEventListener('click', () => pick(button.dataset.tool)));

    slide.addEventListener('pointermove', (event) => {
      const box = slide.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      host.style.setProperty('--sx', `${x}px`);
      host.style.setProperty('--sy', `${y}px`);
      if (tool === 'draw' && drawing) {
        strokes[strokes.length - 1].push({ x, y });
        repaint(box.width, box.height);
      }
    }, { passive: true });

    slide.addEventListener('pointerdown', (event) => {
      if (tool !== 'draw') return;
      const box = slide.getBoundingClientRect();
      drawing = true;
      strokes.push([{ x: event.clientX - box.left, y: event.clientY - box.top }]);
      if (strokes.length > 24) strokes.shift();
    });
    addEventListener('pointerup', () => { drawing = false; });

    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fit, 160);
    }, { passive: true });
    fit();
  }

  /* ------------------------------------------------------------ the tools ring */
  /* The five tools are a ring: one card sits in the middle, the ones either side
     wait behind it, and the row wraps, so stepping past the last card arrives at
     the first. One number drives all of it — `position`, the card the middle is on,
     whole or halfway between two while a drag is in flight — and every card turns
     that into where it stands, how big it is and how lit it is. Nothing turns on its
     own: a drag, a click on a waiting card, the arrow keys, or a sideways wheel. */
  function tools() {
    const ring = document.querySelector('.tool-cards');
    if (!ring) return;

    const cards = [...ring.querySelectorAll('.tool-card')];
    if (cards.length < 2) return;

    /* How far back a card stands, by how far it is from the middle. The air between
       two cards is a constant the ring solves for, so a card that has shrunk still
       keeps its distance: the row can never look like the cards drifted together. */
    const GAP = 22;
    const LOOK = [
      { scale: 1, alpha: 1, lit: 1, z: 30 },
      { scale: 0.86, alpha: 0.62, lit: 0, z: 20 },
      { scale: 0.74, alpha: 0.34, lit: 0, z: 10 },
    ];
    const FADED = { scale: 0.72, alpha: 0, lit: 0, z: 1 };
    const REACH = LOOK.length - 1;

    let position = 0;
    let cardWidth = 0;
    const offsets = new Array(LOOK.length).fill(0);

    const wrap = (value) => {
      const n = cards.length;
      let distance = value;
      if (distance > n / 2) distance -= n;
      if (distance < -n / 2) distance += n;
      return distance;
    };
    const lerp = (from, to, t) => from + (to - from) * t;

    /** Where a card stands and what it looks like, `distance` cards from the middle. */
    function lookAt(distance) {
      if (distance > REACH) return { ...FADED, x: offsets[REACH] + (distance - REACH) * GAP };
      const low = Math.min(Math.floor(distance), REACH - 1);
      const high = low + 1;
      const t = distance - low;
      return {
        x: lerp(offsets[low], offsets[high], t),
        scale: lerp(LOOK[low].scale, LOOK[high].scale, t),
        alpha: lerp(LOOK[low].alpha, LOOK[high].alpha, t),
        lit: lerp(LOOK[low].lit, LOOK[high].lit, t),
        z: LOOK[Math.round(distance)]?.z ?? FADED.z,
      };
    }

    /** Everything the ring shows comes from `position`: nothing else is remembered. */
    function render() {
      const middle = ((position % cards.length) + cards.length) % cards.length;
      cards.forEach((card, index) => {
        const distance = wrap(index - middle);
        const near = Math.abs(distance);
        const look = lookAt(near);
        card.style.setProperty('--x', `${(Math.sign(distance) * look.x).toFixed(1)}px`);
        card.style.setProperty('--scale', look.scale.toFixed(3));
        card.style.setProperty('--alpha', look.alpha.toFixed(3));
        card.style.setProperty('--lit', look.lit.toFixed(3));
        card.style.setProperty('--z', String(Math.round(look.z)));
        const reachable = near <= REACH + 0.5;
        card.style.setProperty('--pe', reachable ? 'auto' : 'none');
        card.setAttribute('aria-hidden', reachable ? 'false' : 'true');
        card.tabIndex = near < 0.5 ? 0 : -1;
      });
    }

    /** One card's worth of travel, which is what a drag is measured against. */
    function stride() {
      return Math.max(1, offsets[1] || cardWidth || 320);
    }

    function measure() {
      cardWidth = cards[0].offsetWidth || 320;
      offsets[0] = 0;
      for (let level = 1; level < offsets.length; level++) {
        // Half of each card, plus the air that has to survive every scale.
        offsets[level] = offsets[level - 1]
          + (cardWidth * LOOK[level - 1].scale) / 2 + GAP + (cardWidth * LOOK[level].scale) / 2;
      }
      // Every card is as tall as the tallest, so the row reads as one line.
      ring.classList.add('is-measuring');
      const tallest = Math.max(...cards.map((card) => card.offsetHeight));
      ring.classList.remove('is-measuring');
      ring.style.setProperty('--stage-h', `${tallest}px`);
      render();
    }

    // Drag: the ring follows the pointer, the cards travel between each other, and
    // letting go lands on the nearest one.
    let dragging = false;
    let moved = 0;
    let startX = 0;
    let startPosition = 0;

    ring.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      moved = 0;
      startX = event.clientX;
      startPosition = position;
    });

    ring.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved <= 6) return;
      if (!ring.classList.contains('is-dragging')) {
        ring.classList.add('is-dragging');
        // Capture only once this is a drag. Capturing on pointerdown retargets the
        // click that ends a plain press to the ring itself, and the card under the
        // pointer never hears it — which is a card you cannot click.
        try { ring.setPointerCapture(event.pointerId); } catch { /* not captureable here */ }
      }
      position = startPosition - dx / stride();
      render();
    });

    function settle() {
      if (!dragging) return;
      dragging = false;
      ring.classList.remove('is-dragging');
      if (moved > 6) {
        position = Math.round(position);
        render();
      }
    }
    ring.addEventListener('pointerup', settle);
    ring.addEventListener('pointercancel', settle);

    function turn(by) {
      forgetWheel();
      wheelBlocked = Date.now() + 400;
      position = Math.round(position) + by;
      render();
    }

    // A click that ended a drag is not a click, and a card that is not in the middle
    // takes the click as "bring me in" instead of following its link.
    ring.addEventListener('click', (event) => {
      if (moved > 6) {
        event.preventDefault();
        event.stopPropagation();
        moved = 0;
        return;
      }
      const card = event.target.closest('.tool-card');
      if (!card) return;
      const away = wrap(cards.indexOf(card) - ((position % cards.length) + cards.length) % cards.length);
      if (Math.abs(away) < 0.5) return;
      event.preventDefault();
      event.stopPropagation();
      turn(away);
    }, true);

    ring.tabIndex = 0;
    ring.setAttribute('role', 'group');
    ring.setAttribute('aria-roledescription', 'carousel');
    if (!ring.hasAttribute('aria-label')) ring.setAttribute('aria-label', 'Nodus tools');
    ring.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); turn(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); turn(1); }
    });

    // One gesture, one card. A trackpad keeps sending events long after the fingers
    // are off, so the sideways total has to pass a threshold before the ring turns,
    // and the gesture has to go quiet before it may turn again — otherwise a single
    // swipe skips three cards, and a click made during that tail gets undone.
    const WHEEL_STEP = 60;
    const WHEEL_QUIET = 240;
    let wheelTotal = 0;
    let wheelQuiet = 0;
    let wheelBlocked = 0;

    function forgetWheel() {
      clearTimeout(wheelQuiet);
      wheelTotal = 0;
    }

    ring.addEventListener('wheel', (event) => {
      // A vertical wheel over the ring scrolls the page, as it should.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (Date.now() < wheelBlocked) { forgetWheel(); return; }
      wheelTotal += event.deltaX;
      clearTimeout(wheelQuiet);
      wheelQuiet = setTimeout(() => { wheelTotal = 0; }, WHEEL_QUIET);
      if (Math.abs(wheelTotal) < WHEEL_STEP) return;
      const by = wheelTotal > 0 ? 1 : -1;
      // Turned once: the rest of this gesture is its tail, not a second turn.
      forgetWheel();
      wheelBlocked = Date.now() + WHEEL_QUIET;
      turn(by);
    }, { passive: false });

    addEventListener('resize', measure, { passive: true });
    measure();
    // The cards are as tall as their text, and the text is a webfont.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
  }

  function boot() {
    opening();
    stage();
    tools();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
