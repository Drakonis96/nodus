/* Keep the current vault and section visible inside the horizontal mobile rails. */
(function () {
  'use strict';

  var mobile = window.matchMedia('(max-width: 900px)');

  function reveal(root, selector) {
    if (!mobile.matches || !root) return;
    var current = root.querySelector(selector);
    if (!current) return;
    window.requestAnimationFrame(function () {
      current.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    });
  }

  function revealCurrent() {
    reveal(document.querySelector('.vault-tabs'), '[aria-current="page"]');
    reveal(document.getElementById('nav'), '.nav-item.active');
  }

  function watchSectionNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var observer = new MutationObserver(function () {
      reveal(nav, '.nav-item.active');
    });
    observer.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      watchSectionNav();
      revealCurrent();
    }, { once: true });
  } else {
    watchSectionNav();
    revealCurrent();
  }

  window.addEventListener('hashchange', revealCurrent);
  if (typeof mobile.addEventListener === 'function') {
    mobile.addEventListener('change', revealCurrent);
  }
}());
