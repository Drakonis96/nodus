// Deck: MCP and Nodus Server — what they are, and how to configure each.
//
// Filmed on a copy of an already-scanned corpus so nothing is re-analysed, and
// paired against a Nodus Server running locally so the connection on screen is
// genuine rather than mimed.
//
//   node scripts/tutorial/engine/narrate.mjs --deck=mcp
//   node scripts/tutorial/decks/mcp/record.mjs
//
// Needs a local server first (see README, "Nodus Server deck").

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { record, repoRoot } from '../../engine/recorder.mjs';
import { SHOTS, nav, SERVER_URL } from './shots.mjs';

const run = promisify(execFile);

/**
 * Hide the MCP token wherever it is rendered, and keep hiding it.
 *
 * Blurring the whole element is too blunt: the token sits inside the client
 * configuration block, so the entire snippet becomes unreadable. This wraps only
 * the token's own characters, leaving the surrounding JSON legible.
 */
const TOKEN_BLUR = (token) => {
  if (!token || token.length < 8) return;
  const paint = () => {
    for (const field of document.querySelectorAll('input, textarea')) {
      if ((field.value ?? '').includes(token)) field.classList.add('nodus-blur');
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const targets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.includes(token)) continue;
      if (node.parentElement?.classList.contains('nodus-blur')) continue;
      targets.push(node);
    }
    for (const node of targets) {
      const parts = node.nodeValue.split(token);
      const fragment = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (part) fragment.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) {
          const mask = document.createElement('span');
          mask.className = 'nodus-blur';
          mask.textContent = token;
          fragment.appendChild(mask);
        }
      });
      node.parentNode?.replaceChild(fragment, node);
    }
  };
  paint();
  if (window.__nodusTokenObserver) window.__nodusTokenObserver.disconnect();
  let queued = false;
  window.__nodusTokenObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  });
  window.__nodusTokenObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
};

await record({
  name: 'mcp',
  shots: SHOTS,
  nav,
  // Reuses the corpus built for the Nodi deck: this video only needs a vault to
  // exist, not a fresh analysis.
  masterProfile: path.join(repoRoot, '.tutorial-out', 'nodi', 'profile'),
  settings: {
    theme: 'light',
    mascotEnabled: false,      // Nodi is not the subject here and would sit over the settings
    mascotStyle: 'orb',
    mascotOrbColorMode: 'auto',
  },
  helpers: (ctx) => {
    const { page, settle, warn, pointAndClick, closeAnyDialog, searchSettings } = ctx;
    // The data-testids mark inner promo boxes, NOT the sections: the real controls
    // are their siblings. Scoping to the testid finds zero checkboxes and no buttons.
    const MCP_SECTION = 'section.card:has([data-testid="mcp-settings-card"])';
    const SERVER_SECTION = 'section.card:has([data-testid="nodus-server-settings-card"])';
    const TOKEN_BLUR_SRC = `const TOKEN_BLUR = ${TOKEN_BLUR.toString()}`;

    const helpers = {
    findSetting: async (text, expect) => {
      await searchSettings(text);
      await settle(1500);
      if (expect) {
        const there = await page.locator(expect).first().isVisible().catch(() => false);
        if (!there) {
          warn(`searching "${text}" did not reveal its section`);
          await page.screenshot({ path: path.join(ctx.diagDir, `find-${text.replace(/\W+/g, '-')}.png`) }).catch(() => {});
        }
      }
    },

    enableMcp: async () => {
      const card = page.locator(MCP_SECTION);
      const box = card.locator('input[type="checkbox"]').first();
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ timeout: 5000 }).catch(() => warn('the MCP switch would not turn on'));
      }
      // The token only exists once the server is running, so wait for it before
      // anything can be blurred or shown.
      let token = '';
      for (let i = 0; i < 20 && !token; i++) {
        await settle(500);
        token = await page.evaluate(async () => (await window.nodus.getSettings())?.mcpToken ?? '').catch(() => '');
      }
      if (!token) warn('no MCP token was generated — the connection details will be empty');
      else {
        await page.evaluate(TOKEN_BLUR_SRC + `;(${'TOKEN_BLUR'})(${JSON.stringify(token)})`, undefined).catch(() => {});
        console.log('[mcp]   MCP on, token blurred');
      }
      await settle(1200);
    },

    openMcpDetails: async () => {
      const card = page.locator(MCP_SECTION);
      const buttons = card.locator('button');
      const n = await buttons.count().catch(() => 0);
      let opened = false;
      for (let i = 0; i < n && !opened; i++) {
        const label = (await buttons.nth(i).innerText().catch(() => '')).toLowerCase();
        if (/connection|conexi|details|datos/.test(label)) {
          await buttons.nth(i).click({ timeout: 4000 }).catch(() => {});
          opened = true;
        }
      }
      if (!opened) warn('no "connection details" button found on the MCP card');
      await settle(2000);
      if (!(await page.locator('[role="dialog"], .modal').first().isVisible().catch(() => false))) {
        warn('the MCP connection dialog did not open');
      }
    },

    mcpTab: async (name) => {
      const tab = page.locator(`[role="dialog"] button, .modal button`).filter({ hasText: new RegExp(`^${name}$`, 'i') }).first();
      if (!(await tab.isVisible().catch(() => false))) return void warn(`no "${name}" tab in the connection dialog`);
      await tab.click({ timeout: 4000 }).catch(() => warn(`the "${name}" tab would not click`));
      await settle(1600);
    },

    closeMcpDetails: async () => {
      await closeAnyDialog();
      await settle(1200);
    },

    typeServerUrl: async () => {
      const input = page.locator('input[placeholder^="https://nodus"]').first();
      if (!(await input.isVisible().catch(() => false))) return void await ctx.diagnose('server-url-missing');
      await input.click();
      await input.fill('');
      await input.pressSequentially(SERVER_URL, { delay: 45 });
      await settle(900);
    },

    typePairCode: async () => {
      // A real code from the local server, so the pairing that follows is genuine.
      let code = '';
      try {
        const { stdout } = await run('node', [path.join(repoRoot, 'scripts/tutorial/probes/server-pair-code.mjs'), SERVER_URL]);
        code = stdout.trim().split('\n').pop() ?? '';
      } catch (e) {
        warn(`could not get a pairing code: ${e.message.split('\n')[0]}`);
      }
      if (!/^[A-Z0-9-]{6,}$/.test(code)) return void warn(`pairing code looks wrong: "${code}"`);
      const input = page.locator('input[placeholder="ABCD-EFGH"]').first();
      if (!(await input.isVisible().catch(() => false))) return void await ctx.diagnose('pair-code-missing');
      await input.click();
      await input.fill('');
      await input.pressSequentially(code, { delay: 90 });
      await settle(900);
      console.log(`[mcp]   pairing code ${code}`);
    },

    connectServer: async () => {
      const card = page.locator(SERVER_SECTION);
      const buttons = card.locator('button');
      const n = await buttons.count().catch(() => 0);
      let clicked = false;
      for (let i = 0; i < n && !clicked; i++) {
        const label = (await buttons.nth(i).innerText().catch(() => '')).toLowerCase();
        if (/^connect vault$|^conectar vault$/.test(label.trim())) {
          await buttons.nth(i).click({ timeout: 5000 }).catch(() => {});
          clicked = true;
        }
      }
      if (!clicked) await ctx.diagnose('connect-button-missing');
      await settle(6000);
      const connected = await page.evaluate(async () => {
        const o = await window.nodus.getNodusServerOverview?.();
        return (o?.connections ?? []).length;
      }).catch(() => 0);
      if (!connected) warn('the vault did not pair — the list will be empty');
      else console.log(`[mcp]   paired: ${connected} connection(s)`);
    },

    showServerToggles: async () => {
      const card = page.locator(SERVER_SECTION);
      await card.locator('input[type="checkbox"]').last().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await settle(1400);
    },

    publishNow: async () => {
      const card = page.locator(SERVER_SECTION);
      const buttons = card.locator('button');
      const n = await buttons.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const label = (await buttons.nth(i).innerText().catch(() => '')).toLowerCase();
        if (/publish now|publicar ahora/.test(label)) {
          await buttons.nth(i).click({ timeout: 4000 }).catch(() => {});
          await settle(2500);
          return;
        }
      }
      warn('no "publish now" button found');
    },
    };
    return helpers;
  },
});
