import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateGenomicsResult, type GenomicsResult } from '@shared/genomics';

const versions = new Map<string, number>();
const root = () => path.join(app.getPath('userData'), 'chat-assets');
export const chatAssetOwner = (surface: string, conversationId: string, vaultId = '') =>
  createHash('sha256').update(JSON.stringify([surface, vaultId, conversationId])).digest('hex');
export const chatAssetVersion = (owner: string) => versions.get(owner) ?? 0;
function directory(owner: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid image owner.');
  return path.join(root(), owner);
}
export function storeChatImage(owner: string, image: { bytes: Buffer; mimeType: string }, metadata: Record<string, string>): string {
  if (image.bytes.length > 40 * 1024 * 1024) throw new Error('The generated image exceeds 40 MB.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('Unsupported generated image format.');
  const id = randomUUID();
  const dir = directory(owner);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, `${id}.image`), image.bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ ...metadata, mimeType: image.mimeType }), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(path.join(dir, `${id}.image`), { force: true });
    fs.rmSync(path.join(dir, `${id}.json`), { force: true });
    throw error;
  }
  return `nodus-image://chat/${owner}/${id}`;
}
export function getChatImage(id: string): { blob: Buffer; mime: string } | null {
  if (!/^[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(id)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(root(), `${id}.json`), 'utf8'));
    return { blob: fs.readFileSync(path.join(root(), `${id}.image`)), mime: meta.mimeType };
  } catch { return null; }
}
export function getChatImageMetadata(source: string): Record<string, string> | null {
  const match = /^nodus-image:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36})$/.exec(source);
  if (!match) return null;
  try { return JSON.parse(fs.readFileSync(path.join(root(), `${match[1]}.json`), 'utf8')); } catch { return null; }
}
export function deleteChatAssets(owner: string): void {
  versions.set(owner, chatAssetVersion(owner) + 1);
  fs.rmSync(directory(owner), { recursive: true, force: true });
}
export function storeGenomicsResult(owner: string, result: GenomicsResult): string {
  validateGenomicsResult(result);
  const id = randomUUID();
  const dir = directory(owner);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${id}.genomics`), JSON.stringify(result), { mode: 0o600 });
  return `nodus-genomics://chat/${owner}/${id}`;
}
export function getGenomicsResult(source: string): GenomicsResult | null {
  const match = /^nodus-genomics:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36})$/.exec(source);
  if (!match) return null;
  try { return validateGenomicsResult(JSON.parse(fs.readFileSync(path.join(root(), `${match[1]}.genomics`), 'utf8'))); } catch { return null; }
}
export function storeCapabilityFile(owner: string, input: { bytes: Buffer; mimeType: string; name: string; title?: string }): string {
  if (input.bytes.length > 10_000_000 || !input.bytes.length) throw new Error('Capability file exceeds its size limit.');
  if (!input.name || /[\\/\0]/.test(input.name) || input.name.length > 160 || !/^[\w.+-]+\/[\w.+-]+$/i.test(input.mimeType)) throw new Error('Invalid capability file metadata.');
  const id = randomUUID(), dir = directory(owner); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(path.join(dir, `${id}.capability`), input.bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.capability.json`), JSON.stringify({ mimeType: input.mimeType, name: input.name, title: input.title ?? input.name }), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(path.join(dir, `${id}.capability`), { force: true }); fs.rmSync(path.join(dir, `${id}.capability.json`), { force: true }); throw error;
  }
  return `nodus-capability://chat/${owner}/${id}`;
}
export function getCapabilityFile(source: string): { blob: Buffer; mimeType: string; name: string; title: string } | null {
  const match = /^nodus-capability:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36})$/.exec(source); if (!match) return null;
  try { const metadata = JSON.parse(fs.readFileSync(path.join(root(), `${match[1]}.capability.json`), 'utf8')); return { blob: fs.readFileSync(path.join(root(), `${match[1]}.capability`)), ...metadata }; }
  catch { return null; }
}
/** Remove images dropped by regeneration, message truncation, or history retention. */
export function reconcileChatAssets(owner: string, messages: Array<{ content: string }>): void {
  const dir = directory(owner);
  if (!fs.existsSync(dir)) return;
  const text = messages.map(message => message.content).join('\n');
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.genomics')) {
      if (!text.includes(`nodus-genomics://chat/${owner}/${file.slice(0, -9)}`)) fs.rmSync(path.join(dir, file), { force: true });
      continue;
    }
    if (file.endsWith('.capability') || file.endsWith('.capability.json')) {
      const id = file.replace(/\.capability(?:\.json)?$/, '');
      if (!text.includes(`nodus-capability://chat/${owner}/${id}`)) fs.rmSync(path.join(dir, file), { force: true });
      continue;
    }
    const id = file.replace(/\.(json|image)$/, '');
    if (!text.includes(`nodus-image://chat/${owner}/${id}`)) fs.rmSync(path.join(dir, file), { force: true });
  }
}
