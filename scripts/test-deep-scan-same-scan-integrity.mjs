// Two graph defects a single deep pass could write, checked through the real scan with a
// fake local model:
//
//   1. Fusion plans are resolved in parallel, so two ideas of one scan with the same
//      statement under different labels were both planned as new and both created.
//   2. Fusion can map two labels of one scan onto the same existing idea; a relation the
//      model drew between them became an edge from that idea to itself.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--deep-scan-same-scan-integrity')) process.exit(0);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-same-scan-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));

let extraction = null;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const user = parsed.input ?? parsed.messages?.find(m => m.role === 'user')?.content ?? '';
    let payload = null;
    try { payload = JSON.parse(user); } catch { /* not a fusion request */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (payload?.new_idea) {
      // Every idea of the self-loop scenario is the existing hub idea.
      const hub = payload.candidates.find(candidate => candidate.label === 'hub');
      const decision = hub
        ? { resolution: 'same_as', matched_id: hub.global_id, merged_label: 'hub', edge_to_existing: null, rationale: 'misma idea', confidence: 0.9 }
        : { resolution: 'new', matched_id: null, merged_label: payload.new_idea.label, edge_to_existing: null, rationale: 'nueva', confidence: 0.5 };
      res.end(JSON.stringify({ output_text: JSON.stringify(decision), finish_reason: 'stop' }));
      return;
    }
    res.end(JSON.stringify({ output_text: JSON.stringify(extraction), finish_reason: 'stop' }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const settingsRepo = load('electron/db/settingsRepo.ts');
  const worksRepo = load('electron/db/worksRepo.ts');
  const ideasRepo = load('electron/db/ideasRepo.ts');
  const { getDb } = load('electron/db/database.ts');
  const deepScan = load('electron/ai/deepScan.ts');
  const model = { provider: 'lmstudio', model: 'fake-local-model' };
  settingsRepo.updateSettings({
    localProviders: { lmstudio: { baseUrl: `http://127.0.0.1:${server.address().port}` } },
    extractionModel: model, fusionModel: model, synthesisModel: model,
    modelSettingsMode: 'advanced', deepContextMode: 'standard', deepStandardChunkWords: 1800,
  });
  const text = 'La transferencia de conocimiento entre disciplinas produce efectos que ninguna de ellas anticipa por separado. '.repeat(80);
  const work = (id) => {
    worksRepo.upsertWork({ nodus_id: id, zotero_key: id.toUpperCase().slice(0, 8), zotero_version: 1, title: `Obra ${id}`,
      authors: ['Autora'], year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [] });
    return worksRepo.getWork(id);
  };
  const reply = (ideas, internal = []) => ({
    document: { type: 'article', summary: 'sintético' }, ideas, internal_relations: internal,
    external_references: [], gaps: [], authors_detail: [], theme_nodes: [],
  });

  // 1. Same statement under two labels in one scan: one idea.
  const statement = 'La transferencia de conocimiento produce efectos imprevistos.';
  extraction = reply([
    { id: 'i1', label: 'alfa', statement, confidence: 0.8 },
    { id: 'i2', label: 'beta', statement: `  ${statement.toUpperCase()} `, confidence: 0.8 },
  ]);
  await deepScan.runDeepScan(work('dup-work'), { text, sourceType: 'full_text', notes: null }, model);
  const held = getDb().prepare(`SELECT i.global_id, i.statement FROM idea_occurrences o JOIN ideas i ON i.global_id=o.global_id WHERE o.nodus_id='dup-work'`).all();
  assert.equal(held.length, 1, `one idea for one statement (got ${held.length})`);

  // 2. Two labels fused onto the same existing idea, with a relation between them.
  const hub = ideasRepo.createIdea({ type: 'claim', label: 'hub', statement: 'La circulación del conocimiento entre disciplinas vecinas.', embedding: null, themes: [] }).global_id;
  extraction = reply([
    { id: 'i1', label: 'circulación del conocimiento', statement: 'La circulación del conocimiento entre disciplinas vecinas.', confidence: 0.8 },
    { id: 'i2', label: 'conocimiento entre disciplinas', statement: 'El conocimiento circula entre disciplinas vecinas.', confidence: 0.8 },
  ], [{ from: 'i1', to: 'i2', type: 'supports', basis: 'explicit', confidence: 0.8 }]);
  await deepScan.runDeepScan(work('loop-work'), { text, sourceType: 'full_text', notes: null }, model);
  const occurrences = getDb().prepare("SELECT global_id FROM idea_occurrences WHERE nodus_id='loop-work'").all().map(row => row.global_id);
  assert.deepEqual(occurrences, [hub], 'both labels fused onto the existing idea');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM edges WHERE from_id = to_id').get().n, 0, 'no idea is related to itself');
  console.log('A deep pass creates one idea per statement and never relates an idea to itself.');
} finally {
  server.close();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
