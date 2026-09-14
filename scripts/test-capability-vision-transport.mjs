// Actual aiClient and provider adapters against a local fixture server. No paid requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-vision-transport'))process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-vision-transport-'));installRuntimeHooks(scratch);
const require=createRequire(import.meta.url),load=p=>require(path.join(repoRoot,p));
let vision=true,fail=false,hang=false;const seen=[];let connection;
const server=createServer((req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture',capabilities:{vision}}]}));return;}
 if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw);seen.push(body);
  if(hang){connection?.();return;}
  if(fail){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'fixture failure'}}));return;}
  const prompt=JSON.parse(body.messages.find(m=>m.role==='user').content[0].text);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'fixture-response',choices:[{message:{role:'assistant',content:JSON.stringify({candidates:prompt.candidates.map(c=>({id:c.id,relevance:0.95,reasoning:'The red square is visible.'}))})},finish_reason:'stop'}]}));
 });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 const settings=load('electron/db/settingsRepo.ts');settings.updateSettings({customProvider:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:['fixture']},synthesisModel:{provider:'custom',model:'fixture'}});
 const {createChatVisionSession}=load('electron/capabilities/vision/adapter.ts');
 const png=await require('sharp')({create:{width:40,height:40,channels:3,background:'red'}}).png().toBuffer();
 let billed=0;
 const fresh=()=>createChatVisionSession({question:'Find a red square.',model:{provider:'custom',model:'fixture'},beforePaidCall:()=>billed++});
 const prepare=s=>s.prepareImages([{id:'red',metadata:{title:'Square'},source:{kind:'generated',bytes:png,mimeType:'image/png'}}],{vision:{maxRounds:3}},'fixture');
 const input=c=>({request:'Find a red square.',candidates:c.map(({id,imageId})=>({id,imageId}))});
 let session=fresh();let candidates=await prepare(session);let result=await session.reviewImages(input(candidates),'fixture');
 assert.equal(result.outcome,'selected');assert.equal(seen.length,1);assert.equal(billed,1);
 const sent=seen[0];assert.equal(sent.model,'fixture');assert.equal(sent.max_tokens,1200);assert.equal(sent.tools,undefined);assert.equal(sent.messages.length,2);
 const content=sent.messages[1].content;assert.equal(content.length,2);assert.match(content[1].image_url.url,/^data:image\/jpeg;base64,/);assert.doesNotMatch(JSON.stringify(sent),/file:\/\/|nodus-image:|vault|api.key/);session.dispose();
 vision=false;session=fresh();result=await session.reviewImages(input(candidates),'fixture');assert.equal(result.outcome,'vision_unavailable');assert.equal(seen.length,1);assert.equal(billed,1);session.dispose();
 vision=true;fail=true;session=fresh();candidates=await prepare(session);result=await session.reviewImages(input(candidates),'fixture');assert.equal(result.outcome,'review_failed');assert.equal(seen.length,2,'503 must not trigger transport or schema retries');session.dispose();
 fail=false;hang=true;session=fresh();candidates=await prepare(session);const controller=new AbortController();const entered=new Promise(r=>connection=r);
 const pending=session.reviewImages(input(candidates),'fixture',3,controller.signal);await entered;controller.abort();await assert.rejects(()=>pending,{name:'AbortError'});session.dispose();
 console.log('VISION TRANSPORT PASS: live model metadata, real JPEG multipart content, fixed output budget, no tools, text-only fallback, no 503 retry, cancellation.');
} finally {load('electron/db/database.ts').closeDb?.();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(scratch,{recursive:true,force:true});}
