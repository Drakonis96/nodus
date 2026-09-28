/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The vault windows on the home page. Each one shows the screenshots the README
ships; a vault with more than one view carries them all, and this steps through
them: the two arrow controls, the left and right arrow keys while the window has
focus, and a horizontal swipe on a touch screen.

One of those windows carries several modes instead of one vault: its screens are
grouped into sections, its tabs move between them, and the bar and the copy beside
it follow whichever section the current screenshot belongs to. Nothing here ever
advances by itself — every change comes from an arrow, a tab, a key or a swipe.

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

    // A frame with jumpers is one carousel over several sections. Everything the
    // section carries — its button, its title in the window bar, the copy beside
    // it and the phase on its corner — is read from the markup, never invented.
    const jumpers = [...frame.querySelectorAll('[data-shots-jump]')];
    const sections = [...frame.querySelectorAll('[data-shots-section]')];
    const grouped = jumpers.length > 1 && sections.length > 1
      && slides.every((slide) => Boolean(slide.dataset.section));
    const bar = frame.querySelector('[data-shots-bar]');

    let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
    let shown = index;

    function followSection() {
      if (!grouped) return;
      const key = slides[index].dataset.section;
      jumpers.forEach((button) => {
        if (button.dataset.shotsJump === key) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
      let current = null;
      sections.forEach((section) => {
        const active = section.dataset.shotsSection === key;
        section.classList.toggle('is-active', active);
        if (active) { current = section; section.removeAttribute('hidden'); }
        else section.setAttribute('hidden', '');
      });
      if (bar && current?.dataset.bar) bar.textContent = current.dataset.bar;
      // Only a preliminary mode wears the corner ribbon; the others take it off.
      if (current?.dataset.phase) frame.dataset.activePhase = current.dataset.phase;
      else delete frame.dataset.activePhase;
    }

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
      followSection();
    }

    previous.hidden = false;
    next.hidden = false;
    previous.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));

    jumpers.forEach((button) => {
      button.addEventListener('click', () => {
        const first = slides.findIndex((slide) => slide.dataset.section === button.dataset.shotsJump);
        if (first >= 0) show(first);
      });
    });

    // The markup is already the resting state, but the sections behind it are not:
    // the first screenshot decides which tab, copy and corner are live.
    followSection();

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
