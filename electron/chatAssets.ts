import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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
/** Remove images dropped by regeneration, message truncation, or history retention. */
export function reconcileChatAssets(owner: string, messages: Array<{ content: string }>): void {
  const dir = directory(owner);
  if (!fs.existsSync(dir)) return;
  const text = messages.map(message => message.content).join('\n');
  for (const file of fs.readdirSync(dir)) {
    const id = file.replace(/\.(json|image)$/, '');
    if (!text.includes(`nodus-image://chat/${owner}/${id}`)) fs.rmSync(path.join(dir, file), { force: true });
  }
}
