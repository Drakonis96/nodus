/* Nodus for Zotero — self-update.
 *
 * Drives Zotero's own AddonManager so the plugin keeps itself current with each
 * Nodus release. The update source is the manifest's
 * applications.zotero.update_url (updates.json on the latest GitHub Release),
 * which Zotero fetches, integrity-checks (sha256) and stages like any other
 * add-on update. We only decide WHETHER background updates apply to this add-on
 * (applyBackgroundUpdates) and, when enabled, ask Zotero to look right now
 * instead of waiting for its daily poll. window.NodusUpdater.
 *
 * Loaded both in the sidebar (chrome://nodus/content/updater.js) and by
 * bootstrap.js at startup, so it must depend on nothing but ChromeUtils.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  const PLUGIN_ID = "nodus-zotero@nodus.app";

  function log(m) {
    try {
      const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");
      Zotero.debug("[Nodus] updater: " + m);
    } catch (e) {}
  }
  function addonManager() {
    return ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
  }

  // Point Zotero's background updater at this add-on, or turn it off. ENABLE
  // forces auto-install for Nodus regardless of the global add-on preference;
  // DISABLE leaves the add-on installed but frozen at its current version.
  async function apply(enabled) {
    try {
      const AM = addonManager();
      const addon = await AM.getAddonByID(PLUGIN_ID);
      if (!addon) { log("add-on not found; skipped"); return false; }
      addon.applyBackgroundUpdates = enabled ? AM.AUTOUPDATE_ENABLE : AM.AUTOUPDATE_DISABLE;
      log("applyBackgroundUpdates = " + (enabled ? "ENABLE" : "DISABLE"));
      return true;
    } catch (e) { log("apply failed: " + (e && e.message ? e.message : e)); return false; }
  }

  // Ask Zotero to look for a newer version right now and stage it silently if
  // one is published (applied on the next restart, like any add-on update).
  // Safe to call repeatedly; a no-op when already current.
  async function checkNow() {
    try {
      const AM = addonManager();
      const addon = await AM.getAddonByID(PLUGIN_ID);
      if (!addon) return;
      addon.findUpdates(
        {
          onUpdateAvailable(addonArg, install) {
            try { install.install(); log("staging update " + (install.version || "")); }
            catch (e) { log("install failed: " + (e && e.message ? e.message : e)); }
          },
          onNoUpdateAvailable() { log("up to date"); },
        },
        AM.UPDATE_WHEN_PERIODIC_UPDATE,
      );
    } catch (e) { log("checkNow failed: " + (e && e.message ? e.message : e)); }
  }

  // Apply the preference and, when enabled, immediately look for an update.
  async function configure(enabled) {
    const ok = await apply(enabled);
    if (ok && enabled) checkNow();
  }

  window.NodusUpdater = { apply, checkNow, configure };
})();
