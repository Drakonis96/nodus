// Acceptance test for "a citation lands on the exact point it was anchored to".
//
// It runs against a COPY of a real profile (`NODUS_E2E_PROFILE`) because this bug
// is only visible with real data: evidence locations carry physical page numbers,
// works resolve against a real library, and the study vault has real materials.
// Nothing here writes outside that copy.
//
//   NODUS_E2E_PROFILE=/path/to/profile-copy \
//   NODUS_E2E_PDF=/path/to/multipage.pdf \
//   NODUS_E2E_PPTX=/path/to/deck.pptx \
//   node scripts/e2e-citation-page-jump.mjs
//
// The Zotero cases run last on purpose: the first `zotero://` open launches Zotero
// when it is closed, and a running Zotero changes what the handler can resolve.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const profile = process.env.NODUS_E2E_PROFILE;
if (!profile) {
  console.error('NODUS_E2E_PROFILE must point at a copy of a Nodus profile.');
  process.exit(2);
}
const pdfFixture = process.env.NODUS_E2E_PDF || '';
const pptxFixture = process.env.NODUS_E2E_PPTX || '';

const passed = [];
const failed = [];
const skipped = [];
async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`  FAIL ${name}\n       ${error?.message ?? error}`);
  }
}
/** The viewer sets its page once the PDF document resolves, so poll instead of racing it. */
async function waitForNumberInput(page, selector, expected, timeout = 30_000) {
  const handle = await page.waitForFunction(({ selector: target, expected: wanted }) => {
    const input = document.querySelector(target);
    return input instanceof HTMLInputElement && Number(input.value) === wanted ? input.value : false;
  }, { selector, expected }, { timeout });
  await handle.dispose();
}

function skip(name, why) {
  skipped.push(`${name} (${why})`);
  console.log(`  skip ${name}: ${why}`);
}
function summary() {
  console.log(`\n${passed.length} checks passed, ${failed.length} failed, ${skipped.length} skipped`);
  if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);
  if (failed.length) {
    console.log(`failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

const vaultsFile = () => path.join(profile, 'vaults.json');
const readVaults = () => JSON.parse(fs.readFileSync(vaultsFile(), 'utf8'));
function activeVault() {
  const data = readVaults();
  return data.vaults.find((vault) => vault.id === data.activeVaultId) ?? data.vaults[0];
}
function setActiveVault(id) {
  const data = readVaults();
  data.activeVaultId = id;
  fs.writeFileSync(vaultsFile(), JSON.stringify(data, null, 2));
}
function sqlite(dbPath, sql) {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();
}

const childEnv = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

async function launch() {
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.waitForTimeout(3500);
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.count()) {
    const button = updateModal.getByRole('button').first();
    if (await button.count()) await button.click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
  return { app, page, pageErrors };
}

/** A saved Research Chat answer that cites a real passage and a real work. */
function seedResearchConversation(dbPath, { conversationId, passageId, workId, ideaId, title }) {
  const now = new Date().toISOString();
  const content = `El pasaje citado [Fontcuberta, 2016](nodus://passage/${passageId}), la idea [álbum fotográfico](nodus://idea/${ideaId}) y la obra [Fotografía pauperista](nodus://work/${workId}) sostienen la lectura.`;
  const script = `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("delete from chat_messages where conversation_id=?", (${JSON.stringify(conversationId)},))
con.execute("delete from chat_conversations where id=?", (${JSON.stringify(conversationId)},))
con.execute("insert into chat_conversations (id, title, created_at, updated_at, archived) values (?,?,?,?,0)",
            (${JSON.stringify(conversationId)}, ${JSON.stringify(title)}, ${JSON.stringify(now)}, ${JSON.stringify(now)}))
con.execute("insert into chat_messages (id, conversation_id, seq, role, content, error, created_at) values (?,?,0,'assistant',?,0,?)",
            (${JSON.stringify(`${conversationId}:m1`)}, ${JSON.stringify(conversationId)}, ${JSON.stringify(content)}, ${JSON.stringify(now)}))
con.commit(); con.close()
`;
  execFileSync('python3', ['-c', script, dbPath], { stdio: 'inherit' });
}

/** A saved study-chat answer whose citation chip points at a material page. */
function seedStudyCitation(storePath, citation) {
  const store = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : { version: 1, conversations: [] };
  const now = new Date().toISOString();
  const conversation = {
    id: 'e2e-study-citation',
    title: 'E2E study citation',
    createdAt: now,
    updatedAt: now,
    archived: false,
    selection: { scope: 'library', courseId: null, subjectId: null, topicId: null, sourceKeys: [] },
    model: null,
    messageCount: 1,
    task: 'answer',
    level: 'standard',
    tone: 'clear',
    language: 'auto',
    allowExternalKnowledge: false,
    messages: [{
      id: 'e2e-study-citation:m1',
      role: 'assistant',
      content: `El material lo explica aquí [material](nodus://study/evidence/${citation.id}).`,
      createdAt: now,
      citations: [citation],
    }],
  };
  store.conversations = [conversation, ...(store.conversations ?? []).filter((entry) => entry.id !== conversation.id)];
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

async function reloadApp(page, { chatNav }) {
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.waitForTimeout(3000);
  await page.locator(`[data-tour="nav-${chatNav}"]`).first().click();
  await page.waitForTimeout(2000);
}

/** Open one saved conversation in whichever research-chat surface is on screen. */
async function openConversation(page, title) {
  const sidebar = page.getByTestId('research-history-sidebar');
  if (!(await sidebar.isVisible().catch(() => false))) {
    await page.getByTestId('research-history-toggle').first().click();
    await page.waitForTimeout(1500);
  }
  await sidebar.waitFor({ state: 'visible', timeout: 20_000 });
  const row = sidebar.locator('.research-history-row').filter({ hasText: title }).first();
  await row.waitFor({ state: 'attached', timeout: 20_000 });
  await row.scrollIntoViewIfNeeded();
  await row.click({ force: true });
  await page.waitForTimeout(3000);
}

/** Open the citation modal from a citation of the given kind. */
async function openCitationModal(page, kind) {
  const citation = page.locator(`.citation-link[data-citation-kind="${kind}"]`).first();
  await citation.waitFor({ state: 'visible', timeout: 20_000 });
  await citation.click();
  await page.getByTestId('source-citation-modal').waitFor({ state: 'visible', timeout: 20_000 });
}

/**
 * The academic vault this run needs: one whose corpus really has page-anchored
 * passages and a work with deep analysis. The suite must choose it rather than
 * trust whatever was left active, or a second consecutive run starts in the study
 * vault and finds nothing.
 */
function pickAcademicVault() {
  const data = readVaults();
  for (const vault of data.vaults) {
    if (vault.type === 'estudio' || vault.type === 'study') continue;
    if (!fs.existsSync(vault.path)) continue;
    try {
      if (sqlite(vault.path, 'select count(*) from passages where page_label is not null;') !== '0'
        && sqlite(vault.path, "select count(*) from works where deep_status='done';") !== '0') return vault;
    } catch {
      // A vault that cannot be opened is not a candidate.
    }
  }
  throw new Error('no academic vault in this profile has page-anchored passages');
}

async function main() {
  const originalActive = activeVault().id;
  const academicVault = pickAcademicVault();
  setActiveVault(academicVault.id);
  console.log(`Phase 1: academic vault "${academicVault.name}"`);
  const { app, page, pageErrors } = await launch();

  const candidates = await page.evaluate(async () => {
    const listed = await window.nodus.listGlobalLibraryItems({ limit: 200, offset: 0 });
    const out = [];
    for (const item of listed.items ?? []) {
      const reader = await window.nodus.getLibraryReaderDocument(item.id);
      if (reader?.originalAvailable && reader.originalMimeType === 'application/pdf'
        && reader.sections.some((section) => typeof section.page === 'number')) {
        out.push({ id: item.id, title: reader.title, pages: reader.sections.map((section) => section.page).filter((value) => typeof value === 'number') });
      }
    }
    return out;
  });
  if (!candidates.length) throw new Error('this profile has no page-capable library copy to jump into');
  const doc = candidates[0];
  const targetPage = Math.max(...doc.pages.slice(0, 40));

  await check('library copy is page-capable (PDF original plus sections carrying pages)', async () => {
    assert.ok(doc.pages.length > 0, 'the reader kept physical pages in its sections');
    assert.ok(targetPage > 1, `the fixture document spans more than one page (max ${targetPage})`);
  });

  await check('a locator with a page resolves to the in-app reader when Zotero has no PDF', async () => {
    const result = await page.evaluate((id) => window.nodus.openEvidenceAtPage(id, { location: 'p. 2', sourceRef: null, pageNumber: 2 }), doc.id);
    assert.equal(result.page, 2, 'the page survives the round trip');
    assert.ok(['local', 'pdf-page'].includes(result.mode), `expected a page destination, got ${result.mode}`);
    if (result.mode === 'local') {
      assert.equal(result.ok, false);
      assert.equal(result.local?.itemId, doc.id);
      assert.equal(result.local?.scope, 'global');
    }
  });

  await check('an unknown work reports mode "none" instead of throwing', async () => {
    const result = await page.evaluate(() => window.nodus.openEvidenceAtPage('00000000-0000-4000-8000-000000000000', { location: 'p. 4', sourceRef: null, pageNumber: 4 }));
    assert.equal(result.mode, 'none');
    assert.equal(result.page, 4);
  });

  await check('a locator without a page keeps the old "select the item" behaviour', async () => {
    const result = await page.evaluate(() => window.nodus.openEvidenceAtPage('00000000-0000-4000-8000-000000000000', null));
    assert.equal(result.page, null);
    assert.equal(result.mode, 'none');
  });

  await check('a citation jump opens the in-app reader on the cited page', async () => {
    await page.evaluate(({ id, pageNumber }) => {
      window.dispatchEvent(new CustomEvent('nodus:open-library-document', { detail: { itemId: id, scope: 'global', page: pageNumber } }));
    }, { id: doc.id, pageNumber: targetPage });
    const preview = page.getByTestId('library-original-preview');
    await preview.waitFor({ state: 'visible', timeout: 30_000 });
    const shown = await preview.locator('canvas').getAttribute('data-page');
    assert.equal(Number(shown), targetPage, `the preview shows page ${targetPage}`);
  });

  await check('the cited page is one-shot: leaving and re-entering the reader does not jump again', async () => {
    const preview = page.getByTestId('library-original-preview');
    await preview.getByRole('button', { name: /close|cerrar/i }).first().click().catch(async () => { await page.keyboard.press('Escape'); });
    await preview.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
    const readerTab = page.locator(`[data-testid="library-workspace-tab-document-${doc.id}"]`);
    await readerTab.first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('[data-testid="library-workspace-tab-library"]').first().click();
    await page.waitForTimeout(1200);
    await readerTab.first().click();
    await page.waitForTimeout(2500);
    assert.equal(await page.getByTestId('library-original-preview').count(), 0, 'no page jump on re-entry');
  });

  await check('a vault library target with a reader item opens that work in the reader', async () => {
    const workId = sqlite(academicVault.path, "select nodus_id from works where deep_status='done' limit 1;");
    await page.reload();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
    await page.waitForTimeout(3000);
    await page.evaluate(({ id }) => {
      window.dispatchEvent(new CustomEvent('nodus:open-library-document', { detail: { itemId: id, scope: 'vault', page: 3 } }));
    }, { id: workId });
    // This profile keeps no reader document for its vault works, so the reader
    // says so instead of silently staying on the list.
    const opened = page.locator('[data-testid="library-reader-empty-card"]').first();
    await opened.waitFor({ state: 'visible', timeout: 30_000 });
  });

  // The reported surface: a Research Chat citation, whose modal used to show the
  // page as inert text.
  const dbPath = academicVault.path;
  const passage = sqlite(dbPath, "select passage_id, page_label from passages where page_label is not null and length(text) > 200 limit 1;").split('|');
  const workId = sqlite(dbPath, "select nodus_id from works where deep_status='done' limit 1;");
  const idea = sqlite(dbPath, "select e.global_id, e.page_number from evidence e join ideas i on i.global_id=e.global_id where e.page_number is not null order by e.global_id limit 1;").split('|');
  const conversationTitle = 'E2E citation jump';
  seedResearchConversation(dbPath, { conversationId: 'e2e-citation-jump', passageId: passage[0], workId, ideaId: idea[0], title: conversationTitle });

  const closeModal = async () => {
    const modal = page.getByTestId('source-citation-modal');
    if (await modal.count()) await page.getByTestId('source-citation-close').click().catch(() => undefined);
    await page.waitForTimeout(800);
  };

  await check('the citation modal exposes the exact page of the cited passage', async () => {
    await reloadApp(page, { chatNav: 'researchChat' });
    await openConversation(page, conversationTitle);
    await openCitationModal(page, 'passage');
    const jump = page.getByTestId('source-citation-jump-passage');
    await jump.waitFor({ state: 'visible', timeout: 20_000 });
    const label = (await jump.textContent())?.trim() ?? '';
    const citedPage = Number((label.match(/[\d]+/) ?? [])[0]);
    assert.equal(citedPage, Number((passage[1].match(/\d+/) ?? [])[0]), `the jump names the passage page (${label})`);
    await closeModal();
  });

  await check('an anchored evidence row offers exactly the page the corpus stored', async () => {
    await reloadApp(page, { chatNav: 'researchChat' });
    await openConversation(page, conversationTitle);
    await openCitationModal(page, 'idea');
    // The evidence rows are the only place a page can come from, so the button
    // must name the stored physical page — not a guess from free text.
    const stored = await page.evaluate(async (ideaId) => {
      const detail = await window.nodus.getIdeaDetail(ideaId);
      const withPage = (detail?.evidence ?? []).find((entry) => typeof entry.page_number === 'number' && entry.page_number !== null);
      return withPage ? { id: withPage.id, page: withPage.page_number } : null;
    }, idea[0]);
    assert.ok(stored, 'the cited idea has an anchored page in the corpus');
    const jump = page.getByTestId(`source-citation-jump-${stored.id}`);
    await jump.waitFor({ state: 'visible', timeout: 25_000 });
    const label = (await jump.textContent())?.trim() ?? '';
    assert.equal(Number((label.match(/\d+/) ?? [])[0]), Number(stored.page), `the row names page ${stored.page} (${label})`);
    await closeModal();
  });

  await check('the work panel names the citation without inventing a page', async () => {
    await reloadApp(page, { chatNav: 'researchChat' });
    await openConversation(page, conversationTitle);
    await openCitationModal(page, 'work');
    await page.getByTestId('source-citation-work').waitFor({ state: 'visible', timeout: 25_000 });
    assert.equal(await page.locator('[data-testid^="source-citation-jump-"]').count(), 0, 'a work citation with no anchored page offers no page jump');
    await closeModal();
  });

  await check('no renderer errors during the citation flow', async () => {
    assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.message).join(' | '));
  });

  // The Zotero branches hand a URL to the operating system: with Zotero closed
  // the first call launches it, and a running Zotero changes what can resolve.
  // Opt in explicitly, and run them after every local case.
  // A stored source_ref carries the Zotero attachment key the extractor already
  // resolved, so the page branch is exercised without depending on Zotero's HTTP
  // API answering: only the hand-off to the desktop app happens.
  const zoteroSource = sqlite(academicVault.path, "select s.nodus_id, s.source_ref from work_text_sources s join works w on w.nodus_id=s.nodus_id where s.attachment_key is not null and w.deep_status='done' limit 1;").split('|');
  const zoteroWork = zoteroSource[0] ?? '';
  const zoteroPage = zoteroWork ? sqlite(academicVault.path, `select page_number from evidence where nodus_id='${zoteroWork}' and page_number is not null limit 1;`) : '';
  if (process.env.NODUS_E2E_ALLOW_ZOTERO_OPEN === '1' && zoteroWork && zoteroPage) {
    await check('a locator without a page selects the item in Zotero', async () => {
      const result = await page.evaluate((id) => window.nodus.openEvidenceAtPage(id, null), zoteroWork);
      assert.equal(result.mode, 'select');
      assert.equal(result.page, null);
    });
    await check('a locator with a page opens Zotero on that page', async () => {
      const result = await page.evaluate(({ id, sourceRef, pageNumber }) => window.nodus.openEvidenceAtPage(id, { location: `p. ${pageNumber}`, sourceRef, pageNumber }), { id: zoteroWork, sourceRef: zoteroSource[1], pageNumber: Number(zoteroPage) });
      assert.equal(result.mode, 'pdf-page');
      assert.equal(result.page, Number(zoteroPage));
    });
  } else {
    skip('the Zotero branches open the item / the exact page', 'set NODUS_E2E_ALLOW_ZOTERO_OPEN=1 to run them');
  }

  await app.close();

  // ── Phase 2: study vault ───────────────────────────────────────────────────
  const vaults = readVaults();
  const studyVault = vaults.vaults.find((vault) => vault.type === 'estudio' || vault.type === 'study') ?? null;
  if (!studyVault || !pdfFixture || !pptxFixture) {
    const why = !studyVault ? 'this profile has no study vault' : 'NODUS_E2E_PDF / NODUS_E2E_PPTX not provided';
    skip('a study material citation opens the PDF on its page', why);
    skip('a study material citation opens the presentation on its slide', why);
    setActiveVault(originalActive);
    summary();
    return;
  }

  console.log(`\nPhase 2: study vault "${studyVault.name}"`);
  setActiveVault(studyVault.id);
  const second = await launch();
  const studyPage = second.page;

  const imported = await studyPage.evaluate(async ({ pdf, pptx }) => {
    const results = await window.nodus.importStudyMaterialPaths([pdf, pptx], {});
    return results.map((result) => ({
      id: result.material.id,
      title: result.material.title,
      kind: result.material.previewKind,
      pages: result.material.pageCount ?? null,
      slides: result.material.metadata?.slideCount ?? null,
    }));
  }, { pdf: pdfFixture, pptx: pptxFixture });
  const pdfMaterial = imported.find((entry) => entry.kind === 'pdf') ?? null;
  const deckMaterial = imported.find((entry) => entry.kind === 'presentation') ?? null;

  const storePath = path.join(path.dirname(studyVault.path), 'study-chat-history.json');
  const citationFor = (material, pageNumber, slideNumber) => ({
    id: `e2e-cite-${pageNumber ?? slideNumber}`,
    sourceKey: `material:${material.id}`,
    indexId: `e2e-index-${material.id}`,
    kind: 'material',
    sourceId: material.id,
    title: material.title,
    subtitle: '',
    quote: 'Cita de prueba para el salto a la página exacta.',
    location: {
      materialId: material.id,
      pageNumber: pageNumber ?? null,
      slideNumber: slideNumber ?? null,
      timestampSeconds: null,
    },
    scope: { courseId: null, subjectId: null, folderId: null, topicId: null },
  });

  if (pdfMaterial) {
    const citedPage = Math.min(4, pdfMaterial.pages ?? 4);
    seedStudyCitation(storePath, citationFor(pdfMaterial, citedPage, null));
    await check('a study material citation opens the PDF on its page', async () => {
      await reloadApp(studyPage, { chatNav: 'studyChat' });
      await openConversation(studyPage, 'E2E study citation');
      await studyPage.locator('.suggestion-chip').first().click();
      const viewer = studyPage.getByTestId('study-material-viewer');
      await viewer.waitFor({ state: 'visible', timeout: 30_000 });
      const input = viewer.locator('input[type="number"]').first();
      await input.waitFor({ state: 'visible', timeout: 30_000 });
      await waitForNumberInput(studyPage, '[data-testid="study-material-viewer"] input[type="number"]', citedPage);
      assert.equal(Number(await input.inputValue()), citedPage, `the viewer is on page ${citedPage}`);
    });
  } else {
    skip('a study material citation opens the PDF on its page', 'the PDF fixture was not imported as a PDF');
  }

  if (deckMaterial) {
    const citedSlide = Math.min(3, deckMaterial.slides ?? 3);
    seedStudyCitation(storePath, citationFor(deckMaterial, null, citedSlide));
    await check('a study material citation opens the presentation on its slide', async () => {
      await reloadApp(studyPage, { chatNav: 'studyChat' });
      await openConversation(studyPage, 'E2E study citation');
      await studyPage.locator('.suggestion-chip').first().click();
      const viewer = studyPage.getByTestId('study-material-viewer');
      await viewer.waitFor({ state: 'visible', timeout: 30_000 });
      await studyPage.waitForTimeout(1500);
      const shown = await viewer.innerText();
      assert.match(shown, new RegExp(`(Diapositiva|Slide)\\s+${citedSlide}\\b`, 'i'), `the viewer is on slide ${citedSlide}`);
    });
  } else {
    skip('a study material citation opens the presentation on its slide', 'the deck fixture was not imported as a presentation');
  }

  await second.app.close();
  setActiveVault(originalActive);
  summary();
}

await main();
