// Step 2 of the tutorial pipeline: film the real app.
//
// The app runs for real — real Electron, real IPC, real database — on a
// throwaway profile that starts empty and is deleted afterwards, so a recording
// can never read or damage a developer's actual vaults. The cinematic tutorial
// and every per-vault tour are switched off before the first frame: this video
// replaces them, so they must not appear in it.
//
// Each shot is held for exactly as long as its narration clip, which is why
// narrate.mjs has to run first.
//
//   node scripts/tutorial/narrate.mjs --local
//   node scripts/tutorial/record.mjs
//
// Output: .tutorial-out/frames/*.jpg and .tutorial-out/timeline.json

import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { SHOTS, nav } from './shots.mjs';
import { CURSOR_CSS, installCursor } from '../../engine/cursor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'intro');
const FRAMES = path.join(OUT, 'frames');
const DIAG = path.join(OUT, 'diagnostics');

// 16:9 at the source keeps the master crop-free; a Retina compositor doubles it
// to 3200x1800, which is the headroom the camera moves crop into.
const WIN = { width: 1600, height: 900 };
const SCALE = 2;

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` first.');
}
const appDemoKeyFile = path.join(os.homedir(), '.config', 'nodus', 'openrouter-app.key');
const appDemoKey = existsSync(appDemoKeyFile) ? (await readFile(appDemoKeyFile, 'utf8')).trim() : null;

/**
 * Rehearsal mode: fixed-length shots, no narration required.
 *
 * Synthesizing speech costs money and, more importantly, changes every downstream
 * timing — so validating a new interaction should never require regenerating the
 * voice track. `--dry` walks the whole shot list, exercises every click and
 * highlight, and reports the warnings, at a flat few seconds per beat.
 */
const dryRun = process.argv.includes('--dry');
const DRY_SHOT_SECONDS = 4.5;

const narrationFile = path.join(OUT, 'narration.json');
if (!dryRun && !existsSync(narrationFile)) {
  throw new Error('Run scripts/tutorial/narrate.mjs first — the shot lengths come from it (or pass --dry to rehearse).');
}
const narration = existsSync(narrationFile) ? JSON.parse(await readFile(narrationFile, 'utf8')) : { cues: [] };
const cueById = new Map(narration.cues.map((c) => [c.id, c]));

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
await rm(DIAG, { recursive: true, force: true });
await mkdir(DIAG, { recursive: true });

// ---------------------------------------------------------------- fixtures
// A deterministic stand-in for Zotero's local API. The demo corpus supplies the
// on-screen content, so this only has to be present and consistent.
const zotero = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Last-Modified-Version', '7');
  if (pathname.endsWith('/groups')) return void res.end('[]');
  if (pathname.endsWith('/collections')) {
    return void res.end(JSON.stringify([
      { key: 'COLL1', version: 7, data: { key: 'COLL1', name: 'The science of learning', parentCollection: false } },
      { key: 'COLL2', version: 7, data: { key: 'COLL2', name: 'Memory and retrieval', parentCollection: 'COLL1' } },
    ]));
  }
  if (pathname.endsWith('/items/top') || pathname.endsWith('/items')) {
    res.setHeader('Total-Results', '0');
    return void res.end('[]');
  }
  res.statusCode = 404;
  res.end('{"error":"not found"}');
});
zotero.listen(0, '127.0.0.1');
await once(zotero, 'listening');
const zoteroApiBase = `http://127.0.0.1:${zotero.address().port}/api`;

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-'));
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_ZOTERO_API_BASE: zoteroApiBase,
};
delete env.ELECTRON_RUN_AS_NODE;

const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`[record] ⚠ ${msg}`);
};

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
let frames = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });

  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
    win.center();
  }, WIN);

  // Silence everything that is *about* the app rather than the app: the cinematic
  // deck this video replaces, every vault tour, and the what's-new modal.
  //
  // The what's-new gate is `lastSeen !== currentVersion`, so the sentinel value
  // these capture scripts usually reach for ('9999.0.0') does the exact opposite
  // of what it looks like — it forces the modal open, and its backdrop then eats
  // every click in the recording. It has to be the real version, written by an
  // init script so it is in place before React first reads it.
  //
  // The startup update modal is not covered by NODUS_E2E_UPDATE_STATUS: that env
  // only decides the *answer*, while the modal opens regardless, once per session,
  // to show its "checking" state. Its own session flag is what keeps it shut.
  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en',
    basicsTutorialVersion: 9999,
    onboardingComplete: true,
    recoverySetupVersion: 9999,
    // Nodi stays on — the video introduces it — but its first-run style picker
    // is a modal, so record it as already answered. The orb skin is the one the
    // tutorial shows.
    mascotStyleChosen: true,
    mascotStyle: 'orb',
    tourComplete: true,
    advancedTourComplete: true,
    genealogyTourComplete: true,
    databasesTourComplete: true,
    studyTourComplete: true,
    docenciaTourComplete: true,
  }));
  await page.evaluate(() => window.nodus.seedDemoData());

  // Load a provider key so the tutorial can show a *connected* provider and a real
  // model catalogue. It goes in through IPC, never through the UI, so the key never
  // appears on camera. This is a separate key from the narration one on purpose:
  // filming model lists must not spend the text-to-speech budget.
  if (appDemoKey) {
    const result = await page.evaluate(async (k) => {
      try { await window.nodus.setApiKey('openrouter', k); return 'ok'; } catch (e) { return String(e); }
    }, appDemoKey);
    if (result !== 'ok') warn(`could not load the OpenRouter demo key: ${result}`);
  } else {
    warn('no OpenRouter demo key found — the provider beats will show an unconnected provider');
  }

  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  // Nothing may cover the UI once filming starts. This is the failure mode that
  // wastes a whole take: a modal backdrop turns every scripted click into a
  // silent no-op, so the run reports success and films four minutes of the same
  // screen. Fail loudly instead, naming what is in the way.
  const blocker = await page.evaluate(() => {
    const covering = [...document.querySelectorAll('[role="dialog"], .whats-new-backdrop, .tutorial-cinema, [aria-modal="true"]')]
      .find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 200 && r.height > 200;
      });
    if (!covering) return null;
    return {
      cls: covering.className?.toString().slice(0, 80) ?? '',
      text: (covering.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    };
  });
  if (blocker) {
    throw new Error(
      `Something is covering the app before filming started, so no click would register.\n` +
      `  class: ${blocker.cls}\n  text:  ${blocker.text}\n` +
      `Suppress it in the bootstrap above — do not work around it in the shot list.`
    );
  }

  // Three pieces of first-run chrome are about the *recording profile*, not about
  // Nodus, and on camera they read as errors: the demo-corpus banner, the
  // "backups are off" alert, and the header's missing-model warning. The alert has
  // a real dismiss button, so use it; the other two are state-driven and get
  // hidden. Everything the tutorial actually teaches stays untouched.
  await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});
  await page.evaluate(() => {
    const hide = (el) => { if (el) el.style.display = 'none'; };
    hide(document.querySelector('button[aria-label="Configure an AI model"]'));
    const demo = [...document.querySelectorAll('div.border-b')].find((d) => {
      const r = d.getBoundingClientRect();
      return r.height < 70 && r.width > 600 && /demo mode/i.test(d.textContent ?? '');
    });
    hide(demo);
  });

  const injectCursor = async () => {
    await page.evaluate((css) => { window.__TUTORIAL_CURSOR_CSS__ = css; }, CURSOR_CSS);
    await page.evaluate(installCursor);
  };
  await injectCursor();

  // ------------------------------------------------------------- driver API
  const settle = (ms) => page.waitForTimeout(ms);

  /** Glide the drawn cursor onto an element and click it for real. */
  const pointAndClick = async (selector, { required = true, timeout = 6000 } = {}) => {
    const el = page.locator(selector).first();
    let box = null;
    try {
      await el.waitFor({ state: 'visible', timeout });
      box = await el.boundingBox();
    } catch {
      /* handled below */
    }
    if (!box) {
      if (required) warn(`selector not found, shot filmed without the click: ${selector}`);
      return false;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y), { x: cx, y: cy });
    await settle(680);
    await page.evaluate(() => window.__tutorialCursor?.pulse());
    let clicked = true;
    await el.click({ timeout: 6000 }).catch(() => {
      warn(`click failed: ${selector}`);
      clicked = false;
    });
    return clicked;
  };

  /**
   * Make sure nothing is covering the interface before a shot begins.
   *
   * A shot that opens a detail panel or a modal leaves it open for the next one,
   * and from then on every scripted click lands on a backdrop instead of the
   * sidebar — the run keeps "succeeding" while filming the same screen. Clearing
   * this between shots is what makes the take reliable rather than lucky.
   */
  const clearOverlays = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const covering = await page.evaluate(() => {
        // Probe the point the sidebar occupies: if something else answers there,
        // navigation is unreachable no matter what the DOM contains.
        const el = document.elementFromPoint(90, 400);
        if (!el) return null;
        const blocker = el.closest('[role="dialog"], [aria-modal="true"], .whats-new-backdrop, .nodi-cite-overlay');
        if (!blocker && el.closest('nav, [data-testid="resizable-sidebar"]')) return null;
        const target = blocker ?? el;
        return { cls: target.className?.toString().slice(0, 60) ?? '', tag: target.tagName };
      });
      if (!covering) return true;

      // Escape does nothing here. Nodus's modal shell has no key handler at all: it
      // closes by clicking its own cancel control, or the backdrop behind the card.
      // Pressing Escape at a modal and assuming it closed is what left the vault
      // dialog standing over the rest of the take.
      const cancel = page.locator(
        '[role="dialog"] button:text-is("Cancel"), [role="dialog"] button:text-is("Close")'
      ).first();
      if (await cancel.isVisible().catch(() => false)) {
        const box = await cancel.boundingBox().catch(() => null);
        if (box) {
          await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 });
          await settle(420);
          await page.evaluate(() => window.__tutorialCursor?.pulse());
        }
        await cancel.click({ timeout: 2500 }).catch(() => {});
        await settle(550);
        continue;
      }

      // No cancel control: click the backdrop, well away from the card.
      await page.mouse.click(24, 24).catch(() => {});
      await settle(400);
      await page.keyboard.press('Escape');
      await settle(350);
    }
    warn('could not clear an overlay covering the sidebar — the next clicks may not register');
    return false;
  };

  /**
   * Ring a target without moving the camera. Resolution happens here, with a
   * Playwright locator, so text-matching selectors work; only the resulting
   * rectangle crosses into the page.
   */
  const highlight = async (selector) => {
    // Accept several candidates: a highlight anchored to visible copy breaks the
    // day that copy is reworded, and losing the emphasis silently is worse than
    // trying an alternative.
    const candidates = Array.isArray(selector) ? selector : [selector];
    for (const candidate of candidates) {
      const box = await page.locator(candidate).first().boundingBox({ timeout: 1500 }).catch(() => null);
      if (box) {
        await page.evaluate((r) => window.__tutorialCursor?.highlight(r), box);
        return true;
      }
    }
    warn(`highlight target not found: ${candidates.join(' | ')}`);
    return false;
  };
  const clearHighlights = () => page.evaluate(() => window.__tutorialCursor?.clearHighlights());

  const helpers = {
    page,
    settle,
    clearOverlays,
    highlight,
    click: (sel) => pointAndClick(sel),
    /** Open an idea so the detail panel with its evidence is on screen. */
    clickIdea: async () => {
      const ok = await pointAndClick('main button.card', { required: false, timeout: 4000 });
      if (!ok) warn('no idea card to open');
      await settle(1400);
    },
    /**
     * Flip the model-configuration mode. The switch asks for confirmation because
     * it changes which models Nodus actually uses, so the dialog has to be
     * answered or the mode never changes.
     */
    switchModelMode: async (label) => {
      const btn = page.locator(`[data-testid="model-settings-mode"] button:has-text("${label}")`).first();
      if (!(await btn.isVisible().catch(() => false))) return void warn(`model mode button "${label}" not visible`);
      const box = await btn.boundingBox().catch(() => null);
      if (box) {
        await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        await settle(450);
        await page.evaluate(() => window.__tutorialCursor?.pulse());
      }
      await btn.click({ timeout: 4000 }).catch(() => warn('model mode click failed'));
      await settle(700);
      const confirm = page.locator('[role="dialog"] button:not(:has-text("Cancel"))').last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click({ timeout: 3000 }).catch(() => {});
        await settle(900);
      }
    },
    /** Expand a provider row so its saved-key state is visible. */
    openProvider: async (name) => {
      await pointAndClick(`[data-testid="provider-${name}"]`, { required: false, timeout: 4000 });
      await settle(1600);
    },
    /**
     * Put a real recommended model into the extraction slot.
     *
     * Written through settings rather than opened on camera: the picker in Settings
     * is a native <select>, and a native dropdown is drawn by the operating system
     * outside the page, so the screencast would record it as nothing at all.
     * Setting the value shows the same fact — the provider's catalogue is available
     * and this is the model to choose — in something the camera can actually see.
     */
    chooseExtractionModel: async (provider, model) => {
      await page.evaluate(({ p, m }) => window.nodus.updateSettings({ extractionModel: { provider: p, model: m } }),
        { p: provider, m: model });
      await settle(1200);
    },
    /** Bring a section into view so the narration has something to point at. */
    scrollTo: async (selector) => {
      const handle = await page.$(selector);
      if (!handle) return void warn(`scrollTo target not found: ${selector}`);
      await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await settle(800);
    },
    clickNodi: async () => {
      await pointAndClick('.nodi-anchor', { required: false, timeout: 4000 });
      await settle(1800);
    },
    dismiss: () => clearOverlays(),
    clickFirstCard: async () => {
      for (const sel of ['[data-testid="idea-card"]', 'main li button', 'main [role="button"]', 'main button']) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) return pointAndClick(sel, { required: false });
      }
      warn('no card found to open');
      return false;
    },
    /**
     * Settings is long; its own search box is the honest way to reach a section.
     *
     * Filming a search that matches nothing is worse than not searching at all —
     * the viewer watches a term being typed into an empty page — so the result is
     * checked and a barren term is reported instead of quietly filmed.
     */
    searchSettings: async (text) => {
      const SEARCH = 'main input[placeholder*="ettings"]';
      const input = page.locator(SEARCH).first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no settings search input found');
      await pointAndClick(SEARCH, { required: false, timeout: 2000 });
      await input.fill('');
      await input.pressSequentially(text, { delay: 55 });
      await settle(900);

      // Check the field, not the page. An earlier guard measured how much text the
      // page still showed, which cannot distinguish "search applied" from "search
      // did nothing" — an unfiltered Settings page is full of text either way. Three
      // shots were filmed typing into a box that stayed empty because of that.
      const value = await input.inputValue().catch(() => '');
      if (value !== text) {
        warn(`settings search did not take: typed "${text}", field holds "${value}"`);
        return;
      }
      const chars = await page.evaluate(() =>
        (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').trim().length);
      if (chars < 600) warn(`settings search "${text}" matched nothing (${chars} chars) — pick another term`);
    },
    clearSettingsSearch: async () => {
      const input = page.locator('main input[placeholder*="ettings"]').first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill('');
        await settle(700);
      }
    },
    /** Open the vault menu, then its add-vault modal: the only place the vault types are all listed. */
    openVaultTypes: async () => {
      await pointAndClick('[data-vault-trigger]', { required: false, timeout: 4000 });
      await settle(900);
      await pointAndClick('button[title="Add vault"]', { required: false, timeout: 4000 });
      await settle(1100);
    },
    typeInSearch: async (text) => {
      // Nodus inputs carry no `type` attribute, so `input[type="text"]` matches
      // none of them — match the shared `.input` class instead.
      const SEARCH = 'main input.input, main input[placeholder], input[type="search"]';
      const input = page.locator(SEARCH).first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no search input found');
      await pointAndClick(SEARCH, { required: false, timeout: 2000 });
      await input.type(text, { delay: 70 });
      await page.keyboard.press('Enter').catch(() => {});
    },
  };

  // ------------------------------------------------------------- screencast
  const cdp = await app.context().newCDPSession(page);
  const t0 = Date.now();
  let index = 0;
  cdp.on('Page.screencastFrame', async (frame) => {
    const file = path.join(FRAMES, `f${String(index++).padStart(6, '0')}.jpg`);
    frames.push({ t: (Date.now() - t0) / 1000, file });
    await writeFile(file, Buffer.from(frame.data, 'base64')).catch(() => {});
    await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 88,
    maxWidth: WIN.width * SCALE,
    maxHeight: WIN.height * SCALE,
    everyNthFrame: 1,
  });

  // ------------------------------------------------------------------ shoot
  const timeline = [];
  for (const shot of SHOTS) {
    const cue = cueById.get(shot.id) ?? (dryRun ? { duration: DRY_SHOT_SECONDS } : null);
    if (!cue) {
      warn(`no narration cue for shot ${shot.id} — skipped`);
      continue;
    }
    // Drop the previous shot's ring immediately. Clearing it later — just before
    // drawing the next one — left it glowing through this shot's navigation and
    // action, so it appeared to point at whatever came next.
    await clearHighlights();

    // Anything the previous shot left open has to go before this one navigates,
    // or it swallows every click from here on. Shots whose whole point *is* the
    // open dialog — the vault type picker — opt out with `keepOverlay`.
    if (!shot.keepOverlay) await clearOverlays();

    const started = (Date.now() - t0) / 1000;

    if (shot.nav) {
      const navigated = await pointAndClick(nav(shot.nav), { required: false });
      if (!navigated) {
        await page.screenshot({ path: path.join(DIAG, `${shot.id}-nav-failed.png`) }).catch(() => {});
      }
    }
    if (shot.settleBefore) await settle(shot.settleBefore);
    else await settle(500);

    // `locator.boundingBox()` *waits* for a missing element, which silently
    // stretched a shot past its narration; query the handle instead so an absent
    // target costs nothing and the shot simply stays wide.
    /**
     * Measure where the camera should point — and make sure that place is actually
     * on screen first.
     *
     * `boundingBox()` happily reports an element sitting far below the fold:
     * Settings returned targets at y=1254 and y=2780 inside a 900px window. Those
     * are real coordinates for an element nobody can see, and the camera dutifully
     * aimed at them, clamped to the bottom edge of the frame, and filmed something
     * unrelated while reporting a successful zoom. Scrolling the target into view
     * fixes the framing and is what a viewer would do anyway.
     */
    const measureFocus = async () => {
      if (!shot.focus) return null;
      const handle = await page.$(shot.focus);
      if (!handle) {
        warn(`focus target missing, shot filmed wide: ${shot.focus} (${shot.id})`);
        return null;
      }
      // Present in the DOM is not the same as on screen: several Settings panels
      // stay mounted while another tab is shown, and aiming at one of those films
      // whatever happens to be in that corner of the visible page instead.
      if (!(await handle.isVisible().catch(() => false))) {
        warn(`focus target present but not visible, shot filmed wide: ${shot.focus} (${shot.id})`);
        return null;
      }
      await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await settle(650);
      const box = await handle.boundingBox().catch(() => null);
      if (!box) {
        warn(`focus target has no box, shot filmed wide: ${shot.focus} (${shot.id})`);
        return null;
      }
      // Belt and braces: never aim at something still outside the window.
      const offscreen = box.y + box.height < 0 || box.y > WIN.height || box.x > WIN.width;
      if (offscreen) {
        warn(`focus target off screen after scrolling, shot filmed wide: ${shot.focus} (${shot.id})`);
        return null;
      }
      return box;
    };

    // A shot's action can be what brings its camera target into existence — the
    // Settings searches reveal the very card the camera is meant to push in on — so
    // when a shot has both, the action runs first and the target is measured after
    // it. Measuring first left those shots framed wide with no explanation.
    const holdUntil = started + cue.duration;
    let focusRect = null;
    if (shot.act && shot.focus && !shot.focusBeforeAct) {
      await shot.act(helpers).catch((e) => warn(`act failed in ${shot.id}: ${e.message}`));
      focusRect = await measureFocus();
    } else {
      focusRect = await measureFocus();
      if (shot.act) await shot.act(helpers).catch((e) => warn(`act failed in ${shot.id}: ${e.message}`));
    }

    if (shot.highlight) await highlight(shot.highlight);

    // Hold what is left of the narration, measured from the shot's own start.
    const remaining = holdUntil - (Date.now() - t0) / 1000;
    if (remaining > 0) await settle(Math.round(remaining * 1000));

    const ended = (Date.now() - t0) / 1000;
    timeline.push({
      id: shot.id,
      start: started,
      end: ended,
      narration: cue.duration,
      focus: focusRect,
      say: shot.say,
    });
    console.log(`[record] ${shot.id.padEnd(20)} ${(ended - started).toFixed(2)}s${focusRect ? ' · zoom' : ''}`);
  }

  await cdp.send('Page.stopScreencast').catch(() => {});
  await settle(400);

  await writeFile(
    path.join(OUT, 'timeline.json'),
    JSON.stringify({
      window: WIN,
      frameSize: { width: WIN.width * SCALE, height: WIN.height * SCALE },
      cssToFrame: SCALE,
      duration: frames.length ? frames.at(-1).t : 0,
      shots: timeline,
      frames,
      warnings,
    }, null, 2),
    'utf8'
  );
  console.log(`\n[record] ${frames.length} frames · ${timeline.length}/${SHOTS.length} shots · ${warnings.length} warnings`);
} finally {
  await app.close().catch(() => {});
  await new Promise((r) => zotero.close(r));
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
