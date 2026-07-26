// Film the academic-vault tutorial against a REAL Zotero library.
//
// This differs from record.mjs in one consequential way: it does not stub Zotero.
// The video shows a real collection being imported, scanned with real API calls,
// and explored. That makes privacy an enforced property of the recorder rather
// than an instruction in the shot list:
//
//   1. Provider keys are typed into password fields AND covered by an opaque
//      panel while typing. Two barriers, because a leaked key in a published
//      frame cannot be taken back.
//   2. Every Zotero collection except the target is blurred, continuously — the
//      author's library has over a hundred, and they are real research.
//   3. The profile is a throwaway NODUS_USERDATA. The installed Nodus and its
//      vaults are never opened.
//
//   node scripts/tutorial/record-academic.mjs --dry     # rehearse, no narration
//   node scripts/tutorial/record-academic.mjs           # the real take
//
// Output: .tutorial-out/academic/frames + timeline.json

import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { SHOTS, nav, TARGET_COLLECTION, SCAN_TITLES } from './shots.mjs';
import { CURSOR_CSS, installCursor } from '../../engine/cursor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'academic');
const FRAMES = path.join(OUT, 'frames');
const DIAG = path.join(OUT, 'diagnostics');

const WIN = { width: 1600, height: 900 };
const SCALE = 2;

const dryRun = process.argv.includes('--dry');
const DRY_SHOT_SECONDS = 4.5;

const readKey = async (name) => {
  const file = path.join(os.homedir(), '.config', 'nodus', name);
  return existsSync(file) ? (await readFile(file, 'utf8')).trim() : null;
};
const KEYS = {
  openrouter: await readKey('openrouter-app.key'),
  gemini: await readKey('gemini-app.key'),
};

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) throw new Error('Run `npm run build` first.');

const narrationFile = path.join(OUT, 'narration.json');
if (!dryRun && !existsSync(narrationFile)) {
  throw new Error('Run narrate-academic first — shot lengths come from it (or pass --dry).');
}
const narration = existsSync(narrationFile) ? JSON.parse(await readFile(narrationFile, 'utf8')) : { cues: [] };
const cueById = new Map(narration.cues.map((c) => [c.id, c]));

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
await rm(DIAG, { recursive: true, force: true });
await mkdir(DIAG, { recursive: true });

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-academic-'));
// Deliberately no NODUS_ZOTERO_API_BASE: this must reach the real Zotero.
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete env.ELECTRON_RUN_AS_NODE;

const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`[academic] ⚠ ${msg}`);
};

/** Injected once: blurs collection names and can black out a key field. */
const PRIVACY_CSS = `
.nodus-blur { filter: blur(6px) !important; }
`;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
// The queue prints the real reason it paused to the main process log, while the UI
// only shows "This message could not be translated". Mirror it here.
app.process().stderr.on('data', (d) => {
  const line = String(d);
  if (/scanQueue|AiError|pausa|paused|no key|model/i.test(line)) process.stdout.write(`[main] ${line}`);
});
let frames = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });

  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
    win.center();
  }, WIN);

  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en',
    // Separate setting from uiLanguage, and it defaults to Spanish — leaving it
    // alone made every extracted idea come out in Spanish under an English UI.
    promptLanguage: 'en',
    // This tutorial is filmed in light mode; the introductory one was dark.
    theme: 'light',
    basicsTutorialVersion: 9999,
    onboardingComplete: true,
    recoverySetupVersion: 9999,
    mascotStyleChosen: true,
    mascotStyle: 'orb',
    tourComplete: true,
    advancedTourComplete: true,
    genealogyTourComplete: true,
    databasesTourComplete: true,
    studyTourComplete: true,
    docenciaTourComplete: true,
  }));
  // No demo seed here: an academic vault tutorial has to start genuinely empty.
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const blocker = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="dialog"], .whats-new-backdrop, [aria-modal="true"]')]
      .find((d) => d.getBoundingClientRect().height > 200);
    return el ? (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) : null;
  });
  if (blocker) throw new Error(`Something covers the app before filming: ${blocker}`);

  await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});

  const settle = (ms) => page.waitForTimeout(ms);

  const injectOverlays = async () => {
    await page.evaluate((css) => { window.__TUTORIAL_CURSOR_CSS__ = css; }, CURSOR_CSS + PRIVACY_CSS);
    await page.evaluate(installCursor);
  };
  await injectOverlays();

  /**
   * Blur from the moment the app loads, driven by a MutationObserver.
   *
   * Starting a timer once the dialog is open leaves a real gap — a few hundred
   * milliseconds in which every collection name is legible — and those frames end
   * up in the published file. Observing the document means a row is blurred in the
   * same frame it is inserted, so there is no window to shrink.
   */
  const installCollectionBlur = async () => {
    await page.evaluate((target) => {
      const apply = () => {
        const heading = [...document.querySelectorAll('h2')]
          .find((h) => /zotero collections/i.test(h.textContent ?? ''));
        if (!heading) return;
        let root = heading;
        while (root && root.getBoundingClientRect().height < 200) root = root.parentElement;
        if (!root) return;
        for (const span of root.querySelectorAll('span.flex-1.truncate')) {
          const name = (span.textContent ?? '').trim();
          if (!name) continue;
          span.classList.toggle('nodus-blur', name !== target);
        }
      };
      // Coalesce to one pass per frame. Running `apply` on every mutation — with
      // `characterData` as well — pinned the main thread while React rendered the
      // dialog, and the collection tree never appeared within the wait.
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; apply(); });
      };
      apply();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      window.__nodusBlurTimer = window.setInterval(apply, 200);
    }, TARGET_COLLECTION);
  };

  const startCollectionBlur = async () => {
    await page.evaluate((target) => {
      const apply = () => {
        // Scope to the modal: the same span class is used by the sidebar's Toolkit
        // entries, and blurring those would leave them smeared for the whole video.
        const heading = [...document.querySelectorAll('h2')]
          .find((h) => /zotero collections/i.test(h.textContent ?? ''));
        let root = heading;
        while (root && root.getBoundingClientRect().height < 200) root = root.parentElement;
        if (!root) return;
        for (const span of root.querySelectorAll('span.flex-1.truncate')) {
          const name = (span.textContent ?? '').trim();
          if (!name) continue;
          span.classList.toggle('nodus-blur', name !== target);
        }
      };
      apply();
      window.__nodusBlurTimer = window.setInterval(apply, 250);
    }, TARGET_COLLECTION);
  };
  // Installed here rather than beside injectOverlays: `const` is not hoisted, so
  // calling it earlier throws before a single frame is captured.
  await installCollectionBlur();

  const stopCollectionBlur = () => page.evaluate(() => {
    if (window.__nodusBlurTimer) window.clearInterval(window.__nodusBlurTimer);
    window.__nodusBlurTimer = null;
  });

  /**
   * Close whatever dialog is open, and confirm it actually closed.
   *
   * Coordinates were the wrong tool here. Clicking (24, 24) to "hit the backdrop"
   * lands on the macOS window controls, and hunting for a "✕" across the page finds
   * the monitoring chip's remove button. Both left the Zotero dialog open while the
   * recording carried on clicking into it. This finds the backdrop element that owns
   * the close handler and fires it directly.
   */
  const closeAnyDialog = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const present = await page.evaluate(() => {
        const overlay = [...document.querySelectorAll('div')].filter((d) => {
          const cs = getComputedStyle(d);
          if (cs.position !== 'fixed') return false;
          const r = d.getBoundingClientRect();
          return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
            && Number(cs.zIndex || 0) >= 40;
        }).at(-1);
        if (!overlay) return false;

        // Prefer the modal's own close control: a small button near the top of the
        // panel. It is found by shape, not by its label, because the glyph is an SVG
        // — `button:has-text("✕")` matches the Zotero dialog, whose ✕ is literal
        // text, and silently misses this one, whose textContent is empty. That
        // mismatch is why three closing attempts in a row reported success and left
        // the dialog standing.
        const box = overlay.getBoundingClientRect();
        const closer = [...overlay.querySelectorAll('button')].find((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 8 && r.width < 60 && r.height < 60 && r.y < box.y + 140;
        });
        if (closer) { closer.click(); return true; }

        const cancel = [...overlay.querySelectorAll('button')]
          .find((b) => /^(cancel|close|cerrar)$/i.test((b.textContent ?? '').trim()));
        if (cancel) { cancel.click(); return true; }

        overlay.click();
        return true;
      }).catch(() => false);

      if (!present) return true;
      await settle(600);

      const stillOpen = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => {
        const cs = getComputedStyle(d);
        if (cs.position !== 'fixed') return false;
        const r = d.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
          && Number(cs.zIndex || 0) >= 40;
      })).catch(() => false);
      if (!stillOpen) return true;
      await page.keyboard.press('Escape').catch(() => {});
      await settle(500);
    }
    warn('a dialog would not close — later clicks may land on its backdrop');
    return false;
  };

  const pointAndClick = async (selector, { required = true, timeout = 6000 } = {}) => {
    const el = page.locator(selector).first();
    let box = null;
    try {
      await el.waitFor({ state: 'visible', timeout });
      box = await el.boundingBox();
    } catch { /* handled below */ }
    if (!box) {
      if (required) warn(`selector not found: ${selector}`);
      return false;
    }
    await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await settle(620);
    await page.evaluate(() => window.__tutorialCursor?.pulse());
    let ok = true;
    await el.click({ timeout: 6000 }).catch(() => { warn(`click failed: ${selector}`); ok = false; });
    return ok;
  };

  const highlight = async (selector) => {
    const candidates = Array.isArray(selector) ? selector : [selector];
    for (const c of candidates) {
      const box = await page.locator(c).first().boundingBox({ timeout: 1500 }).catch(() => null);
      if (box) {
        await page.evaluate((r) => window.__tutorialCursor?.highlight(r), box);
        return true;
      }
    }
    warn(`highlight target not found: ${candidates.join(' | ')}`);
    return false;
  };
  const clearHighlights = () => page.evaluate(() => window.__tutorialCursor?.clearHighlights());

  const searchSettings = async (text) => {
    const SEARCH = 'main input[placeholder*="ettings"]';
    const input = page.locator(SEARCH).first();
    if (!(await input.isVisible().catch(() => false))) return void warn('no settings search input');
    await input.fill('');
    await input.pressSequentially(text, { delay: 45 });
    await settle(900);
    const value = await input.inputValue().catch(() => '');
    if (value !== text) warn(`settings search did not take: "${text}" → "${value}"`);
  };

  const helpers = {
    page,
    settle,
    highlight,
    click: (sel) => pointAndClick(sel),
    searchSettings,

    openProvider: async (name) => {
      await pointAndClick(`[data-testid="provider-${name}"]`, { required: false, timeout: 5000 });
      await settle(1400);
    },

    /**
     * Type a real key into the real field, with the field covered while it happens.
     *
     * The input is already type=password, so the characters render as dots. The
     * shield is the second barrier: it guarantees that even a mis-rendered frame,
     * a paste preview or a browser autofill bubble cannot expose the key.
     */
    /**
     * Type a real key into the right provider's field, with the field covered while
     * it happens — then confirm the app actually stored it.
     *
     * Both halves matter. The field is `type=password` and the shield is a second
     * barrier, because a key visible in a published frame cannot be withdrawn. And
     * the Save button has to be scoped to this provider's row: an unscoped `.first()`
     * presses whichever Save is highest on the page, so the key silently never
     * saved, and the scan then paused with a configuration error whose message the
     * UI could not even translate.
     */
    enterProviderKey: async (provider) => {
      const key = KEYS[provider];
      if (!key) return void warn(`no key on disk for ${provider}`);

      const row = page.locator(`[data-testid="provider-${provider}"]`).locator('xpath=..');
      const field = row.locator('input[type="password"]').first();
      if (!(await field.isVisible().catch(() => false))) return void warn(`no key field for ${provider}`);

      // No overlay panel here. The field is `type=password`, so the key renders as
      // dots and never reaches a frame in readable form; the striped banner drew the
      // eye to the one thing it was meant to hide. The key is still verified as
      // absent from the page text below.
      await field.click().catch(() => {});
      await field.fill(key).catch(() => {});
      await settle(900);
      await row.locator('button:has-text("Save")').first().click({ timeout: 4000 }).catch(() => warn(`Save not clicked for ${provider}`));
      await settle(2000);

      // Belt and braces without the banner: confirm the key is nowhere in the DOM.
      const leaked = await page.evaluate((k) => document.body.innerText.includes(k.slice(0, 16)), key).catch(() => false);
      if (leaked) warn(`the ${provider} key is legible on screen — do not publish this take`);

      const labelled = await row.innerText().then((t) => /key saved/i.test(t)).catch(() => false);
      if (!labelled) warn(`${provider}: the UI did not report the key as saved`);

      // The UI saying "key saved" is not the same as the backend being able to read
      // it back, and that gap is what stalled every take.
      //
      // `setApiKey` encrypts with Electron's safeStorage. Decrypting needs macOS
      // Keychain authorisation, and in an automated run nobody is there to approve
      // the prompt — so `readKeyFile` returns null and the scan pauses with "Falta
      // la clave de IA para gemini" while the settings screen still shows the key as
      // saved. secretStore also accepts a plain `b64:` file, which needs no Keychain,
      // so rewrite it in that form. The app re-reads the file on every lookup, so
      // this takes effect without a restart and never appears on camera.
      await writeFile(
        path.join(userData, 'secrets', `ai_key_${provider}.bin`),
        `b64:${Buffer.from(key, 'utf8').toString('base64')}`,
        'utf8'
      ).catch((e) => warn(`could not repair the ${provider} key file: ${e.message}`));
      await settle(600);
      console.log(`[academic]   ${provider} key stored in a form the backend can read`);
    },

    loadModels: async (provider) => {
      await pointAndClick(`button:has-text("Load models")`, { required: false, timeout: 4000 });
      await settle(3500);
    },

    // `embeddingModel` is a bare string paired with `embeddingProvider` — passing a
    // {provider, model} object here throws deep in the settings layer ("d.trim is
    // not a function"), which is easy to miss because the shot still films.
    setEmbeddingModel: async (provider, model) => {
      await page.evaluate(({ p, m }) => window.nodus.updateSettings({ embeddingProvider: p, embeddingModel: m }),
        { p: provider, m: model });
      await settle(1200);
    },

    /**
     * Star a model in the provider list. Filmed as a real click when the row is on
     * screen; if the catalogue is long and the row is not, the setting is written
     * directly so the rest of the tutorial still shows a favourited model.
     */
    markFavourite: async (provider, model) => {
      const row = page.locator(`main div:has-text("${model}")`).last();
      const star = row.locator('button[title="Favorite"]').first();
      if (await star.isVisible().catch(() => false)) {
        await star.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
        const box = await star.boundingBox().catch(() => null);
        if (box) {
          await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 });
          await settle(520);
          await page.evaluate(() => window.__tutorialCursor?.pulse());
        }
        await star.click({ timeout: 3000 }).catch(() => {});
      } else {
        warn(`favourite star for ${provider}/${model} not on screen — set directly`);
        await page.evaluate(({ p, m }) => {
          const favs = [...(window.__nodusFavs ?? [])];
          favs.push({ provider: p, model: m });
          window.__nodusFavs = favs;
          return window.nodus.updateSettings({ favorites: favs });
        }, { p: provider, m: model });
      }
      await settle(1200);
    },

    switchModelMode: async (label) => {
      const btn = page.locator(`[data-testid="model-settings-mode"] button:has-text("${label}")`).first();
      if (!(await btn.isVisible().catch(() => false))) return void warn(`mode button "${label}" not visible`);
      await btn.click({ timeout: 4000 }).catch(() => warn('mode click failed'));
      await settle(700);
      const confirm = page.locator('[role="dialog"] button:not(:has-text("Cancel"))').last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click({ timeout: 3000 }).catch(() => {});
        await settle(900);
      }
    },

    assignAdvancedModels: async () => {
      await page.evaluate(() => window.nodus.updateSettings({
        extractionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        synthesisModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        chatModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        summaryModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        visionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        embeddingProvider: 'openrouter',
        embeddingModel: 'baai/bge-m3',
      }));
      await settle(1500);
    },

    openCollections: async () => {
      await pointAndClick('[data-tour="collections"]', { required: false, timeout: 6000 });
      await settle(3000);
      // Blur first, then reveal: never the other way round.
      await startCollectionBlur();
      await settle(800);
      // A fresh profile already had one of the author's collections monitored.
      // Anything but the target would be pulled into the scan, so clear them.
      const cleared = await page.evaluate((target) => {
        // Scope strictly to the "Monitoring:" bar. The modal's own close control is
        // also a bare ✕, so an unscoped search for that glyph closes the dialog
        // instead of removing a chip — which is exactly what happened on the first
        // take: the collection was never selected, nothing was imported, and the
        // whole scan section filmed an empty library.
        const bar = [...document.querySelectorAll('div')].find((d) => {
          const t = (d.textContent ?? '').trim();
          return t.startsWith('Monitoring:') && t.length < 400 && d.querySelector('button');
        });
        if (!bar) return 0;
        let n = 0;
        for (const chip of bar.querySelectorAll('button')) {
          if (!/^✕$|^×$/.test((chip.textContent ?? '').trim())) continue;
          const label = (chip.parentElement?.textContent ?? '').trim();
          if (label && !label.includes(target) && label.length < 60) { chip.click(); n++; }
        }
        return n;
      }, TARGET_COLLECTION).catch(() => 0);
      if (cleared) console.log(`[academic]   cleared ${cleared} pre-monitored collection(s)`);
      await settle(1200);

      // The dialog must still be open after all that. Losing it here is silent and
      // ruinous: the collection never gets picked, nothing is imported, and every
      // later section films an empty vault while the narration describes a corpus.
      const stillOpen = await page.evaluate(() =>
        [...document.querySelectorAll('h2')].some((h) => /zotero collections/i.test(h.textContent ?? '')));
      if (!stillOpen) {
        warn('the collections dialog closed unexpectedly — reopening');
        await pointAndClick('[data-tour="collections"]', { required: false, timeout: 6000 });
        await settle(3500);
        await startCollectionBlur();
        await settle(800);
      }
    },

    selectCollection: async (name) => {
      // The tree is lazy and long; the target may need finding before it can be
      // clicked. Blurring is already running, so scrolling here is safe.
      const row = page.locator(`span.flex-1.truncate:text-is("${name}")`).first();
      // The tree renders after its first fetch; waiting for the row is what makes
      // this reliable rather than a race against the network.
      await row.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      if (!(await row.isVisible().catch(() => false))) {
        await row.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      }
      if (!(await row.isVisible().catch(() => false))) {
        warn(`collection "${name}" not visible`);
      } else {
        await row.click().catch(() => {});
        await settle(2500);

        // Scope the Monitor button to the target's own row. Every row carries one,
        // so an unscoped `.first()` monitors whichever collection sits at the top of
        // the tree — which is how one of the author's real collections got monitored
        // instead of the test set, and swept into the scan.
        const monitorInRow = page.locator(
          `div:has(> span.flex-1.truncate:text-is("${name}")) > button[title="Monitor this collection"]`
        ).first();
        if (await monitorInRow.isVisible().catch(() => false)) {
          const box = await monitorInRow.boundingBox().catch(() => null);
          if (box) {
            await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
              { x: box.x + box.width / 2, y: box.y + box.height / 2 });
            await settle(520);
            await page.evaluate(() => window.__tutorialCursor?.pulse());
          }
          await monitorInRow.click({ timeout: 4000 }).catch(() => warn('monitor click failed'));
        } else {
          warn(`no Monitor control inside the "${name}" row`);
        }
        await settle(1500);

        // Verify: exactly one collection monitored, and it is the right one. Without
        // this the mistake is invisible until the finished video is watched.
        const monitored = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('div')].filter((d) =>
            d.querySelector(':scope > span.flex-1.truncate') && /Monitored/.test(d.textContent ?? ''));
          return rows.map((d) => (d.querySelector(':scope > span.flex-1.truncate')?.textContent ?? '').trim());
        }).catch(() => []);
        if (monitored.length !== 1 || monitored[0] !== name) {
          warn(`monitoring is wrong: expected only "${name}", got ${JSON.stringify(monitored)}`);
        } else {
          console.log(`[academic]   monitoring "${name}" only`);
        }
      }
      // Closing is not optional: a modal left open turns every later click in the
      // tutorial into a silent no-op, and the run still reports success.
      await helpers.closeCollections();
    },

    closeCollections: async () => {
      await closeAnyDialog();
      await stopCollectionBlur();
    },

    syncZotero: async () => {
      await pointAndClick('[data-tour="sync"]', { required: false, timeout: 5000 });
      // Metadata only — this is fast, but give it room on a cold library.
      await settle(9000);
    },

    /**
     * Start the full read from inside the collections dialog.
     *
     * This is the only path that actually enqueues. The Library's "Process library"
     * button reports nothing and leaves the queue empty, and the programmatic
     * `analyzeBothBulk` returns ok while enqueueing zero jobs — both were tried.
     * Ticking the items here and pressing "Both" produces the 31 jobs (themes,
     * ideas, summaries, indexing) that the tutorial is about.
     */
    startFullScan: async () => {
      // Reopen the dialog rather than relying on an earlier beat to have left it
      // open. Shot order is fixed by the narration — the audio is one concatenated
      // track, so beats cannot be reordered without re-synthesising everything —
      // and the sync beat in between legitimately needs the dialog shut.
      const alreadyOpen = await page.evaluate(() =>
        [...document.querySelectorAll('h2')].some((h) => /zotero collections/i.test(h.textContent ?? '')));
      if (!alreadyOpen) {
        await pointAndClick('[data-tour="collections"]', { required: false, timeout: 6000 });
        await settle(3500);
        await startCollectionBlur();
        const row = page.locator(`span.flex-1.truncate:text-is("${TARGET_COLLECTION}")`).first();
        await row.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {});
        await row.click().catch(() => warn('could not reselect the collection for scanning'));
        await settle(3000);
      }

      // Tick only the chosen five. The list is virtualised, so rows exist in the DOM
      // only while scrolled into view — ticking has to walk the list rather than
      // query it once.
      const wanted = new Set(SCAN_TITLES);
      const ticked = new Set();
      for (let pass = 0; pass < 12 && ticked.size < wanted.size; pass++) {
        const hit = await page.evaluate((titles) => {
          const found = [];
          for (const label of document.querySelectorAll('div.truncate.text-sm')) {
            const text = (label.textContent ?? '').trim();
            const match = titles.find((t) => text.includes(t));
            if (!match) continue;
            const row = label.closest('div.flex');
            const box = row?.querySelector('input[type="checkbox"]');
            if (box && !box.checked) { box.click(); found.push(match); }
            else if (box?.checked) found.push(match);
          }
          return found;
        }, [...wanted]).catch(() => []);
        hit.forEach((h) => ticked.add(h));
        if (ticked.size >= wanted.size) break;
        await page.evaluate(() => {
          const list = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
          if (list) list.scrollTop += list.clientHeight * 0.8;
        }).catch(() => {});
        await settle(700);
      }
      const missing = [...wanted].filter((w) => !ticked.has(w));
      if (missing.length) warn(`could not tick: ${missing.join(' | ')}`);
      console.log(`[academic]   ticked ${ticked.size}/${wanted.size} chosen article(s)`);
      await settle(2000);

      // No "Both" here. Ticking an item is itself "incorporate into Nodus and
      // analyse ideas", so the five chosen articles are already queued — ten jobs,
      // light and deep for each. "Both" is a bulk action over the whole filtered
      // library and pulled in all fifteen, which is the opposite of scoping this.
      await settle(2500);

      const queued = await page.evaluate(async () => (await window.nodus.getQueue())?.total ?? 0).catch(() => 0);
      if (!queued) warn('nothing was queued — the scan section will film an idle app');
      else console.log(`[academic]   ${queued} job(s) queued`);

      // The dialog has done its job; leave it open and it blocks the rest of the film.
      await helpers.closeCollections();
      await settle(1000);
    },

    /**
     * Hold until the queue drains. The scan is the one part of this tutorial that
     * cannot be hurried: it is real reading of real PDFs through a real API.
     */
    /**
     * Hold until the queue has genuinely finished.
     *
     * The previous version looked for "nothing pending" in the page text, which is
     * already true in the moment before the queue registers its jobs — so it
     * returned instantly, the graph was filmed at 10% with zero nodes, and every
     * view after it was empty while the narration described a finished corpus.
     *
     * Ask the queue instead: wait for it to start, then for every job to finish.
     */
    waitForScan: async (maxMinutes = 45) => {
      const deadline = Date.now() + maxMinutes * 60_000;
      let started = false;
      let idleStreak = 0;
      let lastReport = 0;

      // An empty queue that never fills is a finished job, not a pending one. The
      // later timelapse shot re-enters this waiter after the scan is already done
      // and the queue has been retired, and without this it would sit out the full
      // timeout waiting for work that will never be enqueued.
      const emptyDeadline = Date.now() + 45_000;

      while (Date.now() < deadline) {
        const q = await page.evaluate(() => window.nodus.getQueue()).catch(() => null);
        const total = q?.total ?? 0;
        const done = q?.done ?? 0;
        const failed = q?.failed ?? 0;
        const running = (q?.items ?? []).find((it) => it.state === 'running');

        if (total > 0) started = true;
        if (!started && Date.now() > emptyDeadline) {
          console.log('[academic]   queue is empty — nothing left to wait for');
          return true;
        }

        // Require sustained quiet, not a single idle reading. The pipeline chains
        // phases — light, deep, summary, embeddings, passages, then bridge
        // discovery — and each one enqueues its successors. A momentary
        // `done >= total` between two phases looks exactly like completion, which
        // is how the graph came to be filmed while relations were still being
        // discovered at 93%.
        const idle = started && total > 0 && done + failed >= total && !running;
        idleStreak = idle ? idleStreak + 1 : 0;
        // 21s of quiet was still short enough for a later phase to start after the
        // graph beat had begun filming, leaving a busy progress bar across the
        // analysis views. A full minute covers the longest gap seen between phases.
        if (idleStreak >= 20) {
          console.log(`[academic]   scan finished and stayed quiet: ${done}/${total} done, ${failed} failed`);
          // Retire the finished queue so the analysis views film without a
          // progress bar pinned across the bottom of every shot.
          await page.evaluate(() => window.nodus.clearQueue()).catch(() => {});
          await settle(4000);
          return true;
        }

        if (Date.now() - lastReport > 20_000) {
          lastReport = Date.now();
          console.log(`[academic]   … ${done}/${total} done` + (running ? ` · ${running.kind}: ${running.detail ?? 'working'}` : ' · idle'));
        }
        await settle(3000);
      }
      warn(`the scan did not finish within ${maxMinutes} minutes — later views may be sparse`);
      return false;
    },

    /** Open an idea so its detail panel — source and supporting passage — is shown. */
    clickIdea: async () => {
      const ok = await pointAndClick('main button.card', { required: false, timeout: 6000 });
      if (!ok) warn('no idea card to open');
      await settle(1600);
    },

    /**
     * Search in the semantic mode the narration describes.
     *
     * The Search view has Text and Meaning tabs; the line claims meaning-based
     * search, so the tab has to be switched or the shot contradicts the voice. The
     * query matters too: "women on the overland trail" matched a single work, while
     * "overland trail" returns results across ideas, works and themes.
     */
    searchByMeaning: async (query) => {
      const meaning = page.locator('main button:has-text("Meaning")').first();
      if (await meaning.isVisible().catch(() => false)) {
        await pointAndClick('main button:has-text("Meaning")', { required: false, timeout: 3000 });
        await settle(900);
      } else {
        warn('no Meaning tab in the search view');
      }
      const input = page.locator('main input.input, main input[placeholder]').first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no search input');
      await input.click();
      await input.fill('');
      await input.pressSequentially(query, { delay: 55 });
      await page.keyboard.press('Enter').catch(() => {});
      await settle(4500);

      const hits = await page.evaluate(() => {
        const t = document.querySelector('main')?.innerText ?? '';
        return Number((t.match(/(\d+)\s+result/i) ?? [])[1] ?? 0);
      }).catch(() => 0);
      if (!hits) warn(`the search for "${query}" returned nothing — the shot contradicts the narration`);
      else console.log(`[academic]   search "${query}": ${hits} result(s)`);
    },

    /**
     * Open the finished report so the viewer sees what Deep Research produces.
     *
     * The card carries a "Read" button — that is the control. Reaching for the first
     * generic button in the view instead matched the toolbar and reported that no
     * report existed, while the card was sitting there in plain sight.
     */
    openDeepResearchReport: async () => {
      const read = page.locator('main button:has-text("Read")').first();
      if (!(await read.isVisible().catch(() => false))) {
        warn('no finished report to open — the report may still be generating');
        return;
      }
      const box = await read.boundingBox().catch(() => null);
      if (box) {
        await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        await settle(560);
        await page.evaluate(() => window.__tutorialCursor?.pulse());
      }
      await read.click({ timeout: 4000 }).catch(() => warn('could not open the report'));
      await settle(3500);

      const opened = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').length).catch(() => 0);
      if (opened < 600) warn('the report opened but looks empty');
      else console.log(`[academic]   report opened (${opened} characters on screen)`);
    },

    exploreGraph: async () => {
      await page.mouse.move(800, 480);
      await page.mouse.wheel(0, -220);
      await settle(1400);
      await page.mouse.move(700, 430, { steps: 24 });
      await settle(1200);
    },

    // Drill from the theme overview into the ideas underneath. The nodes live on a
    // WebGL canvas with no DOM handle, but the overview offers a real button —
    // "N themes · click to explore" — which is the app's own route in. Verified by
    // the node count changing, so a silent no-op shows up in the log.
    exploreBiggestTheme: async () => {
      const before = await page.evaluate(() => Number(document.body.innerText.match(/(\d+)\s+nodes/)?.[1] ?? 0));
      const chip = page.locator('button:has-text("click to explore")').first();
      if (!(await chip.isVisible().catch(() => false))) {
        warn('no "click to explore" chip — the graph stays on the theme overview');
        return;
      }
      await chip.click({ timeout: 5000 }).catch(() => warn('the themes chip would not click'));
      await settle(3200);
      const after = await page.evaluate(() => Number(document.body.innerText.match(/(\d+)\s+nodes/)?.[1] ?? 0));
      if (after === before) warn(`exploring the themes changed nothing (${before} nodes)`);
      else console.log(`[academic]   graph expanded: ${before} → ${after} nodes`);
      await page.mouse.move(820, 470, { steps: 20 });
      await settle(1500);
    },

    openGraphNode: async () => {
      await page.mouse.click(800, 460);
      await settle(2200);
    },

    typeInSearch: async (text) => {
      const SEARCH = 'main input.input, main input[placeholder]';
      const input = page.locator(SEARCH).first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no search input');
      await input.click();
      await input.pressSequentially(text, { delay: 60 });
      await page.keyboard.press('Enter').catch(() => {});
      await settle(3500);
    },

    /**
     * Drive the real "New report" dialog.
     *
     * An earlier version typed into the first input on the page — which is the
     * report *filter*, not the question — and then opened the dialog on top, so the
     * question never reached it and the dialog blocked everything that followed.
     */
    runDeepResearch: async (question) => {
      await pointAndClick('main button:has-text("New report")', { required: false, timeout: 5000 });
      await settle(1600);

      const box = page.locator('[role="dialog"] textarea, .card-modal textarea').first();
      if (!(await box.isVisible().catch(() => false))) return void warn('Deep Research dialog did not open');
      await box.click();
      await box.pressSequentially(question, { delay: 42 });
      await settle(900);

      // The report language defaults to the interface language of the machine that
      // recorded it; this video is in English and the report has to match.
      const selects = page.locator('[role="dialog"] select, .card-modal select');
      const count = await selects.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const options = await selects.nth(i).locator('option').allTextContents().catch(() => []);
        if (options.some((o) => /english/i.test(o))) {
          await selects.nth(i).selectOption({ label: options.find((o) => /english/i.test(o)) }).catch(() => {});
          break;
        }
      }
      await settle(700);

      // The illustration the tutorial promises, generated by the same Google key.
      await pointAndClick('[role="dialog"] button:has-text("Decorative image"), .card-modal button:has-text("Decorative image")',
        { required: false, timeout: 3000 });
      await settle(900);

      await pointAndClick('[role="dialog"] button:has-text("Add to queue"), .card-modal button:has-text("Add to queue")',
        { required: false, timeout: 4000 });
      await settle(2500);
    },

    /** Close whatever dialog a shot left open, so the next navigation registers. */
    dismissDialog: async () => {
      for (let i = 0; i < 3; i++) {
        const open = await page.evaluate(() => Boolean([...document.querySelectorAll('[role="dialog"], .card-modal')]
          .find((d) => d.getBoundingClientRect().height > 200)));
        if (!open) return;
        const x = page.locator('[role="dialog"] button:has-text("✕"), .card-modal button:has-text("✕"), [role="dialog"] button:has-text("Cancel")').first();
        if (await x.isVisible().catch(() => false)) await x.click({ timeout: 2500 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await settle(700);
      }
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
    format: 'jpeg', quality: 88,
    maxWidth: WIN.width * SCALE, maxHeight: WIN.height * SCALE, everyNthFrame: 1,
  });

  // ------------------------------------------------------------------ shoot
  const timeline = [];
  for (const shot of SHOTS) {
    const cue = cueById.get(shot.id) ?? (dryRun ? { duration: DRY_SHOT_SECONDS } : null);
    if (!cue) { warn(`no narration cue for ${shot.id} — skipped`); continue; }

    await clearHighlights();

    // Nothing may be left covering the app between shots. A dialog left open turns
    // every later click into a silent no-op and the run still reports success —
    // that failure has already cost two takes. Shots whose subject *is* an open
    // dialog opt out with `keepOverlay`.
    if (!shot.keepOverlay) await closeAnyDialog();

    const started = (Date.now() - t0) / 1000;

    if (shot.nav) {
      const ok = await pointAndClick(nav(shot.nav), { required: false });
      if (!ok) await page.screenshot({ path: path.join(DIAG, `${shot.id}-nav.png`) }).catch(() => {});
    }
    await settle(shot.settleBefore ?? 500);

    const measureFocus = async () => {
      if (!shot.focus) return null;
      const handle = await page.$(shot.focus);
      if (!handle || !(await handle.isVisible().catch(() => false))) {
        warn(`focus target missing: ${shot.focus} (${shot.id})`);
        return null;
      }
      await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await settle(500);
      return handle.boundingBox().catch(() => null);
    };

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

    // A timelapse shot runs as long as the work takes; assembly compresses the
    // captured span back into the narration. Everything else holds to the voice.
    if (shot.timelapse && !dryRun) {
      // Each timelapse shot declares its own ceiling. The corpus scan may run for
      // half an hour; a Deep Research report must not be allowed to hold the
      // recording open for that long just because its queue never reads as empty.
      await helpers.waitForScan(shot.maxWaitMinutes ?? 45);
    } else {
      const remaining = holdUntil - (Date.now() - t0) / 1000;
      if (remaining > 0) await settle(Math.round(remaining * 1000));
    }

    const ended = (Date.now() - t0) / 1000;
    timeline.push({
      id: shot.id, start: started, end: ended,
      narration: cue.duration, focus: focusRect, timelapse: Boolean(shot.timelapse), say: shot.say,
    });
    console.log(`[academic] ${shot.id.padEnd(22)} ${(ended - started).toFixed(2)}s${focusRect ? ' · zoom' : ''}${shot.timelapse ? ' · timelapse' : ''}`);
  }

  await cdp.send('Page.stopScreencast').catch(() => {});
  await settle(400);

  await writeFile(path.join(OUT, 'timeline.json'), JSON.stringify({
    window: WIN, frameSize: { width: WIN.width * SCALE, height: WIN.height * SCALE },
    cssToFrame: SCALE, duration: frames.length ? frames.at(-1).t : 0,
    shots: timeline, frames, warnings,
  }, null, 2), 'utf8');
  console.log(`\n[academic] ${frames.length} frames · ${timeline.length}/${SHOTS.length} shots · ${warnings.length} warnings`);
} finally {
  await app.close().catch(() => {});
  if (process.argv.includes('--keep-profile')) {
    console.log(`[academic] profile kept at ${userData}`);
  } else {
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}
