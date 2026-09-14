import { artifactSidecar } from './artifactStore';

/** What a conversation's history may contain when it is sent to a model.
 *
 *  A capability declares how much of its result the model may ever see again, and this is
 *  where that declaration is enforced. It replaces a rule that used to be written into
 *  the application for genomics alone: the application no longer knows which results are
 *  sensitive, only that some package said so.
 *
 *  Substitution is text-level and deliberately blunt. History arrives as strings, often
 *  nested inside JSON wrappers, and a rule that only worked on well-formed input would be
 *  a rule that fails exactly when it matters. */

const MARKER = '[a capability result retained on this device]';
const ARTIFACT_FENCE = /(?:`{3,}|~{3,})nodus-artifact\s*\n([\s\S]*?)(?:(?:`{3,}|~{3,})(?=\s|$)|$)/gi;
// Packaged 3D provenance may include individual contributor credits. Those belong to
// application-managed presentation and the immutable model, never subsequent inference.
const CAPABILITY_RESULT_FENCE = /(?:`{3,}|~{3,})nodus-capability-result\s*\n([\s\S]*?)(?:(?:`{3,}|~{3,})(?=\s|$)|$)/gi;
const MODEL_MARKER = '[3D model result retained on this device]';
const isModelEnvelope = (value: unknown): boolean => {
  const envelope = value as { capabilityId?: unknown; pluginId?: unknown; result?: { kind?: unknown } } | null;
  return Boolean(envelope && typeof envelope.capabilityId === 'string' && typeof envelope.pluginId === 'string' && envelope.result?.kind === 'model');
};
// Assets written by 5.3.1, before results became generic artifacts.
const LEGACY_FENCE = /(?:`{3,}|~{3,})genomics-result\s*\n[\s\S]*?(?:(?:`{3,}|~{3,})(?=\s|$)|$)/gi;
const LEGACY_SOURCE = /nodus-genomics:\/\/chat\/[a-f0-9]{64}\/[a-f0-9-]{36}/g;

export function excludeInvisibleArtifacts(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  if (!/nodus-artifact|nodus-capability|nodus-genomics|genomics-result|Google DeepMind AlphaGenome/i.test(text)) return text;

  try {
    const value = JSON.parse(text);
    const walk = (node: unknown): unknown => {
      if (typeof node === 'string') return excludeInvisibleArtifacts(node);
      if (isModelEnvelope(node)) return MODEL_MARKER;
      if (node && typeof node === 'object' && (node as { provider?: string }).provider === 'Google DeepMind AlphaGenome') return MARKER;
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
      return node;
    };
    // A JSON string that decodes to itself is impossible, so the recursion progresses.
    return JSON.stringify(walk(value));
  } catch { /* ordinary text */ }

  return text
    .replace(CAPABILITY_RESULT_FENCE, (block, body: string) => {
      try { return isModelEnvelope(JSON.parse(body)) ? MODEL_MARKER : block; }
      catch { return /"kind"\s*:\s*"model"/.test(body) ? MODEL_MARKER : block; }
    })
    .replace(ARTIFACT_FENCE, (block, body: string) => {
      try {
        const reference = JSON.parse(body) as { source?: string; summary?: string };
        const sidecar = reference.source ? artifactSidecar(reference.source) : null;
        // Only a result whose own package said "none" is removed. Everything else keeps
        // its reference, because the model is allowed to know that it exists.
        if (sidecar?.modelVisibility === 'none') return `[${sidecar.artifactType} result, not included in the conversation history]`;
        return block;
      } catch { return block; }
    })
    .replace(LEGACY_FENCE, MARKER)
    .replace(LEGACY_SOURCE, MARKER);
}
