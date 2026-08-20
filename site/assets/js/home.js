/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Home page behaviour: the opening sequence, and the PDF Presenter stage you can
actually draw on. The video gallery lives in the wiki (site/wiki/wiki.js).
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

  function boot() {
    opening();
    stage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
