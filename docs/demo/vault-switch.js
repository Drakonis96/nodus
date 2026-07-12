/* Tiny controller for the demo header's vault/mode switcher — shared by the
   academic (index.html) and genealogy (genealogy.html) demos. Toggles the
   dropdown and closes it on an outside click or Escape. */
(function () {
  window.toggleVaultMenu = function (e) {
    if (e) e.stopPropagation();
    var wrap = document.getElementById('vault-switch');
    if (!wrap) return;
    var open = wrap.classList.toggle('open');
    var btn = wrap.querySelector('.vault-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('mousedown', function (e) {
    var wrap = document.getElementById('vault-switch');
    if (!wrap || !wrap.classList.contains('open')) return;
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('open');
      var btn = wrap.querySelector('.vault-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var wrap = document.getElementById('vault-switch');
    if (wrap && wrap.classList.contains('open')) wrap.classList.remove('open');
  });
})();
