// Tab lifecycle: the parts that leak if they are wrong.
//
// A leaked tab does not throw. It keeps a renderer process alive, keeps its
// listeners registered, and keeps painting nothing — the symptom is memory and
// CPU, noticed days later. So these assertions are about teardown being
// complete and ordered, not about tabs appearing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(repoRoot, 'electron/browser/tabs.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function body(name) {
  const start = code.search(new RegExp(`(?:export )?(?:async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} must exist`);
  const rest = code.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}

test('closing a tab destroys its WebContents rather than only detaching it', () => {
  // removeChildView alone stops it painting; the process stays alive.
  const close = body('destroyTab');
  assert.match(close, /removeChildView|detach\(/, 'the view must leave the window');
  assert.match(close, /webContents\.close\(\)/, 'the WebContents must be destroyed');
  assert.match(close, /isDestroyed\(\)/, 'destroying twice must be guarded');
  assert.match(close, /webContents\.stop\(\)/, 'in-flight page loads must stop before destruction');
});
test('closing a tab removes every listener it registered, before destroying it', () => {
  const close = body('destroyTab');
  assert.match(close, /disposers/, 'listeners must be undone through the disposer list');
  // Order matters: a handler firing during teardown would patch state for a tab
  // that has already been dropped from the registry.
  const disposeAt = close.indexOf('disposers');
  const destroyAt = close.indexOf('webContents.close()');
  assert.ok(disposeAt < destroyAt, 'listeners must be removed before the contents is destroyed');
});

test('every listener the tab registers goes through the disposer list', () => {
  // A raw contents.on(...) would survive closeTab and keep the tab reachable.
  const wire = code.slice(code.indexOf('function wire('), code.indexOf('export async function createTab'));
  const raw = [...wire.matchAll(/contents\.on\(/g)];
  assert.deepEqual(raw.map((m) => m[0]), [],
    'listeners must be registered through on(tab, contents, ...), not contents.on directly');
});

test('the tab registry is emptied when the last tab closes', () => {
  const close = body('destroyTab');
  assert.match(close, /tabs\.delete\(/, 'the registry entry must go');
});

test('closing the active tab hands activation to another one', () => {
  // Otherwise the window keeps a detached view and shows nothing.
  const close = body('destroyTab');
  assert.match(close, /activeTabId === id/, 'closing the active tab must be detected');
  assert.match(close, /activateTab\(/, 'another tab must take over');
});

test('shutdown closes every tab through the same path', () => {
  // Not a second teardown implementation: a divergent one is how the careful
  // ordering above gets skipped exactly when the app is exiting.
  const all = body('closeAllBrowserTabs');
  assert.match(all, /destroyTab\(/, 'shutdown must reuse the per-tab destructor');
  assert.match(all, /activeTabId = null/, 'shutdown must clear the active tab');
});

test('the tab cap is enforced where tabs are created, not only in the UI', () => {
  const create = code.slice(code.indexOf('export async function createTab'));
  const guard = create.slice(0, create.indexOf('const view'));
  assert.match(guard, /MAX_BROWSER_TABS/, 'creation must check the cap');
  // A disabled button is a courtesy; setWindowOpenHandler can also create tabs,
  // and a page opening popups in a loop must not be able to walk past the cap.
  assert.match(guard, /return null/, 'creation past the cap must refuse');
});

test('only the active tab is attached to the window', () => {
  // This is what makes a background tab cheap: detached means Chromium neither
  // composites nor paints it, while its WebContents stays alive.
  const activate = body('activateTab');
  assert.match(activate, /detach\(previous\)/, 'the previous tab must be detached');
  assert.match(activate, /attach\(tab\)/, 'the new tab must be attached');
});

test('native bounds include the host renderer zoom factor', () => {
  const bounds = body('applyBounds');
  assert.match(bounds, /hostWindow\.webContents\.getZoomFactor\(\)/,
    'CSS pixels must be converted with the actual host renderer zoom');
  assert.match(bounds, /viewport\.x \* cssToDip/);
  assert.match(bounds, /viewport\.y \* cssToDip/);
  assert.match(bounds, /\(viewport\.x \+ viewport\.width\) \* cssToDip/);
  assert.match(bounds, /\(viewport\.y \+ viewport\.height\) \* cssToDip/);
  assert.match(bounds, /width: Math\.max\(0, right - left\)/,
    'rounding the two edges must not leave a seam on the right');
  assert.match(bounds, /height: Math\.max\(0, bottom - top\)/,
    'rounding the two edges must not leave a seam at the bottom');
});

test('trusted Nodus overlays automatically cover native Browser pages', () => {
  const overlayGuard = readFileSync(path.join(repoRoot, 'src/browserOverlay.ts'), 'utf8');
  const app = readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8');
  const vaultSwitcher = readFileSync(path.join(repoRoot, 'src/components/VaultSwitcher.tsx'), 'utf8');
  const bookmarksStyles = readFileSync(path.join(repoRoot, 'src/components/browser/NodusBookmarks.css'), 'utf8');

  assert.match(overlayGuard, /new MutationObserver\(schedule\)/,
    'the guard must discover overlays opened anywhere in the trusted renderer');
  assert.match(overlayGuard, /\[role="dialog"\]/,
    'accessible dialogs must automatically hide native content');
  assert.match(overlayGuard, /\.fixed\.inset-0/,
    'legacy full-window backdrops and tours must be covered too');
  assert.match(overlayGuard, /(requestAnimationFrame|queueMicrotask)\(synchronize\)/,
    'overlapping overlay cleanup must settle after the React commit');
  assert.match(app, /useBrowserNativeOverlayGuard\(view === 'browser'\)/,
    'the app shell must enable the guard whenever Browser is the active section');
  assert.match(vaultSwitcher, /data-browser-native-overlay="true"/,
    'the anchored vault switcher must opt into native Browser occlusion');
  assert.match(bookmarksStyles, /\.nodus-site-header[\s\S]{0,180}z-index:20/,
    'the local start-page header must stay below global Nodus overlays');
});

test('shutdown is wired into every one of main.ts’s exit paths', () => {
  // Window close matters independently on macOS, where closing the last window
  // does not quit. The remaining paths cover normal quit, its final backstop,
  // platform window-all-closed, and updater installs.
  const main = readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  for (const marker of [
    "mainWindow.on('closed'",
    "app.on('window-all-closed'",
    "app.on('before-quit'",
    "app.on('will-quit', () =>",
    "updateAwareApp.on('before-quit-for-update'",
  ]) {
    const at = main.indexOf(marker);
    assert.ok(at >= 0, `${marker} must exist`);
    assert.match(main.slice(at, at + 2_500), /destroyBrowserSubsystem\(\)/,
      `${marker} must destroy Browser contents`);
  }
});

test('restart and application exit share one Browser subsystem cleanup', () => {
  const lifecycle = readFileSync(path.join(repoRoot, 'electron/browser/lifecycle.ts'), 'utf8');
  const restartAt = lifecycle.indexOf('export async function restartBrowserSubsystem');
  const restart = lifecycle.slice(restartAt);
  assert.match(restart, /destroyBrowserSubsystem\(\{ preserveViewport: true \}\)/,
    'restart must use the same subsystem cleanup as quit');
  assert.ok(restart.indexOf('destroyBrowserSubsystem') < restart.indexOf('createTab'),
    'all old resources must be destroyed before the fresh tab is created');
  assert.doesNotMatch(lifecycle, /clearStorageData|clearCache|clearAllBrowserData/,
    'restart must never clear the persistent Browser session');
});

test('renderer crashes become a recoverable controlled tab state', () => {
  const crashAt = code.indexOf("'render-process-gone'");
  const crash = code.slice(crashAt, code.indexOf("'unresponsive'", crashAt));
  assert.match(crash, /finishPendingCollections\(tab\)/,
    'a crash must release page-collection requests');
  assert.match(crash, /dropMediaSession\(tab\.id\)/,
    'a crash must clear Browser-owned media state');
  assert.match(crash, /kind:\s*'crashed'/,
    'the trusted Nodus renderer must receive a controlled crash state');
  assert.doesNotMatch(crash, /destroyTab\(tab\.id/,
    'the WebContents shell stays owned so Reload can create a fresh renderer');
});

test('unexpected WebContents destruction still goes through the shared destructor', () => {
  const destroyedAt = code.indexOf("'destroyed'");
  const destroyed = code.slice(destroyedAt, code.indexOf('export async function createTab', destroyedAt));
  assert.match(destroyed, /destroyTab\(tab\.id/,
    'external destruction must remove registry state, listeners and media');
});

test('restart IPC is trusted-UI only and warns from main-process activity state', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const start = ipc.indexOf("h('browser:restart'");
  const end = ipc.indexOf("h('browser:openTab'", start);
  const restart = ipc.slice(start, end);
  assert.match(restart, /assertUiSender\(event, getWindow\)/,
    'loaded websites must never be able to request restart');
  assert.match(restart, /activeBrowserDownloadCount\(\)/,
    'the warning must check live downloads in main');
  assert.match(restart, /browserMediaStates\(\)\.length/,
    'the warning must check live media in main');
  assert.match(restart, /requiresConfirmation: true/,
    'activity must require an explicit second request');
});

test('clear-all reconstructs a usable Browser even when Chromium clearing fails', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const start = ipc.indexOf("h('browser:clearAllData'");
  const end = ipc.indexOf("h('browser:bookmarks:get'", start);
  const clearAll = ipc.slice(start, end);
  assert.match(clearAll, /assertUiSender\(event, getWindow\)/);
  assert.match(clearAll, /destroyBrowserSubsystem\(\{ preserveViewport: true \}\)/,
    'clear-all must retain the host and bounds needed to attach its replacement view');
  assert.ok(clearAll.indexOf('destroyBrowserSubsystem') < clearAll.indexOf('clearAllBrowserData()'));
  assert.match(clearAll, /finally\s*\{[\s\S]*createTab\(replacementUrl\)/,
    'a failed or successful wipe must always recreate one configured home tab');
});

test('theme changes are serialised per page so a stale async update cannot win', () => {
  assert.match(code, /pageThemeJobs = new WeakMap/);
  const themeAt = code.indexOf('async function applyPageTheme');
  const theme = code.slice(themeAt, code.indexOf('/**', themeAt + 10));
  assert.match(theme, /previous[\s\S]*\.then\(/);
  assert.match(theme, /value: dark \? 'dark' : 'light'/);
});

test('the native surface follows the document, not the app theme', () => {
  // A page that never opts into a dark colour scheme keeps BLACK default text.
  // Painting the theme's dark surface behind it is what made a 401 page and
  // other unstyled documents unreadable until their text was selected, which
  // repaints it with the highlight colours.
  const surface = body('applyDocumentSurfaceColor');
  assert.match(surface, /executeJavaScript\(PAGE_SURFACE_PROBE/,
    'the document itself must be asked which surface its colours assume');
  assert.match(surface, /DARK_PAGE_SURFACE : LIGHT_PAGE_SURFACE/,
    'the probe must choose between both surfaces');
  assert.match(code, /probe\.style\.color = 'CanvasText'/,
    'CanvasText reflects the meta tag, the CSS property and the emulated preference');
  assert.match(code, /DARK_PAGE_SURFACE = '#0a0a0a'/);
  assert.match(code, /LIGHT_PAGE_SURFACE = '#ffffff'/);

  const theme = code.slice(code.indexOf('async function applyPageTheme'), code.indexOf('export function setBrowserTheme'));
  assert.match(theme, /await applyDocumentSurfaceColor\(tab\)/,
    'every theme pass must end by re-reading the document surface');

  const ready = code.slice(code.indexOf("'dom-ready'"));
  assert.match(ready, /applyPageTheme\(tab\)/, 'dom-ready must apply the theme and surface');

  const finish = code.slice(code.indexOf("'did-finish-load'"));
  assert.match(finish.slice(0, finish.indexOf("'did-stop-loading'")), /applyPageTheme\(tab\)/,
    'a late stylesheet can declare color-scheme, so the surface is rechecked after load');

  const nav = code.slice(code.indexOf("'did-start-navigation'"));
  assert.match(nav, /setBackgroundColor\(browserSurfaceColor\(\)\)/,
    'a new document must not inherit the previous document’s surface');
});

// Back, and the step Chromium does not record.
//
// Nodus's start pages (Bookmarks, Research Atlas) are drawn by React and load
// NOTHING into the WebContents, so they leave no entry in Chromium's history. A
// tab that opens on one and then visits a site has exactly one history entry,
// canGoBack() is false, and the old goBack() — a lone `if (canGoBack) goBack()`
// — silently did nothing. Measured in Electron 43: goBack() with no history
// emits no events whatsoever, so there was not even a failure to notice.
test('Back never falls through and does nothing', () => {
  const goBack = body('goBack');

  // Chromium's own history first, when there is some.
  assert.match(goBack, /navigationHistory\.canGoBack\(\)/);
  assert.match(goBack, /navigationHistory\.goBack\(\)/);

  // Then the start page Chromium never recorded.
  assert.match(goBack, /tab\.internalReturn/, 'Back must consider the remembered start page');
  assert.match(goBack, /restoreInternalReturn\(tab,\s*back\)/,
    'Back must delegate restoration of the remembered start page');

  const restoreInternalReturn = body('restoreInternalReturn');
  assert.match(restoreInternalReturn, /kind:\s*back\.kind/,
    'returning must restore the internal page kind');

  // Then an error pane, which is raised without any navigation at all.
  assert.match(goBack, /dismissError\(\)/, 'with nothing to navigate, Back must at least clear the pane');
});

test('leaving a start page records it, arriving at one clears the debt', () => {
  const navigate = body('navigate');
  assert.match(navigate, /tab\.state\.kind !== 'web'[\s\S]{0,200}internalReturn = \{/,
    'going from a start page to the web must record where to return');
  assert.match(navigate, /internalReturn = null/,
    'arriving at a start page must clear the pending return');
});

test('the toolbar Back button is enabled exactly when Back will do something', () => {
  // Publishing Chromium's raw canGoBack() would grey out the button in the very
  // case the remembered start page exists — a correct action behind a disabled
  // control is indistinguishable from a broken one.
  assert.match(code, /function canGoBackFrom/, 'the combined check must exist');
  assert.doesNotMatch(code, /canGoBack:\s*contents\.navigationHistory\.canGoBack\(\)/,
    'no tab state may publish Chromium history alone as canGoBack');
  const uses = code.match(/canGoBack:\s*canGoBackFrom\(tab\)/g) ?? [];
  assert.ok(uses.length >= 4, `every canGoBack publication must use it, found ${uses.length}`);
});

// The strip itself: equal widths, and arrows once they no longer fit.
//
// A tab sized by its own title makes the strip unreadable as a row — "the fourth
// tab" stops being a position the eye can return to, and one long title shoves
// every other tab sideways. Chrome, Edge and Firefox all answer the same way: one
// width per tab, and the overflow scrolled rather than compressed. These hold the
// two halves of that answer, and the third thing that follows from it — that the
// arrows and the new-tab button belong to the strip, not to the scrolling part.
const stripSource = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
const strip = stripSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const styles = readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');

test('every tab is the same width, and no title may change it', () => {
  const declared = strip.match(/const TAB_WIDTH_CLASS = '([^']+)'/);
  assert.ok(declared, 'the tab width must be one declared constant, not a per-tab decision');
  assert.match(declared[1], /^w-(?!max)/, `the width must be an explicit one, got ${declared[1]}`);
  assert.match(strip, /className=\{`group flex \$\{TAB_WIDTH_CLASS\} shrink-0/,
    'every tab must take that one width, and must not shrink away from it');
  // The old strip capped a tab and let its title decide the rest.
  assert.doesNotMatch(strip, /max-w-52/, 'no tab may size itself from its own title any more');
});

test('a strip with more tabs than room scrolls, and only the arrows move it', () => {
  // The affordance is the arrows, so the native scrollbar stays hidden: two
  // scroll indicators in a 24px row is one too many.
  assert.match(styles, /\.browser-tab-strip-scroll \{[\s\S]{0,400}?overflow-x: auto/,
    'the viewport must scroll horizontally');
  assert.match(styles, /\.browser-tab-strip-scroll \{[\s\S]{0,400}?overscroll-behavior-inline: contain/,
    'scrolling the strip to its end must not carry on into the page');
  assert.match(styles, /\.browser-tab-strip-scroll \{[\s\S]{0,400}?scrollbar-width: none/);
  assert.match(styles, /\.browser-tab-strip-scroll::-webkit-scrollbar \{[\s\S]{0,80}?display: none/);

  assert.match(strip, /role="tablist"[\s\S]{0,400}?browser-tab-strip-scroll/,
    'the tablist itself must be the element that scrolls');
  assert.doesNotMatch(strip, /className="flex items-center gap-1 border-b[^"]*overflow-x-auto/,
    'the strip root must not scroll, or the arrows would scroll away with the tabs');
});

test('each arrow appears only while that end has tabs left to show', () => {
  // Measured from the DOM, never predicted from a tab count: whether the last
  // tab fits depends on its width, the window and the zoom.
  assert.match(strip, /onScroll=\{measureOverflow\}/, 'scrolling is what moves the ends');
  assert.match(strip, /const max = strip\.scrollWidth - strip\.clientWidth/,
    'the ends must be measured from real layout, not from a tab count');
  assert.match(strip, /overflow\.left && <TabStripArrow direction=\{-1\}/,
    'the left arrow must be conditional on there being tabs to its left');
  assert.match(strip, /overflow\.right && <TabStripArrow direction=\{1\}/,
    'the right arrow must be conditional on there being tabs to its right');
  assert.match(strip, /'browser-tab-scroll-left'/, 'the left arrow needs a testable handle');
  assert.match(strip, /'browser-tab-scroll-right'/, 'the right arrow needs a testable handle');

  // A tab opens, closes or renames itself, and the window resizes: none of those
  // is a scroll event, and all of them change whether the ends overflow.
  assert.match(strip, /new ResizeObserver\(measureOverflow\)/, 'width changes must be observed');
  assert.match(strip, /Array\.from\(strip\.children\)/, 'so must a tab that grows a longer title');

  // Whole tabs per click, not a fraction of the viewport: with twelve tabs the
  // overflow is under one viewport, and a viewport step reaches the end in a
  // single click while still leaving the arrow lit.
  assert.match(strip, /const TAB_SCROLL_STEP_TABS = \d+/, 'the step must be whole tabs');
  assert.match(strip, /const pitch = second && first \? second\.offsetLeft - first\.offsetLeft : 0/,
    'the step must be measured from the layout it is moving');
  assert.match(strip, /scrollBy\(\{ left: direction \* step, behavior: 'smooth' \}\)/,
    'the arrows must move the strip by that step, smoothly');
});

test('the arrows and the new-tab button hold their place while the tabs move', () => {
  const stripBody = strip.slice(strip.indexOf('function BrowserTabStrip'));
  const mapped = stripBody.indexOf('{tabs.map(');
  const rightArrow = stripBody.indexOf('overflow.right &&');
  const newTab = stripBody.indexOf('browser-new-tab');
  assert.ok(mapped < rightArrow, 'the arrows belong after the tabs in the strip');
  assert.ok(rightArrow < newTab, 'the new-tab button must stay pinned past the right arrow');
  // Siblings of the scrolling viewport, not children of it: anything inside it
  // would slide out of reach at exactly the moment it was needed.
  assert.match(strip, /\}\)\}\s*<\/div>[\s\S]{0,300}?overflow\.right &&/,
    'the arrows must be siblings of the scrolling viewport');
});

test('the tab that becomes active is the one the strip shows', () => {
  // Activation from the omnibox, a keyboard shortcut, a link opened in a new tab
  // and a page renaming itself all land here; a selected tab left off screen makes
  // the omnibox describe a page whose tab cannot be found.
  assert.match(strip, /querySelector<HTMLElement>\('\[role="tab"\]\[aria-selected="true"\]'\)/,
    'the selected tab must be found by its ARIA state');
  assert.match(strip, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/,
    'and brought into view without moving the page around it');
});
