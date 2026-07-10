/**
 * Main-process side of local narration. Synthesis itself runs in the renderer
 * (Piper via WebAssembly / onnxruntime-web, which sidesteps Electron's V8 memory
 * cage that blocks native TTS addons). The main process owns the two things that
 * must live here: turning a saved Deep Research report or an immersion into
 * per-segment speakable text, and persisting the WAV bytes the renderer produces
 * as clip files in the vault's audio directory (excluded from backups/sync) with
 * compact metadata in SQLite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AudioClip, AudioEntityKind, AudioSegment } from '@shared/types';
import { getDb } from '../db/database';
import { deepResearchSegments, immersionSegments } from './speakable';
import { audioDir, audioFilePath } from './audioPaths';
import {
  deleteAudioClipRow,
  deleteAudioClipsForEntity,
  insertAudioClip,
  listAudioClips,
} from '../db/audioClipsRepo';

// ── Segmentation ─────────────────────────────────────────────────────────────

/** Build the ordered list of speakable segments for an entity (read by the
 *  renderer, which then synthesises each and posts the audio back to be saved). */
export function getEntitySegments(kind: AudioEntityKind, id: string): AudioSegment[] {
  if (kind === 'deep_research') {
    const row = getDb().prepare('SELECT title, draft_json FROM writing_saved_drafts WHERE id = ?').get(id) as
      | { title: string; draft_json: string }
      | undefined;
    if (!row) throw new Error('El informe guardado ya no existe.');
    let draft: { title?: string; abstract?: string; draftMarkdown?: string } = {};
    try {
      draft = JSON.parse(row.draft_json);
    } catch {
      /* fall back to the row title only */
    }
    return deepResearchSegments({ title: draft.title || row.title, abstract: draft.abstract, draftMarkdown: draft.draftMarkdown });
  }
  const row = getDb().prepare('SELECT title, topic, plan_json FROM immersion_sessions WHERE id = ?').get(id) as
    | { title: string; topic: string; plan_json: string }
    | undefined;
  if (!row) throw new Error('La inmersión ya no existe.');
  let plan: { overview?: string; stations?: unknown[]; title?: string; topic?: string } = {};
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    /* fall back to title/topic */
  }
  return immersionSegments({
    title: plan.title || row.title,
    topic: plan.topic || row.topic,
    overview: plan.overview,
    stations: (plan.stations as never[]) ?? [],
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface SaveClipInput {
  segmentIndex: number;
  segmentLabel: string;
  voice: string;
  language: string;
  /** WAV bytes produced by the renderer. */
  bytes: Uint8Array;
}

/** Persist one generated segment as a WAV file plus a metadata row, returning the clip. */
export function saveClip(kind: AudioEntityKind, id: string, input: SaveClipInput): AudioClip {
  const dir = audioDir();
  const fileName = `${kind}_${id}_${String(input.segmentIndex).padStart(3, '0')}_${randomUUID().slice(0, 8)}.wav`;
  const buffer = Buffer.from(input.bytes);
  fs.writeFileSync(path.join(dir, fileName), buffer);
  const meta = parseWavMeta(buffer);
  const clip: AudioClip = {
    id: randomUUID(),
    entityKind: kind,
    entityId: id,
    segmentIndex: input.segmentIndex,
    segmentLabel: input.segmentLabel,
    provider: 'piper',
    voice: input.voice,
    language: input.language,
    fileName,
    bytes: buffer.length,
    durationSec: meta.durationSec,
    sampleRate: meta.sampleRate,
    createdAt: new Date().toISOString(),
    missing: false,
  };
  insertAudioClip(clip);
  return clip;
}

/** Minimal WAV (PCM) header parse for duration + sample rate. Returns zeros on a
 *  malformed header so a clip is still saved (duration just shows as 0:00). */
function parseWavMeta(buf: Buffer): { durationSec: number; sampleRate: number } {
  try {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return { durationSec: 0, sampleRate: 0 };
    const sampleRate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28);
    // Walk chunks to find 'data' (there may be a LIST/fact chunk before it).
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        const durationSec = byteRate > 0 ? chunkSize / byteRate : 0;
        return { durationSec, sampleRate };
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return { durationSec: 0, sampleRate };
  } catch {
    return { durationSec: 0, sampleRate: 0 };
  }
}

// ── Reads / deletes ──────────────────────────────────────────────────────────

export function clearEntityClips(kind: AudioEntityKind, id: string): void {
  for (const fileName of deleteAudioClipsForEntity(kind, id)) removeFile(fileName);
}

export function listEntityClips(kind: AudioEntityKind, id: string): AudioClip[] {
  return listAudioClips(kind, id);
}

export function deleteClip(id: string): void {
  const fileName = deleteAudioClipRow(id);
  if (fileName) removeFile(fileName);
}

export function deleteEntityClips(kind: AudioEntityKind, id: string): void {
  clearEntityClips(kind, id);
}

/** Raw bytes for playback in the renderer (served as a data URL). */
export function readClipBytes(id: string): { bytes: Buffer; mime: string } | null {
  const row = getDb().prepare('SELECT file_name FROM audio_clips WHERE id = ?').get(id) as
    | { file_name: string }
    | undefined;
  if (!row) return null;
  const full = audioFilePath(row.file_name);
  if (!fs.existsSync(full)) return null;
  return { bytes: fs.readFileSync(full), mime: 'audio/wav' };
}

function removeFile(fileName: string): void {
  try {
    fs.rmSync(audioFilePath(fileName), { force: true });
  } catch {
    /* best effort */
  }
}
