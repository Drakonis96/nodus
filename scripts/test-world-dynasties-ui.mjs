import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('families and dynasties are separate worldbuilding destinations', async () => {
  const [sidebar, navigation, app, vaultTypes] = await Promise.all([
    read('src/components/WorldbuildingSidebar.tsx'),
    read('src/navigation.ts'),
    read('src/App.tsx'),
    read('shared/vaultTypes.ts'),
  ]);

  assert.match(sidebar, /\{ label: 'Familias', icon: 'tree', view: 'tree' \}/);
  assert.match(sidebar, /\{ label: 'Dinastías', icon: 'shield', view: 'dynasties' \}/);
  assert.match(navigation, /'dynasties'/);
  assert.match(vaultTypes, /dynasties: \['worldbuilding'\]/);
  assert.match(app, /const DynastiesView = lazy/);
  assert.match(app, /view === 'dynasties' && <DynastiesView \/>/);
});

test('dynasties are house groups with emblem cards and a complete editable sheet', async () => {
  const [groups, labels, gallery] = await Promise.all([
    read('src/views/GroupsView.tsx'),
    read('shared/characterLabels.ts'),
    read('src/components/world/WorldGallery.tsx'),
  ]);

  assert.match(labels, /export const FACTION_KINDS = \['faction', 'order', 'religion'\]/);
  assert.match(labels, /export const DYNASTY_KINDS = \['house'\]/);
  assert.match(groups, /const DYNASTIES = groupSection\('dynasties', DYNASTY_KINDS/);
  assert.match(groups, /data-testid="dynasty-card"/);
  assert.match(groups, /images\.find\(\(image\) => image\.kind === 'emblem'\)/);
  assert.match(groups, /title=\{dynasty \? 'Blasón y galería' : 'Galería'\}/);
  assert.match(groups, /generateLabel=\{dynasty \? 'Generar blasón' : 'Generar imagen'\}/);
  assert.match(groups, /data-testid="dynasty-sheet-lineage"/);
  for (const field of ['parentId', 'seatPlaceId', 'foundedYear', 'endedYear', 'notes']) {
    assert.match(groups, new RegExp(field), `dynasty sheet edits ${field}`);
  }
  assert.match(gallery, /entityKind === 'group' \? 'emblem'/);
});

test('group image generation loads group material and uses an emblem-specific prompt', async () => {
  const [generator, prompt, types, repo] = await Promise.all([
    read('electron/ai/decorativeImages.ts'),
    read('shared/characterImagePrompt.ts'),
    read('shared/types.ts'),
    read('electron/db/worldImagesRepo.ts'),
  ]);

  assert.match(types, /'emblem'/);
  assert.match(repo, /'emblem'/);
  assert.match(generator, /const group = entityKind === 'group' \? getWorldGroup\(entityId\) : null/);
  assert.match(generator, /group\?\.visualSeed/);
  assert.match(generator, /buildWorldEntityImagePrompt\(style, sources, entityKind, kind\)/);
  assert.match(prompt, /single centred heraldic emblem or coat of arms/);
});

test('the demo ships three compact Codex Image heraldry assets', async () => {
  const demo = await read('electron/db/worldbuildingDemoData.ts');
  for (const house of ['venn', 'sarn', 'mir']) {
    assert.match(demo, new RegExp(`group-${house}`));
    assert.match(demo, new RegExp(`dynasty-${house}\\.webp`));
    const info = await stat(new URL(`../electron/assets/worldbuilding-demo/dynasty-${house}.webp`, import.meta.url));
    assert.ok(info.size > 10_000, `${house} coat of arms has real image content`);
    assert.ok(info.size < 100_000, `${house} coat of arms remains lightweight`);
  }
  assert.match(demo, /group\?\.kind === 'house' \? 'emblem'/);
  assert.match(demo, /upgradeWorldbuildingDemoDynasties/);
});
