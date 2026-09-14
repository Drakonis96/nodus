// Real completion adapters and SDK wire contracts, backed exclusively by localhost.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--attachment-wire')) process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-attachment-wire-'));installRuntimeHooks(scratch);
const require=createRequire(import.meta.url),load=file=>require(path.join(repoRoot,file));
const seen=[];
const server=createServer((req,res)=>{
 let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
  const body=JSON.parse(raw||'{}');seen.push({url:req.url,body});
  if(body.stream){
   res.writeHead(200,{'content-type':'text/event-stream'});
   if(req.url.endsWith('/messages'))res.end('event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Answer'}})+'\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
   else if(req.url.endsWith('/responses'))res.end('event: response.output_text.delta\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Answer'})+'\n\nevent: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed'}})+'\n\n');
   else res.end('data: '+JSON.stringify({choices:[{delta:{content:'Answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  }else{
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify(req.url.endsWith('/messages')?{content:[{type:'text',text:'Answer'}],stop_reason:'end_turn'}:req.url.endsWith('/responses')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Answer'}]}]}:{choices:[{message:{role:'assistant',content:'Answer'},finish_reason:'stop'}]}));
  }
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const fetch=globalThis.fetch;globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(url.origin,base,'no external network');return fetch(input,options);};
try{
 load('electron/db/settingsRepo.ts').updateSettings({customProvider:{baseUrl:base+'/v1',models:['vision-fixture']},chatReasoning:'off',synthesisModel:{provider:'openai',model:'gpt-4.1'}});
 load('electron/secrets/secretStore.ts').getApiKey=()=> 'test-key';
 load('electron/ai/providers.ts').openAiCompatBase=()=>base+'/v1';process.env.ANTHROPIC_BASE_URL=base+'/v1';
 const native=load('electron/ai/nodusLocalAi.ts');native.ensureNodusLocalServer=async()=>base+'/v1';native.withNodusLocalServerLease=async(_model,_kind,run)=>run(base+'/v1');
 const ai=load('electron/ai/aiClient.ts');
 const png=await require('sharp')({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer();
 const images=[{mediaType:'image/png',base64:png.toString('base64')}];
 const opts={system:'Read user attached source data.',user:'[census.csv]\nCity,Total\nMadrid,42',images,maxTokens:1200,reasoning:'off'};
 let count=0;
 for(const provider of ['openai','anthropic','gemini','deepseek','groq','cerebras','xiaomi','openrouter','custom','ollama','lmstudio','nodus']){
  for(const streaming of [false,true]){
   const model={provider,model:provider==='anthropic'?'claude-sonnet-4-6':provider==='nodus'?'qwen3.5-0.8b-q4':'vision-fixture'};
   const answer=streaming?await ai.completeTextStream(opts,()=>{},model):await ai.completeText(opts,model);assert.equal(answer,'Answer');
   const body=seen.at(-1).body;assert.equal(body.model,model.model);const content=body.messages.find(message=>message.role==='user').content;
   assert.match(content.find(part=>part.type==='text').text,/Madrid,42/);
   assert.equal(provider==='anthropic'?content.find(part=>part.type==='image').source.data:content.find(part=>part.type==='image_url').image_url.url.split(',')[1],images[0].base64);count++;
  }
 }
 const go=load('electron/ai/openCodeGoCompletion.ts');
 for(const model of ['vision-fixture','qwen-vision-fixture','gpt-5.6-sol'])for(const streaming of [false,true]){
  const result=await go.completeWithOpenCodeGo({...opts,model,apiKey:'test-key',baseUrl:base,...(streaming?{onDelta:()=>{}}:{})});assert.equal(result.text,'Answer');
  const {body,url}=seen.at(-1);assert.equal(body.model,model);
  const content=url.endsWith('/responses')?body.input[0].content:body.messages.find(message=>message.role==='user').content;
  const data=url.endsWith('/responses')?content[1].image_url.split(',')[1]:url.endsWith('/messages')?content.find(part=>part.type==='image').source.data:content.find(part=>part.type==='image_url').image_url.url.split(',')[1];assert.equal(data,images[0].base64);count++;
 }
 // Codex uses localImage parts in an ephemeral subscription thread.
 const turns=[];const runtime={listeners:new Set(),onNotification(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},async request(method,params){
  if(method==='thread/start')return {thread:{id:'test-thread'}};
  if(method==='thread/unsubscribe')return {};
  if(method==='turn/start') {turns.push(params);const part=params.input.find(item=>item.type==='localImage');assert.deepEqual(fs.readFileSync(part.path),png);queueMicrotask(()=>{for(const fn of this.listeners){fn('item/agentMessage/delta',{threadId:params.threadId,delta:'Answer'});fn('turn/completed',{threadId:params.threadId,turn:{status:'completed',items:[]}});}});return {turn:{id:'test-turn'}};}
  throw new Error(method);
 }};
 const codex=load('electron/ai/codexCompletion.ts');
 const codexResult=await codex.runIsolatedCodexCompletion(runtime,{...opts,model:'vision-fixture',workdir:scratch});assert.equal(codexResult,'Answer');assert.equal(turns.length,1);count++;
 let copilotRequest;
 const client={async createSession(){return {sessionId:'test',on(){return()=>{};},async sendAndWait(request){copilotRequest=request;return {data:{content:'Answer'}};},async abort(){},async disconnect(){}};},async deleteSession(){}};
 const copilot=await load('electron/ai/githubCopilotCompletion.ts').runIsolatedGitHubCopilotCompletion(client,{...opts,model:'vision-fixture',workdir:scratch,supportsReasoning:false});assert.equal(copilot.text,'Answer');assert.equal(copilotRequest.attachments[0].data,images[0].base64);assert.match(copilotRequest.prompt,/Madrid,42/);count++;
 console.log(`PASS: ${count} real adapter contracts: 12 API providers in streaming/nonstreaming, 3 OpenCode protocols, Codex localImage, Copilot blob. Original PNG bytes and CSV text reach the selected model. Local fixture responses, no paid inference.`);
}finally{load('electron/db/database.ts').closeDb();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
