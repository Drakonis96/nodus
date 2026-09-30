// Nodus Drift: the catalogue and the bytes of the bundled recordings.
//
// Two channels, paired with shared/api/drift.ts and electron/preload/drift.ts:
//
//   drift:catalog      the catalogue with the availability of every entry
//   drift:read-audio   the bytes of ONE authorised recording, addressed by sound id
//
// Both belong to the main frame of the main Nodus window and to nothing else: not to a
// Browser page, not to an iframe inside the app, not to an auxiliary window. The caller
// never supplies a path or a URL. The path comes from the catalogue, is confined inside
// the bundled audio directory after resolving symbolic links, and the file is refused
// when it is empty, larger than 12 MiB, of an unexpected size or, on first load, when its
// SHA-256 is not the catalogued one. The service below is Electron-free so all of that is
// exercised against real files by scripts/test-drift-ipc.mjs.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  DRIFT_CATALOG_SCHEMA_VERSION,
  MAX_DRIFT_AUDIO_BYTES,
  baseDriftAvailability,
  isDriftDistributable,
  isDriftSoundId,
  isSafeDriftAssetPath,
  validateDriftCatalog,
  type DriftAvailability,
  type DriftCatalogResponse,
  type DriftSoundDefinition,
} from '@shared/drift';
import { DRIFT_SOUNDS } from '@shared/driftCatalog';
import type { IpcContext } from './context';
import { assertTrustedNodusMainFrame } from './trust';

export type DriftAudioErrorCode = 'unavailable' | 'missing' | 'corrupt' | 'too-large';

/**
 * The reason travels as a prefix of the message because that is all that survives the IPC
 * boundary. The text is English on purpose: the interface shows its own translated copy
 * for the code, and an English message crosses `localizeRuntimeError` untouched.
 */
export class DriftAudioError extends Error {
  constructor(readonly code: DriftAudioErrorCode, detail: string) {
    super(`drift-audio:${code}: ${detail}`);
    this.name = 'DriftAudioError';
  }
}

export interface DriftServiceEntry {
  definition: DriftSoundDefinition;
  /** Directory the definition's `asset` is relative to. */
  root: string;
}

export interface DriftAudioServiceOptions {
  entries: readonly DriftServiceEntry[] | (() => Promise<readonly DriftServiceEntry[]>);
  /** Largest file the service will read. Defaults to 12 MiB. */
  maxBytes?: number;
}

export interface DriftAudioService {
  catalog(): Promise<DriftCatalogResponse>;
  readAudio(soundId: unknown): Promise<Uint8Array>;
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' || (error as NodeJS.ErrnoException | undefined)?.code === 'ENOTDIR';

/**
 * Resolve `asset` inside `root` and prove the result is still inside it once symbolic
 * links are followed. In development a link in the assets directory is a real possibility;
 * inside app.asar there are none, and realpath of an asar path is the path itself.
 */
export async function resolveConfinedAsset(root: string, asset: string): Promise<string> {
  if (!isSafeDriftAssetPath(asset)) throw new DriftAudioError('unavailable', 'the catalogued path is not a safe relative path');
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(root);
  } catch (error) {
    if (isMissing(error)) throw new DriftAudioError('missing', 'the audio directory is not there');
    throw error;
  }
  const candidate = path.join(realRoot, ...asset.split('/'));
  let real: string;
  try {
    real = await fs.promises.realpath(candidate);
  } catch (error) {
    if (isMissing(error)) throw new DriftAudioError('missing', 'the recording is not there');
    throw error;
  }
  const relative = path.relative(realRoot, real);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DriftAudioError('unavailable', 'the recording resolves outside the audio directory');
  }
  return real;
}

export function createDriftAudioService(options: DriftAudioServiceOptions): DriftAudioService {
  const maxBytes = options.maxBytes ?? MAX_DRIFT_AUDIO_BYTES;
  let resolved: Promise<Map<string, DriftServiceEntry>> | null = null;
  // A recording is hashed the first time it is loaded, and again only if the file changed.
  const verified = new Map<string, { size: number; mtimeMs: number }>();

  const entries = (): Promise<Map<string, DriftServiceEntry>> => {
    resolved ??= (async () => {
      const list = typeof options.entries === 'function' ? await options.entries() : options.entries;
      return new Map(list.map((entry) => [entry.definition.id, entry] as const));
    })();
    return resolved;
  };

  return {
    async catalog() {
      const map = await entries();
      const sounds = await Promise.all([...map.values()].map(async (entry) => {
        const definition = structuredClone(entry.definition);
        let availability: DriftAvailability = baseDriftAvailability(definition);
        if (availability === 'available' && definition.source.kind === 'file') {
          try {
            const file = await resolveConfinedAsset(entry.root, definition.source.asset);
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) availability = 'missing';
          } catch {
            availability = 'missing';
          }
        }
        return { ...definition, availability };
      }));
      return { schemaVersion: DRIFT_CATALOG_SCHEMA_VERSION, sounds };
    },

    async readAudio(soundId) {
      if (typeof soundId !== 'string' || !isDriftSoundId(soundId)) {
        throw new DriftAudioError('unavailable', 'not a catalogued sound id');
      }
      const entry = (await entries()).get(soundId);
      if (!entry) throw new DriftAudioError('unavailable', 'not a catalogued sound id');
      const { definition, root } = entry;
      if (definition.source.kind !== 'file') throw new DriftAudioError('unavailable', 'this sound is generated, it has no file');
      if (!isDriftDistributable(definition)) {
        throw new DriftAudioError('unavailable', 'this recording has not been cleared for distribution');
      }
      const source = definition.source;

      const file = await resolveConfinedAsset(root, source.asset);
      const before = await fs.promises.stat(file);
      if (!before.isFile()) throw new DriftAudioError('unavailable', 'the recording is not a regular file');
      // Every size check happens before a single byte is read.
      if (before.size === 0) throw new DriftAudioError('corrupt', 'the file is empty');
      if (before.size > maxBytes) throw new DriftAudioError('too-large', `the file is ${before.size} bytes, above the ${maxBytes} byte limit`);
      if (before.size !== source.bytes) throw new DriftAudioError('corrupt', `the file is ${before.size} bytes, the catalogue says ${source.bytes}`);

      const data = await fs.promises.readFile(file);
      if (data.length !== before.size) throw new DriftAudioError('corrupt', 'the file changed while it was being read');
      const known = verified.get(soundId);
      if (!known || known.size !== before.size || known.mtimeMs !== before.mtimeMs) {
        const digest = createHash('sha256').update(data).digest('hex');
        if (digest !== source.sha256) throw new DriftAudioError('corrupt', 'the file does not match its catalogued SHA-256');
        verified.set(soundId, { size: before.size, mtimeMs: before.mtimeMs });
      }
      // A fresh, exactly sized array of plain bytes. Never the Buffer's pooled ArrayBuffer:
      // structured clone would ship everything that shares it.
      return new Uint8Array(data);
    },
  };
}

// ── e2e fixtures ────────────────────────────────────────────────────────────

/**
 * Test-only recordings for the end-to-end suite, in the manner of the other
 * NODUS_E2E_* switches. NODUS_E2E_DRIFT_FIXTURES names a directory holding `catalog.json`
 * (definitions) and `audio/` (their files). They must pass exactly the same validation as
 * the real catalogue and are never mixed in unless every one of them is well formed,
 * distinctly named and authorised. They are generated at test time by
 * scripts/drift-fixtures.mjs and are not Moodist sounds.
 */
export async function loadE2eDriftFixtures(directory: string | undefined): Promise<DriftServiceEntry[]> {
  if (!directory) return [];
  try {
    const parsed = JSON.parse(await fs.promises.readFile(path.join(directory, 'catalog.json'), 'utf8')) as { sounds?: DriftSoundDefinition[] };
    const sounds = Array.isArray(parsed.sounds) ? parsed.sounds : [];
    const problems = validateDriftCatalog([...DRIFT_SOUNDS, ...sounds]);
    if (problems.length > 0 || sounds.some((sound) => !isDriftDistributable(sound))) {
      console.warn('[drift] ignoring the e2e fixtures: ', problems.slice(0, 3).join('; ') || 'a fixture is not authorised');
      return [];
    }
    return sounds.map((definition) => ({ definition, root: path.join(directory, 'audio') }));
  } catch (error) {
    console.warn('[drift] the e2e fixtures could not be read:', (error as Error).message);
    return [];
  }
}

// ── registration ────────────────────────────────────────────────────────────

export function registerDriftIpc({ h, getWindow }: IpcContext): void {
  const service = createDriftAudioService({
    entries: async () => {
      const root = path.join(app.getAppPath(), 'electron', 'assets', 'drift', 'audio');
      const bundled = DRIFT_SOUNDS.map((definition) => ({ definition, root }));
      return [...bundled, ...await loadE2eDriftFixtures(process.env.NODUS_E2E_DRIFT_FIXTURES)];
    },
  });

  h('drift:catalog', async (event) => {
    assertTrustedNodusMainFrame(event, getWindow());
    return service.catalog();
  });

  h('drift:read-audio', async (event, soundId: unknown) => {
    assertTrustedNodusMainFrame(event, getWindow());
    return service.readAudio(soundId);
  });
}
