// Spike: can we capture the real Electron window as a high-resolution frame
// stream via CDP, and does a fresh profile land on the onboarding wizard?
//
// Throwaway diagnostic for the tutorial-video pipeline. Answers three questions:
//   1. Does Page.startScreencast work against an Electron window under Playwright?
//   2. What resolution do the frames actually come back at?
//   3. What does the very first screen of a zero-state profile look like?
//
//   node scripts/tutorial/spike-screencast.mjs

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const OUT = path.join(repoRoot, '.tutorial-out', 'spike');
await mkdir(OUT, { recursive: true });

// Minimal Zotero stand-in so the onboarding's "verify connection" step succeeds
// without touching the developer's real library.
const zotero = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Last-Modified-Version', '7');
  if (pathname.endsWith('/groups')) return void res.end('[]');
  if (pathname.endsWith('/collections')) return void res.end('[]');
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

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-spike-'));
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_ZOTERO_API_BASE: zoteroApiBase,
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    win.setContentSize(1600, 1000);
    win.center();
  });
  await page.waitForTimeout(500);

  const cdp = await app.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (frame) => {
    frames.push({ ts: frame.metadata.timestamp, bytes: Buffer.from(frame.data, 'base64') });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch {
      /* stream already stopped */
    }
  });

  // Ask for far more pixels than the CSS viewport: on a Retina compositor this is
  // what decides whether we get a master big enough to crop into for pan/zoom.
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 3200, maxHeight: 2000, everyNthFrame: 1 });

  // Give the UI something to animate so we can tell motion is really captured.
  await page.waitForTimeout(2500);
  await page.mouse.move(400, 300, { steps: 30 });
  await page.mouse.move(1200, 700, { steps: 30 });
  await page.waitForTimeout(2500);

  await cdp.send('Page.stopScreencast');

  const first = frames[0];
  await writeFile(path.join(OUT, 'frame-000.jpg'), first?.bytes ?? Buffer.alloc(0));
  await writeFile(path.join(OUT, 'frame-last.jpg'), frames.at(-1)?.bytes ?? Buffer.alloc(0));
  await page.screenshot({ path: path.join(OUT, 'first-screen.png') });

  const span = frames.length > 1 ? frames.at(-1).ts - frames[0].ts : 0;
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 700));
  const report = {
    frameCount: frames.length,
    spanSeconds: Number(span.toFixed(2)),
    fps: span > 0 ? Number((frames.length / span).toFixed(1)) : 0,
    firstFrameBytes: first?.bytes.length ?? 0,
    userData,
    firstScreenText: bodyText,
  };
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close().catch(() => {});
  await new Promise((r) => zotero.close(r));
}
