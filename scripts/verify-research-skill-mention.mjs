import assert from 'node:assert/strict';
import path from 'node:path';

/** Deterministic UI/IPC fixture: @ in the composer invokes a skill for one turn. No model call. */
export async function verifyResearchSkillMention(page, app, root) {
  await app.evaluate(({ ipcMain }) => {
    const fixture = globalThis.__skillMentionFixture = { requests: [] };
    for (const channel of ['research:chatStream', 'chat:generateTitle']) ipcMain.removeHandler(channel);
    ipcMain.handle('chat:generateTitle', () => 'Skill mention fixture');
    ipcMain.handle('research:chatStream', (_event, _requestId, request) => {
      fixture.requests.push(request);
      return { answer: 'Synthetic answer.', stats: { sections: [], works: 0, documents: 0, summaries: 0, passages: 0, contextChars: 0, truncated: false } };
    });
  });
  const input = page.getByRole('textbox', { name: 'Pregunta al asistente...', exact: true });
  await input.fill('');
  await input.pressSequentially('Dibuja el ciclo @sv');
  const menu = page.getByTestId('research-skill-mention');
  await menu.waitFor();
  assert.equal(await input.getAttribute('aria-controls'), 'research-skill-mention', 'the composer points at its list');
  const first = menu.getByRole('option').first();
  assert.match(await first.innerText(), /SVG Studio/);
  assert.equal(await first.getAttribute('aria-selected'), 'true');
  // The list is on top of everything in the chat, the activity panel included.
  const box = await first.boundingBox();
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="research-skill-mention"]') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 }), true, 'the @ list is not covered');
  await page.screenshot({ path: path.join(root, 'artifacts', 'skill-mention-menu.png') });
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await input.inputValue(), 'Dibuja el ciclo ', 'the typed mention becomes a pill');
  const pills = page.getByTestId('research-invoked-skills');
  assert.match(await pills.innerText(), /@SVG Studio/);
  await input.pressSequentially('@zzz');
  await menu.getByText('Ninguna skill coincide.').waitFor();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('research-chat-view').count() + await page.locator('[role="dialog"][aria-label="Research chat"]').count() > 0, true, 'Escape closes only the menu');
  await input.fill('Dibuja el ciclo del agua');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="research-message-skills"]'));
  const request = await app.evaluate(() => globalThis.__skillMentionFixture.requests.at(-1));
  assert.equal(request.skillIds?.length, 1, 'the turn carries the invoked skill');
  assert.equal(await pills.count(), 0, 'pills clear once sent');
  assert.match(await page.getByTestId('research-message-skills').last().innerText(), /@SVG Studio/);
  await page.screenshot({ path: path.join(root, 'artifacts', 'skill-mention-sent.png') });
  return { passed: true, mode: 'deterministic IPC/UI fixture, no live model', skillIds: request.skillIds };
}
