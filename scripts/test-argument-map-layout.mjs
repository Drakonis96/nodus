import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(os.tmpdir(), 'argument-layout-'));
buildSync({entryPoints:['src/components/argumentMap/layout.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'layout.cjs')});
const { layoutArgumentMap, CARD_WIDTH, CARD_HEIGHT } = createRequire(import.meta.url)(path.join(dir,'layout.cjs'));
rmSync(dir,{recursive:true,force:true});
const leaf = (id, relation = 'supports', children = []) => ({ id, relation, children });
const root = leaf('root','root',[leaf('a','supports',[leaf('a1'),leaf('a2')]),leaf('b','refutes',[leaf('b1')]),leaf('c','extends')]);
test('collapsed and first-level views show exactly the requested branches', () => {
 assert.deepEqual(layoutArgumentMap(root,new Set()).map(n=>n.block.id),['root']);
 assert.equal(layoutArgumentMap(root,new Set(['root'])).length,4);
 assert.deepEqual(layoutArgumentMap(root,new Set(['root']),'refutes').map(n=>n.block.id),['root','b']);
});
test('expansion preserves sides, reveals descendants, and never overlaps cards', () => {
 const before=layoutArgumentMap(root,new Set(['root']));
 const after=layoutArgumentMap(root,new Set(['root','a','b']));
 for(const node of before) assert.equal(after.find(n=>n.block.id===node.block.id).side,node.side);
 for(const node of after) {
  if(node.parentId && node.parentId!=='root') assert.equal(node.side,after.find(n=>n.block.id===node.parentId).side);
  for(const other of after) if(node!==other) assert.ok(Math.abs(node.x-other.x)>=CARD_WIDTH || Math.abs(node.y-other.y)>=CARD_HEIGHT);
 }
 assert.equal(after.length,7);
});
test('a full 157-block map is reachable without overlap or orphan connections', () => {
 const make=(id,depth)=>leaf(id,'supports',depth<3?Array.from({length:[12,4,2][depth]},(_,i)=>make(`${id}-${i}`,depth+1)):[]);
 const tree=make('r',0),expanded=new Set();
 const walk=n=>{expanded.add(n.id);n.children.forEach(walk);};walk(tree);
 const nodes=layoutArgumentMap(tree,expanded);assert.equal(nodes.length,157);
 for(const node of nodes){
  assert.ok(!node.parentId||nodes.some(p=>p.block.id===node.parentId));
  for(const other of nodes) if(node!==other) assert.ok(Math.abs(node.x-other.x)>=CARD_WIDTH || Math.abs(node.y-other.y)>=CARD_HEIGHT);
 }
});
