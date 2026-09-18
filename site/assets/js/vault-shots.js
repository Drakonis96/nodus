/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The vault windows on the home page. Each one shows the screenshots the README
ships; a vault with more than one view carries them all, and this steps through
them: the two arrow controls, the left and right arrow keys while the window has
focus, and a horizontal swipe on a touch screen.

Without this file the first screenshot is still there — the markup is the
carousel's resting state, and the arrows stay hidden rather than sitting inert.
*/
(function () {
  'use strict';

  function carousel(frame) {
    const slides = [...frame.querySelectorAll('.shot')];
    const previous = frame.querySelector('[data-shots-prev]');
    const next = frame.querySelector('[data-shots-next]');
    // One view is not a carousel: no arrows, nothing to step through.
    if (slides.length < 2 || !previous || !next) return;

    let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
    let shown = index;

    function show(target) {
      index = (target + slides.length) % slides.length;
      if (index === shown) return;
      shown = index;
      slides.forEach((slide, position) => {
        const active = position === index;
        slide.classList.toggle('is-active', active);
        // Only the visible view is part of the page for a screen reader, and
        // only it can be pointed at.
        if (active) slide.removeAttribute('aria-hidden');
        else slide.setAttribute('aria-hidden', 'true');
      });
    }

    previous.hidden = false;
    next.hidden = false;
    previous.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));

    // The arrows are buttons, so they are reachable by keyboard on their own.
    // This adds the keys someone would try while looking at the window.
    frame.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    });

    // A swipe, for the phones where reaching for a 32px circle is the slow way.
    // Mouse drags are left alone: they select the caption text.
    let startX = 0;
    let startY = 0;
    let tracking = false;
    frame.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
    });
    const stopTracking = () => { tracking = false; };
    frame.addEventListener('pointerup', (event) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      // Mostly sideways, and far enough to be meant: anything else is a scroll.
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      show(index + (dx < 0 ? 1 : -1));
    });
    frame.addEventListener('pointercancel', stopTracking);
    frame.addEventListener('pointerleave', stopTracking);
  }

  function boot() {
    document.querySelectorAll('[data-shots]').forEach(carousel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
