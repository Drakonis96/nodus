/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The vault windows on the home page. Each one shows the screenshots the README
ships; a vault with more than one view carries them all, and this steps through
them: the two arrow controls, the left and right arrow keys while the window has
focus, and a horizontal swipe on a touch screen.

The section that shows the other five modes nests two of these: an outer carousel
picks the mode (its tabs and its own pair of arrows) and each mode brings its own
window with its own screens inside. Nothing here ever advances by itself — every
change comes from an arrow, a tab, a key or a swipe.

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

  /** The outer carousel: one slide per mode, with the copy that belongs to it. The
   *  slides carry their own inner windows; this only decides which one is showing. */
  function sectioned(root) {
    const slides = [...root.querySelectorAll('[data-sections-item]')];
    const copies = [...root.querySelectorAll('[data-shots-section]')];
    const tabs = [...root.querySelectorAll('[data-sections-jump]')];
    const previous = root.querySelector('[data-sections-prev]');
    const next = root.querySelector('[data-sections-next]');
    // One mode is not a carousel either: the tabs stay, the arrows do not.
    if (slides.length < 2 || !slides.some((slide) => !slide.hidden)) return;

    let index = Math.max(0, slides.findIndex((slide) => !slide.hidden));

    function show(target) {
      index = (target + slides.length) % slides.length;
      const key = slides[index].dataset.sectionsItem;
      slides.forEach((slide) => {
        if (slide.dataset.sectionsItem === key) slide.removeAttribute('hidden');
        else slide.setAttribute('hidden', '');
      });
      copies.forEach((copy) => {
        if (copy.dataset.shotsSection === key) copy.removeAttribute('hidden');
        else copy.setAttribute('hidden', '');
      });
      tabs.forEach((tab) => {
        if (tab.dataset.sectionsJump === key) tab.setAttribute('aria-current', 'true');
        else tab.removeAttribute('aria-current');
      });
    }

    if (previous) { previous.hidden = false; previous.addEventListener('click', () => show(index - 1)); }
    if (next) { next.hidden = false; next.addEventListener('click', () => show(index + 1)); }
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = slides.findIndex((slide) => slide.dataset.sectionsItem === tab.dataset.sectionsJump);
        if (target >= 0) show(target);
      });
    });
  }

  function boot() {
    document.querySelectorAll('[data-shots]').forEach(carousel);
    document.querySelectorAll('[data-sections]').forEach(sectioned);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
