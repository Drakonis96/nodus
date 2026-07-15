import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [library, ideas, gaps, authors, worksRepo, ideasRepo, types, ipc, preload] = await Promise.all([
  read('src/views/Library.tsx'),
  read('src/views/IdeasView.tsx'),
  read('src/views/GapsView.tsx'),
  read('src/views/AuthorsView.tsx'),
  read('electron/db/worksRepo.ts'),
  read('electron/db/ideasRepo.ts'),
  read('shared/types.ts'),
  read('electron/ipc.ts'),
  read('electron/preload.ts'),
]);

assert.match(library, /listWorksPage\(filter/, 'Library must request bounded pages');
assert.equal(library.includes('window.nodus.listWorks(filter)'), false, 'Library must not transfer every filtered work');
assert.match(library, /getWorkEmbeddingStatuses\(ids\)/, 'embedding status must be scoped to the visible page');
assert.match(library, /getWorkPassageStatuses\(ids\)/, 'passage status must be scoped to the visible page');
assert.match(worksRepo, /LIMIT @pageLimit OFFSET @pageOffset/, 'works must be paginated inside SQLite');
assert.match(worksRepo, /Math\.min\(250,/, 'works endpoint must enforce a server-side page cap');

assert.match(ideas, /listIdeasPage\(/, 'Ideas must use its compact list endpoint');
assert.equal(ideas.includes("getGraph('ideas')"), false, 'Ideas list must not transfer the full graph');
assert.match(ideas, /listIdeaConnections\(selectedId\)/, 'connections must load only for the selected idea');
assert.match(ideasRepo, /LIMIT @limit OFFSET @offset/, 'ideas must be paginated inside SQLite');

assert.match(gaps, /getGapsPage\(/, 'Gaps must request a bounded page');
assert.equal(gaps.includes('window.nodus.getGaps()'), false, 'Gaps view must not transfer every aggregate');
assert.equal(gaps.includes('window.nodus.getContradictions()'), false, 'Gaps view only needs a contradiction count');
assert.match(authors, /listAuthorsPage\(/, 'Authors must render a bounded page');

for (const channel of ['works:listPage', 'ideas:listPage', 'ideas:connections', 'gaps:listPage', 'authors:listPage']) {
  assert.ok(ipc.includes(channel), `${channel} must be registered`);
  assert.ok(preload.includes(channel), `${channel} must be exposed`);
}
for (const contract of ['WorkPage', 'IdeaPage', 'GapPage', 'AuthorPage']) {
  assert.ok(types.includes(`interface ${contract}`), `${contract} must be typed`);
}

console.log('Pagination performance regression checks passed.');
