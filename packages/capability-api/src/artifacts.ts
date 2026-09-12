import { LIMITS } from './limits';
import { SEMVER, SLUG, exactKeys, plainText } from './json';
import { validateLocalizedText, type LocalizedText } from './localized';

/** How much of an artifact the model is ever allowed to see again.
 *  `none` is enforced by the core: it substitutes a neutral marker before any model call. */
export type ArtifactModelVisibility = 'none' | 'projection';

export interface ArtifactTypeManifestV1 {
  type: string;
  version: number;
  label: LocalizedText;
  modelVisibility: ArtifactModelVisibility;
  /** Legacy on-disk formats this type can still decode when an old chat is reopened. */
  decodes?: string[];
}

/** What a worker hands back. The core wraps it in the envelope; the worker never
 *  chooses its own provenance, digest or timestamp. */
export interface WorkerArtifactV1 {
  artifactType: string;
  artifactVersion: number;
  summary: string;
  data: unknown;
  /** Rendered immediately so the first paint does not need a round trip to the worker. */
  view?: unknown;
}

export interface CapabilityArtifactEnvelopeV1 {
  schemaVersion: 1;
  capabilityId: string;
  plugin: { id: string; version: string; digest: string };
  artifactType: string;
  artifactVersion: number;
  createdAt: string;
  modelVisibility: ArtifactModelVisibility;
  summary: string;
  data: unknown;
}

export function validateArtifactTypeManifest(input: unknown): ArtifactTypeManifestV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['type', 'version', 'label', 'modelVisibility', 'decodes']) && !exactKeys(input, ['type', 'version', 'label', 'modelVisibility'])) throw new Error('Invalid artifact type.');
  const value = input as ArtifactTypeManifestV1;
  if (!SLUG.test(value.type) || !Number.isInteger(value.version) || value.version < 1 || value.version > 1_000
    || !['none', 'projection'].includes(value.modelVisibility)) throw new Error('Invalid artifact type.');
  if (value.decodes !== undefined && (!Array.isArray(value.decodes) || value.decodes.length > 24 || value.decodes.some(entry => !SLUG.test(String(entry))))) throw new Error('Invalid artifact decoder list.');
  return { ...structuredClone(value), label: validateLocalizedText(value.label, 120) };
}

export function validateWorkerArtifact(input: unknown, declared: readonly ArtifactTypeManifestV1[]): WorkerArtifactV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['artifactType', 'artifactVersion', 'summary', 'data', 'view']) && !exactKeys(input, ['artifactType', 'artifactVersion', 'summary', 'data'])) throw new Error('Invalid artifact.');
  const value = input as WorkerArtifactV1;
  const type = declared.find(entry => entry.type === value.artifactType);
  if (!type) throw new Error(`Capability produced an undeclared artifact type: ${String(value.artifactType)}.`);
  if (value.artifactVersion !== type.version) throw new Error('Artifact version does not match its declared type.');
  if (!plainText(value.summary, LIMITS.artifactSummaryChars)) throw new Error('Invalid artifact summary.');
  return structuredClone(value);
}

// Zero-width and bidi characters are stripped alongside fences: both are ways to smuggle
// something that reads as an instruction past a human reviewing the projection.
// eslint-disable-next-line no-control-regex -- projections are hostile input
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** The projection is the only text a `projection` artifact may put back in front of the
 *  model. It is data, never instructions: fences are neutralized so a stored result can
 *  not become a new request on the next turn. */
export function sanitizeProjection(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid artifact projection.');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > LIMITS.projectionBytes) throw new Error(`Artifact projection exceeds ${LIMITS.projectionBytes} bytes.`);
  return text.replace(/```/g, "'''").replace(INVISIBLE, '');
}

export function artifactEnvelope(
  artifact: WorkerArtifactV1,
  context: { capabilityId: string; plugin: { id: string; version: string; digest: string }; modelVisibility: ArtifactModelVisibility; createdAt?: string },
): CapabilityArtifactEnvelopeV1 {
  return {
    schemaVersion: 1,
    capabilityId: context.capabilityId,
    plugin: { ...context.plugin },
    artifactType: artifact.artifactType,
    artifactVersion: artifact.artifactVersion,
    createdAt: context.createdAt ?? new Date().toISOString(),
    modelVisibility: context.modelVisibility,
    summary: artifact.summary,
    data: artifact.data,
  };
}

export function validateArtifactEnvelope(input: unknown): CapabilityArtifactEnvelopeV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'capabilityId', 'plugin', 'artifactType', 'artifactVersion', 'createdAt', 'modelVisibility', 'summary', 'data'])) throw new Error('Invalid artifact envelope.');
  const value = input as CapabilityArtifactEnvelopeV1;
  if (value.schemaVersion !== 1 || typeof value.capabilityId !== 'string' || !value.plugin
    || !exactKeys(value.plugin, ['id', 'version', 'digest']) || !SLUG.test(value.plugin.id) || !SEMVER.test(value.plugin.version)
    || !/^[a-f0-9]{64}$/.test(value.plugin.digest) || !SLUG.test(value.artifactType)
    || !Number.isInteger(value.artifactVersion) || Number.isNaN(Date.parse(value.createdAt))
    || !['none', 'projection'].includes(value.modelVisibility) || !plainText(value.summary, LIMITS.artifactSummaryChars)) throw new Error('Invalid artifact envelope.');
  return structuredClone(value);
}
