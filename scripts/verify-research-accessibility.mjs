/** Automated accessibility audit (axe-core, WCAG 2.0/2.1 A and AA) of the
 * Research surfaces in real Electron, light and dark. This is not a
 * screen-reader test with a person; it finds machine-detectable defects only. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createResearchApp, writeSyntheticPdfs, addPdfItems } from './lib/research-app-harness.mjs';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const strict = process.argv.includes('--strict');
const harness = await createResearchApp();
const report = { root: harness.root, proof: harness.proof, axe: require('axe-core/package.json').version, surfaces: [], completed: false };
const RESEARCH = /research|notebook|preparation|queue/i;
async function audit(page, surface, theme, selector) {
  await page.evaluate(source => { if (!window.axe) (0, eval)(source); }, axeSource);
  const result = await page.evaluate(async selector => {
    const context = !selector ? document : selector.startsWith('closest:') ? document.querySelector(selector.slice(8))?.closest('dialog, [role="dialog"]') : document.querySelector(selector);
    if (!context) return { missing: true };
    const run = await window.axe.run(context, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return { violations: run.violations.map(violation => ({ id: violation.id, impact: violation.impact, help: violation.help,
      nodes: violation.nodes.map(node => ({ target: node.target.join(' '), html: node.html.slice(0, 200), summary: node.failureSummary?.slice(0, 300) })) })) };
  }, selector);
  report.surfaces.push({ surface, theme, selector: selector ?? 'document', ...result });
  return result;
}
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page, { chatModel: { provider: 'deepseek', model: 'deepseek-flash' } });
  const ids = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 2, pages: 2, prefix: 'A11Y' }));
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Accessibility notebook', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);
  await page.evaluate(version => { localStorage.setItem('nodus.lastSeenVersion', version); for (const key of ['nodus.mobileTeaserSeen.5.3.1', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1'); },
    JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')).version);
  // Deterministic activity events (as in verify-research-activity-ui): no model call.
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['research:chatStream', 'research:chatStream:cancel', 'chat:generateTitle']) ipcMain.removeHandler(channel);
    ipcMain.handle('chat:generateTitle', () => 'Accessibility fixture');
    ipcMain.handle('research:chatStream', (event, requestId) => new Promise(resolve => {
      globalThis.__a11yPending = resolve;
      for (const [id, layer, operation, status] of [['scope', 'scope', 'resolve', 'completed'], ['nodus', 'nodus', 'search', 'active'], ['zotero', 'zotero', 'fulltext', 'active']])
        event.sender.send('research:chatStream:activity', requestId, { id, layer, operation, status, subject: 'Synthetic source', startedAt: Date.now(), ...(status !== 'active' ? { finishedAt: Date.now(), count: 2 } : {}) });
    }));
    ipcMain.handle('research:chatStream:cancel', () => globalThis.__a11yPending?.({ answer: '', aborted: true, stats: { sections: [], works: 0, documents: 0, summaries: 0, passages: 0, contextChars: 0, truncated: false } }));
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    await page.reload();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
    await page.getByRole('button', { name: 'Research chat', exact: true }).first().click({ timeout: 20000 });
    // Notebooks live at the top of the chat history.
    await page.locator('.research-assistant-header').waitFor({ timeout: 30000 });
    if (await page.getByTestId('research-history-toggle').count() && !(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
    const search = page.getByTestId('research-chat-search');
    await search.waitFor({ timeout: 15000 }).catch(async error => { await page.screenshot({ path: path.join(harness.root, `artifacts/a11y-${theme}-no-control.png`) }); throw error; });
    await search.fill(notebook.name);
    await page.getByTestId(`research-search-notebook-${notebook.id}`).click();
    await page.getByTestId('research-notebook-home').waitFor();
    await audit(page, 'research-chat', theme, null);
    await page.getByTestId('research-notebook-title').getByRole('button', { name: /Editar colecciones|Edit collections/ }).click();
    const editor = page.getByRole('dialog').filter({ has: page.locator('#research-notebook-title') });
    await editor.waitFor();
    await audit(page, 'notebook-editor', theme, 'closest:#research-notebook-title');
    await page.keyboard.press('Escape');
    const input = page.getByRole('textbox', { name: 'Pregunta al asistente...', exact: true });
    await input.fill('Accessibility activity fixture');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByTestId('research-activity').locator('li[data-layer="zotero"]').waitFor();
    await audit(page, 'research-activity', theme, '[data-testid="research-activity"]');
    await app.evaluate(() => globalThis.__a11yPending?.({ answer: '', aborted: true, stats: { sections: [], works: 0, documents: 0, summaries: 0, passages: 0, contextChars: 0, truncated: false } }));
    const queue = page.locator('[data-queue-trigger]').first();
    if (await queue.count()) {
      await queue.click();
      await page.waitForTimeout(500);
      await audit(page, 'queue-panel', theme, '[data-testid="queue-panel"], [role="dialog"]');
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nodus:research-preparation', { detail: {} })));
    const welcome = page.getByTestId('research-preparation-welcome');
    await welcome.waitFor();
    await page.waitForTimeout(800);
    await audit(page, 'preparation-welcome', theme, '[data-testid="research-preparation-welcome"]');
    await welcome.getByRole('button', { name: 'No', exact: true }).click();
    await page.waitForTimeout(400);
    await audit(page, 'preparation-decline-confirmation', theme, '[data-testid="research-preparation-welcome"]');
    await page.keyboard.press('Escape');
  }
  const findings = report.surfaces.flatMap(surface => (surface.violations ?? []).map(violation => ({ surface: surface.surface, theme: surface.theme, ...violation })));
  report.summary = {
    research: findings.filter(finding => finding.surface !== 'research-chat' || finding.nodes.some(node => RESEARCH.test(node.target + node.html))).map(finding => ({ surface: finding.surface, theme: finding.theme, id: finding.id, impact: finding.impact, nodes: finding.nodes.length })),
    elsewhereInChatView: findings.filter(finding => finding.surface === 'research-chat' && !finding.nodes.some(node => RESEARCH.test(node.target + node.html))).map(finding => ({ theme: finding.theme, id: finding.id, impact: finding.impact, nodes: finding.nodes.length })),
  };
  report.completed = true;
  if (strict && report.summary.research.some(finding => ['serious', 'critical'].includes(finding.impact))) process.exitCode = 1;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/accessibility.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, summary: report.summary }));
}
