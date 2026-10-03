import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateScriptorSidebar } from '../shared/scriptorNavigation.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(),'nodus-scriptor-nav-'));
const bundle = path.join(directory,'navigation.cjs');
buildSync({entryPoints:[new URL('../src/navigation.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:bundle});
const navigation = createRequire(import.meta.url)(bundle);
const vaultBundle = path.join(directory,'vaultTypes.cjs');
buildSync({entryPoints:[new URL('../shared/vaultTypes.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:vaultBundle});
const vaultTypes = createRequire(import.meta.url)(vaultBundle);
test.after(() => rmSync(directory,{recursive:true,force:true}));

test('Scriptor has one Tools shortcut and a working catalogue destination in every vault', () => {
  const tool = navigation.TOOLKIT_TOOLS.find(tool => tool.name === 'Nodus Scriptor');
  assert.equal(tool.page,'workspace');
  assert.equal(navigation.isToolkitStandalonePage(tool.page),true);
  for (const type of ['academic','estudio','docencia','genealogy','prosopography','databases','testimonios','worldbuilding']) {
    const dedicated = navigation.dedicatedVaultNavIds(type);
    const hidden = [...vaultTypes.defaultHiddenViewsForType(type),...navigation.NAV_ITEMS.filter(item => !vaultTypes.isViewAllowedForVaultType(item.id,type) || (dedicated && !dedicated.includes(item.id))).map(item => item.id)];
    const groups = navigation.groupedNav([],hidden);
    const scriptor = groups.flatMap(group => group.items).filter(item => item.label === 'Nodus Scriptor');
    assert.equal(scriptor.length,1,type);
    assert.equal(scriptor[0].group,'tools',type);
    assert.equal(scriptor[0].id,navigation.scriptorViewForVault(type),type);
    assert.equal(groups.some(group => group.label === 'Escribir'),false,type);
    const manuallyHidden = navigation.groupedNav([],[...hidden,scriptor[0].id]);
    assert.equal(manuallyHidden.flatMap(group => group.items).some(item => item.label === 'Nodus Scriptor'),false,type);
  }
});

test('the upcoming release enables Scriptor once without changing unrelated visibility or order', () => {
  const migrated = migrateScriptorSidebar({sidebarHidden:['workspace','notes','reading','toolkit'],sidebarOrder:['notes','library','toolkit','workspace','browser']});
  assert.equal(migrated.changed,true);
  assert.equal(migrated.scriptorSidebarVersion,1);
  assert.deepEqual(migrated.sidebarHidden,['reading','toolkit']);
  assert.deepEqual(migrated.sidebarOrder,['library','toolkit','browser']);
  const manual = {...migrated,sidebarHidden:[...migrated.sidebarHidden,'workspace']};
  for (let read=0;read<3;read++) {
    const persisted = migrateScriptorSidebar(JSON.parse(JSON.stringify(manual)));
    assert.equal(persisted.changed,false);
    assert.deepEqual(persisted.sidebarHidden,manual.sidebarHidden);
  }
  assert.deepEqual(migrateScriptorSidebar({}).sidebarHidden,[]);
});
