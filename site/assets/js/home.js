/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Home page behaviour: the opening sequence, the PDF Presenter stage you can
actually draw on, and the Toolkit row that scrolls sideways. The video gallery
lives in the wiki (site/wiki/wiki.js).
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
  /* The five tools are a ring: one card is in the middle, the two either side wait
     behind it, and the row wraps, so stepping past the last card arrives at the
     first. Every card carries `--d`, its signed distance to the middle, and
     home.css turns that into the position, the size and how lit the card is.
     Nothing turns on its own: a drag, a click on a waiting card, or an arrow key
     while the ring has focus is what moves it. */
  function tools() {
    const ring = document.querySelector('.tool-cards');
    if (!ring) return;

    const cards = [...ring.querySelectorAll('.tool-card')];
    if (cards.length < 2) return;

    // How far a card falls back and dims, by how far it is from the middle.
    const LOOK = [
      { scale: 1, alpha: 1, lit: 1, pe: 'auto', z: 30 },
      { scale: 0.86, alpha: 0.62, lit: 0, pe: 'auto', z: 20 },
      { scale: 0.74, alpha: 0.34, lit: 0, pe: 'auto', z: 10 },
    ];
    const BEHIND = { scale: 0.7, alpha: 0, lit: 0, pe: 'none', z: 1 };

    let active = 0;

    function place() {
      cards.forEach((card, index) => {
        // Circular distance: the nearest way round, not the line between them.
        let distance = index - active;
        if (distance > cards.length / 2) distance -= cards.length;
        if (distance < -cards.length / 2) distance += cards.length;
        const look = LOOK[Math.abs(distance)] || BEHIND;
        card.style.setProperty('--d', String(distance));
        card.style.setProperty('--scale', String(look.scale));
        card.style.setProperty('--alpha', String(look.alpha));
        card.style.setProperty('--lit', String(look.lit));
        card.style.setProperty('--pe', look.pe);
        card.style.setProperty('--z', String(look.z));
        // The ring is as tall as its tallest card, whatever is in the middle.
        card.setAttribute('aria-hidden', look.pe === 'none' ? 'true' : 'false');
        card.tabIndex = distance === 0 ? 0 : -1;
      });
      ring.style.setProperty('--stage-h', `${Math.max(...cards.map((card) => card.offsetHeight))}px`);
    }

    function step(by) {
      active = (active + by + cards.length) % cards.length;
      place();
    }

    // Drag: a horizontal pull turns the ring, a tap on a waiting card brings it in.
    let startX = 0;
    let moved = 0;
    let dragging = false;

    ring.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      moved = 0;
      startX = event.clientX;
      try { ring.setPointerCapture(event.pointerId); } catch { /* not captureable here */ }
    });

    ring.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      moved = Math.max(moved, Math.abs(event.clientX - startX));
      if (moved > 6) ring.classList.add('is-dragging');
    });

    const settle = (event) => {
      if (!dragging) return;
      dragging = false;
      ring.classList.remove('is-dragging');
      const dx = (event.clientX ?? startX) - startX;
      // Far enough to be meant as a turn, and sideways rather than a scroll.
      if (Math.abs(dx) < 40) return;
      step(dx < 0 ? 1 : -1);
    };
    ring.addEventListener('pointerup', settle);
    ring.addEventListener('pointercancel', () => { dragging = false; ring.classList.remove('is-dragging'); });

    // A click that ended a drag is not a click, and a card that is not in the
    // middle takes the click as "bring me in" instead of following its link.
    ring.addEventListener('click', (event) => {
      if (moved > 6) {
        event.preventDefault();
        event.stopPropagation();
        moved = 0;
        return;
      }
      const card = event.target.closest('.tool-card');
      if (!card) return;
      const index = cards.indexOf(card);
      if (index === active) return;
      event.preventDefault();
      event.stopPropagation();
      // Straight there, in one move, and deaf to the trackpad's tail for a moment.
      forgetWheel();
      wheelBlocked = Date.now() + 400;
      step(index - active);
    }, true);

    ring.tabIndex = 0;
    ring.setAttribute('role', 'group');
    ring.setAttribute('aria-roledescription', 'carousel');
    if (!ring.hasAttribute('aria-label')) ring.setAttribute('aria-label', 'Nodus tools');
    ring.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
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
      step(by);
    }, { passive: false });

    addEventListener('resize', place, { passive: true });
    place();
  }

  function boot() {
    opening();
    stage();
    tools();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
