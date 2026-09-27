// The vault Library's index button carries the document's index state in its colour
// and says what pressing it will do: green when indexed (reindex), orange when not yet
// indexed or on its way (index), red when indexing failed (retry).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-action-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'action.cjs');
await build({ entryPoints: [path.join(repo, 'src/libraryIndexAction.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { libraryIndexAction } = createRequire(import.meta.url)(outfile);
const state = patch => ({ documentId: 'd', revision: 'r', text: 'available', lexical: 'ready', embeddings: 'ready', status: 'ready', reason: null, error: null, passages: 3, embedded: 3, ...patch });

test('indexed, not indexed, indexing and failed each read differently', () => {
  assert.deepEqual(libraryIndexAction(state({})), { tone: 'green', label: 'Reindexar documento', busy: false });
  assert.deepEqual(libraryIndexAction(undefined), { tone: 'orange', label: 'Indexar documento', busy: false });
  assert.deepEqual(libraryIndexAction(state({ lexical: 'missing', embeddings: 'missing', status: 'catalogued', text: 'missing' })), { tone: 'orange', label: 'Indexar documento', busy: false });
  assert.deepEqual(libraryIndexAction(state({ embeddings: 'stale' })), { tone: 'orange', label: 'Indexar documento', busy: false }, 'an outdated index needs indexing again');
  assert.deepEqual(libraryIndexAction(state({ embeddings: 'running', status: 'running' })), { tone: 'orange', label: 'Indexando…', busy: true });
  assert.deepEqual(libraryIndexAction(state({ embeddings: 'queued', status: 'queued' })), { tone: 'orange', label: 'Indexando…', busy: true });
  assert.deepEqual(libraryIndexAction(state({ embeddings: 'failed', status: 'failed', error: 'provider' })), { tone: 'red', label: 'Reintentar indexado', busy: false });
  assert.deepEqual(libraryIndexAction(state({ embeddings: 'missing', status: 'blocked', reason: 'no_model' })), { tone: 'red', label: 'Reintentar indexado', busy: false }, 'a blocked job needs the user');
});
