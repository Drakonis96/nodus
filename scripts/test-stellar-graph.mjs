import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const tmp=await mkdtemp(path.join(os.tmpdir(),'stellar-tests-'));
await build({entryPoints:['src/stellarGraph/exploration.ts','src/stellarGraph/source.ts','src/stellarGraph/layout.ts'],outdir:tmp,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const {Exploration}=await import(path.join(tmp,'exploration.mjs'));
const {memorySource}=await import(path.join(tmp,'source.mjs'));
const {placeNodes,isLegacyLinearLayout}=await import(path.join(tmp,'layout.mjs'));
const node=id=>({id,label:id,type:'claim',workCount:1,workIds:id==='outside'?['w2']:['w1'],read:true,themes:[],years:[],authors:[],maxConfidence:1});
const edge=(id,source,target)=>({id,source,target,type:'supports',basis:'explicit',confidence:.8});
const graph={nodes:['a','b','c','d','isolated','outside'].map(node),edges:[edge('1','a','b'),edge('2','a','c'),edge('3','b','d'),edge('4','c','d'),edge('5','d','a'),edge('6','outside','d'),{...edge('7','a','b'),type:'contains'}]};
const source=()=>memorySource('test',async()=>graph);
test('unique breadth-first relations, cycles, incoming edges, and rewind',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');const order=[];for(let x=await e.next();x;x=await e.next())order.push(x.id);assert.deepEqual(order,['1','2','5','7','3','4','6']);assert.equal(e.visible().nodes.length,5);e.previous();assert.equal(e.visible().nodes.length,4);assert.equal((await e.next()).id,'6');assert.equal(e.visible().nodes.length,5);});
test('work baseline includes isolated ideas and only internal links, reroot keeps baseline',async()=>{const e=new Exploration(source());await e.baseline('w1');assert.equal(e.visible().nodes.length,5);assert.equal(e.visible().edges.length,6);e.start('a');assert.equal((await e.next()).id,'6');e.previous();assert.equal(e.visible().nodes.length,5);assert.equal(e.visible().edges.length,6);});
test('multiple seeds retain history; restoring revalidates deletions',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');await e.next();e.start('b');await e.next();assert.equal(e.history.length,2);const restored=new Exploration(source());await restored.restore({version:1,seeds:e.seeds,activeSeed:'b',history:[...e.history,'deleted'],cursor:3});assert.deepEqual(restored.history,e.history);assert.equal(restored.cursor,2);});
test('pagination exhausts hubs beyond 200 without silent caps',async()=>{const g={nodes:[node('a'),...Array.from({length:503},(_,i)=>node('x'+i))],edges:Array.from({length:503},(_,i)=>edge(String(i).padStart(4,'0'),'a','x'+i))};const e=new Exploration(memorySource('hub',async()=>g));e.ingest({nodes:[node('a')],edges:[]});e.start('a');let n=0;while(await e.next())n++;assert.equal(n,503);assert.equal(e.visible().nodes.length,504);});
test('pause during the cooperative yield does not reveal an extra relationship',async()=>{let e;const s=source();let first=true;e=new Exploration({...s,page:async req=>{const page=await s.page(req);if(first){first=false;setTimeout(()=>e.interrupt(),0);}return page;}});e.ingest({nodes:[node('a')],edges:[]});e.start('a');assert.equal(await e.next(),undefined);assert.equal(e.cursor,0);assert.equal((await e.next()).id,'1');});
test('cancelled exploration cannot replay hidden history',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');await e.next();e.previous();e.cancel();assert.equal(await e.next(),null);assert.equal(e.cursor,0);});
test('new placement preserves dragged coordinates and has no occupied cells',()=>{const ids=Array.from({length:10000},(_,i)=>String(i));const edges=ids.slice(1).map(id=>({source:'0',target:id}));const before={'0':{x:560,y:340}};const positions=placeNodes(ids,edges,before);assert.deepEqual(positions['0'],before['0']);assert.equal(new Set(Object.values(positions).map(p=>`${p.x},${p.y}`)).size,10000);assert.deepEqual(placeNodes(ids,edges,positions),positions);});
test('sparse works form a compact two-dimensional canvas without inventing links',()=>{const ids=Array.from({length:32},(_,i)=>'g-'+(5884+i)),edges=[[0,1],[3,4],[8,9],[9,10],[10,11],[23,24]].map(([a,b])=>({source:ids[a],target:ids[b]}));const before=structuredClone(edges),positions=placeNodes(ids,edges,{}),ps=Object.values(positions);const width=Math.max(...ps.map(p=>p.x))-Math.min(...ps.map(p=>p.x)),height=Math.max(...ps.map(p=>p.y))-Math.min(...ps.map(p=>p.y));assert.equal(ps.length,32);assert.ok(new Set(ps.map(p=>p.y)).size>=5);assert.ok(width<5000&&height>700&&width/height<3);assert.equal(new Set(ps.map(p=>`${p.x},${p.y}`)).size,32);assert.deepEqual(edges,before);assert.deepEqual(placeNodes([...ids].reverse(),[...edges].reverse(),{}),positions);});
test('legacy row repair recognizes generated rows and leaves custom layouts alone',()=>{const ids=Array.from({length:32},(_,i)=>String(i));const row=Object.fromEntries(ids.map((id,i)=>[id,{x:Math.round(i*700/280)*280,y:0}]));assert.ok(isLegacyLinearLayout(ids,row));assert.equal(isLegacyLinearLayout(ids,{...row,'1':{x:123,y:45}}),false);assert.equal(isLegacyLinearLayout(ids,placeNodes(ids,[],{})),false);});
process.on('exit',()=>{void rm(tmp,{recursive:true,force:true});});

test('choosing an idea immediately reveals exactly its direct-link budget, with no second-hop fill',async()=>{
 const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});
 assert.equal(await e.add('a',2),2);
 assert.deepEqual(e.visible().edges.map(e=>e.id),['1','2']);
 assert.equal(await e.add('a',25),4);
 assert.deepEqual(e.visible().edges.map(e=>e.id),['1','2','5','7']);
 assert.ok(!e.visible().nodes.some(n=>n.id==='outside'));
});
test('direct loading paginates beyond 200 and unlimited ends at the seed neighborhood',async()=>{
 const g={nodes:[node('a'),...Array.from({length:503},(_,i)=>node('x'+i))],edges:Array.from({length:503},(_,i)=>edge(String(i).padStart(4,'0'),'a','x'+i))};
 const e=new Exploration(memorySource('hub',async()=>g));
 assert.equal(await e.add('a',251),251);assert.equal(e.visible().edges.length,251);
 assert.equal(await e.add('a',0),503);assert.equal(e.visible().edges.length,503);
});
test('a stalled page reports a translatable failure without publishing a partial graph',async()=>{
 const base=source();
 const e=new Exploration({...base,page:async request=>request.kind==='neighbors'
   ? {...await base.page(request),next:request.cursor}
   : base.page(request)});
 await assert.rejects(e.add('a',25),{message:'No se pudieron cargar todas las conexiones. Vuelve a intentarlo.'});
 assert.deepEqual(e.visible(),{nodes:[],edges:[]});
});
test('removing one node preserves other visible ideas and prevents dangling or resurrected edges',async()=>{
 const e=new Exploration(source());await e.add('a',25);
 const before=e.visible().nodes.map(n=>n.id);
 e.remove('a');
 assert.deepEqual(e.visible().nodes.map(n=>n.id).sort(),before.filter(id=>id!=='a').sort());
 assert.equal(e.visible().edges.length,0);
 await e.add('b',25);
 assert.ok(!e.visible().nodes.some(n=>n.id==='a'));
 assert.ok(e.visible().edges.every(e=>e.source!=='a'&&e.target!=='a'));
 await e.add('a',25);assert.equal(e.visible().edges.length,5);
});
test('an isolated idea can be removed and explicitly re-added',async()=>{
 const e=new Exploration(source());await e.add('isolated',25);assert.equal(e.visible().nodes.length,1);
 e.remove('isolated');assert.equal(e.visible().nodes.length,0);
 await e.add('isolated',25);assert.equal(e.visible().nodes[0].id,'isolated');
});
test('Clear during an in-flight neighborhood request cannot repopulate the canvas',async()=>{
 const backing=source();let release;
 const delayed={...backing,page:async req=>{if(req.kind==='neighbors')await new Promise(resolve=>{release=resolve;});return backing.page(req);}};
 const e=new Exploration(delayed);e.ingest({nodes:[node('a')],edges:[]});
 const load=e.add('a',25);e.clear();release();
 assert.equal(await load,undefined);assert.deepEqual(e.visible(),{nodes:[],edges:[]});
 assert.equal(e.activeSeed,null);assert.equal(e.history.length,0);
});
test('independent graph engines do not share visibility or removal state',async()=>{
 const shared=source(),first=new Exploration(shared),second=new Exploration(shared);
 await first.add('a',2);await second.add('b',25);
 first.clear();assert.equal(second.visible().edges.length,3);
 second.remove('a');await first.add('a',25);assert.equal(first.visible().edges.length,4);
});
test('work-scoped search and expansion stay inside the work without a visible baseline',async()=>{
 const {workScopedSource}=await import(path.join(tmp,'source.mjs'));
 const scoped=workScopedSource(source(),'w1'),e=new Exploration(scoped);
 assert.deepEqual(e.visible(),{nodes:[],edges:[]});
 assert.ok(!(await scoped.page({kind:'search',search:''})).nodes.some(n=>n.id==='outside'));
 await e.add('d',0);assert.ok(!e.visible().nodes.some(n=>n.id==='outside'));
});
