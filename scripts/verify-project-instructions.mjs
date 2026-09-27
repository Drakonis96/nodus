// Real Electron UI + IPC verification in a disposable, OS-isolated profile.
// Default is offline; opt into bounded paid calls with an existing campaign ledger.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, simulatedUpstream, repoRoot } from './lib/research-app-harness.mjs';

const out = path.join(repoRoot, 'artifacts/project-instructions');
fs.mkdirSync(out, { recursive: true });
const campaign = process.env.NODUS_PROJECT_PROMPTS_LIVE_CAMPAIGN;
const calls = [];
const report = { live: !!campaign, calls, surfaces: [] };
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
const simulated = simulatedUpstream((_provider, body) => {
  const system = body.messages?.find(message => message.role === 'system')?.content ?? '';
  const token = system.match(/PROJECT_(RESEARCH|DATABASE|WORLD|STUDY)/)?.[0] ?? 'GENERAL';
  const content = `${token}: Synthetic answer. CHAT_END`;
  if (body.stream) return { text: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n` };
  return { json: { choices: [{ message: { content, role: 'assistant' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
});
async function dispatch(url, init) {
  assert.ok(calls.length < 12, 'at most twelve requests in this smoke');
  const body = JSON.parse(Buffer.from(init.body).toString('utf8'));
  assert.equal(body.model, 'deepseek-flash', 'only the requested text model; no embeddings needed');
  const entry = { number: calls.length + 1, startedAt: new Date().toISOString(), model: body.model, request: body };
  calls.push(entry); save();
  const response = campaign ? await fetch(url, init) : await simulated.dispatch(url, init);
  const text = await response.text();
  entry.status = response.status;
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    for (const line of text.split('\n')) if (line.startsWith('data: ')) try { const chunk = JSON.parse(line.slice(6)); if (chunk.usage) parsed = chunk; } catch { /* SSE sentinel */ }
  }
  entry.usage = parsed?.usage;
  // Keep the proxy's conservative peak/cache-miss cost; provider usage is retained for settlement.
  if (entry.usage) entry.costUpperBoundUsd = (entry.usage.prompt_tokens * .3 + entry.usage.completion_tokens * 1.2) / 1e6;
  fs.writeFileSync(path.join(out, `call-${entry.number}.json`), JSON.stringify({ ...entry, response: text }, null, 2));
  save();
  return new Response(text, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' } });
}
const h = await createResearchApp(campaign ? { realProvider: { campaignRoot: campaign, dispatch } } : { provider: { dispatch } });
report.profile = h.root; report.isolation = h.proof;
let page;
try {
  if (campaign) await h.importCredentials(process.env.NODUS_PROJECT_PROMPTS_CREDENTIALS ?? campaign);
  ({ page } = await h.launch());
  await h.prepareProfile(page);
  if (!campaign) await h.simulatedKeys(page);
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  for (const [surface, type] of [['research', 'academic'], ['database', 'databases'], ['world', 'worldbuilding'], ['study', 'estudio']]) {
    const item = { surface, checks: [] }; report.surfaces.push(item);
    const token = `PROJECT_${surface.toUpperCase()}`;
    const seed = await page.evaluate(async ({ surface, type, model }) => {
      const n = window.nodus;
      if (surface !== 'research') { const { vault } = await n.createVault({ name: `Synthetic ${surface}`, type }); await n.switchVault(vault.id); }
      await n.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true,
        studyTourComplete: true, worldTourComplete: true, databasesTourComplete: true, uiLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true,
        chatModel: model, synthesisModel: model, studyModel: model, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', researchWebSearch: 'off' });
      const project = surface === 'research' ? await n.createChatProject({ name: `Synthetic ${surface}` }) : await n.createChatHistoryProject(surface, { name: `Synthetic ${surface}` });
      const custom = await n.saveResearchSystemPrompt({ name: 'Conversation style', instructions: 'Termina la respuesta con CHAT_END.' });
      return { project, custom };
    }, { surface, type, model });
    await page.evaluate(version => {
      localStorage.setItem('nodus.lastSeenVersion', version);
      for (const key of ['nodus.mobileTeaserSeen.3.2.4','nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
    }, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'))).version);
    await page.reload();
    await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
    await page.locator('.research-assistant-header').waitFor();
    if (!(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
    const row = page.getByTestId(`research-project-${seed.project.id}`);
    await row.getByRole('button', { name: `Abrir ${seed.project.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Instrucciones del proyecto', exact: true }).click();
    const dialog = page.getByTestId('project-instructions-dialog');
    await dialog.getByRole('textbox').fill(`Empieza siempre tu respuesta con ${token}: y responde en menos de 40 palabras. Contexto del proyecto: estamos aprendiendo metodología científica.`);
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const read = () => page.evaluate(async ({ surface, id }) => (surface === 'research' ? await window.nodus.listChatProjects() : await window.nodus.listChatHistoryProjects(surface)).find(project => project.id === id), { surface, id: seed.project.id });
    assert.match((await read()).instructions, new RegExp(token));
    item.checks.push('UI save through IPC');
    // Menu entry, cancellation and keyboard dismissal preserve the stored value.
    await row.getByRole('button', { name: 'Más acciones', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Instrucciones del proyecto', exact: true }).click();
    assert.match(await dialog.getByRole('textbox').inputValue(), new RegExp(token));
    await dialog.getByRole('textbox').fill('Unsaved draft'); await page.keyboard.press('Escape');
    assert.match((await read()).instructions, new RegExp(token)); item.checks.push('menu, reopen, cancel');
    await page.getByRole('button', { name: 'Instrucciones del proyecto', exact: true }).click();
    const savedInstructions = await dialog.getByRole('textbox').inputValue();
    await dialog.getByRole('textbox').fill('');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await read()).instructions, '');
    await page.getByRole('button', { name: 'Instrucciones del proyecto', exact: true }).click();
    await dialog.getByRole('textbox').fill(savedInstructions);
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    item.checks.push('clear and restore through UI');
    await page.getByRole('button', { name: 'Instrucciones del proyecto', exact: true }).click();
    await page.screenshot({ path: path.join(out, `${surface}-editor.png`) });
    if (surface === 'study') {
      await h.app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(800, 600); window.setContentSize(800, 800); });
      await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en', theme: 'light' }));
      await dialog.getByRole('button', { name: 'Save', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('textbox').getAttribute('maxlength'), '12000');
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.width <= await page.evaluate(() => innerWidth), 'editor fits narrow window');
      await page.screenshot({ path: path.join(out, 'study-editor-light-800-en.png') });
      await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'es', theme: 'dark' }));
      item.checks.push('English, light theme, 800px window');
    }
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    if (surface === 'research') {
      await h.closeApp(); ({ page } = await h.launch());
      assert.match((await read()).instructions, new RegExp(token)); item.checks.push('full Electron restart');
    }
    const first = calls.length;
    const response = await page.evaluate(async ({ surface, project, custom, model }) => {
      const n = window.nodus; const question = 'Explica brevemente qué es una hipótesis.';
      const selection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} };
      let chat, result;
      const shared = { model, thinkingEffort: 'standard', systemPromptId: custom.id };
      if (surface === 'research') {
        chat = await n.createConversation({ title: 'Synthetic project chat', projectId: project.id, model, selection });
        result = await n.researchChatStream({ ...shared, conversationId: chat.id, selection, messages: [{ role: 'user', content: question }] }, {});
      } else if (surface === 'database') {
        const database = await n.createDatabase('Synthetic observations');
        const column = await n.createDatabaseColumn(database.id, 'Observation', 'title');
        const row = await n.createDatabaseRow(database.id); await n.setDatabaseCell(row.id, column.id, 'A hypothesis is a testable explanation.');
        chat = await n.createDatabaseChatConversation({ title: 'Synthetic project chat', projectId: project.id, databaseIds: [database.id] });
        result = await n.dbChatStream({ ...shared, conversationId: chat.id, databaseIds: [database.id], question, history: [] }, {});
      } else if (surface === 'world') {
        const article = await n.createWorldArticle({ title: 'Hypothesis', body: 'In this synthetic world, a hypothesis is a testable explanation.' });
        chat = await n.createWorldChatConversation({ title: 'Synthetic project chat', projectId: project.id, model, selection: { scope: 'manual', entryKeys: [`article:${article.articleId}`], keepFocus: false } });
        result = await n.worldChatStream({ ...shared, conversationId: chat.id, question, focusKeys: [`article:${article.articleId}`], history: [] }, {});
      } else {
        chat = await n.createStudyAssistantConversation({ title: 'Synthetic project chat', projectId: project.id });
        result = await n.streamStudyAssistant({ ...shared, conversationId: chat.id, messages: [{ id: 'u', role: 'user', content: question, createdAt: new Date().toISOString() }], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true }, {});
      }
      return { chat, result };
    }, { surface, project: seed.project, custom: seed.custom, model });
    item.response = response;
    const answer = response.result.answer ?? response.result.text;
    assert.ok(answer.includes(token), `model follows ${surface} project instructions`);
    assert.ok(answer.includes('CHAT_END'), 'conversation prompt composes with project instructions');
    assert.ok(calls.slice(first).some(call => call.request.messages.some(message => message.role === 'system' && message.content.includes(token) && message.content.includes('CHAT_END'))));
    item.checks.push('actual engine composes project + conversation prompt'); item.passed = true; save();
    console.log(`${surface}: UI, persistence and ${campaign ? 'paid' : 'simulated'} generation passed`);
  }
  report.passed = true;
} catch (error) {
  report.error = String(error.stack); console.error(error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  await h.close();
  report.costUpperBoundUsd = campaign ? calls.reduce((sum, call) => sum + (call.costUpperBoundUsd ?? 0), 0) : 0;
  if (campaign) fs.copyFileSync(path.join(campaign, 'artifacts/cost-ledger.json'), path.join(out, 'campaign-cost-ledger.json'));
  save();
}
