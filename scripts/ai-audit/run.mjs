// Arnés de auditoría de la IA contra la aplicación REAL.
//
// Cada sonda ejercita UNA ruta de IA de punta a punta —IPC, proveedor, parseo y
// persistencia— y guarda lo que devolvió. No mira el código: mira lo que pasa.
//
// Modelos fijados por el usuario: Gemini flash-lite para texto y BGE-M3 (OpenRouter) para
// embeddings. No se usa ningún otro.
//
//   GEMINI_KEY=… OPENROUTER_KEY=… node scripts/ai-audit/run.mjs [--only=id,id]
//
// Las claves NUNCA se guardan aquí: se pasan por entorno y se depositan en el perfil de
// pruebas por la propia IPC de Nodus, cifradas por la aplicación.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { _electron: electron } = require(path.join(repoRoot, 'node_modules/playwright-core/index.js'));

const USERDATA = process.env.AUDIT_USERDATA || path.join(os.homedir(), 'Library/Application Support/Nodus-IA-Audit');
const REPORT = process.env.AUDIT_REPORT || path.join(os.tmpdir(), 'nodus-ai-audit.json');
const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const GEMINI = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
const EMBEDDING = { provider: 'openrouter', model: 'baai/bge-m3' };

if (!process.argv.includes('--child')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [new URL(import.meta.url).pathname, '--child', ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const childEnv = { ...process.env, NODUS_USERDATA: USERDATA, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: require(path.join(repoRoot, 'node_modules/electron')),
  args: [repoRoot],
  env: childEnv,
});
const page = await app.firstWindow();
page.setDefaultTimeout(180_000);
await page.waitForLoadState('domcontentloaded');
await page.waitForFunction(() => !!document.getElementById('root')?.children.length);

const appVersion = require(path.join(repoRoot, 'package.json')).version;
await page.evaluate((version) => {
  localStorage.setItem('nodus.lastSeenVersion', version);
  localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
  localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
  localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
  sessionStorage.setItem('nodus.startupUpdateChecked', '1');
}, appVersion);

// ── Bóvedas de trabajo: una de testimonios con su demo y una de mundo con la suya ──
const vaults = await page.evaluate(async ({ gemini, embedding, keys }) => {
  window.__auditModel = gemini;
  window.__auditEmbedding = embedding;
  await window.nodus.setApiKey('gemini', keys.gemini);
  await window.nodus.setApiKey('openrouter', keys.openrouter);
  const existing = await window.nodus.listVaults();
  const ensure = async (name, type, seed) => {
    let vault = existing.find((item) => item.name === name);
    if (!vault) {
      const created = await window.nodus.createVault({ name, type });
      vault = created.vault;
    }
    const switched = await window.nodus.switchVault(vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true, tourComplete: true, advancedTourComplete: true,
      basicsTutorialVersion: 99, recoverySetupVersion: 99, mascotStyleChosen: true, mascotEnabled: false,
      testimonyTourComplete: true, worldTourComplete: true,
    });
    const models = Object.fromEntries([
      'defaultModel', 'chatModel', 'nodiModel', 'extractionModel', 'summaryModel', 'synthesisModel',
      'fusionModel', 'studyModel', 'tutorModel', 'improveModel', 'questionGenModel', 'gradingModel',
      'flashcardModel', 'writingModel', 'immersionModel', 'deepResearchModel', 'argumentMapModel',
      'authorModel', 'hypothesisModel', 'transcriptionModel', 'visionModel',
    ].map((key) => [key, window.__auditModel]));
    await window.nodus.updateSettings({
      ...models,
      embeddingProvider: window.__auditEmbedding.provider,
      embeddingModel: window.__auditEmbedding.model,
      modelSettingsMode: 'advanced',
    });
    if (seed) await seed();
    return vault.id;
  };

  const testimonios = await ensure('Auditoría testimonios', 'testimonios', async () => {
    const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
    if (!rows.length) await window.nodus.seedTestimonyDemoData();
  });
  const world = await ensure('Auditoría mundo', 'worldbuilding', async () => {
    const people = await window.nodus.listCharacters({}).catch(() => []);
    if (!people.length) await window.nodus.seedWorldbuildingDemoData();
  });

  // Claves y modelos: se guardan por la propia IPC, cifrados por la app.
  await window.nodus.setApiKey('gemini', keys.gemini);
  await window.nodus.setApiKey('openrouter', keys.openrouter);
  const everyModelSetting = [
    'defaultModel', 'chatModel', 'nodiModel', 'extractionModel', 'summaryModel', 'synthesisModel',
    'fusionModel', 'studyModel', 'tutorModel', 'improveModel', 'questionGenModel', 'gradingModel',
    'flashcardModel', 'writingModel', 'immersionModel', 'deepResearchModel', 'argumentMapModel',
    'authorModel', 'hypothesisModel', 'transcriptionModel', 'visionModel',
  ];
  const patch = Object.fromEntries(everyModelSetting.map((key) => [key, gemini]));
  await window.nodus.updateSettings({
    ...patch,
    embeddingProvider: embedding.provider,
    embeddingModel: embedding.model,
    modelSettingsMode: 'advanced',
  });
  return { testimonios, world, settings: await window.nodus.getSettings() };
}, { gemini: GEMINI, embedding: EMBEDDING, keys: { gemini: process.env.GEMINI_KEY, openrouter: process.env.OPENROUTER_KEY } });

console.log(`[audit] bóvedas listas: testimonios=${vaults.testimonios} mundo=${vaults.world}`);
console.log(`[audit] modelo de texto: ${vaults.settings.chatModel?.provider}/${vaults.settings.chatModel?.model}`);
console.log(`[audit] embeddings: ${vaults.settings.embeddingProvider}/${vaults.settings.embeddingModel}`);

const { PROBES: probes } = await import(new URL('./probes.mjs', import.meta.url).href);
const results = [];

async function useVault(id) {
  await page.evaluate(async (vaultId) => {
    const switched = await window.nodus.switchVault(vaultId);
    if (!switched.ok) throw new Error(switched.message);
  }, id);
  await page.waitForTimeout(300);
}

let currentVault = null;
for (const probe of probes) {
  if (ONLY.length && !ONLY.includes(probe.id)) continue;
  const vaultId = probe.vault === 'world' ? vaults.world : vaults.testimonios;
  if (vaultId !== currentVault) { await useVault(vaultId); currentVault = vaultId; }
  const started = Date.now();
  let outcome;
  try {
    outcome = await page.evaluate(probe.body, probe.args ?? null);
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const row = { id: probe.id, title: probe.title, vault: probe.vault, ms: Date.now() - started, ...outcome };
  results.push(row);
  console.log(`[audit] ${row.ok ? 'OK  ' : 'FALLA'} ${probe.id.padEnd(28)} ${row.ms}ms  ${row.ok ? (row.detail ?? '') : row.error}`);
}

fs.writeFileSync(REPORT, `${JSON.stringify({ ranAt: new Date().toISOString(), model: GEMINI, embedding: EMBEDDING, results }, null, 2)}\n`);
console.log(`[audit] ${results.filter((row) => row.ok).length}/${results.length} sondas en verde · informe: ${REPORT}`);
await app.close();
process.exit(results.every((row) => row.ok) ? 0 : 1);
