import { app } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  REACTION_INDEX,
  reactionIndexTotalBytes,
  type ReactionIndexFileStatus,
  type ReactionIndexSource,
  type ReactionIndexStatus,
} from '@shared/reactionIndex';
import { downloadAsset, forgetVerifiedFile } from '../network/assetDownload';

/**
 * Owns the published ORD reaction index on disk: resolves where it lives, downloads and verifies
 * it on demand, and reports progress. No native dependency lives here — the files are inert
 * until a chemistry capability reads them (see tools/reaction-index for the format).
 *
 * A developer override (`NODUS_REACTION_INDEX_DIR`) points at a local build directory so the
 * feature can be exercised before the artifact is published to a release.
 */

const OVERRIDE_ENV = 'NODUS_REACTION_INDEX_DIR';

type Listener = (status: ReactionIndexStatus) => void;

let singleton: ReactionIndexService | null = null;

export function reactionIndexService(): ReactionIndexService {
  singleton ??= new ReactionIndexService();
  return singleton;
}

class ReactionIndexService {
  private listeners = new Set<Listener>();
  private inflight: Promise<ReactionIndexStatus> | null = null;
  private abort: AbortController | null = null;
  private received = new Map<string, number>();
  private lastEmit = 0;

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private source(): ReactionIndexSource {
    if (process.env[OVERRIDE_ENV]) return 'override';
    if (REACTION_INDEX.releaseUrl) return 'release';
    return 'none';
  }

  directory(): string {
    if (process.env[OVERRIDE_ENV]) return path.resolve(process.env[OVERRIDE_ENV]!);
    return path.join(app.getPath('userData'), 'reaction-index', REACTION_INDEX.version);
  }

  /** Directory with a complete, usable index, or null. Consumed by the chemistry capability. */
  async localDirectory(): Promise<string | null> {
    const dir = this.directory();
    const complete = this.source() === 'override'
      ? await this.allFilesExist(dir)
      : await this.matchesDescriptor(dir);
    return complete ? dir : null;
  }

  private async allFilesExist(dir: string): Promise<boolean> {
    for (const file of REACTION_INDEX.files) {
      const stat = await fsp.stat(path.join(dir, file.name)).catch(() => null);
      if (!stat?.isFile()) return false;
    }
    return true;
  }

  private async matchesDescriptor(dir: string): Promise<boolean> {
    const raw = await fsp.readFile(path.join(dir, 'descriptor.json'), 'utf8').catch(() => null);
    if (!raw) return false;
    let parsed: { version?: string; files?: Array<{ name: string; bytes: number; sha256: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (parsed.version !== REACTION_INDEX.version || !parsed.files) return false;
    for (const file of REACTION_INDEX.files) {
      const recorded = parsed.files.find((entry) => entry.name === file.name);
      if (!recorded || recorded.bytes !== file.bytes || recorded.sha256 !== file.sha256) return false;
      const stat = await fsp.stat(path.join(dir, file.name)).catch(() => null);
      if (!stat?.isFile() || stat.size !== file.bytes) return false;
    }
    return true;
  }

  private async fileStatuses(dir: string): Promise<ReactionIndexFileStatus[]> {
    const out: ReactionIndexFileStatus[] = [];
    for (const file of REACTION_INDEX.files) {
      const stat = await fsp.stat(path.join(dir, file.name)).catch(() => null);
      const downloadedBytes = this.received.get(file.name) ?? stat?.size ?? 0;
      out.push({ name: file.name, bytes: file.bytes, downloadedBytes: Math.min(downloadedBytes, file.bytes), received: (stat?.size ?? 0) === file.bytes });
    }
    return out;
  }

  async status(): Promise<ReactionIndexStatus> {
    const source = this.source();
    const dir = this.directory();
    const files = await this.fileStatuses(dir);
    const available = source !== 'none' && (source === 'override'
      ? await this.allFilesExist(dir)
      : await this.matchesDescriptor(dir));
    const downloadedBytes = files.reduce((sum, file) => sum + file.downloadedBytes, 0);
    const totalBytes = reactionIndexTotalBytes();
    return {
      version: REACTION_INDEX.version,
      revision: REACTION_INDEX.revision,
      available,
      published: Boolean(REACTION_INDEX.releaseUrl),
      source,
      path: source === 'none' ? null : dir,
      totalBytes,
      downloadedBytes,
      downloading: Boolean(this.inflight),
      progress: totalBytes === 0 ? (available ? 1 : 0) : Math.min(1, downloadedBytes / totalBytes),
      files,
    };
  }

  private emit(status: ReactionIndexStatus): void {
    for (const listener of this.listeners) listener(status);
  }

  /** Status built from in-flight byte counters only — no filesystem stats, safe to emit per chunk. */
  private progressStatus(): ReactionIndexStatus {
    const files = REACTION_INDEX.files.map((file) => {
      const downloaded = Math.min(this.received.get(file.name) ?? 0, file.bytes);
      return { name: file.name, bytes: file.bytes, downloadedBytes: downloaded, received: downloaded === file.bytes };
    });
    const totalBytes = reactionIndexTotalBytes();
    const downloadedBytes = files.reduce((sum, file) => sum + file.downloadedBytes, 0);
    return {
      version: REACTION_INDEX.version,
      revision: REACTION_INDEX.revision,
      available: false,
      published: true,
      source: 'release',
      path: this.directory(),
      totalBytes,
      downloadedBytes,
      downloading: true,
      progress: totalBytes === 0 ? 0 : Math.min(1, downloadedBytes / totalBytes),
      files,
    };
  }

  /** Download (or resume) every index file, then write the verification descriptor. */
  async ensure(): Promise<ReactionIndexStatus> {
    if (this.inflight) return this.inflight;
    this.inflight = this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<ReactionIndexStatus> {
    const source = this.source();
    if (source === 'none') {
      throw new Error('The reaction index has no published release yet.');
    }
    if (source === 'override') return this.status();

    const releaseUrl = REACTION_INDEX.releaseUrl!;
    const dir = this.directory();
    await fsp.mkdir(dir, { recursive: true });

    this.abort = new AbortController();
    this.received.clear();
    this.emit(await this.status());
    try {
      for (const file of REACTION_INDEX.files) {
        const target = path.join(dir, file.name);
        await downloadAsset({
          url: `${releaseUrl}/${file.name}`,
          target,
          bytes: file.bytes,
          sha256: file.sha256,
          signal: this.abort.signal,
          onBytes: (bytes) => {
            const current = this.received.get(file.name) ?? 0;
            this.received.set(file.name, current + bytes);
            const now = Date.now();
            if (now - this.lastEmit >= 250) {
              this.lastEmit = now;
              this.emit(this.progressStatus());
            }
          },
        });
        this.received.set(file.name, file.bytes);
      }
      await this.writeDescriptor(dir);
    } finally {
      this.abort = null;
    }
    const status = await this.status();
    this.emit(status);
    return status;
  }

  private async writeDescriptor(dir: string): Promise<void> {
    const payload = {
      version: REACTION_INDEX.version,
      revision: REACTION_INDEX.revision,
      files: REACTION_INDEX.files.map((file) => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })),
      writtenAt: new Date().toISOString(),
    };
    const target = path.join(dir, 'descriptor.json');
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fsp.rename(tmp, target);
  }

  /** Drop a verified index (used when pinning a new version). */
  async remove(): Promise<void> {
    const dir = this.directory();
    if (this.source() === 'override') return;
    await fsp.rm(dir, { recursive: true, force: true });
    for (const file of REACTION_INDEX.files) forgetVerifiedFile(path.join(dir, file.name));
  }

  cancel(): void {
    this.abort?.abort();
  }

  async dispose(): Promise<void> {
    this.cancel();
    this.listeners.clear();
  }
}
