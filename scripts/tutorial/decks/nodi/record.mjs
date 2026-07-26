// Deck: Meet Nodi — the companion, its settings, its menu, and how to dismiss it.
//
// Filmed on a copy of an already-scanned corpus, so nothing is re-analysed. The
// chat answers are SCRIPTED, not generated: a tutorial must show the same thing
// every time it is watched, and a live model will not. They are stubbed at the IPC
// layer so the panel still streams and renders exactly as in normal use.
//
//   node scripts/tutorial/engine/narrate.mjs --deck=nodi
//   node scripts/tutorial/decks/nodi/record.mjs

import path from 'node:path';
import { record, repoRoot } from '../../engine/recorder.mjs';
import { SHOTS, nav, SCRIPTED } from './shots.mjs';

await record({
  name: 'nodi',
  shots: SHOTS,
  nav,
  masterProfile: path.join(repoRoot, '.tutorial-out', 'nodi', 'profile'),
  settings: {
    theme: 'light',
    mascotEnabled: true,
    // Start on the classic Nodi so that picking the orb is a real change on screen.
    mascotStyle: 'classic',
    mascotOrbColorMode: 'auto',
  },
  helpers: (ctx) => {
    const { page, app, settle, warn, pointAndClick, searchSettings } = ctx;
    const helpers = {
    findNodiSettings: async () => {
      await searchSettings('Nodi');
      await settle(1200);
    },

    openStylePicker: async () => {
      // In settings the two Nodis are an inline picker, not a modal: both cards
      // are already on screen, so this only brings them into view.
      const grid = page.locator('.nodi-style-grid').first();
      if (!(await grid.isVisible().catch(() => false))) return void warn('no style picker on screen');
      await grid.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await settle(1200);
    },

    pickOrb: async () => {
      const orb = page.locator('.nodi-style-option').nth(1);
      await orb.click({ timeout: 5000 }).catch(() => warn('the orb card would not click'));
      await settle(1800);
      const style = await page.evaluate(async () => (await window.nodus.getSettings())?.mascotStyle);
      if (style !== 'orb') warn(`style did not switch to orb (got ${style})`);
    },

    setColourMode: async (mode) => {
      const select = page.locator('select:has(option[value="manual"])').first();
      await select.selectOption(mode, { timeout: 4000 }).catch(async () => {
        await page.evaluate((m) => window.nodus.updateSettings({ mascotOrbColorMode: m }), mode).catch(() => {});
        warn(`colour mode set through settings, not the control (${mode})`);
      });
      await settle(1500);
    },

    cycleColours: async () => {
      const swatches = page.locator('[data-testid="nodi-orb-palette"] button');
      const n = await swatches.count().catch(() => 0);
      if (!n) return void warn('no colour swatches on screen');
      for (const i of [2, 5, 1].filter((i) => i < n)) {
        await pointAndClick(`[data-testid="nodi-orb-palette"] button >> nth=${i}`, { required: false });
        await settle(1400);
      }
      const colour = await page.evaluate(async () => (await window.nodus.getSettings())?.mascotOrbColor);
      console.log(`[nodi]   orb colour now ${colour}`);
    },

    clearGraphSearch: async () => {
      await page.evaluate(() => {
        const box = [...document.querySelectorAll('input')].find((i) => /graph/i.test(i.placeholder ?? ''));
        if (box && box.value) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(box, '');
          box.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }).catch(() => {});
      await settle(600);
    },

    openRadial: async () => {
      // The buttons are in the DOM whether the menu is open or shut — closed, they
      // sit stacked under the orb and only fly out with `.open`. Counting them was
      // why the menu never opened and every later click landed on the orb itself.
      const open = () => page.locator('.nodi-node.open').count().catch(() => 0);
      if ((await open()) > 0) return;
      await pointAndClick('.nodi-figure', { required: false });
      await settle(1600);
      if (!(await open())) warn('the radial menu did not open');
    },

    openRadialItem: async (action) => {
      // Help draws a speech bubble and the rest draw panels; closing whatever is
      // open first is what keeps the menu clickable for the next beat.
      const closer = page.locator('.nodi-bubble-x, .nodi-panel-head button').last();
      if (await closer.isVisible().catch(() => false)) {
        await closer.click({ timeout: 3000 }).catch(() => {});
        await settle(1000);
      }
      await helpers.openRadial();
      await pointAndClick(`.nodi-node[data-nodi-action="${action}"]`, { required: false });
      await settle(1800);
    },

    openContexts: async () => {
      await pointAndClick('.nodi-context-button', { required: false });
      await settle(1400);
      const vault = page.locator('.nodi-context-grid label').nth(2).locator('input');
      await vault.check({ timeout: 4000 }).catch(() => warn('could not tick the vault context'));
      await settle(1200);
      if (!(await vault.isChecked().catch(() => false))) warn('the vault context is not selected');
      await pointAndClick('.nodi-context-button', { required: false });
      await settle(900);
    },

    askNodi: async (question, key) => {
      // The reply is scripted, not generated. A tutorial has to show the same
      // thing every time, and the streaming path is stubbed rather than the DOM
      // patched so the panel renders exactly as it does in normal use.
      const answer = SCRIPTED[key];
      if (!answer) return void warn(`no scripted answer for ${key}`);
      // Stubbed in the main process, not the renderer: `window.nodus` comes from
      // the context bridge and silently refuses reassignment, so patching it there
      // left the real model answering — and being billed for it. Replacing the IPC
      // handler keeps the whole renderer path genuine while the words are fixed.
      await app.evaluate(({ ipcMain }, text) => {
        globalThis.__nodiScripted = text;
        if (globalThis.__nodiStubbed) return;
        globalThis.__nodiStubbed = true;
        ipcMain.removeHandler('nodi:chatStream');
        ipcMain.handle('nodi:chatStream', async (event, requestId) => {
          const reply = globalThis.__nodiScripted ?? '';
          for (const chunk of reply.match(/\S+\s*/g) ?? [reply]) {
            event.sender.send('nodi:chatStream:delta', requestId, chunk);
            await new Promise((r) => setTimeout(r, 13));
          }
          return reply;
        });
      }, answer);
      const input = page.locator('textarea.nodi-chat-input').first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no chat input on screen');
      await input.click().catch(() => {});
      await input.pressSequentially(question, { delay: 18 });
      await settle(700);
      await page.keyboard.press('Enter').catch(() => {});
      // Streaming is word-paced, so wait on words rather than characters.
      await settle((answer.split(/\s+/).length * 13) + 1400);
      const shown = await page.evaluate(() => (document.querySelector('.nodi-chat-panel')?.innerText ?? '').length);
      if (shown < 200) warn(`the ${key} answer did not render (${shown} chars)`);
    },

    rightClickNodi: async () => {
      const closer = page.locator('.nodi-panel-head button').last();
      if (await closer.isVisible().catch(() => false)) {
        await closer.click({ timeout: 3000 }).catch(() => {});
        await settle(1000);
      }
      // The figure comes and goes while panels open and close, so wait for it
      // rather than assuming it is wherever the last beat left it.
      const figure = page.locator('.nodi-figure').first();
      await figure.waitFor({ state: 'visible', timeout: 8000 }).catch(() => warn('Nodi is not on screen to right-click'));
      const box = await figure.boundingBox().catch(() => null);
      if (box) {
        await page.evaluate(({ x, y }) => window.__tutorialCursor?.moveTo(x, y),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        await settle(600);
      }
      await figure.click({ button: 'right', timeout: 5000 }).catch(() => warn('right click did not land'));
      await settle(1600);
      if (!(await page.locator('.nodi-context-menu').isVisible().catch(() => false))) warn('no context menu appeared');
    },

    closeNodi: async () => {
      await pointAndClick('.nodi-context-menu button', { required: false });
      // Closing plays an animation before the figure leaves the DOM, so poll for
      // its absence rather than assuming a fixed wait covers it.
      let gone = false;
      for (let i = 0; i < 12 && !gone; i++) {
        await settle(500);
        gone = await page.evaluate(() => !document.querySelector('.nodi-figure')).catch(() => false);
      }
      if (!gone) warn('Nodi is still on screen after closing');
      else console.log('[nodi]   Nodi closed');
    },
    };
    return helpers;
  },
});
