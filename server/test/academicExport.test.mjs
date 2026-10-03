import assert from 'node:assert/strict';
import test from 'node:test';
import {withServer} from '../../scripts/lib/nodusServerHarness.mjs';
const text=value=>[{id:'argument-'+value.replace(/[^a-z]/gi,'-'),type:'paragraph',props:{},content:[{type:'text',text:value,styles:{}}],children:[]}];
const academic={formatVersion:1,style:'apa',locale:'es-ES',placement:'in-text',notes:{},evidence:[]};
test('academic deliveries preserve private native state and enforce ownership, vaults and revisions',async()=>{
 await withServer({label:'academic-delivery',ai:true},async ctx=>{
  const vaultId=await ctx.createSpace('Paper'),otherVault=await ctx.createSpace('Other vault');
  const user=await ctx.createUser('academic-owner@example.test','academic-owner-password-long',[{spaceId:vaultId,role:'reader'},{spaceId:otherVault,role:'reader'}]);
  const stranger=await ctx.createUser('academic-stranger@example.test','academic-stranger-password-long',[{spaceId:vaultId,role:'reader'}]);
  const cookie=await ctx.signIn(user.email,user.password),csrf=await ctx.csrf(cookie);
  const call=(method,url,body)=>fetch(ctx.origin+url,{method,headers:{cookie,origin:ctx.origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const create=async(title,vault=vaultId,metadata={})=>{const response=await call('POST','/api/v2/me/artifacts',{vaultId:vault,kind:'workspace-note',title,metadata:{surface:'workspace',nativeDocument:text(title),academicMetadata:academic,...metadata}});assert.equal(response.status,201);return (await response.json()).artifact;};
  const chapter=await create('Chapter'),foreign=await create('Another vault',otherVault);
  const root=await create('Manuscript');
  const exportPath=`/api/v2/me/artifacts/${root.id}/academic-export`;
  for(const format of ['docx','latex']){const result=await call('POST',exportPath,{expectedRevision:root.revision,format,acceptWarnings:true});assert.equal(result.status,200);const file=await result.json();assert.ok(file.base64.length>1000);assert.match(file.html,/Manuscript/);}
  assert.equal((await call('POST',exportPath,{expectedRevision:0,format:'docx'})).status,409);
  const formatOnly=await call('PATCH',`/api/v2/me/artifacts/${root.id}`,{expectedRevision:root.revision,metadata:{...root.metadata,academicMetadata:{...academic,style:'vancouver'}}});assert.equal(formatOnly.status,200);let saved=(await formatOnly.json()).artifact;assert.equal(saved.metadata.editorVersions.at(-1).academicMetadata.style,'apa');assert.deepEqual(saved.metadata.nativeDocument,root.metadata.nativeDocument);
  const manuscript={kind:'thesis',chapters:[{documentId:chapter.id,kind:'note',title:chapter.title,included:true}],authors:'Investigador',abstract:'',keywords:'',includeContents:true,paper:'A4',marginMm:25};
  const patch=async chapters=>{const response=await call('PATCH',`/api/v2/me/artifacts/${root.id}`,{expectedRevision:saved.revision,metadata:{...saved.metadata,academicMetadata:{...academic,manuscript:{...manuscript,chapters}}}});assert.equal(response.status,200);saved=(await response.json()).artifact;};
  await patch(manuscript.chapters);
  const preflight=await call('POST',exportPath,{expectedRevision:saved.revision,format:'check'});assert.equal(preflight.status,200);assert.deepEqual((await preflight.json()).issues,[]);
  const assembled=await call('POST',exportPath,{expectedRevision:saved.revision,format:'latex'});assert.equal(assembled.status,200);assert.match((await assembled.json()).html,/Chapter/);
  await patch([{...manuscript.chapters[0],documentId:foreign.id}]);assert.equal((await call('POST',exportPath,{expectedRevision:saved.revision,format:'docx',acceptWarnings:true})).status,422);
  const outsiderCookie=await ctx.signIn(stranger.email,stranger.password),outsiderCsrf=await ctx.csrf(outsiderCookie);
  assert.equal((await fetch(ctx.origin+exportPath,{method:'POST',headers:{cookie:outsiderCookie,origin:ctx.origin,'x-csrf-token':outsiderCsrf,'content-type':'application/json'},body:JSON.stringify({expectedRevision:saved.revision,format:'docx'})})).status,404);
  assert.equal((await fetch(ctx.origin+exportPath,{method:'POST',headers:{cookie,origin:ctx.origin,'content-type':'application/json'},body:JSON.stringify({expectedRevision:saved.revision,format:'latex'})})).status,403);
 });
});
