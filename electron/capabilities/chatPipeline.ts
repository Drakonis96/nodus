import { LIMITS } from '../../packages/capability-api/src/limits';
import {
  parseChatAst, serializeChatAst, validateFinalMutations, validatePrepareMutations,
  type ChatAstNode, type FinalMutation, type PrepareMutation,
} from '../../packages/capability-api/src/chat';
import type { WorkerArtifactV1 } from '../../packages/capability-api/src/artifacts';
import type { ViewDocumentV1 } from '../../packages/capability-api/src/views';
import type { CapabilityProvider, CapabilityRegistrySnapshot } from './registry';

/** The reply pipeline, with no disciplinary knowledge left in it.
 *
 *  The core used to know what a `chemistry-plan` was. Now it knows only that a provider
 *  may claim a fence, that exactly one may, and in what order claims are honoured. The
 *  reply is parsed once into a generic tree that every provider shares; what comes back
 *  is typed mutations, never text to be re-parsed, so a result can never turn into the
 *  next instruction. */

export interface TrustedCapabilityRunner {
  /** Runs one tool and returns what it produced. */
  invoke(request: { provider: CapabilityProvider; toolId: string; input: unknown; nodeId?: string }): Promise<{ artifacts?: WorkerArtifactV1[]; view?: ViewDocumentV1; notices?: ViewDocumentV1[] }>;
  /** Runs a declared chat hook; the pipeline validates whatever comes back. */
  hook(request: { provider: CapabilityProvider; hook: 'prepare' | 'finalize'; nodes: ChatAstNode[] }): Promise<unknown>;
  /** Stores an artifact and returns the text that stands for it in the saved reply. */
  persistArtifact(request: { provider: CapabilityProvider; artifact: WorkerArtifactV1 }): Promise<string>;
  /** Renders a plugin-authored view into the reply. */
  renderView(request: { provider: CapabilityProvider; view: ViewDocumentV1 }): string;
  /** Everything the core still does itself between the provider stages, told whether a
   *  provider has claimed the drawing lane for this reply. */
  runCoreStages(answer: string, options: { suppressSvgRefinement: boolean }): Promise<string>;
}

export interface TrustedChatOptions {
  locale?: string;
  signal?: AbortSignal;
  /** Present only in tests and in the development flag path. */
  onProblem?: (provider: CapabilityProvider, error: Error) => void;
}

interface Placement { before: string[]; after: string[] }

const emptyPlacement = (): Placement => ({ before: [], after: [] });

/** Nodes a provider is allowed to name in a mutation: the fences it claimed, and nothing
 *  else. Prose and other providers' blocks are visible to it but not its to remove. */
function ownedNodes(nodes: readonly ChatAstNode[], provider: CapabilityProvider, registry: CapabilityRegistrySnapshot): ChatAstNode[] {
  return nodes.filter(node => node.kind === 'fence' && registry.fences.get(node.fence!)?.provider === provider);
}

export async function runTrustedChatPipeline(
  answer: string,
  registry: CapabilityRegistrySnapshot,
  runner: TrustedCapabilityRunner,
  options: TrustedChatOptions = {},
): Promise<string> {
  // With nothing registered there is no v2 stage to run, and the reply is whatever the
  // core already makes of it. This is the shape of a clean install.
  if (!registry.chatOrder.length) return runner.runCoreStages(answer, { suppressSvgRefinement: false });

  const signal = options.signal;
  signal?.throwIfAborted();

  // 1. One parse, shared by every provider. Re-parsing per provider is how two of them
  //    end up disagreeing about what the reply said.
  let nodes = parseChatAst(answer);
  const placement = new Map<string, Placement>();
  const removed = new Set<string>();
  const claimedBy = new Set<CapabilityProvider>();
  let suppressSvgRefinement = false;
  let exclusive: CapabilityProvider | null = null;
  const perFence = new Map<string, number>();

  const report = (provider: CapabilityProvider, error: unknown) => {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    options.onProblem?.(provider, error instanceof Error ? error : new Error(String(error)));
  };
  const placeAt = (nodeId: string) => placement.get(nodeId) ?? placement.set(nodeId, emptyPlacement()).get(nodeId)!;

  const runRequest = async (provider: CapabilityProvider, node: ChatAstNode, toolId: string, input: unknown) => {
    const tool = provider.tools.find(candidate => candidate.id === toolId);
    if (!tool) throw new Error(`${provider.id} has no tool ${toolId}.`);
    const count = (perFence.get(`${provider.id}:${toolId}`) ?? 0) + 1;
    perFence.set(`${provider.id}:${toolId}`, count);
    if (count > tool.maxPerReply) throw new Error(`At most ${tool.maxPerReply} ${toolId} requests are allowed per reply.`);
    const result = await runner.invoke({ provider, toolId, input, nodeId: node.id });
    const pieces: string[] = [];
    for (const artifact of result.artifacts ?? []) pieces.push(await runner.persistArtifact({ provider, artifact }));
    if (result.view) pieces.push(runner.renderView({ provider, view: result.view }));
    for (const notice of result.notices ?? []) pieces.push(runner.renderView({ provider, view: notice }));
    removed.add(node.id);
    placeAt(node.id).before.push(...pieces);
  };

  const requestsFor = (provider: CapabilityProvider, mode: 'replace-answer' | 'replace-block') =>
    (provider.chat?.requestProtocols ?? []).filter(protocol => protocol.answerMode === mode);

  const runRequestStage = async (mode: 'replace-answer' | 'replace-block') => {
    for (const provider of registry.chatOrder) {
      if (exclusive && exclusive !== provider) continue;
      for (const protocol of requestsFor(provider, mode)) {
        for (const node of nodes) {
          if (node.kind !== 'fence' || node.fence !== protocol.fence || removed.has(node.id)) continue;
          signal?.throwIfAborted();
          try {
            if (!node.complete) throw new Error('The request was interrupted. Retry the response.');
            if (node.content.length > 64_000) throw new Error('The request is too large.');
            await runRequest(provider, node, protocol.toolId, JSON.parse(node.content));
          } catch (error) { report(provider, error); removed.add(node.id); placeAt(node.id).before.push(errorText(error)); }
        }
      }
    }
  };

  // 2. Requests that replace the whole answer run first: if one of them owns the reply,
  //    everything after it is working on an answer that no longer exists.
  await runRequestStage('replace-answer');

  // 3. Prepare hooks, in priority order. A hook may drop its own blocks, turn one into a
  //    request, add a notice, or claim the reply — and cannot emit executable text.
  for (const provider of registry.chatOrder) {
    if (!provider.chat?.hooks.prepare) continue;
    if (exclusive && exclusive !== provider) continue;
    const visible = nodes.filter(node => !removed.has(node.id));
    let mutations: PrepareMutation[];
    try {
      mutations = validatePrepareMutations(await runner.hook({ provider, hook: 'prepare', nodes: visible }), {
        nodeIds: new Set(ownedNodes(visible, provider, registry).map(node => node.id)),
        toolIds: new Set(provider.tools.map(tool => tool.id)),
        artifactTypes: provider.artifacts,
      });
    } catch (error) { report(provider, error); continue; }

    for (const mutation of mutations) {
      if (mutation.op === 'remove') { removed.add(mutation.nodeId); continue; }
      if (mutation.op === 'notice') { placeAt(anchorFor(visible, mutation.position)).after.push(runner.renderView({ provider, view: mutation.view })); continue; }
      if (mutation.op === 'claim') {
        claimedBy.add(provider);
        if (mutation.suppressSvgRefinement) suppressSvgRefinement = true;
        if (mutation.exclusive) exclusive = provider;
        continue;
      }
      const node = visible.find(candidate => candidate.id === mutation.nodeId)!;
      try { await runRequest(provider, node, mutation.toolId, mutation.input); }
      catch (error) { report(provider, error); removed.add(node.id); placeAt(node.id).before.push(errorText(error)); }
    }
  }

  // 4-6. The core's own stages, then the block-level requests. The core skips its own
  //      drawing pass only when a provider said it has taken that lane for this reply.
  const body = await runner.runCoreStages(serialize(nodes, removed, placement), { suppressSvgRefinement });

  // The core stages rewrite the text, so the tree is rebuilt before the last stage rather
  // than pretending the node ids from step 1 still describe what is there.
  nodes = parseChatAst(body);
  removed.clear();
  placement.clear();
  perFence.clear();
  await runRequestStage('replace-block');

  // 7. Finalize hooks. No new requests may be created here.
  for (const provider of registry.chatOrder) {
    if (!provider.chat?.hooks.finalize) continue;
    if (exclusive && exclusive !== provider) continue;
    const visible = nodes.filter(node => !removed.has(node.id));
    let mutations: FinalMutation[];
    try {
      mutations = validateFinalMutations(await runner.hook({ provider, hook: 'finalize', nodes: visible }), {
        nodeIds: new Set(ownedNodes(visible, provider, registry).map(node => node.id)),
        toolIds: new Set(provider.tools.map(tool => tool.id)),
        artifactTypes: provider.artifacts,
      });
    } catch (error) { report(provider, error); continue; }

    for (const mutation of mutations) {
      if (mutation.op === 'remove') { removed.add(mutation.nodeId); continue; }
      const anchor = anchorFor(visible, mutation.position);
      if (mutation.op === 'notice') { placeAt(anchor).after.push(runner.renderView({ provider, view: mutation.view })); continue; }
      try { placeAt(anchor).after.push(await runner.persistArtifact({ provider, artifact: mutation.artifact })); }
      catch (error) { report(provider, error); }
    }
  }

  // 8. Serialize once more, with the artifacts already persisted.
  return serialize(nodes, removed, placement);
}

function anchorFor(nodes: readonly ChatAstNode[], position: 'before' | 'after'): string {
  return position === 'before' ? nodes[0]?.id ?? '' : nodes[nodes.length - 1]?.id ?? '';
}

function serialize(nodes: readonly ChatAstNode[], removed: ReadonlySet<string>, placement: ReadonlyMap<string, Placement>): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const around = placement.get(node.id);
    if (around) parts.push(...around.before);
    if (!removed.has(node.id)) parts.push(serializeChatAst([node]));
    if (around) parts.push(...around.after);
  }
  return parts.join('');
}

/** Provider failures are reported to the user as inert text, never as something the next
 *  turn could read back as a request. */
function errorText(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error).replace(/[\r\n`*<>[\]]/g, ' ').slice(0, 500);
  return `\n\nCapability error: ${message}\n\n`;
}

export const TRUSTED_PIPELINE_LIMITS = LIMITS;
