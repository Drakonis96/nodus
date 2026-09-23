import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright-core';
import { researchTestEnvironment } from './research-isolation.mjs';

/** Called only after the parent harness has verified the inherited OS boundary. */
export async function verifyZoteroNodusProduct(root, endpoint, corpus, { providerProxy, externalMcpPort, baselineWorkspace, chatOnly = false, adversarial = false } = {}) {
  const require = createRequire(import.meta.url);
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const wrapper = path.join(root, 'electron-isolated');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(path.join(root, 'isolation.sb'))} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
  const app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', '--disable-gpu', baselineWorkspace ?? path.resolve(import.meta.dirname, '..')], cwd: root,
    env: { ...researchTestEnvironment(root), NODUS_ZOTERO_API_BASE: endpoint,
      ...(providerProxy ? { NODUS_RESEARCH_PROVIDER_PROXY: providerProxy } : {}) }, timeout: 60000 });
  const ownedWorkers = [];
  let external;
  let externalLog;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 60000 });
    await app.evaluate(({ utilityProcess }) => {
      globalThis.researchOwnedWorkers = [];
      const original = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const child = original(...args);
        child.once('spawn', () => globalThis.researchOwnedWorkers.push({ pid: child.pid, service: args[2]?.serviceName }));
        return child;
      };
    });
    if (providerProxy) {
      await page.evaluate(() => window.nodus.updateSettings({ chatModel: { provider: 'deepseek', model: 'deepseek-flash' },
        deepResearchModel: { provider: 'deepseek', model: 'deepseek-flash' }, synthesisModel: { provider: 'deepseek', model: 'deepseek-flash' },
        embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', chatReasoning: 'off', promptLanguage: 'es',
        autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false,
        autoResumeQueue: false, documentIndexingEnabled: false, syncMode: 'manual' }));
    }
    const imported = await page.evaluate(async ({ root, baseline }) => {
      await window.nodus.updateSettings({ autoBackupFolder: `${root}/library`, onboardingComplete: true,
        basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true,
        mascotEnabled: false, reduceMotion: true });
      const libraries = await window.nodus.listZoteroImportLibraries();
      const report = await window.nodus.importZoteroLibrary('synthetic-product-import', { libraryIds: libraries.map(library => library.id), copyAttachments: true, fullRefresh: true });
      return { libraries, report, inventory: baseline ? { documents: (await window.nodus.listGlobalLibraryItems({ limit: 500 })).items } : await window.nodus.getResearchPreparationInventory() };
    }, { root, baseline: Boolean(baselineWorkspace) });
    fs.writeFileSync(path.join(root, 'artifacts/nodus-import.json'), JSON.stringify(imported, null, 2));
    if (baselineWorkspace) {
      const { runResearchBaselineCampaign } = await import('./research-baseline-campaign.mjs');
      const live = await runResearchBaselineCampaign(page, app, root, imported.inventory.documents);
      return { passed: true, baseline: 'f54995e7', importedSources: imported.inventory.documents.length, live };
    }
    const source = imported.inventory.documents.find(document => document.origin.itemKey === corpus.items[0].key);
    assert.ok(source, 'supported Zotero import exposes the synthetic source');
    const notebook = await page.evaluate(async id => window.nodus.saveResearchNotebook({ name: 'Real isolated Zotero', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), source.id);
    const status = await page.evaluate(id => window.nodus.connectResearchZotero({ notebookId: id, mode: 'managed' }), notebook.id);
    assert.equal(status.state, 'connected');
    assert.equal(status.transport, 'stdio');
    const metadata = await page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: source.id, operation: 'metadata' });
    assert.match(JSON.stringify(metadata), /Synthetic research source 1/);
    const text = await page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: source.id, operation: 'fulltext', attachmentKey: corpus.items[0].attachment.key });
    assert.match(JSON.stringify(text), /NORTH23/);
    const other = imported.inventory.documents.find(document => document.origin.itemKey === corpus.items[1].key);
    assert.ok(other);
    await assert.rejects(page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: other.id, operation: 'metadata' }), /not_authorized/);
    await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), source.id);
    let preparation;
    const deadline = Date.now() + 150000;
    do {
      preparation = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
      if (preparation.documents.find(document => document.id === source.id)?.preparation.lexical === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    fs.writeFileSync(path.join(root, 'artifacts/nodus-preparation.json'), JSON.stringify(preparation, null, 2));
    const search = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'NORTH23'), notebook.id);
    fs.writeFileSync(path.join(root, 'artifacts/nodus-search.json'), JSON.stringify(search, null, 2));
    assert.ok(search.evidence.length);
    assert.equal(search.evidence[0].provenance, 'source');
    assert.equal(search.evidence[0].locator.pageNumber, 1);
    // The advanced server is owned by this fixture, never by Nodus. Reuse the
    // exact authorized scope while keeping its files outside the managed root.
    const managedParent = path.join(root, 'profile/mcp/zotero');
    const managedRoot = path.join(managedParent, fs.readdirSync(managedParent)[0]);
    const manifest = JSON.parse(fs.readFileSync(path.join(managedRoot, 'scope.json'), 'utf8'));
    const externalRoot = path.join(root, 'mcp/external');
    fs.mkdirSync(externalRoot);
    const externalScope = path.join(externalRoot, 'scope.json');
    fs.writeFileSync(externalScope, JSON.stringify({ ...manifest, root: externalRoot }));
    await page.evaluate(() => window.nodus.disconnectResearchZotero());
    const port = externalMcpPort;
    assert.ok(Number.isInteger(port) && port > 1023 && port !== 23119, 'external endpoint must be authorized before Electron starts');
    const runtime = path.resolve(import.meta.dirname, '../build/zotero-mcp');
    externalLog = fs.openSync(path.join(root, 'artifacts/external-mcp.log'), 'w');
    external = spawn('/usr/bin/sandbox-exec', ['-f', path.join(root, 'isolation.sb'), path.join(runtime, 'python/bin/python3'), '-I', '-B', '-c',
      'import runpy,sys; s=runpy.run_path(sys.argv[1]); s["build_server"](s["load_scope"](sys.argv[2])).run(transport="streamable-http",host="127.0.0.1",port=int(sys.argv[3]),show_banner=False)',
      path.join(runtime, 'serve.py'), externalScope, String(port)], { cwd: externalRoot,
      env: { ...researchTestEnvironment(root), HOME: externalRoot }, stdio: ['ignore', externalLog, externalLog] });
    const externalUrl = `http://127.0.0.1:${port}/mcp`;
    const readyDeadline = Date.now() + 20000;
    while (Date.now() < readyDeadline) {
      try { await fetch(externalUrl, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    const externalStatus = await page.evaluate(input => window.nodus.connectResearchZotero(input), { notebookId: notebook.id, mode: 'external', externalUrl });
    assert.equal(externalStatus.transport, 'streamable-http');
    assert.equal(externalStatus.state, 'connected');
    await page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: source.id, operation: 'metadata' });
    await page.evaluate(() => window.nodus.disconnectResearchZotero());
    assert.equal(external.exitCode, null, 'disconnect must preserve externally owned processes');
    const wider = await page.evaluate(async ids => window.nodus.saveResearchNotebook({ name: 'Different MCP scope', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), [source.id, other.id]);
    await assert.rejects(page.evaluate(input => window.nodus.connectResearchZotero(input), { notebookId: wider.id, mode: 'external', externalUrl }), /handshake_failed/);
    assert.equal(external.exitCode, null, 'rejected handshake must preserve externally owned processes');
    await page.evaluate(id => window.nodus.connectResearchZotero({ notebookId: id, mode: 'managed' }), notebook.id);
    await page.evaluate(notebook => window.nodus.saveResearchNotebook({ ...notebook, exclusions: notebook.resolvedDocumentIds }), notebook);
    await assert.rejects(page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: source.id, operation: 'metadata' }), /scope_mismatch|unavailable/);
    await page.screenshot({ path: path.join(root, 'artifacts/nodus-zotero.png') });
    let live;
    if (providerProxy) {
      const { runResearchLiveCampaign } = await import('./research-live-campaign.mjs');
      live = await runResearchLiveCampaign(page, app, root, imported.inventory.documents, { chatOnly, adversarial });
    }
    const attachmentReads = providerProxy ? undefined : await (await import('./verify-research-attachment-reads.mjs')).verifyResearchAttachmentReads(page, app, root, source.id);
    ownedWorkers.push(...await app.evaluate(() => globalThis.researchOwnedWorkers));
    for (const name of ['Nodus document extraction', 'Nodus documentary chunking', 'Nodus documentary retrieval']) {
      assert.ok(ownedWorkers.some(worker => worker.service === name && worker.pid !== app.process().pid), `${name} must run outside the main OS process`);
    }
    return { passed: true, ownedWorkers, status, importedSources: imported.inventory.documents.length, lexicalPhysicalPage: 1,
      attachmentReads,
      ...(providerProxy ? { live } : { modelCalls: 0 }), unauthorizedSourceRejected: true, manualSelectionRevokedConnection: true,
      external: { transport: externalStatus.transport, scopeMismatchRejected: true, processPreserved: true } };
  } finally {
    await app.close();
    for (const worker of ownedWorkers) {
      assert.throws(() => process.kill(worker.pid, 0), error => error.code === 'ESRCH', 'owned heavy process exited after application shutdown');
      worker.closed = true;
    }
    if (external && external.exitCode === null) {
      external.kill('SIGTERM');
      await Promise.race([new Promise(resolve => external.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (external.exitCode === null) external.kill('SIGKILL');
    }
    if (externalLog !== undefined) fs.closeSync(externalLog);
  }
}
