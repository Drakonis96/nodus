import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), 'utf8'));

test('Academic parity matrix names every Desktop surface and its Server renderer', () => {
  const matrix = read('docs/server-web-academic-parity.md');
  const desktop = read('src/navigation.ts');
  const app = read('src/serverWeb/App.tsx');
  const serverFiles = [
    'src/serverWeb/academic/SearchServerView.tsx',
    'src/serverWeb/advanced/AdvancedWorkspace.tsx',
    'src/serverWeb/AcademicToolsServerView.tsx',
    'src/serverWeb/StateOfArtServerView.tsx',
    'src/serverWeb/PersonalViews.tsx',
    'src/serverWeb/settings/ServerSettingsView.tsx',
  ].map(read).join('\n');
  const academicViews = [
    'search', 'library', 'graph', 'argument', 'ideas', 'authors', 'dictionary', 'immersion',
    'research', 'hypothesis', 'reading', 'deepResearch', 'workspace',
  ];
  for (const view of academicViews) {
    assert.match(desktop, new RegExp(`['"]${view}['"]`), `Desktop navigation must keep ${view}`);
    assert.match(matrix, new RegExp(`\\|[^\\n]*${view === 'deepResearch' ? 'Deep Research' : view === 'research' ? 'Estado triple' : view}[^\\n]*\\|`), `${view} must be audited in the matrix`);
  }
  for (const marker of ['SearchServerView', 'LibraryView', 'GraphServerView', 'ArgumentView', 'IdeasServerView', 'AuthorsServerView', 'DictionaryServerView', 'ImmersionView', 'StateOfArtServerView', 'HypothesisView', 'ReadingView', 'DeepResearchServerView', 'PrivateNotesServerView', 'ServerSettingsView']) {
    assert.match(serverFiles + app, new RegExp(marker), `Server renderer ${marker} must exist`);
  }
});

test('Academic publication boundary keeps classroom private data out of the web contract', () => {
  const corpus = read('server/lib/routes/corpus.mjs');
  const manifest = read('docs/server-web-design-parity.md');
  assert.match(corpus, /Teaching materials[\s\S]*?Rosters, groups and grades are not published/);
  assert.doesNotMatch(corpus, /'teaching-(?:groups|grades|assessment)'\s*:/);
  assert.match(manifest, /solo lectura|read-only|privad/i);
});

test('Server Academic search is explicitly truthful about lexical fallback', () => {
  const search = read('src/serverWeb/academic/SearchServerView.tsx');
  assert.match(search, /response\.mode/);
  assert.match(search, /mode === 'semantic' && serverMode !== 'semantic'/);
  assert.match(search, /búsqueda por significado necesita embeddings/);
  assert.match(search, /Configura el proveedor y la clave de embeddings/);
});

test('Search opens published academic details instead of the generic record card', () => {
  const search = read('src/serverWeb/academic/SearchServerView.tsx');
  const corpus = read('server/lib/routes/corpus.mjs');
  for (const collection of ['passages', 'themes', 'gaps']) {
    assert.match(search, new RegExp(`'${collection}'`), `${collection} has a dedicated detail target`);
    assert.match(corpus, new RegExp(`head === '${collection}'`), `${collection} has a published detail route`);
  }
  assert.match(search, /data-testid="academic-search-record-detail"/);
  assert.doesNotMatch(search, /PublishedAcademicDetail[\s\S]{0,500}DetailView/);
});

test('Library and Deep Research expose the published projection with stable DOM hooks', () => {
  const library = read('src/serverWeb/LibraryServerView.tsx');
  const api = read('src/serverWeb/api.ts');
  const types = read('src/serverWeb/types.ts');
  const serverApi = read('server/lib/routes/api.mjs');
  const personal = read('src/serverWeb/PersonalViews.tsx');
  for (const marker of ['library-search', 'library-collection-filter', 'library-refresh', 'library-document-row']) {
    assert.match(library, new RegExp(`data-testid="${marker}"`), `${marker} is testable`);
  }
  assert.match(library, /collectionId/);
  assert.match(library, /hasMore/);
  assert.match(api, /request<LibraryPageResponse>/);
  assert.match(types, /export type LibraryPageResponse = PageResponse/);
  assert.match(serverApi, /total: all\.length, limit, offset, hasMore/);
  assert.match(personal, /deep-research-report-image/);
  assert.match(personal, /deep-research-next-steps/);
  assert.match(personal, /deep-research-limitations/);
  assert.match(personal, /data-testid="deep-research-bookmark"/);
  assert.match(personal, /deep-research-translations/);
  assert.match(personal, /Imprimir \/ exportar/);
  assert.match(personal, /deepResearchDocumentUrl/);
  assert.match(personal, /deepResearchPdfUrl/);
  assert.match(personal, /deep-research-private-composer/);
  assert.match(personal, /api\.runAI\(\s*spaceId,\s*["']deep-research["']/);
  assert.match(personal, /kind: ["']deep-research["']/);
  assert.match(personal, /deep-research-private-delete/);
  assert.match(personal, /ErrorNotice error=\{error\}/);
});

test('Academic mutability audit separates private actions from snapshot mutations', () => {
  const audit = read('docs/server-web-academic-mutability-audit.md');
  assert.match(audit, /Deep Research · generación/);
  assert.match(audit, /Estado de la cuestión · triple vista/);
  assert.match(audit, /Workspace/);
  assert.doesNotMatch(audit, /^\| (?:Escritura|Proyectos) \|/m);
  assert.match(audit, /PDF binario.*pdf-lib/);
});

test('Dictionary keeps Desktop table/dossier semantics and private CRUD isolated', () => {
  const personal = read('src/serverWeb/PersonalViews.tsx');
  const corpus = read('server/lib/routes/corpus.mjs');
  assert.match(personal, /data-testid="dictionary-view"/);
  assert.match(personal, /data-testid="dictionary-new"/);
  assert.match(personal, /api\.createArtifact\(\s*\{\s*vaultId: spaceId,\s*kind: ["']dictionary-entry["']/);
  assert.match(personal, /api\.updateArtifact\(\s*activeId/);
  assert.match(personal, /api\.deleteArtifact\(\s*activeId/);
  assert.match(personal, /api\.detail\(\s*spaceId,\s*["']dictionary["']/);
  assert.match(personal, /metadata: \{ private: true, surface: ["']dictionary["']/);
  assert.match(corpus, /head === 'dictionary'/);
  assert.match(corpus, /dictionary_evidence/);
  assert.match(corpus, /dictionary_relations/);
  assert.match(corpus, /dictionary_versions/);
});

test('Deep Research can generate account-private translations beside published ones', () => {
  const personal = read('src/serverWeb/PersonalViews.tsx');
  assert.match(personal, /surface === ["']translation["']/);
  assert.match(personal, /reportId/);
  assert.match(personal, /deep-research-private-translation-composer/);
  assert.match(personal, /Nueva traducción privada/);
  assert.match(personal, /kind: ["']deep-research["']/);
  assert.match(personal, /entry\.privateArtifact === true/);
  assert.match(personal, /modifica el vault/i);
});

test('Deep Research keeps the Desktop reader ribbon grouped and honest on Server', () => {
  const personal = read('src/serverWeb/PersonalViews.tsx');
  const css = read('src/serverWeb/serverDesktop.css');
  for (const marker of [
    'deep-research-section-header', 'deep-research-gallery-toolbar', 'deep-research-gallery',
    'deep-research-reader-toolbar', 'deep-research-draft-actions', 'deep-research-font-controls',
    'deep-research-reader-rail', 'deep-research-reader-progress', 'deep-research-report-headings',
    'deep-research-reader-document', 'deep-research-selection-actions', 'deep-research-fullscreen-toggle',
  ]) assert.match(personal, new RegExp(marker), `${marker} must remain testable`);
  assert.match(personal, /<SectionHeader/);
  assert.match(personal, /<SectionToolbar/);
  assert.match(personal, /<ReaderSelectionActions/);
  assert.match(personal, /<ReaderHighlighterControl/);
  assert.match(personal, /<FindInPage/);
  assert.match(personal, /solo lectura/i);
  assert.match(personal, /showMatrix/);
  assert.match(personal, /formatReportDate\(open\.updated_at \|\| open\.created_at\)/);
  assert.match(css, /deep-research-reader-fullscreen/);
  assert.match(css, /deep-research-reader-actions/);
});

test('State of the question matches Desktop without invented private overlays', () => {
  const state = read('src/serverWeb/StateOfArtServerView.tsx');
  const app = read('src/serverWeb/App.tsx');
  assert.doesNotMatch(state, /state-private-overlay|PrivateOverlayNote|api\.addAnnotation/);
  assert.match(state, /function DebateView/);
  assert.match(state, /function GapsView/);
  assert.match(state, /scholar\.google\.com/);
  assert.match(state, /view\/graph\?seed=/);
  assert.match(app, /initialSeedId=.*location\.search.*seed/);
});

test('Graph parity keeps Desktop lenses, presets and safe audit filters visible', () => {
  const graph = read('src/serverWeb/advanced/AdvancedWorkspace.tsx');
  for (const marker of ['graph-controls', 'graph-search', 'graph-read-filter', 'graph-confidence-filter']) {
    assert.match(graph, new RegExp(`data-testid="${marker}"`), `${marker} is testable`);
  }
  assert.match(graph, /data-testid=\{`graph-preset-\$\{id\}`\}/, 'all graph presets are testable');
  assert.match(graph, /buildPresetAtlas\(graph, filters, lens, preset\)/);
  assert.match(graph, /next === ["']reading["'].*readState: ["']read["']/s);
  assert.match(graph, /next === ["']unread["'].*readState: ["']unread["']/s);
  assert.match(graph, /["']contradicts["'], ["']refutes["'], ["']contains["']/);
  assert.match(graph, /onDrillDown=/);
});

test('Academic tools render current Desktop contracts and legacy removed routes stay hidden', () => {
  const tools = read('src/serverWeb/AcademicToolsServerView.tsx');
  const app = read('src/serverWeb/App.tsx');
  const navigation = read('src/navigation.ts');
  assert.match(tools, /ideas\/routes/);
  assert.match(tools, /ideas\/\$\{encodeURIComponent\(String\(active\.ideaId\)\)\}\/graph/);
  assert.match(tools, /api\s*\.detail\(spaceId, ["']gaps["']/);
  assert.match(app, /requested === ["']writing["'] \|\| requested === ["']projects["'] \? ["']workspace["']/);
  assert.doesNotMatch(navigation, /\{ id: 'writing', label:/);
  assert.doesNotMatch(navigation, /\{ id: 'projects', label:/);
  assert.doesNotMatch(tools, /chapter\.original_text/);
  assert.doesNotMatch(tools, /private-\$\{surface\}-ai-workbench|private-\$\{surface\}-ai-generate|PrivateAiWorkbench/);
  for (const surface of ['argument', 'hypothesis', 'immersion']) assert.doesNotMatch(tools, new RegExp(`surface="${surface}"`), `${surface} must not mount an invented private composer`);
});

test('Reading path preserves Desktop controls, card metadata and published navigation', () => {
  const tools = read('src/serverWeb/AcademicToolsServerView.tsx');
  const corpus = read('server/lib/routes/corpus.mjs');
  for (const marker of ['reading-strategy', 'reading-limit', 'reading-include-read', 'reading-brief', 'reading-analyze', 'reading-entry-card']) {
    assert.match(tools, new RegExp(`data-testid="${marker}"`), `${marker} is testable`);
  }
  assert.match(tools, /connected_authors/);
  assert.match(tools, /includeRead/);
  assert.match(tools, /relatedIdeas/);
  assert.match(tools, /\/view\/graph\?seed=/);
  assert.match(corpus, /strategy === 'connected_authors'/);
  assert.match(corpus, /readCount:/);
  assert.match(corpus, /read_tag/);
});
