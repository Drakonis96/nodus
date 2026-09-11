import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { ChatSkill } from '@shared/chatSkills';
import { listChatSkills, profilePredatesSkillLibrary, replaceChatSkills } from '../chatSkills';
import { migrationBaseline } from './migrationBaselines';
import { pluginMigrationScripts, readPluginStateV2, recordPluginDataVersion, resolveTrustedCapability, listInstalledPluginsV2 } from './pluginStoreV2';
import { rebuildCapabilityRegistry } from './registry';
import { acquireCapabilityWorker } from './workerHost';
import { createCapabilityHostServices } from './hostServices';
import { createCapabilityAdapters } from './runner';
import { installCatalogPlugin } from './marketplaceV2';
import { runCapabilityMigration, pinnedPluginSkill, type MigrationOutcome } from './migration';

/** Binds the migration to the application: where the library lives, what 5.3.1 said, what
 *  each package now says, and which files the built-ins left behind for it to adopt. */

const profileFile = (...segments: string[]) => path.join(app.getPath('userData'), ...segments);

const readJson = (file: string): unknown => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
};

/** What each built-in left in the profile. The package decides what to do with it; the
 *  application only hands it over, and never reads a credential out of it itself. */
function legacyData(pluginId: string): unknown {
  if (pluginId === 'chemistry-studio') {
    const log = profileFile('chemistry-outcomes.jsonl');
    try {
      const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(-500);
      return { chemistryOutcomes: lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) };
    } catch { return { chemistryOutcomes: [] }; }
  }
  if (pluginId === 'legalize') {
    const dir = profileFile('legalize-indexes');
    try {
      return {
        legalizeIndexes: fs.readdirSync(dir)
          .filter(name => name.endsWith('.json'))
          .map(name => ({ country: name.slice(0, -5), index: readJson(path.join(dir, name)) })),
      };
    } catch { return { legalizeIndexes: [] }; }
  }
  if (pluginId === 'alphagenome') {
    // The key is read here, decrypted once, and handed straight to the package's own
    // migration so it can re-encrypt it in the secret store. It is never written back to
    // disk in the clear, never logged and never put in the journal.
    try {
      const file = profileFile('genomics', 'credentials.bin');
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return { genomics: null };
      const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as { apiKey?: string; terms?: string };
      // The accepted-terms string is handed over as it was recorded. Whether it still
      // counts as consent is the package's judgement, not the application's: only the
      // package knows which terms document its own version asks people to accept.
      return { genomics: { apiKey: stored.apiKey, termsVersion: stored.terms } };
    } catch { return { genomics: null }; }
  }
  return {};
}

/** Runs the package's own declared migrations inside its worker, and records how far
 *  they actually got.
 *
 *  The version the profile is at is written here, from what the worker reports finished —
 *  not from what it was asked to do. A package whose second migration fails ends the run
 *  at version 1, keeps everything version 1 gave it, and is retried from there; nothing
 *  rolls the data back, because each rung is written to be re-runnable. */
async function migrateData(pluginId: string, legacy: unknown): Promise<void> {
  const state = readPluginStateV2(pluginId);
  if (!state?.active) throw new Error(`${pluginId} is not active.`);
  const scripts = pluginMigrationScripts(pluginId);
  // A package with nothing to migrate is already at its own data version.
  if (state.dataVersion >= scripts.length) { recordPluginDataVersion(pluginId, scripts.length); return; }

  const provider = [...rebuildCapabilityRegistry().providers.values()].find(entry => entry.plugin?.id === pluginId);
  if (!provider) throw new Error(`${pluginId} registered no capability.`);
  const runtime = resolveTrustedCapability(provider.id, { version: state.active.version, digest: state.active.digest });
  if (!runtime) throw new Error(`${pluginId} could not be resolved.`);
  const services = createCapabilityHostServices(createCapabilityAdapters({
    locale: 'en',
    pins: { revision: 0, pins: new Map([[provider.id, { version: state.active.version, digest: state.active.digest }]]) },
    runCoreStages: async answer => answer,
  }));
  const handle = acquireCapabilityWorker(runtime, { services });
  const result = await handle.call('migrate', {
    fromDataVersion: state.dataVersion,
    toDataVersion: scripts.length,
    legacy,
    scripts,
  }, { timeoutMs: 300_000 }) as { dataVersion?: number; notes?: string; failed?: string };

  const reached = Number.isInteger(result?.dataVersion) ? Math.min(Number(result!.dataVersion), scripts.length) : state.dataVersion;
  if (reached > state.dataVersion) recordPluginDataVersion(pluginId, reached);
  if (result?.notes) console.info(`[capabilities] ${pluginId}: ${result.notes}`);
  if (result?.failed) throw new Error(result.failed);
  if (reached < scripts.length) throw new Error(`${pluginId} stopped at data version ${reached} of ${scripts.length}.`);
}

export async function migrateCapabilitiesForThisProfile(): Promise<MigrationOutcome> {
  return runCapabilityMigration({
    readSkills: () => listChatSkills(),
    writeSkills: (skills: ChatSkill[]) => { replaceChatSkills(skills); },
    baseline: migrationBaseline,
    packaged: pinnedPluginSkill,
    legacyData,
    migrateData,
    preLibraryProfile: profilePredatesSkillLibrary(),
    installer: { online: pluginId => installCatalogPlugin(pluginId, { approvePermissions: true }) },
  });
}

export const migrationInstalledPlugins = () => listInstalledPluginsV2().map(state => state.id);
