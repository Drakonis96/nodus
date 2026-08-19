/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Shared page behaviour: the cursor, scroll reveals, per-section retuning of the
organism, pointer-lit cards, magnetic buttons and the download dialog.

Everything here is an enhancement. With JavaScript off, or motion reduced, the
page is still a complete, readable document.
*/
(function () {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const organism = () => window.NodusOrganism;

  /* ------------------------------------------------------------ reveals */

  function revealer() {
    // split headings reveal themselves, so they never depend on an ancestor
    // happening to carry .reveal
    const targets = document.querySelectorAll('.reveal, [data-split]');
    if (!targets.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach((element) => element.classList.add('seen'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('seen');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    targets.forEach((element) => observer.observe(element));
  }

  /* Split a heading into words so each one can lift into place in turn. */
  function splitWords() {
    if (reduced) return;
    for (const element of document.querySelectorAll('[data-split]')) {
      const words = element.textContent.trim().split(/\s+/);
      element.textContent = '';
      words.forEach((word, index) => {
        const outer = document.createElement('span');
        outer.className = 'word-reveal';
        const inner = document.createElement('span');
        inner.textContent = word;
        inner.style.setProperty('--wd', `${index * 55}ms`);
        outer.append(inner);
        element.append(outer);
        if (index < words.length - 1) element.append(' ');
      });
    }
  }

  /* ------------------------------------------------------------ scene tuning */
  /* Each section can declare the colour and energy the organism should take on
     while it is the section in view: data-accent, data-second, data-energy. */

  function scenes() {
    const sections = [...document.querySelectorAll('[data-accent]')];
    if (!sections.length) return;

    const applyCss = (section) => {
      const accent = section.dataset.accent;
      if (accent) {
        document.documentElement.style.setProperty('--accent', accent);
        document.documentElement.style.setProperty('--accent-soft', `${accent}26`);
      }
    };

    if (!('IntersectionObserver' in window)) {
      applyCss(sections[0]);
      return;
    }

    let current = null;
    const observer = new IntersectionObserver((entries) => {
      // whichever qualifying section covers most of the viewport wins
      let best = null;
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.dataset.ratio = String(entry.intersectionRatio);
        else entry.target.dataset.ratio = '0';
      }
      for (const section of sections) {
        const ratio = Number(section.dataset.ratio || 0);
        if (ratio > 0.12 && (!best || ratio > Number(best.dataset.ratio || 0))) best = section;
      }
      if (!best || best === current) return;
      current = best;
      applyCss(best);
      const engine = organism();
      if (engine) {
        engine.tune(
          best.dataset.accent,
          best.dataset.second || best.dataset.accent,
          Number(best.dataset.energy || 0.3),
        );
      }
    }, { threshold: [0, 0.12, 0.3, 0.55, 0.8] });

    sections.forEach((section) => observer.observe(section));
  }

  /* ------------------------------------------------------------ lit cards */

  function litCards() {
    if (!finePointer) return;
    const cards = document.querySelectorAll('.card.lit, .lit');
    for (const card of cards) {
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      }, { passive: true });
    }
  }

  /* ------------------------------------------------------------ magnetic buttons */

  function magnets() {
    if (!finePointer || reduced) return;
    for (const element of document.querySelectorAll('[data-magnet]')) {
      const strength = Number(element.dataset.magnet) || 0.22;
      element.addEventListener('pointermove', (event) => {
        const box = element.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        element.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
      }, { passive: true });
      element.addEventListener('pointerleave', () => { element.style.transform = ''; }, { passive: true });
    }
  }

  /* ------------------------------------------------------------ cursor */

  function cursor() {
    if (!finePointer || reduced) return;

    const ring = document.createElement('div');
    ring.className = 'cursor';
    ring.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    dot.setAttribute('aria-hidden', 'true');
    document.body.append(ring, dot);

    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let rx = x;
    let ry = y;
    let frame = 0;

    const loop = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      frame = requestAnimationFrame(loop);
    };

    addEventListener('pointermove', (event) => {
      x = event.clientX;
      y = event.clientY;
      if (!document.body.classList.contains('cursor-ready')) {
        document.body.classList.add('cursor-ready');
        rx = x; ry = y;
        frame = requestAnimationFrame(loop);
      }
      const interactive = event.target.closest('a, button, input, summary, [role="tab"], [role="button"], [data-hot]');
      document.body.classList.toggle('cursor-hot', Boolean(interactive));
    }, { passive: true });

    addEventListener('pointerdown', () => document.body.classList.add('cursor-press'), { passive: true });
    addEventListener('pointerup', () => document.body.classList.remove('cursor-press'), { passive: true });
    addEventListener('pointerleave', () => document.body.classList.remove('cursor-ready'), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else frame = requestAnimationFrame(loop);
    });
  }

  /* ------------------------------------------------------------ download dialog */

  function downloads() {
    const overlay = document.getElementById('dl-overlay');
    if (!overlay) return;

    const modal = overlay.querySelector('.dl-modal');
    let lastFocus = null;
    let loaded = false;

    const close = () => {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    };

    const open = () => {
      lastFocus = document.activeElement;
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      (modal.querySelector('.dl-plat') || modal).focus();
      if (!loaded) { loaded = true; fetchRelease(); }
    };

    window.openDl = open;
    window.closeDl = close;

    for (const trigger of document.querySelectorAll('[data-download]')) {
      trigger.addEventListener('click', (event) => { event.preventDefault(); open(); });
    }
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('open')) close();
      if (event.key !== 'Tab' || !overlay.classList.contains('open')) return;
      // keep focus inside the dialog while it is open
      const focusable = modal.querySelectorAll('a[href], button:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    function fetchRelease() {
      const version = document.getElementById('dl-version');
      fetch('https://api.github.com/repos/Drakonis96/nodus/releases/latest', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no release'))))
        .then((release) => {
          if (version) version.textContent = `Latest release · ${release.tag_name} · ${new Date(release.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
          const assets = release.assets || [];
          const find = (suffix) => assets.find((asset) => asset.name.endsWith(suffix));
          const wire = (id, asset, fallbackLabel) => {
            const anchor = document.getElementById(id);
            if (!anchor) return;
            if (asset) {
              anchor.href = asset.browser_download_url;
              const sub = anchor.querySelector('span:not(.arr)');
              if (sub) sub.textContent = `${fallbackLabel} · ${(asset.size / 1048576).toFixed(0)} MB`;
            }
          };
          wire('dl-mac', find('-mac-arm64.dmg'), 'Apple Silicon · .dmg');
          wire('dl-win', find('-win-x64.exe'), 'x64 installer · .exe');
          wire('dl-linux', find('-linux-x86_64.AppImage'), 'x86_64 · .AppImage');
        })
        .catch(() => {
          if (version) version.textContent = 'Open the releases page for every build.';
        });
    }
  }

  /* ------------------------------------------------------------ misc */

  /* Buttons and cards send a ripple through the field when pressed. */
  function feedback() {
    document.addEventListener('pointerdown', (event) => {
      const hot = event.target.closest('.btn, .card, .filter-tab, [data-hot]');
      if (!hot) return;
      const engine = organism();
      if (engine) engine.pulse(event.clientX, event.clientY, 1.5);
    }, { passive: true });
  }

  /* A thin progress rail under the header. */
  function progress() {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return;
    let ticking = false;
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
      ticking = false;
    };
    addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  function boot() {
    splitWords();
    revealer();
    scenes();
    litCards();
    magnets();
    cursor();
    downloads();
    feedback();
    progress();
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
