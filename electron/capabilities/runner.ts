import type { VisionSession } from './vision/service';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { utilityProcess } from 'electron';
import type { ModelRef } from '@shared/types';
import { serializeChatVisualPart } from '@shared/chatSkills';
import { completeText } from '../ai/aiClient';
import { storeCapabilityFile } from '../chatAssets';
import { validateViewDocument, type ViewDocumentV1 } from '../../packages/capability-api/src/views';
import type { WorkerArtifactV1 } from '../../packages/capability-api/src/artifacts';
import type { ChatAstNode } from '../../packages/capability-api/src/chat';
import { acquireCapabilityWorker, stopCapabilityWorkers, type TrustedWorkerRuntime } from './workerHost';
import { createCapabilityHostServices, type CapabilityServiceAdapters } from './hostServices';
import { resolveTrustedCapability } from './pluginStoreV2';
import { serializeArtifactReference, storeCapabilityArtifact } from './artifactStore';
import { inspectCapabilitySvg, refineCapabilitySvg, validateCapabilitySvg } from './svgServices';
import { ensurePythonRuntime, runInPythonRuntime, validateRuntimeLock } from './pythonRuntime';
import type { CapabilityProvider } from './registry';
import type { TurnPins } from './registry';
import type { TrustedCapabilityRunner } from './chatPipeline';

/** Assembles the pieces for one turn: the pinned package, its worker, the host services
 *  it is allowed to reach, and where its results are stored. */

export interface TrustedTurnContext {
  vision?: VisionSession;
  renderStoredArtifacts?: boolean;
  owner?: string;
  question?: string;
  locale: string;
  model?: ModelRef | null;
  pins: TurnPins;
  signal?: AbortSignal;
  beforeInvoke?: () => void;
  beforePaidCall?: () => void;
  beforeRepair?: () => void;
  runCoreStages: (answer: string, options: { suppressSvgRefinement: boolean }) => Promise<string>;
}

function runtimeFor(provider: CapabilityProvider, pins: TurnPins): TrustedWorkerRuntime {
  const pin = pins.pins.get(provider.id);
  const runtime = resolveTrustedCapability(provider.id, pin);
  if (!runtime) throw new Error(`${provider.id} is no longer installed.`);
  return runtime;
}

/** Downloads one pinned artifact through the capability's own declared permission, so a
 *  runtime install cannot reach anywhere the package did not ask for. */
function lockDownloader(runtime: TrustedWorkerRuntime, services: ReturnType<typeof createCapabilityHostServices>, signal: AbortSignal) {
  return async (url: string): Promise<Buffer> => {
    const target = new URL(url);
    const endpoint = (runtime.permissions.network ?? []).find(candidate => new URL(candidate.origin).origin === target.origin);
    if (!endpoint) throw new Error(`The package did not declare permission to reach ${target.origin}.`);
    const response = await services({
      runtime, channel: 'network', method: 'fetch', signal,
      payload: { endpointId: endpoint.id, path: `${target.pathname}${target.search}`, method: 'GET' },
    }) as { status: number; body: Uint8Array };
    if (response.status !== 200) throw new Error(`${url} returned ${response.status}.`);
    return Buffer.from(response.body);
  };
}

export function createCapabilityAdapters(context: TrustedTurnContext): CapabilityServiceAdapters {
  let services: ReturnType<typeof createCapabilityHostServices> | null = null;
  const adapters: CapabilityServiceAdapters = {
    vision: context.vision,
    beforePaidCall: context.beforePaidCall,
    async model(runtime, request, signal) {
      return completeText({
        system: (request.system ?? 'You answer exactly what is asked, with no preamble.').slice(0, 20_000),
        user: request.prompt.slice(0, 200_000),
        maxTokens: Math.min(Math.max(request.maxTokens ?? 4_000, 256), 16_000),
        temperature: 0, reasoning: 'off', plainContext: true, signal, noRetry: Boolean(context.beforePaidCall),
      }, context.model);
    },
    svg: {
      validate: validateCapabilitySvg,
      inspect: inspectCapabilitySvg,
      refine: (request, signal) => { context.beforeRepair?.(); return refineCapabilitySvg(request, context.model, signal, Boolean(context.beforePaidCall)); },
    },
    python: {
      async ensureRuntime(runtime, runtimeId, signal) {
        const declared = runtime.permissions.runtimes?.find(entry => entry.id === runtimeId);
        if (!declared) return { ready: false, detail: 'That runtime is not declared by the package.' };
        // One lock per interpreter version the package supports, named for it. A package
        // that supports only one ships `lock.json` and gets it whatever the interpreter is.
        const locks = path.join(path.dirname(runtime.entryPath), 'runtimes', runtimeId);
        const selectLock = (pythonVersion: string) => {
          for (const file of [`lock-${pythonVersion}.json`, 'lock.json']) {
            try { return validateRuntimeLock(JSON.parse(fs.readFileSync(path.join(locks, file), 'utf8'))); }
            catch { /* try the next */ }
          }
          return null;
        };
        return ensurePythonRuntime(runtime, runtimeId, {
          download: lockDownloader(runtime, services!, signal),
          minVersion: declared.minVersion, selectLock, signal,
        });
      },
      run: (runtime, request, signal) => runInPythonRuntime(runtime, request, signal),
    },
    // An auxiliary process from the package's own bundle, with its own deadline and a kill
    // the host controls. It talks to nothing: one input in, one value out.
    async subworker(runtime, request, signal) {
      const entry = path.resolve(path.dirname(runtime.entryPath), request.entry);
      const base = path.resolve(path.dirname(runtime.entryPath));
      if (entry !== base && !entry.startsWith(base + path.sep)) throw new Error('A subworker entry must live inside its own package.');
      const max = runtime.permissions.subworkers?.max ?? 0;
      if (max < 1) throw new Error('Capability subworkers are not permitted.');
      const child = utilityProcess.fork(entry, [], { serviceName: `Nodus capability subworker ${runtime.capabilityId}`, stdio: 'ignore' });
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, value?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          try { child.kill(); } catch { /* already gone */ }
          if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(new DOMException('The capability subworker was cancelled.', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('The capability subworker exceeded its time limit.')), Math.min(Math.max(request.timeoutMs, 1_000), 300_000));
        signal.addEventListener('abort', abort, { once: true });
        child.on('message', (message: { error?: string; result?: unknown }) => {
          if (message?.error) finish(new Error(String(message.error).slice(0, 2_000)));
          else finish(undefined, message?.result);
        });
        child.once('error', error => finish(new Error(String(error))));
        child.once('exit', () => finish(new Error('The capability subworker exited without a result.')));
        try { child.postMessage(request.input); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    },
    async attachments(runtime, request) {
      if (!context.owner) throw new Error('Start a saved chat before creating capability attachments.');
      const source = storeCapabilityFile(context.owner, { bytes: request.bytes, mimeType: request.mimeType, name: request.name });
      return { attachmentId: source.slice(source.lastIndexOf('/') + 1), bytes: request.bytes.length };
    },
  };
  services = createCapabilityHostServices(adapters);
  return adapters;
}

export function createTrustedCapabilityRunner(context: TrustedTurnContext): TrustedCapabilityRunner {
  const scopeKey = randomUUID();
  const services = createCapabilityHostServices(createCapabilityAdapters(context));
  const workerFor = (provider: CapabilityProvider) => {
    const runtime = runtimeFor(provider, context.pins);
    return { runtime, handle: acquireCapabilityWorker(runtime, { services, scopeKey }) };
  };

  const renderView = ({ provider, view }: { provider: CapabilityProvider; view: ViewDocumentV1 }): string =>
    serializeChatVisualPart({
      kind: 'capability-view', complete: true,
      // The owner travels with the view so a download node can be resolved against the
      // conversation that owns the attachment, never against a path the view chose.
      content: JSON.stringify({ capabilityId: provider.id, plugin: provider.plugin, owner: context.owner, view: validateViewDocument(view) }),
    });

  return {
    dispose: () => stopCapabilityWorkers(key => key.endsWith(`#${scopeKey}`)),
    async invoke({ provider, toolId, input, nodeId }) {
      const tool = provider.tools.find(candidate => candidate.id === toolId);
      if (!tool) throw new Error(`${provider.id} has no tool ${toolId}.`);
      const { handle } = workerFor(provider);
      context.beforeInvoke?.();
      return handle.call('invoke', {
        invocationId: `i${Math.random().toString(36).slice(2, 10)}`,
        toolId, input, locale: context.locale,
        chat: { question: context.question, nodeId },
      }, { timeoutMs: tool.timeoutMs, signal: context.signal });
    },

    async hook({ provider, hook, nodes }: { provider: CapabilityProvider; hook: 'prepare' | 'finalize'; nodes: ChatAstNode[] }) {
      const { handle } = workerFor(provider);
      return handle.call(hook === 'prepare' ? 'prepareChat' : 'finalizeChat',
        { nodes, ...(hook === 'prepare' ? { question: context.question } : {}), locale: context.locale },
        { timeoutMs: 60_000, signal: context.signal });
    },

    async persistArtifact({ provider, artifact }: { provider: CapabilityProvider; artifact: WorkerArtifactV1 }) {
      if (!context.owner) throw new Error('Start a saved chat before a capability can store a result.');
      const declared = provider.artifacts.find(entry => entry.type === artifact.artifactType);
      if (!declared) throw new Error(`${provider.id} produced an undeclared artifact type.`);
      const reference = storeCapabilityArtifact(context.owner, artifact, {
        capabilityId: provider.id,
        plugin: provider.plugin ?? { id: 'core', version: '0.0.0', digest: '0'.repeat(64) },
        modelVisibility: declared.modelVisibility,
      });
      const pieces = [serializeArtifactReference(reference)];
      // A view that came with the artifact is rendered straight away, so the first paint
      // does not need a round trip back into the worker.
      if (artifact.view) {
        try { pieces.push(renderView({ provider, view: validateViewDocument(artifact.view) })); }
        catch { /* the stored artifact can still be rendered on demand */ }
      }
      else if (context.renderStoredArtifacts) {
        const { handle } = workerFor(provider);
        const view = await handle.call('renderArtifact', {
          artifactType: artifact.artifactType, artifactVersion: artifact.artifactVersion,
          data: artifact.data, locale: context.locale,
        }, { timeoutMs: 60_000, signal: context.signal });
        pieces.push(renderView({ provider, view: validateViewDocument(view) }));
      }
      return pieces.join('');
    },

    renderView,
    runCoreStages: context.runCoreStages,
  };
}
