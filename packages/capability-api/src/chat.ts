import { LIMITS } from './limits';
import { SLUG, exactKeys, plainText } from './json';
import { validateLocalizedText, type LocalizedText } from './localized';
import { validateViewDocument, type ViewDocumentV1 } from './views';
import { validateWorkerArtifact, type ArtifactTypeManifestV1, type WorkerArtifactV1 } from './artifacts';

/** The core stopped knowing what a `chemistry-plan` is. It parses a reply once into this
 *  generic tree and hands the fences each plugin declared to that plugin, in priority order. */

export type AnswerMode = 'replace-block' | 'replace-answer';

export interface ChatAstNode {
  /** Stable within one parse. A mutation may only name a node from its own input. */
  id: string;
  kind: 'prose' | 'fence';
  /** Fence tag without backticks, e.g. `chemistry-plan`. Absent for prose. */
  fence?: string;
  content: string;
  /** False when the reply was cut off mid-fence. */
  complete: boolean;
}

export interface CapabilityChatContractV2 {
  /** Lower runs first. Two providers may not share a priority. */
  priority: number;
  requestProtocols: Array<{ fence: string; toolId: string; maxPerReply: number; answerMode: AnswerMode }>;
  /** Fences this capability still recognizes from replies written by older builds. */
  legacyResults: Array<{ fence: string; artifactType: string; artifactVersion: number }>;
  hooks: { prepare?: boolean; finalize?: boolean };
  pendingLabel: LocalizedText;
}

/** Returned by `prepareChat`, before any tool runs. A hook may drop a node, turn one into
 *  a tool request, add a notice, or claim the reply — never emit executable text. */
export type PrepareMutation =
  | { op: 'remove'; nodeId: string }
  | { op: 'promote-request'; nodeId: string; toolId: string; input: unknown }
  | { op: 'notice'; position: 'before' | 'after'; view: ViewDocumentV1 }
  | { op: 'claim'; exclusive?: boolean; suppressSvgRefinement?: boolean };

/** Returned by `finalizeChat`, after every tool has run. No new requests may be created
 *  here: a result must never become the next instruction. */
export type FinalMutation =
  | { op: 'remove'; nodeId: string }
  | { op: 'artifact'; position: 'before' | 'after'; artifact: WorkerArtifactV1 }
  | { op: 'notice'; position: 'before' | 'after'; view: ViewDocumentV1 };

const FENCE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateChatContract(input: unknown): CapabilityChatContractV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['priority', 'requestProtocols', 'legacyResults', 'hooks', 'pendingLabel'])) throw new Error('Invalid capability chat contract.');
  const value = input as CapabilityChatContractV2;
  if (!Number.isInteger(value.priority) || value.priority < LIMITS.chatPriorityMin || value.priority > LIMITS.chatPriorityMax) throw new Error('Invalid chat contract priority.');
  if (!Array.isArray(value.requestProtocols) || value.requestProtocols.length > 8) throw new Error('Invalid chat request protocols.');
  if (!Array.isArray(value.legacyResults) || value.legacyResults.length > 24) throw new Error('Invalid chat legacy results.');
  if (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks)
    || !exactKeys(value.hooks, ['prepare', 'finalize'])
    || (value.hooks.prepare !== undefined && typeof value.hooks.prepare !== 'boolean')
    || (value.hooks.finalize !== undefined && typeof value.hooks.finalize !== 'boolean')) throw new Error('Invalid chat hooks.');

  const fences = new Set<string>();
  for (const protocol of value.requestProtocols) {
    if (!protocol || !exactKeys(protocol, ['fence', 'toolId', 'maxPerReply', 'answerMode'])
      || !FENCE.test(protocol.fence) || fences.has(protocol.fence) || !SLUG.test(protocol.toolId)
      || !Number.isInteger(protocol.maxPerReply) || protocol.maxPerReply < 1 || protocol.maxPerReply > LIMITS.chatFenceMaxPerReply
      || !['replace-block', 'replace-answer'].includes(protocol.answerMode)) throw new Error('Invalid chat request protocol.');
    fences.add(protocol.fence);
  }
  for (const legacy of value.legacyResults) {
    if (!legacy || !exactKeys(legacy, ['fence', 'artifactType', 'artifactVersion'])
      || !FENCE.test(legacy.fence) || fences.has(legacy.fence) || !SLUG.test(legacy.artifactType)
      || !Number.isInteger(legacy.artifactVersion) || legacy.artifactVersion < 1) throw new Error('Invalid chat legacy result.');
    fences.add(legacy.fence);
  }
  return { ...structuredClone(value), pendingLabel: validateLocalizedText(value.pendingLabel, 120) };
}

/** Fences a plugin claims. Two installed plugins may not claim the same one. */
export const contractFences = (contract: CapabilityChatContractV2): string[] =>
  [...contract.requestProtocols.map(protocol => protocol.fence), ...contract.legacyResults.map(legacy => legacy.fence)];

interface MutationContext {
  /** Ids from the AST slice this hook was given. Naming anything else is rejected. */
  nodeIds: ReadonlySet<string>;
  toolIds: ReadonlySet<string>;
  artifactTypes: readonly ArtifactTypeManifestV1[];
}

function assertMutationList(input: unknown): unknown[] {
  if (!Array.isArray(input)) throw new Error('A chat hook must return a list of mutations.');
  if (input.length > LIMITS.chatMutationsPerHook) throw new Error(`A chat hook may return at most ${LIMITS.chatMutationsPerHook} mutations.`);
  return input;
}

export function validatePrepareMutations(input: unknown, context: MutationContext): PrepareMutation[] {
  const seen = new Set<string>();
  let claimed = false;
  return assertMutationList(input).map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid prepare mutation.');
    const mutation = raw as PrepareMutation;
    if (mutation.op === 'remove' || mutation.op === 'promote-request') {
      if (!context.nodeIds.has(mutation.nodeId)) throw new Error('A chat hook may only address nodes it was given.');
      // Two mutations touching one node would make the outcome depend on ordering.
      if (seen.has(mutation.nodeId)) throw new Error('A chat hook addressed the same node twice.');
      seen.add(mutation.nodeId);
    }
    if (mutation.op === 'remove') {
      if (!exactKeys(mutation, ['op', 'nodeId'])) throw new Error('Invalid prepare mutation.');
      return { op: 'remove', nodeId: mutation.nodeId };
    }
    if (mutation.op === 'promote-request') {
      if (!exactKeys(mutation, ['op', 'nodeId', 'toolId', 'input']) || !context.toolIds.has(mutation.toolId)) throw new Error('Invalid promoted request.');
      return { op: 'promote-request', nodeId: mutation.nodeId, toolId: mutation.toolId, input: structuredClone(mutation.input) };
    }
    if (mutation.op === 'notice') {
      if (!exactKeys(mutation, ['op', 'position', 'view']) || !['before', 'after'].includes(mutation.position)) throw new Error('Invalid prepare notice.');
      return { op: 'notice', position: mutation.position, view: validateViewDocument(mutation.view) };
    }
    if (mutation.op === 'claim') {
      if (!exactKeys(mutation, ['op', 'exclusive', 'suppressSvgRefinement']) && !exactKeys(mutation, ['op', 'exclusive'])
        && !exactKeys(mutation, ['op', 'suppressSvgRefinement']) && !exactKeys(mutation, ['op'])) throw new Error('Invalid claim.');
      if (claimed) throw new Error('A chat hook claimed the reply twice.');
      claimed = true;
      return { op: 'claim', ...(mutation.exclusive ? { exclusive: true } : {}), ...(mutation.suppressSvgRefinement ? { suppressSvgRefinement: true } : {}) };
    }
    throw new Error('Unsupported prepare mutation.');
  });
}

export function validateFinalMutations(input: unknown, context: MutationContext): FinalMutation[] {
  const seen = new Set<string>();
  return assertMutationList(input).map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid final mutation.');
    const mutation = raw as FinalMutation;
    if (mutation.op === 'remove') {
      if (!exactKeys(mutation, ['op', 'nodeId']) || !context.nodeIds.has(mutation.nodeId)) throw new Error('A chat hook may only address nodes it was given.');
      if (seen.has(mutation.nodeId)) throw new Error('A chat hook addressed the same node twice.');
      seen.add(mutation.nodeId);
      return { op: 'remove', nodeId: mutation.nodeId };
    }
    if (mutation.op === 'artifact') {
      if (!exactKeys(mutation, ['op', 'position', 'artifact']) || !['before', 'after'].includes(mutation.position)) throw new Error('Invalid final artifact.');
      return { op: 'artifact', position: mutation.position, artifact: validateWorkerArtifact(mutation.artifact, context.artifactTypes) };
    }
    if (mutation.op === 'notice') {
      if (!exactKeys(mutation, ['op', 'position', 'view']) || !['before', 'after'].includes(mutation.position)) throw new Error('Invalid final notice.');
      return { op: 'notice', position: mutation.position, view: validateViewDocument(mutation.view) };
    }
    // `promote-request` is deliberately absent: finalize runs after every tool, so a
    // request created here could only be a result asking to be executed.
    throw new Error('Unsupported final mutation.');
  });
}

/** Splits a reply into prose and fenced blocks exactly once, for every provider to share. */
export function parseChatAst(answer: string): ChatAstNode[] {
  const nodes: ChatAstNode[] = [];
  const pattern = /```([a-z0-9-]+)[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g;
  let cursor = 0, index = 0;
  for (const match of answer.matchAll(pattern)) {
    if (match.index! > cursor) nodes.push({ id: `n${index++}`, kind: 'prose', content: answer.slice(cursor, match.index), complete: true });
    nodes.push({ id: `n${index++}`, kind: 'fence', fence: match[1], content: match[2], complete: match[0].trimEnd().endsWith('```') });
    cursor = match.index! + match[0].length;
  }
  if (cursor < answer.length) nodes.push({ id: `n${index++}`, kind: 'prose', content: answer.slice(cursor), complete: true });
  return nodes;
}

/** Faithful inverse of the parse, incompleteness included: closing a fence the model never
 *  closed would turn a truncated reply into one that looks executable on the next pass. */
export function serializeChatAst(nodes: readonly ChatAstNode[]): string {
  return nodes.map(node => {
    if (node.kind === 'prose') return node.content;
    const opened = `\`\`\`${node.fence}\n${node.content}`;
    return node.complete ? `${opened}\n\`\`\`` : opened;
  }).join('');
}

export const pendingLabelText = (contract: CapabilityChatContractV2, locale: string): string =>
  contract.pendingLabel[locale] ?? contract.pendingLabel[locale.split('-')[0]] ?? contract.pendingLabel.en;

export const isPlainFenceTag = (value: unknown): value is string => typeof value === 'string' && FENCE.test(value);
export const chatContractLabelIsPlain = (label: unknown): boolean => plainText(label, 120);
