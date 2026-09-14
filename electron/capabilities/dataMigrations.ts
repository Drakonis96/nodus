import { listInstalledPluginsV2, pluginMigrationScripts, readPluginStateV2, readStagedPackage, recordPluginDataVersion, resolveTrustedCapability, activePluginRoot } from './pluginStoreV2';
import { createCapabilityHostServices, type CapabilityServiceAdapters } from './hostServices';
import { acquireCapabilityWorker } from './workerHost';

/** Running the migrations a package declares, and recording how far they got.
 *
 *  Kept apart from the profile migration on purpose. This is the piece a fresh install
 *  needs too — a package is not announced until its data version matches what it
 *  declares — so it must not depend on the registry, which is exactly what has not
 *  happened yet. It resolves the worker from the installed package instead.
 *
 *  The version written is the one the worker reports finished, never the one it was asked
 *  for. A package whose second migration fails ends at version 1, keeps everything version
 *  1 gave it, and is retried from there; nothing is rolled back, because each rung is
 *  written to be re-runnable. */

/** Migrations run in the worker of the package's first declared capability. A package
 *  ships one process per capability and its data is the package's, not any one
 *  capability's, so the choice has to be fixed somewhere rather than depend on which
 *  worker happened to be running. */
function migrationRuntime(pluginId: string) {
  const state = readPluginStateV2(pluginId);
  if (!state?.active) throw new Error(`${pluginId} is not active.`);
  const root = activePluginRoot(pluginId);
  if (!root) throw new Error(`${pluginId} has no installed version.`);
  const staged = readStagedPackage(root, state.active.digest, state.active.target);
  const first = staged.capabilities[0];
  if (!first) throw new Error(`${pluginId} provides no capability.`);
  const runtime = resolveTrustedCapability(first.manifest.provides, { version: state.active.version, digest: state.active.digest });
  if (!runtime) throw new Error(`${pluginId} could not be resolved.`);
  return { state, runtime };
}

export async function runPluginDataMigrations(
  pluginId: string,
  legacy: unknown = {},
  adapters: CapabilityServiceAdapters = {},
): Promise<{ dataVersion: number; notes?: string }> {
  const scripts = pluginMigrationScripts(pluginId);
  const { state, runtime } = migrationRuntime(pluginId);

  // A package with nothing left to climb is already where it says it is.
  if (state.dataVersion >= scripts.length) {
    recordPluginDataVersion(pluginId, scripts.length);
    return { dataVersion: scripts.length };
  }

  const handle = acquireCapabilityWorker(runtime, { services: createCapabilityHostServices(adapters) });
  const result = await handle.call('migrate', {
    fromDataVersion: state.dataVersion,
    toDataVersion: scripts.length,
    legacy,
    scripts,
  }, { timeoutMs: 300_000 }) as { dataVersion?: number; notes?: string; failed?: string };

  const reached = Number.isInteger(result?.dataVersion) ? Math.min(Number(result!.dataVersion), scripts.length) : state.dataVersion;
  if (reached > state.dataVersion) recordPluginDataVersion(pluginId, reached);
  if (result?.failed) throw new Error(result.failed);
  if (reached < scripts.length) throw new Error(`${pluginId} stopped at data version ${reached} of ${scripts.length}.`);
  return { dataVersion: reached, ...(result?.notes ? { notes: result.notes } : {}) };
}

/** Finishes any package whose data was left behind.
 *
 *  A package is installed, then its migrations run, then it is announced. A crash between
 *  the first two leaves it installed, unannounced, and with nothing that would start it
 *  again — the profile migration knows only about the three disciplines, and an install
 *  happens once. So every launch settles what is outstanding, which for a profile with
 *  nothing outstanding costs one manifest read per installed package. */
export async function settleInstalledPluginMigrations(adapters: CapabilityServiceAdapters = {}): Promise<string[]> {
  const settled: string[] = [];
  for (const state of listInstalledPluginsV2()) {
    if (!state.active) continue;
    try {
      if (state.dataVersion >= pluginMigrationScripts(state.id).length) continue;
      await runPluginDataMigrations(state.id, {}, adapters);
      settled.push(state.id);
    } catch (error) {
      console.warn(`[capabilities] ${state.id} could not finish its data migration:`, error);
    }
  }
  return settled;
}
