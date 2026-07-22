/* Nodus for Zotero — bootstrap.
 *
 * Docks a full-height Nodus sidebar into the Zotero window (like Beaver): a
 * splitter + panel appended to #browser (outside the tab deck, so it persists
 * across the library and every reader tab). The panel is an iframe loading
 * chrome://nodus/content/sidebar.html. Toolbar buttons in the library AND the
 * reader toggle it; the PDF text-selection popup gets an "Ask Nodus" action.
 */
/* eslint-disable no-undef */

var chromeHandle;
var Nodus = { rootURI: null, readerToolbarListener: null, selectionListener: null };

const PLUGIN_ID = "nodus-zotero@nodus.app";
const BTN_ID = "nodus-tb-button";
const READER_BTN_ID = "nodus-reader-btn";
const SIDEBAR_ID = "nodus-sidebar";
const SPLITTER_ID = "nodus-splitter";
const LIB_TOOLBAR_ID = "zotero-toolbar-item-tree";
const LIB_INSERT_BEFORE = "zotero-tb-search-spinner";

const MARK_SVG =
  '<svg width="16" height="16" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
  '<defs><linearGradient id="ng" x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#ddd6fe"/><stop offset="0.45" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/>' +
  '</linearGradient></defs>' +
  '<path d="M18 48V16L46 48V16" fill="none" stroke="url(#ng)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="18" cy="16" r="6.5" fill="#ddd6fe"/><circle cx="18" cy="48" r="6.5" fill="#a78bfa"/>' +
  '<circle cx="46" cy="48" r="6.5" fill="#8b5cf6"/><circle cx="46" cy="16" r="6.5" fill="#7c3aed"/></svg>';

function log(m) { try { Zotero.debug("[Nodus] " + m); } catch (e) {} }

// ---------------------------------------------------------------- lifecycle

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI, resourceURI }) {
  await Zotero.initializationPromise;
  if (!rootURI) rootURI = resourceURI.spec;
  Nodus.rootURI = rootURI;

  // Expose chrome://nodus/content/ so the sidebar iframe + its assets load with
  // chrome privileges (can import Zotero, read the bridge file, fetch localhost).
  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [["content", "nodus", rootURI + "content/"]]);

  registerReaderToolbarButton();
  registerSelectionPopup();
  eachMainWindow((w) => { injectSidebar(w); addLibraryButton(w); });
  log("startup complete v" + version);
}

function onMainWindowLoad({ window }) {
  try { injectSidebar(window); addLibraryButton(window); } catch (e) { Zotero.logError(e); }
}
function onMainWindowUnload({ window }) {
  try { removeLibraryButton(window); removeSidebar(window); } catch (e) {}
}

function shutdown() {
  try { eachMainWindow((w) => { removeLibraryButton(w); removeSidebar(w); }); } catch (e) {}
  if (Nodus.readerToolbarListener) {
    try { Zotero.Reader.unregisterEventListener("renderToolbar", Nodus.readerToolbarListener); } catch (e) {}
  }
  if (Nodus.selectionListener) {
    try { Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", Nodus.selectionListener); } catch (e) {}
  }
  if (chromeHandle) { try { chromeHandle.destruct(); } catch (e) {} chromeHandle = null; }
  Nodus.rootURI = null;
}

function eachMainWindow(fn) {
  const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
  for (const w of wins) if (w && w.document) fn(w);
}

// ---------------------------------------------------------------- sidebar

function injectSidebar(window) {
  const doc = window.document;
  if (doc.getElementById(SIDEBAR_ID)) return;
  const browser = doc.getElementById("browser");
  if (!browser) { log("#browser not found"); return; }

  // No `collapse` attribute: the splitter is a plain resizer. Collapsing is done
  // by our own toggle (toolbar/reader buttons + the panel's ✕), so there is no
  // separate XUL "collapsed" state that the toggle could get out of sync with.
  const splitter = doc.createXULElement("splitter");
  splitter.id = SPLITTER_ID;
  splitter.setAttribute("hidden", "true");
  splitter.style.cssText = "border:0;min-width:0;width:1px;background:rgba(124,58,237,0.35);";

  const sidebar = doc.createXULElement("vbox");
  sidebar.id = SIDEBAR_ID;
  sidebar.setAttribute("hidden", "true");
  sidebar.setAttribute("zotero-persist", "width");
  sidebar.style.cssText = "width:400px;min-width:320px;max-width:760px;";

  // A XUL <browser> with no type attribute loads the chrome:// page in-process
  // with chrome privileges (needed for ChromeUtils/Zotero/localhost fetch). A
  // type="content" browser would refuse the chrome:// URL.
  const iframe = doc.createXULElement("browser");
  iframe.setAttribute("id", "nodus-sidebar-frame");
  iframe.setAttribute("flex", "1");
  iframe.setAttribute("disableglobalhistory", "true");
  iframe.setAttribute("src", "chrome://nodus/content/sidebar.html");
  sidebar.appendChild(iframe);

  browser.appendChild(splitter);
  browser.appendChild(sidebar);
  log("sidebar injected");
}

function removeSidebar(window) {
  const doc = window.document;
  const s = doc.getElementById(SIDEBAR_ID);
  const sp = doc.getElementById(SPLITTER_ID);
  if (s) s.remove();
  if (sp) sp.remove();
}

function toggleSidebar(window, forceOpen) {
  const doc = window.document;
  const sidebar = doc.getElementById(SIDEBAR_ID);
  const splitter = doc.getElementById(SPLITTER_ID);
  if (!sidebar) { injectSidebar(window); return toggleSidebar(window, true); }
  // Robust "is it closed?": hidden, XUL-collapsed, or resized to ~0 width.
  let width = 0;
  try { width = sidebar.getBoundingClientRect().width; } catch (e) {}
  const isClosed = sidebar.hidden || sidebar.getAttribute("collapsed") === "true" || width < 5;
  const willShow = forceOpen === true ? true : forceOpen === false ? false : isClosed;
  sidebar.hidden = !willShow;
  if (splitter) splitter.hidden = !willShow;
  if (willShow) {
    sidebar.removeAttribute("collapsed");
    const w = parseInt(sidebar.style.width || "0", 10);
    if (!w || w < 120) sidebar.style.width = "400px";
  }
  return willShow;
}

function sidebarFrameWindow(window) {
  const f = window.document.getElementById("nodus-sidebar-frame");
  return f && f.contentWindow ? f.contentWindow : null;
}

function sendToSidebar(window, message) {
  try {
    const win = sidebarFrameWindow(window);
    if (win) win.postMessage(message, "*");
  } catch (e) { Zotero.logError(e); }
}

// ---------------------------------------------------------- library toolbar

function addLibraryButton(window) {
  const doc = window.document;
  if (doc.getElementById(BTN_ID)) return;
  const toolbar = doc.getElementById(LIB_TOOLBAR_ID);
  if (!toolbar) { log("library toolbar not found"); return; }
  const btn = doc.createXULElement("toolbarbutton");
  btn.id = BTN_ID;
  btn.setAttribute("tabindex", "-1");
  btn.setAttribute("tooltiptext", "Nodus");
  btn.classList.add("zotero-tb-button");
  btn.style.setProperty("list-style-image", 'url("' + Nodus.rootURI + 'icons/nodus.svg")');
  btn.addEventListener("command", () => toggleSidebar(window));
  const ref = doc.getElementById(LIB_INSERT_BEFORE);
  if (ref && ref.parentNode === toolbar) toolbar.insertBefore(btn, ref);
  else toolbar.appendChild(btn);
}

function removeLibraryButton(window) {
  const b = window.document.getElementById(BTN_ID);
  if (b) b.remove();
}

// ----------------------------------------------------------- reader toolbar

function registerReaderToolbarButton() {
  Nodus.readerToolbarListener = (event) => {
    try {
      const doc = event.doc;
      if (!doc || doc.getElementById(READER_BTN_ID)) return;
      const btn = doc.createElement("button");
      btn.id = READER_BTN_ID;
      btn.title = "Nodus";
      btn.setAttribute("tabindex", "-1");
      btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;" +
        "height:100%;min-width:28px;padding:0 6px;margin:0;background:transparent;border:none;border-radius:5px;cursor:pointer;";
      btn.innerHTML = MARK_SVG;
      btn.addEventListener("click", () => toggleSidebar(Zotero.getMainWindow(), true));
      event.append(btn);
    } catch (e) { Zotero.logError(e); }
  };
  Zotero.Reader.registerEventListener("renderToolbar", Nodus.readerToolbarListener, PLUGIN_ID);
}

// -------------------------------------------------- reader selection → chat

function registerSelectionPopup() {
  Nodus.selectionListener = (event) => {
    try {
      const doc = event.doc;
      const params = event.params || {};
      const text = (params.annotation && params.annotation.text) || params.text || "";
      const btn = doc.createElement("button");
      btn.textContent = "Nodus";
      btn.title = "Ask Nodus about the selection";
      btn.style.cssText =
        "display:inline-flex;align-items:center;gap:4px;padding:4px 8px;margin:0 2px;" +
        "border:none;border-radius:6px;cursor:pointer;background:#7c3aed;color:#fff;font-size:12px;";
      btn.addEventListener("click", () => {
        const win = Zotero.getMainWindow();
        toggleSidebar(win, true);
        // Send the full annotation draft (position/pageLabel/sortIndex) so the
        // agent can create a real highlight from this selection, not just the text.
        let draft = null;
        try { draft = params.annotation ? JSON.parse(JSON.stringify(params.annotation)) : null; } catch (e) {}
        sendToSidebar(win, { type: "nodus-selection", text: String(text || ""), draft: draft });
      });
      event.append(btn);
    } catch (e) { Zotero.logError(e); }
  };
  Zotero.Reader.registerEventListener("renderTextSelectionPopup", Nodus.selectionListener, PLUGIN_ID);
}
