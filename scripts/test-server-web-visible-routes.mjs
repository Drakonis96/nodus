import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('every visible dedicated-vault route has a Server Web renderer', () => {
  const app = read('src/serverWeb/App.tsx');
  const surfaces = read('src/serverWeb/vaults/index.tsx');
  const visibleRoutes = {
    prosopography: ['prosopSearch', 'prosopPopulation', 'prosopPersons', 'prosopSources', 'prosopAnalysis', 'prosopNetworks'],
    estudio: ['studyCourses', 'studySchedule', 'studyCalendar', 'studySearch', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyIdeas', 'studyGraph', 'studyQuestions', 'studyReview', 'studyDeepResearch'],
    docencia: ['studyCourses', 'teachingGroups', 'studySchedule', 'studyCalendar', 'studySearch', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyIdeas', 'studyGraph', 'studyQuestions', 'teachingRubrics', 'teachingExams', 'teachingGrades', 'teachingUnits'],
    databases: ['pages', 'dbSearch', 'dbAnalysis', 'dbChat'],
    worldbuilding: ['encyclopedia', 'characters', 'places', 'factions', 'cultures', 'timeline', 'map', 'relations', 'tree', 'dynasties', 'worldChat', 'rules', 'conflicts', 'arcs', 'continuity', 'questions', 'scenes', 'manuscript'],
  };
  const explicit = new Set(['prosopSearch', 'prosopPopulation', 'studySearch', 'studyChat', 'studyDeepResearch', 'dbSearch', 'dbChat', 'worldChat']);
  for (const [vaultType, routes] of Object.entries(visibleRoutes)) {
    for (const view of routes) {
      const renderedBySurface = new RegExp(`${view}\\s*:\\s*['\"]`, 'm').test(surfaces);
      const renderedExplicitly = explicit.has(view) && new RegExp(`route\\.view === ['\"]${view}['\"]`).test(app);
      assert.ok(renderedBySurface || renderedExplicitly, `${vaultType}/${view} must not fall through UnavailableView`);
    }
  }
  for (const view of explicit) assert.doesNotMatch(app, new RegExp(`route\\.view === ['\"]${view}['\"][\\s\\S]{0,500}UnavailableView`), `${view} must dispatch to a real surface`);
});

test('special Server Web routes reuse the publication-safe adapters', () => {
  const app = read('src/serverWeb/App.tsx');
  const surfaces = read('src/serverWeb/vaults/index.tsx');
  assert.match(app, /route\.view === 'prosopSearch' \|\| route\.view === 'studySearch' \|\| route\.view === 'dbSearch'[\s\S]*?<SearchServerView/);
  assert.match(surfaces, /prosopPopulation\s*:\s*['"]prosopography-persons['"]/);
  assert.match(app, /route\.view === 'studyChat'[\s\S]*?<ConversationServerView[\s\S]*?mode="study"/);
  assert.match(app, /route\.view === 'dbChat'[\s\S]*?<ConversationServerView[\s\S]*?mode="database"/);
  assert.match(app, /route\.view === 'worldChat'[\s\S]*?<ConversationServerView[\s\S]*?mode="world"/);
  assert.match(app, /route\.view === 'studyDeepResearch'[\s\S]*?<DeepResearchServerView/);
});

test('structured immersion plans are rendered as sections rather than stringified objects', () => {
  const tools = read('src/serverWeb/AcademicToolsServerView.tsx');
  assert.match(tools, /function ImmersionPlan/);
  assert.match(tools, /data-testid="immersion-plan"/);
  assert.match(tools, /Array\.isArray\(plan\.stations\)/);
  assert.doesNotMatch(tools, /MarkdownReader value=\{text\(\(detail\?\.session[\s\S]*?plan/);
});

test('switching vaults dismisses the selector before navigating to the new home', () => {
  const app = read('src/serverWeb/App.tsx');
  assert.match(app, /onSelect=\{\(id\) => \{[^}]*setActiveId\(id\);\s*setVaultsOpen\(false\);\s*navigate\('\/'\);/);
  // Header actions are wrapped by HoverLabelButton for the accessible hover label;
  // assert the semantic hook and its action instead of coupling this contract to
  // the presentational Icon wrapper.
  assert.match(app, /<HoverLabelButton[\s\S]*?data-testid=\{dataTestId\}/);
  assert.match(app, /<ServerHeaderAction[\s\S]*?icon="user"[\s\S]*?label="Mi cuenta"[\s\S]*?dataTestId="header-account"/);
  assert.match(app, /onClick=\{\(\) => \{ setDrawer\(false\); navigate\('\/view\/settings\?tab=server'\); \}\} dataTestId="header-account"/);
  assert.match(app, /navigate\('\/view\/settings\?tab=server'\)/);
});
