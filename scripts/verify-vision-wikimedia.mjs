// Opt-in live integration demo: uses only the configured chat model's encrypted key
// in an isolated profile. Never prints/decrypts credentials into an artifact.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {installRuntimeHooks,repoRoot} from './lib/tsRuntimeHooks.mjs';
const require=createRequire(import.meta.url);
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.join(repoRoot,'node_modules/.bin/electron'),[fileURLToPath(import.meta.url)],{env,stdio:'inherit'});
 child.on('exit',code=>process.exit(code??1));
}else{
 const electron=require('electron');electron.app.setName('Nodus');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-vision-live-'));electron.app.setPath('userData',scratch);
 const out=path.join(repoRoot,'artifacts/vision/wikimedia');fs.mkdirSync(out,{recursive:true});
 let close=()=>{};
 electron.app.whenReady().then(async()=>{
 try{
  // Search only in this opt-in demo; the reusable core has no Wikimedia knowledge.
  const searchFile=path.join(out,'search.json');
  if(!fs.existsSync(searchFile)) {
   const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:'daguerreotype filetype:bitmap',gsrnamespace:'6',gsrlimit:'5',prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'600',iiextmetadatafilter:'ImageDescription|Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms'});
   const url='https://commons.wikimedia.org/w/api.php?'+params;
   const response=await fetch(url,{headers:{'User-Agent':'NodusVisionDemo/1.0 (https://github.com/Drakonis96/nodus)'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error('Wikimedia search failed: '+response.status);
   const result=await response.json();
   if(!result.query?.pages?.length)throw new Error('No Wikimedia image candidates.');
   fs.writeFileSync(searchFile,JSON.stringify({url,retrievedAt:new Date().toISOString(),result},null,2));
  }
  const profile=path.join(os.homedir(),'Library/Application Support/Nodus');
  const prefs=JSON.parse(fs.readFileSync(path.join(profile,'app-prefs.json'),'utf8'));
  const model=prefs.chatModel;
  if(!model?.provider || !model?.model)throw new Error('No configured chat model.');
  const secret=path.join(profile,'secrets',`ai_key_${model.provider}.bin`);
  if(fs.existsSync(secret)){fs.mkdirSync(path.join(scratch,'secrets'),{mode:0o700});fs.copyFileSync(secret,path.join(scratch,'secrets',path.basename(secret)));}
  installRuntimeHooks(scratch,{safeStorage:electron.safeStorage});
  const load=p=>require(path.join(repoRoot,p));
  close=load('electron/db/database.ts').closeDb;
  load('electron/db/settingsRepo.ts').updateSettings({chatModel:model,synthesisModel:model});
  const adapter=load('electron/capabilities/vision/adapter.ts').createVisionAdapter(model);
  const support=await adapter.available(AbortSignal.timeout(15000));console.log('Selected model:',JSON.stringify(model),'Support:',JSON.stringify(support));
  const pages=JSON.parse(fs.readFileSync(path.join(out,'search.json'),'utf8')).result.query.pages.sort((a,b)=>a.index-b.index);
  const strip=s=>String(s??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const found=pages.map(p=>{const i=p.imageinfo[0],m=i.extmetadata,u=new URL(i.thumburl);return {id:String(p.pageid),metadata:{title:p.title.slice(0,300),description:strip(m.ImageDescription?.value).slice(0,1000)||p.title,attribution:strip(m.Artist?.value).slice(0,1000)||'See source page'},source:{kind:'public',endpointId:'commons-thumbnails',path:u.pathname+u.search},page:i.descriptionurl,thumbnail:i.thumburl,license:strip(m.LicenseShortName?.value)};});
  if(found.some(c=>new URL(c.thumbnail).origin!=='https://thumb.wikimedia.org'))throw new Error('Unexpected thumbnail origin; review demo permission first.');
  const permission={vision:{maxRounds:1},network:[{id:'commons-thumbnails',origin:'https://thumb.wikimedia.org',pathPrefixes:['/wikipedia/commons/thumb/'],methods:['GET'],maxResponseBytes:5242880,timeoutMs:15000}]};
  const {VisionSession}=load('electron/capabilities/vision/service.ts');
  let paid=0;adapter.beforePaidCall=()=>{if(++paid>1)throw new Error('Live demo limited to one paid review.');};
  // Save the exact normalized bytes passed to the real provider for reproducible visual QA.
  const complete=adapter.complete;adapter.complete=input=>{input.images.forEach((image,i)=>fs.writeFileSync(path.join(out,found[i].id+'.jpg'),Buffer.from(image.base64,'base64')));return complete(input);};
  const request='Find pictures of a daguerreotype: examples of the historical photographic object or the daguerreotype photograph itself. Prefer a clearly visible original plate, case or framed object. Historical daguerreotype reproductions are also relevant, but distinguish restoration or cropping from the original object.';
  const session=new VisionSession(request,adapter);try{
   const prepared=await session.prepareImages(found.map(({id,metadata,source})=>({id,metadata,source})),permission,'wikimedia-demo');console.log('Prepared actual thumbnails:',prepared.length);
   const review=await session.reviewImages({request,candidates:prepared.map(({id,imageId})=>({id,imageId}))},'wikimedia-demo',1);
   fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({request,model,support,paidCalls:paid,candidates:found,prepared,review},null,2));
   console.log('Review:',JSON.stringify(review));
  }finally{session.dispose();}
 }catch(error){console.error('Live demo failed:',error instanceof Error?error.message:'Unknown failure');process.exitCode=1;}
 finally{close();fs.rmSync(scratch,{recursive:true,force:true});electron.app.exit(process.exitCode??0);}
 });
}
