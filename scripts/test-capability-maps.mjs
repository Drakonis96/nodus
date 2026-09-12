import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { build } from 'esbuild';
import { geometry, request, source } from './fixtures/maps/input.mjs';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-maps-test-'));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
const bundles={};
for(const [key,file] of Object.entries({sdk:'packages/capability-api/src/index.ts',service:'electron/capabilities/maps/service.ts',sources:'electron/capabilities/maps/sources.ts',render:'electron/capabilities/maps/render.ts',contract:'skill-capabilities/builtins/maps/contract.ts'})) {
  const out=path.join(scratch,key+'.cjs'); await build({entryPoints:[path.join(root,file)],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent'}); bundles[key]=require(out);
}
const {sdk,service,sources,render,contract}=bundles;
const fresh=options=>service.createMapService({providers:[],...options});
const signal=()=>new AbortController().signal;
const changed=(edit)=>{const v=structuredClone(request);edit(v);return v;};
const meta={boundaryISO:'TST',boundaryType:'ADM1',boundaryLicense:'CC BY 4.0',boundaryYearRepresented:'2020',boundarySource:'Fixture Agency',boundaryID:'TST-ADM1-fixture',boundarySourceURL:'https://example.org/data',licenseSource:'https://creativecommons.org/licenses/by/4.0/',simplifiedGeometryGeoJSON:'https://github.com/wmgeolab/geoBoundaries/raw/123abcd/releaseData/gbOpen/TST/ADM1/geoBoundaries-TST-ADM1_simplified.geojson'};
const payload={...geometry,features:geometry.features.map((f,i)=>({...f,properties:{shapeID:String(i),shapeName:f.properties.name,shapeISO:'TST'}}))};
const encode=x=>Buffer.from(JSON.stringify(x));
const transport=(metadata=meta)=>({calls:[],async read(url,abort,limit){this.calls.push(url);abort.throwIfAborted();return encode(url.includes('geoboundaries.org/api')?metadata:payload);}});

test('maps is reserved core, tools have valid schemas, and permission expansion is explicit',()=>{
  assert.ok(sdk.CORE_CAPABILITY_IDS.includes('nodus:maps'));assert.equal(sdk.normalizeCapabilityId('maps'),'nodus:maps');
  for(const tool of contract.MAP_TOOLS) sdk.validateJsonSchema(tool.inputSchema);
  assert.equal(sdk.jsonSchemaMatches(contract.MAP_TOOLS[1].inputSchema,request),true);
  assert.throws(()=>sdk.assertMayProvide({id:'evil',publisher:{id:'NodusResearch'}},'nodus:maps'),/core/);
  assert.deepEqual(sdk.validateTrustedPermissions({maps:{maxCalls:2,providers:[]}}).maps,{maxCalls:2,providers:[]});
  assert.throws(()=>sdk.validateTrustedPermissions({maps:{maxCalls:9,providers:[]}}));
  assert.throws(()=>sdk.validateTrustedPermissions({maps:{maxCalls:2,providers:['arbitrary']}}));
  assert.equal(sdk.permissionsExpandV2({maps:{maxCalls:4,providers:['natural-earth']}},{maps:{maxCalls:2,providers:[]}}),false);
  assert.equal(sdk.permissionsExpandV2({maps:{maxCalls:4,providers:[]}},{maps:{maxCalls:4,providers:['natural-earth']}}),true);
});
test('valid geometry is copied; malformed coordinates, rings, empty and nested geometry fail',()=>{
  const copy=sdk.validateMapGeometry(geometry);copy.features[0].properties.name='changed';assert.equal(geometry.features[0].properties.name,'West');
  for(const coord of [[181,0],[0,91],[NaN,0],[Infinity,0],['1',0],[1],[1,2,3]]) assert.throws(()=>sdk.validateMapPosition(coord));
  for(const edit of [v=>v.features[0].geometry.coordinates[0].pop(),v=>v.features[0].geometry.coordinates[0].splice(0,4),v=>v.features[0].geometry=null,v=>v.crs={},v=>v.features[0].properties.url={nested:true},v=>v.features[0].properties.n=NaN,v=>v.features[0].geometry={type:'GeometryCollection',geometries:[]}]) {const v=structuredClone(geometry);edit(v);assert.throws(()=>sdk.validateMapGeometry(v));}
  let nested={type:'Point',coordinates:[0,0]}; for(let i=0;i<12;i++)nested={type:'GeometryCollection',geometries:[nested]};assert.throws(()=>sdk.validateMapGeometry({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:nested}]}),/nesting/);
});
test('projection, bounds, sources, styling and overlay inputs fail closed',()=>{
  for(const edit of [v=>v.projection='fake',v=>v.bounds=[4,30,-4,50],v=>v.markers[0].color='url(https://evil)',v=>delete v.overlaySource,v=>v.layers[0].data.source.origin='provider',v=>v.layers[0].data.source.url='file:///secret',v=>v.routes[0].coordinates=[[0,0]],v=>v.layers[0].query={provider:'natural-earth'},v=>v.legend[0].color='red',v=>v.markers=Array.from({length:201},()=>({coordinates:[0,0]}))])assert.throws(()=>sdk.validateMapRenderRequest(changed(edit)));
});
test('three projections create deterministic, attributed SVG and preserve source geometry',async()=>{
  const svgs=[];
  for(const projection of ['equal-earth','mercator','equirectangular']) {
    const input={...request,projection};const a=await fresh().render(input,signal()),b=await fresh().render(input,signal());
    assert.deepEqual(a,b);assert.match(a.svg,/nodus-map-provenance/);assert.match(a.svg,/Nodus deterministic test data/);assert.match(a.svg,/#675dc1/);assert.match(a.svg,/route-arrow/);assert.match(a.svg,/Site A/);assert.doesNotMatch(a.svg,/<script|foreignObject|<image|NaN|Infinity/);
    assert.equal(a.provenance.sources[0].origin,'caller');assert.equal(a.provenance.sources[0].sha256.length,64);assert.deepEqual(a.geometry[0],geometry);svgs.push(a.svg);
  }
  assert.equal(new Set(svgs).size,3);
});
test('all seven GeoJSON types render, including a lone point and unfilled line geometry',async()=>{
  const polygon=geometry.features[0].geometry;
  for(const g of [{type:'Point',coordinates:[0,0]},{type:'MultiPoint',coordinates:[[0,0],[1,1]]},{type:'LineString',coordinates:[[0,0],[1,1],[2,0]]},{type:'MultiLineString',coordinates:[[[0,0],[1,1]]] },polygon,{type:'MultiPolygon',coordinates:[polygon.coordinates]},{type:'GeometryCollection',geometries:[polygon,{type:'LineString',coordinates:[[-5,38],[-4,40],[-3,39]]}]}]) {
    const geojson={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:g}]};
    const result=await fresh().render({title:g.type,alt:'Geometry type fixture',layers:[{data:{geojson,source},fill:'#123456'}]},signal());
    assert.match(result.svg,/<path d="[^"]+"/);assert.doesNotMatch(result.svg,/NaN|Infinity/);
    if(g.type.includes('Line') || g.type==='GeometryCollection')assert.match(result.svg,/fill="none" fill-rule="evenodd" stroke="#123456"/);
  }
});
test('unknown territories and color categories never fabricate success',async()=>{
  await assert.rejects(fresh().render(changed(v=>v.layers[0].select={property:'name',values:['Atlantis']}),signal()),/No map feature/);
  await assert.rejects(fresh().render(changed(v=>v.layers[0].colors.values[0].value='invented'),signal()),/No map feature/);
  await assert.rejects(fresh().render(changed(v=>v.layers[0].labelProperty='missing'),signal()),/label property/);
});
test('ring winding and holes do not invert the world, and dateline routes are explicit',async()=>{
  const reversed=changed(v=>v.layers[0].data.geojson.features.forEach(f=>f.geometry.coordinates[0].reverse()));
  const a=await fresh().render(request,signal()),b=await fresh().render(reversed,signal());
  const paths=s=>[...s.matchAll(/<path d="([^"]+)" fill="(#[^"]+)"/g)].map(m=>m[1]);assert.deepEqual(paths(a.svg),paths(b.svg));
  const input={title:'Dateline',alt:'Connection across the antimeridian',routes:[{coordinates:[[170,20],[-170,20]],kind:'straight'}],overlaySource:source};
  await assert.rejects(fresh().render(input,signal()),/antimeridian/);
  const ok=await fresh().render({...input,routes:[{...input.routes[0],kind:'great-circle'}]},signal());assert.doesNotMatch(ok.svg,/NaN|Infinity/);
});
test('exact marker placement follows projection; out-of-bounds and polar Mercator markers reject',async()=>{
  await assert.rejects(fresh().render(changed(v=>v.bounds=[0,0,5,5]),signal()),/outside/);
  await assert.rejects(fresh().render({title:'Polar',alt:'Polar marker',projection:'mercator',markers:[{coordinates:[0,90]}],overlaySource:source},signal()),/Mercator/);
  const only={title:'Point',alt:'Exact coordinate',markers:[{coordinates:[0,0],label:'Origin'}],overlaySource:source};
  const result=await fresh().render(only,signal());assert.match(result.svg,/<circle cx="[\d.]+" cy="[\d.]+"/);
});
test('projected marker coordinates and every curved/straight route endpoint agree numerically',async()=>{
  for(const kind of ['straight','curved']) {
    const coordinates=[[-5,-5],[0,0],[5,5]];
    const result=await fresh().render({title:'Coordinates',alt:'Linear projection test',projection:'equirectangular',bounds:[-10,-10,10,10],markers:coordinates.map(coordinates=>({coordinates})),routes:[{coordinates,kind,arrow:true,color:'#123456'}],overlaySource:source},signal());
    const points=[...result.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map(m=>m.slice(1).map(Number));
    const frame=/<clipPath id="map-frame"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(result.svg).slice(1).map(Number);
    assert.ok(Math.abs(points[1][0]-(frame[0]+frame[2]/2))<.02);assert.ok(Math.abs(points[1][1]-(frame[1]+frame[3]/2))<.02);
    assert.ok(Math.abs((points[2][0]-points[1][0])+(points[2][1]-points[1][1]))<.02);
    const routes=[...result.svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#123456"/g)];assert.equal(routes.length,2);
    routes.forEach((m,i)=>{const coords=m[1].replace(/[MLQ]/g,' ').trim().split(/[\s,]+/).map(Number);assert.equal(coords.length,kind==='curved'?6:4);assert.deepEqual(coords.slice(0,2),points[i]);assert.deepEqual(coords.slice(-2),points[i+1]);});
    assert.deepEqual(result.overlays.routes[0].coordinates,coordinates);
  }
});
test('polygon holes, tiny valid rings and inert attribution survive; degenerate data fails',async()=>{
  const data=structuredClone(geometry);data.features[0].geometry.coordinates.push([[-5,39],[-4,39],[-4,40],[-5,40],[-5,39]]);
  const oriented=render.orientMapGeometry(data);assert.notDeepEqual(oriented.features[0].geometry.coordinates[0],data.features[0].geometry.coordinates[0]);assert.deepEqual(oriented.features[0].geometry.coordinates[1],data.features[0].geometry.coordinates[1]);
  const tiny=structuredClone(geometry);tiny.features[0].geometry.coordinates=[[[-5,39],[-4.9999999,39],[-5,39.0000001],[-5,39]]];assert.doesNotThrow(()=>render.orientMapGeometry(tiny));
  const line=structuredClone(geometry);line.features[0].geometry.coordinates=[[[0,0],[1,0],[2,0],[0,0]]];await assert.rejects(fresh().render({...request,layers:[{data:{geojson:line,source}}]},signal()),/Degenerate/);
  const escaped=await fresh().render({...request,title:'A & B <script>',layers:[{data:{geojson:data,source:{...source,attribution:'A & B <image href="https://evil">'}}}]},signal());assert.match(escaped.svg,/A &amp; B &lt;script&gt;/);assert.doesNotMatch(escaped.svg,/<script|<image/);
  for(const period of [{from:'2024-02-30',to:'2024-03-01'},{from:'2001-01-02',to:'2001-01-01'}])assert.throws(()=>sdk.validateMapQuery({provider:'natural-earth',period}));
  for(const id of [NaN,Infinity,'']) {const invalid=structuredClone(geometry);invalid.features[0].id=id;assert.throws(()=>sdk.validateMapGeometry(invalid));}
});
test('provider retrieval pins location, checks metadata/licence, stamps provenance and isolates dataset tokens',async()=>{
  const net=transport(),a=fresh({providers:['geoboundaries'],transport:net}),b=fresh({providers:['geoboundaries'],transport:net});
  const dataset=await a.retrieve({provider:'geoboundaries',country:'TST',level:1},signal());
  assert.equal(dataset.source.origin,'provider');assert.match(dataset.source.license,/CC BY 4.0/);assert.equal(net.calls.length,2);
  const input={title:'Source-backed',alt:'Approved geometry',layers:[{datasetId:dataset.datasetId}]};
  dataset.geojson.features=[];dataset.source.attribution='FORGED';
  const result=await a.render(input,signal());assert.match(result.svg,/Fixture Agency/);assert.doesNotMatch(result.svg,/FORGED/);
  await assert.rejects(b.render(input,signal()),/another invocation scope/);
  await assert.rejects(a.render({...input,layers:[{datasetId:'00000000-0000-0000-0000-000000000000'}]},signal()),/unknown/);
});
test('provider and network restrictions reject arbitrary URLs, redirects via metadata and unknown licences',async()=>{
  for(const query of [{provider:'osm-tiles'},{provider:'geoboundaries',country:'../ESP',level:1},{provider:'natural-earth',url:'https://localhost'},{provider:'geoboundaries',country:'ALL',level:1}])assert.throws(()=>sdk.validateMapQuery(query));
  await assert.rejects(fresh().retrieve({provider:'natural-earth'},signal()),/no permission/);
  for(const metadata of [{...meta,boundaryISO:'WRONG'},{...meta,simplifiedGeometryGeoJSON:'https://127.0.0.1/private'},{...meta,boundaryLicense:'All rights reserved'}]) await assert.rejects(fresh({providers:['geoboundaries'],transport:transport(metadata)}).retrieve({provider:'geoboundaries',country:'TST',level:1},signal()));
});
test('Git LFS retrieval verifies the pinned bytes and rejects oversized or modified data',async()=>{
  const bytes=encode(payload),digest=createHash('sha256').update(bytes).digest('hex');
  const run=async(hash,size,body)=>{const urls=[];const net={async read(url){urls.push(url);return url.includes('/api/')?encode(meta):url.includes('raw.githubusercontent.com')?Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${hash}\nsize ${size}\n`):body;}};return fresh({providers:['geoboundaries'],transport:net}).retrieve({provider:'geoboundaries',country:'TST',level:1},signal());};
  const result=await run(digest,bytes.length,bytes);assert.equal(result.source.sha256,digest);
  await assert.rejects(run('0'.repeat(64),bytes.length,bytes),/digest/);
  await assert.rejects(run(digest,bytes.length+1,bytes),/digest/);
  await assert.rejects(run(digest,sdk.MAP_LIMITS.responseBytes+1,bytes),/byte limit/);
});
test('HTTP transport denies other origins/paths and private DNS, omits credentials, refuses redirects and bounds streams',async(t)=>{
  const lookup=t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  const fetcher=t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);return new Response('1234');});
  for(const url of ['https://example.org/data','http://www.geoboundaries.org/api/current/gbOpen/ESP/ADM1/',sources.NATURAL_EARTH_URL+'?url=https://localhost','https://raw.githubusercontent.com/evil/repo/main/map.json'])await assert.rejects(sources.mapSourceTransport.read(url,signal(),100),/not approved/);
  assert.equal(fetcher.mock.calls.length,0);
  await assert.rejects(sources.mapSourceTransport.read(sources.NATURAL_EARTH_URL,signal(),3),/byte limit/);
  fetcher.mock.mockImplementation(async()=>new Response('x',{headers:{'content-length':'1000'}}));await assert.rejects(sources.mapSourceTransport.read(sources.NATURAL_EARTH_URL,signal(),10),/byte limit/);
  fetcher.mock.mockImplementation(async()=>new Response(null,{status:302}));await assert.rejects(sources.mapSourceTransport.read(sources.NATURAL_EARTH_URL,signal(),10),/HTTP 302/);
  lookup.mock.mockImplementation(async()=>[{address:'127.0.0.1',family:4}]);await assert.rejects(sources.mapSourceTransport.read(sources.NATURAL_EARTH_URL,signal(),10),/not public/);
});
test('historical query does not substitute modern data or contact a provider',async()=>{
  const net=transport();await assert.rejects(fresh({providers:['geoboundaries'],transport:net}).retrieve({provider:'geoboundaries',country:'TST',level:1,period:{from:'1800-01-01',to:'1800-12-31'}},signal()),/Historical retrieval/);assert.equal(net.calls.length,0);
});
test('failures and parallel calls consume bounded budgets',async()=>{
  const limited=fresh({maxCalls:2});await assert.rejects(limited.render({},signal()));await assert.rejects(limited.render({},signal()));await assert.rejects(limited.render(request,signal()),/budget/);
  const parallel=fresh({maxCalls:1});const outcomes=await Promise.allSettled([parallel.render(request,signal()),parallel.render(request,signal())]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const net={async read(){throw new Error('offline');}},s=fresh({providers:['natural-earth'],transport:net});for(let i=0;i<4;i++) await assert.rejects(s.retrieve({provider:'natural-earth'},signal()),/offline/);await assert.rejects(s.retrieve({provider:'natural-earth'},signal()),/retrieval budget/);
});
test('cancellation aborts before work and during retrieval; late data is discarded',async()=>{
  const c=new AbortController();c.abort();await assert.rejects(fresh().render(request,c.signal),{name:'AbortError'});
  const abort=new AbortController();const net={async read(){abort.abort();return encode(payload);}};
  await assert.rejects(fresh({providers:['natural-earth'],transport:net}).retrieve({provider:'natural-earth'},abort.signal),{name:'AbortError'});
  const mid=new AbortController();const running=fresh().render(request,mid.signal);mid.abort();await assert.rejects(running,{name:'AbortError'});
});
test('the service supplies its fixed deadline to network operations',async(t)=>{
  const deadline=new AbortController();
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,30000);return deadline.signal;});
  const net={async read(url,abort){return new Promise((resolve,reject)=>{abort.addEventListener('abort',()=>reject(abort.reason),{once:true});deadline.abort(new DOMException('Deadline','TimeoutError'));});}};
  await assert.rejects(fresh({providers:['natural-earth'],transport:net}).retrieve({provider:'natural-earth'},signal()),{name:'TimeoutError'});
});
test('a stalled transport cannot prevent cancellation or later register its result',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});
  const net={read(){entered();return new Promise(resolve=>{release=resolve;});}};
  const controller=new AbortController(),service=fresh({providers:['natural-earth'],transport:net});
  const pending=service.retrieve({provider:'natural-earth'},controller.signal);
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await started;controller.abort();await rejected;release(encode(payload));
});

test('historical dates support ISO expanded BCE years and chronological ordering',()=>{
  assert.doesNotThrow(()=>sdk.validateMapSource({...source,period:{from:'-000500-01-01',to:'-000400-12-31'}}));
  assert.throws(()=>sdk.validateMapSource({...source,period:{from:'-000400-01-01',to:'-000500-12-31'}}));
  assert.throws(()=>sdk.validateMapSource({...source,period:{from:'1900-02-29',to:'1901-01-01'}}));
});
