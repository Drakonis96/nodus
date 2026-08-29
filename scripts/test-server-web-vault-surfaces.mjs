import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const readSource = (file) => readFile(path.join(root, file), 'utf8').then(variants);

test('server web keeps non-academic views on their Desktop presentation contracts', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  for (const [id, marker] of [
    ['genealogy-timeline', 'vault-timeline'],
    ['genealogy-tree', 'vault-tree'],
    ['genealogy-map', 'vault-map'],
    ['study-calendar', 'vault-calendar'],
    ['study-schedule', 'vault-schedule'],
    ['study-graph', 'vault-network'],
    ['world-manuscript', 'vault-manuscript'],
    ['prosopography-networks', 'vault-network'],
    ['teaching-grades', 'vault-analysis'],
  ]) {
    assert.match(source, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${id} has a dedicated surface descriptor`);
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${id} has its presentation marker`);
  }
  assert.match(source, /timeline:\s*'genealogy-timeline'/);
  assert.match(source, /tree:\s*'genealogy-tree'/);
  assert.match(source, /studyCalendar:\s*'study-calendar'/);
  assert.match(source, /manuscript:\s*'world-manuscript'/);
  assert.doesNotMatch(source, /timeline:\s*'events'.*tree:\s*'relationships'/s);
  for (const collection of ['world-maps', 'study-calendar', 'teaching-exams', 'archive-items', 'testimony-interviews']) {
    assert.match(corpus, new RegExp(`['"]${collection}['"]`), `${collection} is a published server collection`);
  }
});

test('server web preserves published collection keys and never fabricates map data', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  assert.match(source, /['"]study-calendar['"]:\s*['"]events['"]/,
    'the study calendar reads the published events key');
  assert.doesNotMatch(source, /index \* 37|index \* 71|\?\? \(index \*/,
    'maps must not manufacture coordinates from row indexes');
  assert.match(source, /No hay coordenadas publicadas; no se muestran marcadores/,
    'an empty map is explicit when the published rows have no coordinates');
});

test('teaching privacy surfaces remain empty and do not alias public collections', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  for (const surface of ['teaching-groups', 'teaching-grades', 'teaching-units']) {
    const descriptor = source.slice(source.indexOf(`'${surface}':`), source.indexOf(`'${surface}':`) + 520);
    assert.match(descriptor, /published:\s*false/, `${surface} is explicitly private`);
    assert.match(descriptor, /privateNotice:/, `${surface} tells the reader why it is empty`);
  }
  assert.doesNotMatch(source, /'teaching-groups':\s*\{\s*collection:\s*'study-courses'/);
  assert.doesNotMatch(source, /'teaching-grades':\s*\{\s*collection:\s*'teaching-rubrics'/);
  assert.doesNotMatch(source, /'teaching-units':\s*\{\s*collection:\s*'teaching-exams'/);
});

test('factions, cultures and dynasties keep Desktop labels and kind facets', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  assert.match(source, /factions:\s*\{[^}]*label:\s*'Facciones'[^}]*kinds:\s*\['faction',\s*'order',\s*'religion'\]/s);
  assert.match(source, /cultures:\s*\{[^}]*label:\s*'Culturas'[^}]*kinds:\s*\['culture',\s*'species',\s*'language'\]/s);
  assert.match(source, /dynasties:\s*\{[^}]*label:\s*'Dinastías'[^}]*kinds:\s*\['house'\]/s);
  assert.match(source, /groupView\.kinds\.includes\(String\(row\.kind\)\)/);
  assert.match(source, /'world-groups':\s*\{[^}]*C\('kind',\s*'Tipo'/s);
});

test('world maps and nonstandard record keys keep reloadable Web details', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(source, /row\.map_id/, 'map rows use their real primary key when opening a tab');
  assert.match(source, /row\.rel_id/, 'relationship rows use their real primary key when opening a tab');
  assert.match(source, /data-testid="vault-world-maps"/, 'world maps have a dedicated atlas catalogue');
  assert.match(source, /api\.assetUrl\(spaceId, hash\)/, 'published map thumbnails use the asset channel');
  assert.match(corpus, /relationships:\s*\{\s*table:\s*'relationships',\s*key:\s*'relationships',\s*id:\s*'rel_id'/);
  assert.match(corpus, /head === 'world-maps'[\s\S]{0,80}publishedWorldMaps\(snapshot\)/);
  assert.match(corpus, /travelModes:\s*rows\(snapshot, 'map_travel_modes'\)/);
  assert.match(corpus, /rows\(snapshot, 'map_markers'\)[\s\S]*?\.filter\(/, 'map detail must preserve published markers instead of dropping the workbench layer');
});

test('worldbuilding and genealogy home surfaces keep domain metrics and social privacy exact', async () => {
  const source = await readSource('src/serverWeb/App.tsx');
  const vaults = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(source, /data-testid="worldbuilding-overview"/, 'worldbuilding home has its own metrics surface');
  assert.match(source, /data-testid="genealogy-overview"/, 'genealogy home has its own metrics surface');
  assert.match(source, /Protagonistas/, 'worldbuilding home preserves character-role metric');
  assert.match(source, /Vínculos de parentesco/, 'genealogy home labels kinship separately');
  assert.match(vaults, /social-relations.*published: false/s, 'social graph remains private when its source tables are not published');
  assert.match(vaults, /view === 'relations'.*social-relations/s, 'relations route never aliases kinship rows');
  assert.match(corpus, /head === 'world-entries'/, 'encyclopedia is an aggregate publication projection');
  assert.match(corpus, /kind === 'conflict'/, 'aggregate index keeps conflicts as world entries');
  assert.match(vaults, /collection === 'world-entries'\) return value\(row\.key/, 'encyclopedia opens aggregate details by their kind:id key');
  assert.match(vaults, /onNodusLink=\{openNodusLink\}/, 'encyclopedia keeps nodus links navigable inside the published aggregate');
  assert.match(vaults, /'world-maps': 'map_id'/, 'world maps prefer map_id over their related place_id');
  assert.match(vaults, /events: 'event_id'/, 'events prefer event_id over their related place_id');
});

test('worldbuilding catalogues and dossiers preserve the Desktop domain presentations', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  for (const marker of ['characters-grid', 'character-card', 'places-tree', 'world-groups-grid', 'encyclopedia-grid']) {
    assert.match(source, new RegExp(`data-testid=["']${marker}["']`), `${marker} is a dedicated worldbuilding presentation`);
  }
  assert.match(source, /view === 'characters'.*variant: 'characters'/s);
  assert.match(source, /view === 'places'.*variant: 'place-tree'/s);
  assert.match(source, /view === 'encyclopedia'.*variant: 'encyclopedia'/s);
  assert.match(source, /data-testid="place-sheet"/);
  assert.match(source, /data-testid="world-group-sheet"/);
  assert.match(source, /data-testid="character-dossier"/);
  assert.match(source, /Arco narrativo/);
  assert.match(source, /Capacidades y límites/);
  assert.match(source, /Latidos, reglas e hilos/);
  assert.match(corpus, /publishedWorldImages/);
  assert.match(corpus, /abilities: involved\('character_abilities'/);
  assert.match(corpus, /scenes: rows\(snapshot, 'world_scenes'\)/);
  assert.match(corpus, /profile: rows\(snapshot, 'place_profiles'\)/);
  assert.match(corpus, /affiliations: affiliations|affiliations,/);
  assert.match(corpus, /cast: rows\(snapshot, 'scene_characters'\)/);
});

test('shared world surfaces keep the exact Desktop route labels', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const app = await readSource('src/serverWeb/App.tsx');
  assert.match(source, /view === 'timeline'[^\n]*vaultType === 'worldbuilding' \? 'Cronología' : 'Línea temporal'/);
  assert.match(source, /view === 'map'[^\n]*label: 'Mapa'/);
  assert.match(source, /view === 'relations'[^\n]*vaultType === 'worldbuilding' \? 'Relaciones' : 'Relaciones sociales'/);
  assert.match(source, /view === 'tree'[^\n]*vaultType === 'genealogy' \? 'Árbol genealógico' : 'Familias'/);
  assert.match(source, /view === 'conflicts'[^\n]*label: 'Conflictos'/);
  assert.match(source, /view === 'arcs'[^\n]*label: 'Arcos narrativos'/);
  assert.match(app, /<VaultSurfaceView[^>]*vaultType=\{type\}/, 'App passes vault type to shared surfaces');
});

test('study schedule, archive dossiers and testimony dossiers use canonical nested contracts', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(corpus, /'study-schedule':\s*\{\s*table:\s*'study_schedule_periods'/);
  assert.match(corpus, /head === 'study-schedule'/);
  assert.match(corpus, /head === 'archive-items'/);
  assert.match(corpus, /head === 'testimony-interviews'/);
  assert.match(source, /function nestedCollection/);
  assert.match(source, /calendar:\s*'study-calendar'/);
  assert.match(source, /transcripts:\s*'testimony-transcripts'/);
  assert.match(source, /excerpts:\s*'archive-excerpts'/);
});

test('genealogy person details resolve human-readable family dossiers', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(source, /data-testid="person-dossier"/);
  assert.match(source, /Relaciones familiares/);
  assert.match(corpus, /relatedPersons: publishedPersons\(snapshot\)/);
  assert.match(corpus, /placeLinks,/);
});

test('Markdown keeps only the internal Nodus protocol available to navigation handlers', async () => {
  const reader = await readSource('src/serverWeb/readers.tsx');
  assert.match(reader, /defaultUrlTransform/);
  assert.match(reader, /url\.startsWith\('nodus:\/\/'\) \? url : defaultUrlTransform\(url\)/);
  assert.match(reader, /serverHrefForNodus/);
  assert.match(reader, /detail\/encyclopedia\/world-entries/);
  assert.match(reader, /detail\/studyLibrary\/study-docs/);
  assert.match(reader, /detail\/studyLibrary\/study-materials/);
  assert.match(reader, /view\/studyRecordings/);
  assert.match(reader, /detail\/testimonyInterviews\/testimony-interviews/);
  assert.match(reader, /detail\/testimonyContrasts\/testimony-contrasts/);
  assert.match(reader, /testimony\[1\] === 'participant'\) return null/);
  assert.match(reader, /detail\/archive\/archive-items/);
  assert.match(reader, /excerpt=/);
});

test('teaching catalogues never expose implementation JSON and retain Desktop document shapes', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(source, /'teaching-exams':[^\n]*variant:\s*'exam'/);
  assert.match(source, /data-testid="vault-exams"/);
  assert.match(source, /data-testid="exam-card"/);
  assert.match(source, /function ExamDetail/);
  assert.match(source, /data-testid="rubric-detail"/);
  assert.match(source, /function RubricDetail/);
  assert.doesNotMatch(source, /teaching-exams':[^\n]*C\('header_json'/);
  assert.doesNotMatch(source, /teaching-rubrics':[^\n]*C\('criteria_json'/);
  assert.match(corpus, /head === 'teaching-exams'[\s\S]*?subject_name/);
  assert.match(corpus, /head === 'teaching-rubrics'[\s\S]*?criteria_count/);
});

test('specialized published dossiers keep their Desktop reading hierarchy', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  assert.match(source, /function StudyMaterialDetail/);
  assert.match(source, /data-testid="study-material-detail"/);
  assert.match(source, /function ArchiveItemDetail/);
  assert.match(source, /data-testid="archive-item-dossier"/);
  assert.match(source, /function TestimonyInterviewDetail/);
  assert.match(source, /data-testid="testimony-interview-dossier"/);
  assert.match(source, /function TestimonyTranscriptDetail/);
  assert.match(source, /data-testid="testimony-transcript-detail"/);
  assert.match(source, /function DatabasePageDetail/);
  assert.match(source, /data-testid="database-page-detail"/);
  assert.match(corpus, /publishedStudyLibraryRows/);
  assert.match(corpus, /source_kind.*'document'/);
  assert.match(corpus, /head === 'database-pages'.*page_blocks/s);
  assert.match(corpus, /publishedTestimonyTranscripts/);
  assert.match(corpus, /media_id.*_mediaId/);
  assert.match(corpus, /head === 'testimony-transcripts'.*segments/s);
});

test('study question bank keeps answers in the opened sheet, not in the catalogue', async () => {
  const source = await readSource('src/serverWeb/vaults/index.tsx');
  assert.match(source, /variant: 'question-bank'/);
  assert.match(source, /data-testid="study-question-bank-catalog"/);
  assert.match(source, /data-testid="study-question-detail"/);
  assert.match(source, /STUDY_QUESTION_TYPE_LABEL/);
  assert.doesNotMatch(source, /'study-questions':[^\n]*C\('answer_json'/);
  assert.doesNotMatch(source, /'study-review':[^\n]*C\('answer_json'/);
});
