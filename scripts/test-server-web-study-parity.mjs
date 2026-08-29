import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const surface = variants(fs.readFileSync(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8'));

test('Study Web surfaces retain Desktop calendar, schedule, review and graph controls', () => {
  for (const marker of [
    'study-calendar-view-',
    'study-calendar-agenda', 'study-agenda',
    'data-testid="vault-schedule"', 'study-review-catalog', 'study-review-session',
    'study-review-rate-', 'study-graph-svg', 'study-graph-search', 'study-graph-edge-type',
  ]) assert.match(surface, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
  assert.match(surface, /api\s*\.studyAgenda/, 'api.studyAgenda');
  assert.match(surface, /SRS.*privad|historial SRS/i, 'the UI must not imply that private SRS data was published');
});

test('published Study review combines cards/questions without exposing SRS state', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-study-review' }, async (server) => {
    const spaceId = await server.createSpace('Estudio');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot({
      vault: { id: 'vault-study', name: 'Estudio', type: 'study' },
      tables: {
        study_questions: [{ id: 'q-1', prompt: '¿Qué es un archivo?', answer_json: '{"text":"Una colección."}', options_json: '[]', tags_json: '[]', type: 'definition', difficulty: 'easy', status: 'approved', deleted_at: null }],
        study_flashcards: [{ id: 'f-1', short_id: 'F1', front: 'Memoria', back: 'Recuerdo', hint: 'Piensa en el pasado', tags_json: '["repaso"]', difficulty: 'medium', archived_at: null, deleted_at: null }],
        study_srs_state: [{ card_id: 'f-1', due_at: '2099-01-01T00:00:00.000Z', mastered: 1 }],
        study_reviews: [{ id: 'review-1', card_id: 'f-1', rating: 5 }],
        study_calendar_events: [{ id: 'event-1', title: 'Entrega', starts_at: '2026-09-01T10:00:00.000Z', event_type: 'assignment' }],
        study_plan_blocks: [{ id: 'block-1', plan_id: 'plan-1', title: 'Lectura', starts_at: '2026-09-02T10:00:00.000Z' }],
      },
    }));
    const get = async (suffix) => (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/${suffix}`)).json();
    const listed = await get('study-review');
    assert.deepEqual(listed.items.map((item) => item.review_key), ['question:q-1', 'flashcard:f-1']);
    assert.equal(listed.progress.published, false);
    assert.equal(Object.hasOwn(listed.items[1], 'due_at'), false);
    const card = await get('study-review/flashcard:f-1');
    assert.equal(card.card.front, 'Memoria');
    assert.equal(card.progress.published, false);
    assert.equal(Object.hasOwn(card.card, 'mastered'), false);
    const agenda = await get('study-agenda?limit=20');
    assert.deepEqual(agenda.events.map((item) => item.id), ['event-1']);
    assert.deepEqual(agenda.blocks.map((item) => item.id), ['block-1']);
  });
});
