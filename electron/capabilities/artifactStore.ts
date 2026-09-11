import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { artifactEnvelope, sanitizeProjection, validateArtifactEnvelope, type CapabilityArtifactEnvelopeV1, type ArtifactModelVisibility, type WorkerArtifactV1 } from '../../packages/capability-api/src/artifacts';

/** Where a capability result lives once the reply is saved.
 *
 *  The message itself keeps only a reference: which capability produced it, which package
 *  version and digest, a one-line summary, and a local URI. The data sits beside the chat
 *  with its own hash, so an artifact that is tampered with, truncated or restored from a
 *  mismatched backup fails to load instead of being rendered as if it were intact. */

export interface ArtifactReference {
  source: string;
  capabilityId: string;
  plugin: { id: string; version: string; digest: string };
  artifactType: string;
  artifactVersion: number;
  summary: string;
  modelVisibility: ArtifactModelVisibility;
}

export interface ArtifactSidecar extends ArtifactReference {
  sha256: string;
  bytes: number;
  createdAt: string;
}

const SOURCE = /^nodus-artifact:\/\/chat\/([a-f0-9]{64})\/([a-f0-9-]{36})$/;
const root = () => path.join(app.getPath('userData'), 'chat-assets');

function directory(owner: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid artifact owner.');
  return path.join(root(), owner);
}

export function storeCapabilityArtifact(
  owner: string,
  artifact: WorkerArtifactV1,
  context: { capabilityId: string; plugin: { id: string; version: string; digest: string }; modelVisibility: ArtifactModelVisibility },
): ArtifactReference {
  const envelope = artifactEnvelope(artifact, context);
  const encoded = JSON.stringify(validateArtifactEnvelope(envelope));
  if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('The capability result is too large to store.');
  const id = randomUUID();
  const dir = directory(owner);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sidecar: ArtifactSidecar = {
    source: `nodus-artifact://chat/${owner}/${id}`,
    capabilityId: envelope.capabilityId,
    plugin: envelope.plugin,
    artifactType: envelope.artifactType,
    artifactVersion: envelope.artifactVersion,
    summary: envelope.summary,
    modelVisibility: envelope.modelVisibility,
    sha256: createHash('sha256').update(encoded).digest('hex'),
    bytes: Buffer.byteLength(encoded),
    createdAt: envelope.createdAt,
  };
  try {
    fs.writeFileSync(path.join(dir, `${id}.artifact`), encoded, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.artifact.json`), JSON.stringify(sidecar), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(path.join(dir, `${id}.artifact`), { force: true });
    fs.rmSync(path.join(dir, `${id}.artifact.json`), { force: true });
    throw error;
  }
  const { sha256, bytes, createdAt, ...reference } = sidecar;
  void sha256; void bytes; void createdAt;
  return reference;
}

export function artifactSidecar(source: string): ArtifactSidecar | null {
  const match = SOURCE.exec(source);
  if (!match) return null;
  try { return JSON.parse(fs.readFileSync(path.join(root(), match[1], `${match[2]}.artifact.json`), 'utf8')) as ArtifactSidecar; }
  catch { return null; }
}

/** Reads an artifact back, refusing content whose hash no longer matches its sidecar. */
export function readCapabilityArtifact(source: string): CapabilityArtifactEnvelopeV1 | null {
  const match = SOURCE.exec(source);
  const sidecar = artifactSidecar(source);
  if (!match || !sidecar) return null;
  try {
    const encoded = fs.readFileSync(path.join(root(), match[1], `${match[2]}.artifact`), 'utf8');
    if (createHash('sha256').update(encoded).digest('hex') !== sidecar.sha256) return null;
    return validateArtifactEnvelope(JSON.parse(encoded));
  } catch { return null; }
}

/** The reference that travels in the saved reply. It carries nothing the model could act
 *  on: an identity, a summary and a local URI. */
export function serializeArtifactReference(reference: ArtifactReference): string {
  return `\n\n\`\`\`nodus-artifact\n${JSON.stringify(reference)}\n\`\`\`\n\n`;
}

export function parseArtifactReference(content: string): ArtifactReference | null {
  try {
    const value = JSON.parse(content) as ArtifactReference;
    if (!value || typeof value.source !== 'string' || !SOURCE.test(value.source) || typeof value.summary !== 'string') return null;
    return value;
  } catch { return null; }
}

/** What the model is allowed to see of a past artifact.
 *
 *  This is the rule the genomics case used to hardcode, now read from the package that
 *  produced the result: `none` becomes a neutral marker, `projection` becomes whatever
 *  projection the worker offers — sanitized, so a stored result cannot come back as an
 *  instruction. A missing projection degrades to the marker rather than to the raw data. */
export async function artifactForModel(
  source: string,
  project: (envelope: CapabilityArtifactEnvelopeV1) => Promise<string | null>,
): Promise<string> {
  const sidecar = artifactSidecar(source);
  if (!sidecar) return '[a capability result that is no longer available]';
  if (sidecar.modelVisibility === 'none') return `[a ${sidecar.artifactType} result, not included in the conversation history]`;
  const envelope = readCapabilityArtifact(source);
  if (!envelope) return '[a capability result that is no longer available]';
  try {
    const projection = await project(envelope);
    return projection ? sanitizeProjection(projection) : `[${sidecar.summary}]`;
  } catch { return `[${sidecar.summary}]`; }
}
