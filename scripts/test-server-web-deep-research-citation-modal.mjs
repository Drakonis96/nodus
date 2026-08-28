import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Deep Research citations open a safe embedded workspace with tabs', () => {
  const modal = read('src/serverWeb/ServerCitationModal.tsx');
  const personal = read('src/serverWeb/PersonalViews.tsx');
  const explorer = read('src/serverWeb/academic/AcademicDetailExplorer.tsx');
  const readers = read('src/serverWeb/readers.tsx');

  assert.match(modal, /export function parseServerCitation/);
  assert.ok(modal.includes('nodus:\\/\\/'));
  assert.match(modal, /idea\|work\|author\|gap\|passage\|theme\|contradiction/);
  assert.match(modal, /data-testid="server-citation-modal"/);
  assert.match(modal, /data-testid="server-citation-tabs"/);
  assert.match(modal, /data-testid=\{`server-citation-tab-/);
  assert.match(modal, /data-testid="server-citation-close"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /onClick=\{onClose\}/);
  assert.match(modal, /onOpenTarget=\{onOpen\}/);
  assert.match(explorer, /onOpenTarget\?:/);
  assert.match(explorer, /if \(onOpenTarget\) \{ onOpenTarget\(next\); return; \}/);
  assert.match(readers, /onNodusLink\?: \(href: string\) => boolean \| void/);
  assert.match(readers, /onNodusLink\(href\) === false && internalHref/);
  assert.match(personal, /parseServerCitation\(href\)/);
  assert.match(personal, /<ServerCitationModal spaceId=\{spaceId\} target=\{citation\}/);
});
