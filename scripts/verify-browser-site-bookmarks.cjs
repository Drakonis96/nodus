// Focused runtime verification for the bridge between the real public site and
// local Nodus Bookmarks. Run after `npm run build` so the production preload is
// the exact artifact exercised here.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BaseWindow, WebContentsView } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const siteRoot = path.join(repoRoot, 'site');
const preload = path.join(repoRoot, 'dist-electron', 'preload.browserPage.cjs');
let window;
let view;

const mime = (file) => ({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}[path.extname(file)] ?? 'application/octet-stream');

async function main() {
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-site-bookmarks-'));
app.setPath('userData', profile);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const requested = path.resolve(siteRoot, relative.endsWith('/') ? `${relative}index.html` : relative);
    if (requested !== siteRoot && !requested.startsWith(`${siteRoot}${path.sep}`)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(requested);
    response.writeHead(200, { 'Content-Type': mime(requested), 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const pageUrl = `http://127.0.0.1:${address.port}/index.html`;

try {
  await app.whenReady();
  window = new BaseWindow({ show: false, width: 1440, height: 900 });
  view = new WebContentsView({
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1440, height: 900 });

  let openRequests = 0;
  view.webContents.ipc.on('nodus-browser:page:openBookmarks', (event) => {
    assert.equal(event.sender, view.webContents);
    assert.equal(event.senderFrame, view.webContents.mainFrame);
    openRequests += 1;
  });

  await view.webContents.loadURL(pageUrl);
  const entry = await view.webContents.executeJavaScript(`(() => {
    const link = document.querySelector('[data-nodus-browser-bookmarks]');
    const rect = link?.getBoundingClientRect();
    return {
      hidden: link?.hasAttribute('hidden'),
      text: link?.textContent,
      nodus: typeof window.nodus,
      ipc: typeof window.ipcRenderer,
      rect: rect ? { width: rect.width, height: rect.height } : null,
    };
  })()`, true);

  assert.equal(entry.hidden, false, 'Nodus Browser must reveal the prepared Bookmarks slot');
  assert.equal(entry.text, 'Bookmarks');
  assert.equal(entry.nodus, 'undefined', 'the public site must receive no Nodus bridge');
  assert.equal(entry.ipc, 'undefined', 'the public site must receive no ipcRenderer');
  assert.ok(entry.rect?.width > 0 && entry.rect?.height > 0, 'the revealed entry must be visible and clickable');

  await view.webContents.executeJavaScript(
    "document.querySelector('[data-nodus-browser-bookmarks]').click()",
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(openRequests, 0, 'a synthetic click from site JavaScript must be ignored');
  console.log('[verify-browser-site-bookmarks] passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
}

main().then(() => {
  if (window && !window.isDestroyed()) window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(1);
});
