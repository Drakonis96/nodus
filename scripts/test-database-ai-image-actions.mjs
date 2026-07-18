import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(repoRoot, 'src/views/DatabasesView.tsx'), 'utf8');

const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const aiCell = between('function AiImageCell(', 'function AiImageAttachmentActions(');
const actions = between('function AiImageAttachmentActions(', 'function AiImageColumnConfig(');
const preview = between('function AttachmentPreview(', 'function AttachmentCell(');
const removal = between('async function removeStoredAttachment(', '/** Metadata panel');

assert.match(aiCell, /<AiImageAttachmentActions/, 'AI image cells render explicit asset actions');
assert.match(actions, /downloadStoredAttachment\(att\)/, 'the visible download action uses the stored attachment');
assert.match(actions, /name="download"/, 'the download control has a recognizable icon');
assert.match(actions, /name="trash"/, 'the delete control has a recognizable icon');
assert.match(actions, /aria-label=\{t\('Descargar'\)\}/, 'download is accessible by name');
assert.match(actions, /aria-label=\{t\('Eliminar'\)\}/, 'delete is accessible by name');

assert.match(removal, /await confirm\(/, 'attachment deletion asks for confirmation');
assert.match(removal, /danger: true/, 'the confirmation is marked destructive');
assert.ok(
  removal.indexOf('await confirm(') < removal.indexOf('deleteDatabaseAttachment(att.id)'),
  'the attachment is deleted only after confirmation'
);
assert.doesNotMatch(preview, /deleteDatabaseAttachment/, 'the preview delegates removal instead of deleting twice');
assert.match(preview, /onClick=\{onRemove\}/, 'the preview uses the same confirmed parent removal path');

console.log('database AI image actions regression test passed');
