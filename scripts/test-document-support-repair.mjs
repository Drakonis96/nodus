import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--document-support-repair')) process.exit(0);

// Profiles published before passageForQuote required the quote chose a support's passage
// by word overlap, so a citation could open a passage pages away (in a real vault: p. 4
// instead of 12, 150 instead of 159, 5 instead of 278). The once-per-vault repair re-points
// those supports at the passage that holds the quote and leaves every other one alone.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-support-repair-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('w1','W1','Obra','[]','book','text')").run();
  const quote = 'La adición electrofílica al doble enlace sigue la regla de Markovnikov en condiciones estándar';
  const passage = db.prepare("INSERT INTO passages(passage_id,nodus_id,chunk_index,text,char_len,content_hash,created_at,source_ref,page_number) VALUES(?,'w1',?,?,1,'h','now',?,?)");
  passage.run('w1#0', 0, 'regla adición electrofílica doble enlace Markovnikov condiciones estándar sigue', 'fileA', 4);
  passage.run('w1#1', 1, `Texto previo. ${quote}. Texto posterior.`, 'fileA', 12);
  passage.run('w1#2', 2, 'Otra página sin relación con nada de lo citado aquí.', 'fileA', 20);
  const support = db.prepare(`INSERT INTO document_profile_support(support_id,version_id,nodus_id,target_kind,target_id,passage_id,page_start,source_ref,page_start_number,quote,quote_hash,validation_status,created_at)
    VALUES(?,'v1','w1','field','f1',?,?,'fileA',?,?,'q','valid','now')`);
  support.run('wrong', 'w1#0', 'p. 12', 12, quote);             // overlap pick, quote is on p. 12
  support.run('right', 'w1#1', 'p. 12', 12, quote);             // already correct
  support.run('orphan', 'w1#2', 'p. 30', 30, 'Una cita que ningún pasaje actual contiene ya en absoluto.');
  // A quote crossing the end of its chunk: its passage holds only the opening, and no
  // other passage holds more, so it stays.
  passage.run('w1#3', 3, 'Final del fragmento donde empieza la frase citada y', 'fileA', 21);
  passage.run('w1#4', 4, 'continúa en el siguiente fragmento con el resto.', 'fileA', 21);
  support.run('crossing', 'w1#3', 'p. 21', 21, 'donde empieza la frase citada y continúa en el siguiente fragmento con el resto.');

  const { repairDocumentSupportPassagesOnce } = load('electron/ai/documentSupportRepair.ts');
  assert.equal(repairDocumentSupportPassagesOnce(), 1, 'exactly the misplaced support moves');
  const passageOf = id => db.prepare('SELECT passage_id FROM document_profile_support WHERE support_id=?').get(id).passage_id;
  assert.equal(passageOf('wrong'), 'w1#1', 'it now opens the passage that holds its quote');
  assert.equal(passageOf('right'), 'w1#1');
  assert.equal(passageOf('orphan'), 'w1#2', 'a support no passage holds is left as it is');
  assert.equal(passageOf('crossing'), 'w1#3', 'a quote crossing its chunk keeps the passage it starts in');
  assert.equal(repairDocumentSupportPassagesOnce(), null, 'it runs once per vault');
  console.log('Supports pointing away from their quote are re-pointed once; the rest are untouched.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
