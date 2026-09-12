import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const sharp=require('sharp');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-vision-test-'));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const modules={};
for(const [key,file] of Object.entries({sdk:'packages/capability-api/src/index.ts',service:'electron/capabilities/vision/service.ts',images:'electron/capabilities/vision/images.ts',support:'electron/capabilities/vision/modelSupport.ts',contract:'skill-capabilities/builtins/vision/contract.ts',transport:'shared/imageAnalysis.ts'})) {
 const out=path.join(scratch,key+'.cjs'); await build({entryPoints:[path.join(root,file)],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'sharp',setup(b){b.onResolve({filter:/^sharp$/},()=>({path:require.resolve('sharp'),external:true}));}}]}); modules[key]=require(out);
}
const {sdk,service,images,support,contract,transport}=modules;
const request='Select an image of a red square.';
const png=await sharp({create:{width:64,height:64,channels:3,background:'#ff0000'}}).png().toBuffer();
const permission={vision:{maxRounds:3}};
const source=id=>({id,metadata:{title:id},source:{kind:'generated',bytes:png,mimeType:'image/png'}});
function fixture(extra={}) {
 const calls=[];let paid=0;
 const adapter={model:{provider:'openai',model:'gpt-4.1'},available:async()=>({supported:true,reason:'fixture'}),privacyBlocked:()=>false,beforePaidCall:()=>paid++,complete:async input=>{calls.push(input);return JSON.stringify({candidates:JSON.parse(input.user).candidates.map(c=>({id:c.id,relevance:c.id==='red'?0.95:0.1,reasoning:c.id==='red'?'A red square is visible.':'The requested subject is absent.'}))});},...extra};
 const session=new service.VisionSession(request,adapter);
 return {session,calls,paid:()=>paid,prepare:async(ids=['red','blue'])=>session.prepareImages(ids.map(source),permission,'fixture'),review:c=>session.reviewImages({request,candidates:c.map(({id,imageId})=>({id,imageId}))},'fixture')};
}
test('core registry contract and manifest permission expansion',()=>{
 assert.ok(sdk.CORE_CAPABILITY_IDS.includes('nodus:vision'));assert.equal(sdk.normalizeCapabilityId('vision'),'nodus:vision');
 assert.throws(()=>sdk.assertMayProvide({id:'evil',publisher:{id:'NodusResearch'}},'nodus:vision'),/core/);
 sdk.validateJsonSchema(contract.VISION_TOOLS[0].inputSchema);
 assert.equal(contract.VISION_TOOLS[0].billing,'per-call');
 assert.deepEqual(sdk.validateTrustedPermissions(permission),permission);
 for(const maxRounds of [0,4,-1,1.5,'3',Infinity])assert.throws(()=>sdk.validateTrustedPermissions({vision:{maxRounds}}));
 assert.equal(sdk.permissionsExpandV2({},permission),true);assert.equal(sdk.permissionsExpandV2(permission,{vision:{maxRounds:1}}),false);
 assert.equal(sdk.trustedCapabilityIsMetered(permission),true);
 assert.equal(sdk.validateWorkerToHost({type:'host-call',callId:'abc',channel:'vision',method:'reviewImages',payload:{}}).channel,'vision');
});
test('support is provider-aware, unknown fails closed, explicit negative wins',()=>{
 for(const provider of ['openai','anthropic','gemini','openrouter','groq','cerebras','deepseek','xiaomi','ollama','lmstudio','custom','nodus']) {
  assert.equal(support.visionModelSupport({provider,model:'fixture'},{id:'fixture',vision:true}).supported,true,provider);
  assert.equal(support.visionModelSupport({provider,model:'fixture'},{id:'fixture',vision:false}).supported,false);
  assert.equal(support.visionModelSupport({provider,model:'fixture'},{id:'fixture'}).supported,false);
 }
 for(const provider of ['codex','github-copilot','opencode-go','unsupported'])assert.equal(support.visionModelSupport({provider,model:'gpt-4.1'},{id:'gpt-4.1',vision:true}).supported,false);
 assert.equal(support.visionModelSupport({provider:'openai',model:'gpt-4.1'},{id:'gpt-4.1'}).supported,true);
 assert.equal(support.visionModelSupport({provider:'openai',model:'gpt-4.1'},{id:'gpt-4.1',vision:false}).supported,false);
 for(const model of ['gpt-4','gpt-4-0613','gpt-99-vision','gpt-4.1-evil'])assert.equal(support.visionModelSupport({provider:'openai',model},{id:model}).supported,false);
 assert.equal(support.visionModelSupport({provider:'custom',model:'gpt-4.1'},{id:'gpt-4.1'}).supported,false);
 assert.equal(support.visionModelSupport({provider:'openai',model:'gpt-4.1'}).supported,false);
});
test('real raster decoding, metadata stripping and bounded dimensions',async()=>{
 const large=await sharp({create:{width:1400,height:1200,channels:3,background:'blue'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const result=await images.normalizeVisionImage(large); const info=await sharp(Buffer.from(result.base64,'base64')).metadata();
 assert.ok(info.width<=768 && info.height<=768);assert.equal(info.exif,undefined);assert.equal(info.format,'jpeg');
 assert.match(result.thumbnailSha256,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>images.normalizeVisionImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')),/raster/);
 await assert.rejects(()=>images.normalizeVisionImage(Buffer.from('not an image')));
 await assert.rejects(()=>images.normalizeVisionImage(Buffer.alloc(sdk.VISION_LIMITS.inputBytes+1)));
});
test('relevant selection sends actual normalized images in deterministic order to both transport formats',async()=>{
 const f=fixture(), candidates=await f.prepare(),result=await f.review(candidates);
 assert.equal(result.outcome,'selected');assert.deepEqual(result.selected,['red']);assert.equal(result.candidates.every(c=>c.inspected),true);assert.equal(f.paid(),1);
 assert.equal(f.calls.length,1);const call=f.calls[0];assert.equal(call.images.length,2);assert.equal(call.maxTokens,1200);
 assert.equal(JSON.parse(call.user).originalRequest,request);assert.deepEqual(JSON.parse(call.user).candidates.map(c=>c.id),['red','blue']);
 assert.ok(call.images[0].base64.length>0);assert.equal(result.candidates[0].thumbnailSha256,candidates[0].provenance.thumbnailSha256);
 const oa=transport.openAiVisionContent(call.user,call.images),an=transport.anthropicVisionContent(call.user,call.images);
 assert.equal(oa[1].image_url.url,'data:image/jpeg;base64,'+call.images[0].base64);assert.equal(an[1].source.data,call.images[0].base64);
 f.session.dispose();
});
test('all rejected explicitly; a second search batch can succeed without recursive completions',async()=>{
 const f=fixture();const first=await f.review(await f.prepare(['blue']));assert.equal(first.outcome,'no_relevant_candidate');assert.deepEqual(first.selected,[]);
 const second=await f.review(await f.prepare(['red']));assert.equal(second.outcome,'selected');assert.equal(second.round,2);assert.equal(second.remainingRounds,1);assert.equal(f.calls.length,2);
 f.session.dispose();
});
test('text-only fallback does not need or inspect image bytes and never bills',async()=>{
 const f=fixture({available:async()=>({supported:false,reason:'text-only'})});
 const result=await f.review([{id:'candidate',imageId:'unknown'}]);assert.equal(result.status,'skipped');assert.equal(result.outcome,'vision_unavailable');assert.equal(f.calls.length,0);assert.equal(f.paid(),0);assert.equal(result.candidates[0].inspected,false);assert.deepEqual(result.selected,[]);
});
test('privacy context stops before discovery or transmission',async()=>{
 const f=fixture({privacyBlocked:()=>true,available:()=>{throw new Error('must not discover');}});
 assert.equal((await f.review([{id:'a',imageId:'a'}])).outcome,'privacy_blocked');assert.equal(f.calls.length,0);
});
test('three rounds across all callers, failed/skipped attempts count and lower permission limits apply',async()=>{
 const f=fixture(),c=await f.prepare();
 for(let i=0;i<3;i++)assert.equal((await f.session.reviewImages({request,candidates:c.map(({id,imageId})=>({id,imageId}))},'caller'+i)).status,'reviewed');
 assert.equal((await f.review(c)).outcome,'limit_reached');assert.equal(f.calls.length,3);
 const g=fixture(),d=await g.prepare();await g.session.reviewImages({request,candidates:d.map(({id,imageId})=>({id,imageId}))},'limited',1);
 assert.equal((await g.session.reviewImages({request,candidates:d.map(({id,imageId})=>({id,imageId}))},'limited',1)).outcome,'limit_reached');
 for(let i=0;i<2;i++)await g.prepare();await assert.rejects(()=>g.prepare(),/budget/);
});
test('forged, duplicate, extra or missing model scores cannot create inspection/selection results',async()=>{
 for(const raw of ['{}','not JSON',JSON.stringify({candidates:[{id:'evil',relevance:1,reasoning:'seen'}]}),JSON.stringify({candidates:[{id:'red',relevance:1,reasoning:'seen',inspected:true}]}),JSON.stringify({candidates:[{id:'red',relevance:2,reasoning:'seen'}]}),JSON.stringify({selected:['red'],candidates:[{id:'red',relevance:1,reasoning:'seen'}]})]) {
  const f=fixture({complete:async()=>raw});const result=await f.review(await f.prepare(['red']));assert.equal(result.outcome,'invalid_review');assert.deepEqual(result.selected,[]);assert.equal(result.candidates[0].inspected,false);
 }
});
test('handles cannot be forged, relabelled or reused in a different session',async()=>{
 const f=fixture(),g=fixture(),c=await f.prepare(['red']);
 assert.equal((await g.review(c)).outcome,'review_failed');assert.equal(g.calls.length,0);
 assert.equal((await f.review([{...c[0],id:'invented'}])).outcome,'review_failed');assert.equal(f.calls.length,0);
 await assert.rejects(()=>f.session.reviewImages({request:'different request',candidates:c},'fixture'),/Invalid|original/);
 await assert.rejects(()=>f.session.prepareImages([source('a')],{},'fixture'),/permitted/);
});
test('bounded candidate schema denies file access, URLs, unsafe metadata, duplicates and oversized lists',()=>{
 for(const value of [[],Array.from({length:6},(_,i)=>source('a'+i)),[source('a'),source('a')],[{...source('a'),source:{kind:'file',path:'/private'}}],[{...source('a'),source:{kind:'public',url:'https://example.org'}}],[{...source('a'),metadata:{title:'ok',secret:'no'}}]])assert.throws(()=>sdk.validateVisionCandidates(value));
});
test('public intake requires approved paths, public addresses and no secret injection',async()=>{
 const permissions={network:[{id:'images',origin:'https://images.example.org',pathPrefixes:['/public'],methods:['GET'],maxResponseBytes:10000,timeoutMs:5000}]};
 const pub=path=>({kind:'public',endpointId:'images',path});
 assert.equal(images.publicImageTarget(pub('/public/a.png'),permissions).url.href,'https://images.example.org/public/a.png');
 for(const path of ['/private/a','//evil.test/a','/public/../private/a','/public/%2e%2e/private/a','/public/%2e%2e%2fprivate/a','/public/%252e%252e/private/a','/public/\\evil','file:///private','https://evil.test/a'])assert.throws(()=>images.publicImageTarget(pub(path),permissions),path);
 assert.throws(()=>images.publicImageTarget(pub('/public/a'),{...permissions,secrets:[{injection:{kind:'header',endpointId:'images'}}]}),/credentials/);
 await assert.rejects(()=>images.fetchPublicImage(pub('/public/a'),{network:[{...permissions.network[0],origin:'https://127.0.0.1'}]},new AbortController().signal),/public/);
});
test('cancellation reaches the completion, discards late output and prevents concurrent calls',async()=>{
 let entered,resolve;const ready=new Promise(r=>entered=r);let seen;
 const f=fixture({complete:input=>{seen=input.signal;entered();return new Promise(r=>resolve=r);}}),c=await f.prepare(['red']);
 const abort=new AbortController();const pending=f.session.reviewImages({request,candidates:c.map(({id,imageId})=>({id,imageId}))},'fixture',3,abort.signal);
 await ready;assert.equal((await f.review(c)).outcome,'limit_reached');abort.abort();await assert.rejects(()=>pending,{name:'AbortError'});assert.equal(seen.aborted,true);
 resolve(JSON.stringify({candidates:[{id:'red',relevance:1,reasoning:'late'}]}));f.session.dispose();await assert.rejects(()=>f.review(c),{name:'AbortError'});
});
test('provider failures return sanitized errors without repair or hidden calls',async()=>{
 let calls=0;const f=fixture({complete:async()=>{calls++;throw new Error('secret=credential image=base64');}});const result=await f.review(await f.prepare(['red']));
 assert.equal(result.outcome,'review_failed');assert.doesNotMatch(JSON.stringify(result),/credential|base64/);assert.equal(calls,1);
});
test('receipt schemas cannot invent inspection or selection; native boundaries validate them',async()=>{
 const f=fixture();const result=await f.review(await f.prepare(['red']));assert.deepEqual(sdk.validateVisionReviewResult(result),result);
 for(const change of [v=>v.candidates[0].inspected=false,v=>v.selected=['invented'],v=>v.candidates[0].thumbnailSha256='forged',v=>v.status='skipped',v=>v.model.apiKey='secret',v=>v.round=4]){const v=structuredClone(result);change(v);assert.throws(()=>sdk.validateVisionReviewResult(v));}
});
test('an expired total deadline cannot make another model request',async()=>{
 const f=fixture(),c=await f.prepare();await f.review(c);const now=Date.now;Date.now=()=>now()+sdk.VISION_LIMITS.sessionMs+1;
 try{assert.equal((await f.review(c)).outcome,'limit_reached');assert.equal(f.calls.length,1);}finally{Date.now=now;f.session.dispose();}
});
test('per-operation deadline aborts even an adapter that ignores cancellation',async()=>{
 let signal;const f=fixture({complete:input=>{signal=input.signal;return new Promise(()=>{});}}),c=await f.prepare();const schedule=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms,...args)=>schedule(fn,ms===sdk.VISION_LIMITS.callMs?10:ms,...args);
 try{assert.equal((await f.review(c)).outcome,'review_failed');assert.equal(signal.aborted,true);}finally{globalThis.setTimeout=schedule;f.session.dispose();}
});
test('public intake pins DNS, disallows redirects and enforces response bytes without auth',async()=>{
 const https=require('node:https'),dns=require('node:dns').promises,{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
 const get=https.get,lookup=dns.lookup;let status=200,large=false,lookups=0;
 dns.lookup=async()=>{lookups++;return [{address:'93.184.215.14',family:4}];};
 https.get=(url,options,receive)=>{
  assert.equal(options.agent,false);assert.deepEqual(Object.keys(options.headers),['User-Agent','Accept']);assert.match(options.headers['User-Agent'],/^Nodus\/[^ ]+ \(https:\/\/github.com\/Drakonis96\/nodus\)$/);
  options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'93.184.215.14',family:4}]);});
  const request=new EventEmitter();request.setTimeout=()=>request;request.destroy=error=>request.emit('error',error);
  queueMicrotask(()=>{const response=Readable.from([Buffer.from('image')]);response.statusCode=status;response.headers={'content-length':large?'99999999':'5'};receive(response);});return request;
 };
 const permission={network:[{id:'images',origin:'https://images.example.org',pathPrefixes:['/public'],methods:['GET'],maxResponseBytes:10000,timeoutMs:5000}]},source={kind:'public',endpointId:'images',path:'/public/a'};
 try{assert.equal((await images.fetchPublicImage(source,permission,new AbortController().signal)).bytes.toString(),'image');assert.equal(lookups,1);status=302;await assert.rejects(()=>images.fetchPublicImage(source,permission,new AbortController().signal),/failed/);status=200;large=true;await assert.rejects(()=>images.fetchPublicImage(source,permission,new AbortController().signal),/size limit/);}finally{https.get=get;dns.lookup=lookup;}
});

test('documented Gemini 3.1 Flash-Lite is supported only on Gemini with a live catalog match',()=>{
 const model={provider:'gemini',model:'gemini-3.1-flash-lite'};
 assert.equal(support.visionModelSupport(model,{id:model.model}).supported,true);
 assert.equal(support.visionModelSupport(model).supported,false);
 assert.equal(support.visionModelSupport(model,{id:model.model,vision:false}).supported,false);
 assert.equal(support.visionModelSupport({...model,provider:'custom'},{id:model.model}).supported,false);
});
