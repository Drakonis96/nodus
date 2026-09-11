import { BrowserWindow } from 'electron';
import { validateSettingsSubmission, validateSettingsState } from '../../packages/capability-api/src/settings';
import { validateViewDocument } from '../../packages/capability-api/src/views';
import { capabilityRegistry, onCapabilityRegistryChanged, rebuildCapabilityRegistry, type CapabilityProvider } from '../capabilities/registry';
import { approvePendingPluginV2, listInstalledPluginsV2, removePluginV2, resolveTrustedCapability, rollbackPluginV2 } from '../capabilities/pluginStoreV2';
import { acquireCapabilityWorker, stopCapabilityWorkers } from '../capabilities/workerHost';
import { createCapabilityHostServices } from '../capabilities/hostServices';
import { writeCapabilitySecret } from '../capabilities/hostServices';
import { createCapabilityAdapters } from '../capabilities/runner';
import { artifactSidecar, readCapabilityArtifact } from '../capabilities/artifactStore';
import { fetchCapabilityCatalog, installCatalogPlugin, readCachedCatalog } from '../capabilities/marketplaceV2';
import { pinCapabilitiesForTurn } from '../capabilities/registry';
import type { IpcContext } from './context';

/** One generic surface for every capability, whatever discipline it happens to serve.
 *
 *  There is no chemistry channel and no genomics channel: the renderer asks the registry
 *  what exists, asks a capability for its own settings schema, and renders whatever
 *  declarative view comes back. Adding a discipline adds no IPC. */

function providerOrThrow(capabilityId: string): CapabilityProvider {
  const provider = capabilityRegistry().providers.get(capabilityId);
  if (!provider || provider.source !== 'plugin') throw new Error('That capability is not provided by an installed package.');
  return provider;
}

/** A worker outside a chat turn: settings, health and rendering a stored result. There is
 *  no conversation to charge, so the model and attachment lanes are simply absent. */
function detachedWorker(capabilityId: string) {
  const provider = providerOrThrow(capabilityId);
  const runtime = resolveTrustedCapability(capabilityId, pinCapabilitiesForTurn().pins.get(capabilityId));
  if (!runtime) throw new Error('That capability is not installed.');
  const services = createCapabilityHostServices(createCapabilityAdapters({
    locale: 'en', pins: pinCapabilitiesForTurn(),
    runCoreStages: async answer => answer,
  }));
  return { provider, runtime, handle: acquireCapabilityWorker(runtime, { services }) };
}

export function registerCapabilitiesIpc(context: IpcContext): void {
  const { h } = context;

  onCapabilityRegistryChanged(snapshot => {
    const payload = {
      revision: snapshot.revision,
      providers: [...snapshot.providers.values()].map(summarize),
      problems: snapshot.problems,
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('capabilities:registryChanged', payload);
    }
  });

  h('capabilities:list', async () => {
    const snapshot = capabilityRegistry();
    return {
      revision: snapshot.revision,
      providers: [...snapshot.providers.values()].map(summarize),
      problems: snapshot.problems,
      plugins: listInstalledPluginsV2(),
      catalog: readCachedCatalog(),
    };
  });

  h('capabilities:health', async (_event, capabilityId: string) => {
    const { runtime, handle } = detachedWorker(capabilityId);
    return handle.call('health', {
      nodusVersion: process.env.npm_package_version ?? '',
      locale: 'en', platform: process.platform, arch: process.arch,
      dataVersion: listInstalledPluginsV2().find(state => state.id === runtime.plugin.id)?.dataVersion ?? 0,
    }, { timeoutMs: 30_000 });
  });

  h('capabilities:getSettings', async (_event, capabilityId: string) => {
    const { provider, handle } = detachedWorker(capabilityId);
    if (!provider.hasSettings) throw new Error('That capability has no settings.');
    const manifest = settingsManifest(capabilityId);
    return { manifest, state: validateSettingsState(await handle.call('getSettings', {}, { timeoutMs: 30_000 }), manifest) };
  });

  h('capabilities:applySettings', async (_event, capabilityId: string, submission: unknown) => {
    const { provider, runtime, handle } = detachedWorker(capabilityId);
    if (!provider.hasSettings) throw new Error('That capability has no settings.');
    const manifest = settingsManifest(capabilityId);
    const validated = validateSettingsSubmission(submission, manifest);

    // A secret never reaches the worker. It goes to the encrypted store here, and the
    // worker is told only that the field was submitted.
    const forWorker: Record<string, string | boolean> = {};
    for (const [id, value] of Object.entries(validated.fields)) {
      const field = manifest.fields.find(candidate => candidate.id === id);
      if (field?.kind === 'secret') {
        writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, typeof value === 'string' ? value : null);
        continue;
      }
      forWorker[id] = value;
    }
    return validateSettingsState(await handle.call('applySettings', { fields: forWorker }, { timeoutMs: 60_000 }), manifest);
  });

  h('capabilities:runAction', async (_event, capabilityId: string, actionId: string) => {
    const { provider, handle } = detachedWorker(capabilityId);
    const manifest = settingsManifest(capabilityId);
    if (!provider.hasSettings || !manifest.actions.some(action => action.id === actionId)) throw new Error('That capability has no such action.');
    // An action may install a runtime, so it gets the long end of the tool window.
    return validateSettingsState(await handle.call('runAction', { actionId }, { timeoutMs: 300_000 }), manifest);
  });

  h('artifacts:render', async (_event, source: string, locale = 'en') => {
    const sidecar = artifactSidecar(source);
    if (!sidecar) return { available: false as const, reason: 'missing' as const };
    const provider = capabilityRegistry().providers.get(sidecar.capabilityId);
    // A result whose package is gone still shows what it was and who made it, with a way
    // to get the provider back, instead of disappearing from the conversation.
    if (!provider || provider.source !== 'plugin') {
      return { available: false as const, reason: 'no-provider' as const, sidecar };
    }
    const envelope = readCapabilityArtifact(source);
    if (!envelope) return { available: false as const, reason: 'unreadable' as const, sidecar };
    const { handle } = detachedWorker(sidecar.capabilityId);
    const view = await handle.call('renderArtifact', {
      artifactType: envelope.artifactType, artifactVersion: envelope.artifactVersion,
      data: envelope.data, locale,
    }, { timeoutMs: 60_000 });
    return { available: true as const, sidecar, view: validateViewDocument(view) };
  });

  h('capabilities:refreshCatalog', async (_event, sourceUrl: string) => fetchCapabilityCatalog(sourceUrl));

  h('capabilities:installPlugin', async (_event, pluginId: string, approvePermissions = false) => {
    const outcome = await installCatalogPlugin(pluginId, { approvePermissions });
    return { state: outcome.state, activated: outcome.activated };
  });

  h('capabilities:approvePlugin', async (_event, pluginId: string) => {
    const state = approvePendingPluginV2(pluginId);
    await stopCapabilityWorkers(key => key.includes(pluginId));
    rebuildCapabilityRegistry();
    return state;
  });

  h('capabilities:rollbackPlugin', async (_event, pluginId: string) => {
    const state = rollbackPluginV2(pluginId);
    await stopCapabilityWorkers(key => key.includes(pluginId));
    rebuildCapabilityRegistry();
    return state;
  });

  h('capabilities:removePlugin', async (_event, pluginId: string, purgeData = false) => {
    await stopCapabilityWorkers(key => key.includes(pluginId));
    removePluginV2(pluginId, { purgeData });
    rebuildCapabilityRegistry();
    return listInstalledPluginsV2();
  });
}

function summarize(provider: CapabilityProvider) {
  return {
    id: provider.id, version: provider.version, description: provider.description,
    source: provider.source, plugin: provider.plugin,
    tools: provider.tools.map(tool => ({ id: tool.id, description: tool.description, metered: tool.metered })),
    artifacts: provider.artifacts,
    chat: provider.chat ? { priority: provider.chat.priority, pendingLabel: provider.chat.pendingLabel } : undefined,
    hasSettings: provider.hasSettings,
  };
}

function settingsManifest(capabilityId: string) {
  const runtime = resolveTrustedCapability(capabilityId, pinCapabilitiesForTurn().pins.get(capabilityId));
  if (!runtime?.manifest.settings) throw new Error('That capability has no settings.');
  return runtime.manifest.settings;
}
