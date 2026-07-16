import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('worldbuilding and teaching use their own visible vault icons', async () => {
  const [picker, app, ui, dock] = await Promise.all([
    read('src/components/VaultSwitcher.tsx'),
    read('src/App.tsx'),
    read('src/components/ui.tsx'),
    read('src/dockIcon.ts'),
  ]);
  assert.match(picker, /case 'worldbuilding': return 'globe'/);
  assert.match(picker, /case 'docencia': return 'presentation'/);
  assert.match(picker, /new-vault-type-icon-/);
  assert.match(picker, /vault-type-icon-/);
  assert.match(app, /vaultTypeIcon\(activeVault\.type\)/);
  assert.match(ui, /globe:/);
  assert.match(ui, /presentation:/);
  assert.match(dock, /type === 'worldbuilding'.*#7c3aed/);
  assert.match(dock, /type === 'docencia'.*#ea580c/);
});

test('preview vaults bypass setup and every automatic tutorial', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /if \(!isPreviewVault && settings\.basicsTutorialVersion === 0\)/);
  assert.match(app, /if \(!isPreviewVault && !settings\.onboardingComplete\)/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete[^\n]+!settings\.tourComplete/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete[^\n]+settings\.tourComplete[^\n]+!settings\.advancedTourComplete/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete &&/);
});

test('study onboarding is local-first and does not require Zotero', async () => {
  const onboarding = await read('src/views/Onboarding.tsx');
  assert.match(onboarding, /vaultType === 'genealogy' \|\| vaultType === 'databases' \|\| vaultType === 'estudio'/);
  assert.match(onboarding, /if \(!simple\) void checkZotero\(\)/);
  assert.match(onboarding, /Organiza cursos, apuntes, materiales y repasos en un espacio de aprendizaje local/);
  assert.match(onboarding, /enlazar materiales de Zotero de forma opcional/);
});

test('study has a first-run tour and a replay action in settings', async () => {
  const [tour, app, settings, sidebar] = await Promise.all([
    read('src/views/StudyTour.tsx'),
    read('src/App.tsx'),
    read('src/views/Settings.tsx'),
    read('src/components/StudySidebar.tsx'),
  ]);
  for (const target of ['studyCourses', 'studySchedule', 'studyCalendar', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyIdeas', 'studyQuestions', 'studyReview']) {
    assert.match(tour, new RegExp(`nav-${target}`));
  }
  assert.match(app, /isEstudio && !settings\.studyTourComplete/);
  assert.match(app, /updateSettings\(\{ studyTourComplete: true \}\)/);
  assert.match(settings, /data-testid="study-tour-replay"/);
  assert.match(settings, /patch\(\{ studyTourComplete: false \}\)/);
  assert.match(sidebar, /data-tour=\{`nav-\$\{item\.view\}`\}/);
});

test('discarding a new onboarding vault switches away before deleting it', async () => {
  const app = await read('src/App.tsx');
  const start = app.indexOf('const cancelOnboarding = useCallback');
  const end = app.indexOf('const exitDemo = useCallback', start);
  assert.ok(start >= 0 && end > start);
  const cancelFlow = app.slice(start, end);
  const switchAt = cancelFlow.indexOf('switchVault(other.id)');
  const deleteAt = cancelFlow.indexOf('deleteVault(discardedVaultId, true)');
  assert.ok(switchAt >= 0 && deleteAt > switchAt, 'the active vault must be switched before it can be deleted');
  assert.match(cancelFlow, /if \(!switched\.ok\) throw new Error\(switched\.message\)/);
});

test('the create-vault modal shows an inline accessible name error', async () => {
  const picker = await read('src/components/VaultSwitcher.tsx');
  assert.match(picker, /setAddNameError\(t\('Escribe un nombre para la bóveda\.'\)\)/);
  assert.match(picker, /data-testid="vault-name-error"/);
  assert.match(picker, /role="alert"/);
  assert.match(picker, /aria-invalid=\{Boolean\(addNameError\)\}/);
});

test('the create-vault modal asks for a name and a type, never for models', async () => {
  // Model choice belongs to the setup wizard, where Nodus can discover the models
  // from the stored keys. Asking again here is the duplication this replaced.
  const [picker, types] = await Promise.all([
    read('src/components/VaultSwitcher.tsx'),
    read('shared/vaultTypes.ts'),
  ]);
  assert.doesNotMatch(picker, /VaultCreationModels/, 'the creation modal must not embed the model picker');
  assert.doesNotMatch(picker, /aiModel|embeddingProvider|embeddingModel/, 'creation must not send a model payload');
  assert.doesNotMatch(picker, /downloadNodusLocalModel|installNodusLocalRuntime/, 'downloading belongs to the wizard, not to creation');
  assert.match(picker, /createVault\(\{ name, type: addType \}\)/);
  // The create button must depend on the name alone now that models are gone.
  assert.match(picker, /onClick=\{\(\) => void createVault\(\)\} disabled=\{busy\}/);
  assert.match(picker, /data-testid="vault-models-next-step"/);
  for (const type of ['academic', 'genealogy', 'estudio', 'databases']) {
    assert.match(types, new RegExp(`id: '${type}'[\\s\\S]{0,180}available: true`));
  }
});

test('the wizard discovers models by itself and requires one of each role', async () => {
  const [onboarding, step, select] = await Promise.all([
    read('src/views/Onboarding.tsx'),
    read('src/components/OnboardingModelStep.tsx'),
    read('src/components/SearchableModelSelect.tsx'),
  ]);
  // Discovery runs on mount against every reachable provider — no button to press.
  assert.match(step, /useEffect\(\(\) => \{\s*void discover\(keys\)/);
  assert.match(step, /autoDiscoverableAiProviders\(active\)/);
  assert.match(step, /autoDiscoverableEmbeddingProviders\(active\)/);
  assert.match(step, /listModels\(provider\)/);
  assert.match(step, /listEmbeddingModels\(provider as EmbeddingProvider\)/);
  // Both roles are picked separately, and each picker has a searchbox.
  assert.match(step, /testId="onboarding-ai-model"/);
  assert.match(step, /testId="onboarding-embedding-model"/);
  assert.match(select, /data-testid=\{`\$\{testId\}-search`\}/);
  assert.match(select, /filterModelChoices\(choices, query\)/);
  // Adding a key re-runs discovery rather than asking the user to reload.
  assert.match(step, /await window\.nodus\.setApiKey\(keyProvider, keyValue\.trim\(\)\)[\s\S]{0,200}await discover\(next\)/);
  // The wizard, not vault creation, now persists both models and fetches local ones.
  assert.match(onboarding, /synthesisModel: aiModel/);
  assert.match(onboarding, /embeddingProvider,/);
  assert.match(onboarding, /embeddingModel: normalizeEmbeddingModel\(embeddingProvider, embeddingModel\.model\)/);
  assert.match(onboarding, /await downloadLocalModels\(\[aiModel, embeddingModel\]\)/);
  assert.match(onboarding, /disabled=\{finishing \|\| !aiModel \|\| !embeddingModel\}/);
});

test('vault creation persists the complete model selection and keeps legacy callers compatible', async () => {
  const [types, ipc, settings] = await Promise.all([
    read('shared/types.ts'),
    read('electron/ipc.ts'),
    read('electron/vaults/vaultCreationSettings.ts'),
  ]);
  assert.match(types, /aiModel\?: ModelRef/);
  assert.match(types, /embeddingProvider\?: EmbeddingProvider/);
  assert.match(types, /embeddingModel\?: string/);
  assert.match(ipc, /validateVaultModelSelection\(input\)/);
  assert.match(ipc, /initializeVaultModelSelection\(vault\.path, modelSelection\)/);
  assert.match(settings, /if \(!hasAnySelection\) return null/);
  assert.match(settings, /modelSettingsMode: 'basic'/);
  assert.match(settings, /embeddingProvider: selection\.embeddingProvider/);
  assert.match(settings, /writeGlobalPrefs\(\{ favorites, synthesisModel: selection\.aiModel \}\)/);
});
