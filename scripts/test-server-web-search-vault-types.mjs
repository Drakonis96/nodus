import assert from 'node:assert/strict';
import test from 'node:test';
import { lexicalSearch } from '../server/lib/core/search.mjs';

// The Web search endpoint is shared by every vault mode. This small contract test
// keeps a future academic-only refactor from making the other Desktop workspaces
// look empty again.
const cases = [
  ['worldbuilding', 'world_groups', { group_id: 'g1', name: 'Casa del Alba', summary: 'Una facción' }],
  ['estudio', 'study_courses', { id: 'c1', name: 'Historia del arte', description: 'Curso anual' }],
  ['docencia', 'teaching_exams', { id: 'e1', title: 'Examen de historia', instructions: 'Responde' }],
  ['primary_sources', 'archive_items', { item_id: 'a1', title: 'Archivo municipal', description: 'Fuente primaria' }],
  ['testimonios', 'testimony_interviews', { id: 'i1', title: 'Entrevista a Alba', summary: 'Memoria oral' }],
  ['databases', 'db_databases', { id: 'd1', name: 'Inventario', description: 'Registros catalogados' }],
  ['genealogy', 'persons', { person_id: 'p1', display_name: 'Alba Pérez', biography: 'Persona documentada' }],
];

test('global search indexes every published vault family with stable ids', () => {
  for (const [vaultType, table, row] of cases) {
    const identity = String(row.id ?? row.person_id ?? row.group_id ?? row.item_id ?? row.nodus_id);
    const query = String(Object.values(row).find((value) => typeof value === 'string' && String(value) !== identity));
    const results = lexicalSearch({ tables: { [table]: [row] } }, query, 50);
    assert.equal(results.length, 1, `${vaultType} must return a result from ${table}`);
    assert.equal(results[0].id, String(row.id ?? row.person_id ?? row.group_id ?? row.item_id ?? row.nodus_id));
    assert.equal(results[0].type, table);
    assert.ok(results[0].title, `${vaultType} result needs a display title`);
  }
});

test('specialized search preserves archive domain keys and testimony text fields', () => {
  const archive = lexicalSearch({ tables: { archive_excerpts: [{ excerpt_id: 'ex-1', quoted_text: 'Memoria del puerto' }] } }, 'puerto', 50);
  assert.equal(archive[0]?.id, 'ex-1');
  const testimony = lexicalSearch({ tables: { testimony_transcripts: [{ id: 'tr-1', content_markdown: 'La plaza estaba llena' }] } }, 'plaza', 50);
  assert.equal(testimony[0]?.id, 'tr-1');
});
