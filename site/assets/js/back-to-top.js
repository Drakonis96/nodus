/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The one floating control the reading pages carry: a way back to the top.

Nodi lives in the demos, where the visitor is inside the product. The marketing
and documentation pages get this instead — a single button that does one thing
and says so. It appears only once there is something to scroll back from.

Injects itself: <script src="…/assets/js/back-to-top.js"></script>, nothing else.
*/
(function () {
  'use strict';

  if (document.getElementById('back-to-top')) return;

  const button = document.createElement('button');
  button.id = 'back-to-top';
  button.type = 'button';
  button.className = 'back-to-top';
  button.setAttribute('aria-label', 'Back to top');
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  button.addEventListener('click', () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    // the button is about to fade out, so hand the focus back to the top of the
    // page rather than leaving it on a control the visitor can no longer see
    const home = document.querySelector('.nav .logo');
    if (home) home.focus({ preventScroll: true });
  });

  // One screen of scrolling is the point where "back to top" stops being noise.
  // A sentinel one viewport tall watches for it: the observer costs nothing per
  // frame, where a scroll listener would run on every wheel notch.
  const sentinel = document.createElement('div');
  sentinel.className = 'back-to-top-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');

  const show = (on) => button.classList.toggle('is-visible', on);

  const watch = () => {
    if (!('IntersectionObserver' in window)) {
      const sync = () => show(scrollY > innerHeight * 0.9);
      addEventListener('scroll', sync, { passive: true });
      sync();
      return;
    }
    new IntersectionObserver(
      (entries) => { for (const entry of entries) show(!entry.isIntersecting); },
      { threshold: 0 },
    ).observe(sentinel);
  };

  const mount = () => {
    document.body.prepend(sentinel);
    document.body.appendChild(button);
    watch();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
})();
