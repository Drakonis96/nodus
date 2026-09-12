// Deterministic outcomes against the real image decoder/session, using fixture judgments.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/vision');fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),sharp=require('sharp'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-vision-demo-'));
let browser;
try {
 const bundle=path.join(scratch,'vision.cjs');await build({entryPoints:[path.join(root,'electron/capabilities/vision/service.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'sharp',setup(b){b.onResolve({filter:/^sharp$/},()=>({path:require.resolve('sharp'),external:true}));}}]});
 const {VisionSession}=require(bundle);
 const request='Find a clear image of a red square.';
 const assets={};
 for(const [id,color] of [['red','#c83e4b'],['blue','#357bbb']]){assets[id]=await sharp({create:{width:120,height:120,channels:3,background:color}}).png().toBuffer();fs.writeFileSync(path.join(out,id+'.png'),assets[id]);}
 const candidate=id=>({id,metadata:{title:id==='red'?'Red square':'Blue square'},source:{kind:'generated',bytes:assets[id],mimeType:'image/png'}});
 const scenarios=[{name:'Relevant image selected',batches:[['red','blue']],supported:true,expected:'selected'},{name:'All candidates rejected',batches:[['blue']],supported:true,expected:'no_relevant_candidate'},{name:'Text-only model fallback',batches:[['red','blue']],supported:false,expected:'vision_unavailable'},{name:'Second-batch success',batches:[['blue'],['red']],supported:true,expected:'selected'}];
 const reports=[];
 for(const scenario of scenarios){
  let calls=0;const session=new VisionSession(request,{model:{provider:'fixture',model:scenario.supported?'vision-fixture':'text-only-fixture'},privacyBlocked:()=>false,available:async()=>({supported:scenario.supported,reason:scenario.supported?'Fixture image input':'Text-only fixture model'}),complete:async input=>{calls++;assert.equal(input.images.length,JSON.parse(input.user).candidates.length);return JSON.stringify({candidates:JSON.parse(input.user).candidates.map(c=>({id:c.id,relevance:c.id==='red'?0.96:0.08,reasoning:c.id==='red'?'A red square fills the image.':'The square is blue, so it does not match the requested color.'}))});}});
  const rounds=[];
  for(const batch of scenario.batches){const prepared=await session.prepareImages(batch.map(candidate),{vision:{maxRounds:3}},'demo');const result=await session.reviewImages({request,candidates:prepared.map(({id,imageId})=>({id,imageId}))},'demo');rounds.push(result);if(result.outcome!=='no_relevant_candidate')break;}
  assert.equal(rounds.at(-1).outcome,scenario.expected);assert.equal(calls,scenario.supported?scenario.batches.length:0);session.dispose();
  reports.push({name:scenario.name,calls,rounds});
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({fixture:true,request,scenarios:reports},null,2));
 const cards=reports.map(report=>`<article><h2>${report.name}</h2><p class="calls">${report.calls} model call${report.calls===1?'':'s'}</p>${report.rounds.map(round=>`<div class="round"><b>Round ${round.round} · ${round.outcome}</b><div class="images">${round.candidates.map(c=>`<figure><img src="${c.id}.png" alt="${c.id} square"><figcaption>${c.id} · ${c.relevance===null?'not inspected':Math.round(c.relevance*100)+'% relevance'}${round.selected.includes(c.id)?' · selected':''}</figcaption></figure>`).join('')}</div><p>${round.reason??round.candidates.map(c=>c.reasoning).join(' ')}</p></div>`).join('')}</article>`).join('');
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Nodus vision capability demos</title><style>:root{color-scheme:light dark;font:16px/1.5 system-ui;color:#263345;background:#f2f4f8}body{max-width:1100px;margin:40px auto;padding:0 24px}h1{font-size:30px;margin:0}header p{color:#59677b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#fff;border:1px solid #d9deea;border-radius:14px;padding:24px}h2{font-size:20px;margin:0}.calls{color:#59677b}.round{border-top:1px solid #e1e5ed;padding-top:12px;margin-top:16px}.images{display:flex;gap:24px;margin:16px 0}figure{margin:0}img{width:84px;height:84px;border-radius:6px}figcaption{font-size:13px;margin-top:8px}b{font-size:14px;color:#5850a3}.round p{font-size:14px}footer{margin:24px 0;font-size:14px}@media(prefers-color-scheme:dark){:root{color:#e4e8f2;background:#151922}article{background:#202631;border-color:#394354}header p,.calls{color:#bbc4d4}.round{border-color:#394354}b{color:#b7b0ff}}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><header><h1>Controlled image review</h1><p>Request: ${request}</p><p>Deterministic fixture judgments through the real capability service. These are software demos, not live model-quality evaluations.</p></header><main class="grid">${cards}</main><footer>Maximum 5 candidates × 3 review rounds. Text-only fallback sends no images to a model. Host handles and SHA-256 provenance are available in <a href="results.json">results.json</a>.</footer></html>`);
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:1100}});await page.goto('file://'+path.join(out,'index.html'));
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:path.join(out,colorScheme+'.png'),fullPage:true});}
 fs.writeFileSync(path.join(out,'README.md'),'# Deterministic vision demos\n\nOpen index.html for four scenarios; light.png and dark.png are browser captures. results.json contains actual host-generated receipts and thumbnail hashes. Fixture judgments are deterministic; random session handles/receipts intentionally change on each run. No paid model was called.\n');
 console.log('VISION DEMOS PASS: selected (1 call), rejected (1), text-only fallback (0), second-batch success (2). '+out);
} finally {await browser?.close();fs.rmSync(scratch,{recursive:true,force:true});}
