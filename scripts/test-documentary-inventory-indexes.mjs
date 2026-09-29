import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-inventory-indexes')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-inventory-indexes-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));

// Research Chat froze the window for 3.6–5.3 s per question on a library of 1,229 sources:
// the preparation inventory read every revision's text and chunk JSON (327 MB), scanned the
// revisions and requests tables once per source, and parsed chunks just to count them.
try {
  const store = load('electron/ai/documentaryPreparation.ts').documentaryStore();
  const plan = sql => store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail).join(' | ');
  const revisions = plan("SELECT index_key,identity_json,embedding_ready,lexical_ready FROM documentary_revisions WHERE document_id='d' AND json_extract(identity_json,'$.revision')='r' ORDER BY embedding_ready DESC,created_at DESC");
  assert.match(revisions, /COVERING INDEX documentary_revisions_document/, `a source's revisions are read from a covering index, never from rows holding their text (${revisions})`);
  const requests = plan("SELECT state,error,revision FROM documentary_requests WHERE document_id='d' OR source_id='d' ORDER BY updated_at DESC LIMIT 1");
  assert.match(requests, /documentary_requests_source/, `a source's requests are found by index, not by scanning the table (${requests})`);
  const source = fs.readFileSync(path.join(repoRoot, 'electron/ai/documentaryPreparation.ts'), 'utf8');
  assert.doesNotMatch(source, /SELECT \* FROM documentary_revisions WHERE document_id/, 'revision lookups never select the text and chunk columns');
  assert.doesNotMatch(source, /JSON\.parse\(row\.chunks_json\)/, 'the inventory counts chunks without parsing them in the main process');
  console.log('Documentary inventory lookups stay on indexes and never load revision text.');
} finally {
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  fs.rmSync(root, { recursive: true, force: true });
}
