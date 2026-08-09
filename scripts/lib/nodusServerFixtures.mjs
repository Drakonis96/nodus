// A small academic snapshot, hand-built, plus the helpers to publish it.
//
// Deliberately not generated from SQLite: these suites are about the SERVER's behaviour, and
// a hand-written payload makes it obvious what each assertion is reading. The parity between
// this shape and what the desktop actually produces is pinned separately, by
// scripts/test-server-debates-parity.mjs, which runs the real buildServerSnapshot().

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/** A one-pixel PNG. Small, real, and correctly sniffed as an image. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A minimal WAV. It opens with RIFF, exactly like WEBP, and must still be refused. */
export const WAV_BYTES = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0]),
  Buffer.from('data'), Buffer.from([0, 0, 0, 0]),
]);

export const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'), Buffer.alloc(64, 0x20)]);

/** A minimal but genuinely decodable WEBP header, to prove the RIFF check is not a blanket ban. */
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([26, 0, 0, 0]), Buffer.from('WEBPVP8 '),
  Buffer.from([14, 0, 0, 0]), Buffer.alloc(14, 0x30),
]);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function academicSnapshot(overrides = {}) {
  const tables = {
    works: [
      { nodus_id: 'w-1', zotero_key: 'K1', title: 'Memoria y archivo', authors_json: JSON.stringify(['Alba, Rosa']), year: 1998, item_type: 'book', archived: 0, deep_status: 'done' },
      { nodus_id: 'w-2', zotero_key: 'K2', title: 'Contra el archivo', authors_json: JSON.stringify(['Bravo, Iván']), year: 2021, item_type: 'article', archived: 0, deep_status: 'done' },
    ],
    authors: [
      { author_id: 'a-1', name: 'Alba, Rosa', affiliation: 'Universidad A' },
      { author_id: 'a-2', name: 'Bravo, Iván', affiliation: 'Universidad B' },
    ],
    work_authors: [
      { nodus_id: 'w-1', author_id: 'a-1', role: 'author' },
      { nodus_id: 'w-2', author_id: 'a-2', role: 'author' },
    ],
    ideas: [
      { global_id: 'i-a', type: 'claim', label: 'Tesis A', statement: 'El archivo determina la memoria.', created_at: '2026-01-01T00:00:00.000Z' },
      { global_id: 'i-b', type: 'claim', label: 'Tesis B', statement: 'La memoria precede al archivo.', created_at: '2026-01-01T00:00:00.000Z' },
      { global_id: 'i-c', type: 'claim', label: 'Tesis C', statement: 'Se coproducen.', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    idea_occurrences: [
      { global_id: 'i-a', nodus_id: 'w-1', role: 'principal', development: 'Desarrollo A.', confidence: 0.9 },
      { global_id: 'i-b', nodus_id: 'w-2', role: 'principal', development: 'Desarrollo B.', confidence: 0.8 },
      { global_id: 'i-c', nodus_id: 'w-2', role: 'secondary', development: 'Desarrollo C.', confidence: 0.7 },
    ],
    evidence: [
      { id: 'ev-1', global_id: 'i-a', nodus_id: 'w-1', quote: 'Una cita literal sobre el archivo.', location: 'p. 12', kind: 'quote' },
    ],
    themes: [
      { theme_id: 't-1', label: 'Memoria', created_at: '2026-01-01T00:00:00.000Z' },
      { theme_id: 't-2', label: 'Archivo', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    idea_theme_links: [
      { nodus_id: 'w-1', global_id: 'i-a', theme_id: 't-1', confidence: 0.9, basis: 'llm' },
      { nodus_id: 'w-2', global_id: 'i-b', theme_id: 't-1', confidence: 0.8, basis: 'llm' },
    ],
    edges: [
      { id: 'e-ab', from_id: 'i-a', to_id: 'i-b', type: 'contradicts', basis: 'llm', confidence: 0.8, source_work: 'w-1' },
      { id: 'e-bc', from_id: 'i-b', to_id: 'i-c', type: 'refutes', basis: 'llm', confidence: 0.5, source_work: 'w-2' },
      { id: 'e-sup', from_id: 'i-c', to_id: 'i-a', type: 'supports', basis: 'llm', confidence: 0.6, source_work: null },
      { id: 'e-hidden', from_id: 'i-a', to_id: 'i-c', type: 'contradicts', basis: 'llm', confidence: 0.99, source_work: null },
    ],
    // Stored reversed on purpose: the view suppresses a vetoed pair in both directions.
    edge_feedback: [
      { from_id: 'i-c', to_id: 'i-a', type: 'contradicts', verdict: 'rejected', note: '', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    gaps: [
      { id: 'g-1', nodus_id: 'w-1', related_idea: 'i-a', kind: 'evidence', statement: 'Falta trabajo de campo.', confidence: 0.6, evidence_id: null },
    ],
    passages: [
      { passage_id: 'p-1', nodus_id: 'w-1', chunk_index: 0, text: 'Un pasaje citable sobre memoria y archivo.', page_label: '12', char_len: 42, content_hash: 'h1', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    notes: [
      { id: 'n-1', folder_id: null, title: 'Nota de trabajo', kind: 'markdown', content: 'Texto largo de la nota.', source_json: null, order_idx: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    note_folders: [],
    writing_saved_drafts: [
      {
        id: 'dr-1',
        title: 'Informe sobre el archivo',
        brief_json: JSON.stringify({ kind: 'deep_research', objective: 'Estado de la cuestión', language: 'es' }),
        selection_json: '{}',
        model_json: '{}',
        draft_json: JSON.stringify({ title: 'Informe sobre el archivo', draftMarkdown: '## Resumen\nTexto.', bibliography: [] }),
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'dr-2',
        title: 'Borrador normal',
        brief_json: JSON.stringify({ kind: 'section' }),
        selection_json: '{}', model_json: '{}', draft_json: '{}',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    writing_draft_annotations: [
      {
        id: 'ann-1', draft_id: 'dr-1', scope: 'source', kind: 'highlight', color: 'yellow',
        start_offset: 0, end_offset: 5, selected_text: 'Texto', prefix: '', suffix: '.',
        comment_text: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    immersion_sessions: [
      { id: 'im-1', topic: 'Archivo', title: 'Inmersión en el archivo', language: 'es', minutes: 20, model_json: '{}', plan_json: JSON.stringify({ stations: [] }), progress_json: '{}', stats_json: JSON.stringify({ stations: 3 }), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    saved_searches: [],
    research_questions: [],
    ...(overrides.tables ?? {}),
  };

  const assets = overrides.assets ?? [];
  const payload = {
    format: 'nodus.server-snapshot',
    formatVersion: 2,
    generatedAt: '2026-02-01T00:00:00.000Z',
    schemaVersion: overrides.schemaVersion ?? 121,
    vault: overrides.vault ?? { id: 'vault-1', name: 'Corpus de prueba', type: 'academic' },
    capabilities: { includesUserContent: true, includesPassages: true, hasAssets: assets.length > 0 },
    assets,
    tables,
  };
  const revision = createHash('sha256').update(JSON.stringify({ vault: payload.vault, assets, tables })).digest('base64url');
  return { payload, revision, gzipped: gzipSync(Buffer.from(JSON.stringify(payload))) };
}

export async function publish(origin, token, spaceId, snapshot) {
  const response = await fetch(`${origin}/api/v1/spaces/${spaceId}/snapshot`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/vnd.nodus.snapshot+json',
      'content-encoding': 'gzip',
      'x-nodus-revision': snapshot.revision,
    },
    body: snapshot.gzipped,
  });
  const value = await response.json();
  assert.equal(response.status, 200, `publish failed: ${JSON.stringify(value)}`);
  return value;
}
