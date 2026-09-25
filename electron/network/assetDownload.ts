import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Small, dependency-free asset downloader for pinned artifacts: HTTP Range resume, exact byte
 * count and SHA-256 verification, atomic rename on success. Used by the reaction-index service.
 * (`electron/ai/nodusLocalAi.ts` has an equivalent private helper for models; this is the generic
 * copy for artifacts that are not local-AI models.)
 */

const verified = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

/** SHA-256 of a file, cached by (size, mtime) so repeated status checks do not re-hash 100 MB. */
export async function sha256File(target: string): Promise<string> {
  const stat = await fsp.stat(target);
  const cached = verified.get(target);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk as Buffer);
  const digest = hash.digest('hex');
  verified.set(target, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: digest });
  return digest;
}

export function forgetVerifiedFile(target: string): void {
  verified.delete(target);
}

export function cancelledDownloadError(): Error {
  const error = new Error('Download cancelled. Verified progress is kept so it can resume.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledDownloadError();
}

export interface AssetDownload {
  url: string;
  target: string;
  /** Exact expected size in bytes; required for a resumable, verifiable transfer. */
  bytes?: number;
  /** Lowercase hex SHA-256 of the complete file. */
  sha256?: string;
  /** Reports absolute bytes now present in the file (completed size, or each streamed chunk). */
  onBytes?: (bytes: number) => void;
  signal?: AbortSignal;
}

/**
 * Stream one asset to `target`. An already-complete, verified file is a no-op; an interrupted
 * transfer resumes from `<target>.download` with a Range request. On any size/digest mismatch the
 * partial is removed and an error is thrown, leaving the target untouched.
 */
export async function downloadAsset(asset: AssetDownload): Promise<void> {
  const { url, target, bytes: expectedBytes, sha256: expectedSha256, onBytes, signal } = asset;
  throwIfAborted(signal);
  await fsp.mkdir(path.dirname(target), { recursive: true });

  const completed = await fsp.stat(target).catch(() => null);
  if (completed?.isFile() && (!expectedBytes || completed.size === expectedBytes)) {
    if (!expectedSha256 || await sha256File(target) === expectedSha256) {
      onBytes?.(completed.size);
      return;
    }
    await fsp.rm(target, { force: true });
  }

  const partial = `${target}.download`;
  let resumedBytes = (await fsp.stat(partial).catch(() => null))?.size ?? 0;
  if (expectedBytes && resumedBytes > expectedBytes) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: resumedBytes > 0 ? { Range: `bytes=${resumedBytes}-` } : undefined,
    });
  } catch (error) {
    if (signal?.aborted) throw cancelledDownloadError();
    throw error;
  }

  if (response.status === 416 && expectedBytes && resumedBytes === expectedBytes) {
    const digest = await sha256File(partial);
    if (!expectedSha256 || digest === expectedSha256) {
      await fsp.rename(partial, target);
      return;
    }
    await fsp.rm(partial, { force: true });
    throw new Error('The resumed download failed SHA-256 verification.');
  }
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);

  const resumed = resumedBytes > 0 && response.status === 206;
  if (!resumed && resumedBytes > 0) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }

  const file = fs.createWriteStream(partial, { flags: resumed ? 'a' : 'wx' });
  const hash = createHash('sha256');
  let received = resumedBytes;
  try {
    if (resumedBytes > 0) {
      for await (const chunk of fs.createReadStream(partial)) hash.update(chunk as Buffer);
      onBytes?.(resumedBytes);
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve));
      onBytes?.(chunk.length);
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    file.destroy();
    // Keep a bounded partial so a later attempt resumes it; verification still guards corruption.
    if (signal?.aborted) throw cancelledDownloadError();
    throw error;
  }
  throwIfAborted(signal);

  if (expectedBytes && received !== expectedBytes) {
    if (received > expectedBytes) await fsp.rm(partial, { force: true });
    throw new Error(`Incomplete download: expected ${expectedBytes} bytes, received ${received}.`);
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    await fsp.rm(partial, { force: true });
    throw new Error('The downloaded file failed SHA-256 verification.');
  }
  await fsp.rename(partial, target);
  forgetVerifiedFile(target);
}
