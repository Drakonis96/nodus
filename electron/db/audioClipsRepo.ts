import { getDb } from './database';
import type { AudioClip, AudioEntityKind } from '@shared/types';
import { audioFileExists } from '../audio/audioPaths';

interface AudioClipRow {
  id: string;
  entity_kind: AudioEntityKind;
  entity_id: string;
  segment_index: number;
  segment_label: string;
  provider: string;
  voice: string;
  language: string;
  file_name: string;
  bytes: number;
  duration_sec: number;
  sample_rate: number;
  created_at: string;
}

function toClip(row: AudioClipRow): AudioClip {
  return {
    id: row.id,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    segmentIndex: row.segment_index,
    segmentLabel: row.segment_label,
    provider: row.provider === 'kokoro' || row.provider === 'hume' ? row.provider : 'piper',
    voice: row.voice,
    language: row.language,
    fileName: row.file_name,
    bytes: row.bytes,
    durationSec: row.duration_sec,
    sampleRate: row.sample_rate,
    createdAt: row.created_at,
    // A row can outlive its file (restore from backup / sync never carries audio).
    missing: !audioFileExists(row.file_name),
  };
}

export function listAudioClips(entityKind: AudioEntityKind, entityId: string): AudioClip[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM audio_clips WHERE entity_kind = ? AND entity_id = ? ORDER BY segment_index ASC, created_at ASC'
    )
    .all(entityKind, entityId) as AudioClipRow[];
  return rows.map(toClip);
}

export function getAudioClip(id: string): AudioClip | null {
  const row = getDb().prepare('SELECT * FROM audio_clips WHERE id = ?').get(id) as AudioClipRow | undefined;
  return row ? toClip(row) : null;
}

export function insertAudioClip(clip: AudioClip): void {
  getDb()
    .prepare(
      `INSERT INTO audio_clips
       (id, entity_kind, entity_id, segment_index, segment_label, provider, voice, language, file_name, bytes, duration_sec, sample_rate, created_at)
       VALUES (@id, @entity_kind, @entity_id, @segment_index, @segment_label, @provider, @voice, @language, @file_name, @bytes, @duration_sec, @sample_rate, @created_at)`
    )
    .run({
      id: clip.id,
      entity_kind: clip.entityKind,
      entity_id: clip.entityId,
      segment_index: clip.segmentIndex,
      segment_label: clip.segmentLabel,
      provider: clip.provider,
      voice: clip.voice,
      language: clip.language,
      file_name: clip.fileName,
      bytes: clip.bytes,
      duration_sec: clip.durationSec,
      sample_rate: clip.sampleRate,
      created_at: clip.createdAt,
    });
}

/** Remove a clip's metadata; returns its file name so the caller can delete the file. */
export function deleteAudioClipRow(id: string): string | null {
  const row = getDb().prepare('SELECT file_name FROM audio_clips WHERE id = ?').get(id) as
    | { file_name: string }
    | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM audio_clips WHERE id = ?').run(id);
  return row.file_name;
}

/** Remove all clips for an entity; returns their file names for file cleanup. */
export function deleteAudioClipsForEntity(entityKind: AudioEntityKind, entityId: string): string[] {
  const rows = getDb()
    .prepare('SELECT file_name FROM audio_clips WHERE entity_kind = ? AND entity_id = ?')
    .all(entityKind, entityId) as { file_name: string }[];
  getDb().prepare('DELETE FROM audio_clips WHERE entity_kind = ? AND entity_id = ?').run(entityKind, entityId);
  return rows.map((r) => r.file_name);
}
