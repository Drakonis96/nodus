import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(os.tmpdir(), 'argument-camera-'));
buildSync({entryPoints:['src/components/argumentMap/camera.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'camera.cjs')});
const { fitArgumentCamera, focusArgumentCamera, restoreArgumentCamera } = createRequire(import.meta.url)(path.join(dir,'camera.cjs'));
rmSync(dir,{recursive:true,force:true});
const node=(id,x,y,parentId=null)=>({block:{id},x,y,parentId});
const nodes=[node('root',0,0),...Array.from({length:12},(_,i)=>node(`n${i}`,i%2?-374:374,(Math.floor(i/2)-2.5)*180,'root'))];
test('clicking a dense map zooms to a readable card and keeps it above the controls',()=>{
 const size={width:800,height:550};const overview=fitArgumentCamera(nodes,size);
 const focused=focusArgumentCamera(nodes,'n11',size,overview.zoom);
 assert.ok(focused.zoom>=.85 && focused.zoom>overview.zoom);
 const selected=nodes.find(n=>n.block.id==='n11');
 const x=focused.x+selected.x*focused.zoom,y=focused.y+selected.y*focused.zoom;
 assert.ok(x-128*focused.zoom>=20 && x+128*focused.zoom<=size.width-20);
 assert.ok(y-78*focused.zoom>=60 && y+78*focused.zoom<=size.height-70);
});
test('a local parent and child can both fit while the rest of the map stays distant',()=>{
 const size={width:1100,height:700};const focused=focusArgumentCamera(nodes,'n5',size,.29);
 for(const selected of [nodes[0],nodes.find(n=>n.block.id==='n5')]) {
  const x=focused.x+selected.x*focused.zoom,y=focused.y+selected.y*focused.zoom;
  assert.ok(x-128*focused.zoom>=0 && x+128*focused.zoom<=size.width);
  assert.ok(y-78*focused.zoom>=0 && y+78*focused.zoom<=size.height);
 }
 assert.ok(focused.zoom>=.85);
});
test('focus does not unexpectedly zoom out when already reading up close',()=>{
 assert.equal(focusArgumentCamera(nodes,'n5',{width:1100,height:700},1.4).zoom,1.4);
});
test('previous view restores precisely, or preserves world coverage when a sidebar changes width',()=>{
 const from={width:1200,height:800},to={width:800,height:800};
 const camera={x:430,y:280,zoom:.4};
 assert.deepEqual(restoreArgumentCamera(camera,from,from),camera);
 const result=restoreArgumentCamera(camera,from,to);
 assert.ok(result.zoom<camera.zoom);
 assert.ok(Math.abs((to.width/2-result.x)/result.zoom-(from.width/2-camera.x)/camera.zoom)<1e-9);
 assert.ok(Math.abs((to.height/2-result.y)/result.zoom-(from.height/2-camera.y)/camera.zoom)<1e-9);
});
