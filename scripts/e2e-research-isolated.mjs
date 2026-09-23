import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const root = createResearchTestRoot();
const sandbox = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, sandbox);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const policyPath = path.join(root, 'isolation.sb');
const wrapper = path.join(root, 'electron-isolated');
fs.writeFileSync(policyPath, sandbox);
fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policyPath)} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
let app;
const report = { root, proof, completed: false, modelCalls: 0, productionFixtures: false };
try {
  // Seatbelt cannot be nested. This test uses the inherited OS profile above
  // for the entire process tree instead of Chromium's additional child profile.
  app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', repoRoot], cwd: root,
    env: researchTestEnvironment(root), timeout: 60_000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 60_000 });
  const paths = await app.evaluate(({ app }) => ({
    userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), temp: app.getPath('temp'),
    appData: app.getPath('appData'), downloads: app.getPath('downloads'),
  }));
  for (const value of Object.values(paths)) assert.ok(value.startsWith(`${root}/`));
  const windowTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  assert.equal(windowTitle, 'Nodus Research · Desarrollo');
  const audit = fs.readFileSync(path.join(root, 'profile/database-access.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(audit.length > 0);
  for (const row of audit) assert.ok(row.path.startsWith(`${root}/profile/`));
  await page.screenshot({ path: path.join(root, 'artifacts/startup.png') });
  Object.assign(report, { completed: true, paths, databaseOpens: audit.length });
} finally {
  if (app) await app.close();
  fs.writeFileSync(path.join(root, 'artifacts/startup.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
