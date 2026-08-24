import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('the opt-in is queued once after release notes and the startup update check', async () => {
  const [app, modal] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/DocumentUnderstandingConsentModal.tsx'),
  ]);
  assert.match(app, /updateSettled && !documentUnderstandingConsentSettled && !manualWhatsNewOpen/);
  assert.match(app, /<DocumentUnderstandingConsentModal[\s\S]*setDocumentUnderstandingConsentSettled\(true\)/);
  assert.match(app, /documentUnderstandingConsentSettled && !manualWhatsNewOpen[\s\S]*<NodiStyleModal/);
  assert.match(modal, /nodus\.documentUnderstandingConsent\.2026-08/);
  assert.match(modal, /localStorage\.setItem\(DOCUMENT_UNDERSTANDING_CONSENT_KEY, '1'\)/);
});

test('acceptance starts the current vault campaign and optionally enables future works', async () => {
  const modal = await read('src/components/DocumentUnderstandingConsentModal.tsx');
  assert.match(modal, /updateSettings\(\{ documentIndexingEnabled: accept && automatic \}\)/);
  assert.match(modal, /if \(accept\) await window\.nodus\.startDocumentIndexCampaign\(\{ includeArchived: false \}\)/);
  assert.match(modal, /finish\(false\)/);
  assert.match(modal, /finish\(true\)/);
  assert.ok(
    modal.indexOf('startDocumentIndexCampaign') < modal.indexOf('updateSettings'),
    'the one-off campaign starts before continuous discovery, so accepting automatic mode cannot create a duplicate 0/0 campaign',
  );
});

test('the consent is academic-only and its campaign has a global progress/control bar', async () => {
  const [app, bar, api, ipc, main, rootIpc, exportImport] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/DocumentIndexProgressBar.tsx'),
    read('shared/api/academic.ts'),
    read('electron/ipc/academic.ts'),
    read('electron/main.ts'),
    read('electron/ipc.ts'),
    read('electron/export/exportImport.ts'),
  ]);
  assert.match(app, /!manualWhatsNewOpen && isAcademic/);
  assert.match(app, /activeVault\.remote\.role !== 'reader'/);
  assert.match(app, /<DocumentIndexProgressBar \/>/);
  assert.match(bar, /onDocumentIndexProgress/);
  assert.match(bar, /document-index-progress-percent/);
  assert.match(bar, /role="progressbar"/);
  assert.match(bar, /aria-valuenow=\{pct\}/);
  assert.match(bar, /aria-live="polite"/);
  assert.match(bar, /applyStatus\('paused'\)/);
  assert.match(bar, /applyStatus\('running'\)/);
  assert.match(bar, /applyStatus\('cancelled'\)/);
  assert.match(api, /setDocumentIndexCampaignStatus\(vaultId: string, campaignId: string/);
  assert.match(ipc, /documentIndexQueue\.setCampaignStatus\(vaultId, campaignId, status\)/);
  assert.match(main, /documentIndexQueue\.stop\(\);[\s\S]*closeDb\(\)/, 'shutdown aborts document workers before closing their database');
  assert.match(main, /before-quit-for-update[\s\S]*documentIndexQueue\.stop\(\);[\s\S]*closeDb\(\)/, 'application updates use the same safe shutdown ordering');
  assert.match(rootIpc, /await documentIndexQueue\.pauseVaultAndDrain\(id\)[\s\S]*resetVaultDatabase/, 'vault reset drains document workers before replacing SQLite');
  assert.match(exportImport, /pausedVaultIds = await pauseAllDocumentIndexingAndDrain\(\)[\s\S]*finally[\s\S]*resumeAllDocumentIndexingAfterMaintenance/, 'backup restore drains every vault and always releases maintenance');
});

test('the complete consent copy exists in all seven non-Spanish language tables', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-consent-'));
  try {
    const outfile = path.join(tmp, 'translations.mjs');
    await build({
      entryPoints: [path.join(repoRoot, 'src/i18n.documentUnderstandingConsent.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });
    const { DOCUMENT_UNDERSTANDING_CONSENT_TRANSLATIONS: translations } = await import(pathToFileURL(outfile).href);
    for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
      const entries = Object.entries(translations[language] ?? {});
      assert.equal(entries.length, 13, `${language} must translate the complete consent modal`);
      assert.ok(entries.every(([, value]) => typeof value === 'string' && value.trim().length > 3), `${language} contains no blank copy`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('every locale registers the consent translation table', async () => {
  const files = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  for (const language of files) {
    const source = await read(`src/i18n.${language}.ts`);
    assert.match(source, /DOCUMENT_UNDERSTANDING_CONSENT_TRANSLATIONS/, `${language} does not import the modal translations`);
  }
});
